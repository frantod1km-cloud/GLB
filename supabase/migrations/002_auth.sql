-- ============================================================================
-- GOLBIT - Migración Paso 2: Auth funcional
-- ============================================================================
-- Agrega:
-- 1. Campo initial_balance en motor_settings
-- 2. Trigger que crea wallet automáticamente al crear profile
-- 3. Trigger que aplica el referido si vino con código
-- ============================================================================

-- 1. Agregar campo initial_balance (cuánto USDT recibe cada nuevo usuario)
ALTER TABLE public.motor_settings
  ADD COLUMN IF NOT EXISTS initial_balance NUMERIC(20, 8) NOT NULL DEFAULT 0;

-- 2. Trigger: cuando se crea un profile, crear wallet con saldo inicial
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  initial_bal NUMERIC(20, 8);
BEGIN
  -- Leer saldo inicial configurado
  SELECT initial_balance INTO initial_bal FROM public.motor_settings WHERE id = 1;
  IF initial_bal IS NULL THEN
    initial_bal := 0;
  END IF;

  -- Crear wallet USDT con el saldo inicial
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (NEW.id, 'USDT', initial_bal)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  -- Si recibió saldo inicial, registrar la transacción
  IF initial_bal > 0 THEN
    INSERT INTO public.transactions (user_id, type, amount, coin_symbol, status, notes)
    VALUES (NEW.id, 'deposit', initial_bal, 'USDT', 'completed', 'Saldo inicial de bienvenida');
  END IF;

  -- Notificación de bienvenida
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    NEW.id,
    '¡Bienvenido a Golbit!',
    CASE
      WHEN initial_bal > 0 THEN 'Te dimos ' || initial_bal::TEXT || ' USDT para que empieces a operar.'
      ELSE 'Tu cuenta está lista. Pedile a tu instructor que te cargue saldo para empezar.'
    END,
    'success'
  );

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- 3. Función para validar y aplicar código de referido (la usaremos desde server action)
CREATE OR REPLACE FUNCTION public.apply_referral(target_user_id UUID, ref_code TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  referrer_id UUID;
BEGIN
  -- Buscar al referidor por su código
  SELECT id INTO referrer_id FROM public.profiles
  WHERE referral_code = UPPER(TRIM(ref_code)) AND is_active = TRUE;

  IF referrer_id IS NULL THEN
    RETURN FALSE; -- código inválido
  END IF;

  IF referrer_id = target_user_id THEN
    RETURN FALSE; -- no puede referirse a sí mismo
  END IF;

  -- Aplicar referido
  UPDATE public.profiles SET referred_by = referrer_id WHERE id = target_user_id;
  RETURN TRUE;
END; $$;

GRANT EXECUTE ON FUNCTION public.apply_referral(UUID, TEXT) TO authenticated;

-- ============================================================================
-- FIN DE LA MIGRACIÓN
-- ============================================================================
