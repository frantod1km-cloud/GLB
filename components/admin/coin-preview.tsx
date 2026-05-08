"use client";

import { useState } from "react";
import { PriceChart } from "@/components/charts/price-chart";
import { formatPrice } from "@/lib/utils";
import { calculateBidAsk } from "@/lib/price-engine";

const TIMEFRAMES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
] as const;

export function CoinPreview({ coin }: { coin: any }) {
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h">("1m");
  const [price, setPrice] = useState<number>(Number(coin.current_price));

  const params = {
    current_price: Number(coin.current_price),
    volatility: Number(coin.volatility),
    drift_bias: Number(coin.drift_bias),
    spread_percent: Number(coin.spread_percent),
    decimals: coin.decimals,
    tick_seconds: coin.tick_seconds,
  };

  const { bid, ask } = calculateBidAsk(price, Number(coin.spread_percent));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                timeframe === tf.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Bid: </span>
            <span className="font-mono text-destructive">{formatPrice(bid, coin.decimals)}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Ask: </span>
            <span className="font-mono text-primary">{formatPrice(ask, coin.decimals)}</span>
          </div>
          <div>
            <span className="text-muted-foreground text-xs">Last: </span>
            <span className="font-mono font-bold">{formatPrice(price, coin.decimals)}</span>
          </div>
        </div>
      </div>

      <PriceChart
        coinId={coin.id}
        symbol={coin.symbol}
        initialParams={params}
        timeframe={timeframe}
        height={350}
        onPriceUpdate={setPrice}
      />

      <p className="text-xs text-muted-foreground">
        💡 El motor corre en el servidor 24/7 (1 tick/segundo). Todos los usuarios
        ven exactamente lo mismo. Cambia los parámetros abajo y guarda para ver el efecto.
      </p>
    </div>
  );
}
