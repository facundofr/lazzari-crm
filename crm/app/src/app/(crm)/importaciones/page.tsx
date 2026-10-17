"use client";

/** Importaciones: se desarrolla más adelante (Augusto 16/10/2026). Oculta en el menú; esta pantalla evita que el link dé error. */
import { Plane } from "lucide-react";
import { Header } from "@/components/layout/header";

export default function ImportacionesPage() {
  return (
    <div>
      <Header title="Importaciones" subtitle="Próximamente" />
      <div className="px-3 sm:px-4 py-10">
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center text-zinc-500">
          <Plane className="h-10 w-10 text-zinc-400" />
          <p className="text-sm">Esta sección se está preparando.</p>
        </div>
      </div>
    </div>
  );
}
