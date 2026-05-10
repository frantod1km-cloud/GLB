import { Repeat } from "lucide-react";

export const dynamic = "force-dynamic";

export default function ConvertPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-card border border-border/60 rounded-lg p-12 text-center">
        <Repeat className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <h1 className="text-2xl font-bold tracking-tight">Convertir</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Próximamente disponible
        </p>
      </div>
    </div>
  );
}
