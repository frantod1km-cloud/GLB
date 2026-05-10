"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type WalletResult = { error?: string; success?: boolean };

/**
 * Solicitar depósito (usuario)
 */
export async function requestDepositAction(formData: FormData): Promise<WalletResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const amount = Number(formData.get("amount"));
  const proofUrl = formData.get("proof_url")
    ? String(formData.get("proof_url")).trim() || null
    : null;
  const userWallet = formData.get("user_wallet")
    ? String(formData.get("user_wallet")).trim() || null
    : null;

  if (!amount || amount <= 0) return { error: "Monto inválido" };

  const { data, error } = await supabase.rpc("request_deposit", {
    p_amount: amount,
    p_proof_url: proofUrl,
    p_user_wallet: userWallet,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/wallet");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Solicitar retiro (usuario)
 */
export async function requestWithdrawalAction(formData: FormData): Promise<WalletResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const amount = Number(formData.get("amount"));
  const userWallet = String(formData.get("user_wallet") || "").trim();

  if (!amount || amount <= 0) return { error: "Monto inválido" };
  if (!userWallet) return { error: "Ingresá una dirección de retiro" };

  const { data, error } = await supabase.rpc("request_withdrawal", {
    p_amount: amount,
    p_user_wallet: userWallet,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/wallet");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Aprobar transacción (admin) - descuenta de su saldo si es admin normal
 * destination: 'spot' (default) | 'trading' - solo aplica para deposits
 */
export async function approveTransactionAction(
  transactionId: string,
  destination: "spot" | "trading" = "spot",
  notes?: string
): Promise<WalletResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("approve_transaction", {
    p_transaction_id: transactionId,
    p_action: "approve",
    p_destination: destination,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/wallet");
  revalidatePath("/wallet");
  return { success: true };
}

/**
 * Rechazar transacción (admin)
 */
export async function rejectTransactionAction(
  transactionId: string,
  notes?: string
): Promise<WalletResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("approve_transaction", {
    p_transaction_id: transactionId,
    p_action: "reject",
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/wallet");
  revalidatePath("/wallet");
  return { success: true };
}

/**
 * Ajuste manual de saldo (admin) - puede ser negativo o positivo
 */
export async function adjustBalanceAction(
  userId: string,
  amount: number,
  notes?: string
): Promise<WalletResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("admin_adjust_balance", {
    p_user_id: userId,
    p_amount: amount,
    p_notes: notes || null,
  });

  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };

  revalidatePath("/admin/wallet");
  revalidatePath("/admin/users");
  return { success: true };
}

/**
 * Actualizar configuración de wallet (admin)
 */
export async function updateWalletSettingsAction(formData: FormData): Promise<WalletResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  // Verificar que es admin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") return { error: "Solo admins" };

  const updates: Record<string, any> = {};
  const fields = [
    "deposit_mode",
    "withdrawal_mode",
    "deposit_review_hours",
    "withdrawal_review_hours",
    "deposit_min",
    "deposit_max",
    "withdrawal_min",
    "withdrawal_max",
    "withdrawal_daily_max",
    "deposit_ui_mode",
    "deposit_wallet_address",
    "initial_balance",
  ];

  for (const f of fields) {
    const v = formData.get(f);
    if (v !== null && v !== undefined) {
      const isNumeric = [
        "deposit_review_hours",
        "withdrawal_review_hours",
        "deposit_min",
        "deposit_max",
        "withdrawal_min",
        "withdrawal_max",
        "withdrawal_daily_max",
        "initial_balance",
      ].includes(f);
      updates[f] = isNumeric ? Number(v) : String(v);
    }
  }

  const { error } = await supabase.from("motor_settings").update(updates).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/admin");
  return { success: true };
}
