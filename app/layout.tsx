import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Golbit | Trading Educativo",
  description: "Plataforma educativa de trading con simulación avanzada",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
