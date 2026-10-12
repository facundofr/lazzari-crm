"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, X, AlertTriangle, UserPlus, PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import CargarFacturaOC, { type OCParaVincular } from "@/components/cargar-factura-oc";
import ConciliacionCompras, { lineasParaCruce } from "@/components/conciliacion-compras";
import { cargarLineasOc, sugerirEquivalencias, contarSemaforo, type AnalisisIA } from "@/lib/conciliacion-compras-analisis";
import { matchPurchaseLines, citaOc } from "@/lib/purchase-matching";
import { formatCurrency } from "@/lib/utils";
import { canonicalPurchaseInvoiceNumber } from "@/lib/purchase-invoice-reconciliation";
import { canonicalCondicionIva } from "@/lib/fiscal-condition";

type Provider = { id: string; razon_social: string; cuit?: string | null };
type OC = { id: string; numero: string; proveedor_id: string; proveedor_nombre: string; moneda: string };
type RowState = "pending" | "parsing" | "ready" | "saved" | "error";
type QueueRow = { id: string; file: File; state: RowState; message?: string; data?: any; provider?: Provider; oc?: OC; duplicada?: boolean };
/** Resultado del cruce automático de un proveedor (todas sus facturas del lote juntas). */
type Cruce = { estado: "analizando" | "listo" | "sin_renglones" | "error"; verde?: number; amarillo?: number; rojo?: number; analisis?: AnalisisIA; mensaje?: string };
type NuevoProv = { rowId: string; cuit: string; razon_social: string; nombre_fantasia: string; condicion_iva: string; direccion: string; localidad: string; provincia: string; rubro: string };

const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function tipoLabel(file: File, data: any): string {
  const raw = String(data?.tipo_comprobante || "").toUpperCase().trim();
  const name = file.name.toUpperCase();
  if (/CR[EÉ]DITO|^N\.?\s?\/?\s?C\b|^NC/.test(raw) || /(^|[^A-Z])N[\s_.\-/]?C([^A-Z]|$)|NOTA[\s_\-]*DE[\s_\-]*CR/.test(name)) return "NC";
  if (/D[EÉ]BITO|^N\.?\s?\/?\s?D\b|^ND/.test(raw)) return "ND";
  if (/PEDIDO|PRESUPUESTO|PROFORMA/.test(raw)) return "Nota pedido";
  const letra = raw.match(/\b([ABCM])$/)?.[1];
  return letra ? `FC ${letra}` : "FC";
}

export default function CargaMasivaFacturasCompra({ sociedadId, profileId, proveedores, ordenes, onClose, onSuccess }: { sociedadId: string; profileId: string | null; proveedores: Provider[]; ordenes: OC[]; onClose: () => void; onSuccess: () => void }) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [provs, setProvs] = useState<Provider[]>(proveedores);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{ row: QueueRow; orders: OCParaVincular[] } | null>(null);
  const [enSecuencia, setEnSecuencia] = useState(false);
  const [nuevoProv, setNuevoProv] = useState<NuevoProv | null>(null);
  const [arcaLoading, setArcaLoading] = useState(false);
  const [arcaMsg, setArcaMsg] = useState("");
  const [provError, setProvError] = useState("");
  const parsingRef = useRef(false);
  const rowsRef = useRef<QueueRow[]>([]);
  rowsRef.current = rows;
  const dupCache = useRef<Record<string, string[]>>({});

  function findProvider(cuit: string, list = provs) {
    return cuit ? list.find(p => onlyDigits(p.cuit) === cuit) : undefined;
  }

  async function esDuplicada(providerId: string, numero: string) {
    if (!providerId || !numero || !sociedadId) return false;
    if (!dupCache.current[providerId]) {
      const nums: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await (supabase as any).from("facturas_compra").select("numero_factura")
          .eq("sociedad_id", sociedadId).eq("proveedor_id", providerId).order("id").range(offset, offset + 999);
        if (error) return false;
        nums.push(...(data || []).map((f: any) => canonicalPurchaseInvoiceNumber(f.numero_factura || "")));
        if ((data || []).length < 1000) break;
      }
      dupCache.current[providerId] = nums;
    }
    return dupCache.current[providerId].includes(canonicalPurchaseInvoiceNumber(numero));
  }

  function ocFor(provider: Provider | undefined, data: any) {
    const candidates = ordenes.filter(o => o.proveedor_id === provider?.id && o.moneda === (data?.moneda === "USD" ? "USD" : "ARS"));
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const files = Array.from(list).filter(f => /^(application\/pdf|image\/(png|jpe?g|webp))$/i.test(f.type));
    setRows(prev => [...prev, ...files.map(file => ({ id: `${Date.now()}-${Math.random()}`, file, state: "pending" as const }))]);
  }

  async function parseOne(row: QueueRow) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "parsing", message: undefined } : r));
    try {
      const body = new FormData(); body.append("file", row.file);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer el archivo");
      const data = { ...(json.data || {}), numero_factura: String(json.data?.numero_factura || "").trim() };
      const provider = findProvider(onlyDigits(data.proveedor?.cuit));
      const duplicada = provider ? await esDuplicada(provider.id, data.numero_factura) : false;
      // Además evitamos subir dos veces el mismo comprobante dentro del lote.
      // Si ese proveedor ya se había cruzado, se vuelve a cruzar con esta factura incluida.
      if (provider && cruceRef.current[provider.id]) setCruce(c => { const n = { ...c }; delete n[provider.id]; return n; });
      const repetidaEnLote = rowsRef.current.some(r => r.id !== row.id && r.data && onlyDigits(r.data.proveedor?.cuit) === onlyDigits(data.proveedor?.cuit) && canonicalPurchaseInvoiceNumber(r.data.numero_factura || "") === canonicalPurchaseInvoiceNumber(data.numero_factura));
      setRows(prev => prev.map(r => r.id === row.id ? {
        ...r, state: "ready", data, provider, oc: ocFor(provider, data), duplicada: duplicada || repetidaEnLote,
        message: duplicada ? "Ya está cargada en el sistema" : repetidaEnLote ? "Repetida en este lote" : provider ? undefined : "Proveedor no cargado",
      } : r));
    } catch (e) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "error", message: e instanceof Error ? e.message : "Error de lectura" } : r));
    }
  }

  // Lee automáticamente todo lo que se va agregando, de a uno para no saturar la IA.
  useEffect(() => {
    if (parsingRef.current) return;
    const next = rows.find(r => r.state === "pending");
    if (!next) return;
    parsingRef.current = true;
    void parseOne(next).finally(() => { parsingRef.current = false; setRows(prev => [...prev]); });
  }, [rows]);

  // ── Un solo circuito: si el proveedor tiene OC con renglones pendientes, la factura se concilia línea por línea
  //    (junto con las demás del mismo proveedor). Si no (OC viejas sin detalle, NC, gastos), va a la carga simple.
  const [conciliar, setConciliar] = useState<{ proveedorId: string; rows: QueueRow[]; auto?: boolean } | null>(null);
  const renglonesCache = useRef<Record<string, boolean>>({});
  async function proveedorTieneRenglonesOc(provId: string): Promise<boolean> {
    if (provId in renglonesCache.current) return renglonesCache.current[provId];
    let tiene = false;
    try {
      const { data: ocs } = await (supabase as any).from("ordenes_compra").select("id, saldo_cerrado")
        .eq("sociedad_id", sociedadId).eq("proveedor_id", provId).neq("estado", "cancelada");
      const ids = (ocs || []).filter((o: any) => !o.saldo_cerrado).map((o: any) => o.id);
      if (ids.length) {
        const { data } = await (supabase as any).from("orden_compra_items_pendientes").select("id").in("orden_id", ids).gt("cantidad_pendiente", 0).limit(1);
        tiene = !!data?.length;
      }
    } catch { tiene = false; }
    renglonesCache.current[provId] = tiene;
    return tiene;
  }
  const esNotaODebito = (row: QueueRow) => /^(NC|ND)/.test(tipoLabel(row.file, row.data || {}));

  async function openReview(row: QueueRow, forzarSimple = false) {
    setSaving(true);
    try {
      if (!sociedadId) throw new Error("Seleccioná una sociedad");
      if (!forzarSimple && row.provider && row.state === "ready" && !esNotaODebito(row) && await proveedorTieneRenglonesOc(row.provider.id)) {
        const grupo = rowsRef.current.filter(r => r.state === "ready" && r.provider?.id === row.provider!.id && !r.duplicada && !esNotaODebito(r));
        setConciliar({ proveedorId: row.provider.id, rows: grupo.length ? grupo : [row] });
        return;
      }
      const { data, error } = await (supabase as any).from("ordenes_compra")
        .select("id, numero, proveedor_id, total, moneda, estado, fecha, proveedores(razon_social)")
        .eq("sociedad_id", sociedadId).in("estado", ["pendiente", "enviada", "confirmada", "recibida_parcial", "recibida"]);
      if (error) throw error;
      setReview({ row, orders: (data || []).map((o: any) => ({ ...o, proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor" })) });
    } catch (e) { alert(e instanceof Error ? e.message : "No se pudieron cargar las OC"); setEnSecuencia(false); }
    finally { setSaving(false); }
  }

  // ── Cruce automático: cuando terminan de leerse, se cruzan todas las facturas de cada proveedor contra sus OC ──
  const [cruce, setCruce] = useState<Record<string, Cruce>>({});
  const cruceRef = useRef<Record<string, Cruce>>({});
  cruceRef.current = cruce;
  const cruzandoRef = useRef(false);
  const filasDe = (provId: string) => rowsRef.current.filter(r => r.state === "ready" && r.provider?.id === provId && !r.duplicada && !esNotaODebito(r));

  async function cruzarProveedor(provId: string) {
    setCruce(c => ({ ...c, [provId]: { estado: "analizando" } }));
    try {
      if (!await proveedorTieneRenglonesOc(provId)) { setCruce(c => ({ ...c, [provId]: { estado: "sin_renglones" } })); return; }
      const filas = filasDe(provId);
      const { data: prov } = await (supabase as any).from("proveedores").select("razon_social, talles_especiales, tolerancia_precio_pct").eq("id", provId).single();
      const facturas = filas.map(r => lineasParaCruce(r.file, r.data || {}));
      const lineas = facturas.flatMap(f => f.lineas);
      const { lineas: ocLineas, legacy } = await cargarLineasOc(supabase, sociedadId, provId);
      const usables = ocLineas.filter(l => !legacy.has(l.ocId));
      if (!lineas.length || !usables.length) { setCruce(c => ({ ...c, [provId]: { estado: "sin_renglones" } })); return; }
      const ocPreferidas: Record<string, string[]> = {};
      for (const f of facturas) {
        const ids = [...new Set(usables.filter(o => f.ocRefs.some(r => citaOc(r, o.ocNumero))).map(o => o.ocId))];
        if (ids.length) ocPreferidas[f.facturaRef] = ids;
      }
      const opciones = { tallesEspeciales: prov?.talles_especiales || [], toleranciaPct: Number(prov?.tolerancia_precio_pct ?? 0) || 0, ocPreferidas };
      const analisis = await sugerirEquivalencias(supabase, { sociedadId, proveedorId: provId, proveedorNombre: prov?.razon_social || "", lineasFactura: lineas, ocs: usables, manual: {}, opciones });
      const r = matchPurchaseLines(lineas, usables, analisis.equivalencias, {}, opciones);
      const c = contarSemaforo(lineas, r, { manual: {}, confianza: analisis.confianza });
      setCruce(x => ({ ...x, [provId]: { estado: "listo", verde: c.verde, amarillo: c.amarillo, rojo: c.rojo, analisis } }));
    } catch (e) {
      setCruce(x => ({ ...x, [provId]: { estado: "error", mensaje: e instanceof Error ? e.message : "No se pudo cruzar" } }));
    }
  }

  // De a un proveedor por vez, y solo cuando no queda nada leyéndose.
  useEffect(() => {
    if (cruzandoRef.current || rows.some(r => r.state === "pending" || r.state === "parsing")) return;
    const prov = rows.find(r => r.state === "ready" && r.provider && !r.duplicada && !esNotaODebito(r) && !cruceRef.current[r.provider.id])?.provider;
    if (!prov) return;
    cruzandoRef.current = true;
    void cruzarProveedor(prov.id).finally(() => { cruzandoRef.current = false; setRows(prev => [...prev]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const provsQueCierran = () => Object.entries(cruceRef.current)
    .filter(([id, c]) => c.estado === "listo" && !c.amarillo && !c.rojo && filasDe(id).length > 0).map(([id]) => id);
  function confirmarLasQueCierran(excluir?: string) {
    const id = provsQueCierran().find(x => x !== excluir);
    if (!id) { setEnSecuencia(false); return; }
    setEnSecuencia(true);
    setConciliar({ proveedorId: id, rows: filasDe(id), auto: true });
  }

  function siguienteParaRevisar(excluir?: string) {
    return rowsRef.current.find(r => r.id !== excluir && r.state === "ready" && r.provider && !r.duplicada);
  }

  function revisarTodas() {
    const next = siguienteParaRevisar();
    if (!next) { alert("No hay facturas listas para cargar. Revisá las que dicen “Proveedor no cargado” o “Ya está cargada”."); return; }
    setEnSecuencia(true);
    void openReview(next);
  }

  async function abrirNuevoProv(row: QueueRow) {
    const cuit = onlyDigits(row.data?.proveedor?.cuit);
    const base: NuevoProv = { rowId: row.id, cuit, razon_social: String(row.data?.proveedor?.razon_social || "").trim(), nombre_fantasia: String(row.data?.proveedor?.nombre_fantasia || "").trim(), condicion_iva: "RI", direccion: "", localidad: "", provincia: "", rubro: "" };
    setNuevoProv(base); setProvError(""); setArcaMsg("");
    if (cuit.length !== 11) return;
    setArcaLoading(true);
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${cuit}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { setArcaMsg("ARCA no respondió: completá o corregí a mano."); return; }
      setNuevoProv(p => p && p.rowId === row.id ? {
        ...p,
        razon_social: d.razon_social || p.razon_social,
        condicion_iva: canonicalCondicionIva(d.condicion_iva) || p.condicion_iva,
        direccion: d.direccion || "", localidad: d.localidad || "", provincia: d.provincia || "",
      } : p);
      setArcaMsg("Datos traídos de ARCA. Revisá y confirmá.");
    } catch { setArcaMsg("ARCA no respondió: completá o corregí a mano."); }
    finally { setArcaLoading(false); }
  }

  async function guardarNuevoProv() {
    if (!nuevoProv) return;
    if (!sociedadId) { setProvError("Seleccioná una sociedad"); return; }
    if (!nuevoProv.razon_social.trim()) { setProvError("Falta la razón social"); return; }
    const cuit = onlyDigits(nuevoProv.cuit);
    const existente = findProvider(cuit);
    setSaving(true); setProvError("");
    try {
      let provider = existente;
      if (!provider) {
        const insertData: Record<string, unknown> = {
          sociedad_id: sociedadId, activo: true,
          razon_social: nuevoProv.razon_social.trim(),
          condicion_iva: canonicalCondicionIva(nuevoProv.condicion_iva) || "RI",
          rubro: nuevoProv.rubro.trim() || "General",
          direccion: nuevoProv.direccion.trim(), localidad: nuevoProv.localidad.trim(), provincia: nuevoProv.provincia.trim(),
        };
        if (cuit) { insertData.cuit = cuit; insertData.cuit_titular_cuenta = cuit; }
        if (nuevoProv.nombre_fantasia.trim()) insertData.nombre_fantasia = nuevoProv.nombre_fantasia.trim();
        const { data, error } = await (supabase as any).from("proveedores").insert(insertData).select("id, razon_social, cuit").single();
        if (error) throw error;
        provider = data as Provider;
      }
      const nuevos = [...provs, provider!];
      setProvs(nuevos);
      // Asigna el proveedor a todas las facturas del lote con ese mismo CUIT.
      const afectadas = rowsRef.current.filter(r => r.state === "ready" && !r.provider && (r.id === nuevoProv.rowId || (cuit && onlyDigits(r.data?.proveedor?.cuit) === cuit)));
      const updates: Record<string, Partial<QueueRow>> = {};
      for (const r of afectadas) {
        const dup = await esDuplicada(provider!.id, r.data?.numero_factura || "");
        updates[r.id] = { provider: provider!, oc: ocFor(provider, r.data), duplicada: dup, message: dup ? "Ya está cargada en el sistema" : undefined };
      }
      setRows(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
      setNuevoProv(null);
    } catch (e: any) {
      setProvError(e?.message || "No se pudo crear el proveedor");
    } finally { setSaving(false); }
  }

  const busy = saving || rows.some(r => r.state === "parsing");
  const close = () => rows.some(r => r.state === "saved") ? onSuccess() : onClose();
  const listas = rows.filter(r => r.state === "ready" && r.provider && !r.duplicada).length;
  const guardadas = rows.filter(r => r.state === "saved").length;
  const leyendo = rows.filter(r => r.state === "pending" || r.state === "parsing").length;

  if (conciliar) return <ConciliacionCompras sociedadId={sociedadId} profileId={profileId}
    inicial={{ proveedorId: conciliar.proveedorId, facturas: conciliar.rows.map(r => ({ file: r.file, data: r.data || {} })), analisis: cruce[conciliar.proveedorId]?.analisis }}
    autoConfirmar={conciliar.auto}
    onClose={() => { setConciliar(null); setEnSecuencia(false); }}
    onSuccess={(guardadas) => {
      const nums = new Set((guardadas || []).map(n => canonicalPurchaseInvoiceNumber(n)));
      const ids = new Set(conciliar.rows.filter(r => !guardadas || nums.has(canonicalPurchaseInvoiceNumber(r.data?.numero_factura || ""))).map(r => r.id));
      setRows(prev => prev.map(r => ids.has(r.id) ? { ...r, state: "saved" } : r));
      delete dupCache.current[conciliar.proveedorId];
      delete renglonesCache.current[conciliar.proveedorId];
      const eraAuto = conciliar.auto, provHecho = conciliar.proveedorId;
      setConciliar(null);
      if (eraAuto) { rowsRef.current = rowsRef.current.map(r => ids.has(r.id) ? { ...r, state: "saved" as const } : r); confirmarLasQueCierran(provHecho); return; }
      if (enSecuencia) {
        const next = rowsRef.current.find(r => !ids.has(r.id) && r.state === "ready" && r.provider && !r.duplicada);
        if (next) void openReview(next); else setEnSecuencia(false);
      }
    }} />;

  if (review) return <CargarFacturaOC key={review.row.id} sociedadId={sociedadId} profileId={profileId}
    ordenes={review.orders} initialImport={{ data: review.row.data || {}, file: review.row.file }}
    preselectedOCId={review.orders.some(o => o.id === review.row.oc?.id) ? review.row.oc?.id : undefined}
    onClose={() => { setReview(null); setEnSecuencia(false); }}
    onSuccess={() => {
      const doneId = review.row.id;
      setRows(prev => prev.map(r => r.id === doneId ? { ...r, state: "saved" } : r));
      if (review.row.provider) delete dupCache.current[review.row.provider.id];
      setReview(null);
      if (enSecuencia) {
        const next = siguienteParaRevisar(doneId);
        if (next) void openReview(next); else setEnSecuencia(false);
      }
    }} />;

  const input = "w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-5xl rounded-xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold dark:text-white">Carga masiva de facturas de proveedores</h2>
          <p className="text-xs text-zinc-500">Subí todas juntas, de uno o de varios proveedores (facturas, NC y ND). La IA las lee solas. Si un proveedor no existe, lo creás desde acá con los datos de la factura y ARCA.</p>
        </div>
        <button disabled={busy} onClick={close}><X className="h-5 w-5 text-zinc-400" /></button>
      </div>

      <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-5 text-sm text-zinc-500 hover:border-orange-400">
        <FileUp className="h-5 w-5" /> Elegir o arrastrar varios PDF o imágenes
        <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
      </label>

      {rows.length > 0 && <div className="mb-2 flex flex-wrap gap-3 text-xs text-zinc-500">
        <span>{rows.length} archivos</span>
        {leyendo > 0 && <span className="text-orange-600">Leyendo {leyendo}…</span>}
        <span className="text-emerald-600">{listas} listas para cargar</span>
        {guardadas > 0 && <span className="text-sky-600">{guardadas} guardadas</span>}
      </div>}

      <div className="max-h-[52vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr><th className="px-2 py-2">Archivo</th><th className="px-2">Tipo</th><th className="px-2">Número</th><th className="px-2">Fecha</th><th className="px-2">Proveedor</th><th className="px-2 text-right">Total</th><th className="px-2">Estado</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = row.data || {};
              const sinProv = row.state === "ready" && !row.provider;
              return <tr key={row.id} className={`${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200`}>
                <td className="max-w-[180px] truncate px-2 py-2" title={row.file.name}>{row.file.name}</td>
                <td className="px-2">{row.data ? tipoLabel(row.file, d) : ""}</td>
                <td className="px-2 whitespace-nowrap">{d.numero_factura || ""}</td>
                <td className="px-2 whitespace-nowrap">{d.fecha || ""}</td>
                <td className="max-w-[200px] px-2">{row.provider ? <span className="truncate">{row.provider.razon_social}</span> : row.data ? <span className="text-amber-700 dark:text-amber-400">{d.proveedor?.razon_social || "?"} {d.proveedor?.cuit ? `(${d.proveedor.cuit})` : ""}</span> : ""}</td>
                <td className="px-2 text-right whitespace-nowrap">{row.data ? formatCurrency(Number(d.total || 0), d.moneda === "USD" ? "USD" : "ARS") : ""}</td>
                <td className="px-2 whitespace-nowrap">
                  {row.state === "pending" && <span className="text-zinc-400">En cola</span>}
                  {row.state === "parsing" && <span className="flex items-center gap-1 text-orange-600"><Loader2 className="h-3 w-3 animate-spin" /> Leyendo</span>}
                  {row.state === "saved" && <span className="flex items-center gap-1 text-sky-600"><CheckCircle2 className="h-3 w-3" /> Guardada</span>}
                  {row.state === "error" && <span className="flex items-center gap-1 text-red-600" title={row.message}><AlertTriangle className="h-3 w-3" /> No se pudo leer</span>}
                  {row.state === "ready" && (row.duplicada ? <span className="flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3" /> {row.message}</span>
                    : sinProv ? <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" /> Proveedor no cargado</span>
                    : (() => {
                      const c = row.provider && !esNotaODebito(row) ? cruce[row.provider.id] : undefined;
                      if (c?.estado === "analizando") return <span className="flex items-center gap-1 text-orange-600"><Loader2 className="h-3 w-3 animate-spin" /> Cruzando con OC</span>;
                      if (c?.estado === "listo") return (c.amarillo || c.rojo)
                        ? <span className="flex items-center gap-1 text-amber-600" title="Del proveedor (todas sus facturas del lote)"><AlertTriangle className="h-3 w-3" /> {(c.amarillo || 0) + (c.rojo || 0)} renglón(es) para revisar</span>
                        : <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Cierra con las OC</span>;
                      if (c?.estado === "error") return <span className="flex items-center gap-1 text-red-600" title={c.mensaje}><AlertTriangle className="h-3 w-3" /> No se pudo cruzar</span>;
                      return <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Lista{row.oc ? ` · ${row.oc.numero}` : ""}{c?.estado === "sin_renglones" ? " · carga simple" : ""}</span>;
                    })())}
                </td>
                <td className="px-2 whitespace-nowrap text-right">
                  {sinProv && <button disabled={saving} onClick={() => abrirNuevoProv(row)} className="mr-1 inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-white"><UserPlus className="h-3 w-3" /> Crear proveedor</button>}
                  {row.state === "ready" && <button disabled={saving} onClick={() => openReview(row)} className="rounded bg-orange-500 px-2 py-1 text-white" title="Si el proveedor tiene OC con renglones, se concilia línea por línea">{row.duplicada ? "Ver igual" : "Revisar"}</button>}
                  {row.state === "ready" && row.provider && !row.duplicada && <button disabled={saving} onClick={() => openReview(row, true)} className="ml-1 text-[10px] text-zinc-500 underline hover:text-orange-600" title="Cargar sin conciliar por renglón (vinculando la OC por importe)">simple</button>}
                  {row.state === "error" && <><button disabled={busy} onClick={() => setRows(prev => prev.map(r => r.id === row.id ? { ...r, state: "pending" } : r))} className="mr-1 rounded border px-2 py-1">Reintentar</button><button disabled={busy} onClick={() => openReview(row)} className="rounded border px-2 py-1">Cargar a mano</button></>}
                  {row.state !== "parsing" && row.state !== "saved" && <button disabled={busy} onClick={() => setRows(prev => prev.filter(r => r.id !== row.id))} className="ml-1 text-zinc-400 hover:text-red-500" title="Quitar"><X className="inline h-3.5 w-3.5" /></button>}
                </td>
              </tr>;
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-zinc-400">Todavía no subiste archivos.</td></tr>}
          </tbody>
        </table>
      </div>

      {Object.values(cruce).some(c => c.estado === "listo") && (() => {
        const cierran = Object.entries(cruce).filter(([id, c]) => c.estado === "listo" && !c.amarillo && !c.rojo && filasDe(id).length > 0);
        const revisar = Object.entries(cruce).filter(([id, c]) => c.estado === "listo" && ((c.amarillo || 0) + (c.rojo || 0)) > 0 && filasDe(id).length > 0);
        const nombre = (id: string) => provs.find(p => p.id === id)?.razon_social || "Proveedor";
        return <div className="mt-3 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-700 dark:text-zinc-200">
          <p className="mb-1 font-semibold">Cruce automático con las OC</p>
          {cierran.map(([id]) => <p key={id} className="text-emerald-700 dark:text-emerald-400">✔ {nombre(id)}: {filasDe(id).length} factura(s), cierran todas</p>)}
          {revisar.map(([id, c]) => <p key={id} className="text-amber-700 dark:text-amber-400">⚠ {nombre(id)}: {filasDe(id).length} factura(s), {(c.amarillo || 0) + (c.rojo || 0)} renglón(es) para revisar{" "}
            <button disabled={saving} onClick={() => { const r = filasDe(id)[0]; if (r) void openReview(r); }} className="underline">Revisar</button></p>)}
          {cierran.length > 0 && <button disabled={saving || busy} onClick={() => confirmarLasQueCierran()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Confirmar las que cierran ({cierran.reduce((t, [id]) => t + filasDe(id).length, 0)} facturas)</button>}
        </div>;
      })()}

      {nuevoProv && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Nuevo proveedor {arcaLoading && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" />}</p>
          <button onClick={() => setNuevoProv(null)}><X className="h-4 w-4 text-zinc-400" /></button>
        </div>
        {arcaMsg && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{arcaMsg}</p>}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="col-span-2"><label className="text-[11px] text-zinc-500">Razón social</label><input className={input} value={nuevoProv.razon_social} onChange={e => setNuevoProv({ ...nuevoProv, razon_social: e.target.value })} /></div>
          <div><label className="text-[11px] text-zinc-500">CUIT</label><input className={input} value={nuevoProv.cuit} onChange={e => setNuevoProv({ ...nuevoProv, cuit: e.target.value })} /></div>
          <div><label className="text-[11px] text-zinc-500">Condición IVA</label><select className={input} value={nuevoProv.condicion_iva} onChange={e => setNuevoProv({ ...nuevoProv, condicion_iva: e.target.value })}><option value="RI">Resp. Inscripto</option><option value="Monotributo">Monotributo</option><option value="Exento">Exento</option><option value="CF">Consumidor final</option></select></div>
          <div className="col-span-2"><label className="text-[11px] text-zinc-500">Nombre de fantasía (opcional)</label><input className={input} value={nuevoProv.nombre_fantasia} onChange={e => setNuevoProv({ ...nuevoProv, nombre_fantasia: e.target.value })} /></div>
          <div className="col-span-2"><label className="text-[11px] text-zinc-500">Rubro (opcional)</label><input className={input} value={nuevoProv.rubro} onChange={e => setNuevoProv({ ...nuevoProv, rubro: e.target.value })} /></div>
          <div className="col-span-2"><label className="text-[11px] text-zinc-500">Dirección</label><input className={input} value={nuevoProv.direccion} onChange={e => setNuevoProv({ ...nuevoProv, direccion: e.target.value })} /></div>
          <div><label className="text-[11px] text-zinc-500">Localidad</label><input className={input} value={nuevoProv.localidad} onChange={e => setNuevoProv({ ...nuevoProv, localidad: e.target.value })} /></div>
          <div><label className="text-[11px] text-zinc-500">Provincia</label><input className={input} value={nuevoProv.provincia} onChange={e => setNuevoProv({ ...nuevoProv, provincia: e.target.value })} /></div>
        </div>
        {provError && <p className="mt-2 text-xs text-red-600">{provError}</p>}
        <p className="mt-2 text-[11px] text-zinc-500">Los datos bancarios los completás después en Proveedores.</p>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setNuevoProv(null)} className="rounded-lg border px-3 py-1.5 text-sm">Cancelar</button>
          <button disabled={saving || arcaLoading} onClick={guardarNuevoProv} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{saving ? "Guardando…" : "Crear proveedor"}</button>
        </div>
      </div>}

      <div className="mt-5 flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">Al terminar de leer, se cruzan solas contra las OC. Las que cierran se confirman con un botón; las demás se abren mostrando solo lo que no cierra.</p>
        <div className="flex gap-2">
          <button disabled={busy} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cerrar</button>
          <button disabled={saving || listas === 0} onClick={revisarTodas} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><PlayCircle className="h-4 w-4" /> Cargar las {listas} listas</button>
        </div>
      </div>
    </div>
  </div>;
}
