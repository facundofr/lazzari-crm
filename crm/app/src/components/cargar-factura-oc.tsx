"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, Check, Search, Plus, Trash2, Maximize2, Minimize2, AlertTriangle } from "lucide-react";
import { formatCurrency, todayAR } from "@/lib/utils";
import { reconcilePurchaseLines, inspectPurchaseLineMatch, purchaseLineKey, canonicalPurchaseInvoiceNumber, assertCompleteInvoiceOrderSelection, canMarkPurchaseOrdersPaid, markupForFixedSalePrice, type PurchaseLine } from "@/lib/purchase-invoice-reconciliation";
import { supabase } from "@/lib/supabase/client";
import { parseVariant, tallesCompatibles } from "@/lib/purchase-matching";

// ── Types ────────────────────────────────────────────────
export interface OCParaVincular {
  id: string;
  numero: string;
  proveedor_id: string;
  proveedor_nombre: string;
  total: number;
  moneda: string;
  estado: string;
  fecha: string;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
  cuit: string | null;
}

interface CreditOriginOption {
  id: string;
  numero_factura: string;
  tipo_comprobante: string;
  fecha: string;
  total: number;
  saldo_acreditable: number;
  moneda: "ARS" | "USD";
}

interface FCItem {
  codigo?: string;
  tempId: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  iva_porcentaje: number;
  unidad: string;
}

interface OCItemForMatch extends PurchaseLine {
  id: string;
  orden_id: string;
  ocNumero: string;
  codigo_proveedor?: string | null;
  descripcion_proveedor?: string | null;
  talle?: string | null;
}

/** Cómo llama el proveedor al renglón de la OC (si la OC ya se ordenó contra su lista). Solo para comparar. */
function comoLoLlamaElProveedor(o: OCItemForMatch): OCItemForMatch {
  if (!o.codigo_proveedor && !o.descripcion_proveedor) return o;
  return {
    ...o,
    codigo: o.codigo_proveedor || o.codigo,
    descripcion: o.descripcion_proveedor ? `${o.descripcion_proveedor}${o.talle ? ` TALLE ${o.talle}` : ""}` : o.descripcion,
  };
}

const emptyNuevoProveedor = {
  razon_social: "",
  nombre_fantasia: "",
  cuit: "",
  condicion_iva: "RI",
  rubro: "",
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  forma_pago: "Transferencia",
  dias_cuenta_corriente: 30,
  limite_credito: 0,
  cbu: "",
  alias_bancario: "",
  numero_cuenta: "",
  notas: "",
};

interface Props {
  sociedadId: string;
  profileId: string | null;
  ordenes: OCParaVincular[];
  preselectedOCId?: string;
  initialImport?: { data: any; file: File };
  showTipoToggle?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const itemNeto = (item: FCItem) => (
  Number(item.cantidad) * Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100)
);
// ── Component ────────────────────────────────────────────
export default function CargarFacturaOC({
  sociedadId, profileId, ordenes, preselectedOCId, initialImport, showTipoToggle, onClose, onSuccess,
}: Props) {
  const initialOC = preselectedOCId ? ordenes.find((oc) => oc.id === preselectedOCId) : undefined;
  // ── Form state ──
  const [proveedorId, setProveedorId] = useState(initialOC?.proveedor_id || "");
  const [proveedorSearch, setProveedorSearch] = useState(initialOC?.proveedor_nombre || "");
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [proveedoresLoaded, setProveedoresLoaded] = useState(false);
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState(emptyNuevoProveedor);
  const [nuevoProveedorSaving, setNuevoProveedorSaving] = useState(false);
  const [nuevoProveedorError, setNuevoProveedorError] = useState("");
  // Datos del emisor leídos de la factura, para precargar el alta del proveedor.
  const proveedorFacturaRef = useRef<{ cuit: string; razon_social: string; nombre_fantasia?: string } | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState("FC A");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(todayAR());
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [cae, setCae] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [subtotal, setSubtotal] = useState(0);
  const [ivaPorcentaje, setIvaPorcentaje] = useState(21);
  const [percepciones, setPercepciones] = useState(0);
  const [notas, setNotas] = useState("");
  const [items, setItems] = useState<FCItem[]>([]);
  const [tipoFC, setTipoFC] = useState<"mercaderia" | "solo_iva" | "transporte">("mercaderia");
  const [costoReal, setCostoReal] = useState(0);

  // ── OC selection ──
  const [selectedOCIds, setSelectedOCIds] = useState<Set<string>>(new Set(preselectedOCId ? [preselectedOCId] : []));
  const [ocSearch, setOcSearch] = useState("");
  const [selectedOCItems, setSelectedOCItems] = useState<OCItemForMatch[]>([]);
  const [ocItemsLoading, setOCItemsLoading] = useState(false);
  const [ocItemsError, setOCItemsError] = useState("");
  const [manualItemMatches, setManualItemMatches] = useState<Record<string, string>>({});
  const [createExtrasOC, setCreateExtrasOC] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pagadaSinOP, setPagadaSinOP] = useState(false);
  const [cuitLoading, setCuitLoading] = useState(false);

  // ── File & parsing ──
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [parseError, setParseError] = useState("");

  // ── Save ──
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [linkedInvoices, setLinkedInvoices] = useState<{ total: number; moneda: string }[]>([]);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [alignmentError, setAlignmentError] = useState("");
  const [overrideOC, setOverrideOC] = useState(false);
  const [facturaOrigenId, setFacturaOrigenId] = useState("");
  const [creditoAplicado, setCreditoAplicado] = useState(0);
  const [creditOrigins, setCreditOrigins] = useState<CreditOriginOption[]>([]);
  const [creditOriginsLoading, setCreditOriginsLoading] = useState(false);
  const [creditOriginsError, setCreditOriginsError] = useState("");
  const creditRequestKeyRef = useRef<string | null>(null);
  // La IA devuelve el subtotal impreso. Se conserva una pasada para que el
  // efecto que recalcula desde renglones no lo pise inmediatamente (especialmente FC B).
  const parsedSubtotalRef = useRef<number | null>(null);

  // ── Computed ──
  const iva = useMemo(() => {
    if (items.length === 0) return Math.round(subtotal * ivaPorcentaje) / 100;
    return Math.round(items.reduce((sum, item) => (
      sum + itemNeto(item) * Number(item.iva_porcentaje || 0) / 100
    ), 0) * 100) / 100;
  }, [items, subtotal, ivaPorcentaje]);
  const total = useMemo(() => Math.round((subtotal + iva + percepciones) * 100) / 100, [subtotal, iva, percepciones]);
  const totalSinPercepciones = useMemo(() => Math.round((subtotal + iva) * 100) / 100, [subtotal, iva]);
  const isCreditNote = /^NC(?:\s|$)/i.test(tipoComprobante.trim());
  const selectedCreditOrigin = creditOrigins.find((invoice) => invoice.id === facturaOrigenId);

  // Check for duplicate invoices in real-time
  useEffect(() => {
    setDuplicateWarning("");
    const num = numeroFactura.trim();
    if (!num || !proveedorId || !sociedadId) return;
    const timer = setTimeout(async () => {
      const canonical = canonicalPurchaseInvoiceNumber(num);
      const { data } = await (supabase as any)
        .from("facturas_compra").select("id, numero_factura, estado")
        .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId);
      const dup = (data || []).find((fc: any) => canonicalPurchaseInvoiceNumber(fc.numero_factura || "") === canonical);
      if (dup) setDuplicateWarning(`Esta factura ya está cargada (estado: ${dup.estado || "registrada"})`);
    }, 500);
    return () => clearTimeout(timer);
  }, [numeroFactura, proveedorId, sociedadId]);

  useEffect(() => {
    if (!isCreditNote || !sociedadId || !proveedorId) {
      setCreditOrigins([]);
      setFacturaOrigenId("");
      setCreditoAplicado(0);
      setCreditOriginsError("");
      return;
    }
    let cancelled = false;
    setCreditOriginsLoading(true);
    setCreditOriginsError("");
    (async () => {
      try {
        const { data: invoices, error: invoicesError } = await (supabase as any)
          .from("facturas_compra")
          .select("id, numero_factura, tipo_comprobante, fecha, total, total_acreditado, moneda, estado")
          .eq("sociedad_id", sociedadId)
          .eq("proveedor_id", proveedorId)
          .eq("moneda", moneda)
          .neq("estado", "anulada")
          .not("tipo_comprobante", "ilike", "NC%")
          .order("fecha", { ascending: false });
        if (invoicesError) throw invoicesError;
        const ids = (invoices || []).map((invoice: any) => invoice.id);
        const paidByInvoice: Record<string, number> = {};
        if (ids.length) {
          const [{ data: opLinks, error: opError }, { data: directPayments, error: directError }] = await Promise.all([
            (supabase as any).from("op_facturas_compra")
              .select("factura_compra_id, monto, ordenes_pago(id, estado, sociedad_id)")
              .in("factura_compra_id", ids),
            (supabase as any).from("movimientos")
              .select("factura_compra_id, monto, retencion_ganancias_monto, anulado")
              .eq("sociedad_id", sociedadId).eq("tipo", "pago").in("factura_compra_id", ids),
          ]);
          if (opError || directError) throw opError || directError;
          for (const link of opLinks || []) {
            if (link.ordenes_pago?.sociedad_id !== sociedadId || link.ordenes_pago?.estado === "anulada") continue;
            paidByInvoice[link.factura_compra_id] = (paidByInvoice[link.factura_compra_id] || 0) + Number(link.monto || 0);
          }
          for (const payment of directPayments || []) {
            if (payment.anulado) continue;
            paidByInvoice[payment.factura_compra_id] = (paidByInvoice[payment.factura_compra_id] || 0)
              + Number(payment.monto || 0) + Number(payment.retencion_ganancias_monto || 0);
          }
        }
        const options = (invoices || []).map((invoice: any) => ({
          id: invoice.id,
          numero_factura: invoice.numero_factura || "S/N",
          tipo_comprobante: invoice.tipo_comprobante || "FC",
          fecha: invoice.fecha,
          total: Number(invoice.total || 0),
          saldo_acreditable: roundMoney(Math.max(0, Number(invoice.total || 0) - Number(paidByInvoice[invoice.id] || 0))),
          moneda: (invoice.moneda || moneda) as "ARS" | "USD",
        })).filter((invoice: CreditOriginOption) => invoice.saldo_acreditable > 0.005);
        if (!cancelled) {
          setCreditOrigins(options);
          setFacturaOrigenId((current) => options.some((invoice: CreditOriginOption) => invoice.id === current) ? current : "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setCreditOrigins([]);
          setFacturaOrigenId("");
          setCreditOriginsError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las facturas acreditables");
        }
      } finally {
        if (!cancelled) setCreditOriginsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isCreditNote, sociedadId, proveedorId, moneda]);

  useEffect(() => {
    if (!isCreditNote || !selectedCreditOrigin) return;
    const maxApplicable = Math.min(total, selectedCreditOrigin.saldo_acreditable);
    setCreditoAplicado((current) => current > 0 ? Math.min(current, maxApplicable) : maxApplicable);
  }, [isCreditNote, selectedCreditOrigin?.id, selectedCreditOrigin?.saldo_acreditable, total]);

  // Filter OCs by selected proveedor (unless showAllOCs is enabled)
  const [showAllOCs, setShowAllOCs] = useState(false);
  const ocsFiltered = useMemo(() => {
    const q = ocSearch.trim().toLowerCase();
    return ordenes.filter((oc) => {
      // Las OC sin proveedor (sistema anterior) se pueden elegir siempre: al guardar quedan con el de la factura.
      if (!showAllOCs && proveedorId && oc.proveedor_id && oc.proveedor_id !== proveedorId) return false;
      if (q && !`${oc.numero} ${oc.proveedor_nombre} ${oc.estado}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [ordenes, proveedorId, ocSearch, showAllOCs]);

  const filteredProveedores = useMemo(() => {
    if (!proveedorSearch.trim()) return proveedores.slice(0, 20);
    const q = proveedorSearch.toLowerCase();
    return proveedores.filter(p =>
      p.razon_social.toLowerCase().includes(q) || (p.cuit || "").includes(q)
    ).slice(0, 20);
  }, [proveedores, proveedorSearch]);

  const selectedProvNombre = proveedores.find(p => p.id === proveedorId)?.razon_social || "";
  const selectedOCKey = useMemo(() => Array.from(selectedOCIds).sort().join("|"), [selectedOCIds]);
  const selectedOCs = useMemo(() => ordenes.filter((oc) => selectedOCIds.has(oc.id)), [ordenes, selectedOCIds]);
  const ocCurrencies = useMemo(() => new Set(selectedOCs.map((oc) => oc.moneda)), [selectedOCs]);
  const ocTotal = useMemo(() => roundMoney(selectedOCs.reduce((sum, oc) => sum + Number(oc.total || 0), 0)), [selectedOCs]);
  const alreadyInvoiced = useMemo(() => roundMoney(linkedInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0)), [linkedInvoices]);
  const remainingOC = roundMoney(ocTotal - alreadyInvoiced);
  const alignmentDifference = roundMoney(remainingOC - totalSinPercepciones);
  const selectedOCCurrencyMismatch = ocCurrencies.size > 0 && !ocCurrencies.has(moneda);
  const linkedInvoiceCurrencyMismatch = linkedInvoices.some((invoice) => invoice.moneda !== moneda);
  const currencyMismatch = selectedOCCurrencyMismatch || linkedInvoiceCurrencyMismatch;
  const canAdaptOCCurrency = selectedOCCurrencyMismatch && ocCurrencies.size === 1 && !linkedInvoiceCurrencyMismatch;
  const exceedsOC = alignmentDifference < -0.01;
  // Un excedente genera una OC abierta al guardar; solo una diferencia de
  // moneda requiere confirmación explícita para tocar la OC vinculada.
  const alignmentBlocked = selectedOCs.length > 0 && (
    Boolean(alignmentError)
    || linkedInvoiceCurrencyMismatch
    || (selectedOCCurrencyMismatch && !overrideOC)
  );

  useEffect(() => {
    setOverrideOC(false);
  }, [selectedOCKey, moneda]);

  useEffect(() => {
    if (!selectedOCKey) {
      setSelectedOCItems([]);
      setManualItemMatches({});
      setOCItemsError("");
      setCreateExtrasOC(false);
      return;
    }
    let cancelled = false;
    setOCItemsLoading(true);
    setOCItemsError("");
    (async () => {
      const ids = selectedOCKey.split("|");
      const { data, error: itemsError } = await (supabase as any)
        .from("orden_compra_items")
        .select("id, orden_id, codigo, descripcion, cantidad, precio_unitario, iva_porcentaje, unidad, codigo_proveedor, descripcion_proveedor, talle")
        .in("orden_id", ids);
      if (cancelled) return;
      if (itemsError) {
        setSelectedOCItems([]);
        setOCItemsError("No se pudieron cargar los artículos de las OC para compararlos.");
        return;
      }
      const numeroById = new Map(ordenes.map((oc) => [oc.id, oc.numero]));
      const mapped = (data || []).map((item: any) => ({
        ...item,
        cantidad: Number(item.cantidad || 0),
        precio_unitario: Number(item.precio_unitario || 0),
        ocNumero: numeroById.get(item.orden_id) || "OC",
      })) as OCItemForMatch[];
      setSelectedOCItems(mapped);
      const validIds = new Set(mapped.map((item) => item.id));
      setManualItemMatches((current) => Object.fromEntries(
        Object.entries(current).filter(([, target]) => target === "__extra__" || validIds.has(target))
      ));
    })().finally(() => { if (!cancelled) setOCItemsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedOCKey, ordenes]);

  // ── Memoria del proveedor: equivalencias aprendidas en cargas anteriores ──
  const [equivalenciasProv, setEquivalenciasProv] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!proveedorId || !sociedadId) { setEquivalenciasProv({}); return; }
    let cancelado = false;
    (supabase as any).from("proveedor_equivalencias").select("producto_factura, producto_oc")
      .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId)
      .then(({ data }: any) => {
        if (cancelado) return;
        const m: Record<string, string[]> = {};
        for (const e of (data || []) as Array<{ producto_factura: string; producto_oc: string }>) (m[e.producto_factura] ||= []).push(e.producto_oc);
        setEquivalenciasProv(m);
      });
    return () => { cancelado = true; };
  }, [proveedorId, sociedadId]);

  // Para comparar se usa el nombre del proveedor; para guardar, siempre el renglón original.
  const ocItemsComparables = useMemo(() => selectedOCItems.map(comoLoLlamaElProveedor), [selectedOCItems]);

  const itemComparisons = useMemo(() => items.map((item) => {
    const manualTarget = manualItemMatches[item.tempId];
    if (manualTarget === "__extra__") return { item, status: "unmatched" as const, matched: null, manual: true, aprendido: false };
    if (manualTarget) {
      const matched = selectedOCItems.find((candidate) => candidate.id === manualTarget) || null;
      return { item, status: matched ? "matched" as const : "unmatched" as const, matched, manual: true, aprendido: false };
    }
    const inspection = inspectPurchaseLineMatch(ocItemsComparables, item);
    if (inspection.status === "matched" && inspection.candidates.length === 1) {
      return { item, status: "matched" as const, matched: selectedOCItems.find((candidate) => candidate.id === inspection.candidates[0].id) || null, manual: false, aprendido: false };
    }
    // Equivalencia aprendida de este proveedor (mismo artículo con otro nombre, mismo talle).
    const v = parseVariant(item.descripcion);
    const aprendidos = equivalenciasProv[v.producto] || [];
    if (aprendidos.length) {
      const cand = ocItemsComparables.filter((o) => {
        const ov = parseVariant(o.descripcion);
        return aprendidos.includes(ov.producto) && tallesCompatibles(v.talle, ov.talle);
      });
      if (cand.length === 1) {
        return { item, status: "matched" as const, matched: selectedOCItems.find((c) => c.id === cand[0].id) || null, manual: false, aprendido: true };
      }
    }
    return { item, status: inspection.status, matched: null, manual: false, aprendido: false };
  }), [items, selectedOCItems, ocItemsComparables, manualItemMatches, equivalenciasProv]);

  // Vínculos efectivos para guardar: los automáticos (incluidos los aprendidos) + los manuales.
  const asignacionesEfectivas = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of itemComparisons) if (!c.manual && c.status === "matched" && c.matched) m[c.item.tempId] = c.matched.id;
    return { ...m, ...manualItemMatches };
  }, [itemComparisons, manualItemMatches]);

  const unresolvedItemCount = itemComparisons.filter((comparison) => comparison.status !== "matched").length;

  // ── Sugerencias de la IA para los artículos que no coinciden por código/nombre ──
  const [aiMatching, setAiMatching] = useState(false);
  const [aiMotivos, setAiMotivos] = useState<Record<string, string>>({});
  const [aiMatchMsg, setAiMatchMsg] = useState("");
  const aiRunKey = useRef("");
  async function sugerirConIA() {
    const pendientes = itemComparisons.filter((c) => c.status !== "matched" && !manualItemMatches[c.item.tempId]);
    if (!pendientes.length || !selectedOCItems.length) return;
    setAiMatching(true); setAiMatchMsg("");
    try {
      const factura = pendientes.map((c) => ({ key: c.item.tempId, codigo: c.item.codigo || null, descripcion: c.item.descripcion, cantidad: Number(c.item.cantidad) || 0, precio: Number(c.item.precio_unitario) || 0 }));
      const ocs = selectedOCItems.map((o) => ({ id: o.id, ocId: o.orden_id, ocNumero: o.ocNumero, ocFecha: "", codigo: o.codigo || null, descripcion: o.descripcion, cantidad: Number(o.cantidad) || 0, precio: Number(o.precio_unitario) || 0 }));
      const res = await fetch("/api/conciliar-compra", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proveedor: selectedProvNombre, factura, ocs }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "La IA no respondió");
      const nuevos: Record<string, string> = {}; const mot: Record<string, string> = {};
      for (const c of pendientes) {
        const v = parseVariant(c.item.descripcion);
        const prodsOC: string[] = j.equivalencias?.[v.producto] || [];
        if (!prodsOC.length) continue;
        const usados = new Set(Object.values({ ...manualItemMatches, ...nuevos }));
        const cands = selectedOCItems.filter((o) => prodsOC.includes(parseVariant(o.descripcion).producto) && !usados.has(o.id));
        const elegido = cands.find((o) => !v.talle || parseVariant(o.descripcion).talle === v.talle) || cands[0];
        if (!elegido) continue;
        nuevos[c.item.tempId] = elegido.id;
        mot[c.item.tempId] = `Sugerido por IA (confianza ${j.confianza?.[v.producto] || "media"})${j.motivo?.[v.producto] ? ` · ${j.motivo[v.producto]}` : ""}`;
      }
      setManualItemMatches((cur) => ({ ...cur, ...nuevos }));
      setAiMotivos((m) => ({ ...m, ...mot }));
      const n = Object.keys(nuevos).length;
      setAiMatchMsg(n ? `La IA vinculó ${n} artículo(s). Revisalos.` : "La IA no encontró equivalencias en esta OC.");
    } catch (e) {
      setAiMatchMsg(e instanceof Error ? e.message : "No se pudo consultar a la IA");
    } finally { setAiMatching(false); }
  }
  // Se ejecuta sola una vez por combinación de OC + artículos.
  useEffect(() => {
    if (ocItemsLoading || !selectedOCItems.length || aiMatching) return;
    const key = `${selectedOCKey}::${items.map((i) => i.tempId).join(",")}`;
    if (aiRunKey.current === key) return;
    if (!itemComparisons.some((c) => c.status !== "matched" && !manualItemMatches[c.item.tempId])) return;
    aiRunKey.current = key;
    void sugerirConIA();
  }, [ocItemsLoading, selectedOCItems, selectedOCKey, items]);

  async function fetchLinkedInvoicesForOCs(ids: string[]) {
    const [{ data: junctionLinks, error: junctionError }, { data: legacyInvoices, error: legacyError }] = await Promise.all([
      (supabase as any)
        .from("factura_compra_ocs")
        .select("factura_compra_id, facturas_compra(id, estado, total, percepciones, moneda, sociedad_id)")
        .in("orden_compra_id", ids),
      (supabase as any)
        .from("facturas_compra")
        .select("id, estado, total, percepciones, moneda, sociedad_id")
        .eq("sociedad_id", sociedadId)
        .in("orden_compra_id", ids),
    ]);
    if (junctionError || legacyError) {
      throw new Error("No se pudo verificar lo ya facturado para estas OC.");
    }

    const byId = new Map<string, { id: string; estado: string; total: number; moneda: string }>();
    for (const link of junctionLinks || []) {
      const raw = Array.isArray(link.facturas_compra) ? link.facturas_compra[0] : link.facturas_compra;
      if (!raw || raw.sociedad_id !== sociedadId || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { id: raw.id, estado: raw.estado, total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    for (const raw of legacyInvoices || []) {
      if (!raw || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { id: raw.id, estado: raw.estado, total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    return Array.from(byId.values());
  }

  useEffect(() => {
    if (items.length > 0) {
      if (parsedSubtotalRef.current != null) {
        setSubtotal(parsedSubtotalRef.current);
        parsedSubtotalRef.current = null;
        return;
      }
      setSubtotal(roundMoney(items.reduce((sum, item) => sum + itemNeto(item), 0)));
    }
  }, [items]);

  useEffect(() => {
    if (!selectedOCKey) {
      setLinkedInvoices([]);
      setAlignmentError("");
      return;
    }

    let cancelled = false;
    setAlignmentLoading(true);
    setAlignmentError("");
    (async () => {
      const ids = selectedOCKey.split("|");
      try {
        const invoices = await fetchLinkedInvoicesForOCs(ids);
        if (!cancelled) setLinkedInvoices(invoices);
      } catch (loadError) {
        if (!cancelled) {
          setAlignmentError(loadError instanceof Error ? loadError.message : "No se pudo verificar las OC.");
          setLinkedInvoices([]);
        }
      }
      if (cancelled) return;
      setAlignmentLoading(false);
    })();

    return () => { cancelled = true; };
  }, [selectedOCKey]);

  useEffect(() => {
    void loadProveedores();
  }, [sociedadId]);

  async function lookupNuevoProveedor(cuitDirecto?: string) {
    const cuit = (cuitDirecto ?? nuevoProveedor.cuit).replace(/\D/g, "");
    if (cuit.length !== 11) { setNuevoProveedorError("El CUIT debe tener 11 dígitos"); return; }
    setCuitLoading(true);
    setNuevoProveedorError("");
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${cuit}`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo consultar AFIP");
      setNuevoProveedor((prev) => ({
        ...prev,
        cuit,
        razon_social: data.razon_social || prev.razon_social,
        condicion_iva: data.condicion_iva || prev.condicion_iva,
        direccion: data.direccion || prev.direccion,
        localidad: data.localidad || prev.localidad,
        provincia: data.provincia || prev.provincia,
      }));
    } catch (err) {
      setNuevoProveedorError(err instanceof Error ? err.message : "No se pudo consultar AFIP");
    } finally {
      setCuitLoading(false);
    }
  }

  // ── Load proveedores ──
  async function loadProveedores() {
    if (proveedoresLoaded) return;
    try {
      let q = supabase.from("proveedores").select("id, razon_social, cuit").eq("activo", true).order("razon_social");
      if (sociedadId) q = q.eq("sociedad_id" as any, sociedadId);
      const { data } = await q;
      if (data) setProveedores(data as ProveedorOption[]);
    } catch { /* noop */ }
    setProveedoresLoaded(true);
  }

  function openNuevoProveedor() {
    const fact = proveedorFacturaRef.current;
    const cuitFact = (fact?.cuit || "").replace(/\D/g, "");
    setNuevoProveedor({ ...emptyNuevoProveedor, razon_social: proveedorSearch.trim() || fact?.razon_social || "", nombre_fantasia: fact?.nombre_fantasia || "", cuit: cuitFact });
    setNuevoProveedorError("");
    setNuevoProveedorOpen(true);
    // Con el CUIT de la factura se traen solos los datos de ARCA (razón social, IVA, domicilio).
    if (cuitFact.length === 11) void lookupNuevoProveedor(cuitFact);
  }

  async function handleCrearProveedor() {
    if (!nuevoProveedor.razon_social.trim() || !nuevoProveedor.cuit.trim()) {
      setNuevoProveedorError("Razón social y CUIT son obligatorios");
      return;
    }
    setNuevoProveedorSaving(true);
    setNuevoProveedorError("");
    try {
      const { data, error: insertError } = await (supabase as any)
        .from("proveedores")
        .insert({
          ...nuevoProveedor,
          razon_social: nuevoProveedor.razon_social.trim(),
          nombre_fantasia: nuevoProveedor.nombre_fantasia.trim() || null,
          cuit: nuevoProveedor.cuit.trim(),
          cuit_titular_cuenta: nuevoProveedor.cuit.trim(),
          sociedad_id: sociedadId,
          created_by: profileId,
        })
        .select("id, razon_social, cuit")
        .single();
      if (insertError || !data) throw new Error(insertError?.message || "No se pudo crear el proveedor");

      const created = data as ProveedorOption;
      setProveedores(prev => [...prev.filter(p => p.id !== created.id), created].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
      setProveedorId(created.id);
      setProveedorSearch(created.razon_social);
      setSelectedOCIds(new Set());
      setNuevoProveedorOpen(false);
    } catch (err: any) {
      setNuevoProveedorError(err?.message || "Error al crear el proveedor");
    } finally {
      setNuevoProveedorSaving(false);
    }
  }

  // ── Parse PDF ──
  async function handleParseFile(f: File) {
    setFile(f);
    setParsing(true);
    setParseError("");
    setParsed(false);

    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setParseError(json.error || "Error al procesar el archivo");
        return;
      }

      const d = json.data;
      // Si la IA no reconoció la NC/ND pero el archivo se llama "N_C A-…" / "NC B …" / "N_D A…", se usa el nombre.
      const nombre = f.name.toUpperCase();
      const porNombre = nombre.match(/^N[\s_\-/.]?([CD])[\s_\-]+([ABC])\b/);
      if (porNombre && !/CR[EÉ]DITO|D[EÉ]BITO|^N[CD]/i.test(String(d?.tipo_comprobante || ""))) {
        d.tipo_comprobante = `${porNombre[1] === "C" ? "NOTA DE CREDITO" : "NOTA DE DEBITO"} ${porNombre[2]}`;
      }

      await applyImportedData(d);
      setParsed(true);
    } catch (err: any) {
      setParseError(err.message || "Error al procesar");
    } finally {
      setParsing(false);
    }
  }

  async function applyImportedData(d: any) {
      // Detect nota de pedido → auto-set tipo manual + IVA 0%
      const rawTipo = (d.tipo_comprobante || "").toUpperCase().trim();
      const isNotaPedido = /NOTA\s*DE\s*PEDIDO|^NP$|^N\.?\s?P\.?$/.test(rawTipo) || (!d.cae && /PEDIDO|PRESUPUESTO|COTIZACI[OÓ]N|PROFORMA/.test(rawTipo));

      // Auto-fill form
      if (isNotaPedido) {
        setTipoComprobante("FC Manual");
      } else if (d.tipo_comprobante && /CR[EÉ]DITO|^N\.?\s?\/?\s?C\b|^NC/.test(rawTipo)) {
        // Nota de crédito: "NOTA DE CREDITO A", "NC A", "N/C B", "NOTA DE CRÉDITO ELECTRÓNICA MIPYME (FCE) A"…
        const letra = /\bB\b|\sB$/.test(rawTipo) ? "B" : /\bC\b|\sC$/.test(rawTipo) ? "C" : "A";
        setTipoComprobante(/FCE|MIPYME/.test(rawTipo) && letra !== "C" ? `NC FCE ${letra}` : `NC ${letra}`);
      } else if (d.tipo_comprobante && /D[EÉ]BITO|^N\.?\s?\/?\s?D\b|^ND/.test(rawTipo)) {
        const letra = /\bB\b|\sB$/.test(rawTipo) ? "B" : /\bC\b|\sC$/.test(rawTipo) ? "C" : "A";
        setTipoComprobante(`ND ${letra}`);
      } else if (d.tipo_comprobante) {
        const tc = rawTipo;
        if (tc === "A" || tc === "FACTURA A") setTipoComprobante("FC A");
        else if (tc === "B" || tc === "FACTURA B") setTipoComprobante("FC B");
        else if (tc === "C" || tc === "FACTURA C") setTipoComprobante("FC C");
        else if (["FC A", "FC B", "FC C", "FC Manual", "ND A", "ND B", "ND C", "NC A", "NC B", "NC C", "NC FCE A", "NC FCE B", "Recibo"].includes(d.tipo_comprobante)) setTipoComprobante(d.tipo_comprobante);
      }
      if (d.numero_factura) setNumeroFactura(d.numero_factura);
      if (d.fecha) setFecha(d.fecha);
      if (d.fecha_vencimiento) setFechaVencimiento(d.fecha_vencimiento);
      if (d.cae) setCae(d.cae);
      if (d.moneda) setMoneda(d.moneda === "USD" ? "USD" : "ARS");
      if (d.subtotal != null) {
        parsedSubtotalRef.current = Number(d.subtotal) || 0;
        setSubtotal(parsedSubtotalRef.current);
      }
      setIvaPorcentaje(isNotaPedido ? 0 : (d.iva_porcentaje != null ? (Number(d.iva_porcentaje) || 0) : 21));
      if (d.percepciones && !isNotaPedido) setPercepciones(Number(d.percepciones) || 0);
      if (d.notas) setNotas(d.notas);

      // Auto-fill items
      setManualItemMatches({});
      setCreateExtrasOC(false);
      if (d.items && Array.isArray(d.items) && d.items.length > 0) {
        setItems(d.items.map((it: any, idx: number) => ({
          tempId: `ai-${Date.now()}-${idx}`,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          cantidad: it.cantidad == null ? 1 : Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario) || 0,
          descuento_porcentaje: Math.max(0, Math.min(100, Number(it.descuento_porcentaje ?? d.descuento_general_porcentaje) || 0)),
          iva_porcentaje: isNotaPedido ? 0 : (it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21),
          unidad: it.unidad || "UN",
        })));
      } else {
        setItems([]);
      }

      proveedorFacturaRef.current = d.proveedor ? { cuit: String(d.proveedor.cuit || ""), razon_social: String(d.proveedor.razon_social || ""), nombre_fantasia: String(d.proveedor.nombre_fantasia || "") } : null;
      // Match proveedor by CUIT
      if (d.proveedor?.cuit) {
        await loadProveedores();
        const cuitClean = String(d.proveedor.cuit).replace(/\D/g, "");
        // Need to wait for proveedores to be set — use direct query
        let q = supabase.from("proveedores").select("id, razon_social, cuit").eq("activo", true);
        if (sociedadId) q = q.eq("sociedad_id" as any, sociedadId);
        const { data: provs } = await q;
        if (provs) {
          setProveedores(provs as ProveedorOption[]);
          setProveedoresLoaded(true);
          const match = provs.find((p: any) => p.cuit?.replace(/\D/g, "") === cuitClean);
          if (match) {
            setProveedorId(match.id);
            setProveedorSearch(match.razon_social);
          } else if (d.proveedor.razon_social) {
            setProveedorSearch(d.proveedor.razon_social);
          }
        }
      }


  }
  useEffect(() => {
    if (!initialImport) return;
    setFile(initialImport.file);
    void applyImportedData(initialImport.data).then(() => setParsed(true)).catch(e => setParseError(e.message || "Error al importar"));
  }, [initialImport?.file]);

  // ── Toggle OC ──
  function toggleOC(ocId: string) {
    setSelectedOCIds(prev => {
      const next = new Set(prev);
      if (next.has(ocId)) next.delete(ocId);
      else next.add(ocId);
      return next;
    });
  }

  async function validateOCAlignmentLive() {
    const ids = Array.from(selectedOCIds);
    const { data: freshOCs, error: ocError } = await (supabase as any)
      .from("ordenes_compra")
      .select("id, numero, subtotal, iva, total, moneda, sociedad_id, proveedor_id, estado, observaciones, presupuesto_origen_id, orden_compra_items(id, orden_id, codigo, descripcion, cantidad, precio_unitario, iva_porcentaje, unidad)")
      .eq("sociedad_id", sociedadId)
      .in("id", ids);
    if (ocError || !freshOCs || freshOCs.length !== ids.length) {
      throw new Error("No se pudieron verificar los importes actuales de las OC. No se guardó nada.");
    }

    if (freshOCs.some((oc: any) => (oc.proveedor_id && oc.proveedor_id !== proveedorId) || ["cancelada", "borrador"].includes(oc.estado))) {
      throw new Error("Las OC deben estar activas y pertenecer al proveedor de la factura.");
    }
    // OC sin proveedor: se les asigna el proveedor de la factura.
    const sinProveedor = freshOCs.filter((oc: any) => !oc.proveedor_id).map((oc: any) => oc.id);
    if (sinProveedor.length) {
      const { error: provError } = await (supabase as any).from("ordenes_compra").update({ proveedor_id: proveedorId })
        .eq("sociedad_id", sociedadId).in("id", sinProveedor).is("proveedor_id", null);
      if (provError) throw new Error(`No se pudo asignar el proveedor a la OC: ${provError.message}`);
      freshOCs.forEach((oc: any) => { if (!oc.proveedor_id) oc.proveedor_id = proveedorId; });
    }
    const currencies = new Set(freshOCs.map((oc: any) => oc.moneda));
    const liveCurrencyMismatch = currencies.size !== 1 || !currencies.has(moneda);
    if (liveCurrencyMismatch && !(overrideOC && currencies.size === 1)) {
      throw new Error(`La factura está en ${moneda} y las OC seleccionadas están en otra moneda.`);
    }

    const previousInvoices = await fetchLinkedInvoicesForOCs(ids);
    if (previousInvoices.some((invoice) => invoice.moneda !== moneda)) {
      throw new Error("Hay facturas anteriores vinculadas en otra moneda. Revisá la OC antes de continuar.");
    }

    const freshOCTotal = roundMoney(freshOCs.reduce((sum: number, oc: any) => sum + Number(oc.total || 0), 0));
    const previousTotal = roundMoney(previousInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
    const remaining = roundMoney(freshOCTotal - previousTotal);
    // Un excedente se registra en una OC abierta separada al guardar. No se
    // modifica la OC original ni se permite que el importe desaparezca.
    return { remaining, partial: remaining - totalSinPercepciones > 0.01, freshOCs, previousInvoices };
  }

  // ── Save ──
  async function handleSave() {
    if (!sociedadId) { setError("Seleccioná una sociedad"); return; }
    if (!proveedorId) { setError("Seleccioná un proveedor"); return; }
    if (!numeroFactura.trim()) { setError("Ingresá el número de factura"); return; }
    if (subtotal <= 0) { setError("El subtotal debe ser mayor a 0"); return; }
    // La OC es opcional: si no se eligió ninguna, se avisa pero se puede guardar igual.
    if (!isCreditNote && tipoFC === "mercaderia" && selectedOCIds.size === 0 && ocsFiltered.length > 0
      && !window.confirm("No elegiste ninguna orden de compra. ¿Guardar la factura igual, sin OC?")) return;
    // La NC puede quedar sin factura: el total queda como crédito disponible para usar en una Orden de Pago.
    if (isCreditNote && facturaOrigenId && (!Number.isFinite(creditoAplicado) || creditoAplicado < 0 || !selectedCreditOrigin || creditoAplicado > selectedCreditOrigin.saldo_acreditable + 0.005 || creditoAplicado > total + 0.005)) {
      setError("El monto aplicado no puede superar el total de la nota ni el saldo de la factura elegida"); return;
    }
    const isMercaderia = tipoFC === "mercaderia";

    setSaving(true);
    setError("");
    let savedFacturaId: string | null = null;
    let generateExtrasOC = createExtrasOC;

    try {
      // Evitar duplicar una factura del mismo proveedor y número dentro de la
      // sociedad antes de insertar y generar saldos/pagos duplicados.
      const normalizedNumero = numeroFactura.trim();
      let duplicateFactura: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: providerFacturas, error: duplicateError } = await (supabase as any)
          .from("facturas_compra").select("id, numero_factura, estado")
          .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId)
          .order("id").range(offset, offset + 499);
        if (duplicateError) throw new Error(`No se pudo validar duplicados: ${duplicateError.message}`);
        duplicateFactura = (providerFacturas || []).filter((invoice: any) => canonicalPurchaseInvoiceNumber(invoice.numero_factura || "") === canonicalPurchaseInvoiceNumber(normalizedNumero));
        if (duplicateFactura.length || (providerFacturas || []).length < 500) break;
      }
      if (duplicateFactura?.length) {
        throw new Error(`La factura ${normalizedNumero} de este proveedor ya está cargada (estado ${duplicateFactura[0].estado || "registrada"}). Revisá antes de continuar.`);
      }

      let alignmentResult: Awaited<ReturnType<typeof validateOCAlignmentLive>> | null = null;
      if (!isCreditNote && isMercaderia && selectedOCIds.size > 0) {
        alignmentResult = await validateOCAlignmentLive();
      }

      let reconciliation: ReturnType<typeof reconcilePurchaseLines> | null = null;
      const verifiedPresupuestos = new Map<string, any>();
      const verifiedMarkupByItemId = new Map<string, number>();
      if (alignmentResult) {
        const previousInvoices = await fetchLinkedInvoicesForOCs(Array.from(selectedOCIds));
        let previousItems: PurchaseLine[] = [];
        if (previousInvoices.length) {
          const { data: previousOrders, error: previousOrdersError } = await (supabase as any).from("facturas_compra")
            .select("id, numero_factura, orden_compra_id, ordenes_compra(numero), factura_compra_ocs(orden_compra_id, ordenes_compra(numero))")
            .eq("sociedad_id", sociedadId).in("id", previousInvoices.map(i => i.id));
          if (previousOrdersError) throw previousOrdersError;
          assertCompleteInvoiceOrderSelection(Array.from(selectedOCIds), (previousOrders || []).flatMap((invoice: any) => [
            { orden_compra_id: invoice.orden_compra_id, numero: invoice.ordenes_compra?.numero },
            ...(invoice.factura_compra_ocs || []).map((link: any) => ({ orden_compra_id: link.orden_compra_id, numero: link.ordenes_compra?.numero })),
          ]));
          const { data, error: priorError } = await (supabase as any).from("facturas_compra_items")
            .select("factura_compra_id, codigo, descripcion, cantidad, precio_unitario")
            .eq("sociedad_id", sociedadId).in("factura_compra_id", previousInvoices.map(i => i.id));
          if (priorError) throw priorError;
          if (items.length > 0) {
            const invoicesWithItems = new Set((data || []).map((it: any) => it.factura_compra_id));
            const withoutItems = (previousOrders || []).filter((invoice: any) => !invoicesWithItems.has(invoice.id));
            if (withoutItems.length) throw new Error(`Las facturas anteriores ${withoutItems.map((invoice: any) => invoice.numero_factura).join(", ")} no tienen detalle de artículos. Completá ese detalle antes de conciliar cantidades y generar una OC adicional. No se guardó nada.`);
          }
          previousItems = data || [];
        }
        reconciliation = reconcilePurchaseLines(
          alignmentResult.freshOCs.flatMap((oc: any) => oc.orden_compra_items || []),
          items,
          previousItems,
          asignacionesEfectivas,
        );
        for (const oc of alignmentResult.freshOCs) {
          const costChanges = reconciliation.costs.filter(change =>
            change.line.orden_id === oc.id
            && (
              overrideOC
              || Math.abs(Number(change.line.precio_unitario) - change.cost) >= 0.005
              || Number(change.line.iva_porcentaje ?? 21) !== change.vat
            )
          );
          if (!costChanges.length) continue;
          if (!oc.presupuesto_origen_id && /Consolidado de|\[PR_ITEMS:/i.test(oc.observaciones || "")) {
            throw new Error(`La OC ${oc.numero} consolida varios presupuestos y la factura modifica sus costos. Falta la distribución automática por presupuesto: conciliá primero los costos de esta OC y de sus PR de origen, y después cargá la factura. Esta factura no se guardó.`);
          }
          if (!oc.presupuesto_origen_id) continue;
          const { data: pr, error: prError } = await (supabase as any).from("presupuestos")
            .select("id, observaciones, moneda, tipo_cambio, tipo_cambio_divisas, presupuesto_items(id, codigo, descripcion, cantidad, precio_costo, costo_moneda, markup_porcentaje, precio_venta)")
            .eq("id", oc.presupuesto_origen_id).eq("sociedad_id", sociedadId).single();
          if (prError || !pr) throw new Error(`No se pudo comprobar el presupuesto de la OC ${oc.numero}. No se guardó la factura.`);
          for (const change of costChanges) {
            const matching = (pr.presupuesto_items || []).filter((it: PurchaseLine) => purchaseLineKey(it) === purchaseLineKey(change.line) || ((!it.codigo || !change.line.codigo) && purchaseLineKey({ ...it, codigo: null }) === purchaseLineKey({ ...change.line, codigo: null })));
            if (matching.length !== 1) throw new Error(`El artículo «${change.line.descripcion}» no tiene una correspondencia única en el presupuesto de ${oc.numero}. Corregí el código o la vinculación antes de guardar la factura.`);
            const prItem = matching[0] as any;
            const recalculatedMarkup = markupForFixedSalePrice(Number(prItem.precio_venta || 0), change.cost, moneda, pr.moneda, Number(pr.tipo_cambio || 0), Number(pr.tipo_cambio_divisas || 0));
            if (recalculatedMarkup === null) throw new Error(`No se puede recalcular el markup de «${change.line.descripcion}» sin un costo, precio de venta y tipo de cambio válidos. No se guardó la factura.`);
            verifiedMarkupByItemId.set(prItem.id, recalculatedMarkup);
          }
          verifiedPresupuestos.set(pr.id, pr);
        }
        generateExtrasOC = createExtrasOC && reconciliation.extras.length > 0;
        // Si sobran artículos y no se marcó la opción, se pregunta (nunca se traba la carga).
        if (!createExtrasOC && reconciliation.extras.length > 0 && selectedOCItems.length > 0) {
          const lista = reconciliation.extras.slice(0, 12).map((it: any) => `• ${it.cantidad} × ${it.codigo ? `[${it.codigo}] ` : ""}${it.descripcion}`).join("\n");
          const mas = reconciliation.extras.length > 12 ? `\n… y ${reconciliation.extras.length - 12} más` : "";
          generateExtrasOC = window.confirm(`Hay ${reconciliation.extras.length} artículo(s) de la factura que no están en las OC elegidas:\n\n${lista}${mas}\n\n¿Querés crear una OC nueva con los artículos sobrantes?\n\nAceptar = crear la OC · Cancelar = cargar la factura igual, sin OC para esos artículos`);
          if (generateExtrasOC) setCreateExtrasOC(true);
        }
      }

      // Insert FC
      const insertData: Record<string, unknown> = {
        numero_factura: numeroFactura.trim(),
        tipo_comprobante: tipoComprobante,
        proveedor_id: proveedorId,
        fecha,
        fecha_vencimiento: fechaVencimiento || null,
        subtotal,
        iva_porcentaje: ivaPorcentaje,
        iva,
        percepciones,
        total,
        moneda,
        estado: pagadaSinOP ? "pagada" : "pendiente_aprobacion",
        tipo: tipoFC,
        solo_iva: tipoFC !== "mercaderia",
        notas: notas || null,
        cae: cae || null,
        sociedad_id: sociedadId,
        created_by: profileId,
      };

      const invoiceItems = items.map(it => ({
        codigo: it.codigo || null,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        descuento_porcentaje: it.descuento_porcentaje,
        unidad: it.unidad,
        iva_porcentaje: it.iva_porcentaje,
      }));
      let fcData: { id: string } | null = null;

      if (isCreditNote) {
        if (!creditRequestKeyRef.current) creditRequestKeyRef.current = crypto.randomUUID();
        const { data: creditResult, error: creditError } = await (supabase as any).rpc(
          "registrar_nota_credito_compra_v2",
          {
            p_sociedad_id: sociedadId,
            p_request_key: creditRequestKeyRef.current,
            p_factura: insertData,
            p_items: invoiceItems,
            p_aplicaciones: facturaOrigenId && creditoAplicado > 0
              ? [{ factura_compra_id: facturaOrigenId, monto: roundMoney(creditoAplicado) }]
              : [],
          }
        );
        if (creditError) throw new Error(`No se pudo registrar la nota de crédito: ${creditError.message}`);
        if (!creditResult?.factura_compra_id) throw new Error("La base no confirmó la nota de crédito. No se guardó nada.");
        fcData = { id: creditResult.factura_compra_id };
      } else if (generateExtrasOC && reconciliation?.extras.length) {
        // La factura, sus renglones, los vínculos y la OC de extras forman una
        // sola transacción. Si falla cualquier insert, PostgreSQL revierte todo.
        const extraItems = reconciliation.extras.map(it => ({
          codigo: it.codigo || "",
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          unidad: it.unidad || "u",
          precio_unitario: it.precio_unitario,
          iva_porcentaje: it.iva_porcentaje ?? 21,
        }));
        const { data: atomicResult, error: atomicError } = await (supabase as any).rpc(
          "registrar_factura_compra_con_oc_extra",
          {
            p_sociedad_id: sociedadId,
            p_factura: insertData,
            p_items: invoiceItems,
            p_orden_compra_ids: Array.from(selectedOCIds),
            p_items_extra: extraItems,
          }
        );
        if (atomicError) throw new Error(`No se pudo registrar la factura con su OC extra: ${atomicError.message}`);
        if (!atomicResult?.factura_compra_id || !atomicResult?.orden_compra_extra_id) {
          throw new Error("La base no confirmó la factura y la OC extra. No se guardó nada.");
        }
        fcData = { id: atomicResult.factura_compra_id };
      } else {
        const { data, error: fcErr } = await (supabase as any)
          .from("facturas_compra")
          .insert(insertData)
          .select("id")
          .single();
        if (fcErr) throw new Error(fcErr.message);
        fcData = data;

        if (items.length > 0 && fcData?.id) {
          const itemsInsert = invoiceItems.map(it => ({
            ...it,
            factura_compra_id: fcData!.id,
            producto_id: null,
            sociedad_id: sociedadId,
          }));
          const { error: itemsError } = await (supabase as any).from("facturas_compra_items").insert(itemsInsert);
          if (itemsError) throw new Error(`Error al guardar los items: ${itemsError.message}`);
        }

        // Insert OC links (junction table)
        if (isMercaderia && selectedOCIds.size > 0 && fcData?.id) {
          const links = Array.from(selectedOCIds).map(ocId => ({
            factura_compra_id: fcData!.id,
            orden_compra_id: ocId,
          }));
          const { error: linkErr } = await (supabase as any)
            .from("factura_compra_ocs")
            .insert(links);
          if (linkErr) throw new Error(linkErr.message);
        }
      }
      savedFacturaId = fcData?.id || null;

      // Actualizar costos por identidad de artículo, conservando cantidades y recepciones.
      if (reconciliation && alignmentResult) {
        for (const oc of alignmentResult.freshOCs) {
          const changes = reconciliation.costs.filter(c => c.line.orden_id === oc.id);
          if (!changes.length) continue;
          const history: string[] = [];
          for (const change of changes) {
            if (Math.abs(Number(change.line.precio_unitario) - change.cost) < 0.005 && Number(change.line.iva_porcentaje ?? 21) === change.vat) continue;
            const { error: updateError } = await (supabase as any).from("orden_compra_items")
              .update({ precio_unitario: change.cost, iva_porcentaje: change.vat }).eq("id", change.line.id).eq("orden_id", oc.id);
            if (updateError) throw updateError;
            history.push(`${change.line.descripcion}: ${change.line.precio_unitario} → ${change.cost} ${moneda}`);
          }
          const orderItems = (oc.orden_compra_items || []).map((it: any) => {
            const change = changes.find(c => c.line.id === it.id);
            return change ? { ...it, precio_unitario: change.cost, iva_porcentaje: change.vat } : it;
          });
          const orderNet = roundMoney(orderItems.reduce((sum: number, it: any) => sum + Number(it.cantidad) * Number(it.precio_unitario), 0));
          const orderVat = roundMoney(orderItems.reduce((sum: number, it: any) => sum + Number(it.cantidad) * Number(it.precio_unitario) * Number(it.iva_porcentaje ?? 21) / 100, 0));
          const currencyHistory = overrideOC && oc.moneda !== moneda ? `Moneda ${oc.moneda} → ${moneda}` : "";
          const historyParts = [currencyHistory, ...history].filter(Boolean);
          const historyText = historyParts.length ? `\n[${new Date().toLocaleString("es-AR")}] FC ${numeroFactura.trim()}: ${historyParts.join("; ")}` : "";
          const { error: headerError } = await (supabase as any).from("ordenes_compra")
            .update({ moneda, subtotal: orderNet, iva: orderVat, total: roundMoney(orderNet + orderVat), observaciones: `${oc.observaciones || ""}${historyText}` })
            .eq("id", oc.id).eq("sociedad_id", sociedadId);
          if (headerError) throw headerError;
          if (oc.presupuesto_origen_id && (history.length || overrideOC)) {
            const pr = verifiedPresupuestos.get(oc.presupuesto_origen_id);
            if (!pr) continue;
            for (const change of changes) {
              const matching = (pr?.presupuesto_items || []).filter((it: PurchaseLine) => purchaseLineKey(it) === purchaseLineKey(change.line) || ((!it.codigo || !change.line.codigo) && purchaseLineKey({ ...it, codigo: null }) === purchaseLineKey({ ...change.line, codigo: null })));
              if (matching.length !== 1) continue;
              const recalculatedMarkup = verifiedMarkupByItemId.get(matching[0].id);
              if (recalculatedMarkup === undefined) throw new Error(`No se pudo verificar el markup actualizado de «${change.line.descripcion}».`);
              const { error: costError } = await (supabase as any).from("presupuesto_items")
                .update({ precio_costo: change.cost, costo_moneda: moneda, markup_porcentaje: recalculatedMarkup }).eq("id", matching[0].id).eq("presupuesto_id", pr.id);
              if (costError) throw costError;
            }
            const { error: historyError } = await (supabase as any).from("presupuestos")
              .update({ observaciones: `${pr.observaciones || ""}${historyText}` }).eq("id", pr.id).eq("sociedad_id", sociedadId);
            if (historyError) throw historyError;
          }
        }
      }

      // Upload file
      if (file && fcData?.id) {
        const ext = file.name.split(".").pop() || "pdf";
        const filePath = `${sociedadId}/${fcData.id}/factura.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("facturas-compra")
          .upload(filePath, file, { upsert: true });

        if (upErr) throw new Error(`No se pudo adjuntar el archivo: ${upErr.message}`);
        if (!upErr) {
          const { data: urlData } = supabase.storage
            .from("facturas-compra")
            .getPublicUrl(filePath);
          if (urlData?.publicUrl) {
            const { error: attachmentError } = await (supabase as any).from("facturas_compra")
              .update({ archivo_url: urlData.publicUrl, archivo_nombre: file.name })
              .eq("id", fcData.id).eq("sociedad_id", sociedadId);
            if (attachmentError) throw attachmentError;
          }
        }
      }

      // Create gasto_manual for solo_iva with costo_real
      if (tipoFC === "solo_iva" && costoReal > 0 && fcData?.id) {
        await (supabase as any).from("gastos_manuales").insert({
          descripcion: `Compra crédito fiscal IVA — FC ${numeroFactura.trim()}`,
          categoria: "Impuestos",
          monto: costoReal,
          moneda,
          fecha,
          proveedor_id: proveedorId,
          sociedad_id: sociedadId,
          created_by: profileId,
          tipo_recurrencia: "eventual",
          tipo_gasto: "Compra IVA",
          medio_pago: "efectivo",
        });
      }

      // If pagadaSinOP, mark linked OCs as completadas
      const reconciledOrdersTotal = roundMoney((alignmentResult?.freshOCs || []).flatMap((oc: any) => oc.orden_compra_items || []).reduce((sum: number, it: any) => {
        const change = reconciliation?.costs.find(c => c.line.id === it.id);
        return sum + Number(it.cantidad) * (change?.cost ?? Number(it.precio_unitario)) * (1 + (change?.vat ?? Number(it.iva_porcentaje ?? 21)) / 100);
      }, 0));
      const previouslyInvoicedTotal = alignmentResult?.previousInvoices.reduce((sum, invoice) => sum + invoice.total, 0) || 0;
      if (pagadaSinOP && selectedOCIds.size > 0 && alignmentResult && reconciliation?.allQuantitiesBilled && !reconciliation.extras.length && canMarkPurchaseOrdersPaid(alignmentResult.previousInvoices, roundMoney(reconciledOrdersTotal - previouslyInvoicedTotal), totalSinPercepciones)) {
        for (const ocId of Array.from(selectedOCIds)) {
          const { error: paymentError } = await (supabase as any).from("ordenes_compra")
            .update({ estado_pago: "pagada", pago: "tarjeta" })
            .eq("id", ocId).eq("sociedad_id", sociedadId);
          if (paymentError) throw paymentError;
        }
      }

      // Memoria del proveedor: lo que vinculaste a mano queda aprendido para la próxima factura.
      if (!isCreditNote && proveedorId) {
        try {
          const eqs = Object.entries(manualItemMatches)
            .filter(([, target]) => target && target !== "__extra__")
            .map(([tempId, target]) => {
              const it = items.find((i) => i.tempId === tempId);
              const oc = ocItemsComparables.find((o) => o.id === target);
              if (!it || !oc) return null;
              const pf = parseVariant(it.descripcion).producto, po = parseVariant(oc.descripcion).producto;
              return pf && po ? { producto_factura: pf, producto_oc: po, codigo_proveedor: it.codigo || null } : null;
            })
            .filter(Boolean);
          if (eqs.length) await (supabase as any).rpc("aprender_equivalencias", { p_sociedad_id: sociedadId, p_proveedor_id: proveedorId, p_equivalencias: eqs });
        } catch { /* aprender es opcional: nunca frena la carga */ }
      }

      alert(isCreditNote ? (facturaOrigenId ? "Nota de crédito registrada y aplicada a la factura elegida" : "Nota de crédito registrada: queda como crédito disponible del proveedor") : pagadaSinOP ? "Factura cargada como pagada (sin orden de pago)" : "Factura cargada y enviada para aprobación");
      onSuccess();
    } catch (err: any) {
      setError(savedFacturaId ? `La factura ${numeroFactura} quedó registrada, pero falta completar una operación: ${err.message || "Error"}. Abrila desde Facturas de compra para revisarla; no vuelvas a cargarla.` : err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className={`bg-white dark:bg-zinc-900 w-full rounded-xl shadow-2xl ${fullscreen ? "min-h-[calc(100vh-2rem)] max-w-none" : "max-w-5xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cargar factura o nota de pedido</h2>
            <p className="text-sm text-zinc-500">Cargá el comprobante y vinculalo a las órdenes de compra correspondientes</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen((value) => !value)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" title={fullscreen ? "Reducir" : "Ampliar"}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={20} /></button>
          </div>
        </div>

        <div className={`px-6 py-5 space-y-6 overflow-y-auto ${fullscreen ? "max-h-[calc(100vh-10rem)]" : "max-h-[75vh]"}`}>
          {/* ── 1. Upload ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              1. Cargar factura
            </h3>
            {!parsed && !parsing && (
              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
                <div className="flex items-center gap-2 text-orange-600">
                  <Sparkles size={20} />
                  <span className="font-semibold">Importar con IA desde PDF o imagen</span>
                </div>
                <p className="text-xs text-zinc-400">PDF, PNG, JPG o WEBP — la IA extrae los datos automaticamente</p>
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleParseFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {parsing && (
              <div className="flex items-center gap-3 p-6 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
                <span className="text-sm font-medium text-orange-700 dark:text-orange-300">Procesando con IA...</span>
              </div>
            )}
            {parseError && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {parseError}
                <button onClick={() => { setParseError(""); setFile(null); }}
                  className="ml-3 underline text-xs">Reintentar</button>
              </div>
            )}
            {parsed && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-green-700 dark:text-green-400 text-sm">
                <Check size={16} />
                Factura procesada: <span className="font-mono font-bold">{file?.name}</span>
                <button onClick={() => { setParsed(false); setFile(null); setParseError(""); }}
                  className="ml-auto text-xs underline">Cambiar archivo</button>
              </div>
            )}
          </section>

          {/* ── Tipo toggle (solo si showTipoToggle) ── */}
          {showTipoToggle && (
            <div className="flex gap-3">
              <button type="button" onClick={() => setTipoFC("mercaderia")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "mercaderia" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "mercaderia" ? "text-orange-700 dark:text-orange-300" : "text-zinc-600 dark:text-zinc-300"}`}>Compra</span>
              </button>
              <button type="button" onClick={() => setTipoFC("transporte")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "transporte" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "transporte" ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-300"}`}>Transporte</span>
              </button>
              <button type="button" onClick={() => setTipoFC("solo_iva")}
                className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 flex-1 transition-colors ${tipoFC === "solo_iva" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                <span className={`text-sm font-semibold ${tipoFC === "solo_iva" ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-300"}`}>Solo IVA / contable</span>
              </button>
            </div>
          )}

          {/* ── 2. Datos de la factura ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              2. Datos de la factura
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Proveedor */}
              <div className="sm:col-span-2 lg:col-span-3 relative">
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Proveedor</label>
                {proveedorId ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-sm">
                    <Check size={14} className="text-green-600" />
                    <span className="font-medium">{selectedProvNombre}</span>
                    <button onClick={() => { setProveedorId(""); setProveedorSearch(""); setSelectedOCIds(new Set()); }}
                      className="ml-auto text-xs text-zinc-400 hover:text-zinc-600">Cambiar</button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Buscar por razon social o CUIT..."
                        value={proveedorSearch}
                        onFocus={loadProveedores}
                        onChange={e => setProveedorSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
                      />
                    </div>
                    {proveedorSearch && filteredProveedores.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg">
                        {filteredProveedores.map(p => (
                          <button key={p.id} onClick={() => { setProveedorId(p.id); setProveedorSearch(p.razon_social); setSelectedOCIds(new Set()); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
                            <span className="font-medium">{p.razon_social}</span>
                            {p.cuit && <span className="ml-2 text-xs text-zinc-400">{p.cuit}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={openNuevoProveedor}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-orange-300 px-3 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30"
                    >
                      <Plus size={14} />
                      {proveedorSearch.trim() ? `Crear “${proveedorSearch.trim()}” como proveedor` : "Crear proveedor nuevo"}
                    </button>
                  </>
                )}
              </div>

              {/* Tipo de comprobante */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Tipo</label>
                <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value="FC A">FC A</option>
                  <option value="FC B">FC B</option>
                  <option value="FC C">FC C</option>
                  <option value="FC Manual">FC Manual</option>
                  <option value="ND A">ND A</option>
                  <option value="ND B">ND B</option>
                  <option value="ND C">ND C</option>
                  <option value="NC A">NC A</option>
                  <option value="NC B">NC B</option>
                  <option value="NC C">NC C</option>
                  <option value="NC FCE A">NC FCE A (MiPyME)</option>
                  <option value="NC FCE B">NC FCE B (MiPyME)</option>
                  <option value="Recibo">Recibo</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>

              {/* N° Factura */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">N° Factura</label>
                <input type="text" value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)}
                  placeholder="0001-00012345"
                  className={`w-full px-3 py-2 rounded-lg border text-sm font-mono ${duplicateWarning ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"}`} />
                {duplicateWarning && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle size={12} />{duplicateWarning}</p>}
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* Vencimiento */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Vencimiento</label>
                <input type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* CAE */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">CAE</label>
                <input type="text" value={cae} onChange={e => setCae(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* Moneda */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Moneda</label>
                <select value={moneda} onChange={e => setMoneda(e.target.value as "ARS" | "USD")}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              {/* Subtotal */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Subtotal (neto)</label>
                <input type="number" step="0.01" min="0" value={subtotal || ""} onChange={e => setSubtotal(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* IVA % */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">IVA %</label>
                <select value={ivaPorcentaje} onChange={e => {
                  const value = Number(e.target.value);
                  setIvaPorcentaje(value);
                  setItems((prev) => prev.map((item) => ({ ...item, iva_porcentaje: value })));
                }}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value={0}>0% (Exento)</option>
                  <option value={10.5}>10.5%</option>
                  <option value={21}>21%</option>
                  <option value={27}>27%</option>
                </select>
              </div>

              {/* Percepciones */}
              <div>
                <label className="block text-[10px] uppercase text-zinc-400 mb-1">Percepciones</label>
                <input type="number" step="0.01" min="0" value={percepciones || ""} onChange={e => setPercepciones(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>
            </div>

            {/* Totals summary */}
            <div className="mt-3 flex items-center justify-end gap-6 text-sm">
              <span className="text-zinc-500">IVA: <span className="font-mono font-medium">{formatCurrency(iva, moneda)}</span></span>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">Total: <span className="font-mono text-orange-600">{formatCurrency(total, moneda)}</span></span>
            </div>

            {isCreditNote && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Aplicación de la nota de crédito</p>
                  <p className="text-xs text-blue-700 dark:text-blue-300">Podés aplicarla a una factura con saldo, o dejarla sin factura: el total (o lo que no apliques) queda como <b>crédito disponible</b> del proveedor y lo usás al hacer la Orden de Pago.</p>
                </div>
                {creditOriginsError && <p className="mb-3 text-xs text-red-600">{creditOriginsError}</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Factura origen</label>
                    <select
                      value={facturaOrigenId}
                      disabled={creditOriginsLoading}
                      onChange={(event) => {
                        const id = event.target.value;
                        setFacturaOrigenId(id);
                        const origin = creditOrigins.find((invoice) => invoice.id === id);
                        setCreditoAplicado(origin ? Math.min(total, origin.saldo_acreditable) : 0);
                      }}
                      className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm dark:border-blue-800 dark:bg-zinc-900"
                    >
                      <option value="">{creditOriginsLoading ? "Cargando facturas..." : "Sin factura — queda como crédito disponible"}</option>
                      {creditOrigins.map((invoice) => (
                        <option key={invoice.id} value={invoice.id}>
                          {invoice.tipo_comprobante} {invoice.numero_factura} · saldo {formatCurrency(invoice.saldo_acreditable, invoice.moneda)}
                        </option>
                      ))}
                    </select>
                    {!creditOriginsLoading && !creditOriginsError && creditOrigins.length === 0 && (
                      <p className="mt-1 text-xs text-zinc-500">No hay facturas con saldo acreditable para este proveedor y moneda.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase text-zinc-500 mb-1">Monto a aplicar</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={Math.min(total || 0, selectedCreditOrigin?.saldo_acreditable || 0)}
                      value={creditoAplicado || ""}
                      onChange={(event) => setCreditoAplicado(Number(event.target.value) || 0)}
                      className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-mono dark:border-blue-800 dark:bg-zinc-900"
                    />
                    {selectedCreditOrigin && (
                      <p className="mt-1 text-xs text-zinc-500">Máximo aplicable: {formatCurrency(Math.min(total, selectedCreditOrigin.saldo_acreditable), moneda)}
                        {total - creditoAplicado > 0.005 ? ` · Quedan ${formatCurrency(total - creditoAplicado, moneda)} como crédito disponible` : ""}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Items editables */}
            {items.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between"><p className="text-[10px] uppercase text-zinc-400">Items detectados y editables ({items.length})</p><button type="button" onClick={() => setItems((prev) => [...prev, { tempId: uid(), codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, descuento_porcentaje: 0, iva_porcentaje: ivaPorcentaje, unidad: "UN" }])} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600"><Plus size={13} /> Agregar item</button></div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full min-w-[900px] text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-500">
                        <th className="px-1 py-1 text-left w-32">Código</th>
                        <th className="px-1 py-1 text-left">Descripción</th>
                        <th className="px-1 py-1 text-right w-20">Cant.</th>
                        <th className="px-1 py-1 text-right w-28">P. Unit.</th>
                        <th className="px-1 py-1 text-right w-20">Desc. %</th>
                        <th className="px-1 py-1 text-right w-[70px]">IVA</th>
                        <th className="px-2 py-1 text-right w-28">Neto</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, index) => (
                        <tr key={it.tempId} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-1 py-1"><input value={it.codigo || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, codigo: e.target.value } : item))} placeholder="Sin código" className="w-32 rounded border border-zinc-200 bg-transparent px-2 py-1.5 font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input value={it.descripcion} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descripcion: e.target.value } : item))} className="w-full rounded border border-zinc-200 bg-transparent px-2 py-1.5 dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.cantidad} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Number(e.target.value) || 0 } : item))} className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, precio_unitario: Number(e.target.value) || 0 } : item))} className="w-28 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" max="100" step="0.01" value={it.descuento_porcentaje || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descuento_porcentaje: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : item))} placeholder="0" className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><select value={it.iva_porcentaje} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, iva_porcentaje: Number(e.target.value) } : item))} className="rounded border border-zinc-200 bg-transparent px-1 py-1.5 dark:border-zinc-700"><option value={0}>0%</option><option value={10.5}>10,5%</option><option value={21}>21%</option><option value={27}>27%</option></select></td>
                          <td className="px-2 py-1 text-right font-mono font-medium">{formatCurrency(itemNeto(it), moneda)}</td>
                          <td><button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Costo real (solo_iva) ── */}
          {tipoFC === "solo_iva" && (
            <section>
              <label className="block text-[10px] uppercase text-zinc-400 mb-1">Costo real del crédito fiscal (opcional)</label>
              <input type="number" step="0.01" value={costoReal || ""} onChange={e => setCostoReal(Number(e.target.value))}
                placeholder="Monto real pagado por el crédito fiscal"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              <p className="text-xs text-zinc-400 mt-1">Si se ingresa, se crea un gasto manual asociado.</p>
            </section>
          )}

          {/* ── 3. Vincular OCs ── */}
          {tipoFC === "mercaderia" && <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">3. Vincular órdenes de compra</h3>
                {proveedorId && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-500">
                    <input type="checkbox" checked={showAllOCs} onChange={(e) => setShowAllOCs(e.target.checked)} className="accent-orange-600 h-3 w-3" />
                    Ver todas
                  </label>
                )}
              </div>
              <div className="relative w-72 max-w-full"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" /><input value={ocSearch} onChange={(e) => setOcSearch(e.target.value)} placeholder="Buscar OC, proveedor o estado..." className="w-full rounded-lg border border-zinc-200 bg-transparent py-1.5 pl-8 pr-2 text-xs dark:border-zinc-700" /></div>
            </div>
            {ocsFiltered.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-400 italic">
                  {proveedorId
                    ? "No hay ordenes de compra activas para este proveedor"
                    : "Seleccioná un proveedor para filtrar las OCs"}
                </p>
                {proveedorId && !showAllOCs && ordenes.length > 0 && (
                  <button type="button" onClick={() => setShowAllOCs(true)}
                    className="text-xs font-medium text-orange-600 hover:text-orange-700 underline">
                    Ver todas las OCs ({ordenes.length})
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {ocsFiltered.map(oc => {
                  const sel = selectedOCIds.has(oc.id);
                  return (
                    <label key={oc.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        sel ? "bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700" : "bg-zinc-50 dark:bg-zinc-800/50 border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
                      }`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOC(oc.id)}
                        className="accent-orange-600 h-4 w-4" />
                      <div className="flex-1 min-w-0">
                        <span className="font-mono font-medium text-sm">{oc.numero}</span>
                        <span className="ml-2 text-xs text-zinc-500">{oc.proveedor_nombre}</span>
                      </div>
                      <span className="text-xs text-zinc-500">{oc.estado}</span>
                      <span className="font-mono text-sm font-medium">{formatCurrency(oc.total, oc.moneda as "ARS" | "USD")}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedOCIds.size > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-orange-600 font-medium">
                  {selectedOCIds.size} OC{selectedOCIds.size > 1 ? "s" : ""} seleccionada{selectedOCIds.size > 1 ? "s" : ""}
                </p>
                {alignmentLoading ? (
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800"><Loader2 size={14} className="animate-spin" />Verificando importes ya facturados...</div>
                ) : alignmentBlocked ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <p>{alignmentError || (linkedInvoiceCurrencyMismatch ? "La OC ya tiene facturas vinculadas en otra moneda y no se puede convertir automáticamente." : currencyMismatch ? `La factura está en ${moneda} y la OC en ${[...ocCurrencies].join("/")}.` : `El comprobante supera el saldo de las OC en ${formatCurrency(Math.abs(alignmentDifference), moneda)}.`)}</p>
                        {canAdaptOCCurrency && !alignmentError && (
                          <button type="button" onClick={() => setOverrideOC(true)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
                            Adaptar OC y costos a {moneda}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : overrideOC && selectedOCCurrencyMismatch ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>Confirmaste adaptar la OC de {[...ocCurrencies].join("/")} a {moneda}. Al guardar se actualizarán su moneda, costos y totales con los valores de esta factura.</span>
                  </div>
                ) : Math.abs(alignmentDifference) <= 0.01 ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"><Check size={15} />Importe conciliado: comprobante y OC coinciden.</div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    {alignmentDifference < 0 ? "El comprobante supera el importe actual de las OC. Se actualizarán los costos de artículos coincidentes; las cantidades adicionales crearán una OC independiente sin PR." : `Factura parcial: saldo estimado ${formatCurrency(alignmentDifference, moneda)}. Los costos finales se concilian al confirmar.`}
                  </div>
                )}
              </div>
            )}

            {selectedOCIds.size > 0 && items.length > 0 && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/40">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Comparación de artículos: factura vs. OC</p>
                    <p className="text-[11px] text-zinc-500">Las coincidencias seguras se aplican solas. Podés corregir cualquier vínculo manualmente.</p>
                  </div>
                  {!ocItemsLoading && !ocItemsError && (
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium">
                      {selectedOCItems.length > 0 && unresolvedItemCount > 0 && <button type="button" onClick={() => { aiRunKey.current = "manual"; void sugerirConIA(); }} disabled={aiMatching} className="inline-flex items-center gap-1 rounded-full border border-violet-300 px-2 py-1 text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:text-violet-300">{aiMatching ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} {aiMatching ? "La IA está comparando…" : "Sugerir con IA"}</button>}
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{itemComparisons.length - unresolvedItemCount} coinciden</span>
                      {unresolvedItemCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{unresolvedItemCount} para revisar</span>}
                    </div>
                  )}
                </div>

                {ocItemsLoading ? (
                  <div className="flex items-center gap-2 py-3 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" />Comparando artículos...</div>
                ) : ocItemsError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{ocItemsError}</div>
                ) : selectedOCItems.length === 0 ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">La OC elegida no tiene artículos cargados (por ejemplo, viene del sistema anterior). La factura se vincula por importe y no hace falta asignar artículos.</div>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {aiMatchMsg && <p className="text-[11px] font-medium text-violet-700 dark:text-violet-300">{aiMatchMsg}</p>}
                    {itemComparisons.map((comparison) => {
                      const assignedId = manualItemMatches[comparison.item.tempId] || "";
                      const isMatched = comparison.status === "matched";
                      const statusText = comparison.manual
                        ? (assignedId === "__extra__" ? "Marcado fuera de OC" : "Asignación manual")
                        : comparison.status === "matched"
                          ? (comparison.aprendido ? "Coincidencia aprendida de cargas anteriores" : "Coincidencia automática")
                          : comparison.status === "ambiguous"
                            ? "Hay varias coincidencias posibles"
                            : "No encontrado en las OC";
                      return (
                        <div key={comparison.item.tempId} className={`grid gap-2 rounded-lg border p-2.5 md:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)] ${isMatched ? "border-emerald-200 bg-white dark:border-emerald-900/60 dark:bg-zinc-900" : "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/10"}`}>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">{comparison.item.codigo ? `[${comparison.item.codigo}] ` : ""}{comparison.item.descripcion}</p>
                            <p className="text-[10px] text-zinc-500">Factura: {comparison.item.cantidad} {comparison.item.unidad || "UN"}</p>
                            <p className={`mt-1 text-[10px] font-semibold ${isMatched ? "text-emerald-600" : "text-amber-700 dark:text-amber-300"}`}>{aiMotivos[comparison.item.tempId] && assignedId && assignedId !== "__extra__" ? "Sugerido por IA" : statusText}</p>
                            {aiMotivos[comparison.item.tempId] && assignedId && assignedId !== "__extra__" && <p className="text-[10px] text-violet-700 dark:text-violet-300">{aiMotivos[comparison.item.tempId]}</p>}
                          </div>
                          <select
                            value={assignedId}
                            onChange={(event) => setManualItemMatches((current) => ({ ...current, [comparison.item.tempId]: event.target.value }))}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                          >
                            <option value="">{isMatched ? "Usar coincidencia automática" : "Sin asignar — no está en la OC"}</option>
                            <option value="__extra__">Confirmar que no está en las OC</option>
                            {selectedOCItems.map((ocItem) => (
                              <option key={ocItem.id} value={ocItem.id}>{ocItem.ocNumero} · {ocItem.codigo ? `[${ocItem.codigo}] ` : ""}{ocItem.descripcion} · {ocItem.cantidad} {ocItem.unidad || "UN"}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!ocItemsLoading && !ocItemsError && selectedOCItems.length > 0 && unresolvedItemCount > 0 && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                    <input type="checkbox" checked={createExtrasOC} onChange={(event) => setCreateExtrasOC(event.target.checked)} className="mt-0.5 accent-orange-600" />
                    <span><strong>Crear una OC adicional con las cantidades no asignadas</strong><span className="mt-0.5 block font-normal text-zinc-500">Opcional. Si no la marcás, la factura se carga igual y los artículos quedan informados como no vinculados.</span></span>
                  </label>
                )}
              </div>
            )}
          </section>}

          {/* ── Notas ── */}
          <section>
            <label className="block text-[10px] uppercase text-zinc-400 mb-1">Notas / observaciones</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              placeholder="Opcional"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
            <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700"><input type="checkbox" checked={pagadaSinOP} onChange={(e) => setPagadaSinOP(e.target.checked)} className="mt-0.5 accent-orange-600" /><span><strong>Ya pagada con tarjeta / marketplace</strong><span className="block text-xs font-normal text-zinc-500">La factura queda pagada sin generar una orden de pago ni duplicar el gasto.</span></span></label>
          </section>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <p className="text-xs text-zinc-400">
            La factura quedara pendiente de aprobacion por administracion
          </p>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || alignmentLoading || alignmentBlocked || !!duplicateWarning}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Guardando..." : "Enviar para aprobacion"}
            </button>
          </div>
        </div>
      </div>

      {nuevoProveedorOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/65 p-4">
          <div className="my-6 w-full max-w-2xl rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <div>
                <h3 className="font-bold text-zinc-900 dark:text-white">Nuevo proveedor</h3>
                <p className="text-xs text-zinc-500">Se guardará y quedará seleccionado en esta factura.</p>
              </div>
              <button type="button" onClick={() => setNuevoProveedorOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={18} /></button>
            </div>

            <div className="max-h-[72vh] overflow-y-auto p-6">
              {nuevoProveedorError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">{nuevoProveedorError}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500">Razón social *</label><input value={nuevoProveedor.razon_social} onChange={e => setNuevoProveedor({ ...nuevoProveedor, razon_social: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500">Nombre de fantasía <span className="font-normal text-zinc-400">(como figura en la lista de costos, ej. "Segutécnica")</span></label><input value={nuevoProveedor.nombre_fantasia} onChange={e => setNuevoProveedor({ ...nuevoProveedor, nombre_fantasia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">CUIT *</label><div className="mt-1 flex gap-2"><input value={nuevoProveedor.cuit} onChange={e => setNuevoProveedor({ ...nuevoProveedor, cuit: e.target.value })} placeholder="XX-XXXXXXXX-X" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800" /><button type="button" onClick={() => lookupNuevoProveedor()} disabled={cuitLoading} className="inline-flex items-center gap-1 rounded-lg border border-blue-300 px-3 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50">{cuitLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} AFIP</button></div></div>
                <div><label className="text-xs font-medium text-zinc-500">Condición IVA</label><select value={nuevoProveedor.condicion_iva} onChange={e => setNuevoProveedor({ ...nuevoProveedor, condicion_iva: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="RI">Responsable Inscripto</option><option value="Monotributo">Monotributo</option><option value="Exento">Exento</option></select></div>
                <div><label className="text-xs font-medium text-zinc-500">Rubro</label><input value={nuevoProveedor.rubro} onChange={e => setNuevoProveedor({ ...nuevoProveedor, rubro: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Email</label><input type="email" value={nuevoProveedor.email} onChange={e => setNuevoProveedor({ ...nuevoProveedor, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Teléfono</label><input value={nuevoProveedor.telefono} onChange={e => setNuevoProveedor({ ...nuevoProveedor, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Dirección</label><input value={nuevoProveedor.direccion} onChange={e => setNuevoProveedor({ ...nuevoProveedor, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Localidad</label><input value={nuevoProveedor.localidad} onChange={e => setNuevoProveedor({ ...nuevoProveedor, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Provincia</label><input value={nuevoProveedor.provincia} onChange={e => setNuevoProveedor({ ...nuevoProveedor, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Forma de pago</label><select value={nuevoProveedor.forma_pago} onChange={e => setNuevoProveedor({ ...nuevoProveedor, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cheque">Cheque</option><option value="Efectivo">Efectivo</option><option value="Cuenta corriente">Cuenta corriente</option></select></div>
                <div><label className="text-xs font-medium text-zinc-500">Días cuenta corriente</label><input type="number" value={nuevoProveedor.dias_cuenta_corriente} onChange={e => setNuevoProveedor({ ...nuevoProveedor, dias_cuenta_corriente: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Límite de crédito</label><input type="number" value={nuevoProveedor.limite_credito} onChange={e => setNuevoProveedor({ ...nuevoProveedor, limite_credito: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>

                <div className="sm:col-span-2 mt-2 border-t border-zinc-200 pt-4 dark:border-zinc-700"><h4 className="text-sm font-semibold">Datos bancarios <span className="font-normal text-zinc-400">(opcionales)</span></h4></div>
                <div><label className="text-xs font-medium text-zinc-500">CBU / CVU</label><input value={nuevoProveedor.cbu} onChange={e => setNuevoProveedor({ ...nuevoProveedor, cbu: e.target.value.replace(/\s/g, "") })} placeholder="22 dígitos" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">Alias</label><input value={nuevoProveedor.alias_bancario} onChange={e => setNuevoProveedor({ ...nuevoProveedor, alias_bancario: e.target.value })} placeholder="alias.del.proveedor" className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div><label className="text-xs font-medium text-zinc-500">N° de cuenta</label><input value={nuevoProveedor.numero_cuenta} onChange={e => setNuevoProveedor({ ...nuevoProveedor, numero_cuenta: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
                <div className="sm:col-span-2"><label className="text-xs font-medium text-zinc-500">Notas</label><textarea rows={2} value={nuevoProveedor.notas} onChange={e => setNuevoProveedor({ ...nuevoProveedor, notas: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800" /></div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
              <button type="button" onClick={() => setNuevoProveedorOpen(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600">Cancelar</button>
              <button type="button" onClick={handleCrearProveedor} disabled={nuevoProveedorSaving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">{nuevoProveedorSaving && <Loader2 size={15} className="animate-spin" />}{nuevoProveedorSaving ? "Creando..." : "Crear y seleccionar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
