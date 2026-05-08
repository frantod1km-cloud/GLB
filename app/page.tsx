import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wallet, TrendingUp, Activity } from "lucide-react";
import { formatUSDT } from "@/lib/utils";
import { CopyReferralCode } from "@/components/dashboard/copy-referral";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, referral_code")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login");

  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance, locked_balance")
    .eq("user_id", user.id)
    .eq("coin_symbol", "USDT")
    .single();

  const balance = Number(wallet?.balance || 0);
  const locked = Number(wallet?.locked_balance || 0);
  const available = balance - locked;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Hola, {profile.full_name?.split(" ")[0] || "trader"}
        </h1>
        <p className="text-muted-foreground mt-1">
          Resumen de tu cuenta
        </p>
      </div>

      {/* Saldo principal */}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-lg p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wallet className="w-4 h-4" />
          Saldo total
        </div>
        <div className="text-4xl font-bold mt-2 font-mono">
          {formatUSDT(balance)} <span className="text-xl text-muted-foreground">USDT</span>
        </div>
        <div className="text-sm text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Disponible:{" "}
            <span className="text-foreground font-mono font-medium">
              {formatUSDT(available)}
            </span>
          </span>
          {locked > 0 && (
            <span>
              En operaciones:{" "}
              <span className="text-foreground font-mono font-medium">
                {formatUSDT(locked)}
              </span>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* CTA Trading */}
        <div className="bg-card border border-border/60 rounded-lg p-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
            <Activity className="w-5 h-5" />
          </div>
          <h2 className="font-semibold mb-2">Operar</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Mirá las monedas disponibles y abrí posiciones long o short.
          </p>
          <a
            href="/trading"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Ir al trading
            <TrendingUp className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Wallet */}
        <div className="bg-card border border-border/60 rounded-lg p-6">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
            <Wallet className="w-5 h-5" />
          </div>
          <h2 className="font-semibold mb-2">Wallet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Depositá, retirá y consultá tu historial de movimientos.
          </p>
          <a
            href="/wallet"
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary transition-colors"
          >
            Ver wallet
          </a>
        </div>
      </div>

      {/* Referidos */}
      {profile.referral_code && (
        <div className="bg-card border border-border/60 rounded-lg p-6">
          <h2 className="font-semibold mb-2">Tu código de referido</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Compartilo y ganá comisiones sobre las operaciones de tus referidos.
          </p>
          <CopyReferralCode code={profile.referral_code} />
        </div>
      )}
    </div>
  );
}
