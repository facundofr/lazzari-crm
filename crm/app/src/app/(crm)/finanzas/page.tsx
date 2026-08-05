"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import CobroMasivoLiquidacion, { type LiquidacionFactura } from "@/components/cobro-masivo-liquidacion";
import { mockMovimientos, mockClients, mockProveedores, mockExtractos, mockLineasCredito, mockGastosFijos, mockObjetivos } from "@/lib/mock-data";
import type { Movimiento, ExtractoMovimiento, LineaCredito, GastoFijo, Objetivo } from "@/lib/types";
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2, CalendarDays, Clock, Plus, Pencil, Target, FileText, Receipt, Ban, Search, Printer, Download, Paperclip, Eye, ShieldCheck, ShoppingCart, Package, DollarSign, Minimize2, Maximize2, Square, Sparkles } from "lucide-react";
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";

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

type FinanzasTab = "movimientos" | "facturas_compra" | "ordenes_pago" | "gastos_manuales" | "echeqs" | "cc_clientes" | "cc_proveedores" | "extractos" | "lineas_credito" | "gastos_fijos" | "objetivos" | "facturacion";

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
  estado: "en_cartera" | "endosado" | "depositado" | "cobrado" | "rechazado" | "vencido";
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
};

const emptyEcheqForm = {
  tipo_cheque: "echeq" as "echeq" | "fisico",
  numero: "",
  banco_emisor: "",
  cuit_emisor: "",
  monto: 0,
  moneda: "ARS" as "ARS" | "USD",
  fecha_emision: "",
  fecha_pago: new Date().toISOString().slice(0, 10),
  origen_tipo: "cliente" as "cliente" | "otro",
  origen_id: "",
  origen_nombre: "",
  observaciones: "",
};

// ── OP & Gastos types ──
interface ProveedorOption {
  id: string;
  razon_social: string;
  cuit?: string | null;
  condicion_iva?: string | null;
}

interface OrdenPagoRow {
  id: string;
  numero?: string;
  fecha: string;
  proveedor_id: string;
  proveedor_nombre: string;
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
  tipo: "mercaderia" | "solo_iva";
  notas: string;
  costo_real?: number;
  created_at: string;
  archivo_url?: string;
  archivo_nombre?: string;
  solo_iva?: boolean;
  cae?: string;
  op_vinculada?: { id: string; numero: string; estado: string; fecha: string } | null;
  ocs_vinculadas?: { numero: string }[];
}

interface OCOption {
  id: string;
  numero: string;
  proveedor_id: string;
}

const emptyFCForm = {
  tipo_fc: "solo_iva" as "mercaderia" | "solo_iva",
  numero_factura: "",
  proveedor_id: "",
  orden_compra_id: "",
  fecha: new Date().toISOString().slice(0, 10),
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
  unidad: string;
  iva_porcentaje: number;
}

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
  tipo: "cheque" | "cheque_propio" | "deposito" | "transferencia" | "echeq" | "efectivo";
  monto: number;
  fecha: string;
  banco: string;
  numero_cheque: string;
  moneda: "ARS" | "USD";
  cotizacion: number;
  echeq_id?: string; // if selecting from cartera
}
const makeOpMedio = (moneda: "ARS" | "USD" = "ARS"): OpMedioPago => ({
  tempId: Math.random().toString(36).slice(2),
  tipo: "transferencia",
  monto: 0,
  fecha: new Date().toISOString().slice(0, 10),
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
  fecha: new Date().toISOString().slice(0, 10),
  monto_manual: 0,
  usar_monto_manual: false,
  iva_manual_pct: 21 as number,
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
  fecha: new Date().toISOString().slice(0, 10),
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
  conciliado: boolean;
  created_at: string;
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
  fecha: new Date().toISOString().slice(0, 10),
  moneda: "ARS" as "USD" | "ARS",
  cliente_id: "",
  proveedor_id: "",
};

export default function FinanzasPage() {
  const { sociedadActiva, profile } = useUser();
  const [tab, setTab] = useState<FinanzasTab>("movimientos");
  const [filterExtracto, setFilterExtracto] = useState<"todos" | "matcheado" | "pendiente">("todos");
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
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
      const { data: rels } = await supabase.from("movimientos")
        .select("*, clientes(razon_social), proveedores(razon_social)")
        .eq("factura_id" as any, mov.factura_id)
        .order("created_at", { ascending: true });
      if (rels) setRelatedMovs(rels as MovimientoRow[]);
      // Fetch factura info
      const { data: fc } = await supabase.from("facturas")
        .select("tipo, punto_venta, numero, total, estado, moneda")
        .eq("id", mov.factura_id)
        .single();
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
  const [lineasCredito, setLineasCredito] = useState<LineaCreditoRow[]>([]);
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([]);
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);

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
  const [opModalOpen, setOpModalOpen] = useState(false);
  const [opForm, setOpForm] = useState(emptyOPForm);
  const [opSaving, setOpSaving] = useState(false);
  const [opError, setOpError] = useState("");
  const [opFile, setOpFile] = useState<File | null>(null);
  const [opProvCondicion, setOpProvCondicion] = useState<string | null>(null);
  const [opCondicionLoading, setOpCondicionLoading] = useState(false);
  // FC pendientes del proveedor para vincular a la OP
  interface OpFCPendiente { id: string; numero: string; fecha: string; total: number; subtotal: number; iva: number; percepciones: number; saldo_pendiente: number; moneda: string; selected: boolean; monto_a_pagar: number }
  const [opFCPendientes, setOpFCPendientes] = useState<OpFCPendiente[]>([]);
  const [opMedios, setOpMedios] = useState<OpMedioPago[]>([makeOpMedio()]);
  const [opMonthlyBase, setOpMonthlyBase] = useState(0); // Acumulado mensual de bases sin IVA (de OPs previas)
  const [opMonthlyRetenido, setOpMonthlyRetenido] = useState(0); // Retenciones ya practicadas en el mes
  const [opFCLoading, setOpFCLoading] = useState(false);
  const [retencionConfig, setRetencionConfig] = useState({
    aplica_iva: true, minimo_iva: 130000, tasa_iva_ri: 10.5,
    aplica_ganancias: true, minimo_ganancias: 224000, tasa_ganancias_ri: 2, tasa_ganancias_no_inscripto: 28,
    minimo_retencion_ganancias: 15000,
  });
  const [proveedoresOptions, setProveedoresOptions] = useState<ProveedorOption[]>([]);
  const [chequesRecibidos, setChequesRecibidos] = useState<MovimientoRow[]>([]);
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [selectedOP, setSelectedOP] = useState<OrdenPagoRow | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [editingOP, setEditingOP] = useState(false);
  const [editOPForm, setEditOPForm] = useState<{ fecha: string; moneda: "ARS" | "USD"; notas: string }>({ fecha: "", moneda: "ARS", notas: "" });
  const [savingOP, setSavingOP] = useState(false);

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
  const [fcForm, setFcForm] = useState(emptyFCForm);
  const [fcSaving, setFcSaving] = useState(false);
  const [fcError, setFcError] = useState("");
  const [fcProvSearch, setFcProvSearch] = useState("");
  const [fcProvFocused, setFcProvFocused] = useState(false);
  const [ocOptions, setOcOptions] = useState<OCOption[]>([]);
  const [fcFile, setFcFile] = useState<File | null>(null);
  const [fcUploading, setFcUploading] = useState(false);
  const [selectedFC, setSelectedFC] = useState<FacturaCompraRow | null>(null);
  const [selectedFCItems, setSelectedFCItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; unidad: string; iva_porcentaje: number }[]>([]);
  const [editingFC, setEditingFC] = useState(false);
  const [editFCForm, setEditFCForm] = useState<{ numero_factura: string; fecha: string; fecha_vencimiento: string; subtotal: number; iva: number; percepciones: number; moneda: "ARS" | "USD"; notas: string; cae: string }>({ numero_factura: "", fecha: "", fecha_vencimiento: "", subtotal: 0, iva: 0, percepciones: 0, moneda: "ARS", notas: "", cae: "" });
  const [savingFC, setSavingFC] = useState(false);
  const [fcSearchQuery, setFcSearchQuery] = useState("");
  const [fcEstadoFilter, setFcEstadoFilter] = useState<"todos" | "pendiente_aprobacion" | "pendiente" | "pagada" | "recibida" | "anulada">("todos");
  const [newArticleOpen, setNewArticleOpen] = useState(false);
  const [newArticle, setNewArticle] = useState({ codigo: "", descripcion: "", categoria: "", unidad: "UN", precio: 0 });
  const [newArticleSaving, setNewArticleSaving] = useState(false);
  // FC items (mercadería)
  const [fcItems, setFcItems] = useState<FCItem[]>([]);
  const [fcProdSearch, setFcProdSearch] = useState("");
  const [fcProdFocused, setFcProdFocused] = useState(false);
  const [fcProductos, setFcProductos] = useState<{ id: string; codigo: string; nombre: string; precio_costo: number; unidad: string; stock: number }[]>([]);

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

  // Balance projection
  interface BalanceBand { banda: string; moneda: string; total: number }
  const [balanceData, setBalanceData] = useState<{ cobrar: BalanceBand[]; pagar: BalanceBand[]; echeqs: BalanceBand[] } | null>(null);

  // ── CC Detail (Estado de cuenta) ──
  interface CCFacturaRow { id: string; numero: string; tipo: string; punto_venta: number; fecha: string; vencimiento: string | null; total: number; total_acreditado: number; moneda: string; estado: string }
  interface CCMovRow { id: string; tipo: string; monto: number; moneda: string; descripcion: string; fecha: string; referencia: string | null }
  interface CCFCRow { id: string; numero_factura: string; fecha: string; fecha_vencimiento: string | null; total: number; estado: string; moneda: string }
  const [ccDetailCliente, setCcDetailCliente] = useState<CCRow | null>(null);
  const [ccDetailFacturas, setCcDetailFacturas] = useState<CCFacturaRow[]>([]);
  const [ccDetailMovimientos, setCcDetailMovimientos] = useState<CCMovRow[]>([]);
  const [ccDetailLoading, setCcDetailLoading] = useState(false);
  const [ccDetailProveedor, setCcDetailProveedor] = useState<CCRow | null>(null);
  const [ccDetailFCProv, setCcDetailFCProv] = useState<CCFCRow[]>([]);
  const [ccDetailMovProv, setCcDetailMovProv] = useState<CCMovRow[]>([]);
  const [ccDetailProvLoading, setCcDetailProvLoading] = useState(false);

  // ── Cobro Multiple modal ──
  interface CobroMultiFC { id: string; numero: string; tipo: string; punto_venta: number; fecha: string; subtotal: number; iva: number; total: number; total_acreditado: number; moneda: string; saldo: number; selected: boolean }
  const [cobroMultiOpen, setCobroMultiOpen] = useState(false);
  const [cobroMultiFCs, setCobroMultiFCs] = useState<CobroMultiFC[]>([]);
  const [cobroMultiLiqOpen, setCobroMultiLiqOpen] = useState(false);

  // ── Manual movement modal (conciliacion) ──
  const [manualMovOpen, setManualMovOpen] = useState(false);
  const [manualMovTarget, setManualMovTarget] = useState<"cliente" | "proveedor">("cliente");
  const [manualMovTargetId, setManualMovTargetId] = useState("");
  const [manualMovTargetName, setManualMovTargetName] = useState("");
  const [manualMovForm, setManualMovForm] = useState({ monto: 0, descripcion: "", fecha: new Date().toISOString().slice(0, 10), tipo_mov: "credito" as "credito" | "debito", moneda: "ARS" as "ARS" | "USD" });
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
          let qProv = supabase.from("proveedores").select("id, razon_social, cuit, condicion_iva").order("razon_social");
          if (sociedadActiva?.id) qProv = qProv.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: provData } = await qProv;
          if (provData) setProveedoresOptions(provData as ProveedorOption[]);
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
              minimo_retencion_ganancias: retCfg.minimo_retencion_ganancias ?? 15000,
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
          let qOp = (supabase as any).from("ordenes_pago").select("*, proveedores(razon_social)").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qOp = qOp.eq("sociedad_id", sociedadActiva.id);
          const { data: opData } = await qOp;
          if (opData) {
            setOrdenesPago(opData.map((r: any) => ({
              id: r.id, numero: r.numero ?? undefined, fecha: r.fecha, proveedor_id: r.proveedor_id,
              proveedor_nombre: r.proveedores?.razon_social ?? "—",
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
          let qFc = (supabase as any).from("facturas_compra").select("*, proveedores(razon_social), ordenes_compra(numero), op_facturas_compra(orden_pago_id, monto, ordenes_pago(id, numero, estado, fecha)), factura_compra_ocs(orden_compra_id, ordenes_compra(numero))").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qFc = qFc.eq("sociedad_id", sociedadActiva.id);
          const { data: fcData } = await qFc;
          if (fcData) {
            setFacturasCompra(fcData.map((r: any) => ({
              id: r.id, numero_factura: r.numero_factura,
              proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedores?.razon_social ?? "—",
              orden_compra_id: r.orden_compra_id, oc_numero: r.ordenes_compra?.numero ?? undefined,
              fecha: r.fecha, fecha_vencimiento: r.fecha_vencimiento,
              subtotal: Number(r.subtotal), iva_porcentaje: Number(r.iva_porcentaje),
              iva: Number(r.iva), percepciones: Number(r.percepciones ?? 0),
              total: Number(r.total), moneda: (r.moneda as "ARS" | "USD") ?? "ARS",
              estado: r.estado ?? "pendiente", notas: r.notas ?? "",
              tipo: (r.tipo as "mercaderia" | "solo_iva") ?? (r.solo_iva ? "solo_iva" : "mercaderia"),
              created_at: r.created_at,
              costo_real: Number(r.costo_real ?? 0),
              archivo_url: r.archivo_url ?? undefined,
              archivo_nombre: r.archivo_nombre ?? undefined,
              solo_iva: r.solo_iva ?? false,
              cae: r.cae ?? undefined,
              op_vinculada: r.op_facturas_compra?.length > 0 && r.op_facturas_compra[0]?.ordenes_pago
                ? { id: r.op_facturas_compra[0].ordenes_pago.id, numero: r.op_facturas_compra[0].ordenes_pago.numero, estado: r.op_facturas_compra[0].ordenes_pago.estado, fecha: r.op_facturas_compra[0].ordenes_pago.fecha }
                : null,
              ocs_vinculadas: (r.factura_compra_ocs || []).map((link: any) => ({ numero: link.ordenes_compra?.numero || "—" })).filter((o: any) => o.numero !== "—"),
            })));
          } else {
            setFacturasCompra([]);
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch ordenes de compra for optional linking
        try {
          let qOc = supabase.from("ordenes_compra").select("id, numero, proveedor_id").order("numero", { ascending: false });
          if (sociedadActiva?.id) qOc = qOc.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: ocData } = await qOc;
          if (ocData) setOcOptions(ocData as OCOption[]);
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
    fetchData();
  }, [fetchData]);

  // Fetch FC items when detail panel opens
  useEffect(() => {
    if (!selectedFC?.id) { setSelectedFCItems([]); return; }
    (async () => {
      try {
        const { data } = await (supabase as any).from("facturas_compra_items").select("descripcion, cantidad, precio_unitario, unidad, iva_porcentaje").eq("factura_compra_id", selectedFC.id);
        setSelectedFCItems(data ?? []);
      } catch { setSelectedFCItems([]); }
    })();
  }, [selectedFC?.id]);

  async function handleCreateMov() {
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
        sociedad_id: sociedadActiva?.id || null,
      };
      if (movForm.cliente_id) insertData.cliente_id = movForm.cliente_id;
      if (movForm.proveedor_id) insertData.proveedor_id = movForm.proveedor_id;
      if (profile?.id) insertData.created_by = profile.id;
      const { error } = await supabase.from("movimientos").insert(insertData as any);
      if (error) throw error;
      setModalOpen(false);
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
    const monto = Number(editingSaldoVal);
    if (isNaN(monto)) { setEditingSaldo(null); return; }
    const mesActual = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit" }).slice(0, 7);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const { error } = await (supabase as any).from("saldos_caja").upsert({
        sociedad_id: sociedadActiva?.id,
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
    try {
      const { error } = await supabase.from("movimientos").update({ conciliado: true }).eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error conciliando: " + (err instanceof Error ? err.message : String(err)));
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
    if (!gastoForm.descripcion.trim() || gastoForm.monto <= 0) return;
    setGastoSaving(true);
    try {
      if (editingGasto) {
        const { error } = await supabase.from("gastos_fijos").update({
          descripcion: gastoForm.descripcion, categoria: gastoForm.categoria,
          monto: gastoForm.monto, moneda: gastoForm.moneda, notas: gastoForm.notas,
        } as any).eq("id", editingGasto.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("gastos_fijos").insert({
          descripcion: gastoForm.descripcion, categoria: gastoForm.categoria,
          monto: gastoForm.monto, moneda: gastoForm.moneda, notas: gastoForm.notas,
          ...(sociedadActiva?.id ? { sociedad_id: sociedadActiva.id } : {}),
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
    try {
      const { error } = await supabase.from("gastos_fijos").update({ activo: !activo } as any).eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error al cambiar estado: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteGasto(id: string) {
    if (!confirm("Seguro que queres eliminar este gasto fijo?")) return;
    try {
      const { error } = await supabase.from("gastos_fijos").delete().eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleDeleteMov(id: string) {
    if (!confirm("¿Seguro que queres eliminar este movimiento?")) return;
    try {
      const { error } = await supabase.from("movimientos").delete().eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) {
      alert("Error al eliminar: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── OP auto-retenciones ──
  // 1. Cuando cambia el proveedor → consultar AFIP para obtener condición IVA + cargar FC pendientes
  useEffect(() => {
    if (!opModalOpen) return;
    if (!opForm.proveedor_id) { setOpProvCondicion(null); setOpFCPendientes([]); return; }
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
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
        .then(data => { setOpProvCondicion(data.condicion_iva ?? ""); })
        .catch(() => { setOpProvCondicion(null); })
        .finally(() => setOpCondicionLoading(false));
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
        const { data } = await q;

        // Pagos parciales previos: sumar montos ya pagados por FC via op_facturas_compra
        const fcIds = (data || []).map((fc: any) => fc.id);
        let pagadoPorFC: Record<string, number> = {};
        if (fcIds.length > 0) {
          const { data: opfcData } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto").in("factura_compra_id", fcIds);
          (opfcData || []).forEach((r: any) => { pagadoPorFC[r.factura_compra_id] = (pagadoPorFC[r.factura_compra_id] || 0) + Number(r.monto); });
        }

        setOpFCPendientes((data || []).map((fc: any) => {
          const pagado = pagadoPorFC[fc.id] || 0;
          const saldo = Math.max(0, Number(fc.total) - pagado);
          return { id: fc.id, numero: fc.numero_factura || "S/N", fecha: fc.fecha, total: Number(fc.total), subtotal: Number(fc.subtotal || 0), iva: Number(fc.iva || 0), percepciones: Number(fc.percepciones || 0), saldo_pendiente: saldo, moneda: fc.moneda || "ARS", selected: false, monto_a_pagar: saldo };
        }).filter((fc: any) => fc.saldo_pendiente > 0));

        // Acumulado mensual de PAGOS (OPs) a este proveedor — Art. 26 RG 830
        // Se acumulan las bases sin IVA de OPs previas + retenciones ya practicadas
        const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
        let qMensualOP = (supabase as any).from("ordenes_pago").select("base_retencion_ganancias, retencion_ganancias_monto")
          .eq("proveedor_id", opForm.proveedor_id)
          .gte("fecha", `${mesActual}-01`);
        if (sociedadActiva?.id) qMensualOP = qMensualOP.eq("sociedad_id", sociedadActiva.id);
        const { data: mensualOPData } = await qMensualOP;
        const basesMes = (mensualOPData || []).reduce((s: number, r: any) => s + Number(r.base_retencion_ganancias || 0), 0);
        const retenidoMes = (mensualOPData || []).reduce((s: number, r: any) => s + Number(r.retencion_ganancias_monto || 0), 0);
        setOpMonthlyBase(basesMes);
        setOpMonthlyRetenido(retenidoMes);
      } catch { setOpFCPendientes([]); }
      finally { setOpFCLoading(false); }
    })();
  }, [opForm.proveedor_id, opModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
  useEffect(() => {
    if (opProvCondicion === null || opBaseSinIVA <= 0) return;
    let aplica_ganancias = false;
    let retencion_ganancias_pct = 0;
    // RG 830: solo RI son sujetos de retención. Monotributo/Exento/CF = no retener.
    if (opProvCondicion === "RI" && retencionConfig.aplica_ganancias) {
      // Art. 26: acumular bases sin IVA del mes + esta OP
      const acumuladoMensual = opMonthlyBase + opBaseSinIVA;
      if (acumuladoMensual >= retencionConfig.minimo_ganancias) {
        aplica_ganancias = true;
        retencion_ganancias_pct = retencionConfig.tasa_ganancias_ri;
      }
    }
    setOpForm(prev => ({ ...prev, aplica_ganancias, retencion_ganancias_pct }));
  }, [opProvCondicion, opBaseSinIVA, retencionConfig, opMonthlyBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OP handlers ──
  function openOPModal(preloadProveedorId?: string) {
    setOpForm(preloadProveedorId ? { ...emptyOPForm, proveedor_id: preloadProveedorId } : emptyOPForm);
    setOpError("");
    setOpFile(null);
    setOpProvCondicion(null);
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
  const opRetencionGanancias = opRetencionGananciaBruta < retencionConfig.minimo_retencion_ganancias
    ? 0
    : Math.round(opRetencionGananciaBruta * 100) / 100;
  const opNetoAPagar = opMontoBruto - opRetencionGanancias;
  const opTotalMedios = opMedios.reduce((s, m) => s + m.monto, 0);
  const opDiferencia = opNetoAPagar - opTotalMedios;

  async function handleCreateOP() {
    if (!opForm.proveedor_id) { setOpError("Selecciona un proveedor"); return; }
    const selectedFCs = opFCPendientes.filter(f => f.selected);
    if (selectedFCs.length === 0 && !opForm.usar_monto_manual) { setOpError("Selecciona al menos una factura o ingresa un monto manual"); return; }
    if (opMontoBruto <= 0) { setOpError("El monto a pagar debe ser mayor a 0"); return; }
    // Validate medios de pago total = neto a pagar
    const totalMediosVal = opMedios.reduce((s, m) => s + m.monto, 0);
    const diff = Math.abs(opNetoAPagar - totalMediosVal);
    if (diff > 1) { setOpError(`Los medios de pago ($${totalMediosVal.toLocaleString()}) no coinciden con el neto a pagar ($${opNetoAPagar.toLocaleString()})`); return; }

    setOpSaving(true);
    setOpError("");
    try {
      const provNombre = proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social ?? "";
      // Generate OP number
      let qLastOP = (supabase as any).from("ordenes_pago").select("numero").order("created_at", { ascending: false }).limit(1);
      if (sociedadActiva?.id) qLastOP = qLastOP.eq("sociedad_id", sociedadActiva.id);
      const { data: lastOP } = await qLastOP;
      let nextNum = 1;
      if (lastOP?.[0]?.numero) {
        const parts = lastOP[0].numero.split("-");
        const n = parseInt(parts[parts.length - 1]);
        if (n > 0) nextNum = n + 1;
      }
      const opNumero = `OP-${String(nextNum).padStart(6, "0")}`;

      const insertData: Record<string, unknown> = {
        numero: opNumero,
        fecha: opForm.fecha,
        proveedor_id: opForm.proveedor_id,
        monto_bruto: opMontoBruto,
        base_retencion_ganancias: opBaseSinIVA, // Base sin IVA para acumulado mensual futuro
        retencion_porcentaje: 0,
        retencion_monto: 0,
        retencion_ganancias_pct: opForm.aplica_ganancias ? opForm.retencion_ganancias_pct : 0,
        retencion_ganancias_monto: opRetencionGanancias,
        neto_a_pagar: opNetoAPagar,
        moneda: opForm.moneda,
        medio_pago: opMedios[0]?.tipo || "transferencia",
        medios_pago: JSON.stringify(opMedios.map(m => ({ tipo: m.tipo, monto: m.monto, fecha: m.fecha, banco: m.banco, numero_cheque: m.numero_cheque, moneda: m.moneda, cotizacion: m.cotizacion, echeq_id: m.echeq_id }))),
        notas: opForm.notas,
        estado: "pagada",
      };
      if (profile?.id) insertData.created_by = profile.id;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { data: opData, error } = await (supabase as any).from("ordenes_pago").insert(insertData).select("id").single();
      if (error) throw error;

      // Upload comprobante
      if (opFile && opData?.id) {
        const ext = opFile.name.split(".").pop() || "pdf";
        const filePath = `${sociedadActiva?.id || "default"}/op-${opData.id}/comprobante.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprobantes").upload(filePath, opFile, { upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(filePath);
          await (supabase as any).from("ordenes_pago").update({ archivo_url: urlData.publicUrl, archivo_nombre: opFile.name }).eq("id", opData.id);
        }
      }
      setOpFile(null);

      // Link FCs + update saldo
      if (opData?.id && selectedFCs.length > 0) {
        const links = selectedFCs.map(fc => ({
          orden_pago_id: opData.id,
          factura_compra_id: fc.id,
          monto: fc.monto_a_pagar,
        }));
        await (supabase as any).from("op_facturas_compra").insert(links);
        // If monto_a_pagar == saldo_pendiente → pagada; else stays as está
        for (const fc of selectedFCs) {
          if (Math.abs(fc.monto_a_pagar - fc.saldo_pendiente) < 1) {
            await (supabase as any).from("facturas_compra").update({ estado: "pagada" }).eq("id", fc.id);
          }
        }
      }

      // Create movimiento
      const movData: Record<string, unknown> = {
        tipo: "pago",
        descripcion: `${opNumero} — ${provNombre}`,
        monto: opNetoAPagar,
        moneda: opForm.moneda,
        fecha: opForm.fecha,
        proveedor_id: opForm.proveedor_id,
        conciliado: false,
      };
      if (profile?.id) movData.created_by = profile.id;
      if (sociedadActiva?.id) (movData as any).sociedad_id = sociedadActiva.id;
      await supabase.from("movimientos").insert(movData as any);

      // Mark echeqs used as endosado
      for (const m of opMedios) {
        if (m.echeq_id) {
          await (supabase as any).from("echeqs").update({ estado: "endosado", destino_nombre: provNombre }).eq("id", m.echeq_id);
        }
      }

      setOpModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      setOpError(err instanceof Error ? err.message : "Error al crear la OP");
    } finally {
      setOpSaving(false);
    }
  }

  async function handleAnularOP(id: string) {
    if (!confirm("¿Seguro que queres anular esta orden de pago?")) return;
    try {
      const { error } = await (supabase as any).from("ordenes_pago").update({ estado: "anulada" }).eq("id", id);
      if (error) throw error;

      // Revertir FCs vinculadas a pendiente si quedaron como pagadas
      const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id").eq("orden_pago_id", id);
      if (links && links.length > 0) {
        for (const link of links) {
          // Recalcular: sumar pagos de OPs no-anuladas para esta FC
          const { data: allPayments } = await (supabase as any)
            .from("op_facturas_compra").select("monto, orden_pago_id")
            .eq("factura_compra_id", link.factura_compra_id);
          // Excluir pagos de OPs anuladas
          const { data: anuladas } = await (supabase as any)
            .from("ordenes_pago").select("id").in("id", (allPayments || []).map((p: any) => p.orden_pago_id)).eq("estado", "anulada");
          const anuladasSet = new Set((anuladas || []).map((a: any) => a.id));
          const totalVigente = (allPayments || []).filter((p: any) => !anuladasSet.has(p.orden_pago_id)).reduce((s: number, p: any) => s + Number(p.monto), 0);
          const { data: fc } = await (supabase as any).from("facturas_compra").select("total, estado").eq("id", link.factura_compra_id).single();
          if (fc && fc.estado === "pagada" && totalVigente < Number(fc.total) - 1) {
            await (supabase as any).from("facturas_compra").update({ estado: "pendiente" }).eq("id", link.factura_compra_id);
          }
        }
      }

      await fetchData();
    } catch (err) { alert("Error anulando OP: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handlePagarOP(id: string) {
    try {
      const { error } = await (supabase as any).from("ordenes_pago").update({ estado: "pagada" }).eq("id", id);
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
          const { data: fc } = await (supabase as any).from("facturas_compra").select("total").eq("id", link.factura_compra_id).single();
          if (fc && Math.abs(totalPagado - Number(fc.total)) < 1) {
            await (supabase as any).from("facturas_compra").update({ estado: "pagada" }).eq("id", link.factura_compra_id);
          }
        }
      }

      await fetchData();
    } catch (err) { alert("Error marcando OP como pagada: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handleGenerarComprobante(op: OrdenPagoRow) {
    const isGrupoLA = sociedadActiva?.id === "fee94607-747a-4e87-ba24-aff9032f7a56";
    const socNombre = isGrupoLA ? "Grupo LA S.A." : "Lazzari Soluciones Industriales";
    const socCuit = isGrupoLA ? "30-71939604-2" : "20-37930912-8";
    const socDir = isGrupoLA ? "CHARCAS 5151 Piso 1 Dpto 106" : "PUEYRREDON 653, Pergamino";
    const socTel = isGrupoLA ? "" : "2477 628958";

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

    // Format CUIT for display (XX-XXXXXXXX-X)
    const fmtCuit = (c: string) => {
      const digits = c.replace(/\D/g, "");
      if (digits.length === 11) return `${digits.slice(0,2)}-${digits.slice(2,10)}-${digits.slice(10)}`;
      return c;
    };

    // Monto en letras
    const montoEnLetras = (monto: number): string => {
      const unidades = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
      const especiales = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
      const decenas = ["", "", "VEINTE", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
      const centenas = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

      const convertirGrupo = (n: number): string => {
        if (n === 0) return "";
        if (n === 100) return "CIEN";
        let result = "";
        if (n >= 100) { result += centenas[Math.floor(n / 100)] + " "; n = n % 100; }
        if (n >= 20) {
          result += decenas[Math.floor(n / 10)];
          if (n % 10 > 0) result += (Math.floor(n / 10) === 2 ? "I" : " Y ") + unidades[n % 10];
        } else if (n >= 10) {
          result += especiales[n - 10];
        } else if (n > 0) {
          result += unidades[n];
        }
        return result.trim();
      };

      const entero = Math.floor(Math.abs(monto));
      const centavos = Math.round((Math.abs(monto) - entero) * 100);
      const monedaLabel = op.moneda === "USD" ? "DOLARES ESTADOUNIDENSES" : "PESOS ARGENTINOS";

      if (entero === 0) return `SON ${monedaLabel} CERO CON ${String(centavos).padStart(2, "0")}/100 CENTAVOS`;

      let texto = "";
      const millones = Math.floor(entero / 1000000);
      const miles = Math.floor((entero % 1000000) / 1000);
      const resto = entero % 1000;

      if (millones > 0) {
        texto += (millones === 1 ? "UN MILLON" : convertirGrupo(millones) + " MILLONES") + " ";
      }
      if (miles > 0) {
        texto += (miles === 1 ? "MIL" : convertirGrupo(miles) + " MIL") + " ";
      }
      if (resto > 0) {
        texto += convertirGrupo(resto);
      }

      return `SON ${monedaLabel} ${texto.trim()} CON ${String(centavos).padStart(2, "0")}/100 CENTAVOS`;
    };

    const fechaDD = (f: string) => {
      try {
        const d = new Date(f + "T12:00:00");
        return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      } catch { return f; }
    };

    // Fetch linked FCs
    let fcsRows: {numero: string; fecha: string; monto: number}[] = [];
    try {
      const { data: links } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto").eq("orden_pago_id", op.id);
      if (links && links.length > 0) {
        const fcIds = links.map((l: any) => l.factura_compra_id);
        const { data: fcs } = await (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, total").in("id", fcIds);
        if (fcs && fcs.length > 0) {
          fcsRows = fcs.map((fc: any) => {
            const link = links.find((l: any) => l.factura_compra_id === fc.id);
            return { numero: fc.numero_factura || "—", fecha: fc.fecha, monto: Number(link?.monto ?? fc.total) };
          });
        }
      }
    } catch { /* ignore */ }

    // Separate medios by type
    const medios = op.medios_pago && op.medios_pago.length > 0 ? op.medios_pago : [{ tipo: op.medio_pago as OpMedioPago["tipo"], monto: op.neto, fecha: op.fecha, banco: "", numero_cheque: "", moneda: op.moneda as "ARS" | "USD", cotizacion: 1, tempId: "" }];
    const cheques = medios.filter((m) => m.tipo === "cheque" || m.tipo === "cheque_propio" || m.tipo === "echeq");
    const depositos = medios.filter((m) => m.tipo === "deposito" || m.tipo === "transferencia" || m.tipo === "efectivo");

    const totalCheques = cheques.reduce((s, m) => s + Number(m.monto), 0);
    const totalDepositos = depositos.reduce((s, m) => s + Number(m.monto), 0);
    const totalRetGan = op.retencion_ganancias_monto || 0;
    const totalRetenciones = totalRetGan;
    const totalGeneral = totalCheques + totalDepositos + totalRetenciones;

    // ── Build FCs table ──
    const fcsHtml = fcsRows.length > 0 ? `
      <table class="bordered">
        <thead><tr><th style="text-align:center">Fecha</th><th style="text-align:left">Comprobante</th><th style="text-align:right">Monto abonado</th></tr></thead>
        <tbody>${fcsRows.map(fc => `<tr><td style="text-align:center">${fechaDD(fc.fecha)}</td><td>${fc.numero}</td><td style="text-align:right">${formatCurrency(fc.monto, op.moneda)}</td></tr>`).join("")}</tbody>
      </table>` : `<p style="color:#999;font-size:11px">Sin documentos vinculados</p>`;

    // ── Cheques table ──
    const chequesHtml = cheques.length > 0 ? `
      <div class="section">
        <div class="section-title">Cheques</div>
        <table class="bordered">
          <thead><tr>
            <th>Fecha de cheque</th><th>Banco</th><th>N\u00B0 Cheque</th><th>Moneda</th><th style="text-align:right">Importe</th><th style="text-align:right">Cotizaci\u00F3n</th><th style="text-align:right">Importe consolidado</th>
          </tr></thead>
          <tbody>${cheques.map((m) => {
            const importeConsolidado = Number(m.monto) * (Number(m.cotizacion) || 1);
            return `<tr>
              <td>${fechaDD(m.fecha)}</td><td>${m.banco || "\u2014"}</td><td>${m.numero_cheque || "\u2014"}</td><td>${m.moneda || op.moneda}</td>
              <td style="text-align:right">${formatCurrency(Number(m.monto), m.moneda || op.moneda)}</td>
              <td style="text-align:right">${Number(m.cotizacion) || 1}</td>
              <td style="text-align:right">${formatCurrency(importeConsolidado, "ARS")}</td>
            </tr>`;
          }).join("")}</tbody>
          <tfoot><tr><td colspan="6" style="text-align:right;font-weight:700">Total Cheques</td><td style="text-align:right;font-weight:700">${formatCurrency(totalCheques, op.moneda)}</td></tr></tfoot>
        </table>
      </div>` : "";

    // ── Depósitos / Transferencias table ──
    const depositosHtml = depositos.length > 0 ? `
      <div class="section">
        <div class="section-title">Dep\u00F3sitos / Transferencias</div>
        <table class="bordered">
          <thead><tr>
            <th>Fecha</th><th>Moneda</th><th style="text-align:right">Importe</th><th style="text-align:right">Cotizaci\u00F3n</th><th style="text-align:right">Importe Consolidado</th>
          </tr></thead>
          <tbody>${depositos.map((m) => {
            const importeConsolidado = Number(m.monto) * (Number(m.cotizacion) || 1);
            return `<tr>
              <td>${fechaDD(m.fecha)}</td><td>${m.moneda || op.moneda}</td>
              <td style="text-align:right">${formatCurrency(Number(m.monto), m.moneda || op.moneda)}</td>
              <td style="text-align:right">${Number(m.cotizacion) || 1}</td>
              <td style="text-align:right">${formatCurrency(importeConsolidado, "ARS")}</td>
            </tr>`;
          }).join("")}</tbody>
          <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total Dep\u00F3sitos</td><td style="text-align:right;font-weight:700">${formatCurrency(totalDepositos, op.moneda)}</td></tr></tfoot>
        </table>
      </div>` : "";

    // ── Retenciones table ──
    const retencionesItems: {fecha: string; desc: string; monto: number}[] = [];
    if (totalRetGan > 0) retencionesItems.push({ fecha: op.fecha, desc: `Retenci\u00F3n Ganancias (${op.retencion_ganancias_pct}%)`, monto: totalRetGan });

    const retencionesHtml = retencionesItems.length > 0 ? `
      <div class="section">
        <div class="section-title">Retenciones</div>
        <table class="bordered">
          <thead><tr><th>Fecha</th><th>Descripci\u00F3n</th><th>Moneda</th><th style="text-align:right">Importe</th></tr></thead>
          <tbody>${retencionesItems.map(r => `<tr><td>${fechaDD(r.fecha)}</td><td>${r.desc}</td><td>${op.moneda}</td><td style="text-align:right">${formatCurrency(r.monto, op.moneda)}</td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700">Total Retenciones</td><td style="text-align:right;font-weight:700">${formatCurrency(totalRetenciones, op.moneda)}</td></tr></tfoot>
        </table>
      </div>` : "";

    // ── Certificado de Retención Ganancias (página 2) ──
    const certRetGanHtml = totalRetGan > 0 ? `
      <div class="page-break"></div>
      <div class="cert-page">
        <div class="cert-header">
          <div class="cert-logo">${socNombre}</div>
          <div class="cert-title-block">
            <div class="cert-main-title">CERT. RET. IMPUESTO A LAS GANANCIAS</div>
            <table class="cert-info-table">
              <tr><td>Original</td><td>N\u00B0: ${op.numero || "\u2014"}</td></tr>
              <tr><td>Fecha: ${fechaDD(op.fecha)}</td><td>CUIT: ${socCuit}</td></tr>
            </table>
          </div>
        </div>

        <div class="cert-section">
          <div class="cert-section-title">A - Datos del agente de retenci\u00F3n</div>
          <table class="cert-data">
            <tr><td class="cert-label">Raz\u00F3n Social:</td><td>${socNombre}</td></tr>
            <tr><td class="cert-label">CUIT:</td><td>${socCuit}</td></tr>
            <tr><td class="cert-label">Direcci\u00F3n:</td><td>${socDir}</td></tr>
          </table>
        </div>

        <div class="cert-section">
          <div class="cert-section-title">B - Datos del sujeto retenido</div>
          <table class="cert-data">
            <tr><td class="cert-label">Raz\u00F3n Social:</td><td>${op.proveedor_nombre}</td></tr>
            <tr><td class="cert-label">CUIT:</td><td>${provCuit ? fmtCuit(provCuit) : "\u2014"}</td></tr>
            <tr><td class="cert-label">Direcci\u00F3n:</td><td>${provDir || "\u2014"}</td></tr>
          </table>
        </div>

        <div class="cert-section">
          <div class="cert-section-title">C - Datos de la retenci\u00F3n</div>
          <table class="cert-data">
            <tr><td class="cert-label">R\u00E9gimen:</td><td>78 - Anexo II, inc. f) Enajenaci\u00F3n de bienes muebles y bienes de cambio</td></tr>
            <tr><td class="cert-label">Importe sujeto a retenci\u00F3n:</td><td>${formatCurrency(op.monto_bruto, op.moneda)}</td></tr>
            <tr><td class="cert-label">Importe retenido:</td><td style="font-weight:700">${formatCurrency(totalRetGan, op.moneda)}</td></tr>
            <tr><td class="cert-label">Documentos que originan la retenci\u00F3n:</td><td>${op.numero || "\u2014"} (${formatCurrency(totalGeneral, op.moneda)})</td></tr>
          </table>
        </div>

        <div class="cert-letras">
          ${montoEnLetras(totalRetGan)}
        </div>

        <div class="firma-line">
          <div class="firma-placeholder"></div>
          <div class="firma-text">Firma y aclaraci\u00F3n</div>
        </div>
      </div>
    ` : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Orden de Pago ${op.numero || ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px 40px; color: #333; font-size: 12px; line-height: 1.4; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #333; }
  .header-left { }
  .header-left .empresa { font-size: 14px; font-weight: 700; }
  .header-left .dato { font-size: 11px; color: #555; margin-top: 1px; }
  .header-right { text-align: right; font-size: 11px; }
  .header-right .dato { margin-bottom: 1px; }

  .op-title { text-align: center; font-size: 16px; font-weight: 700; margin: 16px 0; letter-spacing: 0.5px; }

  .proveedor-bar { background: #e8e8e8; text-align: center; padding: 6px 12px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }

  .section { margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; color: #444; border-bottom: 1px solid #ccc; padding-bottom: 2px; }

  table.bordered { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 4px; }
  table.bordered th { background: #f0f0f0; border: 1px solid #bbb; padding: 4px 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
  table.bordered td { border: 1px solid #ccc; padding: 4px 6px; }
  table.bordered tfoot td { border-top: 2px solid #999; background: #f8f8f8; }

  .totals-box { border: 2px solid #333; padding: 10px 16px; margin-top: 16px; }
  .totals-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 12px; }
  .totals-row.grand { border-top: 2px solid #333; margin-top: 6px; padding-top: 6px; font-size: 14px; font-weight: 700; }
  .totals-row .label { }
  .totals-row .value { font-weight: 600; }

  .letras { font-size: 11px; margin-top: 8px; font-style: italic; color: #555; }

  .firma-line { margin-top: 60px; text-align: center; }
  .firma-placeholder { border-top: 1px solid #333; width: 250px; margin: 0 auto; }
  .firma-text { font-size: 11px; color: #666; margin-top: 4px; }

  .page-break { page-break-before: always; margin-top: 40px; }

  /* Certificado retenci\u00F3n */
  .cert-page { padding-top: 20px; }
  .cert-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 16px; }
  .cert-logo { font-size: 16px; font-weight: 700; }
  .cert-title-block { text-align: right; }
  .cert-main-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
  .cert-info-table { font-size: 11px; }
  .cert-info-table td { padding: 1px 8px; }
  .cert-section { margin-bottom: 14px; }
  .cert-section-title { font-size: 12px; font-weight: 700; background: #e8e8e8; padding: 4px 8px; margin-bottom: 6px; }
  .cert-data { font-size: 12px; width: 100%; }
  .cert-data td { padding: 2px 8px; }
  .cert-label { font-weight: 600; width: 220px; color: #444; }
  .cert-letras { font-size: 11px; font-style: italic; color: #555; margin-top: 12px; border: 1px solid #ccc; padding: 8px; background: #fafafa; }

  .no-print { }
  .print-btn { margin-top: 20px; text-align: center; }
  .print-btn button { padding: 8px 28px; background: #FF4500; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px; }

  @media print {
    body { margin: 0; padding: 20px; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }
</style>
</head><body>

<!-- P\u00C1GINA 1: ORDEN DE PAGO -->
<div class="header">
  <div class="header-left">
    <div class="empresa">${socNombre}</div>
    <div class="dato">CUIT: ${socCuit}</div>
    <div class="dato">${socDir}</div>
  </div>
  <div class="header-right">
    <div class="dato"><strong>Hoja:</strong> 1</div>
    <div class="dato"><strong>Fecha:</strong> ${fechaDD(op.fecha)}</div>
    ${socTel ? `<div class="dato"><strong>Tel\u00E9fono:</strong> ${socTel}</div>` : ""}
  </div>
</div>

<div class="op-title">Orden de Pago N\u00B0 ${op.numero || "\u2014"}</div>

<div class="proveedor-bar">Proveedor: ${op.proveedor_nombre}</div>

<div class="section">
  <div class="section-title">Documentos abonados</div>
  ${fcsHtml}
</div>

${chequesHtml}
${depositosHtml}
${retencionesHtml}

<div class="totals-box">
  <div class="totals-row"><span class="label">Total Redondeo:</span><span class="value">${formatCurrency(0, op.moneda)}</span></div>
  <div class="totals-row grand"><span class="label">Total:</span><span class="value">${formatCurrency(totalGeneral, op.moneda)}</span></div>
</div>

<div class="letras">${montoEnLetras(totalGeneral)}</div>

<div class="firma-line">
  <div class="firma-placeholder"></div>
  <div class="firma-text">Firma y aclaraci\u00F3n</div>
</div>

${certRetGanHtml}

<div class="print-btn no-print">
  <button onclick="window.print()">Imprimir</button>
</div>

</body></html>`;
    const w = window.open("", "_blank", "width=800,height=700");
    if (w) { w.document.write(html); w.document.close(); }
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
        await (supabase as any).from("ordenes_pago").update({ certificado_retencion_url: publicUrl }).eq("id", opId);
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
        const { error } = await (supabase as any).from("gastos_manuales").update(payload).eq("id", gmEditingId);
        if (error) throw error;
      } else {
        // Insert new gasto
        if (sociedadActiva?.id) payload.sociedad_id = sociedadActiva.id;
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
          await supabase.from("movimientos").insert(movData as any);
        } catch (movErr) {
          console.warn("Gasto creado pero error al registrar movimiento:", movErr);
        }
      }

      setGmModalOpen(false);
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
      const { error } = await (supabase as any).from("gastos_manuales").delete().eq("id", id);
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
    ? fcItems.reduce((sum, it) => sum + (it.cantidad * it.precio_unitario) * ((it.iva_porcentaje ?? 21) / 100), 0)
    : fcForm.subtotal * (fcForm.iva_porcentaje / 100);
  const fcTotal = fcForm.subtotal + fcIva + fcForm.percepciones;
  // Group items by IVA rate for display
  const fcIvaByRate: Record<number, number> = {};
  if (fcItems.length > 0) {
    for (const it of fcItems) {
      const lineSubtotal = it.cantidad * it.precio_unitario;
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
        const parsedItems: FCItem[] = d.items.map((it: { descripcion?: string; cantidad?: number; precio_unitario?: number; iva_porcentaje?: number; unidad?: string }, idx: number) => ({
          tempId: `pdf-${Date.now()}-${idx}`,
          producto_id: "",
          codigo: "",
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 1,
          precio_unitario: Number(it.precio_unitario) || 0,
          unidad: it.unidad || "UN",
          iva_porcentaje: Number(it.iva_porcentaje) || 21,
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
    if (!fcForm.proveedor_id) { setFcError("Seleccioná un proveedor"); return; }
    if (!fcForm.numero_factura.trim()) { setFcError("El número de factura es obligatorio"); return; }
    if (fcForm.subtotal <= 0) { setFcError("El subtotal debe ser mayor a 0"); return; }
    const isMercaderia = fcForm.tipo_fc === "mercaderia";
    setFcSaving(true);
    setFcError("");
    try {
      const insertData: Record<string, unknown> = {
        numero_factura: fcForm.numero_factura.trim(),
        proveedor_id: fcForm.proveedor_id,
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
      };
      if (fcForm.orden_compra_id && isMercaderia) insertData.orden_compra_id = fcForm.orden_compra_id;
      if (fcForm.fecha_vencimiento) insertData.fecha_vencimiento = fcForm.fecha_vencimiento;
      if (fcForm.cae.trim()) insertData.cae = fcForm.cae.trim();
      if (fcForm.percepciones_detalle.length > 0) insertData.percepciones_detalle = JSON.stringify(fcForm.percepciones_detalle);
      if (fcForm.costo_real > 0) insertData.costo_real = fcForm.costo_real;
      if (profile?.id) insertData.created_by = profile.id;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

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
          unidad: it.unidad,
          iva_porcentaje: it.iva_porcentaje,
          sociedad_id: sociedadActiva?.id || null,
        }));
        await (supabase as any).from("facturas_compra_items").insert(itemsToInsert);

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
          await (supabase as any).from("facturas_compra").update({ archivo_url: urlData.publicUrl, archivo_nombre: fcFile.name }).eq("id", fcData.id);
        }
        setFcUploading(false);
      }

      // Create gasto_manual for solo_iva with costo_real
      if (fcForm.tipo_fc === "solo_iva" && fcForm.costo_real > 0 && fcData?.id) {
        await (supabase as any).from("gastos_manuales").insert({
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
    try {
      const { error } = await (supabase as any).from("facturas_compra").delete().eq("id", id);
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

  async function handleAnularFC(id: string) {
    if (!confirm("¿Seguro que querés anular esta factura?")) return;
    try {
      const { error } = await (supabase as any).from("facturas_compra").update({ estado: "anulada" }).eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) { console.error("Error anulando FC:", err); alert("Error al anular FC: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handleRecibirFC(id: string) {
    try {
      // FC de compra NO mueve stock — stock solo lo mueven las OC y las ventas
      const { error: updErr } = await (supabase as any).from("facturas_compra").update({ estado: "recibida" }).eq("id", id);
      if (updErr) throw updErr;
      alert("FC marcada como recibida");
      await fetchData();
    } catch (err) { console.error("Error marcando FC como recibida:", err); alert("Error al marcar FC como recibida: " + (err as any)?.message); }
  }

  function startEditFC(fc: FacturaCompraRow) {
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
      const { error } = await (supabase as any).from("facturas_compra").update(updateData).eq("id", selectedFC.id);
      if (error) throw error;
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
    setSavingOP(true);
    try {
      const updateData: Record<string, any> = {
        fecha: editOPForm.fecha,
        moneda: editOPForm.moneda,
        notas: editOPForm.notas,
      };
      const { error } = await (supabase as any).from("ordenes_pago").update(updateData).eq("id", selectedOP.id);
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

  // OCs filtered by selected proveedor (for optional linking)
  const filteredOCsForFC = fcForm.proveedor_id
    ? ocOptions.filter(oc => oc.proveedor_id === fcForm.proveedor_id)
    : ocOptions;

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
      let qF = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, vencimiento, total, total_acreditado, moneda, estado").eq("cliente_id", cliente.id).in("estado", ["emitida", "pagada", "parcial"]).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qF = qF.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: fData } = await qF;
      if (fData) setCcDetailFacturas(fData.map((f: any) => ({ id: f.id, numero: f.numero ?? "", tipo: f.tipo ?? "", punto_venta: f.punto_venta ?? 0, fecha: f.fecha, vencimiento: f.vencimiento, total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), moneda: f.moneda ?? "ARS", estado: f.estado })));
      let qM = supabase.from("movimientos").select("id, tipo, monto, moneda, descripcion, fecha, referencia").eq("cliente_id" as any, cliente.id).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qM = qM.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: mData } = await qM;
      if (mData) setCcDetailMovimientos(mData.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: Number(m.monto), moneda: m.moneda ?? "ARS", descripcion: m.descripcion ?? "", fecha: m.fecha, referencia: m.referencia ?? null })));
    } catch (err) { console.error("CC detail err:", err); } finally { setCcDetailLoading(false); }
  }
  async function fetchCCDetailProveedor(prov: CCRow) {
    setCcDetailProveedor(prov); setCcDetailProvLoading(true); setCcDetailFCProv([]); setCcDetailMovProv([]);
    try {
      let qFC = (supabase as any).from("facturas_compra").select("id, numero_factura, fecha, fecha_vencimiento, total, estado, moneda").eq("proveedor_id", prov.id).in("estado", ["pendiente", "pagada", "recibida"]).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qFC = qFC.eq("sociedad_id", sociedadActiva.id);
      const { data: fcData } = await qFC;
      if (fcData) setCcDetailFCProv(fcData.map((f: any) => ({ id: f.id, numero_factura: f.numero_factura ?? "", fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento, total: Number(f.total), estado: f.estado, moneda: f.moneda ?? "ARS" })));
      let qM = supabase.from("movimientos").select("id, tipo, monto, moneda, descripcion, fecha, referencia").eq("proveedor_id" as any, prov.id).order("fecha", { ascending: false });
      if (sociedadActiva?.id) qM = qM.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: mData } = await qM;
      if (mData) setCcDetailMovProv(mData.map((m: any) => ({ id: m.id, tipo: m.tipo, monto: Number(m.monto), moneda: m.moneda ?? "ARS", descripcion: m.descripcion ?? "", fecha: m.fecha, referencia: m.referencia ?? null })));
    } catch (err) { console.error("CC prov detail err:", err); } finally { setCcDetailProvLoading(false); }
  }
  async function openCobroMultiple() {
    if (!ccDetailCliente) return;
    setCobroMultiOpen(true); setCobroMultiLiqOpen(false);
    try {
      let q = (supabase as any).from("facturas").select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, estado").eq("cliente_id", ccDetailCliente.id).in("estado", ["emitida", "parcial"]).order("fecha", { ascending: true });
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q;
      if (data && data.length > 0) {
        const ids = data.map((f: any) => f.id);
        const { data: movs } = await (supabase as any).from("movimientos").select("factura_id, monto").in("factura_id", ids);
        const cobradoMap: Record<string, number> = {};
        (movs || []).forEach((m: any) => { cobradoMap[m.factura_id] = (cobradoMap[m.factura_id] || 0) + Number(m.monto); });
        setCobroMultiFCs(data.map((f: any) => { const cobrado = cobradoMap[f.id] || 0; const saldo = Math.max(0, Number(f.total) - Number(f.total_acreditado || 0) - cobrado); return { id: f.id, numero: f.numero ?? "", tipo: f.tipo ?? "", punto_venta: f.punto_venta ?? 0, fecha: f.fecha, subtotal: Number(f.subtotal || 0), iva: Number(f.iva || 0), total: Number(f.total), total_acreditado: Number(f.total_acreditado || 0), moneda: f.moneda ?? "ARS", saldo, selected: false }; }).filter((f: CobroMultiFC) => f.saldo > 0.01));
      }
    } catch { /* noop */ }
  }
  function cobroMultiOpenLiquidacion() {
    const selected = cobroMultiFCs.filter(f => f.selected);
    if (selected.length === 0) { alert("Seleccioná al menos una factura"); return; }
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
    setManualMovSaving(true); setManualMovError("");
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const movData: Record<string, unknown> = { tipo: manualMovForm.tipo_mov === "credito" ? "cobro" : "pago", descripcion: `[Ajuste manual] ${manualMovForm.descripcion}`, monto: manualMovForm.monto, moneda: manualMovForm.moneda, fecha: manualMovForm.fecha, conciliado: false, referencia: "ajuste_manual" };
      if (manualMovTarget === "cliente") (movData as any).cliente_id = manualMovTargetId; else (movData as any).proveedor_id = manualMovTargetId;
      if (sociedadActiva?.id) (movData as any).sociedad_id = sociedadActiva.id;
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
    setManualMovForm({ monto: 0, descripcion: "", fecha: new Date().toISOString().slice(0, 10), tipo_mov: "credito", moneda: "ARS" }); setManualMovError(""); setManualMovOpen(true);
  }
  function openManualMovForProveedor(prov: CCRow) {
    setManualMovTarget("proveedor"); setManualMovTargetId(prov.id); setManualMovTargetName(prov.razon_social);
    setManualMovForm({ monto: 0, descripcion: "", fecha: new Date().toISOString().slice(0, 10), tipo_mov: "credito", moneda: "ARS" }); setManualMovError(""); setManualMovOpen(true);
  }

  // ── Mov modal filtered lists ──
  const filteredMovClientes = movClienteSearch.trim()
    ? clientesOptions.filter((c: ClienteOption) => c.razon_social.toLowerCase().includes(movClienteSearch.toLowerCase()))
    : clientesOptions;
  const filteredMovProvs = movProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(movProvSearch.toLowerCase()))
    : proveedoresOptions;

  // ── Echeq handlers ──
  const filteredEcheqs = echeqFilterEstado ? echeqs.filter(e => e.estado === echeqFilterEstado) : echeqs;
  const echeqsEnCartera = echeqs.filter(e => e.estado === "en_cartera");
  const echeqsMontoCartera = echeqsEnCartera.reduce((s, e) => s + e.monto, 0);
  const today = new Date().toISOString().slice(0, 10);
  const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const echeqsPorVencer = echeqsEnCartera.filter(e => e.fecha_pago >= today && e.fecha_pago <= sevenDays).length;

  const filteredClientesEcheq = echeqClienteSearch.trim()
    ? clientesOptions.filter((c: ClienteOption) => c.razon_social.toLowerCase().includes(echeqClienteSearch.toLowerCase()))
    : clientesOptions;

  async function handleCreateEcheq() {
    if (!echeqForm.numero.trim()) { setEcheqError("El numero es obligatorio"); return; }
    if (echeqForm.monto <= 0) { setEcheqError("El monto debe ser mayor a 0"); return; }
    setEcheqSaving(true); setEcheqError("");
    try {
      const row: Record<string, unknown> = {
        tipo_cheque: echeqForm.tipo_cheque, numero: echeqForm.numero.trim(),
        banco_emisor: echeqForm.banco_emisor || null,
        cuit_emisor: echeqForm.cuit_emisor || null, monto: echeqForm.monto,
        moneda: echeqForm.moneda, fecha_emision: echeqForm.fecha_emision || null,
        fecha_pago: echeqForm.fecha_pago, estado: "en_cartera",
        observaciones: echeqForm.observaciones || null,
      };
      if (echeqForm.origen_tipo === "cliente" && echeqForm.origen_id) {
        row.origen_tipo = "cliente"; row.origen_id = echeqForm.origen_id;
        row.origen_nombre = clientesOptions.find((c: ClienteOption) => c.id === echeqForm.origen_id)?.razon_social || "";
      } else if (echeqForm.origen_nombre) {
        row.origen_tipo = "otro"; row.origen_nombre = echeqForm.origen_nombre;
      }
      if (sociedadActiva?.id) row.sociedad_id = sociedadActiva.id;
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
      const { error } = await (supabase as any).from("echeqs").update(updates).eq("id", echeq.id);
      if (error) throw error;
      setSelectedEcheq(null); setEcheqActionModal(null); setEcheqDestinoId(""); setEcheqDestinoNombre(""); setEcheqProvSearch("");
      await fetchData();
    } catch (err) { alert("Error: " + (err instanceof Error ? err.message : String(err))); }
    finally { setEcheqActionSaving(false); }
  }

  async function handleDeleteEcheq(id: string) {
    if (!confirm("¿Seguro que querés eliminar este cheque?")) return;
    try { const { error } = await (supabase as any).from("echeqs").delete().eq("id", id); if (error) throw error; await fetchData(); }
    catch (err) { console.error(err); alert("Error al eliminar cheque: " + (err as any)?.message); }
  }

  // ── Derived calculations ──
  const currentMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires", year: "numeric", month: "2-digit" }).slice(0, 7);
  const movimientosMes = movimientos.filter((m) => m.fecha?.startsWith(currentMonth));
  const movimientosMesARS = movimientosMes.filter((m) => !m.moneda || m.moneda === "ARS");
  const movimientosMesUSD = movimientosMes.filter((m) => m.moneda === "USD");
  const totalCobrosARS = movimientosMesARS.filter((m) => ["cobro", "cheque_recibido", "transferencia"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagosARS = movimientosMesARS.filter((m) => ["pago", "cheque_emitido"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalCobrosUSD = movimientosMesUSD.filter((m) => ["cobro", "cheque_recibido", "transferencia"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagosUSD = movimientosMesUSD.filter((m) => ["pago", "cheque_emitido"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalCobros = totalCobrosARS;
  const totalPagos = totalPagosARS;
  const sinConciliar = movimientos.filter((m) => !m.conciliado).length;

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

  const totalDisponibleCredito = lineasCredito.reduce((a, lc) => a + lc.monto_disponible, 0);
  const totalUtilizadoCredito = lineasCredito.reduce((a, lc) => a + lc.monto_utilizado, 0);
  const totalLineas = lineasCredito.reduce((a, lc) => a + lc.monto_total, 0);

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
    { id: "facturas_compra", label: "Fact. Compra" },
    { id: "facturacion", label: "Fact. Ventas" },
    // { id: "ordenes_pago", label: "OP" },  // OCULTO: OP se accede desde FC compra
    { id: "gastos_manuales", label: "Gastos" },
    { id: "echeqs", label: "Cheques" },
    { id: "cc_clientes", label: "CC Clientes" },
    { id: "cc_proveedores", label: "CC Prov." },
    { id: "extractos", label: "Extractos" },
    { id: "lineas_credito", label: "Crédito" },
    // { id: "gastos_fijos", label: "G. Fijos" },  // OCULTO: funcionalidad en revisión
    { id: "objetivos", label: "Objetivos" },
  ];

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

  return (
    <>
      <Header title="Finanzas" subtitle="Cuentas corrientes, cobros, conciliacion y credito" action={{ label: "Nuevo movimiento", onClick: () => { setMovForm(emptyMovForm); setFormError(""); setModalOpen(true); } }} />
      <div className="p-4 sm:p-8 space-y-6">
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
          <StatCard title="Credito disponible" value={formatCurrency(totalDisponibleCredito)} icon={CreditCard} iconColor="text-emerald-600" />
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
              <button key={t.id} onClick={() => { setTab(t.id); setCcDetailCliente(null); setCcDetailProveedor(null); }}
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
                  return <span className={`font-mono font-semibold block text-right ${isIngreso ? "text-emerald-600" : isEgreso ? "text-red-600" : "text-zinc-700 dark:text-zinc-300"}`}>{isIngreso ? "+" : isEgreso ? "-" : ""}{formatCurrency(row.monto, row.moneda as "ARS" | "USD")}</span>;
                }},
                { key: "conciliado", label: "Conciliado", sortable: true, render: (row) => <Badge variant={row.conciliado ? "success" : "warning"}>{row.conciliado ? "Si" : "Pendiente"}</Badge> },
                { key: "actions", label: "", sortable: false, render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {!row.conciliado && (
                      <button onClick={() => handleConciliar(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Conciliar">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
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
                    <p className="font-mono text-lg font-bold">{formatCurrency(selectedMov.monto, (selectedMov.moneda || "ARS") as "ARS" | "USD")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Fecha</p>
                    <p className="font-medium">{formatDate(selectedMov.fecha)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Estado</p>
                    <Badge variant={selectedMov.conciliado ? "success" : "warning"}>
                      {selectedMov.conciliado ? "Conciliado" : "Pendiente"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400 uppercase">Entidad</p>
                    <p className="font-medium">{selectedMov.clientes?.razon_social || selectedMov.proveedores?.razon_social || "—"}</p>
                  </div>
                </div>

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
                  {!selectedMov.conciliado && (
                    <button onClick={async () => { await handleConciliar(selectedMov.id); setSelectedMov({ ...selectedMov, conciliado: true }); }}
                      className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                      <CheckCircle2 className="h-4 w-4" /> Conciliar
                    </button>
                  )}
                  <button onClick={() => { handleDeleteMov(selectedMov.id); setSelectedMov(null); }}
                    className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 className="h-4 w-4" /> Eliminar
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Facturas de Compra ── */}
        {tab === "facturas_compra" && (() => {
          const fcsPendientesAprobacion = facturasCompra.filter(f => f.estado === "pendiente_aprobacion");
          const filteredFC = facturasCompra.filter(f => {
            if (fcEstadoFilter !== "todos" && f.estado !== fcEstadoFilter) return false;
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
                <button onClick={() => setFcEstadoFilter("pendiente_aprobacion")}
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
                <button onClick={() => { setTab("ordenes_pago"); openOPModal(); }} className="flex items-center gap-1.5 rounded-lg border border-orange-500 px-3 py-2 text-sm font-medium text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-colors">
                  <FileText className="h-4 w-4" /> Nueva OP
                </button>
                <button onClick={openFCModal} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                  <Plus className="h-4 w-4" /> Nueva factura de compra
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
              <select value={fcEstadoFilter} onChange={(e) => setFcEstadoFilter(e.target.value as any)}
                className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                <option value="todos">Todos los estados</option>
                <option value="pendiente_aprobacion">Pend. aprobacion</option>
                <option value="pendiente">Pendiente</option>
                <option value="pagada">Pagada</option>
                <option value="recibida">Recibida</option>
                <option value="anulada">Anulada</option>
              </select>
              {(fcSearchQuery || fcEstadoFilter !== "todos") && (
                <span className="text-xs text-zinc-500">{filteredFC.length} de {facturasCompra.length}</span>
              )}
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<FacturaCompraRow>
                columns={[
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "fecha_vencimiento", label: "Vencimiento", sortable: true, render: (row) => row.fecha_vencimiento ? <span className="text-zinc-500 text-xs">{formatDate(row.fecha_vencimiento)}</span> : <span className="text-zinc-300">—</span> },
                  { key: "numero_factura", label: "Nro. Factura", sortable: true, render: (row) => <span className="font-mono font-medium">{row.numero_factura}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => (
                    <div>
                      <span className="font-medium">{row.proveedor_nombre}</span>
                      {row.oc_numero && <p className="text-xs text-zinc-400">OC: {row.oc_numero}</p>}
                      {row.ocs_vinculadas && row.ocs_vinculadas.length > 0 && !row.oc_numero && (
                        <p className="text-xs text-zinc-400">OC: {row.ocs_vinculadas.map(o => o.numero).join(", ")}</p>
                      )}
                      {row.tipo === "solo_iva" ? <Badge variant="purple">Solo IVA</Badge> : <Badge variant="info">Mercadería</Badge>}
                      {row.tipo === "solo_iva" && (row.costo_real ?? 0) > 0 && (
                        <p className="text-xs text-blue-500 mt-0.5">Costo real: {formatCurrency(row.costo_real!, row.moneda)}</p>
                      )}
                    </div>
                  )},
                  { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.total, row.moneda)}</span> },
                  { key: "estado", label: "Estado", sortable: true, render: (row) => (
                    <Badge variant={row.estado === "pagada" ? "success" : row.estado === "anulada" ? "danger" : row.estado === "recibida" ? "info" : row.estado === "pendiente_aprobacion" ? "orange" : "warning"}>
                      {row.estado === "pagada" ? "Pagada" : row.estado === "anulada" ? "Anulada" : row.estado === "recibida" ? "Recibida" : row.estado === "pendiente_aprobacion" ? "Por aprobar" : "Pendiente"}
                    </Badge>
                  )},
                  { key: "op_vinculada" as any, label: "OP", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {row.op_vinculada ? (
                        <button onClick={() => { setTab("ordenes_pago"); setTimeout(() => { const op = ordenesPago.find(o => o.id === row.op_vinculada!.id); if (op) setSelectedOP(op); }, 100); }}
                          className="flex items-center gap-1 text-xs" title="Ver orden de pago">
                          <Badge variant={row.op_vinculada.estado === "pagada" ? "success" : row.op_vinculada.estado === "anulada" ? "danger" : "warning"}>
                            {row.op_vinculada.numero || "OP"}
                          </Badge>
                        </button>
                      ) : (row.estado === "pendiente" || row.estado === "recibida") ? (
                        <button onClick={() => handlePagarFC(row.id)} className="rounded px-2 py-1 text-xs text-orange-600 border border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20 font-medium" title="Crear orden de pago">
                          + OP
                        </button>
                      ) : (
                        <span className="text-zinc-300 text-xs">—</span>
                      )}
                    </div>
                  )},
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
                    const medioLabel = (t: string) => t === "transferencia" ? "Transf." : t === "cheque" ? "Cheque" : t === "cheque_propio" ? "Ch. propio" : t === "echeq" ? "E-Cheq" : t === "deposito" ? "Depósito" : t === "efectivo" ? "Efectivo" : t;
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
                      {row.certificado_retencion_url && (
                        <span title="Certificado de retención adjunto" className="text-violet-500"><Paperclip className="h-3.5 w-3.5" /></span>
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
                      {row.estado === "pendiente" && (
                        <>
                          <button onClick={() => handlePagarOP(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar como pagada">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleAnularOP(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )},
                ]}
                data={ordenesPago}
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
                </div>
                <Card className="p-0 overflow-hidden">
                  <DataTable<CCRow>
                    columns={[
                      { key: "razon_social", label: "Cliente", sortable: true, render: (row) => <span className="font-medium">{row.razon_social}</span> },
                      { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                      { key: "dias_cuenta_corriente", label: "Dias CC", sortable: true, render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                      { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago}</Badge> },
                      { key: "limite_credito", label: "Limite", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limite_credito)}</span> },
                      { key: "saldo_cuenta_corriente", label: "Nos debe", className: "text-right", sortable: true, render: (row) => {
                        const pct = row.limite_credito ? (row.saldo_cuenta_corriente / row.limite_credito) * 100 : 0;
                        return (<div className="text-right"><span className={`font-mono font-semibold ${pct > 80 ? "text-red-600" : ""}`}>{formatCurrency(row.saldo_cuenta_corriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
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
                          { key: "numero", label: "Comprobante", sortable: true, render: (row) => <span className="font-mono text-xs">{row.tipo}{String(row.punto_venta).padStart(5, "0")}-{String(row.numero).padStart(8, "0")}</span> },
                          { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(row.total, row.moneda as "ARS" | "USD")}</span> },
                          { key: "total_acreditado" as any, label: "Saldo", className: "text-right", render: (row) => { const saldo = row.total - row.total_acreditado; return <span className={`font-mono font-semibold block text-right ${saldo > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(saldo, row.moneda as "ARS" | "USD")}</span>; }},
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
                          { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className={`font-mono font-semibold block text-right ${row.tipo === "cobro" || row.tipo === "cheque_recibido" ? "text-emerald-600" : "text-red-600"}`}>{formatCurrency(row.monto, row.moneda as "ARS" | "USD")}</span> },
                          { key: "referencia", label: "Ref.", render: (row) => row.referencia ? <span className="text-xs text-zinc-400">{row.referencia}</span> : <span className="text-xs text-zinc-300">—</span> },
                        ]}
                        data={ccDetailMovimientos}
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
              </div>
              <Card className="p-0 overflow-hidden">
                <DataTable<CCRow>
                  columns={[
                    { key: "razon_social", label: "Proveedor", sortable: true, render: (row) => <span className="font-medium">{row.razon_social}</span> },
                    { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                    { key: "rubro", label: "Rubro", render: (row) => <Badge variant="info">{(row.rubro ?? "").split(" ")[0]}</Badge> },
                    { key: "dias_cuenta_corriente", label: "Dias CC", sortable: true, render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                    { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago}</Badge> },
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
                      { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className={`font-mono font-semibold block text-right ${row.tipo === "pago" ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(row.monto, row.moneda as "ARS" | "USD")}</span> },
                      { key: "referencia", label: "Ref.", render: (row) => row.referencia ? <span className="text-xs text-zinc-400">{row.referencia}</span> : <span className="text-xs text-zinc-300">—</span> },
                    ]}
                    data={ccDetailMovProv}
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
              <StatCard title="En cartera" value={`${echeqsEnCartera.length} — ${formatCurrency(echeqsMontoCartera)}`} icon={Wallet} iconColor="text-blue-600" />
              <StatCard title="Por vencer (7 días)" value={String(echeqsPorVencer)} icon={Clock} iconColor="text-amber-500" />
              <StatCard title="Endosados" value={String(echeqs.filter(e => e.estado === "endosado").length)} icon={ArrowUpRight} iconColor="text-purple-500" />
              <StatCard title="Cobrados" value={String(echeqs.filter(e => e.estado === "cobrado").length)} icon={CheckCircle2} iconColor="text-green-600" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
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
            <Card className="p-0 overflow-hidden">
              <DataTable<EcheqRow>
                columns={[
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
                  { key: "destino_nombre", label: "Destino", render: (row) => <span className="text-sm">{row.destino_nombre || "—"}</span> },
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {row.estado === "en_cartera" && (
                        <>
                          <button onClick={() => { setSelectedEcheq(row); setEcheqActionModal("endosar"); }} className="rounded p-1.5 text-zinc-400 hover:bg-purple-100 hover:text-purple-600" title="Endosar"><ArrowUpRight className="h-3.5 w-3.5" /></button>
                          <button onClick={() => { setSelectedEcheq(row); setEcheqActionModal("depositar"); }} className="rounded p-1.5 text-zinc-400 hover:bg-amber-100 hover:text-amber-600" title="Depositar"><Landmark className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleEcheqAction("cobrar", row)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar cobrado"><CheckCircle2 className="h-3.5 w-3.5" /></button>
                          <button onClick={() => handleEcheqAction("rechazar", row)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Rechazar"><Ban className="h-3.5 w-3.5" /></button>
                        </>
                      )}
                      <button onClick={() => handleDeleteEcheq(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  )},
                ]}
                data={filteredEcheqs}
                emptyMessage="No hay cheques registrados"
              />
            </Card>
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
                {/* Tipo de cheque */}
                <div>
                  <label className="text-xs font-medium text-zinc-500">Tipo de cheque</label>
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, tipo_cheque: "echeq" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.tipo_cheque === "echeq" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      E-Cheq (electrónico)
                    </button>
                    <button type="button" onClick={() => setEcheqForm({ ...echeqForm, tipo_cheque: "fisico" })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${echeqForm.tipo_cheque === "fisico" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      Cheque físico
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
                    <label className="text-xs font-medium text-zinc-500">Banco emisor</label>
                    <input value={echeqForm.banco_emisor} onChange={(e) => setEcheqForm({ ...echeqForm, banco_emisor: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
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
                  <div>
                    <label className="text-xs font-medium text-zinc-500">CUIT emisor</label>
                    <input value={echeqForm.cuit_emisor} onChange={(e) => setEcheqForm({ ...echeqForm, cuit_emisor: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
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
                <div>
                  <label className="text-xs font-medium text-zinc-500">Origen</label>
                  <div className="flex gap-2 mt-1 mb-2">
                    <button onClick={() => setEcheqForm({ ...echeqForm, origen_tipo: "cliente", origen_nombre: "" })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqForm.origen_tipo === "cliente" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Cliente</button>
                    <button onClick={() => setEcheqForm({ ...echeqForm, origen_tipo: "otro", origen_id: "" })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${echeqForm.origen_tipo === "otro" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Otro</button>
                  </div>
                  {echeqForm.origen_tipo === "cliente" ? (
                    <select value={echeqForm.origen_id} onChange={(e) => setEcheqForm({ ...echeqForm, origen_id: e.target.value })}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                      <option value="">Seleccionar cliente</option>
                      {clientesOptions.map((c: ClienteOption) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                    </select>
                  ) : (
                    <input value={echeqForm.origen_nombre} onChange={(e) => setEcheqForm({ ...echeqForm, origen_nombre: e.target.value })}
                      placeholder="Nombre del origen" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  )}
                </div>
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
        {tab === "extractos" && extracto && (
          <>
            <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-6 text-center dark:border-zinc-600 dark:bg-zinc-900">
              <Upload className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 font-medium text-zinc-700 dark:text-zinc-300">Arrastra un extracto o hace click para subir</p>
              <p className="text-sm text-zinc-400">Formatos: .xlsx, .xls, .csv, .pdf</p>
              <button className="mt-3 rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600">Seleccionar archivo</button>
            </div>

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
                      <span className={`font-mono font-semibold ${row.tipo === "credito" ? "text-emerald-600" : "text-red-600"}`}>{row.tipo === "credito" ? "+" : "-"}{formatCurrency(row.monto)}</span>
                    </div>
                  )},
                  { key: "estado", label: "Match", render: (row) => row.estado === "matcheado"
                    ? <div className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-emerald-500" /><Badge variant="success">Match</Badge></div>
                    : <div className="flex items-center gap-2"><Badge variant="warning">Pendiente</Badge><button className="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600">Matchear</button></div>
                  },
                ]}
                data={movsFiltrados}
              />
            </Card>
          </>
        )}

        {/* ── Lineas de credito ── */}
        {tab === "lineas_credito" && (
          <>
            <Card>
              <CardHeader><CardTitle>Uso global de credito</CardTitle><span className="text-sm text-zinc-500">{totalLineas > 0 ? Math.round((totalUtilizadoCredito / totalLineas) * 100) : 0}% utilizado</span></CardHeader>
              <div className="h-4 rounded-full bg-zinc-100 dark:bg-zinc-700"><div className="h-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${totalLineas > 0 ? (totalUtilizadoCredito / totalLineas) * 100 : 0}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs text-zinc-400"><span>Utilizado: {formatCurrency(totalUtilizadoCredito)}</span><span>Disponible: {formatCurrency(totalDisponibleCredito)}</span></div>
            </Card>

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
        {/* ── Facturación (embedded) ── */}
        {tab === "facturacion" && (
          <Suspense fallback={<div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-zinc-400" /></div>}>
            <FacturacionEmbed embedded />
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
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white">Nuevo movimiento</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
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
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateMov} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear movimiento
              </button>
            </div>
          </div>
        </>
      )}

      {/* Nueva Orden de Pago modal */}
      {opModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">Nueva Orden de Pago</h2>
              </div>
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {opError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{opError}</div>}
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
                        <button onClick={() => { setOpForm({ ...opForm, proveedor_id: "" }); setProveedorSearch(""); setOpProvCondicion(null); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
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
                                  onChange={() => {
                                    setOpFCPendientes(prev => prev.map(f => f.id === fc.id ? { ...f, selected: !f.selected, monto_a_pagar: !f.selected ? f.saldo_pendiente : 0 } : f));
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
                  {opMonthlyBase > 0 && opProvCondicion === "RI" && (
                    <p className="text-xs text-violet-600 dark:text-violet-400 mt-1">
                      Acumulado mes (base sin IVA): {formatCurrency(opMonthlyBase, opForm.moneda)} — Con esta OP: {formatCurrency(opMonthlyBase + opBaseSinIVA, opForm.moneda)}
                      {(opMonthlyBase + opBaseSinIVA) >= retencionConfig.minimo_ganancias && " → Aplica retención"}
                      {opMonthlyRetenido > 0 && ` (ya retenido: ${formatCurrency(opMonthlyRetenido, opForm.moneda)})`}
                    </p>
                  )}
                </div>
              )}

              {/* ── Retención Ganancias ── */}
              {opMontoBruto > 0 && (
                <div>
                  <div className="rounded-lg border border-violet-200 dark:border-violet-800 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Ret. Ganancias</label>
                      <button type="button" onClick={() => setOpForm({ ...opForm, aplica_ganancias: !opForm.aplica_ganancias, retencion_ganancias_pct: !opForm.aplica_ganancias ? retencionConfig.tasa_ganancias_ri : 0 })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full ${opForm.aplica_ganancias ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${opForm.aplica_ganancias ? "translate-x-4.5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                    {opForm.aplica_ganancias && (
                      <div className="flex items-center gap-2">
                        <input type="number" step="0.5" value={opForm.retencion_ganancias_pct || ""} onChange={(e) => setOpForm({ ...opForm, retencion_ganancias_pct: Number(e.target.value) })}
                          className="w-20 rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <span className="text-xs text-zinc-400">%</span>
                        {[2, 6, 28].map(pct => (
                          <button key={pct} type="button" onClick={() => setOpForm({ ...opForm, retencion_ganancias_pct: pct })}
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${opForm.retencion_ganancias_pct === pct ? "bg-violet-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{pct}%</button>
                        ))}
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
                        </select>
                        <input type="number" value={m.monto || ""} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, monto: Number(e.target.value) } : x))}
                          placeholder="Monto" className="w-28 rounded border border-zinc-200 px-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <input type="date" value={m.fecha} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, fecha: e.target.value } : x))}
                          className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        {(m.tipo === "cheque" || m.tipo === "cheque_propio" || m.tipo === "echeq") && (
                          <>
                            <input value={m.banco} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, banco: e.target.value } : x))}
                              placeholder="Banco" className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                            <input value={m.numero_cheque} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, numero_cheque: e.target.value } : x))}
                              placeholder="N° cheque" className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </>
                        )}
                        {m.tipo === "echeq" && (() => {
                          const enCartera = echeqs.filter(e => e.estado === "en_cartera");
                          return enCartera.length > 0 ? (
                            <select value={m.echeq_id || ""} onChange={(e) => {
                              const sel = enCartera.find(x => x.id === e.target.value);
                              setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, echeq_id: e.target.value || undefined, monto: sel ? sel.monto : x.monto, banco: sel?.banco_emisor || x.banco, numero_cheque: sel?.numero || x.numero_cheque } : x));
                            }} className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                              <option value="">Manual</option>
                              {enCartera.map(e => <option key={e.id} value={e.id}>{e.numero} — {formatCurrency(e.monto)}</option>)}
                            </select>
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
                  <label className="text-xs font-medium text-zinc-500">Comprobante (PDF)</label>
                  <div className="mt-1">
                    <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-orange-400 dark:border-zinc-600">
                      <Upload className="h-4 w-4" />{opFile ? opFile.name : "Adjuntar"}
                      <input type="file" accept=".pdf,.jpg,.png" className="hidden" onChange={(e) => setOpFile(e.target.files?.[0] || null)} />
                    </label>
                    {opFile && <button onClick={() => setOpFile(null)} className="text-xs text-red-400 mt-1">Quitar</button>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateOP} disabled={opSaving || !opForm.proveedor_id || (opMontoBruto <= 0)}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {opSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear Orden de Pago
              </button>
            </div>
          </div>
        </>
      )}

      {/* Nueva factura de compra modal */}
      {fcModalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setFcModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">Nueva Factura de Compra</h2>
              </div>
              <button onClick={() => setFcModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {/* Import from PDF */}
            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20 px-3 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                {fcPdfParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {fcPdfParsing ? "Procesando PDF con IA..." : "Importar desde PDF"}
                <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={fcPdfParsing}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleParseFCPdf(f); e.target.value = ""; }} />
              </label>
            </div>
            {fcError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{fcError}</div>}
            <div className="space-y-4">
              {/* Tipo de factura selector — ninguno mueve stock (stock se mueve desde PR→OC→Recepción) */}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setFcForm({ ...fcForm, tipo_fc: "mercaderia", solo_iva: false })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-colors ${fcForm.tipo_fc === "mercaderia" ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                  <ShoppingCart className={`h-5 w-5 ${fcForm.tipo_fc === "mercaderia" ? "text-orange-500" : "text-zinc-400"}`} />
                  <span className={`text-sm font-semibold ${fcForm.tipo_fc === "mercaderia" ? "text-orange-700 dark:text-orange-300" : "text-zinc-600 dark:text-zinc-300"}`}>Compra de mercadería</span>
                  <span className="text-xs text-zinc-400 text-center">Solo libro IVA, sin stock</span>
                </button>
                <button type="button" onClick={() => setFcForm({ ...fcForm, tipo_fc: "solo_iva", solo_iva: true })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition-colors ${fcForm.tipo_fc === "solo_iva" ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30" : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-300"}`}>
                  <FileText className={`h-5 w-5 ${fcForm.tipo_fc === "solo_iva" ? "text-blue-500" : "text-zinc-400"}`} />
                  <span className={`text-sm font-semibold ${fcForm.tipo_fc === "solo_iva" ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-300"}`}>Solo IVA / contable</span>
                  <span className="text-xs text-zinc-400 text-center">Solo libro IVA, sin stock</span>
                </button>
              </div>

              {/* Proveedor selector with search */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Proveedor *</label>
                <div className="relative mt-1">
                  <div className="flex items-center border border-zinc-200 rounded-lg dark:border-zinc-700 overflow-hidden">
                    <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                    <input
                      value={fcProvSearch}
                      onChange={(e) => { setFcProvSearch(e.target.value); if (fcForm.proveedor_id) setFcForm({ ...fcForm, proveedor_id: "", orden_compra_id: "" }); }}
                      onFocus={() => setFcProvFocused(true)}
                      onBlur={() => setTimeout(() => setFcProvFocused(false), 150)}
                      placeholder="Buscar proveedor..."
                      className="w-full px-2 py-2 text-sm bg-transparent dark:text-white outline-none"
                    />
                  </div>
                  {fcForm.proveedor_id && (
                    <div className="mt-1 flex items-center gap-1">
                      <Badge variant="success">{proveedoresOptions.find(p => p.id === fcForm.proveedor_id)?.razon_social}</Badge>
                      <button onClick={() => { setFcForm({ ...fcForm, proveedor_id: "", orden_compra_id: "" }); setFcProvSearch(""); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                  {!fcForm.proveedor_id && (fcProvFocused || fcProvSearch.trim()) && filteredProveedoresFC.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {filteredProveedoresFC.slice(0, 8).map(p => (
                        <button key={p.id} onClick={() => { setFcForm({ ...fcForm, proveedor_id: p.id, orden_compra_id: "" }); setFcProvSearch(p.razon_social); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">
                          {p.razon_social}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Numero de factura */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Número de factura *</label>
                <input value={fcForm.numero_factura} onChange={(e) => setFcForm({ ...fcForm, numero_factura: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: 0001-00012345" />
              </div>

              {/* Número + CAE */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">CAE (opcional)</label>
                  <input value={fcForm.cae} onChange={(e) => setFcForm({ ...fcForm, cae: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Número CAE del proveedor" />
                </div>
              </div>

              {/* Fecha y fecha vencimiento */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Fecha</label>
                  <input type="date" value={fcForm.fecha} onChange={(e) => setFcForm({ ...fcForm, fecha: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Fecha vencimiento</label>
                  <input type="date" value={fcForm.fecha_vencimiento} onChange={(e) => setFcForm({ ...fcForm, fecha_vencimiento: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
              </div>

              {/* Subtotal + Moneda */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Subtotal (neto gravado) *</label>
                  <input type="number" value={fcForm.subtotal || ""} onChange={(e) => setFcForm({ ...fcForm, subtotal: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={fcForm.moneda} onChange={(e) => setFcForm({ ...fcForm, moneda: e.target.value as "ARS" | "USD" })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {/* IVA % + Percepciones */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">% IVA {fcItems.length > 0 ? <span className="text-zinc-400">(por defecto)</span> : ""}</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" step="0.5" value={fcForm.iva_porcentaje || ""} onChange={(e) => setFcForm({ ...fcForm, iva_porcentaje: Number(e.target.value) })}
                      className="w-20 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    <span className="text-sm text-zinc-400">%</span>
                    <div className="flex gap-1 ml-1">
                      {[10.5, 21, 27].map(pct => (
                        <button key={pct} type="button" onClick={() => setFcForm({ ...fcForm, iva_porcentaje: pct })}
                          className={`rounded px-2 py-1 text-xs font-medium transition-colors ${fcForm.iva_porcentaje === pct ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>
                  {fcItems.length > 0 && new Set(fcItems.map(it => it.iva_porcentaje)).size > 1 && (
                    <p className="text-xs text-blue-500 mt-1">IVA se calcula por item (tasas mixtas detectadas)</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Percepciones (total)</label>
                  <input type="number" value={fcForm.percepciones || ""} onChange={(e) => setFcForm({ ...fcForm, percepciones: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="0" />
                </div>
              </div>

              {/* Percepciones desglose */}
              {(fcForm.percepciones > 0 || fcForm.percepciones_detalle.length > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-zinc-500">Detalle de percepciones</label>
                    <button type="button"
                      onClick={() => setFcForm({ ...fcForm, percepciones_detalle: [...fcForm.percepciones_detalle, { tipo: "iibb", monto: 0, localidad: "" }] })}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium">+ Agregar línea</button>
                  </div>
                  <div className="space-y-2">
                    {fcForm.percepciones_detalle.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select value={p.tipo}
                          onChange={(e) => { const d = [...fcForm.percepciones_detalle]; d[idx] = { ...d[idx], tipo: e.target.value as any }; setFcForm({ ...fcForm, percepciones_detalle: d }); }}
                          className="rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="iibb">IIBB</option>
                          <option value="ganancias">Ganancias</option>
                          <option value="iva">IVA</option>
                          <option value="municipal">Municipal</option>
                        </select>
                        {p.tipo === "iibb" && (
                          <input value={p.localidad || ""} placeholder="Provincia"
                            onChange={(e) => { const d = [...fcForm.percepciones_detalle]; d[idx] = { ...d[idx], localidad: e.target.value }; setFcForm({ ...fcForm, percepciones_detalle: d }); }}
                            className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        )}
                        <input type="number" step="0.01" value={p.monto || ""}
                          onChange={(e) => {
                            const d = [...fcForm.percepciones_detalle];
                            d[idx] = { ...d[idx], monto: Number(e.target.value) };
                            const total = d.reduce((s, x) => s + (x.monto || 0), 0);
                            setFcForm({ ...fcForm, percepciones_detalle: d, percepciones: total });
                          }}
                          className="w-24 rounded border border-zinc-200 px-2 py-1.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="$ monto" />
                        <button type="button" onClick={() => {
                          const d = fcForm.percepciones_detalle.filter((_, i) => i !== idx);
                          const total = d.reduce((s, x) => s + (x.monto || 0), 0);
                          setFcForm({ ...fcForm, percepciones_detalle: d, percepciones: total });
                        }} className="text-zinc-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                    {fcForm.percepciones_detalle.length === 0 && (
                      <p className="text-xs text-zinc-400">Podés desglosar las percepciones por tipo arriba.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Calculated totals */}
              {fcForm.subtotal > 0 && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="font-mono">{formatCurrency(fcForm.subtotal, fcForm.moneda)}</span>
                  </div>
                  {/* Per-rate IVA breakdown when items have mixed rates */}
                  {fcItems.length > 0 && Object.keys(fcIvaByRate).length > 1 ? (
                    <>
                      {Object.entries(fcIvaByRate).sort(([a], [b]) => Number(a) - Number(b)).map(([rate, amount]) => {
                        const rateSubtotal = fcItems.filter(it => (it.iva_porcentaje ?? 21) === Number(rate)).reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
                        return (
                          <div key={rate} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-500">
                              IVA {rate}% <span className="text-zinc-400 text-xs">(s/ {formatCurrency(rateSubtotal, fcForm.moneda)})</span>
                            </span>
                            <span className="font-mono text-zinc-600">{formatCurrency(amount, fcForm.moneda)}</span>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between text-sm border-t border-zinc-100 dark:border-zinc-700 pt-1">
                        <span className="text-zinc-500 font-medium">IVA total</span>
                        <span className="font-mono text-zinc-600 font-medium">{formatCurrency(fcIva, fcForm.moneda)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">IVA ({fcItems.length > 0 && Object.keys(fcIvaByRate).length === 1 ? Object.keys(fcIvaByRate)[0] : fcForm.iva_porcentaje}%)</span>
                      <span className="font-mono text-zinc-600">{formatCurrency(fcIva, fcForm.moneda)}</span>
                    </div>
                  )}
                  {fcForm.percepciones > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Percepciones</span>
                      <span className="font-mono text-zinc-600">{formatCurrency(fcForm.percepciones, fcForm.moneda)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1.5">
                    <span className="text-zinc-700 dark:text-white">Total</span>
                    <span className="font-mono text-red-600">{formatCurrency(fcTotal, fcForm.moneda)}</span>
                  </div>
                </div>
              )}

              {/* Costo real para solo_iva */}
              {fcForm.tipo_fc === "solo_iva" && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20 p-3 space-y-2">
                  <label className="text-xs font-semibold text-blue-700 dark:text-blue-300">Costo real pagado</label>
                  <p className="text-xs text-blue-600/70 dark:text-blue-400/70">Indica cuanto pagaste realmente por esta factura de IVA</p>
                  <input type="number" value={fcForm.costo_real || ""} onChange={(e) => setFcForm({ ...fcForm, costo_real: Number(e.target.value) })}
                    placeholder="Monto pagado" className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm font-mono dark:border-blue-700 dark:bg-zinc-800 dark:text-white" />
                  {fcForm.costo_real > 0 && fcTotal > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Factura: <span className="font-mono font-medium">{formatCurrency(fcTotal, fcForm.moneda)}</span>
                      {" — "}Pagaste: <span className="font-mono font-medium">{formatCurrency(fcForm.costo_real, fcForm.moneda)}</span>
                      {" — "}Ahorro: <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{((1 - fcForm.costo_real / fcTotal) * 100).toFixed(1)}%</span>
                    </p>
                  )}
                </div>
              )}

              {/* Items de mercadería */}
              {fcForm.tipo_fc === "mercaderia" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-zinc-500">Items recibidos (para stock)</label>
                    <button type="button"
                      onClick={() => setFcItems([...fcItems, { tempId: `${Date.now()}`, producto_id: "", codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, unidad: "UN", iva_porcentaje: fcForm.iva_porcentaje || 21 }])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium">
                      <Plus className="h-3.5 w-3.5" /> Agregar item
                    </button>
                  </div>
                  {/* Buscador de producto */}
                  <div className="relative mb-2">
                    <div className="flex items-center border border-dashed border-zinc-300 rounded-lg dark:border-zinc-600 overflow-hidden">
                      <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                      <input value={fcProdSearch} onChange={(e) => setFcProdSearch(e.target.value)}
                        onFocus={() => setFcProdFocused(true)} onBlur={() => setTimeout(() => setFcProdFocused(false), 150)}
                        placeholder="Buscar producto del catálogo para agregar..."
                        className="w-full px-2 py-2 text-xs bg-transparent dark:text-white outline-none" />
                    </div>
                    {(fcProdFocused || fcProdSearch.trim()) && (() => {
                      const matches = fcProductos.filter((p) => (p.nombre + p.codigo).toLowerCase().includes(fcProdSearch.toLowerCase())).slice(0, 6);
                      return matches.length > 0 ? (
                        <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                          {matches.map((p) => (
                            <button key={p.id} type="button" onClick={() => {
                              setFcItems([...fcItems, { tempId: `${Date.now()}`, producto_id: p.id, codigo: p.codigo, descripcion: p.nombre, cantidad: 1, precio_unitario: Number(p.precio_costo), unidad: p.unidad || "UN", iva_porcentaje: fcForm.iva_porcentaje || 21 }]);
                              setFcProdSearch("");
                            }} className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex items-center justify-between">
                              <span><span className="font-mono text-zinc-400 mr-2">{p.codigo}</span>{p.nombre}</span>
                              <span className="text-zinc-400">Stock: {p.stock}</span>
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()}
                  </div>
                  {fcItems.length > 0 ? (
                    <div className="space-y-2">
                      {fcItems.map((it, idx) => (
                        <div key={it.tempId} className="grid grid-cols-12 gap-1.5 items-center rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-2">
                          <input value={it.descripcion} onChange={(e) => { const n = [...fcItems]; n[idx] = { ...n[idx], descripcion: e.target.value }; setFcItems(n); }}
                            placeholder="Descripción *" className="col-span-4 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                          <input type="number" value={it.cantidad || ""} onChange={(e) => { const n = [...fcItems]; n[idx] = { ...n[idx], cantidad: Number(e.target.value) }; setFcItems(n); }}
                            placeholder="Cant." className="col-span-2 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                          <input type="number" value={it.precio_unitario || ""} onChange={(e) => { const n = [...fcItems]; n[idx] = { ...n[idx], precio_unitario: Number(e.target.value) }; setFcItems(n); }}
                            placeholder="$ unit." className="col-span-2 rounded border border-zinc-200 px-2 py-1 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                          <select value={it.iva_porcentaje ?? 21} onChange={(e) => { const n = [...fcItems]; n[idx] = { ...n[idx], iva_porcentaje: Number(e.target.value) }; setFcItems(n); }}
                            className="col-span-2 rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                            <option value={21}>21%</option>
                            <option value={10.5}>10.5%</option>
                            <option value={27}>27%</option>
                            <option value={0}>0%</option>
                          </select>
                          <span className="col-span-1 text-xs text-zinc-400 text-center">{it.unidad}</span>
                          <button type="button" onClick={() => setFcItems(fcItems.filter((_, i) => i !== idx))} className="col-span-1 text-zinc-400 hover:text-red-500 flex justify-center"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      <div className="text-right text-xs text-zinc-400 pr-1">
                        {fcItems.length} item{fcItems.length !== 1 ? "s" : ""} — Total merch: {formatCurrency(fcItems.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0), fcForm.moneda)}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 text-center py-3 border border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
                      Opcional — agregá los artículos recibidos para actualizar el stock
                    </p>
                  )}
                </div>
              )}

              {/* OC opcional */}
              {fcForm.tipo_fc === "mercaderia" && (
              <div>
                <label className="text-xs font-medium text-zinc-500">Orden de compra (opcional)</label>
                <select value={fcForm.orden_compra_id} onChange={(e) => setFcForm({ ...fcForm, orden_compra_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="">— Sin OC vinculada —</option>
                  {filteredOCsForFC.map(oc => (
                    <option key={oc.id} value={oc.id}>{oc.numero}</option>
                  ))}
                </select>
                {fcForm.proveedor_id && filteredOCsForFC.length === 0 && (
                  <p className="text-xs text-zinc-400 mt-1">No hay OCs para este proveedor</p>
                )}
              </div>
              )}

              {/* Adjuntar PDF */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Adjuntar factura (PDF)</label>
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-orange-400 hover:text-orange-500 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-orange-500">
                    <Upload className="h-4 w-4" />
                    {fcFile ? fcFile.name : "Seleccionar PDF"}
                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFcFile(e.target.files?.[0] || null)} />
                  </label>
                  {fcFile && (
                    <button onClick={() => setFcFile(null)} className="text-zinc-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                  )}
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <textarea value={fcForm.notas} onChange={(e) => setFcForm({ ...fcForm, notas: e.target.value })}
                  rows={2} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Observaciones, condiciones de pago..." />
              </div>

              {/* Nuevo artículo desde FC */}
              {fcForm.proveedor_id && (
                <div className="border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setNewArticleOpen(!newArticleOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Nuevo artículo desde esta factura</span>
                    <span className="text-xs text-zinc-400">{newArticleOpen ? "▲" : "▼"}</span>
                  </button>
                  {newArticleOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                      <p className="text-xs text-zinc-400">Se agrega a la lista de precios del proveedor seleccionado</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={newArticle.codigo} onChange={(e) => setNewArticle({ ...newArticle, codigo: e.target.value })}
                          placeholder="Código *" className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <input value={newArticle.categoria} onChange={(e) => setNewArticle({ ...newArticle, categoria: e.target.value })}
                          placeholder="Categoría" className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      </div>
                      <input value={newArticle.descripcion} onChange={(e) => setNewArticle({ ...newArticle, descripcion: e.target.value })}
                        placeholder="Descripción *" className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      <div className="grid grid-cols-3 gap-2">
                        <select value={newArticle.unidad} onChange={(e) => setNewArticle({ ...newArticle, unidad: e.target.value })}
                          className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="UN">UN</option>
                          <option value="MT">MT</option>
                          <option value="KG">KG</option>
                          <option value="LT">LT</option>
                          <option value="JG">JG</option>
                        </select>
                        <input type="number" step="0.01" value={newArticle.precio || ""} onChange={(e) => setNewArticle({ ...newArticle, precio: Number(e.target.value) })}
                          placeholder="Precio" className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                        <button onClick={handleCreateArticle} disabled={newArticleSaving || !newArticle.codigo.trim() || !newArticle.descripcion.trim()}
                          className="flex items-center justify-center gap-1 rounded-lg bg-emerald-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                          {newArticleSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Crear
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setFcModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateFC} disabled={fcSaving || !fcForm.proveedor_id || !fcForm.numero_factura.trim() || fcForm.subtotal <= 0}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {fcSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear factura
              </button>
            </div>
          </div>
        </>
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
                {!editingFC && selectedFC.estado !== "anulada" && (
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
                  {selectedFC.tipo === "solo_iva" ? <Badge variant="purple">Solo IVA</Badge> : <Badge variant="info">Mercadería</Badge>}
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
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Percepciones</span>
                      <span className="font-mono dark:text-white">{formatCurrency(selectedFC.percepciones, selectedFC.moneda)}</span>
                    </div>
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
                          <p className="text-xs text-zinc-400">{it.cantidad} {it.unidad} x {formatCurrency(it.precio_unitario, selectedFC.moneda)} — IVA {it.iva_porcentaje ?? 21}%</p>
                        </div>
                        <span className="font-mono text-sm ml-2 dark:text-white">{formatCurrency(it.cantidad * it.precio_unitario, selectedFC.moneda)}</span>
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
                    <button onClick={() => { setSelectedFC(null); setTab("ordenes_pago"); setTimeout(() => { const op = ordenesPago.find(o => o.id === selectedFC.op_vinculada!.id); if (op) setSelectedOP(op); }, 100); }}
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
                    const { error } = await (supabase as any).from("facturas_compra").update({ estado: "pendiente" }).eq("id", selectedFC.id);
                    if (error) { alert("Error al aprobar: " + error.message); return; }
                    alert("Factura aprobada");
                    setSelectedFC(null);
                    fetchData();
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
                          const ml = m.tipo === "transferencia" ? "Transf." : m.tipo === "cheque" ? "Cheque" : m.tipo === "cheque_propio" ? "Ch. propio" : m.tipo === "echeq" ? "E-Cheq" : m.tipo === "deposito" ? "Depósito" : "Efectivo";
                          return <p key={i} className="text-sm dark:text-white">{ml}{m.banco ? ` — ${m.banco}` : ""} <span className="font-mono text-xs">{formatCurrency(m.monto, m.moneda || selectedOP.moneda)}</span></p>;
                        })}
                      </div>
                    ) : (
                      <p className="font-medium dark:text-white">{selectedOP.medio_pago === "transferencia" ? "Transferencia" : selectedOP.medio_pago === "cheque" ? "Cheque tercero" : selectedOP.medio_pago === "cheque_propio" ? "Cheque propio" : selectedOP.medio_pago === "echeq" ? "E-Cheq" : selectedOP.medio_pago === "deposito" ? "Depósito" : "Efectivo"}</p>
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
                <div className="p-4">
                  <button
                    onClick={() => handleGenerarComprobante(selectedOP)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Printer className="h-4 w-4" />
                    Generar comprobante
                  </button>
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
                  <>
                    <button
                      onClick={() => { handlePagarOP(selectedOP.id); setSelectedOP(null); }}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar pagada
                    </button>
                    <button
                      onClick={() => { handleAnularOP(selectedOP.id); setSelectedOP(null); }}
                      className="flex items-center justify-center gap-2 rounded-lg border border-red-200 dark:border-red-800 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                    >
                      <Ban className="h-4 w-4" /> Anular
                    </button>
                  </>
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
    </>
  );
}
