import { createAdminClient } from "@/lib/supabase/admin";
import { AdminTransactionRow } from "@/components/admin/transaction-row";
import { Wallet, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminWalletPage() {
  const admin = createAdminClient();

  // Cargar transacciones pendientes y procesadas con info del usuario
  const { data: transactions } = await admin
    .from("transactions")
    .select(`
      id, type, amount, status, review_until, notes,
      proof_url, wallet_address, user_wallet,
      created_at, processed_at, user_id,
      profiles!transactions_user_id_fkey ( email, full_name )
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const pending = (transactions || []).filter(
    (t: any) => t.status === "pending" || t.status === "in_review"
  );
  const processed = (transactions || []).filter(
    (t: any) => t.status === "approved" || t.status === "rejected" || t.status === "completed"
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Wallet className="w-6 h-6" />
          Wallet ops
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Aprobar o rechazar depósitos y retiros pendientes
        </p>
      </div>

      <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border/60 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Pendientes ({pending.length})
          </h2>
        </div>

        {pending.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            ✨ No hay transacciones pendientes
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {pending.map((tx: any) => (
              <AdminTransactionRow
                key={tx.id}
                tx={tx}
                userInfo={tx.profiles || { email: "?", full_name: null }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border/60">
          <h2 className="font-semibold">Historial procesado ({processed.length})</h2>
        </div>

        {processed.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Aún no hay transacciones procesadas
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {processed.slice(0, 30).map((tx: any) => (
              <AdminTransactionRow
                key={tx.id}
                tx={tx}
                userInfo={tx.profiles || { email: "?", full_name: null }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
