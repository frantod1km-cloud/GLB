"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/utils";
import { symbolToSlug } from "@/lib/coin-slug";
import { Sparkline } from "@/components/charts/sparkline";

interface CoinsListClientProps {
  coins: any[];
  initialSparks: Record<string, number[]>;
}

const MAX_SPARK_POINTS = 30;

export function CoinsListClient({ coins: initialCoins, initialSparks }: CoinsListClientProps) {
  const [coins, setCoins] = useState(initialCoins);
  const [sparks, setSparks] = useState<Record<string, number[]>>(initialSparks);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("coins-list")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "coins" },
        (payload: any) => {
          const updated = payload.new;
          if (!updated?.id) return;

          // Actualizar precio de la coin
          setCoins((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, current_price: updated.current_price, last_tick_at: updated.last_tick_at }
                : c
            )
          );

          // Agregar el nuevo precio al sparkline (rolling window de N puntos)
          const newPrice = Number(updated.current_price);
          if (newPrice && !isNaN(newPrice)) {
            setSparks((prev) => {
              const existing = prev[updated.id] || [];
              const next = [...existing, newPrice].slice(-MAX_SPARK_POINTS);
              return { ...prev, [updated.id]: next };
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {coins.map((coin) => {
        const data = sparks[coin.id] || [];
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
                  <div className="font-semibold font-mono text-sm">{coin.symbol}</div>
                  <div className="text-xs text-muted-foreground truncate">{coin.name}</div>
                </div>
              </div>
              <div
                className={`flex items-center gap-0.5 text-xs font-semibold flex-shrink-0 ${
                  isUp ? "text-primary" : "text-destructive"
                }`}
              >
                {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {isUp ? "+" : ""}
                {changePct.toFixed(2)}%
              </div>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Precio</div>
                <div className="font-bold text-2xl font-mono transition-all">
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
  );
}
