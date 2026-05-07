"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Activity, Zap, AlertCircle, CheckCircle2, Copy, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EngineStatusProps {
  initialSecondsAgo: number | null;
  initialLastTick: string | null;
}

export function EngineStatus({ initialSecondsAgo, initialLastTick }: EngineStatusProps) {
  const [lastTick, setLastTick] = useState<Date | null>(
    initialLastTick ? new Date(initialLastTick) : null
  );
  const [now, setNow] = useState(Date.now());
  const [showSetup, setShowSetup] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loadingSecret, setLoadingSecret] = useState(false);

  // Tick cada 1s para actualizar "hace X seg"
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Suscribirse a updates de coins para detectar ticks en vivo
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("engine-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "coins" },
        (payload: any) => {
          if (payload.new?.last_tick_at) {
            setLastTick(new Date(payload.new.last_tick_at));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const secondsAgo = lastTick ? Math.floor((now - lastTick.getTime()) / 1000) : null;
  const isHealthy = secondsAgo !== null && secondsAgo < 30;
  const isWarning = secondsAgo !== null && secondsAgo >= 30 && secondsAgo < 120;
  const isDead = secondsAgo === null || secondsAgo >= 120;

  async function loadSecret() {
    setLoadingSecret(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_get_engine_secret");
    if (data?.secret) setSecret(data.secret);
    setLoadingSecret(false);
  }

  async function regenerateSecret() {
    if (!confirm("¿Regenerar el secret? El cron externo va a fallar hasta que lo actualices.")) return;
    setLoadingSecret(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_regenerate_engine_secret");
    if (data?.secret) setSecret(data.secret);
    setLoadingSecret(false);
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://TU-PROYECTO.supabase.co";
  const tickUrl = `${supabaseUrl}/functions/v1/tick-engine`;

  return (
    <div
      className={`rounded-lg border p-4 ${
        isHealthy
          ? "border-primary/30 bg-primary/5"
          : isWarning
            ? "border-yellow-500/30 bg-yellow-500/5"
            : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isHealthy
                ? "bg-primary/20 text-primary"
                : isWarning
                  ? "bg-yellow-500/20 text-yellow-500"
                  : "bg-destructive/20 text-destructive"
            }`}
          >
            {isHealthy ? (
              <Activity className="w-5 h-5 animate-pulse-glow" />
            ) : isWarning ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2">
              Motor de precios
              {isHealthy && <span className="text-xs font-normal text-primary">● Vivo</span>}
              {isWarning && (
                <span className="text-xs font-normal text-yellow-500">● Lento</span>
              )}
              {isDead && (
                <span className="text-xs font-normal text-destructive">● Detenido</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {secondsAgo === null
                ? "Sin datos todavía"
                : secondsAgo < 5
                  ? `Tickeó hace ${secondsAgo}s`
                  : `Último tick: hace ${formatDuration(secondsAgo)}`}
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setShowSetup(!showSetup);
            if (!showSetup && !secret) loadSecret();
          }}
        >
          <Zap className="w-4 h-4" />
          {showSetup ? "Ocultar setup" : "Configurar cron"}
        </Button>
      </div>

      {showSetup && (
        <div className="mt-4 pt-4 border-t border-border/40 space-y-4">
          <div className="text-sm">
            <p className="font-medium mb-2">📡 Configurar cron externo (cron-job.org)</p>
            <p className="text-muted-foreground mb-4">
              Necesitás 2 valores: la URL de la Edge Function y el secret. Configuralos en{" "}
              <a
                href="https://cron-job.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                cron-job.org
              </a>{" "}
              para que invoque la URL cada 10 segundos.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                URL de la Edge Function
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 px-3 py-2 bg-background border border-border/40 rounded text-xs font-mono break-all">
                  {tickUrl}
                </code>
                <Button variant="outline" size="icon" onClick={() => copy(tickUrl, "url")}>
                  {copied === "url" ? (
                    <Check className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Secret (header: <code className="font-mono">X-Engine-Secret</code>)
              </label>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 px-3 py-2 bg-background border border-border/40 rounded text-xs font-mono break-all">
                  {loadingSecret
                    ? "Cargando..."
                    : secret
                      ? showSecret
                        ? secret
                        : "•".repeat(48)
                      : "—"}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowSecret(!showSecret)}
                  disabled={!secret}
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => secret && copy(secret, "secret")}
                  disabled={!secret}
                >
                  {copied === "secret" ? (
                    <Check className="w-4 h-4 text-primary" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={regenerateSecret}
              disabled={loadingSecret}
              className="text-destructive hover:text-destructive"
            >
              Regenerar secret
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seg`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} seg`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}
