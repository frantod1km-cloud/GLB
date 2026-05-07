import { createAdminClient } from "@/lib/supabase/admin";
import { SettingsForm } from "@/components/admin/settings-form";
import { Settings } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("motor_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Configuración general
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Modos, límites y comportamiento de wallet
        </p>
      </div>

      {settings && <SettingsForm initial={settings} />}
    </div>
  );
}
