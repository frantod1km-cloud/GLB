import { createClient } from "@/lib/supabase/server";
import { Activity } from "lucide-react";
import { CoinsListClient } from "@/components/trading/coins-list-client";

export const dynamic = "force-dynamic";

export default async function TradingPage() {
  const supabase = createClient();

  const { data: coins } = await supabase
    .from("coins")
    .select("*")
    .eq("is_active", true)
    .order("symbol", { ascending: true });

  // Cargar sparklines iniciales
  const initialSparks: Record<string, number[]> = {};
  if (coins && coins.length > 0) {
    for (const coin of coins) {
      const { data: rows } = await supabase
        .from("price_history")
        .select("close")
        .eq("coin_id", coin.id)
        .eq("timeframe", "1m")
        .order("timestamp", { ascending: false })
        .limit(30);

      initialSparks[coin.id] = (rows || [])
        .map((r: any) => Number(r.close))
        .reverse();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Trading</h1>
        <p className="text-muted-foreground mt-1">
          Elegí una moneda para ver el gráfico y operar
        </p>
      </div>

      {!coins || coins.length === 0 ? (
        <div className="text-center py-16 px-6 border-2 border-dashed border-border/40 rounded-lg">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Activity className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No hay monedas disponibles</h3>
          <p className="text-sm text-muted-foreground">
            Tu instructor aún no creó ninguna moneda activa para operar.
          </p>
        </div>
      ) : (
        <CoinsListClient coins={coins} initialSparks={initialSparks} />
      )}
    </div>
  );
}
