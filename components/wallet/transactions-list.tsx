"use client";

import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { TransactionStatusBadge } from "@/components/wallet/transaction-status";
import { formatUSDT } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface TransactionsListProps {
  transactions: any[];
}

export function TransactionsList({ transactions }: TransactionsListProps) {
  if (transactions.length === 0) {
    return (
      <div className="bg-card border border-border/60 rounded-lg p-8 text-center text-sm text-muted-foreground">
        No hay movimientos todavía
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
      <div className="divide-y divide-border/40">
        {transactions.map((tx: any) => {
          const isCredit = tx.type === "deposit" || (tx.type === "adjustment" && Number(tx.amount) > 0);
          const isDebit = tx.type === "withdrawal" || (tx.type === "adjustment" && Number(tx.amount) < 0);

          let icon;
          let typeLabel;
          if (tx.type === "deposit") {
            icon = <ArrowDownToLine className="w-4 h-4" />;
            typeLabel = "Depósito";
          } else if (tx.type === "withdrawal") {
            icon = <ArrowUpFromLine className="w-4 h-4" />;
            typeLabel = "Retiro";
          } else {
            icon = <RefreshCw className="w-4 h-4" />;
            typeLabel = "Ajuste";
          }

          return (
            <div key={tx.id} className="p-4 hover:bg-muted/10 transition-colors flex items-center gap-4 flex-wrap">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isCredit
                    ? "bg-primary/10 text-primary"
                    : isDebit
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{typeLabel}</span>
                  <TransactionStatusBadge status={tx.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(tx.created_at).toLocaleString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                {tx.notes && (
                  <div className="text-xs text-muted-foreground mt-0.5 italic">
                    {tx.notes}
                  </div>
                )}
              </div>

              <div className="text-right">
                <div
                  className={`font-mono font-semibold ${
                    isCredit
                      ? "text-primary"
                      : isDebit
                        ? "text-destructive"
                        : ""
                  }`}
                >
                  {isCredit ? "+" : isDebit ? "−" : ""}
                  {formatUSDT(Math.abs(Number(tx.amount)))} USDT
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
