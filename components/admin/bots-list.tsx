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
import {
  Trash2,
  Pencil,
  Loader2,
  Plus,
  AlertCircle,
  ExternalLink,
  Bot as BotIcon,
} from "lucide-react";
import {
  setBotBalanceAction,
  toggleBotAction,
  deleteBotAction,
  createBotAction,
  updateBotConfigAction,
} from "@/app/actions/bots";
import { formatUSDT } from "@/lib/utils";

type Personality = "random" | "momentum" | "mean_reversion";

const PERSONALITY_LABELS: Record<Personality, { label: string; emoji: string; desc: string }> = {
  random: { label: "Random", emoji: "🎲", desc: "Compra/vende al azar" },
  momentum: { label: "Momentum", emoji: "📈", desc: "Sigue la tendencia" },
  mean_reversion: { label: "Mean Reversion", emoji: "🔄", desc: "Contrario a tendencia" },
};

interface BotsListProps {
  bots: any[];
}

export function BotsList({ bots }: BotsListProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<any>(null);
  const [editBalance, setEditBalance] = useState<{ id: string; current: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Form de creación
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPersonality, setNewPersonality] = useState<Personality>("random");
  const [newBalance, setNewBalance] = useState("5000");
  const [newTickInterval, setNewTickInterval] = useState("30");
  const [newAmountMin, setNewAmountMin] = useState("50");
  const [newAmountMax, setNewAmountMax] = useState("500");
  const [newLeverage, setNewLeverage] = useState("5");
  const [newCloseProb, setNewCloseProb] = useState("0.3");

  // Form de edición config
  const [editPersonality, setEditPersonality] = useState<Personality>("random");
  const [editTickInterval, setEditTickInterval] = useState("30");
  const [editAmountMin, setEditAmountMin] = useState("50");
  const [editAmountMax, setEditAmountMax] = useState("500");
  const [editLeverage, setEditLeverage] = useState("5");
  const [editCloseProb, setEditCloseProb] = useState("0.3");

  const [editValue, setEditValue] = useState("");

  function handleCreate() {
    setError(null);
    const formData = new FormData();
    formData.set("email", newEmail);
    formData.set("full_name", newName);
    formData.set("personality", newPersonality);
    formData.set("initial_balance", newBalance);
    formData.set("tick_interval_seconds", newTickInterval);
    formData.set("amount_min", newAmountMin);
    formData.set("amount_max", newAmountMax);
    formData.set("leverage", newLeverage);
    formData.set("close_probability", newCloseProb);

    startTransition(async () => {
      const r = await createBotAction(formData);
      if (r.error) setError(r.error);
      else {
        setCreateOpen(false);
        setNewEmail("");
        setNewName("");
        router.refresh();
      }
    });
  }

  function openEditConfig(bot: any) {
    setEditConfig(bot);
    setEditPersonality(bot.personality || "random");
    setEditTickInterval(String(bot.tick_interval_seconds || 30));
    setEditAmountMin(String(bot.amount_min || 50));
    setEditAmountMax(String(bot.amount_max || 500));
    setEditLeverage(String(bot.leverage || 5));
    setEditCloseProb(String(bot.close_probability || 0.3));
  }

  function handleSaveConfig() {
    if (!editConfig) return;
    setError(null);
    startTransition(async () => {
      const r = await updateBotConfigAction(editConfig.id, {
        personality: editPersonality,
        tick_interval_seconds: Number(editTickInterval),
        amount_min: Number(editAmountMin),
        amount_max: Number(editAmountMax),
        leverage: Number(editLeverage),
        close_probability: Number(editCloseProb),
      });
      if (r.error) setError(r.error);
      else {
        setEditConfig(null);
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
      const r = await setBotBalanceAction(editBalance.id, v);
      if (r.error) setError(r.error);
      else {
        setEditBalance(null);
        setEditValue("");
        router.refresh();
      }
    });
  }

  function handleToggle(botId: string, value: boolean) {
    startTransition(async () => {
      await toggleBotAction(botId, value);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteBotAction(deleteConfirm);
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
          {bots.length} bot{bots.length !== 1 ? "s" : ""} registrado{bots.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" />
          Crear bot
        </Button>
      </div>

      {bots.length === 0 ? (
        <div className="text-center py-12 px-6 border-2 border-dashed border-border/40 rounded-lg">
          <div className="text-4xl mb-3">🤖</div>
          <h3 className="font-semibold mb-1">No hay bots todavía</h3>
          <p className="text-sm text-muted-foreground">
            Creá el primer bot. Operan automáticamente según su personalidad.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {bots.map((bot) => {
            const balance = Number(bot.balance || 0);
            const locked = Number(bot.locked_balance || 0);
            const personality = (bot.personality || "random") as Personality;
            const personalityInfo = PERSONALITY_LABELS[personality];

            return (
              <div
                key={bot.id}
                className="bg-card border border-border/60 rounded-lg p-4 flex items-center gap-4 hover:border-border transition-colors flex-wrap"
              >
                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center text-2xl flex-shrink-0">
                  {personalityInfo.emoji}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{bot.full_name}</span>
                    {bot.is_active ? (
                      <Badge variant="default">Activo</Badge>
                    ) : (
                      <Badge variant="secondary">Pausado</Badge>
                    )}
                    <Badge variant="warning">{personalityInfo.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    <span>{bot.email}</span>
                    <span>Tick: {bot.tick_interval_seconds}s</span>
                    <span>
                      Monto: {formatUSDT(Number(bot.amount_min))}-
                      {formatUSDT(Number(bot.amount_max))}
                    </span>
                    <span>Leverage: {bot.leverage}x</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-bold font-mono text-lg">
                    {formatUSDT(balance)} USDT
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bot.open_trades_count || 0} abiertas
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <Switch
                    checked={bot.is_active}
                    onCheckedChange={(v) => handleToggle(bot.id, v)}
                    disabled={isPending}
                  />
                  <Button asChild variant="ghost" size="icon" title="Ver detalle">
                    <Link href={`/admin/bots/${bot.id}`}>
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditConfig(bot)}
                    title="Editar config"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditBalance({ id: bot.id, current: balance });
                      setEditValue(String(balance));
                    }}
                    title="Cambiar saldo"
                    className="text-yellow-500 hover:text-yellow-500"
                  >
                    💰
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(bot.id)}
                    title="Eliminar"
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

      {/* Crear bot */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>🤖 Crear nuevo bot</DialogTitle>
            <DialogDescription>
              Los bots operan automáticamente todo el tiempo, generando ruido de mercado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email único</Label>
                <Input
                  type="email"
                  placeholder="bot1@golbit.local"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nombre / alias</Label>
                <Input
                  placeholder="Bot Alpha"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Personalidad</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PERSONALITY_LABELS) as Personality[]).map((p) => {
                  const info = PERSONALITY_LABELS[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPersonality(p)}
                      disabled={isPending}
                      className={`p-3 rounded-md border text-xs transition-all ${
                        newPersonality === p
                          ? "border-primary bg-primary/10"
                          : "border-border bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <div className="text-xl mb-1">{info.emoji}</div>
                      <div className="font-semibold">{info.label}</div>
                      <div className="text-muted-foreground text-[10px] mt-1">
                        {info.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Saldo inicial USDT</Label>
                <Input
                  type="number"
                  step="any"
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Intervalo entre ops (seg)</Label>
                <Input
                  type="number"
                  min="5"
                  value={newTickInterval}
                  onChange={(e) => setNewTickInterval(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monto mínimo</Label>
                <Input
                  type="number"
                  step="any"
                  value={newAmountMin}
                  onChange={(e) => setNewAmountMin(e.target.value)}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monto máximo</Label>
                <Input
                  type="number"
                  step="any"
                  value={newAmountMax}
                  onChange={(e) => setNewAmountMax(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Leverage</Label>
                <select
                  value={newLeverage}
                  onChange={(e) => setNewLeverage(e.target.value)}
                  disabled={isPending}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                >
                  {[1, 2, 5, 10, 25].map((l) => (
                    <option key={l} value={l}>
                      {l}x
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Prob. de cerrar (0-1)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={newCloseProb}
                  onChange={(e) => setNewCloseProb(e.target.value)}
                  disabled={isPending}
                />
              </div>
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
              Crear bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar config */}
      <Dialog open={!!editConfig} onOpenChange={(o) => !o && setEditConfig(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar configuración del bot</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Personalidad</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PERSONALITY_LABELS) as Personality[]).map((p) => {
                  const info = PERSONALITY_LABELS[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEditPersonality(p)}
                      disabled={isPending}
                      className={`p-2 rounded-md border text-xs transition-all ${
                        editPersonality === p
                          ? "border-primary bg-primary/10"
                          : "border-border bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <div className="text-lg">{info.emoji}</div>
                      <div className="font-semibold text-[10px]">{info.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Intervalo (seg)</Label>
                <Input
                  type="number"
                  min="5"
                  value={editTickInterval}
                  onChange={(e) => setEditTickInterval(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Leverage</Label>
                <select
                  value={editLeverage}
                  onChange={(e) => setEditLeverage(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                >
                  {[1, 2, 5, 10, 25].map((l) => (
                    <option key={l} value={l}>
                      {l}x
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Monto mínimo</Label>
                <Input
                  type="number"
                  step="any"
                  value={editAmountMin}
                  onChange={(e) => setEditAmountMin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Monto máximo</Label>
                <Input
                  type="number"
                  step="any"
                  value={editAmountMax}
                  onChange={(e) => setEditAmountMax(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Prob. de cerrar (0-1)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={editCloseProb}
                onChange={(e) => setEditCloseProb(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditConfig(null)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSaveConfig} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar saldo */}
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
            <DialogTitle>Editar saldo</DialogTitle>
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
            <DialogTitle>¿Eliminar bot?</DialogTitle>
            <DialogDescription>
              Borra el bot, su wallet y todo su historial. Trades abiertos se cancelan.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirm(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
