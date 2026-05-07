"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, AlertCircle, Settings as SettingsIcon } from "lucide-react";
import { updateWalletSettingsAction } from "@/app/actions/wallet";

interface SettingsFormProps {
  initial: any;
}

export function SettingsForm({ initial }: SettingsFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await updateWalletSettingsAction(formData);
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-8">
      <Section title="🆕 Saldo inicial al registrarse">
        <Field
          label="Saldo inicial (USDT)"
          name="initial_balance"
          type="number"
          step="0.01"
          defaultValue={initial.initial_balance}
          hint="Monto que se acredita automáticamente cuando un usuario nuevo se registra. 0 = sin saldo inicial."
        />
      </Section>

      <Section title="🟢 Depósitos">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Modo de aprobación"
            name="deposit_mode"
            defaultValue={initial.deposit_mode}
            options={[
              { value: "free", label: "Libre (instantáneo)" },
              { value: "review", label: "En revisión (aprobación manual)" },
            ]}
            hint="En modo libre, los depósitos se acreditan al instante."
          />
          <Field
            label="Tiempo de revisión (horas)"
            name="deposit_review_hours"
            type="number"
            step="0.5"
            defaultValue={initial.deposit_review_hours}
            hint="Solo aplica si el modo es 'En revisión'."
          />
        </div>

        <SelectField
          label="UI de depósito"
          name="deposit_ui_mode"
          defaultValue={initial.deposit_ui_mode}
          options={[
            { value: "simple", label: "Simple (solo monto)" },
            { value: "proof", label: "Comprobante (URL de imagen)" },
            { value: "wallet", label: "Dirección de billetera (más realista)" },
          ]}
          hint="Cómo ven los alumnos el formulario de depósito."
        />

        <Field
          label="Dirección de billetera ficticia"
          name="deposit_wallet_address"
          type="text"
          defaultValue={initial.deposit_wallet_address}
          hint="Solo se muestra si el UI de depósito es 'Dirección de billetera'."
        />

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Mínimo (USDT)"
            name="deposit_min"
            type="number"
            step="0.01"
            defaultValue={initial.deposit_min}
          />
          <Field
            label="Máximo (USDT)"
            name="deposit_max"
            type="number"
            step="0.01"
            defaultValue={initial.deposit_max}
          />
        </div>
      </Section>

      <Section title="🔴 Retiros">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Modo de aprobación"
            name="withdrawal_mode"
            defaultValue={initial.withdrawal_mode}
            options={[
              { value: "free", label: "Libre (instantáneo)" },
              { value: "review", label: "En revisión (aprobación manual)" },
            ]}
          />
          <Field
            label="Tiempo de revisión (horas)"
            name="withdrawal_review_hours"
            type="number"
            step="0.5"
            defaultValue={initial.withdrawal_review_hours}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field
            label="Mínimo (USDT)"
            name="withdrawal_min"
            type="number"
            step="0.01"
            defaultValue={initial.withdrawal_min}
          />
          <Field
            label="Máximo (USDT)"
            name="withdrawal_max"
            type="number"
            step="0.01"
            defaultValue={initial.withdrawal_max}
          />
          <Field
            label="Máx diario por usuario"
            name="withdrawal_daily_max"
            type="number"
            step="0.01"
            defaultValue={initial.withdrawal_daily_max}
            hint="0 = sin límite"
          />
        </div>
      </Section>

      <div className="flex items-center gap-3 pt-4 border-t border-border/40">
        <Button type="submit" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <SettingsIcon className="w-4 h-4" />
              Guardar cambios
            </>
          )}
        </Button>

        {saved && (
          <div className="flex items-center gap-1.5 text-sm text-primary">
            <Check className="w-4 h-4" />
            Configuración guardada
          </div>
        )}

        {error && (
          <div className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/60 rounded-lg p-6 space-y-4">
      <h2 className="font-semibold text-lg">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  hint,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: any;
  hint?: string;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue ?? ""}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
