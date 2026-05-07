import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";
import { Coins, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoinsList } from "@/components/admin/coins-list";

export const dynamic = "force-dynamic";

export default async function AdminCoinsPage() {
  const admin = createAdminClient();
  const { data: coins } = await admin
    .from("coins")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Coins className="w-6 h-6" />
            Monedas
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Crear, editar y configurar las monedas que ven los alumnos
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/coins/new">
            <Plus className="w-4 h-4" />
            Crear moneda
          </Link>
        </Button>
      </div>

      <CoinsList coins={coins || []} />
    </div>
  );
}
