import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard/nav";
import { PiggyBank } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EarnPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, referral_code")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav profile={profile} />
      <main className="container py-8 max-w-4xl">
        <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
          <PiggyBank className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <h1 className="text-2xl font-bold tracking-tight">Earn</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Próximamente disponible
          </p>
        </div>
      </main>
    </div>
  );
}
