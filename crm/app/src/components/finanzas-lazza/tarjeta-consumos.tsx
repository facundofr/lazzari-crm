"use client";

/**
 * Consumos de la tarjeta, renglón por renglón (Augusto 02/11/2026). Los guarda «Subir resumen» (Finanzas → Bancos → Tarjetas).
 * - modo "finanzas" (Bancos → Tarjetas → Consumos): todos los consumos, la clase de cada comercio (compra / servicio / personal,
 *   se marca una vez), los cargos del banco y lo que falta cargar.
 * - modo "compras" (Compras Lazza → Mercado Libre → Consumos de la Visa, para los chicos): solo los consumos de compras, con
 *   ✔ la factura, 💡 la OC de Mercado Libre del mismo importe o ⚠ Falta la factura → Cargar (la ventana de siempre, «Ya pagada
 *   con Visa»), Elegir una ya cargada o No tiene.
 * El cruce se calcula acá (lib/visa-cruce) y no se guarda: solo se guarda lo que hace una persona (marcar_consumo_tarjeta).
 * Datos: consumos_de_tarjeta (migración 20261102200000; los chicos ven solo las compras).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, FileUp, ListChecks, Loader2, RefreshCw, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import ComprasLazzaFactura from "@/components/compras-lazza-factura";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { linkArchivo, rutaDeLinkArchivo } from "@/lib/archivo-link";
import { coincideTodas, normalizarTexto, palabrasBusqueda } from "@/lib/buscar-texto";
import { ordenarCandidatas, type FacturaML } from "@/lib/mercado-libre-compras";
import { claseSugerida, leerResumenTarjeta, renglonesDePdf, type ClaseConsumo, type ResumenLeido } from "@/lib/visa-resumen";
import { cruzarConsumos, faltaResolver, sugerirOc, type ConsumoCruce, type Cruce, type EstadoCruce, type MovimientoCruce, type OcSugerible } from "@/lib/visa-cruce";

const db = supabase as any;
const hrefArchivo = (url: string | null) => { const r = rutaDeLinkArchivo(url); return r ? linkArchivo(r.bucket, r.ruta) : url || ""; };
const selectCls = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";
const CLASES: { v: ClaseConsumo; t: string }[] = [{ v: "compra", t: "Compra" }, { v: "servicio", t: "Servicio" }, { v: "personal", t: "Personal" }];

/** Lee el texto del PDF del resumen en la compu (sin IA): cabecera, consumos y cargos. */
export async function leerPdfTarjeta(f: File): Promise<ResumenLeido | null> {
  if (f.type !== "application/pdf") return null;
  const pdfjs: any = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const paginas: { str: string; x: number; y: number }[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    paginas.push((tc.items as any[]).filter((it) => "str" in it).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] })));
  }
  return leerResumenTarjeta(renglonesDePdf(paginas));
}

interface FacturaConsumo { numero: string; tipo: string | null; total: number; moneda: string; fecha: string | null; archivo_url: string | null; proveedor: string | null }
type Fila = ConsumoCruce & { cupon: string | null; claseManual: boolean; factura: FacturaConsumo | null; cruce: Cruce; oc: OcSugerible | null; texto: string };
interface Resumen { id: string; cierre: string; vencimiento: string | null; cuenta_id: string; cuenta: string; consumos: number }

const ESTADO: Record<EstadoCruce, { t: string; cls: string }> = {
  unido: { t: "✔", cls: "text-emerald-700 dark:text-emerald-400" },
  cruzado: { t: "✔", cls: "text-emerald-700 dark:text-emerald-400" },
  cuotas: { t: "✔ en cuotas", cls: "text-emerald-700 dark:text-emerald-400" },
  centavos: { t: "✔ centavos", cls: "text-emerald-700 dark:text-emerald-400" },
  otro_importe: { t: "⚠ otro importe", cls: "text-amber-600 dark:text-amber-400" },
  cuota_anterior: { t: "Cuota de una compra anterior", cls: "text-zinc-500" },
  devuelto: { t: "Devuelto (se compensa)", cls: "text-zinc-500" },
  devolucion: { t: "⚠ Devolución", cls: "text-amber-600 dark:text-amber-400" },
  sin_factura: { t: "Sin factura", cls: "text-zinc-500" },
  falta: { t: "⚠ Falta", cls: "font-medium text-amber-600 dark:text-amber-400" },
  cargo: { t: "Cargo del banco", cls: "text-zinc-500" },
};

export function ConsumosTarjeta({ sociedadId, modo, resumenInicial, articulos, onAbrirOc }: {
  sociedadId: string;
  modo: "finanzas" | "compras";
  resumenInicial?: string;
  /** Pestaña Mercado Libre: un renglón por artículo de las OC, para sugerir la OC del mismo importe. */
  articulos?: OcSugerible[];
  onAbrirOc?: (oc: { id: string; numero: string }) => void;
}) {
  const { toast } = useToast();
  const [datos, setDatos] = useState<{ resumenes: Resumen[]; resumenId: string | null; consumos: any[]; movimientos: MovimientoCruce[]; finanzas: boolean } | null>(null);
  const [resumenId, setResumenId] = useState<string | undefined>(resumenInicial);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [soloFalta, setSoloFalta] = useState(false);
  const [busca, setBusca] = useState("");
  const [cargarPara, setCargarPara] = useState<Fila | null>(null);
  const [elegirPara, setElegirPara] = useState<Fila | null>(null);
  const [candidatas, setCandidatas] = useState<FacturaML[] | null>(null);
  const [buscaFc, setBuscaFc] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    const { data, error: e } = await db.rpc("consumos_de_tarjeta", { p_sociedad_id: sociedadId, p_resumen_id: resumenId ?? null });
    if (e) {
      setError(/consumos_de_tarjeta|function/i.test(e.message) ? "Falta correr la migración de los consumos de la tarjeta." : e.message);
      setDatos(null);
    } else {
      setDatos({
        resumenes: data?.resumenes || [], resumenId: data?.resumen_id ?? null, consumos: data?.consumos || [], finanzas: Boolean(data?.finanzas),
        movimientos: (data?.movimientos || []).map((m: any) => ({ id: m.id, fecha: String(m.fecha).slice(0, 10), monto: Number(m.monto) || 0, moneda: m.moneda === "USD" ? "USD" : "ARS",
          facturaCompraId: m.factura_compra_id, proveedor: m.proveedor || "", descripcion: m.descripcion || "", factura: m.factura || null })),
      });
    }
    setCargando(false);
  }, [sociedadId, resumenId]);
  useEffect(() => { void cargar(); }, [cargar]);

  const filas = useMemo<Fila[]>(() => {
    if (!datos) return [];
    const base = datos.consumos.map((c: any) => ({
      id: c.id, fecha: String(c.fecha).slice(0, 10), descripcion: c.descripcion, comercio: c.comercio, cupon: c.cupon, cuotaN: c.cuota_n, cuotaDe: c.cuota_de,
      importe: Number(c.importe) || 0, moneda: c.moneda === "USD" ? "USD" as const : "ARS" as const, tipo: c.tipo === "cargo" ? "cargo" as const : "consumo" as const,
      clase: c.clase ?? null, claseManual: Boolean(c.clase_manual), facturaCompraId: c.factura_compra_id ?? null, sinFactura: c.sin_factura_motivo ?? null,
      factura: c.factura ? { ...c.factura, total: Number(c.factura.total) || 0 } : null,
    }));
    const cruces = cruzarConsumos(base, datos.movimientos);
    return base.map((c) => {
      const cruce = cruces.get(c.id)!;
      const oc = articulos && faltaResolver(cruce.estado) ? sugerirOc(c, articulos) : null;
      return { ...c, cruce, oc, texto: normalizarTexto([c.descripcion, c.factura?.numero, c.factura?.proveedor, cruce.mov?.proveedor, cruce.mov?.factura, oc?.ocNumero].filter(Boolean).join(" ")) };
    });
  }, [datos, articulos]);

  const esFinanzas = modo === "finanzas" && Boolean(datos?.finanzas);
  /** Lo que todavía hay que resolver: compras y servicios (lo personal es retiro, no lleva factura). */
  const falta = useCallback((f: Fila) => f.tipo === "consumo" && f.clase !== "personal" && faltaResolver(f.cruce.estado), []);
  const consumos = useMemo(() => filas.filter((f) => f.tipo === "consumo"), [filas]);
  const cargos = useMemo(() => filas.filter((f) => f.tipo === "cargo"), [filas]);
  const porClasificar = useMemo(() => {
    const m = new Map<string, { comercio: string; n: number; sugerida: ClaseConsumo | null }>();
    for (const f of consumos) if (!f.clase && !f.claseManual) { const x = m.get(f.comercio); if (x) x.n++; else m.set(f.comercio, { comercio: f.comercio, n: 1, sugerida: claseSugerida(f.comercio) }); }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [consumos]);
  const palabras = useMemo(() => palabrasBusqueda(busca), [busca]);
  const visibles = useMemo(() => consumos.filter((f) => (!soloFalta || falta(f)) && (!palabras.length || coincideTodas(f.texto, palabras))), [consumos, soloFalta, falta, palabras]);
  const totales = useMemo(() => {
    const t = { ars: 0, usd: 0, faltaN: 0, faltaArs: 0, faltaUsd: 0, personalArs: 0, personalUsd: 0, cargos: 0 };
    for (const f of consumos) {
      if (f.moneda === "USD") t.usd += f.importe; else t.ars += f.importe;
      if (falta(f)) { t.faltaN++; if (f.moneda === "USD") t.faltaUsd += f.importe; else t.faltaArs += f.importe; }
      if (f.clase === "personal") { if (f.moneda === "USD") t.personalUsd += f.importe; else t.personalArs += f.importe; }
    }
    for (const f of cargos) t.cargos += f.importe;
    return t;
  }, [consumos, cargos, falta]);
  const pesosUsd = (ars: number, usd: number) => [formatCurrency(ars), usd ? formatCurrency(usd, "USD") : ""].filter(Boolean).join(" + ");

  async function marcar(f: Fila, facturaId: string | null, motivo: string | null, ok: string) {
    const { error: e } = await db.rpc("marcar_consumo_tarjeta", { p_consumo_id: f.id, p_factura_compra_id: facturaId, p_sin_factura_motivo: motivo });
    if (e) { toast.error(`No se pudo guardar: ${e.message}`); return false; }
    toast.success(ok);
    void cargar();
    return true;
  }
  async function noTiene(f: Fila) {
    const motivo = window.prompt(`«${f.descripcion}» (${formatCurrency(f.importe, f.moneda)}) no va a tener factura. ¿Por qué? (ej. Pagó Seba con su plata)`, "");
    if (motivo === null) return;
    if (!motivo.trim()) { toast.error("Escribí el motivo para marcarlo."); return; }
    await marcar(f, null, motivo.trim(), `${f.descripcion}: no tiene factura (${motivo.trim()})`);
  }
  async function deshacer(f: Fila) {
    if (!window.confirm(f.facturaCompraId ? `¿Sacar la factura ${f.factura?.numero || ""} de este consumo? La factura no cambia.` : `¿Volver a pedir la factura de «${f.descripcion}»?`)) return;
    await marcar(f, null, null, "Listo: el consumo vuelve a cruzarse solo");
  }
  async function clasificar(comercio: string, clase: ClaseConsumo | null, soloConsumo?: string) {
    setOcupado(true);
    const { data, error: e } = await db.rpc("clasificar_consumo_tarjeta", { p_sociedad_id: sociedadId, p_comercio: comercio, p_clase: clase, p_consumo_id: soloConsumo ?? null });
    setOcupado(false);
    if (e) { toast.error(`No se pudo clasificar: ${e.message}`); return; }
    toast.success(soloConsumo ? "Clase del consumo guardada" : `${comercio}: ${clase ? CLASES.find((c) => c.v === clase)!.t.toLowerCase() : "sin clase"} (${data?.consumos ?? 0} consumos)`);
    void cargar();
  }
  async function cambiarClase(f: Fila, clase: ClaseConsumo | null) {
    const otros = consumos.filter((x) => x.comercio === f.comercio).length;
    const todos = otros <= 1 || window.confirm(`¿Para todos los consumos de «${f.comercio}» (${otros} en este resumen y los de los próximos)?\n\nAceptar: todos · Cancelar: solo este consumo`);
    await clasificar(f.comercio, clase, todos ? undefined : f.id);
  }
  async function confirmarSugeridas() {
    const lista = porClasificar.filter((p) => p.sugerida);
    if (!lista.length || !window.confirm(`¿Guardar la clase sugerida de ${lista.length} comercios?\n\n${lista.map((p) => `${p.comercio}: ${p.sugerida}`).join("\n")}`)) return;
    setOcupado(true);
    for (const p of lista) {
      const { error: e } = await db.rpc("clasificar_consumo_tarjeta", { p_sociedad_id: sociedadId, p_comercio: p.comercio, p_clase: p.sugerida, p_consumo_id: null });
      if (e) { toast.error(`${p.comercio}: ${e.message}`); break; }
    }
    setOcupado(false);
    toast.success("Clases guardadas");
    void cargar();
  }

  // "Elegir una ya cargada": facturas de compra de los últimos 6 meses (sin anuladas ni notas de crédito), las de importe parecido arriba.
  useEffect(() => {
    if (!elegirPara || candidatas) return;
    const desde = new Date(Date.parse(elegirPara.fecha) - 60 * 86_400_000).toISOString().slice(0, 10);
    void (async () => {
      const { data, error: e } = await db.from("facturas_compra").select("id, numero_factura, tipo_comprobante, total, moneda, fecha, estado, archivo_url, proveedores(razon_social)")
        .eq("sociedad_id", sociedadId).neq("estado", "anulada").gte("fecha", desde).order("fecha", { ascending: false }).limit(1000);
      if (e) { toast.error(`No se pudieron traer las facturas: ${e.message}`); setCandidatas([]); return; }
      setCandidatas(((data || []) as any[]).filter((f) => !/^NC/i.test(f.tipo_comprobante || "")).map((f) => ({
        id: f.id, numero: f.numero_factura || "", tipo: f.tipo_comprobante || null, total: Number(f.total) || 0, moneda: f.moneda === "USD" ? "USD" : "ARS",
        fecha: f.fecha || null, proveedor: f.proveedores?.razon_social || "", archivoUrl: f.archivo_url || null,
      })));
    })();
  }, [elegirPara, candidatas, sociedadId, toast]);
  const listaElegir = useMemo(() => {
    if (!elegirPara || !candidatas) return [];
    const p = palabrasBusqueda(buscaFc);
    const filtradas = p.length ? candidatas.filter((f) => coincideTodas(normalizarTexto(`${f.numero} ${f.proveedor} ${f.total}`), p)) : candidatas;
    return ordenarCandidatas(filtradas, elegirPara.importe * (elegirPara.cuotaDe && elegirPara.cuotaDe > 1 ? elegirPara.cuotaDe : 1), elegirPara.moneda).slice(0, 60);
  }, [elegirPara, candidatas, buscaFc]);

  const lleva = (f: Fila) => f.clase === "compra" || (esFinanzas && f.clase !== "personal");
  const columnas: Column<Fila>[] = [
    { key: "fecha", label: "Fecha", render: (f) => <span className="whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">{formatDate(f.fecha)}</span> },
    { key: "descripcion", label: "Consumo", render: (f) => (
      <span className="block max-w-[260px] truncate text-xs" title={`${f.descripcion}${f.cupon ? ` · cupón ${f.cupon}` : ""}`}>
        {f.descripcion}{f.cuotaDe && f.cuotaDe > 1 ? <span className="ml-1 text-zinc-400">cuota {f.cuotaN}/{f.cuotaDe}</span> : null}
      </span>
    ) },
    { key: "importe", label: "Importe", className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono text-xs ${f.importe < 0 ? "text-emerald-600" : ""}`}>{formatCurrency(f.importe, f.moneda)}</span> },
    ...(esFinanzas ? [{ key: "clase", label: "Clase", sortValue: (f: Fila) => f.clase || "", render: (f: Fila) => (
      <select value={f.clase || ""} disabled={ocupado} onChange={(e) => void cambiarClase(f, (e.target.value || null) as ClaseConsumo | null)} onClick={(e) => e.stopPropagation()}
        className={`h-7 rounded-md border px-1 text-xs dark:bg-zinc-900 ${f.clase ? "border-zinc-200 dark:border-zinc-700" : "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"}`}
        title={f.claseManual ? "Clase de este consumo solo" : "Clase del comercio (vale para todos sus consumos)"}>
        <option value="">{claseSugerida(f.comercio) ? `¿${CLASES.find((c) => c.v === claseSugerida(f.comercio))!.t}?` : "Sin clase"}</option>
        {CLASES.map((c) => <option key={c.v} value={c.v}>{c.t}</option>)}
      </select>
    ) } as Column<Fila>] : []),
    { key: "estado", label: "En el CRM", sortValue: (f) => f.cruce.estado, render: (f) => {
      const e = f.cruce.estado;
      const mov = f.cruce.mov;
      const fc = f.factura;
      return (
        <span className="flex flex-wrap items-center gap-1 text-[11px]">
          {f.clase === "personal" && faltaResolver(e) ? <span className="text-zinc-500">Personal (retiro)</span> : <span className={`whitespace-nowrap ${ESTADO[e].cls}`}>{ESTADO[e].t}</span>}
          {fc && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              title={`${fc.proveedor || ""} · ${formatCurrency(fc.total, fc.moneda === "USD" ? "USD" : "ARS")}${fc.fecha ? ` · ${formatDate(fc.fecha)}` : ""}`}>
              {fc.archivo_url ? <a href={hrefArchivo(fc.archivo_url)} target="_blank" rel="noreferrer" className="hover:underline">{fc.numero}</a> : fc.numero}
              <span className="max-w-[140px] truncate font-normal">{fc.proveedor}</span>
              <button onClick={() => void deshacer(f)} title="Sacar esta factura del consumo (la factura no cambia)" className="rounded-full p-0.5 hover:bg-emerald-200 hover:text-red-600 dark:hover:bg-emerald-800"><X className="h-3 w-3" /></button>
            </span>
          )}
          {!fc && mov && (
            <span className="max-w-[260px] truncate text-zinc-600 dark:text-zinc-300" title={`${formatDate(mov.fecha)} · ${formatCurrency(mov.monto, mov.moneda)} · ${mov.proveedor || mov.descripcion}`}>
              {mov.factura || mov.proveedor || mov.descripcion}{mov.factura && mov.proveedor ? ` · ${mov.proveedor}` : ""}
              {f.cruce.diferencia ? <span className="ml-1 font-mono text-amber-600">dif. {formatCurrency(f.cruce.diferencia, f.moneda)}</span> : null}
            </span>
          )}
          {f.sinFactura && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {f.sinFactura}
              <button onClick={() => void deshacer(f)} title="Volver a pedir la factura" className="rounded-full p-0.5 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"><X className="h-3 w-3" /></button>
            </span>
          )}
          {f.oc && (
            <button onClick={() => onAbrirOc?.({ id: f.oc!.ocId, numero: f.oc!.ocNumero })} title={`Misma plata con IVA que la ${f.oc.ocNumero} (${formatCurrency(f.oc.importe, f.oc.moneda)}): es solo una sugerencia`}
              className="whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 hover:underline dark:bg-violet-950/40 dark:text-violet-300">💡 {f.oc.ocNumero}</button>
          )}
          {e === "cuota_anterior" && <span className="text-zinc-400">se carga una vez, en el mes de la compra</span>}
        </span>
      );
    } },
    { key: "acciones", label: "", sortable: false, render: (f) => (falta(f) && lleva(f) ? (
      <span className="flex justify-end gap-1">
        <button onClick={() => setCargarPara(f)} title="Cargar la factura de este consumo (ya pagada con Visa)"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700"><FileUp className="h-3.5 w-3.5" /> Cargar</button>
        <button onClick={() => { setBuscaFc(""); setCandidatas(null); setElegirPara(f); }} title="La factura ya está cargada en el sistema: elegila"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><ListChecks className="h-3.5 w-3.5" /> Elegir</button>
        <button onClick={() => void noTiene(f)} title="Este consumo no va a tener factura: deja de sumar en lo que falta"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"><Ban className="h-3.5 w-3.5" /> No tiene</button>
      </span>
    ) : null) },
  ];

  const resumen = datos?.resumenes.find((r) => r.id === datos.resumenId);
  if (error) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>;
  if (!cargando && datos && !datos.resumenes.length) {
    return <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
      {modo === "compras" ? "Todavía no hay consumos de compras de la Visa: aparecen cuando Augusto sube el resumen y marca qué comercios son compras." : "Todavía no hay consumos: subí el resumen de la tarjeta (Subir resumen)."}
    </p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select value={datos?.resumenId || ""} onChange={(e) => setResumenId(e.target.value)} className={selectCls} title="Resumen">
          {(datos?.resumenes || []).map((r) => <option key={r.id} value={r.id}>{r.cuenta} · cierre {formatDate(r.cierre)} ({r.consumos})</option>)}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar comercio, factura u OC…"
          className="h-8 w-full max-w-[220px] rounded-lg border border-zinc-200 bg-white px-2 text-sm focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
        <button onClick={() => setSoloFalta((v) => !v)} className={`h-8 rounded-lg border px-2 text-sm ${soloFalta ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
          {modo === "compras" ? "Falta la factura" : "Falta cargar"} <span className="text-xs opacity-70">{totales.faltaN}</span>
        </button>
        <span className="text-xs text-zinc-500">
          {consumos.length} consumos · {pesosUsd(totales.ars, totales.usd)}
          {totales.faltaN > 0 && <> · falta <b className="font-mono text-amber-700 dark:text-amber-400">{pesosUsd(totales.faltaArs, totales.faltaUsd)}</b></>}
          {esFinanzas && (totales.personalArs || totales.personalUsd) ? <> · personal {pesosUsd(totales.personalArs, totales.personalUsd)}</> : null}
          {resumen?.vencimiento && <> · vence {formatDate(resumen.vencimiento)}</>}
        </span>
        <button onClick={() => void cargar()} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700" title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
      </div>

      {esFinanzas && porClasificar.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/20">
          <span className="font-medium text-amber-800 dark:text-amber-300">{porClasificar.length} comercios sin clase (se marca una vez):</span>
          {porClasificar.slice(0, 12).map((p) => (
            <span key={p.comercio} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 dark:bg-zinc-900">
              {p.comercio} <span className="text-zinc-400">({p.n})</span>
              {CLASES.map((c) => (
                <button key={c.v} disabled={ocupado} onClick={() => void clasificar(p.comercio, c.v)}
                  className={`rounded px-1 ${p.sugerida === c.v ? "bg-amber-200 font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>{c.t}</button>
              ))}
            </span>
          ))}
          {porClasificar.some((p) => p.sugerida) && (
            <button disabled={ocupado} onClick={() => void confirmarSugeridas()} className="rounded-md bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Confirmar las sugeridas (${porClasificar.filter((p) => p.sugerida).length})`}
            </button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <DataTable<Fila> data={visibles} loading={cargando && !datos} columns={columnas}
          emptyMessage={soloFalta ? "No falta nada: todos los consumos están en el CRM." : "No hay consumos con estos filtros."} />
      </div>

      {esFinanzas && cargos.length > 0 && (
        <details className="rounded-lg border border-zinc-200 p-2 text-xs dark:border-zinc-800">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">Cargos del banco: <b className="font-mono">{formatCurrency(totales.cargos)}</b> (sellos, intereses, IVA y percepciones)</summary>
          <table className="mt-1 w-full">
            <tbody>
              {cargos.map((c) => (
                <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-0.5 text-zinc-500">{formatDate(c.fecha)}</td><td>{c.descripcion}</td><td className="text-right font-mono">{formatCurrency(c.importe, c.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {cargarPara && (
        <ComprasLazzaFactura sociedadId={sociedadId} conVisaInicial para={`consumo ${formatDate(cargarPara.fecha)} · ${cargarPara.descripcion} · ${formatCurrency(cargarPara.importe, cargarPara.moneda)}`}
          onGuardada={async (id) => { await marcar(cargarPara, id, null, "Factura unida al consumo"); }}
          onClose={() => { setCargarPara(null); void cargar(); }} />
      )}

      <Modal open={!!elegirPara} onClose={() => { setElegirPara(null); setCandidatas(null); }} size="xl" title="Elegir una factura ya cargada"
        description={elegirPara ? `Para el consumo ${elegirPara.descripcion} del ${formatDate(elegirPara.fecha)} · ${formatCurrency(elegirPara.importe, elegirPara.moneda)}. Arriba, las de importe más parecido.` : ""}>
        <div className="space-y-2">
          <input value={buscaFc} onChange={(e) => setBuscaFc(e.target.value)} placeholder="Buscar por número, proveedor o importe…" autoFocus
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          {!candidatas && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las facturas…</p>}
          {candidatas && !listaElegir.length && <p className="text-sm text-zinc-500">No hay facturas con esa búsqueda.</p>}
          <div className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border dark:divide-zinc-800 dark:border-zinc-700">
            {listaElegir.map((f) => (
              <div key={f.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm ${f.coincide ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                <span className="w-20 shrink-0 text-xs text-zinc-500">{f.fecha ? formatDate(f.fecha) : "—"}</span>
                <span className="min-w-0 flex-1 truncate" title={f.proveedor}>{f.proveedor || "—"}</span>
                <span className="shrink-0 font-mono text-xs">{f.tipo ? `${f.tipo} ` : ""}{f.archivoUrl ? <a href={hrefArchivo(f.archivoUrl)} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline">{f.numero}</a> : f.numero}</span>
                <span className="w-28 shrink-0 text-right font-mono text-xs">{formatCurrency(f.total, f.moneda)}</span>
                <span className={`w-24 shrink-0 text-right text-[11px] ${f.coincide ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-400"}`}>
                  {f.coincide ? "✔ mismo importe" : `${f.diferencia > 0 ? "+" : ""}${formatCurrency(f.diferencia, f.moneda)}`}
                </span>
                <button disabled={ocupado} onClick={async () => { setOcupado(true); const ok = await marcar(elegirPara!, f.id, null, `Factura ${f.numero} unida al consumo`); setOcupado(false); if (ok) { setElegirPara(null); setCandidatas(null); } }}
                  className="shrink-0 rounded-md bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">Elegir</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
