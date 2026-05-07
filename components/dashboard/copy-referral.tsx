"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyReferralCode({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  function copyValue(value: string, type: "code" | "link") {
    navigator.clipboard.writeText(value);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!code) return null;

  const referralLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/register?ref=${code}`
      : `/register?ref=${code}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <code className="flex-1 px-4 py-2.5 bg-muted/50 border border-border rounded-md font-mono text-lg font-bold tracking-wider text-center">
          {code}
        </code>
        <Button
          variant="outline"
          size="icon"
          onClick={() => copyValue(code, "code")}
          title="Copiar código"
        >
          {copied === "code" ? (
            <Check className="w-4 h-4 text-primary" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>

      <Button
        variant="secondary"
        className="w-full text-xs"
        onClick={() => copyValue(referralLink, "link")}
      >
        {copied === "link" ? (
          <>
            <Check className="w-3.5 h-3.5" />
            ¡Link copiado!
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            Copiar link de invitación
          </>
        )}
      </Button>
    </div>
  );
}
