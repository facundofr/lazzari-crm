"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency, formatDate, formatDateTime, todayAR } from "@/lib/utils";
import { canMatchBankMovement } from "@/lib/extracto-match";
import CobroMasivoLiquidacion, { type LiquidacionFactura } from "@/components/cobro-masivo-liquidacion";
import { mockMovimientos, mockClients, mockProveedores, mockExtractos, mockLineasCredito, mockGastosFijos, mockObjetivos } from "@/lib/mock-data";
import type { Movimiento, ExtractoMovimiento, LineaCredito, GastoFijo, Objetivo } from "@/lib/types";
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2, CalendarDays, Clock, Plus, Pencil, Target, FileText, Receipt, Ban, Search, Printer, Download, Paperclip, Eye, ShieldCheck, ShoppingCart, Package, DollarSign, Minimize2, Maximize2, Square, Sparkles, Mail, MailCheck, Send } from "lucide-react";
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { generateOrdenPagoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import CargarFacturaOC, { type OCParaVincular } from "@/components/cargar-factura-oc";
import CargaMasivaFacturasCompra from "@/components/carga-masiva-facturas-compra";
import { paymentDocumentFields } from "@/lib/payment-document-parser";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";

const FacturacionEmbed = lazy(() => import("@/app/(crm)/facturacion/facturacion-content").then(m => ({ default: m.FacturacionContent })));

const tipoConfig: Record<string, { label: string; variant: "success" | "danger" | "warning" | "info" | "outline"; icon: typeof ArrowDownLeft }> = {
  cobro: { label: "Cobro", variant: "success", icon: ArrowDownLeft },
  pago: { label: "Pago", variant: "danger", icon: ArrowUpRight },
  cheque_emitido: { label: "Cheque emitido", variant: "warning", icon: CreditCard },
  cheque_recibido: { label: "Cheque recibido", variant: "info", icon: CreditCard },
  transferencia: { label: "Transferencia", variant: "outline", icon: Landmark },
  efectivo: { label: "Efectivo", variant: "outline", icon: Wallet },
  deposito: { label: "Deposito", variant: "outline", icon: Landmark },
  ajuste: { label: "Ajuste", variant: "outline", icon: Wallet },
  retencion_iva: { label: "Ret. IVA", variant: "warning", icon: Wallet },
  retencion_ganancias: { label: "Ret. Ganancias", variant: "warning", icon: Wallet },
  retencion_iibb: { label: "Ret. IIBB", variant: "warning", icon: Wallet },
  retencion_suss: { label: "Ret. SUSS", variant: "warning", icon: Wallet },
};

type FinanzasTab = "movimientos" | "facturas_compra" | "ordenes_pago" | "gastos_manuales" | "echeqs" | "cc_clientes" | "cc_proveedores" | "extractos" | "lineas_credito" | "gastos_fijos" | "objetivos" | "facturacion" | "retenciones";

// ── Echeq types ──
interface EcheqRow {
  id: string;
  numero: string;
  tipo_cheque: "echeq" | "fisico";
  banco_emisor: string | null;
  cuit_emisor: string | null;
  monto: number;
  moneda: "USD" | "ARS";
  fecha_emision: string | null;
  fecha_pago: string;
  estado: "en_cartera" | "endosado" | "depositado" | "cobrado" | "rechazado" | "vencido" | "pendiente" | "entregado" | "anulado";
  direccion: "emitido" | "recibido";
  chequera: string | null;
  origen_tipo: string | null;
  origen_id: string | null;
  origen_nombre: string | null;
  destino_tipo: string | null;
  destino_id: string | null;
  destino_nombre: string | null;
  fecha_endoso: string | null;
  fecha_deposito: string | null;
  observaciones: string | null;
  sociedad_id: string | null;
  user_id: string | null;
  created_at: string;
}

interface ClienteOption {
  id: string;
  razon_social: string;
}

const echeqEstadoConfig: Record<string, { label: string; variant: "info" | "outline" | "warning" | "success" | "danger" }> = {
  en_cartera: { label: "En cartera", variant: "info" },
  endosado: { label: "Endosado", variant: "outline" },
  depositado: { label: "Depositado", variant: "warning" },
  cobrado: { label: "Cobrado", variant: "success" },
  rechazado: { label: "Rechazado", variant: "danger" },
  vencido: { label: "Vencido", variant: "outline" },
  pendiente: { label: "Pendiente", variant: "warning" },
  entregado: { label: "Entregado", variant: "info" },
  anulado: { label: "Anulado", variant: "danger" },
};

const emptyEcheqForm = {
  direccion: "recibido" as "emitido" | "recibido",
  tipo_cheque: "fisico" as "echeq" | "fisico",
  numero: "",
  banco_emisor: "",
  cuit_emisor: "",
  chequera: "",
  monto: 0,
  moneda: "ARS" as "ARS" | "USD",
  fecha_emision: "",
  fecha_pago: todayAR(),
  origen_tipo: "cliente" as "cliente" | "otro",
  origen_id: "",
  origen_nombre: "",
  observaciones: "",
};

// ── OP & Gastos types ──
interface ProveedorOption {
  id: string;
  razon_social: string;
  email?: string | null;
  cuit?: string | null;
  condicion_iva?: string | null;
  alicuota_ganancias?: number | null;
  concepto_retencion_ganancias?: string | null;
  exclusion_retencion?: boolean;
  exclusion_retencion_desde?: string | null;
  exclusion_retencion_hasta?: string | null;
  exclusion_retencion_cert?: string | null;
  forma_pago?: string | null;
  banco?: string | null;
  cbu?: string | null;
  alias_bancario?: string | null;
  numero_cuenta?: string | null;
  titular_cuenta?: string | null;
  tipo_cuenta?: string | null;
}

interface OrdenPagoRow {
  id: string;
  numero?: string;
  fecha: string;
  proveedor_id: string;
  proveedor_nombre: string;
  proveedor_email?: string | null;
  proveedor_cuit?: string | null;
  monto_bruto: number;
  retencion_pct: number;
  monto_retencion: number;
  retencion_ganancias_pct: number;
  retencion_ganancias_monto: number;
  neto: number;
  moneda: "ARS" | "USD";
  medio_pago: string;
  medios_pago?: OpMedioPago[];
  cheque_cruce_id?: string;
  notas: string;
  estado: "pendiente" | "pagada" | "anulada";
  comprobante_url?: string;
  certificado_retencion_url?: string;
  archivo_url?: string;
  archivo_nombre?: string;
  archivos?: { url: string; nombre: string }[];
  sobre_verde?: boolean;
  email_enviado_at?: string | null;
  created_at: string;
}

interface GastoManualRow {
  id: string;
  fecha: string;
  descripcion: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  categoria: string;
  tipo_gasto: string;
  tipo_recurrencia?: "fijo" | "eventual";
  medio_pago: string;
  comprobante_url?: string;
  monto: number;
  moneda: "ARS" | "USD";
  notas: string;
  created_at: string;
}

interface FacturaCompraRow {
  id: string;
  numero_factura: string;
  proveedor_id: string;
  proveedor_nombre: string;
  orden_compra_id?: string;
  oc_numero?: string;
  fecha: string;
  fecha_vencimiento?: string;
  subtotal: number;
  iva_porcentaje: number;
  iva: number;
  percepciones: number;
  total: number;
  moneda: "ARS" | "USD";
  estado: "pendiente" | "pagada" | "anulada" | "recibida" | "pendiente_aprobacion";
  tipo: "mercaderia" | "solo_iva" | "transporte";
  tipo_comprobante?: string;
  notas: string;
  costo_real?: number;
  created_at: string;
  archivo_url?: string;
  archivo_nombre?: string;
  solo_iva?: boolean;
  cae?: string;
  percepciones_detalle?: { tipo: string; monto: number; localidad?: string }[];
  op_vinculada?: { id: string; numero: string; estado: string; fecha: string; sobre_verde?: boolean } | null;
  pago_directo?: number;
  ocs_vinculadas?: { numero: string }[];
}

interface OCOption {
  id: string;
  numero: string;
  proveedor_id: string;
  total: number;
  moneda: "ARS" | "USD";
  estado?: string;
  fecha?: string;
  proveedores?: { razon_social: string } | null;
}

const emptyFCForm = {
  tipo_fc: "solo_iva" as "mercaderia" | "solo_iva",
  tipo_comprobante: "FC A",
  numero_factura: "",
  proveedor_id: "",
  orden_compra_id: "",
  fecha: todayAR(),
  fecha_vencimiento: "",
  subtotal: 0,
  iva_porcentaje: 21,
  percepciones: 0,
  percepciones_detalle: [] as { tipo: "iibb" | "ganancias" | "iva" | "municipal"; monto: number; localidad?: string }[],
  moneda: "ARS" as "ARS" | "USD",
  cae: "",
  notas: "",
  solo_iva: false,
  costo_real: 0,
};

interface FCItem {
  tempId: string;
  producto_id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  unidad: string;
  iva_porcentaje: number;
}

const fcItemNeto = (item: Pick<FCItem, "cantidad" | "precio_unitario" | "descuento_porcentaje">) => (
  Number(item.cantidad) * Number(item.precio_unitario) * (1 - Number(item.descuento_porcentaje || 0) / 100)
);

const GASTO_CATEGORIAS = ["Transporte", "Servicios", "Materiales", "Varios", "Comisiones", "Impuestos"] as const;

const TIPO_GASTO_OPTIONS = [
  { value: "general", label: "General" },
  { value: "servicios", label: "Servicios" },
  { value: "impuestos", label: "Impuestos" },
  { value: "alquiler", label: "Alquiler" },
  { value: "seguros", label: "Seguros" },
  { value: "transporte", label: "Transporte" },
  { value: "varios", label: "Varios" },
] as const;

const tipoGastoVariant: Record<string, "success" | "danger" | "warning" | "info" | "outline"> = {
  general: "outline",
  servicios: "info",
  impuestos: "danger",
  alquiler: "warning",
  seguros: "success",
  transporte: "info",
  varios: "outline",
};

interface OpMedioPago {
  tempId: string;
  tipo: "cheque" | "cheque_propio" | "deposito" | "transferencia" | "echeq" | "efectivo" | "tarjeta";
  monto: number;
  fecha: string;
  banco: string;
  /** Texto ingresado cuando se elige el banco "Otro". */
  banco_otro?: string;
  numero_cheque: string;
  moneda: "ARS" | "USD";
  cotizacion: number;
  echeq_id?: string; // if selecting from cartera
  comprobante_url?: string;
  comprobante_nombre?: string;
}
const BANCOS_ARGENTINA = [
  "Banco Galicia", "Banco Nación", "Banco Provincia", "Banco Santander",
  "BBVA", "HSBC", "ICBC", "Banco Macro", "Banco Credicoop",
  "Brubank", "Mercado Pago", "Ualá", "Otro",
];
const makeOpMedio = (moneda: "ARS" | "USD" = "ARS"): OpMedioPago => ({
  tempId: Math.random().toString(36).slice(2),
  tipo: "transferencia",
  monto: 0,
  fecha: todayAR(),
  banco: "",
  numero_cheque: "",
  moneda,
  cotizacion: 1,
});

const emptyOPForm = {
  proveedor_id: "",
  moneda: "ARS" as "ARS" | "USD",
  aplica_ganancias: false,
  retencion_ganancias_pct: 0,
  notas: "",
  fecha: todayAR(),
  monto_manual: 0,
  usar_monto_manual: false,
  iva_manual_pct: 21 as number,
  sobre_verde: false,
};

const emptyGastoManualForm = {
  descripcion: "",
  proveedor_id: "",
  categoria: "Varios" as string,
  tipo_gasto: "general" as string,
  tipo_recurrencia: "eventual" as "fijo" | "eventual",
  medio_pago: "efectivo" as string,
  monto: 0,
  moneda: "ARS" as "ARS" | "USD",
  notas: "",
  fecha: todayAR(),
};

// ── Helper types for Supabase rows (snake_case) ──
interface MovimientoRow {
  id: string;
  tipo: Movimiento["tipo"];
  cliente_id?: string;
  proveedor_id?: string;
  descripcion: string;
  monto: number;
  moneda?: string;
  fecha: string;
  factura_id?: string;
  factura_compra_id?: string;
  conciliado: boolean;
  created_at: string;
  anulado?: boolean;
  monto_original?: number | null;
  anulado_at?: string | null;
  liquidacion_fx_id?: string | null;
  clientes?: { razon_social: string } | null;
  proveedores?: { razon_social: string } | null;
}

interface CCRow {
  id: string;
  razon_social: string;
  cuit: string | null;
  rubro?: string;
  dias_cuenta_corriente: number;
  forma_pago: string;
  limite_credito: number;
  saldo_cuenta_corriente: number;
}

interface ExtractoMovimientoRow {
  id: string;
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: number;
  tipo: "credito" | "debito";
  estado: "matcheado" | "pendiente" | "ignorado";
  match_cliente_id?: string;
  match_proveedor_id?: string;
  match_factura_id?: string;
}

interface ExtractoRow {
  id: string;
  banco: string;
  cuenta: string;
  periodo: string;
  total_creditos: number;
  total_debitos: number;
  estado: "procesando" | "parcial" | "conciliado";
  created_at: string;
  extracto_movimientos: ExtractoMovimientoRow[];
}

function parseExtractoCsv(text: string, moneda?: "ARS" | "USD") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("El CSV no contiene movimientos");
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line: string) => {
    const cells: string[] = [];
    let value = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === delimiter && !quoted) { cells.push(value.trim()); value = ""; } else value += ch;
    }
    cells.push(value.trim());
    return cells;
  };
  const headers = split(lines[0]).map((h) => h.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const index = (...names: string[]) => headers.findIndex((h) => names.some((name) => h.includes(name)));
  const dateIdx = index("fecha", "date");
  const descIdx = index("descripcion", "concepto", "detalle", "description");
  const refIdx = index("referencia", "referencia", "comprobante", "nro");
  const creditIdx = index("credito", "credit", "ingreso");
  const debitIdx = index("debito", "debit", "egreso");
  // Saldo is a running balance, never the amount of a bank movement.
  const amountIdx = index("importe", "monto", "amount");
  if (dateIdx < 0 || (amountIdx < 0 && creditIdx < 0 && debitIdx < 0)) {
    throw new Error("El CSV debe tener columnas Fecha e Importe (o Crédito/Débito)");
  }
  const number = (value: string) => {
    const explicitCurrency = String(value || "").trim().match(/^(ARS|USD)\s*/i)?.[1]?.toUpperCase();
    if (explicitCurrency && moneda && explicitCurrency !== moneda) throw new Error(`El archivo contiene importes en ${explicitCurrency}, pero la cuenta se indicó en ${moneda}`);
    let clean = String(value || "").trim().replace(/\s/g, "").replace(/^(?:ARS|USD|\$)/i, "");
    if (!clean || clean === "-") return 0;
    if (/^\(.+\)$/.test(clean)) clean = `-${clean.slice(1, -1)}`;
    if (clean.includes(",") && clean.includes(".")) {
      clean = clean.lastIndexOf(",") > clean.lastIndexOf(".")
        ? clean.replace(/\./g, "").replace(",", ".")
        : clean.replace(/,/g, "");
    } else if (clean.includes(",")) clean = clean.replace(",", ".");
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(clean)) throw new Error(`Importe inválido o ambiguo: ${value}`);
    const n = Number(clean);
    if (!Number.isFinite(n)) throw new Error(`Importe inválido: ${value}`);
    return n;
  };
  const date = (value: string) => {
    const raw = String(value || "").trim();
    const m = raw.match(/^(\d{1,2})[\\/-](\d{1,2})[\\/-](\d{2,4})$/);
    const iso = m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : raw;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Fecha inválida: ${raw}. Usá DD/MM/AAAA o AAAA-MM-DD.`);
    const parsed = new Date(`${iso}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error(`Fecha inválida: ${raw}`);
    return iso;
  };
  const movements = lines.slice(1).map((line, rowIndex) => {
    const cells = split(line);
    if (cells.length !== headers.length) throw new Error(`Fila ${rowIndex + 2}: cantidad de columnas inválida`);
    const credit = creditIdx >= 0 ? number(cells[creditIdx]) : 0;
    const debit = debitIdx >= 0 ? number(cells[debitIdx]) : 0;
    if (credit !== 0 && debit !== 0) throw new Error(`Fila ${rowIndex + 2}: crédito y débito simultáneos; revisá el archivo`);
    const hasSides = creditIdx >= 0 || debitIdx >= 0;
    const signed = amountIdx >= 0 ? number(cells[amountIdx]) : 0;
    const amount = hasSides ? Math.abs(credit || debit) : Math.abs(signed);
    if (!amount) return null;
    const isCredit = hasSides ? (credit !== 0 ? credit > 0 : debit < 0) : signed > 0;
    return { fecha: date(cells[dateIdx]), descripcion: cells[descIdx] || "Movimiento bancario", referencia: refIdx >= 0 ? cells[refIdx] : "", monto: amount, tipo: isCredit ? "credito" as const : "debito" as const };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!movements.length) throw new Error("El CSV no contiene movimientos con importe");
  return movements;
}

interface LineaCreditoRow {
  id: string;
  entidad: string;
  tipo: "bancaria" | "proveedor";
  proveedor_id?: string;
  monto_total: number;
  monto_utilizado: number;
  monto_disponible: number;
  moneda: "USD" | "ARS";
  tasa?: number;
  vencimiento: string;
  estado: "activa" | "vencida" | "suspendida";
  notas?: string;
  created_at?: string;
  proveedores?: { razon_social: string } | null;
}

const emptyMovForm = {
  tipo: "cobro" as "cobro" | "pago" | "cheque_emitido" | "cheque_recibido" | "transferencia" | "efectivo",
  descripcion: "",
  monto: 0,
  fecha: todayAR(),
  moneda: "ARS" as "USD" | "ARS",
  cliente_id: "",
  proveedor_id: "",
};

export default function FinanzasPage() {
  const { sociedadActiva, profile } = useUser();
  const [tab, setTab] = useState<FinanzasTab>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("factura")) return "facturacion";
    }
    return "movimientos";
  });
  const [filterExtracto, setFilterExtracto] = useState<"todos" | "matcheado" | "pendiente">("todos");
  const [loading, setLoading] = useState(true);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMovId, setEditingMovId] = useState<string | null>(null);
  const [movForm, setMovForm] = useState(emptyMovForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Movimiento detail panel
  const [selectedMov, setSelectedMov] = useState<MovimientoRow | null>(null);
  const [relatedMovs, setRelatedMovs] = useState<MovimientoRow[]>([]);
  const [relatedFactura, setRelatedFactura] = useState<{ tipo: string; punto_venta: number; numero: number; total: number; estado: string; moneda: string } | null>(null);

  async function openMovDetail(mov: MovimientoRow) {
    setSelectedMov(mov);
    setRelatedMovs([]);
    setRelatedFactura(null);
    if (mov.factura_id) {
      // Fetch all movimientos for this factura (to see the full cobro)
      let qRels = supabase.from("movimientos")
        .select("*, clientes(razon_social), proveedores(razon_social)")
        .eq("factura_id" as any, mov.factura_id)
        .order("created_at", { ascending: true });
      if (sociedadActiva?.id) qRels = qRels.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: rels } = await qRels;
      if (rels) setRelatedMovs(rels as MovimientoRow[]);
      // Fetch factura info
      let qFact = supabase.from("facturas")
        .select("tipo, punto_venta, numero, total, estado, moneda")
        .eq("id", mov.factura_id);
      if (sociedadActiva?.id) qFact = qFact.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: fc } = await qFact.single();
      if (fc) setRelatedFactura(fc as any);
    }
  }

  // Data state — initialised with mock data as fallback
  const [movimientos, setMovimientos] = useState<MovimientoRow[]>([]);
  const [ccClientes, setCcClientes] = useState<CCRow[]>([]);
  const [ccProveedores, setCcProveedores] = useState<CCRow[]>([]);
  const [ccClienteSearch, setCcClienteSearch] = useState("");
  const [ccProveedorSearch, setCcProveedorSearch] = useState("");
  const [movClienteSearch, setMovClienteSearch] = useState("");
  const [movProvSearch, setMovProvSearch] = useState("");
  const [extractos, setExtractos] = useState<ExtractoRow[]>([]);
  const [extractoUploading, setExtractoUploading] = useState(false);
  const [extractoUploadError, setExtractoUploadError] = useState("");
  const [extractoMoneda, setExtractoMoneda] = useState<"ARS" | "USD" | "">("");
  const [lineasCredito, setLineasCredito] = useState<LineaCreditoRow[]>([]);
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([]);
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);

  const handleExtractoUpload = useCallback(async (file: File) => {
    if (!sociedadActiva?.id || !profile?.id) {
      setExtractoUploadError("Seleccioná una sociedad antes de cargar el extracto.");
      return;
    }
    setExtractoUploading(true);
    setExtractoUploadError("");
    try {
      if (!extractoMoneda) throw new Error("Indicá la moneda de la cuenta bancaria antes de cargar el extracto.");
      if (!file.name.toLocaleLowerCase().endsWith(".csv")) throw new Error("Por ahora la carga automática admite CSV. Exportá el extracto bancario como CSV e intentá nuevamente.");
      const movements = parseExtractoCsv(await file.text(), extractoMoneda);
      const credits = movements.filter((m) => m.tipo === "credito").reduce((sum, m) => sum + m.monto, 0);
      const debits = movements.filter((m) => m.tipo === "debito").reduce((sum, m) => sum + m.monto, 0);
      const period = movements.length ? movements.map((m) => m.fecha).sort()[0].slice(0, 7) : new Date().toISOString().slice(0, 7);
      let archivo: string | null = null;
      const storagePath = `${sociedadActiva.id}/extractos/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const upload = await (supabase as any).storage.from("comprobantes").upload(storagePath, file, { upsert: false });
      if (upload.error) throw new Error(`No se pudo guardar el archivo del extracto: ${upload.error.message}`);
      archivo = storagePath;
      const { data: extracto, error } = await (supabase as any).from("extractos_bancarios").insert({
        sociedad_id: sociedadActiva.id,
        banco: file.name.replace(/\.[^.]+$/, "") || "Banco",
        cuenta: "—",
        moneda: extractoMoneda,
        periodo: period,
        fecha_upload: new Date().toISOString(),
        archivo,
        total_creditos: credits,
        total_debitos: debits,
        estado: "parcial",
        created_by: profile.id,
      }).select("*, extracto_movimientos(*)").single();
      if (error || !extracto) throw new Error(error?.message || "No se pudo guardar el extracto");
      const { error: rowsError } = await (supabase as any).from("extracto_movimientos").insert(movements.map((m) => ({ ...m, extracto_id: extracto.id, estado: "pendiente" })));
      if (rowsError) {
        await (supabase as any).from("extractos_bancarios").delete().eq("id", extracto.id).eq("sociedad_id", sociedadActiva.id);
        throw new Error(rowsError.message);
      }
      const { data: complete } = await (supabase as any).from("extractos_bancarios").select("*, extracto_movimientos(*)").eq("id", extracto.id).eq("sociedad_id", sociedadActiva.id).single();
      if (complete) setExtractos((prev) => [complete as ExtractoRow, ...prev]);
    } catch (error) {
      setExtractoUploadError(error instanceof Error ? error.message : "No se pudo cargar el extracto");
    } finally {
      setExtractoUploading(false);
    }
  }, [profile?.id, sociedadActiva?.id, extractoMoneda]);

  // Saldos de caja
  const [saldosCaja, setSaldosCaja] = useState<{ id?: string; moneda: string; monto: number }[]>([]);
  const [editingSaldo, setEditingSaldo] = useState<string | null>(null); // moneda being edited
  const [editingSaldoVal, setEditingSaldoVal] = useState("");

  // Gastos fijos modal
  const [gastoModalOpen, setGastoModalOpen] = useState(false);
  const [editingGasto, setEditingGasto] = useState<GastoFijo | null>(null);
  const [gastoForm, setGastoForm] = useState({ descripcion: "", categoria: "general", monto: 0, moneda: "ARS" as "USD" | "ARS", notas: "" });
  const [gastoSaving, setGastoSaving] = useState(false);

  // OP state
  const [ordenesPago, setOrdenesPago] = useState<OrdenPagoRow[]>([]);
  const [opFilterRetencion, setOpFilterRetencion] = useState(false);
  const [opFilterDesde, setOpFilterDesde] = useState("");
  const [opFilterHasta, setOpFilterHasta] = useState("");
  const [opModalOpen, setOpModalOpen] = useState(false);
  const [pagoParcialDirecto, setPagoParcialDirecto] = useState(false);
  const [pagoParcialFCId, setPagoParcialFCId] = useState<string | null>(null);
  const [opForm, setOpForm] = useState(emptyOPForm);
  const [opSaving, setOpSaving] = useState(false);
  const [opError, setOpError] = useState("");
  const [opFiles, setOpFiles] = useState<File[]>([]);
  const [opParsingCount, setOpParsingCount] = useState(0);
  const opParsingFile = opParsingCount > 0;
  const [opProvCondicion, setOpProvCondicion] = useState<string | null>(null);
  const [opCondicionLoading, setOpCondicionLoading] = useState(false);
  const [opManualGanancias, setOpManualGanancias] = useState(false); // user manually toggled retención
  const [opMontoRetencionManual, setOpMontoRetencionManual] = useState<number | null>(null); // manual override of retention amount
  // FC pendientes del proveedor para vincular a la OP
  interface OpFCPendiente { id: string; numero: string; fecha: string; total: number; subtotal: number; iva: number; percepciones: number; saldo_pendiente: number; moneda: string; selected: boolean; monto_a_pagar: number }
  const [opFCPendientes, setOpFCPendientes] = useState<OpFCPendiente[]>([]);
  const [opMedios, setOpMedios] = useState<OpMedioPago[]>([makeOpMedio()]);
  const [opMonthlyBase, setOpMonthlyBase] = useState(0); // Acumulado mensual de bases sin IVA (de OPs previas)
  const [opDatosError, setOpDatosError] = useState("");
  const [opMonthlyRetenido, setOpMonthlyRetenido] = useState(0); // Retenciones ya practicadas en el mes
  const [opFCLoading, setOpFCLoading] = useState(false);
  const [retencionConfig, setRetencionConfig] = useState({
    aplica_iva: true, minimo_iva: 130000, tasa_iva_ri: 10.5,
    aplica_ganancias: true, minimo_ganancias: 224000, tasa_ganancias_ri: 2, tasa_ganancias_no_inscripto: 28,
    minimo_retencion_ganancias: 240,
  });
  const [proveedoresOptions, setProveedoresOptions] = useState<ProveedorOption[]>([]);
  const [chequesRecibidos, setChequesRecibidos] = useState<MovimientoRow[]>([]);
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [selectedOP, setSelectedOP] = useState<OrdenPagoRow | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [editingOP, setEditingOP] = useState(false);
  const [editOPForm, setEditOPForm] = useState<{ fecha: string; moneda: "ARS" | "USD"; notas: string }>({ fecha: "", moneda: "ARS", notas: "" });
  const [savingOP, setSavingOP] = useState(false);
  const [emailModal, setEmailModal] = useState<{ open: boolean; id: string; to: string; subject: string; body: string; filename: string; suggestedEmails: { email: string; label?: string }[]; extraAttachments: { filename: string; url: string }[] }>({ open: false, id: "", to: "", subject: "", body: "", filename: "", suggestedEmails: [], extraAttachments: [] });

  // Gastos manuales state
  const [gastosManuales, setGastosManuales] = useState<GastoManualRow[]>([]);
  const [gmModalOpen, setGmModalOpen] = useState(false);
  const [gmEditingId, setGmEditingId] = useState<string | null>(null);
  const [gmForm, setGmForm] = useState(emptyGastoManualForm);
  const [gmSaving, setGmSaving] = useState(false);
  const [gmError, setGmError] = useState("");
  const [gmProvSearch, setGmProvSearch] = useState("");
  const [gmFile, setGmFile] = useState<File | null>(null);
  const [gmUploading, setGmUploading] = useState(false);

  // Custom gasto categories from configuracion
  const [gastoCategorias, setGastoCategorias] = useState<string[]>([...GASTO_CATEGORIAS]);
  const [newCategoriaInput, setNewCategoriaInput] = useState("");
  const [showCategoriaManager, setShowCategoriaManager] = useState(false);

  // Facturas compra state
  const [facturasCompra, setFacturasCompra] = useState<FacturaCompraRow[]>([]);
  const [fcModalOpen, setFcModalOpen] = useState(false);
  const [fcMassModalOpen, setFcMassModalOpen] = useState(false);
  const [fcForm, setFcForm] = useState(emptyFCForm);
  const [fcSaving, setFcSaving] = useState(false);
  const [fcError, setFcError] = useState("");
  const [fcProvSearch, setFcProvSearch] = useState("");
  const [fcProvFocused, setFcProvFocused] = useState(false);
  const [ocOptions, setOcOptions] = useState<OCOption[]>([]);
  const [fcOCPreviouslyInvoiced, setFcOCPreviouslyInvoiced] = useState<{ total: number; monedas: string[] }>({ total: 0, monedas: [] });
  const [fcOCCheckLoading, setFcOCCheckLoading] = useState(false);
  const [fcFile, setFcFile] = useState<File | null>(null);
  const [fcUploading, setFcUploading] = useState(false);
  const [selectedFC, setSelectedFC] = useState<FacturaCompraRow | null>(null);
  const [selectedFCItems, setSelectedFCItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; descuento_porcentaje: number; unidad: string; iva_porcentaje: number }[]>([]);
  const [editingFC, setEditingFC] = useState(false);
  const [editFCForm, setEditFCForm] = useState<{ numero_factura: string; fecha: string; fecha_vencimiento: string; subtotal: number; iva: number; percepciones: number; moneda: "ARS" | "USD"; notas: string; cae: string }>({ numero_factura: "", fecha: "", fecha_vencimiento: "", subtotal: 0, iva: 0, percepciones: 0, moneda: "ARS", notas: "", cae: "" });
  const [savingFC, setSavingFC] = useState(false);
  const [fcSearchQuery, setFcSearchQuery] = useState("");
  const FC_ESTADO_GROUPS: Record<string, string[]> = {
    emitida_all: ["pendiente_aprobacion", "pendiente", "pagada", "recibida"],
    pendiente_all: ["pendiente_aprobacion", "pendiente"],
    pagada_all: ["pagada", "recibida"],
    anulada: ["anulada"],
  };
  const fcGroupKeys = Object.keys(FC_ESTADO_GROUPS);
  const [fcSelectedEstados, setFcSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const fcIsAll = fcSelectedEstados.has("todos");
  function fcToggleEstado(estado: string) {
    setFcSelectedEstados(prev => {
      if (estado === "todos") return new Set(["todos"]);
      const next = new Set(prev);
      next.delete("todos");
      if (next.has(estado)) next.delete(estado); else next.add(estado);
      if (next.size === 0 || next.size === fcGroupKeys.length) return new Set(["todos"]);
      return next;
    });
  }
  const [fcTipoFilter, setFcTipoFilter] = useState("");
  const [fcSelectedIds, setFcSelectedIds] = useState<Set<string>>(new Set());
  const [newArticleOpen, setNewArticleOpen] = useState(false);
  const [newArticle, setNewArticle] = useState({ codigo: "", descripcion: "", categoria: "", unidad: "UN", precio: 0 });
  const [newArticleSaving, setNewArticleSaving] = useState(false);
  // FC items (mercadería)
  const [fcItems, setFcItems] = useState<FCItem[]>([]);
  const [fcProdSearch, setFcProdSearch] = useState("");
  const [fcProdFocused, setFcProdFocused] = useState(false);
  const [fcProductos, setFcProductos] = useState<{ id: string; codigo: string; nombre: string; precio_costo: number; unidad: string; stock: number }[]>([]);

  useEffect(() => {
    if (fcItems.length === 0) return;
    const calculatedSubtotal = Math.round(fcItems.reduce((sum, item) => sum + fcItemNeto(item), 0) * 100) / 100;
    setFcForm((prev) => Math.abs(prev.subtotal - calculatedSubtotal) < 0.01 ? prev : { ...prev, subtotal: calculatedSubtotal });
  }, [fcItems]);

  async function fetchExistingOCInvoices(ocId: string) {
    const [{ data: junctionLinks, error: junctionError }, { data: legacyInvoices, error: legacyError }] = await Promise.all([
      (supabase as any).from("factura_compra_ocs").select("factura_compra_id, facturas_compra(id, estado, total, percepciones, moneda)").eq("orden_compra_id", ocId),
      (supabase as any).from("facturas_compra").select("id, estado, total, percepciones, moneda").eq("orden_compra_id", ocId),
    ]);
    if (junctionError || legacyError) throw new Error("No se pudo verificar lo ya facturado para la OC.");
    const byId = new Map<string, { total: number; moneda: string }>();
    for (const link of junctionLinks || []) {
      const raw = Array.isArray(link.facturas_compra) ? link.facturas_compra[0] : link.facturas_compra;
      if (!raw || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    for (const raw of legacyInvoices || []) {
      if (!raw || raw.estado === "anulada" || byId.has(raw.id)) continue;
      byId.set(raw.id, { total: Number(raw.total || 0) - Number(raw.percepciones || 0), moneda: raw.moneda || "ARS" });
    }
    return Array.from(byId.values());
  }

  useEffect(() => {
    if (!fcForm.orden_compra_id) {
      setFcOCPreviouslyInvoiced({ total: 0, monedas: [] });
      return;
    }
    let cancelled = false;
    setFcOCCheckLoading(true);
    fetchExistingOCInvoices(fcForm.orden_compra_id)
      .then((invoices) => {
        if (!cancelled) setFcOCPreviouslyInvoiced({
          total: Math.round(invoices.reduce((sum, invoice) => sum + invoice.total, 0) * 100) / 100,
          monedas: Array.from(new Set(invoices.map((invoice) => invoice.moneda))),
        });
      })
      .catch(() => {
        if (!cancelled) setFcOCPreviouslyInvoiced({ total: Number.POSITIVE_INFINITY, monedas: [] });
      })
      .finally(() => { if (!cancelled) setFcOCCheckLoading(false); });
    return () => { cancelled = true; };
  }, [fcForm.orden_compra_id]);

  // FC PDF parsing state
  const [fcPdfParsing, setFcPdfParsing] = useState(false);
  const [fcPdfFile, setFcPdfFile] = useState<File | null>(null);

  // Echeqs state
  const [echeqs, setEcheqs] = useState<EcheqRow[]>([]);
  const [echeqModalOpen, setEcheqModalOpen] = useState(false);
  const [echeqForm, setEcheqForm] = useState(emptyEcheqForm);
  const [echeqSaving, setEcheqSaving] = useState(false);
  const [echeqError, setEcheqError] = useState("");
  const [clientesOptions, setClientesOptions] = useState<ClienteOption[]>([]);
  const [echeqClienteSearch, setEcheqClienteSearch] = useState("");
  const [selectedEcheq, setSelectedEcheq] = useState<EcheqRow | null>(null);
  const [echeqActionModal, setEcheqActionModal] = useState<"endosar" | "depositar" | null>(null);
  const [echeqActionSaving, setEcheqActionSaving] = useState(false);
  const [echeqDestinoTipo, setEcheqDestinoTipo] = useState<"proveedor" | "banco">("proveedor");
  const [echeqDestinoId, setEcheqDestinoId] = useState("");
  const [echeqDestinoNombre, setEcheqDestinoNombre] = useState("");
  const [echeqProvSearch, setEcheqProvSearch] = useState("");
  const [echeqFilterEstado, setEcheqFilterEstado] = useState("");
  const [echeqFilterDireccion, setEcheqFilterDireccion] = useState<"" | "emitido" | "recibido">("");

  // Sync selectedEcheq after data reload
  useEffect(() => {
    if (selectedEcheq) {
      const updated = echeqs.find(e => e.id === selectedEcheq.id);
      if (updated) setSelectedEcheq(updated);
      else setSelectedEcheq(null);
    }
  }, [echeqs, selectedEcheq?.id]);

  // Balance projection
  interface BalanceBand { banda: string; moneda: string; total: number }
  const [balanceData, setBalanceData] = useState<{ cobrar: BalanceBand[]; pagar: BalanceBand[]; echeqs: BalanceBand[] } | null>(null);

  // ── CC Detail (Estado de cuenta) ──
  interface CCFacturaRow { id: string; numero: string; tipo: string; punto_venta: number; fecha: string; vencimiento: string | null; total: number; total_acreditado: number; cobrado: number; moneda: string; estado: string }
  interface CCMovRow { id: string; tipo: string; monto: number; moneda: string; descripcion: string; fecha: string; factura_id: string | null; conciliado: boolean; cliente_id?: string | null; proveedor_id?: string | null; clientes?: { razon_social: string } | null; proveedores?: { razon_social: string } | null }
  interface CCFCRow { id: string; numero_factura: string; fecha: string; fecha_vencimiento: string | null; total: number; pagado: number; estado: string; moneda: string }
  const [ccDetailCliente, setCcDetailCliente] = useState<CCRow | null>(null);
  const [ccDetailFacturas, setCcDetailFacturas] = useState<CCFacturaRow[]>([]);
  const [ccDetailMovimientos, setCcDetailMovimientos] = useState<CCMovRow[]>([]);
  const [ccDetailLoading, setCcDetailLoading] = useState(false);
  const [ccDetailProveedor, setCcDetailProveedor] = useState<CCRow | null>(null);
  const [ccDetailFCProv, setCcDetailFCProv] = useState<CCFCRow[]>([]);
  const [ccDetailMovProv, setCcDetailMovProv] = useState<CCMovRow[]>([]);
  const [ccDetailProvLoading, setCcDetailProvLoading] = useState(false);

  // ── Cobro Multiple modal ──
  interface CobroMultiFC { id: string; numero: string; tipo: string; punto_venta: number; fecha: string; subtotal: number; iva: number; total: number; total_acreditado: number; moneda: string; tipo_cambio?: number; saldo: number; selected: boolean }
  const [cobroMultiOpen, setCobroMultiOpen] = useState(false);
  const [cobroMultiFCs, setCobroMultiFCs] = useState<CobroMultiFC[]>([]);
  const [cobroMultiLiqOpen, setCobroMultiLiqOpen] = useState(false);
  const [fxPago, setFxPago] = useState<{proveedorId:string; documents:{id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]} | null>(null);
  const [fxCobroMulti, setFxCobroMulti] = useState<{clienteId:string; documents:{id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]} | null>(null);

  // ── Manual movement modal (conciliacion) ──
  const [manualMovOpen, setManualMovOpen] = useState(false);
  const [manualMovTarget, setManualMovTarget] = useState<"cliente" | "proveedor">("cliente");
  const [manualMovTargetId, setManualMovTargetId] = useState("");
  const [manualMovTargetName, setManualMovTargetName] = useState("");
  const [manualMovForm, setManualMovForm] = useState({ monto: 0, descripcion: "", fecha: todayAR(), tipo_mov: "credito" as "credito" | "debito", moneda: "ARS" as "ARS" | "USD" });
  const [manualMovSaving, setManualMovSaving] = useState(false);
  const [manualMovError, setManualMovError] = useState("");

  // ── SmartFilters for Movimientos tab ──
  const movFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "tipo",
      label: "Tipo",
      type: "select",
      options: [
        { value: "cobro", label: "Cobro" },
        { value: "pago", label: "Pago" },
        { value: "cheque_emitido", label: "Cheque emitido" },
        { value: "cheque_recibido", label: "Cheque recibido" },
        { value: "transferencia", label: "Transferencia" },
        { value: "efectivo", label: "Efectivo" },
        { value: "deposito", label: "Deposito" },
        { value: "retencion_iva", label: "Ret. IVA" },
        { value: "retencion_ganancias", label: "Ret. Ganancias" },
        { value: "retencion_iibb", label: "Ret. IIBB" },
        { value: "retencion_suss", label: "Ret. SUSS" },
        { value: "ajuste", label: "Ajuste" },
      ],
    },
    {
      key: "conciliado",
      label: "Conciliado",
      type: "select",
      options: [
        { value: "si", label: "Si" },
        { value: "no", label: "No" },
      ],
    },
    { key: "monto", label: "Monto", type: "number-range" },
  ];
  const [movFilterValues, setMovFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    tipo: "",
    conciliado: "",
    monto: {},
  });

  const fetchData = useCallback(async () => {
      setLoading(true);
      setLoadingTimedOut(false);
      // Nunca consultar Finanzas sin sociedad: además de ser inseguro, deja la
      // pantalla esperando si el contexto de usuario todavía no terminó de cargar.
      if (!sociedadActiva?.id) {
        setLoading(false);
        setLoadingTimedOut(true);
        return;
      }
      try {
        let qMov = supabase
          .from("movimientos")
          .select(`*, clientes(razon_social), proveedores(razon_social)`)
          .order("fecha", { ascending: false });
        if (sociedadActiva?.id) qMov = qMov.eq("sociedad_id" as any, sociedadActiva.id);

        let qCcCli = (supabase as any).from("v_cuenta_corriente_clientes").select("*");
        if (sociedadActiva?.id) qCcCli = qCcCli.eq("sociedad_id", sociedadActiva.id);
        let qCcProv = (supabase as any).from("v_cuenta_corriente_proveedores").select("*");
        if (sociedadActiva?.id) qCcProv = qCcProv.eq("sociedad_id", sociedadActiva.id);
        let qExt = (supabase as any).from("extractos_bancarios").select(`*, extracto_movimientos(*)`).order("created_at", { ascending: false });
        if (sociedadActiva?.id) qExt = qExt.eq("sociedad_id", sociedadActiva.id);
        let qLc = (supabase as any).from("lineas_credito").select(`*, proveedores(razon_social)`).order("vencimiento");
        if (sociedadActiva?.id) qLc = qLc.eq("sociedad_id", sociedadActiva.id);
        let qGf = (supabase as any).from("gastos_fijos").select("*").order("categoria");
        if (sociedadActiva?.id) qGf = qGf.eq("sociedad_id", sociedadActiva.id);
        let qObj = (supabase as any).from("objetivos").select("*, profiles:usuario_id(full_name)").order("periodo_inicio", { ascending: false });
        if (sociedadActiva?.id) qObj = qObj.eq("sociedad_id", sociedadActiva.id);

        // Saldos de caja del mes actual
        const mesActual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit" }).slice(0, 7);
        let qSaldos = (supabase as any).from("saldos_caja").select("id, moneda, monto").eq("mes", mesActual);
        if (sociedadActiva?.id) qSaldos = qSaldos.eq("sociedad_id", sociedadActiva.id);

        const [movRes, ccCliRes, ccProvRes, extRes, lcRes, gfRes, objRes, saldosRes] = await Promise.all([
          qMov, qCcCli, qCcProv, qExt, qLc, qGf, qObj, qSaldos,
        ]);

        // La pantalla principal no debe quedar bloqueada por consultas secundarias
        // (extractos, objetivos, e-cheques, etc.). Mostramos el módulo con los
        // datos principales y dejamos que el resto termine en segundo plano.
        setLoading(false);

        // Use Supabase data if available, otherwise fall back to mock data mapped to snake_case
        if (movRes.data) {
          setMovimientos(movRes.data as MovimientoRow[]);
        } else if (movRes.error) {
          setMovimientos(
            mockMovimientos.map((m) => ({
              id: m.id,
              tipo: m.tipo,
              cliente_id: m.clienteId,
              proveedor_id: m.proveedorId,
              descripcion: m.descripcion,
              monto: m.monto,
              fecha: m.fecha,
              factura_id: m.facturaId,
              conciliado: m.conciliado,
              created_at: m.createdAt,
              clientes: null,
              proveedores: null,
            }))
          );
        }

        if (ccCliRes.data) {
          setCcClientes(ccCliRes.data.map((r: any) => ({
            id: r.id,
            razon_social: r.razon_social,
            cuit: r.cuit,
            dias_cuenta_corriente: r.dias_cuenta_corriente,
            forma_pago: r.forma_pago,
            limite_credito: r.limite_credito,
            saldo_cuenta_corriente: r.saldo ?? r.saldo_cuenta_corriente ?? 0,
          })));
        } else if (ccCliRes.error) {
          setCcClientes(
            mockClients.map((c) => ({
              id: c.id,
              razon_social: c.razonSocial,
              cuit: c.cuit,
              dias_cuenta_corriente: c.diasCuentaCorriente,
              forma_pago: c.formaPago,
              limite_credito: c.limiteCredito,
              saldo_cuenta_corriente: c.saldoCuentaCorriente,
            }))
          );
        }

        if (ccProvRes.data) {
          setCcProveedores(ccProvRes.data.map((r: any) => ({
            id: r.id,
            razon_social: r.razon_social,
            cuit: r.cuit,
            rubro: r.rubro,
            dias_cuenta_corriente: r.dias_cuenta_corriente,
            forma_pago: r.forma_pago,
            limite_credito: r.limite_credito,
            saldo_cuenta_corriente: r.saldo ?? r.saldo_cuenta_corriente ?? 0,
          })));
        } else if (ccProvRes.error) {
          setCcProveedores(
            mockProveedores.map((p) => ({
              id: p.id,
              razon_social: p.razonSocial,
              cuit: p.cuit,
              rubro: p.rubro,
              dias_cuenta_corriente: p.diasCuentaCorriente,
              forma_pago: p.formaPago,
              limite_credito: p.limiteCredito,
              saldo_cuenta_corriente: p.saldoCuentaCorriente,
            }))
          );
        }

        if (extRes.data) {
          setExtractos(extRes.data as ExtractoRow[]);
        } else if (extRes.error) {
          setExtractos(
            mockExtractos.map((e) => ({
              id: e.id,
              banco: e.banco,
              cuenta: e.cuenta,
              periodo: e.periodo,
              total_creditos: e.totalCreditos,
              total_debitos: e.totalDebitos,
              estado: e.estado,
              created_at: e.fechaUpload,
              extracto_movimientos: e.movimientos.map((em) => ({
                id: em.id,
                fecha: em.fecha,
                descripcion: em.descripcion,
                referencia: em.referencia,
                monto: em.monto,
                tipo: em.tipo,
                estado: em.estado,
                match_cliente_id: em.matchClienteId,
                match_proveedor_id: em.matchProveedorId,
                match_factura_id: em.matchFacturaId,
              })),
            }))
          );
        }

        if (lcRes.data) {
          setLineasCredito(lcRes.data as LineaCreditoRow[]);
        } else if (lcRes.error) {
          setLineasCredito(
            mockLineasCredito.map((lc) => ({
              id: lc.id,
              entidad: lc.entidad,
              tipo: lc.tipo,
              proveedor_id: lc.proveedorId,
              monto_total: lc.montoTotal,
              monto_utilizado: lc.montoUtilizado,
              monto_disponible: lc.montoDisponible,
              moneda: lc.moneda,
              tasa: lc.tasa,
              vencimiento: lc.vencimiento,
              estado: lc.estado,
              notas: lc.notas,
              created_at: lc.createdAt,
              proveedores: null,
            }))
          );
        }

        if (gfRes.data) {
          setGastosFijos(gfRes.data.map((g: any) => ({
            id: g.id, descripcion: g.descripcion, categoria: g.categoria,
            monto: Number(g.monto), moneda: g.moneda, activo: g.activo,
            notas: g.notas ?? "", createdAt: g.created_at,
          })));
        }

        if (objRes.data) {
          setObjetivos(objRes.data.map((o: any) => ({
            id: o.id, nombre: o.nombre, tipo: o.tipo,
            montoTarget: Number(o.monto_target), moneda: o.moneda,
            periodoInicio: o.periodo_inicio, periodoFin: o.periodo_fin,
            usuarioId: o.usuario_id, usuarioNombre: o.profiles?.full_name ?? null,
            activo: o.activo, notas: o.notas ?? "", createdAt: o.created_at,
          })));
        }

        if (saldosRes.data) {
          setSaldosCaja(saldosRes.data.map((s: any) => ({ id: s.id, moneda: s.moneda, monto: Number(s.monto) })));
        }

        // Fetch proveedores list for OP/gastos selectors
        try {
          let qProv = supabase.from("proveedores").select("id, razon_social, email, cuit, condicion_iva, forma_pago, banco, cbu, alias_bancario, numero_cuenta, titular_cuenta, tipo_cuenta, alicuota_ganancias, concepto_retencion_ganancias, exclusion_retencion, exclusion_retencion_desde, exclusion_retencion_hasta, exclusion_retencion_cert" as any).order("razon_social");
          if (sociedadActiva?.id) qProv = qProv.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: provData } = await qProv;
          if (provData) setProveedoresOptions(provData as unknown as ProveedorOption[]);
        } catch { /* ignore */ }

        // Fetch retencion config
        try {
          if (sociedadActiva?.id) {
            const { data: retCfg } = await (supabase as any).from("retencion_config").select("*").eq("sociedad_id", sociedadActiva.id).single();
            if (retCfg) setRetencionConfig({
              aplica_iva: retCfg.aplica_iva ?? true,
              minimo_iva: retCfg.minimo_iva ?? 130000,
              tasa_iva_ri: retCfg.tasa_iva_ri ?? 10.5,
              aplica_ganancias: retCfg.aplica_ganancias ?? true,
              minimo_ganancias: retCfg.minimo_ganancias ?? 400000,
              tasa_ganancias_ri: retCfg.tasa_ganancias_ri ?? 2,
              tasa_ganancias_no_inscripto: retCfg.tasa_ganancias_no_inscripto ?? 28,
              minimo_retencion_ganancias: retCfg.minimo_retencion_ganancias ?? 240,
            });
          }
        } catch { /* use defaults */ }

        // Fetch custom gasto categories from configuracion
        try {
          if (sociedadActiva?.id) {
            const { data: catCfg } = await (supabase as any).from("configuracion").select("value").eq("key", "gasto_categorias").eq("sociedad_id", sociedadActiva.id).single();
            if (catCfg?.value) {
              const parsed = typeof catCfg.value === "string" ? JSON.parse(catCfg.value) : catCfg.value;
              if (Array.isArray(parsed) && parsed.length > 0) setGastoCategorias(parsed);
            }
          }
        } catch { /* use defaults */ }

        // Fetch cheques recibidos no conciliados (for cruce)
        try {
          let qCheq = supabase.from("movimientos").select("*").eq("tipo", "cheque_recibido").eq("conciliado", false).order("fecha", { ascending: false });
          if (sociedadActiva?.id) qCheq = qCheq.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: cheqData } = await qCheq;
          if (cheqData) setChequesRecibidos(cheqData as MovimientoRow[]);
        } catch { /* ignore */ }

        // Fetch ordenes de pago (movimientos with tipo=pago that have op_ prefix in descripcion)
        try {
          let qOp = (supabase as any).from("ordenes_pago").select("*, proveedores(razon_social, email, cuit)").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qOp = qOp.eq("sociedad_id", sociedadActiva.id);
          const { data: opData } = await qOp;
          if (opData) {
            setOrdenesPago(opData.map((r: any) => ({
              id: r.id, numero: r.numero ?? undefined, fecha: r.fecha, proveedor_id: r.proveedor_id,
              proveedor_nombre: r.proveedores?.razon_social ?? "—",
              proveedor_email: r.proveedores?.email ?? null,
              proveedor_cuit: r.proveedores?.cuit ?? null,
              monto_bruto: Number(r.monto_bruto), retencion_pct: Number(r.retencion_porcentaje ?? r.retencion_pct ?? 0),
              monto_retencion: Number(r.retencion_monto ?? r.monto_retencion ?? 0),
              retencion_ganancias_pct: Number(r.retencion_ganancias_pct ?? 0),
              retencion_ganancias_monto: Number(r.retencion_ganancias_monto ?? 0),
              neto: Number(r.neto_a_pagar ?? r.neto ?? 0),
              moneda: (r.moneda as "ARS" | "USD") ?? "ARS", medio_pago: r.medio_pago ?? "transferencia",
              medios_pago: r.medios_pago ? (typeof r.medios_pago === "string" ? JSON.parse(r.medios_pago) : r.medios_pago) : undefined,
              cheque_cruce_id: r.cheque_cruce_id, notas: r.notas ?? "",
              estado: r.estado ?? "pendiente",
              comprobante_url: r.comprobante_url ?? undefined,
              certificado_retencion_url: r.certificado_retencion_url ?? undefined,
              archivo_url: r.archivo_url ?? undefined,
              archivo_nombre: r.archivo_nombre ?? undefined,
              archivos: r.archivos ? (typeof r.archivos === "string" ? JSON.parse(r.archivos) : r.archivos) : undefined,
              sobre_verde: !!r.sobre_verde,
              email_enviado_at: r.email_enviado_at ?? null,
              base_retencion_ganancias: Number(r.base_retencion_ganancias || 0),
              created_at: r.created_at,
            })));
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch gastos manuales
        try {
          let qGm = (supabase as any).from("gastos_manuales").select("*, proveedores(razon_social)").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qGm = qGm.eq("sociedad_id", sociedadActiva.id);
          const { data: gmData } = await qGm;
          if (gmData) {
            setGastosManuales(gmData.map((r: any) => ({
              id: r.id, fecha: r.fecha, descripcion: r.descripcion,
              proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedores?.razon_social ?? undefined,
              categoria: r.categoria ?? "Varios", tipo_gasto: r.tipo_gasto ?? "general", tipo_recurrencia: r.tipo_recurrencia ?? "eventual",
              medio_pago: r.medio_pago ?? "efectivo",
              comprobante_url: r.comprobante_url ?? undefined,
              monto: Number(r.monto),
              moneda: (r.moneda as "ARS" | "USD") ?? "ARS", notas: r.notas ?? "",
              created_at: r.created_at,
            })));
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch facturas de compra
        try {
          let qFc = (supabase as any).from("facturas_compra").select("*, proveedores(razon_social), ordenes_compra(numero), op_facturas_compra(orden_pago_id, monto, ordenes_pago(id, numero, estado, fecha, sobre_verde)), factura_compra_ocs(orden_compra_id, ordenes_compra(numero))").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qFc = qFc.eq("sociedad_id", sociedadActiva.id);
          const { data: fcData } = await qFc;
          if (fcData) {
            const fcIds = fcData.map((r: any) => r.id);
            let directPayments: any[] = [];
            if (fcIds.length > 0) {
              let qDirect = (supabase as any).from("movimientos").select("factura_compra_id, monto, anulado").in("factura_compra_id", fcIds).eq("tipo", "pago");
              if (sociedadActiva?.id) qDirect = qDirect.eq("sociedad_id", sociedadActiva.id);
              const { data } = await qDirect;
              directPayments = data || [];
            }
            const directByFC = directPayments.reduce((acc: Record<string, number>, p: any) => {
              if (!p.anulado) acc[p.factura_compra_id] = (acc[p.factura_compra_id] || 0) + Number(p.monto || 0);
              return acc;
            }, {});
            setFacturasCompra(fcData.map((r: any) => ({
              id: r.id, numero_factura: r.numero_factura,
              proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedores?.razon_social ?? "—",
              orden_compra_id: r.orden_compra_id, oc_numero: r.ordenes_compra?.numero ?? undefined,
              fecha: r.fecha, fecha_vencimiento: r.fecha_vencimiento,
              subtotal: Number(r.subtotal), iva_porcentaje: Number(r.iva_porcentaje),
              iva: Number(r.iva), percepciones: Number(r.percepciones ?? 0),
              total: Number(r.total), moneda: (r.moneda as "ARS" | "USD") ?? "ARS",
              estado: r.estado ?? "pendiente", notas: r.notas ?? "",
              tipo: (r.tipo as "mercaderia" | "solo_iva" | "transporte") ?? (r.solo_iva ? "solo_iva" : "mercaderia"),
              tipo_comprobante: r.tipo_comprobante ?? "FC A",
              created_at: r.created_at,
              costo_real: Number(r.costo_real ?? 0),
              archivo_url: r.archivo_url ?? undefined,
              archivo_nombre: r.archivo_nombre ?? undefined,
              solo_iva: r.solo_iva ?? false,
              cae: r.cae ?? undefined,
              percepciones_detalle: r.percepciones_detalle ? (typeof r.percepciones_detalle === "string" ? JSON.parse(r.percepciones_detalle) : r.percepciones_detalle) : undefined,
              // Una OP anulada no debe seguir bloqueando la factura: la FC
              // vuelve a estar disponible para generar una nueva OP.
              op_vinculada: (() => {
                const link = (r.op_facturas_compra || []).find((l: any) =>
                  l?.ordenes_pago && l.ordenes_pago.estado !== "anulada"
                );
                return link?.ordenes_pago
                  ? { id: link.ordenes_pago.id, numero: link.ordenes_pago.numero, estado: link.ordenes_pago.estado, fecha: link.ordenes_pago.fecha, sobre_verde: !!link.ordenes_pago.sobre_verde }
                  : null;
              })(),
              ocs_vinculadas: (r.factura_compra_ocs || []).map((link: any) => ({ numero: link.ordenes_compra?.numero || "—" })).filter((o: any) => o.numero !== "—"),
              pago_directo: directByFC[r.id] || 0,
            })));
          } else {
            setFacturasCompra([]);
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch ordenes de compra for optional linking
        try {
          let qOc = supabase.from("ordenes_compra").select("id, numero, proveedor_id, total, moneda, estado, fecha, proveedores(razon_social)").order("numero", { ascending: false });
          if (sociedadActiva?.id) qOc = qOc.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: ocData } = await qOc;
          if (ocData) setOcOptions(ocData as any[]);
        } catch { /* ignore */ }

        // Fetch echeqs
        try {
          let qEcheq = (supabase as any).from("echeqs").select("*").order("fecha_pago", { ascending: true });
          if (sociedadActiva?.id) qEcheq = qEcheq.eq("sociedad_id", sociedadActiva.id);
          const { data: echeqData } = await qEcheq;
          if (echeqData) setEcheqs(echeqData.map((e: any) => ({ ...e, tipo_cheque: e.tipo_cheque || "echeq" })) as EcheqRow[]);
        } catch { /* table may not exist yet */ }

        // Fetch balance projection
        try {
          const { data: balData } = await (supabase as any).rpc("get_balance_projection", sociedadActiva?.id ? { p_sociedad_id: sociedadActiva.id } : {});
          if (balData) setBalanceData(balData as any);
        } catch { /* ignore */ }

        // Fetch clientes for echeq origin
        try {
          let qCli = supabase.from("clientes").select("id, razon_social").eq("activo", true).order("razon_social");
          if (sociedadActiva?.id) qCli = qCli.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: cliData } = await qCli;
          if (cliData) setClientesOptions(cliData as ClienteOption[]);
        } catch { /* ignore */ }

      } catch (err) {
        console.error("Error fetching finanzas data:", err);
        // On error, mock data fallback is already set above (or stays empty).
        // Re-map mock data so the page still works.
        setMovimientos(
          mockMovimientos.map((m) => ({
            id: m.id, tipo: m.tipo, cliente_id: m.clienteId, proveedor_id: m.proveedorId,
            descripcion: m.descripcion, monto: m.monto, fecha: m.fecha, factura_id: m.facturaId,
            conciliado: m.conciliado, created_at: m.createdAt, clientes: null, proveedores: null,
          }))
        );
        setCcClientes(mockClients.map((c) => ({ id: c.id, razon_social: c.razonSocial, cuit: c.cuit, dias_cuenta_corriente: c.diasCuentaCorriente, forma_pago: c.formaPago, limite_credito: c.limiteCredito, saldo_cuenta_corriente: c.saldoCuentaCorriente })));
        setCcProveedores(mockProveedores.map((p) => ({ id: p.id, razon_social: p.razonSocial, cuit: p.cuit, rubro: p.rubro, dias_cuenta_corriente: p.diasCuentaCorriente, forma_pago: p.formaPago, limite_credito: p.limiteCredito, saldo_cuenta_corriente: p.saldoCuentaCorriente })));
        setExtractos(mockExtractos.map((e) => ({ id: e.id, banco: e.banco, cuenta: e.cuenta, periodo: e.periodo, total_creditos: e.totalCreditos, total_debitos: e.totalDebitos, estado: e.estado, created_at: e.fechaUpload, extracto_movimientos: e.movimientos.map((em) => ({ id: em.id, fecha: em.fecha, descripcion: em.descripcion, referencia: em.referencia, monto: em.monto, tipo: em.tipo, estado: em.estado, match_cliente_id: em.matchClienteId, match_proveedor_id: em.matchProveedorId, match_factura_id: em.matchFacturaId })) })));
        setLineasCredito(mockLineasCredito.map((lc) => ({ id: lc.id, entidad: lc.entidad, tipo: lc.tipo, proveedor_id: lc.proveedorId, monto_total: lc.montoTotal, monto_utilizado: lc.montoUtilizado, monto_disponible: lc.montoDisponible, moneda: lc.moneda, tasa: lc.tasa, vencimiento: lc.vencimiento, estado: lc.estado, notas: lc.notas, created_at: lc.createdAt, proveedores: null })));
      } finally {
        setLoading(false);
      }
  }, [sociedadActiva]);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (active) {
        setLoading(false);
        setLoadingTimedOut(true);
      }
    }, 20000);
    fetchData().finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); };
  }, [fetchData]);

  // Fetch FC items when detail panel opens
  useEffect(() => {
    if (!selectedFC?.id) { setSelectedFCItems([]); return; }
    (async () => {
      try {
        const { data } = await (supabase as any).from("facturas_compra_items").select("descripcion, cantidad, precio_unitario, descuento_porcentaje, unidad, iva_porcentaje").eq("factura_compra_id", selectedFC.id);
        setSelectedFCItems(data ?? []);
      } catch { setSelectedFCItems([]); }
    })();
  }, [selectedFC?.id]);

  async function handleCreateMov() {
    if (!sociedadActiva?.id) { setFormError("No se pudo determinar la sociedad activa"); return; }
    if (!movForm.descripcion.trim()) { setFormError("La descripcion es obligatoria"); return; }
    if (movForm.monto <= 0) { setFormError("El monto debe ser mayor a 0"); return; }
    if (!movForm.cliente_id && !movForm.proveedor_id) { setFormError("Debe seleccionar un cliente o proveedor"); return; }
    setSaving(true);
    setFormError("");
    try {
      const insertData: Record<string, unknown> = {
        tipo: movForm.tipo,
        descripcion: movForm.descripcion,
        monto: movForm.monto,
        moneda: movForm.moneda,
        fecha: movForm.fecha,
        sociedad_id: sociedadActiva.id,
      };
      if (movForm.cliente_id) insertData.cliente_id = movForm.cliente_id;
      if (movForm.proveedor_id) insertData.proveedor_id = movForm.proveedor_id;
      if (profile?.id) insertData.created_by = profile.id;
      if (editingMovId) {
        const { error } = await (supabase as any).rpc("gestionar_cobro", {
          p_movimiento_id: editingMovId,
          p_accion: "editar",
          p_descripcion: movForm.descripcion,
          p_monto: movForm.monto,
          p_moneda: movForm.moneda,
          p_fecha: movForm.fecha,
          p_tipo: movForm.tipo,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("movimientos").insert(insertData as any);
        if (error) throw error;
      }
      setModalOpen(false);
      setEditingMovId(null);
      setMovForm(emptyMovForm);
      setMovClienteSearch("");
      setMovProvSearch("");
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveSaldoCaja(moneda: string) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    const monto = Number(editingSaldoVal);
    if (isNaN(monto)) { setEditingSaldo(null); return; }
    const mesActual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit" }).slice(0, 7);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const { error } = await (supabase as any).from("saldos_caja").upsert({
        sociedad_id: sociedadActiva.id,
        mes: mesActual,
        moneda,
        monto,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "sociedad_id,mes,moneda" });
      if (error) throw error;
      setSaldosCaja(prev => {
        const exists = prev.find(s => s.moneda === moneda);
        if (exists) return prev.map(s => s.moneda === moneda ? { ...s, monto } : s);
        return [...prev, { moneda, monto }];
      });
    } catch (err) { alert("Error al guardar saldo: " + (err instanceof Error ? err.message : String(err))); }
    setEditingSaldo(null);
  }

  async function handleConciliar(id: string) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let q = supabase.from("movimientos").update({ conciliado: true }).eq("id", id);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await q;
      if (error) throw error;
      setMovimientos(prev => prev.map(m => m.id === id ? { ...m, conciliado: true } : m));
    } catch (err) {
      alert("Error conciliando: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleMatchExtracto(row: ExtractoMovimientoRow) {
    if (!sociedadActiva?.id || !extracto) { alert("No se pudo determinar la sociedad activa"); return; }
    if (row.estado !== "pendiente") return;
    const moneda = (extracto as ExtractoRow & { moneda?: string }).moneda
      || window.prompt("Este extracto no tiene moneda registrada. Indicá ARS o USD según la cuenta bancaria:")?.trim().toUpperCase();
    if (!moneda) return;
    if (!["ARS", "USD"].includes(moneda)) { alert("La moneda debe ser ARS o USD."); return; }
    const target = movimientos.filter((m) => canMatchBankMovement(row, m, moneda));
    if (target.length !== 1) {
      alert(target.length === 0 ? "No encontramos un movimiento compatible en moneda, importe, sentido y fecha. Las transferencias sin origen/destino identificado requieren revisión." : "Hay más de un movimiento posible. Revisá sus referencias antes de conciliar; no se realizó ninguna asociación.");
      return;
    }
    const match = target[0];
    if (!window.confirm(`¿Conciliar esta línea del extracto con ${match.descripcion || match.tipo} del ${formatDate(match.fecha)}, por ${formatCurrency(Number(match.monto), moneda as "ARS" | "USD")}? Verificá que corresponda a la misma operación bancaria.`)) return;
    try {
      const { error } = await (supabase as any).rpc("conciliar_extracto_movimiento", {
        p_sociedad_id: sociedadActiva.id,
        p_extracto_id: extracto.id,
        p_extracto_movimiento_id: row.id,
        p_movimiento_id: match.id,
        p_moneda: moneda,
      });
      if (error) throw error;
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Error desconocido";
      alert(`No se pudo conciliar el extracto: ${message}`);
    }
  }

  function openGastoModal(gasto?: GastoFijo) {
    if (gasto) {
      setEditingGasto(gasto);
      setGastoForm({ descripcion: gasto.descripcion, categoria: gasto.categoria, monto: gasto.monto, moneda: gasto.moneda, notas: gasto.notas });
    } else {
      setEditingGasto(null);
      setGastoForm({ descripcion: "", categoria: "general", monto: 0, moneda: "ARS", notas: "" });
    }
    setGastoModalOpen(true);
  }

  async function handleSaveGasto() {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    if (!gastoForm.descripcion.trim() || gastoForm.monto <= 0) return;
    setGastoSaving(true);
    try {
      if (editingGasto) {
        const { error } = await supabase.from("gastos_fijos").update({
          descripcion: gastoForm.descripcion, categoria: gastoForm.categoria,
          monto: gastoForm.monto, moneda: gastoForm.moneda, notas: gastoForm.notas,
        } as any).eq("id", editingGasto.id).eq("sociedad_id" as any, sociedadActiva?.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("gastos_fijos").insert({
          descripcion: gastoForm.descripcion, categoria: gastoForm.categoria,
          monto: gastoForm.monto, moneda: gastoForm.moneda, notas: gastoForm.notas,
          sociedad_id: sociedadActiva.id,
        } as any);
        if (error) throw error;
      }
      setGastoModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Error saving gasto:", err);
      alert("Error al guardar gasto: " + (err as any)?.message);
    } finally {
      setGastoSaving(false);
    }
  }

  async function handleToggleGasto(id: string, activo: boolean) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let q = supabase.from("gastos_fijos").update({ activo: !activo } as any).eq("id", id);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await q;
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error al cambiar estado: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteGasto(id: string) {
    if (!confirm("Seguro que queres eliminar este gasto fijo?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let q = supabase.from("gastos_fijos").delete().eq("id", id);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await q;
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteMov(id: string) {
    const mov = movimientos.find(m => m.id === id);
    if (mov?.liquidacion_fx_id) { alert("Este movimiento pertenece a una liquidación FX. Anulá la liquidación completa desde el botón Anular."); return; }
    if (!confirm("¿Seguro que queres eliminar este movimiento?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      const { error } = await (supabase as any).rpc("gestionar_cobro", {
        p_movimiento_id: id,
        p_accion: "eliminar",
      });
      if (error) throw error;
      if (selectedMov?.id === id) setSelectedMov(null);
      await fetchData();
    } catch (err) {
      alert("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function openEditMov(mov: MovimientoRow) {
    if (mov.anulado) return;
    setEditingMovId(mov.id);
    setMovForm({
      tipo: mov.tipo as typeof emptyMovForm.tipo,
      descripcion: mov.descripcion,
      monto: Number(mov.monto),
      fecha: mov.fecha,
      moneda: (mov.moneda || "ARS") as "ARS" | "USD",
      cliente_id: mov.cliente_id || "",
      proveedor_id: mov.proveedor_id || "",
    });
    setMovClienteSearch(mov.clientes?.razon_social || "");
    setMovProvSearch(mov.proveedores?.razon_social || "");
    setFormError("");
    setModalOpen(true);
  }

  async function handleAnularMov(id: string) {
    // Check if this movement belongs to an FX settlement
    const mov = movimientos.find(m => m.id === id);
    if (mov?.liquidacion_fx_id) {
      if (!confirm("Este movimiento pertenece a una liquidación FX. ¿Anular la liquidación completa?")) return;
      if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
      try {
        const { error } = await (supabase as any).rpc("anular_liquidacion_fx", { p_id: mov.liquidacion_fx_id, p_sociedad_id: sociedadActiva.id });
        if (error) throw error;
        setSelectedMov(null);
        await fetchData();
      } catch (err) { alert("Error al anular liquidación FX: " + (err instanceof Error ? err.message : String(err))); }
      return;
    }
    if (!confirm("¿Anular este cobro? Se conservará el registro, se revertirá el importe y se recalculará la factura.")) return;
    try {
      const { error } = await (supabase as any).rpc("gestionar_cobro", {
        p_movimiento_id: id,
        p_accion: "anular",
      });
      if (error) throw error;
      setSelectedMov(null);
      await fetchData();
    } catch (err) {
      alert("Error al anular: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── OP auto-retenciones ──
  // 1. Cuando cambia el proveedor → consultar AFIP para obtener condición IVA + cargar FC pendientes
  useEffect(() => {
    if (!opModalOpen) return;
    if (!opForm.proveedor_id) { setOpProvCondicion(null); setOpFCPendientes([]); return; }
    let cancelled = false;
    setOpDatosError("");
    setOpCondicionLoading(false);
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    // Pre-seleccionar medio de pago según forma_pago del proveedor
    if (prov?.forma_pago) {
      const fpMap: Record<string, OpMedioPago["tipo"]> = { Transferencia: "transferencia", Cheque: "cheque", Echeq: "echeq", Efectivo: "efectivo", Tarjeta: "tarjeta" };
      const tipoMedio = fpMap[prov.forma_pago];
      if (tipoMedio) setOpMedios(prev => prev.length === 1 && prev[0].monto === 0 ? [{ ...prev[0], tipo: tipoMedio }] : prev);
    }
    // Usar condicion_iva de la DB directamente (fuente de verdad)
    if (prov?.condicion_iva) {
      setOpProvCondicion(prov.condicion_iva);
    } else if (prov?.cuit) {
      // Fallback: CUIT lookup solo si la DB no tiene condicion_iva
      const cuit = prov.cuit.replace(/-/g, "");
      setOpCondicionLoading(true);
      setOpProvCondicion(null);
      fetch(`/api/cuit-lookup?cuit=${cuit}`)
        .then(r => r.json())
        .then(data => { if (!cancelled) setOpProvCondicion(data.condicion_iva ?? ""); })
        .catch(() => { if (!cancelled) setOpProvCondicion(null); })
        .finally(() => { if (!cancelled) setOpCondicionLoading(false); });
    } else {
      setOpProvCondicion(null);
    }
    // Cargar FC pendientes del proveedor + total mensual para ganancias
    setOpFCLoading(true);
    (async () => {
      try {
        // FC pendientes (incluir subtotal/iva/percepciones para base sin IVA — Art. 23 RG 830)
        let q = (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, subtotal, iva, percepciones, total, moneda")
          .eq("proveedor_id", opForm.proveedor_id).in("estado", ["pendiente", "recibida"]);
        if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
        const { data, error: fcLoadError } = await q;
        if (fcLoadError) throw fcLoadError;

        // Pagos parciales previos: sumar montos ya pagados por FC via op_facturas_compra (excluir OPs anuladas)
        const fcIds = (data || []).map((fc: any) => fc.id);
        let pagadoPorFC: Record<string, number> = {};
        if (fcIds.length > 0) {
          const { data: opfcData, error: linkedLoadError } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto, ordenes_pago(id, estado, sociedad_id)").in("factura_compra_id", fcIds);
          if (linkedLoadError) throw linkedLoadError;
          (opfcData || []).forEach((r: any) => {
            if (sociedadActiva?.id && r.ordenes_pago?.sociedad_id !== sociedadActiva.id) return;
            if (r.ordenes_pago?.estado === "anulada") return; // Skip anulada OPs
            pagadoPorFC[r.factura_compra_id] = (pagadoPorFC[r.factura_compra_id] || 0) + Number(r.monto);
          });
          let qDirect = (supabase as any).from("movimientos").select("factura_compra_id, monto, retencion_ganancias_monto, anulado")
            .in("factura_compra_id", fcIds).eq("tipo", "pago");
          if (sociedadActiva?.id) qDirect = qDirect.eq("sociedad_id", sociedadActiva.id);
          const { data: directData, error: directLoadError } = await qDirect;
          if (directLoadError) throw directLoadError;
          (directData || []).forEach((r: any) => {
            if (!r.anulado) pagadoPorFC[r.factura_compra_id] = (pagadoPorFC[r.factura_compra_id] || 0) + Number(r.monto || 0) + Number(r.retencion_ganancias_monto || 0);
          });
        }

        if (cancelled) return;
        setOpFCPendientes((data || []).map((fc: any) => {
          const pagado = pagadoPorFC[fc.id] || 0;
          const saldo = Math.max(0, Number(fc.total) - pagado);
          const esDirecta = pagoParcialDirecto && pagoParcialFCId === fc.id;
          return { id: fc.id, numero: fc.numero_factura || "S/N", fecha: fc.fecha, total: Number(fc.total), subtotal: Number(fc.subtotal || 0), iva: Number(fc.iva || 0), percepciones: Number(fc.percepciones || 0), saldo_pendiente: saldo, moneda: fc.moneda || "ARS", selected: esDirecta, monto_a_pagar: esDirecta ? saldo : 0 };
        }).filter((fc: any) => fc.saldo_pendiente > 0));

        // Acumulado mensual de PAGOS (OPs) a este proveedor — Art. 26 RG 830
        // Se acumulan las bases sin IVA de OPs previas + retenciones ya practicadas
        // El acumulado de RG 830 corresponde al mes de la fecha de la OP.
        const mesActual = (opForm.fecha || new Date().toISOString().slice(0, 10)).slice(0, 7); // YYYY-MM
        const [year, month] = mesActual.split("-").map(Number);
        const mesSiguiente = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
        let qMensualOP = (supabase as any).from("ordenes_pago").select("base_retencion_ganancias, retencion_ganancias_monto, moneda")
          .eq("proveedor_id", opForm.proveedor_id)
          .gte("fecha", `${mesActual}-01`)
          .lt("fecha", mesSiguiente)
          .neq("estado", "anulada");
        if (sociedadActiva?.id) qMensualOP = qMensualOP.eq("sociedad_id", sociedadActiva.id);
        const { data: mensualOPData, error: monthlyLoadError } = await qMensualOP;
        if (monthlyLoadError) throw monthlyLoadError;
        const { data: directMonthly, error: directMonthlyError } = await (supabase as any).from("movimientos")
          .select("base_retencion_ganancias, retencion_ganancias_monto, moneda, anulado")
          .eq("sociedad_id", sociedadActiva?.id).eq("proveedor_id", opForm.proveedor_id)
          .eq("tipo", "pago").not("factura_compra_id", "is", null)
          .gte("fecha", `${mesActual}-01`).lt("fecha", mesSiguiente);
        if (directMonthlyError) throw directMonthlyError;
        const monthPayments = [...(mensualOPData || []), ...(directMonthly || []).filter((m: any) => !m.anulado)];
        if (monthPayments.some((m: any) => m.moneda !== "ARS")) throw new Error("El proveedor tiene pagos en otra moneda este mes: falta conciliar su base fiscal en pesos antes de calcular la retención.");
        const basesMes = monthPayments.reduce((s: number, r: any) => s + Number(r.base_retencion_ganancias || 0), 0);
        const retenidoMes = monthPayments.reduce((s: number, r: any) => s + Number(r.retencion_ganancias_monto || 0), 0);
        if (cancelled) return;
        setOpMonthlyBase(basesMes);
        setOpMonthlyRetenido(retenidoMes);
      } catch (error) {
        if (!cancelled) {
          setOpFCPendientes([]);
          setOpDatosError("No se pudieron verificar saldos y retenciones anteriores. Cerrá y volvé a abrir la OP. " + (error instanceof Error ? error.message : "Revisá la conexión."));
        }
      }
      finally { if (!cancelled) setOpFCLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [opForm.proveedor_id, opForm.fecha, opModalOpen, sociedadActiva?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Base sin IVA de esta OP (Art. 23 RG 830: IVA se excluye de la base de retención)
  const opMontoBrutoFC = opFCPendientes.filter(f => f.selected).reduce((s, f) => s + f.monto_a_pagar, 0);
  const opMontoBruto = opForm.usar_monto_manual && opForm.monto_manual > 0 ? opForm.monto_manual : opMontoBrutoFC;

  // Base sin IVA: para cada FC, la proporción sin IVA del monto a pagar
  const opBaseSinIVA = (() => {
    if (opForm.usar_monto_manual && opForm.monto_manual > 0) {
      // Monto manual: descontar IVA estimado (el usuario puede ajustar el % manualmente)
      const ivaPct = opForm.iva_manual_pct ?? 21;
      return Math.round(opForm.monto_manual / (1 + ivaPct / 100) * 100) / 100;
    }
    return opFCPendientes.filter(f => f.selected).reduce((s, f) => {
      if (f.total <= 0) return s;
      // Proporción sin IVA: (subtotal + percepciones) / total × monto_a_pagar
      const ratioSinIVA = (f.subtotal + f.percepciones) / f.total;
      return s + Math.round(f.monto_a_pagar * ratioSinIVA * 100) / 100;
    }, 0);
  })();

  // 3. Auto-calcular retención ganancias según RG 830
  // Si el usuario activó/desactivó manualmente, no sobreescribir
  useEffect(() => {
    if (opManualGanancias) return; // respect manual override
    if (opProvCondicion === null || opBaseSinIVA <= 0) return;
    let aplica_ganancias = false;
    let retencion_ganancias_pct = 0;
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    // Check exclusion certificate validity
    // La vigencia se evalúa contra la fecha real del pago, no contra hoy.
    const hoy = opForm.fecha || new Date().toISOString().slice(0, 10);
    const excluido = prov?.exclusion_retencion
      && (!prov.exclusion_retencion_desde || prov.exclusion_retencion_desde <= hoy)
      && (!prov.exclusion_retencion_hasta || prov.exclusion_retencion_hasta >= hoy);
    if (excluido) {
      setOpForm(prev => ({ ...prev, aplica_ganancias: false, retencion_ganancias_pct: 0 }));
      return;
    }
    // AFIP puede devolver "RI" o la descripción completa. Normalizamos para
    // no dejar pasar una retención por diferencias de formato; Monotributo,
    // Exento y Consumidor Final no son sujetos en este circuito.
    const condicionNormalizada = String(opProvCondicion || "").trim().toUpperCase();
    const esResponsableInscripto = condicionNormalizada === "RI"
      || condicionNormalizada === "RESPONSABLE INSCRIPTO"
      || condicionNormalizada === "RESPONSABLE INSCRIPTO IVA";
    if (esResponsableInscripto && retencionConfig.aplica_ganancias) {
      // Art. 26: acumular bases sin IVA del mes + esta OP
      const acumuladoMensual = opMonthlyBase + opBaseSinIVA;
      if (acumuladoMensual >= retencionConfig.minimo_ganancias) {
        aplica_ganancias = true;
        // Usar alícuota específica del proveedor (RG 830 por actividad), fallback a tasa global
        retencion_ganancias_pct = prov?.alicuota_ganancias ?? retencionConfig.tasa_ganancias_ri;
      }
    }
    setOpForm(prev => ({ ...prev, aplica_ganancias, retencion_ganancias_pct }));
  }, [opProvCondicion, opBaseSinIVA, retencionConfig, opMonthlyBase, opForm.proveedor_id, opForm.fecha, opManualGanancias]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OP handlers ──
  const filteredOPs = useMemo(() => {
    let list = ordenesPago;
    if (opFilterRetencion) list = list.filter(o => o.retencion_ganancias_monto > 0);
    if (opFilterDesde) list = list.filter(o => o.fecha >= opFilterDesde);
    if (opFilterHasta) list = list.filter(o => o.fecha <= opFilterHasta);
    return list;
  }, [ordenesPago, opFilterRetencion, opFilterDesde, opFilterHasta]);

  function exportOPRetencionesCSV() {
    const rows = filteredOPs.filter(o => o.retencion_ganancias_monto > 0 && o.estado !== "anulada");
    if (rows.length === 0) { alert("No hay retenciones para exportar en el rango seleccionado."); return; }
    const header = "Numero,Fecha,Proveedor,CUIT,Monto Bruto,Base Retencion,% Ganancias,Retencion Ganancias,Neto,Moneda";
    const csvRows = rows.map(r => {
      return [r.numero || "", r.fecha, `"${r.proveedor_nombre.replace(/"/g, '""')}"`, r.proveedor_cuit || "", r.monto_bruto, (r as any).base_retencion_ganancias || r.monto_bruto, r.retencion_ganancias_pct, r.retencion_ganancias_monto, r.neto, r.moneda].join(",");
    });
    const csv = "\uFEFF" + header + "\n" + csvRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    const desde = opFilterDesde || "inicio";
    const hasta = opFilterHasta || "hoy";
    a.download = `Retenciones-Ganancias-${desde}-a-${hasta}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function openOPModal(preloadProveedorId?: string) {
    setPagoParcialDirecto(false);
    setPagoParcialFCId(null);
    setOpForm(preloadProveedorId ? { ...emptyOPForm, proveedor_id: preloadProveedorId } : emptyOPForm);
    setOpError("");
    setOpFiles([]);
    setOpProvCondicion(null);
    setOpManualGanancias(false);
    setOpMontoRetencionManual(null);
    if (preloadProveedorId) {
      const prov = proveedoresOptions.find(p => p.id === preloadProveedorId);
      setProveedorSearch(prov?.razon_social || "");
    } else {
      setProveedorSearch("");
    }
    setOpFCPendientes([]);
    setOpMedios([makeOpMedio()]);
    setOpMonthlyBase(0);
    setOpMonthlyRetenido(0);
    setOpModalOpen(true);
  }

  // Base imponible ganancias (Art. 26 RG 830):
  // 1. Acumular bases sin IVA del mes (OPs previas + esta)
  // 2. Restar mínimo no sujeto a retención
  // 3. Aplicar alícuota
  // 4. Restar retenciones ya practicadas en el mes
  // 5. Verificar monto mínimo de retención (Art. 29)
  const opBaseGanancias = (() => {
    if (!opForm.aplica_ganancias) return 0;
    const minimo = retencionConfig.minimo_ganancias;
    if (opMonthlyBase >= minimo) return opBaseSinIVA; // ya superó antes → retener sobre toda la base sin IVA de esta OP
    return (opMonthlyBase + opBaseSinIVA) - minimo; // esta OP cruza → solo excedente
  })();

  // Retención bruta sobre acumulado, menos retenciones ya practicadas (Art. 26)
  const opRetencionGananciaBruta = (() => {
    if (!opForm.aplica_ganancias || opBaseGanancias <= 0) return 0;
    const minimo = retencionConfig.minimo_ganancias;
    // Calcular retención sobre el acumulado total del mes
    const baseAcumulada = Math.max(0, (opMonthlyBase + opBaseSinIVA) - minimo);
    const retencionAcumulada = baseAcumulada * (opForm.retencion_ganancias_pct / 100);
    // Restar lo ya retenido en OPs previas del mes
    return Math.max(0, retencionAcumulada - opMonthlyRetenido);
  })();

  // Art. 29: si la retención es menor al mínimo, no retener
  // Allow manual override of the final amount
  const opRetencionGanancias = opMontoRetencionManual !== null
    ? Math.round(opMontoRetencionManual * 100) / 100
    : opRetencionGananciaBruta < retencionConfig.minimo_retencion_ganancias
      ? 0
      : Math.round(opRetencionGananciaBruta * 100) / 100;
  const opNetoAPagar = opMontoBruto - opRetencionGanancias;
  const opTotalMedios = opMedios.reduce((s, m) => s + m.monto, 0);
  const opDiferencia = opNetoAPagar - opTotalMedios;

  async function handleParseComprobante(f: File) {
    setOpFiles(prev => [...prev, f]);
    setOpParsingCount(prev => prev + 1);
    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch("/api/parse-cobro", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer el comprobante. Podés completar los medios de pago manualmente.");
      const pagos: any[] = json.data.pagos || (json.data.tipo ? [json.data] : []);
      if (pagos.length === 0) return;
      const mapped: OpMedioPago[] = pagos.map(d => {
        const fields = paymentDocumentFields(d);
        return {
          ...makeOpMedio(fields.moneda),
          ...fields,
          banco_otro: "",
        };
      });
      setOpMedios(prev => [...prev, ...mapped]);
    } catch (error) {
      setOpError(error instanceof Error ? error.message : "No se pudo leer el comprobante. Completá los datos manualmente.");
    } finally {
      setOpParsingCount(prev => Math.max(0, prev - 1));
    }
  }

  async function handleCreateOP() {
    if (!sociedadActiva?.id) { setOpError("No se pudo determinar la sociedad activa"); return; }
    if (!opForm.proveedor_id) { setOpError("Selecciona un proveedor"); return; }
    const selectedFCs = opFCPendientes.filter(f => f.selected);
    if (opDatosError) { setOpError(opDatosError); return; }
    if (opFCLoading || opCondicionLoading || opParsingCount > 0) { setOpError("Esperá a que termine la carga de facturas, condición fiscal y comprobantes antes de generar la OP."); return; }
    if (!opProvCondicion) { setOpError("Falta verificar la condición fiscal del proveedor. Completala en su ficha antes de generar la OP."); return; }
    if (!["RI", "RESPONSABLE INSCRIPTO", "RESPONSABLE INSCRIPTO IVA", "MONOTRIBUTISTA", "MT", "EXENTO", "EX", "CONSUMIDOR FINAL", "CF", "NO RESPONSABLE"].includes(opProvCondicion.trim().toUpperCase())) {
      setOpError("La condición fiscal del proveedor no está reconocida. Revisá su ficha antes de generar la OP."); return;
    }
    if (selectedFCs.length > 0 && selectedFCs.every(f => f.moneda === "USD")) {
      setOpModalOpen(false);
      setFxPago({proveedorId: opForm.proveedor_id, documents: selectedFCs.map(fc => ({id:fc.id,numero:fc.numero,saldo:fc.saldo_pendiente,total:fc.total,subtotal:fc.subtotal,cotizacion:undefined}))});
      return;
    }
    if (selectedFCs.some(f => f.moneda !== opForm.moneda) || opMedios.some(m => m.moneda !== opForm.moneda)) {
      setOpError("Hay documentos o medios en otra moneda. No se puede sumar pesos y dólares sin conversión: esta OP debe tener todos sus importes en la misma moneda."); return;
    }
    if (selectedFCs.some(f => !Number.isFinite(f.monto_a_pagar) || f.monto_a_pagar <= 0 || f.monto_a_pagar > f.saldo_pendiente + 0.005)) {
      setOpError("Revisá el importe a pagar de cada factura: debe ser positivo y no superar su saldo."); return;
    }
    if (selectedFCs.length === 0 && !opForm.usar_monto_manual) { setOpError("Selecciona al menos una factura o ingresa un monto manual"); return; }
    if (opMontoBruto <= 0) { setOpError("El monto a pagar debe ser mayor a 0"); return; }
    // Partial payments are selected per invoice BEFORE calculating retention.
    // Never prorate the final retention: monthly thresholds are not linear.
    const totalMediosVal = opMedios.reduce((s, m) => s + m.monto, 0);
    const selectedEcheqIds = opMedios.map(m => m.echeq_id).filter((id): id is string => Boolean(id));
    if (new Set(selectedEcheqIds).size !== selectedEcheqIds.length) { setOpError("Un mismo e-cheq no puede usarse en dos medios de la OP"); return; }
    if (opMedios.some(m => !Number.isFinite(m.monto) || m.monto < 0)) { setOpError("Los medios de pago no pueden tener importes negativos o inválidos"); return; }
    if (totalMediosVal <= 0) { setOpError("Ingresá al menos un medio de pago con monto mayor a 0"); return; }
    if (!Number.isFinite(opRetencionGanancias) || opRetencionGanancias < 0 || opRetencionGanancias > opMontoBruto) { setOpError("La retención debe estar entre cero y el importe bruto a pagar"); return; }
    const opDiffMedios = totalMediosVal - opNetoAPagar;
    if (opDiffMedios < -1) {
      setOpError("Los medios suman menos que el neto a pagar (faltan $" + Math.abs(opDiffMedios).toFixed(2) + "). Para un pago parcial, modificá primero «A pagar» en cada factura; así se recalcula la retención sobre lo que realmente cancelás."); return;
    }
    if (opDiffMedios > 0.01 && !confirm(`Los medios superan el neto a pagar en $${opDiffMedios.toFixed(2)}. El excedente quedará a favor en la CC del proveedor. ¿Continuar?`)) return;
    if (Math.abs(opDiffMedios) > 0.001 && Math.abs(opDiffMedios) <= 1 && !confirm(`Hay una diferencia de $${Math.abs(opDiffMedios).toFixed(2)} entre los medios y el neto a pagar. ¿Continuar igual?`)) return;
    const montoBrutoEfectivo = opMontoBruto;
    const retencionEfectiva = opRetencionGanancias;
    const baseRetencionEfectiva = opBaseSinIVA;

    setOpSaving(true);
    setOpError("");
    let registeredOP: string | null = null;
    try {
      if (selectedEcheqIds.length) {
        const { data: availableEcheqs, error: echeqLoadError } = await (supabase as any).from("echeqs")
          .select("id, estado, monto, moneda").eq("sociedad_id", sociedadActiva.id).in("id", selectedEcheqIds);
        if (echeqLoadError) throw new Error(`No se pudo verificar la cartera de e-cheqs: ${echeqLoadError.message}`);
        for (const medio of opMedios.filter(m => m.echeq_id)) {
          const cheque = (availableEcheqs || []).find((item: any) => item.id === medio.echeq_id);
          if (!cheque || cheque.estado !== "en_cartera" || cheque.moneda !== medio.moneda || Math.round(Number(cheque.monto) * 100) !== Math.round(medio.monto * 100)) {
            throw new Error("Un e-cheq ya no está disponible o no coincide con el importe y moneda del medio. Actualizá la cartera antes de generar la OP");
          }
        }
      }
      const provNombre = proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social ?? "";
      // Generate OP number atomically via PG function
      const { data: opNumData, error: opNumErr } = await (supabase as any).rpc("next_op_number", { p_sociedad_id: sociedadActiva!.id });
      if (opNumErr) throw new Error("Error al generar número de OP: " + opNumErr.message);
      const opNumero = opNumData as string;

      const insertData: Record<string, unknown> = {
        numero: opNumero,
        fecha: opForm.fecha,
        proveedor_id: opForm.proveedor_id,
        monto_bruto: montoBrutoEfectivo,
        base_retencion_ganancias: baseRetencionEfectiva, // Base efectivamente pagada para acumulado mensual futuro
        retencion_porcentaje: 0,
        retencion_monto: 0,
        retencion_ganancias_pct: opForm.aplica_ganancias ? opForm.retencion_ganancias_pct : 0,
        retencion_ganancias_monto: retencionEfectiva,
        neto_a_pagar: totalMediosVal,
        moneda: opForm.moneda,
        medio_pago: opMedios[0]?.tipo || "transferencia",
        medios_pago: JSON.stringify(opMedios.map(m => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco === "Otro" ? (m.banco_otro?.trim() || "Otro") : m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion, echeq_id: m.echeq_id }))),
        notas: opForm.notas,
        // The OP is paid in full for the chosen amount. Its invoices may still
        // have a balance; marking the OP pending would allow paying it twice.
        estado: "pagada",
        sobre_verde: opForm.sobre_verde || false,
      };
      if (profile?.id) insertData.created_by = profile.id;
      insertData.sociedad_id = sociedadActiva.id;

      const { data: opData, error } = await (supabase as any).from("ordenes_pago").insert(insertData).select("id").single();
      if (error) throw error;
      registeredOP = opNumero;
      const attachmentWarnings: string[] = [];

      // Upload comprobantes (multiple files)
      if (opFiles.length > 0 && opData?.id) {
        const archivosArr: { url: string; nombre: string }[] = [];
        for (let fi = 0; fi < opFiles.length; fi++) {
          const file = opFiles[fi];
          const ext = file.name.split(".").pop() || "pdf";
          const filePath = `${sociedadActiva?.id || "default"}/op-${opData.id}/comprobante-${fi}.${ext}`;
          const { error: upErr } = await supabase.storage.from("comprobantes").upload(filePath, file, { upsert: true });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(filePath);
            archivosArr.push({ url: urlData.publicUrl, nombre: file.name });
          } else attachmentWarnings.push(`${file.name}: ${upErr.message}`);
        }
        if (archivosArr.length > 0) {
          const updateData: Record<string, unknown> = { archivos: JSON.stringify(archivosArr) };
          // El formulario carga archivos de la OP sin asignación explícita a
          // un medio. No inventar vínculos por posición ni tras fallos de carga.
          let opDocUpdate = (supabase as any).from("ordenes_pago").update(updateData).eq("id", opData.id);
          if (sociedadActiva?.id) opDocUpdate = opDocUpdate.eq("sociedad_id", sociedadActiva.id);
          const { error: attachmentError } = await opDocUpdate;
          if (attachmentError) attachmentWarnings.push(`No se pudo guardar la referencia de los archivos: ${attachmentError.message}`);
        }
      }
      setOpFiles([]);

      // Link FCs + update saldo
      if (opData?.id && selectedFCs.length > 0) {
        let saldoAAsignar = montoBrutoEfectivo;
        const links = selectedFCs.map(fc => {
          const monto = Math.min(fc.monto_a_pagar, Math.max(0, saldoAAsignar));
          saldoAAsignar -= monto;
          return { orden_pago_id: opData.id, factura_compra_id: fc.id, monto };
        }).filter((link: { monto: number }) => link.monto > 0);
        const { error: linkErr } = await (supabase as any).from("op_facturas_compra").insert(links);
        if (linkErr) throw new Error("Error al vincular FCs: " + linkErr.message);
        // If monto_a_pagar == saldo_pendiente → pagada; else stays as está
        for (const fc of selectedFCs) {
          const linked = links.find((link: { factura_compra_id: string }) => link.factura_compra_id === fc.id);
          if (linked && Math.round(linked.monto * 100) === Math.round(fc.saldo_pendiente * 100)) {
            let fcUpdate = (supabase as any).from("facturas_compra").update({ estado: "pagada" }).eq("id", fc.id);
            if (sociedadActiva?.id) fcUpdate = fcUpdate.eq("sociedad_id", sociedadActiva.id);
            const { data: updatedFC, error: updateFCError } = await fcUpdate.select("id").maybeSingle();
            if (updateFCError || !updatedFC) throw new Error(`La OP ${opData.numero || opData.id} fue creada, pero no se pudo actualizar la factura ${fc.id}. No vuelvas a generar el pago: revisá esta OP. ${updateFCError?.message || "No se modificó ninguna fila"}`);
          }
        }
      }

      // Create movimientos (pago + retenciones)
      const movBase: Record<string, unknown> = {
        proveedor_id: opForm.proveedor_id,
        moneda: opForm.moneda,
        fecha: opForm.fecha,
        conciliado: true,
      };
      if (profile?.id) movBase.created_by = profile.id;
      if (sociedadActiva?.id) (movBase as any).sociedad_id = sociedadActiva.id;

      // Movimiento principal (neto a pagar)
      const { error: movErr } = await supabase.from("movimientos").insert({ ...movBase, tipo: "pago", descripcion: `${opNumero} — ${provNombre}`, monto: totalMediosVal, orden_pago_id: opData.id } as any);
      if (movErr) throw new Error("Error al crear movimiento: " + movErr.message);

      // Movimiento retención ganancias
      if (retencionEfectiva > 0) {
        const { error: retErr } = await supabase.from("movimientos").insert({ ...movBase, tipo: "retencion_ganancias", descripcion: `${opNumero} — Ret. Ganancias — ${provNombre}`, monto: retencionEfectiva, orden_pago_id: opData.id } as any);
        if (retErr) throw new Error("Error al crear movimiento retención: " + retErr.message);
      }

      // Process cheques: endorse received, create or mark emitted
      for (const m of opMedios) {
        if (m.tipo === "cheque_propio") {
          if (m.echeq_id) {
            // Existing emitted cheque — mark as entregado
            let echeqUpdate = (supabase as any).from("echeqs").update({ estado: "entregado", destino_tipo: "proveedor", destino_id: opForm.proveedor_id, destino_nombre: provNombre }).eq("id", m.echeq_id).eq("estado", "pendiente");
            if (sociedadActiva?.id) echeqUpdate = echeqUpdate.eq("sociedad_id", sociedadActiva.id);
            const { data: claimed, error: claimErr } = await echeqUpdate.select("id");
            if (claimErr || claimed?.length !== 1) throw new Error(`No se pudo reservar el cheque propio ${m.numero_cheque || m.echeq_id}: ${claimErr?.message || "ya cambió de estado"}`);
          } else {
            // Create new emitted cheque
            const newCheque: Record<string, unknown> = {
              tipo_cheque: "fisico", direccion: "emitido", numero: m.numero_cheque || `CHQ-${Date.now()}`,
              banco_emisor: m.banco === "Otro" ? (m.banco_otro?.trim() || "Otro") : (m.banco || null),
              monto: m.monto, moneda: m.moneda, fecha_pago: m.fecha, estado: "entregado",
              destino_tipo: "proveedor", destino_id: opForm.proveedor_id, destino_nombre: provNombre,
            };
            if (sociedadActiva?.id) newCheque.sociedad_id = sociedadActiva.id;
            if (profile?.id) newCheque.user_id = profile.id;
            const { error: newErr } = await (supabase as any).from("echeqs").insert(newCheque);
            if (newErr) throw new Error("Error al registrar cheque propio: " + newErr.message);
          }
        } else if (m.echeq_id) {
          // Received cheque (echeq or cheque tercero) — mark as endosado
          const updateEstado = m.tipo === "cheque" ? "endosado" : "endosado";
          let echeqUpdate = (supabase as any).from("echeqs").update({ estado: updateEstado, destino_tipo: "proveedor", destino_id: opForm.proveedor_id, destino_nombre: provNombre, fecha_endoso: todayAR() }).eq("id", m.echeq_id).eq("estado", "en_cartera");
          if (sociedadActiva?.id) echeqUpdate = echeqUpdate.eq("sociedad_id", sociedadActiva.id);
          const { data: claimedEcheq, error: echeqError } = await echeqUpdate.select("id");
          if (echeqError || claimedEcheq?.length !== 1) throw new Error(`No se pudo reservar el cheque ${m.numero_cheque || m.echeq_id}: ${echeqError?.message || "otro usuario cambió su estado"}. Revisá esta OP antes de entregarlo`);
        }
      }

      setOpModalOpen(false);
      await fetchData();
      if (attachmentWarnings.length) alert(`${opNumero} registrada. Quedaron comprobantes pendientes de adjuntar desde el detalle de la OP:\n${attachmentWarnings.join("\n")}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al crear la OP";
      setOpError(registeredOP ? `${registeredOP} ya está registrada y necesita revisión: ${message}. No vuelvas a generar el pago.` : message);
    } finally {
      setOpSaving(false);
    }
  }

  async function handleAnularOP(id: string) {
    if (!confirm("¿Seguro que queres anular esta orden de pago?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      // Check if this OP belongs to an FX settlement
      const { data: fxLink } = await (supabase as any).from("liquidaciones_fx").select("id").eq("orden_pago_id", id).eq("sociedad_id", sociedadActiva.id).maybeSingle();
      if (fxLink?.id) {
        const { data: result, error: fxErr } = await (supabase as any).rpc("anular_liquidacion_fx", { p_id: fxLink.id, p_sociedad_id: sociedadActiva.id });
        if (fxErr) throw new Error(fxErr.message);
        await fetchData();
        return;
      }
      // Get OP details for movimiento cleanup
      let opQuery = (supabase as any).from("ordenes_pago").select("numero, proveedor_id").eq("id", id);
      if (sociedadActiva?.id) opQuery = opQuery.eq("sociedad_id", sociedadActiva.id);
      const { data: opRow } = await opQuery.single();
      let opUpdate = (supabase as any).from("ordenes_pago").update({ estado: "anulada" }).eq("id", id);
      if (sociedadActiva?.id) opUpdate = opUpdate.eq("sociedad_id", sociedadActiva.id);
      const { error } = await opUpdate;
      if (error) throw error;

      // No borrar movimientos: la anulación debe conservar el rastro contable.
      // Se marcan como anulados para excluirlos de saldos y conciliaciones.
      // Prefer orden_pago_id link; fallback to description pattern for legacy data.
      let movUpdate = (supabase as any).from("movimientos").update({ anulado: true, anulado_at: new Date().toISOString() })
        .eq("orden_pago_id", id);
      if (sociedadActiva?.id) movUpdate = movUpdate.eq("sociedad_id", sociedadActiva.id);
      const { data: movUpdated, error: movError } = await movUpdate.select("id");
      if (movError) throw movError;
      // Fallback for old movimientos without orden_pago_id
      if ((!movUpdated || movUpdated.length === 0) && opRow?.numero && opRow?.proveedor_id) {
        let movFallback = supabase.from("movimientos").update({ anulado: true, anulado_at: new Date().toISOString() } as any)
          .like("descripcion" as any, `${opRow.numero} — %`).eq("proveedor_id" as any, opRow.proveedor_id);
        if (sociedadActiva?.id) movFallback = movFallback.eq("sociedad_id" as any, sociedadActiva.id);
        await movFallback;
      }

      // Un e-cheq endosado por esta OP vuelve a estar disponible en cartera.
      let opMediosQuery = (supabase as any).from("ordenes_pago").select("medios_pago").eq("id", id);
      if (sociedadActiva?.id) opMediosQuery = opMediosQuery.eq("sociedad_id", sociedadActiva.id);
      const { data: opMediosRow } = await opMediosQuery.single();
      let mediosAnulados: any[] = [];
      try { mediosAnulados = typeof opMediosRow?.medios_pago === "string" ? JSON.parse(opMediosRow.medios_pago) : (opMediosRow?.medios_pago || []); } catch { mediosAnulados = []; }
      for (const medio of mediosAnulados) {
        if (!medio?.echeq_id) continue;
        let echeqUpdate = (supabase as any).from("echeqs").update({ estado: "en_cartera", destino_nombre: null }).eq("id", medio.echeq_id);
        if (sociedadActiva?.id) echeqUpdate = echeqUpdate.eq("sociedad_id", sociedadActiva.id);
        const { error: echeqErr } = await echeqUpdate;
        if (echeqErr) console.error("Error restaurando echeq:", echeqErr);
      }

      // Revertir FCs vinculadas a pendiente si quedaron como pagadas
      const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id").eq("orden_pago_id", id);
      if (links && links.length > 0) {
        for (const link of links) {
          const { data: allPayments } = await (supabase as any)
            .from("op_facturas_compra").select("monto, orden_pago_id")
            .eq("factura_compra_id", link.factura_compra_id);
          const { data: anuladas } = await (supabase as any)
            .from("ordenes_pago").select("id, sociedad_id").in("id", (allPayments || []).map((p: any) => p.orden_pago_id)).eq("estado", "anulada");
          const anuladasSociedad = sociedadActiva?.id ? (anuladas || []).filter((a: any) => a.sociedad_id === sociedadActiva.id) : (anuladas || []);
          const anuladasSet = new Set(anuladasSociedad.map((a: any) => a.id));
          const totalVigente = (allPayments || []).filter((p: any) => !anuladasSet.has(p.orden_pago_id)).reduce((s: number, p: any) => s + Number(p.monto), 0);
          let fcQuery = (supabase as any).from("facturas_compra").select("total, estado").eq("id", link.factura_compra_id);
          if (sociedadActiva?.id) fcQuery = fcQuery.eq("sociedad_id", sociedadActiva.id);
          const { data: fc } = await fcQuery.single();
          if (fc && fc.estado === "pagada" && totalVigente < Number(fc.total) - 1) {
            let fcUpdate = (supabase as any).from("facturas_compra").update({ estado: "pendiente" }).eq("id", link.factura_compra_id);
            if (sociedadActiva?.id) fcUpdate = fcUpdate.eq("sociedad_id", sociedadActiva.id);
            await fcUpdate;
          }
        }
      }

      await fetchData();
    } catch (err) { alert("Error anulando OP: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handlePagarOP(id: string) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let opUpdate = (supabase as any).from("ordenes_pago").update({ estado: "pagada" }).eq("id", id);
      if (sociedadActiva?.id) opUpdate = opUpdate.eq("sociedad_id", sociedadActiva.id);
      const { error } = await opUpdate;
      if (error) throw error;

      // Marcar FCs vinculadas como pagadas si el monto cubre el saldo
      const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto").eq("orden_pago_id", id);
      if (links && links.length > 0) {
        for (const link of links) {
          // Sumar pagos de OPs no-anuladas para esta FC
          const { data: allPayments } = await (supabase as any).from("op_facturas_compra").select("monto, orden_pago_id").eq("factura_compra_id", link.factura_compra_id);
          const opIds = [...new Set((allPayments || []).map((p: any) => p.orden_pago_id))];
          const { data: opsActivas } = await (supabase as any).from("ordenes_pago").select("id").in("id", opIds).neq("estado", "anulada");
          const activasSet = new Set((opsActivas || []).map((o: any) => o.id));
          const totalPagado = (allPayments || []).filter((p: any) => activasSet.has(p.orden_pago_id)).reduce((s: number, p: any) => s + Number(p.monto), 0);
          let fcQuery = (supabase as any).from("facturas_compra").select("total").eq("id", link.factura_compra_id);
          if (sociedadActiva?.id) fcQuery = fcQuery.eq("sociedad_id", sociedadActiva.id);
          const { data: fc } = await fcQuery.single();
          if (fc && Math.abs(totalPagado - Number(fc.total)) < 1) {
            let fcUpdate = (supabase as any).from("facturas_compra").update({ estado: "pagada" }).eq("id", link.factura_compra_id);
            if (sociedadActiva?.id) fcUpdate = fcUpdate.eq("sociedad_id", sociedadActiva.id);
            await fcUpdate;
          }
        }
      }

      await fetchData();
    } catch (err) { alert("Error marcando OP como pagada: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handleGenerarComprobante(op: OrdenPagoRow) {
    if (!sociedadActiva) return;

    // Fetch proveedor CUIT & dirección
    let provCuit = "";
    let provDir = "";
    try {
      const { data: provData } = await (supabase as any).from("proveedores").select("cuit, direccion").eq("id", op.proveedor_id).single();
      if (provData) {
        provCuit = provData.cuit || "";
        provDir = provData.direccion || "";
      }
    } catch { /* ignore */ }

    // Fetch linked FCs
    let fcsRows: { numero: string; fecha: string; monto: number }[] = [];
    try {
      const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto").eq("orden_pago_id", op.id);
      if (links && links.length > 0) {
        const fcIds = links.map((l: any) => l.factura_compra_id);
        const { data: fcs } = await (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, total").in("id", fcIds);
        if (fcs && fcs.length > 0) {
          fcsRows = fcs.map((fc: any) => {
            const link = links.find((l: any) => l.factura_compra_id === fc.id);
            return { numero: fc.numero_factura || "\u2014", fecha: fc.fecha, monto: Number(link?.monto ?? fc.total) };
          });
        }
      }
    } catch { /* ignore */ }

    // Build medios array
    const medios = op.medios_pago && op.medios_pago.length > 0
      ? op.medios_pago.map(m => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion }))
      : [{ tipo: op.medio_pago, monto: op.neto, fecha: op.fecha, banco: "", numero_cheque: "", moneda: op.moneda as "ARS" | "USD", cotizacion: 1 }];

    const soc = getSociedadPDF(sociedadActiva);
    const html = generateOrdenPagoPDF({
      numero: op.numero || "",
      fecha: op.fecha,
      estado: op.estado,
      moneda: op.moneda,
      monto_bruto: op.monto_bruto,
      retencion_ganancias_pct: op.retencion_ganancias_pct,
      retencion_ganancias_monto: op.retencion_ganancias_monto,
      neto: op.neto,
      notas: op.notas,
      proveedor: { razon_social: op.proveedor_nombre, cuit: provCuit, direccion: provDir },
      medios,
      facturas_vinculadas: fcsRows,
    }, soc);

    openPDFWindow(html, `${op.numero || "Orden-de-pago"}.pdf`);
  }

  async function openOrdenPagoEmail(op: OrdenPagoRow) {
    const template = await loadEmailTemplate("orden_pago", sociedadActiva?.id || "");
    const vars = {
      numero: op.numero || "",
      sociedad: sociedadActiva?.razonSocial || "Lazzari",
      total: formatCurrency(op.neto, op.moneda),
      fecha: formatDate(op.fecha),
      proveedor: op.proveedor_nombre || "",
    };
    const proveedorEmail = op.proveedor_email
      || proveedoresOptions.find((proveedor) => proveedor.id === op.proveedor_id)?.email
      || "";

    // Fetch proveedor + contactos emails
    const suggested: { email: string; label?: string }[] = [];
    try {
      const { data: provData } = await supabase.from("proveedores").select("email").eq("id", op.proveedor_id).single();
      if (provData?.email) suggested.push({ email: provData.email, label: "Proveedor" });
      const { data: contactos } = await (supabase as any).from("contactos").select("nombre, email").eq("entity_type", "proveedor").eq("entity_id", op.proveedor_id);
      if (contactos) {
        for (const c of contactos) {
          if (c.email && !suggested.some(s => s.email === c.email)) {
            suggested.push({ email: c.email, label: c.nombre || "Contacto" });
          }
        }
      }
    } catch { /* ignore */ }

    // Collect comprobantes from OP archivos
    const opAttachments: { filename: string; url: string }[] = [];
    if (op.archivos?.length) {
      for (const a of op.archivos) {
        if (a.url) opAttachments.push({ filename: a.nombre || "comprobante.pdf", url: a.url });
      }
    }

    setEmailModal({
      open: true,
      id: op.id,
      to: proveedorEmail,
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: `OP-${op.numero || op.id.slice(0, 8)}.pdf`,
      suggestedEmails: suggested,
      extraAttachments: opAttachments,
    });
  }

  async function handleUploadCertificado(opId: string, file: File) {
    setUploadingCert(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `op/${opId}/certificado_retencion.${ext}`;
      const { error: uploadError } = await supabase.storage.from("certificados").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("certificados").getPublicUrl(path);
      const publicUrl = urlData?.publicUrl;
      if (publicUrl) {
        let certUpdate = (supabase as any).from("ordenes_pago").update({ certificado_retencion_url: publicUrl }).eq("id", opId);
        if (sociedadActiva?.id) certUpdate = certUpdate.eq("sociedad_id", sociedadActiva.id);
        const { error: certUpdErr } = await certUpdate;
        if (certUpdErr) throw certUpdErr;
        // Update local state
        setOrdenesPago(prev => prev.map(o => o.id === opId ? { ...o, certificado_retencion_url: publicUrl } : o));
        if (selectedOP?.id === opId) setSelectedOP(prev => prev ? { ...prev, certificado_retencion_url: publicUrl } : null);
      }
    } catch (err) {
      console.error("Error subiendo certificado:", err);
      alert("Error al subir el certificado de retención");
    } finally {
      setUploadingCert(false);
    }
  }

  // ── Gastos manuales handlers ──
  function openGMModal() {
    setGmForm(emptyGastoManualForm);
    setGmEditingId(null);
    setGmError("");
    setGmProvSearch("");
    setGmFile(null);
    setGmModalOpen(true);
  }

  function openGMEdit(gm: GastoManualRow) {
    setGmEditingId(gm.id);
    setGmForm({
      descripcion: gm.descripcion,
      proveedor_id: gm.proveedor_id || "",
      categoria: gm.categoria,
      tipo_gasto: gm.tipo_gasto,
      tipo_recurrencia: gm.tipo_recurrencia || "eventual",
      medio_pago: gm.medio_pago,
      monto: gm.monto,
      moneda: gm.moneda as "ARS" | "USD",
      notas: gm.notas,
      fecha: gm.fecha,
    });
    setGmError("");
    setGmProvSearch(gm.proveedor_nombre || "");
    setGmFile(null);
    setGmModalOpen(true);
  }

  async function handleCreateGM() {
    if (!sociedadActiva?.id) { setGmError("No se pudo determinar la sociedad activa"); return; }
    if (!gmForm.descripcion.trim()) { setGmError("La descripcion es obligatoria"); return; }
    if (gmForm.monto <= 0) { setGmError("El monto debe ser mayor a 0"); return; }
    setGmSaving(true);
    setGmError("");
    try {
      // Upload comprobante file if provided
      let comprobanteUrl: string | undefined;
      if (gmFile) {
        setGmUploading(true);
        const ext = gmFile.name.split(".").pop() ?? "pdf";
        const filePath = `gastos/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprobantes").upload(filePath, gmFile);
        setGmUploading(false);
        if (upErr) throw new Error("Error subiendo comprobante: " + upErr.message);
        const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(filePath);
        comprobanteUrl = urlData.publicUrl;
      }

      const payload: Record<string, unknown> = {
        fecha: gmForm.fecha,
        descripcion: gmForm.descripcion,
        categoria: gmForm.categoria,
        tipo_gasto: gmForm.tipo_gasto,
        tipo_recurrencia: gmForm.tipo_recurrencia,
        monto: gmForm.monto,
        moneda: gmForm.moneda,
        notas: gmForm.notas || "",
        medio_pago: gmForm.medio_pago || "efectivo",
        proveedor_id: gmForm.proveedor_id || null,
      };
      if (comprobanteUrl) payload.comprobante_url = comprobanteUrl;

      if (gmEditingId) {
        // Update existing gasto
        let gmUpdate = (supabase as any).from("gastos_manuales").update(payload).eq("id", gmEditingId);
        if (sociedadActiva?.id) gmUpdate = gmUpdate.eq("sociedad_id", sociedadActiva.id);
        const { error } = await gmUpdate;
        if (error) throw error;
      } else {
        // Insert new gasto
        payload.sociedad_id = sociedadActiva.id;
        if (profile?.id) payload.created_by = profile.id;
        const { error } = await (supabase as any).from("gastos_manuales").insert(payload);
        if (error) throw error;

        // Also create a movimiento for new gastos (non-fatal — gasto already saved)
        try {
          const provNombre = gmForm.proveedor_id ? proveedoresOptions.find(p => p.id === gmForm.proveedor_id)?.razon_social : null;
          const movData: Record<string, unknown> = {
            tipo: "pago",
            descripcion: `Gasto — ${gmForm.categoria} — ${gmForm.descripcion}${provNombre ? ` (${provNombre})` : ""}`,
            monto: gmForm.monto,
            moneda: gmForm.moneda,
            fecha: gmForm.fecha,
            conciliado: false,
          };
          if (gmForm.proveedor_id) (movData as any).proveedor_id = gmForm.proveedor_id;
          if (sociedadActiva?.id) (movData as any).sociedad_id = sociedadActiva.id;
          if (profile?.id) (movData as any).created_by = profile.id;
          const { error: movGastoErr } = await supabase.from("movimientos").insert(movData as any);
          if (movGastoErr) throw new Error("Gasto creado pero error al registrar movimiento: " + movGastoErr.message);
        } catch (movErr: any) {
          alert(movErr.message || "Error al registrar movimiento del gasto");
        }
      }

      setGmModalOpen(false);
      setGmForm(emptyGastoManualForm);
      setGmEditingId(null);
      await fetchData();
    } catch (err: unknown) {
      setGmError(err instanceof Error ? err.message : "Error al crear el gasto");
    } finally {
      setGmSaving(false);
    }
  }

  async function handleDeleteGM(id: string) {
    if (!confirm("¿Seguro que queres eliminar este gasto?")) return;
    try {
      let gmDelete = (supabase as any).from("gastos_manuales").delete().eq("id", id);
      if (sociedadActiva?.id) gmDelete = gmDelete.eq("sociedad_id", sociedadActiva.id);
      const { error } = await gmDelete;
      if (error) throw error;
      await fetchData();
    } catch (err) { alert("Error eliminando gasto: " + (err instanceof Error ? err.message : String(err))); }
  }

  // ── Facturas compra handlers ──
  async function openFCModal() {
    setFcForm(emptyFCForm);
    setFcError("");
    setFcProvSearch("");
    setFcFile(null);
    setFcItems([]);
    setFcProdSearch("");
    setFcModalOpen(true);
    // Load productos for item search if not already loaded
    if (fcProductos.length === 0) {
      try {
        let q = supabase.from("productos").select("id, codigo, nombre, precio_costo, unidad, stock").eq("activo", true).order("nombre");
        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await q;
        if (data) setFcProductos(data as any[]);
      } catch { /* ignore */ }
    }
  }

  // Compute IVA: if items exist with per-item IVA, compute from items; otherwise use header rate
  const fcIva = fcItems.length > 0
    ? fcItems.reduce((sum, it) => sum + fcItemNeto(it) * ((it.iva_porcentaje ?? 21) / 100), 0)
    : fcForm.subtotal * (fcForm.iva_porcentaje / 100);
  const fcTotal = fcForm.subtotal + fcIva + fcForm.percepciones;
  // Group items by IVA rate for display
  const fcIvaByRate: Record<number, number> = {};
  if (fcItems.length > 0) {
    for (const it of fcItems) {
      const lineSubtotal = fcItemNeto(it);
      const lineIva = lineSubtotal * ((it.iva_porcentaje ?? 21) / 100);
      fcIvaByRate[it.iva_porcentaje ?? 21] = (fcIvaByRate[it.iva_porcentaje ?? 21] || 0) + lineIva;
    }
  }

  async function handleParseFCPdf(file: File) {
    setFcPdfParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Error al procesar PDF");
      const d = json.data;
      // Auto-fill form fields
      const updates: Partial<typeof fcForm> = {};
      if (d.numero_factura) updates.numero_factura = d.numero_factura;
      if (d.fecha) updates.fecha = d.fecha;
      if (d.fecha_vencimiento) updates.fecha_vencimiento = d.fecha_vencimiento;
      if (d.subtotal) updates.subtotal = Number(d.subtotal);
      if (d.iva_porcentaje) updates.iva_porcentaje = Number(d.iva_porcentaje);
      if (d.percepciones) updates.percepciones = Number(d.percepciones);
      if (d.moneda) updates.moneda = d.moneda as "ARS" | "USD";
      if (d.cae) updates.cae = d.cae;
      if (d.notas) updates.notas = d.notas;
      setFcForm(prev => ({ ...prev, ...updates }));
      // Try to match proveedor by CUIT
      if (d.proveedor?.cuit) {
        const cuitClean = d.proveedor.cuit.replace(/\D/g, "");
        const match = proveedoresOptions.find(p => p.cuit?.replace(/\D/g, "") === cuitClean);
        if (match) {
          setFcForm(prev => ({ ...prev, ...updates, proveedor_id: match.id }));
          setFcProvSearch(match.razon_social);
        }
      }
      // Auto-fill items if present
      if (d.items && Array.isArray(d.items) && d.items.length > 0) {
        const parsedItems: FCItem[] = d.items.map((it: { descripcion?: string; cantidad?: number; precio_unitario?: number; descuento_porcentaje?: number; iva_porcentaje?: number; unidad?: string }, idx: number) => ({
          tempId: `pdf-${Date.now()}-${idx}`,
          producto_id: "",
          codigo: "",
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precio_unitario) || 0,
          descuento_porcentaje: Math.max(0, Math.min(100, Number(it.descuento_porcentaje ?? d.descuento_general_porcentaje) || 0)),
          unidad: it.unidad || "UN",
          iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
        }));
        setFcItems(parsedItems);
      }
      // Also set the uploaded PDF as attachment
      setFcFile(file);
      alert("Datos importados del PDF — verifica que sean correctos");
    } catch (err) {
      alert("Error al importar PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setFcPdfParsing(false);
    }
  }

  async function handleCreateFC() {
    if (!sociedadActiva?.id) { setFcError("No se pudo determinar la sociedad activa"); return; }
    if (!fcForm.proveedor_id) { setFcError("Seleccioná un proveedor o elegí 'Cargar sin proveedor'"); return; }
    if (!fcForm.numero_factura.trim()) { setFcError("El número de factura es obligatorio"); return; }
    if (fcForm.subtotal <= 0) { setFcError("El subtotal debe ser mayor a 0"); return; }
    const isMercaderia = fcForm.tipo_fc === "mercaderia";
    setFcSaving(true);
    setFcError("");
    try {
      if (isMercaderia && fcForm.orden_compra_id) {
        const { data: freshOC, error: freshOCError } = await (supabase as any)
          .from("ordenes_compra")
          .select("id, total, moneda")
          .eq("id", fcForm.orden_compra_id)
          .single();
        if (freshOCError || !freshOC) throw new Error("No se pudo verificar la OC. No se guardó nada.");
        if (freshOC.moneda !== fcForm.moneda) {
          throw new Error(`La factura está en ${fcForm.moneda} y la OC está en ${freshOC.moneda}.`);
        }
        const previousInvoices = await fetchExistingOCInvoices(fcForm.orden_compra_id);
        if (previousInvoices.some((invoice) => invoice.moneda !== fcForm.moneda)) {
          throw new Error("La OC tiene facturas vinculadas en otra moneda. Revisala antes de continuar.");
        }
        const previousTotal = previousInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
        const remaining = Math.round((Number(freshOC.total || 0) - previousTotal) * 100) / 100;
        const fcSinPercepciones = fcForm.subtotal + fcIva;
        if (fcSinPercepciones - remaining > 0.01) {
          throw new Error(`El comprobante supera en ${formatCurrency(fcSinPercepciones - remaining, fcForm.moneda)} el saldo de la OC. Corregí precios, descuentos o IVA.`);
        }
      }

      const provId = fcForm.proveedor_id === "sin_proveedor" ? null : fcForm.proveedor_id;
      const insertData: Record<string, unknown> = {
        numero_factura: fcForm.numero_factura.trim(),
        proveedor_id: provId,
        fecha: fcForm.fecha,
        subtotal: fcForm.subtotal,
        iva_porcentaje: fcForm.iva_porcentaje,
        iva: fcIva,
        percepciones: fcForm.percepciones,
        total: fcTotal,
        moneda: fcForm.moneda,
        notas: fcForm.notas,
        estado: "pendiente",
        solo_iva: !isMercaderia,
        tipo: fcForm.tipo_fc,
        tipo_comprobante: fcForm.tipo_comprobante,
      };
      if (fcForm.orden_compra_id && isMercaderia) insertData.orden_compra_id = fcForm.orden_compra_id;
      if (fcForm.fecha_vencimiento) insertData.fecha_vencimiento = fcForm.fecha_vencimiento;
      if (fcForm.cae.trim()) insertData.cae = fcForm.cae.trim();
      if (fcForm.percepciones_detalle.length > 0) insertData.percepciones_detalle = JSON.stringify(fcForm.percepciones_detalle);
      if (fcForm.costo_real > 0) insertData.costo_real = fcForm.costo_real;
      if (profile?.id) insertData.created_by = profile.id;
      insertData.sociedad_id = sociedadActiva.id;

      const { data: fcData, error } = await (supabase as any).from("facturas_compra").insert(insertData).select("id").single();
      if (error) throw error;

      // Insert items and update stock (solo para mercadería)
      if (isMercaderia && fcItems.length > 0 && fcData?.id) {
        const itemsToInsert = fcItems.map((it) => ({
          factura_compra_id: fcData.id,
          producto_id: it.producto_id || null,
          codigo: it.codigo || null,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precio_unitario: it.precio_unitario,
          descuento_porcentaje: it.descuento_porcentaje,
          unidad: it.unidad,
          iva_porcentaje: it.iva_porcentaje,
          sociedad_id: sociedadActiva.id,
        }));
        const { error: fcItemsErr } = await (supabase as any).from("facturas_compra_items").insert(itemsToInsert);
        if (fcItemsErr) throw new Error("Error al guardar items de FC: " + fcItemsErr.message);

        // Stock se actualiza al marcar como "recibida" (handleRecibirFC)
      }

      // Upload PDF if provided
      if (fcFile && fcData?.id) {
        setFcUploading(true);
        const ext = fcFile.name.split(".").pop() || "pdf";
        const filePath = `${sociedadActiva?.id || "default"}/${fcData.id}/factura.${ext}`;
        const { error: upErr } = await supabase.storage.from("facturas-compra").upload(filePath, fcFile, { upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from("facturas-compra").getPublicUrl(filePath);
          let fcFileUpdate = (supabase as any).from("facturas_compra").update({ archivo_url: urlData.publicUrl, archivo_nombre: fcFile.name }).eq("id", fcData.id);
          if (sociedadActiva?.id) fcFileUpdate = fcFileUpdate.eq("sociedad_id", sociedadActiva.id);
          const { error: fcFileErr } = await fcFileUpdate;
          if (fcFileErr) console.error("Error guardando referencia de archivo FC:", fcFileErr);
        }
        setFcUploading(false);
      }

      // Create gasto_manual for solo_iva with costo_real
      if (fcForm.tipo_fc === "solo_iva" && fcForm.costo_real > 0 && fcData?.id) {
        const { error: gmInsertErr } = await (supabase as any).from("gastos_manuales").insert({
          descripcion: `Compra credito fiscal IVA — FC ${fcForm.numero_factura.trim()}`,
          categoria: "Impuestos",
          monto: fcForm.costo_real,
          moneda: fcForm.moneda,
          fecha: fcForm.fecha,
          proveedor_id: fcForm.proveedor_id,
          sociedad_id: sociedadActiva?.id || null,
          created_by: profile?.id || null,
          tipo_recurrencia: "eventual",
          tipo_gasto: "Compra IVA",
          medio_pago: "efectivo",
        });
        if (gmInsertErr) console.error("Error creando gasto manual para IVA:", gmInsertErr);
      }

      setFcModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      setFcError(err instanceof Error ? err.message : "Error al crear la factura");
    } finally {
      setFcSaving(false);
    }
  }

  async function handleDeleteFC(id: string) {
    if (!confirm("¿Seguro que querés eliminar esta factura de compra?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let fcDelete = (supabase as any).from("facturas_compra").delete().eq("id", id);
      if (sociedadActiva?.id) fcDelete = fcDelete.eq("sociedad_id", sociedadActiva.id);
      const { error } = await fcDelete;
      if (error) throw error;
      await fetchData();
    } catch (err) { console.error("Error eliminando FC:", err); alert("Error al eliminar FC: " + (err instanceof Error ? err.message : String(err))); }
  }

  function handlePagarFC(id: string) {
    const fc = facturasCompra.find(f => f.id === id);
    if (!fc) return;
    // Open OP modal pre-loaded with this FC's proveedor
    openOPModal(fc.proveedor_id || "");
  }

  function handlePagoParcialDirecto(id: string) {
    const fc = facturasCompra.find(f => f.id === id);
    if (!fc || !fc.proveedor_id) return;
    openOPModal(fc.proveedor_id);
    setPagoParcialDirecto(true);
    setPagoParcialFCId(id);
  }

  async function handleRegistrarPagoParcialDirecto() {
    const selected = opFCPendientes.filter(f => f.selected);
    const fc = selected.length === 1 ? selected[0] : null;
    const total = opMedios.reduce((sum, medio) => sum + Number(medio.monto), 0);
    if (!fc) { setOpError("Seleccioná una sola factura para registrar el pago parcial directo"); return; }
    if (!sociedadActiva?.id) { setOpError("No se pudo determinar la sociedad activa"); return; }
    if (opDatosError) { setOpError(opDatosError); return; }
    if (opFCLoading || opCondicionLoading || opParsingCount > 0) { setOpError("Esperá a que terminen de verificarse facturas, condición fiscal y comprobantes"); return; }
    if (!opProvCondicion || !opForm.proveedor_id) { setOpError("Falta verificar la condición fiscal del proveedor"); return; }
    const knownConditions = ["RI", "RESPONSABLE INSCRIPTO", "RESPONSABLE INSCRIPTO IVA", "MONOTRIBUTISTA", "MT", "EXENTO", "EX", "CONSUMIDOR FINAL", "CF", "NO RESPONSABLE"];
    if (!knownConditions.includes(String(opProvCondicion).trim().toUpperCase())) { setOpError("La condición fiscal del proveedor no está reconocida. Revisá su ficha antes de registrar el pago"); return; }
    if (fc.moneda === "USD") {
      setOpModalOpen(false);
      setFxPago({proveedorId: opForm.proveedor_id, documents: [{id:fc.id,numero:fc.numero,saldo:fc.saldo_pendiente,total:fc.total,subtotal:fc.subtotal,cotizacion:undefined}]});
      return;
    }
    if (opForm.moneda !== "ARS") { setOpError("El pago en dólares requiere registrar su conversión a pesos antes de calcular las retenciones"); return; }
    if (opForm.usar_monto_manual) { setOpError("Para un pago parcial directo indicá el importe bruto en «A pagar» de la factura"); return; }
    if (fc.moneda !== opForm.moneda || opMedios.some(m => m.moneda !== opForm.moneda)) { setOpError("La factura y todos los medios deben estar en la misma moneda"); return; }
    const bruto = Number(fc.monto_a_pagar);
    const retencion = Number(opRetencionGanancias);
    if (!Number.isFinite(bruto) || bruto <= 0 || bruto >= fc.saldo_pendiente - 0.005) { setOpError("El importe bruto debe ser positivo y menor al saldo pendiente; para cancelarlo usá Generar OP"); return; }
    if (!Number.isFinite(retencion) || retencion < 0 || retencion > bruto) { setOpError("La retención debe estar entre cero y el bruto a pagar"); return; }
    if (opMedios.some(m => !Number.isFinite(Number(m.monto)) || Number(m.monto) < 0) || total <= 0) { setOpError("Ingresá medios de pago válidos, sin importes negativos"); return; }
    if (Math.round(total * 100) !== Math.round((bruto - retencion) * 100)) { setOpError("Los medios deben sumar el neto: importe bruto «A pagar» menos la retención calculada"); return; }
    setOpSaving(true);
    setOpError("");
    try {
      const { data: fresh, error: freshError } = await (supabase as any).from("facturas_compra")
        .select("id, proveedor_id, total, subtotal, percepciones, moneda, numero_factura, estado")
        .eq("id", fc.id).eq("sociedad_id", sociedadActiva.id).single();
      if (freshError || !fresh) throw new Error("No se pudo verificar la factura de compra");
      if (fresh.proveedor_id !== opForm.proveedor_id) throw new Error("La factura no pertenece al proveedor seleccionado");
      if (!["pendiente", "recibida"].includes(fresh.estado)) throw new Error("La factura cambió de estado. Reabrí el pago para verificar su saldo");
      if (fresh.moneda !== opForm.moneda) throw new Error("La moneda de la factura cambió. Reabrí el pago");
      const ratioSinIVA = Number(fresh.total) > 0
        ? (Number(fresh.subtotal || 0) + Number(fresh.percepciones || 0)) / Number(fresh.total) : 0;
      const base = Math.round(bruto * ratioSinIVA * 100) / 100;
      if (!Number.isFinite(base) || Math.abs(base - opBaseSinIVA) > 0.005) throw new Error("La base de la factura cambió. Reabrí el pago para recalcular la retención");
      const pctGanancias = opForm.aplica_ganancias ? Number(opForm.retencion_ganancias_pct) : 0;
      const [{ data: existing, error: existingError }, { data: links, error: linksError }] = await Promise.all([
        (supabase as any).from("movimientos").select("monto, retencion_ganancias_monto, anulado")
          .eq("factura_compra_id", fresh.id).eq("tipo", "pago").eq("sociedad_id", sociedadActiva.id),
        (supabase as any).from("op_facturas_compra").select("monto, ordenes_pago(id, estado, sociedad_id)")
          .eq("factura_compra_id", fresh.id),
      ]);
      if (existingError || linksError) throw new Error("No se pudieron verificar los pagos previos. No se registró ningún pago");
      // El movimiento directo guarda neto + retención en la misma fila. La
      // fila separada de retención NO se suma otra vez; OP usa su vínculo bruto.
      const pagadoDirecto = (existing || []).filter((p: any) => !p.anulado)
        .reduce((sum: number, p: any) => sum + Number(p.monto || 0) + Number(p.retencion_ganancias_monto || 0), 0);
      if ((links || []).some((link: any) => !link.ordenes_pago || link.ordenes_pago.sociedad_id !== sociedadActiva.id)) throw new Error("No se pudo verificar la OP vinculada. Revisá el historial de la factura");
      const pagadoOP = (links || []).filter((p: any) => p.ordenes_pago.estado !== "anulada")
        .reduce((sum: number, p: any) => sum + Number(p.monto || 0), 0);
      const saldoActual = Number(fresh.total) - pagadoDirecto - pagadoOP;
      if (!Number.isFinite(saldoActual) || bruto >= saldoActual - 0.005) throw new Error("El importe completa o supera el saldo actual; reabrí la factura y generá una OP para cancelarlo");
      const paymentRows: Record<string, unknown>[] = [{
        tipo: "pago",
        proveedor_id: fresh.proveedor_id,
        factura_compra_id: fresh.id,
        monto: total,
        base_retencion_ganancias: base,
        retencion_ganancias_pct: pctGanancias,
        retencion_ganancias_monto: retencion,
        moneda: fresh.moneda || opForm.moneda,
        fecha: opForm.fecha,
        descripcion: `Pago parcial directo — ${fresh.numero_factura || "FC"} — ${opMedios.map((m) => m.tipo).join(" + ")}`,
        conciliado: true,
        sociedad_id: sociedadActiva.id,
        created_by: profile?.id || null,
      }];
      if (retencion > 0) {
        paymentRows.push({
          tipo: "retencion_ganancias", proveedor_id: fresh.proveedor_id, factura_compra_id: fresh.id,
          monto: retencion, moneda: fresh.moneda || opForm.moneda, fecha: opForm.fecha,
          descripcion: `Pago parcial directo — Ret. Ganancias — ${fresh.numero_factura || "FC"}`,
          base_retencion_ganancias: base, retencion_ganancias_pct: pctGanancias,
          retencion_ganancias_monto: retencion, conciliado: true, sociedad_id: sociedadActiva.id,
          created_by: profile?.id || null,
        });
      }
      // Un INSERT con ambas filas es atómico: nunca queda solo pago o retención.
      const { error } = await (supabase as any).from("movimientos").insert(paymentRows);
      if (error) throw error;
      setOpModalOpen(false);
      setPagoParcialDirecto(false);
      setPagoParcialFCId(null);
      await fetchData();
    } catch (err: unknown) {
      setOpError(err instanceof Error ? err.message : "No se pudo registrar el pago parcial");
    } finally { setOpSaving(false); }
  }

  async function handleToggleSobreVerde(opId: string, current: boolean) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      let q = (supabase as any).from("ordenes_pago").update({ sobre_verde: !current }).eq("id", opId);
      if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
      const { error } = await q;
      if (error) throw error;
      setOrdenesPago(prev => prev.map(op => op.id === opId ? { ...op, sobre_verde: !current } : op));
      setFacturasCompra(prev => prev.map(fc => fc.op_vinculada?.id === opId
        ? { ...fc, op_vinculada: fc.op_vinculada ? { ...fc.op_vinculada, sobre_verde: !current } : fc.op_vinculada }
        : fc));
    } catch (err) {
      alert("No se pudo actualizar el sobre verde: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleAnularFC(id: string) {
    if (!confirm("¿Seguro que querés anular esta factura?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
    let fcAnular = (supabase as any).from("facturas_compra").update({ estado: "anulada" }).eq("id", id);
    if (sociedadActiva?.id) fcAnular = fcAnular.eq("sociedad_id", sociedadActiva.id);
    const { error } = await fcAnular;
      if (error) throw error;
      await fetchData();
    } catch (err) { console.error("Error anulando FC:", err); alert("Error al anular FC: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handleRecibirFC(id: string) {
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try {
      // FC de compra NO mueve stock — stock solo lo mueven las OC y las ventas
      let fcReceive = (supabase as any).from("facturas_compra").update({ estado: "recibida" }).eq("id", id);
      if (sociedadActiva?.id) fcReceive = fcReceive.eq("sociedad_id", sociedadActiva.id);
      const { error: updErr } = await fcReceive;
      if (updErr) throw updErr;
      alert("FC marcada como recibida");
      await fetchData();
    } catch (err) { console.error("Error marcando FC como recibida:", err); alert("Error al marcar FC como recibida: " + (err as any)?.message); }
  }

  function startEditFC(fc: FacturaCompraRow) {
    if (!["pendiente", "pendiente_aprobacion"].includes(fc.estado)) {
      alert("La factura ya fue recibida, pagada o anulada y no se puede editar desde este formulario.");
      return;
    }
    setEditFCForm({
      numero_factura: fc.numero_factura,
      fecha: fc.fecha,
      fecha_vencimiento: fc.fecha_vencimiento ?? "",
      subtotal: fc.subtotal,
      iva: fc.iva,
      percepciones: fc.percepciones,
      moneda: fc.moneda,
      notas: fc.notas,
      cae: fc.cae ?? "",
    });
    setEditingFC(true);
  }

  async function handleSaveFC() {
    if (!selectedFC) return;
    if (!["pendiente", "pendiente_aprobacion"].includes(selectedFC.estado)) { alert("La factura ya no está habilitada para edición."); return; }
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    setSavingFC(true);
    try {
      const updateData: Record<string, any> = {
        numero_factura: editFCForm.numero_factura.trim(),
        fecha: editFCForm.fecha,
        fecha_vencimiento: editFCForm.fecha_vencimiento || null,
        subtotal: Number(editFCForm.subtotal),
        iva: Number(editFCForm.iva),
        percepciones: Number(editFCForm.percepciones),
        total: Number(editFCForm.subtotal) + Number(editFCForm.iva) + Number(editFCForm.percepciones),
        moneda: editFCForm.moneda,
        notas: editFCForm.notas,
        cae: editFCForm.cae.trim() || null,
      };
      let fcUpdate = (supabase as any).from("facturas_compra").update(updateData).eq("id", selectedFC.id);
      if (sociedadActiva?.id) fcUpdate = fcUpdate.eq("sociedad_id", sociedadActiva.id);
      fcUpdate = fcUpdate.eq("estado", selectedFC.estado);
      const { data: savedFC, error } = await fcUpdate.select("id").maybeSingle();
      if (error) throw error;
      if (!savedFC) throw new Error("La factura cambió de estado o no tenés permiso para editarla. No se guardaron cambios; actualizá la pantalla.");
      setEditingFC(false);
      setSelectedFC(null);
      await fetchData();
    } catch (err) {
      console.error("Error guardando FC:", err);
      alert("Error al guardar FC: " + (err as any)?.message);
    } finally {
      setSavingFC(false);
    }
  }

  function startEditOP(op: OrdenPagoRow) {
    setEditOPForm({
      fecha: op.fecha,
      moneda: op.moneda,
      notas: op.notas,
    });
    setEditingOP(true);
  }

  async function handleSaveOP() {
    if (!selectedOP) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    setSavingOP(true);
    try {
      const updateData: Record<string, any> = {
        fecha: editOPForm.fecha,
        moneda: editOPForm.moneda,
        notas: editOPForm.notas,
      };
      let opUpdate = (supabase as any).from("ordenes_pago").update(updateData).eq("id", selectedOP.id);
      if (sociedadActiva?.id) opUpdate = opUpdate.eq("sociedad_id", sociedadActiva.id);
      const { error } = await opUpdate;
      if (error) throw error;
      setEditingOP(false);
      setSelectedOP(null);
      await fetchData();
    } catch (err) {
      console.error("Error guardando OP:", err);
      alert("Error al guardar OP: " + (err as any)?.message);
    } finally {
      setSavingOP(false);
    }
  }

  async function handleCreateArticle() {
    if (!newArticle.codigo.trim() || !newArticle.descripcion.trim()) return;
    if (!fcForm.proveedor_id) return;
    setNewArticleSaving(true);
    try {
      // Find or create a lista_precios for this proveedor
      let listaId: string | null = null;
      const { data: existingListas } = await (supabase as any)
        .from("listas_precios")
        .select("id")
        .eq("proveedor_id", fcForm.proveedor_id)
        .eq("estado", "vigente")
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingListas && existingListas.length > 0) {
        listaId = existingListas[0].id;
      } else {
        // Create a new lista
        const provNombre = proveedoresOptions.find(p => p.id === fcForm.proveedor_id)?.razon_social || "Proveedor";
        const { data: newLista, error: listaErr } = await (supabase as any)
          .from("listas_precios")
          .insert({
            nombre: `Lista ${provNombre}`,
            proveedor_id: fcForm.proveedor_id,
            moneda: fcForm.moneda,
            estado: "vigente",
            sociedad_id: sociedadActiva?.id || null,
          })
          .select("id")
          .single();
        if (listaErr) throw listaErr;
        listaId = newLista.id;
      }

      const { error: itemErr } = await supabase.from("lista_precios_items").insert({
        lista_id: listaId,
        codigo: newArticle.codigo.trim(),
        descripcion: newArticle.descripcion.trim(),
        categoria: newArticle.categoria.trim() || "General",
        unidad: newArticle.unidad || "UN",
        precio: newArticle.precio,
        descuento: 0,
        precio_neto: newArticle.precio,
      } as any);
      if (itemErr) throw itemErr;

      setNewArticle({ codigo: "", descripcion: "", categoria: "", unidad: "UN", precio: 0 });
      setNewArticleOpen(false);
      alert("Artículo creado en la lista de precios del proveedor");
    } catch (err) {
      alert("Error al crear artículo: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setNewArticleSaving(false);
    }
  }

  const filteredProveedoresFC = fcProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(fcProvSearch.toLowerCase()))
    : proveedoresOptions.slice(0, 20);

  // OCs filtered by selected proveedor (for optional linking). Sin proveedor → show all
  const filteredOCsForFC = fcForm.proveedor_id && fcForm.proveedor_id !== "sin_proveedor"
    ? ocOptions.filter(oc => oc.proveedor_id === fcForm.proveedor_id)
    : ocOptions;
  const selectedFCOrder = ocOptions.find((oc) => oc.id === fcForm.orden_compra_id);
  const fcOCRemaining = selectedFCOrder
    ? Math.round((Number(selectedFCOrder.total || 0) - fcOCPreviouslyInvoiced.total) * 100) / 100
    : 0;
  const fcTotalSinPercepciones = fcForm.subtotal + fcIva;
  const fcOCDifference = Math.round((fcOCRemaining - fcTotalSinPercepciones) * 100) / 100;
  const fcOCBlocked = Boolean(selectedFCOrder) && (
    !Number.isFinite(fcOCPreviouslyInvoiced.total)
    || selectedFCOrder?.moneda !== fcForm.moneda
    || fcOCPreviouslyInvoiced.monedas.some((currency) => currency !== fcForm.moneda)
    || fcOCDifference < -0.01
  );

  // Filtered proveedores for search (by razon_social, nombre, or CUIT)
  const filteredProveedoresOP = proveedorSearch.trim()
    ? proveedoresOptions.filter(p => {
        const q = proveedorSearch.toLowerCase().replace(/[-\s]/g, "");
        return (
          p.razon_social.toLowerCase().includes(q) ||
          (p.cuit || "").replace(/[-\s]/g, "").includes(q)
        );
      })
    : proveedoresOptions;

  const filteredProveedoresGM = gmProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(gmProvSearch.toLowerCase()))
    : proveedoresOptions;

  // ── CC filters ──
  const filteredCcClientes = ccClienteSearch.trim()
    ? ccClientes.filter(c => c.razon_social.toLowerCase().includes(ccClienteSearch.toLowerCase()) || (c.cuit ?? "").includes(ccClienteSearch))
    : ccClientes;
  const filteredCcProveedores = ccProveedorSearch.trim()
    ? ccProveedores.filter(p => p.razon_social.toLowerCase().includes(ccProveedorSearch.toLowerCase()) || (p.cuit ?? "").includes(ccProveedorSearch))
    : ccProveedores;

  // Mapas CUIT → saldo cruzado para conciliación proveedor/cliente
  const cuitToSaldoCliente = useMemo(() => {
    const map: Record<string, number> = {};
    ccClientes.forEach(c => { if (c.cuit) map[c.cuit] = c.saldo_cuenta_corriente; });
    return map;
  }, [ccClientes]);
  const cuitToSaldoProveedor = useMemo(() => {
    const map: Record<string, number> = {};
    ccProveedores.forEach(p => { if (p.cuit) map[p.cuit] = p.saldo_cuenta_corriente; });
    return map;
  }, [ccProveedores]);

  // ── CC Detail fetch ──
  async function fetchCCDetailCliente(cliente: CCRow) {
    setCcDetailCliente(cliente); setCcDetailLoading(true); setCcDetailFacturas([]); setCcDetailMovimientos([]);
    try {
      // Refresh saldo from view
      const { data: freshSaldo } = await (supabase as any).from("v_cuenta_corriente_clientes").select("saldo").eq("id", cliente.id).maybeSingle();
      if (freshSaldo) setCcDetailCliente(prev => prev ? { ...prev, saldo_cuenta_corriente: freshSaldo.saldo ?? prev.saldo_cuenta_corriente } : prev);
      let qF = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, fecha_vencimiento, total, total_acreditado, moneda, estado").eq("cliente_id", cliente.id).in("estado", ["emitida", "pagada", "parcial"]).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qF = qF.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: fData } = await qF;
      // Fetch cobrado per factura from movimientos + cobro_aplicaciones
      let cobradoMap: Record<string, number> = {};
      if (fData && fData.length > 0) {
        const fIds = fData.map((f: any) => f.id);
        let qCobros = (supabase as any).from("movimientos").select("factura_id, monto, anulado").in("factura_id", fIds);
        if (sociedadActiva?.id) qCobros = qCobros.eq("sociedad_id", sociedadActiva.id);
        const { data: cobros } = await qCobros;
        if (cobros) (cobros as any[]).filter((m: any) => !m.anulado).forEach((m: any) => { cobradoMap[m.factura_id] = (cobradoMap[m.factura_id] || 0) + Number(m.monto); });
        // Also count consolidated cobros via cobro_aplicaciones
        let qAplic = (supabase as any).from("cobro_aplicaciones").select("factura_id, monto, movimientos!inner(anulado)").in("factura_id", fIds);
        if (sociedadActiva?.id) qAplic = qAplic.eq("sociedad_id", sociedadActiva.id);
        const { data: aplicaciones } = await qAplic;
        if (aplicaciones) (aplicaciones as any[]).filter((a: any) => { const mov = Array.isArray(a.movimientos) ? a.movimientos[0] : a.movimientos; return mov && !mov.anulado; }).forEach((a: any) => { cobradoMap[a.factura_id] = (cobradoMap[a.factura_id] || 0) + Number(a.monto); });
      }
      if (fData) setCcDetailFacturas(fData.map((f: any) => ({ id: f.id, numero: f.numero ?? "", tipo: f.tipo ?? "", punto_venta: f.punto_venta ?? 0, fecha: f.fecha, vencimiento: f.fecha_vencimiento ?? null, total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), cobrado: cobradoMap[f.id] || 0, moneda: f.moneda ?? "ARS", estado: f.estado })));
      let qM = supabase.from("movimientos").select("id, tipo, monto, moneda, descripcion, fecha, factura_id, conciliado, cliente_id, proveedor_id, clientes(razon_social), proveedores(razon_social)").eq("cliente_id" as any, cliente.id).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qM = qM.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: mData } = await qM;
      if (mData) setCcDetailMovimientos(mData.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: Number(m.monto), moneda: m.moneda ?? "ARS", descripcion: m.descripcion ?? "", fecha: m.fecha, factura_id: m.factura_id ?? null, conciliado: !!m.conciliado, cliente_id: m.cliente_id, proveedor_id: m.proveedor_id, clientes: m.clientes, proveedores: m.proveedores })));
    } catch (err) { console.error("CC detail err:", err); } finally { setCcDetailLoading(false); }
  }
  async function fetchCCDetailProveedor(prov: CCRow) {
    setCcDetailProveedor(prov); setCcDetailProvLoading(true); setCcDetailFCProv([]); setCcDetailMovProv([]);
    try {
      // Refresh saldo from view
      const { data: freshSaldo } = await (supabase as any).from("v_cuenta_corriente_proveedores").select("saldo").eq("id", prov.id).maybeSingle();
      if (freshSaldo) setCcDetailProveedor(prev => prev ? { ...prev, saldo_cuenta_corriente: freshSaldo.saldo ?? prev.saldo_cuenta_corriente } : prev);
      let qFC = (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, fecha_vencimiento, total, estado, moneda").eq("proveedor_id", prov.id).in("estado", ["pendiente", "pagada", "recibida"]).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qFC = qFC.eq("sociedad_id", sociedadActiva.id);
      const { data: fcData } = await qFC;
      // Calculate paid per FC from op_facturas_compra (only non-anulada OPs)
      let pagadoMap: Record<string, number> = {};
      if (fcData && fcData.length > 0) {
        const fcIds = fcData.map((f: any) => f.id);
        const { data: opLinks } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto, orden_pago_id").in("factura_compra_id", fcIds);
        if (opLinks && opLinks.length > 0) {
          const opIds = [...new Set((opLinks as any[]).map((l: any) => l.orden_pago_id))];
          const { data: opsActivas } = await (supabase as any).from("ordenes_pago").select("id").in("id", opIds).neq("estado", "anulada");
          const activasSet = new Set((opsActivas || []).map((o: any) => o.id));
          (opLinks as any[]).forEach((l: any) => { if (activasSet.has(l.orden_pago_id)) pagadoMap[l.factura_compra_id] = (pagadoMap[l.factura_compra_id] || 0) + Number(l.monto); });
        }
        // Also include direct payments (pagos parciales) from movimientos
        let qDirectPay = (supabase as any).from("movimientos").select("factura_compra_id, monto, retencion_ganancias_monto, anulado").in("factura_compra_id", fcIds).eq("tipo", "pago");
        if (sociedadActiva?.id) qDirectPay = qDirectPay.eq("sociedad_id", sociedadActiva.id);
        const { data: directPayments } = await qDirectPay;
        if (directPayments) (directPayments as any[]).filter((p: any) => !p.anulado).forEach((p: any) => { pagadoMap[p.factura_compra_id] = (pagadoMap[p.factura_compra_id] || 0) + Number(p.monto || 0) + Number(p.retencion_ganancias_monto || 0); });
      }
      if (fcData) setCcDetailFCProv(fcData.map((f: any) => ({ id: f.id, numero_factura: f.numero_factura ?? "", fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento, total: Number(f.total), pagado: pagadoMap[f.id] || 0, estado: f.estado, moneda: f.moneda ?? "ARS" })));
      let qM = supabase.from("movimientos").select("id, tipo, monto, moneda, descripcion, fecha, factura_id, conciliado, cliente_id, proveedor_id, clientes(razon_social), proveedores(razon_social)").eq("proveedor_id" as any, prov.id).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qM = qM.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: mData } = await qM;
      if (mData) setCcDetailMovProv(mData.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: Number(m.monto), moneda: m.moneda ?? "ARS", descripcion: m.descripcion ?? "", fecha: m.fecha, factura_id: m.factura_id ?? null, conciliado: !!m.conciliado, cliente_id: m.cliente_id, proveedor_id: m.proveedor_id, clientes: m.clientes, proveedores: m.proveedores })));
    } catch (err) { console.error("CC prov detail err:", err); } finally { setCcDetailProvLoading(false); }
  }
  async function openCobroMultiple() {
    if (!ccDetailCliente) return;
    setCobroMultiOpen(true); setCobroMultiLiqOpen(false);
    try {
      let q = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, tipo_cambio, estado").eq("cliente_id", ccDetailCliente.id).in("estado", ["emitida", "parcial", "vencida"]).order("fecha", { ascending: true });
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data, error } = await q;
      if (error) throw error;
      if (data && data.length > 0) {
        const ids = data.map((f: any) => f.id);
        let qCobMovs = (supabase as any).from("movimientos").select("factura_id, monto, anulado").in("factura_id", ids);
        if (sociedadActiva?.id) qCobMovs = qCobMovs.eq("sociedad_id", sociedadActiva.id);
        const { data: movs } = await qCobMovs;
        const cobradoMap: Record<string, number> = {};
        (movs || []).filter((m: any) => !m.anulado).forEach((m: any) => { cobradoMap[m.factura_id] = (cobradoMap[m.factura_id] || 0) + Number(m.monto); });
        let qCobAplic = (supabase as any).from("cobro_aplicaciones").select("factura_id, monto, movimientos!inner(anulado)").in("factura_id", ids);
        if (sociedadActiva?.id) qCobAplic = qCobAplic.eq("sociedad_id", sociedadActiva.id);
        const { data: aplicaciones } = await qCobAplic;
        if (aplicaciones) (aplicaciones as any[]).filter((a: any) => { const mov = Array.isArray(a.movimientos) ? a.movimientos[0] : a.movimientos; return mov && !mov.anulado; }).forEach((a: any) => { cobradoMap[a.factura_id] = (cobradoMap[a.factura_id] || 0) + Number(a.monto); });
        setCobroMultiFCs(data.map((f: any) => { const cobrado = cobradoMap[f.id] || 0; const saldo = Math.max(0, Number(f.total) - Number(f.total_acreditado || 0) - cobrado); return { id: f.id, numero: f.numero ?? "", tipo: f.tipo ?? "", punto_venta: f.punto_venta ?? 0, fecha: f.fecha, subtotal: Number(f.subtotal || 0), iva: Number(f.iva || 0), total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), moneda: f.moneda ?? "ARS", tipo_cambio: Number(f.tipo_cambio) || undefined, saldo, selected: false }; }).filter((f: CobroMultiFC) => f.saldo > 0.01));
      }
    } catch (err) { setCobroMultiFCs([]); alert(err instanceof Error ? err.message : "No se pudieron verificar los saldos."); }
  }
  function cobroMultiOpenLiquidacion() {
    const selected = cobroMultiFCs.filter(f => f.selected);
    if (selected.length === 0) { alert("Seleccioná al menos una factura"); return; }
    if (new Set(selected.map(f => f.moneda)).size !== 1) { alert("Seleccioná facturas de una sola moneda por liquidación; no se pueden sumar pesos y dólares."); return; }
    if (selected[0].moneda === "USD" && ccDetailCliente) {
      setFxCobroMulti({clienteId: ccDetailCliente.id, documents: selected.map(f => ({id:f.id,numero:`${f.tipo} ${String(f.punto_venta).padStart(4,"0")}-${String(f.numero).padStart(8,"0")}`,saldo:f.saldo,total:f.total,subtotal:f.subtotal,cotizacion:f.tipo_cambio}))});
      return;
    }
    setCobroMultiLiqOpen(true);
  }
  function cobroMultiGetLiqFacturas(): LiquidacionFactura[] {
    return cobroMultiFCs.filter(f => f.selected).map(f => ({
      id: f.id,
      numero: `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`,
      fecha: f.fecha, subtotal: f.subtotal, iva: f.iva, total: f.total,
      total_acreditado: f.total_acreditado, saldo: f.saldo, moneda: f.moneda,
    }));
  }
  async function handleManualMov() {
    if (!manualMovTargetId || manualMovForm.monto <= 0 || !manualMovForm.descripcion.trim()) { setManualMovError("Completar monto, descripcion y seleccionar entidad"); return; }
    if (!sociedadActiva?.id) { setManualMovError("No se pudo determinar la sociedad activa"); return; }
    setManualMovSaving(true); setManualMovError("");
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const movData: Record<string, unknown> = { tipo: manualMovForm.tipo_mov === "credito" ? "cobro" : "pago", descripcion: `[Ajuste manual] ${manualMovForm.descripcion}`, monto: manualMovForm.monto, moneda: manualMovForm.moneda, fecha: manualMovForm.fecha, conciliado: false };
      if (manualMovTarget === "cliente") (movData as any).cliente_id = manualMovTargetId; else (movData as any).proveedor_id = manualMovTargetId;
      (movData as any).sociedad_id = sociedadActiva.id;
      if (userId) (movData as any).created_by = userId;
      const { error } = await supabase.from("movimientos").insert(movData as any);
      if (error) throw error;
      setManualMovOpen(false); await fetchData();
      if (manualMovTarget === "cliente" && ccDetailCliente) await fetchCCDetailCliente(ccDetailCliente);
      if (manualMovTarget === "proveedor" && ccDetailProveedor) await fetchCCDetailProveedor(ccDetailProveedor);
    } catch (err: any) { setManualMovError(err.message || "Error al crear movimiento"); } finally { setManualMovSaving(false); }
  }
  function openManualMovForCliente(cli: CCRow) {
    setManualMovTarget("cliente"); setManualMovTargetId(cli.id); setManualMovTargetName(cli.razon_social);
    setManualMovForm({ monto: 0, descripcion: "", fecha: todayAR(), tipo_mov: "credito", moneda: "ARS" }); setManualMovError(""); setManualMovOpen(true);
  }
  function openManualMovForProveedor(prov: CCRow) {
    setManualMovTarget("proveedor"); setManualMovTargetId(prov.id); setManualMovTargetName(prov.razon_social);
    setManualMovForm({ monto: 0, descripcion: "", fecha: todayAR(), tipo_mov: "credito", moneda: "ARS" }); setManualMovError(""); setManualMovOpen(true);
  }

  function exportCCCliente() {
    if (!ccDetailCliente) return;
    // Build combined entries sorted by date: facturas (DEBE) + movimientos (HABER)
    const entries: { fecha: string; documento: string; moneda: string; debe: number; haber: number }[] = [];
    ccDetailFacturas.forEach(f => {
      const doc = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
      entries.push({ fecha: f.fecha, documento: doc, moneda: f.moneda, debe: f.total, haber: 0 });
    });
    ccDetailMovimientos.forEach(m => {
      entries.push({ fecha: m.fecha, documento: m.descripcion, moneda: m.moneda, debe: 0, haber: m.monto });
    });
    entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
    let saldoAcum = 0;
    const lines: string[] = ["Fecha,Cliente,Documento,Moneda,Debe,Haber,Saldo"];
    entries.forEach(e => { saldoAcum += e.debe - e.haber; lines.push(`${e.fecha},"${ccDetailCliente!.razon_social}","${e.documento}",${e.moneda},${e.debe || ""},${e.haber || ""},${saldoAcum.toFixed(2)}`); });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `CC_${ccDetailCliente.razon_social.replace(/[^a-zA-Z0-9]/g, "_")}_${todayAR()}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function fcToggleSelect(id: string) {
    setFcSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function handleBulkEstadoFC(nuevoEstado: string) {
    if (fcSelectedIds.size === 0) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    const label = nuevoEstado === "pendiente" ? "Pendiente" : nuevoEstado === "pagada" ? "Pagada" : nuevoEstado === "anulada" ? "Anulada" : nuevoEstado === "recibida" ? "Recibida" : nuevoEstado;
    if (!confirm(`¿Cambiar ${fcSelectedIds.size} factura${fcSelectedIds.size > 1 ? "s" : ""} de compra a "${label}"?`)) return;
    try {
      let bulkFC = (supabase as any).from("facturas_compra").update({ estado: nuevoEstado }).in("id", Array.from(fcSelectedIds));
      if (sociedadActiva?.id) bulkFC = bulkFC.eq("sociedad_id", sociedadActiva.id);
      const { error } = await bulkFC;
      if (error) { alert(error.message); return; }
      setFcSelectedIds(new Set());
      await fetchData();
    } catch (err) { alert("Error: " + (err as Error).message); }
  }

  function exportFCCompraCSV(data: FacturaCompraRow[]) {
    const lines: string[] = ["Fecha;Vencimiento;Proveedor;Documento;Moneda;Importe;Pagado;Deuda"];
    data.forEach(f => {
      const pagadoOP = f.op_vinculada && f.op_vinculada.estado !== "anulada" ? Number(f.op_vinculada.numero ? f.total : 0) : 0;
      const pagado = (f.pago_directo || 0) + pagadoOP;
      const saldo = (f.estado === "pagada" || f.estado === "anulada") ? 0 : Math.max(0, f.total - pagado);
      lines.push(`${f.fecha};${f.fecha_vencimiento || ""};"${f.proveedor_nombre}";"${f.numero_factura}";${f.moneda};"${formatCurrency(f.total, f.moneda)}";"${formatCurrency(pagado, f.moneda)}";"${formatCurrency(saldo, f.moneda)}"`);
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `Facturas_Compra_${todayAR()}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function exportCCProveedor() {
    if (!ccDetailProveedor) return;
    const entries: { fecha: string; documento: string; moneda: string; debe: number; haber: number }[] = [];
    ccDetailFCProv.forEach(f => {
      entries.push({ fecha: f.fecha, documento: f.numero_factura, moneda: f.moneda, debe: f.total, haber: 0 });
    });
    ccDetailMovProv.forEach(m => {
      entries.push({ fecha: m.fecha, documento: m.descripcion, moneda: m.moneda, debe: 0, haber: m.monto });
    });
    entries.sort((a, b) => a.fecha.localeCompare(b.fecha));
    let saldoAcum = 0;
    const lines: string[] = ["Fecha,Proveedor,Documento,Moneda,Debe,Haber,Saldo"];
    entries.forEach(e => { saldoAcum += e.debe - e.haber; lines.push(`${e.fecha},"${ccDetailProveedor!.razon_social}","${e.documento}",${e.moneda},${e.debe || ""},${e.haber || ""},${saldoAcum.toFixed(2)}`); });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `CC_${ccDetailProveedor.razon_social.replace(/[^a-zA-Z0-9]/g, "_")}_${todayAR()}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  // ── Mov modal filtered lists ──
  const filteredMovClientes = movClienteSearch.trim()
    ? clientesOptions.filter((c: ClienteOption) => c.razon_social.toLowerCase().includes(movClienteSearch.toLowerCase()))
    : clientesOptions;
  const filteredMovProvs = movProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(movProvSearch.toLowerCase()))
    : proveedoresOptions;

  // ── Echeq handlers ──
  const filteredEcheqs = echeqs.filter(e => (!echeqFilterEstado || e.estado === echeqFilterEstado) && (!echeqFilterDireccion || e.direccion === echeqFilterDireccion));
  const echeqsRecibidos = echeqs.filter(e => e.direccion === "recibido" || !e.direccion);
  const echeqsEmitidos = echeqs.filter(e => e.direccion === "emitido");
  const echeqsEnCartera = echeqsRecibidos.filter(e => e.estado === "en_cartera");
  const echeqsMontoCarteraARS = echeqsEnCartera.filter(e => e.moneda !== "USD").reduce((s, e) => s + e.monto, 0);
  const echeqsMontoCarteraUSD = echeqsEnCartera.filter(e => e.moneda === "USD").reduce((s, e) => s + e.monto, 0);
  const echeqsEmitidosPendientes = echeqsEmitidos.filter(e => e.estado === "pendiente");
  const echeqsMontoEmitidosPendARS = echeqsEmitidosPendientes.filter(e => e.moneda !== "USD").reduce((s, e) => s + e.monto, 0);
  const echeqsMontoEmitidosPendUSD = echeqsEmitidosPendientes.filter(e => e.moneda === "USD").reduce((s, e) => s + e.monto, 0);
  const today = new Date().toISOString().slice(0, 10);
  const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const echeqsPorVencer = echeqsEnCartera.filter(e => e.fecha_pago >= today && e.fecha_pago <= sevenDays).length;

  const filteredClientesEcheq = echeqClienteSearch.trim()
    ? clientesOptions.filter((c: ClienteOption) => c.razon_social.toLowerCase().includes(echeqClienteSearch.toLowerCase()))
    : clientesOptions;

  async function handleCreateEcheq() {
    if (!echeqForm.numero.trim()) { setEcheqError("El numero es obligatorio"); return; }
    if (echeqForm.monto <= 0) { setEcheqError("El monto debe ser mayor a 0"); return; }
    if (!sociedadActiva?.id) { setEcheqError("No se pudo determinar la sociedad activa"); return; }
    setEcheqSaving(true); setEcheqError("");
    try {
      const isEmitido = echeqForm.direccion === "emitido";
      const row: Record<string, unknown> = {
        direccion: echeqForm.direccion,
        tipo_cheque: echeqForm.tipo_cheque, numero: echeqForm.numero.trim(),
        banco_emisor: echeqForm.banco_emisor || null,
        cuit_emisor: isEmitido ? null : (echeqForm.cuit_emisor || null),
        chequera: isEmitido ? (echeqForm.chequera || null) : null,
        monto: echeqForm.monto,
        moneda: echeqForm.moneda, fecha_emision: echeqForm.fecha_emision || null,
        fecha_pago: echeqForm.fecha_pago,
        estado: isEmitido ? "pendiente" : "en_cartera",
        observaciones: echeqForm.observaciones || null,
      };
      if (!isEmitido && echeqForm.origen_tipo === "cliente" && echeqForm.origen_id) {
        row.origen_tipo = "cliente"; row.origen_id = echeqForm.origen_id;
        row.origen_nombre = clientesOptions.find((c: ClienteOption) => c.id === echeqForm.origen_id)?.razon_social || "";
      } else if (!isEmitido && echeqForm.origen_nombre) {
        row.origen_tipo = "otro"; row.origen_nombre = echeqForm.origen_nombre;
      }
      row.sociedad_id = sociedadActiva.id;
      if (profile?.id) row.user_id = profile.id;
      const { error } = await (supabase as any).from("echeqs").insert(row);
      if (error) throw error;
      setEcheqModalOpen(false); setEcheqForm(emptyEcheqForm); setEcheqClienteSearch("");
      await fetchData();
    } catch (err) { setEcheqError("Error al crear cheque"); console.error(err); }
    finally { setEcheqSaving(false); }
  }

  async function handleEcheqAction(action: "endosar" | "depositar" | "cobrar" | "rechazar", echeqOverride?: typeof selectedEcheq) {
    const echeq = echeqOverride || selectedEcheq;
    if (!echeq) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    setEcheqActionSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      if (action === "endosar") {
        updates.estado = "endosado"; updates.fecha_endoso = new Date().toISOString().slice(0, 10);
        updates.destino_tipo = echeqDestinoTipo;
        updates.destino_nombre = echeqDestinoTipo === "proveedor"
          ? proveedoresOptions.find(p => p.id === echeqDestinoId)?.razon_social || echeqDestinoNombre
          : echeqDestinoNombre;
        if (echeqDestinoTipo === "proveedor" && echeqDestinoId) updates.destino_id = echeqDestinoId;
      } else if (action === "depositar") {
        updates.estado = "depositado"; updates.fecha_deposito = new Date().toISOString().slice(0, 10);
        if (echeqDestinoNombre) updates.destino_nombre = echeqDestinoNombre;
        updates.destino_tipo = "banco";
      } else if (action === "cobrar") {
        updates.estado = "cobrado";
      } else if (action === "rechazar") {
        updates.estado = "rechazado";
      }
      let echeqUpdate = (supabase as any).from("echeqs").update(updates).eq("id", echeq.id);
      if (sociedadActiva?.id) echeqUpdate = echeqUpdate.eq("sociedad_id", sociedadActiva.id);
      const { error } = await echeqUpdate;
      if (error) throw error;
      setSelectedEcheq(null); setEcheqActionModal(null); setEcheqDestinoId(""); setEcheqDestinoNombre(""); setEcheqProvSearch("");
      await fetchData();
    } catch (err) { alert("Error: " + (err instanceof Error ? err.message : String(err))); }
    finally { setEcheqActionSaving(false); }
  }

  async function handleDeleteEcheq(id: string) {
    if (!confirm("¿Seguro que querés eliminar este cheque?")) return;
    if (!sociedadActiva?.id) { alert("No se pudo determinar la sociedad activa"); return; }
    try { let echeqDelete = (supabase as any).from("echeqs").delete().eq("id", id); if (sociedadActiva?.id) echeqDelete = echeqDelete.eq("sociedad_id", sociedadActiva.id); const { error } = await echeqDelete; if (error) throw error; await fetchData(); }
    catch (err) { console.error(err); alert("Error al eliminar cheque: " + (err as any)?.message); }
  }

  // ── Derived calculations ──
  const currentMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit" }).slice(0, 7);
  const movimientosMes = movimientos.filter((m) => m.fecha?.startsWith(currentMonth) && !m.anulado);
  const movimientosMesARS = movimientosMes.filter((m) => !m.moneda || m.moneda === "ARS");
  const movimientosMesUSD = movimientosMes.filter((m) => m.moneda === "USD");
  const tiposIngreso = ["cobro", "cheque_recibido", "deposito"];
  const tiposEgreso = ["pago", "cheque_emitido", "retencion_ganancias", "retencion_iva", "retencion_iibb", "retencion_suss"];
  const totalCobrosARS = movimientosMesARS.filter((m) => tiposIngreso.includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagosARS = movimientosMesARS.filter((m) => tiposEgreso.includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalCobrosUSD = movimientosMesUSD.filter((m) => tiposIngreso.includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagosUSD = movimientosMesUSD.filter((m) => tiposEgreso.includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const sinConciliar = movimientos.filter((m) => !m.conciliado && !m.anulado).length;

  // Caja: saldo inicial + ingresos - egresos = saldo final
  const saldoInicialARS = saldosCaja.find(s => s.moneda === "ARS")?.monto ?? 0;
  const saldoInicialUSD = saldosCaja.find(s => s.moneda === "USD")?.monto ?? 0;
  const saldoFinalARS = saldoInicialARS + totalCobrosARS - totalPagosARS;
  const saldoFinalUSD = saldoInicialUSD + totalCobrosUSD - totalPagosUSD;
  const hasUSD = totalCobrosUSD > 0 || totalPagosUSD > 0 || saldoInicialUSD !== 0;

  // ── Apply SmartFilters to movimientos ──
  const filteredMovimientos = movimientos.filter((m) => {
    // Date range filter
    const fechaFilter = movFilterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && m.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && m.fecha > fechaFilter.to) return false;

    // Tipo filter
    const tipoFilter = movFilterValues.tipo as string;
    if (tipoFilter && m.tipo !== tipoFilter) return false;

    // Conciliado filter
    const conciliadoFilter = movFilterValues.conciliado as string;
    if (conciliadoFilter === "si" && !m.conciliado) return false;
    if (conciliadoFilter === "no" && m.conciliado) return false;

    // Monto range filter
    const montoFilter = movFilterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && m.monto < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && m.monto > montoFilter.max) return false;

    return true;
  });

  const extracto = extractos[0] ?? null;
  const movsFiltrados = extracto ? extracto.extracto_movimientos.filter((m) => filterExtracto === "todos" || m.estado === filterExtracto) : [];

  const lcARS = lineasCredito.filter(lc => (lc as any).moneda !== "USD");
  const lcUSD = lineasCredito.filter(lc => (lc as any).moneda === "USD");
  const totalDisponibleCreditoARS = lcARS.reduce((a, lc) => a + lc.monto_disponible, 0);
  const totalDisponibleCreditoUSD = lcUSD.reduce((a, lc) => a + lc.monto_disponible, 0);
  const totalUtilizadoCreditoARS = lcARS.reduce((a, lc) => a + lc.monto_utilizado, 0);
  const totalUtilizadoCreditoUSD = lcUSD.reduce((a, lc) => a + lc.monto_utilizado, 0);
  const totalLineasARS = lcARS.reduce((a, lc) => a + lc.monto_total, 0);
  const totalLineasUSD = lcUSD.reduce((a, lc) => a + lc.monto_total, 0);
  const totalLineas = totalLineasARS + totalLineasUSD;

  // ── Balance projection helpers ──
  function sumBands(items: { banda: string; moneda: string; total: number }[], moneda: string, bandas: string[]): number {
    return items.filter(i => i.moneda === moneda && bandas.includes(i.banda)).reduce((s, i) => s + Number(i.total), 0);
  }
  const balCobrarARS = balanceData ? sumBands(balanceData.cobrar, "ARS", ["vencido", "7dias", "15dias", "mas15"]) : 0;
  const balCobrarUSD = balanceData ? sumBands(balanceData.cobrar, "USD", ["vencido", "7dias", "15dias", "mas15"]) : 0;
  const balPagarARS = balanceData ? sumBands(balanceData.pagar, "ARS", ["vencido", "7dias", "15dias", "mas15"]) : 0;
  const balPagarUSD = balanceData ? sumBands(balanceData.pagar, "USD", ["vencido", "7dias", "15dias", "mas15"]) : 0;
  const balCobrar7ARS = balanceData ? sumBands(balanceData.cobrar, "ARS", ["vencido", "7dias"]) : 0;
  const balCobrar15ARS = balanceData ? sumBands(balanceData.cobrar, "ARS", ["vencido", "7dias", "15dias"]) : 0;
  const balPagar7ARS = balanceData ? sumBands(balanceData.pagar, "ARS", ["vencido", "7dias"]) : 0;
  const balPagar15ARS = balanceData ? sumBands(balanceData.pagar, "ARS", ["vencido", "7dias", "15dias"]) : 0;
  const balVencidoCobrarARS = balanceData ? sumBands(balanceData.cobrar, "ARS", ["vencido"]) : 0;
  const balVencidoPagarARS = balanceData ? sumBands(balanceData.pagar, "ARS", ["vencido"]) : 0;

  const tabs: { id: FinanzasTab; label: string }[] = [
    { id: "movimientos", label: "Movimientos" },
    { id: "facturacion", label: "Fact. Ventas" },
    { id: "facturas_compra", label: "Fact. Compra" },
    { id: "ordenes_pago", label: "Órdenes de pago" },
    { id: "gastos_manuales", label: "Gastos" },
    { id: "echeqs", label: "Cheques" },
    { id: "cc_clientes", label: "CC Clientes" },
    { id: "cc_proveedores", label: "CC Prov." },
    { id: "extractos", label: "Extractos" },
    { id: "lineas_credito", label: "Crédito" },
    // { id: "gastos_fijos", label: "G. Fijos" },  // OCULTO: funcionalidad en revisión
    { id: "objetivos", label: "Objetivos" },
    { id: "retenciones", label: "Retenciones" },
  ];

  // Este hook debe ejecutarse también durante el estado de carga; dejarlo
  // debajo del return condicional rompe el orden de hooks de React.
  const retencionesTabla = useMemo(() => [
    ...ordenesPago
      .filter((op) => op.estado !== "anulada" && op.retencion_ganancias_monto > 0)
      .map((op) => ({
        id: op.id,
        fecha: op.fecha,
        numero: op.numero || "—",
        proveedor_nombre: op.proveedor_nombre,
        base_retencion_ganancias: (op as any).base_retencion_ganancias || 0,
        retencion_ganancias_pct: op.retencion_ganancias_pct,
        retencion_ganancias_monto: op.retencion_ganancias_monto,
        moneda: op.moneda,
        origen: "OP",
      })),
    ...movimientos
      .filter((mov) => mov.tipo === "pago" && !mov.anulado && Number((mov as any).retencion_ganancias_monto || 0) > 0)
      .map((mov) => ({
        id: `mov-${mov.id}`,
        fecha: mov.fecha,
        numero: "Pago directo",
        proveedor_nombre: mov.proveedores?.razon_social || "—",
        base_retencion_ganancias: Number((mov as any).base_retencion_ganancias || 0),
        retencion_ganancias_pct: Number((mov as any).retencion_ganancias_pct || 0),
        retencion_ganancias_monto: Number((mov as any).retencion_ganancias_monto || 0),
        moneda: (mov.moneda || "ARS") as "ARS" | "USD",
        origen: "Pago parcial",
      })),
  ], [ordenesPago, movimientos]);

  if (loading) {
    return (
      <>
        <Header title="Finanzas" subtitle="Cuentas corrientes, cobros, conciliacion y credito" action={{ label: "Nuevo movimiento", onClick: () => {} }} />
        <div className="flex items-center justify-center p-24">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          <span className="ml-3 text-zinc-500">Cargando datos financieros...</span>
        </div>
      </>
    );
  }

  const cargaLentaAviso = loadingTimedOut ? (
    <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <span>La carga está tardando más de lo esperado. Podés reintentar sin perder datos guardados.</span>
      <button type="button" onClick={() => fetchData()} className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40">Reintentar</button>
    </div>
  ) : null;

  return (
    <>
      <Header title="Finanzas" subtitle="Cuentas corrientes, cobros, conciliacion y credito" action={{ label: "Nuevo movimiento", onClick: () => { setEditingMovId(null); setMovForm(emptyMovForm); setMovClienteSearch(""); setMovProvSearch(""); setFormError(""); setModalOpen(true); } }} />
      <div className="p-4 sm:p-8 space-y-6">
        {cargaLentaAviso}
        {/* ── Resumen de Caja ── */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-orange-500" />
              Caja del mes — {new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "America/Buenos_Aires" })}
            </h3>
            <span className="text-xs text-zinc-400">Click en saldo inicial para editar</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Concepto</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">ARS</th>
                  {hasUSD && <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">USD</th>}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400">Saldo inicial</td>
                  <td className="py-2 px-3 text-right">
                    {editingSaldo === "ARS" ? (
                      <input type="number" autoFocus value={editingSaldoVal} onChange={e => setEditingSaldoVal(e.target.value)}
                        onBlur={() => handleSaveSaldoCaja("ARS")} onKeyDown={e => e.key === "Enter" && handleSaveSaldoCaja("ARS")}
                        className="w-32 ml-auto rounded border border-orange-300 bg-orange-50 dark:bg-zinc-800 px-2 py-0.5 text-sm font-mono text-right dark:text-white" />
                    ) : (
                      <button onClick={() => { setEditingSaldo("ARS"); setEditingSaldoVal(String(saldoInicialARS)); }}
                        className="font-mono font-medium text-zinc-700 dark:text-zinc-300 hover:text-orange-600 hover:underline cursor-pointer transition-colors"
                        title="Editar saldo inicial ARS">
                        {formatCurrency(saldoInicialARS)}
                      </button>
                    )}
                  </td>
                  {hasUSD && (
                    <td className="py-2 px-3 text-right">
                      {editingSaldo === "USD" ? (
                        <input type="number" autoFocus value={editingSaldoVal} onChange={e => setEditingSaldoVal(e.target.value)}
                          onBlur={() => handleSaveSaldoCaja("USD")} onKeyDown={e => e.key === "Enter" && handleSaveSaldoCaja("USD")}
                          className="w-32 ml-auto rounded border border-orange-300 bg-orange-50 dark:bg-zinc-800 px-2 py-0.5 text-sm font-mono text-right dark:text-white" />
                      ) : (
                        <button onClick={() => { setEditingSaldo("USD"); setEditingSaldoVal(String(saldoInicialUSD)); }}
                          className="font-mono font-medium text-zinc-700 dark:text-zinc-300 hover:text-orange-600 hover:underline cursor-pointer transition-colors"
                          title="Editar saldo inicial USD">
                          {formatCurrency(saldoInicialUSD, "USD")}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 px-3 text-emerald-600 flex items-center gap-1"><ArrowDownLeft className="h-3.5 w-3.5" /> Ingresos</td>
                  <td className="py-2 px-3 text-right font-mono text-emerald-600">+{formatCurrency(totalCobrosARS)}</td>
                  {hasUSD && <td className="py-2 px-3 text-right font-mono text-emerald-600">+{formatCurrency(totalCobrosUSD, "USD")}</td>}
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 px-3 text-red-600 flex items-center gap-1"><ArrowUpRight className="h-3.5 w-3.5" /> Egresos</td>
                  <td className="py-2 px-3 text-right font-mono text-red-600">-{formatCurrency(totalPagosARS)}</td>
                  {hasUSD && <td className="py-2 px-3 text-right font-mono text-red-600">-{formatCurrency(totalPagosUSD, "USD")}</td>}
                </tr>
                <tr className="border-t-2 border-zinc-300 dark:border-zinc-600">
                  <td className="py-2 px-3 font-semibold text-zinc-800 dark:text-zinc-200">Saldo actual</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold text-base ${saldoFinalARS >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(saldoFinalARS)}</td>
                  {hasUSD && <td className={`py-2 px-3 text-right font-mono font-bold text-base ${saldoFinalUSD >= 0 ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(saldoFinalUSD, "USD")}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard title="Saldo CC clientes" value={formatCurrency(ccClientes.reduce((a, c) => a + c.saldo_cuenta_corriente, 0))} icon={Wallet} iconColor="text-blue-600" />
          <StatCard title="Credito disponible" value={`${formatCurrency(totalDisponibleCreditoARS)}${totalDisponibleCreditoUSD > 0 ? ` + ${formatCurrency(totalDisponibleCreditoUSD, "USD")}` : ""}`} icon={CreditCard} iconColor="text-emerald-600" />
          <StatCard title="Sin conciliar" value={`${sinConciliar} movimientos`} icon={Clock} iconColor="text-amber-500" />
        </div>

        {/* ── Balance Debe / Haber ── */}
        {balanceData && (
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              Balance — Proyección de cobranzas vs pagos
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-700">
                    <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Concepto</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500 text-red-500">Vencido</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">Prox. 7 días</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">Prox. 15 días</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-zinc-500">Total pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 px-3 font-medium text-emerald-700 dark:text-emerald-400">A cobrar (facturas emitidas)</td>
                    <td className="py-2 px-3 text-right font-mono text-red-600">{formatCurrency(balVencidoCobrarARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balCobrar7ARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balCobrar15ARS)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600">{formatCurrency(balCobrarARS)}</td>
                  </tr>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 px-3 font-medium text-red-700 dark:text-red-400">A pagar (FC pendientes)</td>
                    <td className="py-2 px-3 text-right font-mono text-red-600">{formatCurrency(balVencidoPagarARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balPagar7ARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balPagar15ARS)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-red-600">{formatCurrency(balPagarARS)}</td>
                  </tr>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <td className="py-2 px-3">Balance neto ARS</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balVencidoCobrarARS - balVencidoPagarARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balCobrar7ARS - balPagar7ARS)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatCurrency(balCobrar15ARS - balPagar15ARS)}</td>
                    <td className={`py-2 px-3 text-right font-mono text-lg ${(balCobrarARS - balPagarARS) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatCurrency(balCobrarARS - balPagarARS)}
                    </td>
                  </tr>
                  {(balCobrarUSD > 0 || balPagarUSD > 0) && (
                    <tr className="bg-zinc-50 dark:bg-zinc-800/50 font-semibold border-t border-zinc-200 dark:border-zinc-700">
                      <td className="py-2 px-3">Balance neto USD</td>
                      <td className="py-2 px-3 text-right font-mono" colSpan={3}></td>
                      <td className={`py-2 px-3 text-right font-mono ${(balCobrarUSD - balPagarUSD) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {formatCurrency(balCobrarUSD - balPagarUSD, "USD")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Tabs */}
        <div className="w-full overflow-x-auto pb-1">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-max">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => { setTab(t.id); setCcDetailCliente(null); setCcDetailProveedor(null); fetchData(); }}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Movimientos ── */}
        {tab === "movimientos" && (
          <>
          <SmartFilters
            filters={movFilterConfigs}
            values={movFilterValues}
            onChange={setMovFilterValues}
          />
          <Card className="p-0 overflow-hidden">
            <DataTable<MovimientoRow>
              columns={[
                { key: "tipo", label: "Tipo", sortable: true, render: (row) => { const cfg = tipoConfig[row.tipo] || { label: row.tipo, variant: "outline" as const, icon: Wallet }; const Icon = cfg.icon; return (<div className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-400" /><Badge variant={cfg.variant}>{cfg.label}</Badge></div>); }},
                { key: "descripcion", label: "Descripcion", sortable: true, render: (row) => {
                  const parts = (row.descripcion || "").split(" — ");
                  const main = parts[0] || "";
                  const detail = parts.slice(1).join(" — ");
                  return (
                    <div className="max-w-xs">
                      <span className="font-medium text-sm">{main}</span>
                      {detail && <p className="text-xs text-zinc-500 mt-0.5">{detail}</p>}
                      {row.clientes?.razon_social && <p className="text-xs text-zinc-400">{row.clientes.razon_social}</p>}
                      {row.proveedores?.razon_social && <p className="text-xs text-zinc-400">{row.proveedores.razon_social}</p>}
                      {row.factura_id && <p className="text-xs text-blue-500">FC vinculada</p>}
                    </div>
                  );
                }},
                { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => {
                  const isIngreso = ["cobro", "cheque_recibido", "transferencia", "efectivo", "deposito", "retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"].includes(row.tipo) && !!row.cliente_id;
                  const isEgreso = ["pago", "cheque_emitido"].includes(row.tipo) || (!!row.proveedor_id && !row.cliente_id);
                  const visibleAmount = row.anulado ? Number(row.monto_original || 0) : row.monto;
                  return <span className={`font-mono font-semibold block text-right ${row.anulado ? "text-zinc-400 line-through" : isIngreso ? "text-emerald-600" : isEgreso ? "text-red-600" : "text-zinc-700 dark:text-zinc-300"}`}>{isIngreso ? "+" : isEgreso ? "-" : ""}{formatCurrency(visibleAmount, row.moneda as "ARS" | "USD")}</span>;
                }},
                { key: "conciliado", label: "Estado", sortable: true, render: (row) => row.anulado ? <Badge variant="danger">Anulado</Badge> : <Badge variant={row.conciliado ? "success" : "warning"}>{row.conciliado ? "Conciliado" : "Pendiente"}</Badge> },
                { key: "actions", label: "", sortable: false, render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {!row.anulado && !row.conciliado && (
                      <button onClick={() => handleConciliar(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Conciliar">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!row.anulado && (
                      <>
                        <button onClick={() => openEditMov(row)} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleAnularMov(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-amber-100 hover:text-amber-600" title="Anular">
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    <button onClick={() => handleDeleteMov(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Eliminar">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )},
              ]}
              data={filteredMovimientos}
              onRowClick={(row) => openMovDetail(row)}
            />
          </Card>
          </>
        )}

        {/* ── Movimiento Detail Panel ── */}
        {selectedMov && (
          <>
            <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setSelectedMov(null)} />
            <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700">
              <div className="sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-zinc-900 p-6 border-b border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-orange-500" />
                  <h2 className="text-lg font-bold dark:text-white">Detalle movimiento</h2>
                  {(() => { const tc = tipoConfig[selectedMov.tipo] || { label: selectedMov.tipo, variant: "outline" as const }; return <Badge variant={tc.variant}>{tc.label}</Badge>; })()}
                </div>
                <button onClick={() => setSelectedMov(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-6 space-y-5">
                {/* Info principal */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Monto</p>
                    <p className={`font-mono text-lg font-bold ${selectedMov.anulado ? "text-zinc-400 line-through" : ""}`}>{formatCurrency(selectedMov.anulado ? Number(selectedMov.monto_original || 0) : selectedMov.monto, (selectedMov.moneda || "ARS") as "ARS" | "USD")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Fecha</p>
                    <p className="font-medium">{formatDate(selectedMov.fecha)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Estado</p>
                    <Badge variant={selectedMov.anulado ? "danger" : selectedMov.conciliado ? "success" : "warning"}>
                      {selectedMov.anulado ? "Anulado" : selectedMov.conciliado ? "Conciliado" : "Pendiente"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Entidad</p>
                    <p className="font-medium">{selectedMov.clientes?.razon_social || selectedMov.proveedores?.razon_social || "—"}</p>
                  </div>
                </div>

                {/* FX settlement badge */}
                {selectedMov.liquidacion_fx_id && (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 px-3 py-2">
                    <DollarSign className="h-4 w-4 text-blue-500" />
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Liquidación FX — Para corregir o anular, usá el botón Anular de este movimiento.</span>
                  </div>
                )}

                {/* Descripcion completa */}
                <div>
                  <p className="text-xs text-zinc-400 uppercase mb-1">Descripcion</p>
                  <p className="text-sm bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3 whitespace-pre-wrap">{selectedMov.descripcion}</p>
                </div>

                {/* Factura vinculada */}
                {relatedFactura && (
                  <div>
                    <p className="text-xs text-zinc-400 uppercase mb-1">Factura vinculada</p>
                    <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-sm">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span className="font-mono font-medium">
                        {relatedFactura.tipo} {String(relatedFactura.punto_venta).padStart(4, "0")}-{String(relatedFactura.numero).padStart(8, "0")}
                      </span>
                      <span className="font-mono">{formatCurrency(relatedFactura.total, (relatedFactura.moneda || "ARS") as "ARS" | "USD")}</span>
                      <Badge variant={relatedFactura.estado === "pagada" ? "success" : relatedFactura.estado === "parcial" ? "warning" : "info"}>
                        {relatedFactura.estado}
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Movimientos relacionados (cobro masivo) */}
                {relatedMovs.length > 1 && (
                  <div>
                    <p className="text-xs text-zinc-400 uppercase mb-2">
                      Movimientos del cobro ({relatedMovs.length} lineas)
                    </p>
                    <div className="space-y-1">
                      {relatedMovs.map(rm => {
                        const tc = tipoConfig[rm.tipo] || { label: rm.tipo, variant: "outline" as const };
                        const isCurrent = rm.id === selectedMov.id;
                        return (
                          <div key={rm.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isCurrent ? "bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800" : "bg-zinc-50 dark:bg-zinc-800/50"}`}>
                            <Badge variant={tc.variant}>{tc.label}</Badge>
                            <span className="flex-1 text-xs text-zinc-500 truncate">{rm.descripcion?.split(" — ")[1] || ""}</span>
                            <span className="font-mono font-medium">{formatCurrency(rm.monto, (rm.moneda || "ARS") as "ARS" | "USD")}</span>
                          </div>
                        );
                      })}
                      <div className="flex justify-end pt-1 border-t border-zinc-200 dark:border-zinc-700">
                        <span className="text-sm font-bold">Total: <span className="font-mono">{formatCurrency(relatedMovs.reduce((s, m) => s + m.monto, 0), (selectedMov.moneda || "ARS") as "ARS" | "USD")}</span></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                  {!selectedMov.anulado && !selectedMov.conciliado && (
                    <button onClick={async () => { await handleConciliar(selectedMov.id); setSelectedMov({ ...selectedMov, conciliado: true }); }}
                      className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                      <CheckCircle2 className="h-4 w-4" /> Conciliar
                    </button>
                  )}
                  {!selectedMov.anulado && (
                    <>
                      {!selectedMov.liquidacion_fx_id && (
                        <button onClick={() => { const mov = selectedMov; setSelectedMov(null); openEditMov(mov); }}
                          className="flex items-center gap-1.5 rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                          <Pencil className="h-4 w-4" /> Editar
                        </button>
                      )}
                      <button onClick={() => handleAnularMov(selectedMov.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                        <Ban className="h-4 w-4" /> {selectedMov.liquidacion_fx_id ? "Anular liquidación FX" : "Anular"}
                      </button>
                    </>
                  )}
                  {!selectedMov.liquidacion_fx_id && (
                    <button onClick={() => handleDeleteMov(selectedMov.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                      <Trash2 className="h-4 w-4" /> Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Facturas de Compra ── */}
        {tab === "facturas_compra" && (() => {
          const fcsPendientesAprobacion = facturasCompra.filter(f => f.estado === "pendiente_aprobacion");
          const fcEstadoCounts: Record<string, number> = {};
          for (const f of facturasCompra) fcEstadoCounts[f.estado] = (fcEstadoCounts[f.estado] || 0) + 1;
          const filteredFC = facturasCompra.filter(f => {
            if (!fcIsAll && !Array.from(fcSelectedEstados).some(grp => (FC_ESTADO_GROUPS[grp] || [grp]).includes(f.estado))) return false;
            if (fcTipoFilter) {
              const tipoDoc = f.numero_factura.split(" ")[0] || "";
              if (tipoDoc !== fcTipoFilter) return false;
            }
            if (fcSearchQuery.trim()) {
              const q = fcSearchQuery.toLowerCase();
              if (!f.proveedor_nombre.toLowerCase().includes(q) && !f.numero_factura.toLowerCase().includes(q)) return false;
            }
            return true;
          });
          return (
          <>
            {/* Banner aprobacion */}
            {fcsPendientesAprobacion.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Tenes {fcsPendientesAprobacion.length} factura{fcsPendientesAprobacion.length > 1 ? "s" : ""} pendiente{fcsPendientesAprobacion.length > 1 ? "s" : ""} de aprobacion
                  </span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-mono">
                    ({formatCurrency(fcsPendientesAprobacion.reduce((s, f) => s + f.total, 0))})
                  </span>
                </div>
                <button onClick={() => { setFcSelectedEstados(new Set(["pendiente_all"])); }}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline">
                  Ver pendientes
                </button>
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-zinc-500">
                Total pendiente: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                  {formatCurrency(facturasCompra.filter(f => f.estado === "pendiente").reduce((s, f) => s + f.total, 0))}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => exportFCCompraCSV(filteredFC)} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
                  <Download className="h-4 w-4" /> Exportar CSV
                </button>
                <button onClick={() => { setTab("ordenes_pago"); openOPModal(); }} className="flex items-center gap-1.5 rounded-lg border border-orange-500 px-3 py-2 text-sm font-medium text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-colors">
                  <FileText className="h-4 w-4" /> Nueva OP
                </button>
                <button onClick={openFCModal} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                  <Plus className="h-4 w-4" /> Nueva factura de compra
                </button>
                <button onClick={() => setFcMassModalOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-orange-500 px-3 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-colors">
                  <Upload className="h-4 w-4" /> Carga masiva con IA
                </button>
              </div>
            </div>
            {/* Search & filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <input value={fcSearchQuery} onChange={(e) => setFcSearchQuery(e.target.value)}
                  placeholder="Buscar por proveedor o nro. factura..."
                  className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => fcToggleEstado("todos")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${fcIsAll ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}>
                  Todos <span className="ml-1 opacity-70">{facturasCompra.length}</span>
                </button>
                {([["emitida_all", "Emitida"], ["pendiente_all", "Pendiente"], ["pagada_all", "Pagada"], ["anulada", "Anulada"]] as const).map(([key, label]) => {
                  const active = fcSelectedEstados.has(key);
                  const groupEstados = FC_ESTADO_GROUPS[key] || [key];
                  const count = groupEstados.reduce((s, e) => s + (fcEstadoCounts[e] || 0), 0);
                  return (
                    <button key={key} onClick={() => fcToggleEstado(key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}>
                      {label} <span className="ml-1 opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
              <select value={fcTipoFilter} onChange={(e) => setFcTipoFilter(e.target.value)}
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
              {(fcSearchQuery || !fcIsAll || fcTipoFilter) && (
                <span className="text-xs text-zinc-500">{filteredFC.length} de {facturasCompra.length}</span>
              )}
            </div>
            {fcSelectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
                  {fcSelectedIds.size} seleccionada{fcSelectedIds.size > 1 ? "s" : ""}
                </span>
                <span className="text-zinc-300 dark:text-zinc-600">|</span>
                <span className="text-xs text-zinc-500">Cambiar estado a:</span>
                <button onClick={() => handleBulkEstadoFC("pendiente")} className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-amber-950/30 transition-colors">Pendiente</button>
                <button onClick={() => handleBulkEstadoFC("recibida")} className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-blue-950/30 transition-colors">Recibida</button>
                <button onClick={() => handleBulkEstadoFC("pagada")} className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-emerald-950/30 transition-colors">Pagada</button>
                <button onClick={() => setFcSelectedIds(new Set())} className="ml-auto text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Deseleccionar</button>
              </div>
            )}
            <Card className="p-0 overflow-hidden">
              <DataTable<FacturaCompraRow>
                columns={[
                  { key: "select" as any, label: "", sortable: false, render: (row: FacturaCompraRow) => (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={fcSelectedIds.has(row.id)} onChange={() => fcToggleSelect(row.id)}
                        className="h-4 w-4 rounded border-zinc-300 text-orange-500 focus:ring-orange-500 cursor-pointer" />
                    </div>
                  )},
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "fecha_vencimiento", label: "Vencimiento", sortable: true, render: (row) => row.fecha_vencimiento ? <span className="text-zinc-500 text-xs">{formatDate(row.fecha_vencimiento)}</span> : <span className="text-zinc-300">—</span> },
                  { key: "numero_factura", label: "Nro. Factura", sortable: true, render: (row) => <span className="font-mono font-medium">{row.tipo_comprobante && row.tipo_comprobante !== "FC A" ? `${row.tipo_comprobante} ` : ""}{row.numero_factura}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => (
                    <div>
                      <span className="font-medium">{row.proveedor_nombre}</span>
                      {row.oc_numero && <p className="text-xs text-zinc-400">OC: {row.oc_numero}</p>}
                      {row.ocs_vinculadas && row.ocs_vinculadas.length > 0 && !row.oc_numero && (
                        <p className="text-xs text-zinc-400">OC: {row.ocs_vinculadas.map(o => o.numero).join(", ")}</p>
                      )}
                      {row.tipo === "solo_iva" ? <Badge variant="purple">Solo IVA</Badge> : row.tipo === "transporte" ? <Badge variant="success">Transporte</Badge> : <Badge variant="info">Mercadería</Badge>}
                      {row.tipo === "solo_iva" && (row.costo_real ?? 0) > 0 && (
                        <p className="text-xs text-blue-500 mt-0.5">Costo real: {formatCurrency(row.costo_real!, row.moneda)}</p>
                      )}
                    </div>
                  )},
                  { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => (
                    <div className="text-right">
                      <span className="font-mono font-semibold text-red-600">{formatCurrency(row.total, row.moneda)}</span>
                      {(row.pago_directo ?? 0) > 0 && <p className="text-[10px] text-blue-500 mt-0.5">Pago directo: {formatCurrency(row.pago_directo || 0, row.moneda)}</p>}
                      {row.percepciones > 0 && (
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          {row.percepciones_detalle && row.percepciones_detalle.length > 0
                            ? row.percepciones_detalle.map(p => `${p.tipo === "iibb" ? "IIBB" : p.tipo === "ganancias" ? "Gan" : p.tipo === "iva" ? "IVA" : "Mun"} ${formatCurrency(p.monto, row.moneda)}`).join(" · ")
                            : `Perc. ${formatCurrency(row.percepciones, row.moneda)}`}
                        </p>
                      )}
                    </div>
                  )},
                  { key: "estado", label: "Estado", sortable: true, render: (row) => (
                    <Badge variant={row.estado === "pagada" ? "success" : row.estado === "anulada" ? "danger" : row.estado === "recibida" ? "info" : row.estado === "pendiente_aprobacion" ? "orange" : "warning"}>
                      {row.estado === "pagada" ? "Pagada" : row.estado === "anulada" ? "Anulada" : row.estado === "recibida" ? "Recibida" : row.estado === "pendiente_aprobacion" ? "Por aprobar" : "Pendiente"}
                    </Badge>
                  )},
                  { key: "op_vinculada" as any, label: "OP", sortable: true, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {row.op_vinculada ? (
                        <button onClick={() => { const op = ordenesPago.find(o => o.id === row.op_vinculada!.id); if (op) { setSelectedOP(op); } else { alert("No se encontró la OP. Intente recargar la página."); } }}
                          className="flex items-center gap-1 text-xs" title="Ver orden de pago">
                          <Badge variant={row.op_vinculada.estado === "pagada" ? "success" : row.op_vinculada.estado === "anulada" ? "danger" : "warning"}>
                            {row.op_vinculada.numero || "OP"}
                          </Badge>
                        </button>
                      ) : (row.estado === "pendiente" || row.estado === "recibida") ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handlePagarFC(row.id)} className="rounded px-2 py-1 text-xs text-orange-600 border border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 font-medium" title="Crear orden de pago">
                            + OP
                          </button>
                          <button onClick={() => handlePagoParcialDirecto(row.id)} className="rounded px-2 py-1 text-xs text-blue-600 border border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium" title="Registrar pago parcial sin OP">
                            + Parcial
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-300 text-xs">—</span>
                      )}
                    </div>
                  )},
                  { key: "sobre_verde" as any, label: "Sobre", sortable: true, render: (row) => row.op_vinculada ? (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => { const op = ordenesPago.find(o => o.id === row.op_vinculada!.id); if (op) openOrdenPagoEmail(op); }}
                        className="rounded p-1.5 text-zinc-400 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900/20"
                        title="Enviar OP por email">
                        <Send className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => handleToggleSobreVerde(row.op_vinculada!.id, !!row.op_vinculada!.sobre_verde)}
                        className={`rounded p-1.5 ${row.op_vinculada.sobre_verde ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-500"}`}
                        title={row.op_vinculada.sobre_verde ? "Quitar sobre verde" : "Marcar como sobre verde"}>
                        <Mail className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : <span className="text-zinc-300 text-xs">—</span> },
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {row.archivo_url && (
                        <a href={row.archivo_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-orange-500 hover:bg-orange-100" title="Ver PDF adjunto">
                          <Paperclip className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {row.estado === "pendiente" && (
                        <button onClick={() => handleRecibirFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Marcar como recibida">
                          <Package className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(row.estado === "pendiente" || row.estado === "recibida") && (
                        <button onClick={() => handleAnularFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => handleDeleteFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Eliminar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )},
                ]}
                data={filteredFC}
                onRowClick={(row) => setSelectedFC(row)}
                emptyMessage="No hay facturas de compra cargadas"
              />
            </Card>
          </>
          );
        })()}

        {/* ── Ordenes de Pago ── */}
        {tab === "ordenes_pago" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">
                Total pendiente: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                  {formatCurrency(ordenesPago.filter(o => o.estado === "pendiente").reduce((s, o) => s + o.neto, 0))}
                </span>
              </p>
              <button onClick={() => openOPModal()} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                <Plus className="h-4 w-4" /> Nueva OP
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={() => setOpFilterRetencion(!opFilterRetencion)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${opFilterRetencion ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400"}`}
              >
                <ShieldCheck className="inline h-3 w-3 mr-1" />Con retención
              </button>
              <input type="date" value={opFilterDesde} onChange={e => setOpFilterDesde(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Desde" title="Desde" />
              <input type="date" value={opFilterHasta} onChange={e => setOpFilterHasta(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" placeholder="Hasta" title="Hasta" />
              {(opFilterDesde || opFilterHasta || opFilterRetencion) && (
                <button onClick={() => { setOpFilterRetencion(false); setOpFilterDesde(""); setOpFilterHasta(""); }} className="text-xs text-zinc-400 hover:text-zinc-600">Limpiar</button>
              )}
              {opFilterRetencion && (
                <button onClick={exportOPRetencionesCSV} className="ml-auto rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300 flex items-center gap-1">
                  <Download className="h-3 w-3" />Exportar retenciones CSV
                </button>
              )}
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<OrdenPagoRow>
                columns={[
                  { key: "numero", label: "N°", sortable: true, render: (row) => <span className="font-mono text-xs text-zinc-500">{row.numero || "—"}</span> },
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => <span className="font-medium">{row.proveedor_nombre}</span> },
                  { key: "monto_bruto", label: "Monto bruto", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.monto_bruto, row.moneda)}</span> },
                  { key: "monto_retencion", label: "Ret. Gan.", className: "text-right", sortable: true, render: (row) => {
                    return (
                      <div className="text-right">
                        {row.retencion_ganancias_monto > 0 ? (
                          <>
                            <span className="font-mono text-violet-600">{formatCurrency(row.retencion_ganancias_monto, row.moneda)}</span>
                            <div className="flex items-center justify-end gap-1 mt-0.5">
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-500 font-medium">
                                <ShieldCheck className="h-2.5 w-2.5" />Gan {row.retencion_ganancias_pct}%
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </div>
                    );
                  }},
                  { key: "neto", label: "Neto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.neto, row.moneda)}</span> },
                  { key: "medio_pago", label: "Medio", render: (row) => {
                    const medioLabel = (t: string) => t === "transferencia" ? "Transf." : t === "cheque" ? "Cheque" : t === "cheque_propio" ? "Ch. propio" : t === "echeq" ? "E-Cheq" : t === "deposito" ? "Depósito" : t === "tarjeta" ? "Tarjeta" : t === "efectivo" ? "Efectivo" : t;
                    if (row.medios_pago && row.medios_pago.length > 1) {
                      return <div className="flex flex-wrap gap-1">{row.medios_pago.map((m, i) => <Badge key={i} variant="outline">{medioLabel(m.tipo)}</Badge>)}</div>;
                    }
                    return <Badge variant="outline">{medioLabel(row.medio_pago)}</Badge>;
                  }},
                  { key: "estado", label: "Estado", sortable: true, render: (row) => (
                    <div className="flex items-center gap-1">
                      <Badge variant={row.estado === "pagada" ? "success" : row.estado === "anulada" ? "danger" : "warning"}>
                        {row.estado === "pagada" ? "Pagada" : row.estado === "anulada" ? "Anulada" : "Pendiente"}
                      </Badge>
                      {row.sobre_verde && (
                        <span title="Sobre verde (efectivo)" className="text-emerald-500"><Mail className="h-3.5 w-3.5" /></span>
                      )}
                      {row.certificado_retencion_url && (
                        <span title="Certificado de retención adjunto" className="text-violet-500"><Paperclip className="h-3.5 w-3.5" /></span>
                      )}
                      {(row.archivo_url || (row.archivos && row.archivos.length > 0)) && (
                        <span title="Comprobante adjunto" className="text-orange-500"><Paperclip className="h-3.5 w-3.5" /></span>
                      )}
                    </div>
                  )},
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setSelectedOP(row)} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Ver detalle">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleGenerarComprobante(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Generar comprobante">
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => openOrdenPagoEmail(row)}
                        className={`rounded p-1.5 transition-colors ${row.email_enviado_at ? "text-emerald-600 hover:bg-emerald-100" : "text-zinc-400 hover:bg-orange-100 hover:text-orange-600"}`}
                        title={row.email_enviado_at ? `Enviada por email el ${formatDateTime(row.email_enviado_at)}${row.proveedor_email ? ` a ${row.proveedor_email}` : ""}` : `Enviar por email${row.proveedor_email ? ` (${row.proveedor_email})` : ""}`}
                      >
                        {row.email_enviado_at ? <MailCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                      </button>
                      {row.estado === "pendiente" && (
                          <button onClick={() => handlePagarOP(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar como pagada">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                      )}
                      {row.estado !== "anulada" && (
                          <button onClick={() => handleAnularOP(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                      )}
                    </div>
                  )},
                ]}
                data={filteredOPs}
                onRowClick={(row) => setSelectedOP(row)}
                emptyMessage="No hay ordenes de pago cargadas"
              />
            </Card>
          </>
        )}

        {/* ── Gastos Manuales ── */}
        {tab === "gastos_manuales" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">
                Total gastos: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                  {formatCurrency(gastosManuales.filter(g => g.moneda !== "USD").reduce((s, g) => s + g.monto, 0))}
                </span>
                {gastosManuales.some(g => g.moneda === "USD") && (
                  <span className="font-bold font-mono text-zinc-900 dark:text-white ml-2">
                    | {formatCurrency(gastosManuales.filter(g => g.moneda === "USD").reduce((s, g) => s + g.monto, 0), "USD")}
                  </span>
                )}
              </p>
              <button onClick={openGMModal} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                <Plus className="h-4 w-4" /> Nuevo gasto
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<GastoManualRow>
                columns={[
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "descripcion", label: "Descripción", sortable: true, render: (row) => (
                    <div>
                      <span className="font-medium">{row.descripcion}</span>
                      {row.proveedor_nombre && <p className="text-xs text-zinc-400">{row.proveedor_nombre}</p>}
                    </div>
                  )},
                  { key: "categoria", label: "Categoría", render: (row) => <Badge variant="info">{row.categoria}</Badge> },
                  { key: "tipo_gasto", label: "Tipo", render: (row) => {
                    const label = TIPO_GASTO_OPTIONS.find(t => t.value === row.tipo_gasto)?.label ?? row.tipo_gasto;
                    return <Badge variant={tipoGastoVariant[row.tipo_gasto] ?? "outline"}>{label}</Badge>;
                  }},
                  { key: "tipo_recurrencia" as any, label: "Recurrencia", render: (row) => (
                    <Badge variant={row.tipo_recurrencia === "fijo" ? "purple" : "outline"}>
                      {row.tipo_recurrencia === "fijo" ? "Fijo" : "Eventual"}
                    </Badge>
                  )},
                  { key: "medio_pago", label: "Medio de pago", render: (row) => {
                    const mp = row.medio_pago || "efectivo";
                    const mpLabels: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", debito_automatico: "Debito aut." };
                    return <Badge variant="outline">{mpLabels[mp] ?? mp}</Badge>;
                  }},
                  { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.monto, row.moneda)}</span> },
                  { key: "moneda", label: "Moneda", render: (row) => <Badge variant="outline">{row.moneda}</Badge> },
                  { key: "comprobante_url", label: "Comp.", render: (row) => row.comprobante_url ? (
                    <a href={row.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600" title="Ver comprobante"><Paperclip className="h-4 w-4" /></a>
                  ) : <span className="text-zinc-300 text-xs">—</span> },
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => openGMEdit(row)} className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-500" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDeleteGM(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Eliminar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )},
                ]}
                data={gastosManuales}
                emptyMessage="No hay gastos manuales cargados"
              />
            </Card>
          </>
        )}

        {/* ── CC Clientes ── */}
        {tab === "cc_clientes" && (
          <>
            {!ccDetailCliente ? (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                    <input value={ccClienteSearch} onChange={(e) => setCcClienteSearch(e.target.value)}
                      placeholder="Buscar por nombre o CUIT..."
                      className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  {ccClienteSearch && <span className="text-xs text-zinc-500">{filteredCcClientes.length} de {ccClientes.length}</span>}
                  <button onClick={() => {
                    const lines = ["Cliente,CUIT,Dias CC,Forma de Pago,Limite,Saldo"];
                    filteredCcClientes.forEach(c => {
                      lines.push(`"${c.razon_social}","${c.cuit || ""}",${c.dias_cuenta_corriente},"${c.forma_pago}",${c.limite_credito.toFixed(2)},${c.saldo_cuenta_corriente.toFixed(2)}`);
                    });
                    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
                    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `CC_Clientes_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
                  }} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors ml-auto">
                    <Download className="h-4 w-4" /> Exportar CSV
                  </button>
                </div>
                <Card className="p-0 overflow-hidden">
                  <DataTable<CCRow>
                    columns={[
                      { key: "razon_social", label: "Cliente", sortable: true, render: (row) => <span className="font-medium">{row.razon_social}</span> },
                      { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                      { key: "dias_cuenta_corriente", label: "Dias CC", sortable: true, render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                      { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago || "—"}</Badge> },
                      { key: "limite_credito", label: "Limite", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limite_credito)}</span> },
                      { key: "saldo_cuenta_corriente", label: "Nos debe", className: "text-right", sortable: true, render: (row) => {
                        const pct = row.limite_credito ? (row.saldo_cuenta_corriente / row.limite_credito) * 100 : 0;
                        return (<div className="text-right"><span className={`font-mono font-semibold ${pct > 80 ? "text-red-600" : ""}`}>{formatCurrency(row.saldo_cuenta_corriente)}</span>{row.limite_credito > 0 && row.saldo_cuenta_corriente > row.limite_credito && <p className="mt-1 text-xs text-red-600 dark:text-red-400">Límite de crédito excedido</p>}<div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} /></div></div>);
                      }},
                      { key: "cuit" as any, label: "Le debemos", className: "text-right", sortable: false, render: (row) => {
                        const saldoProv = row.cuit ? cuitToSaldoProveedor[row.cuit] : undefined;
                        if (saldoProv === undefined || saldoProv === 0) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
                        return <span className="font-mono font-semibold text-red-600">{formatCurrency(saldoProv)}</span>;
                      }},
                      { key: "id" as any, label: "Neto", className: "text-right", sortable: false, render: (row) => {
                        const saldoProv = row.cuit ? (cuitToSaldoProveedor[row.cuit] ?? 0) : 0;
                        if (!row.cuit || !cuitToSaldoProveedor[row.cuit]) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
                        const neto = row.saldo_cuenta_corriente - saldoProv;
                        return <span className={`font-mono font-bold ${neto >= 0 ? "text-emerald-600" : "text-red-600"}`}>{neto >= 0 ? "+" : ""}{formatCurrency(neto)}</span>;
                      }},
                    ]}
                    data={filteredCcClientes}
                    onRowClick={(row) => fetchCCDetailCliente(row)}
                  />
                </Card>
              </>
            ) : (
              <>
                {/* Detail view for a single client */}
                <div className="mb-4 flex items-center gap-3">
                  <button onClick={() => setCcDetailCliente(null)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                    <X className="h-4 w-4" /> Volver
                  </button>
                  <h2 className="text-lg font-semibold">{ccDetailCliente.razon_social}</h2>
                  {ccDetailCliente.cuit && <span className="font-mono text-xs text-zinc-500">CUIT: {ccDetailCliente.cuit}</span>}
                  <span className="ml-auto font-mono text-lg font-bold text-red-600">Deuda: {formatCurrency(ccDetailCliente.saldo_cuenta_corriente)}</span>
                </div>
                <div className="flex gap-2 mb-4">
                  <button onClick={openCobroMultiple} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                    <DollarSign className="h-4 w-4" /> Realizar cobro
                  </button>
                  <button onClick={() => openManualMovForCliente(ccDetailCliente)} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Plus className="h-4 w-4" /> Movimiento manual
                  </button>
                  <button onClick={exportCCCliente} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Download className="h-4 w-4" /> Exportar CSV
                  </button>
                </div>

                {ccDetailLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /><span className="ml-2 text-sm text-zinc-500">Cargando estado de cuenta...</span></div>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Facturas ({ccDetailFacturas.length})</h3>
                    <Card className="p-0 overflow-hidden mb-4">
                      <DataTable<CCFacturaRow>
                        columns={[
                          { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-sm">{formatDate(row.fecha)}</span> },
                          { key: "vencimiento" as any, label: "Vencimiento", render: (row) => <span className={`text-sm ${row.vencimiento && row.vencimiento < new Date().toISOString().slice(0, 10) && row.estado !== "pagada" ? "text-red-600 font-semibold" : ""}`}>{row.vencimiento ? formatDate(row.vencimiento) : "—"}</span> },
                          { key: "numero", label: "Comprobante", sortable: true, render: (row) => <span className="font-mono text-xs">{row.tipo}{String(row.punto_venta).padStart(4, "0")}-{String(row.numero).padStart(8, "0")}</span> },
                          { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total, row.moneda as "ARS" | "USD")}</span> },
                          { key: "total_acreditado" as any, label: "Saldo", className: "text-right", render: (row) => { const saldo = Math.max(0, row.total - row.total_acreditado - row.cobrado); return <span className={`font-mono font-semibold block text-right ${saldo > 0.01 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(saldo, row.moneda as "ARS" | "USD")}</span>; }},
                          { key: "estado", label: "Estado", render: (row) => { const cfg: Record<string, { label: string; variant: "success" | "warning" | "danger" | "outline" }> = { pagada: { label: "Pagada", variant: "success" }, parcial: { label: "Parcial", variant: "warning" }, emitida: { label: "Pendiente", variant: "danger" } }; const c = cfg[row.estado] || { label: row.estado, variant: "outline" as const }; return <Badge variant={c.variant}>{c.label}</Badge>; }},
                        ]}
                        data={ccDetailFacturas}
                        emptyMessage="Sin facturas registradas"
                      />
                    </Card>

                    <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Movimientos ({ccDetailMovimientos.length})</h3>
                    <Card className="p-0 overflow-hidden">
                      <DataTable<CCMovRow>
                        columns={[
                          { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-sm">{formatDate(row.fecha)}</span> },
                          { key: "tipo", label: "Tipo", render: (row) => { const tc = tipoConfig[row.tipo] || { label: row.tipo, variant: "outline" as const, icon: Wallet }; return <Badge variant={tc.variant}>{tc.label}</Badge>; }},
                          { key: "descripcion", label: "Descripcion", render: (row) => <span className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xs truncate block">{row.descripcion}</span> },
                          { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className={`font-mono font-semibold block text-right text-emerald-600`}>{formatCurrency(row.monto, row.moneda as "ARS" | "USD")}</span> },
                          { key: "conciliado" as any, label: "Estado", render: (row) => <Badge variant={row.conciliado ? "success" : "warning"}>{row.conciliado ? "Conciliado" : "Pendiente"}</Badge> },
                        ]}
                        data={ccDetailMovimientos}
                        onRowClick={(row) => openMovDetail(row as any)}
                        emptyMessage="Sin movimientos registrados"
                      />
                    </Card>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── CC Proveedores ── */}
        {tab === "cc_proveedores" && (
          <>
            {!ccDetailProveedor ? (<>
              <div className="mb-4 flex items-center gap-2">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input value={ccProveedorSearch} onChange={(e) => setCcProveedorSearch(e.target.value)} placeholder="Buscar por nombre o CUIT..." className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                {ccProveedorSearch && <span className="text-xs text-zinc-500">{filteredCcProveedores.length} de {ccProveedores.length}</span>}
                <button onClick={() => {
                  const lines = ["Proveedor,CUIT,Dias CC,Forma de Pago,Limite,Saldo"];
                  filteredCcProveedores.forEach(p => {
                    lines.push(`"${p.razon_social}","${p.cuit || ""}",${p.dias_cuenta_corriente},"${p.forma_pago}",${p.limite_credito.toFixed(2)},${p.saldo_cuenta_corriente.toFixed(2)}`);
                  });
                  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `CC_Proveedores_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
                }} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors ml-auto">
                  <Download className="h-4 w-4" /> Exportar CSV
                </button>
              </div>
              <Card className="p-0 overflow-hidden">
                <DataTable<CCRow>
                  columns={[
                    { key: "razon_social", label: "Proveedor", sortable: true, render: (row) => <span className="font-medium">{row.razon_social}</span> },
                    { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                    { key: "rubro", label: "Rubro", render: (row) => <Badge variant="info">{(row.rubro ?? "").split(" ")[0]}</Badge> },
                    { key: "dias_cuenta_corriente", label: "Dias CC", sortable: true, render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                    { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago || "—"}</Badge> },
                    { key: "limite_credito", label: "Limite", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limite_credito)}</span> },
                    { key: "saldo_cuenta_corriente", label: "Le debemos", className: "text-right", sortable: true, render: (row) => {
                      const pct = row.limite_credito ? (row.saldo_cuenta_corriente / row.limite_credito) * 100 : 0;
                      return (<div className="text-right"><span className={`font-mono font-semibold text-red-600`}>{formatCurrency(row.saldo_cuenta_corriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                    }},
                    { key: "cuit" as any, label: "Nos debe", className: "text-right", sortable: false, render: (row) => {
                      const saldoCli = row.cuit ? cuitToSaldoCliente[row.cuit] : undefined;
                      if (saldoCli === undefined || saldoCli === 0) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
                      return <span className="font-mono font-semibold text-emerald-600">{formatCurrency(saldoCli)}</span>;
                    }},
                    { key: "id" as any, label: "Neto", className: "text-right", sortable: false, render: (row) => {
                      const saldoCli = row.cuit ? (cuitToSaldoCliente[row.cuit] ?? 0) : 0;
                      if (!row.cuit || !cuitToSaldoCliente[row.cuit]) return <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>;
                      const neto = saldoCli - row.saldo_cuenta_corriente;
                      return <span className={`font-mono font-bold ${neto >= 0 ? "text-emerald-600" : "text-red-600"}`}>{neto >= 0 ? "+" : ""}{formatCurrency(neto)}</span>;
                    }},
                  ]}
                  data={filteredCcProveedores}
                  onRowClick={(row) => fetchCCDetailProveedor(row)}
                />
              </Card>
            </>) : (<>
              <div className="mb-4 flex items-center gap-3">
                <button onClick={() => setCcDetailProveedor(null)} className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"><X className="h-4 w-4" /> Volver</button>
                <h2 className="text-lg font-semibold">{ccDetailProveedor.razon_social}</h2>
                {ccDetailProveedor.cuit && <span className="font-mono text-xs text-zinc-500">CUIT: {ccDetailProveedor.cuit}</span>}
                <span className="ml-auto font-mono text-lg font-bold text-red-600">Deuda: {formatCurrency(ccDetailProveedor.saldo_cuenta_corriente)}</span>
              </div>
              <div className="flex gap-2 mb-4">
                <button onClick={() => { openOPModal(ccDetailProveedor.id); setCcDetailProveedor(null); setTab("ordenes_pago"); }} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
                  <DollarSign className="h-4 w-4" /> Crear OP
                </button>
                <button onClick={() => openManualMovForProveedor(ccDetailProveedor)} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"><Plus className="h-4 w-4" /> Movimiento manual</button>
                <button onClick={exportCCProveedor} className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /> Exportar CSV</button>
              </div>
              {ccDetailProvLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-zinc-400" /><span className="ml-2 text-sm text-zinc-500">Cargando estado de cuenta...</span></div>
              ) : (<>
                <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Facturas de compra ({ccDetailFCProv.length})</h3>
                <Card className="p-0 overflow-hidden mb-4">
                  <DataTable<CCFCRow>
                    columns={[
                      { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-sm">{formatDate(row.fecha)}</span> },
                      { key: "fecha_vencimiento" as any, label: "Vencimiento", render: (row) => <span className={`text-sm ${row.fecha_vencimiento && row.fecha_vencimiento < new Date().toISOString().slice(0, 10) && row.estado !== "pagada" ? "text-red-600 font-semibold" : ""}`}>{row.fecha_vencimiento ? formatDate(row.fecha_vencimiento) : "—"}</span> },
                      { key: "numero_factura", label: "N. Factura", sortable: true, render: (row) => <span className="font-mono text-xs">{row.numero_factura}</span> },
                      { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total, row.moneda as "ARS" | "USD")}</span> },
                      { key: "pagado" as any, label: "Pagado", className: "text-right", render: (row) => <span className="font-mono block text-right text-emerald-600">{row.pagado > 0 ? formatCurrency(row.pagado, row.moneda as "ARS" | "USD") : "—"}</span> },
                      { key: "id" as any, label: "Saldo", className: "text-right", render: (row) => { const saldo = Math.max(0, row.total - row.pagado); return <span className={`font-mono font-semibold block text-right ${saldo > 0.01 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(saldo, row.moneda as "ARS" | "USD")}</span>; }},
                      { key: "estado", label: "Estado", render: (row) => { const cfg: Record<string, { label: string; variant: "success" | "warning" | "danger" | "outline" }> = { pagada: { label: "Pagada", variant: "success" }, pendiente: { label: "Pendiente", variant: "danger" }, recibida: { label: "Recibida", variant: "warning" } }; const c = cfg[row.estado] || { label: row.estado, variant: "outline" as const }; return <Badge variant={c.variant}>{c.label}</Badge>; }},
                    ]}
                    data={ccDetailFCProv}
                    emptyMessage="Sin facturas de compra"
                  />
                </Card>
                <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Movimientos ({ccDetailMovProv.length})</h3>
                <Card className="p-0 overflow-hidden">
                  <DataTable<CCMovRow>
                    columns={[
                      { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-sm">{formatDate(row.fecha)}</span> },
                      { key: "tipo", label: "Tipo", render: (row) => { const tc = tipoConfig[row.tipo] || { label: row.tipo, variant: "outline" as const, icon: Wallet }; return <Badge variant={tc.variant}>{tc.label}</Badge>; }},
                      { key: "descripcion", label: "Descripcion", render: (row) => <span className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xs truncate block">{row.descripcion}</span> },
                      { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right text-red-600">{formatCurrency(row.monto, row.moneda as "ARS" | "USD")}</span> },
                      { key: "conciliado" as any, label: "Estado", render: (row) => <Badge variant={row.conciliado ? "success" : "warning"}>{row.conciliado ? "Conciliado" : "Pendiente"}</Badge> },
                    ]}
                    data={ccDetailMovProv}
                    onRowClick={(row) => openMovDetail(row as any)}
                    emptyMessage="Sin movimientos registrados"
                  />
                </Card>
              </>)}
            </>)}
          </>
        )}

        {/* ── Echeqs ── */}
        {tab === "echeqs" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 mb-4">
              <StatCard title="Recibidos en cartera" value={`${echeqsEnCartera.length} — ${formatCurrency(echeqsMontoCarteraARS)}${echeqsMontoCarteraUSD > 0 ? ` + ${formatCurrency(echeqsMontoCarteraUSD, "USD")}` : ""}`} icon={Wallet} iconColor="text-blue-600" />
              <StatCard title="Propios pendientes" value={`${echeqsEmitidosPendientes.length} — ${formatCurrency(echeqsMontoEmitidosPendARS)}${echeqsMontoEmitidosPendUSD > 0 ? ` + ${formatCurrency(echeqsMontoEmitidosPendUSD, "USD")}` : ""}`} icon={CreditCard} iconColor="text-orange-500" />
              <StatCard title="Por vencer (7 días)" value={String(echeqsPorVencer)} icon={Clock} iconColor="text-amber-500" />
              <StatCard title="Endosados / Entregados" value={String(echeqs.filter(e => e.estado === "endosado" || e.estado === "entregado").length)} icon={ArrowUpRight} iconColor="text-purple-500" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <select value={echeqFilterDireccion} onChange={(e) => setEcheqFilterDireccion(e.target.value as "" | "emitido" | "recibido")}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="">Todos</option>
                  <option value="recibido">Recibidos</option>
                  <option value="emitido">Emitidos (propios)</option>
                </select>
                <select value={echeqFilterEstado} onChange={(e) => setEcheqFilterEstado(e.target.value)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="">Todos los estados</option>
                  {Object.entries(echeqEstadoConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <button onClick={() => { setEcheqForm(emptyEcheqForm); setEcheqError(""); setEcheqClienteSearch(""); setEcheqModalOpen(true); }}
                className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600">
                <Plus className="h-4 w-4" /> Registrar cheque
              </button>
            </div>
            <div className="flex gap-6">
              <div className={`transition-all ${selectedEcheq && !echeqActionModal ? "w-3/5" : "w-full"}`}>
                <Card className="p-0 overflow-hidden">
                  <DataTable<EcheqRow>
                    columns={[
                      { key: "direccion" as any, label: "Dir.", sortable: true, render: (row) => (
                        <Badge variant={row.direccion === "emitido" ? "orange" : "default"}>
                          {row.direccion === "emitido" ? "Emitido" : "Recibido"}
                        </Badge>
                      )},
                      { key: "tipo_cheque" as any, label: "Tipo", sortable: true, render: (row) => (
                        <Badge variant={row.tipo_cheque === "echeq" ? "info" : "outline"}>
                          {row.tipo_cheque === "echeq" ? "E-Cheq" : "Físico"}
                        </Badge>
                      )},
                      { key: "numero", label: "Número", sortable: true, render: (row) => <span className="font-mono font-medium">{row.numero}</span> },
                      { key: "banco_emisor", label: "Banco", sortable: true, render: (row) => <span className="text-zinc-500">{row.banco_emisor || "—"}</span> },
                      { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.monto, row.moneda)}</span> },
                      { key: "fecha_pago", label: "Fecha pago", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha_pago)}</span> },
                      { key: "estado", label: "Estado", sortable: true, render: (row) => {
                        const cfg = echeqEstadoConfig[row.estado] || { label: row.estado, variant: "outline" as const };
                        return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                      }},
                      { key: "origen_nombre", label: "Origen", render: (row) => <span className="text-sm">{row.origen_nombre || "—"}</span> },
                    ]}
                    data={filteredEcheqs}
                    onRowClick={(row) => setSelectedEcheq(selectedEcheq?.id === row.id ? null : row)}
                    emptyMessage="No hay cheques registrados"
                  />
                </Card>
              </div>

              {/* Panel detalle cheque */}
              {selectedEcheq && !echeqActionModal && (
                <div className="w-2/5">
                  <Card className="sticky top-6">
                    <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
                      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Cheque #{selectedEcheq.numero}</h3>
                      <button onClick={() => setSelectedEcheq(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"><X className="h-5 w-5" /></button>
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={selectedEcheq.direccion === "emitido" ? "orange" : "default"}>
                          {selectedEcheq.direccion === "emitido" ? "Emitido" : "Recibido"}
                        </Badge>
                        <Badge variant={selectedEcheq.tipo_cheque === "echeq" ? "info" : "outline"}>
                          {selectedEcheq.tipo_cheque === "echeq" ? "E-Cheq" : "Físico"}
                        </Badge>
                        {(() => { const cfg = echeqEstadoConfig[selectedEcheq.estado] || { label: selectedEcheq.estado, variant: "outline" as const }; return <Badge variant={cfg.variant}>{cfg.label}</Badge>; })()}
                      </div>
                      <div className="text-center py-3">
                        <p className="text-3xl font-bold text-zinc-900 dark:text-white font-mono">{formatCurrency(selectedEcheq.monto, selectedEcheq.moneda)}</p>
                      </div>
                      <div className="space-y-2.5 text-sm">
                        <div className="flex justify-between"><span className="text-zinc-500">Banco emisor</span><span className="font-medium text-zinc-900 dark:text-white">{selectedEcheq.banco_emisor || "—"}</span></div>
                        {selectedEcheq.cuit_emisor && <div className="flex justify-between"><span className="text-zinc-500">CUIT emisor</span><span className="font-mono text-zinc-900 dark:text-white">{selectedEcheq.cuit_emisor}</span></div>}
                        {selectedEcheq.fecha_emision && <div className="flex justify-between"><span className="text-zinc-500">Fecha emisión</span><span className="text-zinc-900 dark:text-white">{formatDate(selectedEcheq.fecha_emision)}</span></div>}
                        <div className="flex justify-between"><span className="text-zinc-500">Fecha pago</span><span className="font-medium text-zinc-900 dark:text-white">{formatDate(selectedEcheq.fecha_pago)}</span></div>
                        <div className="flex justify-between"><span className="text-zinc-500">Origen</span><span className="text-zinc-900 dark:text-white">{selectedEcheq.origen_nombre || "—"}</span></div>
                        {selectedEcheq.destino_nombre && <div className="flex justify-between"><span className="text-zinc-500">Destino</span><span className="text-zinc-900 dark:text-white">{selectedEcheq.destino_nombre}</span></div>}
                        {selectedEcheq.fecha_endoso && <div className="flex justify-between"><span className="text-zinc-500">Fecha endoso</span><span className="text-zinc-900 dark:text-white">{formatDate(selectedEcheq.fecha_endoso)}</span></div>}
                        {selectedEcheq.fecha_deposito && <div className="flex justify-between"><span className="text-zinc-500">Fecha depósito</span><span className="text-zinc-900 dark:text-white">{formatDate(selectedEcheq.fecha_deposito)}</span></div>}
                        {selectedEcheq.observaciones && (
                          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700">
                            <p className="text-xs text-zinc-500 mb-1">Observaciones</p>
                            <p className="text-zinc-700 dark:text-zinc-300">{selectedEcheq.observaciones}</p>
                          </div>
                        )}
                      </div>

                      {/* Acciones */}
                      {selectedEcheq.estado === "en_cartera" && (
                        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-700">
                          <p className="text-xs font-medium text-zinc-500 mb-2 uppercase">Acciones</p>
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => setEcheqActionModal("endosar")} className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 dark:bg-purple-950/30 dark:text-purple-400">
                              <ArrowUpRight className="h-3.5 w-3.5" /> Endosar
                            </button>
                            <button onClick={() => setEcheqActionModal("depositar")} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400">
                              <Landmark className="h-3.5 w-3.5" /> Depositar
                            </button>
                            <button onClick={() => handleEcheqAction("cobrar")} className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Cobrado
                            </button>
                            <button onClick={() => handleEcheqAction("rechazar")} className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400">
                              <Ban className="h-3.5 w-3.5" /> Rechazar
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="pt-3 border-t border-zinc-100 dark:border-zinc-700 flex justify-end">
                        <button onClick={() => handleDeleteEcheq(selectedEcheq.id)} className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400">
                          <Trash2 className="h-3.5 w-3.5" /> Eliminar
                        </button>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Echeq Create Modal ── */}
        {echeqModalOpen && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setEcheqModalOpen(false)} />
            <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold dark:text-white">Registrar Cheque</h2>
                <button onClick={() => setEcheqModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              {echeqError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{echeqError}</div>}
              <div className="space-y-4">
                {/* Dirección: emitido vs recibido */}
                <div>
                  <label className="text-xs font-medium text-zinc-500">Dirección</label>
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, direccion: "recibido" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.direccion === "recibido" ? "bg-blue-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      Recibido (de tercero)
                    </button>
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, direccion: "emitido" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.direccion === "emitido" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      Emitido (propio)
                    </button>
                  </div>
                </div>
                {/* Tipo de cheque */}
                <div>
                  <label className="text-xs font-medium text-zinc-500">Tipo de cheque</label>
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, tipo_cheque: "fisico" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.tipo_cheque === "fisico" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      Cheque físico
                    </button>
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, tipo_cheque: "echeq" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.tipo_cheque === "echeq" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      E-Cheq (electrónico)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Número *</label>
                    <input value={echeqForm.numero} onChange={(e) => setEcheqForm({ ...echeqForm, numero: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">{echeqForm.direccion === "emitido" ? "Banco (nuestro)" : "Banco emisor"}</label>
                    <input value={echeqForm.banco_emisor} onChange={(e) => setEcheqForm({ ...echeqForm, banco_emisor: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                </div>
                <div className={`grid gap-4 ${echeqForm.direccion === "emitido" ? "grid-cols-3" : "grid-cols-3"}`}>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Monto *</label>
                    <input type="number" value={echeqForm.monto || ""} onChange={(e) => setEcheqForm({ ...echeqForm, monto: Number(e.target.value) })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Moneda</label>
                    <select value={echeqForm.moneda} onChange={(e) => setEcheqForm({ ...echeqForm, moneda: e.target.value as "ARS" | "USD" })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                      <option value="ARS">ARS</option><option value="USD">USD</option>
                    </select>
                  </div>
                  {echeqForm.direccion === "recibido" ? (
                    <div>
                      <label className="text-xs font-medium text-zinc-500">CUIT emisor</label>
                      <input value={echeqForm.cuit_emisor} onChange={(e) => setEcheqForm({ ...echeqForm, cuit_emisor: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-zinc-500">N° Chequera</label>
                      <input value={echeqForm.chequera} onChange={(e) => setEcheqForm({ ...echeqForm, chequera: e.target.value })}
                        placeholder="Ej: 001" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Fecha emisión</label>
                    <input type="date" value={echeqForm.fecha_emision} onChange={(e) => setEcheqForm({ ...echeqForm, fecha_emision: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Fecha pago *</label>
                    <input type="date" value={echeqForm.fecha_pago} onChange={(e) => setEcheqForm({ ...echeqForm, fecha_pago: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                </div>
                {/* Origen: solo para recibidos */}
                {echeqForm.direccion === "recibido" && (
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Origen</label>
                    <div className="flex gap-2 mt-1 mb-2">
                      <button onClick={() => setEcheqForm({ ...echeqForm, origen_tipo: "cliente", origen_nombre: "" })}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqForm.origen_tipo === "cliente" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Cliente</button>
                      <button onClick={() => setEcheqForm({ ...echeqForm, origen_tipo: "otro", origen_id: "" })}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqForm.origen_tipo === "otro" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Otro</button>
                    </div>
                    {echeqForm.origen_tipo === "cliente" ? (
                      <div>
                        <input
                          type="text"
                          value={echeqClienteSearch}
                          onChange={(e) => setEcheqClienteSearch(e.target.value)}
                          placeholder="Filtrar clientes..."
                          className="w-full rounded-t-lg border border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                        />
                        <select value={echeqForm.origen_id} onChange={(e) => setEcheqForm({ ...echeqForm, origen_id: e.target.value })} size={5}
                          className="w-full rounded-b-lg border border-t-0 border-zinc-200 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="">Seleccionar cliente</option>
                          {filteredClientesEcheq.map((c: ClienteOption) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                        </select>
                      </div>
                    ) : (
                      <input value={echeqForm.origen_nombre} onChange={(e) => setEcheqForm({ ...echeqForm, origen_nombre: e.target.value })}
                        placeholder="Nombre del origen" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    )}
                  </div>
                )}
                <div>
                  <label className="text-xs font-medium text-zinc-500">Observaciones</label>
                  <textarea value={echeqForm.observaciones} onChange={(e) => setEcheqForm({ ...echeqForm, observaciones: e.target.value })}
                    rows={2} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button onClick={() => setEcheqModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                <button onClick={handleCreateEcheq} disabled={echeqSaving}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                  {echeqSaving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Echeq Action Modal (Endosar/Depositar) ── */}
        {echeqActionModal && selectedEcheq && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setEcheqActionModal(null)} />
            <div className="fixed inset-4 z-50 m-auto h-fit max-h-[70vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
              <h2 className="text-lg font-bold mb-4 dark:text-white">{echeqActionModal === "endosar" ? "Endosar cheque" : "Depositar cheque"}</h2>
              <p className="text-sm text-zinc-500 mb-4">Cheque #{selectedEcheq.numero} — {formatCurrency(selectedEcheq.monto, selectedEcheq.moneda)}</p>
              <div className="space-y-4">
                {echeqActionModal === "endosar" && (
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Destino</label>
                    <div className="flex gap-2 mt-1 mb-2">
                      <button onClick={() => setEcheqDestinoTipo("proveedor")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqDestinoTipo === "proveedor" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Proveedor</button>
                      <button onClick={() => setEcheqDestinoTipo("banco")} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqDestinoTipo === "banco" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Banco</button>
                    </div>
                    {echeqDestinoTipo === "proveedor" ? (
                      <select value={echeqDestinoId} onChange={(e) => setEcheqDestinoId(e.target.value)}
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                        <option value="">Seleccionar proveedor</option>
                        {proveedoresOptions.map(p => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                      </select>
                    ) : (
                      <input value={echeqDestinoNombre} onChange={(e) => setEcheqDestinoNombre(e.target.value)}
                        placeholder="Nombre del banco" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    )}
                  </div>
                )}
                {echeqActionModal === "depositar" && (
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Banco destino</label>
                    <input value={echeqDestinoNombre} onChange={(e) => setEcheqDestinoNombre(e.target.value)}
                      placeholder="Nombre del banco" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <button onClick={() => setEcheqActionModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                <button onClick={() => handleEcheqAction(echeqActionModal)} disabled={echeqActionSaving}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                  {echeqActionSaving && <Loader2 className="h-4 w-4 animate-spin" />} {echeqActionModal === "endosar" ? "Endosar" : "Depositar"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Extractos bancarios ── */}
        {tab === "extractos" && (
          <>
            <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-600 dark:bg-zinc-900">
              <Upload className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-300">Arrastra un extracto o hace click para subir</p>
              <p className="text-sm text-zinc-400">Formato admitido para carga automática: .csv</p>
              <label className="mt-3 flex justify-center items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                Moneda de la cuenta
                <select value={extractoMoneda} disabled={extractoUploading} onChange={e => setExtractoMoneda(e.target.value as "ARS" | "USD" | "")}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800">
                  <option value="">Seleccionar…</option><option value="ARS">Pesos (ARS)</option><option value="USD">Dólares (USD)</option>
                </select>
              </label>
              <label className={`mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 ${extractoUploading ? "pointer-events-none opacity-60" : ""}`}>
                {extractoUploading && <Loader2 className="h-4 w-4 animate-spin" />}
                {extractoUploading ? "Procesando…" : "Seleccionar archivo"}
                <input type="file" accept=".csv,text/csv" className="sr-only" disabled={extractoUploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) void handleExtractoUpload(file); e.currentTarget.value = ""; }} />
              </label>
              {extractoUploadError && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{extractoUploadError}</p>}
            </div>

            {extracto ? (
              <Card>
                <CardHeader>
                  <div><CardTitle>{extracto.banco} — {extracto.cuenta}</CardTitle><p className="text-sm text-zinc-500 mt-1">{extracto.periodo}</p></div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success">Matcheados: {extracto.extracto_movimientos.filter(m => m.estado === "matcheado").length}</Badge>
                    <Badge variant="warning">Pendientes: {extracto.extracto_movimientos.filter(m => m.estado === "pendiente").length}</Badge>
                  </div>
                </CardHeader>

                <div className="flex gap-2 mb-4">
                  {(["todos", "matcheado", "pendiente"] as const).map((f) => {
                    const count = f === "todos" ? extracto.extracto_movimientos.length : extracto.extracto_movimientos.filter(m => m.estado === f).length;
                    return (<button key={f} onClick={() => setFilterExtracto(f)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${filterExtracto === f ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"}`}>{f === "todos" ? "Todos" : f === "matcheado" ? "Matcheados" : "Pendientes"} ({count})</button>);
                  })}
                </div>

                <DataTable<ExtractoMovimientoRow>
                  columns={[
                    { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
                    { key: "descripcion", label: "Descripcion", render: (row) => <span className="font-medium text-xs">{row.descripcion}</span> },
                    { key: "referencia", label: "Ref.", render: (row) => <span className="font-mono text-xs text-zinc-400">{row.referencia}</span> },
                    { key: "monto", label: "Monto", className: "text-right", render: (row) => (
                      <div className="flex items-center justify-end gap-1.5">
                        {row.tipo === "credito" ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /> : <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />}
                        <span className={`font-mono font-semibold ${row.tipo === "credito" ? "text-emerald-600" : "text-red-600"}`}>{row.tipo === "credito" ? "+" : "-"}{formatCurrency(row.monto, (extracto as any)?.moneda || "ARS")}</span>
                      </div>
                    )},
                    { key: "estado", label: "Match", render: (row) => row.estado === "matcheado"
                      ? <div className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-emerald-500" /><Badge variant="success">Match</Badge></div>
                      : <div className="flex items-center gap-2"><Badge variant="warning">Pendiente</Badge><button onClick={() => void handleMatchExtracto(row)} className="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600">Matchear</button></div>
                    },
                  ]}
                  data={movsFiltrados}
                />
              </Card>
            ) : (
              <Card className="text-center py-12">
                <Landmark className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-500">No hay extractos bancarios cargados</p>
                <p className="text-xs text-zinc-400 mt-1">Subi un archivo para comenzar la conciliacion</p>
              </Card>
            )}
          </>
        )}

        {/* ── Lineas de credito ── */}
        {tab === "lineas_credito" && (
          <>
            <Card>
              <CardHeader><CardTitle>Uso global de credito</CardTitle><span className="text-sm text-zinc-500">{totalLineasARS > 0 ? Math.round((totalUtilizadoCreditoARS / totalLineasARS) * 100) : 0}% utilizado</span></CardHeader>
              <div className="h-4 rounded-full bg-zinc-100 dark:bg-zinc-700"><div className="h-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${totalLineasARS > 0 ? (totalUtilizadoCreditoARS / totalLineasARS) * 100 : 0}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs text-zinc-400"><span>Utilizado: {formatCurrency(totalUtilizadoCreditoARS)}{totalUtilizadoCreditoUSD > 0 ? ` + ${formatCurrency(totalUtilizadoCreditoUSD, "USD")}` : ""}</span><span>Disponible: {formatCurrency(totalDisponibleCreditoARS)}{totalDisponibleCreditoUSD > 0 ? ` + ${formatCurrency(totalDisponibleCreditoUSD, "USD")}` : ""}</span></div>
            </Card>

            {lineasCredito.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {lineasCredito.map((lc) => {
                  const pctUsado = lc.monto_total > 0 ? Math.round((lc.monto_utilizado / lc.monto_total) * 100) : 0;
                  const isAgotada = lc.monto_disponible === 0;
                  return (
                    <Card key={lc.id} className={isAgotada ? "border-red-200" : ""}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`rounded-lg p-2.5 ${lc.tipo === "bancaria" ? "bg-blue-50 text-blue-600" : "bg-violet-50 text-violet-600"}`}>
                            {lc.tipo === "bancaria" ? <Landmark className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
                          </div>
                          <div>
                            <h3 className="font-semibold text-zinc-900 dark:text-white">{lc.entidad}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant={lc.estado === "activa" ? "success" : "danger"}>{lc.estado}</Badge>
                              <Badge variant="outline">{lc.tipo === "bancaria" ? "Bancaria" : "Proveedor"}</Badge>
                              {lc.tasa && <span className="text-xs text-zinc-400">TNA {lc.tasa}%</span>}
                            </div>
                          </div>
                        </div>
                        {isAgotada && <AlertTriangle className="h-5 w-5 text-red-500" />}
                      </div>
                      <div className="mt-4 space-y-3">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1.5"><span className="text-zinc-500">{pctUsado}% utilizado</span><span className="font-mono text-zinc-600 dark:text-zinc-300">{formatCurrency(lc.monto_utilizado)} / {formatCurrency(lc.monto_total)}</span></div>
                          <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-2.5 rounded-full ${pctUsado >= 100 ? "bg-red-500" : pctUsado >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pctUsado, 100)}%` }} /></div>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-700">
                          <div><p className="text-xs text-zinc-400">Disponible</p><p className={`font-mono font-bold text-lg ${isAgotada ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(lc.monto_disponible)}</p></div>
                          <div className="text-right"><p className="text-xs text-zinc-400">Vencimiento</p><p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{lc.vencimiento}</p></div>
                        </div>
                        {lc.notas && <p className="text-xs text-zinc-400 pt-2 border-t border-zinc-100">{lc.notas}</p>}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card className="text-center py-12">
                <CreditCard className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                <p className="mt-3 text-sm text-zinc-500">No hay lineas de credito configuradas</p>
              </Card>
            )}
          </>
        )}

        {/* Vencimientos tab removed — functionality accessible from FC tab */}
        {false && (() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(today);
          endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
          const endOfNextWeek = new Date(endOfWeek);
          endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);
          const endOf2Weeks = new Date(endOfNextWeek);
          endOf2Weeks.setDate(endOf2Weeks.getDate() + 7);

          interface VencimientoItem {
            id: string;
            fecha: Date;
            fechaStr: string;
            entidad: string;
            descripcion: string;
            monto: number;
            tipo: "cheque" | "factura" | "cc_vencimiento" | "linea_credito";
          }

          const tipoVencConfig: Record<string, { label: string; variant: "warning" | "danger" | "info" | "outline" }> = {
            cheque: { label: "Cheque", variant: "warning" },
            factura: { label: "Factura", variant: "danger" },
            cc_vencimiento: { label: "CC Vencimiento", variant: "info" },
            linea_credito: { label: "Linea credito", variant: "outline" },
          };

          // Build vencimientos from existing data
          const items: VencimientoItem[] = [];

          // Pagos pendientes (not conciliados, tipo pago/cheque_emitido)
          movimientos
            .filter((m) => !m.conciliado && ["pago", "cheque_emitido"].includes(m.tipo))
            .forEach((m) => {
              items.push({
                id: m.id,
                fecha: new Date(m.fecha),
                fechaStr: m.fecha,
                entidad: m.proveedores?.razon_social || m.clientes?.razon_social || "—",
                descripcion: m.descripcion,
                monto: m.monto,
                tipo: m.tipo === "cheque_emitido" ? "cheque" : "factura",
              });
            });

          // Lineas de credito con vencimiento
          lineasCredito
            .filter((lc) => lc.estado === "activa" && lc.monto_utilizado > 0)
            .forEach((lc) => {
              items.push({
                id: `lc-${lc.id}`,
                fecha: new Date(lc.vencimiento),
                fechaStr: lc.vencimiento,
                entidad: lc.entidad,
                descripcion: `Linea ${lc.tipo === "bancaria" ? "bancaria" : "proveedor"} — ${formatCurrency(lc.monto_utilizado)} utilizado`,
                monto: lc.monto_utilizado,
                tipo: "linea_credito",
              });
            });

          // CC proveedores con saldo (simulate vencimiento based on dias_cuenta_corriente)
          ccProveedores
            .filter((p) => p.saldo_cuenta_corriente > 0)
            .forEach((p) => {
              const venc = new Date(today);
              venc.setDate(venc.getDate() + p.dias_cuenta_corriente);
              items.push({
                id: `cc-${p.id}`,
                fecha: venc,
                fechaStr: venc.toISOString().slice(0, 10),
                entidad: p.razon_social,
                descripcion: `Cuenta corriente — ${p.dias_cuenta_corriente} dias`,
                monto: p.saldo_cuenta_corriente,
                tipo: "cc_vencimiento",
              });
            });

          // Sort by date
          items.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

          // Group by week
          const groups: { label: string; items: VencimientoItem[] }[] = [
            { label: "Vencido", items: [] },
            { label: "Esta semana", items: [] },
            { label: "Proxima semana", items: [] },
            { label: "Proximas 2 semanas", items: [] },
            { label: "Mas adelante", items: [] },
          ];
          items.forEach((item) => {
            const d = new Date(item.fecha);
            d.setHours(0, 0, 0, 0);
            if (d < today) groups[0].items.push(item);
            else if (d <= endOfWeek) groups[1].items.push(item);
            else if (d <= endOfNextWeek) groups[2].items.push(item);
            else if (d <= endOf2Weeks) groups[3].items.push(item);
            else groups[4].items.push(item);
          });

          const totalVencido = groups[0].items.reduce((a, i) => a + i.monto, 0);
          const totalEstaSemana = groups[1].items.reduce((a, i) => a + i.monto, 0);
          const totalProximoMes = items.filter((i) => {
            const d = new Date(i.fecha);
            return d >= today && d <= new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
          }).reduce((a, i) => a + i.monto, 0);

          function getUrgencyClasses(fecha: Date): { border: string; bg: string; icon: typeof AlertTriangle; iconColor: string } {
            const d = new Date(fecha);
            d.setHours(0, 0, 0, 0);
            if (d <= today) return { border: "border-red-300 dark:border-red-700", bg: "bg-red-50 dark:bg-red-950/30", icon: AlertTriangle, iconColor: "text-red-500" };
            if (d <= endOfWeek) return { border: "border-amber-300 dark:border-amber-700", bg: "bg-amber-50 dark:bg-amber-950/30", icon: Clock, iconColor: "text-amber-500" };
            return { border: "border-emerald-200 dark:border-emerald-800", bg: "bg-emerald-50 dark:bg-emerald-950/20", icon: CalendarDays, iconColor: "text-emerald-500" };
          }

          return (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card className={`${totalVencido > 0 ? "border-red-300 dark:border-red-700" : ""}`}>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-red-50 p-2.5 dark:bg-red-950/30">
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-500">Total vencido</p>
                      <p className={`text-xl font-bold font-mono ${totalVencido > 0 ? "text-red-600" : "text-zinc-400"}`}>{formatCurrency(totalVencido)}</p>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/30">
                      <Clock className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-500">A pagar esta semana</p>
                      <p className="text-xl font-bold font-mono text-amber-600">{formatCurrency(totalEstaSemana)}</p>
                    </div>
                  </div>
                </Card>
                <Card>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950/30">
                      <CalendarDays className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-zinc-500">Total proximo mes</p>
                      <p className="text-xl font-bold font-mono text-zinc-700 dark:text-zinc-200">{formatCurrency(totalProximoMes)}</p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Timeline grouped by week */}
              <div className="space-y-6">
                {groups.filter((g) => g.items.length > 0).map((group) => (
                  <div key={group.label}>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{group.label}</h3>
                      <span className="text-xs text-zinc-400 font-mono">
                        ({group.items.length} {group.items.length === 1 ? "pago" : "pagos"} — {formatCurrency(group.items.reduce((a, i) => a + i.monto, 0))})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const urgency = getUrgencyClasses(item.fecha);
                        const UrgencyIcon = urgency.icon;
                        const cfg = tipoVencConfig[item.tipo];
                        return (
                          <div key={item.id} className={`flex items-center gap-4 rounded-lg border p-4 ${urgency.border} ${urgency.bg}`}>
                            <div className={`flex-shrink-0 rounded-lg p-2 ${urgency.bg}`}>
                              <UrgencyIcon className={`h-5 w-5 ${urgency.iconColor}`} />
                            </div>
                            <div className="flex-shrink-0 w-24">
                              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{formatDate(item.fechaStr)}</p>
                              <p className="text-xs text-zinc-400">{(() => {
                                const d = new Date(item.fecha);
                                d.setHours(0, 0, 0, 0);
                                const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                                if (diff < 0) return `Hace ${Math.abs(diff)} dia${Math.abs(diff) !== 1 ? "s" : ""}`;
                                if (diff === 0) return "Hoy";
                                if (diff === 1) return "Manana";
                                return `En ${diff} dias`;
                              })()}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{item.entidad}</p>
                              <p className="text-xs text-zinc-500 truncate">{item.descripcion}</p>
                            </div>
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <span className="flex-shrink-0 font-mono font-bold text-base text-red-600 dark:text-red-400">
                              {formatCurrency(item.monto)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {items.length === 0 && (
                  <Card className="text-center py-12">
                    <CalendarDays className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                    <p className="mt-3 text-sm text-zinc-500">No hay vencimientos pendientes</p>
                  </Card>
                )}
              </div>
            </>
          );
        })()}

        {/* ── Gastos fijos ── */}
        {tab === "gastos_fijos" && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">
                  Total mensual: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                    {formatCurrency(gastosFijos.filter((g) => g.activo && g.moneda === "ARS").reduce((s, g) => s + g.monto, 0))}
                  </span>
                </p>
              </div>
              <button onClick={() => openGastoModal()} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                <Plus className="h-4 w-4" /> Nuevo gasto
              </button>
            </div>
            <div className="space-y-2">
              {gastosFijos.map((g) => (
                <div key={g.id} className={`flex items-center gap-4 rounded-lg border p-4 ${g.activo ? "border-zinc-200 dark:border-zinc-700" : "border-zinc-100 dark:border-zinc-800 opacity-50"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">{g.descripcion}</span>
                      <Badge variant="outline">{g.categoria}</Badge>
                      {!g.activo && <Badge variant="danger">Inactivo</Badge>}
                    </div>
                    {g.notas && <p className="text-xs text-zinc-500 mt-0.5">{g.notas}</p>}
                  </div>
                  <span className="font-mono font-bold text-lg text-zinc-900 dark:text-white">
                    {formatCurrency(g.monto, g.moneda)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openGastoModal(g)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleToggleGasto(g.id, g.activo)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={g.activo ? "Desactivar" : "Activar"}>
                      {g.activo ? <X className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </button>
                    <button onClick={() => handleDeleteGasto(g.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              {gastosFijos.length === 0 && (
                <Card className="text-center py-12">
                  <Wallet className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                  <p className="mt-3 text-sm text-zinc-500">No hay gastos fijos cargados</p>
                  <button onClick={() => openGastoModal()} className="mt-3 text-sm text-orange-500 hover:text-orange-600 font-medium">Agregar el primero</button>
                </Card>
              )}
            </div>
          </>
        )}

        {/* ── Objetivos ── */}
        {tab === "objetivos" && (
          <>
            <div className="space-y-4">
              {objetivos.map((obj) => {
                const isActive = obj.activo && obj.periodoInicio <= todayAR() && obj.periodoFin >= todayAR();
                return (
                  <Card key={obj.id} className={!isActive ? "opacity-50" : ""}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-orange-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white">{obj.nombre}</span>
                        <Badge variant={isActive ? "success" : "outline"}>{isActive ? "Activo" : "Inactivo"}</Badge>
                        <Badge variant="info">{obj.tipo}</Badge>
                      </div>
                      <span className="font-mono font-bold text-lg">{formatCurrency(obj.montoTarget, obj.moneda)}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div><span className="text-zinc-500">Periodo:</span> <span className="font-medium">{formatDate(obj.periodoInicio)} — {formatDate(obj.periodoFin)}</span></div>
                      <div><span className="text-zinc-500">Asignado a:</span> <span className="font-medium">{obj.usuarioNombre ?? "Global"}</span></div>
                      <div><span className="text-zinc-500">Moneda:</span> <span className="font-medium">{obj.moneda}</span></div>
                      {obj.notas && <div><span className="text-zinc-500">Notas:</span> <span className="font-medium">{obj.notas}</span></div>}
                    </div>
                  </Card>
                );
              })}
              {objetivos.length === 0 && (
                <Card className="text-center py-12">
                  <Target className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                  <p className="mt-3 text-sm text-zinc-500">No hay objetivos configurados</p>
                </Card>
              )}
            </div>
          </>
        )}
        {/* ── Retenciones tab ── */}
        {tab === "retenciones" && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-500" /> Retenciones practicadas</h3>
                <div className="flex items-center gap-2">
                  <input type="month" id="sicore-desde" defaultValue={new Date().toISOString().slice(0, 7)}
                    className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  <button onClick={() => {
                    const mes = (document.getElementById("sicore-desde") as HTMLInputElement)?.value;
                    if (!mes || !sociedadActiva?.id) return;
                    const desde = `${mes}-01`;
                    const y = Number(mes.split("-")[0]); const m = Number(mes.split("-")[1]);
                    const hasta = `${y}-${String(m).padStart(2, "0")}-${new Date(y, m, 0).getDate()}`;
                    window.open(`/api/sicore?desde=${desde}&hasta=${hasta}&sociedad_id=${sociedadActiva.id}`, "_blank");
                  }} className="flex items-center gap-1.5 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors">
                    <Download className="h-3 w-3" /> Exportar SICORE
                  </button>
                </div>
              </div>
              <DataTable
                data={retencionesTabla}
                columns={[
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-xs">{formatDate(row.fecha)}</span> },
                  { key: "numero", label: "OP / origen", sortable: true, render: (row) => <span className="font-mono text-xs font-medium">{row.numero}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => <span className="text-xs">{row.proveedor_nombre}</span> },
                  { key: "base_retencion_ganancias", label: "Base", sortable: true, render: (row) => <span className="font-mono text-xs">{formatCurrency((row as any).base_retencion_ganancias || 0, row.moneda as "ARS" | "USD")}</span> },
                  { key: "retencion_ganancias_pct", label: "%", sortable: true, render: (row) => <span className="text-xs">{(row as any).retencion_ganancias_pct}%</span> },
                  { key: "retencion_ganancias_monto", label: "Monto retenido", sortable: true, render: (row) => <span className="font-mono text-xs font-bold text-violet-600">{formatCurrency((row as any).retencion_ganancias_monto || 0, row.moneda as "ARS" | "USD")}</span> },
                ]}
              />
              {retencionesTabla.length === 0 && (
                <div className="text-center py-8">
                  <ShieldCheck className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                  <p className="mt-2 text-sm text-zinc-500">No hay retenciones practicadas</p>
                </div>
              )}
            </Card>
          </div>
        )}
        {/* ── Facturación (embedded) ── */}
        {tab === "facturacion" && (
          <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>}>
            <FacturacionEmbed embedded autoSelectId={typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("factura") || undefined : undefined} />
          </Suspense>
        )}
      </div>

      {/* Nuevo gasto fijo modal */}
      {gastoModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setGastoModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white">{editingGasto ? "Editar gasto fijo" : "Nuevo gasto fijo"}</h2>
              <button onClick={() => setGastoModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Descripcion *</label>
                <input value={gastoForm.descripcion} onChange={(e) => setGastoForm({ ...gastoForm, descripcion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Alquiler oficina" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Categoria</label>
                <select value={gastoForm.categoria} onChange={(e) => setGastoForm({ ...gastoForm, categoria: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {["Alquiler", "Sueldos", "Servicios", "Seguros", "Profesionales", "Logística", "Impuestos", "Marketing", "Otros"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Monto mensual *</label>
                  <input type="number" value={gastoForm.monto || ""} onChange={(e) => setGastoForm({ ...gastoForm, monto: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={gastoForm.moneda} onChange={(e) => setGastoForm({ ...gastoForm, moneda: e.target.value as "ARS" | "USD" })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <input value={gastoForm.notas} onChange={(e) => setGastoForm({ ...gastoForm, notas: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Notas opcionales..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setGastoModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleSaveGasto} disabled={gastoSaving || !gastoForm.descripcion.trim() || gastoForm.monto <= 0} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {gastoSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingGasto ? "Guardar cambios" : "Crear gasto"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Nuevo movimiento modal */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => { setModalOpen(false); setEditingMovId(null); }} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white">{editingMovId ? "Editar cobro" : "Nuevo movimiento"}</h2>
              <button onClick={() => { setModalOpen(false); setEditingMovId(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {formError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{formError}</div>}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Tipo</label>
                <select value={movForm.tipo} onChange={(e) => setMovForm({ ...movForm, tipo: e.target.value as typeof movForm.tipo })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {Object.entries(tipoConfig).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Descripcion *</label>
                <input value={movForm.descripcion} onChange={(e) => setMovForm({ ...movForm, descripcion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Monto *</label>
                  <input type="number" value={movForm.monto} onChange={(e) => setMovForm({ ...movForm, monto: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={movForm.moneda} onChange={(e) => setMovForm({ ...movForm, moneda: e.target.value as "ARS" | "USD" })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Fecha</label>
                <input type="date" value={movForm.fecha} onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              {/* Cliente selector */}
              <div className="relative">
                <label className="text-xs font-medium text-zinc-500">Cliente</label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input value={movClienteSearch}
                    onChange={(e) => { setMovClienteSearch(e.target.value); if (movForm.cliente_id) setMovForm({ ...movForm, cliente_id: "" }); }}
                    placeholder="Buscar cliente..."
                    className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                {movForm.cliente_id && (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success">{clientesOptions.find((c: ClienteOption) => c.id === movForm.cliente_id)?.razon_social}</Badge>
                    <button onClick={() => { setMovForm({ ...movForm, cliente_id: "" }); setMovClienteSearch(""); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                  </div>
                )}
                {!movForm.cliente_id && movClienteSearch.trim() && filteredMovClientes.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {filteredMovClientes.slice(0, 8).map((c: ClienteOption) => (
                      <button key={c.id} onClick={() => { setMovForm({ ...movForm, cliente_id: c.id, proveedor_id: "" }); setMovClienteSearch(c.razon_social); setMovProvSearch(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">{c.razon_social}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* Proveedor selector */}
              <div className="relative">
                <label className="text-xs font-medium text-zinc-500">Proveedor</label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                  <input value={movProvSearch}
                    onChange={(e) => { setMovProvSearch(e.target.value); if (movForm.proveedor_id) setMovForm({ ...movForm, proveedor_id: "" }); }}
                    placeholder="Buscar proveedor..."
                    className="w-full rounded-lg border border-zinc-200 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                {movForm.proveedor_id && (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success">{proveedoresOptions.find(p => p.id === movForm.proveedor_id)?.razon_social}</Badge>
                    <button onClick={() => { setMovForm({ ...movForm, proveedor_id: "" }); setMovProvSearch(""); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                  </div>
                )}
                {!movForm.proveedor_id && movProvSearch.trim() && filteredMovProvs.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {filteredMovProvs.slice(0, 8).map(p => (
                      <button key={p.id} onClick={() => { setMovForm({ ...movForm, proveedor_id: p.id, cliente_id: "" }); setMovProvSearch(p.razon_social); setMovClienteSearch(""); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">{p.razon_social}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => { setModalOpen(false); setEditingMovId(null); }} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateMov} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingMovId ? "Guardar cambios" : "Crear movimiento"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Nueva Orden de Pago modal */}
      {opModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">{pagoParcialDirecto ? "Registrar pago parcial" : "Nueva Orden de Pago"}</h2>
              </div>
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {opError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{opError}</div>}
            {opDatosError && <div role="alert" className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">{opDatosError}</div>}
            {pagoParcialDirecto && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">Este pago se registra como movimiento directo contra una sola factura y no crea una Orden de Pago. Si corresponde, la retención RG 830 se calcula sobre este pago y queda registrada junto al movimiento.</div>}
            <div className="space-y-4">
              {/* Proveedor + Fecha */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 relative">
                  <label className="text-xs font-medium text-zinc-500">Proveedor *</label>
                  <div className="relative mt-1">
                    <div className="flex items-center border border-zinc-200 rounded-lg dark:border-zinc-700 overflow-hidden">
                      <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                      <input value={proveedorSearch}
                        onChange={(e) => { setProveedorSearch(e.target.value); if (opForm.proveedor_id) setOpForm({ ...opForm, proveedor_id: "" }); }}
                        placeholder="Buscar proveedor..." className="w-full px-2 py-2 text-sm bg-transparent dark:text-white outline-none" />
                    </div>
                    {opForm.proveedor_id && (
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <Badge variant="success">{proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social}</Badge>
                        <button onClick={() => { setOpForm({ ...opForm, proveedor_id: "" }); setProveedorSearch(""); setOpProvCondicion(null); setOpManualGanancias(false); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                        {opCondicionLoading && <span className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" />AFIP…</span>}
                        {!opCondicionLoading && opProvCondicion !== null && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${opProvCondicion === "RI" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}>
                            {opProvCondicion === "RI" ? "Resp. Inscripto" : opProvCondicion || "Sin datos"}
                          </span>
                        )}
                      </div>
                    )}
                    {!opForm.proveedor_id && proveedorSearch.trim() && filteredProveedoresOP.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                        {filteredProveedoresOP.slice(0, 10).map(p => (
                          <button key={p.id} onClick={() => { setOpForm({ ...opForm, proveedor_id: p.id }); setProveedorSearch(p.razon_social); }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex justify-between gap-2">
                            <span>{p.razon_social}</span>
                            {p.cuit && <span className="text-xs text-zinc-400 font-mono">{p.cuit}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Fecha</label>
                  <input type="date" value={opForm.fecha} onChange={(e) => setOpForm({ ...opForm, fecha: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
              </div>

              {/* ── Documentos a pagar (FC) ── */}
              {opForm.proveedor_id && (
                <div>
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1 block">Documentos a pagar</label>
                  {opFCLoading ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-400 py-2"><Loader2 className="h-3 w-3 animate-spin" />Cargando facturas...</div>
                  ) : opFCPendientes.length === 0 ? (
                    <p className="text-xs text-zinc-400 py-1">Sin facturas pendientes</p>
                  ) : (
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                          <th className="w-8 p-2"></th>
                          <th className="text-left p-2">N° Factura</th>
                          <th className="text-left p-2">Fecha</th>
                          <th className="text-right p-2">Total</th>
                          <th className="text-right p-2">Saldo</th>
                          <th className="text-right p-2">A pagar</th>
                        </tr></thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {opFCPendientes.map(fc => (
                            <tr key={fc.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${fc.selected ? "bg-orange-50/50 dark:bg-orange-900/10" : ""}`}>
                              <td className="p-2 text-center">
                                <input type="checkbox" checked={fc.selected}
                                  disabled={pagoParcialDirecto && pagoParcialFCId !== fc.id}
                                  onChange={() => {
                                    setOpFCPendientes(prev => prev.map(f => (pagoParcialDirecto && f.id !== fc.id) ? { ...f, selected: false, monto_a_pagar: 0 } : f.id === fc.id ? { ...f, selected: !f.selected, monto_a_pagar: !f.selected ? f.saldo_pendiente : 0 } : f));
                                  }}
                                  className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                              </td>
                              <td className="p-2 font-mono text-xs dark:text-white">{fc.numero || "S/N"}</td>
                              <td className="p-2 text-xs text-zinc-500">{formatDate(fc.fecha)}</td>
                              <td className="p-2 text-right font-mono text-xs text-zinc-500">{formatCurrency(fc.total, fc.moneda as "ARS"|"USD")}</td>
                              <td className="p-2 text-right font-mono text-xs font-medium dark:text-white">{formatCurrency(fc.saldo_pendiente, fc.moneda as "ARS"|"USD")}</td>
                              <td className="p-2 text-right">
                                {fc.selected ? (
                                  <input type="number" value={fc.monto_a_pagar || ""}
                                    onChange={(e) => {
                                      const val = Math.min(Number(e.target.value), fc.saldo_pendiente);
                                      setOpFCPendientes(prev => prev.map(f => f.id === fc.id ? { ...f, monto_a_pagar: val } : f));
                                    }}
                                    className="w-28 text-right rounded border border-zinc-200 px-2 py-1 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                                ) : <span className="text-xs text-zinc-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {opMontoBruto > 0 && (
                    <div className="flex justify-between items-center mt-2 text-sm">
                      <span className="text-zinc-500">{opFCPendientes.filter(f => f.selected).length} documento(s) seleccionado(s)</span>
                      <span className="font-mono font-bold text-orange-600">{formatCurrency(opMontoBruto, opForm.moneda)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* ── Retención Ganancias ── */}
              {opMontoBruto > 0 && (
                <div>
                  <div className="rounded-lg border border-violet-200 dark:border-violet-800 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Ret. Ganancias</label>
                      <button type="button" onClick={() => { const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id); setOpManualGanancias(true); setOpMontoRetencionManual(null); setOpForm({ ...opForm, aplica_ganancias: !opForm.aplica_ganancias, retencion_ganancias_pct: !opForm.aplica_ganancias ? (prov?.alicuota_ganancias ?? retencionConfig.tasa_ganancias_ri) : 0 }); }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full ${opForm.aplica_ganancias ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${opForm.aplica_ganancias ? "translate-x-4.5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                    {/* Exclusion badge */}
                    {(() => { const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
                      const hoy = new Date().toISOString().slice(0, 10);
                      const excluido = prov?.exclusion_retencion && (!prov.exclusion_retencion_desde || prov.exclusion_retencion_desde <= hoy) && (!prov.exclusion_retencion_hasta || prov.exclusion_retencion_hasta >= hoy);
                      return excluido ? (
                        <div className="flex items-center gap-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-1">
                          <ShieldCheck className="h-3 w-3 text-emerald-500" />
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-300">Excluido de retención{prov.exclusion_retencion_hasta ? ` hasta ${prov.exclusion_retencion_hasta}` : ""}{prov.exclusion_retencion_cert ? ` — Cert: ${prov.exclusion_retencion_cert}` : ""}</span>
                        </div>
                      ) : null;
                    })()}
                    {/* Acumulado mensual */}
                    {opProvCondicion === "RI" && retencionConfig.aplica_ganancias && (
                      <div className="text-[10px] text-violet-600 dark:text-violet-400 space-y-0.5">
                        <div className="flex justify-between"><span>Acumulado mes (base sin IVA):</span><span className="font-mono">{formatCurrency(opMonthlyBase, opForm.moneda)}</span></div>
                        <div className="flex justify-between"><span>+ Esta OP:</span><span className="font-mono">{formatCurrency(opBaseSinIVA, opForm.moneda)}</span></div>
                        <div className="flex justify-between font-semibold"><span>Total acumulado:</span><span className="font-mono">{formatCurrency(opMonthlyBase + opBaseSinIVA, opForm.moneda)}</span></div>
                        <div className="flex justify-between"><span>Mínimo no imponible:</span><span className="font-mono">{formatCurrency(retencionConfig.minimo_ganancias, opForm.moneda)}</span></div>
                        {opMonthlyRetenido > 0 && <div className="flex justify-between"><span>Ya retenido en el mes:</span><span className="font-mono">{formatCurrency(opMonthlyRetenido, opForm.moneda)}</span></div>}
                      </div>
                    )}
                    {opForm.aplica_ganancias && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.5" value={opForm.retencion_ganancias_pct || ""} onChange={(e) => { setOpForm({ ...opForm, retencion_ganancias_pct: Number(e.target.value) }); setOpMontoRetencionManual(null); }}
                            className="w-20 rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          <span className="text-xs text-zinc-400">%</span>
                          {[0.25, 2, 3, 6, 28].map(pct => (
                            <button key={pct} type="button" onClick={() => { setOpForm({ ...opForm, retencion_ganancias_pct: pct }); setOpMontoRetencionManual(null); }}
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${opForm.retencion_ganancias_pct === pct ? "bg-violet-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{pct}%</button>
                          ))}
                        </div>
                        {/* Editable retention amount */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Monto retención:</span>
                          <input type="number" step="0.01"
                            value={opMontoRetencionManual !== null ? opMontoRetencionManual : (opRetencionGananciaBruta < retencionConfig.minimo_retencion_ganancias ? 0 : Math.round(opRetencionGananciaBruta * 100) / 100)}
                            onChange={(e) => setOpMontoRetencionManual(Number(e.target.value))}
                            className="w-32 rounded border border-zinc-200 px-2 py-1.5 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          {opMontoRetencionManual !== null && (
                            <button type="button" onClick={() => setOpMontoRetencionManual(null)} className="text-[10px] text-violet-500 hover:text-violet-700 underline">auto</button>
                          )}
                        </div>
                        {(() => { const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id); return prov?.concepto_retencion_ganancias ? (
                          <p className="text-[10px] text-violet-500">RG 830: {prov.concepto_retencion_ganancias.replace(/_/g, " ")} → {prov.alicuota_ganancias}% inscripto</p>
                        ) : null; })()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Monto manual override ── */}
              {opForm.proveedor_id && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Monto manual (sin facturas)</label>
                    <button type="button" onClick={() => setOpForm({ ...opForm, usar_monto_manual: !opForm.usar_monto_manual, monto_manual: 0 })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full ${opForm.usar_monto_manual ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${opForm.usar_monto_manual ? "translate-x-4.5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  {opForm.usar_monto_manual && (
                    <div className="space-y-2 mt-2">
                      <div className="flex items-center gap-2">
                        <input type="number" value={opForm.monto_manual || ""} onChange={(e) => setOpForm({ ...opForm, monto_manual: Number(e.target.value) })}
                          placeholder="Monto total a pagar" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <span className="text-xs text-zinc-400 whitespace-nowrap">{opForm.moneda}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-zinc-500 whitespace-nowrap">IVA incluido:</label>
                        {[21, 10.5, 0].map(pct => (
                          <button key={pct} type="button" onClick={() => setOpForm({ ...opForm, iva_manual_pct: pct })}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${opForm.iva_manual_pct === pct ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-zinc-400 mt-1">Activar para ingresar un monto libre sin vincular facturas</p>
                </div>
              )}

              {/* ── Resumen ── */}
              {opMontoBruto > 0 && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1">
                  <div className="flex justify-between text-sm"><span className="text-zinc-500">{opForm.usar_monto_manual ? "Monto" : "Documentos"}</span><span className="font-mono">{formatCurrency(opMontoBruto, opForm.moneda)}</span></div>
                  {opBaseSinIVA > 0 && opBaseSinIVA !== opMontoBruto && (
                    <div className="flex justify-between text-sm text-zinc-400">
                      <span>Base sin IVA (Art. 23 RG 830)</span>
                      <span className="font-mono">{formatCurrency(opBaseSinIVA, opForm.moneda)}</span>
                    </div>
                  )}
                  {opRetencionGanancias > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-violet-500" />
                        Ret. Ganancias ({opForm.retencion_ganancias_pct}% s/ {formatCurrency(opBaseGanancias, opForm.moneda)})
                      </span>
                      <span className="font-mono text-violet-600">- {formatCurrency(opRetencionGanancias, opForm.moneda)}</span>
                    </div>
                  )}
                  {opRetencionGananciaBruta > 0 && opRetencionGanancias === 0 && (
                    <div className="flex justify-between text-xs text-amber-500">
                      <span>Ret. Ganancias no aplicada (menor a {formatCurrency(retencionConfig.minimo_retencion_ganancias, opForm.moneda)} — Art. 29 RG 830)</span>
                      <span className="font-mono">{formatCurrency(opRetencionGananciaBruta, opForm.moneda)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1.5">
                    <span className="text-zinc-700 dark:text-white">Neto a pagar</span>
                    <span className="font-mono text-emerald-600 text-base">{formatCurrency(opNetoAPagar, opForm.moneda)}</span>
                  </div>
                </div>
              )}

              {/* ── Datos bancarios del proveedor ── */}
              {opForm.proveedor_id && (() => {
                const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
                if (!prov || (!prov.cbu && !prov.alias_bancario && !prov.banco && !prov.numero_cuenta)) return null;
                return (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1 mb-2"><Landmark className="h-3.5 w-3.5" />Datos bancarios</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {prov.banco && <div><span className="text-zinc-500">Banco</span><p className="font-medium">{prov.banco}</p></div>}
                      {prov.tipo_cuenta && <div><span className="text-zinc-500">Tipo cuenta</span><p className="font-medium">{prov.tipo_cuenta}</p></div>}
                      {prov.cbu && <div className="col-span-2"><span className="text-zinc-500">CBU / CVU</span><p className="font-mono font-medium select-all">{prov.cbu}</p></div>}
                      {prov.alias_bancario && <div><span className="text-zinc-500">Alias</span><p className="font-mono font-medium select-all">{prov.alias_bancario}</p></div>}
                      {prov.numero_cuenta && <div><span className="text-zinc-500">N° cuenta</span><p className="font-mono font-medium">{prov.numero_cuenta}</p></div>}
                      {prov.titular_cuenta && <div className="col-span-2"><span className="text-zinc-500">Titular</span><p className="font-medium">{prov.titular_cuenta}</p></div>}
                    </div>
                  </div>
                );
              })()}

              {/* ── Medios de pago (múltiples) ── */}
              {opMontoBruto > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Medios de pago</label>
                    <button type="button" onClick={() => setOpMedios([...opMedios, makeOpMedio(opForm.moneda)])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"><Plus className="h-3 w-3" />Agregar medio</button>
                  </div>
                  <div className="space-y-2">
                    {opMedios.map((m, idx) => (
                      <div key={m.tempId} className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                        <select value={m.tipo} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, tipo: e.target.value as OpMedioPago["tipo"], echeq_id: undefined } : x))}
                          className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="transferencia">Transferencia</option>
                          <option value="deposito">Depósito</option>
                          <option value="cheque">Cheque tercero</option>
                          <option value="cheque_propio">Cheque propio</option>
                          <option value="echeq">E-Cheq</option>
                          <option value="efectivo">Efectivo</option>
                          <option value="tarjeta">Tarjeta</option>
                        </select>
                        <div className="relative w-28">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-mono">$</span>
                          <input type="number" value={m.monto || ""} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, monto: Number(e.target.value) } : x))}
                            placeholder="Monto" className="w-full rounded border border-zinc-200 pl-5 pr-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        </div>
                        <input type="date" value={m.fecha} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, fecha: e.target.value } : x))}
                          className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        {(m.tipo !== "efectivo" && m.tipo !== "tarjeta") && (
                          <>
                            <select value={m.banco === "Otro" || (m.banco && !BANCOS_ARGENTINA.includes(m.banco)) ? "Otro" : m.banco} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, banco: e.target.value, banco_otro: e.target.value === "Otro" ? (x.banco === "Otro" ? x.banco_otro : x.banco) : undefined } : x))}
                              className="w-32 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                              <option value="">Banco…</option>
                              {BANCOS_ARGENTINA.filter((b, i, a) => a.indexOf(b) === i).map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            {(m.banco === "Otro" || (m.banco && !BANCOS_ARGENTINA.includes(m.banco))) && <input value={m.banco === "Otro" ? (m.banco_otro || "") : m.banco} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, banco: "Otro", banco_otro: e.target.value } : x))}
                              placeholder="Nombre del banco" className="w-28 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />}
                            <input value={m.numero_cheque} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, numero_cheque: e.target.value } : x))}
                              placeholder="N° cheque" className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </>
                        )}
                        {/* Picker de cheques: echeq y cheque tercero eligen de recibidos en_cartera; cheque_propio de emitidos pendiente */}
                        {(m.tipo === "echeq" || m.tipo === "cheque" || m.tipo === "cheque_propio") && (() => {
                          const available = m.tipo === "cheque_propio"
                            ? echeqs.filter(e => e.direccion === "emitido" && e.estado === "pendiente" && e.moneda === m.moneda)
                            : echeqs.filter(e => (e.direccion === "recibido" || !e.direccion) && e.estado === "en_cartera" && e.moneda === m.moneda);
                          return available.length > 0 ? (
                            <select value={m.echeq_id || ""} onChange={(e) => {
                              const sel = available.find(x => x.id === e.target.value);
                              setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, echeq_id: e.target.value || undefined, monto: sel ? sel.monto : x.monto, banco: sel?.banco_emisor || x.banco, numero_cheque: sel?.numero || x.numero_cheque } : x));
                            }} className="max-w-[180px] rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                              <option value="">{m.tipo === "cheque_propio" ? "Nuevo cheque" : "Manual"}</option>
                              {available.map(e => <option key={e.id} value={e.id}>{e.numero} — {formatCurrency(e.monto, (e.moneda as "ARS" | "USD") || "ARS")}{e.banco_emisor ? ` (${e.banco_emisor})` : ""}</option>)}
                            </select>
                          ) : m.tipo === "cheque_propio" ? (
                            <span className="text-[10px] text-zinc-400 self-center">Se creará al confirmar</span>
                          ) : null;
                        })()}
                        {opMedios.length > 1 && (
                          <button type="button" onClick={() => setOpMedios(prev => prev.filter((_, i) => i !== idx))} className="text-zinc-400 hover:text-red-500 mt-0.5"><Trash2 className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-2 text-sm">
                    <span className="text-zinc-500">Total medios</span>
                    <span className={`font-mono font-bold ${Math.abs(opNetoAPagar - opMedios.reduce((s, m) => s + m.monto, 0)) < 1 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(opMedios.reduce((s, m) => s + m.monto, 0), opForm.moneda)}
                    </span>
                  </div>
                  {Math.abs(opNetoAPagar - opMedios.reduce((s, m) => s + m.monto, 0)) >= 1 && opMedios.reduce((s, m) => s + m.monto, 0) > 0 && (
                    <p className="text-xs text-red-500 mt-1">Diferencia: {formatCurrency(opNetoAPagar - opMedios.reduce((s, m) => s + m.monto, 0), opForm.moneda)}</p>
                  )}
                  {opMedios.length === 1 && opMedios[0].monto === 0 && opNetoAPagar > 0 && (
                    <button type="button" onClick={() => setOpMedios([{ ...opMedios[0], monto: Math.round(opNetoAPagar * 100) / 100 }])}
                      className="text-xs text-orange-500 hover:text-orange-600 mt-1 font-medium">Completar con neto a pagar</button>
                  )}
                </div>
              )}

              {/* Notas + Comprobante */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Notas</label>
                  <textarea value={opForm.notas} onChange={(e) => setOpForm({ ...opForm, notas: e.target.value })}
                    rows={2} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Observaciones..." />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Comprobantes — <span className="text-orange-500">IA autocompleta medios</span></label>
                  <div className="mt-1 space-y-1">
                    <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed px-3 py-2 text-sm hover:border-orange-400 ${opParsingFile ? "border-orange-300 bg-orange-50/50 text-orange-600" : "border-zinc-300 text-zinc-500 dark:border-zinc-600"}`}>
                      {opParsingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-500" />}
                      {opParsingFile ? "Procesando con IA..." : opFiles.length > 0 ? `+ Agregar otro archivo` : "Adjuntar comprobante"}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden" disabled={opParsingFile} onChange={(e) => {
                        const files = e.target.files;
                        if (files) { for (const f of Array.from(files)) handleParseComprobante(f); }
                        e.target.value = "";
                      }} />
                    </label>
                    {opFiles.length > 0 && !opParsingFile && (
                      <div className="space-y-1">
                        {opFiles.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                            <Paperclip className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate flex-1">{f.name}</span>
                            <button onClick={() => setOpFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={pagoParcialDirecto ? handleRegistrarPagoParcialDirecto : handleCreateOP} disabled={opSaving || !opForm.proveedor_id || (opMontoBruto <= 0)}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {opSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {pagoParcialDirecto ? "Registrar pago parcial" : "Crear Orden de Pago"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Nueva factura de compra modal */}
      {fcModalOpen && (
        <CargarFacturaOC
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          showTipoToggle
          ordenes={ocOptions.filter(o => o.proveedor_id && !["borrador", "cancelada"].includes(o.estado || "")).map(o => ({
            id: o.id,
            numero: o.numero,
            proveedor_id: o.proveedor_id,
            proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor",
            total: o.total,
            moneda: o.moneda,
            estado: o.estado || "",
            fecha: o.fecha || "",
          }))}
          onClose={() => setFcModalOpen(false)}
          onSuccess={() => { setFcModalOpen(false); fetchData(); }}
        />
      )}

      {fcMassModalOpen && (
        <CargaMasivaFacturasCompra
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          proveedores={proveedoresOptions.map(p => ({ id: p.id, razon_social: p.razon_social, cuit: p.cuit }))}
          ordenes={ocOptions.filter(o => o.proveedor_id && !["cancelada"].includes(o.estado || "")).map(o => ({ id: o.id, numero: o.numero, proveedor_id: o.proveedor_id, proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor", moneda: o.moneda }))}
          onClose={() => setFcMassModalOpen(false)}
          onSuccess={() => { setFcMassModalOpen(false); fetchData(); }}
        />
      )}

      {/* ── FC Detail Panel ── */}
      {selectedFC && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => { setSelectedFC(null); setEditingFC(false); }} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-zinc-900 p-6 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">FC Compra</h2>
                {!editingFC && <span className="font-mono text-sm text-zinc-500">{selectedFC.numero_factura}</span>}
                <Badge variant={selectedFC.estado === "pagada" ? "success" : selectedFC.estado === "anulada" ? "danger" : selectedFC.estado === "recibida" ? "info" : "warning"}>
                  {selectedFC.estado === "pagada" ? "Pagada" : selectedFC.estado === "anulada" ? "Anulada" : selectedFC.estado === "recibida" ? "Recibida" : "Pendiente"}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                {!editingFC && ["pendiente", "borrador"].includes(selectedFC.estado) && (
                  <button onClick={() => startEditFC(selectedFC)} className="rounded-lg p-2 text-zinc-400 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900/20" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => { setSelectedFC(null); setEditingFC(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {editingFC ? (
                <>
                  {/* Edit mode */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-zinc-500">N.° Factura</label>
                      <input value={editFCForm.numero_factura} onChange={e => setEditFCForm({ ...editFCForm, numero_factura: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Fecha</label>
                        <input type="date" value={editFCForm.fecha} onChange={e => setEditFCForm({ ...editFCForm, fecha: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Vencimiento</label>
                        <input type="date" value={editFCForm.fecha_vencimiento} onChange={e => setEditFCForm({ ...editFCForm, fecha_vencimiento: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Subtotal</label>
                        <input type="number" step="0.01" value={editFCForm.subtotal} onChange={e => setEditFCForm({ ...editFCForm, subtotal: Number(e.target.value) })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-500">IVA</label>
                        <input type="number" step="0.01" value={editFCForm.iva} onChange={e => setEditFCForm({ ...editFCForm, iva: Number(e.target.value) })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Percepciones</label>
                        <input type="number" step="0.01" value={editFCForm.percepciones} onChange={e => setEditFCForm({ ...editFCForm, percepciones: Number(e.target.value) })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Moneda</label>
                        <select value={editFCForm.moneda} onChange={e => setEditFCForm({ ...editFCForm, moneda: e.target.value as "ARS" | "USD" })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                          <option value="ARS">ARS</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Total calculado</label>
                      <p className="mt-1 font-mono text-sm font-bold text-red-600">{formatCurrency(Number(editFCForm.subtotal) + Number(editFCForm.iva) + Number(editFCForm.percepciones), editFCForm.moneda)}</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500">CAE</label>
                      <input value={editFCForm.cae} onChange={e => setEditFCForm({ ...editFCForm, cae: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" placeholder="Número de CAE" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Notas</label>
                      <textarea value={editFCForm.notas} onChange={e => setEditFCForm({ ...editFCForm, notas: e.target.value })} rows={3}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <button onClick={handleSaveFC} disabled={savingFC}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors">
                      {savingFC ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Guardar
                    </button>
                    <button onClick={() => setEditingFC(false)}
                      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
              {/* Info general */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Proveedor</p>
                  <p className="font-semibold dark:text-white">{selectedFC.proveedor_nombre}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Fecha</p>
                  <p className="font-medium dark:text-white">{formatDate(selectedFC.fecha)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Vencimiento</p>
                  <p className="font-medium dark:text-white">{selectedFC.fecha_vencimiento ? formatDate(selectedFC.fecha_vencimiento) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500">Tipo</p>
                  {selectedFC.tipo === "solo_iva" ? <Badge variant="purple">Solo IVA</Badge> : selectedFC.tipo === "transporte" ? <Badge variant="success">Transporte</Badge> : <Badge variant="info">Mercadería</Badge>}
                </div>
                {(selectedFC.oc_numero || (selectedFC.ocs_vinculadas && selectedFC.ocs_vinculadas.length > 0)) && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500">OC vinculada{selectedFC.ocs_vinculadas && selectedFC.ocs_vinculadas.length > 1 ? "s" : ""}</p>
                    <p className="font-mono text-sm dark:text-white">
                      {selectedFC.oc_numero || (selectedFC.ocs_vinculadas || []).map(o => o.numero).join(", ")}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-zinc-500">Moneda</p>
                  <p className="font-medium dark:text-white">{selectedFC.moneda}</p>
                </div>
              </div>

              {/* Desglose de importes */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Desglose de importes</p>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="font-mono dark:text-white">{formatCurrency(selectedFC.subtotal, selectedFC.moneda)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">IVA ({selectedFC.iva_porcentaje}%)</span>
                    <span className="font-mono dark:text-white">{formatCurrency(selectedFC.iva, selectedFC.moneda)}</span>
                  </div>
                  {selectedFC.percepciones > 0 && (
                    <>
                      {selectedFC.percepciones_detalle && selectedFC.percepciones_detalle.length > 0 ? (
                        selectedFC.percepciones_detalle.map((p, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-500">
                              {p.tipo === "iibb" ? `Perc. IIBB${p.localidad ? ` (${p.localidad})` : ""}` :
                               p.tipo === "ganancias" ? "Perc. Ganancias" :
                               p.tipo === "iva" ? "Perc. IVA" :
                               p.tipo === "municipal" ? "Perc. Municipal" : `Perc. ${p.tipo}`}
                            </span>
                            <span className="font-mono dark:text-white">{formatCurrency(p.monto, selectedFC.moneda)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-zinc-500">Percepciones</span>
                          <span className="font-mono dark:text-white">{formatCurrency(selectedFC.percepciones, selectedFC.moneda)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {selectedFC.tipo === "solo_iva" && (selectedFC.costo_real ?? 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Costo real</span>
                      <span className="font-mono text-blue-600">{formatCurrency(selectedFC.costo_real!, selectedFC.moneda)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm border-t border-zinc-200 dark:border-zinc-700 pt-2">
                    <span className="font-semibold text-zinc-700 dark:text-white">Total</span>
                    <span className="font-mono font-bold text-red-600">{formatCurrency(selectedFC.total, selectedFC.moneda)}</span>
                  </div>
                </div>
              </div>

              {/* Items */}
              {selectedFCItems.length > 0 && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Items ({selectedFCItems.length})</p>
                  </div>
                  <div className="divide-y divide-zinc-100 dark:divide-zinc-700">
                    {selectedFCItems.map((it, idx) => (
                      <div key={idx} className="px-4 py-2 text-sm flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium dark:text-white truncate">{it.descripcion}</p>
                          <p className="text-xs text-zinc-400">{it.cantidad} {it.unidad} x {formatCurrency(it.precio_unitario, selectedFC.moneda)}{Number(it.descuento_porcentaje || 0) > 0 ? ` — Desc. ${Number(it.descuento_porcentaje).toLocaleString("es-AR")}%` : ""} — IVA {it.iva_porcentaje ?? 21}%</p>
                        </div>
                        <span className="font-mono text-sm ml-2 dark:text-white">{formatCurrency(fcItemNeto(it), selectedFC.moneda)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OP vinculada */}
              {selectedFC.op_vinculada && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Orden de pago vinculada</p>
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-medium dark:text-white">{selectedFC.op_vinculada.numero}</span>
                      <span className="ml-2">
                        <Badge variant={selectedFC.op_vinculada.estado === "pagada" ? "success" : selectedFC.op_vinculada.estado === "anulada" ? "danger" : "warning"}>
                          {selectedFC.op_vinculada.estado === "pagada" ? "Pagada" : selectedFC.op_vinculada.estado === "anulada" ? "Anulada" : "Pendiente"}
                        </Badge>
                      </span>
                    </div>
                    <button onClick={() => { const op = ordenesPago.find(o => o.id === selectedFC.op_vinculada!.id); if (op) { setSelectedFC(null); setSelectedOP(op); } else { alert("No se encontró la OP. Intente recargar la página."); } }}
                      className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600" title="Ver OP">
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* CAE */}
              {selectedFC.cae && (
                <div>
                  <p className="text-xs font-medium text-zinc-500">CAE</p>
                  <p className="text-sm font-mono text-zinc-600 dark:text-zinc-400 mt-1">{selectedFC.cae}</p>
                </div>
              )}

              {/* Notas */}
              {selectedFC.notas && (
                <div>
                  <p className="text-xs font-medium text-zinc-500">Notas</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{selectedFC.notas}</p>
                </div>
              )}

              {/* Archivo adjunto */}
              {selectedFC.archivo_url && (
                <a href={selectedFC.archivo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-orange-500 hover:text-orange-600">
                  <Paperclip className="h-4 w-4" /> {selectedFC.archivo_nombre || "Ver archivo adjunto"}
                </a>
              )}

              {/* Acciones */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                {(selectedFC.estado === "pendiente" || selectedFC.estado === "recibida") && !selectedFC.op_vinculada && (
                  <button onClick={() => handlePagarFC(selectedFC.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                    <DollarSign className="h-4 w-4" /> Crear OP
                  </button>
                )}
                {selectedFC.estado === "pendiente_aprobacion" && (
                  <button onClick={async () => {
                    let approveFC = (supabase as any).from("facturas_compra").update({ estado: "pendiente" }).eq("id", selectedFC.id);
                    if (sociedadActiva?.id) approveFC = approveFC.eq("sociedad_id", sociedadActiva.id);
                    const { error } = await approveFC;
                    if (error) { alert("Error al aprobar: " + error.message); return; }
                    setSelectedFC({ ...selectedFC, estado: "pendiente" });
                    setFacturasCompra(prev => prev.map(f => f.id === selectedFC.id ? { ...f, estado: "pendiente" } : f));
                  }}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                    <CheckCircle2 className="h-4 w-4" /> Aprobar
                  </button>
                )}
                {selectedFC.estado === "pendiente" && (
                  <button onClick={() => { handleRecibirFC(selectedFC.id); setSelectedFC(null); }}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                    <Package className="h-4 w-4" /> Recibir
                  </button>
                )}
                {(selectedFC.estado === "pendiente" || selectedFC.estado === "recibida" || selectedFC.estado === "pendiente_aprobacion") && (
                  <button onClick={() => { handleAnularFC(selectedFC.id); setSelectedFC(null); }}
                    className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Ban className="h-4 w-4" /> Anular
                  </button>
                )}
              </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── OP Detail Panel ── */}
      {selectedOP && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => { setSelectedOP(null); setEditingOP(false); }} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-zinc-900 p-6 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">Orden de Pago</h2>
                {selectedOP.numero && <span className="font-mono text-sm text-zinc-500">{selectedOP.numero}</span>}
                <Badge variant={selectedOP.estado === "pagada" ? "success" : selectedOP.estado === "anulada" ? "danger" : "warning"}>
                  {selectedOP.estado === "pagada" ? "Pagada" : selectedOP.estado === "anulada" ? "Anulada" : "Pendiente"}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                {!editingOP && selectedOP.estado !== "anulada" && (
                  <button onClick={() => startEditOP(selectedOP)} className="rounded-lg p-2 text-zinc-400 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-900/20" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => { setSelectedOP(null); setEditingOP(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {editingOP ? (
                <>
                  {/* Edit mode */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Proveedor</label>
                      <p className="mt-1 font-semibold text-sm dark:text-white">{selectedOP.proveedor_nombre}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Fecha</label>
                        <input type="date" value={editOPForm.fecha} onChange={e => setEditOPForm({ ...editOPForm, fecha: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-zinc-500">Moneda</label>
                        <select value={editOPForm.moneda} onChange={e => setEditOPForm({ ...editOPForm, moneda: e.target.value as "ARS" | "USD" })}
                          className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                          <option value="ARS">ARS</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-zinc-500">Notas</label>
                      <textarea value={editOPForm.notas} onChange={e => setEditOPForm({ ...editOPForm, notas: e.target.value })} rows={3}
                        className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <button onClick={handleSaveOP} disabled={savingOP}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors">
                      {savingOP ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Guardar
                    </button>
                    <button onClick={() => setEditingOP(false)}
                      className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
              <>
              {/* Info general */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Proveedor</p>
                    <p className="font-semibold dark:text-white">{selectedOP.proveedor_nombre}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Fecha</p>
                    <p className="font-medium dark:text-white">{formatDate(selectedOP.fecha)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Medios de pago</p>
                    {selectedOP.medios_pago && selectedOP.medios_pago.length > 0 ? (
                      <div className="space-y-1 mt-1">
                        {selectedOP.medios_pago.map((m, i) => {
                          const ml = m.tipo === "transferencia" ? "Transf." : m.tipo === "cheque" ? "Cheque" : m.tipo === "cheque_propio" ? "Ch. propio" : m.tipo === "echeq" ? "E-Cheq" : m.tipo === "deposito" ? "Depósito" : m.tipo === "tarjeta" ? "Tarjeta" : "Efectivo";
                          return <div key={i} className="flex items-center gap-2 text-sm dark:text-white">
                            <span>{ml}{m.banco ? ` — ${m.banco}` : ""} <span className="font-mono text-xs">{formatCurrency(m.monto, m.moneda || selectedOP.moneda)}</span></span>
                            {m.comprobante_url && <a href={m.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600" title={m.comprobante_nombre || "Ver comprobante de este medio"}><Paperclip className="h-3.5 w-3.5" /></a>}
                          </div>;
                        })}
                      </div>
                    ) : (
                      <p className="font-medium dark:text-white">{selectedOP.medio_pago === "transferencia" ? "Transferencia" : selectedOP.medio_pago === "cheque" ? "Cheque tercero" : selectedOP.medio_pago === "cheque_propio" ? "Cheque propio" : selectedOP.medio_pago === "echeq" ? "E-Cheq" : selectedOP.medio_pago === "deposito" ? "Depósito" : selectedOP.medio_pago === "tarjeta" ? "Tarjeta" : "Efectivo"}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Moneda</p>
                    <p className="font-medium dark:text-white">{selectedOP.moneda}</p>
                  </div>
                </div>
                {selectedOP.notas && (
                  <div>
                    <p className="text-xs font-medium text-zinc-500">Notas</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedOP.notas}</p>
                  </div>
                )}
              </div>

              {/* Desglose de importes */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Desglose de importes</p>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Monto bruto</span>
                    <span className="font-mono font-semibold dark:text-white">{formatCurrency(selectedOP.monto_bruto, selectedOP.moneda)}</span>
                  </div>
                  {selectedOP.retencion_ganancias_monto > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-violet-500" />
                        Ret. Ganancias ({selectedOP.retencion_ganancias_pct}%)
                      </span>
                      <span className="font-mono text-violet-600">- {formatCurrency(selectedOP.retencion_ganancias_monto, selectedOP.moneda)}</span>
                    </div>
                  )}
                  {selectedOP.retencion_ganancias_monto > 0 && (
                    <div className="flex items-center justify-between text-sm border-t border-zinc-100 dark:border-zinc-700 pt-2">
                      <span className="text-zinc-500">Total retenciones</span>
                      <span className="font-mono text-amber-600 font-medium">- {formatCurrency(selectedOP.retencion_ganancias_monto, selectedOP.moneda)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-base font-bold border-t border-zinc-200 dark:border-zinc-700 pt-2">
                    <span className="text-zinc-700 dark:text-white">Neto a pagar</span>
                    <span className="font-mono text-emerald-600">{formatCurrency(selectedOP.neto, selectedOP.moneda)}</span>
                  </div>
                </div>
              </div>

              {/* Comprobante de pago */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Comprobante de pago</p>
                </div>
                <div className="p-4 space-y-2">
                  <button
                    onClick={() => handleGenerarComprobante(selectedOP)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Printer className="h-4 w-4" />
                    Generar comprobante
                  </button>
                  {/* Archivos adjuntos */}
                  {(() => {
                    const allFiles = selectedOP.archivos && selectedOP.archivos.length > 0
                      ? selectedOP.archivos
                      : selectedOP.archivo_url
                        ? [{ url: selectedOP.archivo_url, nombre: selectedOP.archivo_nombre || "Archivo adjunto" }]
                        : [];
                    if (allFiles.length === 0) return null;
                    return (
                      <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-700">
                        <p className="text-[10px] uppercase text-zinc-400 font-medium">Archivos adjuntos</p>
                        {allFiles.map((af, i) => (
                          <a key={i} href={af.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-orange-500 hover:text-orange-600">
                            <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">{af.nombre}</span>
                          </a>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Certificado de retención */}
              {selectedOP.retencion_ganancias_monto > 0 && (
                <div className="rounded-lg border border-violet-200 dark:border-violet-800 overflow-hidden">
                  <div className="bg-violet-50 dark:bg-violet-950/30 px-4 py-2">
                    <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Certificado de retención
                    </p>
                  </div>
                  <div className="p-4 space-y-3">
                    {selectedOP.certificado_retencion_url ? (
                      <div className="flex items-center gap-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 p-3 border border-violet-100 dark:border-violet-800">
                        <Paperclip className="h-4 w-4 text-violet-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-violet-700 dark:text-violet-300 truncate">Certificado adjunto</p>
                          <p className="text-xs text-violet-500 truncate">{selectedOP.certificado_retencion_url.split("/").pop()}</p>
                        </div>
                        <a
                          href={selectedOP.certificado_retencion_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg bg-violet-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 transition-colors flex-shrink-0"
                        >
                          <Download className="h-3 w-3" />
                          Descargar
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-400">No se adjuntó certificado de retención</p>
                    )}
                    <label className="block">
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadCertificado(selectedOP.id, file);
                        }}
                      />
                      <span className={`w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-violet-300 dark:border-violet-700 px-4 py-2.5 text-sm font-medium cursor-pointer transition-colors ${uploadingCert ? "text-zinc-400" : "text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20"}`}>
                        {uploadingCert ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo...</>
                        ) : (
                          <><Upload className="h-4 w-4" /> {selectedOP.certificado_retencion_url ? "Reemplazar certificado" : "Adjuntar certificado"}</>
                        )}
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Acciones */}
              <div className="flex gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                {selectedOP.estado === "pendiente" && (
                    <button
                      onClick={() => { handlePagarOP(selectedOP.id); setSelectedOP(null); }}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar pagada
                    </button>
                )}
                <button
                  onClick={() => openOrdenPagoEmail(selectedOP)}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${selectedOP.email_enviado_at ? "border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-950/20" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"}`}
                  title={selectedOP.email_enviado_at ? `Enviada por email el ${formatDateTime(selectedOP.email_enviado_at)}${selectedOP.proveedor_email ? ` a ${selectedOP.proveedor_email}` : ""}` : `Enviar por email${selectedOP.proveedor_email ? ` (${selectedOP.proveedor_email})` : ""}`}
                >
                  {selectedOP.email_enviado_at ? <MailCheck className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  {selectedOP.email_enviado_at ? "Enviada" : "Enviar"}
                </button>
                {selectedOP.estado !== "anulada" && (
                    <button
                      onClick={() => { handleAnularOP(selectedOP.id); setSelectedOP(null); }}
                      className="flex items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <Ban className="h-4 w-4" /> Anular
                    </button>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Nuevo gasto manual modal */}
      {gmModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setGmModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">{gmEditingId ? "Editar gasto" : "Nuevo gasto manual"}</h2>
              </div>
              <button onClick={() => setGmModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {gmError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{gmError}</div>}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-500">Descripción *</label>
                <input value={gmForm.descripcion} onChange={(e) => setGmForm({ ...gmForm, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Flete a Campana" />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500">Fecha</label>
                <input type="date" value={gmForm.fecha} onChange={(e) => setGmForm({ ...gmForm, fecha: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>

              {/* Proveedor opcional con search */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Proveedor (opcional)</label>
                <div className="relative mt-1">
                  <div className="flex items-center border border-zinc-200 rounded-lg dark:border-zinc-700 overflow-hidden">
                    <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                    <input
                      value={gmProvSearch}
                      onChange={(e) => { setGmProvSearch(e.target.value); if (gmForm.proveedor_id) setGmForm({ ...gmForm, proveedor_id: "" }); }}
                      placeholder="Buscar proveedor..."
                      className="w-full px-2 py-2 text-sm bg-transparent dark:text-white outline-none"
                    />
                  </div>
                  {gmForm.proveedor_id && (
                    <div className="mt-1 flex items-center gap-1">
                      <Badge variant="success">{proveedoresOptions.find(p => p.id === gmForm.proveedor_id)?.razon_social}</Badge>
                      <button onClick={() => { setGmForm({ ...gmForm, proveedor_id: "" }); setGmProvSearch(""); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                  {!gmForm.proveedor_id && gmProvSearch.trim() && filteredProveedoresGM.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {filteredProveedoresGM.slice(0, 8).map(p => (
                        <button key={p.id} onClick={() => { setGmForm({ ...gmForm, proveedor_id: p.id }); setGmProvSearch(p.razon_social); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">
                          {p.razon_social}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-500">Categoría</label>
                    <button type="button" onClick={() => setShowCategoriaManager(!showCategoriaManager)} className="text-[10px] text-orange-500 hover:text-orange-600 font-medium">
                      {showCategoriaManager ? "Cerrar" : "Gestionar"}
                    </button>
                  </div>
                  <select value={gmForm.categoria} onChange={(e) => setGmForm({ ...gmForm, categoria: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    {gastoCategorias.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {showCategoriaManager && (
                    <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 space-y-2">
                      <div className="flex items-center gap-1">
                        <input value={newCategoriaInput} onChange={(e) => setNewCategoriaInput(e.target.value)}
                          placeholder="Nueva categoría" className="flex-1 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newCategoriaInput.trim()) {
                              const updated = [...gastoCategorias, newCategoriaInput.trim()];
                              setGastoCategorias(updated);
                              setNewCategoriaInput("");
                              // Save to configuracion
                              (supabase as any).from("configuracion").upsert({ key: "gasto_categorias", value: JSON.stringify(updated), sociedad_id: sociedadActiva?.id }, { onConflict: "sociedad_id,key" }).then(({ error: upsErr }: any) => { if (upsErr) console.error("Error guardando categorías:", upsErr); });
                            }
                          }} />
                        <button type="button" onClick={() => {
                          if (!newCategoriaInput.trim()) return;
                          const updated = [...gastoCategorias, newCategoriaInput.trim()];
                          setGastoCategorias(updated);
                          setNewCategoriaInput("");
                          (supabase as any).from("configuracion").upsert({ key: "gasto_categorias", value: JSON.stringify(updated), sociedad_id: sociedadActiva?.id }, { onConflict: "sociedad_id,key" }).then(({ error: upsErr }: any) => { if (upsErr) console.error("Error guardando categorías:", upsErr); });
                        }} className="rounded bg-orange-500 px-2 py-1 text-xs text-white hover:bg-orange-600"><Plus className="h-3 w-3" /></button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {gastoCategorias.map(c => (
                          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                            {c}
                            <button type="button" onClick={() => {
                              const updated = gastoCategorias.filter(x => x !== c);
                              if (updated.length === 0) return;
                              setGastoCategorias(updated);
                              if (gmForm.categoria === c) setGmForm({ ...gmForm, categoria: updated[0] });
                              (supabase as any).from("configuracion").upsert({ key: "gasto_categorias", value: JSON.stringify(updated), sociedad_id: sociedadActiva?.id }, { onConflict: "sociedad_id,key" }).then(({ error: upsErr }: any) => { if (upsErr) console.error("Error guardando categorías:", upsErr); });
                            }} className="text-zinc-400 hover:text-red-500"><X className="h-2.5 w-2.5" /></button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Tipo de gasto</label>
                  <select value={gmForm.tipo_gasto} onChange={(e) => setGmForm({ ...gmForm, tipo_gasto: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    {TIPO_GASTO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Fijo / Eventual */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Recurrencia</label>
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setGmForm({ ...gmForm, tipo_recurrencia: "eventual" })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${gmForm.tipo_recurrencia === "eventual" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                    Eventual
                  </button>
                  <button type="button" onClick={() => setGmForm({ ...gmForm, tipo_recurrencia: "fijo" })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${gmForm.tipo_recurrencia === "fijo" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                    Fijo (mensual)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500">Medio de pago</label>
                <select value={gmForm.medio_pago} onChange={(e) => setGmForm({ ...gmForm, medio_pago: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="debito_automatico">Debito automatico</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500">Comprobante (opcional)</label>
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Upload className="h-4 w-4" />
                    {gmFile ? gmFile.name : "Subir archivo"}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => setGmFile(e.target.files?.[0] ?? null)} />
                  </label>
                  {gmFile && (
                    <button onClick={() => setGmFile(null)} className="text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Monto *</label>
                  <input type="number" value={gmForm.monto || ""} onChange={(e) => setGmForm({ ...gmForm, monto: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={gmForm.moneda} onChange={(e) => setGmForm({ ...gmForm, moneda: e.target.value as "ARS" | "USD" })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <input value={gmForm.notas} onChange={(e) => setGmForm({ ...gmForm, notas: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Notas opcionales..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setGmModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateGM} disabled={gmSaving || !gmForm.descripcion.trim() || gmForm.monto <= 0}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {gmSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {gmEditingId ? "Guardar cambios" : "Crear gasto"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── FX Settlement Dialogs ── */}
      {fxPago && sociedadActiva?.id && <FxSettlementDialog
        kind="pago" counterpartyId={fxPago.proveedorId} sociedadId={sociedadActiva.id}
        documents={fxPago.documents}
        onClose={() => setFxPago(null)}
        onSuccess={async () => { setFxPago(null); setOpModalOpen(false); await fetchData(); }}
      />}
      {fxCobroMulti && sociedadActiva?.id && <FxSettlementDialog
        kind="cobro" counterpartyId={fxCobroMulti.clienteId} sociedadId={sociedadActiva.id}
        documents={fxCobroMulti.documents}
        onClose={() => setFxCobroMulti(null)}
        onSuccess={async () => { setFxCobroMulti(null); setCobroMultiOpen(false); setCobroMultiLiqOpen(false); await fetchData(); if (ccDetailCliente) await fetchCCDetailCliente(ccDetailCliente); }}
      />}

      {/* ── Cobro Multiple Modal — Paso 1: selección ── */}
      {cobroMultiOpen && ccDetailCliente && !cobroMultiLiqOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setCobroMultiOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-xl dark:bg-zinc-900 overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Cobro masivo — {ccDetailCliente.razon_social}</h2>
                <button onClick={() => setCobroMultiOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
              </div>

              <h3 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-2">Seleccioná las facturas a cobrar</h3>
              <div className="border rounded-lg dark:border-zinc-700 overflow-hidden mb-4">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-800">
                    <tr>
                      <th className="px-3 py-2 text-left w-8"><input type="checkbox" checked={cobroMultiFCs.length > 0 && cobroMultiFCs.every(f => f.selected)} onChange={(e) => setCobroMultiFCs(prev => prev.map(f => ({ ...f, selected: e.target.checked })))} /></th>
                      <th className="px-3 py-2 text-left">Comprobante</th>
                      <th className="px-3 py-2 text-left">Fecha</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Saldo pend.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cobroMultiFCs.map((fc, idx) => (
                      <tr key={fc.id} className={`border-t dark:border-zinc-700 ${fc.selected ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                        <td className="px-3 py-2"><input type="checkbox" checked={fc.selected} onChange={(e) => { const newFCs = [...cobroMultiFCs]; newFCs[idx] = { ...newFCs[idx], selected: e.target.checked }; setCobroMultiFCs(newFCs); }} /></td>
                        <td className="px-3 py-2 font-mono text-xs">{fc.tipo} {String(fc.punto_venta).padStart(4, "0")}-{String(fc.numero).padStart(8, "0")}</td>
                        <td className="px-3 py-2">{formatDate(fc.fecha)}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(fc.total, fc.moneda as "ARS" | "USD")}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-600 font-semibold">{formatCurrency(fc.saldo, fc.moneda as "ARS" | "USD")}</td>
                      </tr>
                    ))}
                    {cobroMultiFCs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-400">No hay facturas pendientes</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t pt-4 dark:border-zinc-700">
                <div className="text-sm text-zinc-500">
                  {cobroMultiFCs.filter(f => f.selected).length} factura{cobroMultiFCs.filter(f => f.selected).length !== 1 ? "s" : ""} seleccionada{cobroMultiFCs.filter(f => f.selected).length !== 1 ? "s" : ""}
                  {" — "}Saldo: <span className="font-mono font-bold text-emerald-600">{formatCurrency(cobroMultiFCs.filter(f => f.selected).reduce((s, f) => s + f.saldo, 0))}</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setCobroMultiOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
                  <button onClick={cobroMultiOpenLiquidacion} disabled={cobroMultiFCs.filter(f => f.selected).length === 0}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                    Continuar a liquidación
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      {/* ── Cobro Multiple — Paso 2: Liquidación ── */}
      {cobroMultiLiqOpen && ccDetailCliente && (
        <CobroMasivoLiquidacion
          facturas={cobroMultiGetLiqFacturas()}
          clienteId={ccDetailCliente.id}
          clienteNombre={ccDetailCliente.razon_social}
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          moneda={(cobroMultiFCs.find(f => f.selected)?.moneda as "ARS" | "USD") || "ARS"}
          onClose={() => setCobroMultiLiqOpen(false)}
          onSuccess={async () => { setCobroMultiLiqOpen(false); setCobroMultiOpen(false); await fetchData(); if (ccDetailCliente) await fetchCCDetailCliente(ccDetailCliente); }}
        />
      )}

      {/* ── Manual Movement Modal ── */}
      {manualMovOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setManualMovOpen(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Movimiento manual</h2>
              <button onClick={() => setManualMovOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-zinc-500 mb-4">{manualMovTarget === "cliente" ? "Cliente" : "Proveedor"}: <span className="font-medium text-zinc-800 dark:text-zinc-200">{manualMovTargetName}</span></p>
            {manualMovError && <p className="mb-3 text-sm text-red-500">{manualMovError}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-500">Tipo</label>
                <select value={manualMovForm.tipo_mov} onChange={(e) => setManualMovForm({ ...manualMovForm, tipo_mov: e.target.value as "credito" | "debito" })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="credito">Credito (a favor del {manualMovTarget === "cliente" ? "cliente" : "proveedor"})</option>
                  <option value="debito">Debito (cargo al {manualMovTarget === "cliente" ? "cliente" : "proveedor"})</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Monto</label>
                  <input type="number" value={manualMovForm.monto || ""} onChange={(e) => setManualMovForm({ ...manualMovForm, monto: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="0.00" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={manualMovForm.moneda} onChange={(e) => setManualMovForm({ ...manualMovForm, moneda: e.target.value as "ARS" | "USD" })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Fecha</label>
                <input type="date" value={manualMovForm.fecha} onChange={(e) => setManualMovForm({ ...manualMovForm, fecha: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">Descripcion</label>
                <input value={manualMovForm.descripcion} onChange={(e) => setManualMovForm({ ...manualMovForm, descripcion: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Ajuste de saldo, nota de credito..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setManualMovOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleManualMov} disabled={manualMovSaving || manualMovForm.monto <= 0 || !manualMovForm.descripcion.trim()}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {manualMovSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Registrar movimiento
              </button>
            </div>
          </div>
        </>
      )}
      <EmailComposeModal
        open={emailModal.open}
        onClose={() => setEmailModal(prev => ({ ...prev, open: false }))}
        documentType="orden_pago"
        sociedadId={sociedadActiva?.id}
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        suggestedEmails={emailModal.suggestedEmails}
        extraAttachments={emailModal.extraAttachments}
        onSuccess={async () => {
          const sentAt = new Date().toISOString();
          const ordenPagoId = emailModal.id;
          let emailUpdate = (supabase as any)
            .from("ordenes_pago")
            .update({ email_enviado_at: sentAt, sobre_verde: true })
            .eq("id", ordenPagoId);
          if (sociedadActiva?.id) emailUpdate = emailUpdate.eq("sociedad_id", sociedadActiva.id);
          const { error } = await emailUpdate;
          if (error) {
            alert(`El email se envió, pero no se pudo guardar la marca de envío: ${error.message}`);
            return;
          }
          setOrdenesPago((prev) => prev.map((orden) =>
            orden.id === ordenPagoId ? { ...orden, email_enviado_at: sentAt, sobre_verde: true } : orden
          ));
          setSelectedOP((prev) =>
            prev?.id === ordenPagoId ? { ...prev, email_enviado_at: sentAt, sobre_verde: true } : prev
          );
        }}
        onMarkSent={async () => {
          const sentAt = new Date().toISOString();
          const ordenPagoId = emailModal.id;
          let emailUpdate = (supabase as any)
            .from("ordenes_pago")
            .update({ email_enviado_at: sentAt, sobre_verde: true })
            .eq("id", ordenPagoId);
          if (sociedadActiva?.id) emailUpdate = emailUpdate.eq("sociedad_id", sociedadActiva.id);
          const { error } = await emailUpdate;
          if (error) { alert(`Error al marcar como enviada: ${error.message}`); return; }
          setOrdenesPago((prev) => prev.map((orden) =>
            orden.id === ordenPagoId ? { ...orden, email_enviado_at: sentAt, sobre_verde: true } : orden
          ));
          setSelectedOP((prev) =>
            prev?.id === ordenPagoId ? { ...prev, email_enviado_at: sentAt, sobre_verde: true } : prev
          );
        }}
        generatePdf={async () => {
          const op = ordenesPago.find(o => o.id === emailModal.id);
          if (!op || !sociedadActiva) throw new Error("No se encontró la OP");

          // Fetch proveedor CUIT & dirección
          let provCuit = "";
          let provDir = "";
          try {
            const { data: provData } = await (supabase as any).from("proveedores").select("cuit, direccion").eq("id", op.proveedor_id).single();
            if (provData) { provCuit = provData.cuit || ""; provDir = provData.direccion || ""; }
          } catch { /* ignore */ }

          // Fetch linked FCs
          let fcsRows: { numero: string; fecha: string; monto: number }[] = [];
          try {
            const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto").eq("orden_pago_id", op.id);
            if (links && links.length > 0) {
              const fcIds = links.map((l: any) => l.factura_compra_id);
              const { data: fcs } = await (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, total").in("id", fcIds);
              if (fcs && fcs.length > 0) {
                fcsRows = fcs.map((fc: any) => {
                  const link = links.find((l: any) => l.factura_compra_id === fc.id);
                  return { numero: fc.numero_factura || "\u2014", fecha: fc.fecha, monto: Number(link?.monto ?? fc.total) };
                });
              }
            }
          } catch { /* ignore */ }

          const medios = op.medios_pago && op.medios_pago.length > 0
            ? op.medios_pago.map(m => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion }))
            : [{ tipo: op.medio_pago, monto: op.neto, fecha: op.fecha, banco: "", numero_cheque: "", moneda: op.moneda as "ARS" | "USD", cotizacion: 1 }];

          const soc = getSociedadPDF(sociedadActiva);
          const html = generateOrdenPagoPDF({
            numero: op.numero || "",
            fecha: op.fecha,
            estado: op.estado,
            moneda: op.moneda,
            monto_bruto: op.monto_bruto,
            retencion_ganancias_pct: op.retencion_ganancias_pct,
            retencion_ganancias_monto: op.retencion_ganancias_monto,
            neto: op.neto,
            notas: op.notas,
            proveedor: { razon_social: op.proveedor_nombre, cuit: provCuit, direccion: provDir },
            medios,
            facturas_vinculadas: fcsRows,
          }, soc);
          return htmlToPdfBase64(html);
        }}
      />
    </>
  );
}
