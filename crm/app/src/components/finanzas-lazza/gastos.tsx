"use client";

// Finanzas Lazza → Gastos (Tanda 4, Augusto 20/10/2026: "Debito automatico pasa a ser forma de pago. Hace los grupos que vos decis.
// Que todo se pueda editar y cambiar de grupo si yo quiero."). Una sola lista del mes (fijos y eventuales), 7 grupos, todo editable.
// Mismas reglas que Finanzas vieja: cada gasto tiene su pago en Movimientos (tipo "pago", gasto_manual_id); al editar, el pago
// acompaña (gestionar_cobro "editar"); al borrar, el pago se anula. Si el gasto ya está cruzado con el banco: aviso, nunca frena.
// Débitos automáticos: al abrir el mes en curso se cargan solos los del día ya pasado (cargar_debitos_automaticos, migración
// 20261020150000), con aviso y Deshacer. Lógica pura en lib/gastos-lazza.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/input";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import {
  GRUPOS, MEDIOS, armarFilasGastos, etiquetaMedio, filtrarGastos, fijosSinCargar, grupoDe, totalesPorGrupo,
  type FijoRow, type FilaGasto, type GastoRow, type Grupo,
} from "@/lib/gastos-lazza";
import { rangoMes } from "./datos";

const db = supabase as any;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const sel = "!h-8 !py-0 !px-2 text-sm";
const opcionesGrupo = GRUPOS.map((g) => ({ value: g, label: g }));
const opcionesMedio = Object.entries(MEDIOS).map(([value, label]) => ({ value, label }));
const faltaFuncion = (e: any) => e && (e.code === "PGRST202" || e.code === "42883" || /Could not find the function|does not exist/i.test(String(e.message || "")));
const plata = (m: { ARS: number; USD: number }) => [m.ARS > 0.005 || !m.USD ? formatCurrency(m.ARS) : "", m.USD > 0.005 ? formatCurrency(m.USD, "USD") : ""].filter(Boolean).join(" + ");

interface Borrador { id: string | null; fecha: string; grupo: Grupo; detalle: string; fijo: boolean; medio: string; monto: string; moneda: "ARS" | "USD"; fijoId: string | null }
interface PagoGasto { id: string; gasto_manual_id: string; monto: number; conciliado: boolean; cruzado: boolean }

export function FinanzasLazzaGastos({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const { profile } = useUser();
  const { toast } = useToast();
  const [gastos, setGastos] = useState<GastoRow[] | null>(null);
  const [fijos, setFijos] = useState<FijoRow[]>([]);
  const [pagos, setPagos] = useState<PagoGasto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sinMigracion, setSinMigracion] = useState(false);
  const [cargadosSolos, setCargadosSolos] = useState<{ gasto_id: string; descripcion: string; monto: number }[]>([]);
  const [recarga, setRecarga] = useState(0);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verFijos, setVerFijos] = useState(false);
  const [grupo, setGrupo] = useState<"" | Grupo>("");
  const [tipo, setTipo] = useState<"" | "fijo" | "eventual">("");
  const [soloDebito, setSoloDebito] = useState(false);
  const [texto, setTexto] = useState("");
  const hoy = todayAR();
  const esMesActual = periodo === hoy.slice(0, 7);
  const nombreMes = `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;

  useEffect(() => {
    let vivo = true;
    setGastos(null); setError(null);
    (async () => {
      // Débitos automáticos del mes en curso (una vez por fijo y por mes; la base no duplica).
      if (esMesActual && recarga === 0) {
        const { data, error: e } = await db.rpc("cargar_debitos_automaticos", { p_sociedad_id: sociedadId });
        if (e && faltaFuncion(e)) { if (vivo) setSinMigracion(true); }
        else if (e) console.error("Débitos automáticos:", e);
        else if (vivo && Array.isArray(data) && data.length) setCargadosSolos(data);
      }
      const { desde, hasta } = rangoMes(periodo);
      const [gs, fs] = await Promise.all([
        traerTodo<GastoRow>(() => db.from("gastos_manuales").select("*").eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
        traerTodo<FijoRow>(() => db.from("gastos_fijos").select("*").eq("sociedad_id", sociedadId).order("id")),
      ]);
      const ids = gs.map((g) => g.id);
      const ps: PagoGasto[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("movimientos").select("id, gasto_manual_id, monto, conciliado").eq("sociedad_id", sociedadId).eq("anulado", false).in("gasto_manual_id", ids.slice(i, i + 200));
        ps.push(...(data || []).map((m: any) => ({ ...m, monto: Number(m.monto || 0), cruzado: false })));
      }
      const movIds = ps.map((p) => p.id);
      for (let i = 0; i < movIds.length; i += 200) {
        const { data } = await db.from("extracto_movimientos").select("match_movimiento_id").in("match_movimiento_id", movIds.slice(i, i + 200));
        const cruz = new Set((data || []).map((x: any) => x.match_movimiento_id));
        for (const p of ps) if (cruz.has(p.id)) p.cruzado = true;
      }
      if (!vivo) return;
      setGastos(gs); setFijos(fs); setPagos(ps);
    })().catch((e) => { console.error("Finanzas Lazza · Gastos:", e); if (vivo) setError("No se pudieron cargar los gastos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodo, esMesActual, recarga]);

  const recargar = () => setRecarga((n) => n + 1);
  const filas = useMemo(() => armarFilasGastos(gastos || [], fijos), [gastos, fijos]);
  const visibles = useMemo(() => filtrarGastos(filas, { grupo, tipo, soloDebito, texto }), [filas, grupo, tipo, soloDebito, texto]);
  const totales = useMemo(() => totalesPorGrupo(filas), [filas]);
  const totalVisible = useMemo(() => ({ ARS: visibles.filter((x) => x.moneda === "ARS").reduce((s, x) => s + x.monto, 0), USD: visibles.filter((x) => x.moneda === "USD").reduce((s, x) => s + x.monto, 0) }), [visibles]);
  const pendientes = useMemo(() => fijosSinCargar(fijos, gastos || [], periodo), [fijos, gastos, periodo]);
  const pagosDe = useCallback((gastoId: string) => pagos.filter((p) => p.gasto_manual_id === gastoId), [pagos]);

  // ── Guardar / borrar (mismas reglas que Finanzas vieja) ──
  async function guardar(b: Borrador) {
    const monto = Math.round(Number(String(b.monto).replace(",", ".")) * 100) / 100;
    if (!b.detalle.trim()) { toast.error("Poné el detalle del gasto"); return; }
    if (!(monto > 0)) { toast.error("El monto tiene que ser mayor a 0"); return; }
    const descMov = `Gasto — ${b.grupo} — ${b.detalle.trim()}`;
    if (b.id) {
      const atados = pagosDe(b.id);
      const cruzado = atados.find((p) => p.cruzado || p.conciliado);
      const anterior = (gastos || []).find((g) => g.id === b.id);
      if (cruzado && anterior && Math.abs(Number(anterior.monto) - monto) > 0.005
        && !confirm(`Este gasto ya está cruzado con el banco por ${formatCurrency(Number(anterior.monto), b.moneda)}. Si cambiás el monto a ${formatCurrency(monto, b.moneda)}, la línea del banco no va a coincidir.\n\n¿Guardar igual?`)) return;
    }
    setGuardando(true);
    try {
      const datos: Record<string, unknown> = {
        fecha: b.fecha, descripcion: b.detalle.trim(), grupo: b.grupo, monto, moneda: b.moneda, medio_pago: b.medio || "transferencia",
        tipo_recurrencia: b.fijo ? "mensual" : "eventual",
      };
      if (b.id) {
        const { error: e } = await db.from("gastos_manuales").update(datos).eq("id", b.id).eq("sociedad_id", sociedadId);
        if (e) throw e;
        for (const p of pagosDe(b.id)) {
          const { error: e2 } = await db.rpc("gestionar_cobro", { p_movimiento_id: p.id, p_accion: "editar", p_descripcion: descMov, p_monto: monto, p_moneda: b.moneda, p_fecha: b.fecha });
          if (e2) toast.warning(`Gasto guardado, pero su pago en Movimientos no se pudo actualizar: ${e2.message}`);
        }
      } else {
        const { data: nuevo, error: e } = await db.from("gastos_manuales").insert({
          ...datos, sociedad_id: sociedadId, categoria: b.grupo, tipo_gasto: "general", notas: "", gasto_fijo_id: b.fijoId, created_by: profile?.id || null,
        }).select("id").single();
        if (e) throw e;
        const { error: e2 } = await db.from("movimientos").insert({
          tipo: "pago", descripcion: descMov, monto, moneda: b.moneda, fecha: b.fecha, conciliado: false, gasto_manual_id: nuevo.id,
          sociedad_id: sociedadId, created_by: profile?.id || null,
        });
        if (e2) toast.warning(`Gasto guardado, pero no se pudo registrar su pago en Movimientos: ${e2.message}`);
      }
      setBorrador(null);
      toast.success("Gasto guardado");
      recargar();
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e?.message || String(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  /** Borra el gasto y anula su pago (queda el registro del pago anulado). */
  async function borrar(ids: string[], preguntar = true) {
    if (!ids.length) return;
    if (preguntar && !confirm(ids.length === 1 ? "¿Borrar este gasto? Su pago en Movimientos se anula (queda el registro)." : `¿Borrar estos ${ids.length} gastos? Sus pagos se anulan (queda el registro).`)) return;
    let fallas = 0;
    for (const id of ids) {
      for (const p of pagosDe(id).length ? pagosDe(id) : await traerPagos(id)) {
        const { error: e } = await db.rpc("gestionar_cobro", { p_movimiento_id: p.id, p_accion: "anular" });
        if (e) { fallas++; toast.error(`No se pudo anular el pago: ${e.message}`); }
      }
      const { error: e } = await db.from("gastos_manuales").delete().eq("id", id).eq("sociedad_id", sociedadId);
      if (e) { fallas++; toast.error(`No se pudo borrar el gasto: ${e.message}`); }
    }
    if (!fallas) toast.success(ids.length === 1 ? "Gasto borrado" : `${ids.length} gastos borrados`);
    recargar();
  }
  const traerPagos = async (gastoId: string): Promise<{ id: string }[]> => {
    const { data } = await db.from("movimientos").select("id").eq("sociedad_id", sociedadId).eq("anulado", false).eq("gasto_manual_id", gastoId);
    return data || [];
  };

  const nuevo = (): Borrador => ({ id: null, fecha: esMesActual ? hoy : `${periodo}-01`, grupo: "Operativos", detalle: "", fijo: false, medio: "transferencia", monto: "", moneda: "ARS", fijoId: null });
  const desdeFila = (f: FilaGasto): Borrador => {
    const g = (gastos || []).find((x) => x.id === f.id);
    return { id: f.id, fecha: f.fecha, grupo: f.grupo, detalle: f.detalle, fijo: f.fijo, medio: g?.medio_pago || f.medio, monto: String(f.monto), moneda: f.moneda, fijoId: f.fijoId };
  };
  const desdeFijo = (f: (typeof pendientes)[number]): Borrador => ({
    id: null, fecha: f.vence && f.vence <= hoy ? f.vence : esMesActual ? hoy : f.vence || `${periodo}-01`, grupo: f.grupoFinal,
    detalle: `${f.descripcion || ""} — ${nombreMes}`, fijo: true, medio: f.medio_pago || "transferencia", monto: String(Number(f.monto || 0)),
    moneda: String(f.moneda).toUpperCase() === "USD" ? "USD" : "ARS", fijoId: f.id,
  });

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  return (
    <div className="space-y-2">
      {sinMigracion && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Falta correr la migración 20261020150000 (grupos y débitos automáticos): por ahora el grupo sale de la categoría y los débitos no se cargan solos.
        </p>
      )}
      {cargadosSolos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
          <span>🔁 Se cargaron solos {cargadosSolos.length} débito{cargadosSolos.length === 1 ? "" : "s"} automático{cargadosSolos.length === 1 ? "" : "s"}: {cargadosSolos.map((x) => `${x.descripcion} ${formatCurrency(Number(x.monto))}`).join(" · ")}. Revisá el monto si la factura vino distinta.</span>
          <button type="button" onClick={async () => {
            if (!confirm("¿Deshacer? Se borran esos gastos y se anulan sus pagos.")) return;
            const fijosIds = [...new Set((gastos || []).filter((g) => cargadosSolos.some((x) => x.gasto_id === g.id)).map((g) => g.gasto_fijo_id).filter(Boolean))];
            await borrar(cargadosSolos.map((x) => x.gasto_id), false);
            setCargadosSolos([]);
            // Si no se saca el 🔁, la próxima vez que se abra el mes se vuelven a cargar solos.
            if (fijosIds.length && confirm("¿Les saco también el 🔁 débito automático a esos gastos fijos? Si no, se vuelven a cargar solos la próxima vez que abras Gastos.")) {
              const { error: e } = await db.from("gastos_fijos").update({ medio_pago: null }).in("id", fijosIds).eq("sociedad_id", sociedadId);
              if (e) toast.error(`No se pudo sacar el 🔁: ${e.message}`); else recargar();
            }
          }}
            className="inline-flex items-center gap-1 rounded border border-blue-300 px-2 py-0.5 font-medium hover:bg-blue-100 dark:border-blue-800"><Undo2 className="h-3 w-3" /> Deshacer</button>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setCargadosSolos([])} className="ml-auto rounded p-0.5 hover:bg-blue-100"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* Totales por grupo: tocar uno filtra la lista. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
        {totales.map((t) => (
          <button key={t.grupo} type="button" onClick={() => setGrupo((g) => (g === t.grupo ? "" : t.grupo))}
            className={`rounded-lg border px-2 py-1.5 text-left ${grupo === t.grupo ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 bg-white hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900"}`}>
            <span className="block truncate text-[11px] text-zinc-500">{t.grupo} · {t.n}</span>
            <span className="block truncate font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-100">{plata(t)}</span>
          </button>
        ))}
        <div className="rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-1.5 dark:border-zinc-600 dark:bg-zinc-800">
          <span className="block text-[11px] text-zinc-500">Total {nombreMes}</span>
          <span className="block truncate font-mono text-xs font-bold text-zinc-900 dark:text-white">{plata({ ARS: totales.reduce((s, t) => s + t.ARS, 0), USD: totales.reduce((s, t) => s + t.USD, 0) })}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setBorrador(nuevo())}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600"><Plus className="h-4 w-4" /> Nuevo gasto</button>
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar detalle" className={`${control} w-full pl-8`} />
        </div>
        <div className="w-44"><Select value={grupo} onChange={(e) => setGrupo(e.target.value as "" | Grupo)} options={opcionesGrupo} placeholder="Todos los grupos" className={sel} /></div>
        <div className="w-36"><Select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} options={[{ value: "fijo", label: "Fijos" }, { value: "eventual", label: "Eventuales" }]} placeholder="Fijos y eventuales" className={sel} /></div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={soloDebito} onChange={(e) => setSoloDebito(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Solo 🔁</label>
        <button type="button" onClick={() => setVerFijos((v) => !v)} className="text-xs text-orange-600 hover:underline">{verFijos ? "Ocultar gastos fijos" : "Editar gastos fijos"}</button>
      </div>

      {borrador && !borrador.id && <Editor b={borrador} cambiar={setBorrador} guardar={guardar} cancelar={() => setBorrador(null)} guardando={guardando} titulo={borrador.fijoId ? "Cargar gasto fijo" : "Nuevo gasto"} />}

      {!gastos ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-[11px] uppercase text-zinc-500 dark:bg-zinc-800">
              <tr><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Grupo</th><th className="px-2 py-1.5">Detalle</th><th className="px-2 py-1.5">Tipo</th><th className="px-2 py-1.5">Pago</th><th className="px-2 py-1.5 text-right">Monto</th><th className="w-16" /></tr>
            </thead>
            <tbody>
              {visibles.map((f) => borrador?.id === f.id ? (
                <tr key={f.id}><td colSpan={7} className="p-1"><Editor b={borrador} cambiar={setBorrador} guardar={guardar} cancelar={() => setBorrador(null)} guardando={guardando} titulo="Editar gasto"
                  aviso={pagosDe(f.id).some((p) => p.cruzado || p.conciliado) ? "Ya está cruzado con el banco: si cambiás el monto, la línea del banco no va a coincidir (se puede guardar igual)." : undefined} /></td></tr>
              ) : (
                <tr key={f.id} onClick={() => setBorrador(desdeFila(f))} className="cursor-pointer border-t border-zinc-100 hover:bg-orange-50/40 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <td className="whitespace-nowrap px-2 py-1.5">{formatDate(f.fecha)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.grupo}</td>
                  <td className="px-2 py-1.5">{f.detalle}{f.cargadoSolo && <span className="ml-1 text-[10px] text-blue-600">(cargado solo)</span>}</td>
                  <td className="px-2 py-1.5 text-xs">{f.fijo ? "Fijo" : "Eventual"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{etiquetaMedio(f.medio)}{pagosDe(f.id).some((p) => p.cruzado || p.conciliado) && <span className="ml-1 text-emerald-600" title="Cruzado con el banco">✓ banco</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-semibold">{formatCurrency(f.monto, f.moneda)}</td>
                  <td className="px-1 py-1 text-right">
                    <button type="button" title="Editar" onClick={(e) => { e.stopPropagation(); setBorrador(desdeFila(f)); }} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Borrar (el pago se anula)" onClick={(e) => { e.stopPropagation(); void borrar([f.id]); }} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-400">No hay gastos con ese filtro en {nombreMes}.</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-end gap-6 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span>{visibles.length} gastos</span><span>Total <b className="font-mono text-zinc-800 dark:text-zinc-100">{plata(totalVisible)}</b></span>
          </div>
        </div>
      )}

      {gastos && pendientes.length > 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-1 px-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Fijos sin cargar en {nombreMes} ({pendientes.length})</p>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pendientes.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2 px-1 py-1 text-sm">
                <span className="w-24 text-xs text-zinc-500">{f.vence ? `vence ${formatDate(f.vence)}` : "sin día"}</span>
                <span className="w-36 truncate text-xs">{f.grupoFinal}</span>
                <span className="min-w-[160px] flex-1">{f.descripcion}{f.medio_pago === "debito_automatico" && <span className="ml-1 text-xs">🔁</span>}</span>
                <span className="font-mono text-xs">{formatCurrency(Number(f.monto || 0), String(f.moneda).toUpperCase() === "USD" ? "USD" : "ARS")}</span>
                <button type="button" onClick={() => setBorrador(desdeFijo(f))} className="rounded-lg border border-orange-300 px-2 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300">Cargar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {verFijos && <FijosEditables fijos={fijos} sociedadId={sociedadId} onCambio={recargar} />}
    </div>
  );
}

/** Formulario de un gasto (nuevo o editar), en una línea. */
function Editor({ b, cambiar, guardar, cancelar, guardando, titulo, aviso }: {
  b: Borrador; cambiar: (b: Borrador) => void; guardar: (b: Borrador) => void; cancelar: () => void; guardando: boolean; titulo: string; aviso?: string;
}) {
  const set = (k: Partial<Borrador>) => cambiar({ ...b, ...k });
  return (
    <div className="space-y-1.5 rounded-lg border border-orange-300 bg-orange-50/60 p-2 dark:border-orange-800 dark:bg-orange-950/20" onClick={(e) => e.stopPropagation()}>
      <p className="text-xs font-semibold text-orange-800 dark:text-orange-300">{titulo}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="date" value={b.fecha} onChange={(e) => set({ fecha: e.target.value })} className={control} />
        <div className="w-44"><Select value={b.grupo} onChange={(e) => set({ grupo: e.target.value as Grupo })} options={opcionesGrupo} className={sel} /></div>
        <input value={b.detalle} onChange={(e) => set({ detalle: e.target.value })} placeholder="Detalle" className={`${control} min-w-[220px] flex-1`} autoFocus />
        <div className="w-28"><Select value={b.fijo ? "fijo" : "eventual"} onChange={(e) => set({ fijo: e.target.value === "fijo" })} options={[{ value: "fijo", label: "Fijo" }, { value: "eventual", label: "Eventual" }]} className={sel} /></div>
        <div className="w-48"><Select value={b.medio} onChange={(e) => set({ medio: e.target.value })} options={opcionesMedio} className={sel} /></div>
        <div className="w-20"><Select value={b.moneda} onChange={(e) => set({ moneda: e.target.value as "ARS" | "USD" })} options={[{ value: "ARS", label: "$" }, { value: "USD", label: "US$" }]} className={sel} /></div>
        <input type="number" step="0.01" min="0" value={b.monto} onChange={(e) => set({ monto: e.target.value })} placeholder="Monto" className={`${control} w-32 text-right`} />
        <button type="button" disabled={guardando} onClick={() => guardar(b)} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
        <button type="button" onClick={cancelar} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Cancelar</button>
      </div>
      {aviso && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> {aviso}</p>}
    </div>
  );
}

/** Los gastos fijos (lo que se repite todos los meses): grupo, detalle, monto, día, pago (🔁) y activo, todo editable. */
function FijosEditables({ fijos, sociedadId, onCambio }: { fijos: FijoRow[]; sociedadId: string; onCambio: () => void }) {
  const { toast } = useToast();
  const [edit, setEdit] = useState<Record<string, Partial<FijoRow>>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const lista = [...fijos].sort((a, b) => Number(b.activo !== false) - Number(a.activo !== false) || grupoDe(a).localeCompare(grupoDe(b)) || String(a.descripcion).localeCompare(String(b.descripcion)));
  const val = <K extends keyof FijoRow>(f: FijoRow, k: K): FijoRow[K] => (edit[f.id] && k in edit[f.id] ? edit[f.id][k] : f[k]) as FijoRow[K];
  const set = (id: string, k: Partial<FijoRow>) => setEdit((e) => ({ ...e, [id]: { ...e[id], ...k } }));
  async function guardar(f: FijoRow) {
    const c = edit[f.id];
    if (!c) return;
    setGuardando(f.id);
    const { error } = await db.from("gastos_fijos").update({ ...c, monto: c.monto !== undefined ? Number(c.monto) : undefined, dia_vencimiento: c.dia_vencimiento !== undefined ? (c.dia_vencimiento ? Number(c.dia_vencimiento) : null) : undefined })
      .eq("id", f.id).eq("sociedad_id", sociedadId);
    setGuardando(null);
    if (error) { toast.error(`No se pudo guardar el fijo: ${error.message}`); return; }
    toast.success("Gasto fijo guardado (vale para los próximos meses)");
    setEdit((e) => { const n = { ...e }; delete n[f.id]; return n; });
    onCambio();
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-1 px-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Gastos fijos (lo que se repite todos los meses; los cambios valen para los próximos)</p>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-zinc-500"><tr><th className="px-1">Activo</th><th className="px-1">Grupo</th><th className="px-1">Detalle</th><th className="px-1">Pago</th><th className="px-1">Día</th><th className="px-1 text-right">Monto</th><th /></tr></thead>
        <tbody>
          {lista.map((f) => (
            <tr key={f.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${val(f, "activo") === false ? "opacity-50" : ""}`}>
              <td className="px-1 py-1"><input type="checkbox" checked={val(f, "activo") !== false} onChange={(e) => set(f.id, { activo: e.target.checked })} className="h-4 w-4 accent-orange-500" /></td>
              <td className="px-1 py-1"><div className="w-44"><Select value={grupoDe({ grupo: val(f, "grupo"), categoria: f.categoria })} onChange={(e) => set(f.id, { grupo: e.target.value })} options={opcionesGrupo} className={sel} /></div></td>
              <td className="px-1 py-1"><input value={String(val(f, "descripcion") || "")} onChange={(e) => set(f.id, { descripcion: e.target.value })} className={`${control} w-full min-w-[220px]`} /></td>
              <td className="px-1 py-1"><div className="w-48"><Select value={String(val(f, "medio_pago") || "")} onChange={(e) => set(f.id, { medio_pago: e.target.value || null })} options={opcionesMedio} placeholder="Sin definir" className={sel} /></div></td>
              <td className="px-1 py-1"><input type="number" min={1} max={31} value={val(f, "dia_vencimiento") ?? ""} onChange={(e) => set(f.id, { dia_vencimiento: e.target.value ? Number(e.target.value) : null })} className={`${control} w-16`} /></td>
              <td className="px-1 py-1 text-right"><span className="mr-1 text-xs text-zinc-400">{String(f.moneda).toUpperCase() === "USD" ? "US$" : "$"}</span><input type="number" step="0.01" value={String(val(f, "monto") ?? "")} onChange={(e) => set(f.id, { monto: e.target.value })} className={`${control} w-28 text-right`} /></td>
              <td className="px-1 py-1">{edit[f.id] && <button type="button" disabled={guardando === f.id} onClick={() => guardar(f)} className="rounded-lg bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">{guardando === f.id ? "…" : "Guardar"}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
