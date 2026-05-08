-- ============================================================================
-- GOLBIT - Migración 009: Whales avanzadas (Paso 7.2)
-- ============================================================================
-- Agrega:
--   - Tabla whale_scheduled_actions (cola de acciones diferidas)
--   - RPC admin_whale_precision (un trade en una whale específica)
--   - RPC admin_whale_soft_command (programar acciones graduales)
--   - RPC process_scheduled_whale_actions (lo llama el motor cada tick)
--   - RPC admin_delete_whale_trade (borrar trade del historial)
-- ============================================================================

-- 1. Cola de acciones programadas para whales
CREATE TABLE IF NOT EXISTS public.whale_scheduled_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coin_id UUID NOT NULL REFERENCES public.coins(id) ON DELETE CASCADE,
  whale_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL = repartir entre todas
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  amount NUMERIC(20, 8) NOT NULL,
  leverage NUMERIC(6, 2) NOT NULL,
  execute_at TIMESTAMPTZ NOT NULL,
  batch_id UUID, -- para agrupar acciones de un mismo SOFT command
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'cancelled', 'failed')),
  executed_at TIMESTAMPTZ,
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whale_scheduled_pending
  ON public.whale_scheduled_actions(execute_at)
  WHERE status = 'pending';

ALTER TABLE public.whale_scheduled_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manages scheduled" ON public.whale_scheduled_actions;
CREATE POLICY "Admin manages scheduled" ON public.whale_scheduled_actions
  FOR ALL USING (public.is_admin());

-- ============================================================================
-- 2. RPC: PRECISION - operar con una whale específica
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_whale_precision(
  p_whale_id UUID,
  p_coin_id UUID,
  p_direction TEXT,
  p_amount NUMERIC,
  p_leverage NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_whale RECORD;
  v_coin RECORD;
  v_wallet RECORD;
  v_entry_price NUMERIC;
  v_liq_price NUMERIC;
  v_trade_id UUID;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_direction NOT IN ('long', 'short') THEN
    RETURN jsonb_build_object('error', 'Dirección inválida');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  SELECT * INTO v_whale FROM public.profiles WHERE id = p_whale_id AND role = 'whale';
  IF v_whale IS NULL THEN
    RETURN jsonb_build_object('error', 'Whale no encontrada');
  END IF;

  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no encontrada o inactiva');
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = p_whale_id AND coin_symbol = 'USDT';

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

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'entry_price', v_entry_price,
    'liquidation_price', v_liq_price
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_whale_precision TO authenticated;

-- ============================================================================
-- 3. RPC: SOFT command - distribuir compras/ventas en N segundos
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_whale_soft_command(
  p_coin_id UUID,
  p_command TEXT,  -- 'soft_pump' | 'soft_dump'
  p_total_amount NUMERIC,
  p_leverage NUMERIC,
  p_duration_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_whales_count INTEGER;
  v_steps INTEGER;
  v_amount_per_step NUMERIC;
  v_step_seconds NUMERIC;
  v_direction TEXT;
  v_batch_id UUID := gen_random_uuid();
  v_now TIMESTAMPTZ := NOW();
  i INTEGER;
  v_whale RECORD;
  v_amount_per_whale NUMERIC;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_command NOT IN ('soft_pump', 'soft_dump') THEN
    RETURN jsonb_build_object('error', 'Comando inválido');
  END IF;
  IF p_total_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto debe ser > 0');
  END IF;
  IF p_duration_seconds < 5 OR p_duration_seconds > 600 THEN
    RETURN jsonb_build_object('error', 'Duración entre 5 y 600 segundos');
  END IF;

  v_direction := CASE WHEN p_command = 'soft_pump' THEN 'long' ELSE 'short' END;

  -- Cantidad de pasos: 1 cada 5 segundos aprox
  v_steps := GREATEST(p_duration_seconds / 5, 1);
  v_step_seconds := p_duration_seconds::NUMERIC / v_steps;
  v_amount_per_step := p_total_amount / v_steps;

  -- Contar whales activas con saldo
  SELECT COUNT(*) INTO v_whales_count
  FROM public.profiles p
  JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
  WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100;

  IF v_whales_count = 0 THEN
    RETURN jsonb_build_object('error', 'No hay whales con saldo');
  END IF;

  v_amount_per_whale := v_amount_per_step / v_whales_count;

  -- Programar acciones para cada paso
  FOR i IN 0..(v_steps - 1) LOOP
    FOR v_whale IN
      SELECT p.id AS user_id
      FROM public.profiles p
      JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
      WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100
    LOOP
      INSERT INTO public.whale_scheduled_actions (
        coin_id, whale_id, direction, amount, leverage,
        execute_at, batch_id, status, created_by
      ) VALUES (
        p_coin_id, v_whale.user_id, v_direction, v_amount_per_whale, p_leverage,
        v_now + (i * v_step_seconds || ' seconds')::INTERVAL,
        v_batch_id, 'pending', v_admin_id
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'steps', v_steps,
    'whales', v_whales_count,
    'amount_per_step', v_amount_per_step,
    'amount_per_whale_per_step', v_amount_per_whale,
    'duration_seconds', p_duration_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_whale_soft_command TO authenticated;

-- ============================================================================
-- 4. RPC: cancelar batch SOFT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_cancel_whale_batch(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_count INTEGER;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  UPDATE public.whale_scheduled_actions
  SET status = 'cancelled'
  WHERE batch_id = p_batch_id AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'cancelled', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cancel_whale_batch TO authenticated;

-- ============================================================================
-- 5. RPC: process_scheduled_whale_actions - se llama desde el motor
-- Ejecuta todas las acciones que ya tocaba ejecutar
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_scheduled_whale_actions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action RECORD;
  v_coin RECORD;
  v_wallet RECORD;
  v_entry_price NUMERIC;
  v_liq_price NUMERIC;
  v_trade_id UUID;
  v_count INTEGER := 0;
BEGIN
  FOR v_action IN
    SELECT * FROM public.whale_scheduled_actions
    WHERE status = 'pending' AND execute_at <= NOW()
    ORDER BY execute_at
    LIMIT 100
  LOOP
    SELECT * INTO v_coin FROM public.coins WHERE id = v_action.coin_id AND is_active;
    IF v_coin IS NULL THEN
      UPDATE public.whale_scheduled_actions SET status = 'failed' WHERE id = v_action.id;
      CONTINUE;
    END IF;

    SELECT * INTO v_wallet FROM public.wallets
    WHERE user_id = v_action.whale_id AND coin_symbol = 'USDT';

    IF v_wallet IS NULL OR (v_wallet.balance - v_wallet.locked_balance) < v_action.amount THEN
      UPDATE public.whale_scheduled_actions SET status = 'failed' WHERE id = v_action.id;
      CONTINUE;
    END IF;

    IF v_action.direction = 'long' THEN
      v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
    ELSE
      v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
    END IF;

    v_liq_price := public.calc_liquidation_price(v_action.direction, v_entry_price, v_action.leverage);

    INSERT INTO public.trades (
      user_id, coin_id, direction, amount, leverage,
      entry_price, liquidation_price, fee_open, status, opened_at
    ) VALUES (
      v_action.whale_id, v_action.coin_id, v_action.direction, v_action.amount, v_action.leverage,
      v_entry_price, v_liq_price, 0, 'open', NOW()
    ) RETURNING id INTO v_trade_id;

    UPDATE public.wallets
    SET balance = balance - v_action.amount,
        locked_balance = locked_balance + v_action.amount,
        updated_at = NOW()
    WHERE user_id = v_action.whale_id AND coin_symbol = 'USDT';

    UPDATE public.whale_scheduled_actions
    SET status = 'executed', executed_at = NOW(), trade_id = v_trade_id
    WHERE id = v_action.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 6. Modificar tick_all_active_coins para procesar acciones programadas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.tick_all_active_coins()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_coin RECORD;
  v_new_price NUMERIC;
  v_drift NUMERIC;
  v_z NUMERIC;
  v_count INTEGER := 0;
  v_ts TIMESTAMPTZ := NOW();
  v_minute TIMESTAMPTZ;
  v_5min TIMESTAMPTZ;
  v_15min TIMESTAMPTZ;
  v_hour TIMESTAMPTZ;
  v_whale_long_size NUMERIC;
  v_whale_short_size NUMERIC;
  v_pressure_factor NUMERIC := 0;
BEGIN
  -- NUEVO: ejecutar acciones programadas primero (afecta presión del tick actual)
  PERFORM public.process_scheduled_whale_actions();

  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  FOR v_coin IN SELECT * FROM public.coins WHERE is_active = TRUE LOOP
    v_drift := v_coin.drift_bias / 1000;
    v_z := (random() + random() + random() + random() + random() + random() - 3) / 1.732;

    SELECT
      COALESCE(SUM(CASE WHEN t.direction = 'long' THEN t.amount * t.leverage ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN t.direction = 'short' THEN t.amount * t.leverage ELSE 0 END), 0)
    INTO v_whale_long_size, v_whale_short_size
    FROM public.trades t
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.coin_id = v_coin.id
      AND t.status = 'open'
      AND p.role = 'whale';

    IF v_coin.market_liquidity > 0 THEN
      v_pressure_factor := LEAST(
        GREATEST((v_whale_long_size - v_whale_short_size) / v_coin.market_liquidity * 0.01, -0.05),
        0.05
      );
    ELSE
      v_pressure_factor := 0;
    END IF;

    v_new_price := v_coin.current_price * EXP(v_drift + v_coin.volatility * v_z + v_pressure_factor);
    v_new_price := GREATEST(v_new_price, v_coin.current_price * 0.5);
    v_new_price := LEAST(v_new_price, v_coin.current_price * 2.0);

    UPDATE public.coins
    SET current_price = v_new_price, last_tick_at = v_ts, updated_at = v_ts
    WHERE id = v_coin.id;

    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '1m', v_minute, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '5m', v_5min, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '15m', v_15min, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '1h', v_hour, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    PERFORM public.check_open_trades_for_coin(v_coin.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- 7. RPC: borrar trade del historial de una whale (sin afectar wallet)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_whale_trade(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_trade RECORD;
  v_is_whale BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id;
  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Trade no encontrado');
  END IF;

  -- Solo se pueden borrar trades de whales (seguridad)
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_trade.user_id AND role = 'whale')
    INTO v_is_whale;
  IF NOT v_is_whale THEN
    RETURN jsonb_build_object('error', 'Solo se pueden borrar trades de whales');
  END IF;

  -- Si está abierto, primero hay que cerrarlo (liberar locked)
  IF v_trade.status = 'open' THEN
    UPDATE public.wallets
    SET locked_balance = GREATEST(locked_balance - v_trade.amount, 0),
        balance = balance + v_trade.amount,
        updated_at = NOW()
    WHERE user_id = v_trade.user_id AND coin_symbol = 'USDT';
  END IF;

  DELETE FROM public.trades WHERE id = p_trade_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_whale_trade TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
