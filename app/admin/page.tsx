import { createAdminClient } from "@/lib/supabase/admin";
import { Users, Wallet, Clock, TrendingUp, Activity, Zap } from "lucide-react";
import { formatUSDT } from "@/lib/utils";
import Link from "next/link";
import { EngineStatus } from "@/components/admin/engine-status";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const admin = createAdminClient();

  const [usersRes, walletsRes, pendingTxRes, coinsRes] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("wallets").select("balance, locked_balance"),
    admin
      .from("transactions")
      .select("id, type, amount, status", { count: "exact" })
      .in("status", ["pending", "in_review"]),
    admin
      .from("coins")
      .select("id, symbol, current_price, last_tick_at, is_active")
      .eq("is_active", true)
      .order("last_tick_at", { ascending: false })
      .limit(1),
  ]);

  const totalBalance =
    walletsRes.data?.reduce((sum, w) => sum + Number(w.balance || 0), 0) || 0;

  const pendingDeposits = pendingTxRes.data?.filter((t) => t.type === "deposit").length || 0;
  const pendingWithdrawals = pendingTxRes.data?.filter((t) => t.type === "withdrawal").length || 0;

  const lastTick = coinsRes.data?.[0]?.last_tick_at
    ? new Date(coinsRes.data[0].last_tick_at)
    : null;
  const secondsAgo = lastTick ? Math.floor((Date.now() - lastTick.getTime()) / 1000) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Panel de control</h1>
        <p className="text-muted-foreground mt-1">Vista general de Golbit</p>
      </div>

      <EngineStatus initialSecondsAgo={secondsAgo} initialLastTick={lastTick?.toISOString() || null} />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Usuarios totales"
          value={String(usersRes.count || 0)}
        />
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="USDT en circulación"
          value={`${formatUSDT(totalBalance)}`}
        />
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Depósitos pendientes"
          value={String(pendingDeposits)}
          link="/admin/wallet"
          highlight={pendingDeposits > 0}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Retiros pendientes"
          value={String(pendingWithdrawals)}
          link="/admin/wallet"
          highlight={pendingWithdrawals > 0}
        />
      </div>

      <div className="bg-card border border-border/60 rounded-lg p-6">
        <h2 className="font-semibold mb-3">🚧 Roadmap</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>✅ <strong>Pasos 1-5:</strong> Setup, auth, wallet, monedas, trading view</li>
          <li>⏳ <strong>Paso 6:</strong> Trading real (abrir/cerrar long/short)</li>
          <li>⏳ <strong>Paso 7:</strong> Motor de resultados (fader profit/loss)</li>
          <li>⏳ <strong>Paso 8:</strong> Notificaciones realtime</li>
          <li>⏳ <strong>Paso 9:</strong> Gestión usuarios + roles</li>
          <li>⏳ <strong>Paso 10:</strong> Sistema referidos multinivel</li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  link,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  link?: string;
  highlight?: boolean;
}) {
  const card = (
    <div
      className={`p-5 rounded-lg border transition-colors ${
        highlight
          ? "bg-yellow-500/5 border-yellow-500/30 hover:border-yellow-500/50"
          : "bg-card border-border/60 hover:border-border"
      } ${link ? "cursor-pointer" : ""}`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
          highlight
            ? "bg-yellow-500/20 text-yellow-500"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
  if (link) return <Link href={link}>{card}</Link>;
  return card;
}
