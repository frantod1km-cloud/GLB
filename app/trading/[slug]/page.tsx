import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { slugToSymbol } from "@/lib/coin-slug";
import { TradingView } from "@/components/trading/trading-view";
import { TradePanelPlaceholder } from "@/components/trading/trade-panel-placeholder";
import { formatUSDT } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TradingDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createClient();
  const symbol = slugToSymbol(params.slug);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Buscar la moneda por símbolo
  const { data: coin } = await supabase
    .from("coins")
    .select("*")
    .eq("symbol", symbol)
    .eq("is_active", true)
    .single();

  if (!coin) notFound();

  // Saldo del usuario
  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance, locked_balance")
    .eq("user_id", user.id)
    .eq("coin_symbol", "USDT")
    .single();

  const available =
    Number(wallet?.balance ?? 0) - Number(wallet?.locked_balance ?? 0);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          href="/trading"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a monedas
        </Link>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-card border border-border/60 text-sm">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">Disponible:</span>
          <span className="font-semibold font-mono">
            {formatUSDT(available)} USDT
          </span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr,320px] gap-4">
        <TradingView coin={coin} initialPrice={Number(coin.current_price)} />

        <aside>
          <TradePanelPlaceholder />
        </aside>
      </div>
    </div>
  );
}
