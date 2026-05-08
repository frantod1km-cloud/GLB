"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Pencil, Trash2, TrendingUp, TrendingDown, Activity, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  toggleCoinAction,
  deleteCoinAction,
  forcePriceAction,
} from "@/app/actions/coins";
import { formatPrice } from "@/lib/utils";

interface CoinsListProps {
  coins: any[];
}

export function CoinsList({ coins }: CoinsListProps) {
  const router = useRouter();
  const [forcePriceOpen, setForcePriceOpen] = useState<string | null>(null);
  const [forcePriceValue, setForcePriceValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle(coinId: string, isActive: boolean) {
    startTransition(async () => {
      await toggleCoinAction(coinId, isActive);
      router.refresh();
    });
  }

  function handleForcePrice() {
    if (!forcePriceOpen) return;
    const v = Number(forcePriceValue);
    if (!v || v <= 0) {
      setError("Precio inválido");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await forcePriceAction(forcePriceOpen, v);
      if (r.error) setError(r.error);
      else {
        setForcePriceOpen(null);
        setForcePriceValue("");
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteCoinAction(deleteConfirm);
      if (r.error) setError(r.error);
      else {
        setDeleteConfirm(null);
        router.refresh();
      }
    });
  }

  if (coins.length === 0) {
    return (
      <div className="text-center py-16 px-6 border-2 border-dashed border-border/40 rounded-lg">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
          <Activity className="w-7 h-7 text-muted-foreground" />
        </div>
        <h3 className="font-semibold mb-1">Aún no hay monedas</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Creá la primera moneda para que los usuarios puedan operar
        </p>
        <Button asChild>
          <Link href="/admin/coins/new">+ Crear primera moneda</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {coins.map((coin) => (
          <div
            key={coin.id}
            className="bg-card border border-border/60 rounded-lg p-4 flex items-center gap-4 hover:border-border transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
              {coin.symbol.split("/")[0].slice(0, 3)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold font-mono">{coin.symbol}</span>
                {coin.is_active ? (
                  <Badge variant="success">Activa</Badge>
                ) : (
                  <Badge variant="secondary">Inactiva</Badge>
                )}
                {Number(coin.drift_bias) > 0 && (
                  <Badge variant="default">
                    <TrendingUp className="w-3 h-3" /> Sesgo +{coin.drift_bias}
                  </Badge>
                )}
                {Number(coin.drift_bias) < 0 && (
                  <Badge variant="destructive">
                    <TrendingDown className="w-3 h-3" /> Sesgo {coin.drift_bias}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {coin.name}
                {coin.description && ` • ${coin.description}`}
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>Vol: {coin.volatility}</span>
                <span>Spread: {coin.spread_percent}%</span>
                <span>Tick: {coin.tick_seconds}s</span>
                <span>Decimales: {coin.decimals}</span>
              </div>
            </div>

            <div className="text-right">
              <div className="font-bold font-mono text-lg">
                {formatPrice(Number(coin.current_price), coin.decimals)}
              </div>
              <div className="text-xs text-muted-foreground">USDT</div>
            </div>

            <div className="flex items-center gap-1">
              <Switch
                checked={coin.is_active}
                onCheckedChange={(v) => handleToggle(coin.id, v)}
                disabled={isPending}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setForcePriceOpen(coin.id)}
                title="Forzar precio"
              >
                <Zap className="w-4 h-4" />
              </Button>
              <Button asChild variant="ghost" size="icon" title="Editar">
                <Link href={`/admin/coins/${coin.id}`}>
                  <Pencil className="w-4 h-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteConfirm(coin.id)}
                title="Eliminar"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal forzar precio */}
      <Dialog
        open={!!forcePriceOpen}
        onOpenChange={(o) => {
          if (!o) {
            setForcePriceOpen(null);
            setForcePriceValue("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forzar precio</DialogTitle>
            <DialogDescription>
              El precio se actualiza inmediatamente y se registra en el histórico.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="number"
              step="any"
              placeholder="Nuevo precio"
              value={forcePriceValue}
              onChange={(e) => setForcePriceValue(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setForcePriceOpen(null);
                setForcePriceValue("");
              }}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleForcePrice} disabled={isPending}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminación */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar esta moneda?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. Si la moneda tiene operaciones asociadas,
              no se podrá eliminar — mejor desactivala.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              Sí, eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
