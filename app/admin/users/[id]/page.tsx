import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Wallet,
  Activity,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatUSDT } from "@/lib/utils";
import { UserActions } from "@/components/admin/user-actions";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function UserDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const me = await requireAdmin();
  const isSuperAdmin = me.role === "super_admin";
  const admin = createAdminClient();

  const { data: user } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active, created_at, referral_code,
      wallets ( balance, locked_balance )
    `)
    .eq("id", params.id)
    .single();

  if (!user) notFound();

  // Solo permitir ver detalles de students
  if (user.role !== "student") {
    notFound();
  }

  const wallet = Array.isArray(user.wallets) ? user.wallets[0] : user.wallets;
  const balance = Number(wallet?.balance || 0);
  const locked = Number(wallet?.locked_balance || 0);
  const available = balance - locked;

  // Trades recientes
  const { data: recentTrades } = await admin
    .from("trades")
    .select("*, coins ( symbol, decimals )")
    .eq("user_id", params.id)
    .order("opened_at", { ascending: false })
    .limit(20);

  const openCount =
    recentTrades?.filter((t: any) => t.status === "open").length || 0;
  const closedTrades =
    recentTrades?.filter((t: any) => t.status === "closed") || [];
  const totalPnl = closedTrades.reduce(
    (sum: number, t: any) => sum + Number(t.pnl || 0),
    0
  );

  // Transacciones recientes
  const { data: recentTx } = await admin
    .from("transactions")
    .select("*")
    .eq("user_id", params.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a usuarios
        </Link>
        <div className="flex items-start gap-3 mt-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary">
            {(user.full_name || user.email || "?").slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {user.full_name || "Sin nombre"}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">{user.email}</span>
              {user.is_active ? (
                <Badge variant="default">Activo</Badge>
              ) : (
                <Badge variant="destructive">Bloqueado</Badge>
              )}
              {user.referral_code && (
                <span className="text-xs text-muted-foreground font-mono">
                  Ref: {user.referral_code}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Registrado el{" "}
              {new Date(user.created_at).toLocaleString("es-AR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr,320px] gap-6">
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox
              icon={<Wallet className="w-4 h-4" />}
              label="Saldo total"
              value={`${formatUSDT(balance)} USDT`}
            />
            <StatBox
              label="Disponible"
              value={`${formatUSDT(available)} USDT`}
            />
            <StatBox
              icon={<Activity className="w-4 h-4" />}
              label="Operaciones abiertas"
              value={String(openCount)}
              color={openCount > 0 ? "primary" : "default"}
            />
            <StatBox
              label="PnL acumulado"
              value={`${totalPnl >= 0 ? "+" : ""}${formatUSDT(totalPnl)}`}
              color={totalPnl >= 0 ? "primary" : "destructive"}
            />
          </div>

          {/* Trades recientes */}
          <div>
            <h2 className="text-lg font-semibold mb-3">
              Operaciones recientes
            </h2>
            {!recentTrades || recentTrades.length === 0 ? (
              <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
                Este usuario no tiene operaciones todavía
              </div>
            ) : (
              <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
                <div className="divide-y divide-border/40">
                  {recentTrades.map((trade: any) => {
                    const isLong = trade.direction === "long";
                    const isOpen = trade.status === "open";
                    const pnl = Number(trade.pnl || 0);
                    const isProfit = pnl >= 0;

                    return (
                      <div
                        key={trade.id}
                        className="p-3 hover:bg-muted/10 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs">
                              {trade.coins?.symbol}
                            </span>
                            <Badge
                              variant={isLong ? "default" : "destructive"}
                            >
                              {isLong ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              {isLong ? "LONG" : "SHORT"}
                            </Badge>
                            <Badge variant="secondary">{trade.leverage}x</Badge>
                            {isOpen ? (
                              <Badge variant="success">Abierta</Badge>
                            ) : (
                              <Badge variant="secondary">
                                {trade.close_reason}
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground font-mono">
                              {formatUSDT(Number(trade.amount))} USDT
                            </span>
                          </div>
                          {!isOpen && (
                            <span
                              className={`font-mono font-semibold text-sm ${
                                isProfit ? "text-primary" : "text-destructive"
                              }`}
                            >
                              {isProfit ? "+" : ""}
                              {formatUSDT(pnl)} USDT
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Movimientos wallet */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Últimos movimientos</h2>
            {!recentTx || recentTx.length === 0 ? (
              <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
                Sin movimientos en wallet
              </div>
            ) : (
              <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
                <div className="divide-y divide-border/40">
                  {recentTx.map((tx: any) => (
                    <div key={tx.id} className="p-3 text-sm flex items-center gap-3 flex-wrap">
                      <Badge variant="secondary">{tx.type}</Badge>
                      <Badge
                        variant={
                          tx.status === "completed"
                            ? "success"
                            : tx.status === "rejected"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {tx.status}
                      </Badge>
                      <span className="font-mono text-sm">
                        {Number(tx.amount) >= 0 ? "+" : ""}
                        {formatUSDT(Number(tx.amount))} USDT
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(tx.created_at).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <aside>
          <UserActions user={user} isSuperAdmin={isSuperAdmin} />
        </aside>
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  color = "default",
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  color?: "default" | "primary" | "destructive";
}) {
  const colorClass =
    color === "primary"
      ? "text-primary"
      : color === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="bg-card border border-border/60 rounded-lg p-3">
      {icon && <div className="text-muted-foreground mb-1">{icon}</div>}
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-0.5 font-mono ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}
