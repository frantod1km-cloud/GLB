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
  DialogDescription,
} from "@/components/ui/dialog";
import { Trash2, TrendingUp, TrendingDown, Loader2, X } from "lucide-react";
import { deleteWhaleTradeAction } from "@/app/actions/whales";
import { closeTradeAction } from "@/app/actions/trades";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface WhaleTradesProps {
  trades: any[];
}

export function WhaleTrades({ trades }: WhaleTradesProps) {
  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!deleteId) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteWhaleTradeAction(deleteId);
      if (r.error) setError(r.error);
      else {
        setDeleteId(null);
        router.refresh();
      }
    });
  }

  function handleClose() {
    if (!closeId) return;
    setError(null);
    startTransition(async () => {
      const r = await closeTradeAction(closeId);
      if (r.error) setError(r.error);
      else {
        setCloseId(null);
        router.refresh();
      }
    });
  }

  if (trades.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
        Esta whale no tiene operaciones todavía
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
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
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
                      <Badge variant="secondary">{trade.close_reason}</Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
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
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteId(trade.id)}
                      disabled={isPending}
                      className="text-destructive hover:text-destructive"
                      title="Borrar del historial"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono mt-2">
                  <Field
                    label="Monto"
                    value={`${formatUSDT(Number(trade.amount))} USDT`}
                  />
                  <Field
                    label="Entrada"
                    value={formatPrice(
                      Number(trade.entry_price),
                      trade.coins?.decimals || 4
                    )}
                  />
                  {trade.exit_price && (
                    <Field
                      label="Salida"
                      value={formatPrice(
                        Number(trade.exit_price),
                        trade.coins?.decimals || 4
                      )}
                    />
                  )}
                  <Field
                    label={isOpen ? "Abierta" : "Cerrada"}
                    value={new Date(
                      isOpen ? trade.opened_at : trade.closed_at
                    ).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  />
                </div>

                {!isOpen && (
                  <div
                    className={`mt-2 pt-2 border-t border-border/40 text-right font-mono font-bold ${
                      isProfit ? "text-primary" : "text-destructive"
                    }`}
                  >
                    PnL: {isProfit ? "+" : ""}
                    {formatUSDT(pnl)} USDT
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmar cerrar */}
      <Dialog open={!!closeId} onOpenChange={(o) => !o && setCloseId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cerrar operación de la whale?</DialogTitle>
            <DialogDescription>
              Cerrar al precio actual de mercado. Libera la presión de la whale.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseId(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleClose} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar borrar */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar este trade del historial?</DialogTitle>
            <DialogDescription>
              {trades.find((t) => t.id === deleteId)?.status === "open"
                ? "Si el trade está abierto, primero se libera el saldo lockeado."
                : "Solo borra el registro del historial. El saldo no se modifica."}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}
