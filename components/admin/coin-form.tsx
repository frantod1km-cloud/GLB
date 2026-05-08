"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, AlertCircle, Coins } from "lucide-react";
import { createCoinAction, updateCoinAction } from "@/app/actions/coins";

interface CoinFormProps {
  initial?: any; // si viene, es modo edición
  onSuccess?: () => void;
}

export function CoinForm({ initial, onSuccess }: CoinFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState<boolean>(initial?.is_active ?? true);
  const [isPending, startTransition] = useTransition();

  const isEdit = !!initial;

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("is_active", isActive ? "on" : "off");

    startTransition(async () => {
      const result = isEdit
        ? await updateCoinAction(initial.id, formData)
        : await createCoinAction(formData);

      if (result.error) {
        setError(result.error);
      } else {
        if (onSuccess) onSuccess();
        else router.push("/admin/coins");
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      <div className="bg-card border border-border/60 rounded-lg p-6 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Coins className="w-4 h-4" />
          Información básica
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">Símbolo *</Label>
            <Input
              id="symbol"
              name="symbol"
              placeholder="GLB/USDT"
              defaultValue={initial?.symbol}
              disabled={isEdit || isPending}
              required
              className="uppercase font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Formato BASE/QUOTE — ej: GLB/USDT, FAKE-BTC/USDT
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nombre completo *</Label>
            <Input
              id="name"
              name="name"
              placeholder="Golbit Token"
              defaultValue={initial?.name}
              disabled={isPending}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Descripción</Label>
          <Input
            id="description"
            name="description"
            placeholder="Token nativo de Golbit"
            defaultValue={initial?.description}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-lg p-6 space-y-4">
        <h3 className="font-semibold">📈 Algoritmo de precio</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="initial_price">Precio inicial *</Label>
            <Input
              id="initial_price"
              name="initial_price"
              type="number"
              step="any"
              defaultValue={initial?.current_price ?? "1"}
              disabled={isEdit || isPending}
              required
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? "Para cambiar usá 'Forzar precio'" : "El precio en el momento de creación"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="decimals">Decimales</Label>
            <Input
              id="decimals"
              name="decimals"
              type="number"
              min="0"
              max="8"
              defaultValue={initial?.decimals ?? 4}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">Cantidad de decimales a mostrar</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="volatility">Volatilidad (0–1)</Label>
            <Input
              id="volatility"
              name="volatility"
              type="number"
              step="0.001"
              min="0"
              max="1"
              defaultValue={initial?.volatility ?? "0.02"}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              0.02 = ±2% por tick. Más alto = más loco
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="drift_bias">Drift / Sesgo (-1 a 1)</Label>
            <Input
              id="drift_bias"
              name="drift_bias"
              type="number"
              step="0.01"
              min="-1"
              max="1"
              defaultValue={initial?.drift_bias ?? "0"}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Negativo = baja, 0 = neutro, positivo = sube
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tick_seconds">Segundos por tick</Label>
            <Input
              id="tick_seconds"
              name="tick_seconds"
              type="number"
              min="1"
              max="60"
              defaultValue={initial?.tick_seconds ?? 5}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">Frecuencia de actualización</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="spread_percent">Spread (%)</Label>
            <Input
              id="spread_percent"
              name="spread_percent"
              type="number"
              step="0.01"
              min="0"
              max="5"
              defaultValue={initial?.spread_percent ?? "0.10"}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Diferencia entre compra/venta (0.10 = 0.10%)
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="is_active" className="text-base">
              Moneda activa
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Solo las activas son visibles para los usuarios
            </p>
          </div>
          <Switch id="is_active" checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Guardando...
            </>
          ) : isEdit ? (
            "Guardar cambios"
          ) : (
            "Crear moneda"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
