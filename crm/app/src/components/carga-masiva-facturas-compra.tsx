"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2, X, AlertTriangle, UserPlus, PlayCircle, Minimize2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import CargarFacturaOC, { type OCParaVincular } from "@/components/cargar-factura-oc";
import ConciliacionCompras, { lineasParaCruce } from "@/components/conciliacion-compras";
import { cargarLineasOc, sugerirEquivalencias, contarSemaforo, type AnalisisIA } from "@/lib/conciliacion-compras-analisis";
import { matchPurchaseLines, citaOc } from "@/lib/purchase-matching";
import { formatCurrency } from "@/lib/utils";
import { traerTodo } from "@/lib/paginar";
import { canonicalPurchaseInvoiceNumber } from "@/lib/purchase-invoice-reconciliation";
import { ProveedorFormModal, type ProveedorForm } from "@/components/proveedor-form-modal";

type Provider = { id: string; razon_social: string; cuit?: string | null };
type OC = { id: string; numero: string; proveedor_id: string; proveedor_nombre: string; moneda: string };
type RowState = "pending" | "parsing" | "ready" | "saved" | "error";
type QueueRow = { id: string; file: File; state: RowState; message?: string; data?: any; provider?: Provider; oc?: OC; duplicada?: boolean };
/** Resultado del cruce automático de un proveedor (todas sus facturas del lote juntas). */
type Cruce = { estado: "analizando" | "listo" | "sin_renglones" | "error"; verde?: number; amarillo?: number; rojo?: number; analisis?: AnalisisIA; mensaje?: string };
type NuevoProv = { rowId: string; cuit: string; inicial: Partial<ProveedorForm> };

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

/**
 * Carga masiva de facturas de compra. Si no recibe proveedores/OC los trae sola.
 * Con `oculta` sigue leyendo y cruzando en segundo plano y solo muestra un aviso abajo a la derecha.
 */
export default function CargaMasivaFacturasCompra({ sociedadId, sociedadNombre, profileId, proveedores, ordenes: ordenesProp, oculta, onMinimizar, onAbrir, onGuardada, onClose, onSuccess }: {
  sociedadId: string; sociedadNombre?: string; profileId: string | null; proveedores?: Provider[]; ordenes?: OC[];
  oculta?: boolean; onMinimizar?: () => void; onAbrir?: () => void; onGuardada?: () => void;
  onClose: () => void; onSuccess: () => void;
}) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [provs, setProvs] = useState<Provider[]>(proveedores || []);
  const [ordenes, setOrdenes] = useState<OC[]>(ordenesProp || []);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<{ row: QueueRow; orders: OCParaVincular[]; ncSugerida?: { asociadas: string[]; deLaTanda: string[] } } | null>(null);

  // Abierta desde cualquier pantalla: trae proveedores y OC de la sociedad.
  useEffect(() => {
    if ((proveedores && ordenesProp) || !sociedadId) return;
    let cancelado = false;
    (async () => {
      const db = supabase as any;
      const [ps, os] = await Promise.all([
        proveedores ? Promise.resolve(proveedores) : traerTodo<Provider>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
        ordenesProp ? Promise.resolve(ordenesProp) : traerTodo<any>(() => db.from("ordenes_compra").select("id, numero, proveedor_id, moneda, estado, proveedores(razon_social)")
          .eq("sociedad_id", sociedadId).neq("estado", "cancelada").not("proveedor_id", "is", null).order("id")),
      ]).catch(() => [[], []] as [Provider[], any[]]);
      if (cancelado) return;
      setProvs(prev => [...ps, ...prev.filter(p => !ps.some(x => x.id === p.id))]);
      setOrdenes(os.map((o: any) => ({ id: o.id, numero: o.numero, proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedor_nombre || o.proveedores?.razon_social || "Sin proveedor", moneda: o.moneda })));
      // Las que se leyeron antes de tener la lista de proveedores, se asignan ahora.
      setRows(prev => prev.map(r => r.state === "ready" && !r.provider && r.data ? (() => {
        const provider = ps.find(p => onlyDigits(p.cuit) === onlyDigits(r.data?.proveedor?.cuit) && onlyDigits(p.cuit));
        return provider ? { ...r, provider, message: undefined } : r;
      })() : r));
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sociedadId]);
  const [enSecuencia, setEnSecuencia] = useState(false);
  const [nuevoProv, setNuevoProv] = useState<NuevoProv | null>(null);
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
      const ncSugerida = esNotaODebito(row) && row.provider ? {
        asociadas: Array.isArray(row.data?.comprobantes_asociados) ? row.data.comprobantes_asociados.map(String) : [],
        deLaTanda: rowsRef.current.filter(r => r.state === "saved" && r.provider?.id === row.provider!.id && !esNotaODebito(r)).map(r => String(r.data?.numero_factura || "")),
      } : undefined;
      const { data, error } = await (supabase as any).from("ordenes_compra")
        .select("id, numero, proveedor_id, total, moneda, estado, fecha, proveedores(razon_social)")
        .eq("sociedad_id", sociedadId).in("estado", ["borrador", "enviada", "confirmada", "recibida_parcial", "recibida"]);
      if (error) throw error;
      setReview({ row, ncSugerida, orders: (data || []).map((o: any) => ({ ...o, proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor" })) });
    } catch (e) { alert(e instanceof Error ? e.message : `No se pudieron cargar las OC${(e as any)?.message ? `: ${(e as any).message}` : ""}`); setEnSecuencia(false); }
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

  // Primero las facturas y después las NC/ND: así la NC se puede aplicar a la factura que se acaba de guardar.
  function siguienteParaRevisar(excluir?: string) {
    const listas = rowsRef.current.filter(r => r.id !== excluir && r.state === "ready" && r.provider && !r.duplicada);
    return listas.find(r => !esNotaODebito(r)) || listas[0];
  }

  function revisarTodas() {
    const next = siguienteParaRevisar();
    if (!next) { alert("No hay facturas listas para cargar. Revisá las que dicen “Proveedor no cargado” o “Ya está cargada”."); return; }
    setEnSecuencia(true);
    void openReview(next);
  }

  // "Crear proveedor": abre el MISMO formulario completo que Proveedores (con los datos de ARCA si la factura trae CUIT).
  function abrirNuevoProv(row: QueueRow) {
    const cuit = onlyDigits(row.data?.proveedor?.cuit);
    const existente = findProvider(cuit);
    if (existente) { void asignarProveedor(existente, row.id, cuit); return; }
    setNuevoProv({ rowId: row.id, cuit, inicial: {
      cuit,
      razon_social: String(row.data?.proveedor?.razon_social || "").trim(),
      nombre_fantasia: String(row.data?.proveedor?.nombre_fantasia || "").trim(),
    } });
  }

  // Asigna el proveedor a todas las facturas del lote con ese mismo CUIT.
  async function asignarProveedor(provider: Provider, rowId: string, cuit: string) {
    setSaving(true);
    try {
      setProvs(prev => prev.some(p => p.id === provider.id) ? prev : [...prev, provider]);
      const afectadas = rowsRef.current.filter(r => r.state === "ready" && !r.provider && (r.id === rowId || (cuit && onlyDigits(r.data?.proveedor?.cuit) === cuit)));
      const updates: Record<string, Partial<QueueRow>> = {};
      for (const r of afectadas) {
        const dup = await esDuplicada(provider.id, r.data?.numero_factura || "");
        updates[r.id] = { provider, oc: ocFor(provider, r.data), duplicada: dup, message: dup ? "Ya está cargada en el sistema" : undefined };
      }
      setRows(prev => prev.map(r => updates[r.id] ? { ...r, ...updates[r.id] } : r));
    } finally { setSaving(false); }
  }

  const busy = saving || rows.some(r => r.state === "parsing");
  const close = () => {
    const sinCargar = rows.filter(r => r.state === "pending" || r.state === "parsing" || (r.state === "ready" && !r.duplicada)).length;
    if (sinCargar && !confirm(`Quedan ${sinCargar} factura(s) sin cargar. Si cerrás se pierden (con "Segundo plano" siguen acá). ¿Cerrar igual?`)) return;
    if (rows.some(r => r.state === "saved")) onSuccess(); else onClose();
  };
  const listas = rows.filter(r => r.state === "ready" && r.provider && !r.duplicada).length;
  const guardadas = rows.filter(r => r.state === "saved").length;
  const leyendo = rows.filter(r => r.state === "pending" || r.state === "parsing").length;

  if (oculta) {
    const revisar = Object.values(cruce).filter(c => c.estado === "listo" && ((c.amarillo || 0) + (c.rojo || 0)) > 0).length;
    const termino = rows.length > 0 && leyendo === 0 && !Object.values(cruce).some(c => c.estado === "analizando");
    return <button onClick={onAbrir} title="Abrir la carga de facturas"
      className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg ${termino ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-orange-300 bg-white text-zinc-700 dark:border-orange-800 dark:bg-zinc-900 dark:text-zinc-200"}`}>
      {termino ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" />}
      Facturas{sociedadNombre ? ` · ${sociedadNombre}` : ""}:
      {leyendo > 0 && <span className="text-orange-600">leyendo {leyendo}</span>}
      <span className="text-emerald-700 dark:text-emerald-400">{listas} listas</span>
      {revisar > 0 && <span className="text-amber-600">{revisar} prov. para revisar</span>}
      {guardadas > 0 && <span className="text-sky-600">{guardadas} guardadas</span>}
      <span className="rounded-full bg-orange-500 px-2 py-0.5 text-white">Abrir</span>
    </button>;
  }

  if (conciliar) return <ConciliacionCompras sociedadId={sociedadId} profileId={profileId}
    inicial={{ proveedorId: conciliar.proveedorId, facturas: conciliar.rows.map(r => ({ file: r.file, data: r.data || {} })), analisis: cruce[conciliar.proveedorId]?.analisis }}
    autoConfirmar={conciliar.auto}
    onClose={() => { setConciliar(null); setEnSecuencia(false); }}
    onSuccess={(guardadas) => {
      const nums = new Set((guardadas || []).map(n => canonicalPurchaseInvoiceNumber(n)));
      const ids = new Set(conciliar.rows.filter(r => !guardadas || nums.has(canonicalPurchaseInvoiceNumber(r.data?.numero_factura || ""))).map(r => r.id));
      setRows(prev => prev.map(r => ids.has(r.id) ? { ...r, state: "saved" } : r));
      rowsRef.current = rowsRef.current.map(r => ids.has(r.id) ? { ...r, state: "saved" as const } : r);
      onGuardada?.();
      delete dupCache.current[conciliar.proveedorId];
      delete renglonesCache.current[conciliar.proveedorId];
      const eraAuto = conciliar.auto, provHecho = conciliar.proveedorId;
      setConciliar(null);
      if (eraAuto) { confirmarLasQueCierran(provHecho); return; }
      if (enSecuencia) {
        const next = siguienteParaRevisar();
        if (next) void openReview(next); else setEnSecuencia(false);
      }
    }} />;

  if (review) return <CargarFacturaOC key={review.row.id} sociedadId={sociedadId} profileId={profileId}
    ordenes={review.orders} initialImport={{ data: review.row.data || {}, file: review.row.file }} ncSugerida={review.ncSugerida}
    preselectedOCId={review.orders.some(o => o.id === review.row.oc?.id) ? review.row.oc?.id : undefined}
    onClose={() => { setReview(null); setEnSecuencia(false); }}
    onSuccess={() => {
      const doneId = review.row.id;
      setRows(prev => prev.map(r => r.id === doneId ? { ...r, state: "saved" } : r));
      rowsRef.current = rowsRef.current.map(r => r.id === doneId ? { ...r, state: "saved" as const } : r);
      onGuardada?.();
      if (review.row.provider) delete dupCache.current[review.row.provider.id];
      setReview(null);
      if (enSecuencia) {
        const next = siguienteParaRevisar(doneId);
        if (next) void openReview(next); else setEnSecuencia(false);
      }
    }} />;


  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-6xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold dark:text-white">Carga masiva de facturas de proveedores</h2>
          <p className="text-xs text-zinc-500">Subí todas juntas, de uno o varios proveedores (FC, NC y ND). La IA las lee y las cruza con las OC; las NC se aplican a la factura de la tanda. Podés dejarla en segundo plano.</p>
        </div>
        <div className="flex items-center gap-1">
          {onMinimizar && <button onClick={onMinimizar} title="Seguir en segundo plano: podés usar el sistema mientras la IA lee y cruza" className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Minimize2 className="h-5 w-5 text-zinc-400" /></button>}
          <button disabled={busy && !onMinimizar} onClick={close} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5 text-zinc-400" /></button>
        </div>
      </div>

      <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-3 text-sm text-zinc-500 hover:border-orange-400">
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
        <table className="w-full table-fixed text-xs">
          <colgroup><col style={{ width: "15%" }} /><col style={{ width: "6%" }} /><col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "21%" }} /><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /><col style={{ width: "12%" }} /></colgroup>
          <thead className="sticky top-0 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <tr><th className="px-2 py-2">Archivo</th><th className="px-2">Tipo</th><th className="px-2">Número</th><th className="px-2">Fecha</th><th className="px-2">Proveedor</th><th className="px-2 text-right">Total</th><th className="px-2">Estado</th><th className="px-2"></th></tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = row.data || {};
              const sinProv = row.state === "ready" && !row.provider;
              return <tr key={row.id} className={`${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200`}>
                <td className="truncate px-2 py-2" title={row.file.name}>{row.file.name}</td>
                <td className="px-2">{row.data ? tipoLabel(row.file, d) : ""}</td>
                <td className="px-2 whitespace-nowrap">{d.numero_factura || ""}</td>
                <td className="px-2 whitespace-nowrap">{d.fecha || ""}</td>
                <td className="px-2"><div className={`truncate ${row.provider ? "" : "text-amber-700 dark:text-amber-400"}`} title={row.provider ? row.provider.razon_social : `${d.proveedor?.razon_social || "?"} ${d.proveedor?.cuit ? `(${d.proveedor.cuit})` : ""}`}>{row.provider ? row.provider.razon_social : row.data ? `${d.proveedor?.razon_social || "?"} ${d.proveedor?.cuit ? `(${d.proveedor.cuit})` : ""}` : ""}</div></td>
                <td className="px-2 text-right whitespace-nowrap">{row.data ? formatCurrency(Number(d.total || 0), d.moneda === "USD" ? "USD" : "ARS") : ""}</td>
                <td className="px-2 leading-tight">
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
                <td className="px-2 text-right">
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

      <ProveedorFormModal
        open={!!nuevoProv}
        proveedorId={null}
        inicial={nuevoProv?.inicial}
        consultarArcaAlAbrir
        subtitulo="Se guarda y queda asignado a las facturas del lote con ese CUIT."
        onClose={() => setNuevoProv(null)}
        onSaved={(row) => {
          const np = nuevoProv;
          setNuevoProv(null);
          if (np) void asignarProveedor({ id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string } as Provider, np.rowId, onlyDigits(row.cuit as string) || np.cuit);
        }}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">Al terminar de leer, se cruzan solas contra las OC. Las que cierran se confirman con un botón; las demás se abren mostrando solo lo que no cierra.</p>
        <div className="flex gap-2">
          {onMinimizar && <button onClick={onMinimizar} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm"><Minimize2 className="h-4 w-4" /> Segundo plano</button>}
          <button disabled={busy && !onMinimizar} onClick={close} className="rounded-lg border px-4 py-2 text-sm">Cerrar</button>
          <button disabled={saving || listas === 0} onClick={revisarTodas} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><PlayCircle className="h-4 w-4" /> Cargar las {listas} listas</button>
        </div>
      </div>
    </div>
  </div>;
}
