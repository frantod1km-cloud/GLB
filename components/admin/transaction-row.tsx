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
} from "@/components/ui/dialog";
import { Check, X, ArrowDownToLine, ArrowUpFromLine, ExternalLink } from "lucide-react";
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
  const [rejectNote, setRejectNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isCredit = tx.type === "deposit";
  const reviewUntil = tx.review_until ? new Date(tx.review_until) : null;
  const expired = reviewUntil ? reviewUntil < new Date() : false;

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const r = await approveTransactionAction(tx.id);
      if (r.error) setError(r.error);
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
          {isCredit ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
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

          <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
            <div>Solicitado: {new Date(tx.created_at).toLocaleString("es-AR")}</div>
            {reviewUntil && tx.status === "in_review" && (
              <div>
                Revisar hasta: {reviewUntil.toLocaleString("es-AR")}
              </div>
            )}
            {tx.user_wallet && (
              <div className="font-mono text-xs">
                Wallet destino: {tx.user_wallet}
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

      {error && (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar {tx.type === "deposit" ? "depósito" : "retiro"}</DialogTitle>
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
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={isPending}>
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
