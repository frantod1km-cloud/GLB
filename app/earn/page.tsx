import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EarnView } from "@/components/earn/earn-view";

export const dynamic = "force-dynamic";

export default async function EarnPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [productsRes, subsRes, holdingsRes] = await Promise.all([
    admin
      .from("earn_products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("earn_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("spot_holdings").select("coin_symbol, amount").eq("user_id", user.id),
  ]);

  const holdings: Record<string, number> = {};
  for (const h of holdingsRes.data || []) {
    holdings[h.coin_symbol] = Number(h.amount || 0);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Earn</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Hacé crecer tus monedas con intereses pasivos
        </p>
      </div>

      <EarnView
        userId={user.id}
        initialProducts={productsRes.data || []}
        initialSubscriptions={subsRes.data || []}
        initialHoldings={holdings}
      />
    </div>
  );
}
