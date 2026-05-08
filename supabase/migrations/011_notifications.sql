-- ============================================================================
-- GOLBIT - Migración 011: Notificaciones automáticas (Paso 8)
-- ============================================================================
-- Triggers automáticos para enviar notificaciones de eventos importantes:
--   - Para alumnos: login, depósitos aprobados/rechazados, retiros, ajustes
--   - Para admins: depósitos pendientes, retiros pendientes, liquidaciones
-- ============================================================================

-- 1. Helper: insertar notificación a TODOS los admins
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_title TEXT,
  p_message TEXT,
  p_type TEXT DEFAULT 'info',
  p_data JSONB DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_admin RECORD;
BEGIN
  FOR v_admin IN SELECT id FROM public.profiles WHERE role = 'admin' AND is_active = TRUE LOOP
    INSERT INTO public.notifications (user_id, title, message, type, data)
    VALUES (v_admin.id, p_title, p_message, p_type, p_data);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 2. Trigger: nueva transaction → notificar
CREATE OR REPLACE FUNCTION public.notify_transaction_event()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_type_label TEXT;
BEGIN
  v_type_label := CASE NEW.type
    WHEN 'deposit' THEN 'Depósito'
    WHEN 'withdrawal' THEN 'Retiro'
    WHEN 'adjustment' THEN 'Ajuste'
    ELSE NEW.type
  END;

  -- En INSERT: si es deposit o withdrawal pending → avisar a admins
  IF TG_OP = 'INSERT' THEN
    -- Notificar al usuario propietario
    IF NEW.type = 'deposit' AND NEW.status IN ('pending', 'in_review') THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        NEW.user_id,
        '⏳ Depósito en revisión',
        'Tu depósito de ' || NEW.amount::TEXT || ' USDT está siendo revisado',
        'info'
      );

      -- Notificar a admins
      SELECT full_name INTO v_user_name FROM public.profiles WHERE id = NEW.user_id;
      PERFORM public.notify_admins(
        '💰 Nuevo depósito pendiente',
        COALESCE(v_user_name, 'Un usuario') || ' solicitó ' || NEW.amount::TEXT || ' USDT',
        'info',
        jsonb_build_object('transaction_id', NEW.id, 'user_id', NEW.user_id)
      );

    ELSIF NEW.type = 'withdrawal' AND NEW.status IN ('pending', 'in_review') THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        NEW.user_id,
        '⏳ Retiro en revisión',
        'Tu retiro de ' || NEW.amount::TEXT || ' USDT está siendo revisado',
        'info'
      );

      SELECT full_name INTO v_user_name FROM public.profiles WHERE id = NEW.user_id;
      PERFORM public.notify_admins(
        '💸 Nuevo retiro pendiente',
        COALESCE(v_user_name, 'Un usuario') || ' solicitó retirar ' || NEW.amount::TEXT || ' USDT',
        'warning',
        jsonb_build_object('transaction_id', NEW.id, 'user_id', NEW.user_id)
      );

    ELSIF NEW.type = 'adjustment' THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        NEW.user_id,
        CASE WHEN NEW.amount >= 0 THEN '✅ Saldo acreditado' ELSE '⚠️ Ajuste de saldo' END,
        (CASE WHEN NEW.amount >= 0 THEN '+' ELSE '' END) || NEW.amount::TEXT || ' USDT',
        CASE WHEN NEW.amount >= 0 THEN 'success' ELSE 'warning' END
      );
    END IF;

  -- En UPDATE: cambio de status → avisar
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    IF NEW.status = 'completed' THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        NEW.user_id,
        '✅ ' || v_type_label || ' aprobado',
        v_type_label || ' de ' || NEW.amount::TEXT || ' USDT acreditado',
        'success'
      );
    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (
        NEW.user_id,
        '❌ ' || v_type_label || ' rechazado',
        v_type_label || ' de ' || NEW.amount::TEXT || ' USDT no fue aprobado',
        'error'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_transaction_event ON public.transactions;
CREATE TRIGGER on_transaction_event
  AFTER INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_transaction_event();

-- 3. Trigger: registro de nuevo alumno → notificar admins
CREATE OR REPLACE FUNCTION public.notify_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Solo para students (no whales/bots)
  IF NEW.role = 'student' THEN
    -- Notificar al alumno (bienvenida)
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      NEW.id,
      '👋 ¡Bienvenido a Golbit!',
      'Empezá explorando la sección Trading para ver las monedas disponibles',
      'success'
    );

    -- Notificar admins
    PERFORM public.notify_admins(
      '👤 Nuevo alumno registrado',
      COALESCE(NEW.full_name, NEW.email) || ' se registró',
      'info',
      jsonb_build_object('user_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_new_user_notify ON public.profiles;
CREATE TRIGGER on_new_user_notify
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_user();

-- 4. Trigger: liquidación de alumno → notificar admins (alumno ya recibe en check_open_trades_for_coin)
-- En realidad esto ya se hace dentro de check_open_trades_for_coin, agregamos solo aviso a admin

CREATE OR REPLACE FUNCTION public.notify_admin_on_liquidation()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_name TEXT;
  v_user_role TEXT;
  v_coin_symbol TEXT;
BEGIN
  -- Solo procesar si pasó de open a closed con close_reason='liquidation'
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'open'
     AND NEW.status = 'closed'
     AND NEW.close_reason = 'liquidation'
  THEN
    SELECT full_name, role INTO v_user_name, v_user_role
    FROM public.profiles WHERE id = NEW.user_id;

    -- Solo avisar admins si fue alumno (no whale/bot)
    IF v_user_role = 'student' THEN
      SELECT symbol INTO v_coin_symbol FROM public.coins WHERE id = NEW.coin_id;

      PERFORM public.notify_admins(
        '⚠️ Liquidación de alumno',
        COALESCE(v_user_name, 'Alumno') || ' fue liquidado en ' || v_coin_symbol || ' (-' || NEW.amount::TEXT || ' USDT)',
        'warning',
        jsonb_build_object('trade_id', NEW.id, 'user_id', NEW.user_id)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_trade_liquidation ON public.trades;
CREATE TRIGGER on_trade_liquidation
  AFTER UPDATE ON public.trades
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_on_liquidation();

-- 5. RPCs para que el cliente marque como leídas
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  UPDATE public.notifications
  SET read_at = NOW()
  WHERE id = p_notification_id AND user_id = v_user_id AND read_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_notification_read TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  UPDATE public.notifications
  SET read_at = NOW()
  WHERE user_id = v_user_id AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'marked', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_notification(p_notification_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  DELETE FROM public.notifications
  WHERE id = p_notification_id AND user_id = v_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_notification TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_all_read_notifications()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;

  DELETE FROM public.notifications
  WHERE user_id = v_user_id AND read_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_all_read_notifications TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
