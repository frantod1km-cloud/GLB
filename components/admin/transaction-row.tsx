"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Check,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { TransactionStatusBadge } from "@/components/wallet/transaction-status";
import { formatUSDT } from "@/lib/utils";
import {
  approveTransactionAction,
  rejectTransactionAction,
} from "@/app/actions/wallet";

interface AdminTransactionRowProps {
  tx: any;
  userInfo: { full_name: string | null; email: string };
}

export function AdminTransactionRow({ tx, userInfo }: AdminTransactionRowProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [destination, setDestination] = useState<"spot" | "trading">("spot");
  const [rejectNote, setRejectNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isCredit = tx.type === "deposit";
  const reviewUntil = tx.review_until ? new Date(tx.review_until) : null;
  const expired = reviewUntil ? reviewUntil < new Date() : false;

  function handleApprove() {
    setError(null);
    // Si es deposit, mostrar el modal con selector de destino
    if (tx.type === "deposit") {
      setApproveOpen(true);
      return;
    }
    // Para withdrawal directamente
    startTransition(async () => {
      const r = await approveTransactionAction(tx.id, "trading");
      if (r.error) setError(r.error);
    });
  }

  function handleConfirmApprove() {
    setError(null);
    startTransition(async () => {
      const r = await approveTransactionAction(tx.id, destination);
      if (r.error) setError(r.error);
      else setApproveOpen(false);
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const r = await rejectTransactionAction(tx.id, rejectNote || undefined);
      if (r.error) setError(r.error);
      else setRejectOpen(false);
    });
  }

  return (
    <div className="p-4 hover:bg-muted/20 transition-colors">
      <div className="flex items-start gap-4">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
            isCredit ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
          }`}
        >
          {isCredit ? (
            <ArrowDownToLine className="w-4 h-4" />
          ) : (
            <ArrowUpFromLine className="w-4 h-4" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {tx.type === "deposit" ? "Depósito" : "Retiro"}
            </span>
            <TransactionStatusBadge status={tx.status} />
            {expired && tx.status === "in_review" && (
              <span className="text-xs text-yellow-500">⏰ Plazo vencido</span>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">
              {userInfo.full_name || userInfo.email}
            </span>
            <span className="mx-1.5">•</span>
            <span>{userInfo.email}</span>
          </div>

          <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
            <div>
              Solicitado:{" "}
              {new Date(tx.created_at).toLocaleString("es-AR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
            {reviewUntil && (
              <div>
                Revisar hasta:{" "}
                {reviewUntil.toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
            )}
            {tx.proof_url && (
              <a
                href={tx.proof_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Ver comprobante <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div
            className={`font-bold text-lg ${
              isCredit ? "text-primary" : "text-destructive"
            }`}
          >
            {isCredit ? "+" : "−"} {formatUSDT(Number(tx.amount))} USDT
          </div>

          {(tx.status === "pending" || tx.status === "in_review") && (
            <div className="flex gap-2 mt-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRejectOpen(true)}
                disabled={isPending}
              >
                <X className="w-3.5 h-3.5" />
                Rechazar
              </Button>
              <Button size="sm" onClick={handleApprove} disabled={isPending}>
                <Check className="w-3.5 h-3.5" />
                Aprobar
              </Button>
            </div>
          )}
        </div>
      </div>

      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}

      {/* Modal aprobar deposit con selector de destino */}
      <Dialog
        open={approveOpen}
        onOpenChange={(o) => {
          if (!o) {
            setApproveOpen(false);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar depósito</DialogTitle>
            <DialogDescription>
              Acreditar <strong>{formatUSDT(Number(tx.amount))} USDT</strong> a{" "}
              <strong>{userInfo.full_name || userInfo.email}</strong>. Elegí en qué wallet:
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDestination("spot")}
              disabled={isPending}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                destination === "spot"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              <div className="text-2xl mb-1">💼</div>
              <div className="font-semibold text-sm">Spot</div>
              <div className="text-xs text-muted-foreground mt-1">
                Para convertir, hacer earn, etc.
              </div>
            </button>

            <button
              type="button"
              onClick={() => setDestination("trading")}
              disabled={isPending}
              className={`p-4 rounded-lg border-2 transition-all text-left ${
                destination === "trading"
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/20 hover:bg-muted/40"
              }`}
            >
              <div className="text-2xl mb-1">📈</div>
              <div className="font-semibold text-sm">Trading</div>
              <div className="text-xs text-muted-foreground mt-1">
                Para abrir posiciones long/short
              </div>
            </button>
          </div>

          {error && (
            <div className="text-sm text-destructive mt-2">{error}</div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirmApprove} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Aprobar y acreditar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal rechazar */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Rechazar {tx.type === "deposit" ? "depósito" : "retiro"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Vas a rechazar la solicitud de{" "}
              <strong>{formatUSDT(Number(tx.amount))} USDT</strong> de{" "}
              <strong>{userInfo.full_name || userInfo.email}</strong>.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Motivo (opcional)</label>
              <Input
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Ej: comprobante inválido, datos incorrectos..."
                disabled={isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={isPending}>
              Rechazar solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
