"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Pencil, Loader2, Plus, AlertCircle, ExternalLink } from "lucide-react";
import {
  setWhaleBalanceAction,
  toggleWhaleAction,
  deleteWhaleAction,
  createWhaleAction,
} from "@/app/actions/whales";
import { formatUSDT } from "@/lib/utils";

interface WhalesListProps {
  whales: any[];
}

export function WhalesList({ whales }: WhalesListProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editBalance, setEditBalance] = useState<{ id: string; current: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("100000");

  const [editValue, setEditValue] = useState("");

  function handleCreate() {
    setError(null);
    const formData = new FormData();
    formData.set("email", newEmail);
    formData.set("full_name", newName);
    formData.set("initial_balance", newBalance);

    startTransition(async () => {
      const r = await createWhaleAction(formData);
      if (r.error) setError(r.error);
      else {
        setCreateOpen(false);
        setNewEmail("");
        setNewName("");
        setNewBalance("100000");
        router.refresh();
      }
    });
  }

  function handleSetBalance() {
    if (!editBalance) return;
    setError(null);
    const v = Number(editValue);
    if (isNaN(v) || v < 0) {
      setError("Saldo inválido");
      return;
    }
    startTransition(async () => {
      const r = await setWhaleBalanceAction(editBalance.id, v);
      if (r.error) setError(r.error);
      else {
        setEditBalance(null);
        setEditValue("");
        router.refresh();
      }
    });
  }

  function handleToggle(whaleId: string, value: boolean) {
    startTransition(async () => {
      await toggleWhaleAction(whaleId, value);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteWhaleAction(deleteConfirm);
      if (r.error) setError(r.error);
      else {
        setDeleteConfirm(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {whales.length} whale{whales.length !== 1 ? "s" : ""} registrada
          {whales.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />
          Crear whale
        </Button>
      </div>

      {whales.length === 0 ? (
        <div className="text-center py-12 px-6 border-2 border-dashed border-border/40 rounded-lg">
          <div className="text-4xl mb-3">🐋</div>
          <h3 className="font-semibold mb-1">No hay whales todavía</h3>
          <p className="text-sm text-muted-foreground">
            Creá la primera whale para empezar a manipular el mercado
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {whales.map((whale) => {
            const balance = Number(whale.balance || 0);
            const locked = Number(whale.locked_balance || 0);
            const available = balance - locked;
            const openTrades = whale.open_trades_count || 0;

            return (
              <div
                key={whale.id}
                className="bg-card border border-border/60 rounded-lg p-4 flex items-center gap-4 hover:border-border transition-colors flex-wrap"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-2xl flex-shrink-0">
                  🐋
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{whale.full_name || "Sin nombre"}</span>
                    {whale.is_active ? (
                      <Badge variant="default">Activa</Badge>
                    ) : (
                      <Badge variant="secondary">Inactiva</Badge>
                    )}
                    {openTrades > 0 && (
                      <Badge variant="warning">{openTrades} abiertas</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {whale.email}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-bold font-mono text-lg">
                    {formatUSDT(balance)} USDT
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Disponible: {formatUSDT(available)}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <Switch
                    checked={whale.is_active}
                    onCheckedChange={(v) => handleToggle(whale.id, v)}
                    disabled={isPending}
                  />
                  <Button asChild variant="ghost" size="icon" title="Ver detalle">
                    <Link href={`/admin/whales/${whale.id}`}>
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditBalance({ id: whale.id, current: balance });
                      setEditValue(String(balance));
                    }}
                    title="Editar saldo"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(whale.id)}
                    title="Eliminar whale"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🐋 Crear nueva whale</DialogTitle>
            <DialogDescription>
              Las whales son cuentas que vos controlás para empujar el mercado.
              Sus operaciones afectan el precio realmente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="w_email">Email único</Label>
              <Input
                id="w_email"
                type="email"
                placeholder="whale1@golbit.local"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Puede ser cualquier email único. La whale no se loguea, vos la controlás.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w_name">Nombre / alias</Label>
              <Input
                id="w_name"
                placeholder="Whale Alpha"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w_balance">Saldo inicial (USDT)</Label>
              <Input
                id="w_balance"
                type="number"
                step="any"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                disabled={isPending}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isPending || !newEmail || !newName}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear whale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal editar saldo */}
      <Dialog
        open={!!editBalance}
        onOpenChange={(o) => {
          if (!o) {
            setEditBalance(null);
            setEditValue("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar saldo de la whale</DialogTitle>
            <DialogDescription>
              Esto setea el saldo absoluto, no es un ajuste relativo. Es como un "magic wand".
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Nuevo saldo (USDT)</Label>
            <Input
              type="number"
              step="any"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Saldo actual: {editBalance ? formatUSDT(editBalance.current) : "?"} USDT
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditBalance(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSetBalance} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminar */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar whale?</DialogTitle>
            <DialogDescription>
              Esto borra la whale, su wallet, sus operaciones y todo su historial. Las
              operaciones abiertas se cancelan automáticamente. Acción irreversible.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Eliminar whale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
