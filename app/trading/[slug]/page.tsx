import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { slugToSymbol } from "@/lib/coin-slug";
import { TradingView } from "@/components/trading/trading-view";
import { TradePanel } from "@/components/trading/trade-panel";
import { OpenTrades } from "@/components/trading/open-trades";
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

  const { data: coin } = await supabase
    .from("coins")
    .select("*")
    .eq("symbol", symbol)
    .eq("is_active", true)
    .single();

  if (!coin) notFound();

  const { data: wallet } = await supabase
    .from("wallets")
    .select("balance, locked_balance")
    .eq("user_id", user.id)
    .eq("coin_symbol", "USDT")
    .single();

  const { data: settings } = await supabase
    .from("motor_settings")
    .select("trade_fee_percent, allowed_leverages")
    .eq("id", 1)
    .single();

  const balance = Number(wallet?.balance ?? 0);
  const locked = Number(wallet?.locked_balance ?? 0);
  const available = balance - locked;

  const allowedLeverages = (settings?.allowed_leverages || "1,2,5,10,25")
    .split(",")
    .map((s: string) => Number(s.trim()))
    .filter((n: number) => !isNaN(n) && n > 0);

  return (
    <div className="space-y-4">
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
          <span className="font-semibold font-mono">{formatUSDT(available)} USDT</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr,340px] gap-4">
        <div className="space-y-4">
          <TradingView coin={coin} initialPrice={Number(coin.current_price)} />
          <OpenTrades
            userId={user.id}
            coinId={coin.id}
            coin={coin}
            currentPrice={Number(coin.current_price)}
          />
        </div>

        <aside>
          <TradePanel
            coin={coin}
            currentPrice={Number(coin.current_price)}
            available={available}
            allowedLeverages={allowedLeverages}
            feePercent={Number(settings?.trade_fee_percent || 0.1)}
          />
        </aside>
      </div>
    </div>
  );
}
