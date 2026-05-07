-- ============================================================================
-- GOLBIT - Migración Paso 3: Wallet completa
-- ============================================================================

-- 1. Nuevos campos en motor_settings: límites y modo de depósito
ALTER TABLE public.motor_settings
  ADD COLUMN IF NOT EXISTS deposit_min NUMERIC(20, 8) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS deposit_max NUMERIC(20, 8) NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS withdrawal_min NUMERIC(20, 8) NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS withdrawal_max NUMERIC(20, 8) NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS withdrawal_daily_max NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_ui_mode TEXT NOT NULL DEFAULT 'wallet'
    CHECK (deposit_ui_mode IN ('simple', 'proof', 'wallet')),
  ADD COLUMN IF NOT EXISTS deposit_wallet_address TEXT NOT NULL DEFAULT '0xGOLBIT4FAKE9d2a7c3b1e5f8a9d2c4b7e6a3f9c1';

-- withdrawal_daily_max = 0 significa "sin límite diario"

-- 2. Nuevos campos en transactions: comprobantes y dirección
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS proof_url TEXT,
  ADD COLUMN IF NOT EXISTS wallet_address TEXT,
  ADD COLUMN IF NOT EXISTS user_wallet TEXT;

-- proof_url: url del comprobante subido (modo proof)
-- wallet_address: dirección a la que el usuario "envía" (modo wallet)
-- user_wallet: dirección de retiro que ingresa el usuario al solicitar withdrawal

-- 3. Permitir saldo negativo en wallets (decisión confirmada)
-- Ya no hay un check positivo, pero validamos en función

-- ============================================================================
-- RPC: solicitar depósito
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_deposit(
  p_amount NUMERIC,
  p_proof_url TEXT DEFAULT NULL,
  p_user_wallet TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_settings RECORD;
  v_tx_id UUID;
  v_review_until TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

  -- Validar monto
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;
  IF p_amount < v_settings.deposit_min THEN
    RETURN jsonb_build_object('error', 'Monto mínimo: ' || v_settings.deposit_min::TEXT || ' USDT');
  END IF;
  IF p_amount > v_settings.deposit_max THEN
    RETURN jsonb_build_object('error', 'Monto máximo: ' || v_settings.deposit_max::TEXT || ' USDT');
  END IF;

  -- Determinar status según modo
  IF v_settings.deposit_mode = 'free' THEN
    v_status := 'completed';
    v_review_until := NULL;
  ELSE
    v_status := 'in_review';
    v_review_until := NOW() + (v_settings.deposit_review_hours || ' hours')::INTERVAL;
  END IF;

  -- Crear transacción
  INSERT INTO public.transactions (
    user_id, type, amount, coin_symbol, status, review_until,
    proof_url, wallet_address
  ) VALUES (
    v_user_id, 'deposit', p_amount, 'USDT', v_status, v_review_until,
    p_proof_url, v_settings.deposit_wallet_address
  ) RETURNING id INTO v_tx_id;

  -- Si es modo libre, acreditar al instante
  IF v_status = 'completed' THEN
    UPDATE public.wallets
    SET balance = balance + p_amount, updated_at = NOW()
    WHERE user_id = v_user_id AND coin_symbol = 'USDT';

    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_user_id,
      'Depósito acreditado',
      'Se acreditaron ' || p_amount::TEXT || ' USDT a tu wallet.',
      'wallet'
    );
  ELSE
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_user_id,
      'Depósito en revisión',
      'Tu solicitud de depósito de ' || p_amount::TEXT || ' USDT está en revisión.',
      'wallet'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_deposit TO authenticated;

-- ============================================================================
-- RPC: solicitar retiro
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount NUMERIC,
  p_user_wallet TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_settings RECORD;
  v_wallet RECORD;
  v_tx_id UUID;
  v_review_until TIMESTAMPTZ;
  v_status TEXT;
  v_today_total NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

  -- Validar dirección
  IF p_user_wallet IS NULL OR LENGTH(TRIM(p_user_wallet)) < 5 THEN
    RETURN jsonb_build_object('error', 'Dirección de retiro inválida');
  END IF;

  -- Validar monto
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;
  IF p_amount < v_settings.withdrawal_min THEN
    RETURN jsonb_build_object('error', 'Monto mínimo: ' || v_settings.withdrawal_min::TEXT || ' USDT');
  END IF;
  IF p_amount > v_settings.withdrawal_max THEN
    RETURN jsonb_build_object('error', 'Monto máximo: ' || v_settings.withdrawal_max::TEXT || ' USDT');
  END IF;

  -- Validar saldo
  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  IF v_wallet IS NULL OR (v_wallet.balance - v_wallet.locked_balance) < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente');
  END IF;

  -- Validar límite diario (si está configurado)
  IF v_settings.withdrawal_daily_max > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_today_total
    FROM public.transactions
    WHERE user_id = v_user_id
      AND type = 'withdrawal'
      AND status IN ('completed', 'in_review', 'pending', 'approved')
      AND created_at >= CURRENT_DATE;

    IF (v_today_total + p_amount) > v_settings.withdrawal_daily_max THEN
      RETURN jsonb_build_object(
        'error',
        'Excede el límite diario de ' || v_settings.withdrawal_daily_max::TEXT || ' USDT'
      );
    END IF;
  END IF;

  -- Determinar status
  IF v_settings.withdrawal_mode = 'free' THEN
    v_status := 'completed';
    v_review_until := NULL;
  ELSE
    v_status := 'in_review';
    v_review_until := NOW() + (v_settings.withdrawal_review_hours || ' hours')::INTERVAL;
  END IF;

  -- Crear transacción
  INSERT INTO public.transactions (
    user_id, type, amount, coin_symbol, status, review_until, user_wallet
  ) VALUES (
    v_user_id, 'withdrawal', p_amount, 'USDT', v_status, v_review_until, p_user_wallet
  ) RETURNING id INTO v_tx_id;

  -- Lockear el monto del balance disponible inmediatamente (esté en revisión o no)
  UPDATE public.wallets
  SET locked_balance = locked_balance + p_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  -- Si es modo libre, descontar al instante
  IF v_status = 'completed' THEN
    UPDATE public.wallets
    SET balance = balance - p_amount,
        locked_balance = locked_balance - p_amount,
        updated_at = NOW()
    WHERE user_id = v_user_id AND coin_symbol = 'USDT';

    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_user_id,
      'Retiro procesado',
      'Tu retiro de ' || p_amount::TEXT || ' USDT fue procesado.',
      'wallet'
    );
  ELSE
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_user_id,
      'Retiro en revisión',
      'Tu solicitud de retiro de ' || p_amount::TEXT || ' USDT está en revisión.',
      'wallet'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', v_tx_id, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_withdrawal TO authenticated;

-- ============================================================================
-- RPC: aprobar transacción (solo admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_approve_transaction(
  p_transaction_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_tx RECORD;
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins pueden aprobar');
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF v_tx IS NULL THEN
    RETURN jsonb_build_object('error', 'Transacción no encontrada');
  END IF;

  IF v_tx.status NOT IN ('pending', 'in_review') THEN
    RETURN jsonb_build_object('error', 'Esta transacción ya fue procesada');
  END IF;

  IF v_tx.type = 'deposit' THEN
    UPDATE public.wallets
    SET balance = balance + v_tx.amount, updated_at = NOW()
    WHERE user_id = v_tx.user_id AND coin_symbol = v_tx.coin_symbol;

    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_tx.user_id,
      'Depósito aprobado',
      'Se acreditaron ' || v_tx.amount::TEXT || ' USDT a tu wallet.',
      'success'
    );
  ELSIF v_tx.type = 'withdrawal' THEN
    UPDATE public.wallets
    SET balance = balance - v_tx.amount,
        locked_balance = locked_balance - v_tx.amount,
        updated_at = NOW()
    WHERE user_id = v_tx.user_id AND coin_symbol = v_tx.coin_symbol;

    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_tx.user_id,
      'Retiro aprobado',
      'Tu retiro de ' || v_tx.amount::TEXT || ' USDT fue procesado.',
      'success'
    );
  END IF;

  UPDATE public.transactions
  SET status = 'approved',
      processed_by = v_admin_id,
      processed_at = NOW(),
      notes = COALESCE(p_notes, notes)
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_transaction TO authenticated;

-- ============================================================================
-- RPC: rechazar transacción (solo admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_reject_transaction(
  p_transaction_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_tx RECORD;
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins pueden rechazar');
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF v_tx IS NULL THEN
    RETURN jsonb_build_object('error', 'Transacción no encontrada');
  END IF;

  IF v_tx.status NOT IN ('pending', 'in_review') THEN
    RETURN jsonb_build_object('error', 'Esta transacción ya fue procesada');
  END IF;

  -- Si era retiro, liberar el lock
  IF v_tx.type = 'withdrawal' THEN
    UPDATE public.wallets
    SET locked_balance = locked_balance - v_tx.amount, updated_at = NOW()
    WHERE user_id = v_tx.user_id AND coin_symbol = v_tx.coin_symbol;
  END IF;

  UPDATE public.transactions
  SET status = 'rejected',
      processed_by = v_admin_id,
      processed_at = NOW(),
      notes = COALESCE(p_notes, notes)
  WHERE id = p_transaction_id;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_tx.user_id,
    CASE WHEN v_tx.type = 'deposit' THEN 'Depósito rechazado' ELSE 'Retiro rechazado' END,
    'Tu solicitud de ' || v_tx.amount::TEXT || ' USDT fue rechazada' ||
      COALESCE('. Motivo: ' || p_notes, '.'),
    'error'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reject_transaction TO authenticated;

-- ============================================================================
-- RPC: ajuste manual de saldo (solo admin)
-- Permite saldos negativos según decisión
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  p_user_id UUID,
  p_amount NUMERIC, -- positivo = crédito, negativo = débito
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_tx_type TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins pueden ajustar saldos');
  END IF;

  IF p_amount = 0 THEN
    RETURN jsonb_build_object('error', 'El monto no puede ser cero');
  END IF;

  -- Asegurarse que la wallet exista
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_user_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  -- Aplicar ajuste (puede dejar negativo)
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND coin_symbol = 'USDT';

  v_tx_type := CASE WHEN p_amount > 0 THEN 'deposit' ELSE 'withdrawal' END;

  INSERT INTO public.transactions (
    user_id, type, amount, coin_symbol, status, processed_by, processed_at, notes,
    metadata
  ) VALUES (
    p_user_id, v_tx_type, ABS(p_amount), 'USDT', 'completed',
    v_admin_id, NOW(),
    'Ajuste manual: ' || COALESCE(p_notes, 'sin motivo'),
    jsonb_build_object('manual_adjustment', true, 'sign', SIGN(p_amount))
  );

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    CASE WHEN p_amount > 0 THEN 'Crédito recibido' ELSE 'Débito en cuenta' END,
    CASE
      WHEN p_amount > 0 THEN 'Se acreditaron ' || p_amount::TEXT || ' USDT a tu cuenta.'
      ELSE 'Se descontaron ' || ABS(p_amount)::TEXT || ' USDT de tu cuenta.'
    END || COALESCE(' Motivo: ' || p_notes, ''),
    'wallet'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_adjust_balance TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
