"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Zap, TrendingUp, TrendingDown, X, Loader2, AlertCircle } from "lucide-react";
import { whaleCommandAction, updateMarketLiquidityAction } from "@/app/actions/whales";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface CommandCenterProps {
  coins: any[];
  totalWhales: number;
  totalAvailable: number;
}

export function WhaleCommandCenter({ coins: initialCoins, totalWhales, totalAvailable }: CommandCenterProps) {
  const router = useRouter();
  const [coins, setCoins] = useState(initialCoins);
  const [selectedCoinId, setSelectedCoinId] = useState<string>(initialCoins[0]?.id || "");
  const [amount, setAmount] = useState<string>("10000");
  const [leverage, setLeverage] = useState<number>(5);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editLiquidity, setEditLiquidity] = useState(false);
  const [liquidityValue, setLiquidityValue] = useState("");

  // Suscribirse a cambios de precio en vivo
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("whales-coins")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "coins" },
        (payload: any) => {
          setCoins((prev) =>
            prev.map((c) =>
              c.id === payload.new.id
                ? { ...c, current_price: payload.new.current_price }
                : c
            )
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const selectedCoin = coins.find((c) => c.id === selectedCoinId);

  function handleCommand(command: "pump" | "dump" | "stop") {
    setError(null);
    setSuccess(null);
    if (!selectedCoinId) {
      setError("Elegí una moneda");
      return;
    }

    const totalAmount = command === "stop" ? 0 : Number(amount);

    if (command !== "stop" && (!totalAmount || totalAmount <= 0)) {
      setError("Monto inválido");
      return;
    }

    startTransition(async () => {
      const r = await whaleCommandAction(selectedCoinId, command, totalAmount, leverage);
      if (r.error) {
        setError(r.error);
        return;
      }
      const d = r.data;
      if (command === "stop") {
        setSuccess(`✓ ${d.closed} operaciones cerradas`);
      } else {
        setSuccess(
          `✓ ${command === "pump" ? "PUMP" : "DUMP"}: ${d.whales_executed} whales abrieron ${formatUSDT(d.amount_per_whale)} USDT cada una`
        );
      }
      setTimeout(() => setSuccess(null), 4000);
      router.refresh();
    });
  }

  function handleLiquidityUpdate() {
    if (!selectedCoinId) return;
    const v = Number(liquidityValue);
    if (!v || v <= 0) {
      setError("Liquidez inválida");
      return;
    }
    startTransition(async () => {
      const r = await updateMarketLiquidityAction(selectedCoinId, v);
      if (r.error) setError(r.error);
      else {
        setEditLiquidity(false);
        setLiquidityValue("");
        router.refresh();
      }
    });
  }

  if (coins.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
        No hay monedas activas. Creá una primero en /admin/coins.
      </div>
    );
  }

  if (totalWhales === 0) {
    return (
      <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-lg p-6 text-center">
        <div className="text-4xl mb-2">🐋</div>
        <h3 className="font-semibold mb-1">Necesitás whales primero</h3>
        <p className="text-sm text-muted-foreground">
          Creá al menos una whale activa abajo para usar los comandos masivos.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-yellow-500" />
          Centro de comando
        </h3>
        <Badge variant="default">
          {totalWhales} whale{totalWhales !== 1 ? "s" : ""} • {formatUSDT(totalAvailable)} USDT
        </Badge>
      </div>

      {/* Selector de moneda */}
      <div className="space-y-1.5">
        <Label className="text-xs">Moneda objetivo</Label>
        <select
          value={selectedCoinId}
          onChange={(e) => setSelectedCoinId(e.target.value)}
          disabled={isPending}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
        >
          {coins.map((c) => (
            <option key={c.id} value={c.id}>
              {c.symbol} — {formatPrice(Number(c.current_price), c.decimals)}
            </option>
          ))}
        </select>
      </div>

      {selectedCoin && (
        <div className="bg-muted/20 rounded-md p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Precio actual</span>
            <span className="font-mono font-semibold">
              {formatPrice(Number(selectedCoin.current_price), selectedCoin.decimals)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Liquidez de mercado</span>
            {editLiquidity ? (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  step="any"
                  value={liquidityValue}
                  onChange={(e) => setLiquidityValue(e.target.value)}
                  className="h-7 text-xs w-32"
                  disabled={isPending}
                />
                <Button size="sm" onClick={handleLiquidityUpdate} disabled={isPending}>
                  ✓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditLiquidity(false)}
                  disabled={isPending}
                >
                  ✕
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLiquidityValue(String(selectedCoin.market_liquidity));
                  setEditLiquidity(true);
                }}
                className="font-mono font-semibold hover:underline text-primary"
              >
                {formatUSDT(Number(selectedCoin.market_liquidity))} USDT
              </button>
            )}
          </div>
          <p className="text-muted-foreground italic text-[10px]">
            Liquidez baja → más fácil mover el precio. Click para editar.
          </p>
        </div>
      )}

      {/* Inputs de comando */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Total a usar (USDT)</Label>
          <Input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isPending}
            className="font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Apalancamiento</Label>
          <select
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            disabled={isPending}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
          >
            {[1, 2, 5, 10, 25].map((l) => (
              <option key={l} value={l}>
                {l}x
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Se distribuye entre todas las whales activas con saldo. Cada whale abre un trade con
        ese monto y leverage en la dirección elegida.
      </p>

      {/* Botones de acción */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          onClick={() => handleCommand("pump")}
          disabled={isPending}
          className="bg-primary hover:bg-primary/90"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <TrendingUp className="w-4 h-4" />
          )}
          PUMP
        </Button>
        <Button
          onClick={() => handleCommand("dump")}
          disabled={isPending}
          className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          DUMP
        </Button>
        <Button
          onClick={() => handleCommand("stop")}
          disabled={isPending}
          variant="outline"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <X className="w-4 h-4" />
          )}
          STOP
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-2 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs">
          {success}
        </div>
      )}
    </div>
  );
}
