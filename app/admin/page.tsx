import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function AdminPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">Panel admin</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4" />
              Volver al dashboard
            </Link>
          </Button>
        </div>
      </header>

      <main className="container py-12">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">Panel de administración</h1>
          <p className="text-muted-foreground mb-8">
            Desde acá vas a controlar todo Golbit
          </p>

          <div className="bg-card border border-border/60 rounded-lg p-6">
            <h2 className="font-semibold mb-3">⚙️ En construcción</h2>
            <p className="text-sm text-muted-foreground mb-4">
              El panel admin completo se implementa en pasos siguientes. Lo que
              vas a poder hacer desde acá:
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>📊 <strong>Paso 4:</strong> Crear y gestionar monedas</li>
              <li>💰 <strong>Paso 3-9:</strong> Aprobar depósitos y retiros</li>
              <li>🎛️ <strong>Paso 7:</strong> Motor de resultados (fader profit/loss)</li>
              <li>👥 <strong>Paso 9:</strong> Gestión de usuarios y permisos</li>
              <li>🔔 <strong>Paso 8:</strong> Enviar notificaciones manuales</li>
              <li>📈 <strong>Paso 10:</strong> Vista del árbol multinivel</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
