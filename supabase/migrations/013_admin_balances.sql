-- ============================================================================
-- GOLBIT - Migración 013: Saldo de admins
-- ============================================================================
-- Cada admin (no super) tiene un "saldo asignado" por el super_admin.
-- Cuando aprueba un depósito o hace un ajuste, descuenta de ese saldo.
-- El super_admin tiene saldo infinito (fuente del sistema).
-- ============================================================================

-- 1. Tabla admin_balances
CREATE TABLE IF NOT EXISTS public.admin_balances (
  admin_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Saldo total asignado por el super_admin (acumulado)
  total_assigned NUMERIC(20, 2) NOT NULL DEFAULT 0,
  -- Total transferido a usuarios (gastado)
  total_spent NUMERIC(20, 2) NOT NULL DEFAULT 0,
  -- Disponible = total_assigned - total_spent
  -- Lo calculamos en consulta o lo mantenemos como columna generada
  available NUMERIC(20, 2) GENERATED ALWAYS AS (total_assigned - total_spent) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Tabla admin_balance_movements (historial de movimientos)
CREATE TABLE IF NOT EXISTS public.admin_balance_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Tipo: 'assignment' (super da saldo) o 'transfer' (admin envía a user) o 'revoke' (super quita)
  type TEXT NOT NULL CHECK (type IN ('assignment', 'transfer', 'revoke', 'refund')),
  amount NUMERIC(20, 2) NOT NULL, -- positivo o negativo
  -- Si es 'transfer', a quién va
  target_user_id UUID REFERENCES public.profiles(id),
  -- Si es 'transfer' relacionado a una transaction
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  -- Quien lo hizo (super para assignment, admin para transfer)
  performed_by UUID REFERENCES public.profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_movements_admin_id ON public.admin_balance_movements(admin_id, created_at DESC);

-- RLS
ALTER TABLE public.admin_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_balance_movements ENABLE ROW LEVEL SECURITY;

-- Admin puede ver SU PROPIO balance
DROP POLICY IF EXISTS "Admin sees own balance" ON public.admin_balances;
CREATE POLICY "Admin sees own balance" ON public.admin_balances
  FOR SELECT USING (
    admin_id = auth.uid()
    OR public.is_super_admin()
  );

-- Solo super puede insertar/actualizar admin_balances directamente
DROP POLICY IF EXISTS "Super manages balances" ON public.admin_balances;
CREATE POLICY "Super manages balances" ON public.admin_balances
  FOR ALL USING (public.is_super_admin());

-- Movements: admin ve los suyos, super ve todos
DROP POLICY IF EXISTS "Movements visible" ON public.admin_balance_movements;
CREATE POLICY "Movements visible" ON public.admin_balance_movements
  FOR SELECT USING (
    admin_id = auth.uid()
    OR public.is_super_admin()
  );

-- Solo super puede insertar movements directamente
DROP POLICY IF EXISTS "Super inserts movements" ON public.admin_balance_movements;
CREATE POLICY "Super inserts movements" ON public.admin_balance_movements
  FOR INSERT WITH CHECK (public.is_super_admin());

-- 3. Función: asignar saldo a un admin (solo super)
CREATE OR REPLACE FUNCTION public.admin_assign_balance(
  p_admin_id UUID,
  p_amount NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_super_id UUID := auth.uid();
  v_target_role TEXT;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Solo super_admin puede asignar saldo');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'El monto debe ser positivo');
  END IF;

  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_admin_id;
  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('error', 'Admin no encontrado');
  END IF;
  IF v_target_role <> 'admin' THEN
    RETURN jsonb_build_object('error', 'El usuario destino no es admin');
  END IF;

  -- Crear el balance si no existe
  INSERT INTO public.admin_balances (admin_id, total_assigned)
  VALUES (p_admin_id, p_amount)
  ON CONFLICT (admin_id) DO UPDATE SET
    total_assigned = admin_balances.total_assigned + p_amount,
    updated_at = NOW();

  -- Movimiento
  INSERT INTO public.admin_balance_movements (
    admin_id, type, amount, performed_by, notes
  ) VALUES (
    p_admin_id, 'assignment', p_amount, v_super_id, p_notes
  );

  -- Notificar al admin
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_admin_id,
    '💰 Saldo asignado',
    'Recibiste ' || p_amount::TEXT || ' USDT en tu cuenta de admin',
    'success'
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_assign_balance TO authenticated;

-- 4. Función: revocar saldo a un admin (solo super)
CREATE OR REPLACE FUNCTION public.admin_revoke_balance(
  p_admin_id UUID,
  p_amount NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_super_id UUID := auth.uid();
  v_balance RECORD;
BEGIN
  IF NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('error', 'Solo super_admin');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  SELECT * INTO v_balance FROM public.admin_balances WHERE admin_id = p_admin_id;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('error', 'El admin no tiene balance asignado');
  END IF;

  IF v_balance.available < p_amount THEN
    RETURN jsonb_build_object('error', 'El admin no tiene tanto saldo disponible (tiene ' || v_balance.available::TEXT || ')');
  END IF;

  -- Revocar = aumentar total_spent (lo restamos de available)
  UPDATE public.admin_balances
  SET total_assigned = total_assigned - p_amount,
      updated_at = NOW()
  WHERE admin_id = p_admin_id;

  INSERT INTO public.admin_balance_movements (
    admin_id, type, amount, performed_by, notes
  ) VALUES (
    p_admin_id, 'revoke', -p_amount, v_super_id, p_notes
  );

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_admin_id,
    '⚠️ Saldo revocado',
    'Se revocaron ' || p_amount::TEXT || ' USDT de tu cuenta',
    'warning'
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_revoke_balance TO authenticated;

-- 5. Función: transferir admin → user (descuenta del balance del admin)
-- Esta es la que llaman los flujos de aprobación de depósitos / ajustes manuales
CREATE OR REPLACE FUNCTION public.admin_transfer_to_user(
  p_user_id UUID,
  p_amount NUMERIC,
  p_transaction_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_balance RECORD;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Solo admins pueden transferir');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Si es super_admin, NO descuenta saldo (es fuente infinita)
  IF v_actor_role = 'admin' THEN
    SELECT * INTO v_balance FROM public.admin_balances WHERE admin_id = v_actor_id;
    IF v_balance IS NULL OR v_balance.available < p_amount THEN
      RETURN jsonb_build_object(
        'error',
        'Saldo insuficiente. Tenés ' ||
        COALESCE(v_balance.available::TEXT, '0') ||
        ' USDT disponibles. Pedile más al super admin.'
      );
    END IF;

    -- Descontar del balance del admin
    UPDATE public.admin_balances
    SET total_spent = total_spent + p_amount,
        updated_at = NOW()
    WHERE admin_id = v_actor_id;

    -- Registrar movimiento
    INSERT INTO public.admin_balance_movements (
      admin_id, type, amount, target_user_id, transaction_id, performed_by, notes
    ) VALUES (
      v_actor_id, 'transfer', -p_amount, p_user_id, p_transaction_id, v_actor_id, p_notes
    );
  END IF;

  -- Asegurar que la wallet del user existe y acreditar
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_user_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND coin_symbol = 'USDT';

  RETURN jsonb_build_object('success', true, 'amount', p_amount, 'role', v_actor_role);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_transfer_to_user TO authenticated;

-- 6. Helper para obtener mi balance (admin actual)
CREATE OR REPLACE FUNCTION public.my_admin_balance()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_balance RECORD;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_user_id;

  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'role', 'super_admin',
      'unlimited', true
    );
  END IF;

  IF v_role <> 'admin' THEN
    RETURN jsonb_build_object('error', 'No sos admin');
  END IF;

  SELECT * INTO v_balance FROM public.admin_balances WHERE admin_id = v_user_id;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object(
      'role', 'admin',
      'total_assigned', 0,
      'total_spent', 0,
      'available', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'role', 'admin',
    'total_assigned', v_balance.total_assigned,
    'total_spent', v_balance.total_spent,
    'available', v_balance.available
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_admin_balance TO authenticated;

-- 7. Trigger: cuando se crea un admin nuevo, automáticamente le creamos su balance en 0
CREATE OR REPLACE FUNCTION public.create_admin_balance_on_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' AND (OLD.role IS NULL OR OLD.role <> 'admin') THEN
    INSERT INTO public.admin_balances (admin_id, total_assigned, total_spent)
    VALUES (NEW.id, 0, 0)
    ON CONFLICT (admin_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_admin_created ON public.profiles;
CREATE TRIGGER on_admin_created
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_admin_balance_on_role_change();

-- Crear balances iniciales para admins existentes que no lo tengan
INSERT INTO public.admin_balances (admin_id, total_assigned, total_spent)
SELECT id, 0, 0 FROM public.profiles WHERE role = 'admin'
ON CONFLICT (admin_id) DO NOTHING;

-- ============================================================================
-- 8. MODIFICAR el flujo de aprobar depósitos para que descuente saldo del admin
-- ============================================================================
-- Buscamos la función approve_transaction (creada en wallet) y la actualizamos.
-- Si no existe, la creamos.

CREATE OR REPLACE FUNCTION public.approve_transaction(
  p_transaction_id UUID,
  p_action TEXT  -- 'approve' | 'reject'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_tx RECORD;
  v_transfer_result JSONB;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('error', 'Acción inválida');
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF v_tx IS NULL THEN
    RETURN jsonb_build_object('error', 'Transacción no encontrada');
  END IF;

  IF v_tx.status NOT IN ('pending', 'in_review') THEN
    RETURN jsonb_build_object('error', 'La transacción ya fue procesada');
  END IF;

  IF p_action = 'reject' THEN
    UPDATE public.transactions
    SET status = 'rejected',
        approved_by = v_actor_id,
        approved_at = NOW()
    WHERE id = p_transaction_id;
    RETURN jsonb_build_object('success', true, 'action', 'rejected');
  END IF;

  -- APPROVE
  IF v_tx.type = 'deposit' THEN
    -- Transferir desde el saldo del admin al user
    v_transfer_result := public.admin_transfer_to_user(
      v_tx.user_id,
      v_tx.amount,
      v_tx.id,
      'Depósito aprobado'
    );

    IF (v_transfer_result->>'error') IS NOT NULL THEN
      RETURN v_transfer_result;
    END IF;

  ELSIF v_tx.type = 'withdrawal' THEN
    -- Retiro: descontar saldo del usuario (ya estaba lockeado)
    UPDATE public.wallets
    SET locked_balance = GREATEST(locked_balance - v_tx.amount, 0),
        updated_at = NOW()
    WHERE user_id = v_tx.user_id AND coin_symbol = 'USDT';
  END IF;

  UPDATE public.transactions
  SET status = 'completed',
      approved_by = v_actor_id,
      approved_at = NOW()
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object('success', true, 'action', 'approved');
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_transaction TO authenticated;

-- ============================================================================
-- 9. Modificar admin_adjust_balance para descontar saldo del admin si es ajuste positivo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  p_user_id UUID,
  p_amount NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_balance RECORD;
  v_target_role TEXT;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_amount = 0 THEN
    RETURN jsonb_build_object('error', 'Monto no puede ser 0');
  END IF;

  -- Verificar que el target sea student (no whales/bots/admins)
  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role <> 'student' THEN
    RETURN jsonb_build_object('error', 'Solo se ajusta saldo de usuarios');
  END IF;

  -- Si el admin normal está acreditando (monto positivo), descontar su saldo
  IF v_actor_role = 'admin' AND p_amount > 0 THEN
    SELECT * INTO v_balance FROM public.admin_balances WHERE admin_id = v_actor_id;
    IF v_balance IS NULL OR v_balance.available < p_amount THEN
      RETURN jsonb_build_object(
        'error',
        'Saldo insuficiente para acreditar. Tenés ' ||
        COALESCE(v_balance.available::TEXT, '0') ||
        ' USDT disponibles.'
      );
    END IF;

    UPDATE public.admin_balances
    SET total_spent = total_spent + p_amount,
        updated_at = NOW()
    WHERE admin_id = v_actor_id;

    INSERT INTO public.admin_balance_movements (
      admin_id, type, amount, target_user_id, performed_by, notes
    ) VALUES (
      v_actor_id, 'transfer', -p_amount, p_user_id, v_actor_id,
      'Ajuste manual: ' || COALESCE(p_notes, '')
    );
  END IF;

  -- Asegurar wallet
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_user_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  -- Aplicar el ajuste (puede ser negativo)
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = p_user_id AND coin_symbol = 'USDT';

  -- Registrar transaction
  INSERT INTO public.transactions (
    user_id, type, amount, status, approved_by, approved_at, notes
  ) VALUES (
    p_user_id, 'adjustment', p_amount, 'completed', v_actor_id, NOW(), p_notes
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance TO authenticated;

-- ============================================================================
-- FIN
-- ============================================================================
