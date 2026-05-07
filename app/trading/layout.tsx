import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard/nav";

export default async function TradingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <main className="container py-8">{children}</main>
    </div>
  );
}
