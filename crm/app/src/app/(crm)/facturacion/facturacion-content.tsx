"use client";

import { useToast } from "@/components/ui/toast";

import { BotonDejarRevisar } from "@/components/dejar-revisar";
import { AvisoBCRA } from "@/components/clientes/bcra-card";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate, formatDateTime, todayAR } from "@/lib/utils";
import { textoEnvioCorto } from "@/lib/envio-factura-texto";
import { generateFacturaPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64, documentFilename } from "@/lib/pdf-templates";
import { Autocompletar } from "@/components/ui/autocompletar";
import CobroMasivoLiquidacion, { type LiquidacionFactura } from "@/components/cobro-masivo-liquidacion";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";
import { EmailComposeModal, type EmailDocumentType } from "@/components/email-compose-modal";
import { useUser } from "@/lib/auth-context";
import { useFiscalDateLimits } from "@/lib/use-fiscal-date-limits";
import { beginInvoiceIntent, postInvoiceIntent } from "@/lib/invoice-intent";
import { useArcaStatus } from "@/lib/use-arca-status";
import { EmitirFacturaModal } from "@/components/facturacion/emitir-factura-modal";
import { leyendaCotizacion, modalidadFactura } from "@/lib/factura-moneda";
import { parseDecimalInput, toDecimalInput } from "@/lib/decimal-input";
import { buildOrdenPagoPlan, comprobanteKey, type OpParsed } from "@/lib/orden-pago-plan";
import { fechaCobroSugerida, avisoFechaCobroFutura } from "@/lib/fecha-cobro";
import { estadoVisibleFactura } from "@/lib/estado-factura-venta";
import { creditNoteTotals, creditNoteTypeForInvoice, freeAmountCreditItem, isInvoiceA, type SalesCreditNoteMode } from "@/lib/sales-credit-note";
import { supabase } from "@/lib/supabase/client";
import { precioUnitarioParaFactura } from "@/lib/precio-factura";
import { precioNetoItemPresupuesto } from "@/lib/factura-condicion";
import { traerTodo } from "@/lib/paginar";
import { esNotaCredito, elegirFacturaDeOrdenPago } from "@/lib/ventas-documentos";
import { facturadoMesNeto } from "@/lib/facturado-mes";
import { traerDatosSaldoClientes, calcularSaldosClientes, cobradoPorFactura as cobradoPorFacturaVenta, saldoClienteEn, type SaldoCliente } from "@/lib/saldo-clientes";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import {
  Receipt, DollarSign, FileCheck, AlertTriangle, Loader2, XCircle,
  X, Printer, CheckCircle2, Clock, Ban, Copy, Download, Check,
  ShieldCheck, ClipboardCopy, Plus, Minus, Mail, MailCheck, FileText, Search, Scissors,
  Maximize2, Minimize2, Pencil, Trash2, Upload, Sparkles, Eye, CheckCheck, MailX,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "orange" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pendiente: { label: "Pendiente", variant: "orange" },
  parcial: { label: "Cobro parcial", variant: "warning" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
  cheque_rechazado: { label: "Cheque rechazado", variant: "danger" },
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
  observaciones?: string | null;
  nota_interna?: string | null;
  factura_origen_id?: string | null;
  total_acreditado?: number | null;
  modalidad_emision?: string | null;
  recibida_cliente?: boolean;
  email_enviado_at?: string | null;
  email_enviado_a?: string | null;
  email_resend_id?: string | null;
  email_estado?: "sent" | "delivered" | "bounced" | "complained" | "delivery_delayed" | null;
  clientes: { razon_social: string; cuit: string; condicion_iva?: string; email?: string; email_facturacion?: string; telefono?: string; direccion?: string; localidad?: string; provincia?: string; dias_cuenta_corriente?: number | null; limite_credito?: number | null; saldo_cuenta_corriente?: number | null } | null;
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
  limite_credito?: number | null;
  saldo_cuenta_corriente?: number | null;
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

/**
 * Buscador de facturas: coincide por cliente, CUIT, número de factura,
 * presupuesto (PR) u orden de compra del cliente.
 * Ej.: "corteva", "FA 0015-00000054", "54", "PR-2026-1231", "1231", "4300506128".
 */
/** Importe escrito por el usuario ("1.241.525,27", "1241525.27"…); inválido o vacío = 0. */
function montoNum(v: string | number | null | undefined): number {
  const n = parseDecimalInput(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

function facturaCoincideBusqueda(
  f: { tipo: string; punto_venta: number; numero: number; oc_cliente?: string | null; _prNumero?: string; clientes?: { razon_social?: string | null; cuit?: string | null } | null },
  busqueda: string,
): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  const soloDigitos = (t: string) => t.replace(/\D/g, "");
  const comprobante = formatComprobante(f.tipo, f.punto_venta, f.numero);
  const campos = [f.clientes?.razon_social, f.clientes?.cuit, comprobante, f._prNumero, f.oc_cliente]
    .filter((c): c is string => !!c)
    .map(c => c.toLowerCase());
  if (campos.some(c => c.includes(q))) return true;
  const qDigitos = soloDigitos(q);
  if (!qDigitos) return false;
  // "54" o "FA 15-54": el último grupo de dígitos es el número de la factura.
  const ultimoGrupo = q.match(/\d+/g)?.pop();
  if (ultimoGrupo && Number(ultimoGrupo) === Number(f.numero)) return true;
  return campos.some(c => soloDigitos(c).includes(qDigitos));
}

function clienteAlcanzoLimite(cliente: { limite_credito?: number | null; saldo_cuenta_corriente?: number | null } | null | undefined) {
  const limite = Number(cliente?.limite_credito || 0);
  return limite > 0 && Number(cliente?.saldo_cuenta_corriente || 0) >= limite;
}

export function FacturacionContent({ embedded = false, autoSelectId }: { embedded?: boolean; autoSelectId?: string }) {
  const { toast } = useToast();
  const { sociedadActiva, profile } = useUser();

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
  // Saldo real por cliente (B3): la columna clientes.saldo_cuenta_corriente no la actualiza nadie.
  const saldosClientesRef = useRef<Record<string, SaldoCliente> | null>(null);
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
  const arcaStatus = useArcaStatus(sociedadActiva?.id);

  // Emitir factura: ventana única (components/facturacion/emitir-factura-modal), la misma que usa Ventas.
  const [emitOpen, setEmitOpen] = useState(false);

  // Facturación masiva de presupuestos del cliente (sin exigir OC del cliente).
  // Se mantiene separado de la emisión manual para que cada comprobante pase por
  // las mismas validaciones/numeración del endpoint /api/facturacion.
  type FacturacionMasivaPR = {
    id: string; numero: string; fecha: string; moneda: "ARS" | "USD";
    tipo_cambio: number | null; cotizacion_modalidad: "divisas" | "billetes" | null;
    total: number; cliente_id: string; clienteNombre: string; condicion_iva: string | null;
    tipo_comprobante: string | null; items: EmitItem[]; selected: boolean;
    /** PR manual: guarda precio final (con IVA). PR electrónico: guarda precio neto. */
    sourceIsManual: boolean;
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

  // Fecha mínima de la facturación masiva: hasta 5 días atrás.
  const minFecha = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    return d.toISOString().slice(0, 10);
  }, []);
  // Ventana de 5 días hacia atrás que usa la NC (además de las fechas que habilita ARCA).
  const dateWindow = new Date(`${todayAR()}T12:00:00Z`);
  dateWindow.setUTCDate(dateWindow.getUTCDate() - 5);
  const dateWindowMin = dateWindow.toISOString().slice(0,10);

  // ── NC (Nota de Crédito) modal ────────────────────────────────
  const [ncOpen, setNcOpen] = useState(false);
  const [ncFactura, setNcFactura] = useState<FacturaRow | null>(null);
  const [ncItems, setNcItems] = useState<NcItem[]>([]);
  const [ncOriginalItems, setNcOriginalItems] = useState<NcItem[]>([]);
  const [ncMode, setNcMode] = useState<SalesCreditNoteMode>("total");
  const [ncAmount, setNcAmount] = useState("");
  const [ncAmountIva, setNcAmountIva] = useState(21);
  const [ncCobradoPrevio, setNcCobradoPrevio] = useState(0);
  const [ncFecha, setNcFecha] = useState(todayAR());
  const [ncManual, setNcManual] = useState(false);
  const [ncNumero, setNcNumero] = useState("");
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState("");
  const [ncStep, setNcStep] = useState<"form" | "saving" | "success" | "error">("form");
  const [ncResult, setNcResult] = useState<string>("");
  const [ncSuccessWarning, setNcSuccessWarning] = useState("");
  // Después de una NC total que deja el PR en "facturar": ¿se vuelve a facturar? Es una pregunta, nunca frena nada.
  const [ncPrPregunta, setNcPrPregunta] = useState<{ prId: string; prNumero: string; notas: string; resuelto: "" | "si" | "no" | "error" } | null>(null);
  const ncRequestKeyRef = useRef("");
  const [detailNCs, setDetailNCs] = useState<FacturaRow[]>([]);
  const [detailSolicitante, setDetailSolicitante] = useState<string | null>(null);

  const isFacturaANc = isInvoiceA(ncFactura?.tipo || "");
  const ncEsFce = ncFactura?.tipo === "FCEA" || ncFactura?.tipo === "FCEB";
  const ncTipo = creditNoteTypeForInvoice(ncFactura?.tipo || "FB");
  const ncFiscalDates = useFiscalDateLimits(ncOpen && !ncManual && Boolean(ncFactura), sociedadActiva?.id, emisorData.ptoVta, ncTipo);
  const ncFiscalMinDate = ncFiscalDates.minDate && ncFiscalDates.minDate > dateWindowMin ? ncFiscalDates.minDate : dateWindowMin;
  const ncDateBlocked = !ncFecha || ncFecha < (ncManual ? dateWindowMin : ncFiscalMinDate) || ncFecha > todayAR()
    || (!ncManual && !ncFiscalDates.ready);
  const ncAmountValue = parseDecimalInput(ncAmount);
  const ncItemsParaEmitir = ncMode === "amount"
    ? [freeAmountCreditItem(ncAmountValue, ncAmountIva, isFacturaANc)]
    : ncItems;
  const ncTotals = creditNoteTotals(ncItemsParaEmitir, isFacturaANc);
  const ncSaldoPendiente = Math.max(0, Number(ncFactura?.total || 0) - Number(ncFactura?.total_acreditado || 0) - ncCobradoPrevio);
  const ncExcedeSaldo = ncTotals.total > ncSaldoPendiente + 0.01;

  async function openNcModal(factura: FacturaRow) {
    beginInvoiceIntent(`nc:${sociedadActiva?.id}:${factura.id}`);
    // Cargar items de la factura original
    const { data: items } = await supabase
      .from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje")
      .eq("factura_id", factura.id)
      .order("orden");

    const originalItems = items && items.length > 0
      ? items.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21 }))
      : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }];
    let cobrado = 0;
    try { cobrado = await fetchCobrosPrevios(factura.id); } catch { /* El servidor vuelve a calcular bajo lock. */ }
    setNcFactura(factura);
    setNcPrPregunta(null);
    setNcOriginalItems(originalItems);
    setNcItems(originalItems);
    setNcMode("total");
    setNcAmount("");
    setNcAmountIva(originalItems[0]?.iva_porcentaje ?? 21);
    setNcCobradoPrevio(cobrado);
    // Las FCE solo se ajustan con su NC MiPyME autorizada.
    setNcManual(!["FCEA", "FCEB"].includes(factura.tipo) && arcaStatus !== null && arcaStatus.certOk === false);
    setNcNumero("");
    setNcFecha(todayAR());
    setNcError("");
    setNcStep("form");
    setNcResult("");
    setNcSuccessWarning("");
    ncRequestKeyRef.current = crypto.randomUUID();
    setNcOpen(true);
  }

  async function handleCreateNC() {
    if (!ncFactura) return;
    if (ncEsFce && ncManual) {
      setNcError(`La ${ncFactura.tipo} requiere ${ncTipo} electrónica con CAE. No puede registrarse como NC manual.`); return;
    }
    if (ncMode === "amount" && (!Number.isFinite(ncAmountValue) || ncAmountValue <= 0)) {
      setNcError("El campo Importe a acreditar debe ser mayor que cero y puede usar coma o punto decimal."); return;
    }
    if (ncItemsParaEmitir.some(it => !it.descripcion.trim() || !Number.isFinite(it.cantidad) || it.cantidad <= 0 || !Number.isFinite(it.precio_unitario) || it.precio_unitario < 0)) {
      setNcError("Cada ítem necesita una descripción, una cantidad mayor que cero y un precio válido."); return;
    }
    if (ncManual && (!ncNumero || Number(ncNumero) <= 0)) {
      setNcError("Ingresá el número de comprobante"); return;
    }
    if (ncDateBlocked) {
      setNcError(ncFiscalDates.error || `Elegí una fecha válida entre ${formatDate(ncManual ? dateWindowMin : ncFiscalMinDate)} y ${formatDate(todayAR())}`); return;
    }
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
            items: ncItemsParaEmitir,
            sociedad_id: sociedadActiva?.id,
            factura_origen_id: ncFactura.id,
            nota_credito_modo: ncMode,
            fecha: ncFecha,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Error al emitir NC");
        if (data.reconciliation_required) throw new Error(data.warning || "La NC fue autorizada y requiere completar su aplicación local. Reintentá sin cambiar los datos.");

        setNcResult(data.factura.comprobante + (data.factura.cae ? ` — CAE: ${data.factura.cae}` : ""));
        setNcSuccessWarning(data.warning || "");
      } else {
        // Manual sin ARCA: una sola llamada atómica e idempotente (A8).
        // Si la NC supera el saldo pendiente, la base avisa y se pide confirmación (nunca bloquea).
        if (!sociedadActiva?.id) throw new Error("No se pudo determinar la sociedad activa");
        if (!ncRequestKeyRef.current) ncRequestKeyRef.current = crypto.randomUUID();
        const ncManualParams = {
          p_request_key: ncRequestKeyRef.current,
          p_sociedad_id: sociedadActiva.id,
          p_factura_origen_id: ncFactura.id,
          p_tipo: ncTipo,
          p_punto_venta: emisorData.ptoVta,
          p_numero: Number(ncNumero),
          p_fecha: ncFecha,
          p_subtotal: ncTotals.neto,
          p_iva: ncTotals.iva,
          p_total: ncTotals.total,
          p_items: ncItemsParaEmitir.map((it, idx) => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, iva_porcentaje: isFacturaANc ? it.iva_porcentaje : 21, orden: idx })),
          p_modo: ncMode,
          p_observaciones: `Comprobante asociado: ${formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)}`,
        };
        let { data: ncRpc, error: ncRpcErr } = await (supabase as any).rpc("crear_nota_credito_manual_venta", { ...ncManualParams, p_confirmar: false });
        if (ncRpcErr) throw new Error(ncRpcErr.message);
        if (ncRpc?.requires_confirmation) {
          const seguir = window.confirm(`${ncRpc.warning || "La NC supera el saldo pendiente de la factura."}\n\n¿Querés registrarla igual?`);
          if (!seguir) { setNcStep("form"); return; }
          ({ data: ncRpc, error: ncRpcErr } = await (supabase as any).rpc("crear_nota_credito_manual_venta", { ...ncManualParams, p_confirmar: true }));
          if (ncRpcErr) throw new Error(ncRpcErr.message);
        }
        if (!ncRpc?.ok) throw new Error("No se pudo registrar la nota de crédito.");
        ncRequestKeyRef.current = "";

        setNcResult(formatComprobante(ncTipo, emisorData.ptoVta, Number(ncNumero)) + " (manual)");
        setNcSuccessWarning(ncRpc?.warning || (ncExcedeSaldo ? "La NC supera el saldo pendiente; revisá el saldo a favor del cliente en su cuenta corriente." : ""));
      }

      setNcStep("success");
      await fetchData();
      try {
        if (ncFactura.presupuesto_id) {
          const db = supabase as any;
          const [{ data: fAct }, { data: pAct }] = await Promise.all([
            db.from("facturas").select("estado").eq("id", ncFactura.id).single(),
            db.from("presupuestos").select("numero, estado, notas_internas").eq("id", ncFactura.presupuesto_id).single(),
          ]);
          if (fAct?.estado === "anulada" && pAct?.estado === "facturar") {
            setNcPrPregunta({ prId: ncFactura.presupuesto_id, prNumero: pAct.numero, notas: pAct.notas_internas || "", resuelto: "" });
          }
        }
      } catch { /* la pregunta es opcional: la NC ya está emitida */ }
    } catch (err: unknown) {
      setNcError(err instanceof Error ? err.message : "Error al crear NC");
      setNcStep("error");
    } finally {
      setNcSaving(false);
    }
  }

  // Filters — multi-select estado (like presupuestos)
  const ESTADO_GROUPS: Record<string, string[]> = {
    emitida_all: ["pendiente", "parcial", "pagada", "vencida", "cheque_rechazado"],
    pendiente_all: ["pendiente", "parcial", "vencida", "cheque_rechazado"],
    vencida: ["vencida"],
    cheque_rechazado: ["cheque_rechazado"],
    pagada: ["pagada"],
    anulada: ["anulada"],
  };
  const fvAllEstados = Object.keys(ESTADO_GROUPS);
  const [fvSelectedEstados, setFvSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const [fvTipoFilter, setFvTipoFilter] = useState("");
  const [fvMonedaFilter, setFvMonedaFilter] = useState<"" | "ARS" | "USD">("");
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

  const filteredFacturas = useMemo(() => facturas.filter((f) => {
    if (!fvIsAll && !Array.from(fvSelectedEstados).some(grp => (ESTADO_GROUPS[grp] || [grp]).includes(f.estado))) return false;
    if (fvTipoFilter && f.tipo !== fvTipoFilter) return false;
    if (fvMonedaFilter && (f.moneda === "USD" ? "USD" : "ARS") !== fvMonedaFilter) return false;
    if (clienteSearch.trim() && !facturaCoincideBusqueda(f, clienteSearch)) return false;
    if (fvEnvioFilter === "enviada" && !f.email_enviado_at) return false;
    if (fvEnvioFilter === "no_enviada" && f.email_enviado_at) return false;
    return true;
  }), [facturas, fvIsAll, fvSelectedEstados, fvTipoFilter, fvMonedaFilter, clienteSearch, fvEnvioFilter]);

  // ── Fetch data ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setCobradoPorFactura(null);
    try {
      // B4: Supabase corta en 1000 filas; se traen todas de a páginas con orden estable.
      const armarQuery = () => {
        let query = supabase
          .from("facturas")
          .select(`*, clientes(razon_social, cuit, condicion_iva, email, email_facturacion, telefono, direccion, localidad, provincia, dias_cuenta_corriente, limite_credito, saldo_cuenta_corriente), presupuestos:presupuesto_id(numero, cotizacion_modalidad, oc_cliente_fecha)`)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true });
        if (sociedadActiva?.id) {
          query = query.eq("sociedad_id" as any, sociedadActiva.id);
        }
        return query;
      };

      let data: unknown[] | null = null;
      let error: unknown = null;
      try { data = await traerTodo(armarQuery); } catch (e) { error = e; }

      if (!error && data) {
        // Cobrado por factura y saldo real de cada cliente (B3), con una sola lectura paginada.
        let saldosCli: Record<string, SaldoCliente> | null = null;
        try {
          if (!sociedadActiva?.id) throw new Error("sin sociedad");
          const datosSaldo = await traerDatosSaldoClientes(supabase, sociedadActiva.id, traerTodo);
          setCobradoPorFactura(cobradoPorFacturaVenta(datosSaldo.facturas, datosSaldo.movimientos, datosSaldo.aplicaciones));
          saldosCli = calcularSaldosClientes(datosSaldo.facturas, datosSaldo.movimientos, datosSaldo.aplicaciones, datosSaldo.ajustes);
        } catch { setCobradoPorFactura(null); }
        saldosClientesRef.current = saldosCli;
        // El aviso de límite usa el saldo real en pesos (si no se pudo calcular, no se muestra).
        const saldoRealCli = (id: string | null | undefined) => (saldosCli ? saldoClienteEn(saldosCli, id, "ARS") : null);
        const hoy = new Date().toISOString().slice(0, 10);
        setFacturas((data as unknown as FacturaRow[]).map(f => {
          const fv = f.fecha_vencimiento || (f.clientes?.dias_cuenta_corriente && f.fecha
            ? new Date(new Date(f.fecha).getTime() + ((f.clientes.dias_cuenta_corriente as number) * 86400000)).toISOString().slice(0, 10)
            : null);
          // Estado visible: vencida / pendiente, o "cheque rechazado" si su cheque volvió (lib/estado-factura-venta).
          const estado = estadoVisibleFactura(f as { estado: string; cheque_rechazado_at?: string | null }, fv, hoy);
          return { ...f, clientes: f.clientes ? { ...f.clientes, saldo_cuenta_corriente: saldoRealCli(f.cliente_id) } : f.clientes, estado, cotizacion_modalidad: f.cotizacion_modalidad || (f as any).presupuestos?.cotizacion_modalidad || null, oc_cliente_fecha: f.oc_cliente_fecha || (f as any).presupuestos?.oc_cliente_fecha || null, _clienteNombre: f.clientes?.razon_social || "", _fechaVencCalc: fv || "", _prNumero: (f as any).presupuestos?.numero || "" };
        }));
      } else if (error) {
        setFacturas([]);
        toast.error("No se pudieron cargar las facturas. Recargá la página.");
      }
    } catch {
      setFacturas([]);
        toast.error("No se pudieron cargar las facturas. Recargá la página.");
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
      // Ventas manda directo a la acción: &accion=cobro (registrar cobro) o &accion=nc (nota de crédito).
      const accion = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("accion") : null;
      if (accion === "cobro" && !["pagada", "anulada"].includes(match.estado)) void openCobroModal(match);
      if (accion === "nc" && match.estado !== "anulada") void openNcModal(match);
      // Clean URL param
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("factura");
        url.searchParams.delete("accion");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, [autoSelectId, facturas]);

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
        .select("id, numero, fecha, moneda, tipo_cambio, tipo_cambio_divisas, cotizacion_modalidad, total, cliente_id, tipo_comprobante, estado, modalidad_emision, clientes(razon_social, condicion_iva, moneda_predeterminada), presupuesto_items(codigo, descripcion, cantidad, precio_venta, iva_porcentaje, total, orden)")
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
        // Manda la ficha del cliente ("USD Divisa" / "USD"); si no dice, el del presupuesto (lib/factura-moneda).
        cotizacion_modalidad: modalidadFactura(r.clientes?.moneda_predeterminada, r.cotizacion_modalidad),
        total: Number(r.total || 0),
        cliente_id: r.cliente_id,
        clienteNombre: r.clientes?.razon_social || "",
        condicion_iva: r.clientes?.condicion_iva || null,
        tipo_comprobante: r.tipo_comprobante || null,
        // precio_unitario queda como lo guarda el PR (neto si es electrónico, final si es manual).
        // Se convierte al emitir, cuando ya se sabe si va FA o FB (ver precioUnitarioParaFactura).
        items: (r.presupuesto_items || []).sort((a: any, b: any) => Number(a.orden || 0) - Number(b.orden || 0)).map((it: any) => {
          const iva = Number(it.iva_porcentaje ?? 21);
          return {
            descripcion: it.descripcion || it.codigo || "Item",
            cantidad: Number(it.cantidad || 0),
            precio_unitario: precioNetoItemPresupuesto(it),
            iva_porcentaje: iva,
          };
        }),
        sourceIsManual: r.modalidad_emision === "manual",
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
      // A1: la FB se manda con precio final (IVA incluido) y la FA con neto, igual que Ventas.
      // PENDIENTE DE VERIFICAR EN PRODUCCIÓN con una factura controlada (FB y FA chicas)
      // antes de volver a usar la facturación masiva: en local no se puede probar ARCA.
      const itemsFactura: EmitItem[] = pr.items.map(it => ({
        ...it,
        precio_unitario: precioUnitarioParaFactura({ tipo, sourceIsManual: pr.sourceIsManual, precioNeto: it.precio_unitario, ivaPorcentaje: it.iva_porcentaje }),
      }));
      try {
        let automaticRate: number | null = null;
        let leyendaTc: string | null = null;
        if (pr.moneda === "USD") {
          const quoteRes = await fetch(`/api/cotizacion-bna?fecha_factura=${encodeURIComponent(fmFecha)}&modalidad=${pr.cotizacion_modalidad || "divisas"}`);
          const quote = await quoteRes.json();
          if (!quoteRes.ok || !(quote.valor_venta > 0)) throw new Error(quote.error || "No se pudo verificar el tipo de cambio automático.");
          automaticRate = quote.valor_venta;
          leyendaTc = leyendaCotizacion({ modalidad: pr.cotizacion_modalidad === "billetes" ? "billetes" : "divisas", valor: quote.valor_venta, fecha: quote.fecha });
        }
        const res = await postInvoiceIntent(`presupuesto:${sociedadActiva.id}:${pr.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({
            tipo, cliente_id: pr.cliente_id, punto_venta: emisorData.ptoVta,
            moneda: pr.moneda, tipo_cambio: automaticRate,
            cotizacion_modalidad: pr.moneda === "USD" ? (pr.cotizacion_modalidad || "divisas") : null,
            fecha: fmFecha, items: itemsFactura, presupuesto_id: pr.id, sociedad_id: sociedadActiva.id,
            observaciones: leyendaTc,
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
  const [fxCobro, setFxCobro] = useState<{clienteId:string; documents:{id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]; ordenPago?: OpParsed; ordenPagoAvisos?: string[]} | null>(null);
  // Cobro de todas las facturas de una orden de pago: primero las de pesos y después las de dólares.
  const [opSecuencia, setOpSecuencia] = useState<{ parsed: OpParsed; clienteId: string; clienteNombre: string; ars: LiquidacionFactura[]; usd: {id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]; avisos: string[] } | null>(null);
  const [opSecuenciaPaso, setOpSecuenciaPaso] = useState<"ars" | "usd" | null>(null);
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
  const cobroRequestKeyRef = useRef("");

  // Busca en el sistema todas las facturas que figuran en la orden de pago y arma el
  // cobro: las pendientes en pesos (paso 1) y en dólares (paso 2). Las ya cobradas o
  // no encontradas se informan y no se tocan. Nada se registra sin confirmar.
  async function iniciarCobroOrdenPago(parsed: OpParsed, clienteId: string) {
    if (!sociedadActiva?.id || !clienteId) { alert("No se pudo identificar el cliente o la sociedad."); return; }
    const claves = (parsed.facturas_pagadas || [])
      .filter(f => !String(f.tipo || "").toUpperCase().startsWith("NC"))
      .map(f => ({ clave: comprobanteKey(f.punto_venta, f.numero, f.comprobante), texto: f.comprobante || `${f.punto_venta}-${f.numero}`, tipo: f.tipo || null, comprobante: f.comprobante || null }))
      .filter((c): c is { clave: string; texto: string; tipo: string | null; comprobante: string | null } => !!c.clave);
    if (!claves.length) { alert("La IA no encontró el detalle de facturas en la orden de pago."); return; }
    try {
      const numeros = Array.from(new Set(claves.map(c => Number(c.clave.split("-")[1]))));
      const { data, error } = await (supabase as any).from("facturas")
        .select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, tipo_cambio, estado, cliente_id, clientes(razon_social)")
        .eq("sociedad_id", sociedadActiva.id).eq("cliente_id", clienteId).in("numero", numeros);
      if (error) throw error;
      // Solo facturas: una NC puede tener el mismo punto de venta y número que la factura.
      const filas = ((data || []) as any[]).filter(f => f.estado !== "anulada" && !esNotaCredito(f.tipo) && claves.some(c => c.clave === `${Number(f.punto_venta)}-${Number(f.numero)}`));
      const cobrado = await fetchCobradoMap(filas.map(f => ({ id: f.id, moneda: f.moneda || "ARS" })));
      const ars: LiquidacionFactura[] = [];
      const usd: {id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[] = [];
      const avisos: string[] = [];
      for (const c of claves) {
        const f = elegirFacturaDeOrdenPago(filas.filter(x => `${Number(x.punto_venta)}-${Number(x.numero)}` === c.clave), c.tipo, c.comprobante);
        if (!f) { avisos.push(`${c.texto}: no está en el sistema para este cliente (o está anulada). Revisala.`); continue; }
        const numero = formatComprobante(f.tipo, f.punto_venta, f.numero);
        const saldo = Math.round((Number(f.total) - Number(f.total_acreditado || 0) - (cobrado[f.id] || 0)) * 100) / 100;
        if (saldo <= 0.01) { avisos.push(`${numero}: ya figura cobrada, no se vuelve a cobrar.`); continue; }
        if ((f.moneda || "ARS") === "USD") usd.push({ id: f.id, numero, saldo, total: Number(f.total), subtotal: Number(f.subtotal || 0), cotizacion: Number(f.tipo_cambio) || undefined });
        else ars.push({ id: f.id, numero, fecha: f.fecha, subtotal: Number(f.subtotal || 0), iva: Number(f.iva || 0), total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), saldo, moneda: "ARS" });
      }
      if (!ars.length && !usd.length) { alert(`No hay facturas pendientes para cobrar en esta orden de pago.\n\n${avisos.join("\n")}`); return; }
      const clienteNombre = filas[0]?.clientes?.razon_social || "";
      setFxCobro(null); setCobroModalId(null); setCmLiquidacionOpen(false); setCmOpen(false);
      setOpSecuencia({ parsed, clienteId, clienteNombre, ars, usd, avisos });
      if (ars.length) setOpSecuenciaPaso("ars");
      else abrirPasoUsd({ parsed, clienteId, clienteNombre, ars, usd, avisos });
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudieron buscar las facturas de la orden de pago.");
    }
  }

  function avisosPaso(sec: NonNullable<typeof opSecuencia>, paso: "ars" | "usd"): string[] {
    const pasos = (sec.ars.length ? 1 : 0) + (sec.usd.length ? 1 : 0);
    const lineas: string[] = [];
    if (pasos === 2) lineas.push(paso === "ars" ? "Paso 1 de 2: facturas en pesos. Al confirmar se abre el cobro de las facturas en dólares." : "Paso 2 de 2: facturas en dólares.");
    return [...lineas, ...sec.avisos];
  }

  function abrirPasoUsd(sec: NonNullable<typeof opSecuencia>) {
    setOpSecuenciaPaso("usd");
    setFxCobro({ clienteId: sec.clienteId, documents: sec.usd, ordenPago: sec.parsed, ordenPagoAvisos: avisosPaso(sec, "usd") });
  }

  async function handleParseComprobante(files: FileList | File[]) {
    setCobroParsing(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) formData.append("file", file);
      formData.append("contexto", "orden_pago_cliente");
      const res = await fetch("/api/parse-cobro", { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success || !json.data) { alert(json.error || "No se pudo leer el comprobante"); return; }
      let pagos: any[] = json.data.pagos || (json.data.tipo ? [json.data] : []);
      // Si es una orden de pago que también paga otras facturas, usar solo la parte de esta.
      const facturaCobro = facturas.find(x => x.id === cobroModalId);
      if (facturaCobro && Array.isArray(json.data.facturas_pagadas) && json.data.facturas_pagadas.length) {
        const plan = buildOrdenPagoPlan(json.data as OpParsed, [{ id: facturaCobro.id, numero: formatComprobante(facturaCobro.tipo, facturaCobro.punto_venta, facturaCobro.numero) }]);
        if (plan.incluidas.length) {
          const original = (tipo: string) => pagos.find(p => String(p.tipo || "").toLowerCase() === tipo) || {};
          pagos = [
            ...plan.medios.map(m => ({ ...original(m.tipo), tipo: m.tipo, monto: m.monto, fecha: m.fecha, referencia: m.referencia, banco: m.banco })),
            ...plan.retenciones.map(r => ({ ...original(r.tipo), tipo: r.tipo, monto: r.monto, referencia: r.certificado })),
          ];
          if (plan.otras.length && window.confirm(`Esta orden de pago también paga: ${plan.otras.map(o => `${o.comprobante} (${formatCurrency(o.importe, "ARS")})`).join(", ")}.\n\n¿Querés cobrar todas las facturas de la orden juntas?\n\nAceptar = cobrar todas · Cancelar = solo esta factura`)) {
            void iniciarCobroOrdenPago(json.data as OpParsed, facturaCobro.cliente_id);
            return;
          }
          const avisos = [...plan.otras.map(o => `La orden también paga ${o.comprobante} por ${formatCurrency(o.importe, "ARS")}: cobrala aparte.`), ...plan.avisos];
          if (avisos.length) alert(`Se cargó solo la parte de esta factura.\n\n${avisos.join("\n")}`);
        }
      }
      if (pagos.length === 0) { alert("No se detectaron pagos en el comprobante"); return; }

      // Map API tipo → CobroLinea tipo
      function mapTipo(t: string): CobroLinea["tipo"] {
        if (t === "deposito") return "efectivo";
        // En cobros, todo cheque detectado se presume E-Cheq. El usuario debe
        // marcarlo expresamente como físico antes de confirmar.
        if (t === "cheque" || t === "echeq") return "echeq";
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
          monto: p.monto ? toDecimalInput(Number(p.monto)) : "",
          descripcion: descParts.join(" — "),
          cheque_numero: p.cheque_numero || "",
          cheque_banco: p.banco || "",
          cheque_fecha: p.cheque_fecha || ((tipo === "cheque_recibido" || tipo === "echeq") ? (p.fecha_cobro || p.fecha || "") : ""),
          cheque_id_digital: p.cheque_id_digital || "",
        };
      });

      // El cobro va con la fecha en que se recibe: la de la transferencia, o hoy si se pagó con cheques
      // (la fecha de pago del cheque queda en el cheque).
      setCobroFecha(fechaCobroSugerida(pagos, todayAR()));

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
    // B4: de a tandas de ids (URL corta) y paginado (más de 1000 cobros).
    const sociedadId=sociedadActiva.id;
    const direct={data:[] as any[]}, applications={data:[] as any[]};
    try{
      for(let i=0;i<ids.length;i+=150){
        const lote=ids.slice(i,i+150);
        const [d,a]=await Promise.all([
          traerTodo(()=>(supabase as any).from("movimientos").select("id,factura_id,monto,moneda,anulado").in("factura_id",lote).eq("sociedad_id",sociedadId).order("id")),
          traerTodo(()=>(supabase as any).from("cobro_aplicaciones").select("movimiento_id,factura_id,monto,movimientos!inner(anulado,sociedad_id)").in("factura_id",lote).eq("movimientos.sociedad_id",sociedadId).order("movimiento_id").order("factura_id")),
        ]);
        direct.data.push(...d); applications.data.push(...a);
      }
    }catch{throw new Error("No se pudieron verificar los cobros previos; no se habilitó el cobro. Reintentá la consulta.");}
    const totals:Record<string,number>={};
    // Un cobro con aplicaciones ya se cuenta por ellas: no se suma también como directo (igual que Finanzas y lib/saldo-clientes).
    const movimientosAplicados=new Set<string>((applications.data||[]).map((a:any)=>a.movimiento_id).filter(Boolean));
    for(const m of direct.data||[]){
      if(m.anulado||movimientosAplicados.has(m.id))continue;
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
      cobroRequestKeyRef.current = crypto.randomUUID();
      setCobroModalId(factura.id);
      setCobroLineas([{ tipo: "transferencia", monto: toDecimalInput(Math.max(0, Math.round(saldoReal * 100) / 100)), descripcion: "" }]);
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
      { tipo: "transferencia", monto: toDecimalInput(Math.max(0, Math.round(saldo * 100) / 100)), descripcion: "" },
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
    const lineasValidas = cobroLineas.filter(l => montoNum(l.monto) > 0);
    if (!cobroModalId || lineasValidas.length === 0) return;
    const factura = facturas.find(f => f.id === cobroModalId);
    if (!factura) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    if(factura.moneda!=="ARS"){alert("Los cobros de facturas USD deben registrarse desde la liquidación con tipo de cambio.");return;}
    const totalLineas = lineasValidas.reduce((s, l) => s + montoNum(l.monto), 0);
    const saldo = Number(factura.total) - Number(factura.total_acreditado || 0) - cobroPrevios;
    const saldoComp = saldo;
    // Aviso, nunca bloqueo (regla de Augusto): puede haber un redondeo o un pago de más que se aplica después.
    if (totalLineas > saldoComp + 0.01 && !confirm(`El total de cobros (${formatCurrency(totalLineas)}) supera el saldo de la factura (${formatCurrency(Math.max(0, saldoComp))}). La factura queda pagada y lo que sobra queda a favor del cliente en su cuenta corriente. ¿Guardar igual?`)) {
      return;
    }
    const avisoFecha = avisoFechaCobroFutura(cobroFecha, todayAR());
    if (avisoFecha && !confirm(avisoFecha)) return;
    setCobroSaving(true);
    try {
      if (!cobroRequestKeyRef.current) cobroRequestKeyRef.current = crypto.randomUUID();
      const lineasPayload = lineasValidas.map(l => {
        let desc = l.descripcion || `Cobro ${formatComprobante(factura.tipo, factura.punto_venta, factura.numero)}`;
        // Append cheque details to description
        if ((l.tipo === "cheque_recibido" || l.tipo === "echeq") && (l.cheque_numero || l.cheque_banco)) {
          const parts = [l.cheque_banco, l.cheque_numero ? `N° ${l.cheque_numero}` : null, l.cheque_fecha, l.cheque_id_digital ? `ID: ${l.cheque_id_digital}` : null].filter(Boolean);
          desc = (l.descripcion ? l.descripcion + " — " : "") + parts.join(" · ");
        }
        return {
          tipo: l.tipo === "echeq" ? "cheque_recibido" : l.tipo,
          monto: montoNum(l.monto),
          descripcion: desc,
          ...(l.tipo === "cheque_recibido" || l.tipo === "echeq" ? {
            tipo_cheque: l.tipo === "echeq" ? "echeq" : "fisico",
            cheque_numero: l.cheque_numero || "",
            cheque_banco: l.cheque_banco || "",
            cheque_fecha_pago: l.cheque_fecha || cobroFecha,
            cheque_id_digital: l.cheque_id_digital || "",
          } : {}),
        };
      });
      const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc("registrar_cobro_seguro", {
        p_factura_id: cobroModalId,
        p_lineas: lineasPayload,
        p_fecha: cobroFecha,
        p_sociedad_id: sociedadActiva.id,
        p_request_key: cobroRequestKeyRef.current,
      });
      if (rpcErr) throw rpcErr;

      setCobroModalId(null);
      cobroRequestKeyRef.current = "";
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
      let q = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, tipo_cambio, estado").eq("cliente_id", clienteId).in("estado", ["emitida", "parcial", "vencida"]).order("fecha", { ascending: true });
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
        // Las notas de crédito no se cobran: se aplican a su factura (antes aparecían en la lista).
        }).filter((f: CobroMasivoFC) => f.saldo > 0.01 && !String(f.tipo || "").toUpperCase().startsWith("NC")));
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

  /** A quién salió de verdad según Resend ("a, b"), o null si no vino. */
  const destinatariosReales = (data: any): string | null => {
    const to = Array.isArray(data?.to) ? data.to : data?.to ? [data.to] : [];
    const txt = to.map((e: string) => String(e).trim()).filter(Boolean).join(", ");
    return txt || null;
  };
  const mismosMails = (a?: string | null, b?: string | null) =>
    (a || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).sort().join(",") === (b || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).sort().join(",");

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
    let solicitanteEmail = "";
    try {
      if (f.clientes?.email_facturacion) {
        // email_facturacion can be comma-separated
        for (const e of f.clientes.email_facturacion.split(",").map(s => s.trim()).filter(Boolean)) {
          suggested.push({ email: e, label: "Facturación" });
        }
      }
      if (f.clientes?.email && !suggested.some(s => s.email === f.clientes!.email)) {
        suggested.push({ email: f.clientes.email, label: "Cliente" });
      }
      const { data: contactos } = await (supabase as any).from("contactos").select("id, nombre, email").eq("entity_type", "cliente").eq("entity_id", f.cliente_id);
      // If factura comes from a presupuesto, find the solicitante
      let solicitanteContactoId: string | null = null;
      if (f.presupuesto_id) {
        const { data: prData } = await (supabase as any).from("presupuestos").select("contacto_id, contacto:contacto_id(nombre, email), created_by_profile:created_by(full_name, email)").eq("id", f.presupuesto_id).single();
        if (prData?.contacto_id) solicitanteContactoId = prData.contacto_id;
        // El solicitante del PR va primero y marcado (aunque haya otra ficha con el mismo mail).
        const solEmail = String(prData?.contacto?.email || "").trim();
        if (solEmail) {
          solicitanteEmail = solEmail;
          const label = `⭐ Solicitante: ${prData.contacto.nombre || solEmail}`;
          const ya = suggested.find(s => s.email.toLowerCase() === solEmail.toLowerCase());
          if (ya) ya.label = label; else suggested.unshift({ email: solEmail, label });
        }
        if (prData?.created_by_profile?.email && !suggested.some(s => s.email === prData.created_by_profile.email)) {
          suggested.push({ email: prData.created_by_profile.email, label: `Creador PR: ${prData.created_by_profile.full_name || ""}` });
        }
      }
      if (contactos) {
        for (const c of contactos) {
          if (c.email && !suggested.some(s => s.email === c.email)) {
            const isSolicitante = solicitanteContactoId && c.id === solicitanteContactoId;
            suggested.push({ email: c.email, label: isSolicitante ? `⭐ Solicitante: ${c.nombre}` : (c.nombre || "Contacto") });
          }
        }
      }
    } catch { /* ignore */ }

    // Para: mail de facturación (o el del cliente) + el solicitante del PR.
    const base = f.clientes?.email_facturacion?.split(",")[0]?.trim() || f.clientes?.email || "";
    const defaultTo = [base, solicitanteEmail].filter((e, i, a) => e && a.findIndex(x => x.toLowerCase() === e.toLowerCase()) === i).join(", ");
    setEmailModal({
      open: true,
      facturaId: f.id,
      to: defaultTo,
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social),
      suggestedEmails: suggested,
    });
  }

  async function fetchFacturaItems(facturaId: string) {
    const { data } = await supabase.from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
      .eq("factura_id", facturaId).order("orden");
    return (data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }));
  }

  function buildFacturaHTML(f: FacturaRow, items: { descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number; subtotal: number }[]): string | null {
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
      observaciones: f.observaciones,
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
      items: items.map(it => ({
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
    // Always fetch fresh items for the specific factura to avoid cross-contamination
    const items = await fetchFacturaItems(f.id);
    setDetailItems(items);
    const html = buildFacturaHTML(f, items);
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
  // B7: una NC cuya factura quedó anulada no se resta otra vez (la factura ya no suma).
  const estadoFacturaPorId = new Map(facturas.map(f => [f.id, f.estado] as [string, string]));
  // Facturado del mes: la misma cuenta que el Dashboard (facturas − NC, sin IVA, pesos y dólares por separado).
  const facturadoNeto = facturadoMesNeto(facturas as any[], todayAR().slice(0, 7));
  const saldoFactura = (f:FacturaRow)=>["pagada","anulada"].includes(f.estado)?0:Math.max(0,Number(f.total)-Number(f.total_acreditado||0)-(cobradoPorFactura?.[f.id]||0));
  const pendientesMoneda = (moneda:string)=>facturas.filter(f => f.moneda===moneda && ["pendiente", "parcial", "vencida", "cheque_rechazado"].includes(f.estado) && !ncTipos.includes(f.tipo)).reduce((a, f) => a + saldoFactura(f), 0);
  const facturasVencidas = facturas.filter(f => f.estado === "vencida").length;
  const caeVigentes = facturas.filter(f => f.cae && f.estado !== "anulada").length;

  const [checkingEmails, setCheckingEmails] = useState(false);
  async function handleCheckAllEmails() {
    const toCheck = facturas.filter(f => f.email_resend_id && f.email_estado !== "delivered" && f.email_estado !== "bounced");
    if (toCheck.length === 0) { alert("No hay emails pendientes de verificar"); return; }
    setCheckingEmails(true);
    let updated = 0;
    let failed = 0;
    try {
      for (const f of toCheck) {
        try {
          const res = await fetch(`/api/email/status?resend_id=${f.email_resend_id}`);
          const data = await res.json();
          // Estado de entrega y, si no coincide, a quién salió de verdad.
          const real = destinatariosReales(data);
          const cambios: Record<string, unknown> = {};
          if (data.status && data.status !== f.email_estado) cambios.email_estado = data.status;
          if (real && !mismosMails(real, f.email_enviado_a)) cambios.email_enviado_a = real;
          if (Object.keys(cambios).length) {
            await (supabase as any).from("facturas").update(cambios).eq("id", f.id);
            setFacturas(prev => prev.map(x => x.id === f.id ? { ...x, ...cambios } : x));
            updated++;
          }
        } catch { failed++; }
      }
      alert(`Verificados: ${toCheck.length}. Actualizados: ${updated}.${failed > 0 ? ` Errores: ${failed}.` : ""}`);
    } finally { setCheckingEmails(false); }
  }

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
        action={{ label: "Emitir factura", onClick: () => setEmitOpen(true) }}
      />}
      {/* Action buttons */}
      <div className={`${embedded ? "" : "px-3 sm:px-5 pt-3"} flex flex-wrap justify-end gap-2`}>
        {embedded && (
          <button onClick={() => setEmitOpen(true)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            <Plus className="h-4 w-4" /> Emitir factura
          </button>
        )}
        <button onClick={openFacturacionMasiva} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
          <FileCheck className="h-4 w-4" /> Facturación masiva sin OC
        </button>
        <button onClick={openCobroMasivo} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors">
          <DollarSign className="h-4 w-4" /> Cobro masivo
        </button>
        <button onClick={handleCheckAllEmails} disabled={checkingEmails} className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50">
          {checkingEmails ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />} Verificar emails
        </button>
        <button onClick={exportFacturasCSV} className="flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
          <Download className="h-4 w-4" /> Exportar CSV
        </button>
      </div>
      <div className={`${embedded ? "pt-3" : "p-3 sm:p-5"} space-y-4`}>
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes (sin IVA)" value={`${formatCurrency(facturadoNeto.ARS.neto,"ARS")} / ${formatCurrency(facturadoNeto.USD.neto,"USD")}`} detail={`Facturas ${formatCurrency(facturadoNeto.ARS.facturas,"ARS")} − NC ${formatCurrency(facturadoNeto.ARS.nc,"ARS")}`} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Pendientes de cobro" value={cobradoPorFactura?`${formatCurrency(pendientesMoneda("ARS"),"ARS")} / ${formatCurrency(pendientesMoneda("USD"),"USD")}`:"Saldo sin verificar"} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Comprobantes vencidos" value={String(facturasVencidas)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-blue-600" />
        </div>

        {/* Search & tipo filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input value={clienteSearch} onChange={(e) => setClienteSearch(e.target.value)}
              placeholder="Buscar por cliente, factura, PR u OC..."
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
          <select value={fvMonedaFilter} onChange={(e) => setFvMonedaFilter(e.target.value as "" | "ARS" | "USD")}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
            <option value="">Todas las monedas</option>
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
          <select value={fvEnvioFilter} onChange={(e) => setFvEnvioFilter(e.target.value as any)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
            <option value="todos">Envío: todas</option>
            <option value="enviada">Enviadas</option>
            <option value="no_enviada">No enviadas</option>
          </select>
          {(clienteSearch || !fvIsAll || fvTipoFilter || fvMonedaFilter || fvEnvioFilter !== "todos") && (
            <span className="text-xs text-zinc-500">{filteredFacturas.length} de {facturas.length}</span>
          )}
        </div>
        {/* Estado multi-select toggles */}
        <div className="flex gap-2 flex-wrap">
          {([["emitida_all", "Emitida"], ["pendiente_all", "Pendiente"], ["vencida", "Vencida"], ["cheque_rechazado", "Cheque rechazado"], ["pagada", "Pagada"], ["anulada", "Anulada"]] as const).map(([key, label]) => {
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
              { key: "clientes", label: "Cliente", sortable: true, sortKey: "_clienteNombre", render: (r) => (
                <div>
                  <span className="font-medium">{r.clientes?.razon_social || "\u2014"}</span>
                  {r.email_enviado_at && (
                    <p className="max-w-[260px] truncate text-[10px] text-zinc-400" title={`Enviada el ${formatDateTime(r.email_enviado_at)}${r.email_enviado_a ? ` a ${r.email_enviado_a}` : ""}`}>
                      ✉ {textoEnvioCorto(r.email_enviado_at, r.email_enviado_a)}
                    </p>
                  )}
                  {clienteAlcanzoLimite(r.clientes) && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400" title="Aviso informativo; no bloquea la emisión">
                      <AlertTriangle className="h-3 w-3" /> Límite de crédito alcanzado
                    </p>
                  )}
                </div>
              )},
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
                  onDoubleClick={async (e) => {
                    e.stopPropagation();
                    if (!r.email_resend_id) return;
                    try {
                      const res = await fetch(`/api/email/status?resend_id=${r.email_resend_id}`);
                      const data = await res.json();
                      const real = destinatariosReales(data);
                      const cambios: Record<string, unknown> = {};
                      if (data.status && data.status !== r.email_estado) cambios.email_estado = data.status;
                      if (real && !mismosMails(real, r.email_enviado_a)) cambios.email_enviado_a = real;
                      if (Object.keys(cambios).length) {
                        await (supabase as any).from("facturas").update(cambios).eq("id", r.id);
                        setFacturas(prev => prev.map(f => f.id === r.id ? { ...f, ...cambios } : f));
                      }
                      const statusLabels: Record<string, string> = { sent: "Enviado", delivered: "Entregado", bounced: "Rebotado", complained: "Spam", delivery_delayed: "Demorado" };
                      alert(`Estado: ${statusLabels[data.status] || data.status}${real ? `
Salió a: ${real}` : ""}`);
                    } catch { /* ignore */ }
                  }}
                  className="flex justify-center cursor-pointer"
                  title={(() => {
                    const emailDest = r.email_enviado_a || r.clientes?.email_facturacion || r.clientes?.email || "";
                    const estadoLabel = r.email_estado === "delivered" ? " - Entregado" : r.email_estado === "bounced" ? " - Rebotado" : r.email_estado === "delivery_delayed" ? " - Demorado" : "";
                    return r.email_enviado_at
                      ? `Enviada el ${formatDateTime(r.email_enviado_at)}${emailDest ? ` a ${emailDest}` : ""}${estadoLabel}. Doble click para verificar.`
                      : `Enviar por email${emailDest ? ` (${emailDest})` : ""}`;
                  })()}
                >
                  {r.email_enviado_at
                    ? r.email_estado === "delivered"
                      ? <CheckCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      : r.email_estado === "bounced"
                        ? <MailX className="h-5 w-5 text-red-500" />
                        : <MailCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    : <Mail className="h-4 w-4 text-zinc-700 dark:text-zinc-300 hover:text-orange-500 transition-colors" />}
                </div>
              )},
            ]}
            data={filteredFacturas}
            onRowClick={(f) => {
              setDetailFactura(f);
              setDetailNCs([]);
              setDetailSolicitante(null);
              supabase.from("factura_items").select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden")
                .then(({ data }) => setDetailItems((data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }))));
              // Cargar NCs relacionadas a esta factura
              (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, total, estado")
                .eq("factura_origen_id", f.id).order("fecha", { ascending: false })
                .then(({ data }: { data: FacturaRow[] | null }) => setDetailNCs(data || []));
              // Cargar solicitante del presupuesto
              if (f.presupuesto_id) {
                (supabase as any).from("presupuestos").select("contacto_id").eq("id", f.presupuesto_id).single()
                  .then(({ data: prData }: any) => {
                    if (prData?.contacto_id) {
                      (supabase as any).from("contactos").select("nombre, cargo, email, telefono").eq("id", prData.contacto_id).single()
                        .then(({ data: cData }: any) => {
                          if (cData) setDetailSolicitante(cData.cargo ? `${cData.nombre} (${cData.cargo})` : cData.nombre);
                        });
                    }
                  });
              }
            }}
          />
        </Card>

        {/* ARCA: la tarjeta completa está en Configuración > Integraciones. Acá solo se avisa si falta el certificado. */}
        {arcaStatus?.certOk === false && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>ARCA: {arcaStatus.error || "certificado no configurado"}. Las facturas se cargan como manuales. Detalle en Configuración &gt; Integraciones.</span>
          </div>
        )}
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
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                  <Autocompletar
                    opciones={fmClientes.map(c => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit || undefined }))}
                    placeholder={fmClientes.find(c => c.id === fmClienteId)?.razon_social || "Escribí el cliente o el CUIT…"}
                    onElegir={(id) => { setFmClienteId(id); fmSelectCliente(id); }}
                    className="w-full border-zinc-300 dark:border-zinc-700"
                  />
                </div>
                <div><label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha común *</label><input type="date" value={fmFecha} min={minFecha} max={todayAR()} onChange={e => setFmFecha(e.target.value)} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" /></div>
              </div>
              {fmClienteId && <AvisoBCRA clienteId={fmClienteId} />}
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

      {emitOpen && (
        <EmitirFacturaModal
          arcaCertOk={arcaStatus?.certOk}
          saldoClienteArs={(id) => (saldosClientesRef.current ? saldoClienteEn(saldosClientesRef.current, id, "ARS") : null)}
          onClose={() => setEmitOpen(false)}
          onEmitted={() => { void fetchData(); }}
        />
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
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-4 py-2.5 border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700">
              <div>
                <h2 className="font-mono text-lg font-bold dark:text-white">
                  {formatComprobante(detailFactura.tipo, detailFactura.punto_venta, detailFactura.numero)}
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
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
                  const items = await fetchFacturaItems(detailFactura.id);
                  const html = buildFacturaHTML(detailFactura, items);
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

            <div className="px-4 py-3 space-y-3">
              {["FCEA", "FCEB"].includes(detailFactura.tipo) && <div className="rounded-lg border border-blue-200 p-2.5 space-y-1.5 dark:border-blue-900">
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
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Cliente</h4>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{detailFactura.clientes?.razon_social}</p>
                {detailFactura.clientes?.cuit && <p className="text-xs text-zinc-500 mt-0.5">CUIT: {detailFactura.clientes.cuit}</p>}
                {detailFactura.clientes?.condicion_iva && <p className="text-xs text-zinc-400">{detailFactura.clientes.condicion_iva}</p>}
                {clienteAlcanzoLimite(detailFactura.clientes) && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Límite de crédito alcanzado. Aviso informativo: la factura y sus acciones continúan habilitadas.</span>
                  </div>
                )}
              </div>

              {/* Solicitante */}
              {detailSolicitante && (
                <p className="text-xs text-zinc-500 mt-1">Solicitante: <span className="font-medium text-zinc-700 dark:text-zinc-300">{detailSolicitante}</span></p>
              )}

              {/* OC Cliente */}
              {detailFactura.oc_cliente && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">OC Cliente</h4>
                  <p className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{detailFactura.oc_cliente}</p>
                  <p className="mt-1 text-xs text-zinc-500">Fecha de la OC: {detailFactura.oc_cliente_fecha ? formatDate(detailFactura.oc_cliente_fecha) : "Sin informar"}</p>
                </div>
              )}

              {/* CAE */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">CAE</h4>
                {detailFactura.cae ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{detailFactura.cae}</span>
                    </div>
                    {detailFactura.cae_vencimiento && (
                      <p className="text-xs text-emerald-600/70 mt-1 ml-6">Vencimiento: {formatDate(detailFactura.cae_vencimiento)}</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">Sin CAE — factura no autorizada por ARCA</div>
                )}
              </div>

              {/* Items */}
              {detailItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Items</h4>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                          <th className="text-left px-3 py-1.5 font-medium text-zinc-500">Descripcion</th>
                          <th className="text-right px-3 py-1.5 font-medium text-zinc-500">Cant.</th>
                          <th className="text-right px-3 py-1.5 font-medium text-zinc-500">P.Unit.</th>
                          <th className="text-right px-3 py-1.5 font-medium text-zinc-500">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((it, idx) => (
                          <tr key={idx} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{it.descripcion}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-400">{it.cantidad}</td>
                            <td className="px-3 py-1.5 text-right font-mono text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(it.precio_unitario), detailFactura.moneda as "USD" | "ARS")}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">{formatCurrency(Number(it.subtotal), detailFactura.moneda as "USD" | "ARS")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Importes */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Importes</h4>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  {detailFactura.tipo !== "X" && (<>
                    <div className="flex items-center justify-between px-4 py-1.5 text-sm">
                      <span className="text-zinc-500">Neto gravado</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.subtotal), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                    <div className="flex items-center justify-between px-4 py-1.5 text-sm border-t border-zinc-100 dark:border-zinc-800">
                      <span className="text-zinc-500">IVA</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.iva), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  </>)}
                  <div className="flex items-center justify-between px-4 py-2 text-sm border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <span className="text-zinc-700 dark:text-zinc-300">{detailFactura.tipo === "X" ? "Total (sin IVA)" : "Total"}</span>
                    <span className="font-mono text-base">{formatCurrency(Number(detailFactura.total), detailFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {detailFactura.moneda === "USD" && detailFactura.tipo_cambio && (
                    <div className="flex items-center justify-between px-4 py-1.5 text-xs border-t border-zinc-100 dark:border-zinc-800 text-zinc-400">
                      <span>Operacion en USD — TC: {Number(detailFactura.tipo_cambio).toLocaleString("es-AR")}</span>
                      <span className="font-mono">USD {(Number(detailFactura.total) / Number(detailFactura.tipo_cambio)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notas de crédito relacionadas */}
              {detailNCs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1">Notas de crédito</h4>
                  <div className="space-y-1.5">
                    {detailNCs.map((nc) => (
                      <div key={nc.id} className="flex items-center justify-between rounded-lg border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 text-xs">
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
                    <div className="mt-1.5 flex justify-between text-xs text-amber-700 dark:text-amber-400 font-medium px-1">
                      <span>Total acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.total_acreditado), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Acciones */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">Acciones</h4>
                <div className="space-y-2">
                  <BotonDejarRevisar key={detailFactura.id} className="w-full justify-center py-2" datos={{ entidad_tipo: "factura_venta", entidad_id: detailFactura.id, titulo: `${detailFactura.tipo} ${detailFactura.punto_venta}-${detailFactura.numero}`, importe: detailFactura.total, moneda: detailFactura.moneda === "USD" ? "USD" : "ARS", cliente_id: detailFactura.cliente_id }} />
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
                  {/* Factura ya cobrada: igual se puede emitir la NC; el importe queda a favor del cliente. */}
                  {detailFactura.estado === "pagada" && ["FA", "FB", "FCEA", "FCEB"].includes(detailFactura.tipo) && (
                    <button onClick={() => openNcModal(detailFactura)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-950/30">
                      <FileText className="h-4 w-4" /> Emitir Nota de Crédito <span className="text-xs text-zinc-400">(queda a favor del cliente)</span>
                    </button>
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
        ordenPago={fxCobro.ordenPago}
        ordenPagoAvisos={fxCobro.ordenPagoAvisos}
        onCobrarOrdenCompleta={opSecuencia ? undefined : (orden)=>{void iniciarCobroOrdenPago(orden, fxCobro.clienteId);}}
        onClose={()=>{setFxCobro(null);setOpSecuencia(null);setOpSecuenciaPaso(null);}}
        onSuccess={()=>{setFxCobro(null);setCobroModalId(null);setCmOpen(false);setCmLiquidacionOpen(false);setOpSecuencia(null);setOpSecuenciaPaso(null);fetchData();}}
      />}
      {opSecuencia && opSecuenciaPaso === "ars" && (
        <CobroMasivoLiquidacion
          facturas={opSecuencia.ars}
          clienteId={opSecuencia.clienteId}
          clienteNombre={opSecuencia.clienteNombre}
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          moneda="ARS"
          ordenPago={opSecuencia.parsed}
          ordenPagoAvisos={avisosPaso(opSecuencia, "ars")}
          onClose={() => { setOpSecuencia(null); setOpSecuenciaPaso(null); }}
          onSuccess={() => { if (opSecuencia.usd.length) abrirPasoUsd(opSecuencia); else { setOpSecuencia(null); setOpSecuenciaPaso(null); } fetchData(); }}
        />
      )}
      {cobroModalId && (() => {
        const f = facturas.find(ff => ff.id === cobroModalId);
        if (!f) return null;
        const saldo = Number(f.total) - Number(f.total_acreditado || 0) - cobroPrevios;
        const totalLineas = cobroLineas.reduce((s, l) => s + montoNum(l.monto), 0);
        const lineasValidas = cobroLineas.some(l => montoNum(l.monto) > 0);
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
                      {cobroPrevios > 0 && `Cobrado antes: ${formatCurrency(cobroPrevios, f.moneda as "ARS" | "USD")} — `}
                      Saldo de la factura: {formatCurrency(Math.max(0, saldo), f.moneda as "ARS" | "USD")} — Queda después de este cobro: {formatCurrency(Math.max(0, saldo - totalLineas), f.moneda as "ARS" | "USD")}
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
                          <select value={linea.tipo === "cheque_recibido" ? "echeq" : linea.tipo} onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, tipo: e.target.value as any } : l))}
                            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm dark:text-white">
                            <option value="transferencia">Transferencia</option>
                            <option value="efectivo">Efectivo</option>
                            <option value="tarjeta">Tarjeta</option>
                            <option value="echeq">Cheque / E-Cheq</option>
                            <option value="retencion_iibb">Ret. IIBB</option>
                            <option value="retencion_ganancias">Ret. Ganancias</option>
                            <option value="retencion_iva">Ret. IVA</option>
                            <option value="cobro">Otro</option>
                          </select>
                          <input type="text" inputMode="decimal" placeholder="Monto" value={linea.monto}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              setCobroLineas(prev => {
                                const updated = prev.map((l, i) => i === idx ? { ...l, monto: newVal } : l);
                                // Auto-ajustar transferencia/efectivo si se modificó una retención
                                const isRetencion = updated[idx]?.tipo.startsWith("retencion_");
                                const firstPayIdx = updated.findIndex(l => l.tipo === "transferencia" || l.tipo === "efectivo" || l.tipo === "cheque_recibido" || l.tipo === "echeq");
                                if (isRetencion && firstPayIdx >= 0 && firstPayIdx !== idx) {
                                  const totalRet = updated.reduce((s, l, i) => i !== firstPayIdx ? s + montoNum(l.monto) : s, 0);
                                  updated[firstPayIdx] = { ...updated[firstPayIdx], monto: toDecimalInput(Math.max(0, Math.round((saldo - totalRet) * 100) / 100)) };
                                }
                                return updated;
                              });
                            }}
                            className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono dark:text-white" />
                          {!linea.tipo.startsWith("retencion_") && (
                            <button type="button" title="Completar con el saldo pendiente" onClick={() => setCobroLineas(prev => { const otros = prev.reduce((s, l, i) => i === idx ? s : s + montoNum(l.monto), 0); return prev.map((l, i) => i === idx ? { ...l, monto: toDecimalInput(Math.max(0, Math.round((saldo - otros) * 100) / 100)) } : l); })} className="shrink-0 rounded p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles className="h-3.5 w-3.5" /></button>
                          )}
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
                            <label className="flex items-center gap-2 self-end rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                              <input
                                type="checkbox"
                                checked={linea.tipo === "cheque_recibido"}
                                onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, tipo: e.target.checked ? "cheque_recibido" : "echeq" } : l))}
                                className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                              />
                              Cheque físico
                            </label>
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
          onCobrarOrdenCompleta={(orden) => { void iniciarCobroOrdenPago(orden, cmClienteId); }}
        />
      )}

      {/* ── NC Modal ─────────────────────────────────────────────── */}
      {ncOpen && ncFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Nota de crédito</h2>
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

                {ncEsFce && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                    Se emitirá una {ncTipo === "NCEA" ? "Nota de Crédito Electrónica MiPyME A — código ARCA 203" : "Nota de Crédito Electrónica MiPyME B — código ARCA 208"}, vinculada a la FCE original. El modo manual está deshabilitado para evitar un comprobante fiscal incorrecto.
                  </div>
                )}

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
                      disabled={ncEsFce}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ncManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {ncEsFce
                        ? "ARCA no está configurado. Una nota MiPyME no puede emitirse manualmente."
                        : "ARCA no configurado — solo modo manual disponible."}
                    </p>
                  )}
                  {ncEsFce && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Se emitirá {ncTipo} — código ARCA {ncTipo === "NCEA" ? "203" : "208"} — asociada a la FCE original. El modo manual no corresponde a este comprobante.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha de emisión *</label>
                    <input
                      type="date"
                      value={ncFecha}
                      min={ncManual ? dateWindowMin : ncFiscalMinDate}
                      max={todayAR()}
                      disabled={!ncManual && !ncFiscalDates.ready}
                      onChange={(e) => setNcFecha(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    {!ncManual && (
                      <div className="mt-1 text-xs text-zinc-500">
                        {ncFiscalDates.error ? <><span className="text-red-600">{ncFiscalDates.error}</span> <button type="button" onClick={ncFiscalDates.retry} className="underline">Reintentar</button></>
                          : !ncFiscalDates.ready ? "Consultando fechas habilitadas en ARCA…"
                          : <>{ncFiscalDates.warning ? <span className="text-amber-600 dark:text-amber-400">{ncFiscalDates.warning} </span> : <>Primera fecha habilitada: {formatDate(ncFiscalMinDate)}. </>}{ncFecha < ncFiscalMinDate && <span className="text-red-600">Cambiá la fecha seleccionada.</span>}</>}
                      </div>
                    )}
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
                    <div className="flex justify-between"><span className="text-zinc-500">Saldo pendiente</span><span className="font-mono font-semibold">{formatCurrency(ncSaldoPendiente, ncFactura.moneda as "USD" | "ARS")}</span></div>
                    {ncCobradoPrevio > 0 && <div className="mt-1 flex justify-between text-zinc-500"><span>Cobros previos</span><span className="font-mono">{formatCurrency(ncCobradoPrevio, ncFactura.moneda as "USD" | "ARS")}</span></div>}
                  </div>
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

                <div>
                  <label className="mb-2 block text-sm font-medium dark:text-zinc-300">Alcance de la nota de crédito</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ["total", "Total"],
                      ["items", "Por ítems"],
                      ["amount", "Importe libre"],
                    ] as const).map(([mode, label]) => (
                      <button key={mode} type="button" onClick={() => {
                        setNcMode(mode);
                        if (mode !== "amount") setNcItems(ncOriginalItems.map((item) => ({...item})));
                        setNcError("");
                      }} className={`rounded-lg border px-3 py-2 text-xs font-medium ${ncMode === mode ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {ncMode === "amount" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Importe total a acreditar</label>
                      <input type="text" inputMode="decimal" value={ncAmount} onChange={(e) => setNcAmount(e.target.value)} placeholder="0,00"
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                      <p className="mt-1 text-xs text-zinc-500">Acepta coma o punto decimal.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">IVA aplicado</label>
                      <select value={ncAmountIva} onChange={(e) => setNcAmountIva(Number(e.target.value))}
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                        <option value={21}>21%</option><option value={10.5}>10,5%</option><option value={27}>27%</option><option value={0}>0%</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Items NC — editables para NC parcial */}
                {ncMode !== "amount" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium dark:text-zinc-300">
                      Items a acreditar <span className="text-xs font-normal text-zinc-400">{ncMode === "items" ? "(cantidades y precios editables)" : "(factura completa)"}</span>
                    </label>
                    {ncMode === "items" && <button
                      onClick={() => setNcItems(p => [...p, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>}
                  </div>
                  <div className="space-y-2">
                    {ncItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaANc ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripción</label>}
                          <input disabled={ncMode === "total"} value={item.descripcion} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))} placeholder="Descripción" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:opacity-70" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cant.</label>}
                          <input disabled={ncMode === "total"} type="number" min={0} step="0.01" value={item.cantidad} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white disabled:opacity-70" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaANc ? "Neto unit." : "Precio"}</label>}
                          <input disabled={ncMode === "total"} type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) } : it))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white disabled:opacity-70" />
                        </div>
                        {isFacturaANc && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select disabled={ncMode === "total"} value={item.iva_porcentaje} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, iva_porcentaje: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white disabled:opacity-70">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {ncMode === "items" && ncItems.length > 1 && (
                            <button onClick={() => setNcItems(p => p.filter((_, i) => i !== idx))} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}

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

                {ncExcedeSaldo && (
                  <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>El total de la NC supera el saldo pendiente. Se emitirá igualmente y la diferencia quedará identificada como saldo a favor del cliente.</span>
                  </div>
                )}

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
                {ncSuccessWarning && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{ncSuccessWarning}</p>}
                {ncPrPregunta && (
                  <div className="w-full rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm dark:border-orange-900 dark:bg-orange-950/20">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">¿Se vuelve a facturar el {ncPrPregunta.prNumero}?</p>
                    <p className="mt-0.5 text-xs text-zinc-500">La factura quedó anulada y el PR volvió a &quot;Facturar&quot;. Si no se refactura, sigue contando como venta.</p>
                    {ncPrPregunta.resuelto === "" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button onClick={() => setNcPrPregunta((p) => p ? { ...p, resuelto: "si" } : p)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200">Sí, se refactura (queda en Ventas)</button>
                        <button onClick={async () => {
                          const p = ncPrPregunta;
                          try {
                            const nota = `[${new Date().toLocaleDateString("es-AR")}] NC total ${ncResult.split(" — ")[0]}: no se vuelve a facturar. PR cerrado como rechazado.`;
                            const { error } = await (supabase as any).from("presupuestos").update({ estado: "rechazado", motivo_rechazo: "NC total, no se vuelve a facturar", respondido_at: new Date().toISOString(), notas_internas: p.notas ? `${p.notas}
${nota}` : nota }).eq("id", p.prId).eq("sociedad_id", sociedadActiva?.id);
                            if (error) throw error;
                            setNcPrPregunta({ ...p, resuelto: "no" });
                          } catch { setNcPrPregunta((q) => q ? { ...q, resuelto: "error" } : q); }
                        }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600">No, cerrar el PR (rechazado)</button>
                      </div>
                    )}
                    {ncPrPregunta.resuelto === "si" && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Listo: el PR queda en Finanzas Lazza → Facturar para re-facturar (corregí el precio antes si hace falta).</p>}
                    {ncPrPregunta.resuelto === "no" && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Listo: el PR quedó como rechazado, con una nota interna, y ya no cuenta como venta.</p>}
                    {ncPrPregunta.resuelto === "error" && <p className="mt-2 text-xs text-red-600">No se pudo cerrar el PR. Podés pasarlo a Rechazado a mano desde Presupuestos.</p>}
                  </div>
                )}
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
        guardarContacto={(() => { const cid = facturas.find(ff => ff.id === emailModal.facturaId)?.cliente_id; return cid ? { entityType: "cliente" as const, entityId: cid, cargo: "Administración" } : undefined; })()}
        generatePdf={async () => {
          const f = facturas.find(ff => ff.id === emailModal.facturaId);
          if (!f || !sociedadActiva) throw new Error("Factura no encontrada");
          // Always fetch fresh items for the specific factura
          const pdfItems = await fetchFacturaItems(f.id);
          const html = buildFacturaHTML(f, pdfItems);
          if (!html) throw new Error("No se pudo generar el PDF");
          return htmlToPdfBase64(html);
        }}
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        onSuccess={async (emailId, enviadoA) => {
          const sentAt = new Date().toISOString();
          const facturaId = emailModal.facturaId;
          // A quién salió de verdad (lo que quedó en "Para"), no el mail sugerido al abrir.
          const sentTo = enviadoA?.length ? enviadoA.join(", ") : emailModal.to || null;
          const updateData: Record<string, unknown> = { email_enviado_at: sentAt, email_enviado_a: sentTo, email_estado: "sent" };
          if (emailId) updateData.email_resend_id = emailId;
          const { error } = await (supabase as any)
            .from("facturas")
            .update(updateData)
            .eq("id", facturaId);
          if (error) {
            alert(`El email se envió, pero no se pudo guardar la marca de envío: ${error.message}`);
            return;
          }
          setFacturas((prev) => prev.map((factura) =>
            factura.id === facturaId ? { ...factura, email_enviado_at: sentAt, email_enviado_a: sentTo, email_resend_id: emailId || null, email_estado: "sent" as const } : factura
          ));
          setDetailFactura((prev) =>
            prev?.id === facturaId ? { ...prev, email_enviado_at: sentAt, email_enviado_a: sentTo, email_resend_id: emailId || null, email_estado: "sent" as const } : prev
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
