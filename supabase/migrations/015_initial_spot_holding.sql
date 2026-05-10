-- ============================================================================
-- GOLBIT - Migración 015: trigger spot_holding inicial
-- ============================================================================
-- Cuando se crea un nuevo profile (al registrarse), también le creamos
-- una fila spot_holdings con USDT en 0 para que la UI no muestre vacío.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_initial_spot_holding()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Solo para students (whales/bots/admins no necesitan)
  IF NEW.role = 'student' THEN
    INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
    VALUES (NEW.id, 'USDT', 0)
    ON CONFLICT (user_id, coin_symbol) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_create_spot_holding ON public.profiles;
CREATE TRIGGER on_profile_create_spot_holding
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_spot_holding();

-- También crear holdings USDT en 0 para todos los students existentes que no lo tengan
INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
SELECT id, 'USDT', 0
FROM public.profiles
WHERE role = 'student'
ON CONFLICT (user_id, coin_symbol) DO NOTHING;

-- ============================================================================
-- FIN
-- ============================================================================
