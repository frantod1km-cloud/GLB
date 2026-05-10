import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConvertView } from "@/components/convert/convert-view";
import { ConvertHistory } from "@/components/convert/convert-history";

export const dynamic = "force-dynamic";

export default async function ConvertPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [coinsRes, holdingsRes, transfersRes, settingsRes] = await Promise.all([
    admin
      .from("coins")
      .select(
        "symbol, current_price, decimals, spread_percent, spot_buy_price, spot_sell_price, spot_enabled"
      )
      .eq("is_active", true)
      .eq("spot_enabled", true)
      .order("symbol"),
    supabase
      .from("spot_holdings")
      .select("coin_symbol, amount")
      .eq("user_id", user.id),
    supabase
      .from("wallet_transfers")
      .select("*")
      .eq("user_id", user.id)
      .eq("type", "convert")
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("motor_settings").select("convert_fee_percent").eq("id", 1).single(),
  ]);

  // Convertir las monedas a CoinOption
  const coins = (coinsRes.data || []).map((c: any) => {
    const cp = Number(c.current_price);
    const sp = Number(c.spread_percent || 0);
    const buy_price =
      c.spot_buy_price !== null ? Number(c.spot_buy_price) : cp * (1 + sp / 200);
    const sell_price =
      c.spot_sell_price !== null ? Number(c.spot_sell_price) : cp * (1 - sp / 200);

    return {
      symbol: c.symbol,
      buy_price,
      sell_price,
      decimals: c.decimals || 4,
      spot_enabled: c.spot_enabled !== false,
    };
  });

  // Agregar USDT como opción siempre disponible
  if (!coins.some((c) => c.symbol === "USDT")) {
    coins.unshift({
      symbol: "USDT",
      buy_price: 1,
      sell_price: 1,
      decimals: 2,
      spot_enabled: true,
    });
  }

  // Holdings como mapa
  const holdings: Record<string, number> = {};
  for (const h of holdingsRes.data || []) {
    holdings[h.coin_symbol] = Number(h.amount || 0);
  }

  const feePercent = Number(settingsRes.data?.convert_fee_percent || 0.1);

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Convertir</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cambiá tus monedas Spot al instante
        </p>
      </div>

      <ConvertView
        userId={user.id}
        initialCoins={coins}
        initialHoldings={holdings}
        feePercent={feePercent}
      />

      <div>
        <h2 className="text-lg font-semibold mb-3">Historial</h2>
        <ConvertHistory
          userId={user.id}
          initialTransfers={transfersRes.data || []}
        />
      </div>
    </div>
  );
}
