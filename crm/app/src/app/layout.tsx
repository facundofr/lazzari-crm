import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lazzari CRM — Sistema de Gestión",
  description: "Sistema de gestión integral para Lazzari Soluciones Industriales",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
