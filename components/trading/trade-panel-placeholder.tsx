import { Lock } from "lucide-react";

export function TradePanelPlaceholder() {
  return (
    <div className="bg-card border border-border/60 rounded-lg p-5 sticky top-24">
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mx-auto mb-3">
        <Lock className="w-5 h-5 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-center mb-1">Trading próximamente</h3>
      <p className="text-xs text-muted-foreground text-center mb-4">
        El panel de operaciones se habilita en el siguiente paso del desarrollo
      </p>

      {/* Preview de cómo va a verse */}
      <div className="space-y-3 opacity-50 pointer-events-none">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-primary/10 rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">Comprar</div>
            <div className="font-bold text-primary text-sm">Long</div>
          </div>
          <div className="bg-destructive/10 rounded p-2 text-center">
            <div className="text-xs text-muted-foreground">Vender</div>
            <div className="font-bold text-destructive text-sm">Short</div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Monto USDT</div>
          <div className="h-9 bg-muted/30 rounded" />
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">Apalancamiento</div>
          <div className="h-2 bg-muted/30 rounded-full" />
        </div>

        <div className="h-10 bg-primary/30 rounded" />
      </div>
    </div>
  );
}
