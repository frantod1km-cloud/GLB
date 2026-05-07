"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowUpFromLine, Check, Loader2, AlertCircle } from "lucide-react";
import { requestWithdrawalAction } from "@/app/actions/wallet";
import { formatUSDT } from "@/lib/utils";

interface WithdrawDialogProps {
  availableBalance: number;
  minAmount: number;
  maxAmount: number;
}

export function WithdrawDialog({
  availableBalance,
  minAmount,
  maxAmount,
}: WithdrawDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestWithdrawalAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
        }, 1800);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full">
          <ArrowUpFromLine className="w-4 h-4" />
          Retirar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retirar USDT</DialogTitle>
          <DialogDescription>
            Disponible: {formatUSDT(availableBalance)} USDT — Mínimo {minAmount} USDT
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center py-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Check className="w-6 h-6 text-primary" />
            </div>
            <p className="font-medium">¡Solicitud enviada!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Vas a recibir una notificación cuando se procese.
            </p>
          </div>
        ) : (
          <form action={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Monto (USDT)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min={minAmount}
                max={Math.min(maxAmount, availableBalance)}
                placeholder={`${minAmount} - ${formatUSDT(Math.min(maxAmount, availableBalance))}`}
                required
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="user_wallet">Dirección de retiro</Label>
              <Input
                id="user_wallet"
                name="user_wallet"
                type="text"
                placeholder="0x... o tu wallet de destino"
                required
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Es educativo: la dirección no se usa realmente, pero igual la pedimos
                para simular el flujo real.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  "Solicitar retiro"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
