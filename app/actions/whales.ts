"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type WhaleResult = { error?: string; success?: boolean; whaleId?: string; data?: any };

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
  if (profile?.role !== "admin") return { error: "Solo admins", user: null };

  return { error: null, user };
}

/**
 * Crear nueva whale: usa admin SDK para crear el usuario en auth.users,
 * después le asigna role='whale' y le carga saldo inicial.
 */
export async function createWhaleAction(formData: FormData): Promise<WhaleResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const initialBalance = Number(formData.get("initial_balance"));

  if (!email || !fullName) return { error: "Email y nombre obligatorios" };
  if (!email.includes("@")) return { error: "Email inválido" };
  if (initialBalance < 0) return { error: "Saldo inicial inválido" };

  const admin = createAdminClient();

  // Generar password aleatorio (la whale no se loguea, vos la controlás)
  const randomPassword = crypto.randomUUID() + crypto.randomUUID();

  // Crear usuario en auth con email confirmado
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: randomPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authError) {
    if (authError.message.includes("already")) return { error: "Ese email ya existe" };
    return { error: authError.message };
  }

  if (!created.user) return { error: "No se pudo crear la whale" };

  const whaleId = created.user.id;

  // El trigger handle_new_user creó el profile como 'student' por default.
  // Lo actualizamos a 'whale'
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role: "whale", full_name: fullName })
    .eq("id", whaleId);

  if (profileError) return { error: profileError.message };

  // Setear saldo inicial (asegurar wallet)
  await admin.from("wallets").upsert(
    {
      user_id: whaleId,
      coin_symbol: "USDT",
      balance: initialBalance,
    },
    { onConflict: "user_id,coin_symbol" }
  );

  revalidatePath("/admin/whales");
  return { success: true, whaleId };
}

/**
 * Editar saldo de una whale (set absoluto, no relativo)
 */
export async function setWhaleBalanceAction(
  whaleId: string,
  balance: number
): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_whale_balance", {
    p_whale_id: whaleId,
    p_amount: balance,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true };
}

/**
 * Activar/desactivar whale
 */
export async function toggleWhaleAction(
  whaleId: string,
  isActive: boolean
): Promise<WhaleResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", whaleId)
    .eq("role", "whale");

  if (error) return { error: error.message };

  revalidatePath("/admin/whales");
  return { success: true };
}

/**
 * Eliminar whale (borra el usuario en auth.users → cascada borra todo)
 */
export async function deleteWhaleAction(whaleId: string): Promise<WhaleResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Verificar que efectivamente sea whale
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", whaleId)
    .single();

  if (profile?.role !== "whale") {
    return { error: "Solo se pueden eliminar whales desde acá" };
  }

  // Cerrar trades abiertos primero (soltar locked_balance)
  await admin
    .from("trades")
    .update({ status: "cancelled", closed_at: new Date().toISOString() })
    .eq("user_id", whaleId)
    .eq("status", "open");

  // Borrar usuario en auth (cascada borra profile, wallet, trades, transactions, etc)
  const { error } = await admin.auth.admin.deleteUser(whaleId);
  if (error) return { error: error.message };

  revalidatePath("/admin/whales");
  return { success: true };
}

/**
 * Comando masivo: PUMP, DUMP, STOP
 */
export async function whaleCommandAction(
  coinId: string,
  command: "pump" | "dump" | "stop",
  totalAmount: number,
  leverage: number
): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_whale_command", {
    p_coin_id: coinId,
    p_command: command,
    p_total_amount: totalAmount,
    p_leverage: leverage,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true, data };
}

/**
 * Actualizar liquidez de mercado de una moneda
 */
export async function updateMarketLiquidityAction(
  coinId: string,
  liquidity: number
): Promise<WhaleResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };
  if (liquidity <= 0) return { error: "Liquidez debe ser mayor a 0" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("coins")
    .update({ market_liquidity: liquidity, updated_at: new Date().toISOString() })
    .eq("id", coinId);

  if (error) return { error: error.message };

  revalidatePath("/admin/whales");
  revalidatePath("/admin/coins");
  return { success: true };
}

/**
 * SOFT command - reparte la presión en N segundos
 */
export async function whaleSoftCommandAction(
  coinId: string,
  command: "soft_pump" | "soft_dump",
  totalAmount: number,
  leverage: number,
  durationSeconds: number
): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_whale_soft_command", {
    p_coin_id: coinId,
    p_command: command,
    p_total_amount: totalAmount,
    p_leverage: leverage,
    p_duration_seconds: durationSeconds,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true, data };
}

/**
 * Cancelar un batch de SOFT pendientes
 */
export async function cancelWhaleBatchAction(batchId: string): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_cancel_whale_batch", {
    p_batch_id: batchId,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true, data };
}

/**
 * PRECISION - una whale específica + monto + dirección
 */
export async function whalePrecisionAction(
  whaleId: string,
  coinId: string,
  direction: "long" | "short",
  amount: number,
  leverage: number
): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_whale_precision", {
    p_whale_id: whaleId,
    p_coin_id: coinId,
    p_direction: direction,
    p_amount: amount,
    p_leverage: leverage,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true, data };
}

/**
 * Borrar un trade del historial de una whale (no afecta wallet del usuario)
 */
export async function deleteWhaleTradeAction(tradeId: string): Promise<WhaleResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_whale_trade", {
    p_trade_id: tradeId,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/whales");
  return { success: true };
}
