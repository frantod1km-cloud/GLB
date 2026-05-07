-- ============================================================================
-- GOLBIT - Hotfix Paso 3.1: Bug de aprobación + reconciliación
-- ============================================================================
-- Arregla el bug donde aprobar un depósito en /admin/wallet no actualizaba el
-- saldo. Causas posibles: wallet inexistente al momento de aprobar, o symbol
-- inconsistente. Esta versión es robusta a ambos casos.
-- ============================================================================

-- 1. RPC mejorada: aprobar transacción con creación implícita de wallet
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
  v_rows_affected INTEGER;
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
    -- Asegurar que la wallet existe (idempotente)
    INSERT INTO public.wallets (user_id, coin_symbol, balance)
    VALUES (v_tx.user_id, COALESCE(v_tx.coin_symbol, 'USDT'), 0)
    ON CONFLICT (user_id, coin_symbol) DO NOTHING;

    -- Sumar balance, contando filas afectadas
    UPDATE public.wallets
    SET balance = balance + v_tx.amount, updated_at = NOW()
    WHERE user_id = v_tx.user_id
      AND coin_symbol = COALESCE(v_tx.coin_symbol, 'USDT');

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
      RETURN jsonb_build_object('error', 'No se pudo actualizar el balance. Wallet no encontrada.');
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_tx.user_id,
      'Depósito aprobado',
      'Se acreditaron ' || v_tx.amount::TEXT || ' USDT a tu wallet.',
      'success'
    );

  ELSIF v_tx.type = 'withdrawal' THEN
    -- Para retiros, debe existir la wallet con saldo lockeado
    UPDATE public.wallets
    SET balance = balance - v_tx.amount,
        locked_balance = GREATEST(locked_balance - v_tx.amount, 0),
        updated_at = NOW()
    WHERE user_id = v_tx.user_id
      AND coin_symbol = COALESCE(v_tx.coin_symbol, 'USDT');

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    IF v_rows_affected = 0 THEN
      RETURN jsonb_build_object('error', 'No se pudo procesar el retiro. Wallet no encontrada.');
    END IF;

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
-- 2. RECONCILIACIÓN: recalcular balance basado en transacciones existentes
-- ============================================================================
-- Esta función recorre todas las transacciones aprobadas/completadas y deja
-- el balance de cada wallet en su valor correcto. Útil después de un bug.
-- Ejecutar UNA SOLA VEZ después de aplicar el hotfix.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_reconcile_balances()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_user RECORD;
  v_count INTEGER := 0;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  -- Para cada profile, recalcular su balance
  FOR v_user IN SELECT id FROM public.profiles LOOP
    -- Asegurar que tenga wallet
    INSERT INTO public.wallets (user_id, coin_symbol, balance)
    VALUES (v_user.id, 'USDT', 0)
    ON CONFLICT (user_id, coin_symbol) DO NOTHING;

    -- Calcular: SUM(deposits aprobados) - SUM(retiros aprobados o lockeados)
    UPDATE public.wallets w
    SET balance = COALESCE((
      SELECT SUM(
        CASE
          WHEN type IN ('deposit', 'transfer_in') AND status IN ('approved', 'completed')
            THEN amount
          WHEN type IN ('withdrawal', 'transfer_out') AND status IN ('approved', 'completed')
            THEN -amount
          ELSE 0
        END
      )
      FROM public.transactions
      WHERE user_id = v_user.id AND coin_symbol = 'USDT'
    ), 0),
    locked_balance = COALESCE((
      SELECT SUM(amount)
      FROM public.transactions
      WHERE user_id = v_user.id
        AND coin_symbol = 'USDT'
        AND type = 'withdrawal'
        AND status IN ('pending', 'in_review')
    ), 0),
    updated_at = NOW()
    WHERE w.user_id = v_user.id AND w.coin_symbol = 'USDT';

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'users_reconciled', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reconcile_balances TO authenticated;

-- ============================================================================
-- 3. EJECUTAR LA RECONCILIACIÓN AHORA
-- ============================================================================
-- Esto deja todos los balances correctos basándose en las transacciones
-- aprobadas. Si tu cuenta tiene un depósito de 5000 aprobado, te queda en 5000.
-- ============================================================================

SELECT public.admin_reconcile_balances();

-- ============================================================================
-- FIN DEL HOTFIX
-- ============================================================================
