import { createClient } from "@/lib/supabase/server";
import { Wallet, TrendingUp, Users, Copy } from "lucide-react";
import { formatUSDT } from "@/lib/utils";
import { CopyReferralCode } from "@/components/dashboard/copy-referral";

export default async function DashboardPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance, locked_balance")
    .eq("user_id", user.id)
    .eq("coin_symbol", "USDT")
    .single();

  // Contar referidos directos (nivel 1)
  const { count: referralsCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("referred_by", user.id);

  const balance = wallet?.balance ? Number(wallet.balance) : 0;
  const locked = wallet?.locked_balance ? Number(wallet.locked_balance) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Hola, {profile?.full_name?.split(" ")[0] || "trader"} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          Bienvenido a tu panel de Golbit
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          label="Saldo disponible"
          value={`${formatUSDT(balance)} USDT`}
          highlight
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="En operaciones"
          value={`${formatUSDT(locked)} USDT`}
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Referidos directos"
          value={String(referralsCount || 0)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-card border border-border/60 rounded-lg p-6">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Copy className="w-4 h-4" />
            Tu código de referido
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Compartí este código para invitar a otros y ganar comisiones por sus
            operaciones (10% / 5% / 2% en 3 niveles).
          </p>
          <CopyReferralCode code={profile?.referral_code || ""} />
        </div>

        <div className="bg-card border border-border/60 rounded-lg p-6">
          <h2 className="font-semibold mb-3">Empezá a operar</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Mirá las monedas disponibles, analizá los gráficos y aprendé a leer
            el mercado.
          </p>
          <div className="flex gap-2">
            <a
              href="/trading"
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 text-center transition-opacity"
            >
              Ver monedas
            </a>
            <a
              href="/wallet"
              className="flex-1 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary text-center transition-colors"
            >
              Ver wallet
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
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
    <div
      className={`p-6 rounded-lg border ${
        highlight
          ? "bg-primary/5 border-primary/30"
          : "bg-card border-border/60"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
          highlight
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
