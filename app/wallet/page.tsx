import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardNav } from "@/components/dashboard/nav";
import { WalletView } from "@/components/wallet/wallet-view";
import { TransactionsList } from "@/components/wallet/transactions-list";

export const dynamic = "force-dynamic";

export default async function WalletPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, referral_code")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login");

  const admin = createAdminClient();

  const [holdingsRes, walletRes, coinsRes, txRes, settingsRes] = await Promise.all([
    supabase.from("spot_holdings").select("*").eq("user_id", user.id),
    supabase
      .from("wallets")
      .select("balance, locked_balance")
      .eq("user_id", user.id)
      .eq("coin_symbol", "USDT")
      .single(),
    admin
      .from("coins")
      .select(
        "symbol, current_price, decimals, spread_percent, spot_buy_price, spot_sell_price"
      )
      .eq("is_active", true),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("motor_settings").select("*").eq("id", 1).single(),
  ]);

  const coinPrices: Record<string, { sell: number; buy: number; decimals: number }> = {};
  for (const c of coinsRes.data || []) {
    const cp = Number(c.current_price);
    const sp = Number(c.spread_percent || 0);
    const sell = c.spot_sell_price !== null ? Number(c.spot_sell_price) : cp * (1 - sp / 200);
    const buy = c.spot_buy_price !== null ? Number(c.spot_buy_price) : cp * (1 + sp / 200);
    coinPrices[c.symbol] = { sell, buy, decimals: c.decimals || 4 };
  }

  const settings = settingsRes.data || {};

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav profile={profile} />
      <main className="container py-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Gestioná tus saldos de Spot y Trading
          </p>
        </div>

        <WalletView
          userId={user.id}
          initialSpotHoldings={holdingsRes.data || []}
          initialTradingBalance={Number(walletRes.data?.balance || 0)}
          initialLockedBalance={Number(walletRes.data?.locked_balance || 0)}
          coinPrices={coinPrices}
          depositSettings={{
            uiMode: settings.deposit_ui_mode || "simple",
            walletAddress: settings.deposit_address || "",
            minAmount: Number(settings.deposit_min || 10),
            maxAmount: Number(settings.deposit_max || 100000),
          }}
        />

        <div>
          <h2 className="text-lg font-semibold mb-3">Movimientos recientes</h2>
          <TransactionsList transactions={txRes.data || []} />
        </div>
      </main>
    </div>
  );
}
