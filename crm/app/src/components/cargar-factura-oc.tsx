"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { X, Loader2, Sparkles, Check, Search, Plus, Trash2, Maximize2, Minimize2, AlertTriangle } from "lucide-react";
import { formatCurrency, todayAR } from "@/lib/utils";
import { sugerirFacturaParaNC } from "@/lib/nc-sugerencia";
import { traerTarjetas, tarjetaSugerida, movimientoPagoTarjeta, registrarPagoTarjeta } from "@/lib/pago-tarjeta";
import { reconcilePurchaseLines, inspectPurchaseLineMatch, purchaseLineKey, canonicalPurchaseInvoiceNumber, assertCompleteInvoiceOrderSelection, canMarkPurchaseOrdersPaid, markupForFixedSalePrice, type PurchaseLine } from "@/lib/purchase-invoice-reconciliation";
import { supabase } from "@/lib/supabase/client";
import { parseVariant, tallesCompatibles, mismoCodigo, puntajeParecido, PUNTAJE_PARECIDO } from "@/lib/purchase-matching";
import { aprenderNombreFantasiaDeFactura } from "@/lib/nombre-fantasia";
import { useToast } from "@/components/ui/toast";
import { leerFacturaLocal, type LecturaLocal } from "@/lib/leer-factura-local";
import { duplicadosComprobanteCompra } from "@/lib/saldo-factura-compra";
import { ProveedorFormModal, type ProveedorForm } from "@/components/proveedor-form-modal";
import { CondicionPagoEditor } from "@/components/condicion-pago-editor";
import { textoCondicionPago, vencimientoFactura, type PlanPago } from "@/lib/condicion-pago";
import { equivalenciaSugerida, costoPorUnidadPR, avisoCambioCostoPR } from "@/lib/reemplazo-oc";
import { controlIva, emparejarPorPrecio, elegirOC } from "@/lib/factura-vs-oc";
import { esRenglonEnvio } from "@/lib/envio-detectar";
import { repartirEnvio, repartoPorPR } from "@/lib/envio-reparto";
import { convertirCostoPR } from "@/lib/dolar-presupuesto";
import { TIPOS_FACTURA_COMPRA, CATEGORIAS_GASTO, tipoSugerido, type TipoFacturaCompra } from "@/lib/factura-tipo";

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

interface Props {
  sociedadId: string;
  profileId: string | null;
  ordenes: OCParaVincular[];
  preselectedOCId?: string;
  initialImport?: { data: any; file: File };
  /** Carga masiva: facturas a las que conviene aplicar esta NC (citadas por la NC o cargadas en la misma tanda). */
  ncSugerida?: { asociadas: string[]; deLaTanda: string[] };
  onClose: () => void;
  onSuccess: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const itemNeto = (item: FCItem) => (
  Number(item.cantidad) * Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100)
);
const costoUnitario = (item: FCItem) => Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100);
/** Qué hacer con lo que la factura trae de más: va a la misma OC, a una OC nueva o queda solo en la factura. */
type DecisionSobrante = "oc" | "nueva" | "nada";
type Comparacion = {
  item: FCItem;
  status: "matched" | "unmatched" | "ambiguous";
  matched: OCItemForMatch | null;
  manual: boolean;
  aprendido: boolean;
  parecido?: string;
  porPrecio?: boolean;
};
// ── Component ────────────────────────────────────────────
export default function CargarFacturaOC({
  sociedadId, profileId, ordenes, preselectedOCId, initialImport, ncSugerida, onClose, onSuccess,
}: Props) {
  const { toast } = useToast();
  const initialOC = preselectedOCId ? ordenes.find((oc) => oc.id === preselectedOCId) : undefined;
  // ── Form state ──
  const [proveedorId, setProveedorId] = useState(initialOC?.proveedor_id || "");
  const [proveedorSearch, setProveedorSearch] = useState(initialOC?.proveedor_nombre || "");
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [proveedoresLoaded, setProveedoresLoaded] = useState(false);
  const [nuevoProveedorOpen, setNuevoProveedorOpen] = useState(false);
  const [nuevoProveedorInicial, setNuevoProveedorInicial] = useState<Partial<ProveedorForm>>({});
  // Datos del emisor leídos de la factura, para precargar el alta del proveedor.
  const proveedorFacturaRef = useRef<{ cuit: string; razon_social: string; nombre_fantasia?: string } | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState("FC A");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [fecha, setFecha] = useState(todayAR());
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  // Vencimiento escrito a mano (o leído de la factura): no se recalcula solo.
  const [vencimientoManual, setVencimientoManual] = useState(false);
  // Pago que pide el proveedor: el de la OC si lo tiene; si no, el del proveedor. Se guarda en la factura.
  const [planPago, setPlanPago] = useState<PlanPago>({});
  const [planProveedor, setPlanProveedor] = useState<PlanPago | null>(null);
  const [editandoPlan, setEditandoPlan] = useState(false);
  const [cae, setCae] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [subtotal, setSubtotal] = useState(0);
  const [ivaPorcentaje, setIvaPorcentaje] = useState(21);
  const [percepciones, setPercepciones] = useState(0);
  const [notas, setNotas] = useState("");
  const [items, setItems] = useState<FCItem[]>([]);
  const [tipoFC, setTipoFCState] = useState<TipoFacturaCompra>("mercaderia");
  const [categoriaGasto, setCategoriaGasto] = useState("");
  // Tipo sugerido (no traba): se deja de sugerir cuando el usuario lo toca.
  const tipoTocado = useRef(false);
  const [tipoMotivo, setTipoMotivo] = useState<"" | "proveedor" | "texto">("");
  const setTipoFC = (t: TipoFacturaCompra) => { tipoTocado.current = true; setTipoMotivo(""); setTipoFCState(t); };
  const [costoReal, setCostoReal] = useState(0);

  // ── OC selection ──
  const [selectedOCIds, setSelectedOCIds] = useState<Set<string>>(new Set(preselectedOCId ? [preselectedOCId] : []));
  const [ocSearch, setOcSearch] = useState("");
  const [selectedOCItems, setSelectedOCItems] = useState<OCItemForMatch[]>([]);
  const [ocItemsLoading, setOCItemsLoading] = useState(false);
  const [ocItemsError, setOCItemsError] = useState("");
  const [manualItemMatches, setManualItemMatches] = useState<Record<string, string>>({});
  // Renglones de la factura que REEMPLAZAN al de la OC (se compró otra medida/artículo). Valor = equivalencia
  // "1 unidad de la OC/PR = N unidades de la factura" (texto editable).
  const [reemplazos, setReemplazos] = useState<Record<string, string>>({});
  // Lo que la factura trae de más (renglón que no está en la OC o más cantidad): por defecto va a la misma OC.
  const [decisiones, setDecisiones] = useState<Record<string, DecisionSobrante>>({});
  const [verDetalle, setVerDetalle] = useState(false);
  const [cambiarOC, setCambiarOC] = useState(false);
  const [ocAuto, setOcAuto] = useState(false);
  // Total impreso y OC que nombra la factura (los lee la IA): para controlar el IVA y elegir la OC sola.
  const [totalLeido, setTotalLeido] = useState<number | null>(null);
  const [referenciasOC, setReferenciasOC] = useState<string[]>([]);
  // Factura sin OC: crear una OC nueva con sus artículos (queda recibida y atada a la factura).
  const [crearOCNueva, setCrearOCNueva] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Cómo se pagó: "" = va a orden de pago; id de una tarjeta = pagada con esa tarjeta (se registra el pago en su cuenta);
  // "otro" = ya pagada por otro medio, sin OP. La OC pagada con tarjeta o Mercado Libre sugieren la Visa (se puede cambiar).
  const [pagoTarjeta, setPagoTarjeta] = useState("");
  const pagoTarjetaTocado = useRef(false);
  const [tarjetas, setTarjetas] = useState<{ id: string; nombre: string }[]>([]);

  // ── File & parsing ──
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(false);
  const [parseError, setParseError] = useState("");
  // Lectura sin IA (QR de ARCA o texto del PDF): de dónde salieron los datos y qué revisar. null = leído con IA o nada leído.
  const [lecturaLocal, setLecturaLocal] = useState<Pick<LecturaLocal, "origen" | "avisos"> | null>(null);
  const [parsingIA, setParsingIA] = useState(false);

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
  const totalRef = useRef(total);
  totalRef.current = total;
  // NC de la carga masiva: la factura sugerida se elige una sola vez (después manda lo que elija el usuario).
  const ncSugeridaUsada = useRef(false);
  const [origenSugerido, setOrigenSugerido] = useState<{ id: string; motivo: "asociada" | "tanda" } | null>(null);
  const totalSinPercepciones = useMemo(() => Math.round((subtotal + iva) * 100) / 100, [subtotal, iva]);
  const isCreditNote = /^NC(?:\s|$)/i.test(tipoComprobante.trim());
  const pagadaSinOP = pagoTarjeta !== "" && !isCreditNote;

  // Tarjetas de la sociedad (cuentas financieras tipo tarjeta de crédito).
  useEffect(() => {
    if (!sociedadId) return;
    let cancelado = false;
    void traerTarjetas(supabase, sociedadId).then((ts) => { if (!cancelado) setTarjetas(ts); }).catch(() => {});
    return () => { cancelado = true; };
  }, [sociedadId]);

  // Sugerencia (no traba): OC ya pagada con tarjeta o compra en Mercado Libre → "Ya pagada con Visa".
  const ocIdsClave = Array.from(selectedOCIds).sort().join(",");
  useEffect(() => {
    if (pagoTarjetaTocado.current || !tarjetas.length || isCreditNote) return;
    let cancelado = false;
    (async () => {
      let ocConTarjeta = false;
      if (ocIdsClave) {
        const { data } = await (supabase as any).from("ordenes_compra").select("id, estado_pago, medio_pago").in("id", ocIdsClave.split(","));
        ocConTarjeta = (data || []).some((o: any) => o.medio_pago === "tarjeta");
      }
      if (!cancelado && !pagoTarjetaTocado.current) setPagoTarjeta(tarjetaSugerida(tarjetas, { proveedorNombre: proveedorSearch, ocConTarjeta })?.id || "");
    })();
    return () => { cancelado = true; };
  }, [ocIdsClave, tarjetas, proveedorSearch, isCreditNote]);

  // Tipo sugerido: lo último que se cargó de este proveedor (transporte / servicio) o el texto de los renglones (honorarios, alquiler, luz…).
  const descripcionesClave = items.map((it) => it.descripcion).join("|");
  useEffect(() => {
    if (tipoTocado.current || isCreditNote) return;
    let cancelado = false;
    (async () => {
      let ultimo: any = null;
      if (proveedorId && sociedadId) {
        const { data } = await (supabase as any).from("facturas_compra").select("*")
          .eq("proveedor_id", proveedorId).eq("sociedad_id", sociedadId).neq("estado", "anulada")
          .order("created_at", { ascending: false }).limit(1);
        ultimo = data?.[0] || null;
      }
      if (cancelado || tipoTocado.current) return;
      const sug = tipoSugerido({ ultimoTipo: ultimo?.tipo, ultimaCategoria: ultimo?.categoria_gasto, descripciones: descripcionesClave ? descripcionesClave.split("|") : [] });
      setTipoFCState(sug ? sug.tipo : "mercaderia");
      setTipoMotivo(sug ? sug.motivo : "");
      if (sug?.categoria) setCategoriaGasto(sug.categoria);
    })();
    return () => { cancelado = true; };
  }, [proveedorId, sociedadId, descripcionesClave, isCreditNote]);
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
          const sugerida = ncSugerida && !ncSugeridaUsada.current
            ? sugerirFacturaParaNC(options, ncSugerida.asociadas, ncSugerida.deLaTanda, Number(totalRef.current || 0)) : null;
          if (sugerida) { ncSugeridaUsada.current = true; setOrigenSugerido(sugerida); }
          setFacturaOrigenId((current) => sugerida ? sugerida.id : options.some((invoice: CreditOriginOption) => invoice.id === current) ? current : "");
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
  // Viene marcada sola si el proveedor no tiene ninguna OC abierta (ej. proveedor nuevo).
  const ocsDelProveedor = useMemo(() => (proveedorId ? ordenes.filter((oc) => oc.proveedor_id === proveedorId).length : 0), [ordenes, proveedorId]);
  useEffect(() => { setCrearOCNueva(!!proveedorId && ocsDelProveedor === 0); }, [proveedorId, ocsDelProveedor]);

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

  // Pago que pide el proveedor (de la primera OC elegida o del proveedor).
  const primeraOCId = Array.from(selectedOCIds).sort()[0] || "";
  useEffect(() => {
    let cancelado = false;
    if (!proveedorId) { setPlanPago({}); setPlanProveedor(null); return; }
    const campos = "condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago";
    (async () => {
      const db = supabase as any;
      const [prov, oc] = await Promise.all([
        db.from("proveedores").select(`${campos}, medios_pago`).eq("id", proveedorId).maybeSingle(),
        primeraOCId ? db.from("ordenes_compra").select(campos).eq("id", primeraOCId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (cancelado) return;
      const p = (prov.data || null) as PlanPago | null;
      const o = (oc.data || null) as PlanPago | null;
      setPlanProveedor(p);
      setPlanPago(o?.condicion_pago ? o : { ...(p || {}) });
      setEditandoPlan(false);
    })();
    return () => { cancelado = true; };
  }, [proveedorId, primeraOCId]);

  // Vencimiento = fecha de factura + días que pide el proveedor (si no se escribió a mano).
  const vencimientoSugerido = vencimientoFactura(fecha, planPago);
  useEffect(() => {
    if (!vencimientoManual && vencimientoSugerido) setFechaVencimiento(vencimientoSugerido);
  }, [vencimientoSugerido, vencimientoManual]);
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

  // Mismas reglas que la conciliación por línea (lib/purchase-matching): código tolerante y, si no aparece,
  // el renglón más parecido por nombre + cantidad + precio (queda en amarillo con el motivo).
  const itemComparisons = useMemo((): Comparacion[] => {
    const usadosParecido = new Set<string>();
    const base = items.map((item): Comparacion => {
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
    // Código parecido: sin ceros adelante, guiones ni el talle pegado ("01234-42" = "1234" talle 42).
    if (item.codigo && inspection.status === "unmatched") {
      const vt = parseVariant(item.descripcion).talle;
      const porCodigo = ocItemsComparables.filter((o) => {
        const ot = parseVariant(o.descripcion).talle;
        return mismoCodigo(item.codigo, vt, o.codigo, ot) && !(vt && ot && !tallesCompatibles(vt, ot));
      });
      if (porCodigo.length === 1) {
        return { item, status: "matched" as const, matched: selectedOCItems.find((c) => c.id === porCodigo[0].id) || null, manual: false, aprendido: false };
      }
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
    if (inspection.status === "unmatched") {
      const factura = { descripcion: item.descripcion, cantidad: Number(item.cantidad) || 0, precio: roundMoney(Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100)) };
      let mejor: { o: OCItemForMatch; puntaje: number; motivos: string[] } | null = null;
      for (const o of ocItemsComparables) {
        if (usadosParecido.has(o.id)) continue;
        const p = puntajeParecido(factura, { descripcion: o.descripcion, precio: Number(o.precio_unitario) || 0 }, Number(o.cantidad) || 0);
        if (p && p.puntaje >= PUNTAJE_PARECIDO && (!mejor || p.puntaje > mejor.puntaje)) mejor = { o, puntaje: p.puntaje, motivos: p.motivos };
      }
      if (mejor) {
        usadosParecido.add(mejor.o.id);
        return { item, status: "matched" as const, matched: selectedOCItems.find((c) => c.id === mejor!.o.id) || null, manual: false, aprendido: false, parecido: `Propuesto por parecido: ${mejor.motivos.join(", ")}. Revisalo.` };
      }
    }
    return { item, status: inspection.status, matched: null, manual: false, aprendido: false };
    });
    // El proveedor llama distinto a los artículos: lo que no coincidió por código o nombre se empareja por precio.
    const usados = new Set(base.filter((c) => c.status === "matched" && c.matched).map((c) => c.matched!.id));
    const pares = emparejarPorPrecio(
      base.filter((c) => c.status !== "matched" && !c.manual).map((c) => ({ key: c.item.tempId, cantidad: Number(c.item.cantidad) || 0, precio: costoUnitario(c.item), iva: 0 })),
      selectedOCItems.filter((o) => !usados.has(o.id)).map((o) => ({ id: o.id, cantidad: Number(o.cantidad) || 0, precio: Number(o.precio_unitario) || 0 })),
    );
    return base.map((c) => {
      const id = pares[c.item.tempId];
      const matched = id ? selectedOCItems.find((o) => o.id === id) || null : null;
      return matched ? { ...c, status: "matched" as const, matched, porPrecio: true } : c;
    });
  }, [items, selectedOCItems, ocItemsComparables, manualItemMatches, equivalenciasProv]);

  // Vínculos efectivos para guardar: los automáticos (incluidos los aprendidos) + los manuales.
  const asignacionesEfectivas = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of itemComparisons) if (!c.manual && c.status === "matched" && c.matched) m[c.item.tempId] = c.matched.id;
    return { ...m, ...manualItemMatches };
  }, [itemComparisons, manualItemMatches]);

  const unresolvedItemCount = itemComparisons.filter((comparison) => comparison.status !== "matched").length;

  // ── Factura vs. OC: solo lo que es distinto ──
  const decisionDe = (tempId?: string): DecisionSobrante => (tempId && decisiones[tempId])
    || (tempId && manualItemMatches[tempId] === "__extra__" ? "nada" : "oc");
  const diferencias = useMemo(() => {
    const porLinea = new Map<string, { oc: OCItemForMatch; cantidad: number; ultimo: FCItem; costos: number[] }>();
    const faltan: FCItem[] = [];
    for (const c of itemComparisons) {
      if (c.status !== "matched" || !c.matched) { faltan.push(c.item); continue; }
      const g = porLinea.get(c.matched.id) || { oc: c.matched, cantidad: 0, ultimo: c.item, costos: [] };
      g.cantidad += Number(c.item.cantidad) || 0;
      g.ultimo = c.item;
      g.costos.push(costoUnitario(c.item));
      porLinea.set(c.matched.id, g);
    }
    const mas: { oc: OCItemForMatch; cantidad: number; tempId: string }[] = [];
    const menos: { oc: OCItemForMatch; cantidad: number }[] = [];
    const precio: { oc: OCItemForMatch; costo: number }[] = [];
    for (const g of porLinea.values()) {
      const enOC = Number(g.oc.cantidad) || 0;
      if (g.cantidad > enOC + 0.0001) mas.push({ oc: g.oc, cantidad: g.cantidad, tempId: g.ultimo.tempId });
      else if (g.cantidad < enOC - 0.0001) menos.push({ oc: g.oc, cantidad: g.cantidad });
      const costo = g.costos[g.costos.length - 1];
      if (Math.abs(costo - Number(g.oc.precio_unitario)) >= 0.005) precio.push({ oc: g.oc, costo });
    }
    const noVinieron = selectedOCItems.filter((o) => !porLinea.has(o.id));
    const coinciden = itemComparisons.filter((c) => c.status === "matched").length;
    const otroNombre = itemComparisons.filter((c) => c.status === "matched" && (c.porPrecio || c.parecido || c.aprendido || c.manual)).length;
    return { mas, menos, precio, faltan, noVinieron, coinciden, otroNombre };
  }, [itemComparisons, selectedOCItems]);

  // ── Envío que COBRA EL PROVEEDOR en su factura: se reparte entre los PR de las OC como costo INTERNO (nunca va al cliente) ──
  // No incluye el transporte que trabaja para Lazzari (eso corre por Transportes).
  const [envioPRActivo, setEnvioPRActivo] = useState(true);
  const [envioMontos, setEnvioMontos] = useState<Record<string, string>>({});
  const [ocsPR, setOcsPR] = useState<{ id: string; numero: string; peso: number; prId: string | null }[]>([]);
  const [prNumeros, setPrNumeros] = useState<Record<string, string>>({});
  const envioItems = useMemo(() => (isCreditNote ? [] : diferencias.faltan.filter((it) => esRenglonEnvio(it.descripcion || "", it.codigo))), [diferencias, isCreditNote]);
  const envioNeto = roundMoney(envioItems.reduce((acc, it) => acc + itemNeto(it), 0));
  const selectedOCIdsKey = Array.from(selectedOCIds).sort().join(",");
  useEffect(() => {
    if (!selectedOCIdsKey || envioNeto <= 0) { setOcsPR([]); return; }
    let vivo = true;
    (async () => {
      const db = supabase as any;
      const { data } = await db.from("ordenes_compra").select("id, numero, subtotal, total, presupuesto_origen_id")
        .in("id", selectedOCIdsKey.split(",")).eq("sociedad_id", sociedadId);
      const filas = (data || []) as any[];
      const prIds = Array.from(new Set(filas.map((o) => o.presupuesto_origen_id).filter(Boolean)));
      const nums: Record<string, string> = {};
      if (prIds.length) {
        const { data: prs } = await db.from("presupuestos").select("id, numero").in("id", prIds).eq("sociedad_id", sociedadId);
        for (const p of (prs || []) as any[]) nums[p.id] = p.numero;
      }
      if (!vivo) return;
      setPrNumeros(nums);
      setOcsPR(filas.map((o) => ({ id: o.id, numero: o.numero, peso: Number(o.subtotal) || Number(o.total) || 0, prId: o.presupuesto_origen_id || null })));
    })();
    return () => { vivo = false; };
  }, [selectedOCIdsKey, envioNeto, sociedadId]);
  useEffect(() => { setEnvioMontos({}); }, [envioNeto, selectedOCIdsKey]);
  const envioReparto = useMemo(() => {
    const porOC = repartirEnvio(envioNeto, ocsPR.map((o) => ({ id: o.id, peso: o.peso })));
    return repartoPorPR(porOC, Object.fromEntries(ocsPR.map((o) => [o.id, o.prId])));
  }, [envioNeto, ocsPR]);
  const envioPrIds = useMemo(() => Array.from(new Set(ocsPR.map((o) => o.prId).filter(Boolean) as string[])), [ocsPR]);
  const envioMontoPR = (prId: string) => Number(String(envioMontos[prId] ?? envioReparto.porPR[prId] ?? 0).replace(",", ".")) || 0;

  // neto + IVA + percepciones = total del PDF (aviso; propone 21 % si con eso da).
  const ivaControl = useMemo(() => controlIva({
    renglones: items.length
      ? items.map((it) => ({ key: it.tempId, cantidad: Number(it.cantidad) || 0, precio: costoUnitario(it), iva: Number(it.iva_porcentaje || 0) }))
      : [{ key: "neto", cantidad: 1, precio: subtotal, iva: ivaPorcentaje }],
    neto: subtotal, percepciones, totalLeido,
  }), [items, subtotal, ivaPorcentaje, percepciones, totalLeido]);
  function usarIva21() {
    setIvaPorcentaje(21);
    setItems((prev) => prev.map((it) => ({ ...it, iva_porcentaje: 21 })));
  }

  // ── OC pendientes del proveedor (sin facturar del todo) y elección automática ──
  const ordenesKey = useMemo(() => ordenes.map((oc) => `${oc.id}:${oc.proveedor_id}`).join(","), [ordenes]);
  const [ocInfo, setOcInfo] = useState<{ prov: string; porOC: Record<string, { facturado: number; precios: number[]; nombres: string[]; cantidades: number[] }> }>({ prov: "", porOC: {} });
  useEffect(() => {
    const ids = ordenes.filter((oc) => proveedorId && oc.proveedor_id === proveedorId).map((oc) => oc.id);
    if (!ids.length) { setOcInfo({ prov: proveedorId, porOC: {} }); return; }
    let cancelado = false;
    (async () => {
      const db = supabase as any;
      const [links, lineas] = await Promise.all([
        db.from("factura_compra_ocs").select("orden_compra_id, facturas_compra(total, percepciones, estado, sociedad_id)").in("orden_compra_id", ids),
        db.from("orden_compra_items").select("orden_id, descripcion, descripcion_proveedor, cantidad, precio_unitario").in("orden_id", ids),
      ]);
      if (cancelado) return;
      const porOC: Record<string, { facturado: number; precios: number[]; nombres: string[]; cantidades: number[] }> = {};
      for (const id of ids) porOC[id] = { facturado: 0, precios: [], nombres: [], cantidades: [] };
      for (const l of links.data || []) {
        const f = Array.isArray(l.facturas_compra) ? l.facturas_compra[0] : l.facturas_compra;
        if (!f || f.estado === "anulada" || f.sociedad_id !== sociedadId) continue;
        porOC[l.orden_compra_id].facturado += Number(f.total || 0) - Number(f.percepciones || 0);
      }
      for (const l of lineas.data || []) {
        const o = porOC[l.orden_id];
        if (!o) continue;
        o.precios.push(Number(l.precio_unitario) || 0);
        o.nombres.push(`${l.descripcion || ""} ${l.descripcion_proveedor || ""}`);
        o.cantidades.push(Number(l.cantidad) || 0);
      }
      setOcInfo({ prov: proveedorId, porOC });
    })();
    return () => { cancelado = true; };
  }, [proveedorId, sociedadId, ordenesKey]);
  const ocsPendientes = useMemo(() => ordenes.filter((oc) => proveedorId && oc.proveedor_id === proveedorId
    && Number(oc.total || 0) - (ocInfo.porOC[oc.id]?.facturado || 0) > 1), [ordenes, proveedorId, ocInfo]);
  // Arriba se ven solo las pendientes del proveedor; "Ver todas" muestra el resto.
  const ocsVisibles = useMemo(() => {
    if (showAllOCs || !proveedorId) return ocsFiltered;
    const q = ocSearch.trim().toLowerCase();
    return ocsPendientes.filter((oc) => !q || `${oc.numero} ${oc.estado}`.toLowerCase().includes(q));
  }, [showAllOCs, proveedorId, ocsFiltered, ocsPendientes, ocSearch]);
  const autoOCHecho = useRef("");
  useEffect(() => {
    if (!parsed || !proveedorId || ocInfo.prov !== proveedorId || selectedOCIds.size > 0 || isCreditNote || tipoFC !== "mercaderia") return;
    const clave = `${proveedorId}|${file?.name || ""}|${numeroFactura}`;
    if (autoOCHecho.current === clave) return;
    autoOCHecho.current = clave;
    const elegida = elegirOC(
      ocsPendientes.map((oc) => ({ id: oc.id, numero: oc.numero, total: Number(oc.total || 0), ...(ocInfo.porOC[oc.id] || { precios: [] }) })),
      { precios: items.map(costoUnitario), total: totalSinPercepciones, referencias: referenciasOC, nombres: items.map((it) => it.descripcion), cantidades: items.map((it) => Number(it.cantidad) || 0) },
    );
    if (elegida) { setSelectedOCIds(new Set([elegida])); setOcAuto(true); }
  }, [parsed, proveedorId, ocInfo, isCreditNote, tipoFC]);

  // ── Sugerencias de la IA para los artículos que no coinciden por código/nombre ──
  const [aiMatching, setAiMatching] = useState(false);
  const [aiMotivos, setAiMotivos] = useState<Record<string, string>>({});
  const [aiMatchMsg, setAiMatchMsg] = useState("");
  const aiRunKey = useRef("");
  async function sugerirConIA() {
    const pendientes = itemComparisons.filter((c) => (c.status !== "matched" || (c as { parecido?: string }).parecido) && !manualItemMatches[c.item.tempId]);
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
    if (!itemComparisons.some((c) => (c.status !== "matched" || (c as { parecido?: string }).parecido) && !manualItemMatches[c.item.tempId])) return;
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
    // Mismo formulario completo que en Proveedores; con el CUIT de la factura se traen solos los datos de ARCA.
    setNuevoProveedorInicial({ razon_social: proveedorSearch.trim() || fact?.razon_social || "", nombre_fantasia: fact?.nombre_fantasia || "", cuit: cuitFact });
    setNuevoProveedorOpen(true);
  }

  function proveedorCreado(row: Record<string, unknown>) {
    const created = { id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string } as ProveedorOption;
    setProveedores(prev => [...prev.filter(p => p.id !== created.id), created].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
    setProveedorId(created.id);
    setProveedorSearch(created.razon_social);
    setSelectedOCIds(new Set());
    setNuevoProveedorOpen(false);
  }

  // ── Parse PDF ──
  // Primero sin IA: QR de ARCA y, si no hay, el texto del PDF con reglas fijas. La IA queda en el botón "Leer con IA".
  async function handleParseFile(f: File) {
    setFile(f);
    setParsing(true);
    setParsingIA(false);
    setParseError("");
    setParsed(false);
    setLecturaLocal(null);
    try {
      const lectura = await leerFacturaLocal(f);
      if (!lectura) {
        setParseError("No se encontró el QR de ARCA ni los datos en el texto (puede ser una foto o un PDF escaneado). Cargala a mano o usá \"Leer con IA\".");
        return;
      }
      await applyImportedData(lectura.data);
      setLecturaLocal({ origen: lectura.origen, avisos: lectura.avisos });
      setParsed(true);
    } catch (err: any) {
      setParseError(`No se pudo leer el archivo sin IA (${err?.message || "error"}). Cargala a mano o usá "Leer con IA".`);
    } finally {
      setParsing(false);
    }
  }

  async function handleParseFileIA(f: File) {
    setFile(f);
    setParsing(true);
    setParsingIA(true);
    setParseError("");
    setParsed(false);
    setLecturaLocal(null);

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
      if (d.fecha_vencimiento) { setFechaVencimiento(d.fecha_vencimiento); setVencimientoManual(true); }
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
      setDecisiones({});
      setTotalLeido(Number(d.total) > 0 ? Number(d.total) : null);
      setReferenciasOC(Array.isArray(d.referencias_oc) ? d.referencias_oc.map(String) : []);
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
          } else {
            // Lectura sin IA (QR / texto): solo viene el CUIT; se deja en el buscador para ver que no está cargado.
            setProveedorSearch(String(d.proveedor.cuit));
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
    setOcAuto(false);
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
      .select("id, numero, subtotal, iva, total, moneda, sociedad_id, proveedor_id, estado, observaciones, presupuesto_origen_id, orden_compra_items(id, orden_id, codigo, descripcion, cantidad, cantidad_recibida, precio_unitario, iva_porcentaje, unidad)")
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
    if (!isCreditNote && tipoFC === "mercaderia" && selectedOCIds.size === 0 && !crearOCNueva && ocsPendientes.length > 0
      && !window.confirm("No elegiste ninguna orden de compra ni marcaste «Crear una OC nueva con los artículos de esta factura». ¿Guardar la factura igual, sin OC?")) return;
    // La NC puede quedar sin factura: el total queda como crédito disponible para usar en una Orden de Pago.
    if (isCreditNote && facturaOrigenId && (!Number.isFinite(creditoAplicado) || creditoAplicado < 0 || !selectedCreditOrigin || creditoAplicado > selectedCreditOrigin.saldo_acreditable + 0.005 || creditoAplicado > total + 0.005)) {
      setError("El monto aplicado no puede superar el total de la nota ni el saldo de la factura elegida"); return;
    }
    const isMercaderia = tipoFC === "mercaderia";

    setSaving(true);
    setError("");
    let savedFacturaId: string | null = null;
    let generateExtrasOC = false;

    try {
      // Aviso de duplicado: mismo proveedor, número y TIPO de comprobante (una NC 0001-00000045
      // no repite a la FC 0001-00000045). Las anuladas no cuentan. Avisa, no traba.
      const normalizedNumero = numeroFactura.trim();
      let duplicateFactura: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data: providerFacturas, error: duplicateError } = await (supabase as any)
          .from("facturas_compra").select("id, numero_factura, tipo_comprobante, estado")
          .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId)
          .order("id").range(offset, offset + 499);
        if (duplicateError) throw new Error(`No se pudo validar duplicados: ${duplicateError.message}`);
        duplicateFactura = duplicadosComprobanteCompra(providerFacturas || [], { numero_factura: normalizedNumero, tipo_comprobante: tipoComprobante }, canonicalPurchaseInvoiceNumber);
        if (duplicateFactura.length || (providerFacturas || []).length < 500) break;
      }
      if (duplicateFactura.length && !window.confirm(`La ${tipoComprobante} ${normalizedNumero} de este proveedor ya está cargada (estado ${duplicateFactura[0].estado || "registrada"}).\n\n¿Cargarla igual?`)) {
        return;
      }

      let alignmentResult: Awaited<ReturnType<typeof validateOCAlignmentLive>> | null = null;
      if (!isCreditNote && isMercaderia && selectedOCIds.size > 0) {
        alignmentResult = await validateOCAlignmentLive();
      }

      // Reemplazos: el renglón de la OC pasa a ser el de la factura (misma OC, sin crear otra).
      // Se aplica en memoria antes de conciliar, así no quedan "sobrantes" ni OC adicional.
      type Reemplazo = { oc: any; line: any; original: any; item: (typeof items)[number]; equivalencia: number; costo: number; pr?: any; prItem?: any; costoPR?: number; markup?: number | null };
      const reemplazosAplicados: Reemplazo[] = [];
      const avisosReemplazo: string[] = [];
      if (alignmentResult) {
        for (const [tempId, eqTxt] of Object.entries(reemplazos)) {
          const target = asignacionesEfectivas[tempId];
          const item = items.find((i) => i.tempId === tempId);
          if (!item || !target || target === "__extra__") continue;
          const oc = alignmentResult.freshOCs.find((o: any) => (o.orden_compra_items || []).some((l: any) => l.id === target));
          const line = oc?.orden_compra_items.find((l: any) => l.id === target);
          if (!oc || !line) continue;
          const original = { ...line };
          const costo = Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100);
          const equivalencia = Number(String(eqTxt).replace(",", ".")) || equivalenciaSugerida(item.cantidad, Number(original.cantidad));
          Object.assign(line, { codigo: item.codigo || null, descripcion: item.descripcion, cantidad: Number(item.cantidad), precio_unitario: costo, iva_porcentaje: Number(item.iva_porcentaje ?? 21), unidad: item.unidad || line.unidad });
          reemplazosAplicados.push({ oc, line, original, item, equivalencia, costo });
        }
      }

      let reconciliation: ReturnType<typeof reconcilePurchaseLines> | null = null;
      // Cambios a la misma OC por lo que la factura trae de más (se guardan después de la factura).
      type CambioOC = { tipo: "nuevo" | "cantidad"; oc: any; line: any; antes: number };
      const cambiosOC: CambioOC[] = [];
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
        // Lo que sobra va a la misma OC (sube la cantidad o agrega el renglón), salvo que se haya elegido OC nueva o solo factura.
        if (reconciliation.extras.some((extra) => decisionDe(extra.tempId) === "oc")) {
          const ocsVivas = alignmentResult.freshOCs;
          const destino = ocsVivas.find((oc: any) => oc.id === selectedOCs[0]?.id) || ocsVivas[0];
          const todoRecibido = (oc: any) => (oc.orden_compra_items || []).length > 0
            && oc.orden_compra_items.every((l: any) => Number(l.cantidad_recibida || 0) >= Number(l.cantidad) - 0.000001);
          const asignaciones = { ...asignacionesEfectivas };
          for (const extra of reconciliation.extras) {
            if (decisionDe(extra.tempId) !== "oc") continue;
            const target = extra.tempId ? asignaciones[extra.tempId] : undefined;
            const oc = target && target !== "__extra__" ? ocsVivas.find((o: any) => (o.orden_compra_items || []).some((l: any) => l.id === target)) : null;
            const line = oc?.orden_compra_items.find((l: any) => l.id === target);
            if (oc && line) {
              const antes = Number(line.cantidad);
              const recibido = todoRecibido(oc);
              line.cantidad = Math.round((antes + Number(extra.cantidad)) * 10000) / 10000;
              if (recibido) line.cantidad_recibida = line.cantidad;
              cambiosOC.push({ tipo: "cantidad", oc, line, antes });
            } else if (destino) {
              const recibido = todoRecibido(destino);
              const nueva = {
                id: `nuevo:${extra.tempId || uid()}`, orden_id: destino.id, codigo: extra.codigo || "", descripcion: extra.descripcion,
                cantidad: Number(extra.cantidad), cantidad_recibida: recibido ? Number(extra.cantidad) : 0,
                precio_unitario: roundMoney(Number(extra.precio_unitario)), iva_porcentaje: Number(extra.iva_porcentaje ?? 21), unidad: extra.unidad || "UN",
              };
              (destino.orden_compra_items ||= []).push(nueva);
              if (extra.tempId) asignaciones[extra.tempId] = nueva.id;
              cambiosOC.push({ tipo: "nuevo", oc: destino, line: nueva, antes: 0 });
            }
          }
          if (cambiosOC.length) {
            reconciliation = reconcilePurchaseLines(ocsVivas.flatMap((oc: any) => oc.orden_compra_items || []), items, previousItems, asignaciones);
          }
        }
        for (const oc of alignmentResult.freshOCs) {
          const costChanges = reconciliation!.costs.filter(change =>
            change.line.orden_id === oc.id
            && !String(change.line.id || "").startsWith("nuevo:")
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
            .select("id, estado, observaciones, notas_internas, moneda, tipo_cambio, tipo_cambio_divisas, presupuesto_items(id, codigo, descripcion, cantidad, precio_costo, costo_moneda, markup_porcentaje, precio_venta)")
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
        // PR de origen de cada reemplazo: se conserva lo vendido y cambia solo el costo (pasado a la unidad del PR).
        // Nunca frena: si no se encuentra el renglón, se avisa para corregirlo a mano.
        for (const r of reemplazosAplicados) {
          if (!r.oc.presupuesto_origen_id) continue;
          let pr = verifiedPresupuestos.get(r.oc.presupuesto_origen_id);
          if (!pr) {
            const { data } = await (supabase as any).from("presupuestos")
              .select("id, numero, estado, observaciones, notas_internas, moneda, tipo_cambio, tipo_cambio_divisas, presupuesto_items(id, codigo, descripcion, cantidad, precio_costo, costo_moneda, markup_porcentaje, precio_venta)")
              .eq("id", r.oc.presupuesto_origen_id).eq("sociedad_id", sociedadId).maybeSingle();
            if (!data) { avisosReemplazo.push(`No se encontró el presupuesto de ${r.oc.numero}: actualizá el costo a mano.`); continue; }
            pr = data;
            verifiedPresupuestos.set(pr.id, pr);
          }
          const k = purchaseLineKey(r.original), kSinCodigo = purchaseLineKey({ ...r.original, codigo: null });
          const matching = (pr.presupuesto_items || []).filter((it: PurchaseLine) => purchaseLineKey(it) === k || purchaseLineKey({ ...it, codigo: null }) === kSinCodigo);
          if (matching.length !== 1) { avisosReemplazo.push(`«${r.original.descripcion}» no tiene un renglón único en el presupuesto de ${r.oc.numero}: actualizá su costo a mano.`); continue; }
          const prItem = matching[0] as any;
          const costoPR = costoPorUnidadPR(r.costo, r.equivalencia);
          const markup = markupForFixedSalePrice(Number(prItem.precio_venta || 0), costoPR, moneda, pr.moneda, Number(pr.tipo_cambio || 0), Number(pr.tipo_cambio_divisas || 0));
          Object.assign(r, { pr, prItem, costoPR, markup });
          const aviso = avisoCambioCostoPR({
            articulo: prItem.descripcion,
            costoViejo: Number(prItem.precio_costo || 0),
            costoNuevo: costoPR,
            mismaMoneda: String(prItem.costo_moneda || pr.moneda || "ARS").toUpperCase().startsWith("USD") === moneda.toUpperCase().startsWith("USD"),
            markupNuevo: markup,
            facturado: pr.estado === "facturado",
          });
          if (aviso.avisar) avisosReemplazo.push(`${aviso.bajoMinimo ? "⚠️ " : ""}${aviso.texto}`);
        }
        // Lo elegido como "Crear OC nueva" va a una OC aparte; lo de "solo en la factura" queda sin OC.
        generateExtrasOC = reconciliation.extras.some((extra) => decisionDe(extra.tempId) === "nueva");
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
        ...(tipoFC === "servicio" && categoriaGasto ? { categoria_gasto: categoriaGasto } : {}),
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
        const extraItems = reconciliation.extras.filter((it) => decisionDe(it.tempId) === "nueva").map(it => ({
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
        let { data, error: fcErr } = await (supabase as any)
          .from("facturas_compra")
          .insert(insertData)
          .select("id")
          .single();
        // Si la base todavía no tiene la columna de categoría, se guarda sin ella.
        if (fcErr && /categoria_gasto/.test(String(fcErr.message || ""))) {
          const { categoria_gasto: _sinCategoria, ...sinCategoria } = insertData;
          ({ data, error: fcErr } = await (supabase as any).from("facturas_compra").insert(sinCategoria).select("id").single());
        }
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

      // Factura sin OC: OC nueva con sus artículos, recibida y atada a la factura. Si falla, la factura queda igual y se avisa.
      if (!isCreditNote && isMercaderia && selectedOCIds.size === 0 && crearOCNueva && fcData?.id && items.length > 0) {
        try {
          const db = supabase as any;
          const sub = roundMoney(items.reduce((s2, it) => s2 + Number(it.cantidad) * Number(it.precio_unitario) * (1 - Number(it.descuento_porcentaje || 0) / 100), 0));
          const ivaOC = roundMoney(items.reduce((s2, it) => s2 + Number(it.cantidad) * Number(it.precio_unitario) * (1 - Number(it.descuento_porcentaje || 0) / 100) * Number(it.iva_porcentaje ?? 21) / 100, 0));
          const { data: ocRow, error: ocErr } = await db.from("ordenes_compra").insert({
            proveedor_id: proveedorId, fecha, moneda, estado: "enviada", estado_pago: "pendiente",
            subtotal: sub, iva: ivaOC, total: roundMoney(sub + ivaOC), sociedad_id: sociedadId, presupuesto_origen_id: null,
            observaciones: `OC creada desde la FC ${numeroFactura.trim()} (factura sin OC)`, created_by: profileId,
          }).select("id, numero").single();
          if (ocErr || !ocRow) throw new Error(ocErr?.message || "sin respuesta");
          const { error: itErr } = await db.from("orden_compra_items").insert(items.map((it, idx) => ({
            orden_id: ocRow.id, codigo: it.codigo || "", descripcion: it.descripcion, cantidad: it.cantidad, cantidad_recibida: it.cantidad,
            unidad: it.unidad || "u", precio_unitario: roundMoney(Number(it.precio_unitario) * (1 - Number(it.descuento_porcentaje || 0) / 100)),
            iva_porcentaje: it.iva_porcentaje ?? 21, orden: idx,
          })));
          if (itErr) throw new Error(`artículos: ${itErr.message}`);
          const { error: linkErr } = await db.from("factura_compra_ocs").insert({ factura_compra_id: fcData.id, orden_compra_id: ocRow.id });
          if (linkErr) throw new Error(`vínculo: ${linkErr.message}`);
          avisosReemplazo.push(`Se creó la ${ocRow.numero || "OC"} con los artículos de esta factura.`);
        } catch (e: any) {
          avisosReemplazo.push(`⚠️ La factura se guardó, pero no se pudo crear la OC (${e?.message || "error"}). Creala a mano desde Compras.`);
        }
      }

      // Reemplazos: la OC queda igual a la factura; el PR conserva lo vendido y cambia solo el costo, con leyenda.
      if (reemplazosAplicados.length) {
        const stamp = new Date().toLocaleString("es-AR");
        const histOC = new Map<any, string[]>();
        const histPR = new Map<any, string[]>();
        for (const r of reemplazosAplicados) {
          const recibida = Number(r.original.cantidad_recibida || 0);
          const recibidaNueva = recibida > 0 ? Math.min(Number(r.line.cantidad), Math.round(recibida * r.equivalencia * 10000) / 10000) : 0;
          const { error: repError } = await (supabase as any).from("orden_compra_items").update({
            codigo: r.line.codigo, descripcion: r.line.descripcion, cantidad: r.line.cantidad, precio_unitario: r.line.precio_unitario,
            iva_porcentaje: r.line.iva_porcentaje, unidad: r.line.unidad, codigo_proveedor: r.item.codigo || null, descripcion_proveedor: r.item.descripcion,
            ...(recibida > 0 ? { cantidad_recibida: recibidaNueva } : {}),
          }).eq("id", r.line.id).eq("orden_id", r.oc.id);
          if (repError) throw repError;
          r.line.cantidad_recibida = recibida > 0 ? recibidaNueva : r.line.cantidad_recibida;
          (histOC.get(r.oc) || histOC.set(r.oc, []).get(r.oc)!).push(`reemplazo «${r.original.descripcion}» (${r.original.cantidad} ${r.original.unidad || "UN"} a ${r.original.precio_unitario}) → «${r.item.descripcion}» (${r.item.cantidad} a ${r.costo} ${moneda})`);
          if (r.pr && r.prItem && r.costoPR !== undefined) {
            const { error: prCostError } = await (supabase as any).from("presupuesto_items")
              .update({ precio_costo: r.costoPR, costo_moneda: moneda, ...(r.markup !== null && r.markup !== undefined ? { markup_porcentaje: r.markup } : {}) })
              .eq("id", r.prItem.id).eq("presupuesto_id", r.pr.id);
            if (prCostError) throw prCostError;
            (histPR.get(r.pr) || histPR.set(r.pr, []).get(r.pr)!).push(`«${r.prItem.descripcion}» se compró como «${r.item.descripcion}» (${selectedProvNombre || "proveedor"}, FC ${numeroFactura.trim()}): ${r.item.cantidad} a ${r.costo} ${moneda}; 1 ${r.original.unidad || "UN"} = ${r.equivalencia} → costo ${r.costoPR} (antes ${r.prItem.precio_costo} ${r.prItem.costo_moneda || ""})`);
          }
        }
        for (const [oc, hist] of histOC) {
          const lines = oc.orden_compra_items || [];
          const net = roundMoney(lines.reduce((s: number, it: any) => s + Number(it.cantidad) * Number(it.precio_unitario), 0));
          const vat = roundMoney(lines.reduce((s: number, it: any) => s + Number(it.cantidad) * Number(it.precio_unitario) * Number(it.iva_porcentaje ?? 21) / 100, 0));
          oc.observaciones = `${oc.observaciones || ""}\n[${stamp}] FC ${numeroFactura.trim()}: ${hist.join("; ")}`;
          const { error: ocHeadError } = await (supabase as any).from("ordenes_compra")
            .update({ subtotal: net, iva: vat, total: roundMoney(net + vat), observaciones: oc.observaciones }).eq("id", oc.id).eq("sociedad_id", sociedadId);
          if (ocHeadError) throw ocHeadError;
        }
        for (const [pr, hist] of histPR) {
          // Costos y márgenes van a NOTAS INTERNAS: "Observaciones" sale impreso en el PDF del cliente.
          pr.notas_internas = `${pr.notas_internas || ""}\n[${stamp}] ${hist.join("; ")}`;
          const { error: prObsError } = await (supabase as any).from("presupuestos").update({ notas_internas: pr.notas_internas }).eq("id", pr.id).eq("sociedad_id", sociedadId);
          if (prObsError) throw prObsError;
        }
      }

      // Lo que la factura trajo de más quedó en la misma OC: renglones nuevos y cantidades, con historial.
      if (cambiosOC.length) {
        const db = supabase as any;
        const stamp = new Date().toLocaleString("es-AR");
        const histOC = new Map<any, string[]>();
        for (const c of cambiosOC) {
          const hist = histOC.get(c.oc) || histOC.set(c.oc, []).get(c.oc)!;
          if (c.tipo === "nuevo") {
            const { data: ins, error: insError } = await db.from("orden_compra_items").insert({
              orden_id: c.oc.id, codigo: c.line.codigo || "", descripcion: c.line.descripcion, cantidad: c.line.cantidad,
              cantidad_recibida: c.line.cantidad_recibida, unidad: c.line.unidad || "UN", precio_unitario: c.line.precio_unitario,
              iva_porcentaje: c.line.iva_porcentaje, orden: (c.oc.orden_compra_items || []).length,
            }).select("id").single();
            if (insError || !ins) throw new Error(`No se pudo agregar «${c.line.descripcion}» a ${c.oc.numero}: ${insError?.message || "sin respuesta"}`);
            c.line.id = ins.id;
            hist.push(`se agregó «${c.line.descripcion}» ${c.line.cantidad} × ${c.line.precio_unitario} ${moneda}`);
            avisosReemplazo.push(`Se agregó «${c.line.descripcion}» a ${c.oc.numero}.${c.oc.presupuesto_origen_id ? " No está en el presupuesto: revisá si hay que cobrárselo al cliente." : ""}`);
          } else {
            const { error: qtyError } = await db.from("orden_compra_items").update({ cantidad: c.line.cantidad, cantidad_recibida: c.line.cantidad_recibida })
              .eq("id", c.line.id).eq("orden_id", c.oc.id);
            if (qtyError) throw new Error(`No se pudo actualizar la cantidad de «${c.line.descripcion}» en ${c.oc.numero}: ${qtyError.message}`);
            hist.push(`«${c.line.descripcion}» cantidad ${c.antes} → ${c.line.cantidad}`);
            avisosReemplazo.push(`${c.oc.numero}: «${c.line.descripcion}» pasó de ${c.antes} a ${c.line.cantidad}.${c.oc.presupuesto_origen_id ? ` El presupuesto sigue con ${c.antes}.` : ""}`);
          }
        }
        for (const [oc, hist] of histOC) {
          const lines = oc.orden_compra_items || [];
          const net = roundMoney(lines.reduce((s: number, it: any) => s + Number(it.cantidad) * Number(it.precio_unitario), 0));
          const vat = roundMoney(lines.reduce((s: number, it: any) => s + Number(it.cantidad) * Number(it.precio_unitario) * Number(it.iva_porcentaje ?? 21) / 100, 0));
          oc.observaciones = `${oc.observaciones || ""}\n[${stamp}] FC ${numeroFactura.trim()}: ${hist.join("; ")}`;
          const { error: ocHeadError } = await db.from("ordenes_compra")
            .update({ subtotal: net, iva: vat, total: roundMoney(net + vat), observaciones: oc.observaciones }).eq("id", oc.id).eq("sociedad_id", sociedadId);
          if (ocHeadError) throw ocHeadError;
        }
      }

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
              .update({ notas_internas: `${pr.notas_internas || ""}${historyText}` }).eq("id", pr.id).eq("sociedad_id", sociedadId);
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

      // Pagada con tarjeta: el pago queda registrado en la cuenta de la tarjeta (baja la deuda con el proveedor,
      // suma a la deuda de la tarjeta y después se cruza con el resumen). Si falla, la factura igual queda guardada.
      const tarjetaElegida = tarjetas.find((t) => t.id === pagoTarjeta);
      if (!isCreditNote && tarjetaElegida && fcData?.id) {
        const { error: pagoError } = await registrarPagoTarjeta(supabase, fcData.id, tarjetaElegida, movimientoPagoTarjeta({
          sociedadId, proveedorId, facturaId: fcData.id, tarjeta: tarjetaElegida, total, moneda, fecha,
          comprobante: `${tipoComprobante} ${numeroFactura.trim()}`, proveedorNombre: proveedorSearch.trim(), userId: profileId,
        }));
        if (pagoError) avisosReemplazo.push(`La factura quedó pagada pero no se pudo registrar el pago en ${tarjetaElegida.nombre}: ${pagoError}. Avisá para cargarlo.`);
      }

      // Memoria del proveedor: lo que vinculaste a mano queda aprendido para la próxima factura.
      if (!isCreditNote && proveedorId) {
        try {
          const porParecido = itemComparisons
            .filter((c) => (c.parecido || c.porPrecio) && c.matched && !manualItemMatches[c.item.tempId])
            .map((c) => [c.item.tempId, c.matched!.id] as [string, string]);
          const eqs = [...Object.entries(manualItemMatches), ...porParecido]
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

      // Pago que pide el proveedor: queda en la factura; si el proveedor no lo tenía cargado, se le guarda (nunca frena).
      if (savedFacturaId && planPago.condicion_pago) {
        try {
          const db = supabase as any;
          await db.from("facturas_compra").update({ condicion_pago: planPago.condicion_pago, dias_pago: planPago.dias_pago ?? null, dias_pago_hasta: planPago.condicion_pago === "escalonado" ? planPago.dias_pago_hasta ?? null : null })
            .eq("id", savedFacturaId).eq("sociedad_id", sociedadId);
          if (!planProveedor?.condicion_pago) {
            const medios = Array.from(new Set([...(planProveedor?.medios_pago || []), ...(planPago.medio_pago_preferido ? [planPago.medio_pago_preferido] : [])]));
            await db.from("proveedores").update({
              condicion_pago: planPago.condicion_pago, dias_pago: planPago.dias_pago ?? null,
              dias_pago_hasta: planPago.condicion_pago === "escalonado" ? planPago.dias_pago_hasta ?? null : null,
              medio_pago_preferido: planPago.medio_pago_preferido || null, plazo_cheque_dias: planPago.plazo_cheque_dias ?? null,
              descuento_pronto_pago: planPago.descuento_pronto_pago ?? null, medios_pago: medios,
            }).eq("id", proveedorId).eq("sociedad_id", sociedadId);
          }
        } catch { /* es un dato de ayuda: nunca frena la carga */ }
      }

      // Nombre de fantasía leído en la factura: si el proveedor no tiene, se guarda; si tiene otro, solo se avisa.
      const emisorLeido = proveedorFacturaRef.current;
      if (proveedorId && emisorLeido?.nombre_fantasia) {
        const cuitLeido = emisorLeido.cuit.replace(/\D/g, "");
        const cuitElegido = (proveedores.find((p) => p.id === proveedorId)?.cuit || "").replace(/\D/g, "");
        if (cuitLeido && cuitElegido && cuitLeido === cuitElegido) {
          await aprenderNombreFantasiaDeFactura(supabase, { proveedorId, sociedadId, deFactura: emisorLeido.nombre_fantasia, razonSocialFactura: emisorLeido.razon_social, cuitFactura: cuitLeido }, toast);
        }
      }

      // Envío del proveedor → costo INTERNO de cada PR (reparto elegido en pantalla). La factura ya está guardada:
      // si algo falla acá, avisa y no frena nada.
      if (!isCreditNote && fcData?.id && envioPRActivo && envioNeto > 0 && envioPrIds.length) {
        try {
          const db = supabase as any;
          const stampEnvio = new Date().toLocaleString("es-AR");
          for (const prId of envioPrIds) {
            const monto = roundMoney(Math.max(0, envioMontoPR(prId)));
            if (monto <= 0) continue;
            const { data: prRow, error: prErr } = await db.from("presupuestos")
              .select("id, numero, moneda, tipo_cambio, tipo_cambio_divisas, costo_envio_interno, notas_internas")
              .eq("id", prId).eq("sociedad_id", sociedadId).maybeSingle();
            if (prErr || !prRow) { avisosReemplazo.push(`No se pudo sumar el envío (${formatCurrency(monto, moneda)}) al presupuesto ${prNumeros[prId] || ""}: ${prErr?.message || "no se encontró"}. Sumalo a mano en el PR.`); continue; }
            const enMonedaPR = roundMoney(convertirCostoPR(monto, moneda, prRow.moneda, Number(prRow.tipo_cambio) || 0, Number(prRow.tipo_cambio_divisas) || 0));
            const nota = `${prRow.notas_internas ? prRow.notas_internas + "\n" : ""}[${stampEnvio}] FC ${tipoComprobante} ${numeroFactura.trim()}: envío ${formatCurrency(monto, moneda)}${prRow.moneda !== moneda ? ` (= ${formatCurrency(enMonedaPR, prRow.moneda)})` : ""}`;
            const { error: upErr } = await db.from("presupuestos")
              .update({ costo_envio_interno: roundMoney(Number(prRow.costo_envio_interno || 0) + enMonedaPR), notas_internas: nota })
              .eq("id", prId).eq("sociedad_id", sociedadId);
            if (upErr) avisosReemplazo.push(`No se pudo sumar el envío (${formatCurrency(monto, moneda)}) a ${prRow.numero}: ${upErr.message}. Sumalo a mano en el PR.`);
            else avisosReemplazo.push(`Envío interno de ${formatCurrency(enMonedaPR, prRow.moneda)} sumado a ${prRow.numero} (no se le cobra al cliente; baja la ganancia).`);
          }
          if (envioReparto.sinPR > 0.004) avisosReemplazo.push(`${formatCurrency(envioReparto.sinPR, moneda)} de envío corresponden a OC sin presupuesto: quedó solo en la factura.`);
        } catch (e: any) {
          avisosReemplazo.push(`La factura se guardó, pero no se pudo sumar el envío a los presupuestos (${e?.message || "error"}). Sumalo a mano.`);
        }
      }

      const avisosTxt = avisosReemplazo.length ? `\n\nAvisos (no frenan nada):\n• ${avisosReemplazo.join("\n• ")}` : "";
      alert((isCreditNote ? (facturaOrigenId ? "Nota de crédito registrada y aplicada a la factura elegida" : "Nota de crédito registrada: queda como crédito disponible del proveedor") : pagadaSinOP ? `Factura cargada como pagada${tarjetas.find((t) => t.id === pagoTarjeta) ? ` con ${tarjetas.find((t) => t.id === pagoTarjeta)!.nombre}` : ""} (sin orden de pago)` : "Factura cargada y enviada para aprobación") + avisosTxt);
      onSuccess();
    } catch (err: any) {
      setError(savedFacturaId ? `La factura ${numeroFactura} quedó registrada, pero falta completar una operación: ${err.message || "Error"}. Abrila desde Facturas de compra para revisarla; no vuelvas a cargarla.` : err.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──
  const ocConArticulos = tipoFC === "mercaderia" && !isCreditNote && selectedOCIds.size > 0 && selectedOCItems.length > 0 && !ocItemsLoading;
  const hayDiferencias = diferencias.mas.length + diferencias.faltan.length + diferencias.precio.length + diferencias.menos.length + diferencias.noVinieron.length > 0;
  const opcionesSobrante = (tempId: string, opciones: [DecisionSobrante, string][]) => (
    <div className="flex flex-wrap gap-1">
      {opciones.map(([valor, texto]) => {
        const activo = decisionDe(tempId) === valor;
        return (
          <button key={valor} type="button" onClick={() => setDecisiones((d) => ({ ...d, [tempId]: valor }))}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${activo ? "border-orange-500 bg-orange-600 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {activo ? "✓ " : ""}{texto}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className={`bg-white dark:bg-zinc-900 w-full rounded-xl shadow-2xl ${fullscreen ? "min-h-[calc(100vh-2rem)] max-w-none" : "max-w-5xl"}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Cargar factura o nota de pedido</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setFullscreen((value) => !value)} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" title={fullscreen ? "Reducir" : "Ampliar"}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><X size={20} /></button>
          </div>
        </div>

        <div className={`px-5 py-3 space-y-3 overflow-y-auto ${fullscreen ? "max-h-[calc(100vh-8rem)]" : "max-h-[80vh]"}`}>
          {/* ── 1. Upload ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-1.5">
              1. Cargar factura
            </h3>
            {!parsed && !parsing && (
              <label className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-xl cursor-pointer hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-900/10 transition-colors">
                <div className="flex items-center gap-2 text-orange-600">
                  <Search size={20} />
                  <span className="font-semibold">Leer factura desde PDF o imagen (sin IA)</span>
                </div>
                <p className="text-xs text-zinc-400">Lee el QR de ARCA o el texto del PDF, gratis y sin mandar el archivo. Si no alcanza, después podés usar &quot;Leer con IA&quot;.</p>
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
                <span className="text-sm font-medium text-orange-700 dark:text-orange-300">{parsingIA ? "Procesando con IA..." : "Leyendo QR de ARCA y texto del PDF..."}</span>
              </div>
            )}
            {parseError && (
              <div className="flex flex-wrap items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                <span className="flex-1 min-w-[200px]">{parseError}</span>
                {file && !parsingIA && (
                  <button onClick={() => handleParseFileIA(file)}
                    className="inline-flex items-center gap-1 rounded-md border border-orange-400 px-2 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:text-orange-300">
                    <Sparkles size={12} /> Leer con IA
                  </button>
                )}
                <button onClick={() => { setParseError(""); setFile(null); }}
                  className="underline text-xs">{parsingIA ? "Reintentar" : "Cargar a mano / otro archivo"}</button>
              </div>
            )}
            {parsed && (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-lg text-green-700 dark:text-green-400 text-sm">
                  <Check size={16} />
                  {lecturaLocal ? (lecturaLocal.origen === "qr" ? "Leído del QR de ARCA:" : "Leído del texto del PDF (revisá):") : "Factura procesada con IA:"}
                  <span className="font-mono font-bold truncate max-w-[260px]">{file?.name}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {lecturaLocal && file && (
                      <button onClick={() => handleParseFileIA(file)} title="Lee también los artículos (usa IA)"
                        className="inline-flex items-center gap-1 rounded-md border border-orange-400 px-2 py-0.5 text-xs font-medium text-orange-700 hover:bg-orange-50 dark:text-orange-300">
                        <Sparkles size={12} /> Leer con IA
                      </button>
                    )}
                    <button onClick={() => { setParsed(false); setFile(null); setParseError(""); setLecturaLocal(null); }}
                      className="text-xs underline">Cambiar archivo</button>
                  </span>
                </div>
                {lecturaLocal && lecturaLocal.avisos.length > 0 && (
                  <p className="px-3 text-xs text-amber-700 dark:text-amber-400">⚠️ {lecturaLocal.avisos.join(" · ")}</p>
                )}
              </div>
            )}
          </section>

          {/* ── Tipo de factura (sugerido, se puede cambiar) ── */}
          {!isCreditNote && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[10px] uppercase text-zinc-400">Tipo</span>
              {TIPOS_FACTURA_COMPRA.map((t) => (
                <button key={t.value} type="button" onClick={() => setTipoFC(t.value)}
                  className={`rounded-full border px-2.5 py-0.5 font-medium transition-colors ${tipoFC === t.value ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700"}`}>
                  {t.label}
                </button>
              ))}
              {tipoFC === "servicio" && (
                <select value={categoriaGasto} onChange={(e) => setCategoriaGasto(e.target.value)}
                  className="rounded-lg border border-zinc-300 bg-white px-2 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                  <option value="">Categoría del gasto…</option>
                  {CATEGORIAS_GASTO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              )}
              {tipoMotivo && tipoFC !== "mercaderia" && (
                <span className="text-[11px] text-violet-600 dark:text-violet-400">✨ {tipoMotivo === "proveedor" ? "como las facturas anteriores de este proveedor" : "por el texto de la factura"}</span>
              )}
              {tipoFC === "servicio" && <span className="text-[11px] text-zinc-400">Sin OC · va a orden de pago o se marca pagada</span>}
            </div>
          )}

          {/* ── 2. Datos de la factura (dos filas) ── */}
          <section>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-x-2 gap-y-1.5">
              {/* Proveedor */}
              <div className="col-span-2 sm:col-span-4 lg:col-span-4 relative">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Proveedor</label>
                {proveedorId ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-sm">
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
                      className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-orange-300 px-2.5 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-950/30"
                    >
                      <Plus size={14} />
                      {proveedorSearch.trim() ? `Crear “${proveedorSearch.trim()}” como proveedor` : "Crear proveedor nuevo"}
                    </button>
                  </>
                )}
              </div>

              {/* Tipo de comprobante */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Tipo</label>
                <select value={tipoComprobante} onChange={e => setTipoComprobante(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
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
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">N° Factura</label>
                <input type="text" value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)}
                  placeholder="0001-00012345"
                  className={`w-full px-2.5 py-1.5 rounded-lg border text-sm font-mono ${duplicateWarning ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"}`} />
                {duplicateWarning && <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle size={12} />{duplicateWarning}</p>}
              </div>

              {/* Fecha */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* Vencimiento */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Vencimiento</label>
                <input type="date" value={fechaVencimiento} onChange={e => { setFechaVencimiento(e.target.value); setVencimientoManual(Boolean(e.target.value)); }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              </div>

              {/* CAE */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">CAE</label>
                <input type="text" value={cae} onChange={e => setCae(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* Moneda */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Moneda</label>
                <select value={moneda} onChange={e => setMoneda(e.target.value as "ARS" | "USD")}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>

              {/* Subtotal */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Subtotal (neto)</label>
                <input type="number" step="0.01" min="0" value={subtotal || ""} onChange={e => setSubtotal(Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>

              {/* IVA % */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">IVA % · {formatCurrency(iva, moneda)}</label>
                <select value={ivaPorcentaje} onChange={e => {
                  const value = Number(e.target.value);
                  setIvaPorcentaje(value);
                  setItems((prev) => prev.map((item) => ({ ...item, iva_porcentaje: value })));
                }}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                  <option value={0}>0% (Exento)</option>
                  <option value={10.5}>10.5%</option>
                  <option value={21}>21%</option>
                  <option value={27}>27%</option>
                </select>
              </div>

              {/* Percepciones */}
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Percepciones</label>
                <input type="number" step="0.01" min="0" value={percepciones || ""} onChange={e => setPercepciones(Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
              </div>
            
              <div className="lg:col-span-2">
                <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Total {ivaControl.controlado && ivaControl.cuadra && <span className="normal-case text-emerald-600">✓ igual al PDF</span>}</label>
                <div className="px-2.5 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/30 text-sm font-mono font-bold text-orange-600">{formatCurrency(total, moneda)}</div>
              </div>
            </div>

            {/* Control del IVA: neto + IVA + percepciones tiene que dar el total del PDF (aviso, no frena) */}
            {ivaControl.controlado && !ivaControl.cuadra && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1 min-w-0">No cuadra con el PDF: el total impreso es <b>{formatCurrency(ivaControl.totalLeido, moneda)}</b> y neto + IVA + percepciones da <b>{formatCurrency(ivaControl.calculado, moneda)}</b> (diferencia {formatCurrency(ivaControl.diferencia, moneda)}).{!ivaControl.propone21 && " Revisá el IVA de cada artículo o las percepciones."}</span>
                {ivaControl.propone21 && <button type="button" onClick={usarIva21} className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700">Usar IVA 21 % en todo (da justo)</button>}
              </div>
            )}

            {/* Pago que pide el proveedor */}
              {!isCreditNote && proveedorId && (
                <div className={`mt-1.5 rounded-lg border px-3 py-1 text-xs ${planPago.condicion_pago ? "border-zinc-200 dark:border-zinc-700" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase text-zinc-400">Pago que pide el proveedor</span>
                    {planPago.condicion_pago
                      ? <span className="font-medium">{textoCondicionPago(planPago)}</span>
                      : <span className="font-medium text-amber-700 dark:text-amber-400">⚠️ Sin indicar — completalo así Pagos sabe cuándo y cómo pagar</span>}
                    {vencimientoSugerido && <span className="text-xs text-zinc-500">· vence {vencimientoSugerido.split("-").reverse().join("/")} (desde la fecha de factura)</span>}
                    {vencimientoManual && vencimientoSugerido && fechaVencimiento !== vencimientoSugerido && (
                      <button type="button" onClick={() => { setVencimientoManual(false); setFechaVencimiento(vencimientoSugerido); }} className="text-xs text-orange-600 hover:underline">Usar el calculado</button>
                    )}
                    {!editandoPlan && <button type="button" onClick={() => setEditandoPlan(true)} className="ml-auto text-xs font-medium text-orange-600 hover:underline">{planPago.condicion_pago ? "Cambiar" : "Indicar"}</button>}
                  </div>
                  {editandoPlan && (
                    <div className="mt-2 space-y-2">
                      <CondicionPagoEditor value={planPago} onChange={setPlanPago} compacto />
                      {!planProveedor?.condicion_pago && <p className="text-[11px] text-zinc-500">El proveedor no lo tiene cargado: al guardar la factura se le guarda también a él.</p>}
                      <div className="flex justify-end"><button type="button" onClick={() => setEditandoPlan(false)} className="rounded-lg border border-zinc-200 px-3 py-1 text-xs dark:border-zinc-700">Listo</button></div>
                    </div>
                  )}
                </div>
              )}

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
                    {origenSugerido && facturaOrigenId === origenSugerido.id && (
                      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">✨ Sugerida: {origenSugerido.motivo === "asociada" ? "es la factura que cita la NC" : "es la factura de este proveedor que cargaste en la misma tanda"}. Podés cambiarla o dejar la NC como crédito.</p>
                    )}
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

          </section>

          {/* ── Costo real (solo_iva) ── */}
          {tipoFC === "solo_iva" && (
            <section>
              <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Costo real del crédito fiscal (opcional)</label>
              <input type="number" step="0.01" value={costoReal || ""} onChange={e => setCostoReal(Number(e.target.value))}
                placeholder="Monto real pagado por el crédito fiscal"
                className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
              <p className="text-xs text-zinc-400 mt-1">Si se ingresa, se crea un gasto manual asociado.</p>
            </section>
          )}

          {(tipoFC !== "mercaderia" || isCreditNote) && items.length > 0 && <section>
            {(
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between"><p className="text-[10px] uppercase text-zinc-400">Artículos de la factura ({items.length})</p><button type="button" onClick={() => setItems((prev) => [...prev, { tempId: uid(), codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, descuento_porcentaje: 0, iva_porcentaje: ivaPorcentaje, unidad: "UN" }])} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600"><Plus size={13} /> Agregar item</button></div>
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
                          <td className="px-1 py-1"><input value={it.codigo || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, codigo: e.target.value } : item))} placeholder="Sin código" className="w-32 rounded border border-zinc-200 bg-transparent px-2 py-1 font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input value={it.descripcion} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descripcion: e.target.value } : item))} className="w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.cantidad} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Number(e.target.value) || 0 } : item))} className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, precio_unitario: Number(e.target.value) || 0 } : item))} className="w-28 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" max="100" step="0.01" value={it.descuento_porcentaje || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descuento_porcentaje: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : item))} placeholder="0" className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><select value={it.iva_porcentaje} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, iva_porcentaje: Number(e.target.value) } : item))} className="rounded border border-zinc-200 bg-transparent px-1 py-1 dark:border-zinc-700"><option value={0}>0%</option><option value={10.5}>10,5%</option><option value={21}>21%</option><option value={27}>27%</option></select></td>
                          <td className="px-2 py-1 text-right font-mono font-medium">{formatCurrency(itemNeto(it), moneda)}</td>
                          <td><button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>}

          {/* ── 3. Orden de compra: se elige sola y se muestran solo las diferencias ── */}
          {tipoFC === "mercaderia" && !isCreditNote && <section className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">3. Orden de compra</h3>
              {selectedOCs.length > 0 && !cambiarOC && (
                <>
                  {selectedOCs.map((oc) => (
                    <span key={oc.id} className="inline-flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs dark:border-orange-800 dark:bg-orange-950/30">
                      <span className="font-mono font-semibold">{oc.numero}</span>
                      <span className="text-zinc-500">{formatCurrency(oc.total, oc.moneda as "ARS" | "USD")}</span>
                      <button type="button" onClick={() => toggleOC(oc.id)} title="Quitar esta OC" className="text-zinc-400 hover:text-red-500"><X size={12} /></button>
                    </span>
                  ))}
                  {ocAuto && <span className="text-[11px] text-emerald-600">elegida sola (nombres y precios)</span>}
                  <button type="button" onClick={() => setCambiarOC(true)} className="text-xs text-orange-600 hover:underline">cambiar / sumar otra</button>
                </>
              )}
              {(selectedOCs.length === 0 || cambiarOC) && (
                <>
                  {proveedorId && (
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-500">
                      <input type="checkbox" checked={showAllOCs} onChange={(e) => setShowAllOCs(e.target.checked)} className="accent-orange-600 h-3 w-3" />
                      Ver todas
                    </label>
                  )}
                  <div className="relative ml-auto w-60 max-w-full"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" /><input value={ocSearch} onChange={(e) => setOcSearch(e.target.value)} placeholder="Buscar OC..." className="w-full rounded-lg border border-zinc-200 bg-transparent py-1 pl-8 pr-2 text-xs dark:border-zinc-700" /></div>
                  {cambiarOC && <button type="button" onClick={() => setCambiarOC(false)} className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-700">Listo</button>}
                </>
              )}
            </div>

            {(selectedOCs.length === 0 || cambiarOC) && (
              <>
                {proveedorId && selectedOCIds.size === 0 && (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/50 px-2.5 py-1 text-xs dark:border-orange-900 dark:bg-orange-950/20">
                    <input type="checkbox" checked={crearOCNueva} onChange={(e) => setCrearOCNueva(e.target.checked)} className="accent-orange-600" />
                    <span><strong>Crear una OC nueva con los artículos de esta factura</strong> <span className="text-zinc-500">— queda recibida y atada a la factura{ocsVisibles.length > 0 ? " (o elegí una OC de abajo)" : ""}</span></span>
                  </label>
                )}
                {ocsVisibles.length === 0 ? (
                  <p className="text-xs text-zinc-400 italic">
                    {proveedorId ? "No hay OC pendientes de facturar de este proveedor." : "Elegí un proveedor para ver sus OC."}
                    {proveedorId && !showAllOCs && ordenes.length > 0 && (
                      <button type="button" onClick={() => setShowAllOCs(true)} className="ml-2 not-italic font-medium text-orange-600 underline">Ver todas las OC ({ordenes.length})</button>
                    )}
                  </p>
                ) : (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {ocsVisibles.map((oc) => {
                      const sel = selectedOCIds.has(oc.id);
                      const facturado = ocInfo.porOC[oc.id]?.facturado || 0;
                      return (
                        <label key={oc.id} className={`flex items-center gap-3 px-2.5 py-1 rounded-lg cursor-pointer text-xs ${sel ? "bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700" : "bg-zinc-50 dark:bg-zinc-800/50 border border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-700/50"}`}>
                          <input type="checkbox" checked={sel} onChange={() => toggleOC(oc.id)} className="accent-orange-600 h-3.5 w-3.5" />
                          <span className="font-mono font-medium">{oc.numero}</span>
                          <span className="flex-1 min-w-0 truncate text-zinc-500">{oc.proveedor_nombre} · {oc.estado}{oc.fecha ? ` · ${oc.fecha.split("-").reverse().join("/")}` : ""}</span>
                          {facturado > 1 && <span className="text-zinc-400">facturado {formatCurrency(facturado, oc.moneda as "ARS" | "USD")}</span>}
                          <span className="font-mono font-medium">{formatCurrency(oc.total, oc.moneda as "ARS" | "USD")}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {selectedOCIds.size > 0 && (alignmentLoading ? (
              <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-500 dark:bg-zinc-800"><Loader2 size={14} className="animate-spin" />Verificando importes ya facturados...</div>
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
            ) : null)}

            {selectedOCIds.size > 0 && items.length > 0 && (
              ocItemsLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-zinc-500"><Loader2 size={14} className="animate-spin" />Comparando artículos...</div>
              ) : ocItemsError ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{ocItemsError}</div>
              ) : selectedOCItems.length === 0 ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">La OC elegida no tiene artículos cargados (por ejemplo, viene del sistema anterior). La factura se vincula por importe.</div>
              ) : (
                <div className="space-y-1">
                  <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${hayDiferencias ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>
                    <Check size={14} className="shrink-0" />
                    <span className="flex-1 min-w-0">
                      {hayDiferencias
                        ? <><b>{diferencias.coinciden} de {items.length}</b> artículos coinciden con {selectedOCs.map((oc) => oc.numero).join(", ")}</>
                        : <b>La factura coincide con {selectedOCs.map((oc) => oc.numero).join(", ")}</b>}
                      {diferencias.otroNombre > 0 && <span className="opacity-80"> · {diferencias.otroNombre} con otro nombre (emparejados por precio o parecido)</span>}
                    </span>
                    {aiMatching && <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300"><Loader2 size={11} className="animate-spin" /> La IA está comparando…</span>}
                    <button type="button" onClick={() => setVerDetalle((v) => !v)} className="font-medium text-orange-600 hover:underline">{verDetalle ? "ocultar detalle" : "ver detalle"}</button>
                  </div>
                  {diferencias.mas.map((d) => (
                    <div key={`mas-${d.oc.id}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span className="flex-1 min-w-0 truncate"><b>{d.oc.descripcion}</b>: factura {d.cantidad} · OC {d.oc.cantidad}</span>
                      {opcionesSobrante(d.tempId, [["oc", `Actualizar OC a ${d.cantidad}`], ["nueva", "Crear OC nueva"], ["nada", "Solo en la factura"]])}
                    </div>
                  ))}
                  {diferencias.faltan.map((it) => (
                    <div key={`falta-${it.tempId}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span className="flex-1 min-w-0 truncate"><b>{it.descripcion || "Sin descripción"}</b> · {it.cantidad} × {formatCurrency(costoUnitario(it), moneda)} — no está en la OC</span>
                      {opcionesSobrante(it.tempId, [["oc", `Agregar a ${selectedOCs[0]?.numero || "la OC"}`], ["nueva", "Crear OC nueva"], ["nada", "Solo en la factura"]])}
                    </div>
                  ))}
                  {envioItems.length > 0 && (
                    <div className="space-y-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-900 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-200">
                      <label className="flex items-center gap-2 font-medium">
                        <input type="checkbox" checked={envioPRActivo} onChange={(e) => setEnvioPRActivo(e.target.checked)} />
                        <span>Envío del proveedor: {formatCurrency(envioNeto, moneda)} (sin IVA) — sumarlo como costo interno de los presupuestos 🔒</span>
                      </label>
                      <p className="opacity-80">Resta de la ganancia del PR. No se le cobra al cliente ni sale en el PDF. El envío igual queda en la factura y en la OC como siempre.</p>
                      {envioPRActivo && (envioPrIds.length === 0 ? (
                        <p className="opacity-80">Estas OC no vienen de un presupuesto: el envío queda solo en la factura.</p>
                      ) : (
                        <div className="space-y-1">
                          {envioPrIds.map((prId) => (
                            <div key={prId} className="flex items-center justify-between gap-2">
                              <span>{prNumeros[prId] || "Presupuesto"} <span className="opacity-60">({ocsPR.filter((o) => o.prId === prId).map((o) => o.numero).join(", ")})</span></span>
                              <input type="number" step="0.01" min="0" value={envioMontos[prId] ?? String(envioReparto.porPR[prId] ?? 0)}
                                onChange={(e) => setEnvioMontos((m) => ({ ...m, [prId]: e.target.value }))}
                                className="w-28 rounded border border-violet-200 px-1 py-0.5 text-right font-mono dark:border-violet-800 dark:bg-zinc-900" />
                            </div>
                          ))}
                          {envioReparto.sinPR > 0.004 && <p className="opacity-80">{formatCurrency(envioReparto.sinPR, moneda)} van a OC sin presupuesto: quedan solo en la factura.</p>}
                          {Math.abs(envioPrIds.reduce((a, id) => a + envioMontoPR(id), 0) + envioReparto.sinPR - envioNeto) > 0.01 && <p className="text-amber-700 dark:text-amber-300">⚠️ Los montos no suman el envío ({formatCurrency(envioNeto, moneda)}). Es un aviso, podés guardar igual.</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {diferencias.precio.map((d) => (
                    <div key={`precio-${d.oc.id}`} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200 truncate">
                      <b>{d.oc.descripcion}</b>: precio OC {formatCurrency(Number(d.oc.precio_unitario), moneda)} → factura {formatCurrency(d.costo, moneda)} · se actualiza el costo
                    </div>
                  ))}
                  {diferencias.menos.map((d) => (
                    <div key={`menos-${d.oc.id}`} className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 truncate">
                      <b>{d.oc.descripcion}</b>: vienen {d.cantidad} de {d.oc.cantidad} · el resto queda pendiente en la OC
                    </div>
                  ))}
                  {diferencias.noVinieron.map((o) => (
                    <div key={`no-${o.id}`} className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-700 truncate">
                      <b>{o.descripcion}</b> ({o.cantidad}) no vino en esta factura · queda pendiente en {o.ocNumero}
                    </div>
                  ))}
                  {verDetalle && (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2 dark:border-zinc-700 dark:bg-zinc-800/40">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-zinc-500">Cada artículo de la factura y su renglón de la OC. Si alguno quedó mal, elegí el correcto.</p>
                        {unresolvedItemCount > 0 && <button type="button" onClick={() => { aiRunKey.current = "manual"; void sugerirConIA(); }} disabled={aiMatching} className="inline-flex items-center gap-1 rounded-full border border-violet-300 px-2 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:border-violet-800 dark:text-violet-300">{aiMatching ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Sugerir con IA</button>}
                      </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {aiMatchMsg && <p className="text-[11px] font-medium text-violet-700 dark:text-violet-300">{aiMatchMsg}</p>}
                    {itemComparisons.map((comparison) => {
                      const assignedId = manualItemMatches[comparison.item.tempId] || "";
                      const parecido = (comparison as { parecido?: string }).parecido;
                      const isMatched = comparison.status === "matched" && !parecido;
                      const statusText = comparison.manual
                        ? (assignedId === "__extra__" ? "Marcado fuera de OC" : "Asignación manual")
                        : comparison.status === "matched"
                          ? (comparison.aprendido ? "Coincidencia aprendida de cargas anteriores" : comparison.porPrecio ? "Emparejado por precio (el proveedor lo llama distinto)" : "Coincidencia automática")
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
                            {parecido && !assignedId && <p className="text-[10px] text-amber-700 dark:text-amber-300">{parecido}{comparison.matched ? ` → ${comparison.matched.ocNumero}: ${comparison.matched.descripcion}` : ""}</p>}
                          </div>
                          <select
                            value={assignedId}
                            onChange={(event) => setManualItemMatches((current) => ({ ...current, [comparison.item.tempId]: event.target.value }))}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                          >
                            <option value="">{isMatched ? "Usar coincidencia automática" : "Sin asignar — no está en la OC"}</option>
                            <option value="__extra__">No está en la OC</option>
                            {selectedOCItems.map((ocItem) => (
                              <option key={ocItem.id} value={ocItem.id}>{ocItem.ocNumero} · {ocItem.codigo ? `[${ocItem.codigo}] ` : ""}{ocItem.descripcion} · {ocItem.cantidad} {ocItem.unidad || "UN"}</option>
                            ))}
                          </select>
                          {(() => {
                            const target = assignedId && assignedId !== "__extra__" ? selectedOCItems.find((o) => o.id === assignedId) : comparison.matched;
                            if (!target) return null;
                            const tempId = comparison.item.tempId;
                            const activo = tempId in reemplazos;
                            const eq = Number(String(reemplazos[tempId] ?? "").replace(",", ".")) || equivalenciaSugerida(comparison.item.cantidad, target.cantidad);
                            const costoUnit = Number(comparison.item.precio_unitario) * (1 - Number(comparison.item.descuento_porcentaje || 0) / 100);
                            return (
                              <div className={`md:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-[11px] ${activo ? "bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200" : "text-zinc-500"}`}>
                                <label className="flex cursor-pointer items-center gap-1.5">
                                  <input type="checkbox" checked={activo} className="accent-sky-600"
                                    onChange={(e) => {
                                      setReemplazos((cur) => { const n = { ...cur }; if (e.target.checked) n[tempId] = String(equivalenciaSugerida(comparison.item.cantidad, target.cantidad)); else delete n[tempId]; return n; });
                                      if (e.target.checked && !assignedId) setManualItemMatches((cur) => ({ ...cur, [tempId]: target.id }));
                                    }} />
                                  <span><strong>Compré otra cosa:</strong> reemplaza «{target.descripcion}» en {target.ocNumero} (sin OC nueva)</span>
                                </label>
                                {activo && (
                                  <span className="flex items-center gap-1">
                                    1 {target.unidad || "UN"} del PR =
                                    <input value={reemplazos[tempId]} onChange={(e) => setReemplazos((cur) => ({ ...cur, [tempId]: e.target.value }))}
                                      className="w-16 rounded border border-sky-300 bg-white px-1 py-0.5 text-right dark:border-sky-800 dark:bg-zinc-800" />
                                    de la factura → costo PR <strong>{formatCurrency(costoPorUnidadPR(costoUnit, eq), moneda)}</strong>
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                    </div>
                  )}
                </div>
              )
            )}
            {/* Artículos de la factura: se pliegan cuando hay OC (ver detalle) */}
            {items.length > 0 && (verDetalle || !ocConArticulos) && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between"><p className="text-[10px] uppercase text-zinc-400">Artículos de la factura ({items.length})</p><button type="button" onClick={() => setItems((prev) => [...prev, { tempId: uid(), codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, descuento_porcentaje: 0, iva_porcentaje: ivaPorcentaje, unidad: "UN" }])} className="inline-flex items-center gap-1 text-xs font-medium text-orange-600"><Plus size={13} /> Agregar item</button></div>
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
                          <td className="px-1 py-1"><input value={it.codigo || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, codigo: e.target.value } : item))} placeholder="Sin código" className="w-32 rounded border border-zinc-200 bg-transparent px-2 py-1 font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input value={it.descripcion} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descripcion: e.target.value } : item))} className="w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.cantidad} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, cantidad: Number(e.target.value) || 0 } : item))} className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" step="0.01" value={it.precio_unitario} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, precio_unitario: Number(e.target.value) || 0 } : item))} className="w-28 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><input type="number" min="0" max="100" step="0.01" value={it.descuento_porcentaje || ""} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, descuento_porcentaje: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : item))} placeholder="0" className="w-20 rounded border border-zinc-200 bg-transparent px-2 py-1 text-right font-mono dark:border-zinc-700" /></td>
                          <td className="px-1 py-1"><select value={it.iva_porcentaje} onChange={(e) => setItems((prev) => prev.map((item, i) => i === index ? { ...item, iva_porcentaje: Number(e.target.value) } : item))} className="rounded border border-zinc-200 bg-transparent px-1 py-1 dark:border-zinc-700"><option value={0}>0%</option><option value={10.5}>10,5%</option><option value={21}>21%</option><option value={27}>27%</option></select></td>
                          <td className="px-2 py-1 text-right font-mono font-medium">{formatCurrency(itemNeto(it), moneda)}</td>
                          <td><button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>}

          {/* ── Notas y pago con tarjeta, en una fila ── */}
          <section className="grid gap-2 md:grid-cols-2">
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={1}
              placeholder="Notas / observaciones (opcional)"
              className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
            {!isCreditNote && <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-700">
              <strong className="whitespace-nowrap">¿Cómo se paga?</strong>
              <select value={pagoTarjeta} onChange={(e) => { pagoTarjetaTocado.current = true; setPagoTarjeta(e.target.value); }}
                className={`min-w-0 flex-1 rounded border px-1.5 py-1 text-xs dark:bg-zinc-800 ${pagadaSinOP ? "border-orange-300 bg-orange-50 font-medium text-orange-800 dark:border-orange-800 dark:text-orange-300" : "border-zinc-200 bg-white dark:border-zinc-700"}`}>
                <option value="">Va a orden de pago</option>
                {tarjetas.map((t) => <option key={t.id} value={t.id}>Ya pagada con {t.nombre}</option>)}
                <option value="otro">Ya pagada por otro medio (sin OP)</option>
              </select>
            </label>}
          </section>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <p className="text-xs text-zinc-400">
            Queda pendiente de aprobación por administración
          </p>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving || alignmentLoading || alignmentBlocked}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Guardando..." : "Guardar y enviar para aprobación"}
            </button>
          </div>
        </div>
      </div>

      <ProveedorFormModal
        open={nuevoProveedorOpen}
        proveedorId={null}
        inicial={nuevoProveedorInicial}
        consultarArcaAlAbrir
        subtitulo="Se guarda y queda seleccionado en esta factura."
        onClose={() => setNuevoProveedorOpen(false)}
        onSaved={proveedorCreado}
      />
    </div>
  );
}
