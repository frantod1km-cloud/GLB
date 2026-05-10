import { PiggyBank } from "lucide-react";

export const dynamic = "force-dynamic";

export default function EarnPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
        <PiggyBank className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <h1 className="text-2xl font-bold tracking-tight">Earn</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Próximamente disponible
        </p>
      </div>
    </div>
  );
}
