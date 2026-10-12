"use client";

// Botón "🚩 Dejar para revisar" + guardado en finanzas_revisar (Finanzas > Hoy > Revisar).
// Se usa desde cheques, cobros, facturas, órdenes de pago y extracto. Nunca frena nada: solo anota.
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { todayAR } from "@/lib/utils";
import { MOTIVOS_REVISAR, type RevisarEntidad } from "@/lib/revisar-finanzas";
import { Flag, Loader2, X } from "lucide-react";

export interface DatosRevisar {
  entidad_tipo: RevisarEntidad;
  entidad_id?: string | null;
  titulo: string;
  motivo?: string;
  nota?: string | null;
  importe?: number | null;
  moneda?: "ARS" | "USD";
  cliente_id?: string | null;
  proveedor_id?: string | null;
  recordar_el?: string | null;
}

/** Guarda una cosa para revisar. Devuelve el texto del error (o null si salió bien). */
export async function guardarRevisar(sociedadId: string, d: DatosRevisar): Promise<string | null> {
  const { error } = await (supabase as any).from("finanzas_revisar").insert({
    sociedad_id: sociedadId,
    entidad_tipo: d.entidad_tipo,
    entidad_id: d.entidad_id || null,
    titulo: d.titulo.trim().slice(0, 200) || "Sin título",
    motivo: d.motivo || "otro",
    nota: d.nota?.trim() || null,
    importe: d.importe ?? null,
    moneda: d.moneda || "ARS",
    cliente_id: d.cliente_id || null,
    proveedor_id: d.proveedor_id || null,
    recordar_el: d.recordar_el || null,
  });
  if (!error) return null;
  if (/finanzas_revisar/.test(String(error.message || ""))) return "Falta correr la migración de \"Revisar\" (20261012100000).";
  return error.message || "No se pudo guardar.";
}

const inp = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

/** Botón chico + ventanita con motivo, nota y "Recordarme el". */
export function BotonDejarRevisar({ datos, className = "", etiqueta = "Dejar para revisar", onGuardado }: {
  datos: DatosRevisar;
  className?: string;
  etiqueta?: string;
  onGuardado?: () => void;
}) {
  const { sociedadActiva } = useUser();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState(datos.motivo || "otro");
  const [nota, setNota] = useState(datos.nota || "");
  const [recordar, setRecordar] = useState(datos.recordar_el || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  async function guardar() {
    if (!sociedadActiva?.id) return;
    setGuardando(true);
    setError(null);
    const e = await guardarRevisar(sociedadActiva.id, { ...datos, motivo, nota, recordar_el: recordar || null });
    setGuardando(false);
    if (e) { setError(e); return; }
    setListo(true);
    setAbierto(false);
    onGuardado?.();
  }

  return (
    <>
      <button type="button" onClick={(ev) => { ev.stopPropagation(); setAbierto(true); setListo(false); }}
        title="Anotarlo en Finanzas > Hoy > Revisar"
        className={`inline-flex items-center gap-1 rounded-lg border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40 ${className}`}>
        <Flag className="h-3.5 w-3.5" /> {listo ? "Anotado en Revisar" : etiqueta}
      </button>
      {abierto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(ev) => { ev.stopPropagation(); setAbierto(false); }}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(ev) => ev.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white"><Flag className="h-4 w-4 text-amber-500" /> Dejar para revisar</h3>
              <button type="button" onClick={() => setAbierto(false)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">{datos.titulo}</p>
            <div className="space-y-2">
              <div><label className="text-xs text-zinc-500">Motivo</label>
                <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={inp}>
                  {MOTIVOS_REVISAR.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select></div>
              <div><label className="text-xs text-zinc-500">Nota</label>
                <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} className={inp} placeholder="Qué hay que revisar" /></div>
              <div><label className="text-xs text-zinc-500">Recordarme el (opcional)</label>
                <input type="date" min={todayAR()} value={recordar} onChange={(e) => setRecordar(e.target.value)} className={inp} /></div>
            </div>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setAbierto(false)} className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button type="button" onClick={guardar} disabled={guardando}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
