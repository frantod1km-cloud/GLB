"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type TradeResult = { error?: string; success?: boolean; tradeId?: string };

export async function openTradeAction(formData: FormData): Promise<TradeResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const coinId = String(formData.get("coin_id") || "");
  const direction = String(formData.get("direction") || "");
  const amount = Number(formData.get("amount"));
  const leverage = Number(formData.get("leverage"));
  const stopLossRaw = formData.get("stop_loss");
  const takeProfitRaw = formData.get("take_profit");
  const stopLoss = stopLossRaw ? Number(stopLossRaw) : null;
  const takeProfit = takeProfitRaw ? Number(takeProfitRaw) : null;

  if (!coinId) return { error: "Moneda inválida" };
  if (!["long", "short"].includes(direction)) return { error: "Dirección inválida" };
  if (!amount || amount <= 0) return { error: "Monto inválido" };
  if (!leverage || leverage <= 0) return { error: "Leverage inválido" };

  const { data, error } = await supabase.rpc("open_trade", {
    p_coin_id: coinId,
    p_direction: direction,
    p_amount: amount,
    p_leverage: leverage,
    p_stop_loss: stopLoss,
    p_take_profit: takeProfit,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/trading");
  revalidatePath(`/trading/[slug]`, "page");
  revalidatePath("/wallet");
  return { success: true, tradeId: data?.trade_id };
}

export async function closeTradeAction(tradeId: string): Promise<TradeResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("close_trade", {
    p_trade_id: tradeId,
    p_reason: "manual",
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/trading");
  revalidatePath(`/trading/[slug]`, "page");
  revalidatePath("/wallet");
  return { success: true };
}

export async function adminCloseTradeAction(tradeId: string): Promise<TradeResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") return { error: "Solo admins" };

  const { data, error } = await supabase.rpc("close_trade", {
    p_trade_id: tradeId,
    p_reason: "admin",
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/trades");
  return { success: true };
}
