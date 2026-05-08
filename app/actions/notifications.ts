"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type NotifResult = { error?: string; success?: boolean };

export async function markNotificationReadAction(id: string): Promise<NotifResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function markAllReadAction(): Promise<NotifResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteNotificationAction(id: string): Promise<NotifResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_notification", {
    p_notification_id: id,
  });
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { success: true };
}

export async function clearReadAction(): Promise<NotifResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_all_read_notifications");
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { success: true };
}
