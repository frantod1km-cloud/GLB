import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shield, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { revalidatePath } from "next/cache";

/**
 * Página de setup inicial.
 * Solo funciona si NO hay ningún admin todavía en la base.
 * Si hay un admin, redirige al login.
 *
 * Uso: vos te registrás normalmente, después abrís /setup y te convertís en admin.
 */
async function makeMeAdmin() {
  "use server";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  // Verificar que NO haya admin todavía (seguridad)
  const { data: existingAdmin } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  if (existingAdmin) {
    // Ya hay un admin, no permitir
    return;
  }

  // Convertir al usuario actual en admin
  await admin
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", user.id);

  // Notificar
  await admin.from("notifications").insert({
    user_id: user.id,
    title: "Eres admin de Golbit",
    message: "Tu cuenta ahora tiene permisos de administrador.",
    type: "success",
  });

  revalidatePath("/", "layout");
  redirect("/admin");
}

export default async function SetupPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si no hay sesión, redirigir a login
  if (!user) {
    redirect("/login?next=/setup");
  }

  // Verificar si ya hay un admin
  const admin = createAdminClient();
  const { data: existingAdmin } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();

  // Si ya hay admin, mostrar mensaje
  if (existingAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border/60 rounded-lg p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-xl font-bold mb-2">Setup ya completado</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Esta plataforma ya tiene un administrador asignado. Si necesitás
            permisos de admin, contactá al administrador actual.
          </p>
          <Button asChild>
            <Link href="/dashboard">
              Ir al dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // No hay admin todavía → mostrar el form
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-card border border-border/60 rounded-lg p-8">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Shield className="w-6 h-6 text-primary" />
        </div>
        <h1 className="text-xl font-bold mb-2 text-center">
          Setup inicial de Golbit
        </h1>
        <p className="text-sm text-muted-foreground mb-6 text-center">
          No hay ningún administrador asignado todavía. Hacé click abajo para
          convertir tu cuenta (<strong>{user.email}</strong>) en administrador.
        </p>

        <div className="rounded-md bg-muted/50 border border-border/40 p-4 text-xs text-muted-foreground mb-6 space-y-2">
          <p className="font-medium text-foreground">⚠️ Atención</p>
          <p>
            Esta acción es irreversible. Una vez que tu cuenta sea admin, esta
            página dejará de funcionar para evitar que alguien más se asigne
            permisos.
          </p>
        </div>

        <form action={makeMeAdmin}>
          <Button type="submit" className="w-full">
            <Shield className="w-4 h-4" />
            Convertirme en administrador
          </Button>
        </form>
      </div>
    </div>
  );
}
