"use client";

import { useState, useTransition, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerAction } from "@/app/actions/auth";
import { Loader2, AlertCircle, Gift } from "lucide-react";

export function RegisterForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [refCode, setRefCode] = useState("");
  const [isPending, startTransition] = useTransition();

  // Auto-completar código si vino por URL: /register?ref=ABC12345
  useEffect(() => {
    const fromUrl = searchParams.get("ref");
    if (fromUrl) setRefCode(fromUrl.toUpperCase());
  }, [searchParams]);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await registerAction(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="full_name">Nombre completo</Label>
        <Input
          id="full_name"
          name="full_name"
          type="text"
          placeholder="Juan Pérez"
          required
          autoComplete="name"
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="tu@email.com"
          required
          autoComplete="email"
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="Mínimo 6 caracteres"
          required
          autoComplete="new-password"
          minLength={6}
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="referral_code" className="flex items-center gap-1.5">
          <Gift className="w-3.5 h-3.5" />
          Código de referido <span className="text-muted-foreground font-normal">(opcional)</span>
        </Label>
        <Input
          id="referral_code"
          name="referral_code"
          type="text"
          placeholder="ABC12345"
          value={refCode}
          onChange={(e) => setRefCode(e.target.value.toUpperCase())}
          disabled={isPending}
          maxLength={8}
          className="uppercase"
        />
        {refCode && (
          <p className="text-xs text-primary">
            ✓ Vas a quedar referido al ingresar este código
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Creando cuenta...
          </>
        ) : (
          "Crear cuenta"
        )}
      </Button>
    </form>
  );
}
