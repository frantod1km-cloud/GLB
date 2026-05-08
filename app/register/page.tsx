import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { RegisterForm } from "@/components/auth/register-form";

export const dynamic = "force-dynamic";

export default function RegisterPage({
  searchParams,
}: {
  searchParams: { ref?: string };
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-xl tracking-tight">Golbit</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Crear cuenta</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Es gratis y solo te lleva un minuto
          </p>
        </div>

        <RegisterForm />

        <div className="text-center text-sm text-muted-foreground">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Iniciar sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
