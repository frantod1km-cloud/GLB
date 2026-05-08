import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { BotTrades } from "@/components/admin/bot-trades";
import { Badge } from "@/components/ui/badge";
import { formatUSDT } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PERSONALITY_LABELS: Record<string, { label: string; emoji: string }> = {
  random: { label: "Random", emoji: "🎲" },
  momentum: { label: "Momentum", emoji: "📈" },
  mean_reversion: { label: "Mean Reversion", emoji: "🔄" },
};

export default async function BotDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const admin = createAdminClient();

  const { data: bot } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active,
      wallets ( balance, locked_balance ),
      bots ( personality, tick_interval_seconds, amount_min, amount_max, leverage, close_probability, last_action_at )
    `)
    .eq("id", params.id)
    .eq("role", "bot")
    .single();

  if (!bot) notFound();

  const wallet = Array.isArray(bot.wallets) ? bot.wallets[0] : bot.wallets;
  const config = Array.isArray(bot.bots) ? bot.bots[0] : bot.bots;
  const balance = Number(wallet?.balance || 0);
  const locked = Number(wallet?.locked_balance || 0);
  const personality = config?.personality || "random";
  const personalityInfo = PERSONALITY_LABELS[personality];

  const { data: trades } = await admin
    .from("trades")
    .select(`*, coins ( symbol, decimals )`)
    .eq("user_id", params.id)
    .order("opened_at", { ascending: false })
    .limit(200);

  const openCount = trades?.filter((t: any) => t.status === "open").length || 0;
  const closedCount = trades?.filter((t: any) => t.status === "closed").length || 0;

  const totalPnl =
    trades
      ?.filter((t: any) => t.status === "closed")
      .reduce((sum: number, t: any) => sum + Number(t.pnl || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/bots"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a bots
        </Link>
        <div className="flex items-start gap-3 mt-2">
          <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center text-2xl">
            {personalityInfo?.emoji || "🤖"}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{bot.full_name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">{bot.email}</span>
              {bot.is_active ? (
                <Badge variant="default">Activo</Badge>
              ) : (
                <Badge variant="secondary">Pausado</Badge>
              )}
              <Badge variant="warning">{personalityInfo?.label || personality}</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Config compacta */}
      {config && (
        <div className="bg-card border border-border/60 rounded-lg p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Tick interval</div>
            <div className="font-mono font-semibold">{config.tick_interval_seconds}s</div>
          </div>
          <div>
            <div className="text-muted-foreground">Rango monto</div>
            <div className="font-mono font-semibold">
              {formatUSDT(Number(config.amount_min))} - {formatUSDT(Number(config.amount_max))}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Leverage</div>
            <div className="font-mono font-semibold">{config.leverage}x</div>
          </div>
          <div>
            <div className="text-muted-foreground">Prob cierre</div>
            <div className="font-mono font-semibold">{Number(config.close_probability) * 100}%</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Saldo total" value={`${formatUSDT(balance)} USDT`} />
        <StatBox
          label="Disponible"
          value={`${formatUSDT(balance - locked)} USDT`}
        />
        <StatBox
          label="Operaciones abiertas"
          value={String(openCount)}
          color={openCount > 0 ? "primary" : "default"}
        />
        <StatBox
          label="PnL acumulado"
          value={`${totalPnl >= 0 ? "+" : ""}${formatUSDT(totalPnl)} USDT`}
          color={totalPnl >= 0 ? "primary" : "destructive"}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">
          Operaciones ({openCount} abiertas / {closedCount} cerradas)
        </h2>
        <BotTrades trades={trades || []} />
      </div>
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
      <div className={`text-xl font-bold mt-1 font-mono ${colorClass}`}>{value}</div>
    </div>
  );
}
