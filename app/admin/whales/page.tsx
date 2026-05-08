import { createAdminClient } from "@/lib/supabase/admin";
import { WhalesList } from "@/components/admin/whales-list";
import { WhaleCommandCenter } from "@/components/admin/whale-command-center";

export const dynamic = "force-dynamic";

export default async function AdminWhalesPage() {
  const admin = createAdminClient();

  // Cargar todas las whales con su wallet y conteo de trades abiertos
  const { data: whalesRaw } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active, created_at,
      wallets ( balance, locked_balance )
    `)
    .eq("role", "whale")
    .order("created_at", { ascending: false });

  const whales = await Promise.all(
    (whalesRaw || []).map(async (w: any) => {
      const wallet = Array.isArray(w.wallets) ? w.wallets[0] : w.wallets;
      const { count } = await admin
        .from("trades")
        .select("id", { count: "exact", head: true })
        .eq("user_id", w.id)
        .eq("status", "open");

      return {
        ...w,
        balance: wallet?.balance || 0,
        locked_balance: wallet?.locked_balance || 0,
        open_trades_count: count || 0,
      };
    })
  );

  // Cargar coins activas
  const { data: coins } = await admin
    .from("coins")
    .select("id, symbol, current_price, decimals, market_liquidity")
    .eq("is_active", true)
    .order("symbol");

  // Cargar batches pendientes (acciones programadas SOFT)
  const { data: scheduledRaw } = await admin
    .from("whale_scheduled_actions")
    .select("batch_id, execute_at, status")
    .eq("status", "pending")
    .order("execute_at", { ascending: true });

  // Agrupar por batch_id
  const batchMap = new Map<string, { batch_id: string; pending: number; next_at: string }>();
  for (const s of scheduledRaw || []) {
    if (!s.batch_id) continue;
    const existing = batchMap.get(s.batch_id);
    if (existing) {
      existing.pending++;
    } else {
      batchMap.set(s.batch_id, {
        batch_id: s.batch_id,
        pending: 1,
        next_at: s.execute_at,
      });
    }
  }
  const pendingBatches = Array.from(batchMap.values());

  // Stats agregadas
  const totalWhales = whales.filter((w: any) => w.is_active).length;
  const totalAvailable = whales
    .filter((w: any) => w.is_active)
    .reduce(
      (sum: number, w: any) =>
        sum + (Number(w.balance) - Number(w.locked_balance || 0)),
      0
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          🐋 Whales
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cuentas de control que mueven el mercado realmente
        </p>
      </div>

      <WhaleCommandCenter
        coins={coins || []}
        whales={whales}
        totalWhales={totalWhales}
        totalAvailable={totalAvailable}
        pendingBatches={pendingBatches}
      />

      <div>
        <h2 className="text-lg font-semibold mb-3">Whales registradas</h2>
        <WhalesList whales={whales} />
      </div>
    </div>
  );
}
