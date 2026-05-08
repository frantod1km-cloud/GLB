"use client";

import Link from "next/link";
import { TrendingUp, LogOut, Shield, Wallet, LayoutDashboard, Activity, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/actions/auth";
import { NotificationsBell } from "@/components/notifications/notifications-bell";

interface DashboardNavProps {
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
    referral_code: string | null;
  };
}

export function DashboardNav({ profile }: DashboardNavProps) {
  const isAdmin = profile.role === "admin";
  const displayName = profile.full_name || profile.email.split("@")[0];

  return (
    <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
      <div className="container flex items-center justify-between h-16 gap-4">
        <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-xl tracking-tight hidden sm:block">Golbit</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink href="/dashboard" icon={<LayoutDashboard className="w-4 h-4" />}>
            Dashboard
          </NavLink>
          <NavLink href="/trading" icon={<Activity className="w-4 h-4" />}>
            Trading
          </NavLink>
          <NavLink href="/trading/historial" icon={<History className="w-4 h-4" />}>
            Historial
          </NavLink>
          <NavLink href="/wallet" icon={<Wallet className="w-4 h-4" />}>
            Wallet
          </NavLink>
        </nav>

        <div className="flex items-center gap-3 ml-auto">
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
            >
              <Shield className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Panel admin</span>
            </Link>
          )}

          <NotificationsBell userId={profile.id} />

          <div className="text-sm text-right hidden md:block">
            <div className="font-medium leading-tight">{displayName}</div>
            <div className="text-xs text-muted-foreground leading-tight">
              {profile.email}
            </div>
          </div>

          <form action={logoutAction}>
            <Button type="submit" variant="ghost" size="icon" title="Cerrar sesión">
              <LogOut className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-secondary/50 transition-colors"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}
