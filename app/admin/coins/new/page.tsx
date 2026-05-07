import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CoinForm } from "@/components/admin/coin-form";

export default function NewCoinPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/coins"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a monedas
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Crear nueva moneda</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Configurá los parámetros del algoritmo de precio
        </p>
      </div>

      <CoinForm />
    </div>
  );
}
