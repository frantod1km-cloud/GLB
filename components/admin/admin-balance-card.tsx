"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { HandCoins, AlertTriangle } from "lucide-react";
import { formatUSDT } from "@/lib/utils";

interface AdminBalanceCardProps {
  adminId: string;
}

export function AdminBalanceCard({ adminId }: AdminBalanceCardProps) {
  const [balance, setBalance] = useState<{
    total_assigned: number;
    total_spent: number;
    available: number;
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();

    async function load() {
      const { data } = await supabase
        .from("admin_balances")
        .select("total_assigned, total_spent, available")
        .eq("admin_id", adminId)
        .single();
      if (data) {
        setBalance({
          total_assigned: Number(data.total_assigned || 0),
          total_spent: Number(data.total_spent || 0),
          available: Number(data.available || 0),
        });
      }
    }
    load();

    // Realtime: actualizar cuando cambia mi balance
    const channel = supabase
      .channel(`my-admin-balance-${adminId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "admin_balances",
          filter: `admin_id=eq.${adminId}`,
        },
        (payload: any) => {
          setBalance({
            total_assigned: Number(payload.new.total_assigned || 0),
            total_spent: Number(payload.new.total_spent || 0),
            available: Number(payload.new.available || 0),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId]);

  if (!balance) return null;

  const usedPct =
    balance.total_assigned > 0
      ? (balance.total_spent / balance.total_assigned) * 100
      : 0;
  const isLow = balance.available < 1000 && balance.total_assigned > 0;
  const isEmpty = balance.available === 0;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isEmpty
          ? "bg-destructive/5 border-destructive/30"
          : isLow
            ? "bg-yellow-500/5 border-yellow-500/30"
            : "bg-card border-border/60"
      }`}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isEmpty
                ? "bg-destructive/20 text-destructive"
                : isLow
                  ? "bg-yellow-500/20 text-yellow-500"
                  : "bg-primary/20 text-primary"
            }`}
          >
            {isLow || isEmpty ? <AlertTriangle className="w-5 h-5" /> : <HandCoins className="w-5 h-5" />}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2">
              Tu saldo asignado
              {isEmpty && <span className="text-xs font-normal text-destructive">● Sin saldo</span>}
              {isLow && !isEmpty && (
                <span className="text-xs font-normal text-yellow-500">● Saldo bajo</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {balance.total_assigned === 0
                ? "Aún no te asignaron saldo"
                : `Asignado: ${formatUSDT(balance.total_assigned)} • Gastado: ${formatUSDT(balance.total_spent)}`}
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold font-mono">
            {formatUSDT(balance.available)}{" "}
            <span className="text-sm text-muted-foreground">USDT</span>
          </div>
          <div className="text-xs text-muted-foreground">disponibles</div>
        </div>
      </div>

      {balance.total_assigned > 0 && (
        <div className="mt-3 h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              usedPct > 80
                ? "bg-destructive"
                : usedPct > 50
                  ? "bg-yellow-500"
                  : "bg-primary"
            }`}
            style={{ width: `${Math.min(usedPct, 100)}%` }}
          />
        </div>
      )}

      {(isLow || isEmpty) && balance.total_assigned > 0 && (
        <p className="text-xs text-muted-foreground mt-3">
          💡 Pedí más saldo al super admin (próximamente disponible).
        </p>
      )}
    </div>
  );
}
