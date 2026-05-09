"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type BotResult = { error?: string; success?: boolean; botId?: string; data?: any };

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
  if (profile?.role !== "admin" && profile?.role !== "super_admin") return { error: "Solo admins", user: null };

  return { error: null, user };
}

/**
 * Crear nuevo bot: usa admin SDK + setea config
 */
export async function createBotAction(formData: FormData): Promise<BotResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const personality = String(formData.get("personality") || "random") as
    | "random"
    | "momentum"
    | "mean_reversion";
  const initialBalance = Number(formData.get("initial_balance"));
  const tickInterval = Number(formData.get("tick_interval_seconds"));
  const amountMin = Number(formData.get("amount_min"));
  const amountMax = Number(formData.get("amount_max"));
  const leverage = Number(formData.get("leverage"));
  const closeProbability = Number(formData.get("close_probability"));

  if (!email || !fullName) return { error: "Email y nombre obligatorios" };
  if (!email.includes("@")) return { error: "Email inválido" };
  if (initialBalance < 0) return { error: "Saldo inválido" };
  if (amountMin <= 0 || amountMax < amountMin) return { error: "Rango de monto inválido" };
  if (tickInterval < 5) return { error: "Intervalo mínimo 5 segundos" };

  const admin = createAdminClient();

  const randomPassword = crypto.randomUUID() + crypto.randomUUID();

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

  if (!created.user) return { error: "No se pudo crear el bot" };
  const botId = created.user.id;

  // Update profile a 'bot'
  await admin.from("profiles").update({ role: "bot", full_name: fullName }).eq("id", botId);

  // Setear saldo inicial
  await admin.from("wallets").upsert(
    { user_id: botId, coin_symbol: "USDT", balance: initialBalance },
    { onConflict: "user_id,coin_symbol" }
  );

  // Insertar config en bots (NO usa el trigger porque ya seteamos role='bot' arriba)
  const { error: botError } = await admin.from("bots").insert({
    id: botId,
    personality,
    tick_interval_seconds: tickInterval,
    amount_min: amountMin,
    amount_max: amountMax,
    leverage,
    close_probability: closeProbability,
  });

  if (botError) return { error: botError.message };

  revalidatePath("/admin/bots");
  return { success: true, botId };
}

/**
 * Actualizar config del bot
 */
export async function updateBotConfigAction(
  botId: string,
  config: {
    personality: string;
    tick_interval_seconds: number;
    amount_min: number;
    amount_max: number;
    leverage: number;
    close_probability: number;
    preferred_coins?: string[] | null;
  }
): Promise<BotResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_upsert_bot_config", {
    p_bot_id: botId,
    p_personality: config.personality,
    p_tick_interval_seconds: config.tick_interval_seconds,
    p_amount_min: config.amount_min,
    p_amount_max: config.amount_max,
    p_leverage: config.leverage,
    p_close_probability: config.close_probability,
    p_preferred_coins: config.preferred_coins || null,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/bots");
  return { success: true };
}

/**
 * Setear saldo
 */
export async function setBotBalanceAction(botId: string, balance: number): Promise<BotResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_set_bot_balance", {
    p_bot_id: botId,
    p_amount: balance,
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  revalidatePath("/admin/bots");
  return { success: true };
}

/**
 * Activar / desactivar bot
 */
export async function toggleBotAction(botId: string, isActive: boolean): Promise<BotResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", botId)
    .eq("role", "bot");
  if (error) return { error: error.message };
  revalidatePath("/admin/bots");
  return { success: true };
}

/**
 * Eliminar bot completamente
 */
export async function deleteBotAction(botId: string): Promise<BotResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", botId)
    .single();
  if (profile?.role !== "bot") return { error: "Solo bots" };

  // Cancelar trades abiertos
  await admin
    .from("trades")
    .update({ status: "cancelled", closed_at: new Date().toISOString() })
    .eq("user_id", botId)
    .eq("status", "open");

  // Borrar config (cascada vía profile borrará todo)
  const { error } = await admin.auth.admin.deleteUser(botId);
  if (error) return { error: error.message };

  revalidatePath("/admin/bots");
  return { success: true };
}

/**
 * Operación manual sobre un bot (estilo PRECISION en whales)
 */
export async function botPrecisionAction(
  botId: string,
  coinId: string,
  direction: "long" | "short",
  amount: number,
  leverage: number
): Promise<BotResult> {
  // Reusamos la RPC de whales porque la lógica es idéntica.
  // Cambiamos la verificación de "es whale" → adaptamos llamando a una nueva RPC.
  // Por simplicidad: usamos directamente admin SDK aquí.
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Obtener info de la moneda
  const { data: coin } = await admin
    .from("coins")
    .select("*")
    .eq("id", coinId)
    .eq("is_active", true)
    .single();
  if (!coin) return { error: "Moneda no encontrada o inactiva" };

  // Verificar que es bot
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", botId)
    .single();
  if (profile?.role !== "bot") return { error: "Solo bots" };

  // Wallet
  const { data: wallet } = await admin
    .from("wallets")
    .select("balance, locked_balance")
    .eq("user_id", botId)
    .eq("coin_symbol", "USDT")
    .single();

  const available = Number(wallet?.balance || 0) - Number(wallet?.locked_balance || 0);
  if (available < amount) return { error: "Bot sin saldo suficiente" };

  // Calcular entry y liquidación
  const spreadFactor = Number(coin.spread_percent) / 200;
  const entryPrice =
    direction === "long"
      ? Number(coin.current_price) * (1 + spreadFactor)
      : Number(coin.current_price) * (1 - spreadFactor);
  const liqPrice =
    direction === "long"
      ? entryPrice * (1 - 1 / leverage)
      : entryPrice * (1 + 1 / leverage);

  const { error: insertError } = await admin.from("trades").insert({
    user_id: botId,
    coin_id: coinId,
    direction,
    amount,
    leverage,
    entry_price: entryPrice,
    liquidation_price: liqPrice,
    fee_open: 0,
    status: "open",
    opened_at: new Date().toISOString(),
  });
  if (insertError) return { error: insertError.message };

  // Lockear saldo
  await admin
    .from("wallets")
    .update({
      balance: Number(wallet?.balance || 0) - amount,
      locked_balance: Number(wallet?.locked_balance || 0) + amount,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", botId)
    .eq("coin_symbol", "USDT");

  revalidatePath("/admin/bots");
  return { success: true };
}

/**
 * Borrar trade de bot
 */
export async function deleteBotTradeAction(tradeId: string): Promise<BotResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_delete_bot_trade", { p_trade_id: tradeId });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  revalidatePath("/admin/bots");
  return { success: true };
}
