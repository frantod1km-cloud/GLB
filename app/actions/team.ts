"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type TeamResult = { error?: string; success?: boolean; adminId?: string };

async function ensureSuperAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado", user: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "super_admin") return { error: "Solo super_admin", user: null };

  return { error: null, user };
}

/**
 * Crear nuevo admin (solo super_admin)
 */
export async function createAdminAction(formData: FormData): Promise<TeamResult> {
  const auth = await ensureSuperAdmin();
  if (auth.error) return { error: auth.error };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const password = String(formData.get("password") || "");
  const initialBalance = Number(formData.get("initial_balance") || 0);

  if (!email || !fullName) return { error: "Email y nombre obligatorios" };
  if (!email.includes("@")) return { error: "Email inválido" };
  if (password.length < 8) return { error: "Contraseña mínimo 8 caracteres" };

  const admin = createAdminClient();

  // Crear usuario en auth
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    if (authError.message.includes("already")) return { error: "Ese email ya existe" };
    return { error: authError.message };
  }

  if (!created.user) return { error: "No se pudo crear el admin" };
  const adminId = created.user.id;

  // Asignar role admin
  await admin
    .from("profiles")
    .update({ role: "admin", full_name: fullName })
    .eq("id", adminId);

  // Si vino un saldo inicial, asignárselo
  if (initialBalance > 0) {
    const supabase = createClient();
    await supabase.rpc("admin_assign_balance", {
      p_admin_id: adminId,
      p_amount: initialBalance,
      p_notes: "Saldo inicial al crear el admin",
    });
  }

  revalidatePath("/admin/team");
  return { success: true, adminId };
}

/**
 * Asignar saldo a un admin
 */
export async function assignAdminBalanceAction(
  adminId: string,
  amount: number,
  notes?: string
): Promise<TeamResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_assign_balance", {
    p_admin_id: adminId,
    p_amount: amount,
    p_notes: notes || null,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Revocar saldo de un admin
 */
export async function revokeAdminBalanceAction(
  adminId: string,
  amount: number,
  notes?: string
): Promise<TeamResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_revoke_balance", {
    p_admin_id: adminId,
    p_amount: amount,
    p_notes: notes || null,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/team");
  return { success: true };
}

/**
 * Eliminar admin (solo super)
 */
export async function deleteAdminAction(adminId: string): Promise<TeamResult> {
  const auth = await ensureSuperAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", adminId)
    .single();

  if (target?.role !== "admin") {
    return { error: "Solo se pueden borrar admins desde acá" };
  }

  const { error } = await admin.auth.admin.deleteUser(adminId);
  if (error) return { error: error.message };

  revalidatePath("/admin/team");
  return { success: true };
}
