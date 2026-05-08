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

  // Aplanar el resultado y contar trades abiertos
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

      {/* Centro de comando arriba */}
      <WhaleCommandCenter
        coins={coins || []}
        totalWhales={totalWhales}
        totalAvailable={totalAvailable}
      />

      {/* Lista de whales abajo */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Whales registradas</h2>
        <WhalesList whales={whales} />
      </div>
    </div>
  );
}
