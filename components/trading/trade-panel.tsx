"use client";

import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, Loader2, AlertCircle, Check, ChevronDown } from "lucide-react";
import { openTradeAction } from "@/app/actions/trades";
import { calculateBidAsk } from "@/lib/price-engine";
import { formatPrice, formatUSDT } from "@/lib/utils";

interface TradePanelProps {
  coin: any;
  currentPrice: number;
  available: number;
  allowedLeverages: number[];
  feePercent: number;
}

export function TradePanel({
  coin,
  currentPrice,
  available,
  allowedLeverages,
  feePercent,
}: TradePanelProps) {
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [amount, setAmount] = useState<string>("");
  const [leverage, setLeverage] = useState<number>(allowedLeverages[0] || 1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopLoss, setStopLoss] = useState<string>("");
  const [takeProfit, setTakeProfit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  const { bid, ask } = calculateBidAsk(currentPrice, Number(coin.spread_percent));
  const entryPrice = direction === "long" ? ask : bid;

  const amountNum = Number(amount) || 0;
  const fee = amountNum * (feePercent / 100);
  const totalCost = amountNum + fee;
  const positionSize = amountNum * leverage;

  // Liquidación estimada
  const liqPrice = useMemo(() => {
    if (!entryPrice || !leverage) return 0;
    if (direction === "long") return entryPrice * (1 - 1 / leverage);
    return entryPrice * (1 + 1 / leverage);
  }, [entryPrice, leverage, direction]);

  const insufficientBalance = totalCost > available;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!amountNum || amountNum <= 0) {
      setError("Ingresá un monto");
      return;
    }
    if (insufficientBalance) {
      setError("Saldo insuficiente (incluye fee)");
      return;
    }

    const formData = new FormData();
    formData.set("coin_id", coin.id);
    formData.set("direction", direction);
    formData.set("amount", String(amountNum));
    formData.set("leverage", String(leverage));
    if (stopLoss) formData.set("stop_loss", stopLoss);
    if (takeProfit) formData.set("take_profit", takeProfit);

    startTransition(async () => {
      const result = await openTradeAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setAmount("");
        setStopLoss("");
        setTakeProfit("");
        setTimeout(() => setSuccess(false), 2500);
      }
    });
  }

  return (
    <div className="bg-card border border-border/60 rounded-lg p-5 sticky top-24 space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground mb-3">
          Abrir operación
        </h3>

        {/* Long / Short */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setDirection("long")}
            disabled={isPending}
            className={`py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-1.5 transition-all ${
              direction === "long"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Long
          </button>
          <button
            type="button"
            onClick={() => setDirection("short")}
            disabled={isPending}
            className={`py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-1.5 transition-all ${
              direction === "short"
                ? "bg-destructive text-destructive-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            Short
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Monto */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="amount" className="text-xs">Monto (USDT)</Label>
            <button
              type="button"
              onClick={() => setAmount(String(Math.floor(available * 0.99)))}
              className="text-xs text-primary hover:underline"
              disabled={isPending}
            >
              Máx: {formatUSDT(available)}
            </button>
          </div>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={isPending}
            className="text-lg font-mono"
          />
        </div>

        {/* Leverage */}
        <div className="space-y-2">
          <Label className="text-xs">Apalancamiento</Label>
          <div className="grid grid-cols-5 gap-1">
            {allowedLeverages.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLeverage(l)}
                disabled={isPending}
                className={`py-1.5 rounded text-xs font-semibold transition-colors ${
                  leverage === l
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Resumen */}
        <div className="bg-muted/20 rounded-md p-3 space-y-1 text-xs font-mono">
          <Row label="Precio entrada" value={formatPrice(entryPrice, coin.decimals)} />
          <Row
            label="Tamaño posición"
            value={`${formatUSDT(positionSize)} USDT`}
            highlight
          />
          <Row
            label="Liquidación a"
            value={formatPrice(liqPrice, coin.decimals)}
            danger
          />
          <Row
            label={`Fee (${feePercent}%)`}
            value={`${formatUSDT(fee)} USDT`}
            muted
          />
          <Row
            label="Total a debitar"
            value={`${formatUSDT(totalCost)} USDT`}
            highlight
          />
        </div>

        {/* Avanzado: SL/TP */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${
                showAdvanced ? "rotate-180" : ""
              }`}
            />
            Stop Loss / Take Profit
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sl" className="text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-destructive"></span>
                  Stop Loss (USDT)
                </Label>
                <Input
                  id="sl"
                  type="number"
                  step="any"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder={
                    direction === "long"
                      ? `< ${formatPrice(entryPrice, coin.decimals)}`
                      : `> ${formatPrice(entryPrice, coin.decimals)}`
                  }
                  disabled={isPending}
                  className="text-sm font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="tp" className="text-xs flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary"></span>
                  Take Profit (USDT)
                </Label>
                <Input
                  id="tp"
                  type="number"
                  step="any"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder={
                    direction === "long"
                      ? `> ${formatPrice(entryPrice, coin.decimals)}`
                      : `< ${formatPrice(entryPrice, coin.decimals)}`
                  }
                  disabled={isPending}
                  className="text-sm font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs">
            <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>Operación abierta</span>
          </div>
        )}

        <Button
          type="submit"
          className={`w-full ${
            direction === "long"
              ? "bg-primary hover:bg-primary/90"
              : "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          }`}
          disabled={isPending || insufficientBalance || !amountNum}
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Abriendo...
            </>
          ) : (
            <>
              {direction === "long" ? "Comprar Long" : "Vender Short"} {leverage}x
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  danger,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`text-right ${
          highlight
            ? "text-foreground font-semibold"
            : danger
              ? "text-destructive"
              : muted
                ? "text-muted-foreground"
                : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
