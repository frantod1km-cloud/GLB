import { createClient } from "@/lib/supabase/server";
import { Wallet, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { formatUSDT } from "@/lib/utils";
import { DepositDialog } from "@/components/wallet/deposit-dialog";
import { WithdrawDialog } from "@/components/wallet/withdraw-dialog";
import { TransactionStatusBadge } from "@/components/wallet/transaction-status";

export default async function WalletPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [walletRes, settingsRes, txsRes] = await Promise.all([
    supabase
      .from("wallets")
      .select("balance, locked_balance")
      .eq("user_id", user.id)
      .eq("coin_symbol", "USDT")
      .single(),
    supabase.from("motor_settings").select("*").eq("id", 1).single(),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const wallet = walletRes.data;
  const settings = settingsRes.data;
  const transactions = txsRes.data || [];

  const balance = wallet?.balance ? Number(wallet.balance) : 0;
  const locked = wallet?.locked_balance ? Number(wallet.locked_balance) : 0;
  const available = balance - locked;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
        <p className="text-muted-foreground mt-1">
          Gestioná tu saldo, depósitos y retiros
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 p-6 rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Wallet className="w-4 h-4" />
            Saldo total
          </div>
          <div className="text-4xl font-bold mb-4">
            {formatUSDT(balance)} <span className="text-xl text-muted-foreground">USDT</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Disponible</div>
              <div className="font-semibold text-primary">{formatUSDT(available)} USDT</div>
            </div>
            <div>
              <div className="text-muted-foreground">En operaciones</div>
              <div className="font-semibold">{formatUSDT(locked)} USDT</div>
            </div>
          </div>
        </div>

        <div className="space-y-3 flex flex-col justify-center">
          {settings && (
            <>
              <DepositDialog
                uiMode={settings.deposit_ui_mode || "wallet"}
                walletAddress={settings.deposit_wallet_address || ""}
                minAmount={Number(settings.deposit_min || 10)}
                maxAmount={Number(settings.deposit_max || 100000)}
              />
              <WithdrawDialog
                availableBalance={available}
                minAmount={Number(settings.withdrawal_min || 50)}
                maxAmount={Number(settings.withdrawal_max || 100000)}
              />
            </>
          )}
        </div>
      </div>

      <div className="bg-card border border-border/60 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-border/60">
          <h2 className="font-semibold">Historial de transacciones</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Últimas 50 transacciones
          </p>
        </div>

        {transactions.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Aún no tenés transacciones
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {transactions.map((tx: any) => {
              const isCredit = tx.type === "deposit" || tx.type === "transfer_in";
              return (
                <div
                  key={tx.id}
                  className="p-4 flex items-center gap-4 hover:bg-muted/20 transition-colors"
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isCredit
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {isCredit ? (
                      <ArrowDownToLine className="w-4 h-4" />
                    ) : (
                      <ArrowUpFromLine className="w-4 h-4" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium capitalize">
                        {tx.type === "deposit" && "Depósito"}
                        {tx.type === "withdrawal" && "Retiro"}
                        {tx.type === "transfer_in" && "Transferencia recibida"}
                        {tx.type === "transfer_out" && "Transferencia enviada"}
                      </span>
                      <TransactionStatusBadge status={tx.status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(tx.created_at).toLocaleString("es-AR")}
                      {tx.notes && ` • ${tx.notes}`}
                    </div>
                  </div>

                  <div
                    className={`font-bold text-right flex-shrink-0 ${
                      isCredit ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {isCredit ? "+" : "−"} {formatUSDT(Number(tx.amount))} USDT
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
