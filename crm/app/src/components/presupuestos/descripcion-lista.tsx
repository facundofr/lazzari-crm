"use client";

/**
 * Descripción del renglón del presupuesto que busca en la lista de costos mientras se escribe (Augusto 13/10).
 * ↓/↑ para moverse, Enter o clic para elegir, Esc para cerrar. Si no se elige nada, queda el texto escrito a mano.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { traerListaCompleta, type FilaLista } from "@/components/presupuestos/catalogo-picker";
import { buscarEnLista } from "@/lib/presupuesto-ayudas";

interface Props {
  value: string;
  onChange: (texto: string) => void;
  onElegir: (fila: FilaLista) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
  placeholder?: string;
}

const fmt = (n: number, m: string) =>
  `${m === "ARS" ? "$" : m === "USD divisa" ? "US$ div" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DescripcionLista({ value, onChange, onElegir, onKeyDown, className, placeholder }: Props) {
  const [filas, setFilas] = useState<FilaLista[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const cargar = () => { if (!filas.length) traerListaCompleta().then(setFilas).catch(() => { /* sin lista: se escribe a mano */ }); };
  const resultados = useMemo(() => (abierto ? buscarEnLista(filas, value, 8) : []), [abierto, filas, value]);
  const visible = abierto && resultados.length > 0;

  useEffect(() => { setMarcado(-1); }, [value]);
  useEffect(() => {
    if (!visible) return;
    const ubicar = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 560) });
    };
    ubicar();
    window.addEventListener("scroll", ubicar, true);
    window.addEventListener("resize", ubicar);
    return () => { window.removeEventListener("scroll", ubicar, true); window.removeEventListener("resize", ubicar); };
  }, [visible]);

  function elegir(f: FilaLista) { setAbierto(false); onElegir(f); }

  return (
    <>
      <input ref={ref} value={value} placeholder={placeholder} className={className} data-desc
        onFocus={cargar}
        onChange={(e) => { onChange(e.target.value); setAbierto(true); }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (visible) {
            if (e.key === "ArrowDown") { e.preventDefault(); setMarcado((i) => Math.min(resultados.length - 1, i + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setMarcado((i) => Math.max(-1, i - 1)); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAbierto(false); return; }
            if (e.key === "Enter" && marcado >= 0) { e.preventDefault(); e.stopPropagation(); elegir(resultados[marcado]); return; }
          }
          if (e.key === "Enter") setAbierto(false);
          onKeyDown?.(e);
        }} />
      {visible && pos && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, zIndex: 90 }}
          className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="px-2 py-1 text-[10px] text-zinc-400">Lista de costos · ↓ y Enter para elegir · seguí escribiendo para cargarlo a mano</div>
          {resultados.map((f, i) => (
            <button key={f.id} type="button" onMouseDown={(e) => { e.preventDefault(); elegir(f); }} onMouseEnter={() => setMarcado(i)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${i === marcado ? "bg-orange-50 dark:bg-orange-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}>
              <span className="w-24 shrink-0 truncate font-mono text-zinc-500">{f.codigo_interno || f.codigo}</span>
              <span className="flex-1 truncate text-zinc-800 dark:text-zinc-100">{f.descripcion}</span>
              <span className="w-28 shrink-0 truncate text-zinc-400">{f.proveedor}</span>
              <span className="w-24 shrink-0 text-right font-mono text-zinc-600 dark:text-zinc-300">{fmt(f.costo, f.moneda)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
