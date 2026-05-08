-- ============================================================================
-- GOLBIT - Migración 010: Bots de mercado (Paso 7.3)
-- ============================================================================
-- Bots = cuentas con role='bot'. Operan automáticamente con personalidades
-- distintas. Generan ruido natural de mercado. Pueden además ser operados
-- manualmente desde el panel admin (estilo whales).
-- ============================================================================

-- 1. Tabla con configuración de cada bot
CREATE TABLE IF NOT EXISTS public.bots (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  personality TEXT NOT NULL DEFAULT 'random' CHECK (personality IN ('random', 'momentum', 'mean_reversion')),
  -- Cada cuántos segundos puede operar (con jitter aleatorio)
  tick_interval_seconds INTEGER NOT NULL DEFAULT 30,
  -- Monto típico que opera (con variación)
  amount_min NUMERIC(20, 2) NOT NULL DEFAULT 50,
  amount_max NUMERIC(20, 2) NOT NULL DEFAULT 500,
  -- Leverage típico
  leverage NUMERIC(6, 2) NOT NULL DEFAULT 5,
  -- Probabilidad de cerrar trades viejos antes de abrir uno nuevo (0-1)
  close_probability NUMERIC(4, 3) NOT NULL DEFAULT 0.3,
  -- Última vez que operó (para respetar tick_interval)
  last_action_at TIMESTAMPTZ,
  -- Configuración por moneda: en qué monedas opera
  -- NULL = todas las activas
  preferred_coins UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin manages bots" ON public.bots;
CREATE POLICY "Admin manages bots" ON public.bots
  FOR ALL USING (public.is_admin());

-- 2. Trigger: cuando se inserta un bot, actualizar el role en profiles
CREATE OR REPLACE FUNCTION public.handle_new_bot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET role = 'bot' WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_bot_inserted ON public.bots;
CREATE TRIGGER on_bot_inserted
  AFTER INSERT ON public.bots
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_bot();

-- ============================================================================
-- 3. Función: ejecutar un tick de bots (decide quién opera y abre/cierra)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_bots_tick()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bot RECORD;
  v_coin RECORD;
  v_wallet RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_actions INTEGER := 0;
  v_should_close BOOLEAN;
  v_open_trade RECORD;
  v_direction TEXT;
  v_amount NUMERIC;
  v_entry_price NUMERIC;
  v_liq_price NUMERIC;
  v_pct_change NUMERIC;
  v_random NUMERIC;
  v_jitter NUMERIC;
  v_target_coin_id UUID;
BEGIN
  -- Iterar bots activos cuyo intervalo ya pasó
  FOR v_bot IN
    SELECT b.*, p.is_active
    FROM public.bots b
    JOIN public.profiles p ON p.id = b.id
    WHERE p.is_active = TRUE
      AND p.role = 'bot'
      AND (
        b.last_action_at IS NULL
        OR v_now > b.last_action_at + (b.tick_interval_seconds || ' seconds')::INTERVAL
      )
    ORDER BY random()  -- mezclar para que no todos disparen exactamente al mismo tick
    LIMIT 30  -- máximo 30 bots por tick para no sobrecargar
  LOOP
    -- Jitter aleatorio: 50-100% del intervalo (algunos esperan más)
    v_jitter := 0.5 + random() * 0.5;
    -- Si el random le dijo que esperaba más, skipear
    IF v_bot.last_action_at IS NOT NULL AND
       v_now < v_bot.last_action_at + ((v_bot.tick_interval_seconds * v_jitter) || ' seconds')::INTERVAL
    THEN
      CONTINUE;
    END IF;

    -- Elegir moneda: o de las preferidas, o cualquier activa al azar
    IF v_bot.preferred_coins IS NOT NULL AND array_length(v_bot.preferred_coins, 1) > 0 THEN
      v_target_coin_id := v_bot.preferred_coins[1 + floor(random() * array_length(v_bot.preferred_coins, 1))::INT];
    ELSE
      SELECT id INTO v_target_coin_id FROM public.coins
      WHERE is_active = TRUE
      ORDER BY random() LIMIT 1;
    END IF;

    IF v_target_coin_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_coin FROM public.coins WHERE id = v_target_coin_id AND is_active;
    IF v_coin IS NULL THEN CONTINUE; END IF;

    -- Wallet del bot
    SELECT * INTO v_wallet FROM public.wallets
    WHERE user_id = v_bot.id AND coin_symbol = 'USDT';
    IF v_wallet IS NULL OR (v_wallet.balance - v_wallet.locked_balance) < v_bot.amount_max THEN
      -- Sin saldo suficiente, skipear pero actualizar last_action para no martillar
      UPDATE public.bots SET last_action_at = v_now WHERE id = v_bot.id;
      CONTINUE;
    END IF;

    -- ¿Cerrar un trade viejo? (según probabilidad)
    v_should_close := random() < v_bot.close_probability;

    IF v_should_close THEN
      SELECT * INTO v_open_trade
      FROM public.trades
      WHERE user_id = v_bot.id AND status = 'open'
      ORDER BY opened_at ASC
      LIMIT 1;

      IF v_open_trade IS NOT NULL THEN
        -- Cerrar el trade más viejo (inline para no llamar close_trade que requiere auth.uid)
        DECLARE
          v_settings RECORD;
          v_pnl NUMERIC;
          v_fee_close NUMERIC;
          v_pnl_net NUMERIC;
          v_return_amount NUMERIC;
          v_exit_price NUMERIC;
          v_close_coin RECORD;
        BEGIN
          SELECT * INTO v_close_coin FROM public.coins WHERE id = v_open_trade.coin_id;
          SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

          IF v_open_trade.direction = 'long' THEN
            v_exit_price := v_close_coin.current_price * (1 - v_close_coin.spread_percent / 200);
          ELSE
            v_exit_price := v_close_coin.current_price * (1 + v_close_coin.spread_percent / 200);
          END IF;

          v_pnl := public.calc_pnl(
            v_open_trade.direction, v_open_trade.amount, v_open_trade.leverage,
            v_open_trade.entry_price, v_exit_price
          );
          v_fee_close := v_open_trade.amount * v_settings.trade_fee_percent / 100;
          v_pnl_net := v_pnl - v_fee_close;
          v_return_amount := GREATEST(v_open_trade.amount + v_pnl_net, 0);

          UPDATE public.trades
          SET status = 'closed', exit_price = v_exit_price, pnl = v_pnl_net,
              fee_close = v_fee_close, close_reason = 'bot_auto', closed_at = NOW()
          WHERE id = v_open_trade.id;

          UPDATE public.wallets
          SET balance = balance + v_return_amount,
              locked_balance = locked_balance - v_open_trade.amount,
              updated_at = NOW()
          WHERE user_id = v_bot.id AND coin_symbol = 'USDT';
        END;

        UPDATE public.bots SET last_action_at = v_now WHERE id = v_bot.id;
        v_actions := v_actions + 1;
        CONTINUE; -- el bot ya hizo su acción de este tick
      END IF;
    END IF;

    -- ABRIR NUEVO TRADE
    -- Decidir dirección según personalidad
    v_random := random();

    CASE v_bot.personality
      WHEN 'momentum' THEN
        -- Sigue tendencia: mira el cambio reciente del precio
        SELECT
          CASE WHEN COUNT(*) >= 2 AND v_coin.current_price > AVG(close)
               THEN 'long' ELSE 'short' END
        INTO v_direction
        FROM (
          SELECT close FROM public.price_history
          WHERE coin_id = v_coin.id AND timeframe = '1m'
          ORDER BY timestamp DESC LIMIT 5
        ) sub;
        IF v_direction IS NULL THEN v_direction := CASE WHEN v_random < 0.5 THEN 'long' ELSE 'short' END; END IF;

      WHEN 'mean_reversion' THEN
        -- Contrario a la tendencia
        SELECT
          CASE WHEN COUNT(*) >= 2 AND v_coin.current_price > AVG(close)
               THEN 'short' ELSE 'long' END
        INTO v_direction
        FROM (
          SELECT close FROM public.price_history
          WHERE coin_id = v_coin.id AND timeframe = '1m'
          ORDER BY timestamp DESC LIMIT 5
        ) sub;
        IF v_direction IS NULL THEN v_direction := CASE WHEN v_random < 0.5 THEN 'long' ELSE 'short' END; END IF;

      ELSE -- random
        v_direction := CASE WHEN v_random < 0.5 THEN 'long' ELSE 'short' END;
    END CASE;

    -- Monto aleatorio entre min y max
    v_amount := v_bot.amount_min + (random() * (v_bot.amount_max - v_bot.amount_min));
    v_amount := ROUND(v_amount::NUMERIC, 2);

    -- Validar saldo de nuevo (tras posible cierre arriba)
    IF (v_wallet.balance - v_wallet.locked_balance) < v_amount THEN
      UPDATE public.bots SET last_action_at = v_now WHERE id = v_bot.id;
      CONTINUE;
    END IF;

    -- Calcular entry y liquidación
    IF v_direction = 'long' THEN
      v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
    ELSE
      v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
    END IF;
    v_liq_price := public.calc_liquidation_price(v_direction, v_entry_price, v_bot.leverage);

    -- Insertar trade
    INSERT INTO public.trades (
      user_id, coin_id, direction, amount, leverage,
      entry_price, liquidation_price, fee_open, status, opened_at
    ) VALUES (
      v_bot.id, v_coin.id, v_direction, v_amount, v_bot.leverage,
      v_entry_price, v_liq_price, 0, 'open', NOW()
    );

    UPDATE public.wallets
    SET balance = balance - v_amount,
        locked_balance = locked_balance + v_amount,
        updated_at = NOW()
    WHERE user_id = v_bot.id AND coin_symbol = 'USDT';

    UPDATE public.bots SET last_action_at = v_now WHERE id = v_bot.id;
    v_actions := v_actions + 1;
  END LOOP;

  RETURN v_actions;
END;
$$;

-- ============================================================================
-- 4. Modificar tick para que también procese bots
-- (la presión ya los considera porque busca todos los trades de role='whale' OR 'bot')
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
  v_long_size NUMERIC;
  v_short_size NUMERIC;
  v_pressure_factor NUMERIC := 0;
BEGIN
  -- Procesar acciones programadas de whales
  PERFORM public.process_scheduled_whale_actions();

  -- NUEVO: procesar bots
  PERFORM public.process_bots_tick();

  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  FOR v_coin IN SELECT * FROM public.coins WHERE is_active = TRUE LOOP
    v_drift := v_coin.drift_bias / 1000;
    v_z := (random() + random() + random() + random() + random() + random() - 3) / 1.732;

    -- Presión: ahora considera whales Y bots (ambos non-student)
    SELECT
      COALESCE(SUM(CASE WHEN t.direction = 'long' THEN t.amount * t.leverage ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN t.direction = 'short' THEN t.amount * t.leverage ELSE 0 END), 0)
    INTO v_long_size, v_short_size
    FROM public.trades t
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.coin_id = v_coin.id
      AND t.status = 'open'
      AND p.role IN ('whale', 'bot');

    IF v_coin.market_liquidity > 0 THEN
      v_pressure_factor := LEAST(
        GREATEST((v_long_size - v_short_size) / v_coin.market_liquidity * 0.01, -0.05),
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
-- 5. Helpers admin para gestionar bots
-- ============================================================================

-- Configurar/actualizar bot
CREATE OR REPLACE FUNCTION public.admin_upsert_bot_config(
  p_bot_id UUID,
  p_personality TEXT,
  p_tick_interval_seconds INTEGER,
  p_amount_min NUMERIC,
  p_amount_max NUMERIC,
  p_leverage NUMERIC,
  p_close_probability NUMERIC,
  p_preferred_coins UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  INSERT INTO public.bots (
    id, personality, tick_interval_seconds,
    amount_min, amount_max, leverage,
    close_probability, preferred_coins
  ) VALUES (
    p_bot_id, p_personality, p_tick_interval_seconds,
    p_amount_min, p_amount_max, p_leverage,
    p_close_probability, p_preferred_coins
  )
  ON CONFLICT (id) DO UPDATE SET
    personality = p_personality,
    tick_interval_seconds = p_tick_interval_seconds,
    amount_min = p_amount_min,
    amount_max = p_amount_max,
    leverage = p_leverage,
    close_probability = p_close_probability,
    preferred_coins = p_preferred_coins,
    updated_at = NOW();

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_upsert_bot_config TO authenticated;

-- Setear saldo de bot (igual que whale)
CREATE OR REPLACE FUNCTION public.admin_set_bot_balance(
  p_bot_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_is_bot BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error', 'Solo admins'); END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_bot_id AND role = 'bot')
    INTO v_is_bot;
  IF NOT v_is_bot THEN RETURN jsonb_build_object('error', 'Usuario no es bot'); END IF;
  IF p_amount < 0 THEN RETURN jsonb_build_object('error', 'Saldo no puede ser negativo'); END IF;

  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_bot_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  UPDATE public.wallets
  SET balance = p_amount, updated_at = NOW()
  WHERE user_id = p_bot_id AND coin_symbol = 'USDT';

  RETURN jsonb_build_object('success', true, 'balance', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_bot_balance TO authenticated;

-- Borrar trade de bot (similar a whale)
CREATE OR REPLACE FUNCTION public.admin_delete_bot_trade(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_trade RECORD;
  v_is_bot BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN RETURN jsonb_build_object('error', 'Solo admins'); END IF;

  SELECT * INTO v_trade FROM public.trades WHERE id = p_trade_id;
  IF v_trade IS NULL THEN RETURN jsonb_build_object('error', 'Trade no encontrado'); END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_trade.user_id AND role = 'bot')
    INTO v_is_bot;
  IF NOT v_is_bot THEN RETURN jsonb_build_object('error', 'Solo trades de bots'); END IF;

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
GRANT EXECUTE ON FUNCTION public.admin_delete_bot_trade TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
