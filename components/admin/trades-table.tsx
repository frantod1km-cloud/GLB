"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TrendingUp, TrendingDown, X, Loader2 } from "lucide-react";
import { adminCloseTradeAction } from "@/app/actions/trades";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface AdminTradesTableProps {
  trades: any[];
}

export function AdminTradesTable({ trades }: AdminTradesTableProps) {
  const router = useRouter();
  const [closeId, setCloseId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (!closeId) return;
    setError(null);
    startTransition(async () => {
      const r = await adminCloseTradeAction(closeId);
      if (r.error) setError(r.error);
      else {
        setCloseId(null);
        router.refresh();
      }
    });
  }

  if (trades.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-12 text-center text-sm text-muted-foreground">
        No hay operaciones para mostrar
      </div>
    );
  }

  return (
    <>
      <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="divide-y divide-border/40">
          {trades.map((trade: any) => {
            const isLong = trade.direction === "long";
            const isOpen = trade.status === "open";
            const pnl = Number(trade.pnl || 0);
            const isProfit = pnl >= 0;

            return (
              <div key={trade.id} className="p-4 hover:bg-muted/10 transition-colors">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {trade.profiles?.full_name || trade.profiles?.email}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {trade.profiles?.email}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap mt-1.5">
                      <span className="font-mono text-xs">
                        {trade.coins?.symbol || "?"}
                      </span>
                      <Badge variant={isLong ? "default" : "destructive"}>
                        {isLong ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {isLong ? "LONG" : "SHORT"}
                      </Badge>
                      <Badge variant="secondary">{trade.leverage}x</Badge>
                      {isOpen ? (
                        <Badge variant="success">Abierta</Badge>
                      ) : (
                        <Badge variant="secondary">Cerrada</Badge>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatUSDT(Number(trade.amount))} USDT
                      </span>
                    </div>

                    <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-3">
                      <span>
                        Entrada:{" "}
                        <span className="font-mono">
                          {formatPrice(
                            Number(trade.entry_price),
                            trade.coins?.decimals || 4
                          )}
                        </span>
                      </span>
                      {trade.exit_price && (
                        <span>
                          Salida:{" "}
                          <span className="font-mono">
                            {formatPrice(
                              Number(trade.exit_price),
                              trade.coins?.decimals || 4
                            )}
                          </span>
                        </span>
                      )}
                      <span>
                        {new Date(trade.opened_at).toLocaleString("es-AR")}
                      </span>
                      {trade.close_reason && (
                        <span>
                          Cierre: <strong>{trade.close_reason}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end gap-2">
                    {!isOpen && (
                      <div
                        className={`font-mono font-bold ${
                          isProfit ? "text-primary" : "text-destructive"
                        }`}
                      >
                        {isProfit ? "+" : ""}
                        {formatUSDT(pnl)} USDT
                      </div>
                    )}

                    {isOpen && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCloseId(trade.id)}
                        disabled={isPending}
                      >
                        <X className="w-3.5 h-3.5" />
                        Cerrar
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={!!closeId} onOpenChange={(o) => !o && setCloseId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cerrar esta operación?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Vas a cerrar manualmente esta operación al precio actual del mercado.
            El alumno recibe el PnL correspondiente.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseId(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleClose} disabled={isPending}>
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              Cerrar operación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
