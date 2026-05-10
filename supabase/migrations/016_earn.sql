-- ============================================================================
-- GOLBIT - Migración 016: Earn (productos + suscripciones)
-- ============================================================================
-- Sistema completo de Earn:
-- - earn_products: catálogo configurable por super_admin
-- - earn_subscriptions: suscripciones activas de cada usuario
-- - Tipos: flexible, fixed, shark_fin
-- - Pagos: al vencer o diario (configurable)
-- - Cancelación anticipada con penalty (configurable)
-- ============================================================================

-- 1. Tabla productos
CREATE TABLE IF NOT EXISTS public.earn_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tipo de producto
  type TEXT NOT NULL CHECK (type IN ('flexible', 'fixed', 'shark_fin')),
  -- Nombre visible (ej: "USDT Flexible", "BTC Fijo 30 días")
  name TEXT NOT NULL,
  description TEXT,
  -- Moneda en la que se invierte
  coin_symbol TEXT NOT NULL,
  -- APR anual (%)
  apr NUMERIC(8, 4) NOT NULL DEFAULT 0,
  -- Para fixed/shark_fin: duración en días (NULL = flexible)
  duration_days INTEGER,
  -- Mínimo y máximo de suscripción
  min_amount NUMERIC(30, 12) NOT NULL DEFAULT 0,
  max_amount NUMERIC(30, 12),
  -- Cuánto se paga: al vencer o diario
  payout_mode TEXT NOT NULL DEFAULT 'at_maturity' CHECK (payout_mode IN ('at_maturity', 'daily')),
  -- ¿Permite cancelación anticipada?
  early_cancellation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Si permite, qué % se penaliza (ej: 30 = pierde 30% del capital)
  early_cancellation_penalty_percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  -- ====== SHARK FIN ======
  -- Sólo aplica si type = shark_fin
  shark_fin_target_coin TEXT,        -- moneda a observar (ej: BTC, ETH)
  shark_fin_range_low NUMERIC(30, 12),    -- precio mínimo del rango
  shark_fin_range_high NUMERIC(30, 12),   -- precio máximo del rango
  shark_fin_bonus_apr NUMERIC(8, 4),      -- APR si se cumple
  shark_fin_base_apr NUMERIC(8, 4) DEFAULT 0, -- APR si NO se cumple
  -- ====== METADATOS ======
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Visibilidad / orden
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Capacidad total del producto (NULL = sin tope)
  total_capacity NUMERIC(30, 12),
  total_subscribed NUMERIC(30, 12) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_earn_products_active ON public.earn_products(is_active, type);
CREATE INDEX IF NOT EXISTS idx_earn_products_coin ON public.earn_products(coin_symbol);

-- RLS: todos los usuarios autenticados pueden ver productos activos
ALTER TABLE public.earn_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone sees active products" ON public.earn_products;
CREATE POLICY "Anyone sees active products" ON public.earn_products
  FOR SELECT USING (
    is_active = TRUE OR public.is_admin_or_super()
  );

DROP POLICY IF EXISTS "Super admin manages products" ON public.earn_products;
CREATE POLICY "Super admin manages products" ON public.earn_products
  FOR ALL USING (public.is_super_admin());

-- ============================================================================
-- 2. Tabla suscripciones
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.earn_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.earn_products(id),
  -- Snapshot de los parámetros (por si el producto cambia después)
  product_type TEXT NOT NULL,
  product_name TEXT NOT NULL,
  coin_symbol TEXT NOT NULL,
  apr NUMERIC(8, 4) NOT NULL,
  duration_days INTEGER,
  payout_mode TEXT NOT NULL,
  early_cancellation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  early_cancellation_penalty_percent NUMERIC(8, 4) DEFAULT 0,
  -- Para shark_fin: snapshot del rango y APRs
  shark_fin_target_coin TEXT,
  shark_fin_range_low NUMERIC(30, 12),
  shark_fin_range_high NUMERIC(30, 12),
  shark_fin_bonus_apr NUMERIC(8, 4),
  shark_fin_base_apr NUMERIC(8, 4),
  -- Si el rango se rompió durante el período (sólo shark_fin)
  shark_fin_range_broken BOOLEAN NOT NULL DEFAULT FALSE,
  shark_fin_break_price NUMERIC(30, 12),
  shark_fin_break_at TIMESTAMPTZ,
  -- Datos de la suscripción
  amount NUMERIC(30, 12) NOT NULL,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ, -- NULL para flexible
  -- Intereses acumulados (se actualizan con el cron)
  accumulated_interest NUMERIC(30, 12) NOT NULL DEFAULT 0,
  last_interest_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Estado
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matured', 'redeemed', 'cancelled')),
  matured_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  -- Si fue cancelado anticipadamente
  early_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  penalty_amount NUMERIC(30, 12) DEFAULT 0,
  -- Total final pagado (capital + intereses - penalty)
  final_payout NUMERIC(30, 12),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_user_active ON public.earn_subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_ends ON public.earn_subscriptions(ends_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subs_product ON public.earn_subscriptions(product_id);

ALTER TABLE public.earn_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User sees own subs" ON public.earn_subscriptions;
CREATE POLICY "User sees own subs" ON public.earn_subscriptions
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_admin_or_super()
  );

-- ============================================================================
-- 3. RPC: suscribirse a un producto
-- ============================================================================
CREATE OR REPLACE FUNCTION public.earn_subscribe(
  p_product_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_product RECORD;
  v_balance NUMERIC;
  v_ends_at TIMESTAMPTZ;
  v_subscription_id UUID;
  v_remaining_capacity NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Obtener producto
  SELECT * INTO v_product FROM public.earn_products WHERE id = p_product_id AND is_active = TRUE;
  IF v_product IS NULL THEN
    RETURN jsonb_build_object('error', 'Producto no encontrado o inactivo');
  END IF;

  -- Validar mínimo / máximo
  IF p_amount < v_product.min_amount THEN
    RETURN jsonb_build_object('error', 'Monto mínimo: ' || v_product.min_amount::TEXT || ' ' || v_product.coin_symbol);
  END IF;

  IF v_product.max_amount IS NOT NULL AND p_amount > v_product.max_amount THEN
    RETURN jsonb_build_object('error', 'Monto máximo: ' || v_product.max_amount::TEXT || ' ' || v_product.coin_symbol);
  END IF;

  -- Validar capacidad total
  IF v_product.total_capacity IS NOT NULL THEN
    v_remaining_capacity := v_product.total_capacity - v_product.total_subscribed;
    IF p_amount > v_remaining_capacity THEN
      RETURN jsonb_build_object('error', 'Capacidad disponible: ' || v_remaining_capacity::TEXT || ' ' || v_product.coin_symbol);
    END IF;
  END IF;

  -- Validar saldo en Spot
  v_balance := public.get_spot_balance(v_user_id, v_product.coin_symbol);
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object(
      'error',
      'Saldo insuficiente. Tenés ' || v_balance::TEXT || ' ' || v_product.coin_symbol
    );
  END IF;

  -- Calcular fecha fin (NULL para flexible)
  IF v_product.duration_days IS NOT NULL THEN
    v_ends_at := NOW() + (v_product.duration_days || ' days')::INTERVAL;
  ELSE
    v_ends_at := NULL;
  END IF;

  -- Restar del Spot
  UPDATE public.spot_holdings
  SET amount = amount - p_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = v_product.coin_symbol;

  -- Crear suscripción (snapshot de todo)
  INSERT INTO public.earn_subscriptions (
    user_id, product_id,
    product_type, product_name, coin_symbol,
    apr, duration_days, payout_mode,
    early_cancellation_enabled, early_cancellation_penalty_percent,
    shark_fin_target_coin, shark_fin_range_low, shark_fin_range_high,
    shark_fin_bonus_apr, shark_fin_base_apr,
    amount, ends_at
  ) VALUES (
    v_user_id, v_product.id,
    v_product.type, v_product.name, v_product.coin_symbol,
    v_product.apr, v_product.duration_days, v_product.payout_mode,
    v_product.early_cancellation_enabled, v_product.early_cancellation_penalty_percent,
    v_product.shark_fin_target_coin, v_product.shark_fin_range_low, v_product.shark_fin_range_high,
    v_product.shark_fin_bonus_apr, v_product.shark_fin_base_apr,
    p_amount, v_ends_at
  ) RETURNING id INTO v_subscription_id;

  -- Actualizar total_subscribed del producto
  UPDATE public.earn_products
  SET total_subscribed = total_subscribed + p_amount, updated_at = NOW()
  WHERE id = v_product.id;

  -- Registrar en wallet_transfers (para historial)
  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin, from_amount, to_amount, notes
  ) VALUES (
    v_user_id, 'spot_to_earn', v_product.coin_symbol, v_product.coin_symbol,
    p_amount, p_amount, 'Suscripción a ' || v_product.name
  );

  -- Notificar
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    '💎 Suscripción activa',
    'Suscribiste ' || p_amount::TEXT || ' ' || v_product.coin_symbol || ' a ' || v_product.name,
    'success'
  );

  RETURN jsonb_build_object(
    'success', true,
    'subscription_id', v_subscription_id,
    'amount', p_amount,
    'ends_at', v_ends_at
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.earn_subscribe TO authenticated;

-- ============================================================================
-- 4. RPC: redimir (flexible o fijo vencido)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.earn_redeem(p_subscription_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sub RECORD;
  v_total_payout NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT * INTO v_sub FROM public.earn_subscriptions
  WHERE id = p_subscription_id AND user_id = v_user_id;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('error', 'Suscripción no encontrada');
  END IF;

  IF v_sub.status NOT IN ('active', 'matured') THEN
    RETURN jsonb_build_object('error', 'La suscripción no se puede redimir');
  END IF;

  -- Para fixed/shark_fin que NO esté vencido → no se puede redimir (debe cancelar)
  IF v_sub.product_type IN ('fixed', 'shark_fin') AND v_sub.status = 'active' THEN
    IF v_sub.ends_at IS NULL OR v_sub.ends_at > NOW() THEN
      RETURN jsonb_build_object('error', 'El plazo todavía no venció. Para retirar antes, usá cancelar anticipado.');
    END IF;
  END IF;

  -- Total a devolver = capital + intereses acumulados
  v_total_payout := v_sub.amount + COALESCE(v_sub.accumulated_interest, 0);

  -- Acreditar en Spot
  INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
  VALUES (v_user_id, v_sub.coin_symbol, v_total_payout)
  ON CONFLICT (user_id, coin_symbol) DO UPDATE SET
    amount = spot_holdings.amount + v_total_payout,
    updated_at = NOW();

  -- Marcar redeemed
  UPDATE public.earn_subscriptions
  SET status = 'redeemed',
      redeemed_at = NOW(),
      final_payout = v_total_payout,
      updated_at = NOW()
  WHERE id = p_subscription_id;

  -- Liberar capacidad del producto
  UPDATE public.earn_products
  SET total_subscribed = GREATEST(total_subscribed - v_sub.amount, 0), updated_at = NOW()
  WHERE id = v_sub.product_id;

  -- Registrar
  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin, from_amount, to_amount, notes
  ) VALUES (
    v_user_id, 'earn_to_spot', v_sub.coin_symbol, v_sub.coin_symbol,
    v_total_payout, v_total_payout, 'Redención de ' || v_sub.product_name
  );

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    '✅ Redención completada',
    'Recibiste ' || v_total_payout::TEXT || ' ' || v_sub.coin_symbol || ' (incluye intereses)',
    'success'
  );

  RETURN jsonb_build_object(
    'success', true,
    'amount', v_sub.amount,
    'interest', COALESCE(v_sub.accumulated_interest, 0),
    'total_payout', v_total_payout
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.earn_redeem TO authenticated;

-- ============================================================================
-- 5. RPC: cancelar anticipadamente (con penalty)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.earn_cancel_early(p_subscription_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_sub RECORD;
  v_penalty_amount NUMERIC;
  v_returned_amount NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT * INTO v_sub FROM public.earn_subscriptions
  WHERE id = p_subscription_id AND user_id = v_user_id;

  IF v_sub IS NULL THEN
    RETURN jsonb_build_object('error', 'Suscripción no encontrada');
  END IF;

  IF v_sub.status <> 'active' THEN
    RETURN jsonb_build_object('error', 'La suscripción no está activa');
  END IF;

  IF NOT v_sub.early_cancellation_enabled THEN
    RETURN jsonb_build_object('error', 'Este producto no permite cancelación anticipada');
  END IF;

  -- Si ya venció, debería redimir, no cancelar
  IF v_sub.ends_at IS NOT NULL AND v_sub.ends_at <= NOW() THEN
    RETURN jsonb_build_object('error', 'El plazo ya venció. Usá redimir.');
  END IF;

  -- Calcular penalty (sobre el capital, no sobre intereses)
  v_penalty_amount := v_sub.amount * COALESCE(v_sub.early_cancellation_penalty_percent, 0) / 100;
  -- Devuelve capital - penalty (los intereses acumulados se pierden al cancelar)
  v_returned_amount := v_sub.amount - v_penalty_amount;

  -- Acreditar en Spot
  IF v_returned_amount > 0 THEN
    INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
    VALUES (v_user_id, v_sub.coin_symbol, v_returned_amount)
    ON CONFLICT (user_id, coin_symbol) DO UPDATE SET
      amount = spot_holdings.amount + v_returned_amount,
      updated_at = NOW();
  END IF;

  -- Marcar cancelada
  UPDATE public.earn_subscriptions
  SET status = 'cancelled',
      cancelled_at = NOW(),
      early_cancelled = TRUE,
      penalty_amount = v_penalty_amount,
      final_payout = v_returned_amount,
      updated_at = NOW()
  WHERE id = p_subscription_id;

  -- Liberar capacidad
  UPDATE public.earn_products
  SET total_subscribed = GREATEST(total_subscribed - v_sub.amount, 0), updated_at = NOW()
  WHERE id = v_sub.product_id;

  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin, from_amount, to_amount,
    fee_amount, fee_coin, notes
  ) VALUES (
    v_user_id, 'earn_to_spot', v_sub.coin_symbol, v_sub.coin_symbol,
    v_returned_amount, v_returned_amount,
    v_penalty_amount, v_sub.coin_symbol,
    'Cancelación anticipada de ' || v_sub.product_name
  );

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    '⚠️ Suscripción cancelada',
    'Cancelaste anticipadamente. Recibiste ' || v_returned_amount::TEXT || ' ' || v_sub.coin_symbol || ' (penalty: ' || v_penalty_amount::TEXT || ')',
    'warning'
  );

  RETURN jsonb_build_object(
    'success', true,
    'returned_amount', v_returned_amount,
    'penalty_amount', v_penalty_amount
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.earn_cancel_early TO authenticated;

-- ============================================================================
-- 6. Helper RPC: stats del usuario
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_earn_summary()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_active_count INTEGER;
  v_total_capital NUMERIC;
  v_total_interest NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(accumulated_interest), 0)
  INTO v_active_count, v_total_capital, v_total_interest
  FROM public.earn_subscriptions
  WHERE user_id = v_user_id AND status = 'active';

  RETURN jsonb_build_object(
    'active_count', v_active_count,
    'total_capital', v_total_capital,
    'total_interest', v_total_interest
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.my_earn_summary TO authenticated;

-- ============================================================================
-- 7. Insertar productos de ejemplo
-- ============================================================================
INSERT INTO public.earn_products (
  type, name, description, coin_symbol, apr,
  duration_days, min_amount, max_amount, payout_mode,
  early_cancellation_enabled, early_cancellation_penalty_percent,
  is_active, sort_order
) VALUES
  ('flexible', 'USDT Flexible', 'Retirá cuando quieras', 'USDT', 8.00,
   NULL, 10, NULL, 'daily',
   FALSE, 0,
   TRUE, 1),
  ('fixed', 'USDT Fijo 7 días', 'Bloqueado por 7 días', 'USDT', 10.00,
   7, 100, 50000, 'at_maturity',
   TRUE, 30,
   TRUE, 10),
  ('fixed', 'USDT Fijo 30 días', 'Bloqueado por 30 días', 'USDT', 12.00,
   30, 100, 100000, 'at_maturity',
   TRUE, 50,
   TRUE, 20),
  ('fixed', 'USDT Fijo 90 días', 'Bloqueado por 90 días', 'USDT', 15.00,
   90, 500, 200000, 'at_maturity',
   TRUE, 70,
   TRUE, 30)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- FIN
-- ============================================================================
