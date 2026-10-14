"use client";

/**
 * Conciliación de facturas de compra contra OC, por línea, con IA.
 *
 * 1. Se suben una o varias facturas del mismo proveedor (la IA las lee).
 * 2. Se traen las líneas de OC de ese proveedor que todavía no se facturaron.
 * 3. La IA decide qué artículo de la factura es qué artículo de la OC; el motor
 *    reparte cantidades sin cruzar talles (purchase-matching.ts).
 * 4. El usuario revisa con semáforo y guarda:
 *    - "Confirmar": la factura va a aprobación/pagos y las OC quedan facturadas.
 *    - "Conciliación parcial": queda guardada SIN ir a pagos, para retomarla después.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Sparkles, Check, AlertTriangle, Upload, Trash2, RotateCcw, Pencil, Maximize2, Minimize2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { aprenderNombreFantasiaDeFactura } from "@/lib/nombre-fantasia";
import { traerTarjetas, tarjetaSugerida, movimientoPagoTarjeta, registrarPagoTarjeta, type Tarjeta } from "@/lib/pago-tarjeta";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { parseDecimalInput } from "@/lib/decimal-input";
import {
  matchPurchaseLines, parseVariant, puntajeParecido, citaOc,
  type Equivalencias, type InvoiceLineInput, type MatchResult, type Asignacion,
} from "@/lib/purchase-matching";
import {
  cargarLineasOc, sugerirEquivalencias, semaforoLinea, contarSemaforo,
  type OcLinea, type Manual, type Confianza, type AnalisisIA,
} from "@/lib/conciliacion-compras-analisis";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  sociedadId: string;
  profileId: string | null;
  onClose: () => void;
  /** Recibe los números de las facturas guardadas. */
  onSuccess: (guardadas?: string[]) => void;
  /** Facturas ya leídas (desde la carga masiva): se cargan sin volver a pasar por la IA. */
  inicial?: { proveedorId?: string; facturas: Array<{ file: File; data: any }>; analisis?: AnalisisIA };
  /** Carga masiva: si al abrir todo cierra (sin amarillas ni rojas), confirma sola y pasa a la siguiente. */
  autoConfirmar?: boolean;
}

interface Proveedor { id: string; razon_social: string; cuit: string | null; talles_especiales?: string[] | null; tolerancia_precio_pct?: number | null }

interface ItemFactura {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  iva_porcentaje: number;
  unidad: string;
}

interface FacturaCarga {
  localId: string;
  dbId: string | null;            // si se retoma una conciliación parcial
  file: File | null;
  archivoNombre: string;
  numero: string;
  tipo: string;
  fecha: string;
  vencimiento: string;
  cae: string;
  moneda: "ARS" | "USD";
  subtotal: number;
  iva: number;
  ivaPorcentaje: number;
  percepciones: number;
  total: number;
  items: ItemFactura[];
  cuit: string;
  /** Números de OC que la factura cita impresos ("Su OC N° 1199"). */
  ocRefs?: string[];
  /** Emisor leído por la IA (para aprender el nombre de fantasía del proveedor). */
  razonSocialLeida?: string;
  nombreFantasiaLeido?: string;
}


function tipoComprobante(raw: string): string {
  const t = String(raw || "").toUpperCase().trim();
  if (t === "A" || t === "FACTURA A" || t === "FC A") return "FC A";
  if (t === "B" || t === "FACTURA B" || t === "FC B") return "FC B";
  if (t === "C" || t === "FACTURA C" || t === "FC C") return "FC C";
  return t || "FC A";
}

const precioNeto = (it: ItemFactura) => round2(it.precio_unitario * (1 - (it.descuento_porcentaje || 0) / 100));
const lineKey = (f: FacturaCarga, i: number) => `${f.localId}:${i}`;

/** Líneas de una factura ya leída, como las cruza la conciliación (para el cruce automático de la carga masiva). */
export function lineasParaCruce(file: File, d: any): { lineas: InvoiceLineInput[]; ocRefs: string[]; facturaRef: string } {
  const f = facturaDesdeDatos(file, d);
  const facturaRef = f.numero || f.localId;
  return {
    facturaRef, ocRefs: f.ocRefs || [],
    lineas: f.items.map((it, i) => ({ key: lineKey(f, i), facturaRef, codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio: precioNeto(it) })),
  };
}

/** Arma una factura de la conciliación con los datos que devolvió /api/parse-factura-compra. */
function facturaDesdeDatos(file: File, d: any): FacturaCarga {
  const ivaPct = d.iva_porcentaje != null ? Number(d.iva_porcentaje) || 0 : 21;
  return {
    localId: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    dbId: null,
    file,
    archivoNombre: file.name,
    numero: String(d.numero_factura || ""),
    tipo: tipoComprobante(d.tipo_comprobante),
    fecha: d.fecha || todayAR(),
    vencimiento: d.fecha_vencimiento || "",
    cae: d.cae || "",
    moneda: d.moneda === "USD" ? "USD" : "ARS",
    subtotal: Number(d.subtotal) || 0,
    iva: Number(d.iva) || 0,
    ivaPorcentaje: ivaPct,
    percepciones: Number(d.percepciones) || 0,
    total: Number(d.total) || 0,
    cuit: String(d.proveedor?.cuit || "").replace(/\D/g, ""),
    ocRefs: (Array.isArray(d.referencias_oc) ? d.referencias_oc : []).map((x: unknown) => String(x || "").trim()).filter(Boolean),
    razonSocialLeida: String(d.proveedor?.razon_social || "").trim(),
    nombreFantasiaLeido: String(d.proveedor?.nombre_fantasia || "").trim(),
    items: (Array.isArray(d.items) ? d.items : []).map((it: any) => ({
      codigo: String(it.codigo || ""),
      descripcion: String(it.descripcion || ""),
      cantidad: it.cantidad == null ? 1 : Number(it.cantidad) || 0,
      precio_unitario: Number(it.precio_unitario) || 0,
      descuento_porcentaje: Math.max(0, Math.min(100, Number(it.descuento_porcentaje ?? d.descuento_general_porcentaje) || 0)),
      iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : ivaPct,
      unidad: it.unidad || "UN",
    })).filter((it: ItemFactura) => it.descripcion && it.cantidad > 0),
  };
}

export default function ConciliacionCompras({ sociedadId, profileId, onClose, onSuccess, inicial, autoConfirmar }: Props) {
  const { toast } = useToast();
  const [fullscreen, setFullscreen] = useState(true);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [proveedorId, setProveedorId] = useState("");
  const [busquedaProv, setBusquedaProv] = useState("");
  const [facturas, setFacturas] = useState<FacturaCarga[]>([]);
  const [leyendo, setLeyendo] = useState<string>("");
  const [error, setError] = useState("");
  const [borradores, setBorradores] = useState<Array<{ id: string; numero_factura: string; fecha: string; total: number; moneda: string }>>([]);

  const [ocLineas, setOcLineas] = useState<OcLinea[]>([]);
  const [legacyOcs, setLegacyOcs] = useState<Set<string>>(new Set());
  const [incluirLegacy, setIncluirLegacy] = useState(false);
  const [cargandoOcs, setCargandoOcs] = useState(false);

  const [equivalencias, setEquivalencias] = useState<Equivalencias>({});
  const [confianza, setConfianza] = useState<Record<string, Confianza>>({});
  const [motivo, setMotivo] = useState<Record<string, string>>({});
  const [iaInfo, setIaInfo] = useState("");
  const [conciliando, setConciliando] = useState(false);
  const [conciliado, setConciliado] = useState(false);
  const [manual, setManual] = useState<Manual>({});
  const [revisadas, setRevisadas] = useState<Set<string>>(new Set());
  // Arranca mostrando solo lo que no cierra; lo que está bien queda plegado en una línea.
  const [soloRevisar, setSoloRevisar] = useState(true);
  // Lo que vino sin OC o de más va a una OC complementaria atada a la factura (se puede destildar).
  const [crearOcExtra, setCrearOcExtra] = useState(true);
  // Unidades de más que se aceptan en la misma OC (en vez de mandarlas a la OC complementaria).
  const [aceptarDeMas, setAceptarDeMas] = useState<Set<string>>(new Set());
  // Diferencias de precio que se aceptan pero quedan anotadas para reclamar al proveedor.
  const [reclamar, setReclamar] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<string | null>(null);
  const [aceptarCostos, setAceptarCostos] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // ── Proveedores ──
  useEffect(() => {
    if (!sociedadId) return;
    (async () => {
      let { data, error: e } = await db.from("proveedores").select("id, razon_social, cuit, talles_especiales, tolerancia_precio_pct").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social");
      if (e) ({ data } = await db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social"));
      setProveedores((data || []) as Proveedor[]);
    })();
  }, [sociedadId]);

  const proveedor = proveedores.find(p => p.id === proveedorId) || null;
  // Reglas del proveedor: talles que factura como "talle especial" y diferencia de precio aceptada.
  const opcionesMatch = useMemo(() => ({
    tallesEspeciales: proveedor?.talles_especiales || [],
    toleranciaPct: Number(proveedor?.tolerancia_precio_pct ?? 0) || 0,
  }), [proveedor?.talles_especiales, proveedor?.tolerancia_precio_pct]);
  // OC citadas en cada factura (por número): el motor las prefiere al repartir.
  const opcionesConRefs = useMemo(() => {
    const ocPreferidas: Record<string, string[]> = {};
    for (const f of facturas) {
      if (!f.ocRefs?.length) continue;
      const ids = [...new Set(ocLineas.filter(o => f.ocRefs!.some(r => citaOc(r, o.ocNumero))).map(o => o.ocId))];
      if (ids.length) ocPreferidas[f.numero || f.localId] = ids;
    }
    return { ...opcionesMatch, ocPreferidas };
  }, [opcionesMatch, facturas, ocLineas]);
  const proveedoresFiltrados = useMemo(() => {
    const q = busquedaProv.trim().toLowerCase();
    if (!q) return proveedores.slice(0, 30);
    const digits = q.replace(/\D/g, "");
    return proveedores.filter(p => p.razon_social.toLowerCase().includes(q) || (digits.length >= 3 && (p.cuit || "").replace(/\D/g, "").includes(digits))).slice(0, 30);
  }, [proveedores, busquedaProv]);

  // ── Facturas que llegan ya leídas desde la carga masiva ──
  const inicialCargado = useRef(false);
  useEffect(() => {
    if (!inicial || inicialCargado.current) return;
    inicialCargado.current = true;
    setFacturas(inicial.facturas.map(f => facturaDesdeDatos(f.file, f.data || {})));
    if (inicial.proveedorId) setProveedorId(inicial.proveedorId);
  }, [inicial]);

  // ── Conciliaciones parciales del proveedor ──
  useEffect(() => {
    if (!proveedorId || !sociedadId) { setBorradores([]); return; }
    (async () => {
      const { data } = await db.from("facturas_compra").select("id, numero_factura, fecha, total, moneda")
        .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId).eq("estado", "en_conciliacion").order("fecha");
      setBorradores(data || []);
    })();
  }, [proveedorId, sociedadId]);

  // ── Leer facturas con IA ──
  async function leerArchivos(files: File[]) {
    setError("");
    const nuevas: FacturaCarga[] = [];
    for (const file of files) {
      setLeyendo(file.name);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/parse-factura-compra", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer");
        nuevas.push(facturaDesdeDatos(file, json.data || {}));
      } catch (e: any) {
        setError(prev => `${prev ? prev + " · " : ""}${file.name}: ${e?.message || "error al leer"}`);
      }
    }
    setLeyendo("");
    if (!nuevas.length) return;
    setFacturas(prev => [...prev, ...nuevas]);
    setConciliado(false);
    // Proveedor por CUIT
    if (!proveedorId) {
      const cuit = nuevas.find(f => f.cuit)?.cuit;
      const match = cuit ? proveedores.find(p => (p.cuit || "").replace(/\D/g, "") === cuit) : null;
      if (match) setProveedorId(match.id);
      else if (cuit) setError(prev => `${prev ? prev + " · " : ""}El CUIT ${cuit} de la factura no coincide con ningún proveedor: elegilo a mano.`);
    }
  }

  // ── Retomar una conciliación parcial ──
  async function retomar(id: string) {
    setError("");
    const [{ data: fc }, { data: items }, { data: asig }] = await Promise.all([
      db.from("facturas_compra").select("*").eq("id", id).single(),
      db.from("facturas_compra_items").select("id, codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, iva_porcentaje, unidad").eq("factura_compra_id", id),
      db.from("factura_compra_asignaciones").select("factura_compra_item_id, orden_compra_item_id, cantidad").eq("factura_compra_id", id),
    ]);
    if (!fc) { setError("No se encontró la factura"); return; }
    const localId = `d${id.slice(0, 8)}`;
    const lista = (items || []) as Array<ItemFactura & { id: string }>;
    const f: FacturaCarga = {
      localId, dbId: id, file: null, archivoNombre: fc.archivo_nombre || "",
      numero: fc.numero_factura, tipo: fc.tipo_comprobante || "FC A", fecha: fc.fecha, vencimiento: fc.fecha_vencimiento || "",
      cae: fc.cae || "", moneda: fc.moneda === "USD" ? "USD" : "ARS", subtotal: Number(fc.subtotal) || 0, iva: Number(fc.iva) || 0,
      ivaPorcentaje: Number(fc.iva_porcentaje) || 21, percepciones: Number(fc.percepciones) || 0, total: Number(fc.total) || 0, cuit: "",
      items: lista.map(it => ({
        codigo: it.codigo || "", descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario),
        descuento_porcentaje: Number(it.descuento_porcentaje) || 0, iva_porcentaje: Number(it.iva_porcentaje ?? 21), unidad: it.unidad || "UN",
      })),
    };
    // Lo que ya estaba asignado se respeta como asignación manual.
    const idx = new Map(lista.map((it, i) => [it.id, i]));
    const m: Manual = {};
    for (const a of (asig || []) as Array<{ factura_compra_item_id: string; orden_compra_item_id: string; cantidad: number }>) {
      const i = idx.get(a.factura_compra_item_id);
      if (i === undefined) continue;
      const k = lineKey(f, i);
      const arr = (m[k] as Array<{ ocLineId: string; cantidad: number }>) || [];
      arr.push({ ocLineId: a.orden_compra_item_id, cantidad: Number(a.cantidad) });
      m[k] = arr;
    }
    setFacturas(prev => [...prev.filter(x => x.dbId !== id), f]);
    setManual(prev => ({ ...prev, ...m }));
    setConciliado(false);
  }

  // ── Líneas de OC pendientes del proveedor ──
  const cargarOcs = useCallback(async (): Promise<{ lineas: OcLinea[]; legacy: Set<string> }> => {
    if (!proveedorId || !sociedadId) return { lineas: [], legacy: new Set() };
    setCargandoOcs(true);
    try {
      const r = await cargarLineasOc(db, sociedadId, proveedorId, manual);
      setLegacyOcs(r.legacy);
      setOcLineas(r.lineas);
      return r;
    } finally {
      setCargandoOcs(false);
    }
  }, [proveedorId, sociedadId, manual]);

  const ocsUsables = useMemo(
    () => ocLineas.filter(l => incluirLegacy || !legacyOcs.has(l.ocId)),
    [ocLineas, legacyOcs, incluirLegacy],
  );

  const lineasFactura: InvoiceLineInput[] = useMemo(() => facturas.flatMap(f => f.items.map((it, i) => ({
    key: lineKey(f, i), facturaRef: f.numero || f.localId, codigo: it.codigo || null,
    descripcion: it.descripcion, cantidad: it.cantidad, precio: precioNeto(it),
  }))), [facturas]);

  // ── Conciliar con IA ──
  const analisisPrevio = useRef<AnalisisIA | undefined>(inicial?.analisis);
  async function conciliar() {
    setError(""); setIaInfo(""); setConciliando(true);
    try {
      const { lineas: ocs, legacy } = await cargarOcs();
      const usables = ocs.filter(l => incluirLegacy || !legacy.has(l.ocId));
      if (!lineasFactura.length) throw new Error("La factura no tiene líneas");
      if (!usables.length) throw new Error("Este proveedor no tiene OC con artículos pendientes de facturar.");
      // Desde la carga masiva el análisis ya viene hecho: no se vuelve a consultar a la IA.
      const previo = analisisPrevio.current;
      analisisPrevio.current = undefined;
      const a = previo || await sugerirEquivalencias(db, {
        sociedadId, proveedorId, proveedorNombre: proveedor?.razon_social || "", lineasFactura, ocs: usables, manual, opciones: opcionesConRefs,
      });
      setEquivalencias(a.equivalencias); setConfianza(a.confianza); setMotivo(a.motivo); setIaInfo(a.iaInfo);
      setConciliado(true);
    } catch (e: any) {
      setError(e?.message || "Error al conciliar");
    } finally {
      setConciliando(false);
    }
  }

  // Concilia sola en cuanto hay facturas y proveedor (una vez por combinación; "Volver a conciliar" repite).
  const autoKey = useRef("");
  useEffect(() => {
    if (!proveedor || !facturas.length || conciliado || conciliando || leyendo) return;
    const key = `${proveedorId}|${facturas.map(f => f.localId).join(",")}`;
    if (autoKey.current === key) return;
    autoKey.current = key;
    void conciliar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedor, proveedorId, facturas, conciliado, conciliando, leyendo]);

  const resultado: MatchResult | null = useMemo(
    () => (conciliado ? matchPurchaseLines(lineasFactura, ocsUsables, equivalencias, manual, opcionesConRefs) : null),
    [conciliado, lineasFactura, ocsUsables, equivalencias, manual, opcionesConRefs],
  );

  const asigPorLinea = useMemo(() => {
    const m = new Map<string, Asignacion[]>();
    for (const a of resultado?.asignaciones || []) m.set(a.invoiceKey, [...(m.get(a.invoiceKey) || []), a]);
    return m;
  }, [resultado]);
  const sinAsignarPorLinea = useMemo(() => new Map((resultado?.sinAsignar || []).map(s => [s.invoiceKey, s])), [resultado]);
  const ocById = useMemo(() => new Map(ocLineas.map(o => [o.id, o])), [ocLineas]);

  function semaforo(l: InvoiceLineInput) {
    return resultado ? semaforoLinea(l.key, l.descripcion, resultado, { manual, confianza, revisadas }) : "verde";
  }

  const sugerenciaSinOc = useMemo(() => {
    const m = new Map<string, { o: OcLinea; libre: number; motivos: string[] }>();
    if (!resultado) return m;
    const usado = new Map<string, number>();
    for (const a of resultado.asignaciones) usado.set(a.ocLineId, (usado.get(a.ocLineId) || 0) + a.cantidad);
    for (const sa of resultado.sinAsignar) {
      if (sa.tipo !== "sin_oc" || manual[sa.invoiceKey] === "__extra__") continue;
      const l = lineasFactura.find(x => x.key === sa.invoiceKey);
      if (!l) continue;
      let mejor: { o: OcLinea; libre: number; motivos: string[]; puntaje: number } | null = null;
      for (const o of ocsUsables) {
        const libre = round2(o.cantidad - (usado.get(o.id) || 0));
        const p = puntajeParecido({ ...l, cantidad: sa.cantidad }, o, libre, opcionesMatch);
        if (p && (!mejor || p.puntaje > mejor.puntaje)) mejor = { o, libre, motivos: p.motivos, puntaje: p.puntaje };
      }
      if (mejor) m.set(sa.invoiceKey, mejor);
    }
    return m;
  }, [resultado, lineasFactura, ocsUsables, manual, opcionesMatch]);

  const conteo = useMemo(
    () => (resultado ? contarSemaforo(lineasFactura, resultado, { manual, confianza, revisadas }) : { verde: 0, amarillo: 0, rojo: 0, fuera: 0 }),
    [resultado, lineasFactura, revisadas, confianza, manual],
  );

  // Carga masiva: si todo cierra, se confirma sola (una sola vez).
  const autoConfirmado = useRef(false);
  useEffect(() => {
    if (!autoConfirmar || autoConfirmado.current || !resultado || guardando || conciliando) return;
    if (!lineasFactura.length || conteo.amarillo > 0 || conteo.rojo > 0) return;
    autoConfirmado.current = true;
    void guardar(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirmar, resultado, conteo, guardando, conciliando, lineasFactura]);

  const diferenciaTotal = round2((resultado?.asignaciones || []).reduce((s, a) => s + a.diferencia, 0));
  const ocNumero = (id: string) => ocLineas.find(o => o.ocId === id)?.ocNumero || id.slice(0, 8);

  // ── OC complementaria: lo que vino sin OC o de más, atado a la factura ──
  async function crearOcComplementaria(f: FacturaCarga, sobrantes: Array<{ key: string; it: ItemFactura; cantidad: number }>) {
    const renglones = sobrantes.map((x, i) => {
      const precio = precioNeto(x.it);
      return { key: x.key, precio, item: {
        codigo: x.it.codigo || "", descripcion: x.it.descripcion, cantidad: x.cantidad, cantidad_recibida: x.cantidad,
        unidad: x.it.unidad || "UN", precio_unitario: precio, iva_porcentaje: Number(x.it.iva_porcentaje ?? 21), orden: i,
      } };
    });
    const subtotal = round2(renglones.reduce((s, r) => s + r.item.cantidad * r.precio, 0));
    const iva = round2(renglones.reduce((s, r) => s + r.item.cantidad * r.precio * r.item.iva_porcentaje / 100, 0));
    const { data: oc, error: e1 } = await db.from("ordenes_compra").insert({
      proveedor_id: proveedorId, fecha: f.fecha || todayAR(), moneda: f.moneda, estado: "enviada", estado_pago: "pendiente",
      subtotal, iva, total: round2(subtotal + iva), sociedad_id: sociedadId, presupuesto_origen_id: null,
      observaciones: `OC complementaria de la FC ${f.numero.trim()}: artículos que vinieron sin OC o de más`, created_by: profileId,
    }).select("id, numero").single();
    if (e1 || !oc) throw new Error(`Factura ${f.numero}: no se pudo crear la OC complementaria (${e1?.message || "sin respuesta"})`);
    const { data: items, error: e2 } = await db.from("orden_compra_items")
      .insert(renglones.map(r => ({ orden_id: oc.id, ...r.item }))).select("id, orden");
    if (e2 || !items?.length) {
      await db.from("ordenes_compra").update({ estado: "cancelada" }).eq("id", oc.id);
      throw new Error(`Factura ${f.numero}: no se pudieron cargar los artículos de la OC complementaria (${e2?.message || "sin respuesta"})`);
    }
    const idPorOrden = new Map((items as Array<{ id: string; orden: number }>).map(x => [Number(x.orden), x.id]));
    return {
      oc: { id: oc.id as string, numero: String(oc.numero || "nueva") },
      asignaciones: renglones
        .map((r, i) => ({ invoiceKey: r.key, ocLineId: idPorOrden.get(i) || "", cantidad: r.item.cantidad, precioFactura: r.precio, precioOc: r.precio, origen: "oc_complementaria" }))
        .filter(a => a.ocLineId),
    };
  }

  // ── Guardar ──
  async function guardar(borrador: boolean, silencioso = false) {
    if (!resultado || !proveedorId) return;
    setError("");
    for (const f of facturas) if (!f.numero.trim()) { setError("Falta el número de una factura."); return; }
    // Lo que no está en ninguna OC nunca frena: va a la OC complementaria o queda como "Fuera de OC".
    if (!borrador && conteo.rojo > 0 && !crearOcExtra
      && !window.confirm(`Hay ${conteo.rojo} línea(s) sin OC. Se guardan como «Fuera de OC» (se pagan con la factura, sin OC). ¿Seguir?`)) return;
    if (!borrador && conteo.amarillo > 0 && !window.confirm(`Hay ${conteo.amarillo} línea(s) en amarillo sin revisar. ¿Confirmar igual?`)) return;
    setGuardando(true);
    const guardadas: string[] = [];
    const ocsCreadas: string[] = [];
    const pagadasTarjeta: string[] = [];
    let tarjetasCache: Tarjeta[] | undefined;
    let prActualizados = 0;
    const sinPr: string[] = [];
    try {
      for (const f of facturas) {
        const keys = new Set(f.items.map((_, i) => lineKey(f, i)));
        const asign: Array<Pick<Asignacion, "invoiceKey" | "ocLineId" | "cantidad" | "precioFactura" | "precioOc"> & { origen: string }> =
          resultado.asignaciones.filter(a => keys.has(a.invoiceKey));
        // Lo que sobró de esta factura: las unidades de más aceptadas van a su misma OC; el resto, a la OC complementaria.
        const sobrantes: Array<{ key: string; it: ItemFactura; cantidad: number }> = [];
        if (!borrador) f.items.forEach((it, i) => {
          const k = lineKey(f, i);
          const sa = sinAsignarPorLinea.get(k);
          if (!sa || sa.cantidad <= 0) return;
          const ocLinea = sa.ocLineId ? ocById.get(sa.ocLineId) : undefined;
          if (sa.tipo === "de_mas" && aceptarDeMas.has(k) && ocLinea) {
            asign.push({ invoiceKey: k, ocLineId: ocLinea.id, cantidad: sa.cantidad, precioFactura: precioNeto(it), precioOc: ocLinea.precio, origen: "de_mas" });
          } else {
            sobrantes.push({ key: k, it, cantidad: sa.cantidad });
          }
        });
        let ocExtra: { id: string; numero: string } | null = null;
        if (sobrantes.length && crearOcExtra) {
          const creada = await crearOcComplementaria(f, sobrantes);
          ocExtra = creada.oc;
          asign.push(...creada.asignaciones);
        }
        const eqMap = new Map<string, { producto_factura: string; producto_oc: string; codigo_proveedor: string | null }>();
        if (!borrador) for (const a of asign) {
          if (a.origen === "codigo") continue;
          const l = lineasFactura.find(x => x.key === a.invoiceKey);
          const o = ocById.get(a.ocLineId);
          if (!l || !o) continue;
          const pf = parseVariant(l.descripcion).producto, po = parseVariant(o.descripcion).producto;
          if (pf && po) eqMap.set(`${pf}|${po}`, { producto_factura: pf, producto_oc: po, codigo_proveedor: l.codigo || null });
        }
        const eqs = [...eqMap.values()];
        const extras = ocExtra ? [] : sobrantes.map(x => `${x.cantidad} × ${x.it.descripcion}`);
        const aReclamar = f.items.map((it, i) => {
          const k = lineKey(f, i);
          if (!reclamar.has(k)) return null;
          const as = asigPorLinea.get(k) || [];
          return `${it.descripcion} (factura ${formatCurrency(precioNeto(it), f.moneda)} vs OC ${[...new Set(as.map(a => formatCurrency(a.precioOc, f.moneda)))].join(" / ")})`;
        }).filter(Boolean);
        const notas = [
          "Conciliada por línea contra OC" + (iaInfo ? ` · ${iaInfo}` : ""),
          ocExtra ? `OC complementaria ${ocExtra.numero} con lo que vino sin OC o de más` : "",
          extras.length ? `Fuera de OC: ${extras.join("; ")}` : "",
          aReclamar.length ? `A reclamar al proveedor (precio): ${aReclamar.join("; ")}` : "",
        ].filter(Boolean).join("\n");
        const guardarFactura = (confirmar: boolean) => db.rpc("guardar_conciliacion_compra", {
          p_sociedad_id: sociedadId,
          p_factura_id: f.dbId,
          p_factura: {
            proveedor_id: proveedorId, numero_factura: f.numero.trim(), tipo_comprobante: f.tipo, fecha: f.fecha,
            fecha_vencimiento: f.vencimiento || null, cae: f.cae || null, moneda: f.moneda, subtotal: f.subtotal,
            iva: f.iva, iva_porcentaje: f.ivaPorcentaje, percepciones: f.percepciones, total: f.total, notas,
          },
          p_items: f.items.map((it, i) => ({ key: lineKey(f, i), ...it })),
          p_asignaciones: asign.map(a => ({
            key: a.invoiceKey, orden_compra_item_id: a.ocLineId, cantidad: a.cantidad,
            precio_factura: a.precioFactura, precio_oc: a.precioOc, origen: a.origen,
          })),
          p_borrador: borrador,
          p_aceptar_costos: aceptarCostos,
          p_equivalencias: eqs,
          p_confirmar: confirmar,
        });
        let data: any;
        try {
          let rpcError: any;
          ({ data, error: rpcError } = await guardarFactura(false));
          if (rpcError) throw new Error(`Factura ${f.numero}: ${rpcError.message}`);
          // Facturado de más contra la OC: es un aviso, nunca traba. Sin confirmar no se guardó nada.
          if (data?.requiere_confirmacion) {
            if (!window.confirm(`Factura ${f.numero}: ${data.aviso || "hay líneas de OC que quedarían facturadas de más."}\n\n¿Guardar igual?`)) {
              throw new Error(`Factura ${f.numero}: no se guardó (quedaba facturado de más contra la OC). Revisá la asignación.`);
            }
            ({ data, error: rpcError } = await guardarFactura(true));
            if (rpcError) throw new Error(`Factura ${f.numero}: ${rpcError.message}`);
          }
        } catch (e) {
          // La factura no se guardó: la OC complementaria recién creada queda cancelada (no se borra).
          if (ocExtra) await db.from("ordenes_compra").update({ estado: "cancelada", observaciones: `Cancelada: no se pudo guardar la FC ${f.numero} a la que acompañaba` }).eq("id", ocExtra.id);
          throw e;
        }
        const facturaId = data?.factura_compra_id as string;
        guardadas.push(f.numero);
        // OC marcadas "pagada con tarjeta" (Mercado Libre, etc.): la factura queda pagada con esa tarjeta, sin OP.
        if (!borrador && facturaId) {
          try {
            const ocIds = [...new Set(asign.map(a => ocById.get(a.ocLineId)?.ocId).filter(Boolean))] as string[];
            const { data: ocsPago } = ocIds.length ? await db.from("ordenes_compra").select("id, medio_pago").in("id", ocIds) : { data: [] };
            const ocConTarjeta = !!ocsPago?.length && ocsPago.every((o: any) => o.medio_pago === "tarjeta");
            tarjetasCache ??= await traerTarjetas(db, sociedadId);
            const tarjeta = ocConTarjeta ? tarjetaSugerida(tarjetasCache, { ocConTarjeta }) : null;
            if (tarjeta) {
              const { error: ePago } = await registrarPagoTarjeta(db, facturaId, tarjeta, movimientoPagoTarjeta({
                sociedadId, proveedorId, facturaId, tarjeta, total: f.total, moneda: f.moneda, fecha: f.fecha || todayAR(),
                comprobante: `${f.tipo} ${f.numero.trim()}`, proveedorNombre: proveedores.find(p => p.id === proveedorId)?.razon_social, userId: profileId,
              }));
              pagadasTarjeta.push(ePago ? `${f.numero}: no se pudo registrar el pago con ${tarjeta.nombre} (${ePago}), quedó para OP` : `${f.numero} con ${tarjeta.nombre}`);
            }
          } catch { /* si falla, la factura queda para OP como siempre */ }
        }
        if (ocExtra) ocsCreadas.push(`${ocExtra.numero} (FC ${f.numero})`);
        prActualizados += Number(data?.presupuestos_items_actualizados) || 0;
        for (const x of (data?.sin_presupuesto || []) as string[]) sinPr.push(x);
        if (f.file && facturaId) {
          const ext = f.file.name.split(".").pop() || "pdf";
          const path = `${sociedadId}/${facturaId}/factura.${ext}`;
          const { error: upErr } = await supabase.storage.from("facturas-compra").upload(path, f.file, { upsert: true });
          if (!upErr) {
            const { data: u } = supabase.storage.from("facturas-compra").getPublicUrl(path);
            if (u?.publicUrl) await db.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: f.file.name }).eq("id", facturaId);
          }
        }
      }
      // Nombre de fantasía leído en la factura: si el proveedor no tiene, se guarda; si tiene otro, solo se avisa.
      const cuitProv = (proveedores.find(p => p.id === proveedorId)?.cuit || "").replace(/\D/g, "");
      const leida = cuitProv ? facturas.find(f => f.nombreFantasiaLeido && (f.cuit || "").replace(/\D/g, "") === cuitProv) : undefined;
      if (leida) await aprenderNombreFantasiaDeFactura(db, { proveedorId, sociedadId, deFactura: leida.nombreFantasiaLeido, razonSocialFactura: leida.razonSocialLeida, cuitFactura: leida.cuit }, toast);
      const mensaje = (borrador
        ? `Conciliación parcial guardada (${guardadas.join(", ")}). No se envía a pagos; la podés retomar desde «Conciliar facturas».`
        : `Listo: ${guardadas.join(", ")} conciliada(s) y enviada(s) a aprobación.`
          + (ocsCreadas.length ? `\n\nOC complementaria creada y atada a la factura: ${ocsCreadas.join("; ")}.` : "")
          + (pagadasTarjeta.length ? `\n\nPagadas con tarjeta (la OC estaba pagada con tarjeta, sin OP): ${pagadasTarjeta.join("; ")}.` : "")
          + (aceptarCostos ? `\n\nCostos actualizados en presupuestos: ${prActualizados} artículo(s) (se mantuvo el precio de venta y se recalculó el margen).` : "")
          + (sinPr.length ? `\n\nNo se encontró en el presupuesto de origen (revisalo a mano): ${sinPr.join("; ")}` : ""));
      if (silencioso) toast.success(mensaje.split("\n")[0] + (ocsCreadas.length ? ` · OC complementaria ${ocsCreadas.join("; ")}` : ""));
      else alert(mensaje);
      onSuccess(guardadas);
    } catch (e: any) {
      setError(guardadas.length
        ? `Se guardaron ${guardadas.join(", ")}, pero falló la siguiente: ${e?.message}. No vuelvas a cargar las que ya se guardaron.`
        : e?.message || "Error al guardar");
    } finally {
      setGuardando(false);
    }
  }

  const colores = {
    verde: "bg-emerald-500", amarillo: "bg-amber-400", rojo: "bg-red-500", fuera: "bg-zinc-400",
  } as const;
  const monedaOc = [...new Set(ocsUsables.map(o => o.moneda))];
  const monedaFc = [...new Set(facturas.map(f => f.moneda))];
  const avisoMoneda = conciliado && monedaOc.length && monedaFc.length && monedaOc.some(m => !monedaFc.includes(m as any));

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4">
      <div className={`bg-white dark:bg-zinc-900 w-full rounded-xl shadow-2xl ${fullscreen ? "min-h-[calc(100vh-2rem)] max-w-none" : "max-w-6xl"}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2"><Sparkles className="h-5 w-5 text-orange-500" /> Conciliar facturas de compra con OC</h2>
            <p className="text-sm text-zinc-500">Subí la factura: se busca sola cada artículo en las OC del proveedor (código, nombre, cantidad y precio) y te muestra solo lo que no cierra.</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen(v => !v)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={20} /></button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* 1. Facturas y proveedor */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">1. Facturas del proveedor</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-900/10">
                {leyendo ? <span className="flex items-center gap-2 text-sm text-orange-700"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo {leyendo}…</span> : <>
                  <span className="flex items-center gap-2 font-semibold text-orange-600"><Upload className="h-4 w-4" /> Subir factura(s) en PDF o foto</span>
                  <span className="text-xs text-zinc-500">Podés subir varias del mismo proveedor juntas</span>
                </>}
                <input type="file" multiple accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={!!leyendo}
                  onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ""; if (fs.length) leerArchivos(fs); }} />
              </label>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Proveedor</label>
                {proveedor ? (
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm">
                    <span className="font-semibold flex-1">{proveedor.razon_social}</span>
                    <span className="text-xs text-zinc-500">{proveedor.cuit}</span>
                    <button onClick={() => { setProveedorId(""); setConciliado(false); setOcLineas([]); }} className="text-xs underline">Cambiar</button>
                  </div>
                ) : (
                  <div>
                    <input value={busquedaProv} onChange={e => setBusquedaProv(e.target.value)} placeholder="Buscar proveedor por nombre o CUIT…"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-3 py-2 text-sm" />
                    {busquedaProv && (
                      <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm">
                        {proveedoresFiltrados.map(p => (
                          <button key={p.id} onClick={() => { setProveedorId(p.id); setBusquedaProv(""); setConciliado(false); }}
                            className="block w-full text-left px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">{p.razon_social} <span className="text-xs text-zinc-500">{p.cuit}</span></button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {borradores.length > 0 && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2 text-sm">
                    <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Conciliaciones parciales de este proveedor</p>
                    {borradores.map(b => (
                      <div key={b.id} className="flex items-center gap-2">
                        <span className="flex-1">{b.numero_factura} · {formatDate(b.fecha)} · {formatCurrency(Number(b.total), b.moneda === "USD" ? "USD" : "ARS")}</span>
                        <button disabled={facturas.some(f => f.dbId === b.id)} onClick={() => retomar(b.id)}
                          className="flex items-center gap-1 text-xs underline disabled:opacity-40"><RotateCcw className="h-3 w-3" /> Retomar</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {facturas.map(f => {
              const sumaLineas = round2(f.items.reduce((s, it) => s + it.cantidad * precioNeto(it), 0));
              const descuadre = f.subtotal > 0 && Math.abs(sumaLineas - f.subtotal) > Math.max(1, f.subtotal * 0.005);
              return (
                <div key={f.localId} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm">
                  <span className="text-xs text-zinc-500">{f.dbId ? "Retomada" : f.archivoNombre}</span>
                  <label className="flex items-center gap-1">N°
                    <input value={f.numero} onChange={e => setFacturas(p => p.map(x => x.localId === f.localId ? { ...x, numero: e.target.value } : x))}
                      className="w-40 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-0.5 font-mono" /></label>
                  <label className="flex items-center gap-1">Fecha
                    <input type="date" value={f.fecha} onChange={e => setFacturas(p => p.map(x => x.localId === f.localId ? { ...x, fecha: e.target.value } : x))}
                      className="rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-0.5" /></label>
                  <span>{f.items.length} líneas · {f.items.reduce((s, it) => s + it.cantidad, 0)} unidades</span>
                  <span className="font-semibold">Total {formatCurrency(f.total, f.moneda)}</span>
                  {descuadre && <span className="flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Las líneas suman {formatCurrency(sumaLineas, f.moneda)} y el subtotal dice {formatCurrency(f.subtotal, f.moneda)}: revisá que la IA haya leído todo.</span>}
                  <button onClick={() => { setFacturas(p => p.filter(x => x.localId !== f.localId)); setConciliado(false); }} className="ml-auto p-1 text-zinc-500 hover:text-red-600" title="Quitar"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}

            {error && <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}

            <div className="flex flex-wrap items-center gap-3">
              <button disabled={!facturas.length || !proveedorId || conciliando || !!leyendo} onClick={conciliar}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-40">
                {conciliando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {conciliado ? "Volver a conciliar" : "Buscar en las OC con IA"}
              </button>
              {legacyOcs.size > 0 && (
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  <input type="checkbox" checked={incluirLegacy} onChange={e => setIncluirLegacy(e.target.checked)} />
                  Incluir {legacyOcs.size} OC ya vinculadas a facturas con el sistema anterior
                </label>
              )}
              {cargandoOcs && <span className="text-xs text-zinc-500">Trayendo OC…</span>}
            </div>
          </section>

          {/* 2. Revisión */}
          {resultado && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">2. Revisión</h3>
                <span className="text-xs text-zinc-500">{iaInfo}</span>
                <span className="flex items-center gap-1 text-sm"><span className="h-3 w-3 rounded-full bg-emerald-500" />{conteo.verde} ok</span>
                <span className="flex items-center gap-1 text-sm"><span className="h-3 w-3 rounded-full bg-amber-400" />{conteo.amarillo} para revisar</span>
                <span className="flex items-center gap-1 text-sm"><span className="h-3 w-3 rounded-full bg-red-500" />{conteo.rojo} sin OC{conteo.rojo > 0 && crearOcExtra ? " (van a OC complementaria)" : ""}</span>
                {conteo.fuera > 0 && <span className="flex items-center gap-1 text-sm"><span className="h-3 w-3 rounded-full bg-zinc-400" />{conteo.fuera} fuera de OC</span>}
                <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={soloRevisar} onChange={e => setSoloRevisar(e.target.checked)} /> Mostrar solo lo que no cierra</label>
                {conteo.amarillo > 0 && (
                  <button onClick={() => setRevisadas(new Set(lineasFactura.map(l => l.key)))}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-400 text-emerald-700 text-sm"><Check className="h-4 w-4" /> Aceptar todas las sugerencias</button>
                )}
              </div>
              {avisoMoneda ? <p className="text-sm text-amber-700 flex items-center gap-1"><AlertTriangle className="h-4 w-4" /> La factura está en {monedaFc.join("/")} y hay OC en {monedaOc.join("/")}: las diferencias de precio no son comparables.</p> : null}

              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800 text-xs text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 w-6"></th>
                      <th className="px-2 py-2 text-left">Factura</th>
                      <th className="px-2 py-2 text-right">Cant.</th>
                      <th className="px-2 py-2 text-right">Precio FC</th>
                      <th className="px-2 py-2 text-left">Va a la OC</th>
                      <th className="px-2 py-2 text-right">Precio OC</th>
                      <th className="px-2 py-2 text-right">Diferencia</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {lineasFactura.map(l => {
                      const s = semaforo(l);
                      if (soloRevisar && (s === "verde" || s === "fuera")) return null;
                      const as = asigPorLinea.get(l.key) || [];
                      const sa = sinAsignarPorLinea.get(l.key);
                      const prod = parseVariant(l.descripcion).producto;
                      const dif = round2(as.reduce((x, a) => x + a.diferencia, 0));
                      const notas = [...new Set(as.map(a => a.nota).filter(Boolean))];
                      return (
                        <tr key={l.key} className="align-top">
                          <td className="px-2 py-2"><span className={`mt-1 block h-3 w-3 rounded-full ${colores[s]}`} /></td>
                          <td className="px-2 py-2">
                            <div className="font-medium">{l.descripcion}</div>
                            <div className="text-xs text-zinc-500">{facturas.length > 1 ? `FC ${l.facturaRef} · ` : ""}{l.codigo || ""}</div>
                            {s === "amarillo" && confianza[prod] && confianza[prod] !== "alta" && motivo[prod] && <div className="text-xs text-amber-700">IA ({confianza[prod]}): {motivo[prod]}</div>}
                            {notas.map(n => <div key={n} className="text-xs text-amber-700">{n}</div>)}
                            {editando === l.key && <EditorLinea l={l} asignaciones={resultado.asignaciones} ocsUsables={ocsUsables} manualActual={manual[l.key]}
                              onAplicar={valor => {
                                setManual(p => { const n = { ...p }; if (valor === null) delete n[l.key]; else n[l.key] = valor; return n; });
                                if (valor !== null) setRevisadas(p => new Set(p).add(l.key));
                                setEditando(null);
                              }} />}
                          </td>
                          <td className="px-2 py-2 text-right">{l.cantidad}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(l.precio)}</td>
                          <td className="px-2 py-2">
                            {manual[l.key] === "__extra__" && <span className="text-zinc-500">Fuera de OC: se paga con la factura, no toca ninguna OC ni presupuesto</span>}
                            {as.map(a => (
                              <div key={a.ocLineId}><span className="font-mono text-xs">{a.ocNumero}</span> · {a.cantidad} × {ocById.get(a.ocLineId)?.descripcion || ""}</div>
                            ))}
                            {sa && sa.tipo === "de_mas" && (
                              <div className="text-amber-700">
                                {sa.cantidad} de más (la OC {sa.ocNumero} pedía menos) →{" "}
                                {aceptarDeMas.has(l.key) ? <>se cargan en la {sa.ocNumero}, que queda facturada de más.{" "}
                                  <button onClick={() => { setAceptarDeMas(p => { const n = new Set(p); n.delete(l.key); return n; }); setRevisadas(p => new Set(p).add(l.key)); }} className="underline">Mejor a OC aparte</button></>
                                : <>{crearOcExtra ? "van a la OC complementaria." : "quedan fuera de OC."}{" "}
                                  <button onClick={() => { setAceptarDeMas(p => new Set(p).add(l.key)); setRevisadas(p => new Set(p).add(l.key)); }} className="underline">Aceptar de más en la {sa.ocNumero}</button></>}
                              </div>
                            )}
                            {sa && sa.tipo === "sin_oc" && manual[l.key] !== "__extra__" && (
                              <div className="text-red-600">
                                {sa.cantidad} sin OC{crearOcExtra ? " → van a la OC complementaria" : " → quedan fuera de OC"}.
                                {sugerenciaSinOc.get(l.key) && (() => {
                                  const sg = sugerenciaSinOc.get(l.key)!;
                                  const cant = Math.min(sa.cantidad, sg.libre);
                                  return (
                                    <div className="mt-1 text-zinc-700 dark:text-zinc-300">
                                      ¿Es este? <span className="font-mono text-xs">{sg.o.ocNumero}</span> · {sg.o.descripcion} (libre {sg.libre}, {formatCurrency(sg.o.precio)}) <span className="text-xs text-zinc-500">— {sg.motivos.join(", ")}</span>{" "}
                                      <button onClick={() => {
                                        const actual = manual[l.key];
                                        const previas = Array.isArray(actual) ? actual : (asigPorLinea.get(l.key) || []).map(a => ({ ocLineId: a.ocLineId, cantidad: a.cantidad }));
                                        setManual(p => ({ ...p, [l.key]: [...previas, { ocLineId: sg.o.id, cantidad: cant }] }));
                                        setRevisadas(p => new Set(p).add(l.key));
                                      }} className="text-xs font-semibold text-blue-700 underline">Asignar {cant}</button>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">{as.length ? [...new Set(as.map(a => formatCurrency(a.precioOc)))].join(" / ") : ""}</td>
                          <td className={`px-2 py-2 text-right ${dif > 0 ? "text-red-600" : dif < 0 ? "text-emerald-600" : "text-zinc-400"}`}>{as.length ? formatCurrency(dif) : ""}</td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {s === "amarillo" && <button onClick={() => setRevisadas(p => new Set(p).add(l.key))} className="mr-2 text-xs text-emerald-700 underline">{as.some(a => a.origen === "parecido") ? "Es este, OK" : dif !== 0 ? "Aceptar precio" : "OK"}</button>}
                            {as.length > 0 && dif !== 0 && (s === "amarillo" || reclamar.has(l.key)) && (
                              <button onClick={() => { setReclamar(p => { const n = new Set(p); if (n.has(l.key)) n.delete(l.key); else n.add(l.key); return n; }); setRevisadas(p => new Set(p).add(l.key)); }}
                                className={`mr-2 text-xs underline ${reclamar.has(l.key) ? "font-semibold text-red-700" : "text-red-600"}`}>{reclamar.has(l.key) ? "✓ A reclamar" : "A reclamar"}</button>
                            )}
                            {s === "rojo" && <button onClick={() => { setManual(p => ({ ...p, [l.key]: "__extra__" })); setRevisadas(p => new Set(p).add(l.key)); }} className="mr-2 text-xs text-zinc-600 underline">Fuera de OC</button>}
                            <button onClick={() => setEditando(editando === l.key ? null : l.key)} className="inline-flex items-center gap-1 text-xs underline"><Pencil className="h-3 w-3" /> Cambiar</button>
                          </td>
                        </tr>
                      );
                    })}
                    {soloRevisar && conteo.verde + conteo.fuera > 0 && (
                      <tr>
                        <td className="px-2 py-2"><span className="mt-1 block h-3 w-3 rounded-full bg-emerald-500" /></td>
                        <td colSpan={7} className="px-2 py-2 text-emerald-700">
                          ✔ {conteo.verde + conteo.fuera} renglón(es) cierran solos.{" "}
                          <button onClick={() => setSoloRevisar(false)} className="underline">Ver todo</button>
                        </td>
                      </tr>
                    )}
                    {soloRevisar && conteo.amarillo + conteo.rojo === 0 && (
                      <tr><td colSpan={8} className="px-2 py-3 text-center text-emerald-700 font-semibold">Todo cierra: podés confirmar.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Resumen por OC */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 text-sm space-y-1">
                  <p className="font-semibold">Cómo quedan las OC</p>
                  {resultado.ocsCompletas.map(id => <p key={id} className="text-emerald-700">✔ {ocNumero(id)}: completa</p>)}
                  {resultado.ocsParciales.map(id => {
                    const pend = resultado.pendientesOc.filter(p => p.ocId === id);
                    return (
                      <div key={id} className="text-amber-700">
                        ◐ {ocNumero(id)}: parcial — faltan {pend.reduce((s, p) => s + p.cantidad, 0)} u.
                        <ul className="ml-4 text-xs text-zinc-600 dark:text-zinc-400">
                          {pend.slice(0, 8).map(p => <li key={p.ocLineId}>{p.cantidad} × {ocById.get(p.ocLineId)?.descripcion}</li>)}
                          {pend.length > 8 && <li>…y {pend.length - 8} líneas más</li>}
                        </ul>
                      </div>
                    );
                  })}
                  {!resultado.ocsCompletas.length && !resultado.ocsParciales.length && <p className="text-zinc-500">Ninguna OC quedó asignada.</p>}
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 text-sm space-y-2">
                  <p className="font-semibold">Diferencia de costo total: <span className={diferenciaTotal > 0 ? "text-red-600" : diferenciaTotal < 0 ? "text-emerald-600" : ""}>{formatCurrency(diferenciaTotal)}</span> <span className="text-xs font-normal text-zinc-500">(sin IVA; positivo = la factura es más cara que la OC)</span></p>
                  {(resultado.sinAsignar.length > 0) && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={crearOcExtra} onChange={e => setCrearOcExtra(e.target.checked)} />
                      <span>Crear una OC complementaria con lo que vino sin OC o de más, atada a la factura
                        <span className="block text-xs text-zinc-500">{resultado.sinAsignar.filter(x => !aceptarDeMas.has(x.invoiceKey)).reduce((t, x) => t + x.cantidad, 0)} unidad(es). Si la destildás, quedan anotadas como «Fuera de OC».</span></span>
                    </label>
                  )}
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={aceptarCostos} onChange={e => setAceptarCostos(e.target.checked)} />
                    <span>Actualizar el costo en las OC y en los presupuestos al precio facturado <span className="block text-xs text-zinc-500">El precio de venta del presupuesto no cambia: se recalcula el margen. Queda anotado en las observaciones de la OC y del presupuesto.</span></span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 dark:border-zinc-700 pt-4">
                <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm">Cancelar</button>
                <button disabled={guardando} onClick={() => guardar(true)}
                  className="px-4 py-2 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 text-sm font-semibold disabled:opacity-40">
                  Guardar como conciliación parcial
                </button>
                <button disabled={guardando} onClick={() => guardar(false)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Confirmar y enviar a aprobación
                </button>
              </div>
              {!profileId && <p className="text-xs text-red-600">No se detectó el usuario: volvé a iniciar sesión.</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Edición manual de una línea ──
function EditorLinea({ l, asignaciones, ocsUsables, manualActual, onAplicar }: {
l: InvoiceLineInput;
asignaciones: Asignacion[];
ocsUsables: OcLinea[];
manualActual: Manual[string] | undefined;
onAplicar: (valor: Manual[string] | null) => void;
}) {
  const actuales = asignaciones.filter(a => a.invoiceKey === l.key);
  void manualActual;
  const [cant, setCant] = useState<Record<string, string>>(() => Object.fromEntries(actuales.map(a => [a.ocLineId, String(a.cantidad)])));
  const [filtro, setFiltro] = useState("");
  const v = parseVariant(l.descripcion);
  const usadoPorOtras = new Map<string, number>();
  for (const a of asignaciones) if (a.invoiceKey !== l.key) usadoPorOtras.set(a.ocLineId, (usadoPorOtras.get(a.ocLineId) || 0) + a.cantidad);
  const opciones = ocsUsables
    .map(o => ({ o, libre: round2(o.cantidad - (usadoPorOtras.get(o.id) || 0)), mismoTalle: !!v.talle && parseVariant(o.descripcion).talle === v.talle }))
    .filter(x => x.libre > 0 || cant[x.o.id])
    .filter(x => !filtro || `${x.o.ocNumero} ${x.o.descripcion} ${x.o.descripcionOc || ""}`.toLowerCase().includes(filtro.toLowerCase()))
    .sort((a, b) => Number(b.mismoTalle) - Number(a.mismoTalle) || a.o.ocFecha.localeCompare(b.o.ocFecha))
    .slice(0, 60);
  const total = Object.values(cant).reduce((s, x) => s + (parseDecimalInput(x) || 0), 0);
  return (
    <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar en las OC (número o artículo)…"
          className="flex-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-2 py-1 text-sm" />
        <span className={`text-xs font-semibold ${total > l.cantidad ? "text-red-600" : "text-zinc-600"}`}>{total} de {l.cantidad}</span>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-700 text-sm">
        {opciones.map(({ o, libre, mismoTalle }) => (
          <div key={o.id} className="flex items-center gap-2 py-1">
            <span className="font-mono text-xs w-20 shrink-0">{o.ocNumero}</span>
            <span className={`flex-1 ${mismoTalle ? "" : "text-zinc-500"}`}>{o.descripcion}{o.descripcionOc && o.descripcionOc !== o.descripcion && <span className="block text-[10px] text-zinc-400">En la OC: {o.descripcionOc}</span>}</span>
            <span className="text-xs text-zinc-500 w-24 text-right">{formatCurrency(o.precio)}</span>
            <span className="text-xs text-zinc-500 w-16 text-right">libre {libre}</span>
            <input value={cant[o.id] || ""} onChange={e => setCant(p => ({ ...p, [o.id]: e.target.value }))} inputMode="decimal"
              className="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1 py-0.5 text-right" placeholder="0" />
          </div>
        ))}
        {!opciones.length && <p className="py-2 text-zinc-500">No hay líneas de OC disponibles.</p>}
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button onClick={() => onAplicar(null)}
          className="px-3 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-600">Volver a la sugerencia</button>
        <button onClick={() => onAplicar("__extra__")}
          className="px-3 py-1 text-xs rounded border border-zinc-400 text-zinc-700 dark:text-zinc-300">Fuera de OC</button>
        <button disabled={total > l.cantidad} onClick={() => {
          const arr = Object.entries(cant).map(([ocLineId, x]) => ({ ocLineId, cantidad: parseDecimalInput(x) || 0 })).filter(a => a.cantidad > 0);
          onAplicar(arr);
        }} className="px-3 py-1 text-xs rounded bg-blue-600 text-white disabled:opacity-40">Aplicar</button>
      </div>
    </div>
  );
}
