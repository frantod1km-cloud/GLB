import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { symbolToSlug } from "@/lib/coin-slug";
import { Sparkline } from "@/components/charts/sparkline";

export const dynamic = "force-dynamic";

export default async function TradingPage() {
  const supabase = createClient();

  // Solo monedas activas
  const { data: coins } = await supabase
    .from("coins")
    .select("*")
    .eq("is_active", true)
    .order("symbol", { ascending: true });

  // Para cada coin, traer las últimas 30 velas de 1m para sparkline
  const sparkData: Record<string, number[]> = {};
  if (coins && coins.length > 0) {
    for (const coin of coins) {
      const { data: rows } = await supabase
        .from("price_history")
        .select("close")
        .eq("coin_id", coin.id)
        .eq("timeframe", "1m")
        .order("timestamp", { ascending: false })
        .limit(30);

      sparkData[coin.id] = (rows || [])
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {coins.map((coin) => {
            const data = sparkData[coin.id] || [];
            const first = data[0] ?? Number(coin.current_price);
            const last = data[data.length - 1] ?? Number(coin.current_price);
            const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
            const isUp = changePct >= 0;

            return (
              <Link
                key={coin.id}
                href={`/trading/${symbolToSlug(coin.symbol)}`}
                className="group bg-card border border-border/60 rounded-lg p-5 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                      {coin.symbol.split("/")[0].slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold font-mono text-sm">
                        {coin.symbol}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {coin.name}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`flex items-center gap-0.5 text-xs font-semibold flex-shrink-0 ${
                      isUp ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {isUp ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {isUp ? "+" : ""}
                    {changePct.toFixed(2)}%
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Precio</div>
                    <div className="font-bold text-2xl font-mono">
                      {formatPrice(Number(coin.current_price), coin.decimals)}
                    </div>
                  </div>
                  <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                    <Sparkline
                      data={data}
                      width={100}
                      height={36}
                      trend={isUp ? "up" : "down"}
                    />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
