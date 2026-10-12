"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, getInitials, todayAR } from "@/lib/utils";
import { precioUnitarioParaFactura } from "@/lib/precio-factura";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { canOverrideInvoiceRate } from "@/lib/invoice-rate-permission";
import { useFiscalDateLimits } from "@/lib/use-fiscal-date-limits";
import { beginInvoiceIntent, postInvoiceIntent } from "@/lib/invoice-intent";
import { useFceCheck, fceTotalArs as calculateFceTotalArs } from "@/lib/use-fce-check";
import { generateFacturaPDF, getSociedadPDF, openPDFWindow, documentFilename } from "@/lib/pdf-templates";
import Link from "next/link";
import {
  FileText, Receipt, Truck, CheckCircle2,
  Loader2, X, ChevronRight, ChevronDown,
  Plus, Minus, DollarSign, Eye, AlertCircle,
  ArrowRight, Clock, Package, ClipboardList, Search, Download, Mail, MailCheck, Maximize2, Minimize2, Ban,
} from "lucide-react";
import { FichasRelevamiento } from "@/components/ventas/fichas-relevamiento";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────

interface VendedorOption {
  id: string;
  full_name: string;
}

interface VentaPresupuesto {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  estado: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  vendedor_id: string | null;
  oc_cliente: string | null;
  oc_cliente_fecha?: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  observaciones: string | null;
  vendedor_profile: { full_name: string; avatar_url: string | null } | null;
  listo_para_facturar?: boolean;
  clientes: { razon_social: string; cuit: string; condicion_iva: string; forma_pago: string | null; dias_cuenta_corriente?: number | null; limite_credito?: number | null; saldo_cuenta_corriente?: number | null; email?: string | null; email_facturacion?: string | null } | null;
  presupuesto_items: {
    descripcion: string;
    cantidad: number;
    precio_venta: number | null;
    iva_porcentaje: number;
    total: number | null;
  }[];
}

interface VentaFactura {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  cae: string | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  estado: string;
  presupuesto_id: string | null;
  tipo_cambio?: number | null;
  cae_vencimiento?: string | null;
  fecha_vencimiento?: string | null;
  condicion_venta?: string | null;
  oc_cliente?: string | null;
  email_enviado_at?: string | null;
  email_enviado_a?: string | null;
  factura_origen_id?: string | null;
}

interface VentaRemito {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  presupuesto_id: string | null;
}

interface VentaOC {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  total: number;
  moneda: string;
  pago: string | null;
  presupuesto_origen_id: string;
}

interface Venta {
  presupuesto: VentaPresupuesto;
  facturas: VentaFactura[];
  remitos: VentaRemito[];
  ordenesCompra: VentaOC[];
}

type EmitTipo = "FA" | "FB" | "FCEA" | "FCEB" | "X";

interface EmitItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

function isFacturaA(tipo: EmitTipo): boolean {
  return tipo.endsWith("A");
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function convertItemsForInvoiceType(items: EmitItem[], from: EmitTipo, to: EmitTipo): EmitItem[] {
  if (isFacturaA(from) === isFacturaA(to)) return items;

  return items.map((item) => {
    const ivaFactor = 1 + (item.iva_porcentaje ?? 21) / 100;
    const precioUnitario = isFacturaA(from)
      ? item.precio_unitario * ivaFactor
      : item.precio_unitario / ivaFactor;

    return { ...item, precio_unitario: roundMoney(precioUnitario) };
  });
}

// ── Pipeline logic ───────────────────────────────────────────────
// Entrega y Factura son independientes: se puede facturar sin entregar y viceversa

type VentaStep = 0 | 1 | 2 | 3;

interface VentaStatus {
  entregado: boolean;
  facturado: boolean;
  cobrado: boolean;
}

function getVentaStatus(v: Venta): VentaStatus {
  const facturaActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
  return {
    entregado: v.remitos.some(r => r.estado === "entregado"),
    facturado: !!facturaActiva,
    cobrado: facturaActiva?.estado === "pagada" || false,
  };
}

// Asigna cada venta a UN SOLO bucket del pipeline (mutuamente exclusivos)
type VentaStage = "pend_factura" | "facturadas";
function getVentaStage(v: Venta): VentaStage {
  const s = getVentaStatus(v);
  if (s.facturado) return "facturadas";
  return "pend_factura";
}

// Keep getVentaStep for KPI filtering compatibility
function getVentaStep(v: Venta): VentaStep {
  const s = getVentaStatus(v);
  if (s.cobrado) return 3;
  if (s.facturado && s.entregado) return 3; // Completada (falta cobro)
  if (s.facturado || s.entregado) return 2; // En progreso
  if (v.remitos.length > 0) return 1; // Algo iniciado
  return 0; // Pendiente
}

function calcFechaVenc(condVenta: string, fechaBase: string): string {
  const diasMap: Record<string, number> = {
    "Contado": 0, "Cta. Cte.": 30,
    "15 días": 15, "30 días": 30, "45 días": 45, "60 días": 60, "90 días": 90,
    "Cheque 30 días": 30, "Cheque 60 días": 60, "Cheque 90 días": 90,
  };
  const dias = diasMap[condVenta];
  if (dias == null || !fechaBase) return "";
  const d = new Date(fechaBase + "T12:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

const STEP_LABELS = ["Presupuesto", "Entrega", "Factura", "Cobro"];
const STEP_ICONS = [FileText, Truck, Receipt, DollarSign];

// ── Component ────────────────────────────────────────────────────

export default function VentasPage() {
  const { role, sociedadActiva, profile } = useUser();
  const [rateOverride, setRateOverride] = useState(false);
  const canOverrideRate = canOverrideInvoiceRate(profile?.email);

  const minFecha = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d.toISOString().slice(0, 10);
  }, []);

  const pvOpciones = useMemo(() => {
    if (sociedadActiva?.nombre === "Grupo LA") return [10];
    return [15, 16];
  }, [sociedadActiva]);
  const [pvCrm, setPvCrm] = useState(() => pvOpciones[0]);

  const [ventas, setVentas] = useState<Venta[]>([]);
  const ventasRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [vendedores, setVendedores] = useState<VendedorOption[]>([]);
  const [filterVendedor, setFilterVendedor] = useState<string>("todos");
  const [filterCliente, setFilterCliente] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [filterMoneda, setFilterMoneda] = useState<string>("todas");
  const [filterFacturacion, setFilterFacturacion] = useState<"todas" | "pend" | "lista" | "facturada">("pend");
  const [selectedVentaId, setSelectedVentaId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Emit modal state
  const [emitFullscreen, setEmitFullscreen] = useState(false);
  const [emitModalOpen, setEmitModalOpen] = useState(false);
  const [emitVenta, setEmitVenta] = useState<Venta | null>(null);
  const [emitTipo, setEmitTipo] = useState<EmitTipo>("FB");
  const [emitItems, setEmitItems] = useState<EmitItem[]>([]);
  const [emitting, setEmitting] = useState(false);
  const [emitTipoCambio, setEmitTipoCambio] = useState<number>(0);
  const [emitMoneda, setEmitMoneda] = useState<"ARS" | "USD">("ARS");
  const [emitError, setEmitError] = useState("");
  const [emitSuccess, setEmitSuccess] = useState("");
  const [emitFacturaId, setEmitFacturaId] = useState<string | null>(null);
  const [downloadingFacturaId, setDownloadingFacturaId] = useState<string | null>(null);
  const [emitManual, setEmitManual] = useState(false);
  const editRate = emitManual || (canOverrideRate && rateOverride);
  const [emitNextNum, setEmitNextNum] = useState<number | null>(null);
  const [emitFecha, setEmitFecha] = useState("");
  const [emitPvManual, setEmitPvManual] = useState<number>(0);
  const [emitCondVenta, setEmitCondVenta] = useState("Contado");
  const [emitFechaVenc, setEmitFechaVenc] = useState("");
  const [emitFceCbu, setEmitFceCbu] = useState("");
  const [emitFceTransmision, setEmitFceTransmision] = useState<"" | "SCA" | "ADC">("");
  const emitIsFce = !emitManual && (emitTipo === "FCEA" || emitTipo === "FCEB");
  const [emitObservaciones, setEmitObservaciones] = useState("");
  const fiscalDates = useFiscalDateLimits(emitModalOpen && !emitManual, sociedadActiva?.id, pvCrm, emitTipo);
  const fiscalMinDate = fiscalDates.minDate && fiscalDates.minDate > minFecha ? fiscalDates.minDate : minFecha;
  const fiscalDateBlocked = !emitManual && (!fiscalDates.ready || emitFecha < fiscalMinDate || emitFecha > todayAR());
  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);
  const [cotizFecha, setCotizFecha] = useState("");
  const [emitRateModality, setEmitRateModality] = useState<"divisas" | "billetes">("divisas");
  const cotizRequest = useRef(0);
  const fceCheck = useFceCheck(emitModalOpen && !emitManual, sociedadActiva?.id, emitVenta?.presupuesto.cliente_id, emitFecha);
  const fceTotalArs = calculateFceTotalArs(emitItems.map(it => {
    let price = it.precio_unitario;
    const source = emitVenta?.presupuesto.moneda || "ARS";
    if (source !== emitMoneda && emitTipoCambio > 0) price = roundMoney(source === "USD" ? price * emitTipoCambio : price / emitTipoCambio);
    return { ...it, precio_unitario: price };
  }), isFacturaA(emitTipo), emitMoneda === "USD" ? emitTipoCambio : 1);
  const fceNeedsRate = emitMoneda === "USD" || emitVenta?.presupuesto.moneda === "USD";
  const fceRateReady = !fceNeedsRate || (emitTipoCambio > 0 && !cotizBnaLoading && (editRate || !!cotizBna));
  const fceRequired = fceCheck.ready && fceCheck.obligado && fceTotalArs >= (fceCheck.montoDesde || Infinity);
  const fceExpectedTipo = isFacturaA(emitTipo) ? (fceRequired ? "FCEA" : "FA") : (fceRequired ? "FCEB" : "FB");
  const fceBlocked = !emitManual && (!fceCheck.ready || !fceRateReady || emitTipo !== fceExpectedTipo);
  useEffect(() => {
    if (!emitModalOpen || emitManual || !fceCheck.ready || !fceRateReady) return;
    if (emitTipo !== fceExpectedTipo) setEmitTipo(fceExpectedTipo);
  }, [emitModalOpen, emitManual, fceCheck.ready, fceRateReady, emitTipo, fceExpectedTipo]);

  useEffect(() => {
    const id = ++cotizRequest.current;
    setCotizBnaLoading(false);
    if (!emitModalOpen || editRate || (emitMoneda !== "USD" && emitVenta?.presupuesto.moneda !== "USD")) return;
    setEmitTipoCambio(0); setCotizBna(null); setCotizBnaLoading(true);
    fetch(`/api/cotizacion-bna?fecha_factura=${encodeURIComponent(emitFecha)}&modalidad=${emitVenta?.presupuesto.cotizacion_modalidad === "billetes" ? "billetes" : "divisas"}`)
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error); return data; })
      .then(data => { if (id !== cotizRequest.current) return; setCotizBna(data); setEmitRateModality(data.modalidad); setEmitTipoCambio(data.valor_venta); })
      .catch(error => { if (id === cotizRequest.current) setEmitError(error.message || "No se pudo verificar la cotización automática."); })
      .finally(() => { if (id === cotizRequest.current) setCotizBnaLoading(false); });
    return () => { cotizRequest.current += 1; };
  }, [emitModalOpen, editRate, emitMoneda, emitFecha, emitVenta?.presupuesto.id, emitVenta?.presupuesto.moneda, emitVenta?.presupuesto.cotizacion_modalidad]);

  async function fetchCotizBna(modalidad: "divisas" | "billetes" = "divisas", fecha?: string) {
    const id = ++cotizRequest.current;
    setCotizBnaLoading(true);
    try {
      const params = new URLSearchParams({ modalidad });
      if (fecha) params.set("fecha", fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      if (res.ok && id === cotizRequest.current) {
        const data = await res.json();
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad });
        setEmitRateModality(modalidad);
        setEmitTipoCambio(data.valor_venta);
      }
    } catch { /* silencioso */ } finally {
      if (id === cotizRequest.current) setCotizBnaLoading(false);
    }
  }

  // Tab: pipeline vs fichas
  const [ventasTab, setVentasTab] = useState<"pipeline" | "fichas">("pipeline");

  // Remito creation state
  const [creatingRemito, setCreatingRemito] = useState(false);

  useEffect(() => { setPvCrm(pvOpciones[0]); }, [pvOpciones]);

  const fetchData = useCallback(async () => {
    const request = ++ventasRequest.current;
    try {
      // Fetch presupuestos aprobados with items
      let presupuestosQuery = supabase
        .from("presupuestos")
        .select(`
          id, numero, cliente_id, fecha, estado, subtotal, iva, total, moneda, tipo_cambio, cotizacion_modalidad, vendedor_id, modalidad_emision, oc_cliente, oc_cliente_fecha, archivo_url, archivo_nombre, observaciones, listo_para_facturar,
          vendedor_profile:vendedor_id(full_name, avatar_url),
          clientes(razon_social, cuit, condicion_iva, forma_pago, dias_cuenta_corriente, limite_credito, saldo_cuenta_corriente, email, email_facturacion),
          presupuesto_items(id, descripcion, cantidad, precio_venta, iva_porcentaje, total)
        `)
        .in("estado" as any, ["aprobado", "facturar", "facturado"])
        .neq("eliminado" as any, true)
        .order("fecha", { ascending: false });
      if (sociedadActiva?.id) presupuestosQuery = presupuestosQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: presupuestos, error: pError } = await presupuestosQuery;
      if (request !== ventasRequest.current) return;

      if (pError || !presupuestos) {
        console.error("Error fetching presupuestos:", pError);
        setVentas([]);
        setLoading(false);
        return;
      }

      // Get all presupuesto IDs
      const pIds = presupuestos.map((p: any) => p.id);

      // Fetch related facturas, remitos and OC in parallel
      const [facturasRes, remitosRes, ocRes] = await Promise.all([
        pIds.length > 0
          ? (() => {
              let q = (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, cae_vencimiento, subtotal, iva, total, moneda, tipo_cambio, estado, presupuesto_id, fecha_vencimiento, condicion_venta, oc_cliente, email_enviado_at, email_enviado_a, factura_origen_id").in("presupuesto_id", pIds);
              if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
              return q;
            })()
          : { data: [], error: null },
        pIds.length > 0
          ? (() => {
              let q = supabase.from("remitos").select("id, numero, fecha, estado, presupuesto_id").in("presupuesto_id", pIds);
              if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
              return q;
            })()
          : { data: [], error: null },
        pIds.length > 0
          ? (() => {
              let q = (supabase as any).from("ordenes_compra").select("id, numero, fecha, estado, total, moneda, pago, presupuesto_origen_id").in("presupuesto_origen_id", pIds);
              if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
              return q;
            })()
          : { data: [], error: null },
      ]);

      const facturas = (facturasRes.data || []) as VentaFactura[];
      if (request !== ventasRequest.current) return;
      const remitos = (remitosRes.data || []) as VentaRemito[];
      const ocs = (ocRes.data || []) as VentaOC[];

      // Build ventas array — exclude "aprobado" PRs with no facturas/remitos (not ready for ventas)
      const ventasArr: Venta[] = presupuestos.map((p: any) => ({
        presupuesto: p as VentaPresupuesto,
        facturas: facturas.filter(f => f.presupuesto_id === p.id),
        remitos: remitos.filter(r => r.presupuesto_id === p.id),
        ordenesCompra: ocs.filter(oc => oc.presupuesto_origen_id === p.id),
      })).filter(v => v.presupuesto.estado !== "aprobado" || v.facturas.length > 0 || v.remitos.length > 0);

      setVentas(ventasArr);

      // Fetch vendedores for filter
      const { data: vendedorData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["vendedor", "admin", "super_admin"])
        .eq("active", true);
      if (vendedorData && request === ventasRequest.current) setVendedores(vendedorData as VendedorOption[]);
    } catch (err) {
      console.error("Error fetching ventas:", err);
      if (request === ventasRequest.current) setVentas([]);
    } finally {
      if (request === ventasRequest.current) setLoading(false);
    }
  }, [sociedadActiva]);

  async function downloadFactura(facturaId: string, preview?: boolean) {
    if (!sociedadActiva || downloadingFacturaId) return;
    setDownloadingFacturaId(facturaId);
    try {
      const [{ data: factura, error: facturaError }, { data: items, error: itemsError }] = await Promise.all([
        (supabase as any).from("facturas")
          .select("*, clientes(razon_social, cuit, condicion_iva, direccion, localidad, provincia, email, telefono)")
          .eq("id", facturaId).single(),
        supabase.from("factura_items")
          .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
          .eq("factura_id", facturaId).order("orden"),
      ]);
      if (facturaError || !factura) throw facturaError || new Error("Factura no encontrada");
      if (itemsError) throw itemsError;

      const soc = getSociedadPDF(sociedadActiva);
      const cli = factura.clientes;
      const html = generateFacturaPDF({
        tipo: factura.tipo,
        punto_venta: factura.punto_venta,
        numero: factura.numero,
        fecha: factura.fecha,
        fecha_vencimiento: factura.fecha_vencimiento,
        nota_interna: factura.nota_interna,
        observaciones: factura.observaciones,
        condicion_venta: factura.condicion_venta,
        moneda: factura.moneda || "ARS",
        tipo_cambio: factura.tipo_cambio,
        subtotal: Number(factura.subtotal),
        iva: Number(factura.iva),
        total: Number(factura.total),
        cae: factura.cae,
        cae_vencimiento: factura.cae_vencimiento,
        oc_cliente: factura.oc_cliente,
        cliente: cli ? {
          razon_social: cli.razon_social,
          cuit: cli.cuit,
          condicion_iva: cli.condicion_iva,
          direccion: cli.direccion,
          localidad: cli.localidad,
          provincia: cli.provincia,
          email: cli.email,
          telefono: cli.telefono,
        } : null,
        items: (items || []).map((it) => ({
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precio_unitario: Number(it.precio_unitario),
          iva_porcentaje: Number(it.iva_porcentaje),
          subtotal: Number(it.subtotal ?? (Number(it.cantidad) * Number(it.precio_unitario))),
        })),
      }, {
        razonSocial: soc.razonSocial,
        cuit: soc.cuit,
        cuitNumero: Number(soc.cuit.replace(/\D/g, "")),
        condicionIva: soc.condicionIva,
        domicilio: soc.domicilio,
        ptoVta: factura.punto_venta,
      }, soc);
      await openPDFWindow(html, documentFilename(factura.tipo, factura.punto_venta, factura.numero, cli?.razon_social), preview);
    } catch (error) {
      console.error("Error descargando factura:", error);
      alert("No se pudo descargar la factura. Intentá nuevamente.");
    } finally {
      setDownloadingFacturaId(null);
    }
  }

  useEffect(() => { fetchData(); }, [fetchData]);

  // Los cambios de Presupuestos deben actualizar también el filtro de Ventas.
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    const refresh = () => { if (document.visibilityState === "visible") void fetchData(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const channel = supabase.channel(`ventas-presupuestos-${sociedadActiva.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "presupuestos", filter: `sociedad_id=eq.${sociedadActiva.id}` }, (payload) => {
        const updated = payload.new as { id: string; listo_para_facturar?: boolean; estado?: string };
        setVentas(current => current.map(venta => venta.presupuesto.id === updated.id
          ? { ...venta, presupuesto: { ...venta.presupuesto, ...updated } }
          : venta));
        void fetchData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "facturas", filter: `sociedad_id=eq.${sociedadActiva.id}` }, () => {
        void fetchData();
      }).subscribe();
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      void supabase.removeChannel(channel);
    };
  }, [fetchData, sociedadActiva?.id]);

  // ── Filtered data ──────────────────────────────────────────────

  const filteredVentas = useMemo(() => {
    const q = filterCliente.toLowerCase().trim();
    return ventas.filter(v => {
      if (filterVendedor !== "todos" && v.presupuesto.vendedor_id !== filterVendedor) return false;
      if (q && !(v.presupuesto.clientes?.razon_social || "").toLowerCase().includes(q) && !v.presupuesto.numero.toLowerCase().includes(q)) return false;
      if (filterMoneda !== "todas" && v.presupuesto.moneda !== filterMoneda) return false;
      if (filterFacturacion !== "todas") {
        const st = getVentaStatus(v);
        if (filterFacturacion === "pend" && st.facturado) return false;
        if (filterFacturacion === "lista" && (v.presupuesto.estado !== "facturar" || st.facturado)) return false;
        if (filterFacturacion === "facturada" && !st.facturado) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = a.presupuesto.fecha || "";
      const db = b.presupuesto.fecha || "";
      return sortOrder === "desc" ? db.localeCompare(da) : da.localeCompare(db);
    });
  }, [ventas, filterVendedor, filterCliente, sortOrder, filterMoneda, filterFacturacion]);

  // KPIs from filtered ventas (respecting vendedor filter, ignoring step filter)
  const kpis = useMemo(() => {
    const base = ventas.filter(v =>
      filterVendedor === "todos" || v.presupuesto.vendedor_id === filterVendedor
    );
    const total = base.length;
    const pendFactura = base.filter(v => getVentaStage(v) === "pend_factura").length;
    const facturadas = base.filter(v => getVentaStage(v) === "facturadas").length;
    const montoTotal = base.reduce((sum, v) => sum + (v.presupuesto.total || 0), 0);
    return { total, pendFactura, facturadas, montoTotal };
  }, [ventas, filterVendedor]);

  const selectedVenta = useMemo(() => {
    if (!selectedVentaId) return null;
    return filteredVentas.find(v => v.presupuesto.id === selectedVentaId) || null;
  }, [filteredVentas, selectedVentaId]);

  async function fetchNextNum(tipo: string, pv?: number) {
    try {
      let q = supabase.from("facturas").select("numero").eq("tipo" as any, tipo).eq("punto_venta" as any, pv ?? pvCrm);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q.order("numero", { ascending: false }).limit(1);
      setEmitNextNum(((data && data.length > 0 ? (data[0] as any).numero : 0) || 0) + 1);
    } catch { setEmitNextNum(null); }
  }

  // ── Actions ────────────────────────────────────────────────────

  function openEmitModal(venta: Venta) {
    beginInvoiceIntent(`presupuesto:${sociedadActiva?.id}:${venta.presupuesto.id}`);
    const p = venta.presupuesto;
    const condIva = p.clientes?.condicion_iva;
    const defaultTipo: EmitTipo = ["RI", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((condIva || "").toUpperCase()) ? "FA" : "FB";
    const sourceIsManual = (p as any).modalidad_emision === "manual";
    const initialTipo: EmitTipo = sourceIsManual ? "X" : defaultTipo;

    const items = (p.presupuesto_items || []).map(it => {
      const ivaPorcentaje = Number(it.iva_porcentaje ?? 21);
      const precioNeto = it.precio_venta ?? (it.total
        ? it.total / (it.cantidad || 1) / (1 + ivaPorcentaje / 100)
        : 0);

      return {
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        // Un PR manual ya guarda el precio final; no se le vuelve a sumar IVA al facturarlo.
        // Los PR A/B electrónicos guardan precio neto. Regla única en lib/precio-factura.
        precio_unitario: precioUnitarioParaFactura({ tipo: defaultTipo, sourceIsManual, precioNeto, ivaPorcentaje }),
        iva_porcentaje: ivaPorcentaje,
      };
    });

    setEmitVenta(venta);
    setEmitTipo(initialTipo);
    setEmitItems(items.length > 0 ? items : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }]);
    const hoy = todayAR();
    const diasCC = p.clientes?.dias_cuenta_corriente;
    const formaPago = p.clientes?.forma_pago;
    // Map client's dias_cuenta_corriente to a valid condicion_venta option
    let condCliente = "Contado";
    if (diasCC && diasCC > 0) {
      const diasOpts: Record<number, string> = { 15: "15 días", 30: "30 días", 45: "Cta. Cte.", 60: "60 días", 90: "90 días" };
      if (formaPago && formaPago.toLowerCase().includes("cheque")) {
        condCliente = diasOpts[diasCC] ? `Cheque ${diasCC} días` : `Cheque ${diasCC} días`;
        // Validate it's a known option, fallback to nearest
        if (!["Cheque 30 días", "Cheque 60 días", "Cheque 90 días"].includes(condCliente)) condCliente = diasOpts[diasCC] || `${diasCC} días`;
      } else {
        condCliente = diasOpts[diasCC] || `${diasCC} días`;
      }
    }

    setEmitTipoCambio(p.tipo_cambio || 0);
    setRateOverride(false);
    setEmitRateModality(p.cotizacion_modalidad === "billetes" ? "billetes" : "divisas");
    setEmitMoneda(p.moneda as "ARS" | "USD" || "ARS");
    setEmitError("");
    setEmitSuccess("");
    setEmitFacturaId(null);
    setEmitManual(sourceIsManual);
    setEmitPvManual(0);
    setEmitFecha(hoy);
    setEmitCondVenta(condCliente);
    setEmitFechaVenc(calcFechaVenc(condCliente, hoy));
    setEmitFceCbu("");
    setEmitFceTransmision("");
    setEmitObservaciones("");
    setCotizBna(null);
    setEmitModalOpen(true);
    fetchNextNum(initialTipo, sourceIsManual ? 0 : undefined);
  }

  async function handleEmitFactura() {
    if (!emitVenta || emitting) return;
    if (fceBlocked) { setEmitError(fceCheck.error || "Esperá la verificación de FCE y de la cotización antes de emitir."); return; }
    if (fiscalDateBlocked) { setEmitError(fiscalDates.error || `Elegí una fecha válida desde ${fiscalMinDate}; esperá la verificación de ARCA si está en curso.`); return; }
    const p = emitVenta.presupuesto;

    if (emitIsFce && (!emitFechaVenc || emitFechaVenc < emitFecha || emitFechaVenc < todayAR())) {
      setEmitError("La FCE requiere un vencimiento igual o posterior a hoy y a la fecha de emisión."); return;
    }
    if (emitIsFce && (!/^\d{22}$/.test(emitFceCbu) || !emitFceTransmision)) {
      setEmitError("La FCE requiere la CBU del emisor (22 dígitos) y elegir SCA o ADC."); return;
    }

    if (emitItems.some(it => !it.descripcion || it.precio_unitario <= 0 || it.cantidad <= 0)) {
      setEmitError("Completa todos los items con descripcion, cantidad > 0 y precio > 0.");
      return;
    }
    const prMoneda = p.moneda || "ARS";
    const needsConversion = emitMoneda !== prMoneda && emitTipoCambio > 0;
    if (emitMoneda !== prMoneda && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio para convertir de " + prMoneda + " a " + emitMoneda);
      return;
    }
    if (emitMoneda === "USD" && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio USD → ARS para facturar en USD.");
      return;
    }

    setEmitting(true);
    setEmitError("");

    try {
      const convertPrice = (price: number) => {
        if (!needsConversion) return price;
        return prMoneda === "USD" ? Math.round(price * emitTipoCambio * 100) / 100 : Math.round(price / emitTipoCambio * 100) / 100;
      };
      const { data: { session } } = await supabase.auth.getSession();
      const res = await postInvoiceIntent(`presupuesto:${sociedadActiva?.id}:${p.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tipo: emitTipo,
          cliente_id: p.cliente_id,
          punto_venta: pvCrm,
          moneda: emitMoneda,
          tipo_cambio: emitMoneda === "USD" && emitTipoCambio > 0 ? emitTipoCambio : null,
          cotizacion_override: canOverrideRate && rateOverride,
          cotizacion_fecha: cotizFecha || cotizBna?.fecha || null,
          cotizacion_modalidad: emitRateModality,
          items: emitItems.map(it => ({ ...it, precio_unitario: convertPrice(it.precio_unitario) })),
          presupuesto_id: p.id,
          sociedad_id: sociedadActiva?.id || null,
          fecha: emitFecha || null,
          condicion_venta: emitCondVenta || null,
          fecha_vencimiento: emitFechaVenc || null,
          fce_cbu: emitIsFce ? emitFceCbu : undefined,
          fce_transmision: emitIsFce ? emitFceTransmision : undefined,
          observaciones: emitObservaciones || null,
          oc_cliente: p.oc_cliente || null,
          oc_cliente_fecha: p.oc_cliente_fecha || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmitSuccess(`${data.factura.comprobante} emitida - CAE: ${data.factura.cae}${data.warning ? ` · ${data.warning}` : ""}${data.warnings?.length ? ` · Advertencias ARCA: ${data.warnings.map((w: any) => typeof w === "string" ? w : (w.Msg || w.message || JSON.stringify(w))).join("; ")}` : ""}`);
        setEmitFacturaId(data.factura.id);
        // Marcar PR como facturado
        let prUpdate = supabase.from("presupuestos").update({ estado: "facturado" } as any).eq("id", p.id);
        if (sociedadActiva?.id) prUpdate = prUpdate.eq("sociedad_id" as any, sociedadActiva.id);
        const { error: prErr } = await prUpdate;
        if (prErr) console.error("Error al marcar PR como facturado:", prErr.message);
        await fetchData();
      } else {
        setEmitError(data.error || "Error al emitir factura");
      }
    } catch (err) {
      setEmitError("Error de conexion al emitir factura");
    } finally {
      setEmitting(false);
    }
  }

  async function handleCancelarVenta(prId: string) {
    if (!confirm("¿Cancelar esta venta? El presupuesto pasará a estado «rechazado» y saldrá de Ventas.")) return;
    let finQ = (supabase as any).from("presupuestos").update({ estado: "rechazado" }).eq("id", prId);
    if (sociedadActiva?.id) finQ = finQ.eq("sociedad_id", sociedadActiva.id);
    const { error } = await finQ;
    if (error) { alert("Error al cancelar: " + error.message); return; }
    await fetchData();
    setSelectedVentaId(null);
  }

  async function handleEmitFacturaManual() {
    if (!emitVenta || emitting) return;
    const p = emitVenta.presupuesto;

    if (emitItems.some(it => !it.descripcion || it.precio_unitario <= 0 || it.cantidad <= 0)) {
      setEmitError("Completa todos los items con descripcion, cantidad > 0 y precio > 0.");
      return;
    }
    if (emitMoneda !== (p.moneda || "ARS") && (!emitTipoCambio || emitTipoCambio <= 0)) {
      setEmitError("Ingresa el tipo de cambio para convertir de " + (p.moneda || "ARS") + " a " + emitMoneda);
      return;
    }

    setEmitting(true);
    setEmitError("");

    try {
      // Todo comprobante manual es X, con precio final y sin IVA.
      const tipoManual: EmitTipo = "X";
      const pvManual = emitPvManual || 0;
      let maxQuery = supabase
        .from("facturas")
        .select("numero")
        .eq("tipo" as any, tipoManual)
        .eq("punto_venta" as any, pvManual);
      if (sociedadActiva?.id) {
        maxQuery = maxQuery.eq("sociedad_id" as any, sociedadActiva.id);
      }
      const { data: maxRows } = await maxQuery
        .order("numero", { ascending: false })
        .limit(1);

      const nextNumero = ((maxRows && maxRows.length > 0 ? maxRows[0].numero : 0) || 0) + 1;

      // Calculate totals — convert prices if moneda changed
      const prMoneda = p.moneda || "ARS";
      const needsConv = emitMoneda !== prMoneda && emitTipoCambio > 0;
      const conv = (price: number) => {
        if (!needsConv) return price;
        return prMoneda === "USD" ? Math.round(price * emitTipoCambio * 100) / 100 : Math.round(price / emitTipoCambio * 100) / 100;
      };

      const total = roundMoney(emitItems.reduce((sum, it) => sum + it.cantidad * conv(it.precio_unitario), 0));
      const subtotal = total;
      const iva = 0;

      // Insert factura
      const { data: facturaData, error: fError } = await (supabase.from("facturas") as any)
        .insert({
          tipo: tipoManual,
          punto_venta: pvManual,
          numero: nextNumero,
          cliente_id: p.cliente_id,
          presupuesto_id: p.id,
          fecha: emitFecha || todayAR(),
          cae: null,
          cae_vencimiento: null,
          subtotal,
          iva,
          total,
          moneda: emitMoneda,
          tipo_cambio: emitMoneda === "USD" && emitTipoCambio > 0 ? emitTipoCambio : null,
          estado: "emitida",
          condicion_venta: emitCondVenta || null,
          fecha_vencimiento: emitFechaVenc || null,
          observaciones: emitObservaciones || null,
          sociedad_id: sociedadActiva?.id || null,
          oc_cliente: (p as any).oc_cliente || null,
          oc_cliente_fecha: p.oc_cliente_fecha || null,
        })
        .select("id")
        .single();

      if (fError || !facturaData) {
        setEmitError("Error al crear factura manual: " + (fError?.message || "Error desconocido"));
        return;
      }

      // Insert factura items
      const facturaItems = emitItems.map((it, idx) => ({
        factura_id: facturaData.id,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: conv(it.precio_unitario),
        iva_porcentaje: 0,
        orden: idx,
      }));
      const { error: itemsError } = await (supabase.from("factura_items") as any).insert(facturaItems);
      if (itemsError) throw itemsError;

      const comp = `${tipoManual} ${String(pvManual).padStart(4, "0")}-${String(nextNumero).padStart(8, "0")}`;
      setEmitSuccess(`${comp} emitida (manual, sin CAE)`);
      setEmitFacturaId(facturaData.id);
      // Marcar PR como facturado
      let prUpdate = supabase.from("presupuestos").update({ estado: "facturado" } as any).eq("id", p.id);
      if (sociedadActiva?.id) prUpdate = prUpdate.eq("sociedad_id" as any, sociedadActiva.id);
      await prUpdate;
      await fetchData();
    } catch (err) {
      setEmitError("Error al crear factura manual");
    } finally {
      setEmitting(false);
    }
  }

  async function handleCrearRemito(venta: Venta) {
    const p = venta.presupuesto;
    setCreatingRemito(true);
    try {
      // Create remito
      const { data: remitoData, error: rError } = await (supabase.from("remitos") as any)
        .insert({
          cliente_id: p.cliente_id,
          presupuesto_id: p.id,
          fecha: todayAR(),
          observaciones: `Desde presupuesto ${p.numero}`,
          estado: "pendiente",
          oc_cliente: (p as any).oc_cliente || null,
          sociedad_id: sociedadActiva?.id || null,
        })
        .select("id")
        .single();

      if (rError || !remitoData) {
        console.error("Error creando remito:", rError);
        alert("Error al crear remito: " + (rError?.message || "Error desconocido"));
        return;
      }

      // Create remito items from presupuesto items
      if (p.presupuesto_items?.length > 0) {
        const items = p.presupuesto_items.map((item: any, idx: number) => ({
          remito_id: remitoData.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          unidad: "u",
          orden: idx,
          presupuesto_item_id: item.id || null,
        }));
        const { error: riError } = await (supabase.from("remito_items") as any).insert(items);
        if (riError) {
          alert("Error creando items del remito: " + riError.message);
        }
      }

      await fetchData();
    } catch (err) {
      console.error("Error creando remito:", err);
      alert("Error al crear remito");
    } finally {
      setCreatingRemito(false);
    }
  }

  async function handleMarcarEntregado(remitoId: string) {
    let remitoUpdate = supabase.from("remitos").update({ estado: "entregado" } as any).eq("id", remitoId);
    if (sociedadActiva?.id) remitoUpdate = remitoUpdate.eq("sociedad_id" as any, sociedadActiva.id);
    const { error } = await remitoUpdate;
    if (error) {
      alert("Error al marcar como entregado: " + error.message);
      return;
    }
    await fetchData();
  }

  // Cobro se registra desde la pagina de facturacion (con movimientos transaccionales via registrar_cobro RPC)

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header title="Ventas" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Ventas" subtitle={`${ventas.length} ventas en proceso`} />
      <div className="p-3 sm:p-5 space-y-4">

        {/* Tab toggle */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => setVentasTab("pipeline")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              ventasTab === "pipeline"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <span className="flex items-center gap-2"><Package className="h-4 w-4" /> Pipeline</span>
          </button>
          <button
            onClick={() => setVentasTab("fichas")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              ventasTab === "fichas"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
            }`}
          >
            <span className="flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Fichas de relevamiento</span>
          </button>
        </div>

        {ventasTab === "fichas" ? (
          <FichasRelevamiento />
        ) : (
        <>
        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Total", value: kpis.total, color: "text-zinc-900 dark:text-white" },
            { label: "Pend. factura", value: kpis.pendFactura, color: "text-red-600" },
            { label: "Facturadas", value: kpis.facturadas, color: "text-blue-600" },
          ].map(kpi => (
            <div
              key={kpi.label}
              className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950"
            >
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">{kpi.label}</p>
              <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={filterCliente}
              onChange={e => setFilterCliente(e.target.value)}
              placeholder="Buscar cliente o PR..."
              className="rounded-lg border border-zinc-300 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white w-56"
            />
          </div>
          <select
            value={filterVendedor}
            onChange={e => setFilterVendedor(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="todos">Todos los vendedores</option>
            {vendedores.map(v => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
          <select
            value={filterMoneda}
            onChange={e => setFilterMoneda(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="todas">Todas las monedas</option>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
          <select
            value={filterFacturacion}
            onChange={e => setFilterFacturacion(e.target.value as any)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="todas">Todas</option>
            <option value="pend">Pend. factura</option>
            <option value="lista">Lista para facturar</option>
            <option value="facturada">Facturadas</option>
          </select>
          <button
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800"
            title={sortOrder === "desc" ? "Más nuevos primero" : "Más viejos primero"}
          >
            <Clock className="h-3.5 w-3.5" />
            {sortOrder === "desc" ? "Nuevos → Viejos" : "Viejos → Nuevos"}
          </button>
          <span className="ml-auto text-sm text-zinc-400">
            {filteredVentas.length} venta{filteredVentas.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Main content */}
        <div className="flex gap-6">
          {/* List */}
          <div className={`space-y-3 ${selectedVenta ? "w-1/2 hidden lg:block" : "w-full"}`}>
            {filteredVentas.length === 0 ? (
              <Card className="p-12 text-center">
                <Package className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500">No hay ventas que coincidan con los filtros</p>
              </Card>
            ) : (
              filteredVentas.map(v => {
                const p = v.presupuesto;
                const step = getVentaStep(v);
                const vendedorName = (p.vendedor_profile as any)?.full_name;
                const isSelected = selectedVentaId === p.id;

                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedVentaId(isSelected ? null : p.id);
                      setExpandedSection(null);
                    }}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      isSelected
                        ? "border-orange-500 bg-orange-50/50 dark:bg-orange-950/20"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white">{p.numero}</span>
                          <span className="text-sm text-zinc-500">{p.clientes?.razon_social}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {vendedorName && (
                            <span className="text-xs text-zinc-400">{vendedorName}</span>
                          )}
                          <span className="text-xs text-zinc-400">{formatDate(p.fecha)}</span>
                          {!!p.clientes?.limite_credito && Number(p.clientes.saldo_cuenta_corriente || 0) >= Number(p.clientes.limite_credito) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                              <AlertCircle className="h-3 w-3" /> Límite de crédito excedido
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-zinc-900 dark:text-white">
                          {formatCurrency(p.total, p.moneda as "ARS" | "USD")}
                        </p>
                      </div>
                    </div>

                    {/* Status badges — entrega y factura independientes */}
                    {(() => {
                      const st = getVentaStatus(v);
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          {/* Presupuesto siempre done */}
                          <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                            <FileText className="h-3 w-3" />
                            <span className="hidden sm:inline">Aprobado</span>
                          </div>
                          {/* Entrega */}
                          <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                            st.entregado
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                              : v.remitos.length > 0
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                                : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                          }`}>
                            <Truck className="h-3 w-3" />
                            <span className="hidden sm:inline">{st.entregado ? "Entregado" : v.remitos.length > 0 ? "En entrega" : "Sin entregar"}</span>
                          </div>
                          {/* Factura */}
                          {(() => {
                            const factActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                            const esManual = factActiva && !factActiva.cae;
                            const listaParaFacturar = v.presupuesto.estado === "facturar";
                            return (
                              <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                                st.facturado
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                  : listaParaFacturar
                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                                    : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                              }`}>
                                <Receipt className="h-3 w-3" />
                                <span className="hidden sm:inline">
                                  {st.facturado
                                    ? esManual ? "Manual" : "ARCA"
                                    : listaParaFacturar ? "Lista p/ fact." : "Sin facturar"}
                                </span>
                              </div>
                            );
                          })()}
                          {/* Email enviado */}
                          {(() => {
                            const factActiva = v.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                            if (!factActiva) return null;
                            const emailDest = factActiva.email_enviado_a || v.presupuesto.clientes?.email_facturacion || v.presupuesto.clientes?.email || "";
                            return factActiva.email_enviado_at
                              ? <div className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" title={`Enviada ${formatDate(factActiva.email_enviado_at)}${emailDest ? ` a ${emailDest}` : ""}`}><MailCheck className="h-3 w-3" /></div>
                              : <div className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" title="No enviada por email"><Mail className="h-3 w-3" /></div>;
                          })()}
                          {/* Cobro */}
                          {st.facturado && (
                            <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                              st.cobrado
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                            }`}>
                              <DollarSign className="h-3 w-3" />
                              <span className="hidden sm:inline">{st.cobrado ? "Cobrado" : "Pend. cobro"}</span>
                            </div>
                          )}
                          {/* OC cliente */}
                          {v.presupuesto.oc_cliente && (
                            <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400"
                              title={`OC cliente: ${v.presupuesto.oc_cliente}${v.presupuesto.oc_cliente_fecha ? ` — ${formatDate(v.presupuesto.oc_cliente_fecha)}` : ""}`}>
                              <FileText className="h-3 w-3" />
                              <span className="hidden sm:inline">OC: {v.presupuesto.oc_cliente}</span>
                            </div>
                          )}
                          {/* OC proveedor */}
                          {v.ordenesCompra.length > 0 && (
                            <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                              v.ordenesCompra.some(oc => oc.pago === "tarjeta")
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"
                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                            }`} title={v.ordenesCompra.map(oc => `${oc.numero} — ${formatDate(oc.fecha)}`).join("\n")}>
                              <ClipboardList className="h-3 w-3" />
                              <span className="hidden sm:inline">
                                {v.ordenesCompra.length === 1 ? v.ordenesCompra[0].numero : `${v.ordenesCompra.length} OC`}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Quick action */}
                    {(() => {
                      const st = getVentaStatus(v);
                      if (st.cobrado) return (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Completada
                          </span>
                        </div>
                      );
                      const pending: string[] = [];
                      if (!st.entregado) pending.push("entregar");
                      if (!st.facturado) pending.push("facturar");
                      else pending.push("cobrar");
                      return (
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Falta: {pending.join(", ")}
                          </span>
                        </div>
                      );
                    })()}
                  </button>
                );
              })
            )}
          </div>

          {/* Detail Panel */}
          {selectedVenta && (
            <div className="w-full lg:w-1/2">
              <Card className="sticky top-4 p-0 overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 p-4">
                  <div>
                    <h3 className="font-bold text-zinc-900 dark:text-white">{selectedVenta.presupuesto.numero}</h3>
                    <p className="text-sm text-zinc-500">{selectedVenta.presupuesto.clientes?.razon_social}</p>
                  </div>
                  <button onClick={() => setSelectedVentaId(null)} className="text-zinc-400 hover:text-zinc-600 lg:hidden">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {!!selectedVenta.presupuesto.clientes?.limite_credito && Number(selectedVenta.presupuesto.clientes.saldo_cuenta_corriente || 0) >= Number(selectedVenta.presupuesto.clientes.limite_credito) && (
                  <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                    <AlertCircle className="mr-1 inline h-3.5 w-3.5" /> El cliente alcanzó o superó su límite de crédito.
                  </div>
                )}

                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {/* Step 1: Presupuesto */}
                  <DetailSection
                    title="Presupuesto"
                    icon={FileText}
                    status="done"
                    expanded={expandedSection === "presupuesto"}
                    onToggle={() => setExpandedSection(expandedSection === "presupuesto" ? null : "presupuesto")}
                  >
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Numero</span>
                        <span className="font-mono font-bold">{selectedVenta.presupuesto.numero}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Fecha</span>
                        <span>{formatDate(selectedVenta.presupuesto.fecha)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Total</span>
                        <span className="font-bold">
                          {formatCurrency(selectedVenta.presupuesto.total, selectedVenta.presupuesto.moneda as "ARS" | "USD")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Items</span>
                        <span>{selectedVenta.presupuesto.presupuesto_items?.length || 0} productos</span>
                      </div>
                      <Link
                        href={`/presupuestos?selected=${selectedVenta.presupuesto.id}`}
                        className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 mt-1"
                      >
                        Ver presupuesto <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </DetailSection>

                  {/* Step 2: Entrega */}
                  <DetailSection
                    title="Entrega"
                    icon={Truck}
                    status={
                      selectedVenta.remitos.some(r => r.estado === "entregado") ? "done"
                        : selectedVenta.remitos.length > 0 ? "in-progress"
                        : "pending"
                    }
                    expanded={expandedSection === "entrega"}
                    onToggle={() => setExpandedSection(expandedSection === "entrega" ? null : "entrega")}
                  >
                    {selectedVenta.remitos.length > 0 ? (
                      <div className="space-y-2">
                        {selectedVenta.remitos.map(r => (
                          <div key={r.id} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                            <div>
                              <span className="font-mono text-xs font-bold">{r.numero || "Sin numero"}</span>
                              <span className="text-xs text-zinc-400 ml-2">{formatDate(r.fecha)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={r.estado === "entregado" ? "success" : r.estado === "parcial" ? "info" : "warning"}>
                                {r.estado}
                              </Badge>
                              {r.estado === "pendiente" && (
                                <button
                                  onClick={() => handleMarcarEntregado(r.id)}
                                  className="text-xs text-green-600 hover:text-green-700 font-medium"
                                >
                                  Marcar entregado
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        <Link
                          href="/remitos"
                          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                        >
                          Ver en remitos <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-zinc-500">Sin remitos generados</p>
                        <Link
                          href={`/presupuestos?selected=${selectedVenta.presupuesto.id}`}
                          className="flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 w-fit"
                        >
                          <Truck className="h-4 w-4" />
                          Remitar desde presupuesto
                        </Link>
                      </div>
                    )}
                  </DetailSection>

                  {/* OC vinculadas */}
                  {selectedVenta.ordenesCompra.length > 0 && (
                    <DetailSection
                      title={`Órdenes de compra (${selectedVenta.ordenesCompra.length})`}
                      icon={ClipboardList}
                      status={selectedVenta.ordenesCompra.every(oc => oc.estado === "completada" || oc.estado === "cancelada") ? "done" : "in-progress"}
                      expanded={expandedSection === "oc"}
                      onToggle={() => setExpandedSection(expandedSection === "oc" ? null : "oc")}
                    >
                      <div className="space-y-2">
                        {selectedVenta.ordenesCompra.map(oc => (
                          <div key={oc.id} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                            <div>
                              <span className="font-mono text-xs font-bold">{oc.numero}</span>
                              <span className="text-xs text-zinc-400 ml-2">{formatDate(oc.fecha)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{formatCurrency(oc.total, (oc.moneda || "ARS") as "ARS" | "USD")}</span>
                              <Badge variant={
                                oc.estado === "completada" ? "success"
                                : oc.estado === "cancelada" ? "danger"
                                : oc.pago === "tarjeta" ? "purple"
                                : "warning"
                              }>
                                {oc.pago === "tarjeta" ? "Pagada tarjeta" : oc.estado}
                              </Badge>
                            </div>
                          </div>
                        ))}
                        <Link
                          href="/ordenes-compra"
                          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                        >
                          Ver en órdenes de compra <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </DetailSection>
                  )}

                  {/* Step 3: Factura */}
                  <DetailSection
                    title="Factura"
                    icon={Receipt}
                    status={
                      selectedVenta.facturas.some(f => f.estado === "emitida" || f.estado === "pagada") ? "done"
                        : "pending"
                    }
                    expanded={expandedSection === "factura"}
                    onToggle={() => setExpandedSection(expandedSection === "factura" ? null : "factura")}
                  >
                    {(() => {
                      const allFacturas = [...selectedVenta.facturas].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
                      const facturaActiva = selectedVenta.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                      const ncTipos = ["NCA", "NCB", "NCEA", "NCEB"];
                      // Show path if there's more than 1 comprobante (e.g. FACT → NC → FACT)
                      const showPath = allFacturas.length > 1;
                      if (facturaActiva) {
                        const comp = `${facturaActiva.tipo} ${String(facturaActiva.punto_venta).padStart(4, "0")}-${String(facturaActiva.numero).padStart(8, "0")}`;
                        return (
                          <div className="space-y-2 text-sm">
                            {showPath && (
                              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2 mb-1">
                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mr-1">Historial:</span>
                                {allFacturas.map((f, idx) => {
                                  const isNC = ncTipos.includes(f.tipo);
                                  const isActive = f.id === facturaActiva.id;
                                  const isAnulada = f.estado === "anulada";
                                  const fLabel = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
                                  return (
                                    <span key={f.id} className="flex items-center gap-1">
                                      {idx > 0 && <ArrowRight className="h-3 w-3 text-amber-400 shrink-0" />}
                                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        isActive ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                        : isNC ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                        : isAnulada ? "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                                      }`}>
                                        {fLabel}
                                      </span>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Comprobante</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold">{comp}</span>
                                {facturaActiva.cae ? (
                                  <span className="inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-400">ARCA</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Manual</span>
                                )}
                              </div>
                            </div>
                            {facturaActiva.cae && (
                            <div className="flex justify-between">
                              <span className="text-zinc-500">CAE</span>
                              <span className="font-mono text-xs">{facturaActiva.cae}</span>
                            </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Total</span>
                              <span className="font-bold">{formatCurrency(facturaActiva.total, (facturaActiva.moneda || "ARS") as "ARS" | "USD")}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-zinc-500">Estado</span>
                              <Badge variant={facturaActiva.estado === "pagada" ? "success" : "info"}>
                                {facturaActiva.estado}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              <button
                                onClick={() => downloadFactura(facturaActiva.id)}
                                disabled={downloadingFacturaId === facturaActiva.id}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
                              >
                                {downloadingFacturaId === facturaActiva.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                PDF
                              </button>
                              <button
                                onClick={() => downloadFactura(facturaActiva.id, true)}
                                disabled={downloadingFacturaId === facturaActiva.id}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60"
                              >
                                <Eye className="h-3.5 w-3.5" /> Ver
                              </button>
                              <Link
                                href={`/finanzas?factura=${facturaActiva.id}`}
                                className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700"
                              >
                                Ver en facturación <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                            {facturaActiva.estado === "emitida" && role !== "vendedor" && (
                              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 mt-2">
                                <Link
                                  href={`/finanzas?factura=${facturaActiva.id}&nc=1`}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-700 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                >
                                  <Ban className="h-3.5 w-3.5" /> Emitir NC
                                </Link>
                                <button
                                  onClick={() => handleCancelarVenta(selectedVenta.presupuesto.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                >
                                  <X className="h-3.5 w-3.5" /> Cancelar venta
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      }
                      const tieneNcTotal = selectedVenta.facturas.some(f => f.estado === "anulada");
                      const puedeFacturar = selectedVenta.presupuesto.estado === "facturar" || tieneNcTotal;
                      return role === "vendedor" ? (
                        <p className="text-sm text-zinc-500">Pendiente de facturación administrativa</p>
                      ) : (
                        <div className="space-y-3">
                          {allFacturas.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2">
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium mr-1">Historial:</span>
                              {allFacturas.map((f, idx) => {
                                const isNC = ncTipos.includes(f.tipo);
                                const fLabel = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
                                return (
                                  <span key={f.id} className="flex items-center gap-1">
                                    {idx > 0 && <ArrowRight className="h-3 w-3 text-amber-400 shrink-0" />}
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      isNC ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                      : "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500"
                                    }`}>
                                      {fLabel}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {tieneNcTotal && allFacturas.length === 0 && (
                            <p className="text-sm text-amber-600 dark:text-amber-400">Factura anterior anulada por Nota de Crédito</p>
                          )}
                          {puedeFacturar ? (
                            <>
                              <p className="text-sm text-zinc-500">{tieneNcTotal ? "La factura fue anulada por NC. Podés volver a facturar o cancelar la venta." : "Sin factura emitida"}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  onClick={() => openEmitModal(selectedVenta)}
                                  className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                                >
                                  <Receipt className="h-4 w-4" />
                                  {tieneNcTotal ? "Re-facturar" : "Facturar"}
                                </button>
                                {tieneNcTotal && (
                                  <button
                                    onClick={() => handleCancelarVenta(selectedVenta.presupuesto.id)}
                                    className="flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-700 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                                  >
                                    <X className="h-4 w-4" />
                                    Cancelar venta
                                  </button>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-amber-600 dark:text-amber-400">El presupuesto no esta marcado como &ldquo;Listo para facturar&rdquo;. Marcalo desde Presupuestos.</p>
                          )}
                        </div>
                      );
                    })()}
                  </DetailSection>

                  {/* Step 4: Cobro */}
                  <DetailSection
                    title="Cobro"
                    icon={DollarSign}
                    status={
                      selectedVenta.facturas.some(f => f.estado === "pagada") ? "done" : "pending"
                    }
                    expanded={expandedSection === "cobro"}
                    onToggle={() => setExpandedSection(expandedSection === "cobro" ? null : "cobro")}
                  >
                    {(() => {
                      const facturaActiva = selectedVenta.facturas.find(f => f.estado === "emitida" || f.estado === "pagada");
                      if (facturaActiva?.estado === "pagada") {
                        return (
                          <div className="flex items-center gap-2 text-sm text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="font-medium">Cobro registrado</span>
                          </div>
                        );
                      }
                      if (facturaActiva?.estado === "emitida") {
                        return (
                          <div className="space-y-3">
                            <p className="text-sm text-zinc-500">Factura emitida, pendiente de cobro</p>
                            <Link
                              href="/finanzas"
                              className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 w-fit"
                            >
                              <DollarSign className="h-4 w-4" />
                              Registrar cobro en Facturación
                            </Link>
                          </div>
                        );
                      }
                      return <p className="text-sm text-zinc-400">Primero emiti la factura</p>;
                    })()}
                  </DetailSection>
                </div>

                {/* Quick links */}
                <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
                  <p className="text-xs font-medium text-zinc-400 uppercase mb-2">Ir a</p>
                  <div className="flex flex-wrap gap-2">
                    <Link href="/clientes" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Cliente
                    </Link>
                    <Link href="/presupuestos" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Presupuesto
                    </Link>
                    <Link href="/remitos" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Remitos
                    </Link>
                    <Link href="/finanzas" className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Facturacion
                    </Link>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>

      {/* Emit Modal */}
      {emitModalOpen && emitVenta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !emitting && setEmitModalOpen(false)}>
          <Card className={`p-6 space-y-4 overflow-y-auto ${emitFullscreen ? "fixed inset-2 max-w-none max-h-none" : "w-full max-w-2xl max-h-[90vh]"}`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">
                Emitir factura — {emitVenta.presupuesto.numero}
              </h2>
              <div className="flex items-center gap-1">
                <button onClick={() => setEmitFullscreen(f => !f)} className="text-zinc-400 hover:text-zinc-600 p-1" title={emitFullscreen ? "Restaurar" : "Maximizar"}>
                  {emitFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button onClick={() => !emitting && setEmitModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 p-1">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {emitSuccess ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/30">
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <p className="font-medium">{emitSuccess}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {emitFacturaId && (
                    <button
                      onClick={() => downloadFactura(emitFacturaId)}
                      disabled={downloadingFacturaId === emitFacturaId}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
                    >
                      {downloadingFacturaId === emitFacturaId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Descargar factura PDF
                    </button>
                  )}
                  <button
                    onClick={() => setEmitModalOpen(false)}
                    className="rounded-lg border border-green-300 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Info */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500">Cliente</span>
                    <p className="font-medium dark:text-white">{emitVenta.presupuesto.clientes?.razon_social}</p>
                    <p className="text-xs text-zinc-400">
                      {emitVenta.presupuesto.clientes?.condicion_iva || "—"} · {emitVenta.presupuesto.clientes?.cuit || "Sin CUIT"}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500">Punto de venta</span>
                    {emitManual ? (
                      <input
                        type="number" min={0}
                        value={emitPvManual || ""}
                        onChange={e => {
                          const newPv = Number(e.target.value);
                          setEmitPvManual(newPv);
                          fetchNextNum("X", newPv);
                        }}
                        placeholder="PV"
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-sm font-mono font-bold dark:text-white"
                      />
                    ) : pvOpciones.length > 1 ? (
                      <select
                        value={pvCrm}
                        onChange={(e) => { const newPv = Number(e.target.value); setPvCrm(newPv); fetchNextNum(emitTipo, newPv); }}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-sm font-mono font-bold dark:text-white"
                      >
                        {pvOpciones.map((pv) => (
                          <option key={pv} value={pv}>{String(pv).padStart(4, "0")}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="font-mono font-bold dark:text-white">{String(pvCrm).padStart(4, "0")}</p>
                    )}
                  </div>
                  <div>
                    <span className="text-zinc-500">Nro. comprobante</span>
                    <p className="font-mono font-bold text-orange-600 dark:text-orange-400">
                      {emitNextNum != null ? `${String(emitManual ? emitPvManual : pvCrm).padStart(4, "0")}-${String(emitNextNum).padStart(8, "0")}` : "…"}
                    </p>
                  </div>
                </div>

                {/* Fecha de facturación */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha de facturación</label>
                  <input
                    type="date"
                    value={emitFecha}
                    min={emitManual ? minFecha : fiscalMinDate}
                    disabled={!emitManual && !fiscalDates.ready}
                    max={todayAR()}
                    onChange={e => {
                      setEmitFecha(e.target.value);
                      setEmitFechaVenc(calcFechaVenc(emitCondVenta, e.target.value));
                    }}
                    className="w-full max-w-xs rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                  {!emitManual && <div className="mt-1 text-xs text-zinc-500">{fiscalDates.error ? <><span className="text-red-600">{fiscalDates.error}</span> <button type="button" onClick={fiscalDates.retry} className="underline">Reintentar</button></> : !fiscalDates.ready ? "Consultando fechas habilitadas en ARCA…" : <>{fiscalDates.warning ? <span className="text-amber-600 dark:text-amber-400">{fiscalDates.warning} </span> : <>Primera fecha habilitada: {formatDate(fiscalMinDate)}. </>}{emitFecha < fiscalMinDate && <span className="text-red-600">Cambiá la fecha seleccionada.</span>}</>}</div>}
                </div>

                {/* Info adicional del PR */}
                {(emitVenta.presupuesto.oc_cliente || emitVenta.presupuesto.oc_cliente_fecha || emitVenta.presupuesto.archivo_url || emitVenta.presupuesto.observaciones || emitVenta.ordenesCompra.length > 0) && (
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1">
                    {(emitVenta.presupuesto.oc_cliente || emitVenta.presupuesto.oc_cliente_fecha || emitVenta.presupuesto.archivo_url) && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-zinc-500 font-medium">OC cliente:</span>
                        <span className="font-mono font-bold dark:text-white">{emitVenta.presupuesto.oc_cliente || "Sin número informado"}</span>
                        <span className="text-zinc-600 dark:text-zinc-300">Fecha: {emitVenta.presupuesto.oc_cliente_fecha ? formatDate(emitVenta.presupuesto.oc_cliente_fecha) : "Sin informar"}</span>
                        {emitVenta.presupuesto.archivo_url && <a href={emitVenta.presupuesto.archivo_url} target="_blank" rel="noreferrer" className="rounded border border-orange-200 bg-white px-2 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:bg-zinc-900">Abrir OC adjunta</a>}
                      </div>
                    )}
                    {emitVenta.ordenesCompra.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-zinc-500 font-medium">OC proveedor:</span>
                        {emitVenta.ordenesCompra.map(oc => (
                          <span key={oc.id} className="inline-flex items-center gap-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-zinc-900 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {oc.numero} <span className="font-normal text-zinc-400">({formatDate(oc.fecha)})</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {emitVenta.presupuesto.observaciones && (
                      <div className="text-sm">
                        <span className="text-zinc-500 font-medium">Observaciones PR:</span>
                        <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{emitVenta.presupuesto.observaciones}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Tipo */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo de comprobante</label>
                  <select
                    value={emitTipo}
                    disabled={emitManual}
                    onChange={e => {
                      const t = e.target.value as EmitTipo;
                      setEmitItems((items) => convertItemsForInvoiceType(items, emitTipo, t));
                      setEmitTipo(t);
                      fetchNextNum(t);
                    }}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800/60"
                  >
                    {emitManual ? (
                      <option value="X">Comprobante X (sin IVA)</option>
                    ) : (<>
                    {["RI", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((emitVenta.presupuesto.clientes?.condicion_iva || "").toUpperCase()) && (
                      <option value="FA">Factura A (discrimina IVA)</option>
                    )}
                    <option value="FB">Factura B (precio final)</option>
                    {["RI", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((emitVenta.presupuesto.clientes?.condicion_iva || "").toUpperCase()) && (
                      <option value="FCEA">FCE A — Crédito Electrónica (MiPyMEs)</option>
                    )}
                    <option value="FCEB">FCE B — Crédito Electrónica (MiPyMEs)</option>
                    </>)}
                  </select>
                </div>

                {/* Manual toggle */}
                {!emitManual && <div className="text-sm text-zinc-600 dark:text-zinc-300" role="status">
                  {fceCheck.error ? <><span className="text-red-600">{fceCheck.error}</span> <button type="button" onClick={fceCheck.retry} className="underline">Reintentar verificación FCE</button></>
                    : !fceCheck.ready ? "Consultando encuadre FCE del cliente en ARCA…"
                    : !fceRateReady ? "Esperando cotización para determinar si corresponde FCE…"
                    : fceRequired ? `Corresponde FCE por consulta ARCA e importe. Mínimo: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.`
                    : `Corresponde factura común según la consulta y el importe.${fceCheck.obligado ? ` Mínimo FCE: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.` : ""}`}
                </div>}
                <div className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={emitManual}
                      onChange={e => {
                        const manual = e.target.checked;
                        setEmitManual(manual);
                        if (manual) {
                          setEmitTipo("X");
                          setEmitPvManual(0);
                          fetchNextNum("X", 0);
                        } else {
                          const tipoArca: EmitTipo = ["RI", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((emitVenta.presupuesto.clientes?.condicion_iva || "").toUpperCase()) ? "FA" : "FB";
                          setEmitItems((items) => convertItemsForInvoiceType(items, "X", tipoArca));
                          setEmitTipo(tipoArca);
                          fetchNextNum(tipoArca);
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:after:border-zinc-500 peer-checked:bg-orange-500" />
                  </label>
                  <div>
                    <span className="text-sm font-medium dark:text-white">Factura manual (sin ARCA)</span>
                    <p className="text-xs text-zinc-400">
                      {emitManual
                        ? "Se creara un registro interno sin autorizacion electronica (sin CAE)"
                        : "Se emitira electronicamente via ARCA con CAE"}
                    </p>
                  </div>
                </div>

                {/* Moneda de facturación */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Moneda factura</label>
                    <div className="flex gap-1.5">
                      {(["ARS", "USD"] as const).map(m => (
                        <button key={m} onClick={() => setEmitMoneda(m)}
                          className={`rounded-md border-2 px-4 py-1.5 text-xs font-semibold transition-colors ${emitMoneda === m ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    {emitMoneda !== (emitVenta.presupuesto.moneda || "ARS") && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">PR en {emitVenta.presupuesto.moneda} → factura en {emitMoneda}</span>
                    )}
                  </div>
                  {(emitMoneda === "USD" || emitMoneda !== (emitVenta.presupuesto.moneda || "ARS")) && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-xs text-amber-600 dark:text-amber-500">Cotizacion USD/ARS {emitManual ? "" : "*"}</label>
                        <input
                          type="number" step="0.01" min={0}
                          value={emitTipoCambio || ""}
                          readOnly={!editRate}
                          onChange={e => { cotizRequest.current += 1; setCotizBnaLoading(false); setCotizBna(null); setEmitTipoCambio(Number(e.target.value)); }}
                          placeholder="Ej: 1450.00"
                          className="w-32 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm font-mono dark:text-white"
                        />
                        {editRate && <><button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap">
                          {cotizBnaLoading ? "…" : "Divisas"}
                        </button>
                        <span className="text-xs text-zinc-400">·</span>
                        <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap">
                          {cotizBnaLoading ? "…" : "Billetes"}
                        </button>
                        <input type="date" value={cotizFecha} onChange={e => setCotizFecha(e.target.value)} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" /></>}
                        {!editRate && <span className="text-xs text-amber-700 dark:text-amber-400">{cotizBnaLoading ? "Verificando BNA…" : `Automática: BNA ${emitVenta.presupuesto.cotizacion_modalidad === "billetes" ? "billetes" : "divisas"} venta, día hábil anterior. Modalidad del presupuesto.`}</span>}
                        {!emitManual && canOverrideRate && <label className="text-xs"><input type="checkbox" checked={rateOverride} onChange={e => setRateOverride(e.target.checked)} /> Modificar cotización (Augusto)</label>}
                      </div>
                      {cotizBna && (
                        <p className="text-xs text-zinc-500 mt-1">BNA {cotizBna.modalidad} venta: ${cotizBna.valor_venta.toLocaleString("es-AR")} ({cotizBna.fecha})</p>
                      )}
                      {emitMoneda !== (emitVenta.presupuesto.moneda || "ARS") && emitTipoCambio > 0 && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                          Los items se convertirán de {emitVenta.presupuesto.moneda} a {emitMoneda} al tipo de cambio {emitTipoCambio.toLocaleString("es-AR")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Items</label>
                    <button
                      onClick={() => setEmitItems([...emitItems, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="text-xs text-orange-600 hover:text-orange-700 flex items-center gap-1"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {emitItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-5">
                          {idx === 0 && <span className="text-xs text-zinc-400">Descripcion</span>}
                          <input
                            type="text"
                            value={item.descripcion}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], descripcion: e.target.value };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <span className="text-xs text-zinc-400">Cant.</span>}
                          <input
                            type="number"
                            min="1"
                            value={item.cantidad}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], cantidad: Number(e.target.value) };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <span className="text-xs text-zinc-400">{(emitTipo === "FA" || emitTipo === "FCEA") ? "Neto" : "Precio"}</span>}
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.precio_unitario}
                            onChange={e => {
                              const copy = [...emitItems];
                              copy[idx] = { ...copy[idx], precio_unitario: Number(e.target.value) };
                              setEmitItems(copy);
                            }}
                            className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                          />
                        </div>
                        {(emitTipo === "FA" || emitTipo === "FCEA") && (
                          <div className="col-span-2">
                            {idx === 0 && <span className="text-xs text-zinc-400">IVA %</span>}
                            <select
                              value={item.iva_porcentaje}
                              onChange={e => {
                                const copy = [...emitItems];
                                copy[idx] = { ...copy[idx], iva_porcentaje: Number(e.target.value) };
                                setEmitItems(copy);
                              }}
                              className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                            >
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className={(emitTipo === "FA" || emitTipo === "FCEA") ? "col-span-1" : "col-span-3 flex items-end justify-end"}>
                          {emitItems.length > 1 && (
                            <button
                              onClick={() => setEmitItems(emitItems.filter((_, i) => i !== idx))}
                              className="rounded p-1 text-zinc-400 hover:text-red-500"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {emitIsFce && (
                  <div className="rounded-lg border border-blue-200 p-3 space-y-3 dark:border-blue-900">
                    <p className="text-sm dark:text-zinc-200">Datos obligatorios de la FCE. La CBU debe pertenecer al emisor de esta sociedad.</p>
                    <label className="block text-sm dark:text-zinc-300">CBU del emisor *
                      <input inputMode="numeric" maxLength={22} value={emitFceCbu} onChange={e => setEmitFceCbu(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                    </label>
                    <label className="block text-sm dark:text-zinc-300">Transmisión de la FCE *
                      <select value={emitFceTransmision} onChange={e => setEmitFceTransmision(e.target.value as "" | "SCA" | "ADC")} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                        <option value="">Seleccioná una modalidad</option>
                        <option value="SCA">SCA — Sistema de Circulación Abierta</option>
                        <option value="ADC">ADC — Agente de Depósito Colectivo</option>
                      </select>
                    </label>
                  </div>
                )}
                {/* Condición de venta + Fecha vencimiento */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Condición de venta</label>
                    <select
                      value={emitCondVenta}
                      onChange={e => { setEmitCondVenta(e.target.value); setEmitFechaVenc(calcFechaVenc(e.target.value, emitFecha)); }}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    >
                      <option value="Contado">Contado</option>
                      <option value="Cta. Cte.">Cta. Cte.</option>
                      <option value="15 días">15 días</option>
                      <option value="30 días">30 días</option>
                      <option value="45 días">45 días</option>
                      <option value="60 días">60 días</option>
                      <option value="90 días">90 días</option>
                      <option value="Cheque 30 días">Cheque 30 días</option>
                      <option value="Cheque 60 días">Cheque 60 días</option>
                      <option value="Cheque 90 días">Cheque 90 días</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha vencimiento</label>
                    <input
                      type="date"
                      value={emitFechaVenc}
                      required={emitIsFce}
                      min={emitIsFce ? (emitFecha > todayAR() ? emitFecha : todayAR()) : undefined}
                      onChange={e => setEmitFechaVenc(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones</label>
                    <input
                      type="text"
                      value={emitObservaciones}
                      onChange={e => setEmitObservaciones(e.target.value)}
                      placeholder="Notas para la factura..."
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    />
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 space-y-1">
                  {(() => {
                    const prMon = (emitVenta.presupuesto.moneda || "ARS") as "ARS" | "USD";
                    const needsConv = emitMoneda !== prMon && emitTipoCambio > 0;
                    const cv = (p: number) => {
                      if (!needsConv) return p;
                      return prMon === "USD" ? Math.round(p * emitTipoCambio * 100) / 100 : Math.round(p / emitTipoCambio * 100) / 100;
                    };
                    if (emitTipo === "FA" || emitTipo === "FCEA") {
                      const neto = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      const iva = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario * it.iva_porcentaje / 100, 0);
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Neto</span>
                            <span>{formatCurrency(neto, prMon)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">IVA</span>
                            <span>{formatCurrency(iva, prMon)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                            <span>Total</span>
                            <span>{formatCurrency(neto + iva, prMon)}</span>
                          </div>
                          {needsConv && (
                            <div className="flex justify-between text-sm font-bold text-blue-600 dark:text-blue-400 border-t border-zinc-200 dark:border-zinc-700 pt-1">
                              <span>Total factura ({emitMoneda})</span>
                              <span>{formatCurrency(cv(neto) + cv(iva), emitMoneda)}</span>
                            </div>
                          )}
                        </>
                      );
                    } else {
                      const total = emitItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
                      return (
                        <>
                          <div className="flex justify-between text-sm font-bold">
                            <span>{emitManual || emitTipo === "X" ? "Total (sin IVA)" : "Total (IVA incluido)"}</span>
                            <span>{formatCurrency(total, prMon)}</span>
                          </div>
                          {needsConv && (
                            <div className="flex justify-between text-sm font-bold text-blue-600 dark:text-blue-400 border-t border-zinc-200 dark:border-zinc-700 pt-1">
                              <span>Total factura ({emitMoneda})</span>
                              <span>{formatCurrency(cv(total), emitMoneda)}</span>
                            </div>
                          )}
                        </>
                      );
                    }
                  })()}
                </div>

                {emitError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    {emitError}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setEmitModalOpen(false)}
                    disabled={emitting}
                    className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={emitManual ? handleEmitFacturaManual : handleEmitFactura}
                    disabled={emitting}
                    className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2 ${
                      emitManual ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    {emitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Emitiendo...
                      </>
                    ) : emitManual ? (
                      <>
                        <Receipt className="h-4 w-4" />
                        Crear factura manual
                      </>
                    ) : (
                      <>
                        <Receipt className="h-4 w-4" />
                        Emitir con ARCA
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
        </>
        )}
      </div>
    </>
  );
}

// ── Detail Section Component ─────────────────────────────────────

function DetailSection({
  title, icon: Icon, status, expanded, onToggle, children,
}: {
  title: string;
  icon: React.ElementType;
  status: "done" | "in-progress" | "pending";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button onClick={onToggle} className="flex items-center w-full p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
        <div className={`rounded-lg p-1.5 mr-3 ${
          status === "done" ? "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
            : status === "in-progress" ? "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400"
            : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        }`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="flex-1 text-left text-sm font-medium dark:text-white">{title}</span>
        {status === "done" && <CheckCircle2 className="h-4 w-4 text-green-500 mr-2" />}
        {status === "in-progress" && <Clock className="h-4 w-4 text-orange-500 mr-2" />}
        <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-[52px]">
          {children}
        </div>
      )}
    </div>
  );
}
