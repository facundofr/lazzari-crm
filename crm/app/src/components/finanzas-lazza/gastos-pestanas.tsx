"use client";

// Finanzas › Gastos › Editar pestañas (03/11/2026, Augusto: "dejame que pueda crear una pestaña nueva y ponerle con el nombre que
// yo quiera, o editar las que están ahí, así Nati puede reordenar toda la parte de reportes, contabilidad y gastos").
// Crear (nombre + a qué línea del Estado de resultados va), renombrar, cambiar el orden y ocultar. Nada se borra: los gastos de
// una pestaña oculta siguen sumando. Cambiar la línea de una pestaña con gastos avisa que mueve los meses pasados (nunca frena).
// Transportes queda fija (sale de las facturas de transporte). Tabla gastos_grupos; lógica en lib/gastos-grupos.
import { useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { GRUPO_TRANSPORTES } from "@/lib/gastos-lazza";
import { LINEAS_PESTANA, claveNueva, errorNombre, moverGrupo, nombreLinea, type GrupoGasto, type LineaGrupo } from "@/lib/gastos-grupos";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const sel = "!h-8 !py-0 !px-2 text-sm";
const opcionesLinea = LINEAS_PESTANA.map((l) => ({ value: l.id, label: l.nombre }));
const opcionesLineaBase = [{ value: "", label: nombreLinea(null) }, ...opcionesLinea];

interface Cambio { nombre: string; linea: string; oculto: boolean }

export function EditarPestanas({ grupos, sociedadId, onCambio, onCerrar }: { grupos: GrupoGasto[]; sociedadId: string; onCambio: () => void; onCerrar: () => void }) {
  const { toast } = useToast();
  const [cambios, setCambios] = useState<Record<string, Cambio>>({});
  const [nuevo, setNuevo] = useState<{ nombre: string; linea: LineaGrupo }>({ nombre: "", linea: "administrativos" });
  const [guardando, setGuardando] = useState<string | null>(null);
  const sinTabla = !grupos.some((g) => g.id);
  const valor = (g: GrupoGasto): Cambio => cambios[g.clave] || { nombre: g.nombre, linea: g.linea || "", oculto: g.oculto };
  const cambiado = (g: GrupoGasto) => { const v = valor(g); return v.nombre.trim() !== g.nombre || v.linea !== (g.linea || "") || v.oculto !== g.oculto; };
  const set = (g: GrupoGasto, c: Partial<Cambio>) => setCambios((x) => ({ ...x, [g.clave]: { ...valor(g), ...c } }));

  async function guardar(g: GrupoGasto) {
    const v = valor(g);
    const err = errorNombre(v.nombre, grupos, g.clave);
    if (err) { toast.error(err); return; }
    if (v.linea !== (g.linea || "")) {
      // Aviso, nunca bloqueo: la línea nueva vale para todos los gastos de la pestaña, también los de meses pasados.
      const { count } = await db.from("gastos_manuales").select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadId).eq("grupo", g.clave);
      if ((count || 0) > 0 && !confirm(`"${g.nombre}" tiene ${count} gasto${count === 1 ? "" : "s"} cargado${count === 1 ? "" : "s"}.\n\nAl pasarla a "${nombreLinea((v.linea || null) as LineaGrupo | null)}", esos importes se mueven en la Contabilidad de todos los meses, también los pasados (el resultado de esos meses cambia).\n\n¿Cambiar igual?`)) return;
    }
    setGuardando(g.clave);
    const { error } = await db.from("gastos_grupos").update({ nombre: v.nombre.trim(), linea: v.linea || null, oculto: v.oculto, updated_at: new Date().toISOString() }).eq("id", g.id).eq("sociedad_id", sociedadId);
    setGuardando(null);
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setCambios((x) => { const y = { ...x }; delete y[g.clave]; return y; });
    toast.success("Pestaña guardada");
    onCambio();
  }

  async function mover(g: GrupoGasto, dir: -1 | 1) {
    const nuevos = moverGrupo(grupos, g.clave, dir);
    if (!nuevos.length) return;
    setGuardando(g.clave);
    for (const n of nuevos) {
      const id = grupos.find((x) => x.clave === n.clave)?.id;
      const { error } = await db.from("gastos_grupos").update({ orden: n.orden, updated_at: new Date().toISOString() }).eq("id", id).eq("sociedad_id", sociedadId);
      if (error) { toast.error(`No se pudo mover: ${error.message}`); break; }
    }
    setGuardando(null);
    onCambio();
  }

  async function crear() {
    const err = errorNombre(nuevo.nombre, grupos);
    if (err) { toast.error(err); return; }
    setGuardando("__nuevo");
    const { error } = await db.from("gastos_grupos").insert({
      sociedad_id: sociedadId, clave: claveNueva(nuevo.nombre, grupos), nombre: nuevo.nombre.trim(), linea: nuevo.linea,
      orden: Math.max(0, ...grupos.map((g) => g.orden)) + 1,
    });
    setGuardando(null);
    if (error) { toast.error(`No se pudo crear: ${error.message}`); return; }
    setNuevo({ nombre: "", linea: "administrativos" });
    toast.success("Pestaña creada");
    onCambio();
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-zinc-200 bg-white p-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start gap-2 px-1">
        <p className="flex-1 text-xs text-zinc-600 dark:text-zinc-300"><b>Pestañas de Gastos.</b> El nombre y el orden son los de Gastos; la línea dice dónde suma en Contabilidad (Estado de resultados y Cashflow). Ocultar no borra: sus gastos siguen sumando.</p>
        <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
      </div>
      {sinTabla && <p className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Falta correr la migración 20261103210000 (pestañas de Gastos): por ahora se ven las de siempre y no se pueden editar.</p>}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {grupos.map((g, i) => {
          const v = valor(g);
          const fija = g.clave === GRUPO_TRANSPORTES;
          return (
            <div key={g.clave} className={`flex flex-wrap items-center gap-1.5 px-1 py-1 ${v.oculto ? "opacity-60" : ""}`}>
              <div className="flex">
                <button type="button" title="Subir" disabled={sinTabla || i === 0 || guardando !== null} onClick={() => void mover(g, -1)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-orange-600 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" title="Bajar" disabled={sinTabla || i === grupos.length - 1 || guardando !== null} onClick={() => void mover(g, 1)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-orange-600 disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowDown className="h-3.5 w-3.5" /></button>
              </div>
              {fija ? (
                <>
                  <span className="w-44 px-2 text-sm">{g.nombre}</span>
                  <span className="text-xs text-zinc-500">Fija: sale de las facturas de transporte (Transportes en Contabilidad).</span>
                </>
              ) : (
                <>
                  <input value={v.nombre} disabled={sinTabla} onChange={(e) => set(g, { nombre: e.target.value })} className={`${control} w-44`} aria-label="Nombre de la pestaña" />
                  <div className="w-72"><Select value={v.linea} disabled={sinTabla} onChange={(e) => set(g, { linea: e.target.value })} options={g.base ? opcionesLineaBase : opcionesLinea} className={sel} /></div>
                  <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" disabled={sinTabla} checked={v.oculto} onChange={(e) => set(g, { oculto: e.target.checked })} className="h-4 w-4 accent-orange-500" /> Oculta</label>
                  {cambiado(g) && (
                    <>
                      <button type="button" disabled={guardando !== null} onClick={() => void guardar(g)} className="inline-flex h-7 items-center gap-1 rounded-lg bg-orange-500 px-2 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                        {guardando === g.clave && <Loader2 className="h-3 w-3 animate-spin" />}Guardar</button>
                      <button type="button" onClick={() => setCambios((x) => { const y = { ...x }; delete y[g.clave]; return y; })} className="text-xs text-zinc-500 hover:underline">Deshacer</button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-200 px-1 pt-1.5 dark:border-zinc-700">
        <span className="w-[52px]" />
        <input value={nuevo.nombre} disabled={sinTabla} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void crear(); }} placeholder="Nombre de la pestaña nueva" className={`${control} w-44`} />
        <div className="w-72"><Select value={nuevo.linea} disabled={sinTabla} onChange={(e) => setNuevo({ ...nuevo, linea: e.target.value as LineaGrupo })} options={opcionesLinea} className={sel} /></div>
        <button type="button" disabled={sinTabla || !nuevo.nombre.trim() || guardando !== null} onClick={() => void crear()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-orange-300 px-2 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-800 dark:text-orange-300">
          {guardando === "__nuevo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Crear pestaña</button>
      </div>
    </div>
  );
}
