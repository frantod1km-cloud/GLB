import { Users } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsersList } from "@/components/admin/users-list";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireAdmin();
  const admin = createAdminClient();

  // Solo students (admins se gestionan en /admin/team, whales/bots tienen sus páginas)
  const { data: usersRaw } = await admin
    .from("profiles")
    .select(`
      id, email, full_name, role, is_active, created_at,
      wallets ( balance, locked_balance )
    `)
    .eq("role", "student")
    .order("created_at", { ascending: false });

  const users = (usersRaw || []).map((u: any) => {
    const wallet = Array.isArray(u.wallets) ? u.wallets[0] : u.wallets;
    return {
      ...u,
      balance: wallet?.balance || 0,
      locked_balance: wallet?.locked_balance || 0,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="w-6 h-6" />
          Usuarios
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {users.length} usuario{users.length !== 1 ? "s" : ""} registrado
          {users.length !== 1 ? "s" : ""}
        </p>
      </div>

      <UsersList users={users} />
    </div>
  );
}
