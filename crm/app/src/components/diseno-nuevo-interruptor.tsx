"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useTheme } from "@/lib/theme-context";

/**
 * Prende o apaga el diseño nuevo para todos los usuarios (Augusto 30/10: "que usen el que estoy usando yo").
 * Lo ve solo super_admin; se guarda en la base (/api/diseno-nuevo). Los datos y los botones son los mismos.
 */
export function DisenoNuevoInterruptor() {
  const { disenoNuevo, setDisenoNuevo } = useTheme();
  const [guardando, setGuardando] = useState(false);

  async function cambiar() {
    const nuevo = !disenoNuevo;
    if (!confirm(nuevo
      ? "¿Prender el diseño nuevo para todos? Lo ven al recargar la página."
      : "¿Apagar el diseño nuevo? Todos vuelven al de siempre al recargar la página.")) return;
    setGuardando(true);
    const r = await fetch("/api/diseno-nuevo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ todos: nuevo }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setGuardando(false);
    if (!r?.ok) { alert(`No se pudo guardar: ${d.error ?? "sin conexión"}`); return; }
    setDisenoNuevo(nuevo);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">Diseño nuevo para todos</p>
        <p className="text-xs text-zinc-500">Lo ven todos los usuarios. Cambia cómo se ve, no lo que hace: lo apagás y vuelve al de siempre.</p>
      </div>
      {guardando && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      <button
        type="button"
        role="switch"
        aria-checked={disenoNuevo}
        aria-label="Diseño nuevo para todos"
        disabled={guardando}
        onClick={() => void cambiar()}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${disenoNuevo ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${disenoNuevo ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
