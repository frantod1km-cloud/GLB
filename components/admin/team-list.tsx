"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  HandCoins,
  Trash2,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Shield,
  ArrowDownCircle,
  ArrowUpCircle,
} from "lucide-react";
import {
  createAdminAction,
  assignAdminBalanceAction,
  revokeAdminBalanceAction,
  deleteAdminAction,
} from "@/app/actions/team";
import { formatUSDT } from "@/lib/utils";

interface TeamListProps {
  admins: any[];
}

export function TeamList({ admins }: TeamListProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<{ adminId: string; name: string } | null>(null);
  const [revokeOpen, setRevokeOpen] = useState<{ adminId: string; name: string; available: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ adminId: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Form crear admin
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newInitialBalance, setNewInitialBalance] = useState("0");

  // Form asignar/revocar saldo
  const [actionAmount, setActionAmount] = useState("");
  const [actionNotes, setActionNotes] = useState("");

  function handleCreate() {
    setError(null);
    const formData = new FormData();
    formData.set("email", newEmail);
    formData.set("full_name", newName);
    formData.set("password", newPassword);
    formData.set("initial_balance", newInitialBalance);

    startTransition(async () => {
      const r = await createAdminAction(formData);
      if (r.error) setError(r.error);
      else {
        setCreateOpen(false);
        setNewEmail("");
        setNewName("");
        setNewPassword("");
        setNewInitialBalance("0");
        router.refresh();
      }
    });
  }

  function handleAssign() {
    if (!assignOpen) return;
    setError(null);
    const v = Number(actionAmount);
    if (!v || v <= 0) {
      setError("Monto inválido");
      return;
    }
    startTransition(async () => {
      const r = await assignAdminBalanceAction(assignOpen.adminId, v, actionNotes || undefined);
      if (r.error) setError(r.error);
      else {
        setAssignOpen(null);
        setActionAmount("");
        setActionNotes("");
        router.refresh();
      }
    });
  }

  function handleRevoke() {
    if (!revokeOpen) return;
    setError(null);
    const v = Number(actionAmount);
    if (!v || v <= 0) {
      setError("Monto inválido");
      return;
    }
    if (v > revokeOpen.available) {
      setError(`No tiene tanto disponible (tiene ${formatUSDT(revokeOpen.available)})`);
      return;
    }
    startTransition(async () => {
      const r = await revokeAdminBalanceAction(revokeOpen.adminId, v, actionNotes || undefined);
      if (r.error) setError(r.error);
      else {
        setRevokeOpen(null);
        setActionAmount("");
        setActionNotes("");
        router.refresh();
      }
    });
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteAdminAction(deleteConfirm.adminId);
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
          {admins.length} admin{admins.length !== 1 ? "s" : ""} en el equipo
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />
          Crear admin
        </Button>
      </div>

      {admins.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-border/40 rounded-lg">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <h3 className="font-semibold mb-1">No hay admins en el equipo todavía</h3>
          <p className="text-sm text-muted-foreground">
            Creá el primer admin para que te ayude con la operación diaria
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {admins.map((a) => {
            const isSuper = a.role === "super_admin";
            const total = Number(a.total_assigned || 0);
            const spent = Number(a.total_spent || 0);
            const available = Number(a.available || 0);
            const usedPct = total > 0 ? (spent / total) * 100 : 0;

            return (
              <div
                key={a.id}
                className="bg-card border border-border/60 rounded-lg p-4 flex items-center gap-4 flex-wrap"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isSuper ? "bg-yellow-500/10 text-yellow-500" : "bg-primary/10 text-primary"
                  }`}
                >
                  {isSuper ? (
                    <ShieldCheck className="w-5 h-5" />
                  ) : (
                    <Shield className="w-5 h-5" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{a.full_name || "Sin nombre"}</span>
                    {isSuper ? (
                      <Badge variant="warning">Super admin</Badge>
                    ) : (
                      <Badge variant="default">Admin</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{a.email}</div>
                </div>

                {!isSuper && (
                  <div className="text-right">
                    <div className="font-mono font-semibold">
                      {formatUSDT(available)} USDT
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Asignado: {formatUSDT(total)} • Gastado: {formatUSDT(spent)}
                    </div>
                    {total > 0 && (
                      <div className="w-32 h-1 bg-muted/50 rounded-full mt-1 ml-auto overflow-hidden">
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
                  </div>
                )}

                {isSuper && (
                  <div className="text-right text-xs text-muted-foreground italic">
                    Saldo ilimitado
                  </div>
                )}

                {!isSuper && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setAssignOpen({ adminId: a.id, name: a.full_name || a.email })
                      }
                      title="Asignar saldo"
                      className="text-primary"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      Dar
                    </Button>
                    {available > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRevokeOpen({
                            adminId: a.id,
                            name: a.full_name || a.email,
                            available,
                          })
                        }
                        title="Revocar saldo"
                      >
                        <ArrowDownCircle className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setDeleteConfirm({ adminId: a.id, name: a.full_name || a.email })
                      }
                      title="Eliminar admin"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal crear admin */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear nuevo admin</DialogTitle>
            <DialogDescription>
              Los admins gestionan usuarios y aprueban depósitos. Tienen su propio saldo
              asignado por vos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  placeholder="admin1@golbit.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre completo</Label>
                <Input
                  placeholder="Juan Pérez"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Contraseña (mínimo 8)</Label>
              <Input
                type="text"
                placeholder="Compartila con el admin después de crearlo"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Esta contraseña la usará el admin para entrar. Compartila por canal seguro.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Saldo inicial (USDT)</Label>
              <Input
                type="number"
                step="any"
                value={newInitialBalance}
                onChange={(e) => setNewInitialBalance(e.target.value)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Cuánto saldo inicial tiene este admin para acreditar a usuarios. Podés
                cambiarlo después.
              </p>
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
            <Button
              onClick={handleCreate}
              disabled={isPending || !newEmail || !newName || newPassword.length < 8}
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal asignar saldo */}
      <Dialog
        open={!!assignOpen}
        onOpenChange={(o) => {
          if (!o) {
            setAssignOpen(null);
            setActionAmount("");
            setActionNotes("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <HandCoins className="inline w-5 h-5 mr-1" />
              Asignar saldo a {assignOpen?.name}
            </DialogTitle>
            <DialogDescription>
              Sumá USDT al saldo asignado del admin. Los va a usar para acreditar a usuarios.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Monto USDT</Label>
              <Input
                type="number"
                step="any"
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                disabled={isPending}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Input
                placeholder="Ej: refuerzo mensual"
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                disabled={isPending}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleAssign} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Asignar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal revocar */}
      <Dialog
        open={!!revokeOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRevokeOpen(null);
            setActionAmount("");
            setActionNotes("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revocar saldo de {revokeOpen?.name}</DialogTitle>
            <DialogDescription>
              Te quita saldo disponible al admin. Disponible actual:{" "}
              {revokeOpen ? formatUSDT(revokeOpen.available) : "?"} USDT
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Monto a revocar (USDT)</Label>
              <Input
                type="number"
                step="any"
                value={actionAmount}
                onChange={(e) => setActionAmount(e.target.value)}
                disabled={isPending}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Input
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                disabled={isPending}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOpen(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Revocar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar eliminar */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar admin?</DialogTitle>
            <DialogDescription>
              Vas a borrar a <strong>{deleteConfirm?.name}</strong>. Pierde acceso de inmediato y
              su saldo asignado se elimina. Las acciones que ya hizo quedan registradas.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Sí, eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
