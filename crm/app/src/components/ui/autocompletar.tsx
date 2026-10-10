"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type OpcionAutocompletar = { valor: string; texto: string; /** Segunda línea chica en gris (ej. CUIT). También se busca por ahí. */ detalle?: string };

const MIN_LETRAS = 2;
const MAX_RESULTADOS = 8;
/** Con listas cortas (o si se pide), al entrar al campo se muestran las opciones sin escribir. */
const LISTA_CORTA = 30;
const MAX_SIN_ESCRIBIR = 50;

/** Campo que se va escribiendo y, desde 2 letras, muestra hasta 8 opciones que contienen esas letras (sin importar acentos).
 *  Con listas de hasta 30 opciones (o con mostrarSinEscribir) muestra la lista apenas se entra al campo. */
export function Autocompletar({ opciones, placeholder, onElegir, className = "", chico = false, mostrarSinEscribir = false }: { opciones: OpcionAutocompletar[]; placeholder: string; onElegir: (valor: string) => void; className?: string; chico?: boolean; mostrarSinEscribir?: boolean }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const sinEscribir = mostrarSinEscribir || opciones.length <= LISTA_CORTA;
  const { filtradas, hayMas } = useMemo(() => {
    const n = norm(q.trim());
    if (n.length < MIN_LETRAS) {
      if (!sinEscribir) return { filtradas: [] as OpcionAutocompletar[], hayMas: 0 };
      const base = n ? opciones.filter(o => norm(o.texto).includes(n) || (!!o.detalle && norm(o.detalle).includes(n))) : opciones;
      return { filtradas: base.slice(0, MAX_SIN_ESCRIBIR), hayMas: Math.max(0, base.length - MAX_SIN_ESCRIBIR) };
    }
    const soloDigitos = n.replace(/\D/g, "");
    const coincide = (o: OpcionAutocompletar) => norm(o.texto).includes(n) || (!!o.detalle && (norm(o.detalle).includes(n) || (soloDigitos.length >= MIN_LETRAS && soloDigitos === n.replace(/[\s.-]/g, "") && o.detalle.replace(/\D/g, "").includes(soloDigitos))));
    const todas = opciones.filter(coincide).sort((a, b) => Number(!norm(a.texto).startsWith(n)) - Number(!norm(b.texto).startsWith(n)));
    return { filtradas: todas.slice(0, MAX_RESULTADOS), hayMas: Math.max(0, todas.length - MAX_RESULTADOS) };
  }, [q, opciones, sinEscribir]);
  const faltanLetras = !sinEscribir && norm(q.trim()).length < MIN_LETRAS;
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
      faltanLetras
        ? <div style={pos} className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] text-zinc-400 shadow dark:border-zinc-700 dark:bg-zinc-900">Escribí 2 letras…</div>
        : <div style={pos} className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {filtradas.map((o, i) => <button key={o.valor} type="button" onMouseDown={e => { e.preventDefault(); elegir(o.valor); }} onMouseEnter={() => setMarcado(i)}
          className={`flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-xs dark:text-zinc-200 ${i === marcado ? "bg-orange-100 dark:bg-orange-900/40" : "hover:bg-orange-50 dark:hover:bg-orange-900/20"}`}>
          <span className="min-w-0 truncate">{o.texto}</span>
          {o.detalle && <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">{o.detalle}</span>}
        </button>)}
        {hayMas > 0 && <p className="border-t border-zinc-100 px-3 py-1 text-[10px] text-zinc-400 dark:border-zinc-800">Hay {hayMas} más: seguí escribiendo</p>}
        {!filtradas.length && <p className="px-3 py-2 text-xs text-zinc-400">{opciones.length ? "Sin coincidencias" : "Cargando…"}</p>}
      </div>, document.body)}
  </>;
}

export default Autocompletar;
