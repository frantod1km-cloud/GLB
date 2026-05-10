-- ============================================================================
-- GOLBIT - Migración 014: Multi-wallet (Spot / Trading / Earn)
-- ============================================================================
-- Crea la estructura para wallets separadas estilo Binance.
-- - Trading: la wallet actual (sigue siendo `wallets` con USDT)
-- - Spot: nueva tabla para saldos por moneda (BTC, ETH, USDT, etc.)
-- - Earn: nueva tabla para suscripciones a productos
--
-- Esta migración SOLO crea la infraestructura.
-- NO modifica el comportamiento actual: trading sigue igual.
-- ============================================================================

-- ============================================================================
-- 1. Tabla spot_holdings: saldos por moneda en wallet Spot
-- ============================================================================
-- Cada usuario puede tener N filas, una por moneda donde tenga saldo
CREATE TABLE IF NOT EXISTS public.spot_holdings (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coin_symbol TEXT NOT NULL,
  -- Cantidad en la moneda (ej: 0.05 BTC, 1.2 ETH, 500 USDT)
  amount NUMERIC(30, 12) NOT NULL DEFAULT 0,
  -- Costo promedio en USDT (para calcular PnL si convirtiera de vuelta)
  avg_buy_price_usdt NUMERIC(20, 8) NOT NULL DEFAULT 0,
  -- Cantidad acumulada comprada (para el promedio ponderado)
  total_bought_usdt NUMERIC(20, 8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, coin_symbol)
);

CREATE INDEX IF NOT EXISTS idx_spot_holdings_user ON public.spot_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_spot_holdings_coin ON public.spot_holdings(coin_symbol);

-- RLS: usuario ve solo lo suyo, admins ven todo
ALTER TABLE public.spot_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User sees own holdings" ON public.spot_holdings;
CREATE POLICY "User sees own holdings" ON public.spot_holdings
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_admin_or_super()
  );

-- Inserts/updates solo via RPCs SECURITY DEFINER

-- ============================================================================
-- 2. Tabla wallet_transfers: historial de transferencias entre wallets
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Tipo: 'spot_to_trading', 'trading_to_spot', 'spot_to_earn', 'earn_to_spot', 'convert'
  type TEXT NOT NULL CHECK (type IN (
    'spot_to_trading', 'trading_to_spot',
    'spot_to_earn', 'earn_to_spot',
    'convert'
  )),
  from_coin TEXT NOT NULL,
  to_coin TEXT NOT NULL,
  from_amount NUMERIC(30, 12) NOT NULL,
  to_amount NUMERIC(30, 12) NOT NULL,
  -- Para conversiones: precio aplicado y comisión
  conversion_rate NUMERIC(30, 12),
  fee_amount NUMERIC(30, 12) DEFAULT 0,
  fee_coin TEXT,
  -- Notas opcionales
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transfers_user ON public.wallet_transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_type ON public.wallet_transfers(type);

ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User sees own transfers" ON public.wallet_transfers;
CREATE POLICY "User sees own transfers" ON public.wallet_transfers
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_admin_or_super()
  );

-- ============================================================================
-- 3. Agregar campos a la tabla coins para precios de conversión
-- ============================================================================
-- spot_buy_price: precio al que el usuario compra esta moneda con USDT
-- spot_sell_price: precio al que el usuario vende esta moneda y recibe USDT
-- Cuando son NULL, se usa current_price con spread del trading.
-- Cuando el super_admin los setea, override.

ALTER TABLE public.coins
  ADD COLUMN IF NOT EXISTS spot_buy_price NUMERIC(30, 12),
  ADD COLUMN IF NOT EXISTS spot_sell_price NUMERIC(30, 12),
  -- Si esta moneda se puede usar en spot/convert
  ADD COLUMN IF NOT EXISTS spot_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================================
-- 4. Helper: obtener el saldo de una moneda en spot
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_spot_balance(
  p_user_id UUID,
  p_coin_symbol TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC;
BEGIN
  SELECT amount INTO v_amount
  FROM public.spot_holdings
  WHERE user_id = p_user_id AND coin_symbol = p_coin_symbol;
  RETURN COALESCE(v_amount, 0);
END;
$$;

-- ============================================================================
-- 5. Helper: obtener el precio efectivo de una moneda
-- (override manual del super admin si existe, si no current_price)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_spot_price(
  p_coin_symbol TEXT,
  p_side TEXT  -- 'buy' (cuanto USDT pago por 1 unidad) | 'sell' (cuanto USDT recibo por 1 unidad)
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_coin RECORD;
BEGIN
  -- USDT es siempre 1
  IF p_coin_symbol = 'USDT' THEN
    RETURN 1;
  END IF;

  SELECT current_price, spread_percent, spot_buy_price, spot_sell_price, spot_enabled
  INTO v_coin
  FROM public.coins
  WHERE symbol = p_coin_symbol AND is_active = TRUE;

  IF v_coin IS NULL OR NOT v_coin.spot_enabled THEN
    RETURN NULL;
  END IF;

  IF p_side = 'buy' THEN
    -- Si el admin override está seteado, usarlo
    IF v_coin.spot_buy_price IS NOT NULL THEN
      RETURN v_coin.spot_buy_price;
    END IF;
    -- Sino, current_price + half spread (más caro al comprar)
    RETURN v_coin.current_price * (1 + COALESCE(v_coin.spread_percent, 0) / 200);
  ELSIF p_side = 'sell' THEN
    IF v_coin.spot_sell_price IS NOT NULL THEN
      RETURN v_coin.spot_sell_price;
    END IF;
    RETURN v_coin.current_price * (1 - COALESCE(v_coin.spread_percent, 0) / 200);
  END IF;

  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_spot_price TO authenticated;

-- ============================================================================
-- 6. RPC: convert (convertir entre monedas spot)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.spot_convert(
  p_from_coin TEXT,
  p_to_coin TEXT,
  p_from_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_from_balance NUMERIC;
  v_from_price NUMERIC;
  v_to_price NUMERIC;
  v_usdt_value NUMERIC;
  v_to_amount NUMERIC;
  v_fee_pct NUMERIC;
  v_fee_amount NUMERIC;
  v_net_to_amount NUMERIC;
  v_settings RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No autenticado');
  END IF;

  IF p_from_coin = p_to_coin THEN
    RETURN jsonb_build_object('error', 'No se puede convertir a la misma moneda');
  END IF;

  IF p_from_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto inválido');
  END IF;

  -- Comisión configurable desde motor_settings
  SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;
  v_fee_pct := COALESCE(v_settings.convert_fee_percent, 0.1);

  -- Verificar saldo disponible
  v_from_balance := public.get_spot_balance(v_user_id, p_from_coin);

  IF v_from_balance < p_from_amount THEN
    RETURN jsonb_build_object('error', 'Saldo insuficiente. Tenés ' || v_from_balance::TEXT || ' ' || p_from_coin);
  END IF;

  -- Convertir todo a USDT como intermedio
  -- Si origen es USDT: usdt_value = p_from_amount
  -- Si origen es otra: usdt_value = p_from_amount * sell_price
  IF p_from_coin = 'USDT' THEN
    v_usdt_value := p_from_amount;
  ELSE
    v_from_price := public.get_spot_price(p_from_coin, 'sell');
    IF v_from_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Moneda origen no disponible para conversión');
    END IF;
    v_usdt_value := p_from_amount * v_from_price;
  END IF;

  -- Convertir USDT a destino
  IF p_to_coin = 'USDT' THEN
    v_to_amount := v_usdt_value;
  ELSE
    v_to_price := public.get_spot_price(p_to_coin, 'buy');
    IF v_to_price IS NULL THEN
      RETURN jsonb_build_object('error', 'Moneda destino no disponible para conversión');
    END IF;
    v_to_amount := v_usdt_value / v_to_price;
  END IF;

  -- Aplicar comisión sobre el destino
  v_fee_amount := v_to_amount * v_fee_pct / 100;
  v_net_to_amount := v_to_amount - v_fee_amount;

  -- Restar del origen
  UPDATE public.spot_holdings
  SET amount = amount - p_from_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = p_from_coin;

  -- Sumar al destino (insert o update)
  INSERT INTO public.spot_holdings (user_id, coin_symbol, amount, total_bought_usdt, avg_buy_price_usdt)
  VALUES (
    v_user_id, p_to_coin, v_net_to_amount,
    CASE WHEN p_to_coin <> 'USDT' THEN v_usdt_value ELSE 0 END,
    CASE WHEN p_to_coin <> 'USDT' AND v_net_to_amount > 0 THEN v_usdt_value / v_net_to_amount ELSE 0 END
  )
  ON CONFLICT (user_id, coin_symbol) DO UPDATE SET
    amount = spot_holdings.amount + EXCLUDED.amount,
    total_bought_usdt = spot_holdings.total_bought_usdt + EXCLUDED.total_bought_usdt,
    -- Promedio ponderado del precio de compra
    avg_buy_price_usdt = CASE
      WHEN spot_holdings.amount + EXCLUDED.amount > 0
      THEN (spot_holdings.total_bought_usdt + EXCLUDED.total_bought_usdt) / (spot_holdings.amount + EXCLUDED.amount)
      ELSE 0
    END,
    updated_at = NOW();

  -- Registrar en historial
  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin,
    from_amount, to_amount, conversion_rate, fee_amount, fee_coin
  ) VALUES (
    v_user_id, 'convert', p_from_coin, p_to_coin,
    p_from_amount, v_net_to_amount,
    CASE WHEN p_from_amount > 0 THEN v_net_to_amount / p_from_amount ELSE 0 END,
    v_fee_amount, p_to_coin
  );

  RETURN jsonb_build_object(
    'success', true,
    'from_coin', p_from_coin,
    'from_amount', p_from_amount,
    'to_coin', p_to_coin,
    'to_amount', v_net_to_amount,
    'gross_to_amount', v_to_amount,
    'fee_amount', v_fee_amount,
    'fee_pct', v_fee_pct,
    'usdt_value', v_usdt_value
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.spot_convert TO authenticated;

-- ============================================================================
-- 7. RPC: spot_to_trading (mover USDT de Spot a Trading)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transfer_spot_to_trading(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_spot_balance NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error', 'Monto inválido'); END IF;

  v_spot_balance := public.get_spot_balance(v_user_id, 'USDT');
  IF v_spot_balance < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo USDT en spot insuficiente');
  END IF;

  -- Restar de spot
  UPDATE public.spot_holdings
  SET amount = amount - p_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  -- Sumar a trading wallet
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (v_user_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  -- Registrar transferencia
  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin, from_amount, to_amount
  ) VALUES (
    v_user_id, 'spot_to_trading', 'USDT', 'USDT', p_amount, p_amount
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_spot_to_trading TO authenticated;

-- ============================================================================
-- 8. RPC: trading_to_spot (mover USDT de Trading a Spot)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.transfer_trading_to_spot(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_trading_balance NUMERIC;
  v_locked NUMERIC;
  v_available NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('error', 'No autenticado'); END IF;
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error', 'Monto inválido'); END IF;

  SELECT balance, locked_balance INTO v_trading_balance, v_locked
  FROM public.wallets
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  v_available := COALESCE(v_trading_balance, 0) - COALESCE(v_locked, 0);
  IF v_available < p_amount THEN
    RETURN jsonb_build_object('error', 'Saldo USDT disponible en trading insuficiente');
  END IF;

  -- Restar de trading
  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = NOW()
  WHERE user_id = v_user_id AND coin_symbol = 'USDT';

  -- Sumar a spot
  INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
  VALUES (v_user_id, 'USDT', p_amount)
  ON CONFLICT (user_id, coin_symbol) DO UPDATE SET
    amount = spot_holdings.amount + p_amount,
    updated_at = NOW();

  INSERT INTO public.wallet_transfers (
    user_id, type, from_coin, to_coin, from_amount, to_amount
  ) VALUES (
    v_user_id, 'trading_to_spot', 'USDT', 'USDT', p_amount, p_amount
  );

  RETURN jsonb_build_object('success', true, 'amount', p_amount);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_trading_to_spot TO authenticated;

-- ============================================================================
-- 9. Agregar comisión de conversión a motor_settings
-- ============================================================================
ALTER TABLE public.motor_settings
  ADD COLUMN IF NOT EXISTS convert_fee_percent NUMERIC(6, 4) NOT NULL DEFAULT 0.1;

-- ============================================================================
-- 10. Modificar approve_transaction para aceptar destino (spot|trading)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_transaction(
  p_transaction_id UUID,
  p_action TEXT,
  p_destination TEXT DEFAULT 'trading'  -- 'spot' | 'trading'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_role TEXT;
  v_tx RECORD;
  v_balance RECORD;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = v_actor_id;
  IF v_actor_role NOT IN ('admin', 'super_admin') THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('error', 'Acción inválida');
  END IF;

  IF p_destination NOT IN ('spot', 'trading') THEN
    RETURN jsonb_build_object('error', 'Destino inválido (debe ser spot o trading)');
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
    SET status = 'rejected', approved_by = v_actor_id, approved_at = NOW()
    WHERE id = p_transaction_id;
    RETURN jsonb_build_object('success', true, 'action', 'rejected');
  END IF;

  -- APPROVE
  IF v_tx.type = 'deposit' THEN
    -- Si admin normal, descontar de su saldo
    IF v_actor_role = 'admin' THEN
      SELECT * INTO v_balance FROM public.admin_balances WHERE admin_id = v_actor_id;
      IF v_balance IS NULL OR v_balance.available < v_tx.amount THEN
        RETURN jsonb_build_object(
          'error',
          'Saldo insuficiente. Tenés ' || COALESCE(v_balance.available::TEXT, '0') ||
          ' USDT. Pedile más al super admin.'
        );
      END IF;

      UPDATE public.admin_balances
      SET total_spent = total_spent + v_tx.amount, updated_at = NOW()
      WHERE admin_id = v_actor_id;

      INSERT INTO public.admin_balance_movements (
        admin_id, type, amount, target_user_id, transaction_id, performed_by, notes
      ) VALUES (
        v_actor_id, 'transfer', -v_tx.amount, v_tx.user_id, v_tx.id, v_actor_id,
        'Depósito aprobado a wallet ' || p_destination
      );
    END IF;

    -- Acreditar en la wallet de destino
    IF p_destination = 'spot' THEN
      INSERT INTO public.spot_holdings (user_id, coin_symbol, amount)
      VALUES (v_tx.user_id, 'USDT', v_tx.amount)
      ON CONFLICT (user_id, coin_symbol) DO UPDATE SET
        amount = spot_holdings.amount + v_tx.amount,
        updated_at = NOW();
    ELSE
      -- trading
      INSERT INTO public.wallets (user_id, coin_symbol, balance)
      VALUES (v_tx.user_id, 'USDT', 0)
      ON CONFLICT (user_id, coin_symbol) DO NOTHING;

      UPDATE public.wallets
      SET balance = balance + v_tx.amount, updated_at = NOW()
      WHERE user_id = v_tx.user_id AND coin_symbol = 'USDT';
    END IF;

  ELSIF v_tx.type = 'withdrawal' THEN
    -- Retiro: ya tiene saldo lockeado
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

  RETURN jsonb_build_object('success', true, 'action', 'approved', 'destination', p_destination);
END;
$$;
GRANT EXECUTE ON FUNCTION public.approve_transaction TO authenticated;

-- ============================================================================
-- 11. Inicializar precios spot por defecto (copiar de current_price)
-- ============================================================================
-- Por defecto los precios spot son NULL (se calculan del current_price).
-- Sin embargo, queremos asegurar que spot_enabled está activo por defecto.
UPDATE public.coins
SET spot_enabled = TRUE
WHERE spot_enabled IS NULL;

-- ============================================================================
-- FIN
-- ============================================================================
-- Después de correr esto:
-- 1. La estructura para Spot, Trading separadas ya existe
-- 2. Trading sigue funcionando con la tabla `wallets` igual que antes
-- 3. Los nuevos depósitos pueden ir a Spot o Trading (admin elige)
-- 4. Existen RPCs para convertir entre monedas (spot_convert)
-- 5. Existen RPCs para transferir entre wallets
-- 6. Los tres pasos siguientes (UI, Convert UI, Earn) construyen sobre esto
-- ============================================================================
