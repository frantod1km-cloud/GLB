"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export type AuthResult = {
  error?: string;
  success?: boolean;
};

/**
 * Login con email y password
 */
export async function loginAction(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Completá email y contraseña." };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email o contraseña incorrectos." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Tenés que confirmar tu email primero." };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Registro con email, password y código de referido opcional
 */
export async function registerAction(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const fullName = String(formData.get("full_name") || "").trim();
  const referralCode = String(formData.get("referral_code") || "").trim().toUpperCase();

  // Validaciones
  if (!email || !password || !fullName) {
    return { error: "Completá todos los campos obligatorios." };
  }
  if (password.length < 6) {
    return { error: "La contraseña debe tener al menos 6 caracteres." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Email inválido." };
  }

  const supabase = createClient();

  // Crear usuario en Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { error: "Ese email ya está registrado." };
    }
    return { error: error.message };
  }

  if (!data.user) {
    return { error: "No se pudo crear el usuario." };
  }

  // Si vino con código de referido, aplicarlo (usando service role para bypass RLS)
  if (referralCode) {
    try {
      const admin = createAdminClient();
      await admin.rpc("apply_referral", {
        target_user_id: data.user.id,
        ref_code: referralCode,
      });
      // Si el código es inválido, no falla el registro, solo no se aplica
    } catch (e) {
      console.error("Error aplicando referido:", e);
    }
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Cerrar sesión
 */
export async function logoutAction() {
  const supabase = createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
