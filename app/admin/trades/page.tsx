import Link from "next/link";
import { Activity } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminTradesTable } from "@/components/admin/trades-table";

export const dynamic = "force-dynamic";

export default async function AdminTradesPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const admin = createAdminClient();
  const filter = searchParams.filter || "open";

  let query = admin
    .from("trades")
    .select(`
      *,
      profiles!trades_user_id_fkey!inner ( email, full_name, role ),
      coins ( symbol, decimals )
    `)
    .eq("profiles.role", "student")
    .order(filter === "closed" ? "closed_at" : "opened_at", { ascending: false })
    .limit(100);

  if (filter === "open") query = query.eq("status", "open");
  if (filter === "closed") query = query.eq("status", "closed");

  const { data: trades } = await query;

  const filters = [
    { id: "open", label: "Abiertas" },
    { id: "closed", label: "Cerradas" },
    { id: "all", label: "Todas" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6" />
          Operaciones
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Trades de todos los usuarios
        </p>
      </div>

      <div className="flex gap-1">
        {filters.map((f) => (
          <Link
            key={f.id}
            href={`/admin/trades?filter=${f.id}`}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <AdminTradesTable trades={trades || []} />
    </div>
  );
}
