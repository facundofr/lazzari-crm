"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// Botoncito para copiar un texto al portapapeles (monto, CBU, alias, CUIT).
export function CopiarBtn({ texto, title = "Copiar" }: { texto: string; title?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title={ok ? "Copiado" : title}
      onClick={async () => {
        try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin portapapeles */ }
      }}
      className="inline-flex shrink-0 items-center rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-orange-500 dark:hover:bg-zinc-800">
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
