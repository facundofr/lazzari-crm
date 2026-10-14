"use client";

/**
 * Reglas comerciales de un proveedor de la lista de costos: semáforo de vigencia, ícono ℹ️ con el detalle,
 * chips de descuentos opcionales (no incluidos en el costo) y avisos "Verificar" / "Pedir actualización".
 * Todo es informativo: nunca frena una cotización.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import {
  semaforoVigencia, chipOpcional, textoOpcional, textoDescuentosLista, pideVerificar, EMOJI_SEMAFORO, type Semaforo,
} from "@/lib/lista-costos";
import type { ReglasCostos } from "./reglas-datos";

const PUNTO: Record<Semaforo["color"], string> = { verde: "bg-emerald-500", amarillo: "bg-amber-400", rojo: "bg-red-500" };

export function PuntoSemaforo({ semaforo }: { semaforo: Semaforo }) {
  return <span title={semaforo.texto} className={`inline-block h-2 w-2 shrink-0 rounded-full ${PUNTO[semaforo.color]}`} />;
}

/** Detalle completo de la regla (se usa en el ℹ️ y en la ficha del proveedor). */
export function DetalleRegla({ proveedor, datos }: { proveedor: string; datos: ReglasCostos }) {
  const regla = datos.reglas[proveedor];
  const ops = datos.opcionales[proveedor] || [];
  const sem = semaforoVigencia(regla);
  if (!regla) return <p className="text-xs text-zinc-500">Todavía no hay reglas cargadas para «{proveedor}».</p>;
  const descuentos = textoDescuentosLista(regla);
  return (
    <div className="space-y-1.5 text-xs">
      <p className="flex flex-wrap items-center gap-1.5">
        <span>{EMOJI_SEMAFORO[sem.color]}</span>
        <span className="font-medium">{regla.vigencia_texto || "Sin fecha"}</span>
        <span className="text-zinc-500">· {sem.texto}</span>
        {regla.moneda && <span className="text-zinc-500">· {regla.moneda}</span>}
        {sem.pedirActualizacion && <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Pedir actualización</span>}
      </p>
      {descuentos && <p><span className="text-zinc-500">En el costo:</span> <span className="font-medium">{descuentos}</span></p>}
      {regla.como_se_calcula && <p><span className="text-zinc-500">Cómo se calcula:</span> {regla.como_se_calcula}</p>}
      {regla.condiciones && <p><span className="text-zinc-500">Condiciones:</span> {regla.condiciones}</p>}
      {ops.length > 0 && (
        <div>
          <p className="text-zinc-500">No incluidos en el costo (margen extra si se consiguen):</p>
          <ul className="ml-3 list-disc">
            {ops.map((o) => <li key={o.tipo} className="text-emerald-700 dark:text-emerald-400">{textoOpcional(o)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Botón ℹ️ que abre el detalle en una ventanita flotante (no se corta dentro de tablas con scroll). */
export function InfoRegla({ proveedor, datos }: { proveedor: string; datos: ReglasCostos }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pos) return;
    const cerrar = () => setPos(null);
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => { window.removeEventListener("scroll", cerrar, true); window.removeEventListener("resize", cerrar); };
  }, [pos]);
  function abrir(e: React.MouseEvent) {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = 360;
    setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 260), left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) });
  }
  return (
    <>
      <button ref={btn} type="button" onClick={abrir} title="Reglas del proveedor" className="text-sky-600 hover:text-sky-700">
        <Info className="h-3.5 w-3.5" />
      </button>
      {pos && typeof document !== "undefined" && createPortal(
        // stopPropagation: los eventos del portal suben por React y si no, el clic tildaría la fila de la tabla.
        <div className="fixed inset-0 z-[120]" onMouseDown={() => setPos(null)} onClick={(e) => e.stopPropagation()}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ top: pos.top, left: pos.left }}
            className="absolute w-[360px] max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <p className="mb-1.5 text-sm font-semibold">{proveedor}</p>
            <DetalleRegla proveedor={proveedor} datos={datos} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Semáforo + ℹ️ + avisos + chips de opcionales, en una línea. `compacto` (filas de tablas): solo semáforo e ℹ️. */
export function AvisosProveedor({ proveedor, datos, compacto = false }: { proveedor: string; datos: ReglasCostos; compacto?: boolean }) {
  const regla = datos.reglas[proveedor];
  if (!regla) return null;
  const sem = semaforoVigencia(regla);
  const ops = datos.opcionales[proveedor] || [];
  return (
    <span className={`inline-flex ${compacto ? "shrink-0" : "flex-wrap"} items-center gap-1 align-middle`}>
      <PuntoSemaforo semaforo={sem} />
      <InfoRegla proveedor={proveedor} datos={datos} />
      {!compacto && sem.pedirActualizacion && <span title={sem.texto} className="rounded bg-red-100 px-1 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Pedir actualización</span>}
      {!compacto && pideVerificar(regla) && <span title={regla.condiciones || regla.como_se_calcula || ""} className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Verificar</span>}
      {!compacto && ops.map((o) => (
        <span key={o.tipo} title={`No incluido en el costo: ${textoOpcional(o)}`} className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {chipOpcional(o)}
        </span>
      ))}
    </span>
  );
}
