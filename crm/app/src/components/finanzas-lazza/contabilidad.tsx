"use client";

// Finanzas Lazza → Contabilidad (Nati y Augusto, 29/10/2026). Etapa 1: Estado de resultados mensual por lo devengado, del año
// hasta el mes elegido. Solo lectura, salvo el % de IIBB y tasas (fila "contabilidad" de `configuracion`, por sociedad;
// si no se guardó otro, 6% según Nati 29/10).
// Cuentas en lib/contabilidad (estadoDeResultados). Tanda 2: el Cashflow semanal (contabilidad-cashflow.tsx), en otra pestaña.
import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { LINEAS, estadoDeResultados, mesesDelAnio, pctSobreVentas, planillaER, type EstadoResultados, type FilaER, type LineaId } from "@/lib/contabilidad";
import { CLAVE_CONTABILIDAD, traerDatosContabilidad } from "./datos";
import { ContabilidadCashflow } from "./contabilidad-cashflow";

const db = supabase as any;
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesCorto = (p: string) => `${MESES_CORTOS[Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
const pesos = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
const pct = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);
const ORIGEN: Record<string, string> = { gasto: "Gastos", banco: "Banco", estimado: "Estimado", calculo: "Cálculo" };
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

const VISTAS = [{ id: "resultados", nombre: "Estado de resultados" }, { id: "cashflow", nombre: "Cashflow semanal" }] as const;

export function FinanzasLazzaContabilidad({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const [vista, setVista] = useState<(typeof VISTAS)[number]["id"]>("resultados");
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
        {VISTAS.map((v) => (
          <button key={v.id} type="button" onClick={() => setVista(v.id)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${vista === v.id ? "bg-orange-500 text-white" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
            {v.nombre}
          </button>
        ))}
      </div>
      {vista === "resultados" ? <EstadoResultadosVista sociedadId={sociedadId} periodo={periodo} /> : <ContabilidadCashflow sociedadId={sociedadId} />}
    </div>
  );
}

function EstadoResultadosVista({ sociedadId, periodo }: { sociedadId: string; periodo: string }) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const esLazzari = sociedadActiva?.nombre === "Lazzari";
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerDatosContabilidad>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iibbTexto, setIibbTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const periodos = useMemo(() => mesesDelAnio(periodo), [periodo]);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null); setAbierta(null);
    traerDatosContabilidad(sociedadId, periodos, esLazzari)
      .then((d) => { if (!vivo) return; setDatos(d); setIibbTexto(d.iibbPct === null ? "" : String(d.iibbPct).replace(".", ",")); })
      .catch((e) => { console.error("Finanzas Lazza · Contabilidad:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, periodos, esLazzari]);

  const pctIibb = iibbTexto.trim() === "" ? null : Number(iibbTexto.replace(",", "."));
  const er = useMemo(() => {
    if (!datos) return null;
    const iibbPct = pctIibb !== null && Number.isFinite(pctIibb) ? pctIibb : null;
    const completo = estadoDeResultados({ periodos, ...datos, iibbPct });
    // Se arranca en el primer mes con ventas: antes no se facturaba con el CRM y esos meses mostrarían solo gastos (pérdida que no es).
    const ventas = completo.lineas.find((l) => l.id === "ventas")!;
    const desde = periodos.findIndex((p) => ventas.valores[p] !== 0);
    if (desde <= 0) return completo;
    const er = estadoDeResultados({ periodos: periodos.slice(desde), ...datos, iibbPct });
    const antes = periodos.slice(0, desde);
    const afuera = completo.lineas.filter((l) => l.id !== "ganancias").reduce((s, l) => s + antes.reduce((t, p) => t + l.valores[p], 0), 0);
    if (afuera) er.avisos.unshift(`Antes de ${mesCorto(periodos[desde])} no hay ventas en el CRM: no se muestran ${formatCurrency(Math.abs(afuera))} de gastos de esos meses (${antes.filter((p) => completo.lineas.some((l) => l.valores[p] !== 0)).map(mesCorto).join(", ")}).`);
    return er;
  }, [datos, periodos, pctIibb]);

  const guardarPct = async () => {
    if (pctIibb === null || !Number.isFinite(pctIibb) || pctIibb < 0 || pctIibb > 20) { toast.error("Poné un % entre 0 y 20 (por ejemplo 3,5)."); return; }
    setGuardando(true);
    const { error: e } = await db.from("configuracion").upsert(
      { key: CLAVE_CONTABILIDAD, value: { iibbPct: pctIibb }, sociedad_id: sociedadId },
      { onConflict: "sociedad_id,key" },
    );
    setGuardando(false);
    if (e) { console.error("Contabilidad · % IIBB:", e); toast.error("No se pudo guardar el %. Probá de nuevo."); return; }
    setDatos((d) => (d ? { ...d, iibbPct: pctIibb } : d));
    toast.success(`% de IIBB y tasas guardado: ${iibbTexto} %`);
  };

  const bajarExcel = async () => {
    if (!er) return;
    const XLSX: any = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(planillaER(er, mesCorto));
    ws["!cols"] = [{ wch: 34 }, ...er.periodos.map(() => ({ wch: 14 })), { wch: 15 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estado de resultados");
    XLSX.writeFile(wb, `Estado de resultados ${sociedadActiva?.nombre || ""} ${periodo.slice(0, 4)}.xlsx`);
  };

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!er || !datos) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Calculando el año (un mes por vez)…</p>;

  const ventasTotal = er.lineas.find((l) => l.id === "ventas")!.total;
  const L = (id: LineaId) => er.lineas.find((l) => l.id === id)!;
  const bloque = (b: string) => LINEAS.filter((l) => l.bloque === b).map((l) => L(l.id));
  const filaAbierta = abierta ? [...er.lineas, ...er.fuera].find((f) => f.id === abierta) ?? null : null;

  const celda = (n: number, fuerte = false) => (
    <td className={`whitespace-nowrap py-1 pl-3 text-right font-mono ${fuerte ? "font-semibold" : ""} ${n < 0 ? "text-zinc-600 dark:text-zinc-300" : ""}`}>{n === 0 ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : pesos(n)}</td>
  );
  const fila = (f: FilaER, tipo: "linea" | "sub" | "fuera" = "linea") => {
    const sub = tipo === "sub";
    const color = sub ? (f.total >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600") : "";
    const tocable = !sub && f.id !== "ventas" && f.id !== "costo_mercaderia";
    return (
      <tr key={f.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${sub ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} ${tipo === "fuera" ? "text-zinc-500" : ""} ${abierta === f.id ? "bg-orange-50 dark:bg-orange-950/20" : ""}`}>
        <td className={`sticky left-0 z-10 bg-inherit py-1 pr-3 ${sub ? `font-semibold ${color}` : tipo === "linea" && f.id !== "ventas" ? "pl-3" : ""}`} title={f.que}>
          {tocable
            ? <button type="button" onClick={() => setAbierta(abierta === f.id ? null : f.id)} className="text-left hover:text-orange-600 hover:underline">{f.nombre}</button>
            : <span className={f.id === "ventas" ? "font-semibold" : ""}>{f.nombre}</span>}
          {f.id === "iibb" && er.faltaPctIibb && <span className="ml-1 text-[11px] text-amber-600">(falta el %)</span>}
        </td>
        {er.periodos.map((p) => <Fragment key={p}>{celda(f.valores[p], sub)}</Fragment>)}
        <td className={`whitespace-nowrap border-l border-zinc-200 py-1 pl-3 text-right font-mono font-semibold dark:border-zinc-700 ${color}`}>{pesos(f.total)}</td>
        <td className="whitespace-nowrap py-1 pl-3 text-right font-mono text-[11px] text-zinc-500">{tipo === "fuera" ? "" : pct(pctSobreVentas(f.total, ventasTotal))}</td>
      </tr>
    );
  };
  const titulo = (t: string) => (
    <tr key={t} className="border-t border-zinc-200 dark:border-zinc-700"><td colSpan={er.periodos.length + 3} className="sticky left-0 bg-white pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-900">{t}</td></tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Estado de resultados {periodo.slice(0, 4)} · {sociedadActiva?.nombre}</p>
          <p className="text-[11px] text-zinc-500">Por lo devengado: cada venta y cada gasto en el mes en que se generan (el premio de octubre cuenta en octubre aunque se pague en noviembre). En $, de enero a {mesCorto(periodo)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            IIBB y tasas
            <input value={iibbTexto} onChange={(e) => setIibbTexto(e.target.value)} inputMode="decimal" placeholder="falta" className={`${control} w-16 text-right`} />
            % de las ventas
          </label>
          <button type="button" onClick={guardarPct} disabled={guardando || pctIibb === datos.iibbPct}
            className="h-8 rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            {guardando ? "Guardando…" : "Guardar %"}
          </button>
          <button type="button" onClick={bajarExcel} className="flex h-8 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-xs font-medium text-white hover:bg-orange-600">
            <Download className="h-3.5 w-3.5" /> Bajar Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="sticky left-0 z-10 bg-white pb-1 text-left font-semibold dark:bg-zinc-900">En $</th>
              {er.periodos.map((p) => <th key={p} className="pb-1 pl-3 text-right font-semibold">{mesCorto(p)}</th>)}
              <th className="border-l border-zinc-200 pb-1 pl-3 text-right font-semibold dark:border-zinc-700">Acumulado</th>
              <th className="pb-1 pl-3 text-right font-semibold">% vtas</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-900">
            {fila(L("ventas"))}
            {titulo("Costos directos")}
            {bloque("directos").map((f) => fila(f))}
            {fila(er.subtotales.bruto, "sub")}
            <tr className="text-[11px] text-zinc-500">
              <td className="sticky left-0 z-10 bg-white py-0.5 pl-3 dark:bg-zinc-900">Margen bruto</td>
              {er.periodos.map((p) => <td key={p} className="py-0.5 pl-3 text-right font-mono">{pct(er.margenBruto[p])}</td>)}
              <td className="border-l border-zinc-200 py-0.5 pl-3 text-right font-mono dark:border-zinc-700">{pct(er.margenBruto.total)}</td><td />
            </tr>
            {titulo("Estructura")}
            {bloque("estructura").map((f) => fila(f))}
            {fila(er.subtotales.operativo, "sub")}
            {bloque("financiero").map((f) => fila(f))}
            {fila(er.subtotales.antes_ganancias, "sub")}
            {fila(L("ganancias"))}
            {fila(er.subtotales.neto, "sub")}
            {titulo("Fuera del resultado (informativo)")}
            {er.fuera.map((f) => fila(f, "fuera"))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-400">Tocá una línea para ver de dónde sale. Ventas y costo de mercadería, factura por factura, están en Reportes (mismo cálculo). Ganancias: 25 % del resultado de cada mes (si el mes da pérdida, descuenta). Ley 25.413: 100 % a cuenta de Ganancias, no es gasto.</p>
      </div>

      {filaAbierta && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{filaAbierta.nombre} <span className="text-[11px] font-normal text-zinc-500">· {filaAbierta.que}</span></p>
            <button type="button" onClick={() => setAbierta(null)} className="text-xs text-orange-600 hover:underline">Cerrar</button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-2">Mes</th><th className="py-1 pr-2">Fecha</th><th className="py-1 pr-2">Detalle</th><th className="py-1 pr-2">De</th><th className="py-1 pl-2 text-right">Monto</th></tr></thead>
              <tbody>
                {er.periodos.flatMap((p) => filaAbierta.detalle[p].map((d, i) => (
                  <tr key={`${p}-${i}`} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pr-2 whitespace-nowrap">{mesCorto(p)}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{d.origen === "gasto" || d.origen === "banco" ? formatDate(d.fecha) : ""}</td>
                    <td className="py-1 pr-2">{d.detalle}</td>
                    <td className={`py-1 pr-2 whitespace-nowrap ${d.origen === "estimado" ? "text-amber-600" : "text-zinc-500"}`}>{ORIGEN[d.origen]}</td>
                    <td className="py-1 pl-2 text-right font-mono">{formatCurrency(d.monto)}</td>
                  </tr>
                )))}
                {er.periodos.every((p) => !filaAbierta.detalle[p].length) && <tr><td colSpan={5} className="py-2 text-zinc-500">Nada en estos meses.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {er.avisos.length > 0 && <Avisos avisos={er.avisos} />}
    </div>
  );
}

function Avisos({ avisos }: { avisos: EstadoResultados["avisos"] }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> Para revisar (no frena nada)</p>
      <ul className="space-y-0.5 text-amber-900 dark:text-amber-200">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}
