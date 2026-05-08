"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type UserResult = { error?: string; success?: boolean };

async function ensureAdmin() {
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
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return { error: "Solo admins", user: null };
  }
  return { error: null, user };
}

/**
 * Activar / desactivar usuario (bloqueo)
 */
export async function toggleUserActiveAction(
  userId: string,
  isActive: boolean
): Promise<UserResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Verificar que NO sea otro admin/super_admin (no se pueden bloquear entre admins)
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (target?.role === "admin" || target?.role === "super_admin") {
    return { error: "No se pueden bloquear admins desde acá" };
  }

  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

/**
 * Editar nombre del usuario
 */
export async function updateUserNameAction(
  userId: string,
  fullName: string
): Promise<UserResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  if (!fullName.trim()) return { error: "El nombre no puede estar vacío" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: fullName.trim(), updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

/**
 * Forzar reset de password (envía email)
 */
export async function resetUserPasswordAction(userId: string): Promise<UserResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();

  if (!target?.email) return { error: "Usuario no encontrado" };

  const { error } = await admin.auth.resetPasswordForEmail(target.email);
  if (error) return { error: error.message };

  return { success: true };
}

/**
 * Borrar usuario (solo super_admin)
 */
export async function deleteUserAction(userId: string): Promise<UserResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (actorProfile?.role !== "super_admin") {
    return { error: "Solo super_admin puede borrar usuarios" };
  }

  const admin = createAdminClient();

  // Verificar que NO sea otro admin/super_admin
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (target?.role === "super_admin") {
    return { error: "No se puede borrar un super_admin" };
  }

  // Cancelar trades abiertos
  await admin
    .from("trades")
    .update({ status: "cancelled", closed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "open");

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/admin/users");
  return { success: true };
}
