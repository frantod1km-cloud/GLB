-- ============================================================================
-- GOLBIT - Migración 007: Trading completo
-- ============================================================================
-- Long/Short con leverage, SL/TP, liquidación automática, comisiones
-- ============================================================================

-- 1. Comisiones en motor_settings (configurables desde admin)
ALTER TABLE public.motor_settings
  ADD COLUMN IF NOT EXISTS trade_fee_percent NUMERIC(8, 4) NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS allowed_leverages TEXT NOT NULL DEFAULT '1,2,5,10,25';

-- 2. Campos nuevos en trades
ALTER TABLE public.trades
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS take_profit NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS liquidation_price NUMERIC(20, 8),
  ADD COLUMN IF NOT EXISTS fee_open NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_close NUMERIC(20, 8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS close_reason TEXT;

-- close_reason: 'manual', 'stop_loss', 'take_profit', 'liquidation', 'admin'

-- 3. Función helper: calcular precio de liquidación
CREATE OR REPLACE FUNCTION public.calc_liquidation_price(
  p_direction TEXT,
  p_entry_price NUMERIC,
  p_leverage NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  -- Para long: liquidación cuando precio cae lo suficiente para perder todo el margen
  -- liq_price = entry * (1 - 1/leverage)
  -- Para short: cuando precio sube lo suficiente
  -- liq_price = entry * (1 + 1/leverage)
  IF p_leverage <= 0 THEN RETURN NULL; END IF;

  IF p_direction = 'long' THEN
    RETURN p_entry_price * (1 - 1.0 / p_leverage);
  ELSE
    RETURN p_entry_price * (1 + 1.0 / p_leverage);
  END IF;
END;
$$;

-- 4. Función helper: calcular PnL de una operación abierta
CREATE OR REPLACE FUNCTION public.calc_pnl(
  p_direction TEXT,
  p_amount NUMERIC,
  p_leverage NUMERIC,
  p_entry_price NUMERIC,
  p_current_price NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_position_size NUMERIC;
  v_pct_change NUMERIC;
BEGIN
  IF p_entry_price = 0 THEN RETURN 0; END IF;

  v_position_size := p_amount * p_leverage;

  IF p_direction = 'long' THEN
    v_pct_change := (p_current_price - p_entry_price) / p_entry_price;
  ELSE
    v_pct_change := (p_entry_price - p_current_price) / p_entry_price;
  END IF;

  RETURN v_position_size * v_pct_change;
END;
$$;

-- ============================================================================
-- 5. RPC: abrir operación
-- ============================================================================
CREATE OR REPLACE FUNCTION public.open_trade(
  p_coin_id UUID,
  p_direction TEXT,
  p_amount NUMERIC,
  p_leverage NUMERIC,
  p_stop_loss NUMERIC DEFAULT NULL,
  p_take_profit NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_coin RECORD;
  v_settings RECORD;
  v_wallet RECORD;
  v_entry_price NUMERIC;
  v_fee NUMERIC;
  v_liq_price NUMERIC;
  v_total_cost NUMERIC;
  v_trade_id UUID;
  v_allowed_levs NUMERIC[];
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  IF p_direction NOT IN ('long', 'short') THEN
    RETURN jsonb_build_object('error', 'Dirección inválida');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Validar moneda activa
  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active = TRUE;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no disponible');
  END IF;

  -- Validar leverage permitido
  SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;
  v_allowed_levs := string_to_array(v_settings.allowed_leverages, ',')::NUMERIC[];
  IF NOT (p_leverage = ANY(v_allowed_levs)) THEN
    RETURN jsonb_build_object('error', 'Apalancamiento no permitido');
  END IF;

  -- Validar saldo
  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  -- Calcular fee y costo total
  v_fee := p_amount * v_settings.trade_fee_percent / 100;
  v_total_cost := p_amount + v_fee;

  IF v_wallet IS NULL OR (v_wallet.balance - v_wallet.locked_balance) < v_total_cost THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente (incluye fee)');
  END IF;

  -- Calcular entry price con spread
  -- long → paga ask (más alto), short → recibe bid (más bajo)
  IF p_direction = 'long' THEN
    v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
  ELSE
    v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
  END IF;

  -- Calcular precio de liquidación
  v_liq_price := public.calc_liquidation_price(p_direction, v_entry_price, p_leverage);

  -- Validar SL/TP (si vinieron)
  IF p_stop_loss IS NOT NULL THEN
    IF p_direction = 'long' AND p_stop_loss >= v_entry_price THEN
      RETURN jsonb_build_object('error', 'Stop Loss debe ser menor al precio de entrada (long)');
    END IF;
    IF p_direction = 'short' AND p_stop_loss <= v_entry_price THEN
      RETURN jsonb_build_object('error', 'Stop Loss debe ser mayor al precio de entrada (short)');
    END IF;
  END IF;

  IF p_take_profit IS NOT NULL THEN
    IF p_direction = 'long' AND p_take_profit <= v_entry_price THEN
      RETURN jsonb_build_object('error', 'Take Profit debe ser mayor al precio de entrada (long)');
    END IF;
    IF p_direction = 'short' AND p_take_profit >= v_entry_price THEN
      RETURN jsonb_build_object('error', 'Take Profit debe ser menor al precio de entrada (short)');
    END IF;
  END IF;

  -- Crear el trade
  INSERT INTO public.trades (
    user_id, coin_id, direction, amount, leverage,
    entry_price, stop_loss, take_profit, liquidation_price, fee_open,
    status, opened_at
  ) VALUES (
    v_user_id, p_coin_id, p_direction, p_amount, p_leverage,
    v_entry_price, p_stop_loss, p_take_profit, v_liq_price, v_fee,
    'open', NOW()
  ) RETURNING id INTO v_trade_id;

  -- Lockear saldo: monto + fee
  UPDATE public.wallets
  SET balance = balance - v_total_cost,
      locked_balance = locked_balance + p_amount,
      updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    'Operación abierta',
    'Abriste ' || UPPER(p_direction) || ' ' || p_amount::TEXT || ' USDT en ' ||
    v_coin.symbol || ' con ' || p_leverage::TEXT || 'x',
    'trade'
  );

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'entry_price', v_entry_price,
    'liquidation_price', v_liq_price,
    'fee', v_fee
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.open_trade TO authenticated;

-- ============================================================================
-- 6. RPC: cerrar operación (manual, por usuario)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_trade(
  p_trade_id UUID,
  p_reason TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_trade RECORD;
  v_coin RECORD;
  v_settings RECORD;
  v_exit_price NUMERIC;
  v_pnl NUMERIC;
  v_fee_close NUMERIC;
  v_pnl_net NUMERIC;
  v_return_amount NUMERIC;
  v_is_admin BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id;
  IF v_trade IS NULL THEN
    RETURN jsonb_build_object('error', 'Operación no encontrada');
  END IF;

  -- Verificar permisos: dueño o admin
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_user_id AND role = 'admin')
    INTO v_is_admin;
  IF v_trade.user_id <> v_user_id AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Sin permisos');
  END IF;

  IF v_trade.status <> 'open' THEN
    RETURN jsonb_build_object('error', 'Esta operación ya está cerrada');
  END IF;

  SELECT * INTO v_coin FROM public.coins WHERE id = v_trade.coin_id;
  SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

  -- Calcular exit price con spread
  -- long cierra → vende a bid; short cierra → compra a ask
  IF v_trade.direction = 'long' THEN
    v_exit_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
  ELSE
    v_exit_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
  END IF;

  -- Calcular PnL (sin fee close todavía)
  v_pnl := public.calc_pnl(
    v_trade.direction,
    v_trade.amount,
    v_trade.leverage,
    v_trade.entry_price,
    v_exit_price
  );

  -- Fee de cierre sobre el monto inicial
  v_fee_close := v_trade.amount * v_settings.trade_fee_percent / 100;

  -- PnL neto (PnL - fee close)
  v_pnl_net := v_pnl - v_fee_close;

  -- Lo que vuelve a la wallet: monto inicial + pnl_net (puede ser negativo)
  -- Si la pérdida supera el monto, devolvemos 0 (ya se lockeó al abrir)
  v_return_amount := GREATEST(v_trade.amount + v_pnl_net, 0);

  -- Actualizar trade
  UPDATE public.trades
  SET status = 'closed',
      exit_price = v_exit_price,
      pnl = v_pnl_net,
      fee_close = v_fee_close,
      close_reason = p_reason,
      closed_at = NOW()
  WHERE id = p_trade_id;

  -- Devolver saldo (puede haber perdido todo o más; locked se libera)
  UPDATE public.wallets
  SET balance = balance + v_return_amount,
      locked_balance = locked_balance - v_trade.amount,
      updated_at = NOW()
  WHERE user_id = v_trade.user_id AND coin_symbol = 'USDT';

  -- Notificar
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_trade.user_id,
    CASE
      WHEN p_reason = 'manual' THEN 'Operación cerrada'
      WHEN p_reason = 'stop_loss' THEN '🛑 Stop Loss disparado'
      WHEN p_reason = 'take_profit' THEN '🎯 Take Profit alcanzado'
      WHEN p_reason = 'liquidation' THEN '⚠️ Liquidación'
      ELSE 'Operación cerrada por admin'
    END,
    CASE
      WHEN v_pnl_net >= 0 THEN '+' || ROUND(v_pnl_net::NUMERIC, 2)::TEXT || ' USDT'
      ELSE ROUND(v_pnl_net::NUMERIC, 2)::TEXT || ' USDT'
    END || ' en ' || v_coin.symbol,
    CASE WHEN v_pnl_net >= 0 THEN 'success' ELSE 'warning' END
  );

  RETURN jsonb_build_object(
    'success', true,
    'exit_price', v_exit_price,
    'pnl', v_pnl_net,
    'returned', v_return_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_trade TO authenticated;

-- ============================================================================
-- 7. RPC: chequear y disparar SL/TP/Liquidación
-- Esta se ejecuta junto con cada tick del motor.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_open_trades_for_coin(
  p_coin_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_coin RECORD;
  v_trade RECORD;
  v_bid NUMERIC;
  v_ask NUMERIC;
  v_check_price NUMERIC;
  v_count INTEGER := 0;
  v_reason TEXT;
BEGIN
  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id;
  IF v_coin IS NULL THEN RETURN 0; END IF;

  v_bid := v_coin.current_price * (1 - v_coin.spread_percent / 200);
  v_ask := v_coin.current_price * (1 + v_coin.spread_percent / 200);

  FOR v_trade IN
    SELECT * FROM public.trades
    WHERE coin_id = p_coin_id AND status = 'open'
  LOOP
    v_reason := NULL;

    -- Para long: chequear contra bid (precio de cierre)
    -- Para short: chequear contra ask
    IF v_trade.direction = 'long' THEN
      v_check_price := v_bid;

      -- Liquidación
      IF v_check_price <= v_trade.liquidation_price THEN
        v_reason := 'liquidation';
      -- Stop loss
      ELSIF v_trade.stop_loss IS NOT NULL AND v_check_price <= v_trade.stop_loss THEN
        v_reason := 'stop_loss';
      -- Take profit
      ELSIF v_trade.take_profit IS NOT NULL AND v_check_price >= v_trade.take_profit THEN
        v_reason := 'take_profit';
      END IF;
    ELSE -- short
      v_check_price := v_ask;

      IF v_check_price >= v_trade.liquidation_price THEN
        v_reason := 'liquidation';
      ELSIF v_trade.stop_loss IS NOT NULL AND v_check_price >= v_trade.stop_loss THEN
        v_reason := 'stop_loss';
      ELSIF v_trade.take_profit IS NOT NULL AND v_check_price <= v_trade.take_profit THEN
        v_reason := 'take_profit';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      -- Cerrar usando el RPC (que ya hace todo)
      -- Pero tenemos que llamarla con permisos elevados (security definer)
      -- Como no podemos cambiar auth.uid() aquí, hacemos el cierre inline
      DECLARE
        v_pnl NUMERIC;
        v_fee_close NUMERIC;
        v_pnl_net NUMERIC;
        v_return_amount NUMERIC;
        v_settings RECORD;
      BEGIN
        SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

        v_pnl := public.calc_pnl(
          v_trade.direction, v_trade.amount, v_trade.leverage,
          v_trade.entry_price, v_check_price
        );
        v_fee_close := v_trade.amount * v_settings.trade_fee_percent / 100;
        v_pnl_net := v_pnl - v_fee_close;
        v_return_amount := GREATEST(v_trade.amount + v_pnl_net, 0);

        UPDATE public.trades
        SET status = 'closed',
            exit_price = v_check_price,
            pnl = v_pnl_net,
            fee_close = v_fee_close,
            close_reason = v_reason,
            closed_at = NOW()
        WHERE id = v_trade.id;

        UPDATE public.wallets
        SET balance = balance + v_return_amount,
            locked_balance = locked_balance - v_trade.amount,
            updated_at = NOW()
        WHERE user_id = v_trade.user_id AND coin_symbol = 'USDT';

        INSERT INTO public.notifications (user_id, title, message, type)
        VALUES (
          v_trade.user_id,
          CASE
            WHEN v_reason = 'stop_loss' THEN '🛑 Stop Loss disparado'
            WHEN v_reason = 'take_profit' THEN '🎯 Take Profit alcanzado'
            WHEN v_reason = 'liquidation' THEN '⚠️ Liquidación'
          END,
          CASE
            WHEN v_pnl_net >= 0 THEN '+' || ROUND(v_pnl_net::NUMERIC, 2)::TEXT || ' USDT'
            ELSE ROUND(v_pnl_net::NUMERIC, 2)::TEXT || ' USDT'
          END || ' en ' || v_coin.symbol,
          CASE WHEN v_pnl_net >= 0 THEN 'success' ELSE 'warning' END
        );

        v_count := v_count + 1;
      END;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 8. Modificar tick_all_active_coins para que después de cada tick, chequee SL/TP
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
BEGIN
  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  FOR v_coin IN SELECT * FROM public.coins WHERE is_active = TRUE LOOP
    v_drift := v_coin.drift_bias / 1000;
    v_z := (random() + random() + random() + random() + random() + random() - 3) / 1.732;
    v_new_price := v_coin.current_price * EXP(v_drift + v_coin.volatility * v_z);
    v_new_price := GREATEST(v_new_price, v_coin.current_price * 0.5);
    v_new_price := LEAST(v_new_price, v_coin.current_price * 2.0);

    UPDATE public.coins
    SET current_price = v_new_price, last_tick_at = v_ts, updated_at = v_ts
    WHERE id = v_coin.id;

    -- Velas
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

    -- NUEVO: Chequear SL/TP/liquidación de operaciones abiertas
    PERFORM public.check_open_trades_for_coin(v_coin.id);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
