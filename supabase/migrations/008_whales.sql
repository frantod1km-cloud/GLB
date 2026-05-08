-- ============================================================================
-- GOLBIT - Migración 008: Whales (Paso 7.1)
-- ============================================================================
-- Whales son cuentas controladas por el admin que pueden abrir trades reales.
-- Sus trades empujan el precio del mercado vía "presión".
-- ============================================================================

-- 1. Permitir el nuevo role 'whale' en profiles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('student', 'admin', 'whale', 'bot'));

-- 2. Liquidez de mercado por moneda (cuánto mueve cada whale)
ALTER TABLE public.coins
  ADD COLUMN IF NOT EXISTS market_liquidity NUMERIC(20, 2) NOT NULL DEFAULT 100000;
-- 100000 USDT default: una compra de 1000 USDT mueve ~1% el precio en su tick

-- 3. Helper: ¿es whale?
CREATE OR REPLACE FUNCTION public.is_whale(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_user_id AND role = 'whale');
$$;

-- ============================================================================
-- 4. Modificar tick_all_active_coins para aplicar presión de whales
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
  v_whale_pressure NUMERIC;
  v_whale_long_size NUMERIC;
  v_whale_short_size NUMERIC;
  v_pressure_factor NUMERIC := 0;
BEGIN
  v_minute := date_trunc('minute', v_ts);
  v_5min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 5) * INTERVAL '5 minute');
  v_15min := date_trunc('hour', v_ts) + ((EXTRACT(MINUTE FROM v_ts)::INT / 15) * INTERVAL '15 minute');
  v_hour := date_trunc('hour', v_ts);

  FOR v_coin IN SELECT * FROM public.coins WHERE is_active = TRUE LOOP
    v_drift := v_coin.drift_bias / 1000;
    v_z := (random() + random() + random() + random() + random() + random() - 3) / 1.732;

    -- ============================================================
    -- NUEVO: Calcular presión de whales abiertas en esta moneda
    -- ============================================================
    SELECT
      COALESCE(SUM(CASE WHEN t.direction = 'long' THEN t.amount * t.leverage ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN t.direction = 'short' THEN t.amount * t.leverage ELSE 0 END), 0)
    INTO v_whale_long_size, v_whale_short_size
    FROM public.trades t
    JOIN public.profiles p ON p.id = t.user_id
    WHERE t.coin_id = v_coin.id
      AND t.status = 'open'
      AND p.role = 'whale';

    -- Presión neta como fracción de la liquidez
    -- positive → empuja precio hacia arriba, negativo → hacia abajo
    v_whale_pressure := (v_whale_long_size - v_whale_short_size);

    IF v_coin.market_liquidity > 0 THEN
      -- Factor: cap al 5% por tick para evitar saltos absurdos
      v_pressure_factor := LEAST(
        GREATEST(v_whale_pressure / v_coin.market_liquidity * 0.01, -0.05),
        0.05
      );
    END IF;

    -- Aplicar precio: GBM normal + presión
    v_new_price := v_coin.current_price * EXP(v_drift + v_coin.volatility * v_z + v_pressure_factor);

    -- Limitar saltos extremos
    v_new_price := GREATEST(v_new_price, v_coin.current_price * 0.5);
    v_new_price := LEAST(v_new_price, v_coin.current_price * 2.0);

    UPDATE public.coins
    SET current_price = v_new_price, last_tick_at = v_ts, updated_at = v_ts
    WHERE id = v_coin.id;

    -- Velas (igual que antes)
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
-- 5. RPC: Crear whale (admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_create_whale(
  p_email TEXT,
  p_full_name TEXT,
  p_initial_balance NUMERIC DEFAULT 100000
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_whale_id UUID;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins pueden crear whales');
  END IF;

  -- La whale necesita estar en auth.users primero
  -- Pero NO podemos crear usuarios en auth desde una función SQL.
  -- Esta función la llamamos DESPUÉS de crear el usuario via supabase.auth.admin.createUser
  -- y nos pasan el ID resultante.

  -- Esta versión es para convertir un usuario existente (creado por admin SDK) en whale
  RETURN jsonb_build_object('error', 'Esta funcion no debe llamarse directamente, usa server action createWhaleAction');
END;
$$;

-- En realidad la creación se hace desde el server action con admin SDK.
-- Esta función la dejamos como placeholder por compatibilidad.

-- ============================================================================
-- 6. RPC: Cargar saldo a una whale
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_set_whale_balance(
  p_whale_id UUID,
  p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_is_whale BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = p_whale_id AND role = 'whale')
    INTO v_is_whale;
  IF NOT v_is_whale THEN
    RETURN jsonb_build_object('error', 'El usuario no es una whale');
  END IF;

  IF p_amount < 0 THEN
    RETURN jsonb_build_object('error', 'El saldo no puede ser negativo');
  END IF;

  -- Asegurar wallet existe
  INSERT INTO public.wallets (user_id, coin_symbol, balance)
  VALUES (p_whale_id, 'USDT', 0)
  ON CONFLICT (user_id, coin_symbol) DO NOTHING;

  -- Setear directamente al monto (no es ajuste relativo, es absoluto)
  UPDATE public.wallets
  SET balance = p_amount, updated_at = NOW()
  WHERE user_id = p_whale_id AND coin_symbol = 'USDT';

  RETURN jsonb_build_object('success', true, 'balance', p_amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_whale_balance TO authenticated;

-- ============================================================================
-- 7. RPC: Comando masivo - PUMP o DUMP con todas las whales activas en una moneda
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_whale_command(
  p_coin_id UUID,
  p_command TEXT,  -- 'pump', 'dump', 'stop'
  p_total_amount NUMERIC DEFAULT 0,
  p_leverage NUMERIC DEFAULT 5
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_whale RECORD;
  v_whales_count INTEGER;
  v_amount_per_whale NUMERIC;
  v_direction TEXT;
  v_coin RECORD;
  v_executed INTEGER := 0;
  v_skipped INTEGER := 0;
  v_trade_id UUID;
  v_entry_price NUMERIC;
  v_liq_price NUMERIC;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin')
    INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Solo admins');
  END IF;

  IF p_command NOT IN ('pump', 'dump', 'stop') THEN
    RETURN jsonb_build_object('error', 'Comando invalido');
  END IF;

  SELECT * INTO v_coin FROM public.coins WHERE id = p_coin_id AND is_active;
  IF v_coin IS NULL THEN
    RETURN jsonb_build_object('error', 'Moneda no encontrada o inactiva');
  END IF;

  -- STOP: cerrar todas las posiciones abiertas de whales en esta moneda
  IF p_command = 'stop' THEN
    FOR v_whale IN
      SELECT t.id AS trade_id, t.user_id
      FROM public.trades t
      JOIN public.profiles p ON p.id = t.user_id
      WHERE t.coin_id = p_coin_id
        AND t.status = 'open'
        AND p.role = 'whale'
    LOOP
      -- Cerrar el trade (sin pasar por close_trade RPC porque requiere auth.uid del owner)
      DECLARE
        v_t RECORD;
        v_settings RECORD;
        v_pnl NUMERIC;
        v_fee_close NUMERIC;
        v_pnl_net NUMERIC;
        v_return_amount NUMERIC;
        v_exit_price NUMERIC;
      BEGIN
        SELECT * INTO v_t FROM public.trades WHERE id = v_whale.trade_id;
        SELECT * INTO v_settings FROM public.motor_settings WHERE id = 1;

        IF v_t.direction = 'long' THEN
          v_exit_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
        ELSE
          v_exit_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
        END IF;

        v_pnl := public.calc_pnl(v_t.direction, v_t.amount, v_t.leverage, v_t.entry_price, v_exit_price);
        v_fee_close := v_t.amount * v_settings.trade_fee_percent / 100;
        v_pnl_net := v_pnl - v_fee_close;
        v_return_amount := GREATEST(v_t.amount + v_pnl_net, 0);

        UPDATE public.trades
        SET status = 'closed', exit_price = v_exit_price, pnl = v_pnl_net,
            fee_close = v_fee_close, close_reason = 'admin', closed_at = NOW()
        WHERE id = v_t.id;

        UPDATE public.wallets
        SET balance = balance + v_return_amount,
            locked_balance = locked_balance - v_t.amount,
            updated_at = NOW()
        WHERE user_id = v_t.user_id AND coin_symbol = 'USDT';

        v_executed := v_executed + 1;
      END;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'command', 'stop', 'closed', v_executed);
  END IF;

  -- PUMP / DUMP: abrir trades con todas las whales con saldo
  v_direction := CASE WHEN p_command = 'pump' THEN 'long' ELSE 'short' END;

  -- Contar whales con saldo suficiente
  SELECT COUNT(*) INTO v_whales_count
  FROM public.profiles p
  JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
  WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100;

  IF v_whales_count = 0 THEN
    RETURN jsonb_build_object('error', 'No hay whales con saldo disponible');
  END IF;

  IF p_total_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Monto total debe ser mayor a 0');
  END IF;

  v_amount_per_whale := p_total_amount / v_whales_count;

  -- Abrir trades para cada whale
  FOR v_whale IN
    SELECT p.id AS user_id, w.balance
    FROM public.profiles p
    JOIN public.wallets w ON w.user_id = p.id AND w.coin_symbol = 'USDT'
    WHERE p.role = 'whale' AND p.is_active = TRUE AND w.balance > 100
  LOOP
    -- Si esta whale no tiene saldo suficiente, skipear
    IF v_whale.balance < (v_amount_per_whale * 1.01) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Calcular entry price con spread
    IF v_direction = 'long' THEN
      v_entry_price := v_coin.current_price * (1 + v_coin.spread_percent / 200);
    ELSE
      v_entry_price := v_coin.current_price * (1 - v_coin.spread_percent / 200);
    END IF;

    v_liq_price := public.calc_liquidation_price(v_direction, v_entry_price, p_leverage);

    -- Insertar trade
    INSERT INTO public.trades (
      user_id, coin_id, direction, amount, leverage,
      entry_price, liquidation_price, fee_open, status, opened_at
    ) VALUES (
      v_whale.user_id, p_coin_id, v_direction, v_amount_per_whale, p_leverage,
      v_entry_price, v_liq_price, 0, 'open', NOW()
    ) RETURNING id INTO v_trade_id;

    -- Lockear saldo (whales no pagan fee, son la casa)
    UPDATE public.wallets
    SET balance = balance - v_amount_per_whale,
        locked_balance = locked_balance + v_amount_per_whale,
        updated_at = NOW()
    WHERE user_id = v_whale.user_id AND coin_symbol = 'USDT';

    v_executed := v_executed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'command', p_command,
    'whales_executed', v_executed,
    'whales_skipped', v_skipped,
    'amount_per_whale', v_amount_per_whale,
    'leverage', p_leverage
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_whale_command TO authenticated;

-- ============================================================================
-- 8. Vista útil: estadísticas de whales por moneda
-- ============================================================================
CREATE OR REPLACE VIEW public.whale_pressure_view AS
SELECT
  c.id AS coin_id,
  c.symbol,
  COALESCE(SUM(CASE WHEN t.direction = 'long' THEN t.amount * t.leverage ELSE 0 END), 0) AS long_size,
  COALESCE(SUM(CASE WHEN t.direction = 'short' THEN t.amount * t.leverage ELSE 0 END), 0) AS short_size,
  COUNT(t.id) FILTER (WHERE t.status = 'open') AS open_trades_count
FROM public.coins c
LEFT JOIN public.trades t ON t.coin_id = c.id AND t.status = 'open'
LEFT JOIN public.profiles p ON p.id = t.user_id AND p.role = 'whale'
WHERE c.is_active = TRUE
GROUP BY c.id, c.symbol;

-- ============================================================================
-- FIN
-- ============================================================================
