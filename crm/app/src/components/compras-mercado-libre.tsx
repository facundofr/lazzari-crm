"use client";

/**
 * Compras Lazza › pestaña "Mercado Libre" (Augusto 30/10/2026): una fila por artículo de las OC al proveedor Mercado Libre.
 * A cada artículo se le carga la factura A MANO (nada se une solo):
 *  - "Cargar factura": la ventana de siempre (components/compras-lazza-factura) con "Ya pagada con Visa" elegido; al guardar
 *    queda unida a ese artículo y a los otros tildados (una factura puede cubrir varios artículos).
 *  - "Elegir una ya cargada": para las facturas que ya están en el sistema (así no se cargan dos veces).
 *  - La ✕ de la factura deshace la unión (la factura no cambia).
 *  - "No tiene" (Augusto 30/10): el artículo no va a tener factura nunca (ej. lo pagó Seba): se marca con un motivo y deja de
 *    sumar en "Falta la factura"; la ✕ lo desmarca (no se borra). Tabla mercado_libre_sin_factura (migración 20261030170000).
 * La unión se guarda con unir_factura_mercado_libre / quitar_factura_mercado_libre (migración 20261030160000).
 * Lógica pura en lib/mercado-libre-compras (prueba: scripts/test-mercado-libre-compras.ts).
 * Seba 02/11: la OC en naranja abre la OC (components/compras-lazza-oc); el ícono al lado tilda todos sus artículos; arriba,
 * con artículos tildados, "Cargar factura" y "Varias facturas" (se eligen varios PDF y se cargan de a uno, todos unidos a los
 * tildados). Así una factura va a varias OC, una OC lleva varias facturas (+ Otra) y varias facturas van a varias OC.
 * Factura en la OC equivocada: se saca con la ✕ y se carga en la otra; si el PDF ya está cargado, la ventana ofrece
 * «Usar la que ya está» (la une sin cargarla de nuevo). No se anula nada (Augusto 02/11: bien simple).
 * Augusto 02/11: arriba «Por artículo» | «Consumos de la Visa»: los consumos de compras del resumen de la Visa, cada uno con su
 * factura o «Falta la factura» (components/finanzas-lazza/tarjeta-consumos, modo compras); 💡 la OC del mismo importe con IVA.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import ComprasLazzaFactura from "@/components/compras-lazza-factura";
import ComprasLazzaOc from "@/components/compras-lazza-oc";
import { ConsumosTarjeta } from "@/components/finanzas-lazza/tarjeta-consumos";
import type { OcSugerible } from "@/lib/visa-cruce";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { coincideTodas, normalizarTexto, palabrasBusqueda } from "@/lib/buscar-texto";
import { linkArchivo, rutaDeLinkArchivo } from "@/lib/archivo-link";
import { armarFilasML, faltaFactura, ordenarCandidatas, resumenML, type FacturaML, type FilaML, type OcML, type SinFacturaML } from "@/lib/mercado-libre-compras";
import { Ban, CheckSquare, FileUp, Files, ListChecks, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";

const db = supabase as any;
type Vista = FilaML & { id: string; texto: string };

const SEL_FC = "id, numero_factura, tipo_comprobante, total, moneda, fecha, estado, archivo_url, proveedores(razon_social)";
const aFactura = (f: any): FacturaML => ({
  id: f.id, numero: f.numero_factura || "", tipo: f.tipo_comprobante || null, total: Number(f.total) || 0, moneda: f.moneda === "USD" ? "USD" : "ARS",
  fecha: f.fecha || null, proveedor: f.proveedores?.razon_social || "", archivoUrl: f.archivo_url || null,
});
const hrefArchivo = (url: string | null) => { const r = rutaDeLinkArchivo(url); return r ? linkArchivo(r.bucket, r.ruta) : url || ""; };
const selectCls = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";

async function enTandas<T>(ids: string[], armar: (tanda: string[]) => any): Promise<T[]> {
  const out: T[] = [];
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await armar(unicos.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data || []) as T[]));
  }
  return out;
}

export default function ComprasMercadoLibre({ sociedadId }: { sociedadId: string }) {
  const { toast } = useToast();
  const [filas, setFilas] = useState<Vista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [busca, setBusca] = useState("");
  const [soloFalta, setSoloFalta] = useState(false);
  const [periodo, setPeriodo] = useState<"" | "mes" | "mes_pasado">("");
  const [tildados, setTildados] = useState<Set<string>>(new Set());
  const [cargarPara, setCargarPara] = useState<Vista[] | null>(null);
  const [elegirPara, setElegirPara] = useState<Vista[] | null>(null);
  const [candidatas, setCandidatas] = useState<FacturaML[] | null>(null);
  const [buscaFc, setBuscaFc] = useState("");
  const [uniendo, setUniendo] = useState(false);
  const [ocAbierta, setOcAbierta] = useState<{ id: string; numero: string } | null>(null);
  // Varias facturas juntas: se cargan de a una (la ventana de siempre) y todas se unen a los mismos artículos.
  const [cola, setCola] = useState<{ archivos: File[]; total: number; para: Vista[] } | null>(null);
  const colaGuardada = useRef(false);
  const [vista, setVista] = useState<"articulos" | "visa">("articulos");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const { data: provs, error: eP } = await db.from("proveedores").select("id").eq("sociedad_id", sociedadId).ilike("razon_social", "%mercado%libre%");
      if (eP) throw eP;
      const provIds = (provs || []).map((p: { id: string }) => p.id);
      if (!provIds.length) { setFilas([]); return; }
      const ocs = await traerTodo<any>(() => db.from("ordenes_compra")
        .select("id, numero, fecha, moneda, presupuesto_origen:presupuesto_origen_id(numero, clientes(razon_social)), orden_compra_items(id, descripcion, cantidad, precio_unitario, iva_porcentaje, moneda)")
        .eq("sociedad_id", sociedadId).in("proveedor_id", provIds).neq("estado", "cancelada").order("id"));
      const ocsML: OcML[] = ocs.map(o => ({
        id: o.id, numero: o.numero, fecha: o.fecha, moneda: o.moneda, prNumero: o.presupuesto_origen?.numero || "",
        cliente: o.presupuesto_origen?.clientes?.razon_social || "", items: o.orden_compra_items || [],
      }));
      const itemIds = ocsML.flatMap(o => o.items.map(i => i.id));
      const asig = await enTandas<{ orden_compra_item_id: string; factura_compra_id: string; origen: string }>(itemIds,
        t => db.from("factura_compra_asignaciones").select("orden_compra_item_id, factura_compra_id, origen").in("orden_compra_item_id", t));
      const fcs = await enTandas<any>(asig.map(a => a.factura_compra_id), t => db.from("facturas_compra").select(SEL_FC).in("id", t).neq("estado", "anulada"));
      // «No tiene factura»: si la tabla todavía no está (migración sin correr), se sigue sin las marcas.
      let sinF: SinFacturaML[] = [];
      try {
        sinF = (await enTandas<{ orden_compra_item_id: string; motivo: string }>(itemIds,
          t => db.from("mercado_libre_sin_factura").select("orden_compra_item_id, motivo").eq("anulado", false).in("orden_compra_item_id", t)))
          .map(x => ({ ocItemId: x.orden_compra_item_id, motivo: x.motivo }));
      } catch { sinF = []; }
      const armadas = armarFilasML(ocsML, asig.map(a => ({ ocItemId: a.orden_compra_item_id, facturaId: a.factura_compra_id, origen: a.origen })), fcs.map(aFactura), sinF);
      setFilas(armadas.map(f => ({
        ...f, id: f.ocItemId,
        texto: normalizarTexto([f.ocNumero, f.prNumero, f.cliente, f.descripcion, f.noTiene || "", ...f.facturas.flatMap(x => [x.numero, x.proveedor])].join(" ")),
      })));
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer las compras de Mercado Libre");
    } finally {
      setCargando(false);
    }
  }, [sociedadId]);
  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => {
    const refrescar = () => { void cargar(); };
    window.addEventListener(EVENTO_FACTURAS_COMPRA, refrescar);
    return () => window.removeEventListener(EVENTO_FACTURAS_COMPRA, refrescar);
  }, [cargar]);

  const palabras = useMemo(() => palabrasBusqueda(busca), [busca]);
  const rango = useMemo(() => {
    const hoy = todayAR();
    if (periodo === "mes") return { d: `${hoy.slice(0, 7)}-01`, h: "9999" };
    if (periodo === "mes_pasado") {
      const [y, m] = hoy.split("-").map(Number);
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { d: `${py}-${String(pm).padStart(2, "0")}-01`, h: `${hoy.slice(0, 7)}-01` };
    }
    return null;
  }, [periodo]);
  const enPeriodo = useMemo(() => filas.filter(f => {
    if (rango && !((f.fecha || "") >= rango.d && (f.fecha || "") < rango.h)) return false;
    if (palabras.length && !coincideTodas(f.texto, palabras)) return false;
    return true;
  }), [filas, rango, palabras]);
  const visibles = useMemo(() => (soloFalta ? enPeriodo.filter(faltaFactura) : enPeriodo), [enPeriodo, soloFalta]);
  const resumen = useMemo(() => resumenML(enPeriodo), [enPeriodo]);
  /** Para «Consumos de la Visa»: la OC del mismo importe con IVA (💡, solo sugerencia). */
  const articulosOc = useMemo<OcSugerible[]>(() => filas.map(f => ({
    ocId: f.ocId, ocNumero: f.ocNumero, fecha: f.fecha || null, importe: f.importe, moneda: f.moneda === "USD" ? "USD" : "ARS", conFactura: f.facturas.length > 0 || !!f.noTiene,
  })), [filas]);

  /** Lo que va a llevar la factura: la fila tocada más las tildadas. */
  const objetivo = useCallback((f: Vista) => [f, ...filas.filter(x => tildados.has(x.id) && x.id !== f.id)], [filas, tildados]);
  const textoPara = (lista: Vista[]) => (lista.length === 1 ? `${lista[0].ocNumero} · ${lista[0].descripcion}` : `${lista.length} artículos`);

  const unir = useCallback(async (facturaId: string, lista: Vista[]) => {
    const { data, error: e } = await db.rpc("unir_factura_mercado_libre", { p_factura_id: facturaId, p_oc_item_ids: lista.map(f => f.ocItemId) });
    if (e) { toast.error(`La factura quedó cargada, pero no se pudo unir al artículo: ${e.message}`); return false; }
    toast.success(lista.length === 1 ? `Factura unida a ${lista[0].descripcion}` : `Factura unida a ${data?.unidos ?? lista.length} artículos`);
    setTildados(new Set());
    return true;
  }, [toast]);

  async function elegir(f: FacturaML) {
    if (!elegirPara || uniendo) return;
    setUniendo(true);
    const ok = await unir(f.id, elegirPara);
    setUniendo(false);
    if (ok) { setElegirPara(null); void cargar(); }
  }

  async function quitar(fila: Vista, f: FacturaML) {
    if (!window.confirm(`¿Sacar la factura ${f.numero} de «${fila.descripcion}»? La factura no cambia: solo deja de estar unida a este artículo.

Si era de otro artículo, en ese tocá Elegir (o Cargar: si la volvés a subir, tocá «Usar la que ya está»).`)) return;
    const { error: e } = await db.rpc("quitar_factura_mercado_libre", { p_factura_id: f.id, p_oc_item_id: fila.ocItemId });
    if (e) { toast.error(`No se pudo sacar: ${e.message}`); return; }
    toast.success(`Factura ${f.numero} sacada de ${fila.descripcion}`);
    void cargar();
  }

  async function marcarNoTiene(fila: Vista) {
    const motivo = window.prompt(`«${fila.descripcion}» no va a tener factura. ¿Por qué? (ej. Pagó Seba con su plata)`, "");
    if (motivo === null) return;
    if (!motivo.trim()) { toast.error("Escribí el motivo para marcarlo."); return; }
    const { error: e } = await db.rpc("marcar_mercado_libre_sin_factura", { p_oc_item_id: fila.ocItemId, p_motivo: motivo.trim() });
    if (e) { toast.error(`No se pudo marcar: ${e.message}`); return; }
    toast.success(`${fila.descripcion}: no tiene factura (${motivo.trim()})`);
    void cargar();
  }

  async function desmarcarNoTiene(fila: Vista) {
    if (!window.confirm(`¿Volver a pedir la factura de «${fila.descripcion}»?`)) return;
    const { error: e } = await db.rpc("desmarcar_mercado_libre_sin_factura", { p_oc_item_id: fila.ocItemId });
    if (e) { toast.error(`No se pudo desmarcar: ${e.message}`); return; }
    toast.success(`${fila.descripcion}: vuelve a faltar la factura`);
    void cargar();
  }

  // "Elegir una ya cargada": facturas de compra de los últimos 6 meses (sin anuladas ni notas de crédito).
  useEffect(() => {
    if (!elegirPara || candidatas) return;
    const desde = new Date(Date.now() - 183 * 86_400_000).toISOString().slice(0, 10);
    void (async () => {
      const { data, error: e } = await db.from("facturas_compra").select(SEL_FC).eq("sociedad_id", sociedadId).neq("estado", "anulada")
        .gte("fecha", desde).order("fecha", { ascending: false }).limit(1000);
      if (e) { toast.error(`No se pudieron traer las facturas: ${e.message}`); setCandidatas([]); return; }
      setCandidatas(((data || []) as any[]).filter(f => !/^NC/i.test(f.tipo_comprobante || "")).map(aFactura));
    })();
  }, [elegirPara, candidatas, sociedadId, toast]);
  const importeElegir = useMemo(() => (elegirPara || []).reduce((s, f) => s + f.importe, 0), [elegirPara]);
  const listaElegir = useMemo(() => {
    if (!elegirPara || !candidatas) return [];
    const p = palabrasBusqueda(buscaFc);
    const filtradas = p.length ? candidatas.filter(f => coincideTodas(normalizarTexto(`${f.numero} ${f.proveedor} ${f.total}`), p)) : candidatas;
    return ordenarCandidatas(filtradas, importeElegir, elegirPara[0]?.moneda ?? "ARS").slice(0, 60);
  }, [elegirPara, candidatas, buscaFc, importeElegir]);

  const tildar = (id: string) => setTildados(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  /** Tilda todos los artículos de la OC; si ya estaban todos, los destilda. */
  const tildarOc = (ocId: string) => setTildados(p => {
    const ids = filas.filter(x => x.ocId === ocId).map(x => x.id);
    const n = new Set(p);
    if (ids.every(id => n.has(id))) ids.forEach(id => n.delete(id)); else ids.forEach(id => n.add(id));
    return n;
  });
  const tildadas = useMemo(() => filas.filter(x => tildados.has(x.id)), [filas, tildados]);

  function empezarCola(archivos: File[]) {
    if (!archivos.length || !tildadas.length) return;
    colaGuardada.current = false;
    setCola({ archivos, total: archivos.length, para: tildadas });
  }
  /** Al cerrar la ventana de una factura de la tanda: pasa a la siguiente (si no se guardó, pregunta). */
  function siguienteDeCola() {
    if (!cola) return;
    const resto = cola.archivos.slice(1);
    if (resto.length && (colaGuardada.current || window.confirm(`No se guardó «${cola.archivos[0].name}». ¿Seguir con la siguiente (${resto[0].name})?`))) {
      colaGuardada.current = false;
      setCola({ ...cola, archivos: resto });
      return;
    }
    setCola(null);
    setTildados(new Set());
    void cargar();
  }

  const columnas: Column<Vista>[] = [
    { key: "tilde", label: "", sortable: false, render: f => (
      <input type="checkbox" checked={tildados.has(f.id)} onChange={() => tildar(f.id)} onClick={e => e.stopPropagation()}
        title="Tildá los artículos que van en la misma factura" className="h-3.5 w-3.5 accent-orange-500" />
    ) },
    { key: "fecha", label: "Fecha", render: f => <span className="whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-300">{f.fecha ? formatDate(f.fecha) : "—"}</span> },
    { key: "ocNumero", label: "OC", render: f => (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <button onClick={e => { e.stopPropagation(); setOcAbierta({ id: f.ocId, numero: f.ocNumero }); }} title="Ver lo que tiene esta OC"
          className="font-mono text-xs font-bold text-orange-600 hover:underline">{f.ocNumero}</button>
        <button onClick={e => { e.stopPropagation(); tildarOc(f.ocId); }} title="Tildar todos los artículos de esta OC (para la misma factura)"
          className="rounded p-0.5 text-zinc-400 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-950/30"><CheckSquare className="h-3 w-3" /></button>
      </span>
    ) },
    { key: "prNumero", label: "PR / Cliente", sortValue: f => `${f.prNumero} ${f.cliente}`, render: f => (
      <span className="block max-w-[190px] truncate text-xs" title={`${f.prNumero} · ${f.cliente}`}><span className="font-mono text-zinc-500">{f.prNumero || "—"}</span>{f.cliente ? ` · ${f.cliente}` : ""}</span>
    ) },
    { key: "descripcion", label: "Artículo", render: f => <span className="block max-w-[300px] truncate text-xs" title={f.descripcion}>{f.descripcion || "—"}</span> },
    { key: "cantidad", label: "Cant.", className: "text-right", render: f => <span className="font-mono text-xs">{f.cantidad}</span> },
    { key: "importe", label: "Con IVA", className: "text-right", render: f => <span className="whitespace-nowrap font-mono text-xs">{formatCurrency(f.importe, f.moneda)}</span> },
    { key: "factura", label: "Factura", sortable: false, render: f => (
      <span className="flex flex-wrap items-center gap-1">
        {f.facturas.map(x => (
          <span key={x.id} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            title={`${x.proveedor} · ${formatCurrency(x.total, x.moneda)}${x.fecha ? ` · ${formatDate(x.fecha)}` : ""}`}>
            ✔ {x.archivoUrl
              ? <a href={hrefArchivo(x.archivoUrl)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="hover:underline">{x.numero}</a>
              : x.numero}
            {x.origen === "mercado_libre" && (
              <button onClick={e => { e.stopPropagation(); void quitar(f, x); }} title="Sacar esta factura del artículo (la factura no cambia)"
                className="rounded-full p-0.5 text-emerald-600 hover:bg-emerald-200 hover:text-red-600 dark:hover:bg-emerald-800"><X className="h-3 w-3" /></button>
            )}
          </span>
        ))}
        {f.noTiene && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Marcado «No tiene factura»: no suma en Falta la factura">
            Sin factura: {f.noTiene}
            <button onClick={e => { e.stopPropagation(); void desmarcarNoTiene(f); }} title="Volver a pedir la factura"
              className="rounded-full p-0.5 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"><X className="h-3 w-3" /></button>
          </span>
        )}
        {faltaFactura(f) && <span className="whitespace-nowrap text-[11px] font-medium text-amber-600 dark:text-amber-400">⚠ Falta la factura</span>}
      </span>
    ) },
    { key: "acciones", label: "", sortable: false, render: f => (
      <span className="flex justify-end gap-1">
        <button onClick={e => { e.stopPropagation(); setCargarPara(objetivo(f)); }}
          title={f.facturas.length ? "Cargar otra factura para este artículo (y los tildados)" : tildados.size ? "Cargar la factura para este artículo y los tildados" : "Cargar la factura de este artículo (ya pagada con Visa)"}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700">
          {f.facturas.length ? <><Plus className="h-3.5 w-3.5" /> Otra</> : <><FileUp className="h-3.5 w-3.5" /> Cargar</>}
        </button>
        <button onClick={e => { e.stopPropagation(); setBuscaFc(""); setCandidatas(null); setElegirPara(objetivo(f)); }}
          title="La factura ya está cargada en el sistema: elegila (así no se carga dos veces)"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
          <ListChecks className="h-3.5 w-3.5" /> Elegir
        </button>
        {faltaFactura(f) && (
          <button onClick={e => { e.stopPropagation(); void marcarNoTiene(f); }} title="Este artículo no va a tener factura (ej. lo pagó alguien con su plata): deja de sumar en Falta la factura"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Ban className="h-3.5 w-3.5" /> No tiene
          </button>
        )}
      </span>
    ) },
  ];

  const botonVista = (v: typeof vista, texto: string) => (
    <button onClick={() => setVista(v)} className={`rounded-md px-3 py-1 text-sm font-medium ${vista === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{texto}</button>
  );

  return (
    <div className="space-y-2">
      <div className="flex w-fit gap-1 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
        {botonVista("articulos", "Por artículo")}
        {botonVista("visa", "Consumos de la Visa")}
      </div>
      {vista === "visa" && <ConsumosTarjeta sociedadId={sociedadId} modo="compras" articulos={articulosOc} onAbrirOc={setOcAbierta} />}
      {vista === "articulos" && <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar OC, PR, cliente, artículo o factura…"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-7 pr-7 text-sm focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          {busca && <button onClick={() => setBusca("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700" title="Borrar búsqueda"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <select value={periodo} onChange={e => setPeriodo(e.target.value as typeof periodo)} className={selectCls}>
          <option value="">Cualquier fecha</option>
          <option value="mes">Este mes</option>
          <option value="mes_pasado">Mes pasado</option>
        </select>
        <button onClick={() => setSoloFalta(v => !v)} className={`h-8 rounded-lg border px-2 text-sm ${soloFalta ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
          Falta la factura <span className="text-xs opacity-70">{resumen.sinFactura}</span>
        </button>
        <span className="text-xs text-zinc-500">
          {resumen.total} artículos · {resumen.sinFactura} sin factura
          {resumen.importeSinFactura > 0 && ` · ${formatCurrency(resumen.importeSinFactura, "ARS")}`}
          {resumen.importeSinFacturaUsd > 0 && ` · ${formatCurrency(resumen.importeSinFacturaUsd, "USD")}`}
        </span>
        {tildados.size > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
            {tildados.size} tildado{tildados.size === 1 ? "" : "s"} para la misma factura
            <button onClick={() => setTildados(new Set())} title="Destildar" className="rounded-full p-0.5 hover:bg-orange-200"><X className="h-3 w-3" /></button>
          </span>
        )}
        {tildadas.length > 0 && (
          <>
            <button onClick={() => setCargarPara(tildadas)} title="Una factura para todos los artículos tildados (pueden ser de varias OC)"
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-medium text-white hover:bg-emerald-700">
              <FileUp className="h-3.5 w-3.5" /> Cargar factura
            </button>
            <label title="Elegí varios PDF: se cargan de a uno y todos quedan unidos a los artículos tildados"
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-emerald-600 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
              <Files className="h-3.5 w-3.5" /> Varias facturas
              <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ""; empezarCola(fs); }} />
            </label>
            <button onClick={() => { setBuscaFc(""); setCandidatas(null); setElegirPara(tildadas); }} title="La factura ya está cargada: elegila para los tildados"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-zinc-300 px-2 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
              <ListChecks className="h-3.5 w-3.5" /> Elegir
            </button>
          </>
        )}
        <button onClick={() => void cargar()} className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700" title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

      <Card className="overflow-hidden p-0">
        <DataTable<Vista> data={visibles} loading={cargando && !filas.length} columns={columnas}
          emptyMessage={soloFalta ? "Todos los artículos de Mercado Libre tienen su factura." : "No hay compras de Mercado Libre con estos filtros."} />
      </Card>
      </>}

      {cargarPara && (
        <ComprasLazzaFactura sociedadId={sociedadId} conVisaInicial para={textoPara(cargarPara)}
          onGuardada={async id => { await unir(id, cargarPara); }}
          onClose={() => { setCargarPara(null); void cargar(); }} />
      )}

      {cola && (
        <ComprasLazzaFactura key={`${cola.total - cola.archivos.length}-${cola.archivos[0].name}`} sociedadId={sociedadId} conVisaInicial archivoInicial={cola.archivos[0]}
          para={`factura ${cola.total - cola.archivos.length + 1} de ${cola.total} · ${textoPara(cola.para)}`}
          onGuardada={async id => { colaGuardada.current = true; await unir(id, cola.para); }}
          onClose={siguienteDeCola} />
      )}

      {ocAbierta && <ComprasLazzaOc sociedadId={sociedadId} oc={ocAbierta} onClose={() => { setOcAbierta(null); void cargar(); }} />}

      <Modal open={!!elegirPara} onClose={() => { setElegirPara(null); setCandidatas(null); }} size="xl"
        title="Elegir una factura ya cargada"
        description={elegirPara ? `Para ${textoPara(elegirPara)} · ${formatCurrency(importeElegir, elegirPara[0]?.moneda ?? "ARS")} con IVA. Arriba, las de importe más parecido.` : ""}>
        <div className="space-y-2">
          <input value={buscaFc} onChange={e => setBuscaFc(e.target.value)} placeholder="Buscar por número, proveedor o importe…" autoFocus
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          {!candidatas && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las facturas…</p>}
          {candidatas && !listaElegir.length && <p className="text-sm text-zinc-500">No hay facturas con esa búsqueda.</p>}
          <div className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border dark:divide-zinc-800 dark:border-zinc-700">
            {listaElegir.map(f => (
              <div key={f.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm ${f.coincide ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                <span className="w-20 shrink-0 text-xs text-zinc-500">{f.fecha ? formatDate(f.fecha) : "—"}</span>
                <span className="min-w-0 flex-1 truncate" title={f.proveedor}>{f.proveedor || "—"}</span>
                <span className="shrink-0 font-mono text-xs">{f.tipo ? `${f.tipo} ` : ""}{f.archivoUrl
                  ? <a href={hrefArchivo(f.archivoUrl)} target="_blank" rel="noreferrer" className="text-orange-600 hover:underline">{f.numero}</a> : f.numero}</span>
                <span className="w-28 shrink-0 text-right font-mono text-xs">{formatCurrency(f.total, f.moneda)}</span>
                <span className={`w-24 shrink-0 text-right text-[11px] ${f.coincide ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-400"}`}>
                  {f.coincide ? "✔ mismo importe" : `${f.diferencia > 0 ? "+" : ""}${formatCurrency(f.diferencia, f.moneda)}`}
                </span>
                <button onClick={() => void elegir(f)} disabled={uniendo}
                  className="shrink-0 rounded-md bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50">Elegir</button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
