import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Shield,
  ArrowLeft,
  Wallet,
  Users,
  Settings,
  Coins,
  Bell,
  Activity,
  ShieldCheck,
  ScrollText,
  HandCoins,
} from "lucide-react";
import { NotificationsBell } from "@/components/notifications/notifications-bell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, email")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "admin" && profile.role !== "super_admin")) {
    redirect("/dashboard");
  }

  const isSuperAdmin = profile.role === "super_admin";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-card/30">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            {isSuperAdmin ? (
              <ShieldCheck className="w-5 h-5 text-yellow-500" />
            ) : (
              <Shield className="w-5 h-5 text-primary" />
            )}
            <span className="font-bold text-lg">
              {isSuperAdmin ? "Super admin" : "Panel admin"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell userId={user.id} />
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver al dashboard
            </Link>
          </div>
        </div>
      </header>

      <div className="container flex gap-8 py-8">
        <aside className="w-56 flex-shrink-0">
          <nav className="space-y-1 sticky top-24">
            {/* Visible para todos los admins */}
            <AdminLink href="/admin" icon={<Shield className="w-4 h-4" />}>
              Inicio
            </AdminLink>
            <AdminLink href="/admin/wallet" icon={<Wallet className="w-4 h-4" />}>
              Wallet ops
            </AdminLink>
            <AdminLink href="/admin/users" icon={<Users className="w-4 h-4" />}>
              Usuarios
            </AdminLink>
            <AdminLink href="/admin/trades" icon={<Activity className="w-4 h-4" />}>
              Operaciones
            </AdminLink>
            <AdminLink href="/notifications" icon={<Bell className="w-4 h-4" />}>
              Notificaciones
            </AdminLink>

            {/* Solo super_admin: separador + items sensibles */}
            {isSuperAdmin && (
              <>
                <div className="pt-4 pb-2 px-3 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                  Administración
                </div>
                <AdminLink href="/admin/team" icon={<HandCoins className="w-4 h-4" />}>
                  Equipo y saldos
                </AdminLink>
                <AdminLink href="/admin/coins" icon={<Coins className="w-4 h-4" />}>
                  Monedas
                </AdminLink>
                <AdminLink
                  href="/admin/whales"
                  icon={
                    <span className="w-4 h-4 inline-flex items-center justify-center text-base">
                      🐋
                    </span>
                  }
                >
                  Whales
                </AdminLink>
                <AdminLink
                  href="/admin/bots"
                  icon={
                    <span className="w-4 h-4 inline-flex items-center justify-center text-base">
                      🤖
                    </span>
                  }
                >
                  Bots
                </AdminLink>
                <AdminLink href="/admin/audit" icon={<ScrollText className="w-4 h-4" />}>
                  Audit log
                </AdminLink>
                <AdminLink href="/admin/settings" icon={<Settings className="w-4 h-4" />}>
                  Configuración
                </AdminLink>
              </>
            )}
          </nav>
        </aside>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

function AdminLink({
  href,
  icon,
  children,
  disabled = false,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground/50 cursor-not-allowed">
        {icon}
        {children}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-secondary/50 transition-colors"
    >
      {icon}
      {children}
    </Link>
  );
}
