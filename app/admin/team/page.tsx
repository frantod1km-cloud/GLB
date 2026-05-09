import { HandCoins, ScrollText } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamList } from "@/components/admin/team-list";
import { Badge } from "@/components/ui/badge";
import { formatUSDT } from "@/lib/utils";
import { requireSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  await requireSuperAdmin();
  const admin = createAdminClient();

  // Cargar admins + super_admin con sus balances
  const { data: profilesRaw } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at")
    .in("role", ["admin", "super_admin"])
    .order("role", { ascending: false }) // super_admin primero
    .order("created_at", { ascending: true });

  // Para cada admin, traer su balance
  const admins = await Promise.all(
    (profilesRaw || []).map(async (p: any) => {
      if (p.role === "super_admin") {
        return { ...p, total_assigned: 0, total_spent: 0, available: 0, unlimited: true };
      }
      const { data: balance } = await admin
        .from("admin_balances")
        .select("total_assigned, total_spent, available")
        .eq("admin_id", p.id)
        .single();
      return {
        ...p,
        total_assigned: balance?.total_assigned || 0,
        total_spent: balance?.total_spent || 0,
        available: balance?.available || 0,
      };
    })
  );

  // Movimientos recientes
  const { data: movementsRaw } = await admin
    .from("admin_balance_movements")
    .select(`
      id, type, amount, notes, created_at,
      admin:admin_id ( full_name, email ),
      target:target_user_id ( full_name, email ),
      performer:performed_by ( full_name, email )
    `)
    .order("created_at", { ascending: false })
    .limit(20);

  const movements = movementsRaw || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <HandCoins className="w-6 h-6" />
          Equipo y saldos
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Administradores del sistema y sus saldos asignados
        </p>
      </div>

      <TeamList admins={admins} />

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <ScrollText className="w-5 h-5" />
          Movimientos recientes
        </h2>

        {movements.length === 0 ? (
          <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
            Sin movimientos todavía
          </div>
        ) : (
          <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
            <div className="divide-y divide-border/40">
              {movements.map((m: any) => {
                const isPositive = Number(m.amount) > 0;
                const typeLabels: Record<string, { label: string; color: string }> = {
                  assignment: { label: "Asignación", color: "default" },
                  transfer: { label: "Transferencia", color: "secondary" },
                  revoke: { label: "Revocación", color: "destructive" },
                  refund: { label: "Reembolso", color: "warning" },
                };
                const typeInfo = typeLabels[m.type] || { label: m.type, color: "secondary" };

                return (
                  <div key={m.id} className="p-3 flex items-center gap-3 flex-wrap text-sm">
                    <Badge variant={typeInfo.color as any}>{typeInfo.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {m.admin?.full_name || m.admin?.email}
                    </span>
                    {m.target && (
                      <>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-xs">
                          {m.target.full_name || m.target.email}
                        </span>
                      </>
                    )}
                    <span
                      className={`font-mono font-semibold ${
                        isPositive ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {isPositive ? "+" : ""}
                      {formatUSDT(Number(m.amount))} USDT
                    </span>
                    {m.notes && (
                      <span className="text-xs text-muted-foreground italic">
                        ({m.notes})
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(m.created_at).toLocaleString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
