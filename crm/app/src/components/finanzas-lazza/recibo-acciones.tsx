"use client";

// Finanzas › Recibos: Anular y Editar un cobro (auditoría integral Tanda 6, 02/11/2026; Augusto: "1 lo confirmo").
// Lo hacía la Finanzas vieja de a un movimiento; acá va el recibo entero (medios + retenciones) en una sola operación
// de la base (anular_recibo / editar_recibo, migración 20261102160000): si algo falla, no cambia nada.
// Nada se borra. Los cheques no cambian (los mueve solo el banco). La línea del banco cruzada vuelve a quedar sin cruzar.
// Todo avisa, nada frena; lo único que no se edita es un cobro en US$ con liquidación de cambio (se anula y se carga de nuevo).
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cambiosDeRecibo, MEDIO_RECIBO, textoTotalRecibo, type Recibo } from "@/lib/recibos";

const db = supabase as any;
const SIN_MIGRACION = "Falta correr la migración 20261102160000 (anular y editar cobros) en la base.";
const faltaFuncion = (e: any) => e && (e.code === "PGRST202" || e.code === "42883" || /function .* does not exist|Could not find the function/i.test(String(e.message || "")));
const mensaje = (e: any) => (faltaFuncion(e) ? SIN_MIGRACION : String(e?.message || e));
/** Avisos de la base sin repetir, uno por cartel. */
const mostrarAvisos = (toast: ReturnType<typeof useToast>["toast"], avisos: unknown) => {
  for (const a of [...new Set(Array.isArray(avisos) ? avisos.map(String) : [])]) toast.warning(a);
};

function Ventana({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

export function AnularRecibo({ recibo: r, onClose, onHecho }: { recibo: Recibo; onClose: () => void; onHecho: () => void }) {
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("Cargado por error");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const anular = async () => {
    setTrabajando(true); setError("");
    const { data, error: e } = await db.rpc("anular_recibo", { p_recibo_id: r.id, p_motivo: motivo });
    setTrabajando(false);
    if (e) { setError(mensaje(e)); return; }
    toast.success(`Recibo ${r.numero} anulado`);
    mostrarAvisos(toast, data?.avisos);
    onHecho();
  };
  return (
    <Ventana titulo={`Anular el recibo ${r.numero}`} onClose={onClose}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{r.cliente} · {formatDate(r.fecha)} · <b className="font-mono">{textoTotalRecibo(r.total, (v, m) => formatCurrency(v, m))}</b></p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
        <li>No se borra: el recibo queda anulado (tachado) y se sigue viendo. Se anulan todos sus renglones (medios y retenciones).</li>
        <li>{r.facturas.length ? `Vuelve${r.facturas.length === 1 ? "" : "n"} a quedar a cobrar: ${r.facturas.join(", ")}.` : "No cobraba facturas (era un cobro a cuenta): el saldo a favor del cliente desaparece."}</li>
        {r.cheques.length > 0 && <li>Los cheques {r.cheques.join(", ")} no cambian: dónde está cada uno lo dice el banco.</li>}
        {r.banco !== "pendiente" && <li>Si estaba cruzado con el banco, esa línea vuelve a quedar sin cruzar.</li>}
        {r.enviado && <li className="text-amber-700 dark:text-amber-300">⚠️ Este recibo se mandó por mail el {formatDate(r.enviado)}: avisale al cliente.</li>}
      </ul>
      <label className="block text-xs text-zinc-500">Motivo
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-0.5 h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">No se pudo anular: {error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
        <button type="button" disabled={trabajando} onClick={() => void anular()} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
          {trabajando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Anular cobro
        </button>
      </div>
    </Ventana>
  );
}

type RenglonEdit = { id: string; medio: string; detalle: string; moneda: "ARS" | "USD"; monto: number; texto: string; repartido: boolean; cheque: boolean; fx: boolean };

export function EditarRecibo({ recibo: r, onClose, onHecho }: { recibo: Recibo; onClose: () => void; onHecho: () => void }) {
  const { toast } = useToast();
  const [fecha, setFecha] = useState(String(r.fecha).slice(0, 10));
  const [renglones, setRenglones] = useState<RenglonEdit[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: v } = await db.from("recibo_movimientos").select("movimiento_id").eq("recibo_id", r.id);
      const ids = (v || []).map((x: any) => x.movimiento_id);
      if (!ids.length) { if (vivo) setRenglones([]); return; }
      const [{ data: movs }, { data: apl }, { data: chq }] = await Promise.all([
        db.from("movimientos").select("id, tipo, monto, moneda, descripcion, anulado, liquidacion_fx_id").in("id", ids),
        db.from("cobro_aplicaciones").select("movimiento_id").in("movimiento_id", ids),
        db.from("echeqs").select("movimiento_id").in("movimiento_id", ids),
      ]);
      const aplicaciones = new Map<string, number>();
      for (const a of (apl || []) as any[]) aplicaciones.set(a.movimiento_id, (aplicaciones.get(a.movimiento_id) || 0) + 1);
      const conCheque = new Set(((chq || []) as any[]).map((c) => c.movimiento_id));
      if (!vivo) return;
      setRenglones(((movs || []) as any[]).filter((m) => !m.anulado).map((m) => ({
        id: m.id, medio: MEDIO_RECIBO[m.tipo] || m.tipo || "Renglón", detalle: m.descripcion || "",
        moneda: String(m.moneda).toUpperCase() === "USD" ? "USD" : "ARS", monto: Number(m.monto),
        texto: String(Number(m.monto)).replace(".", ","), repartido: (aplicaciones.get(m.id) || 0) > 1, cheque: conCheque.has(m.id), fx: !!m.liquidacion_fx_id,
      })));
    })().catch((e) => { if (vivo) setError(mensaje(e)); });
    return () => { vivo = false; };
  }, [r.id]);
  const fx = !!renglones?.some((x) => x.fx);
  const guardar = async () => {
    if (!renglones) return;
    const { cambios, errores } = cambiosDeRecibo(renglones.filter((x) => !x.repartido).map((x) => ({ id: x.id, monto: x.monto, texto: x.texto, medio: x.medio })));
    if (errores.length) { setError(errores.join(" · ")); return; }
    const cambiaFecha = fecha && fecha !== String(r.fecha).slice(0, 10);
    if (!cambios.length && !cambiaFecha) { setError("No cambiaste nada."); return; }
    setTrabajando(true); setError("");
    const { data, error: e } = await db.rpc("editar_recibo", { p_recibo_id: r.id, p_fecha: cambiaFecha ? fecha : null, p_renglones: cambios });
    setTrabajando(false);
    if (e) { setError(mensaje(e)); return; }
    toast.success(`Recibo ${r.numero} guardado`);
    mostrarAvisos(toast, data?.avisos);
    onHecho();
  };
  const input = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <Ventana titulo={`Editar el recibo ${r.numero}`} onClose={onClose}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{r.cliente}{r.facturas.length ? ` · ${r.facturas.join(", ")}` : ""}</p>
      {renglones === null ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo el cobro…</p>
        : fx ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Es un cobro en US$ con liquidación de cambio: no se edita. Anulalo y cargalo de nuevo con Nuevo cobro.</p>
        : (
          <>
            <label className="flex items-center justify-between gap-2 text-sm">Fecha del cobro
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={input} />
            </label>
            <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
              {renglones.map((x) => (
                <div key={x.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{x.medio}</span>
                    {x.detalle && <span className="block truncate text-[11px] text-zinc-500" title={x.detalle}>{x.detalle}</span>}
                    {x.cheque && <span className="block text-[11px] text-zinc-500">El cheque no cambia: su importe lo dice el banco.</span>}
                  </span>
                  <span className="text-xs text-zinc-500">{x.moneda === "USD" ? "US$" : "$"}</span>
                  <input value={x.texto} inputMode="decimal" disabled={x.repartido}
                    title={x.repartido ? "Este importe está repartido en varias facturas: para cambiarlo, anulá el cobro y cargalo de nuevo" : undefined}
                    onChange={(e) => setRenglones((p) => (p || []).map((y) => (y.id === x.id ? { ...y, texto: e.target.value } : y)))}
                    className={`${input} w-32 text-right disabled:opacity-50`} />
                </div>
              ))}
              {!renglones.length && <p className="px-2 py-1.5 text-xs text-zinc-500">No tiene renglones vigentes.</p>}
            </div>
            {renglones.some((x) => x.repartido) && <p className="text-[11px] text-zinc-500">Los importes en gris están repartidos en varias facturas: la fecha sí se cambia.</p>}
          </>
        )}
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">{fx ? "Cerrar" : "Cancelar"}</button>
        {!fx && renglones !== null && (
          <button type="button" disabled={trabajando} onClick={() => void guardar()} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {trabajando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
          </button>
        )}
      </div>
    </Ventana>
  );
}
