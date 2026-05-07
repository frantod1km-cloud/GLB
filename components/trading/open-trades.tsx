"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, X, Loader2 } from "lucide-react";
import { closeTradeAction } from "@/app/actions/trades";
import { formatPrice, formatUSDT } from "@/lib/utils";
import { calculateBidAsk } from "@/lib/price-engine";

interface OpenTradesProps {
  userId: string;
  coinId: string;
  coin: any;
  currentPrice: number;
}

export function OpenTrades({ userId, coinId, coin, currentPrice: initialPrice }: OpenTradesProps) {
  const [trades, setTrades] = useState<any[]>([]);
  const [currentPrice, setCurrentPrice] = useState(initialPrice);
  const [closing, setClosing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Cargar trades abiertos iniciales y suscribirse a cambios
  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", userId)
        .eq("coin_id", coinId)
        .eq("status", "open")
        .order("opened_at", { ascending: false });

      setTrades(data || []);
    }

    load();

    // Suscribirse a cambios en mis trades para esta moneda
    const channel = supabase
      .channel(`my-trades-${coinId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trades",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          const trade = payload.new || payload.old;
          if (!trade || trade.coin_id !== coinId) return;

          if (payload.eventType === "INSERT" && trade.status === "open") {
            setTrades((prev) => [trade, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            if (trade.status === "open") {
              setTrades((prev) =>
                prev.map((t) => (t.id === trade.id ? trade : t))
              );
            } else {
              setTrades((prev) => prev.filter((t) => t.id !== trade.id));
            }
          } else if (payload.eventType === "DELETE") {
            setTrades((prev) => prev.filter((t) => t.id !== trade.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, coinId]);

  // Suscribirse a cambios de precio para calcular PnL en vivo
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`coin-price-pnl-${coinId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "coins",
          filter: `id=eq.${coinId}`,
        },
        (payload: any) => {
          const newPrice = Number(payload.new?.current_price);
          if (newPrice && !isNaN(newPrice)) setCurrentPrice(newPrice);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coinId]);

  function handleClose(tradeId: string) {
    setClosing(tradeId);
    startTransition(async () => {
      await closeTradeAction(tradeId);
      setClosing(null);
    });
  }

  if (trades.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-6 text-center text-sm text-muted-foreground">
        No tenés operaciones abiertas en {coin.symbol}
      </div>
    );
  }

  const { bid, ask } = calculateBidAsk(currentPrice, Number(coin.spread_percent));

  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border/60">
        <h3 className="font-semibold text-sm">
          Operaciones abiertas ({trades.length})
        </h3>
      </div>

      <div className="divide-y divide-border/40">
        {trades.map((trade) => {
          const isLong = trade.direction === "long";
          // Para PnL: long se cierra a bid, short se cierra a ask
          const exitPrice = isLong ? bid : ask;
          const positionSize = Number(trade.amount) * Number(trade.leverage);
          const pctChange = isLong
            ? (exitPrice - Number(trade.entry_price)) / Number(trade.entry_price)
            : (Number(trade.entry_price) - exitPrice) / Number(trade.entry_price);
          const pnl = positionSize * pctChange;
          const pnlPct = pctChange * 100 * Number(trade.leverage);
          const isProfit = pnl >= 0;

          const isClosingThis = closing === trade.id;

          return (
            <div key={trade.id} className="p-4 hover:bg-muted/10 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={isLong ? "default" : "destructive"}>
                    {isLong ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {isLong ? "LONG" : "SHORT"}
                  </Badge>
                  <Badge variant="secondary">{trade.leverage}x</Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {formatUSDT(Number(trade.amount))} USDT
                  </span>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleClose(trade.id)}
                  disabled={isClosingThis || isPending}
                >
                  {isClosingThis ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <X className="w-3.5 h-3.5" />
                  )}
                  Cerrar
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <Stat
                  label="Entrada"
                  value={formatPrice(Number(trade.entry_price), coin.decimals)}
                />
                <Stat label="Actual" value={formatPrice(exitPrice, coin.decimals)} />
                <Stat
                  label="Liquidación"
                  value={formatPrice(Number(trade.liquidation_price), coin.decimals)}
                  danger
                />
              </div>

              {(trade.stop_loss || trade.take_profit) && (
                <div className="grid grid-cols-2 gap-2 text-xs font-mono mt-2 pt-2 border-t border-border/40">
                  {trade.stop_loss && (
                    <Stat
                      label="🛑 SL"
                      value={formatPrice(Number(trade.stop_loss), coin.decimals)}
                    />
                  )}
                  {trade.take_profit && (
                    <Stat
                      label="🎯 TP"
                      value={formatPrice(Number(trade.take_profit), coin.decimals)}
                    />
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
                <span className="text-xs text-muted-foreground">PnL no realizado</span>
                <div className={`text-right font-mono font-bold ${isProfit ? "text-primary" : "text-destructive"}`}>
                  <div>
                    {isProfit ? "+" : ""}
                    {formatUSDT(pnl)} USDT
                  </div>
                  <div className="text-xs">
                    ({isProfit ? "+" : ""}
                    {pnlPct.toFixed(2)}%)
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div className={danger ? "text-destructive" : ""}>{value}</div>
    </div>
  );
}
