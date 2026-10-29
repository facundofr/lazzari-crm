"use client";

import { Sparkles } from "lucide-react";
import { useTheme } from "@/lib/theme-context";

/**
 * Prende o apaga el diseño nuevo en prueba (Augusto 29/10). Se guarda en esta compu (localStorage):
 * nadie más lo ve, los datos y los botones son los mismos.
 */
export function DisenoNuevoInterruptor() {
  const { disenoNuevo, setDisenoNuevo } = useTheme();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">Diseño nuevo (prueba)</p>
        <p className="text-xs text-zinc-500">Solo en esta compu. Cambia cómo se ve, no lo que hace: lo apagás y vuelve al de siempre.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={disenoNuevo}
        aria-label="Diseño nuevo (prueba)"
        onClick={() => setDisenoNuevo(!disenoNuevo)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${disenoNuevo ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${disenoNuevo ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
