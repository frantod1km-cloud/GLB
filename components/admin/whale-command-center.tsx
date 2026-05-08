"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  X,
  Loader2,
  AlertCircle,
  Waves,
  Crosshair,
} from "lucide-react";
import {
  whaleCommandAction,
  whaleSoftCommandAction,
  whalePrecisionAction,
  cancelWhaleBatchAction,
  updateMarketLiquidityAction,
} from "@/app/actions/whales";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface CommandCenterProps {
  coins: any[];
  whales: any[];
  totalWhales: number;
  totalAvailable: number;
  pendingBatches: any[];
}

type Mode = "instant" | "soft" | "precision";

export function WhaleCommandCenter({
  coins: initialCoins,
  whales,
  totalWhales,
  totalAvailable,
  pendingBatches,
}: CommandCenterProps) {
  const router = useRouter();
  const [coins, setCoins] = useState(initialCoins);
  const [mode, setMode] = useState<Mode>("instant");
  const [selectedCoinId, setSelectedCoinId] = useState<string>(initialCoins[0]?.id || "");

  // Instant
  const [amount, setAmount] = useState<string>("10000");
  const [leverage, setLeverage] = useState<number>(5);

  // Soft
  const [softAmount, setSoftAmount] = useState<string>("30000");
  const [softLeverage, setSoftLeverage] = useState<number>(5);
  const [softDuration, setSoftDuration] = useState<number>(60);

  // Precision
  const [precWhaleId, setPrecWhaleId] = useState<string>(whales[0]?.id || "");
  const [precDirection, setPrecDirection] = useState<"long" | "short">("long");
  const [precAmount, setPrecAmount] = useState<string>("5000");
  const [precLeverage, setPrecLeverage] = useState<number>(5);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editLiquidity, setEditLiquidity] = useState(false);
  const [liquidityValue, setLiquidityValue] = useState("");

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
  const selectedWhale = whales.find((w) => w.id === precWhaleId);

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  function handleInstant(command: "pump" | "dump" | "stop") {
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
      if (command === "stop") flashSuccess(`✓ ${d.closed} operaciones cerradas`);
      else
        flashSuccess(
          `✓ ${command.toUpperCase()}: ${d.whales_executed} whales × ${formatUSDT(d.amount_per_whale)} USDT`
        );
      router.refresh();
    });
  }

  function handleSoft(command: "soft_pump" | "soft_dump") {
    setError(null);
    setSuccess(null);
    if (!selectedCoinId) {
      setError("Elegí una moneda");
      return;
    }
    const total = Number(softAmount);
    if (!total || total <= 0) {
      setError("Monto inválido");
      return;
    }
    if (softDuration < 5 || softDuration > 600) {
      setError("Duración entre 5 y 600 segundos");
      return;
    }
    startTransition(async () => {
      const r = await whaleSoftCommandAction(
        selectedCoinId,
        command,
        total,
        softLeverage,
        softDuration
      );
      if (r.error) {
        setError(r.error);
        return;
      }
      const d = r.data;
      flashSuccess(
        `✓ Soft ${command === "soft_pump" ? "PUMP" : "DUMP"}: ${d.steps} pasos en ${d.duration_seconds}s programados`
      );
      router.refresh();
    });
  }

  function handlePrecision() {
    setError(null);
    setSuccess(null);
    if (!precWhaleId || !selectedCoinId) {
      setError("Faltan datos");
      return;
    }
    const am = Number(precAmount);
    if (!am || am <= 0) {
      setError("Monto inválido");
      return;
    }
    startTransition(async () => {
      const r = await whalePrecisionAction(
        precWhaleId,
        selectedCoinId,
        precDirection,
        am,
        precLeverage
      );
      if (r.error) {
        setError(r.error);
        return;
      }
      flashSuccess(
        `✓ Precision: ${selectedWhale?.full_name} abrió ${precDirection.toUpperCase()} ${formatUSDT(am)} USDT @ ${precLeverage}x`
      );
      router.refresh();
    });
  }

  function handleCancelBatch(batchId: string) {
    startTransition(async () => {
      const r = await cancelWhaleBatchAction(batchId);
      if (!r.error) {
        flashSuccess("✓ Batch cancelado");
        router.refresh();
      }
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
          Creá al menos una whale activa abajo para usar los comandos.
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

      {/* Selector de moneda compartido */}
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
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/40">
        <ModeTab
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Masivo"
          active={mode === "instant"}
          onClick={() => setMode("instant")}
        />
        <ModeTab
          icon={<Waves className="w-3.5 h-3.5" />}
          label="Soft (gradual)"
          active={mode === "soft"}
          onClick={() => setMode("soft")}
        />
        <ModeTab
          icon={<Crosshair className="w-3.5 h-3.5" />}
          label="Precision"
          active={mode === "precision"}
          onClick={() => setMode("precision")}
        />
      </div>

      {/* INSTANT */}
      {mode === "instant" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Total USDT</Label>
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
            Inmediato: todas las whales abren posición de golpe
          </p>

          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => handleInstant("pump")}
              disabled={isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              PUMP
            </Button>
            <Button
              onClick={() => handleInstant("dump")}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingDown className="w-4 h-4" />}
              DUMP
            </Button>
            <Button onClick={() => handleInstant("stop")} disabled={isPending} variant="outline">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              STOP
            </Button>
          </div>
        </div>
      )}

      {/* SOFT */}
      {mode === "soft" && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Total USDT</Label>
              <Input
                type="number"
                step="any"
                value={softAmount}
                onChange={(e) => setSoftAmount(e.target.value)}
                disabled={isPending}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Leverage</Label>
              <select
                value={softLeverage}
                onChange={(e) => setSoftLeverage(Number(e.target.value))}
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
            <div className="space-y-1.5">
              <Label className="text-xs">Duración (seg)</Label>
              <Input
                type="number"
                min="5"
                max="600"
                value={softDuration}
                onChange={(e) => setSoftDuration(Number(e.target.value))}
                disabled={isPending}
                className="font-mono"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            La presión se distribuye en N segundos. Más sutil, parece movimiento orgánico.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => handleSoft("soft_pump")}
              disabled={isPending}
              className="bg-primary hover:bg-primary/90"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Waves className="w-4 h-4" />}
              SOFT PUMP
            </Button>
            <Button
              onClick={() => handleSoft("soft_dump")}
              disabled={isPending}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Waves className="w-4 h-4" />}
              SOFT DUMP
            </Button>
          </div>

          {pendingBatches.length > 0 && (
            <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-md p-3 space-y-2">
              <p className="text-xs font-semibold text-yellow-500">
                ⏱️ Batches activos
              </p>
              {pendingBatches.map((b: any) => (
                <div
                  key={b.batch_id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="font-mono">
                    {b.pending} acciones pendientes — próx: {new Date(b.next_at).toLocaleTimeString("es-AR")}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCancelBatch(b.batch_id)}
                    disabled={isPending}
                  >
                    Cancelar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PRECISION */}
      {mode === "precision" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Whale específica</Label>
            <select
              value={precWhaleId}
              onChange={(e) => setPrecWhaleId(e.target.value)}
              disabled={isPending}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {whales.map((w: any) => (
                <option key={w.id} value={w.id} disabled={!w.is_active}>
                  {w.full_name} — {formatUSDT(Number(w.balance) - Number(w.locked_balance || 0))} USDT
                  {!w.is_active && " (inactiva)"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPrecDirection("long")}
              disabled={isPending}
              className={`py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-1.5 transition-all ${
                precDirection === "long"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Long
            </button>
            <button
              type="button"
              onClick={() => setPrecDirection("short")}
              disabled={isPending}
              className={`py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-1.5 transition-all ${
                precDirection === "short"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <TrendingDown className="w-4 h-4" />
              Short
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Monto USDT</Label>
              <Input
                type="number"
                step="any"
                value={precAmount}
                onChange={(e) => setPrecAmount(e.target.value)}
                disabled={isPending}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Leverage</Label>
              <select
                value={precLeverage}
                onChange={(e) => setPrecLeverage(Number(e.target.value))}
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
            Cirugía fina: una sola whale + monto exacto. Útil para escenarios puntuales.
          </p>

          <Button
            onClick={handlePrecision}
            disabled={isPending}
            className="w-full"
            variant="outline"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
            Ejecutar precisión
          </Button>
        </div>
      )}

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

function ModeTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors border-b-2 -mb-px ${
        active
          ? "text-primary border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
