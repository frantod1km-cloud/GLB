import Link from "next/link";
import { TrendingUp, Activity, Wallet } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-xl tracking-tight">Golbit</span>
          </div>
          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium hover:text-primary transition-colors"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              Registrarse
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="container py-24 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse-glow"></span>
              Plataforma educativa
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
              Aprendé trading
              <span className="block text-primary mt-2">sin riesgo real</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-10 max-w-2xl mx-auto">
              Practicá con saldos simulados, gráficos en tiempo real y un
              entorno controlado por tu instructor. Diseñado para que aprendas
              cuándo entrar y cuándo salir.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/register"
                className="px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90 transition-opacity"
              >
                Comenzar ahora
              </Link>
              <Link
                href="/login"
                className="px-6 py-3 border border-border rounded-md font-medium hover:bg-secondary transition-colors"
              >
                Ya tengo cuenta
              </Link>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="container py-16 border-t border-border/40">
          <div className="grid md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Activity className="w-6 h-6" />}
              title="Trading simulado"
              description="Operá con gráficos realistas y precios que se mueven como el mercado real, sin arriesgar dinero."
            />
            <FeatureCard
              icon={<Wallet className="w-6 h-6" />}
              title="Wallet integrada"
              description="Gestioná tu saldo, depósitos y retiros simulados desde un solo lugar."
            />
            <FeatureCard
              icon={<TrendingUp className="w-6 h-6" />}
              title="Aprendizaje guiado"
              description="Tu instructor diseña los escenarios para que aprendas a leer el mercado paso a paso."
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-6">
        <div className="container text-center text-sm text-muted-foreground">
          © 2026 Golbit. Plataforma de trading simulado con fines educativos.
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-6 rounded-lg border border-border/60 bg-card hover:border-primary/40 transition-colors">
      <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
