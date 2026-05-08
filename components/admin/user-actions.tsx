"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Loader2, KeyRound, Trash2, Ban, CircleCheck } from "lucide-react";
import {
  toggleUserActiveAction,
  updateUserNameAction,
  resetUserPasswordAction,
  deleteUserAction,
} from "@/app/actions/users";

interface UserActionsProps {
  user: any;
  isSuperAdmin: boolean;
}

export function UserActions({ user, isSuperAdmin }: UserActionsProps) {
  const router = useRouter();
  const [editName, setEditName] = useState(false);
  const [nameValue, setNameValue] = useState(user.full_name || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function flashSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  function handleSaveName() {
    setError(null);
    startTransition(async () => {
      const r = await updateUserNameAction(user.id, nameValue);
      if (r.error) setError(r.error);
      else {
        setEditName(false);
        flashSuccess("Nombre actualizado");
        router.refresh();
      }
    });
  }

  function handleToggle() {
    setError(null);
    startTransition(async () => {
      const r = await toggleUserActiveAction(user.id, !user.is_active);
      if (r.error) setError(r.error);
      else {
        flashSuccess(user.is_active ? "Usuario bloqueado" : "Usuario desbloqueado");
        router.refresh();
      }
    });
  }

  function handleResetPassword() {
    setError(null);
    startTransition(async () => {
      const r = await resetUserPasswordAction(user.id);
      if (r.error) setError(r.error);
      else {
        setConfirmReset(false);
        flashSuccess("Email de recuperación enviado");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const r = await deleteUserAction(user.id);
      if (r.error) setError(r.error);
      else {
        router.push("/admin/users");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/60 rounded-lg p-5">
        <h3 className="font-semibold mb-3 text-sm">Acciones</h3>

        {/* Nombre */}
        <div className="space-y-1.5 mb-4">
          <Label className="text-xs">Nombre</Label>
          {editName ? (
            <div className="flex gap-2">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                disabled={isPending}
              />
              <Button size="sm" onClick={handleSaveName} disabled={isPending}>
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditName(false);
                  setNameValue(user.full_name || "");
                }}
                disabled={isPending}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm">{user.full_name || "Sin nombre"}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setEditName(true)}
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {/* Bloquear/Desbloquear */}
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleToggle}
            disabled={isPending}
          >
            {user.is_active ? (
              <>
                <Ban className="w-4 h-4" />
                Bloquear cuenta
              </>
            ) : (
              <>
                <CircleCheck className="w-4 h-4" />
                Desbloquear cuenta
              </>
            )}
          </Button>

          {/* Reset password */}
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => setConfirmReset(true)}
            disabled={isPending}
          >
            <KeyRound className="w-4 h-4" />
            Enviar email de recuperación
          </Button>

          {/* Borrar (solo super_admin) */}
          {isSuperAdmin && (
            <Button
              variant="outline"
              className="w-full justify-start text-destructive hover:text-destructive border-destructive/30 hover:border-destructive/60"
              onClick={() => setConfirmDelete(true)}
              disabled={isPending}
            >
              <Trash2 className="w-4 h-4" />
              Borrar usuario
            </Button>
          )}
        </div>

        {error && (
          <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3 p-2 rounded bg-primary/10 border border-primary/30 text-primary text-xs">
            ✓ {success}
          </div>
        )}
      </div>

      {/* Confirmar reset */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Enviar email de recuperación?</DialogTitle>
            <DialogDescription>
              Se enviará un email a <strong>{user.email}</strong> con un link para
              cambiar la contraseña.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmReset(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button onClick={handleResetPassword} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar borrar */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar usuario?</DialogTitle>
            <DialogDescription>
              Esta acción es irreversible. Borra el usuario, su wallet, todas sus
              operaciones y todo su historial. Las operaciones abiertas se cancelan.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Sí, borrar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
