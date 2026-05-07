import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Activity } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { CoinForm } from "@/components/admin/coin-form";
import { CoinPreview } from "@/components/admin/coin-preview";

export const dynamic = "force-dynamic";

export default async function EditCoinPage({ params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: coin } = await admin
    .from("coins")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!coin) notFound();

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link
          href="/admin/coins"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a monedas
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2 font-mono">
          {coin.symbol}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{coin.name}</p>
      </div>

      <div className="bg-card border border-border/60 rounded-lg p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4" />
          Preview en vivo (motor activo)
        </h3>
        <CoinPreview coin={coin} />
      </div>

      <CoinForm initial={coin} />
    </div>
  );
}
