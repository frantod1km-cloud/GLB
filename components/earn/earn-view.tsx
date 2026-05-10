"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
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
  PiggyBank,
  TrendingUp,
  Lock,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPrice, formatUSDT } from "@/lib/utils";
import {
  earnSubscribeAction,
  earnRedeemAction,
  earnCancelEarlyAction,
} from "@/app/actions/earn";

interface EarnViewProps {
  userId: string;
  initialProducts: any[];
  initialSubscriptions: any[];
  initialHoldings: Record<string, number>;
}

export function EarnView({
  userId,
  initialProducts,
  initialSubscriptions,
  initialHoldings,
}: EarnViewProps) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [holdings, setHoldings] = useState(initialHoldings);

  const [coinFilter, setCoinFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "flexible" | "fixed" | "shark_fin">("all");

  // Modal suscribir
  const [subscribeProduct, setSubscribeProduct] = useState<any>(null);
  const [subscribeAmount, setSubscribeAmount] = useState("");

  // Modal cancelar
  const [cancelSubscription, setCancelSubscription] = useState<any>(null);

  // Modal redimir
  const [redeemSubscription, setRedeemSubscription] = useState<any>(null);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Realtime
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`earn-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "earn_products" },
        async () => {
          const { data } = await supabase
            .from("earn_products")
            .select("*")
            .eq("is_active", true)
            .order("sort_order");
          setProducts(data || []);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "earn_subscriptions",
          filter: `user_id=eq.${userId}`,
        },
        async () => {
          const { data } = await supabase
            .from("earn_subscriptions")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
          setSubscriptions(data || []);
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

  // Filtrar productos
  const availableCoins = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.coin_symbol));
    return Array.from(set).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (coinFilter !== "all" && p.coin_symbol !== coinFilter) return false;
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      return true;
    });
  }, [products, coinFilter, typeFilter]);

  // Subs activas
  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const totalCapital = activeSubs.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const totalInterest = activeSubs.reduce(
    (sum, s) => sum + Number(s.accumulated_interest || 0),
    0
  );

  function handleSubscribe() {
    setError(null);
    if (!subscribeProduct) return;

    const amt = Number(subscribeAmount);
    if (!amt || amt <= 0) {
      setError("Monto inválido");
      return;
    }
    if (amt < Number(subscribeProduct.min_amount)) {
      setError(`Mínimo: ${subscribeProduct.min_amount} ${subscribeProduct.coin_symbol}`);
      return;
    }
    if (subscribeProduct.max_amount && amt > Number(subscribeProduct.max_amount)) {
      setError(`Máximo: ${subscribeProduct.max_amount} ${subscribeProduct.coin_symbol}`);
      return;
    }

    const balance = holdings[subscribeProduct.coin_symbol] || 0;
    if (amt > balance) {
      setError(`Saldo insuficiente. Tenés ${formatPrice(balance, 4)} ${subscribeProduct.coin_symbol} en Spot`);
      return;
    }

    startTransition(async () => {
      const r = await earnSubscribeAction(subscribeProduct.id, amt);
      if (r.error) {
        setError(r.error);
        return;
      }
      setSubscribeProduct(null);
      setSubscribeAmount("");
      router.refresh();
    });
  }

  function handleRedeem() {
    if (!redeemSubscription) return;
    setError(null);
    startTransition(async () => {
      const r = await earnRedeemAction(redeemSubscription.id);
      if (r.error) setError(r.error);
      else {
        setRedeemSubscription(null);
        router.refresh();
      }
    });
  }

  function handleCancelEarly() {
    if (!cancelSubscription) return;
    setError(null);
    startTransition(async () => {
      const r = await earnCancelEarlyAction(cancelSubscription.id);
      if (r.error) setError(r.error);
      else {
        setCancelSubscription(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          icon={<PiggyBank className="w-5 h-5" />}
          label="Capital activo"
          value={`${formatUSDT(totalCapital)} USDT`}
        />
        <SummaryCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Intereses ganados"
          value={`+${formatUSDT(totalInterest)} USDT`}
          highlight
        />
        <SummaryCard
          icon={<Zap className="w-5 h-5" />}
          label="Suscripciones activas"
          value={String(activeSubs.length)}
        />
      </div>

      {/* Suscripciones activas */}
      {activeSubs.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Mis suscripciones activas</h2>
          <div className="space-y-2">
            {activeSubs.map((s) => (
              <SubscriptionRow
                key={s.id}
                sub={s}
                onRedeem={() => setRedeemSubscription(s)}
                onCancel={() => setCancelSubscription(s)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Productos */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-lg font-semibold">Productos disponibles</h2>

          {/* Filtros */}
          <div className="flex gap-1 flex-wrap">
            <FilterButton
              active={typeFilter === "all"}
              onClick={() => setTypeFilter("all")}
            >
              Todos
            </FilterButton>
            <FilterButton
              active={typeFilter === "flexible"}
              onClick={() => setTypeFilter("flexible")}
            >
              Flexible
            </FilterButton>
            <FilterButton
              active={typeFilter === "fixed"}
              onClick={() => setTypeFilter("fixed")}
            >
              Plazo fijo
            </FilterButton>
            <FilterButton
              active={typeFilter === "shark_fin"}
              onClick={() => setTypeFilter("shark_fin")}
            >
              Shark Fin
            </FilterButton>
          </div>
        </div>

        {availableCoins.length > 1 && (
          <div className="flex gap-1 flex-wrap mb-3">
            <FilterButton
              active={coinFilter === "all"}
              onClick={() => setCoinFilter("all")}
              size="sm"
            >
              Todas las monedas
            </FilterButton>
            {availableCoins.map((coin) => (
              <FilterButton
                key={coin}
                active={coinFilter === coin}
                onClick={() => setCoinFilter(coin)}
                size="sm"
              >
                {coin}
              </FilterButton>
            ))}
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
            <PiggyBank className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">
              No hay productos para los filtros seleccionados
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                userBalance={holdings[p.coin_symbol] || 0}
                onSubscribe={() => {
                  setSubscribeProduct(p);
                  setSubscribeAmount("");
                  setError(null);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal suscribir */}
      <Dialog
        open={!!subscribeProduct}
        onOpenChange={(o) => {
          if (!o) {
            setSubscribeProduct(null);
            setSubscribeAmount("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          {subscribeProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <PiggyBank className="w-5 h-5" />
                  {subscribeProduct.name}
                </DialogTitle>
                <DialogDescription>
                  {subscribeProduct.description}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {/* Datos del producto */}
                <div className="bg-muted/20 rounded-lg p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">APR</span>
                    <span className="font-mono font-bold text-primary">
                      {Number(subscribeProduct.apr).toFixed(2)}%
                    </span>
                  </div>
                  {subscribeProduct.duration_days && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Duración</span>
                      <span className="font-mono">{subscribeProduct.duration_days} días</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pago de intereses</span>
                    <span>
                      {subscribeProduct.payout_mode === "daily" ? "Diario" : "Al vencer"}
                    </span>
                  </div>
                  {subscribeProduct.early_cancellation_enabled && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cancelación anticipada</span>
                      <span className="text-yellow-500">
                        Penalty {Number(subscribeProduct.early_cancellation_penalty_percent).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {subscribeProduct.type === "shark_fin" && (
                    <>
                      <div className="border-t border-border/40 pt-1.5 mt-1.5">
                        <div className="text-muted-foreground mb-1">Shark Fin</div>
                        <div className="flex justify-between">
                          <span>Moneda observada</span>
                          <span className="font-mono">{subscribeProduct.shark_fin_target_coin}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Rango</span>
                          <span className="font-mono">
                            {Number(subscribeProduct.shark_fin_range_low).toFixed(2)}–
                            {Number(subscribeProduct.shark_fin_range_high).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>APR si se mantiene</span>
                          <span className="text-primary">
                            {Number(subscribeProduct.shark_fin_bonus_apr).toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>APR si rompe</span>
                          <span className="text-yellow-500">
                            {Number(subscribeProduct.shark_fin_base_apr || 0).toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Monto */}
                <div className="space-y-1.5">
                  <Label>Monto a suscribir ({subscribeProduct.coin_symbol})</Label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="0.00"
                    value={subscribeAmount}
                    onChange={(e) => setSubscribeAmount(e.target.value)}
                    disabled={isPending}
                    className="font-mono"
                  />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Min: {Number(subscribeProduct.min_amount).toFixed(2)}
                      {subscribeProduct.max_amount &&
                        ` • Max: ${Number(subscribeProduct.max_amount).toFixed(2)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSubscribeAmount(
                          String(holdings[subscribeProduct.coin_symbol] || 0)
                        )
                      }
                      className="text-primary hover:underline"
                      disabled={isPending}
                    >
                      Saldo:{" "}
                      {formatPrice(
                        holdings[subscribeProduct.coin_symbol] || 0,
                        4
                      )}
                    </button>
                  </div>
                </div>

                {/* Estimación de ganancia */}
                {Number(subscribeAmount) > 0 && (
                  <EstimateBox
                    amount={Number(subscribeAmount)}
                    apr={Number(subscribeProduct.apr)}
                    days={subscribeProduct.duration_days}
                    coin={subscribeProduct.coin_symbol}
                  />
                )}

                {error && (
                  <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSubscribeProduct(null)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubscribe}
                  disabled={isPending || !subscribeAmount}
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Suscribir
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal redimir */}
      <Dialog
        open={!!redeemSubscription}
        onOpenChange={(o) => !o && setRedeemSubscription(null)}
      >
        <DialogContent>
          {redeemSubscription && (
            <>
              <DialogHeader>
                <DialogTitle>Redimir suscripción</DialogTitle>
                <DialogDescription>
                  Vas a recibir capital + intereses acumulados en tu Spot.
                </DialogDescription>
              </DialogHeader>

              <div className="bg-muted/20 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital</span>
                  <span className="font-mono">
                    {formatPrice(Number(redeemSubscription.amount), 4)}{" "}
                    {redeemSubscription.coin_symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Intereses ganados</span>
                  <span className="font-mono text-primary">
                    +{formatPrice(Number(redeemSubscription.accumulated_interest || 0), 6)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border/40 font-semibold">
                  <span>Total a recibir</span>
                  <span className="font-mono">
                    {formatPrice(
                      Number(redeemSubscription.amount) +
                        Number(redeemSubscription.accumulated_interest || 0),
                      4
                    )}{" "}
                    {redeemSubscription.coin_symbol}
                  </span>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setRedeemSubscription(null)}
                  disabled={isPending}
                >
                  Cancelar
                </Button>
                <Button onClick={handleRedeem} disabled={isPending}>
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Redimir ahora
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal cancelar anticipado */}
      <Dialog
        open={!!cancelSubscription}
        onOpenChange={(o) => !o && setCancelSubscription(null)}
      >
        <DialogContent>
          {cancelSubscription && (
            <>
              <DialogHeader>
                <DialogTitle>Cancelar anticipadamente</DialogTitle>
                <DialogDescription>
                  Vas a perder los intereses acumulados y se aplicará el penalty.
                </DialogDescription>
              </DialogHeader>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capital</span>
                  <span className="font-mono">
                    {formatPrice(Number(cancelSubscription.amount), 4)}{" "}
                    {cancelSubscription.coin_symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Penalty ({Number(cancelSubscription.early_cancellation_penalty_percent).toFixed(0)}%)
                  </span>
                  <span className="font-mono text-destructive">
                    −{formatPrice(
                      (Number(cancelSubscription.amount) *
                        Number(cancelSubscription.early_cancellation_penalty_percent)) /
                        100,
                      4
                    )}{" "}
                    {cancelSubscription.coin_symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Intereses (se pierden)</span>
                  <span className="font-mono text-destructive">
                    −{formatPrice(Number(cancelSubscription.accumulated_interest || 0), 6)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border/40 font-semibold">
                  <span>Recibís</span>
                  <span className="font-mono">
                    {formatPrice(
                      Number(cancelSubscription.amount) -
                        (Number(cancelSubscription.amount) *
                          Number(cancelSubscription.early_cancellation_penalty_percent)) /
                          100,
                      4
                    )}{" "}
                    {cancelSubscription.coin_symbol}
                  </span>
                </div>
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCancelSubscription(null)}
                  disabled={isPending}
                >
                  Volver
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancelEarly}
                  disabled={isPending}
                >
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Cancelar anticipadamente
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-lg p-4">
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${
          highlight ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold mt-0.5 font-mono ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
  size = "md",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  size?: "md" | "sm";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md font-medium transition-colors ${
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs"
      } ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}

function ProductCard({
  product,
  userBalance,
  onSubscribe,
}: {
  product: any;
  userBalance: number;
  onSubscribe: () => void;
}) {
  const typeIcons: Record<string, React.ReactNode> = {
    flexible: <Zap className="w-4 h-4" />,
    fixed: <Lock className="w-4 h-4" />,
    shark_fin: <span className="text-base">🦈</span>,
  };
  const typeLabels: Record<string, string> = {
    flexible: "Flexible",
    fixed: `Plazo fijo${product.duration_days ? ` ${product.duration_days}d` : ""}`,
    shark_fin: "Shark Fin",
  };

  const remainingCapacity = product.total_capacity
    ? Number(product.total_capacity) - Number(product.total_subscribed)
    : null;

  return (
    <div className="bg-card border border-border/60 rounded-lg p-5 hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {typeIcons[product.type]}
          </div>
          <div>
            <div className="font-semibold text-sm">{product.name}</div>
            <Badge variant="secondary" className="mt-0.5">
              {typeLabels[product.type]}
            </Badge>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-primary font-mono">
            {Number(product.apr).toFixed(2)}%
          </div>
          <div className="text-[10px] text-muted-foreground">APR</div>
        </div>
      </div>

      {product.description && (
        <p className="text-xs text-muted-foreground mb-3">{product.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3 flex-wrap gap-1">
        <span>
          Min: <span className="font-mono">{Number(product.min_amount).toFixed(0)}</span>{" "}
          {product.coin_symbol}
        </span>
        {product.max_amount && (
          <span>
            Max:{" "}
            <span className="font-mono">{Number(product.max_amount).toFixed(0)}</span>
          </span>
        )}
        {product.payout_mode === "daily" && (
          <span className="text-primary">Pago diario</span>
        )}
      </div>

      {product.type === "shark_fin" && (
        <div className="text-xs bg-muted/20 rounded p-2 mb-3">
          <div className="text-muted-foreground">Rango {product.shark_fin_target_coin}</div>
          <div className="font-mono">
            {Number(product.shark_fin_range_low).toFixed(2)} -{" "}
            {Number(product.shark_fin_range_high).toFixed(2)}
          </div>
        </div>
      )}

      <Button
        className="w-full"
        onClick={onSubscribe}
        disabled={remainingCapacity !== null && remainingCapacity <= 0}
      >
        {remainingCapacity !== null && remainingCapacity <= 0
          ? "Capacidad agotada"
          : "Suscribir"}
        <ArrowRight className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}

function SubscriptionRow({
  sub,
  onRedeem,
  onCancel,
}: {
  sub: any;
  onRedeem: () => void;
  onCancel: () => void;
}) {
  const interest = Number(sub.accumulated_interest || 0);
  const isFlexible = sub.product_type === "flexible";
  const isMatured = sub.ends_at && new Date(sub.ends_at) <= new Date();
  const daysLeft =
    sub.ends_at && !isMatured
      ? Math.ceil(
          (new Date(sub.ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      : null;

  return (
    <div className="bg-card border border-border/60 rounded-lg p-4 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{sub.product_name}</span>
          <Badge variant="warning">{Number(sub.apr).toFixed(2)}% APR</Badge>
          {isMatured && <Badge variant="success">Vencido</Badge>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
          <span>
            Capital:{" "}
            <span className="font-mono text-foreground">
              {formatPrice(Number(sub.amount), 4)} {sub.coin_symbol}
            </span>
          </span>
          <span>
            Intereses:{" "}
            <span className="font-mono text-primary">
              +{formatPrice(interest, 6)}
            </span>
          </span>
          {daysLeft !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {daysLeft} día{daysLeft !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {(isFlexible || isMatured) && (
          <Button size="sm" onClick={onRedeem}>
            Redimir
          </Button>
        )}
        {!isFlexible && !isMatured && sub.early_cancellation_enabled && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancelar anticipado
          </Button>
        )}
      </div>
    </div>
  );
}

function EstimateBox({
  amount,
  apr,
  days,
  coin,
}: {
  amount: number;
  apr: number;
  days: number | null;
  coin: string;
}) {
  if (!days) {
    // Flexible: estimación diaria
    const dailyInterest = (amount * apr) / 100 / 365;
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Estimado por día</span>
          <span className="font-mono text-primary">
            +{formatPrice(dailyInterest, 6)} {coin}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Estimado por mes</span>
          <span className="font-mono text-primary">
            +{formatPrice(dailyInterest * 30, 6)} {coin}
          </span>
        </div>
      </div>
    );
  }

  const periodInterest = (amount * apr * days) / 100 / 365;
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Intereses al vencer ({days} días)</span>
        <span className="font-mono text-primary">
          +{formatPrice(periodInterest, 6)} {coin}
        </span>
      </div>
      <div className="flex justify-between font-semibold pt-1.5 border-t border-border/40">
        <span>Total al vencer</span>
        <span className="font-mono">
          {formatPrice(amount + periodInterest, 6)} {coin}
        </span>
      </div>
    </div>
  );
}
