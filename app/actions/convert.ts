"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ConvertResult = { error?: string; success?: boolean; data?: any };

/**
 * Convertir entre monedas spot
 */
export async function spotConvertAction(
  fromCoin: string,
  toCoin: string,
  fromAmount: number
): Promise<ConvertResult> {
  if (!fromCoin || !toCoin) return { error: "Faltan monedas" };
  if (fromCoin === toCoin) return { error: "No se puede convertir a la misma moneda" };
  if (!fromAmount || fromAmount <= 0) return { error: "Monto inválido" };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("spot_convert", {
    p_from_coin: fromCoin,
    p_to_coin: toCoin,
    p_from_amount: fromAmount,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/convert");
  revalidatePath("/wallet");
  revalidatePath("/dashboard");
  return { success: true, data };
}
