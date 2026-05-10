"use client";

import { useState, useEffect } from "react";
import { ArrowDownUp, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface ConvertHistoryProps {
  userId: string;
  initialTransfers: any[];
}

export function ConvertHistory({ userId, initialTransfers }: ConvertHistoryProps) {
  const [transfers, setTransfers] = useState(initialTransfers);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`convert-history-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transfers",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (payload.new.type === "convert") {
            setTransfers((prev) => [payload.new, ...prev].slice(0, 30));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (transfers.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
        <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm text-muted-foreground">
          Aún no realizaste ninguna conversión
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <div className="divide-y divide-border/40">
        {transfers.map((t: any) => {
          const fromAmt = Number(t.from_amount);
          const toAmt = Number(t.to_amount);
          const fee = Number(t.fee_amount || 0);

          return (
            <div
              key={t.id}
              className="p-4 hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <ArrowDownUp className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {t.from_coin} → {t.to_coin}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(t.created_at).toLocaleString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 text-sm flex-wrap">
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">Entregaste</div>
                  <div className="font-mono">
                    {formatPrice(fromAmt, 6)}{" "}
                    <span className="text-muted-foreground text-xs">
                      {t.from_coin}
                    </span>
                  </div>
                </div>

                <ArrowDownUp className="w-3 h-3 text-muted-foreground rotate-90" />

                <div className="space-y-0.5 text-right">
                  <div className="text-xs text-muted-foreground">Recibiste</div>
                  <div className="font-mono text-primary">
                    {formatPrice(toAmt, 6)}{" "}
                    <span className="text-muted-foreground text-xs">
                      {t.to_coin}
                    </span>
                  </div>
                </div>
              </div>

              {fee > 0 && (
                <div className="text-[10px] text-muted-foreground mt-2 text-right">
                  Comisión: {formatPrice(fee, 6)} {t.fee_coin || t.to_coin}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
