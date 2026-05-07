import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
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
          <h1 className="text-2xl font-bold mb-2">Iniciar sesión</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Ingresá a tu cuenta para empezar a operar
          </p>

          <LoginForm />

          <div className="mt-6 text-center text-sm text-muted-foreground">
            ¿No tenés cuenta?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Registrate
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
