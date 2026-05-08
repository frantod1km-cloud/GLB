import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardNav } from "@/components/dashboard/nav";
import NotificationsClientPage from "@/components/notifications/notifications-page";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
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
      <main className="container py-8 max-w-3xl">
        <NotificationsClientPage userId={user.id} />
      </main>
    </div>
  );
}
