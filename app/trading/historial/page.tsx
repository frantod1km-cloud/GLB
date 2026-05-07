import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, History, TrendingUp, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatUSDT } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HistorialPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trades } = await supabase
    .from("trades")
    .select(`
      *,
      coins ( symbol, name, decimals )
    `)
    .eq("user_id", user.id)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(100);

  // Stats agregadas
  const totalTrades = trades?.length || 0;
  const totalPnl = trades?.reduce((sum, t) => sum + Number(t.pnl || 0), 0) || 0;
  const wins = trades?.filter((t) => Number(t.pnl || 0) > 0).length || 0;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/trading"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver a trading
          </Link>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="w-6 h-6" />
            Historial de operaciones
          </h1>
        </div>
      </div>

      {totalTrades > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatBox
            label="Operaciones"
            value={String(totalTrades)}
          />
          <StatBox
            label="Win rate"
            value={`${winRate.toFixed(1)}%`}
            color={winRate >= 50 ? "primary" : "destructive"}
          />
          <StatBox
            label="PnL total"
            value={`${totalPnl >= 0 ? "+" : ""}${formatUSDT(totalPnl)} USDT`}
            color={totalPnl >= 0 ? "primary" : "destructive"}
          />
        </div>
      )}

      {!trades || trades.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-lg p-12 text-center text-sm text-muted-foreground">
          Aún no cerraste ninguna operación
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
          <div className="divide-y divide-border/40">
            {trades.map((trade: any) => {
              const isLong = trade.direction === "long";
              const pnl = Number(trade.pnl || 0);
              const isProfit = pnl >= 0;
              const closeReason = trade.close_reason || "manual";

              return (
                <div key={trade.id} className="p-4 hover:bg-muted/10 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold font-mono text-sm">
                        {trade.coins?.symbol || "?"}
                      </span>
                      <Badge variant={isLong ? "default" : "destructive"}>
                        {isLong ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {isLong ? "LONG" : "SHORT"}
                      </Badge>
                      <Badge variant="secondary">{trade.leverage}x</Badge>
                      <CloseReasonBadge reason={closeReason} />
                    </div>

                    <div className={`text-right font-mono font-bold ${isProfit ? "text-primary" : "text-destructive"}`}>
                      <div className="text-lg">
                        {isProfit ? "+" : ""}
                        {formatUSDT(pnl)} USDT
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono mt-3">
                    <Field
                      label="Monto"
                      value={`${formatUSDT(Number(trade.amount))} USDT`}
                    />
                    <Field
                      label="Entrada"
                      value={formatPrice(Number(trade.entry_price), trade.coins?.decimals || 4)}
                    />
                    <Field
                      label="Salida"
                      value={formatPrice(Number(trade.exit_price), trade.coins?.decimals || 4)}
                    />
                    <Field
                      label="Cierre"
                      value={new Date(trade.closed_at).toLocaleString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({
  label,
  value,
  color = "default",
}: {
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
    <div className="bg-card border border-border/60 rounded-lg p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function CloseReasonBadge({ reason }: { reason: string }) {
  const map: Record<string, { label: string; variant: any }> = {
    manual: { label: "Manual", variant: "secondary" },
    stop_loss: { label: "🛑 SL", variant: "destructive" },
    take_profit: { label: "🎯 TP", variant: "success" },
    liquidation: { label: "⚠️ Liquidación", variant: "destructive" },
    admin: { label: "Admin", variant: "warning" },
  };
  const m = map[reason] || { label: reason, variant: "secondary" };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
