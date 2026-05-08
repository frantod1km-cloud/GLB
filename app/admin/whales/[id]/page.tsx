import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { WhaleTrades } from "@/components/admin/whale-trades";
import { Badge } from "@/components/ui/badge";
import { formatUSDT } from "@/lib/utils";
import { requireSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WhaleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireSuperAdmin();
  const admin = createAdminClient();

  // Verificar que es whale
  const { data: whale } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active, created_at,
      wallets ( balance, locked_balance )
    `)
    .eq("id", params.id)
    .eq("role", "whale")
    .single();

  if (!whale) notFound();

  const wallet = Array.isArray(whale.wallets) ? whale.wallets[0] : whale.wallets;
  const balance = Number(wallet?.balance || 0);
  const locked = Number(wallet?.locked_balance || 0);
  const available = balance - locked;

  // Trades de esta whale
  const { data: trades } = await admin
    .from("trades")
    .select(`
      *,
      coins ( symbol, decimals )
    `)
    .eq("user_id", params.id)
    .order("opened_at", { ascending: false })
    .limit(200);

  const openCount = trades?.filter((t: any) => t.status === "open").length || 0;
  const closedCount = trades?.filter((t: any) => t.status === "closed").length || 0;

  // Stats
  const totalPnl =
    trades
      ?.filter((t: any) => t.status === "closed")
      .reduce((sum: number, t: any) => sum + Number(t.pnl || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/whales"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a whales
        </Link>
        <div className="flex items-start gap-3 mt-2">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-2xl">
            🐋
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {whale.full_name}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">{whale.email}</span>
              {whale.is_active ? (
                <Badge variant="default">Activa</Badge>
              ) : (
                <Badge variant="secondary">Inactiva</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Saldo total" value={`${formatUSDT(balance)} USDT`} />
        <StatBox label="Disponible" value={`${formatUSDT(available)} USDT`} />
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
        <WhaleTrades trades={trades || []} />
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
