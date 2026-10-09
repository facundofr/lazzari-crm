"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Campo que se va escribiendo y muestra solo las opciones que contienen esas letras (sin importar acentos). */
export function Autocompletar({ opciones, placeholder, onElegir, className = "", chico = false }: { opciones: Array<{ valor: string; texto: string }>; placeholder: string; onElegir: (valor: string) => void; className?: string; chico?: boolean }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const filtradas = useMemo(() => {
    const n = norm(q.trim());
    const base = n ? opciones.filter(o => norm(o.texto).includes(n)) : opciones;
    return [...base].sort((a, b) => (n ? Number(!norm(a.texto).startsWith(n)) - Number(!norm(b.texto).startsWith(n)) : 0)).slice(0, 50);
  }, [q, opciones]);
  function ubicar() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const arriba = window.innerHeight - r.bottom < 220 && r.top > 220;
    setPos({ position: "fixed", left: r.left, width: Math.max(r.width, 240), zIndex: 10000, ...(arriba ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }) });
  }
  function elegir(v: string) { onElegir(v); setQ(""); setAbierto(false); }
  return <>
    <input ref={ref} value={q} placeholder={placeholder}
      onChange={e => { setQ(e.target.value); setMarcado(0); ubicar(); setAbierto(true); }}
      onFocus={() => { ubicar(); setAbierto(true); }}
      onBlur={() => setTimeout(() => setAbierto(false), 150)}
      onKeyDown={e => {
        if (e.key === "ArrowDown") { e.preventDefault(); setMarcado(m => Math.min(m + 1, filtradas.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setMarcado(m => Math.max(m - 1, 0)); }
        else if (e.key === "Enter" && filtradas[marcado]) { e.preventDefault(); elegir(filtradas[marcado].valor); }
        else if (e.key === "Escape") setAbierto(false);
      }}
      className={`rounded border px-2 ${chico ? "py-0.5 text-[10px]" : "py-1 text-xs"} dark:bg-zinc-800 dark:text-white ${className}`} />
    {abierto && typeof document !== "undefined" && createPortal(
      <div style={pos} className="max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {filtradas.map((o, i) => <button key={o.valor} type="button" onMouseDown={e => { e.preventDefault(); elegir(o.valor); }} onMouseEnter={() => setMarcado(i)}
          className={`block w-full px-3 py-1.5 text-left text-xs dark:text-zinc-200 ${i === marcado ? "bg-orange-100 dark:bg-orange-900/40" : "hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}>{o.texto}</button>)}
        {!filtradas.length && <p className="px-3 py-2 text-xs text-zinc-400">{opciones.length ? "Sin coincidencias" : "Cargando…"}</p>}
      </div>, document.body)}
  </>;
}

export default Autocompletar;
