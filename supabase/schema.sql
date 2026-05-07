-- ============================================================================
-- GOLBIT - Schema inicial de base de datos
-- ============================================================================
-- Ejecutar este script completo en Supabase SQL Editor
-- (Project > SQL Editor > New query > pegar todo > Run)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROFILES (extiende auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES public.profiles(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-crear profile al registrarse en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    UPPER(SUBSTRING(MD5(NEW.id::TEXT) FROM 1 FOR 8))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COINS (monedas que crea el admin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  current_price NUMERIC(20, 8) NOT NULL DEFAULT 1.0,
  initial_price NUMERIC(20, 8) NOT NULL DEFAULT 1.0,
  -- Parámetros del algoritmo de precios (GBM sesgado)
  volatility NUMERIC(8, 4) NOT NULL DEFAULT 0.02, -- 0.02 = 2% por tick
  drift_bias NUMERIC(8, 4) NOT NULL DEFAULT 0.0,  -- -1 a 1, sesgo direccional
  tick_seconds INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  decimals INTEGER NOT NULL DEFAULT 4,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PRICE_HISTORY (velas OHLC)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.price_history (
  id BIGSERIAL PRIMARY KEY,
  coin_id UUID NOT NULL REFERENCES public.coins(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '1m', -- 1m, 5m, 15m, 1h, etc.
  open NUMERIC(20, 8) NOT NULL,
  high NUMERIC(20, 8) NOT NULL,
  low NUMERIC(20, 8) NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  volume NUMERIC(20, 8) NOT NULL DEFAULT 0,
  UNIQUE(coin_id, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_price_history_coin_time
  ON public.price_history(coin_id, timeframe, timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. WALLETS (saldo de cada usuario por moneda)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coin_symbol TEXT NOT NULL DEFAULT 'USDT', -- USDT siempre, otras coins se agregan
  balance NUMERIC(20, 8) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(20, 8) NOT NULL DEFAULT 0, -- en operaciones abiertas
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, coin_symbol)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TRANSACTIONS (depósitos/retiros)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'transfer_in', 'transfer_out')),
  amount NUMERIC(20, 8) NOT NULL,
  coin_symbol TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'completed')),
  review_until TIMESTAMPTZ, -- cuándo se libera automáticamente
  notes TEXT,
  processed_by UUID REFERENCES public.profiles(id),
  processed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TRADES (operaciones de trading)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coin_id UUID NOT NULL REFERENCES public.coins(id),
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
  amount NUMERIC(20, 8) NOT NULL, -- monto invertido en USDT
  leverage NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
  entry_price NUMERIC(20, 8) NOT NULL,
  exit_price NUMERIC(20, 8),
  pnl NUMERIC(20, 8), -- profit and loss final en USDT
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  -- Override pre-cargado para esta operación específica
  forced_outcome JSONB, -- { mode: 'win'|'loss'|'pnl', value: number }
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trades_user_status ON public.trades(user_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_user_closed ON public.trades(user_id, closed_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OUTCOME_OVERRIDES (control de resultados global y por usuario)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.outcome_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Si user_id es NULL, aplica a TODOS los usuarios (override global)
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Modo del usuario
  mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (mode IN ('manual', 'low_inv_wins', 'high_inv_loss', 'auto_house')),
  -- Fader -100 (extreme loss) a +100 (extreme profit)
  bias NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (bias >= -100 AND bias <= 100),
  -- Qué umbral usa: 'B' = % del saldo, 'A' = relativo a promedio
  threshold_type TEXT NOT NULL DEFAULT 'B' CHECK (threshold_type IN ('A', 'B')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  active_until TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_user ON public.outcome_overrides(user_id) WHERE is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. MOTOR_SETTINGS (configuración global del motor)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.motor_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  -- Umbrales Opción B (% del saldo)
  threshold_b_low NUMERIC(5, 2) NOT NULL DEFAULT 5,
  threshold_b_high NUMERIC(5, 2) NOT NULL DEFAULT 25,
  -- Umbrales Opción A (% del promedio del usuario)
  threshold_a_low NUMERIC(5, 2) NOT NULL DEFAULT 70,
  threshold_a_high NUMERIC(5, 2) NOT NULL DEFAULT 130,
  -- Casa-gana
  house_max_profit_pool NUMERIC(20, 2) NOT NULL DEFAULT 5000,
  house_current_distributed NUMERIC(20, 2) NOT NULL DEFAULT 0,
  house_reset_period TEXT NOT NULL DEFAULT 'manual', -- manual, daily, weekly, monthly
  house_last_reset TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Ruido (apagado por default según pediste)
  noise_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  noise_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  -- Wallet
  deposit_mode TEXT NOT NULL DEFAULT 'review' CHECK (deposit_mode IN ('free', 'review')),
  deposit_review_hours NUMERIC(6, 2) NOT NULL DEFAULT 1,
  withdrawal_mode TEXT NOT NULL DEFAULT 'review' CHECK (withdrawal_mode IN ('free', 'review')),
  withdrawal_review_hours NUMERIC(6, 2) NOT NULL DEFAULT 24,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.motor_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. NOTIFICATIONS (campanita - se actualiza vía Realtime)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info'
    CHECK (type IN ('info', 'success', 'warning', 'error', 'trade', 'wallet')),
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC) WHERE NOT read;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. REFERRAL_COMMISSIONS (preparado para sistema MLM)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  commission_percent NUMERIC(5, 2) NOT NULL,
  amount NUMERIC(20, 8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motor_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

-- Helper: ¿es admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- PROFILES
CREATE POLICY "Users see own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin all profiles" ON public.profiles
  FOR ALL USING (public.is_admin());

-- COINS - todos pueden leer activas, solo admin escribe
CREATE POLICY "Anyone reads active coins" ON public.coins
  FOR SELECT USING (is_active OR public.is_admin());
CREATE POLICY "Admin manages coins" ON public.coins
  FOR ALL USING (public.is_admin());

-- PRICE_HISTORY - lectura pública
CREATE POLICY "Anyone reads prices" ON public.price_history
  FOR SELECT USING (TRUE);
CREATE POLICY "Admin writes prices" ON public.price_history
  FOR ALL USING (public.is_admin());

-- WALLETS
CREATE POLICY "Users see own wallet" ON public.wallets
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Admin manages wallets" ON public.wallets
  FOR ALL USING (public.is_admin());

-- TRANSACTIONS
CREATE POLICY "Users see own transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users create own transactions" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin manages transactions" ON public.transactions
  FOR ALL USING (public.is_admin());

-- TRADES
CREATE POLICY "Users see own trades" ON public.trades
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "Users create own trades" ON public.trades
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admin manages trades" ON public.trades
  FOR ALL USING (public.is_admin());

-- OUTCOME_OVERRIDES - solo admin
CREATE POLICY "Admin manages overrides" ON public.outcome_overrides
  FOR ALL USING (public.is_admin());

-- MOTOR_SETTINGS - solo admin
CREATE POLICY "Admin manages motor settings" ON public.motor_settings
  FOR ALL USING (public.is_admin());
CREATE POLICY "Anyone reads safe motor fields" ON public.motor_settings
  FOR SELECT USING (TRUE); -- el cliente igual no necesita ver los topes

-- NOTIFICATIONS
CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admin manages notifications" ON public.notifications
  FOR ALL USING (public.is_admin());

-- REFERRAL_COMMISSIONS
CREATE POLICY "Users see own commissions" ON public.referral_commissions
  FOR SELECT USING (auth.uid() = beneficiary_id OR public.is_admin());
CREATE POLICY "Admin manages commissions" ON public.referral_commissions
  FOR ALL USING (public.is_admin());

-- ============================================================================
-- REALTIME (para la campanita y actualizaciones push)
-- ============================================================================
-- Habilitamos solo las tablas que el cliente necesita escuchar
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trades;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;

-- ============================================================================
-- FIN DEL SCHEMA INICIAL
-- ============================================================================
-- Después de correr esto, creá tu usuario admin:
-- 1. Registrate en la app con tu email
-- 2. En Supabase SQL Editor corré:
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'tu@email.com';
-- ============================================================================
