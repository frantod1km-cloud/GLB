"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowDownUp,
  Loader2,
  AlertCircle,
  TrendingUp,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatUSDT } from "@/lib/utils";
import { spotConvertAction } from "@/app/actions/convert";

interface CoinOption {
  symbol: string;
  buy_price: number;
  sell_price: number;
  decimals: number;
  spot_enabled: boolean;
}

interface ConvertViewProps {
  userId: string;
  initialCoins: CoinOption[];
  initialHoldings: Record<string, number>;
  feePercent: number;
}

export function ConvertView({
  userId,
  initialCoins,
  initialHoldings,
  feePercent,
}: ConvertViewProps) {
  const router = useRouter();
  const [coins, setCoins] = useState<CoinOption[]>(initialCoins);
  const [holdings, setHoldings] = useState<Record<string, number>>(initialHoldings);

  const [fromCoin, setFromCoin] = useState<string>("USDT");
  const [toCoin, setToCoin] = useState<string>(
    initialCoins.find((c) => c.symbol !== "USDT")?.symbol || "BTC"
  );
  const [fromAmount, setFromAmount] = useState("");

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    fromAmount: number;
    fromCoin: string;
    toAmount: number;
    toCoin: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Realtime: actualizar precios cuando cambian
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("convert-coins")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "coins" },
        (payload: any) => {
          const c = payload.new;
          const cp = Number(c.current_price);
          const sp = Number(c.spread_percent || 0);
          const sell =
            c.spot_sell_price !== null
              ? Number(c.spot_sell_price)
              : cp * (1 - sp / 200);
          const buy =
            c.spot_buy_price !== null
              ? Number(c.spot_buy_price)
              : cp * (1 + sp / 200);

          setCoins((prev) =>
            prev.map((coin) =>
              coin.symbol === c.symbol
                ? { ...coin, sell_price: sell, buy_price: buy }
                : coin
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "spot_holdings",
          filter: `user_id=eq.${userId}`,
        },
        async () => {
          const { data } = await supabase
            .from("spot_holdings")
            .select("coin_symbol, amount")
            .eq("user_id", userId);
          const map: Record<string, number> = {};
          for (const h of data || []) {
            map[h.coin_symbol] = Number(h.amount || 0);
          }
          setHoldings(map);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const fromCoinData = coins.find((c) => c.symbol === fromCoin);
  const toCoinData = coins.find((c) => c.symbol === toCoin);
  const fromBalance = holdings[fromCoin] || 0;

  // Calcular conversión preview
  const preview = useMemo(() => {
    const amt = Number(fromAmount);
    if (!amt || amt <= 0) {
      return { rate: 0, grossTo: 0, fee: 0, netTo: 0, usdtValue: 0 };
    }

    let usdtValue: number;
    if (fromCoin === "USDT") {
      usdtValue = amt;
    } else {
      usdtValue = amt * (fromCoinData?.sell_price || 0);
    }

    let grossTo: number;
    if (toCoin === "USDT") {
      grossTo = usdtValue;
    } else {
      grossTo = usdtValue / (toCoinData?.buy_price || 1);
    }

    const fee = grossTo * (feePercent / 100);
    const netTo = grossTo - fee;
    const rate = amt > 0 ? netTo / amt : 0;

    return { rate, grossTo, fee, netTo, usdtValue };
  }, [fromAmount, fromCoin, toCoin, fromCoinData, toCoinData, feePercent]);

  function handleFlip() {
    const tmp = fromCoin;
    setFromCoin(toCoin);
    setToCoin(tmp);
    setFromAmount("");
    setError(null);
  }

  function handleMax() {
    setFromAmount(String(fromBalance));
  }

  function handlePercent(pct: number) {
    setFromAmount(String((fromBalance * pct) / 100));
  }

  function openConfirm() {
    setError(null);
    const amt = Number(fromAmount);
    if (!amt || amt <= 0) {
      setError("Ingresá un monto válido");
      return;
    }
    if (amt > fromBalance) {
      setError(`Saldo insuficiente. Tenés ${formatPrice(fromBalance, fromCoinData?.decimals || 4)} ${fromCoin}`);
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setError(null);
    const amt = Number(fromAmount);

    startTransition(async () => {
      const r = await spotConvertAction(fromCoin, toCoin, amt);
      if (r.error) {
        setError(r.error);
        setConfirmOpen(false);
        return;
      }
      setSuccess({
        fromAmount: amt,
        fromCoin,
        toAmount: Number(r.data?.to_amount || 0),
        toCoin,
      });
      setConfirmOpen(false);
      setFromAmount("");
      router.refresh();
      setTimeout(() => setSuccess(null), 5000);
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border/60 rounded-2xl p-6 space-y-3">
        {/* DESDE */}
        <div className="bg-muted/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-medium">Desde</span>
            <span className="text-xs text-muted-foreground">
              Disponible:{" "}
              <span className="text-foreground font-mono font-medium">
                {formatPrice(fromBalance, fromCoinData?.decimals || 4)} {fromCoin}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              step="any"
              placeholder="0.00"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              disabled={isPending}
              className="text-2xl font-mono font-bold bg-transparent border-0 focus-visible:ring-0 px-0 h-auto"
            />
            <button
              type="button"
              onClick={() => setShowFromPicker(true)}
              className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:bg-secondary/40 transition-colors flex-shrink-0"
            >
              <CoinIcon symbol={fromCoin} />
              <span className="font-semibold">{fromCoin}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Quick % buttons */}
          {fromBalance > 0 && (
            <div className="flex gap-1.5 mt-3">
              {[25, 50, 75].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handlePercent(pct)}
                  disabled={isPending}
                  className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 text-muted-foreground transition-colors"
                >
                  {pct}%
                </button>
              ))}
              <button
                type="button"
                onClick={handleMax}
                disabled={isPending}
                className="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                MAX
              </button>
            </div>
          )}
        </div>

        {/* FLIP */}
        <div className="flex justify-center -my-1.5 relative z-10">
          <button
            type="button"
            onClick={handleFlip}
            disabled={isPending}
            className="w-9 h-9 rounded-lg bg-card border-2 border-border hover:border-primary/50 hover:rotate-180 transition-all duration-300 flex items-center justify-center"
            title="Invertir"
          >
            <ArrowDownUp className="w-4 h-4" />
          </button>
        </div>

        {/* HACIA */}
        <div className="bg-muted/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-medium">A</span>
            <span className="text-xs text-muted-foreground">
              Saldo:{" "}
              <span className="text-foreground font-mono font-medium">
                {formatPrice(holdings[toCoin] || 0, toCoinData?.decimals || 4)}{" "}
                {toCoin}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-2xl font-mono font-bold flex-1 truncate">
              {preview.netTo > 0
                ? formatPrice(preview.netTo, toCoinData?.decimals || 4)
                : "0.00"}
            </div>
            <button
              type="button"
              onClick={() => setShowToPicker(true)}
              className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:bg-secondary/40 transition-colors flex-shrink-0"
            >
              <CoinIcon symbol={toCoin} />
              <span className="font-semibold">{toCoin}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Detalles del trade */}
      {Number(fromAmount) > 0 && (
        <div className="bg-muted/10 rounded-xl p-4 text-sm space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Tasa de cambio</span>
            <span className="font-mono">
              1 {fromCoin} ≈ {formatPrice(preview.rate, toCoinData?.decimals || 6)} {toCoin}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Valor en USDT</span>
            <span className="font-mono">≈ {formatUSDT(preview.usdtValue)} USDT</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Comisión ({feePercent}%)</span>
            <span className="font-mono text-yellow-500">
              −{formatPrice(preview.fee, toCoinData?.decimals || 6)} {toCoin}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-border/40">
            <span className="font-medium">Recibís</span>
            <span className="font-mono font-bold">
              {formatPrice(preview.netTo, toCoinData?.decimals || 6)} {toCoin}
            </span>
          </div>
        </div>
      )}

      {/* Botón principal */}
      <Button
        size="lg"
        className="w-full h-12 text-base"
        disabled={isPending || !Number(fromAmount) || Number(fromAmount) <= 0}
        onClick={openConfirm}
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>Convertir</>
        )}
      </Button>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30 text-primary text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium">¡Conversión exitosa!</div>
            <div className="text-xs mt-0.5">
              {formatPrice(success.fromAmount, fromCoinData?.decimals || 4)} {success.fromCoin} →{" "}
              {formatPrice(success.toAmount, toCoinData?.decimals || 6)} {success.toCoin}
            </div>
          </div>
        </div>
      )}

      {/* Picker monedas - DESDE */}
      <CoinPicker
        open={showFromPicker}
        onClose={() => setShowFromPicker(false)}
        coins={coins}
        holdings={holdings}
        excludeSymbol={toCoin}
        onSelect={(sym) => {
          setFromCoin(sym);
          setShowFromPicker(false);
          setFromAmount("");
        }}
        title="Convertir desde"
      />

      {/* Picker monedas - A */}
      <CoinPicker
        open={showToPicker}
        onClose={() => setShowToPicker(false)}
        coins={coins}
        holdings={holdings}
        excludeSymbol={fromCoin}
        onSelect={(sym) => {
          setToCoin(sym);
          setShowToPicker(false);
        }}
        title="Convertir a"
      />

      {/* Modal confirmación */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar conversión</DialogTitle>
            <DialogDescription>
              Esta operación es inmediata e irreversible
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-muted/20 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entregás</span>
                <span className="font-mono font-bold">
                  {formatPrice(Number(fromAmount), fromCoinData?.decimals || 4)} {fromCoin}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Recibís</span>
                <span className="font-mono font-bold text-primary">
                  {formatPrice(preview.netTo, toCoinData?.decimals || 6)} {toCoin}
                </span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-border/40">
                <span className="text-muted-foreground">
                  Comisión ({feePercent}%)
                </span>
                <span className="font-mono text-yellow-500">
                  −{formatPrice(preview.fee, toCoinData?.decimals || 6)} {toCoin}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CoinPicker({
  open,
  onClose,
  coins,
  holdings,
  excludeSymbol,
  onSelect,
  title,
}: {
  open: boolean;
  onClose: () => void;
  coins: CoinOption[];
  holdings: Record<string, number>;
  excludeSymbol: string;
  onSelect: (symbol: string) => void;
  title: string;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return coins
      .filter((c) => c.symbol !== excludeSymbol && c.spot_enabled)
      .filter((c) => {
        const q = search.toLowerCase();
        return !q || c.symbol.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        // Primero las que tienen saldo
        const ab = holdings[a.symbol] || 0;
        const bb = holdings[b.symbol] || 0;
        if (ab > 0 && bb === 0) return -1;
        if (bb > 0 && ab === 0) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [coins, excludeSymbol, search, holdings]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Buscar..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="max-h-[400px] overflow-y-auto -mx-6 px-6">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Sin resultados
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((c) => {
                const balance = holdings[c.symbol] || 0;
                return (
                  <button
                    key={c.symbol}
                    type="button"
                    onClick={() => onSelect(c.symbol)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <CoinIcon symbol={c.symbol} />
                    <div className="flex-1 text-left">
                      <div className="font-semibold text-sm">{c.symbol}</div>
                      {c.symbol !== "USDT" && (
                        <div className="text-xs text-muted-foreground font-mono">
                          ≈ {formatPrice(c.sell_price, 2)} USDT
                        </div>
                      )}
                    </div>
                    {balance > 0 && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Saldo</div>
                        <div className="text-sm font-mono">
                          {formatPrice(balance, c.decimals || 4)}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CoinIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    USDT: "bg-green-500/20 text-green-500",
    BTC: "bg-orange-500/20 text-orange-500",
    ETH: "bg-blue-500/20 text-blue-500",
  };
  const color = colors[symbol] || "bg-primary/20 text-primary";
  return (
    <div
      className={`w-6 h-6 rounded-full ${color} flex items-center justify-center text-[10px] font-bold flex-shrink-0`}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}
