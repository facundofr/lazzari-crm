"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate, formatDateTime, todayAR } from "@/lib/utils";
import { generateFacturaPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64, documentFilename } from "@/lib/pdf-templates";
import CobroMasivoLiquidacion, { type LiquidacionFactura } from "@/components/cobro-masivo-liquidacion";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";
import { EmailComposeModal, type EmailDocumentType } from "@/components/email-compose-modal";
import { useUser } from "@/lib/auth-context";
import { canOverrideInvoiceRate } from "@/lib/invoice-rate-permission";
import { useFiscalDateLimits } from "@/lib/use-fiscal-date-limits";
import { beginInvoiceIntent, postInvoiceIntent } from "@/lib/invoice-intent";
import { useFceCheck, fceTotalArs } from "@/lib/use-fce-check";
import { supabase } from "@/lib/supabase/client";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { mockFacturas } from "@/lib/mock-data";
import {
  Receipt, DollarSign, FileCheck, AlertTriangle, Loader2, XCircle,
  X, Printer, CheckCircle2, Clock, Ban, Copy, Download, Check,
  ShieldCheck, KeyRound, Server, ClipboardCopy, Plus, Minus, Mail, MailCheck, FileText, Search, Scissors,
  Maximize2, Minimize2, Pencil, Trash2, Upload, Sparkles, Eye,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "orange" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pendiente: { label: "Pendiente", variant: "orange" },
  parcial: { label: "Cobro parcial", variant: "warning" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
};

interface FacturaRow {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  cae: string | null;
  cae_vencimiento: string | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  estado: string;
  presupuesto_id: string | null;
  oc_cliente?: string | null;
  oc_cliente_fecha?: string | null;
  condicion_venta?: string | null;
  fecha_vencimiento?: string | null;
  nota_interna?: string | null;
  factura_origen_id?: string | null;
  total_acreditado?: number | null;
  modalidad_emision?: string | null;
  recibida_cliente?: boolean;
  email_enviado_at?: string | null;
  email_enviado_a?: string | null;
  clientes: { razon_social: string; cuit: string; condicion_iva?: string; email?: string; email_facturacion?: string; telefono?: string; direccion?: string; localidad?: string; provincia?: string; dias_cuenta_corriente?: number | null } | null;
  _clienteNombre?: string;
  _fechaVencCalc?: string;
  _prNumero?: string;
  presupuestos?: { numero: string } | null;
}

type NcItem = { descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number };

interface ClienteOption {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string | null;
}

interface EmitItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

export function FacturacionContent({ embedded = false, autoSelectId }: { embedded?: boolean; autoSelectId?: string }) {
  const { sociedadActiva, profile } = useUser();
  const [rateOverride, setRateOverride] = useState(false);
  const canOverrideRate = canOverrideInvoiceRate(profile?.email);

  const emisorData = useMemo(() => {
    if (sociedadActiva?.nombre === "Grupo LA") {
      return {
        razonSocial: "Grupo LA Servicios Integrales SAS",
        cuit: "30-71939604-2",
        cuitNumero: 30719396042,
        condicionIva: "Responsable Inscripto",
        domicilio: "",
        ptoVta: 10,
        ptoVtaOpciones: [10],
      };
    }
    return {
      razonSocial: "Lazzari Soluciones Industriales",
      cuit: "20-37930912-8",
      cuitNumero: 20379309128,
      condicionIva: "Responsable Inscripto",
      domicilio: "",
      ptoVta: 15,
      ptoVtaOpciones: [15, 16],
    };
  }, [sociedadActiva]);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [cobradoPorFactura, setCobradoPorFactura] = useState<Record<string,number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailFactura, setDetailFactura] = useState<FacturaRow | null>(null);
  const [fceRegistry, setFceRegistry] = useState<{ key: string; loading?: boolean; error?: string; estado?: string; historial?: { estado: string; fechaHora?: string }[]; checkedAt?: string }>({ key: "" });
  const fceRegistryRequest = useRef(0);
  useEffect(() => { fceRegistryRequest.current += 1; setFceRegistry({ key: "" }); }, [detailFactura?.id, sociedadActiva?.id]);
  async function consultarRegistroFce() {
    if (!detailFactura || !sociedadActiva?.id) return;
    const key = `${sociedadActiva.id}:${detailFactura.id}`;
    const request = ++fceRegistryRequest.current;
    setFceRegistry({ key, loading: true });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({ action: "fce-status", sociedad_id: sociedadActiva.id, factura_id: detailFactura.id });
      const response = await fetch(`/api/facturacion?${params}`, { cache: "no-store", headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo consultar el Registro FCE.");
      if (request === fceRegistryRequest.current) setFceRegistry({ key, estado: data.estado || "Sin estado informado", historial: Array.isArray(data.historial) ? data.historial : [], checkedAt: new Date().toLocaleString("es-AR") });
    } catch (error) {
      if (request === fceRegistryRequest.current) setFceRegistry({ key, error: error instanceof Error ? error.message : "No se pudo consultar el Registro FCE." });
    }
  }
  const [detailItems, setDetailItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number; subtotal: number }[]>([]);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [emailModal, setEmailModal] = useState<{ open: boolean; facturaId: string; to: string; subject: string; body: string; filename: string; suggestedEmails: { email: string; label?: string }[] }>({ open: false, facturaId: "", to: "", subject: "", body: "", filename: "", suggestedEmails: [] });
  const [editingFechaPago, setEditingFechaPago] = useState<string | null>(null);

  async function saveFechaPago(id: string, newDate: string) {
    setFacturas(prev => prev.map(f => f.id === id ? { ...f, fecha_vencimiento: newDate || null, _fechaVencCalc: newDate || "" } : f));
    setEditingFechaPago(null);
    let q = supabase.from("facturas").update({ fecha_vencimiento: newDate || null } as any).eq("id", id);
    if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
    const { error } = await q;
    if (error) { alert("Error: " + error.message); await fetchData(); }
  }

  async function toggleRecibidaCliente(id: string, current: boolean) {
    const newVal = !current;
    setFacturas(prev => prev.map(f => f.id === id ? { ...f, recibida_cliente: newVal } : f));
    let q = supabase.from("facturas").update({ recibida_cliente: newVal } as any).eq("id", id);
    if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
    const { error } = await q;
    if (error) {
      setFacturas(prev => prev.map(f => f.id === id ? { ...f, recibida_cliente: current } : f));
      alert("Error: " + error.message);
    }
  }

  // ARCA status
  const [arcaStatus, setArcaStatus] = useState<{ connected: boolean; certOk?: boolean; error?: string; afipError?: string; production?: boolean; ptoVta?: number } | null>(null);

  // Emit modal
  const [emitOpen, setEmitOpen] = useState(false);
  const [emitFullscreen, setEmitFullscreen] = useState(false);
  const [emitStep, setEmitStep] = useState<"form" | "emitting" | "success" | "error">("form");
  const [emitResult, setEmitResult] = useState<any>(null);
  const [emitError, setEmitError] = useState("");
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [emitManual, setEmitManual] = useState(false);
  const [emitClienteSearch, setEmitClienteSearch] = useState("");
  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);
  const [cotizError, setCotizError] = useState("");
  const cotizRequest = useRef(0);
  const [cotizModalidad, setCotizModalidad] = useState<"divisas" | "billetes">("divisas");
  const [cotizFecha, setCotizFecha] = useState("");
  const [latestFacturaDate, setLatestFacturaDate] = useState("");

  // Facturación masiva de presupuestos del cliente (sin exigir OC del cliente).
  // Se mantiene separado de la emisión manual para que cada comprobante pase por
  // las mismas validaciones/numeración del endpoint /api/facturacion.
  type FacturacionMasivaPR = {
    id: string; numero: string; fecha: string; moneda: "ARS" | "USD";
    tipo_cambio: number | null; cotizacion_modalidad: "divisas" | "billetes" | null;
    total: number; cliente_id: string; clienteNombre: string; condicion_iva: string | null;
    tipo_comprobante: string | null; items: EmitItem[]; selected: boolean;
  };
  type FacturacionMasivaResultado = { id: string; numero: string; ok: boolean; comprobante?: string; error?: string };
  const [fmOpen, setFmOpen] = useState(false);
  const [fmClientes, setFmClientes] = useState<ClienteOption[]>([]);
  const [fmClienteId, setFmClienteId] = useState("");
  const [fmClienteSearch, setFmClienteSearch] = useState("");
  const [fmFecha, setFmFecha] = useState(todayAR());
  const [fmPRs, setFmPRs] = useState<FacturacionMasivaPR[]>([]);
  const [fmLoading, setFmLoading] = useState(false);
  const [fmEmitting, setFmEmitting] = useState(false);
  const [fmResults, setFmResults] = useState<FacturacionMasivaResultado[]>([]);
  const [fmError, setFmError] = useState("");

  function previousBusinessDay(iso: string): string {
    const d = new Date(`${iso || todayAR()}T12:00:00`);
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function fetchCotizBna(modalidad: "divisas" | "billetes" = "divisas", fecha?: string) {
    const requestId = ++cotizRequest.current;
    setCotizModalidad(modalidad);
    setCotizBnaLoading(true);
    setCotizError("");
    setCotizBna(null);
    setEmitData(p => ({ ...p, tipo_cambio: 0 }));
    try {
      const params = new URLSearchParams({ modalidad });
      // Por defecto se usa el día hábil anterior a la fecha de la factura.
      // Solo un valor explícito en el selector permite cambiar esta regla.
      if (emitManual || (canOverrideRate && rateOverride)) params.set("fecha", fecha || cotizFecha || previousBusinessDay(emitData.fecha));
      else params.set("fecha_factura", emitData.fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      const data = await res.json();
      if (requestId !== cotizRequest.current) return;
      if (!res.ok) throw new Error(data.error || "No se pudo consultar la cotización.");
      if ((emitManual || (canOverrideRate && rateOverride)) && (data.stale || data.fecha !== params.get("fecha"))) {
        throw new Error(`La cotización disponible es del ${data.fecha}, no del ${params.get("fecha")}. No se aplicó; ingresá el valor correcto manualmente.`);
      }
      if (Number(data.valor_venta) > 0) {
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad: data.modalidad || modalidad });
        setEmitData((p) => ({ ...p, tipo_cambio: data.valor_venta }));
      } else throw new Error("La cotización recibida no es válida. Ingresá el valor correcto manualmente.");
    } catch (error) { if (requestId === cotizRequest.current) setCotizError(error instanceof Error ? error.message : "No se pudo consultar la cotización. Ingresala manualmente."); } finally {
      if (requestId === cotizRequest.current) setCotizBnaLoading(false);
    }
  }
  const [emitData, setEmitData] = useState({
    tipo: "FA",
    cliente_id: "",
    punto_venta: 15,
    numero_manual: "",
    moneda: "ARS" as "ARS" | "USD",
    tipo_cambio: 0,
    fecha: todayAR(),
    condicion_venta: "Cta. Cte.",
    fecha_vencimiento: "",
    fce_cbu: "",
    fce_transmision: "",
    items: [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] as EmitItem[],
  });

  useEffect(() => {
    if (!emitOpen || emitData.moneda !== "USD") return;
    if (emitManual || (canOverrideRate && rateOverride)) { setCotizBnaLoading(false); return; }
    void fetchCotizBna("divisas", previousBusinessDay(emitData.fecha));
    return () => { cotizRequest.current += 1; };
    // La edición manual de tipo_cambio no dispara otra consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitOpen, emitData.moneda, emitData.fecha, emitManual, canOverrideRate, rateOverride]);

  function calcFechaVencFC(condVenta: string, fechaBase: string): string {
    const diasMap: Record<string, number> = {
      "Contado": 0, "Cta. Cte.": 30,
      "15 días": 15, "30 días": 30, "60 días": 60, "90 días": 90,
    };
    const dias = diasMap[condVenta];
    if (dias == null || !fechaBase) return "";
    const d = new Date(fechaBase + "T12:00:00");
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  const minFecha = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    const fallback = d.toISOString().slice(0, 10);
    return latestFacturaDate && latestFacturaDate > fallback ? latestFacturaDate : fallback;
  }, [latestFacturaDate]);
  const fiscalDates = useFiscalDateLimits(emitOpen && !emitManual, sociedadActiva?.id, emitData.punto_venta, emitData.tipo);
  const dateWindow = new Date(`${todayAR()}T12:00:00Z`);
  dateWindow.setUTCDate(dateWindow.getUTCDate() - 5);
  const dateWindowMin = dateWindow.toISOString().slice(0,10);
  const fiscalMinDate = fiscalDates.minDate && fiscalDates.minDate > dateWindowMin ? fiscalDates.minDate : dateWindowMin;
  const fiscalDateBlocked = !emitManual && (!fiscalDates.ready || emitData.fecha < fiscalMinDate || emitData.fecha > todayAR());

  useEffect(() => {
    if (!emitOpen || !sociedadActiva?.id || !emitData.tipo) return;
    (async () => {
      const { data } = await (supabase as any).from("facturas")
        .select("fecha")
        .eq("sociedad_id", sociedadActiva.id)
        .eq("tipo", emitManual ? "X" : emitData.tipo)
        .eq("punto_venta", emitData.punto_venta)
        .order("fecha", { ascending: false }).limit(1).maybeSingle();
      setLatestFacturaDate(data?.fecha || "");
    })();
  }, [emitOpen, emitManual, emitData.tipo, emitData.punto_venta, sociedadActiva?.id]);

  // ── NC (Nota de Crédito) modal ────────────────────────────────
  const [ncOpen, setNcOpen] = useState(false);
  const [ncFactura, setNcFactura] = useState<FacturaRow | null>(null);
  const [ncItems, setNcItems] = useState<NcItem[]>([]);
  const [ncManual, setNcManual] = useState(false);
  const [ncNumero, setNcNumero] = useState("");
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState("");
  const [ncStep, setNcStep] = useState<"form" | "saving" | "success" | "error">("form");
  const [ncResult, setNcResult] = useState<string>("");
  const [detailNCs, setDetailNCs] = useState<FacturaRow[]>([]);

  const isFacturaANc = ncFactura?.tipo === "FA" || ncFactura?.tipo === "FCEA";

  const ncTotals = ncItems.reduce((acc, it) => {
    if (isFacturaANc) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    } else {
      const total = it.cantidad * it.precio_unitario;
      const ivaPct = it.iva_porcentaje ?? 21;
      const neto = Math.round(total / (1 + ivaPct / 100) * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
    }
  }, { neto: 0, iva: 0, total: 0 });

  async function openNcModal(factura: FacturaRow) {
    beginInvoiceIntent(`nc:${sociedadActiva?.id}:${factura.id}`);
    // Cargar items de la factura original
    const { data: items } = await supabase
      .from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje")
      .eq("factura_id", factura.id)
      .order("orden");

    setNcFactura(factura);
    setNcItems(
      items && items.length > 0
        ? items.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21 }))
        : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }]
    );
    setNcManual(arcaStatus !== null && arcaStatus.certOk === false);
    setNcNumero("");
    setNcError("");
    setNcStep("form");
    setNcResult("");
    setNcOpen(true);
  }

  async function handleCreateNC() {
    if (!ncFactura) return;
    if (ncItems.some(it => !it.descripcion || it.precio_unitario <= 0)) {
      setNcError("Completa todos los items con descripción y precio"); return;
    }
    if (ncManual && (!ncNumero || Number(ncNumero) <= 0)) {
      setNcError("Ingresá el número de comprobante"); return;
    }

    const ncTipo = ncFactura.tipo === "FCEA" ? "NCEA" : ncFactura.tipo === "FCEB" ? "NCEB" : ncFactura.tipo === "FA" ? "NCA" : "NCB";
    setNcSaving(true);
    setNcStep("saving");
    setNcError("");

    try {
      if (!ncManual) {
        // Electrónica via ARCA
        const { data: { session } } = await supabase.auth.getSession();
        const res = await postInvoiceIntent(`nc:${sociedadActiva?.id}:${ncFactura.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            tipo: ncTipo,
            cliente_id: ncFactura.cliente_id,
            punto_venta: emisorData.ptoVta,
            moneda: ncFactura.moneda || "ARS",
            tipo_cambio: ncFactura.tipo_cambio || null,
            items: ncItems,
            sociedad_id: sociedadActiva?.id,
            factura_origen_id: ncFactura.id,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Error al emitir NC");

        // Actualizar total_acreditado en la factura original
        const newAcreditado = (Number(ncFactura.total_acreditado) || 0) + ncTotals.total;
        const ncCobreTotal = newAcreditado >= Number(ncFactura.total) - 0.01;
        let acredArcaQuery = (supabase as any).from("facturas").update({
          total_acreditado: newAcreditado,
          ...(ncCobreTotal ? { estado: "anulada" } : {}),
        }).eq("id", ncFactura.id);
        if (sociedadActiva?.id) acredArcaQuery = acredArcaQuery.eq("sociedad_id", sociedadActiva.id);
        const { error: acredArcaErr } = await acredArcaQuery;
        if (acredArcaErr) console.error("Error actualizando total_acreditado:", acredArcaErr.message);

        // Si la NC cubre el total, permitir re-facturar el PR
        if (ncCobreTotal && ncFactura.presupuesto_id) {
          let prQuery = supabase.from("presupuestos").update({ estado: "facturar" } as any).eq("id", ncFactura.presupuesto_id);
          if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id" as any, sociedadActiva.id);
          await prQuery;
        }

        setNcResult(data.factura.comprobante + (data.factura.cae ? ` — CAE: ${data.factura.cae}` : ""));
      } else {
        // Manual sin ARCA
        const today = todayAR();
        const { data: newNc, error: ncErr } = await (supabase as any)
          .from("facturas")
          .insert({
            tipo: ncTipo,
            punto_venta: emisorData.ptoVta,
            numero: Number(ncNumero),
            cliente_id: ncFactura.cliente_id,
            fecha: today,
            cae: null,
            cae_vencimiento: null,
            subtotal: ncTotals.neto,
            iva: ncTotals.iva,
            total: ncTotals.total,
            moneda: ncFactura.moneda || "ARS",
            tipo_cambio: ncFactura.tipo_cambio || null,
            estado: "emitida",
            sociedad_id: sociedadActiva?.id || null,
            factura_origen_id: ncFactura.id,
            created_by: profile?.id || null,
          })
          .select("id")
          .single();

        if (ncErr) throw new Error(ncErr.message);

        if (newNc) {
          const itemRows = ncItems.map((it, idx) => {
            return { factura_id: newNc.id, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, iva_porcentaje: isFacturaANc ? it.iva_porcentaje : 21, orden: idx };
          });
          const { error: ncItemsErr } = await (supabase as any).from("factura_items").insert(itemRows);
          if (ncItemsErr) throw new Error("Error al guardar items NC: " + ncItemsErr.message);
        }

        const newAcreditadoManual = (Number(ncFactura.total_acreditado) || 0) + ncTotals.total;
        const ncCobreTotalManual = newAcreditadoManual >= Number(ncFactura.total) - 0.01;
        let acredQuery = (supabase as any).from("facturas").update({
          total_acreditado: newAcreditadoManual,
          ...(ncCobreTotalManual ? { estado: "anulada" } : {}),
        }).eq("id", ncFactura.id);
        if (sociedadActiva?.id) acredQuery = acredQuery.eq("sociedad_id", sociedadActiva.id);
        const { error: acredErr } = await acredQuery;
        if (acredErr) throw new Error("Error al actualizar total_acreditado: " + acredErr.message);

        // Si la NC cubre el total, permitir re-facturar el PR
        if (ncCobreTotalManual && ncFactura.presupuesto_id) {
          let prQuery = supabase.from("presupuestos").update({ estado: "facturar" } as any).eq("id", ncFactura.presupuesto_id);
          if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id" as any, sociedadActiva.id);
          await prQuery;
        }

        setNcResult(formatComprobante(ncTipo, emisorData.ptoVta, Number(ncNumero)) + " (manual)");
      }

      setNcStep("success");
      await fetchData();
    } catch (err: unknown) {
      setNcError(err instanceof Error ? err.message : "Error al crear NC");
      setNcStep("error");
    } finally {
      setNcSaving(false);
    }
  }

  // Filters — multi-select estado (like presupuestos)
  const ESTADO_GROUPS: Record<string, string[]> = {
    emitida_all: ["pendiente", "parcial", "pagada", "vencida"],
    pendiente_all: ["pendiente", "parcial", "vencida"],
    vencida: ["vencida"],
    pagada: ["pagada"],
    anulada: ["anulada"],
  };
  const fvAllEstados = Object.keys(ESTADO_GROUPS);
  const [fvSelectedEstados, setFvSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const [fvTipoFilter, setFvTipoFilter] = useState("");
  const [clienteSearch, setClienteSearch] = useState("");
  const [fvEnvioFilter, setFvEnvioFilter] = useState<"todos" | "enviada" | "no_enviada">("todos");
  const fvIsAll = fvSelectedEstados.has("todos");

  function fvToggleEstado(estado: string) {
    setFvSelectedEstados(prev => {
      if (estado === "todos") return new Set(["todos"]);
      const next = new Set(prev);
      next.delete("todos");
      if (next.has(estado)) next.delete(estado); else next.add(estado);
      if (next.size === 0 || next.size === fvAllEstados.length) return new Set(["todos"]);
      return next;
    });
  }

  const fvEstadoCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [grp, estados] of Object.entries(ESTADO_GROUPS)) {
      c[grp] = facturas.filter(f => estados.includes(f.estado)).length;
    }
    return c;
  }, [facturas]);

  const filteredFacturas = facturas.filter((f) => {
    if (!fvIsAll && !Array.from(fvSelectedEstados).some(grp => (ESTADO_GROUPS[grp] || [grp]).includes(f.estado))) return false;
    if (fvTipoFilter && f.tipo !== fvTipoFilter) return false;
    if (clienteSearch.trim()) {
      const nombre = (f.clientes?.razon_social || "").toLowerCase();
      if (!nombre.includes(clienteSearch.trim().toLowerCase())) return false;
    }
    if (fvEnvioFilter === "enviada" && !f.email_enviado_at) return false;
    if (fvEnvioFilter === "no_enviada" && f.email_enviado_at) return false;
    return true;
  });

  // ── Fetch data ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setCobradoPorFactura(null);
    try {
      let query = supabase
        .from("facturas")
        .select(`*, clientes(razon_social, cuit, condicion_iva, email, email_facturacion, telefono, direccion, localidad, provincia, dias_cuenta_corriente), presupuestos:presupuesto_id(numero, cotizacion_modalidad, oc_cliente_fecha)`)
        .order("created_at", { ascending: false });

      if (sociedadActiva?.id) {
        query = query.eq("sociedad_id" as any, sociedadActiva.id);
      }

      const { data, error } = await query;

      if (!error && data) {
        try {setCobradoPorFactura(await fetchCobradoMap((data as unknown as FacturaRow[]).map(f=>({id:f.id,moneda:f.moneda||"ARS"}))))}
        catch {setCobradoPorFactura(null);}
        const hoy = new Date().toISOString().slice(0, 10);
        setFacturas((data as unknown as FacturaRow[]).map(f => {
          const fv = f.fecha_vencimiento || (f.clientes?.dias_cuenta_corriente && f.fecha
            ? new Date(new Date(f.fecha).getTime() + ((f.clientes.dias_cuenta_corriente as number) * 86400000)).toISOString().slice(0, 10)
            : null);
          // Compute derived estado: emitida + vencida → "vencida", emitida sin vencer → "pendiente"
          let estado = f.estado;
          if (estado === "emitida") {
            if (fv && fv < hoy) estado = "vencida";
            else estado = "pendiente";
          }
          return { ...f, estado, cotizacion_modalidad: f.cotizacion_modalidad || (f as any).presupuestos?.cotizacion_modalidad || null, oc_cliente_fecha: f.oc_cliente_fecha || (f as any).presupuestos?.oc_cliente_fecha || null, _clienteNombre: f.clientes?.razon_social || "", _fechaVencCalc: fv || "", _prNumero: (f as any).presupuestos?.numero || "" };
        }));
      } else if (error) {
        setFacturas(mockFacturas.map((f) => ({
          id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
          cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
          subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
          moneda: "ARS", tipo_cambio: null,
          presupuesto_id: null,
          clientes: { razon_social: f.clienteNombre, cuit: "" },
          _clienteNombre: f.clienteNombre,
        })));
      }
    } catch {
      setFacturas(mockFacturas.map((f) => ({
        id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
        cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
        subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
        moneda: "ARS", tipo_cambio: null,
        presupuesto_id: null,
        clientes: { razon_social: f.clienteNombre, cuit: "" },
        _clienteNombre: f.clienteNombre,
      })));
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-select factura from URL param
  useEffect(() => {
    if (!autoSelectId || facturas.length === 0) return;
    const match = facturas.find((f) => f.id === autoSelectId);
    if (match) {
      setDetailFactura(match);
      // Clean URL param
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("factura");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, [autoSelectId, facturas]);

  // Check ARCA status when sociedad changes
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    setArcaStatus(null); // reset to loading while fetching
    fetch(`/api/facturacion?action=status&sociedad_id=${sociedadActiva.id}`)
      .then((r) => r.ok ? r.json() : r.json().catch(() => null).then((body: any) => {
        // API returned non-OK status — assume cert exists, connectivity may fail (normal on Vercel)
        return { connected: false, certOk: true, afipError: body?.error || `HTTP ${r.status}`, ptoVta: body?.ptoVta };
      }))
      .then((data: any) => {
        // Guard against unexpected response shapes — if certOk is missing, default to true
        if (data && typeof data === "object" && data.certOk !== undefined) {
          setArcaStatus(data);
        } else {
          setArcaStatus({ connected: false, certOk: true, afipError: "No se pudo verificar estado — puede emitir igualmente", ptoVta: data?.ptoVta });
        }
      })
      .catch(() => setArcaStatus({ connected: false, certOk: true, error: "No se pudo verificar estado — puede emitir igualmente" }));
  }, [sociedadActiva?.id]);

  // ── Emit handlers ──────────────────────────────────────────────
  const openEmitModal = (prefill?: { cliente_id: string; tipo?: string; items?: EmitItem[]; moneda?: "ARS" | "USD"; tipo_cambio?: number }) => {
    beginInvoiceIntent(`facturacion:${sociedadActiva?.id}:emit`);
    // Solo forzar manual si certOk es explícitamente false (certificado no encontrado)
    const forceManual = arcaStatus !== null && arcaStatus.certOk === false;
    setEmitManual(forceManual);
    setCotizBna(null);
    setCotizFecha("");
    setRateOverride(false);
    setCotizError("");
    setCotizModalidad("divisas");
    const tipoInicial = forceManual ? "X" : (prefill?.tipo || "FB");
    const hoy = todayAR();
    setEmitData({
      tipo: tipoInicial,
      cliente_id: prefill?.cliente_id || "",
      punto_venta: forceManual ? 0 : emisorData.ptoVta,
      numero_manual: "",
      moneda: prefill?.moneda || "ARS",
      tipo_cambio: prefill?.tipo_cambio || 0,
      fecha: hoy,
      condicion_venta: "Cta. Cte.",
      fecha_vencimiento: calcFechaVencFC("Cta. Cte.", hoy),
      fce_cbu: "",
      fce_transmision: "",
      items: prefill?.items || [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }],
    });
    setEmitStep("form");
    setEmitError("");
    setEmitResult(null);
    setEmitClienteSearch("");
    setEmitOpen(true);
    // Fetch clientes
    const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva").eq("activo", true).order("razon_social");
    (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q)
      .then(({ data }) => { if (data) setClientes(data as ClienteOption[]); });
    // Auto-fill next correlative number
    (async () => {
      try {
        const pvInicial = forceManual ? 0 : emisorData.ptoVta;
        if (!sociedadActiva?.id) return;
        const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, tipoInicial).eq("punto_venta" as any, pvInicial).order("numero", { ascending: false }).limit(1);
        if (last && last.length > 0) {
          setEmitData(prev => ({ ...prev, numero_manual: String(Number(last[0].numero) + 1) }));
        }
      } catch { /* ignore */ }
    })();
  };

  async function openFacturacionMasiva() {
    setFmOpen(true);
    setFmClienteId("");
    setFmClienteSearch("");
    setFmPRs([]);
    setFmResults([]);
    setFmError("");
    setFmFecha(todayAR());
    const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva").eq("activo", true).order("razon_social");
    const { data, error } = await (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q);
    if (error) setFmError("No se pudieron cargar los clientes: " + error.message);
    else setFmClientes((data || []) as ClienteOption[]);
  }

  async function fmSelectCliente(clienteId: string) {
    setFmClienteId(clienteId);
    setFmPRs([]);
    setFmResults([]);
    setFmError("");
    if (!clienteId || !sociedadActiva?.id) return;
    setFmLoading(true);
    try {
      const { data: rows, error } = await (supabase as any)
        .from("presupuestos")
        .select("id, numero, fecha, moneda, tipo_cambio, tipo_cambio_divisas, cotizacion_modalidad, total, cliente_id, tipo_comprobante, estado, clientes(razon_social, condicion_iva), presupuesto_items(codigo, descripcion, cantidad, precio_venta, iva_porcentaje, orden)")
        .eq("sociedad_id", sociedadActiva.id)
        .eq("cliente_id", clienteId)
        .in("estado", ["facturar", "aprobado"])
        .order("fecha", { ascending: true });
      if (error) throw error;

      // Un PR con factura ya emitida no se vuelve a ofrecer aunque su estado
      // haya quedado viejo por una actualización anterior.
      const ids = (rows || []).map((r: any) => r.id);
      let emitidos = new Set<string>();
      if (ids.length) {
        const { data: fs, error: fErr } = await (supabase as any)
          .from("facturas").select("presupuesto_id")
          .eq("sociedad_id", sociedadActiva.id).in("presupuesto_id", ids)
          .neq("estado", "anulada");
        if (fErr) throw fErr;
        emitidos = new Set((fs || []).map((f: any) => f.presupuesto_id).filter(Boolean));
      }
      const disponibles = (rows || []).filter((r: any) => !emitidos.has(r.id)).map((r: any) => ({
        id: r.id,
        numero: r.numero,
        fecha: r.fecha,
        moneda: r.moneda === "USD" ? "USD" : "ARS",
        tipo_cambio: Number(r.tipo_cambio || r.tipo_cambio_divisas || 0) || null,
        cotizacion_modalidad: r.cotizacion_modalidad === "billetes" ? "billetes" : "divisas",
        total: Number(r.total || 0),
        cliente_id: r.cliente_id,
        clienteNombre: r.clientes?.razon_social || "",
        condicion_iva: r.clientes?.condicion_iva || null,
        tipo_comprobante: r.tipo_comprobante || null,
        items: (r.presupuesto_items || []).sort((a: any, b: any) => Number(a.orden || 0) - Number(b.orden || 0)).map((it: any) => ({
          descripcion: it.descripcion || it.codigo || "Item",
          cantidad: Number(it.cantidad || 0),
          precio_unitario: Number(it.precio_venta || 0),
          iva_porcentaje: Number(it.iva_porcentaje ?? 21),
        })),
        selected: true,
      })) as FacturacionMasivaPR[];
      setFmPRs(disponibles);
      if (!disponibles.length) setFmError("No hay presupuestos aprobados/listos para facturar sin una factura vigente.");
    } catch (err: any) {
      setFmError("No se pudieron cargar los presupuestos: " + (err?.message || "error desconocido"));
    } finally { setFmLoading(false); }
  }

  async function handleFacturacionMasiva() {
    const seleccionados = fmPRs.filter(p => p.selected);
    if (!sociedadActiva?.id) { setFmError("Seleccioná una sociedad antes de facturar"); return; }
    if (!seleccionados.length) { setFmError("Seleccioná al menos un presupuesto"); return; }
    if (!fmFecha) { setFmError("Elegí la fecha común de facturación"); return; }
    if (arcaStatus?.certOk === false) { setFmError("No se puede emitir masivamente: falta el certificado ARCA de esta sociedad"); return; }
    const sinItems = seleccionados.find(p => !p.items.length || p.items.some(i => !i.descripcion || i.cantidad <= 0 || i.precio_unitario <= 0));
    if (sinItems) { setFmError(`El presupuesto ${sinItems.numero} no tiene ítems completos para facturar`); return; }
    setFmEmitting(true); setFmError(""); setFmResults([]);
    const { data: { session } } = await supabase.auth.getSession();
    const resultados: FacturacionMasivaResultado[] = [];
    for (const pr of seleccionados) {
      const esRI = (pr.condicion_iva || "").toUpperCase() === "RI" || (pr.condicion_iva || "").toUpperCase() === "RESPONSABLE INSCRIPTO";
      const tipo = ["FA", "FB"].includes(pr.tipo_comprobante || "") ? pr.tipo_comprobante! : (esRI ? "FA" : "FB");
      try {
        let automaticRate: number | null = null;
        if (pr.moneda === "USD") {
          const quoteRes = await fetch(`/api/cotizacion-bna?fecha_factura=${encodeURIComponent(fmFecha)}&modalidad=${pr.cotizacion_modalidad || "divisas"}`);
          const quote = await quoteRes.json();
          if (!quoteRes.ok || !(quote.valor_venta > 0)) throw new Error(quote.error || "No se pudo verificar el tipo de cambio automático.");
          automaticRate = quote.valor_venta;
        }
        const res = await postInvoiceIntent(`presupuesto:${sociedadActiva.id}:${pr.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({
            tipo, cliente_id: pr.cliente_id, punto_venta: emisorData.ptoVta,
            moneda: pr.moneda, tipo_cambio: automaticRate,
            cotizacion_modalidad: pr.moneda === "USD" ? (pr.cotizacion_modalidad || "divisas") : null,
            fecha: fmFecha, items: pr.items, presupuesto_id: pr.id, sociedad_id: sociedadActiva.id,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
        const { error: updateError } = await (supabase as any).from("presupuestos").update({ estado: "facturado" }).eq("id", pr.id).eq("sociedad_id", sociedadActiva.id);
        resultados.push({ id: pr.id, numero: pr.numero, ok: true, comprobante: data.factura?.comprobante, error: updateError ? "Factura emitida; no se pudo actualizar el estado del presupuesto" : undefined });
      } catch (err: any) {
        resultados.push({ id: pr.id, numero: pr.numero, ok: false, error: err?.message || "Error desconocido" });
      }
      setFmResults([...resultados]);
    }
    setFmPRs(prev => prev.filter(p => !resultados.some(r => r.ok && r.id === p.id)));
    await fetchData();
    setFmEmitting(false);
  }

  const addItem = () => setEmitData((p) => ({ ...p, items: [...p.items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] }));
  const removeItem = (idx: number) => setEmitData((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: keyof EmitItem, value: string | number) => {
    setEmitData((p) => ({
      ...p,
      items: p.items.map((it, i) => i === idx ? { ...it, [field]: value } : it),
    }));
  };

  const emitFilteredClientes = useMemo(() => {
    const term = emitClienteSearch.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!term) return clientes;
    return clientes.filter(c =>
      c.razon_social.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(term) ||
      (c.cuit || "").includes(term)
    );
  }, [clientes, emitClienteSearch]);

  const isFacturaA = emitData.tipo === "FA" || emitData.tipo === "NCA" || emitData.tipo === "NDA" || emitData.tipo === "FCEA" || emitData.tipo === "NCEA";

  const isUSD = emitData.moneda === "USD";
  const tc = emitData.tipo_cambio || 0;

  const emitTotals = emitData.items.reduce((acc, it) => {
    if (emitManual || emitData.tipo === "X") {
      const total = it.cantidad * it.precio_unitario;
      return { neto: acc.neto + total, iva: acc.iva, total: acc.total + total };
    }
    if (isFacturaA) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    } else {
      const total = it.cantidad * it.precio_unitario;
      const ivaPct = it.iva_porcentaje ?? 21;
      const neto = Math.round(total / (1 + ivaPct / 100) * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
    }
  }, { neto: 0, iva: 0, total: 0 });

  const fceApplies = !emitManual && ["FA", "FB", "FCEA", "FCEB"].includes(emitData.tipo);
  const fceCheck = useFceCheck(emitOpen && fceApplies, sociedadActiva?.id, emitData.cliente_id, emitData.fecha);
  const fceRateReady = !isUSD || (tc > 0 && !cotizBnaLoading && ((canOverrideRate && rateOverride) || !!cotizBna));
  const fceRequired = fceCheck.ready && fceCheck.obligado && fceTotalArs(emitData.items, isFacturaA, isUSD ? tc : 1) >= (fceCheck.montoDesde || Infinity);
  const fceExpectedTipo = isFacturaA ? (fceRequired ? "FCEA" : "FA") : (fceRequired ? "FCEB" : "FB");
  const fceBlocked = fceApplies && (!fceCheck.ready || !fceRateReady || emitData.tipo !== fceExpectedTipo);
  useEffect(() => {
    if (!emitOpen || !fceApplies || !fceCheck.ready || !fceRateReady) return;
    if (emitData.tipo !== fceExpectedTipo) setEmitData(p => ({ ...p, tipo: fceExpectedTipo }));
  }, [emitOpen, fceApplies, fceCheck.ready, fceRateReady, emitData.tipo, fceExpectedTipo]);

  const handleEmit = async () => {
    if (!emitData.cliente_id) { setEmitError("Selecciona un cliente"); return; }
    if (fceBlocked) { setEmitError(fceCheck.error || "Esperá la verificación de FCE y de la cotización antes de emitir."); return; }
    if (fiscalDateBlocked) { setEmitError(fiscalDates.error || `Elegí una fecha válida desde ${fiscalMinDate}; esperá la verificación de ARCA si está en curso.`); return; }
    if (emitData.items.some((it) => !it.descripcion || it.precio_unitario <= 0)) {
      setEmitError("Completa todos los items con descripcion y precio"); return;
    }
    if (isUSD && (!tc || tc <= 0)) {
      setEmitError("Factura en USD requiere tipo de cambio (cotizacion ARCA)"); return;
    }
    if (["FCEA", "FCEB"].includes(emitData.tipo)) {
      if (!emitData.fecha_vencimiento || emitData.fecha_vencimiento < emitData.fecha || emitData.fecha_vencimiento < todayAR()) {
        setEmitError("La FCE requiere un vencimiento igual o posterior a hoy y a la fecha de emisión."); return;
      }
      if (!/^\d{22}$/.test(emitData.fce_cbu) || !["SCA", "ADC"].includes(emitData.fce_transmision)) {
        setEmitError("La FCE requiere la CBU del emisor (22 dígitos) y elegir SCA o ADC."); return;
      }
    }

    setEmitStep("emitting");
    setEmitError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await postInvoiceIntent(`facturacion:${sociedadActiva?.id}:emit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tipo: emitData.tipo,
          cliente_id: emitData.cliente_id,
          punto_venta: emitData.punto_venta,
          moneda: emitData.moneda,
          tipo_cambio: isUSD ? tc : null,
          cotizacion_modalidad: isUSD ? cotizModalidad : null,
          cotizacion_override: canOverrideRate && rateOverride,
          cotizacion_fecha: cotizFecha || cotizBna?.fecha || null,
          fecha: emitData.fecha || null,
          condicion_venta: emitData.condicion_venta || null,
          fecha_vencimiento: emitData.fecha_vencimiento || null,
          fce_cbu: ["FCEA", "FCEB"].includes(emitData.tipo) ? emitData.fce_cbu : undefined,
          fce_transmision: ["FCEA", "FCEB"].includes(emitData.tipo) ? emitData.fce_transmision : undefined,
          items: emitData.items,
          sociedad_id: sociedadActiva?.id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmitResult({ ...data.factura, warnings: data.warnings, warning: data.warning });
        setEmitStep("success");
        await fetchData();
      } else {
        setEmitError(data.error || "Error al emitir factura");
        setEmitStep("error");
      }
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error de conexion");
      setEmitStep("error");
    }
  };

  const handleEmitManual = async () => {
    if (!emitData.cliente_id) { setEmitError("Selecciona un cliente"); return; }
    if (emitData.fecha < minFecha) { setEmitError(`La fecha no puede ser anterior a la última factura (${minFecha})`); return; }
    if (emitData.items.some((it) => !it.descripcion || it.precio_unitario <= 0)) {
      setEmitError("Completa todos los items con descripcion y precio"); return;
    }
    const numManual = Number(emitData.numero_manual);
    if (!numManual || numManual <= 0) {
      setEmitError("Ingresa el numero de comprobante"); return;
    }

    setEmitStep("emitting");
    setEmitError("");

    try {
      const cliente = clientes.find(c => c.id === emitData.cliente_id);
      const { data: { session } } = await supabase.auth.getSession();
      const res = await postInvoiceIntent(`facturacion:${sociedadActiva?.id}:emit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          manual: true,
          tipo: "X",
          numero_manual: numManual,
          punto_venta: emitData.punto_venta,
          cliente_id: emitData.cliente_id,
          fecha: emitData.fecha || todayAR(),
          fecha_vencimiento: emitData.fecha_vencimiento || null,
          condicion_venta: emitData.condicion_venta || null,
          moneda: emitData.moneda,
          tipo_cambio: emitData.moneda === "USD" ? emitData.tipo_cambio : null,
          cotizacion_modalidad: emitData.moneda === "USD" ? cotizModalidad : null,
          items: emitData.items,
          sociedad_id: sociedadActiva?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Error al guardar factura manual");

      const comp = formatComprobante("X", emitData.punto_venta, numManual);
      setEmitResult({
        comprobante: comp,
        cae: null,
        cae_vencimiento: null,
        total: data.factura?.total ?? emitTotals.total,
        manual: true,
        cliente: cliente?.razon_social || "Consumidor Final",
      });
      setEmitStep("success");
      await fetchData();
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error al guardar factura");
      setEmitStep("error");
    }
  };

  // ── Detail actions ─────────────────────────────────────────────
  async function handleAnular(id: string) {
    if (!confirm("¿Seguro que queres anular esta factura?")) return;
    try {
      let q = supabase.from("facturas").update({ estado: "anulada" } as any).eq("id", id);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await q;
      if (error) { alert(error.message); return; }
      await fetchData();
      if (detailFactura?.id === id) { setDetailFactura(null); setPanelFullscreen(false); }
    } catch (err) { console.error("Error anulando:", err); }
  }

  async function handleRevertirAnulacion(id: string) {
    if (!confirm("¿Revertir la anulación y volver a estado Emitida?")) return;
    try {
      let q = supabase.from("facturas").update({ estado: "emitida" } as any).eq("id", id);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await q;
      if (error) { alert(error.message); return; }
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura(prev => prev ? { ...prev, estado: "emitida" } : null);
      alert("Factura revertida a Emitida");
    } catch (err) { alert("Error al revertir: " + (err as Error).message); }
  }

  async function handleEliminar(id: string) {
    if (!confirm("¿Eliminar esta factura manual permanentemente? Esta acción no se puede deshacer.")) return;
    try {
      const { error } = await (supabase as any).rpc("delete_manual_invoice", { p_factura_id: id });
      if (error) { alert("Error eliminando factura: " + error.message); return; }
      await fetchData();
      if (detailFactura?.id === id) { setDetailFactura(null); setPanelFullscreen(false); }
      alert("Factura eliminada");
    } catch (err) { alert("Error: " + (err as Error).message); }
  }


  // ── Copy & PDF ─────────────────────────────────────────────────
  // Cobro modal
  const [cobroModalId, setCobroModalId] = useState<string | null>(null);
  const [fxCobro, setFxCobro] = useState<{clienteId:string; documents:{id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]} | null>(null);
  type CobroLinea = { tipo: "cobro" | "transferencia" | "efectivo" | "tarjeta" | "cheque_recibido" | "echeq" | "retencion_iibb" | "retencion_ganancias" | "retencion_iva"; monto: string; descripcion: string; cheque_numero?: string; cheque_banco?: string; cheque_fecha?: string; cheque_id_digital?: string };
  const [cobroLineas, setCobroLineas] = useState<CobroLinea[]>([{ tipo: "transferencia", monto: "", descripcion: "" }]);
  const [cobroFecha, setCobroFecha] = useState(todayAR());
  const [cobroSaving, setCobroSaving] = useState(false);
  const [cobroPrevios, setCobroPrevios] = useState<number>(0);
  const [cobroPreviosLoading, setCobroPreviosLoading] = useState(false);
  const [cobroCotiz, setCobroCotiz] = useState("");
  const [cobroCotizModalidad, setCobroCotizModalidad] = useState<"divisas" | "billetes">("divisas");
  const [cobroCotizFetching, setCobroCotizFetching] = useState(false);
  const [cobroParsing, setCobroParsing] = useState(false);
  const cobroFileRef = useRef<HTMLInputElement>(null);

  async function handleParseComprobante(files: FileList | File[]) {
    setCobroParsing(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append("file", file);
      const res = await fetch("/api/parse-cobro", { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success || !json.data) { alert(json.error || "No se pudo leer el comprobante"); return; }
      const pagos: any[] = json.data.pagos || (json.data.tipo ? [json.data] : []);
      if (pagos.length === 0) { alert("No se detectaron pagos en el comprobante"); return; }

      // Map API tipo → CobroLinea tipo
      function mapTipo(t: string): CobroLinea["tipo"] {
        if (t === "deposito") return "efectivo";
        if (t === "cheque") return "cheque_recibido";
        if (t === "echeq") return "echeq";
        if (t === "retencion_iibb" || t === "retencion_ganancias" || t === "retencion_iva") return t;
        if (t === "efectivo") return "efectivo";
        return "transferencia";
      }

      const newLineas: CobroLinea[] = pagos.map((p, idx) => {
        const tipo = mapTipo(p.tipo);
        const descParts: string[] = [];
        if (tipo === "cheque_recibido" || tipo === "echeq") {
          if (p.banco) descParts.push(p.banco);
          if (p.cheque_numero) descParts.push(`N° ${p.cheque_numero}`);
          if (p.ordenante) descParts.push(p.ordenante);
        } else {
          if (p.referencia) descParts.push(p.referencia);
          if (p.banco) descParts.push(p.banco);
          if (p.ordenante) descParts.push(p.ordenante);
          if (p.concepto) descParts.push(p.concepto);
        }
        return {
          tipo,
          monto: p.monto ? String(p.monto) : "",
          descripcion: descParts.join(" — "),
          cheque_numero: p.cheque_numero || "",
          cheque_banco: p.banco || "",
          cheque_fecha: p.cheque_fecha || "",
          cheque_id_digital: p.cheque_id_digital || "",
        };
      });

      // Use fecha from first pago
      const firstFecha = pagos.find(p => p.fecha)?.fecha;
      if (firstFecha) setCobroFecha(firstFecha);

      setCobroLineas(prev => {
        // If only one default line (untouched by user), replace entirely with AI results
        const isDefault = prev.length === 1 && !prev[0].descripcion && (prev[0].tipo === "transferencia" || prev[0].tipo === "efectivo");
        if (isDefault) return newLineas;
        // Otherwise append
        return [...prev, ...newLineas];
      });
    } catch (e) {
      alert("Error al procesar el comprobante");
      console.error(e);
    } finally {
      setCobroParsing(false);
      if (cobroFileRef.current) cobroFileRef.current.value = "";
    }
  }

  async function fetchCobroCotizBNA(modalidad: "divisas" | "billetes") {
    setCobroCotizFetching(true);
    try {
      const res = await fetch(`/api/cotizacion-bna?modalidad=${modalidad}`);
      if (res.ok) { const d = await res.json(); setCobroCotiz(String(d.valor_venta)); setCobroCotizModalidad(modalidad); }
    } catch { /* ignore */ } finally { setCobroCotizFetching(false); }
  }

  async function fetchCobradoMap(documents: {id:string;moneda:string}): Promise<Record<string,number>>;
  async function fetchCobradoMap(documents: {id:string;moneda:string}[]): Promise<Record<string,number>>;
  async function fetchCobradoMap(input: {id:string;moneda:string} | {id:string;moneda:string}[]): Promise<Record<string,number>> {
    if (!sociedadActiva?.id) throw new Error("No se pudo identificar la sociedad para verificar los saldos.");
    const documents=Array.isArray(input)?input:[input];
    if(!documents.length)return {};
    const ids=documents.map(f=>f.id);
    const [direct,applications]=await Promise.all([
      (supabase as any).from("movimientos").select("factura_id,monto,moneda,anulado").in("factura_id",ids).eq("sociedad_id",sociedadActiva.id),
      (supabase as any).from("cobro_aplicaciones").select("factura_id,monto,movimientos!inner(anulado,sociedad_id)").in("factura_id",ids).eq("movimientos.sociedad_id",sociedadActiva.id),
    ]);
    if(direct.error||applications.error)throw new Error("No se pudieron verificar los cobros previos; no se habilitó el cobro. Reintentá la consulta.");
    const totals:Record<string,number>={};
    for(const m of direct.data||[]){
      if(m.anulado)continue;
      const doc=documents.find(f=>f.id===m.factura_id);
      if(!doc || (m.moneda||"ARS")!==doc.moneda)throw new Error("Hay un cobro previo en otra moneda sin aplicación conciliada. Revisalo antes de continuar.");
      if(!Number.isFinite(Number(m.monto)))throw new Error("Un cobro previo tiene un importe inválido.");
      totals[m.factura_id]=(totals[m.factura_id]||0)+Number(m.monto);
    }
    for(const a of applications.data||[]){
      const movement=Array.isArray(a.movimientos)?a.movimientos[0]:a.movimientos;
      if(!movement)throw new Error("Una aplicación no tiene un movimiento verificable.");
      if(movement.anulado)continue;
      if(!Number.isFinite(Number(a.monto)))throw new Error("Una aplicación de cobro tiene un importe inválido.");
      // Application amount is ALWAYS in the invoice's currency; FX cash is ARS
      // with factura_id null, so it must not also be counted as a direct payment.
      totals[a.factura_id]=(totals[a.factura_id]||0)+Number(a.monto);
    }
    return totals;
  }
  async function fetchCobrosPrevios(facturaId: string): Promise<number> {
    const factura=facturas.find(f=>f.id===facturaId);
    if(!factura)throw new Error("Factura no encontrada para verificar su saldo.");
    return (await fetchCobradoMap({id:factura.id,moneda:factura.moneda}))[facturaId]||0;
  }

  async function openCobroModal(factura: FacturaRow) {
    setCobroPreviosLoading(true);
    setCobroPrevios(0);
    setCobroFecha(todayAR());
    setCobroModalId(null);
    setCobroCotiz("");
    try {
      const previos = await fetchCobrosPrevios(factura.id);
      setCobroPrevios(previos);
      const saldoReal = Number(factura.total) - Number(factura.total_acreditado || 0) - previos;
      if(saldoReal<=0.005)throw new Error("La factura no tiene saldo pendiente.");
      if(factura.moneda==="USD"){
        setFxCobro({clienteId:factura.cliente_id,documents:[{id:factura.id,numero:formatComprobante(factura.tipo,factura.punto_venta,factura.numero),saldo:saldoReal,total:Number(factura.total),subtotal:Number(factura.subtotal),cotizacion:Number(factura.tipo_cambio)||undefined}]});
        return;
      }
      setCobroModalId(factura.id);
      setCobroLineas([{ tipo: "transferencia", monto: String(Math.max(0, Math.round(saldoReal * 100) / 100)), descripcion: "" }]);
    } catch(error) {
      alert(error instanceof Error?error.message:"No se pudo verificar el saldo de la factura.");
    } finally {
      setCobroPreviosLoading(false);
    }
  }

  function handleSepararImpuestos() {
    const f = facturas.find(ff => ff.id === cobroModalId);
    if (!f) return;
    const saldo = Number(f.total) - Number(f.total_acreditado || 0) - cobroPrevios;
    const ivaFactura = Number(f.iva || 0);
    const netoFactura = Number(f.subtotal || 0);
    // Proporción del saldo respecto al total (por si hay cobros previos parciales)
    const ratio = Number(f.total) > 0 ? Math.min(1, saldo / Number(f.total)) : 1;
    const ivaProporcional = Math.round(ivaFactura * ratio * 100) / 100;
    const netoProporcional = Math.round(netoFactura * ratio * 100) / 100;
    // Crear líneas: neto como transferencia + retenciones vacías para que el usuario complete
    const lineas: CobroLinea[] = [
      { tipo: "transferencia", monto: String(Math.max(0, Math.round(saldo * 100) / 100)), descripcion: "" },
    ];
    if (ivaProporcional > 0) {
      lineas.push({ tipo: "retencion_iva", monto: "", descripcion: `IVA factura: ${formatCurrency(ivaProporcional, f.moneda as "ARS" | "USD")}` });
    }
    if (netoProporcional > 0) {
      lineas.push({ tipo: "retencion_ganancias", monto: "", descripcion: `Neto factura: ${formatCurrency(netoProporcional, f.moneda as "ARS" | "USD")}` });
      lineas.push({ tipo: "retencion_iibb", monto: "", descripcion: `Neto factura: ${formatCurrency(netoProporcional, f.moneda as "ARS" | "USD")}` });
    }
    setCobroLineas(lineas);
  }

  async function handleRegistrarCobro() {
    const lineasValidas = cobroLineas.filter(l => Number(l.monto) > 0);
    if (!cobroModalId || lineasValidas.length === 0) return;
    const factura = facturas.find(f => f.id === cobroModalId);
    if (!factura) return;
    if(factura.moneda!=="ARS"){alert("Los cobros de facturas USD deben registrarse desde la liquidación con tipo de cambio.");return;}
    const totalLineas = lineasValidas.reduce((s, l) => s + Number(l.monto), 0);
    const saldo = Number(factura.total) - Number(factura.total_acreditado || 0) - cobroPrevios;
    const saldoComp = saldo;
    if (totalLineas > saldoComp + 0.01) {
      alert(`El total de cobros ($${totalLineas.toLocaleString()}) supera el saldo pendiente ($${Math.max(0, saldoComp).toLocaleString()})`);
      return;
    }
    setCobroSaving(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const lineasPayload = lineasValidas.map(l => {
        let desc = l.descripcion || `Cobro ${formatComprobante(factura.tipo, factura.punto_venta, factura.numero)}`;
        // Append cheque details to description
        if ((l.tipo === "cheque_recibido" || l.tipo === "echeq") && (l.cheque_numero || l.cheque_banco)) {
          const parts = [l.cheque_banco, l.cheque_numero ? `N° ${l.cheque_numero}` : null, l.cheque_fecha, l.cheque_id_digital ? `ID: ${l.cheque_id_digital}` : null].filter(Boolean);
          desc = (l.descripcion ? l.descripcion + " — " : "") + parts.join(" · ");
        }
        return { tipo: l.tipo === "echeq" ? "cheque_recibido" : l.tipo, monto: Number(l.monto), descripcion: desc };
      });
      const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc("registrar_cobro", {
        p_factura_id: cobroModalId,
        p_lineas: lineasPayload,
        p_fecha: cobroFecha,
        p_sociedad_id: sociedadActiva?.id || null,
        p_created_by: userId,
      });
      if (rpcErr) throw rpcErr;

      // Auto-create echeqs for cheque/echeq lines
      const chequeLineas = lineasValidas.filter(l => l.tipo === "cheque_recibido" || l.tipo === "echeq");
      for (const cl of chequeLineas) {
        const echeqRow: Record<string, unknown> = {
          direccion: "recibido",
          tipo_cheque: cl.tipo === "echeq" ? "echeq" : "fisico",
          numero: cl.cheque_numero || `CHQ-${Date.now()}`,
          banco_emisor: cl.cheque_banco || null,
          monto: Number(cl.monto),
          moneda: "ARS",
          fecha_pago: cl.cheque_fecha || cobroFecha,
          estado: "en_cartera",
          origen_tipo: "cliente",
          origen_nombre: factura.clientes?.razon_social || factura._clienteNombre || "",
          observaciones: cl.descripcion || null,
        };
        if (cl.cheque_id_digital) (echeqRow as any).echeq_id_digital = cl.cheque_id_digital;
        if (sociedadActiva?.id) echeqRow.sociedad_id = sociedadActiva.id;
        if (userId) echeqRow.user_id = userId;
        await (supabase as any).from("echeqs").insert(echeqRow);
      }

      setCobroModalId(null);
      await fetchData();
      if (detailFactura?.id === cobroModalId) {
        setDetailFactura(prev => prev ? { ...prev, estado: rpcResult?.pagada ? "pagada" : "parcial" } : null);
      }
    } catch (err: any) {
      alert("Error al registrar cobro: " + (err.message || JSON.stringify(err)));
    } finally {
      setCobroSaving(false);
    }
  }

  // ── Cobro masivo modal ────────────────────────────────────────
  interface CobroMasivoFC { id: string; numero: number; tipo: string; punto_venta: number; fecha: string; total: number; subtotal: number; iva: number; total_acreditado: number; moneda: string; tipo_cambio?:number; saldo: number; selected: boolean }
  const [cmOpen, setCmOpen] = useState(false);
  const [cmClientes, setCmClientes] = useState<ClienteOption[]>([]);
  const [cmClienteId, setCmClienteId] = useState("");
  const [cmClienteSearch, setCmClienteSearch] = useState("");
  const [cmFCs, setCmFCs] = useState<CobroMasivoFC[]>([]);
  const [cmLoadingFCs, setCmLoadingFCs] = useState(false);
  const [cmLiquidacionOpen, setCmLiquidacionOpen] = useState(false);

  async function openCobroMasivo() {
    setCmOpen(true);
    setCmClienteId("");
    setCmClienteSearch("");
    setCmFCs([]);
    setCmLiquidacionOpen(false);
    const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva").eq("activo", true).order("razon_social");
    const { data } = await (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q);
    if (data) setCmClientes(data as ClienteOption[]);
  }

  async function cmSelectCliente(clienteId: string) {
    setCmClienteId(clienteId);
    setCmFCs([]);
    if (!clienteId) return;
    if(!sociedadActiva?.id){alert("Seleccioná una sociedad antes de consultar los saldos.");return;}
    setCmLoadingFCs(true);
    try {
      let q = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, tipo_cambio, estado").eq("cliente_id", clienteId).in("estado", ["emitida", "parcial", "vencida", "pendiente"]).order("fecha", { ascending: true });
      if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
      const { data, error } = await q;
      if(error)throw error;
      if (data && data.length > 0) {
        // Query existing movimientos + cobro_aplicaciones to get real saldo
        const cobradoMap = await fetchCobradoMap(data.map((f:any)=>({id:f.id,moneda:f.moneda||"ARS"})));
        setCmFCs(data.map((f: any) => {
          const cobrado = cobradoMap[f.id] || 0;
          const saldo = Number(f.total) - Number(f.total_acreditado || 0) - cobrado;
          return { id: f.id, numero: f.numero ?? 0, tipo: f.tipo ?? "", punto_venta: f.punto_venta ?? 0, fecha: f.fecha, subtotal: Number(f.subtotal || 0), iva: Number(f.iva || 0), total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), moneda: f.moneda ?? "ARS", tipo_cambio:Number(f.tipo_cambio)||undefined, saldo: Math.max(0, saldo), selected: false };
        }).filter((f: CobroMasivoFC) => f.saldo > 0.01));
      }
    } catch(error) {setCmFCs([]);alert(error instanceof Error?error.message:"No se pudieron verificar los saldos.");} finally { setCmLoadingFCs(false); }
  }

  function cmOpenLiquidacion() {
    const selected = cmFCs.filter(f => f.selected);
    if (selected.length === 0) { alert("Seleccioná al menos una factura"); return; }
    if(new Set(selected.map(f=>f.moneda)).size!==1){alert("Seleccioná facturas de una sola moneda por liquidación; no se pueden sumar pesos y dólares.");return;}
    if(selected[0].moneda==="USD"){
      setFxCobro({clienteId:cmClienteId,documents:selected.map(f=>({id:f.id,numero:formatComprobante(f.tipo,f.punto_venta,f.numero),saldo:f.saldo,total:f.total,subtotal:f.subtotal,cotizacion:f.tipo_cambio}))});
      return;
    }
    setCmLiquidacionOpen(true);
  }

  function cmGetLiquidacionFacturas(): LiquidacionFactura[] {
    return cmFCs.filter(f => f.selected).map(f => ({
      id: f.id,
      numero: formatComprobante(f.tipo, f.punto_venta, f.numero),
      fecha: f.fecha,
      subtotal: f.subtotal,
      iva: f.iva,
      total: f.total,
      total_acreditado: f.total_acreditado,
      saldo: f.saldo,
      moneda: f.moneda,
    }));
  }

  const cmFilteredClientes = cmClienteSearch.trim()
    ? cmClientes.filter(c => c.razon_social.toLowerCase().includes(cmClienteSearch.toLowerCase()) || (c.cuit || "").includes(cmClienteSearch))
    : cmClientes;

  const [copied, setCopied] = useState(false);
  function handleCopy(f: FacturaRow) {
    const isManualX = f.tipo === "X";
    const lines = [
      `*${formatComprobante(f.tipo, f.punto_venta, f.numero)}*`,
      "",
      `Fecha: ${formatDate(f.fecha)}`,
      `Estado: ${estadoConfig[f.estado]?.label || f.estado}`,
      "",
      `*Emisor:* ${emisorData.razonSocial}`,
      `CUIT: ${emisorData.cuit}`,
      "",
      `*Cliente:* ${f.clientes?.razon_social || "\u2014"}`,
      f.clientes?.cuit ? `CUIT: ${f.clientes.cuit}` : null,
      "",
      isManualX ? null : `Neto: ${formatCurrency(Number(f.subtotal), f.moneda as "USD" | "ARS")}`,
      isManualX ? null : `IVA: ${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}`,
      `*Total: ${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}*`,
      f.cae ? `\nCAE: ${f.cae}` : null,
      f.cae_vencimiento ? `Vto CAE: ${formatDate(f.cae_vencimiento)}` : null,
    ];
    navigator.clipboard.writeText(lines.filter(Boolean).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function buildFacturaSummaryText(f: FacturaRow) {
    const isManualX = f.tipo === "X";
    const comp = formatComprobante(f.tipo, f.punto_venta, f.numero);
    const lines = [
      `${comp}`,
      "",
      `Fecha: ${formatDate(f.fecha)}`,
      `Estado: ${estadoConfig[f.estado]?.label || f.estado}`,
      "",
      `Emisor: ${emisorData.razonSocial}`,
      `CUIT: ${emisorData.cuit}`,
      "",
      `Cliente: ${f.clientes?.razon_social || "\u2014"}`,
      f.clientes?.cuit ? `CUIT: ${f.clientes.cuit}` : null,
      f.oc_cliente ? `OC Cliente: ${f.oc_cliente}` : null,
      "",
      "DETALLE:",
      ...detailItems.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} x ${formatCurrency(it.precio_unitario, f.moneda as "USD" | "ARS")} = ${formatCurrency(it.subtotal, f.moneda as "USD" | "ARS")}`),
      "",
      isManualX ? null : `Subtotal: ${formatCurrency(Number(f.subtotal), f.moneda as "USD" | "ARS")}`,
      isManualX ? null : `IVA: ${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}`,
      `TOTAL: ${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}`,
      f.moneda === "USD" && f.tipo_cambio ? `Moneda: USD — TC: ${Number(f.tipo_cambio).toLocaleString("es-AR")}` : null,
      f.cae ? `\nCAE: ${f.cae}` : null,
      f.cae_vencimiento ? `Vto CAE: ${formatDate(f.cae_vencimiento)}` : null,
    ];
    return lines.filter(Boolean).join("\n");
  }

  async function handleEmailFactura(f: FacturaRow) {
    const comp = formatComprobante(f.tipo, f.punto_venta, f.numero);
    const socName = sociedadActiva?.razonSocial || sociedadActiva?.nombre || "Lazzari";
    const template = await loadEmailTemplate("factura", sociedadActiva?.id || "");
    const vars = {
      comprobante: comp,
      numero: comp,
      sociedad: socName,
      total: formatCurrency(Number(f.total), f.moneda as "ARS" | "USD"),
      fecha: formatDate(f.fecha),
      cliente: f.clientes?.razon_social || "",
    };
    // Fetch client emails + contactos
    const suggested: { email: string; label?: string }[] = [];
    try {
      if (f.clientes?.email) suggested.push({ email: f.clientes.email, label: "Cliente" });
      const { data: contactos } = await (supabase as any).from("contactos").select("nombre, email").eq("entity_type", "cliente").eq("entity_id", f.cliente_id);
      if (contactos) {
        for (const c of contactos) {
          if (c.email && !suggested.some(s => s.email === c.email)) {
            suggested.push({ email: c.email, label: c.nombre || "Contacto" });
          }
        }
      }
    } catch { /* ignore */ }

    setEmailModal({
      open: true,
      facturaId: f.id,
      to: f.clientes?.email || "",
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social),
      suggestedEmails: suggested,
    });
  }

  function buildFacturaHTML(f: FacturaRow): string | null {
    if (!sociedadActiva) return null;
    const soc = getSociedadPDF(sociedadActiva);
    const cli = f.clientes;
    return generateFacturaPDF({
      tipo: f.tipo,
      punto_venta: f.punto_venta,
      numero: f.numero,
      fecha: f.fecha,
      fecha_vencimiento: f.fecha_vencimiento,
      nota_interna: f.nota_interna,
      condicion_venta: f.condicion_venta,
      moneda: f.moneda as "ARS" | "USD",
      tipo_cambio: f.tipo_cambio,
      cotizacion_modalidad: f.cotizacion_modalidad || (f as any).presupuestos?.cotizacion_modalidad || null,
      subtotal: Number(f.subtotal),
      iva: Number(f.iva),
      total: Number(f.total),
      cae: f.cae,
      cae_vencimiento: f.cae_vencimiento,
      oc_cliente: f.oc_cliente,
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
      items: detailItems.map(it => ({
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: Number(it.precio_unitario),
        iva_porcentaje: it.iva_porcentaje,
        subtotal: Number(it.subtotal),
      })),
    }, emisorData, soc);
  }

  async function handlePrintFactura(f: FacturaRow) {
    if (!sociedadActiva) return;
    // Ensure items are loaded before generating PDF
    if (detailItems.length === 0) {
      const { data } = await supabase.from("factura_items")
        .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
        .eq("factura_id", f.id).order("orden");
      if (data) setDetailItems(data.map(d => ({ ...d, subtotal: d.subtotal ?? 0 })));
    }
    const html = buildFacturaHTML(f);
    if (html) openPDFWindow(html, documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social));
  }

  // ── KPIs ───────────────────────────────────────────────────────
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const facturasEsteMes = facturas.filter((f) => {
    const d = new Date(f.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && f.estado !== "anulada";
  });
  const ncTipos = ["NCA", "NCB", "NCEA", "NCEB"];
  const facturadoMesMoneda = (moneda:string)=>facturasEsteMes.filter(f=>f.moneda===moneda).reduce((a, f) => a + (ncTipos.includes(f.tipo) ? -Number(f.total) : Number(f.total)), 0);
  const saldoFactura = (f:FacturaRow)=>["pagada","anulada"].includes(f.estado)?0:Math.max(0,Number(f.total)-Number(f.total_acreditado||0)-(cobradoPorFactura?.[f.id]||0));
  const pendientesMoneda = (moneda:string)=>facturas.filter(f => f.moneda===moneda && ["pendiente", "parcial", "vencida"].includes(f.estado) && !ncTipos.includes(f.tipo)).reduce((a, f) => a + saldoFactura(f), 0);
  const facturasVencidas = facturas.filter(f => f.estado === "vencida").length;
  const caeVigentes = facturas.filter(f => f.cae && f.estado !== "anulada").length;

  function exportFacturasCSV() {
    if(!cobradoPorFactura){alert("No se pudieron verificar los saldos. Actualizá la lista antes de exportar para no informar una deuda incorrecta.");return;}
    const csvLines: string[] = ["Fecha;Vencimiento;Cliente;Documento;Moneda;Importe;Deuda"];
    filteredFacturas.forEach((f: any) => {
      const doc = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
      const saldo = saldoFactura(f);
      csvLines.push(`${f.fecha};${f._fechaVencCalc || ""};"${(f.clientes?.razon_social || "").replace(/"/g, '""')}";"${doc}";${f.moneda};"${formatCurrency(Number(f.total), f.moneda as "ARS"|"USD")}";"${formatCurrency(saldo, f.moneda as "ARS"|"USD")}"`);
    });
    const blob = new Blob(["\uFEFF" + csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `facturas-ventas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <>
        {!embedded && <Header title="Facturacion" subtitle="Comprobantes electronicos" />}
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      {!embedded && <Header
        title="Facturacion"
        subtitle="Comprobantes electronicos ARCA"
        action={{ label: "Emitir factura", onClick: openEmitModal }}
      />}
      {/* Action buttons */}
      <div className="px-6 lg:px-8 pt-4 -mb-2 flex justify-end gap-2">
        {embedded && (
          <button onClick={() => openEmitModal()} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            <Plus className="h-4 w-4" /> Emitir factura
          </button>
        )}
        <button onClick={openFacturacionMasiva} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
          <FileCheck className="h-4 w-4" /> Facturación masiva sin OC
        </button>
        <button onClick={openCobroMasivo} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
          <DollarSign className="h-4 w-4" /> Cobro masivo
        </button>
        <button onClick={exportFacturasCSV} className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>
      <div className="p-6 lg:p-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={`${formatCurrency(facturadoMesMoneda("ARS"),"ARS")} / ${formatCurrency(facturadoMesMoneda("USD"),"USD")}`} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Pendientes de cobro" value={cobradoPorFactura?`${formatCurrency(pendientesMoneda("ARS"),"ARS")} / ${formatCurrency(pendientesMoneda("USD"),"USD")}`:"Saldo sin verificar"} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Comprobantes vencidos" value={String(facturasVencidas)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-blue-600" />
        </div>

        {/* Search & tipo filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input value={clienteSearch} onChange={(e) => setClienteSearch(e.target.value)}
              placeholder="Buscar por cliente..."
              className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
          </div>
          <select value={fvTipoFilter} onChange={(e) => setFvTipoFilter(e.target.value)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
            <option value="">Todos los tipos</option>
            <option value="FA">FA</option>
            <option value="FB">FB</option>
            <option value="FCEA">FCEA</option>
            <option value="FCEB">FCEB</option>
            <option value="NCA">NCA</option>
            <option value="NCB">NCB</option>
            <option value="NCEA">NCEA</option>
            <option value="NCEB">NCEB</option>
          </select>
          <select value={fvEnvioFilter} onChange={(e) => setFvEnvioFilter(e.target.value as any)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
            <option value="todos">Envío: todas</option>
            <option value="enviada">Enviadas</option>
            <option value="no_enviada">No enviadas</option>
          </select>
          {(clienteSearch || !fvIsAll || fvTipoFilter || fvEnvioFilter !== "todos") && (
            <span className="text-xs text-zinc-500">{filteredFacturas.length} de {facturas.length}</span>
          )}
        </div>
        {/* Estado multi-select toggles */}
        <div className="flex gap-2 flex-wrap">
          {([["emitida_all", "Emitida"], ["pendiente_all", "Pendiente"], ["vencida", "Vencida"], ["pagada", "Pagada"], ["anulada", "Anulada"]] as const).map(([key, label]) => {
            const active = !fvIsAll && fvSelectedEstados.has(key);
            return (
              <button key={key} onClick={() => fvToggleEstado(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-orange-500 text-white shadow-sm" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"}`}>
                {active && <Check className="h-3.5 w-3.5" />} {label} <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>{fvEstadoCounts[key] || 0}</span>
              </button>
            );
          })}
        </div>

        {/* Data table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<FacturaRow>
            columns={[
              { key: "numero", label: "Comprobante", sortable: true, render: (r) => (
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-zinc-400" />
                  <div>
                    <span className="font-mono text-xs font-bold">{formatComprobante(r.tipo, r.punto_venta, r.numero)}</span>
                    {r._prNumero && <p className="font-mono text-[10px] text-blue-500">{r._prNumero}</p>}
                  </div>
                </div>
              )},
              { key: "clientes", label: "Cliente", sortable: true, sortKey: "_clienteNombre", render: (r) => <span className="font-medium">{r.clientes?.razon_social || "\u2014"}</span> },
              { key: "oc_cliente", label: "OC", render: (r) => r.oc_cliente
                ? <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{r.oc_cliente}{r.oc_cliente_fecha && <small className="ml-1 font-sans text-zinc-400">({formatDate(r.oc_cliente_fecha)})</small>}</span>
                : <span className="text-zinc-300">{"\u2014"}</span>
              },
              { key: "fecha", label: "F.Venta", sortable: true, render: (r) => <span className="text-zinc-500">{formatDate(r.fecha)}</span> },
              { key: "_fechaVencCalc" as any, label: "F.Pago", sortable: true, render: (r) => {
                const fv = r._fechaVencCalc;
                if (editingFechaPago === r.id) return (
                  <div onClick={e => e.stopPropagation()}>
                    <input type="date" autoFocus defaultValue={fv || ""} onBlur={e => saveFechaPago(r.id, e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingFechaPago(null); }}
                      className="w-32 px-1.5 py-0.5 rounded border border-orange-300 text-xs bg-white dark:bg-zinc-800 dark:text-white dark:border-orange-600" />
                  </div>
                );
                if (!fv) return (
                  <div className="flex items-center gap-1" onClick={e => { e.stopPropagation(); setEditingFechaPago(r.id); }}>
                    <span className="text-zinc-300">—</span>
                    <Pencil className="h-3 w-3 text-zinc-300 hover:text-orange-500 cursor-pointer" />
                  </div>
                );
                const vencido = new Date(fv) < new Date(todayAR()) && r.estado !== "pagada" && r.estado !== "anulada";
                return (
                  <div className="flex items-center gap-1" onClick={e => { e.stopPropagation(); setEditingFechaPago(r.id); }}>
                    <span className={vencido ? "text-red-500 font-medium" : "text-zinc-500"}>{formatDate(fv)}</span>
                    <Pencil className="h-3 w-3 text-zinc-300 hover:text-orange-500 cursor-pointer" />
                  </div>
                );
              }},
              { key: "total", label: "Total", sortable: true, className: "text-right", render: (r) => (
                <span className="font-mono font-semibold block text-right">{formatCurrency(Number(r.total), r.moneda as "USD" | "ARS")}</span>
              )},
              { key: "cae", label: "CAE", render: (r) => r.cae
                ? <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{r.cae.slice(-8)}</span>
                : <span className="text-xs text-zinc-400 italic">Manual</span>
              },
              { key: "estado", label: "Estado", sortable: true, render: (r) => (
                <Badge variant={estadoConfig[r.estado]?.variant || "info"}>
                  {estadoConfig[r.estado]?.label || r.estado}
                </Badge>
              )},
              { key: "recibida_cliente" as any, label: "Recib.", sortable: false, className: "w-12 text-center", render: (r: FacturaRow) => (
                <div onClick={(e) => e.stopPropagation()} className="flex justify-center" title={r.recibida_cliente ? "Cliente confirmó recepción" : "Marcar como recibida por cliente"}>
                  <input type="checkbox" checked={!!r.recibida_cliente} onChange={() => toggleRecibidaCliente(r.id, !!r.recibida_cliente)}
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-500 focus:ring-emerald-500 cursor-pointer" />
                </div>
              )},
              { key: "_mail" as any, label: "", sortable: false, className: "w-10", render: (r: FacturaRow) => (
                <div
                  onClick={(e) => { e.stopPropagation(); handleEmailFactura(r); }}
                  className="flex justify-center cursor-pointer"
                  title={(() => {
                    const emailDest = r.email_enviado_a || r.clientes?.email_facturacion || r.clientes?.email || "";
                    return r.email_enviado_at
                      ? `Enviada por email el ${formatDateTime(r.email_enviado_at)}${emailDest ? ` a ${emailDest}` : ""}`
                      : `Enviar por email${emailDest ? ` (${emailDest})` : ""}`;
                  })()}
                >
                  {r.email_enviado_at
                    ? <MailCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    : <Mail className="h-4 w-4 text-zinc-700 dark:text-zinc-300 hover:text-orange-500 transition-colors" />}
                </div>
              )},
            ]}
            data={filteredFacturas}
            onRowClick={(f) => {
              setDetailFactura(f);
              setDetailNCs([]);
              supabase.from("factura_items").select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden")
                .then(({ data }) => setDetailItems((data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }))));
              // Cargar NCs relacionadas a esta factura
              (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, total, estado")
                .eq("factura_origen_id", f.id).order("fecha", { ascending: false })
                .then(({ data }: { data: FacturaRow[] | null }) => setDetailNCs(data || []));
            }}
          />
        </Card>

        {/* ARCA Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <CardTitle>Conexion ARCA</CardTitle>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
                  <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">WSFE</p>
                  <p className="text-xs text-zinc-400">Factura electronica</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${arcaStatus?.connected ? "bg-emerald-500" : arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.certOk ? "bg-amber-400" : "bg-red-400"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus === null ? "Verificando..." : arcaStatus.connected ? `Produccion — PV ${arcaStatus.ptoVta}` : arcaStatus?.certOk ? `Configurado — PV ${arcaStatus.ptoVta}` : "Sin conexion"}
                </span>
              </div>
              {arcaStatus && !arcaStatus.connected && arcaStatus.afipError && (
                <p className="text-xs text-amber-500 mt-1 leading-tight">AFIP no responde ahora (normal)</p>
              )}
              {arcaStatus && !arcaStatus.connected && arcaStatus.error && !arcaStatus.certOk && (
                <p className="text-xs text-red-500 mt-1 leading-tight">{arcaStatus.error}</p>
              )}
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-950">
                  <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Certificado digital</p>
                  <p className="text-xs text-zinc-400">Requerido para emitir</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.connected || arcaStatus?.certOk ? "bg-emerald-500" : "bg-red-400"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus === null ? "Verificando..." : arcaStatus?.connected || arcaStatus?.certOk ? "Certificado configurado" : "Certificado no configurado"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500 mb-2">CUIT emisor</p>
              <p className="text-xl font-bold font-mono dark:text-white">{emisorData.cuit}</p>
              <p className="text-xs text-zinc-400 mt-1">{emisorData.razonSocial}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Facturación masiva sin OC del cliente ───────────────────── */}
      {fmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
              <div><h2 className="text-lg font-bold dark:text-white">Facturación masiva sin OC del cliente</h2><p className="text-xs text-zinc-500 mt-1">Seleccioná presupuestos aprobados/listos para facturar y emitilos con una fecha común.</p></div>
              <button onClick={() => setFmOpen(false)} disabled={fmEmitting} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              {fmError && <div className="text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-3 py-2">{fmError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                  <input value={fmClienteId ? (fmClientes.find(c => c.id === fmClienteId)?.razon_social || "") : fmClienteSearch} onChange={e => { setFmClienteSearch(e.target.value); if (fmClienteId) setFmClienteId(""); }} placeholder="Buscar por nombre o CUIT..." className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" autoComplete="off" />
                  {!fmClienteId && fmClienteSearch.trim() && <div className="absolute z-20 mt-1 left-0 right-0 max-h-40 overflow-y-auto rounded-lg border bg-white dark:bg-zinc-800 dark:border-zinc-700 shadow-lg">{fmClientes.filter(c => c.razon_social.toLowerCase().includes(fmClienteSearch.toLowerCase()) || (c.cuit || "").includes(fmClienteSearch)).slice(0, 15).map(c => <button key={c.id} onClick={() => { setFmClienteId(c.id); setFmClienteSearch(""); fmSelectCliente(c.id); }} className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">{c.razon_social} <span className="text-xs text-zinc-400 float-right">{c.cuit || "Sin CUIT"}</span></button>)}</div>}
                </div>
                <div><label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha común *</label><input type="date" value={fmFecha} min={minFecha} max={todayAR()} onChange={e => setFmFecha(e.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" /></div>
              </div>
              {fmLoading && <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando presupuestos...</div>}
              {fmPRs.length > 0 && <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/60 text-sm"><span className="font-medium dark:text-white">{fmPRs.filter(p => p.selected).length} de {fmPRs.length} seleccionados</span><button onClick={() => setFmPRs(p => p.map(x => ({ ...x, selected: !p.every(y => y.selected) })))} className="text-indigo-600 hover:underline text-xs">{fmPRs.every(p => p.selected) ? "Quitar todos" : "Seleccionar todos"}</button></div>
                <div className="divide-y divide-zinc-200 dark:divide-zinc-700">{fmPRs.map(pr => <label key={pr.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"><input type="checkbox" checked={pr.selected} onChange={() => setFmPRs(p => p.map(x => x.id === pr.id ? { ...x, selected: !x.selected } : x))} disabled={fmEmitting} className="h-4 w-4 rounded border-zinc-300 text-indigo-600" /><span className="flex-1 min-w-0"><span className="font-medium text-sm dark:text-white">{pr.numero}</span><span className="ml-2 text-xs text-zinc-400">{formatDate(pr.fecha)} · {pr.items.length} ítem{pr.items.length === 1 ? "" : "s"}</span></span><span className="text-sm font-mono dark:text-zinc-200">{formatCurrency(pr.total, pr.moneda)}</span></label>)}</div>
              </div>}
              {fmResults.length > 0 && <div className="space-y-2"><h3 className="text-sm font-semibold dark:text-white">Resultado</h3>{fmResults.map(r => <div key={r.id} className={`rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"}`}><span className="font-medium">{r.numero}</span>: {r.ok ? `emitida ${r.comprobante || ""}` : `no emitida — ${r.error}`}{r.ok && r.error && <span className="block text-xs mt-1">Aviso: {r.error}</span>}</div>)}</div>}
              <div className="flex justify-end gap-3 pt-2"><button onClick={() => setFmOpen(false)} disabled={fmEmitting} className="px-4 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 dark:text-zinc-200">{fmResults.some(r => r.ok) ? "Cerrar" : "Cancelar"}</button><button onClick={handleFacturacionMasiva} disabled={fmEmitting || fmLoading || !fmClienteId || !fmPRs.some(p => p.selected)} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{fmEmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Emitiendo...</> : <><FileCheck className="h-4 w-4" /> Emitir seleccionadas</>}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Emit Modal ──────────────────────────────────────────────── */}
      {emitOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-y-auto ${emitFullscreen ? "fixed inset-2 max-w-none max-h-none mx-0" : "w-full max-w-2xl mx-4 max-h-[90vh]"}`}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">{emitManual ? "Factura manual" : "Emitir factura ARCA"}</h2>
                <p className="text-sm text-zinc-400">{emitManual ? "Se guarda sin autorizar en ARCA (sin CAE)" : "Se autorizara en tiempo real con ARCA"}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEmitFullscreen(f => !f)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400" title={emitFullscreen ? "Restaurar" : "Maximizar"}>
                  {emitFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button onClick={() => setEmitOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {emitStep === "form" && (
              <div className="p-6 space-y-5">
                {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{emitError}</div>}

                {/* Toggle ARCA / Manual */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <button
                      onClick={() => { setEmitManual(false); setEmitData((p) => ({ ...p, tipo: p.tipo === "X" ? "FA" : p.tipo, punto_venta: emisorData.ptoVta })); }}
                      disabled={arcaStatus !== null && arcaStatus.certOk === false}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!emitManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                    </button>
                    <button
                      onClick={async () => {
                        setEmitManual(true);
                        const newTipo = "X";
                        const manualPv = 0;
                        setEmitData((p) => ({ ...p, tipo: newTipo, punto_venta: manualPv }));
                        try {
                          if (!sociedadActiva?.id) return;
                          const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, newTipo).eq("punto_venta" as any, manualPv).order("numero", { ascending: false }).limit(1);
                          setEmitData(prev => ({ ...prev, numero_manual: last && last.length > 0 ? String(Number(last[0].numero) + 1) : "1" }));
                        } catch { /* ignore */ }
                      }}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${emitManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> ARCA no configurado para esta sociedad — solo modo manual disponible.
                    </p>
                  )}
                </div>

                {/* Tipo + Cliente + PV */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Tipo *</label>
                    <select value={emitData.tipo} disabled={emitManual} onChange={(e) => {
                      const newTipo = e.target.value;
                      setEmitData((p) => ({ ...p, tipo: newTipo }));
                      // Auto-update correlative number for new tipo
                      (async () => {
                        try {
                          if (!sociedadActiva?.id) return;
                          const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, newTipo).eq("punto_venta" as any, emitData.punto_venta).order("numero", { ascending: false }).limit(1);
                          if (last && last.length > 0) {
                            setEmitData(prev => ({ ...prev, numero_manual: String(Number(last[0].numero) + 1) }));
                          } else {
                            setEmitData(prev => ({ ...prev, numero_manual: "1" }));
                          }
                        } catch { /* ignore */ }
                      })();
                    }} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:cursor-not-allowed disabled:bg-zinc-100 dark:disabled:bg-zinc-800/60">
                      {emitManual ? (
                        <option value="X">Comprobante X (sin IVA)</option>
                      ) : (<>
                      <optgroup label="Facturas">
                        <option value="FA">Factura A</option>
                        <option value="FB">Factura B</option>
                      </optgroup>
                      <optgroup label="Factura de Crédito Electrónica">
                        <option value="FCEA">FCE A (MiPyMEs)</option>
                        <option value="FCEB">FCE B (MiPyMEs)</option>
                      </optgroup>
                      <optgroup label="Notas de crédito">
                        <option value="NCA">NC A</option>
                        <option value="NCB">NC B</option>
                        <option value="NCEA">NCE A (MiPyMEs)</option>
                        <option value="NCEB">NCE B (MiPyMEs)</option>
                      </optgroup>
                      </>)}
                    </select>
                  </div>
                  <div className="col-span-7 relative">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                      <input
                        value={emitData.cliente_id
                          ? (emitData.cliente_id === "consumidor_final" ? "Consumidor Final" : clientes.find(c => c.id === emitData.cliente_id)?.razon_social || "")
                          : emitClienteSearch}
                        onChange={(e) => {
                          setEmitClienteSearch(e.target.value);
                          if (emitData.cliente_id) setEmitData(p => ({ ...p, cliente_id: "" }));
                        }}
                        onFocus={() => { if (emitData.cliente_id) { setEmitClienteSearch(""); setEmitData(p => ({ ...p, cliente_id: "" })); } }}
                        placeholder="Buscar cliente por nombre o CUIT..."
                        autoComplete="off"
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 pl-9 pr-8 py-2 text-sm dark:text-white"
                      />
                      {emitData.cliente_id && (
                        <button onClick={() => { setEmitData(p => ({ ...p, cliente_id: "" })); setEmitClienteSearch(""); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {!emitData.cliente_id && emitClienteSearch.trim() && (
                      <div className="mt-1 border rounded-lg dark:border-zinc-700 max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 shadow-lg absolute z-20 left-0 right-0">
                        {(!isFacturaA || emitData.tipo === "X") && (
                          <button onClick={() => { setEmitData(p => ({ ...p, cliente_id: "consumidor_final" })); setEmitClienteSearch(""); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white font-medium text-orange-600">
                            Consumidor Final
                          </button>
                        )}
                        {emitFilteredClientes.slice(0, 12).map(c => (
                          <button key={c.id} onClick={() => {
                            setEmitData(p => {
                              if (emitManual || !["FA", "FB", "FCEA", "FCEB"].includes(p.tipo)) return { ...p, cliente_id: c.id };
                              const nextA = ["RI", "MONOTRIBUTO", "MONOTRIBUTISTA"].includes((c.condicion_iva || "").toUpperCase());
                              const previousA = p.tipo.endsWith("A");
                              return { ...p, cliente_id: c.id, tipo: nextA ? "FA" : "FB", items: previousA === nextA ? p.items : p.items.map(it => ({ ...it, precio_unitario: Math.round((nextA ? it.precio_unitario / (1 + it.iva_porcentaje / 100) : it.precio_unitario * (1 + it.iva_porcentaje / 100)) * 100) / 100 })) };
                            });
                            setEmitClienteSearch("");
                          }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex justify-between">
                            <span>{c.razon_social}</span>
                            <span className="text-xs text-zinc-400">{c.cuit || "Sin CUIT"}</span>
                          </button>
                        ))}
                        {emitFilteredClientes.length === 0 && (
                          <p className="px-3 py-2 text-sm text-zinc-400">No se encontraron clientes</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">PV</label>
                    {emitManual ? (
                      <input type="number" min={0} value={emitData.punto_venta} onChange={async (e) => {
                        const newPv = Number(e.target.value);
                        setEmitData((p) => ({ ...p, punto_venta: newPv }));
                        try {
                          if (!sociedadActiva?.id) return;
                          const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, emitData.tipo).eq("punto_venta" as any, newPv).order("numero", { ascending: false }).limit(1);
                          setEmitData(prev => ({ ...prev, numero_manual: last && last.length > 0 ? String(Number(last[0].numero) + 1) : "1" }));
                        } catch { /* ignore */ }
                      }} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    ) : emisorData.ptoVtaOpciones && emisorData.ptoVtaOpciones.length > 1 ? (
                      <select
                        value={emitData.punto_venta}
                        onChange={async (e) => {
                          const newPv = Number(e.target.value);
                          setEmitData((p) => ({ ...p, punto_venta: newPv }));
                          // Fetch next number for this PV
                          if (!sociedadActiva?.id) return;
                          const { data: last } = await supabase.from("facturas").select("numero").eq("sociedad_id" as any, sociedadActiva.id).eq("tipo" as any, emitData.tipo).eq("punto_venta" as any, newPv).order("numero", { ascending: false }).limit(1);
                          const nextNum = last && last.length > 0 ? (last[0] as any).numero + 1 : 1;
                          setEmitData((p) => ({ ...p, punto_venta: newPv, numero_manual: String(nextNum) }));
                        }}
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white"
                      >
                        {emisorData.ptoVtaOpciones.map((pv) => (
                          <option key={pv} value={pv}>{String(pv).padStart(4, "0")}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-500 dark:text-zinc-400">
                        {String(emitData.punto_venta).padStart(4, "0")}
                      </div>
                    )}
                  </div>
                </div>

                {emitManual && (
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-4">
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                      <input type="number" min={1} value={emitData.numero_manual} onChange={(e) => setEmitData((p) => ({ ...p, numero_manual: e.target.value }))} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="col-span-8 flex items-end">
                      <p className="text-xs text-amber-600 dark:text-amber-400 pb-2">Esta factura no se autoriza con ARCA. No tendrá CAE.</p>
                    </div>
                  </div>
                )}

                {/* Moneda + Tipo de cambio */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-4">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Moneda factura</label>
                    <select value={emitData.moneda} onChange={(e) => setEmitData((p) => ({ ...p, moneda: e.target.value as "ARS" | "USD" }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <option value="ARS">ARS — Pesos</option>
                      <option value="USD">USD — Dolares</option>
                    </select>
                  </div>
                  {isUSD && (
                    <div className="col-span-8">
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cotizacion USD/ARS {emitManual ? "" : "*"}</label>
                      <input type="number" readOnly={!(emitManual || (canOverrideRate && rateOverride))} step="0.01" min={0} value={emitData.tipo_cambio || ""} onChange={(e) => { cotizRequest.current += 1; setCotizBnaLoading(false); setCotizBna(null); setEmitData((p) => ({ ...p, tipo_cambio: Number(e.target.value) })); }} placeholder={emitManual ? "Ej: 1450.00" : "Verificando BNA…"} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        {(emitManual || (canOverrideRate && rateOverride)) && <>
                        <span className="text-xs text-zinc-400">BNA:</span>
                        <button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                          {cotizBnaLoading ? "…" : "Divisas"}
                        </button>
                        <span className="text-xs text-zinc-300">·</span>
                        <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                          {cotizBnaLoading ? "…" : "Billetes"}
                        </button>
                        <input type="date" value={cotizFecha} onChange={e => { cotizRequest.current += 1; setCotizFecha(e.target.value); setCotizBnaLoading(false); setCotizBna(null); setCotizError(""); setEmitData(p => ({ ...p, tipo_cambio: 0 })); }} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
                        </>}
                        {!emitManual && !rateOverride && <span className="text-xs text-zinc-500">Automática: BNA divisa venta, día hábil anterior a la factura.</span>}
                        {!emitManual && canOverrideRate && <label className="text-xs"><input type="checkbox" checked={rateOverride} onChange={e => setRateOverride(e.target.checked)} /> Modificar cotización (Augusto)</label>}
                        {cotizBna && <span className="text-xs text-zinc-400">→ Venta {cotizBna.modalidad}: ${cotizBna.valor_venta.toLocaleString("es-AR")} ({cotizBna.fecha})</span>}
                      </div>
                      {cotizError && <p role="alert" className="mt-1 text-xs text-amber-700 dark:text-amber-400">{cotizError}</p>}
                    </div>
                  )}
                </div>

                {/* Fecha facturación + Condicion de venta + Fecha vencimiento */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha facturación</label>
                    <input type="date" value={emitData.fecha} min={emitManual ? minFecha : fiscalMinDate} max={todayAR()} disabled={!emitManual && !fiscalDates.ready}
                      onChange={(e) => setEmitData((p) => ({ ...p, fecha: e.target.value, fecha_vencimiento: calcFechaVencFC(p.condicion_venta, e.target.value) }))}
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                    {!emitManual && <div className="mt-1 text-xs text-zinc-500">{fiscalDates.error ? <><span className="text-red-600">{fiscalDates.error}</span> <button type="button" onClick={fiscalDates.retry} className="underline">Reintentar</button></> : !fiscalDates.ready ? "Consultando fechas habilitadas en ARCA…" : <>Primera fecha habilitada: {formatDate(fiscalMinDate)}. {emitData.fecha < fiscalMinDate && <span className="text-red-600">Cambiá la fecha seleccionada.</span>}</>}</div>}
                  </div>
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Condición de venta</label>
                    <select value={emitData.condicion_venta}
                      onChange={(e) => setEmitData((p) => ({ ...p, condicion_venta: e.target.value, fecha_vencimiento: calcFechaVencFC(e.target.value, p.fecha) }))}
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <option value="Contado">Contado</option>
                      <option value="Cta. Cte.">Cta. Cte.</option>
                      <option value="15 días">15 días</option>
                      <option value="30 días">30 días</option>
                      <option value="60 días">60 días</option>
                      <option value="90 días">90 días</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha vencimiento</label>
                    <input type="date" value={emitData.fecha_vencimiento} onChange={(e) => setEmitData((p) => ({ ...p, fecha_vencimiento: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                  </div>
                </div>

                {fceApplies && <div className="text-sm text-zinc-600 dark:text-zinc-300" role="status">
                  {fceCheck.error ? <><span className="text-red-600">{fceCheck.error}</span> <button type="button" onClick={fceCheck.retry} className="underline">Reintentar verificación FCE</button></>
                    : !emitData.cliente_id ? "Seleccioná un cliente para verificar el régimen FCE."
                    : !fceCheck.ready ? "Consultando encuadre FCE del cliente en ARCA…"
                    : !fceRateReady ? "Esperando cotización para determinar si corresponde FCE…"
                    : fceRequired ? `Corresponde FCE por consulta ARCA e importe. Mínimo: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.`
                    : `Corresponde factura común según la consulta y el importe.${fceCheck.obligado ? ` Mínimo FCE: ${formatCurrency(fceCheck.montoDesde || 0, "ARS")}.` : ""}`}
                </div>}
                {!emitManual && ["FCEA", "FCEB"].includes(emitData.tipo) && (
                  <div className="rounded-lg border border-blue-200 p-3 space-y-3 dark:border-blue-900">
                    <p className="text-sm dark:text-zinc-200">Datos obligatorios de la FCE. La CBU debe pertenecer al emisor de esta sociedad. El vencimiento es obligatorio y no puede ser anterior a hoy ni a la emisión.</p>
                    <label className="block text-sm dark:text-zinc-300">CBU del emisor *
                      <input inputMode="numeric" maxLength={22} value={emitData.fce_cbu} onChange={e => setEmitData(p => ({ ...p, fce_cbu: e.target.value.replace(/\D/g, "") }))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
                    </label>
                    <label className="block text-sm dark:text-zinc-300">Transmisión de la FCE *
                      <select value={emitData.fce_transmision} onChange={e => setEmitData(p => ({ ...p, fce_transmision: e.target.value }))} className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                        <option value="">Seleccioná una modalidad</option>
                        <option value="SCA">SCA — Sistema de Circulación Abierta</option>
                        <option value="ADC">ADC — Agente de Depósito Colectivo</option>
                      </select>
                    </label>
                  </div>
                )}
                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium dark:text-zinc-300">Items *</label>
                    <button onClick={addItem} className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium">
                      <Plus className="h-3 w-3" /> Agregar item
                    </button>
                  </div>
                  <div className="space-y-3">
                    {emitData.items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaA ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripcion</label>}
                          <input
                            value={item.descripcion} onChange={(e) => updateItem(idx, "descripcion", e.target.value)}
                            placeholder="Ej: Valvula esferica 1/2"
                            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cantidad</label>}
                          <input type="number" min={1} value={item.cantidad} onChange={(e) => updateItem(idx, "cantidad", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaA ? "Neto unit." : "Precio"}</label>}
                          <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => updateItem(idx, "precio_unitario", Number(e.target.value))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        {isFacturaA && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select value={item.iva_porcentaje} onChange={(e) => updateItem(idx, "iva_porcentaje", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {emitData.items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals preview */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaA ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(emitTotals.neto, isUSD ? "USD" : "ARS")}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(emitTotals.iva, isUSD ? "USD" : "ARS")}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>{emitManual || emitData.tipo === "X" ? "Total (sin IVA)" : "Total"}</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                    </div>
                  )}
                  {isUSD && tc > 0 && (
                    <div className="text-xs text-zinc-400 text-right">Cotizacion ARCA: 1 USD = {tc.toLocaleString("es-AR")} ARS</div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  {emitManual ? (
                    <button onClick={handleEmitManual} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-zinc-700 text-white hover:bg-zinc-800 transition-colors">
                      <FileCheck className="h-4 w-4" /> Guardar manual
                    </button>
                  ) : (
                    <button onClick={handleEmit} disabled={fiscalDateBlocked || fceBlocked || (isUSD && (cotizBnaLoading || (!(canOverrideRate && rateOverride) && !cotizBna) || tc <= 0))} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50">
                      <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                    </button>
                  )}
                </div>
              </div>
            )}

            {emitStep === "emitting" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">{emitManual ? "Guardando factura..." : "Autorizando con ARCA..."}</p>
                {!emitManual && <p className="text-xs text-zinc-400">Esto puede tomar unos segundos</p>}
              </div>
            )}

            {emitStep === "success" && emitResult && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">{emitResult.manual ? "Factura guardada" : "Factura emitida exitosamente"}</h3>
                  {emitResult.warning && <p className="text-sm text-amber-700 dark:text-amber-400">{emitResult.warning}</p>}
                  {emitResult.warnings?.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">Advertencias ARCA: {emitResult.warnings.map((w: any) => typeof w === "string" ? w : (w.Msg || w.message || JSON.stringify(w))).join("; ")}</p>}
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Comprobante</span><span className="font-mono font-bold">{emitResult.comprobante}</span></div>
                  {emitResult.manual ? (
                    <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="text-zinc-400 italic">Sin CAE (manual)</span></div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="font-mono">{emitResult.cae}</span></div>
                      <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Vto CAE</span><span>{emitResult.cae_vencimiento ? formatDate(emitResult.cae_vencimiento) : "\u2014"}</span></div>
                    </>
                  )}
                  <div className="flex justify-between border-t border-emerald-200 dark:border-emerald-700 pt-2"><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Total</span><span className="font-mono font-bold">{formatCurrency(emitResult.total, emitData.moneda)}</span></div>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}

            {emitStep === "error" && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                    <XCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">Error al emitir</h3>
                  <p className="text-sm text-red-600 text-center max-w-md">{emitError}</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setEmitStep("form")} className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">Intentar de nuevo</button>
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail Side Panel ─────────────────────────────────────────── */}
      {detailFactura && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setDetailFactura(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-lg"
          }>
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 py-4 border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700">
              <div>
                <h2 className="font-mono text-lg font-bold dark:text-white">
                  {formatComprobante(detailFactura.tipo, detailFactura.punto_venta, detailFactura.numero)}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={estadoConfig[detailFactura.estado]?.variant || "info"}>
                    {estadoConfig[detailFactura.estado]?.label || detailFactura.estado}
                  </Badge>
                  <span className="text-xs text-zinc-400">{formatDate(detailFactura.fecha)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEmailFactura(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Enviar por correo">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button onClick={() => handleCopy(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Copiar resumen">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
                <button onClick={() => handlePrintFactura(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                <button onClick={async () => {
                  const html = buildFacturaHTML(detailFactura);
                  if (html) await openPDFWindow(html, undefined, true);
                }} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Ver factura online">
                  <Eye className="h-3.5 w-3.5" /> Ver
                </button>
                <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setDetailFactura(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">
              {["FCEA", "FCEB"].includes(detailFactura.tipo) && <div className="rounded-lg border border-blue-200 p-3 space-y-2 dark:border-blue-900">
                <h4 className="text-sm font-semibold dark:text-zinc-200">Registro FCE de ARCA</h4>
                <p className="text-xs text-zinc-500">Consulta de solo lectura. Este estado no equivale al estado de cobro del CRM.</p>
                <button type="button" onClick={consultarRegistroFce} disabled={fceRegistry.key === `${sociedadActiva?.id}:${detailFactura.id}` && fceRegistry.loading} className="text-sm text-blue-600 underline disabled:opacity-50">Consultar / actualizar estado en ARCA</button>
                {fceRegistry.key === `${sociedadActiva?.id}:${detailFactura.id}` && <div className="text-sm dark:text-zinc-300" role="status">
                  {fceRegistry.loading ? "Consultando…" : fceRegistry.error ? <p className="text-red-600">{fceRegistry.error}</p> : <>
                    <p>Estado informado: {fceRegistry.estado}</p>
                    <p className="text-xs text-zinc-500">Consultado: {fceRegistry.checkedAt}</p>
                    {(fceRegistry.historial || []).map((event, index) => <p key={index} className="text-xs">{event.fechaHora || "Sin fecha"} — {event.estado}</p>)}
                  </>}
                </div>}
              </div>}
              {/* Cliente */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Cliente</h4>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{detailFactura.clientes?.razon_social}</p>
                {detailFactura.clientes?.cuit && <p className="text-xs text-zinc-500 mt-0.5">CUIT: {detailFactura.clientes.cuit}</p>}
                {detailFactura.clientes?.condicion_iva && <p className="text-xs text-zinc-400">{detailFactura.clientes.condicion_iva}</p>}
              </div>

              {/* OC Cliente */}
              {detailFactura.oc_cliente && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">OC Cliente</h4>
                  <p className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{detailFactura.oc_cliente}</p>
                  <p className="mt-1 text-xs text-zinc-500">Fecha de la OC: {detailFactura.oc_cliente_fecha ? formatDate(detailFactura.oc_cliente_fecha) : "Sin informar"}</p>
                </div>
              )}

              {/* CAE */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">CAE</h4>
                {detailFactura.cae ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{detailFactura.cae}</span>
                    </div>
                    {detailFactura.cae_vencimiento && (
                      <p className="text-xs text-emerald-600/70 mt-1 ml-6">Vencimiento: {formatDate(detailFactura.cae_vencimiento)}</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">Sin CAE — factura no autorizada por ARCA</div>
                )}
              </div>

              {/* Items */}
              {detailItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Items</h4>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                          <th className="text-left px-3 py-2 font-medium text-zinc-500">Descripcion</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">Cant.</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">P.Unit.</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((it, idx) => (
                          <tr key={idx} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{it.descripcion}</td>
                            <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{it.cantidad}</td>
                            <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(it.precio_unitario), detailFactura.moneda as "USD" | "ARS")}</td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">{formatCurrency(Number(it.subtotal), detailFactura.moneda as "USD" | "ARS")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Importes */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Importes</h4>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  {detailFactura.tipo !== "X" && (<>
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="text-zinc-500">Neto gravado</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.subtotal), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-zinc-100 dark:border-zinc-800">
                      <span className="text-zinc-500">IVA</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.iva), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  </>)}
                  <div className="flex items-center justify-between px-4 py-3 text-sm border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <span className="text-zinc-700 dark:text-zinc-300">{detailFactura.tipo === "X" ? "Total (sin IVA)" : "Total"}</span>
                    <span className="font-mono text-base">{formatCurrency(Number(detailFactura.total), detailFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {detailFactura.moneda === "USD" && detailFactura.tipo_cambio && (
                    <div className="flex items-center justify-between px-4 py-2 text-xs border-t border-zinc-100 dark:border-zinc-800 text-zinc-400">
                      <span>Operacion en USD — TC: {Number(detailFactura.tipo_cambio).toLocaleString("es-AR")}</span>
                      <span className="font-mono">USD {(Number(detailFactura.total) / Number(detailFactura.tipo_cambio)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notas de crédito relacionadas */}
              {detailNCs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Notas de crédito</h4>
                  <div className="space-y-1.5">
                    {detailNCs.map((nc) => (
                      <div key={nc.id} className="flex items-center justify-between rounded-lg border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs">
                        <div>
                          <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">{formatComprobante(nc.tipo, nc.punto_venta, nc.numero)}</span>
                          <span className="text-zinc-400 ml-2">{formatDate(nc.fecha)}</span>
                          {nc.cae && <span className="text-emerald-600 dark:text-emerald-400 ml-2">CAE ✓</span>}
                        </div>
                        <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">{formatCurrency(Number(nc.total), detailFactura.moneda as "USD" | "ARS")}</span>
                      </div>
                    ))}
                  </div>
                  {Number(detailFactura.total_acreditado) > 0 && (
                    <div className="mt-2 flex justify-between text-xs text-amber-700 dark:text-amber-400 font-medium px-1">
                      <span>Total acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.total_acreditado), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Acciones */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Acciones</h4>
                <div className="space-y-2">
                  {detailFactura.estado !== "pagada" && detailFactura.estado !== "anulada" && (
                    <>
                      <button onClick={() => openCobroModal(detailFactura)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-emerald-950/30">
                        <DollarSign className="h-4 w-4" /> Registrar cobro
                      </button>
                      {["FA", "FB", "FCEA", "FCEB"].includes(detailFactura.tipo) && (
                        <button onClick={() => openNcModal(detailFactura)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-950/30">
                          <FileText className="h-4 w-4" /> Emitir Nota de Crédito
                        </button>
                      )}
                      {!detailFactura.cae && (
                        <button onClick={() => handleAnular(detailFactura.id)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/30">
                          <XCircle className="h-4 w-4" /> Anular comprobante
                        </button>
                      )}
                    </>
                  )}
                  {detailFactura.estado === "anulada" && !detailFactura.cae && (
                    <>
                      <button onClick={() => handleRevertirAnulacion(detailFactura.id)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-emerald-950/30">
                        <CheckCircle2 className="h-4 w-4" /> Revertir anulación
                      </button>
                      <button onClick={() => handleEliminar(detailFactura.id)} className="flex w-full items-center gap-3 rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950/30">
                        <Trash2 className="h-4 w-4" /> Eliminar factura manual
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Cobro Modal ──────────────────────────────────────────── */}
      {fxCobro && sociedadActiva?.id && <FxSettlementDialog
        kind="cobro" counterpartyId={fxCobro.clienteId} sociedadId={sociedadActiva.id}
        documents={fxCobro.documents}
        onClose={()=>setFxCobro(null)}
        onSuccess={()=>{setFxCobro(null);setCobroModalId(null);setCmOpen(false);setCmLiquidacionOpen(false);fetchData();}}
      />}
      {cobroModalId && (() => {
        const f = facturas.find(ff => ff.id === cobroModalId);
        if (!f) return null;
        const saldo = Number(f.total) - Number(f.total_acreditado || 0) - cobroPrevios;
        const totalLineas = cobroLineas.reduce((s, l) => s + Number(l.monto || 0), 0);
        const lineasValidas = cobroLineas.some(l => Number(l.monto) > 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
                <div>
                  <h3 className="font-semibold dark:text-white">Registrar cobro</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {formatComprobante(f.tipo, f.punto_venta, f.numero)} — Total: {formatCurrency(Number(f.total), f.moneda as "ARS" | "USD")}
                    {Number(f.iva) > 0 && <span className="ml-1 text-zinc-400">(Neto: {formatCurrency(Number(f.subtotal), f.moneda as "ARS" | "USD")} + IVA: {formatCurrency(Number(f.iva), f.moneda as "ARS" | "USD")})</span>}
                  </p>
                  {cobroPreviosLoading ? (
                    <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Calculando saldo...</p>
                  ) : (
                    <p className="text-xs font-medium mt-0.5" style={{ color: (saldo - totalLineas) > 0 ? "#f59e0b" : "#10b981" }}>
                      {cobroPrevios > 0 && `Cobrado: ${formatCurrency(cobroPrevios, f.moneda as "ARS" | "USD")} — `}
                      Saldo pendiente: {formatCurrency(Math.max(0, saldo - totalLineas), f.moneda as "ARS" | "USD")}
                    </p>
                  )}
                </div>
                <button onClick={() => setCobroModalId(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Fecha comun */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha *</label>
                  <input type="date" value={cobroFecha} onChange={(e) => setCobroFecha(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                </div>

                {/* Tipo de cambio (USD) */}
                {f.moneda === "USD" && (() => {
                  const cotizNum = parseFloat(cobroCotiz) || 0;
                  return (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
                      <label className="block text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Tipo de cambio (USD → ARS)</label>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex gap-1">
                          <button type="button" onClick={() => fetchCobroCotizBNA("divisas")} disabled={cobroCotizFetching}
                            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${cobroCotizModalidad === "divisas" && cotizNum > 0 ? "bg-orange-500 text-white" : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600"}`}>
                            Divisas
                          </button>
                          <button type="button" onClick={() => fetchCobroCotizBNA("billetes")} disabled={cobroCotizFetching}
                            className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors ${cobroCotizModalidad === "billetes" && cotizNum > 0 ? "bg-orange-500 text-white" : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600"}`}>
                            Billetes
                          </button>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase text-zinc-400 mb-0.5">Cotización</label>
                          <input type="number" step="0.01" min="0" placeholder="Ej: 1250" value={cobroCotiz}
                            onChange={e => setCobroCotiz(e.target.value)}
                            className="w-32 px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono dark:text-white" />
                        </div>
                        {cotizNum > 0 && (
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            Saldo: {formatCurrency(saldo, "USD")} × {cotizNum.toFixed(2)} = <span className="font-bold text-zinc-900 dark:text-white">{formatCurrency(saldo * cotizNum, "ARS")}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Lineas de pago */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Medios de pago {f.moneda === "USD" && parseFloat(cobroCotiz) > 0 && <span className="text-xs text-zinc-400 font-normal">(en ARS)</span>}</label>
                    <div className="flex items-center gap-3">
                      {Number(f.iva) > 0 && cobroLineas.length === 1 && (
                        <button onClick={handleSepararImpuestos}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                          <Scissors className="h-3 w-3" /> Separar impuestos
                        </button>
                      )}
                      <button onClick={() => setCobroLineas(prev => [...prev, { tipo: "transferencia", monto: "", descripcion: "" }])}
                        className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                        <Plus className="h-3 w-3" /> Agregar medio
                      </button>
                      <input ref={cobroFileRef} type="file" accept="image/*,.pdf" multiple className="hidden"
                        onChange={(e) => { const fl = e.target.files; if (fl && fl.length > 0) handleParseComprobante(fl); }} />
                      <button onClick={() => cobroFileRef.current?.click()} disabled={cobroParsing}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50">
                        {cobroParsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} {cobroParsing ? "Leyendo..." : "Leer comprobantes"}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {cobroLineas.map((linea, idx) => (
                      <div key={idx} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select value={linea.tipo} onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, tipo: e.target.value as any } : l))}
                            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm dark:text-white">
                            <option value="transferencia">Transferencia</option>
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="cheque_recibido">Cheque</option>
                            <option value="echeq">Echeq</option>
                            <option value="retencion_iibb">Ret. IIBB</option>
                            <option value="retencion_ganancias">Ret. Ganancias</option>
                            <option value="retencion_iva">Ret. IVA</option>
                            <option value="cobro">Otro</option>
                          </select>
                          <input type="number" step="0.01" placeholder="Monto" value={linea.monto}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setCobroLineas(prev => {
                                const updated = prev.map((l, i) => i === idx ? { ...l, monto: newVal } : l);
                                // Auto-ajustar transferencia/efectivo si se modificó una retención
                                const isRetencion = updated[idx]?.tipo.startsWith("retencion_");
                                const firstPayIdx = updated.findIndex(l => l.tipo === "transferencia" || l.tipo === "efectivo" || l.tipo === "cheque_recibido" || l.tipo === "echeq");
                                if (isRetencion && firstPayIdx >= 0 && firstPayIdx !== idx) {
                                  const totalRet = updated.reduce((s, l, i) => i !== firstPayIdx ? s + Number(l.monto || 0) : s, 0);
                                  updated[firstPayIdx] = { ...updated[firstPayIdx], monto: String(Math.max(0, Math.round((saldo - totalRet) * 100) / 100)) };
                                }
                                return updated;
                              });
                            }}
                            className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono dark:text-white" />
                          {cobroLineas.length > 1 && (
                            <button onClick={() => setCobroLineas(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <input type="text" placeholder="Descripcion (opcional)" value={linea.descripcion}
                          onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, descripcion: e.target.value } : l))}
                          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs dark:text-white" />
                        {(linea.tipo === "cheque_recibido" || linea.tipo === "echeq") && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-zinc-400">N° Cheque</label>
                              <input type="text" placeholder="00000000" value={linea.cheque_numero || ""}
                                onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, cheque_numero: e.target.value } : l))}
                                className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs font-mono dark:text-white" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400">Banco</label>
                              <input type="text" placeholder="Ej: Credicoop" value={linea.cheque_banco || ""}
                                onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, cheque_banco: e.target.value } : l))}
                                className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs dark:text-white" />
                            </div>
                            <div>
                              <label className="text-[10px] text-zinc-400">Fecha cheque</label>
                              <input type="date" value={linea.cheque_fecha || ""}
                                onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, cheque_fecha: e.target.value } : l))}
                                className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs dark:text-white" />
                            </div>
                            {linea.tipo === "echeq" && (
                              <div>
                                <label className="text-[10px] text-zinc-400">ID Echeq</label>
                                <input type="text" placeholder="ID digital" value={linea.cheque_id_digital || ""}
                                  onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, cheque_id_digital: e.target.value } : l))}
                                  className="w-full rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs font-mono dark:text-white" />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totales */}
                {totalLineas > 0 && (() => {
                  const cotizNum = parseFloat(cobroCotiz) || 0;
                  const isUSDConv = f.moneda === "USD" && cotizNum > 0;
                  const saldoDisplay = isUSDConv ? saldo * cotizNum : saldo;
                  const monDisplay = isUSDConv ? "ARS" as const : f.moneda as "ARS" | "USD";
                  return (
                  <div className="space-y-1 px-1">
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-zinc-500">Total a registrar:</span>
                      <span className="font-mono dark:text-white">{formatCurrency(totalLineas, monDisplay)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Saldo restante:</span>
                      <span className={`font-mono font-medium ${saldoDisplay - totalLineas <= 0 ? "text-emerald-600" : "text-amber-600"}`}>
                        {formatCurrency(Math.max(0, saldoDisplay - totalLineas), monDisplay)}
                      </span>
                    </div>
                  </div>
                  );
                })()}

                {(() => {
                  const cotizNum = parseFloat(cobroCotiz) || 0;
                  const saldoComp = f.moneda === "USD" && cotizNum > 0 ? saldo * cotizNum : saldo;
                  const monDisp = (f.moneda === "USD" && cotizNum > 0 ? "ARS" : f.moneda) as "ARS" | "USD";
                  if (totalLineas > saldoComp && saldoComp > 0) return (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">El monto excede el saldo pendiente por {formatCurrency(totalLineas - saldoComp, monDisp)}</p>
                    </div>
                  );
                  if (totalLineas >= saldoComp && saldoComp > 0) return (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">Cubre el saldo completo — la factura se marcara como pagada</p>
                    </div>
                  );
                  return null;
                })()}
              </div>
              <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
                <button onClick={() => setCobroModalId(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                <button onClick={handleRegistrarCobro} disabled={cobroSaving || !lineasValidas}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {cobroSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Registrar cobro{cobroLineas.length > 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── NC Modal ─────────────────────────────────────────────── */}
      {/* ── Cobro Masivo Modal — Paso 1: selección de facturas ──── */}
      {cmOpen && !cmLiquidacionOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setCmOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-xl dark:bg-zinc-900 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold dark:text-white">Cobro masivo — Selección de facturas</h2>
                <button onClick={() => setCmOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
              </div>

              {/* Selector de cliente */}
              <div className="mb-4">
                <label className="text-xs font-medium text-zinc-500 mb-1 block">Cliente</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input
                    value={cmClienteId ? cmClientes.find(c => c.id === cmClienteId)?.razon_social || "" : cmClienteSearch}
                    onChange={(e) => { setCmClienteSearch(e.target.value); if (cmClienteId) { setCmClienteId(""); setCmFCs([]); } }}
                    placeholder="Buscar cliente por nombre o CUIT..."
                    className="w-full rounded-lg border border-zinc-200 pl-9 pr-8 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  />
                  {cmClienteId && (
                    <button onClick={() => { setCmClienteId(""); setCmFCs([]); setCmClienteSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {!cmClienteId && cmClienteSearch.trim() && cmFilteredClientes.length > 0 && (
                  <div className="mt-1 border rounded-lg dark:border-zinc-700 max-h-40 overflow-y-auto bg-white dark:bg-zinc-800 shadow-lg">
                    {cmFilteredClientes.slice(0, 10).map(c => (
                      <button key={c.id} onClick={() => { setCmClienteSearch(""); cmSelectCliente(c.id); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex justify-between">
                        <span>{c.razon_social}</span>
                        <span className="text-xs text-zinc-400">{c.cuit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {cmClienteId && (
                <>
                  <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Facturas pendientes</h3>
                  {cmLoadingFCs ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /></div>
                  ) : (
                    <div className="border rounded-lg dark:border-zinc-700 overflow-hidden mb-4">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 dark:bg-zinc-800">
                          <tr>
                            <th className="px-3 py-2 text-left w-8">
                              <input type="checkbox" checked={cmFCs.length > 0 && cmFCs.every(f => f.selected)}
                                onChange={(e) => setCmFCs(prev => prev.map(f => ({ ...f, selected: e.target.checked })))} />
                            </th>
                            <th className="px-3 py-2 text-left">Comprobante</th>
                            <th className="px-3 py-2 text-left">Fecha</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-right">Saldo pend.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cmFCs.map((fc, idx) => (
                            <tr key={fc.id} className={`border-t dark:border-zinc-700 ${fc.selected ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                              <td className="px-3 py-2">
                                <input type="checkbox" checked={fc.selected} onChange={(e) => {
                                  const newFCs = [...cmFCs]; newFCs[idx] = { ...newFCs[idx], selected: e.target.checked };
                                  setCmFCs(newFCs);
                                }} />
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{formatComprobante(fc.tipo, fc.punto_venta, fc.numero)}</td>
                              <td className="px-3 py-2">{formatDate(fc.fecha)}</td>
                              <td className="px-3 py-2 text-right font-mono">{formatCurrency(fc.total, fc.moneda as "ARS" | "USD")}</td>
                              <td className="px-3 py-2 text-right font-mono text-red-600 font-semibold">{formatCurrency(fc.saldo, fc.moneda as "ARS" | "USD")}</td>
                            </tr>
                          ))}
                          {cmFCs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-400">No hay facturas pendientes</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t pt-4 dark:border-zinc-700">
                    <div className="text-sm text-zinc-500">
                      {cmFCs.filter(f => f.selected).length} factura{cmFCs.filter(f => f.selected).length !== 1 ? "s" : ""} seleccionada{cmFCs.filter(f => f.selected).length !== 1 ? "s" : ""}
                      {" — "}Saldo: <span className="font-mono font-bold text-emerald-600">{formatCurrency(cmFCs.filter(f => f.selected).reduce((s, f) => s + f.saldo, 0))}</span>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setCmOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
                      <button onClick={cmOpenLiquidacion} disabled={cmFCs.filter(f => f.selected).length === 0}
                        className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                        Continuar a liquidación
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {/* ── Cobro Masivo — Paso 2: Liquidación ──────────────────── */}
      {cmLiquidacionOpen && (
        <CobroMasivoLiquidacion
          facturas={cmGetLiquidacionFacturas()}
          clienteId={cmClienteId}
          clienteNombre={cmClientes.find(c => c.id === cmClienteId)?.razon_social || ""}
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          moneda={(cmFCs.find(f => f.selected)?.moneda as "ARS" | "USD") || "ARS"}
          onClose={() => setCmLiquidacionOpen(false)}
          onSuccess={() => { setCmLiquidacionOpen(false); setCmOpen(false); fetchData(); }}
        />
      )}

      {/* ── NC Modal ─────────────────────────────────────────────── */}
      {ncOpen && ncFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Nota de Crédito</h2>
                <p className="text-sm text-zinc-400">
                  Para {formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)} — {ncFactura.clientes?.razon_social}
                </p>
              </div>
              <button onClick={() => setNcOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {ncStep === "form" && (
              <div className="p-6 space-y-5">
                {ncError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{ncError}</div>}

                {/* Referencia a la factura original */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-zinc-500">Comprobante original</span>
                    <span className="font-mono font-semibold">{formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total original</span>
                    <span className="font-mono">{formatCurrency(Number(ncFactura.total), ncFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {Number(ncFactura.total_acreditado) > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400 mt-1">
                      <span>Ya acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(ncFactura.total_acreditado), ncFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                {/* Toggle ARCA / Manual */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <button
                      onClick={() => setNcManual(false)}
                      disabled={arcaStatus !== null && arcaStatus.certOk === false}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!ncManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                    </button>
                    <button
                      onClick={() => setNcManual(true)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${ncManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> ARCA no configurado — solo modo manual disponible.
                    </p>
                  )}
                </div>

                {/* Número manual */}
                {ncManual && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                      <input type="number" min={1} value={ncNumero} onChange={(e) => setNcNumero(e.target.value)} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="flex items-end pb-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">Sin CAE. Ajustá el número al talonario.</p>
                    </div>
                  </div>
                )}

                {/* Items NC — editables para NC parcial */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium dark:text-zinc-300">
                      Items a acreditar <span className="text-xs font-normal text-zinc-400">(editá para NC parcial)</span>
                    </label>
                    <button
                      onClick={() => setNcItems(p => [...p, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  <div className="space-y-2">
                    {ncItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaANc ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripción</label>}
                          <input value={item.descripcion} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))} placeholder="Descripción" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cant.</label>}
                          <input type="number" min={0} step="0.01" value={item.cantidad} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaANc ? "Neto unit." : "Precio"}</label>}
                          <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) } : it))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        {isFacturaANc && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select value={item.iva_porcentaje} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, iva_porcentaje: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {ncItems.length > 1 && (
                            <button onClick={() => setNcItems(p => p.filter((_, i) => i !== idx))} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaANc ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(ncTotals.neto, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(ncTotals.iva, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setNcOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  <button
                    onClick={handleCreateNC}
                    disabled={ncSaving || ncTotals.total <= 0}
                    className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 ${ncManual ? "bg-zinc-700 hover:bg-zinc-800" : "bg-orange-500 hover:bg-orange-600"}`}
                  >
                    {ncManual ? <FileCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {ncManual ? "Guardar NC manual" : "Emitir NC con ARCA"}
                  </button>
                </div>
              </div>
            )}

            {ncStep === "saving" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">{ncManual ? "Guardando nota de crédito..." : "Autorizando NC con ARCA..."}</p>
              </div>
            )}

            {ncStep === "success" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Nota de Crédito emitida</h3>
                <p className="text-sm font-mono text-emerald-700 dark:text-emerald-400">{ncResult}</p>
                <p className="text-xs text-zinc-400">Total acreditado: {formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</p>
                <button onClick={() => setNcOpen(false)} className="mt-2 px-6 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Cerrar</button>
              </div>
            )}

            {ncStep === "error" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Error al emitir NC</h3>
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{ncError}</p>
                <button onClick={() => setNcStep("form")} className="px-6 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">Volver</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email compose modal */}
      <EmailComposeModal
        open={emailModal.open}
        onClose={() => setEmailModal(prev => ({ ...prev, open: false }))}
        documentType="factura"
        sociedadId={sociedadActiva?.id}
        suggestedEmails={emailModal.suggestedEmails}
        generatePdf={async () => {
          const f = facturas.find(ff => ff.id === emailModal.facturaId);
          if (!f || !sociedadActiva) throw new Error("Factura no encontrada");
          let pdfItems = detailItems;
          if (pdfItems.length === 0) {
            const { data } = await supabase.from("factura_items")
              .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
              .eq("factura_id", f.id).order("orden");
            pdfItems = (data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }));
          }
          const soc = getSociedadPDF(sociedadActiva);
          const cli = f.clientes;
          const html = generateFacturaPDF({
            tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero,
            fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento,
            nota_interna: f.nota_interna,
            condicion_venta: f.condicion_venta, moneda: f.moneda as "ARS" | "USD",
            tipo_cambio: f.tipo_cambio, cotizacion_modalidad: f.cotizacion_modalidad || (f as any).presupuestos?.cotizacion_modalidad || null, subtotal: Number(f.subtotal), iva: Number(f.iva), total: Number(f.total),
            cae: f.cae, cae_vencimiento: f.cae_vencimiento, oc_cliente: f.oc_cliente,
            cliente: cli ? {
              razon_social: cli.razon_social, cuit: cli.cuit, condicion_iva: cli.condicion_iva,
              direccion: cli.direccion, localidad: cli.localidad, provincia: cli.provincia,
              email: cli.email, telefono: cli.telefono,
            } : null,
            items: pdfItems.map(it => ({
              descripcion: it.descripcion, cantidad: it.cantidad,
              precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje,
              subtotal: Number(it.subtotal),
            })),
          }, emisorData, soc);
          return htmlToPdfBase64(html);
        }}
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        onSuccess={async () => {
          const sentAt = new Date().toISOString();
          const facturaId = emailModal.facturaId;
          const { error } = await (supabase as any)
            .from("facturas")
            .update({ email_enviado_at: sentAt, email_enviado_a: emailModal.to || null })
            .eq("id", facturaId);
          if (error) {
            alert(`El email se envió, pero no se pudo guardar la marca de envío: ${error.message}`);
            return;
          }
          const sentTo = emailModal.to || null;
          setFacturas((prev) => prev.map((factura) =>
            factura.id === facturaId ? { ...factura, email_enviado_at: sentAt, email_enviado_a: sentTo } : factura
          ));
          setDetailFactura((prev) =>
            prev?.id === facturaId ? { ...prev, email_enviado_at: sentAt, email_enviado_a: sentTo } : prev
          );
        }}
        onMarkSent={async () => {
          const sentAt = new Date().toISOString();
          const facturaId = emailModal.facturaId;
          const { error } = await (supabase as any)
            .from("facturas")
            .update({ email_enviado_at: sentAt, email_enviado_a: "enviada por fuera" })
            .eq("id", facturaId);
          if (error) return;
          setFacturas((prev) => prev.map((factura) =>
            factura.id === facturaId ? { ...factura, email_enviado_at: sentAt, email_enviado_a: "enviada por fuera" } : factura
          ));
          setDetailFactura((prev) =>
            prev?.id === facturaId ? { ...prev, email_enviado_at: sentAt, email_enviado_a: "enviada por fuera" } : prev
          );
        }}
      />
    </>
  );
}
