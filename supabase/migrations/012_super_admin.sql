-- ============================================================================
-- GOLBIT - Migración 012: super_admin role
-- ============================================================================
-- Crea el role super_admin y promueve al primer admin del sistema.
-- super_admin tiene acceso total. Los admins normales tienen acceso limitado.
-- ============================================================================

-- 1. Permitir el role super_admin
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'admin', 'super_admin', 'whale', 'bot'));

-- 2. Promover el primer admin a super_admin (el más antiguo registrado)
DO $$
DECLARE
  v_first_admin_id UUID;
BEGIN
  SELECT id INTO v_first_admin_id
  FROM public.profiles
  WHERE role = 'admin'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_first_admin_id IS NOT NULL THEN
    UPDATE public.profiles SET role = 'super_admin' WHERE id = v_first_admin_id;
    RAISE NOTICE 'Promoted user % to super_admin', v_first_admin_id;
  ELSE
    RAISE NOTICE 'No admin found to promote';
  END IF;
END $$;

-- 3. Helpers: is_super_admin, is_admin_or_super
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin_or_super()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

-- 4. Reemplazar la función is_admin para que ahora funcione tambien para super_admin
-- Esto hace que las RLS y RPCs existentes que usan is_admin sigan funcionando
-- y los super_admin tengan los mismos derechos que admin (más algunos extras)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
  );
$$;

-- ============================================================================
-- 5. Las RPCs sensibles (manipulación) deben validar super_admin específicamente
-- Lo aplicamos sobre las funciones de whales y bots
-- ============================================================================

-- Helper para no repetir el chequeo
CREATE OR REPLACE FUNCTION public._require_super_admin()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Solo super_admin puede ejecutar esta acción';
  END IF;
END;
$$;

-- Reemplazar admin_set_whale_balance para que requiera super_admin
CREATE OR REPLACE FUNCTION public.admin_set_whale_balance(
  p_whale_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Solo super_admin');
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_whale_id AND role = 'whale') THEN
    RETURN jsonb_build_object('error', 'El usuario no es una whale');
  END IF;

  IF p_amount < 0 THEN
    RETURN jsonb_build_object('error', 'El saldo no puede ser negativo');
  END IF;

  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_whale_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  UPDATE public.wallets
  SET balance = p_amount, updated_at = NOW()
  WHERE user_id = p_whale_id AND coin_symbol = 'USDT';

  RETURN jsonb_build_object('success', true, 'balance', p_amount);
END;
$$;

-- Replazar admin_whale_command para super_admin
CREATE OR REPLACE FUNCTION public.admin_whale_command(
  p_coin_id UUID,
  p_command TEXT,
  p_total_amount NUMERIC DEFAULT 0,
  p_leverage NUMERIC DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_whale RECORD;
  v_whales_count INTEGER;
  v_amount_per_whale NUMERIC;
  v_direction TEXT;
  v_coin RECORD;
  v_executed INTEGER := 0;
  v_skipped INTEGER := 0;
  v_trade_id UUID;
  v_entry_price NUMERIC;
  v_liq_price NUMERIC;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Solo super_admin');
  END IF;

  IF p_command NOT IN ('pump', 'dump', 'stop') THEN
    RETURN jsonb_build_object('error', 'Comando invalido');
  END IF;

  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no encontrada o inactiva');
  END IF;

  IF p_command = 'stop' THEN
    FOR v_whale IN
      SELECT t.id AS trade_id, t.user_id
      FROM public.trades t
      JOIN public.profiles p ON p.id = t.user_id
      WHERE t.coin_id = p_coin_id AND t.status = 'open' AND p.role = 'whale'
    LOOP
      DECLARE
        v_t RECORD; v_settings RECORD; v_pnl NUMERIC; v_fee_close NUMERIC;
        v_pnl_net NUMERIC; v_return_amount NUMERIC; v_exit_price NUMERIC;
      BEGIN
        SELECT * INTO v_t FROM public.trades WHERE id = v_whale.trade_id;
        SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

        IF v_t.direction = 'long' THEN
          v_exit_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
        ELSE
          v_exit_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
        END IF;

        v_pnl := public.calc_pnl(v_t.direction, v_t.amount, v_t.leverage, v_t.entry_price, v_exit_price);
        v_fee_close := v_t.amount * v_settings.trade_fee_percent / 100;
        v_pnl_net := v_pnl - v_fee_close;
        v_return_amount := GREATEST(v_t.amount + v_pnl_net, 0);

        UPDATE public.trades
        SET status = 'closed', exit_price = v_exit_price, pnl = v_pnl_net,
            fee_close = v_fee_close, close_reason = 'admin', closed_at = NOW()
        WHERE id = v_t.id;

        UPDATE public.wallets
        SET balance = balance + v_return_amount,
            locked_balance = locked_balance - v_t.amount,
            updated_at = NOW()
        WHERE user_id = v_t.user_id AND coin_symbol = 'USDT';

        v_executed := v_executed + 1;
      END;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'command', 'stop', 'closed', v_executed);
  END IF;

  v_direction := CASE WHEN p_command = 'pump' THEN 'long' ELSE 'short' END;

  SELECT COUNT(*) INTO v_whales_count
  FROM public.profiles p
  JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
  WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100;

  IF v_whales_count = 0 THEN
    RETURN jsonb_build_object('error', 'No hay whales con saldo disponible');
  END IF;
  IF p_total_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto total debe ser mayor a 0');
  END IF;

  v_amount_per_whale := p_total_amount / v_whales_count;

  FOR v_whale IN
    SELECT p.id AS user_id, w.balance
    FROM public.profiles p
    JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
    WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100
  LOOP
    IF v_whale.balance < (v_amount_per_whale * 1.01) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_direction = 'long' THEN
      v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
    ELSE
      v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
    END IF;

    v_liq_price := public.calc_liquidation_price(v_direction, v_entry_price, p_leverage);

    INSERT INTO public.trades (
      user_id, coin_id, direction, amount, leverage,
      entry_price, liquidation_price, fee_open, status, opened_at
    ) VALUES (
      v_whale.user_id, p_coin_id, v_direction, v_amount_per_whale, p_leverage,
      v_entry_price, v_liq_price, 0, 'open', NOW()
    ) RETURNING id INTO v_trade_id;

    UPDATE public.wallets
    SET balance = balance - v_amount_per_whale,
        locked_balance = locked_balance + v_amount_per_whale,
        updated_at = NOW()
    WHERE user_id = v_whale.user_id AND coin_symbol = 'USDT';

    v_executed := v_executed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true, 'command', p_command,
    'whales_executed', v_executed, 'whales_skipped', v_skipped,
    'amount_per_whale', v_amount_per_whale, 'leverage', p_leverage
  );
END;
$$;

-- Lo mismo para admin_whale_precision, admin_whale_soft_command, admin_cancel_whale_batch,
-- admin_delete_whale_trade, admin_upsert_bot_config, admin_set_bot_balance, admin_delete_bot_trade
-- → todas requieren super_admin

CREATE OR REPLACE FUNCTION public.admin_whale_precision(
  p_whale_id UUID, p_coin_id UUID, p_direction TEXT,
  p_amount NUMERIC, p_leverage NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_whale RECORD; v_coin RECORD; v_wallet RECORD;
  v_entry_price NUMERIC; v_liq_price NUMERIC; v_trade_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Solo super_admin');
  END IF;

  IF p_direction NOT IN ('long', 'short') THEN
    RETURN jsonb_build_object('error', 'Dirección inválida');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  SELECT * INTO v_whale FROM public.profiles WHERE id = p_whale_id AND role = 'whale';
  IF v_whale IS NULL THEN RETURN jsonb_build_object('error', 'Whale no encontrada'); END IF;

  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active;
  IF v_coin IS NULL THEN RETURN jsonb_build_object('error', 'Moneda no encontrada'); END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_whale_id AND coin_symbol = 'USDT';
  IF v_wallet IS NULL OR (v_wallet.balance - v_wallet.locked_balance) < p_amount THEN
    RETURN jsonb_build_object('error', 'Whale sin saldo suficiente');
  END IF;

  IF p_direction = 'long' THEN
    v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
  ELSE
    v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
  END IF;

  v_liq_price := public.calc_liquidation_price(p_direction, v_entry_price, p_leverage);

  INSERT INTO public.trades (
    user_id, coin_id, direction, amount, leverage,
    entry_price, liquidation_price, fee_open, status, opened_at
  ) VALUES (
    p_whale_id, p_coin_id, p_direction, p_amount, p_leverage,
    v_entry_price, v_liq_price, 0, 'open', NOW()
  ) RETURNING id INTO v_trade_id;

  UPDATE public.wallets
  SET balance = balance - p_amount,
      locked_balance = locked_balance + p_amount,
      updated_at = NOW()
  WHERE user_id = p_whale_id AND coin_symbol = 'USDT';

  RETURN jsonb_build_object('success', true, 'trade_id', v_trade_id);
END;
$$;

-- Helper RLS para policies que requieren super_admin
DROP POLICY IF EXISTS "Super admin manages bots" ON public.bots;
CREATE POLICY "Super admin manages bots" ON public.bots
  FOR ALL USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin manages scheduled" ON public.whale_scheduled_actions;
CREATE POLICY "Super admin manages scheduled" ON public.whale_scheduled_actions
  FOR ALL USING (public.is_super_admin());

-- ============================================================================
-- FIN
-- ============================================================================
-- Después de correr esto:
-- 1. Tu primer admin (vos) será automáticamente super_admin
-- 2. Otros admins seguirán con role 'admin' y NO podrán manipular whales/bots
-- 3. Las RPCs sensibles requieren super_admin específicamente
-- ============================================================================
