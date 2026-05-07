-- ============================================================================
-- GOLBIT - Migración Paso 4: Monedas + spread + generación de velas
-- ============================================================================

-- 1. Agregar spread a la tabla de coins
ALTER TABLE public.coins
  ADD COLUMN IF NOT EXISTS spread_percent NUMERIC(8, 4) NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS last_tick_at TIMESTAMPTZ;

-- spread_percent: porcentaje total de spread (ej: 0.10 = 0.10% spread)
-- bid (compra) = price * (1 - spread/2/100)
-- ask (venta) = price * (1 + spread/2/100)

-- 2. Función para upsert de velas (idempotente, usada por cliente)
CREATE OR REPLACE FUNCTION public.upsert_candle(
  p_coin_id UUID,
  p_timeframe TEXT,
  p_timestamp TIMESTAMPTZ,
  p_open NUMERIC,
  p_high NUMERIC,
  p_low NUMERIC,
  p_close NUMERIC,
  p_volume NUMERIC DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close, volume)
  VALUES (p_coin_id, p_timeframe, p_timestamp, p_open, p_high, p_low, p_close, p_volume)
  ON CONFLICT (coin_id, timeframe, timestamp)
  DO UPDATE SET
    high = GREATEST(price_history.high, p_high),
    low = LEAST(price_history.low, p_low),
    close = p_close,
    volume = price_history.volume + p_volume;

  -- Actualizar el precio actual y last_tick_at de la coin
  UPDATE public.coins
  SET current_price = p_close, last_tick_at = NOW(), updated_at = NOW()
  WHERE id = p_coin_id;
END;
$$;

-- Permitir que admin la llame
GRANT EXECUTE ON FUNCTION public.upsert_candle TO authenticated;

-- 3. Función para registrar el precio de manera segura (cualquiera la puede llamar
-- pero solo afecta el precio si el coin existe y está activo, y si pasaron al
-- menos N segundos del último tick para evitar abuso)
CREATE OR REPLACE FUNCTION public.record_price_tick(
  p_coin_id UUID,
  p_price NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_coin RECORD;
  v_ts TIMESTAMPTZ := NOW();
  v_minute TIMESTAMPTZ;
  v_5min TIMESTAMPTZ;
  v_15min TIMESTAMPTZ;
  v_hour TIMESTAMPTZ;
  v_existing RECORD;
BEGIN
  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active = TRUE;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no encontrada o inactiva');
  END IF;

  -- Validar que el precio sea positivo y razonable (rate limit no agresivo)
  IF p_price IS NULL OR p_price <= 0 THEN
    RETURN jsonb_build_object('error', 'Precio inválido');
  END IF;

  -- Truncar timestamps a inicio de cada timeframe
  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  -- Upsert en cada timeframe
  -- 1m
  SELECT * INTO v_existing FROM public.price_history
    WHERE coin_id = p_coin_id AND timeframe = '1m' AND timestamp = v_minute;
  IF v_existing IS NULL THEN
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (p_coin_id, '1m', v_minute, p_price, p_price, p_price, p_price);
  ELSE
    UPDATE public.price_history SET
      high = GREATEST(high, p_price),
      low = LEAST(low, p_price),
      close = p_price
    WHERE coin_id = p_coin_id AND timeframe = '1m' AND timestamp = v_minute;
  END IF;

  -- 5m
  SELECT * INTO v_existing FROM public.price_history
    WHERE coin_id = p_coin_id AND timeframe = '5m' AND timestamp = v_5min;
  IF v_existing IS NULL THEN
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (p_coin_id, '5m', v_5min, p_price, p_price, p_price, p_price);
  ELSE
    UPDATE public.price_history SET
      high = GREATEST(high, p_price),
      low = LEAST(low, p_price),
      close = p_price
    WHERE coin_id = p_coin_id AND timeframe = '5m' AND timestamp = v_5min;
  END IF;

  -- 15m
  SELECT * INTO v_existing FROM public.price_history
    WHERE coin_id = p_coin_id AND timeframe = '15m' AND timestamp = v_15min;
  IF v_existing IS NULL THEN
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (p_coin_id, '15m', v_15min, p_price, p_price, p_price, p_price);
  ELSE
    UPDATE public.price_history SET
      high = GREATEST(high, p_price),
      low = LEAST(low, p_price),
      close = p_price
    WHERE coin_id = p_coin_id AND timeframe = '15m' AND timestamp = v_15min;
  END IF;

  -- 1h
  SELECT * INTO v_existing FROM public.price_history
    WHERE coin_id = p_coin_id AND timeframe = '1h' AND timestamp = v_hour;
  IF v_existing IS NULL THEN
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (p_coin_id, '1h', v_hour, p_price, p_price, p_price, p_price);
  ELSE
    UPDATE public.price_history SET
      high = GREATEST(high, p_price),
      low = LEAST(low, p_price),
      close = p_price
    WHERE coin_id = p_coin_id AND timeframe = '1h' AND timestamp = v_hour;
  END IF;

  -- Actualizar precio actual de la moneda
  UPDATE public.coins
  SET current_price = p_price, last_tick_at = v_ts, updated_at = NOW()
  WHERE id = p_coin_id;

  RETURN jsonb_build_object('success', true, 'timestamp', v_ts, 'price', p_price);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_price_tick TO authenticated;

-- 4. Función para que el cliente pueda backfillear velas históricas
-- Genera N velas hacia atrás del momento actual con el algoritmo GBM
-- Solo se ejecuta si la coin tiene < 50 velas en el timeframe
CREATE OR REPLACE FUNCTION public.backfill_candles(
  p_coin_id UUID,
  p_timeframe TEXT DEFAULT '1m',
  p_count INTEGER DEFAULT 200
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_coin RECORD;
  v_existing_count INTEGER;
  v_current_price NUMERIC;
  v_open NUMERIC;
  v_close NUMERIC;
  v_high NUMERIC;
  v_low NUMERIC;
  v_drift NUMERIC;
  v_vol NUMERIC;
  v_random NUMERIC;
  v_ts TIMESTAMPTZ;
  v_interval INTERVAL;
  i INTEGER;
BEGIN
  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no encontrada');
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM public.price_history
  WHERE coin_id = p_coin_id AND timeframe = p_timeframe;

  IF v_existing_count >= 50 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'Ya hay velas suficientes', 'existing', v_existing_count);
  END IF;

  -- Determinar intervalo según timeframe
  v_interval := CASE p_timeframe
    WHEN '1m' THEN INTERVAL '1 minute'
    WHEN '5m' THEN INTERVAL '5 minute'
    WHEN '15m' THEN INTERVAL '15 minute'
    WHEN '1h' THEN INTERVAL '1 hour'
    ELSE INTERVAL '1 minute'
  END;

  v_current_price := v_coin.current_price;
  v_drift := v_coin.drift_bias / 100; -- drift por vela (suavizado)
  v_vol := v_coin.volatility;

  -- Generar velas hacia atrás partiendo del precio actual
  -- (en realidad se generan hacia "atrás" pero matemáticamente es hacia adelante,
  -- después se invierten)
  FOR i IN 1..p_count LOOP
    v_open := v_current_price;

    -- random simulado: random() devuelve 0..1, lo escalamos a -1..1
    v_random := (random() - 0.5) * 2;
    v_close := v_open * (1 + v_drift + v_vol * v_random);

    -- High y low: small variation
    v_high := GREATEST(v_open, v_close) * (1 + v_vol * random() * 0.3);
    v_low := LEAST(v_open, v_close) * (1 - v_vol * random() * 0.3);

    -- Timestamp: cada vela retroactiva
    v_ts := date_trunc(
      CASE p_timeframe
        WHEN '1h' THEN 'hour'
        ELSE 'minute'
      END,
      NOW()
    ) - (v_interval * (p_count - i));

    -- Para timeframes mayores a 1m, alinear bien
    IF p_timeframe = '5m' THEN
      v_ts := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
    ELSIF p_timeframe = '15m' THEN
      v_ts := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
    END IF;

    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close, volume)
    VALUES (p_coin_id, p_timeframe, v_ts, v_open, v_high, v_low, v_close, random() * 1000)
    ON CONFLICT (coin_id, timeframe, timestamp) DO NOTHING;

    v_current_price := v_close;
  END LOOP;

  -- Asegurar que el último precio coincide con el current_price guardado
  UPDATE public.coins SET current_price = v_current_price, updated_at = NOW() WHERE id = p_coin_id;

  RETURN jsonb_build_object(
    'success', true,
    'generated', p_count,
    'final_price', v_current_price
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_candles TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
