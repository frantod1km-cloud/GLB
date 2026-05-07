import Link from "next/link";
import { TrendingUp } from "lucide-react";

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="font-bold text-2xl">Golbit</span>
        </Link>

        <div className="bg-card border border-border/60 rounded-lg p-8">
          <h1 className="text-2xl font-bold mb-2">Crear cuenta</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Registrate para empezar a aprender
          </p>

          <div className="rounded-md bg-muted/50 border border-border/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">
              ⚙️ En construcción
            </p>
            <p>El formulario de registro se habilita en el paso 2.</p>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Iniciá sesión
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
