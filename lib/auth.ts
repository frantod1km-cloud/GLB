import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type UserRole = "student" | "admin" | "super_admin" | "whale" | "bot";

export async function getCurrentProfile() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, referral_code, is_active")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin" && profile.role !== "super_admin") {
    redirect("/dashboard");
  }
  return profile;
}

export async function requireSuperAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "super_admin") {
    redirect("/admin");
  }
  return profile;
}
