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
import { ArrowDownToLine, Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { requestDepositAction } from "@/app/actions/wallet";

interface DepositDialogProps {
  uiMode: "simple" | "proof" | "wallet";
  walletAddress: string;
  minAmount: number;
  maxAmount: number;
}

export function DepositDialog({
  uiMode,
  walletAddress,
  minAmount,
  maxAmount,
}: DepositDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestDepositAction(formData);
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

  function copyAddress() {
    navigator.clipboard.writeText(walletAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          <ArrowDownToLine className="w-4 h-4" />
          Depositar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Depositar USDT</DialogTitle>
          <DialogDescription>
            Mínimo {minAmount} USDT — Máximo {maxAmount} USDT
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
            {uiMode === "wallet" && (
              <div className="rounded-md bg-muted/50 border border-border/40 p-4 space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Enviá USDT a esta dirección:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded text-xs font-mono break-all">
                      {walletAddress}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={copyAddress}
                    >
                      {copiedAddr ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tu depósito será procesado por nuestro equipo dentro de las próximas 24hs.
                  Una vez "enviado", solicitá el depósito abajo.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="amount">Monto (USDT)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min={minAmount}
                max={maxAmount}
                placeholder={`${minAmount} - ${maxAmount}`}
                required
                disabled={isPending}
              />
            </div>

            {uiMode === "proof" && (
              <div className="space-y-2">
                <Label htmlFor="proof_url">URL del comprobante (opcional)</Label>
                <Input
                  id="proof_url"
                  name="proof_url"
                  type="url"
                  placeholder="https://imgur.com/..."
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Pegá la URL pública del comprobante (Imgur, Drive, etc.)
                </p>
              </div>
            )}

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
                  "Solicitar depósito"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
