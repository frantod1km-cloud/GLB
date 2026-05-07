-- ============================================================================
-- GOLBIT - Migración 005: Motor de precios servidor (pg_cron)
-- ============================================================================
-- Cambia la arquitectura de precios:
-- ANTES: cada cliente generaba sus propios precios (todos veían distinto)
-- AHORA: el servidor genera 1 tick por segundo, todos ven lo mismo
-- ============================================================================

-- 1. Activar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_cron por default vive en el schema "extensions" o "cron" en Supabase
-- ya viene preinstalado pero hay que activarlo

-- 2. Función que genera el siguiente tick para todas las monedas activas
-- Esta es la "vida" de Golbit: corre cada segundo y mueve los precios
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
  -- Truncar timestamps una vez (más eficiente)
  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  FOR v_coin IN SELECT * FROM public.coins WHERE is_active = TRUE LOOP
    -- Geometric Brownian Motion: precio_nuevo = precio_actual * exp(drift + vol * Z)
    -- Z ~ N(0,1) usando aproximación de Box-Muller con random()
    -- random() devuelve [0,1), lo escalamos a [-1, 1] con escala normal aproximada
    v_drift := v_coin.drift_bias / 1000;  -- suavizado: drift por segundo
    -- Aproximación de gaussian: suma de 6 randoms - 3 (CLT con n=6)
    v_z := (random() + random() + random() + random() + random() + random() - 3) / 1.732;

    v_new_price := v_coin.current_price * EXP(v_drift + v_coin.volatility * v_z);

    -- Limitar caídas extremas (no menos del 1% del actual)
    v_new_price := GREATEST(v_new_price, v_coin.current_price * 0.5);
    v_new_price := LEAST(v_new_price, v_coin.current_price * 2.0);

    -- Actualizar precio actual y last_tick_at
    UPDATE public.coins
    SET current_price = v_new_price,
        last_tick_at = v_ts,
        updated_at = v_ts
    WHERE id = v_coin.id;

    -- Upsert en cada timeframe
    -- 1m
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '1m', v_minute, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    -- 5m
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '5m', v_5min, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    -- 15m
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '15m', v_15min, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    -- 1h
    INSERT INTO public.price_history (coin_id, timeframe, timestamp, open, high, low, close)
    VALUES (v_coin.id, '1h', v_hour, v_new_price, v_new_price, v_new_price, v_new_price)
    ON CONFLICT (coin_id, timeframe, timestamp) DO UPDATE SET
      high = GREATEST(price_history.high, v_new_price),
      low = LEAST(price_history.low, v_new_price),
      close = v_new_price;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 3. Programar la ejecución cada 1 segundo
-- pg_cron acepta formato extendido: "* * * * * *" = cada segundo
-- Primero quitar job anterior si existe (idempotente)
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'golbit-tick-engine';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

-- Programar el tick cada 1 segundo
-- Nota: pg_cron usa formato cron pero con resolución de minuto por default.
-- Para correr "cada N segundos" usamos un loop de N veces dentro de la función
-- llamada cada minuto. Esto es más eficiente que crear 60 jobs separados.
SELECT cron.schedule(
  'golbit-tick-engine',
  '* * * * *',  -- cada minuto
  $$
  DO $job$
  DECLARE
    i INTEGER;
  BEGIN
    -- Ejecutar 60 ticks en 60 segundos (1 por segundo)
    FOR i IN 1..60 LOOP
      PERFORM public.tick_all_active_coins();
      PERFORM pg_sleep(1);
    END LOOP;
  END;
  $job$;
  $$
);

-- 4. Habilitar Realtime en la tabla coins (para que clientes escuchen cambios)
-- Solo si no está ya habilitado (idempotente)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.coins;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Habilitar Realtime en price_history también (para velas en vivo)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.price_history;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Helper: ejecutar el tick manualmente (útil para testing y para admin)
-- (la función tick_all_active_coins ya existe arriba, solo dejamos un alias claro)
CREATE OR REPLACE FUNCTION public.admin_run_tick_now()
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

  v_count := public.tick_all_active_coins();
  RETURN jsonb_build_object('success', true, 'coins_ticked', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_run_tick_now TO authenticated;

-- 7. Helper para verificar que el cron está activo
CREATE OR REPLACE FUNCTION public.admin_check_engine_status()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_job RECORD;
  v_last_tick TIMESTAMPTZ;
  v_seconds_ago NUMERIC;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  SELECT * INTO v_job FROM cron.job WHERE jobname = 'golbit-tick-engine';
  SELECT MAX(last_tick_at) INTO v_last_tick FROM public.coins WHERE is_active;
  v_seconds_ago := EXTRACT(EPOCH FROM (NOW() - v_last_tick));

  RETURN jsonb_build_object(
    'job_active', v_job IS NOT NULL,
    'job_schedule', COALESCE(v_job.schedule, ''),
    'last_tick_at', v_last_tick,
    'seconds_since_last_tick', v_seconds_ago,
    'engine_healthy', v_seconds_ago IS NOT NULL AND v_seconds_ago < 5
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_check_engine_status TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
-- Después de correr esto:
-- - El motor empieza a generar ticks automáticamente
-- - Esperá 1-2 minutos y mirá la tabla coins: current_price y last_tick_at deben moverse
-- - Si querés verificar: SELECT public.admin_check_engine_status();
-- ============================================================================
