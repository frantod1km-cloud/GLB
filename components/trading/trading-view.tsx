"use client";

import { useState } from "react";
import { PriceChart } from "@/components/charts/price-chart";
import { calculateBidAsk } from "@/lib/price-engine";
import { formatPrice } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradingViewProps {
  coin: any;
  initialPrice: number;
}

const TIMEFRAMES = [
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
] as const;

export function TradingView({ coin, initialPrice }: TradingViewProps) {
  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h">("1m");
  const [price, setPrice] = useState<number>(initialPrice);

  const params = {
    current_price: initialPrice,
    volatility: Number(coin.volatility),
    drift_bias: Number(coin.drift_bias),
    spread_percent: Number(coin.spread_percent),
    decimals: coin.decimals,
    tick_seconds: coin.tick_seconds,
  };

  const { bid, ask } = calculateBidAsk(price, Number(coin.spread_percent));
  const change = price - initialPrice;
  const changePct = initialPrice > 0 ? (change / initialPrice) * 100 : 0;
  const isUp = changePct >= 0;

  return (
    <div className="space-y-4">
      {/* Header con info de precio */}
      <div className="bg-card border border-border/60 rounded-lg p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
              {coin.symbol.split("/")[0].slice(0, 3)}
            </div>
            <div>
              <div className="font-bold text-xl font-mono">{coin.symbol}</div>
              <div className="text-xs text-muted-foreground">{coin.name}</div>
            </div>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground">Último precio</div>
              <div className="text-2xl font-bold font-mono">
                {formatPrice(price, coin.decimals)}
              </div>
            </div>

            <div>
              <div className="text-xs text-muted-foreground">Cambio (sesión)</div>
              <div
                className={`flex items-center gap-1 font-semibold ${
                  isUp ? "text-primary" : "text-destructive"
                }`}
              >
                {isUp ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                {isUp ? "+" : ""}
                {change.toFixed(coin.decimals)} ({changePct.toFixed(2)}%)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
              <div className="text-xs text-muted-foreground">Bid (venta)</div>
              <div className="text-xs text-muted-foreground">Ask (compra)</div>
              <div className="font-mono text-destructive">
                {formatPrice(bid, coin.decimals)}
              </div>
              <div className="font-mono text-primary">
                {formatPrice(ask, coin.decimals)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Selector de timeframe */}
      <div className="flex gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.id}
            onClick={() => setTimeframe(tf.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              timeframe === tf.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* Gráfico */}
      <div className="bg-card border border-border/60 rounded-lg p-3">
        <PriceChart
          coinId={coin.id}
          symbol={coin.symbol}
          initialParams={params}
          timeframe={timeframe}
          height={500}
          onPriceUpdate={setPrice}
        />
      </div>
    </div>
  );
}
