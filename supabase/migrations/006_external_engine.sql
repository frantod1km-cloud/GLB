-- ============================================================================
-- GOLBIT - Migración 006: Motor con Edge Function + cron externo
-- ============================================================================
-- El cron interno de Supabase no soporta resolución sub-minuto de forma
-- confiable. Cambiamos a una arquitectura más robusta:
--   1. Función SQL existente (tick_all_active_coins) sigue siendo el corazón
--   2. Edge Function de Supabase la invoca con auth por secret
--   3. Servicio externo gratis (cron-job.org) llama la Edge Function cada 10s
-- ============================================================================

-- 1. Limpiar TODOS los cron jobs viejos del intento anterior
DO $$
DECLARE
  v_jobid BIGINT;
  v_jobnames TEXT[] := ARRAY[
    'golbit-tick-engine',
    'golbit-tick-0', 'golbit-tick-10', 'golbit-tick-20',
    'golbit-tick-30', 'golbit-tick-40', 'golbit-tick-50'
  ];
  v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY v_jobnames LOOP
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = v_name;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
      RAISE NOTICE 'Unscheduled job: %', v_name;
    END IF;
  END LOOP;
END $$;

-- 2. Agregar campo "engine_secret" en motor_settings para autenticar al cron externo
ALTER TABLE public.motor_settings
  ADD COLUMN IF NOT EXISTS engine_secret TEXT;

-- Generar un secret aleatorio si no existe
UPDATE public.motor_settings
SET engine_secret = encode(gen_random_bytes(24), 'hex')
WHERE id = 1 AND (engine_secret IS NULL OR engine_secret = '');

-- 3. Función pública que el cron externo va a invocar
-- Recibe un secret y si es válido, ejecuta el tick
DROP FUNCTION IF EXISTS public.public_tick(TEXT);

CREATE OR REPLACE FUNCTION public.public_tick(p_secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stored_secret TEXT;
  v_count INTEGER;
BEGIN
  SELECT engine_secret INTO v_stored_secret FROM public.motor_settings WHERE id = 1;

  IF v_stored_secret IS NULL OR v_stored_secret = '' THEN
    RETURN jsonb_build_object('error', 'Engine secret not configured');
  END IF;

  IF p_secret IS NULL OR p_secret <> v_stored_secret THEN
    RETURN jsonb_build_object('error', 'Invalid secret');
  END IF;

  v_count := public.tick_all_active_coins();

  RETURN jsonb_build_object(
    'success', true,
    'ticked', v_count,
    'at', NOW()
  );
END;
$$;

-- Permitir que cualquiera la llame (la auth la hace el secret)
GRANT EXECUTE ON FUNCTION public.public_tick(TEXT) TO anon, authenticated;

-- 4. Función para ver/regenerar el secret (solo admin)
CREATE OR REPLACE FUNCTION public.admin_get_engine_secret()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_secret TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  SELECT engine_secret INTO v_secret FROM public.motor_settings WHERE id = 1;
  RETURN jsonb_build_object('secret', v_secret);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_engine_secret() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_regenerate_engine_secret()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_new TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  v_new := encode(gen_random_bytes(24), 'hex');
  UPDATE public.motor_settings SET engine_secret = v_new WHERE id = 1;
  RETURN jsonb_build_object('secret', v_new);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_regenerate_engine_secret() TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
-- Después de correr esto:
-- 1. El cron interno está apagado
-- 2. Hay una función public_tick(secret) lista para ser invocada
-- 3. El secret se genera automáticamente la primera vez
--
-- Próximo paso: configurar cron-job.org para llamar esta función cada 10s
-- ============================================================================
