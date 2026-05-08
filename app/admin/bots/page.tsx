import { createAdminClient } from "@/lib/supabase/admin";
import { BotsList } from "@/components/admin/bots-list";

export const dynamic = "force-dynamic";

export default async function AdminBotsPage() {
  const admin = createAdminClient();

  // Cargar profiles + bots config + wallets
  const { data: botsRaw } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active, created_at,
      wallets ( balance, locked_balance ),
      bots ( personality, tick_interval_seconds, amount_min, amount_max, leverage, close_probability, last_action_at )
    `)
    .eq("role", "bot")
    .order("created_at", { ascending: false });

  const bots = await Promise.all(
    (botsRaw || []).map(async (b: any) => {
      const wallet = Array.isArray(b.wallets) ? b.wallets[0] : b.wallets;
      const config = Array.isArray(b.bots) ? b.bots[0] : b.bots;

      const { count } = await admin
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("user_id", b.id)
        .eq("status", "open");

      return {
        ...b,
        ...config,
        balance: wallet?.balance || 0,
        locked_balance: wallet?.locked_balance || 0,
        open_trades_count: count || 0,
      };
    })
  );

  const activeBots = bots.filter((b: any) => b.is_active).length;
  const totalBalance = bots.reduce((sum, b) => sum + Number(b.balance || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          🤖 Bots de mercado
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cuentas automáticas que generan ruido natural y volumen
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total bots" value={String(bots.length)} />
        <Stat label="Activos" value={String(activeBots)} highlight={activeBots > 0} />
        <Stat
          label="Saldo total"
          value={`${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(totalBalance)} USDT`}
        />
      </div>

      <BotsList bots={bots} />
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-card border border-border/60 rounded-lg p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-2xl font-bold mt-1 font-mono ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
