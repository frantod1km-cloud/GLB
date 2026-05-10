"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type CoinResult = { error?: string; success?: boolean; coinId?: string };

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
 * Crear nueva moneda
 */
export async function createCoinAction(formData: FormData): Promise<CoinResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const symbol = String(formData.get("symbol") || "").trim().toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const initialPrice = Number(formData.get("initial_price"));
  const volatility = Number(formData.get("volatility"));
  const driftBias = Number(formData.get("drift_bias"));
  const tickSeconds = Number(formData.get("tick_seconds"));
  const decimals = Number(formData.get("decimals"));
  const spreadPercent = Number(formData.get("spread_percent"));
  const isActive = formData.get("is_active") === "on";
  const spotEnabled = formData.get("spot_enabled") === "on";
  const spotBuyPriceRaw = formData.get("spot_buy_price");
  const spotSellPriceRaw = formData.get("spot_sell_price");
  const spotBuyPrice = spotBuyPriceRaw && String(spotBuyPriceRaw).trim() !== ""
    ? Number(spotBuyPriceRaw)
    : null;
  const spotSellPrice = spotSellPriceRaw && String(spotSellPriceRaw).trim() !== ""
    ? Number(spotSellPriceRaw)
    : null;

  if (!symbol || !name) return { error: "Símbolo y nombre son obligatorios" };
  if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol))
    return { error: "El símbolo debe tener formato BASE/QUOTE (ej: GLB/USDT)" };
  if (!initialPrice || initialPrice <= 0) return { error: "Precio inicial inválido" };
  if (volatility < 0 || volatility > 1) return { error: "Volatilidad fuera de rango (0-1)" };
  if (driftBias < -1 || driftBias > 1) return { error: "Drift fuera de rango (-1 a 1)" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("coins")
    .insert({
      symbol,
      name,
      description,
      current_price: initialPrice,
      initial_price: initialPrice,
      volatility,
      drift_bias: driftBias,
      tick_seconds: tickSeconds || 5,
      decimals: decimals || 4,
      spread_percent: spreadPercent || 0.1,
      is_active: isActive,
      spot_enabled: spotEnabled,
      spot_buy_price: spotBuyPrice,
      spot_sell_price: spotSellPrice,
      created_by: auth.user!.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.message.includes("duplicate")) return { error: "Ya existe una moneda con ese símbolo" };
    return { error: error.message };
  }

  // Backfill velas iniciales (200 velas en cada timeframe)
  if (data?.id) {
    await Promise.all([
      admin.rpc("backfill_candles", { p_coin_id: data.id, p_timeframe: "1m", p_count: 200 }),
      admin.rpc("backfill_candles", { p_coin_id: data.id, p_timeframe: "5m", p_count: 100 }),
      admin.rpc("backfill_candles", { p_coin_id: data.id, p_timeframe: "15m", p_count: 100 }),
      admin.rpc("backfill_candles", { p_coin_id: data.id, p_timeframe: "1h", p_count: 100 }),
    ]);
  }

  revalidatePath("/admin/coins");
  return { success: true, coinId: data?.id };
}

/**
 * Editar moneda
 */
export async function updateCoinAction(
  coinId: string,
  formData: FormData
): Promise<CoinResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const updates: Record<string, any> = {};
  const fields = {
    name: "string",
    description: "string",
    volatility: "number",
    drift_bias: "number",
    tick_seconds: "number",
    decimals: "number",
    spread_percent: "number",
    is_active: "boolean",
    spot_enabled: "boolean",
  };

  for (const [key, type] of Object.entries(fields)) {
    const v = formData.get(key);
    if (v === null || v === undefined) continue;
    if (type === "number") updates[key] = Number(v);
    else if (type === "boolean") updates[key] = v === "on" || v === "true";
    else updates[key] = String(v);
  }

  // Spot prices: pueden ser null (vaciar el campo)
  const spotBuyRaw = formData.get("spot_buy_price");
  if (spotBuyRaw !== null) {
    const v = String(spotBuyRaw).trim();
    updates.spot_buy_price = v === "" ? null : Number(v);
  }
  const spotSellRaw = formData.get("spot_sell_price");
  if (spotSellRaw !== null) {
    const v = String(spotSellRaw).trim();
    updates.spot_sell_price = v === "" ? null : Number(v);
  }

  // Validaciones
  if (updates.volatility !== undefined && (updates.volatility < 0 || updates.volatility > 1))
    return { error: "Volatilidad fuera de rango (0-1)" };
  if (updates.drift_bias !== undefined && (updates.drift_bias < -1 || updates.drift_bias > 1))
    return { error: "Drift fuera de rango (-1 a 1)" };

  updates.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { error } = await admin.from("coins").update(updates).eq("id", coinId);
  if (error) return { error: error.message };

  revalidatePath("/admin/coins");
  revalidatePath(`/admin/coins/${coinId}`);
  return { success: true };
}

/**
 * Eliminar moneda
 */
export async function deleteCoinAction(coinId: string): Promise<CoinResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Verificar si tiene operaciones
  const { count } = await admin
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("coin_id", coinId);

  if (count && count > 0)
    return {
      error: `No se puede eliminar. Hay ${count} operaciones asociadas. Mejor desactivá la moneda.`,
    };

  const { error } = await admin.from("coins").delete().eq("id", coinId);
  if (error) return { error: error.message };

  revalidatePath("/admin/coins");
  return { success: true };
}

/**
 * Toggle active/inactive
 */
export async function toggleCoinAction(coinId: string, isActive: boolean): Promise<CoinResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("coins")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", coinId);
  if (error) return { error: error.message };

  revalidatePath("/admin/coins");
  return { success: true };
}

/**
 * Forzar precio actual
 */
export async function forcePriceAction(
  coinId: string,
  newPrice: number
): Promise<CoinResult> {
  const auth = await ensureAdmin();
  if (auth.error) return { error: auth.error };
  if (!newPrice || newPrice <= 0) return { error: "Precio inválido" };

  const admin = createAdminClient();

  // Aplicar el tick para que se registre en todos los timeframes
  const { data, error } = await admin.rpc("record_price_tick", {
    p_coin_id: coinId,
    p_price: newPrice,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/coins");
  revalidatePath(`/admin/coins/${coinId}`);
  return { success: true };
}

/**
 * Tick público (cliente envía precio nuevo)
 * Lo usaremos en el motor del cliente
 */
export async function recordTickAction(
  coinId: string,
  price: number
): Promise<CoinResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("record_price_tick", {
    p_coin_id: coinId,
    p_price: price,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { success: true };
}
