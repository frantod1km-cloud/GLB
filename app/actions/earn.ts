"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type EarnResult = { error?: string; success?: boolean; data?: any };

export async function earnSubscribeAction(
  productId: string,
  amount: number
): Promise<EarnResult> {
  if (!productId) return { error: "Producto inválido" };
  if (!amount || amount <= 0) return { error: "Monto inválido" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("earn_subscribe", {
    p_product_id: productId,
    p_amount: amount,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/earn");
  revalidatePath("/wallet");
  return { success: true, data };
}

export async function earnRedeemAction(
  subscriptionId: string
): Promise<EarnResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("earn_redeem", {
    p_subscription_id: subscriptionId,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/earn");
  revalidatePath("/wallet");
  return { success: true, data };
}

export async function earnCancelEarlyAction(
  subscriptionId: string
): Promise<EarnResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("earn_cancel_early", {
    p_subscription_id: subscriptionId,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/earn");
  revalidatePath("/wallet");
  return { success: true, data };
}
