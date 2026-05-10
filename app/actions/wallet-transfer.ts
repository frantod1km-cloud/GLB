"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type TransferResult = { error?: string; success?: boolean; data?: any };

/**
 * Mover USDT desde Spot a Trading
 */
export async function transferSpotToTradingAction(amount: number): Promise<TransferResult> {
  if (!amount || amount <= 0) return { error: "Monto inválido" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("transfer_spot_to_trading", {
    p_amount: amount,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/wallet");
  revalidatePath("/dashboard");
  return { success: true, data };
}

/**
 * Mover USDT desde Trading a Spot
 */
export async function transferTradingToSpotAction(amount: number): Promise<TransferResult> {
  if (!amount || amount <= 0) return { error: "Monto inválido" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("transfer_trading_to_spot", {
    p_amount: amount,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/wallet");
  revalidatePath("/dashboard");
  return { success: true, data };
}
