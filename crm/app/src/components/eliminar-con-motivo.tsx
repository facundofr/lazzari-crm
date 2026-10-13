"use client";

// Ventanita "Eliminar con motivo" para clientes y proveedores.
// La base decide: si tiene historial (presupuestos, facturas, cobros, OC, listas…) no se borra, se desactiva.
// Todo queda guardado en registros_eliminados (copia, motivo, quién y cuándo).
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Loader2, Trash2, X } from "lucide-react";

export type TipoEliminar = "cliente" | "proveedor";
export type ResultadoEliminar = { accion: "eliminado" | "desactivado"; historial: Record<string, number> };

/** Llama a eliminar_cliente / eliminar_proveedor. Devuelve el resultado o el texto del error. */
export async function eliminarConMotivo(tipo: TipoEliminar, id: string, motivo: string): Promise<ResultadoEliminar | string> {
  const fn = tipo === "cliente" ? "eliminar_cliente" : "eliminar_proveedor";
  const args = tipo === "cliente" ? { p_cliente_id: id, p_motivo: motivo } : { p_proveedor_id: id, p_motivo: motivo };
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) {
    const msg = String(error.message || "");
    if (/eliminar_(cliente|proveedor)/.test(msg)) return "Falta correr la migración de permisos (20261013100000).";
    return msg || "No se pudo eliminar.";
  }
  return data as ResultadoEliminar;
}

const inp = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

export function EliminarConMotivoModal({ tipo, id, nombre, onCerrar, onListo }: {
  tipo: TipoEliminar;
  id: string;
  nombre: string;
  onCerrar: () => void;
  /** Se llama con el resultado cuando la base confirmó. */
  onListo: (r: ResultadoEliminar) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const palabra = tipo === "cliente" ? "cliente" : "proveedor";

  async function confirmar() {
    if (motivo.trim().length < 3) { setError("Escribí el motivo."); return; }
    setGuardando(true);
    setError(null);
    const r = await eliminarConMotivo(tipo, id, motivo.trim());
    setGuardando(false);
    if (typeof r === "string") { setError(r); return; }
    onListo(r);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(ev) => { ev.stopPropagation(); if (!guardando) onCerrar(); }}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(ev) => ev.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white"><Trash2 className="h-4 w-4 text-red-500" /> Eliminar {palabra}</h3>
          <button type="button" onClick={onCerrar} disabled={guardando} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">{nombre}</p>
        <p className="mb-3 text-xs text-zinc-500">
          Si tiene historial (presupuestos, facturas, cobros, órdenes de compra, listas de precios…) no se borra: queda <b>desactivado</b>, para no perder datos.
          El motivo queda guardado con tu nombre y la fecha.
        </p>
        <label className="text-xs text-zinc-500">Motivo</label>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} className={inp} autoFocus
          placeholder={tipo === "cliente" ? "Ej.: cargado dos veces, cerró la empresa…" : "Ej.: cargado dos veces, no trabajamos más…"} />
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCerrar} disabled={guardando} className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={guardando || motivo.trim().length < 3}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
