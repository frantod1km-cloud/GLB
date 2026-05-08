"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Search, ExternalLink, Ban, CircleCheck } from "lucide-react";
import { toggleUserActiveAction } from "@/app/actions/users";
import { formatUSDT } from "@/lib/utils";

interface UsersListProps {
  users: any[];
}

export function UsersList({ users }: UsersListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "blocked">("all");
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter((u) => {
      if (filter === "active" && !u.is_active) return false;
      if (filter === "blocked" && u.is_active) return false;
      if (!q) return true;
      const inName = u.full_name?.toLowerCase().includes(q);
      const inEmail = u.email?.toLowerCase().includes(q);
      return inName || inEmail;
    });
  }, [users, search, filter]);

  function handleToggle(userId: string, value: boolean) {
    startTransition(async () => {
      await toggleUserActiveAction(userId, value);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-1">
          {([
            { id: "all", label: "Todos" },
            { id: "active", label: "Activos" },
            { id: "blocked", label: "Bloqueados" },
          ] as const).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        Mostrando {filtered.length} de {users.length} usuarios
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border/60 rounded-lg p-12 text-center text-sm text-muted-foreground">
          No se encontraron usuarios con esos criterios
        </div>
      ) : (
        <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
          <div className="divide-y divide-border/40">
            {filtered.map((user) => {
              const balance = Number(user.balance || 0);
              const locked = Number(user.locked_balance || 0);

              return (
                <div
                  key={user.id}
                  className="p-4 hover:bg-muted/10 transition-colors flex items-center gap-4 flex-wrap"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                    {(user.full_name || user.email || "?").slice(0, 1).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {user.full_name || "Sin nombre"}
                      </span>
                      {!user.is_active && <Badge variant="destructive">Bloqueado</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Registrado:{" "}
                      {new Date(user.created_at).toLocaleDateString("es-AR")}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono font-semibold">
                      {formatUSDT(balance)} USDT
                    </div>
                    {locked > 0 && (
                      <div className="text-xs text-muted-foreground">
                        En ops: {formatUSDT(locked)}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Switch
                      checked={user.is_active}
                      onCheckedChange={(v) => handleToggle(user.id, v)}
                      disabled={isPending}
                    />
                    <Button asChild variant="ghost" size="icon" title="Ver detalle">
                      <Link href={`/admin/users/${user.id}`}>
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
