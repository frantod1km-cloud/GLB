"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Wallet,
  TrendingUp,
  ArrowLeftRight,
  Loader2,
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Repeat,
  PiggyBank,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatUSDT, formatPrice } from "@/lib/utils";
import { DepositDialog } from "@/components/wallet/deposit-dialog";
import { WithdrawDialog } from "@/components/wallet/withdraw-dialog";
import {
  transferSpotToTradingAction,
  transferTradingToSpotAction,
} from "@/app/actions/wallet-transfer";

type Tab = "spot" | "trading";
type TransferDirection = "spot_to_trading" | "trading_to_spot";

interface WalletViewProps {
  userId: string;
  initialSpotHoldings: any[];
  initialTradingBalance: number;
  initialLockedBalance: number;
  coinPrices: Record<string, { sell: number; buy: number; decimals: number; name?: string }>;
  depositSettings: {
    uiMode: "simple" | "proof" | "wallet";
    walletAddress: string;
    minAmount: number;
    maxAmount: number;
  };
}

export function WalletView({
  userId,
  initialSpotHoldings,
  initialTradingBalance,
  initialLockedBalance,
  coinPrices,
  depositSettings,
}: WalletViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>("spot");
  const [holdings, setHoldings] = useState(initialSpotHoldings);
  const [tradingBalance, setTradingBalance] = useState(initialTradingBalance);
  const [lockedBalance, setLockedBalance] = useState(initialLockedBalance);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDirection, setTransferDirection] =
    useState<TransferDirection>("spot_to_trading");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Realtime para spot_holdings
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`spot-${userId}`)
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
            .select("*")
            .eq("user_id", userId);
          setHoldings(data || []);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "wallets",
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          if (payload.new.coin_symbol === "USDT") {
            setTradingBalance(Number(payload.new.balance || 0));
            setLockedBalance(Number(payload.new.locked_balance || 0));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Calcular el valor total en USDT de los holdings spot
  const spotTotalUsdt = useMemo(() => {
    return holdings.reduce((sum, h) => {
      const sym = h.coin_symbol;
      const amt = Number(h.amount || 0);
      if (sym === "USDT") return sum + amt;
      const price = coinPrices[sym]?.sell || 0;
      return sum + amt * price;
    }, 0);
  }, [holdings, coinPrices]);

  const tradingAvailable = tradingBalance - lockedBalance;
  const totalPortfolio = spotTotalUsdt + tradingBalance;

  function openTransfer(direction: TransferDirection) {
    setTransferDirection(direction);
    setTransferAmount("");
    setTransferError(null);
    setTransferSuccess(null);
    setTransferOpen(true);
  }

  function handleTransfer() {
    setTransferError(null);
    const amt = Number(transferAmount);
    if (!amt || amt <= 0) {
      setTransferError("Monto inválido");
      return;
    }

    const maxAvailable =
      transferDirection === "spot_to_trading"
        ? Number(holdings.find((h) => h.coin_symbol === "USDT")?.amount || 0)
        : tradingAvailable;

    if (amt > maxAvailable) {
      setTransferError(`Máximo: ${formatUSDT(maxAvailable)} USDT`);
      return;
    }

    startTransition(async () => {
      const action =
        transferDirection === "spot_to_trading"
          ? transferSpotToTradingAction
          : transferTradingToSpotAction;
      const r = await action(amt);
      if (r.error) {
        setTransferError(r.error);
        return;
      }
      setTransferSuccess(`✓ ${formatUSDT(amt)} USDT transferidos`);
      setTimeout(() => setTransferOpen(false), 1200);
    });
  }

  // Obtener el saldo USDT en spot
  const spotUsdt = Number(
    holdings.find((h) => h.coin_symbol === "USDT")?.amount || 0
  );
  const otherHoldings = holdings.filter(
    (h) => h.coin_symbol !== "USDT" && Number(h.amount) > 0
  );

  return (
    <div className="space-y-6">
      {/* Total portfolio */}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-lg p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4" />
          Patrimonio total
        </div>
        <div className="text-4xl font-bold mt-2 font-mono">
          {formatUSDT(totalPortfolio)}{" "}
          <span className="text-xl text-muted-foreground">USDT</span>
        </div>
        <div className="text-sm text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Spot:{" "}
            <span className="text-foreground font-mono font-medium">
              {formatUSDT(spotTotalUsdt)}
            </span>
          </span>
          <span>
            Trading:{" "}
            <span className="text-foreground font-mono font-medium">
              {formatUSDT(tradingBalance)}
            </span>
          </span>
        </div>
      </div>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <DepositDialog
          uiMode={depositSettings.uiMode}
          walletAddress={depositSettings.walletAddress}
          minAmount={depositSettings.minAmount}
          maxAmount={depositSettings.maxAmount}
        />
        <WithdrawDialog
          availableBalance={tradingAvailable + spotUsdt}
          minAmount={depositSettings.minAmount}
          maxAmount={depositSettings.maxAmount}
        />
        <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1">
          <Link href="/convert">
            <Repeat className="w-4 h-4" />
            Convertir
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto py-3 flex-col gap-1">
          <Link href="/earn">
            <PiggyBank className="w-4 h-4" />
            Earn
          </Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/40">
        <TabButton
          active={activeTab === "spot"}
          onClick={() => setActiveTab("spot")}
          icon={<Wallet className="w-3.5 h-3.5" />}
          label="Spot"
          balance={spotTotalUsdt}
        />
        <TabButton
          active={activeTab === "trading"}
          onClick={() => setActiveTab("trading")}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Trading"
          balance={tradingBalance}
        />
      </div>

      {/* Tab Spot */}
      {activeTab === "spot" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Saldos en Spot</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openTransfer("spot_to_trading")}
              disabled={spotUsdt === 0}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Mover a Trading
            </Button>
          </div>

          {holdings.length === 0 ? (
            <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
              <Wallet className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm text-muted-foreground">
                Aún no tenés saldo en Spot. Hacé un depósito para empezar.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
              <div className="divide-y divide-border/40">
                {/* USDT siempre primero */}
                {spotUsdt > 0 && (
                  <HoldingRow
                    coinSymbol="USDT"
                    amount={spotUsdt}
                    valueUsdt={spotUsdt}
                    pricePerUnit={1}
                    decimals={2}
                  />
                )}

                {otherHoldings.map((h) => {
                  const sym = h.coin_symbol;
                  const amt = Number(h.amount);
                  const price = coinPrices[sym]?.sell || 0;
                  const decimals = coinPrices[sym]?.decimals || 4;
                  return (
                    <HoldingRow
                      key={sym}
                      coinSymbol={sym}
                      amount={amt}
                      valueUsdt={amt * price}
                      pricePerUnit={price}
                      decimals={decimals}
                      avgBuyPrice={Number(h.avg_buy_price_usdt || 0)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Trading */}
      {activeTab === "trading" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Saldo en Trading</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openTransfer("trading_to_spot")}
              disabled={tradingAvailable === 0}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Mover a Spot
            </Button>
          </div>

          <div className="bg-card border border-border/60 rounded-lg p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="text-2xl font-bold font-mono mt-1">
                  {formatUSDT(tradingBalance)}{" "}
                  <span className="text-sm text-muted-foreground">USDT</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Disponible</div>
                <div className="text-2xl font-bold font-mono mt-1 text-primary">
                  {formatUSDT(tradingAvailable)}
                </div>
              </div>
              {lockedBalance > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground">En operaciones</div>
                  <div className="text-2xl font-bold font-mono mt-1 text-yellow-500">
                    {formatUSDT(lockedBalance)}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-border/40 text-xs text-muted-foreground">
              💡 El saldo de Trading se usa para abrir posiciones long/short en{" "}
              <Link href="/trading" className="text-primary hover:underline">
                la sección de Trading
              </Link>
              .
            </div>
          </div>
        </div>
      )}

      {/* Modal transferencia */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <ArrowLeftRight className="inline w-5 h-5 mr-1" />
              {transferDirection === "spot_to_trading"
                ? "Mover de Spot a Trading"
                : "Mover de Trading a Spot"}
            </DialogTitle>
            <DialogDescription>
              {transferDirection === "spot_to_trading"
                ? "Las USDT que muevas a Trading podrán usarse para abrir posiciones."
                : "Las USDT que muevas a Spot podrán convertirse a otras monedas o usarse en Earn."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="bg-muted/20 rounded p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Disponible en {transferDirection === "spot_to_trading" ? "Spot" : "Trading"}:
                </span>
                <span className="font-mono font-semibold">
                  {formatUSDT(
                    transferDirection === "spot_to_trading"
                      ? spotUsdt
                      : tradingAvailable
                  )}{" "}
                  USDT
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Monto USDT</Label>
              <Input
                type="number"
                step="any"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                disabled={isPending}
                className="font-mono"
                placeholder="0.00"
              />
              <button
                type="button"
                onClick={() =>
                  setTransferAmount(
                    String(
                      transferDirection === "spot_to_trading"
                        ? spotUsdt
                        : tradingAvailable
                    )
                  )
                }
                className="text-xs text-primary hover:underline"
                disabled={isPending}
              >
                Usar todo
              </button>
            </div>

            {transferError && (
              <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{transferError}</span>
              </div>
            )}
            {transferSuccess && (
              <div className="p-2 rounded bg-primary/10 border border-primary/30 text-primary text-xs">
                {transferSuccess}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleTransfer} disabled={isPending || !transferAmount}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Transferir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  balance,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  balance: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 transition-colors border-b-2 -mb-px ${
        active
          ? "text-primary border-primary"
          : "text-muted-foreground border-transparent hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono text-xs opacity-70 ml-1">
        {formatUSDT(balance)}
      </span>
    </button>
  );
}

function HoldingRow({
  coinSymbol,
  amount,
  valueUsdt,
  pricePerUnit,
  decimals,
  avgBuyPrice,
}: {
  coinSymbol: string;
  amount: number;
  valueUsdt: number;
  pricePerUnit: number;
  decimals: number;
  avgBuyPrice?: number;
}) {
  const pnlPct =
    avgBuyPrice && avgBuyPrice > 0 && coinSymbol !== "USDT"
      ? ((pricePerUnit - avgBuyPrice) / avgBuyPrice) * 100
      : null;

  return (
    <div className="p-4 hover:bg-muted/10 transition-colors flex items-center gap-3 flex-wrap">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs flex-shrink-0">
        {coinSymbol.slice(0, 2)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{coinSymbol}</div>
        {coinSymbol !== "USDT" && (
          <div className="text-xs text-muted-foreground">
            ≈ {formatPrice(pricePerUnit, 2)} USDT
          </div>
        )}
      </div>
      <div className="text-right">
        <div className="font-mono font-semibold">
          {formatPrice(amount, decimals)}{" "}
          <span className="text-xs text-muted-foreground">{coinSymbol}</span>
        </div>
        {coinSymbol !== "USDT" && (
          <div className="text-xs text-muted-foreground">
            ≈ {formatUSDT(valueUsdt)} USDT
          </div>
        )}
        {pnlPct !== null && (
          <div
            className={`text-[10px] font-medium ${
              pnlPct >= 0 ? "text-primary" : "text-destructive"
            }`}
          >
            {pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(2)}%
          </div>
        )}
      </div>
    </div>
  );
}
