"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency } from "@/lib/utils";
import { mockMovimientos, mockClients, mockProveedores, mockExtractos, mockLineasCredito, mockGastosFijos, mockObjetivos } from "@/lib/mock-data";
import type { Movimiento, ExtractoMovimiento, LineaCredito, GastoFijo, Objetivo } from "@/lib/types";
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2, CalendarDays, Clock, Plus, Pencil, Target, FileText, Receipt, Ban, Search, Printer, Download, Paperclip, Eye, ShieldCheck } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";

const tipoConfig: Record<string, { label: string; variant: "success" | "danger" | "warning" | "info" | "outline"; icon: typeof ArrowDownLeft }> = {
  cobro: { label: "Cobro", variant: "success", icon: ArrowDownLeft },
  pago: { label: "Pago", variant: "danger", icon: ArrowUpRight },
  cheque_emitido: { label: "Cheque emitido", variant: "warning", icon: CreditCard },
  cheque_recibido: { label: "Cheque recibido", variant: "info", icon: CreditCard },
  transferencia: { label: "Transferencia", variant: "outline", icon: Landmark },
  efectivo: { label: "Efectivo", variant: "outline", icon: Wallet },
};

type FinanzasTab = "movimientos" | "facturas_compra" | "ordenes_pago" | "gastos_manuales" | "echeqs" | "cc_clientes" | "cc_proveedores" | "cheques" | "extractos" | "lineas_credito" | "vencimientos" | "gastos_fijos" | "objetivos";

// ── Echeq types ──
interface EcheqRow {
  id: string;
  numero: string;
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
}

interface OrdenPagoRow {
  id: string;
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
  estado: "pendiente" | "pagada" | "anulada";
  notas: string;
  created_at: string;
  archivo_url?: string;
  archivo_nombre?: string;
}

interface OCOption {
  id: string;
  numero: string;
  proveedor_id: string;
}

const emptyFCForm = {
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
};

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

const emptyOPForm = {
  proveedor_id: "",
  monto_bruto: 0,
  moneda: "ARS" as "ARS" | "USD",
  retencion_pct: 0,
  aplica_ganancias: false,
  retencion_ganancias_pct: 0,
  medio_pago: "transferencia" as string,
  cheque_cruce_id: "",
  notas: "",
  fecha: new Date().toISOString().slice(0, 10),
};

const emptyGastoManualForm = {
  descripcion: "",
  proveedor_id: "",
  categoria: "Varios" as string,
  tipo_gasto: "general" as string,
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
  cuit: string;
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

  // Data state — initialised with mock data as fallback
  const [movimientos, setMovimientos] = useState<MovimientoRow[]>([]);
  const [ccClientes, setCcClientes] = useState<CCRow[]>([]);
  const [ccProveedores, setCcProveedores] = useState<CCRow[]>([]);
  const [extractos, setExtractos] = useState<ExtractoRow[]>([]);
  const [lineasCredito, setLineasCredito] = useState<LineaCreditoRow[]>([]);
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>([]);
  const [objetivos, setObjetivos] = useState<Objetivo[]>([]);

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
  const [retencionConfig, setRetencionConfig] = useState({
    aplica_iva: true, minimo_iva: 130000, tasa_iva_ri: 10.5,
    aplica_ganancias: true, minimo_ganancias: 400000, tasa_ganancias_ri: 3.5, tasa_ganancias_no_inscripto: 28,
  });
  const [proveedoresOptions, setProveedoresOptions] = useState<ProveedorOption[]>([]);
  const [chequesRecibidos, setChequesRecibidos] = useState<MovimientoRow[]>([]);
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [selectedOP, setSelectedOP] = useState<OrdenPagoRow | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);

  // Gastos manuales state
  const [gastosManuales, setGastosManuales] = useState<GastoManualRow[]>([]);
  const [gmModalOpen, setGmModalOpen] = useState(false);
  const [gmForm, setGmForm] = useState(emptyGastoManualForm);
  const [gmSaving, setGmSaving] = useState(false);
  const [gmError, setGmError] = useState("");
  const [gmProvSearch, setGmProvSearch] = useState("");
  const [gmFile, setGmFile] = useState<File | null>(null);
  const [gmUploading, setGmUploading] = useState(false);

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
  const [newArticleOpen, setNewArticleOpen] = useState(false);
  const [newArticle, setNewArticle] = useState({ codigo: "", descripcion: "", categoria: "", unidad: "UN", precio: 0 });
  const [newArticleSaving, setNewArticleSaving] = useState(false);

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

        const [movRes, ccCliRes, ccProvRes, extRes, lcRes, gfRes, objRes] = await Promise.all([
          qMov, qCcCli, qCcProv, qExt, qLc, qGf, qObj,
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

        // Fetch proveedores list for OP/gastos selectors
        try {
          let qProv = supabase.from("proveedores").select("id, razon_social, cuit").order("razon_social");
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
              tasa_ganancias_ri: retCfg.tasa_ganancias_ri ?? 3.5,
              tasa_ganancias_no_inscripto: retCfg.tasa_ganancias_no_inscripto ?? 28,
            });
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
              id: r.id, fecha: r.fecha, proveedor_id: r.proveedor_id,
              proveedor_nombre: r.proveedores?.razon_social ?? "—",
              monto_bruto: Number(r.monto_bruto), retencion_pct: Number(r.retencion_porcentaje ?? r.retencion_pct ?? 0),
              monto_retencion: Number(r.retencion_monto ?? r.monto_retencion ?? 0),
              retencion_ganancias_pct: Number(r.retencion_ganancias_pct ?? 0),
              retencion_ganancias_monto: Number(r.retencion_ganancias_monto ?? 0),
              neto: Number(r.neto_a_pagar ?? r.neto ?? 0),
              moneda: (r.moneda as "ARS" | "USD") ?? "ARS", medio_pago: r.medio_pago ?? "transferencia",
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
              categoria: r.categoria ?? "Varios", tipo_gasto: r.tipo_gasto ?? "general",
              comprobante_url: r.comprobante_url ?? undefined,
              monto: Number(r.monto),
              moneda: (r.moneda as "ARS" | "USD") ?? "ARS", notas: r.notas ?? "",
              created_at: r.created_at,
            })));
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch facturas de compra
        try {
          let qFc = (supabase as any).from("facturas_compra").select("*, proveedores(razon_social), ordenes_compra(numero)").order("fecha", { ascending: false });
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
              created_at: r.created_at,
              archivo_url: r.archivo_url ?? undefined,
              archivo_nombre: r.archivo_nombre ?? undefined,
              solo_iva: r.solo_iva ?? false,
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
          if (echeqData) setEcheqs(echeqData as EcheqRow[]);
        } catch { /* table may not exist yet */ }

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

  async function handleCreateMov() {
    if (!movForm.descripcion.trim()) { setFormError("La descripcion es obligatoria"); return; }
    if (movForm.monto <= 0) { setFormError("El monto debe ser mayor a 0"); return; }
    setSaving(true);
    setFormError("");
    try {
      const { error } = await supabase.from("movimientos").insert({ ...movForm, sociedad_id: sociedadActiva?.id || null } as any);
      if (error) throw error;
      setModalOpen(false);
      setMovForm(emptyMovForm);
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
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
  // 1. Cuando cambia el proveedor → consultar AFIP para obtener condición IVA
  useEffect(() => {
    if (!opModalOpen) return;
    if (!opForm.proveedor_id) { setOpProvCondicion(null); return; }
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    if (!prov?.cuit) { setOpProvCondicion(null); return; }
    const cuit = prov.cuit.replace(/-/g, "");
    setOpCondicionLoading(true);
    setOpProvCondicion(null);
    fetch(`/api/cuit-lookup?cuit=${cuit}`)
      .then(r => r.json())
      .then(data => { setOpProvCondicion(data.condicion_iva ?? ""); })
      .catch(() => { setOpProvCondicion(null); })
      .finally(() => setOpCondicionLoading(false));
  }, [opForm.proveedor_id, opModalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Cuando tenemos condición y monto → auto-calcular retenciones
  useEffect(() => {
    if (opProvCondicion === null || opForm.monto_bruto <= 0) return;
    let retencion_pct = 0;
    let aplica_ganancias = false;
    let retencion_ganancias_pct = 0;
    if (opProvCondicion === "RI") {
      if (retencionConfig.aplica_iva && opForm.monto_bruto >= retencionConfig.minimo_iva) {
        retencion_pct = retencionConfig.tasa_iva_ri;
      }
      if (retencionConfig.aplica_ganancias && opForm.monto_bruto >= retencionConfig.minimo_ganancias) {
        aplica_ganancias = true;
        retencion_ganancias_pct = retencionConfig.tasa_ganancias_ri;
      }
    }
    // Monotributo / Exento / CF / vacío → sin retención (usuario puede agregar manual)
    setOpForm(prev => ({ ...prev, retencion_pct, aplica_ganancias, retencion_ganancias_pct }));
  }, [opProvCondicion, opForm.monto_bruto, retencionConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── OP handlers ──
  function openOPModal() {
    setOpForm(emptyOPForm);
    setOpError("");
    setOpFile(null);
    setOpProvCondicion(null);
    setProveedorSearch("");
    setOpModalOpen(true);
  }

  const opRetencion = opForm.monto_bruto * (opForm.retencion_pct / 100);
  const opRetencionGanancias = opForm.aplica_ganancias ? opForm.monto_bruto * (opForm.retencion_ganancias_pct / 100) : 0;
  const opNeto = opForm.monto_bruto - opRetencion - opRetencionGanancias;

  async function handleCreateOP() {
    if (!opForm.proveedor_id) { setOpError("Selecciona un proveedor"); return; }
    if (opForm.monto_bruto <= 0) { setOpError("El monto debe ser mayor a 0"); return; }
    setOpSaving(true);
    setOpError("");
    try {
      // Insert into ordenes_pago table
      const insertData: Record<string, unknown> = {
        fecha: opForm.fecha,
        proveedor_id: opForm.proveedor_id,
        monto_bruto: opForm.monto_bruto,
        retencion_porcentaje: opForm.retencion_pct,
        retencion_monto: opRetencion,
        retencion_ganancias_pct: opForm.aplica_ganancias ? opForm.retencion_ganancias_pct : 0,
        retencion_ganancias_monto: opRetencionGanancias,
        neto_a_pagar: opNeto,
        moneda: opForm.moneda,
        medio_pago: opForm.medio_pago,
        notas: opForm.notas,
        estado: "pendiente",
      };
      if (opForm.cheque_cruce_id) insertData.cheque_cruce_id = opForm.cheque_cruce_id;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { data: opData, error } = await (supabase as any).from("ordenes_pago").insert(insertData).select("id").single();
      if (error) throw error;

      // Upload comprobante file if provided
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

      // Also create a movimiento for the payment
      const provNombre = proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social ?? "";
      const movData: Record<string, unknown> = {
        tipo: "pago",
        descripcion: `OP — ${provNombre} — Neto ${opForm.moneda} ${opNeto.toLocaleString()}`,
        monto: opNeto,
        moneda: opForm.moneda,
        fecha: opForm.fecha,
        proveedor_id: opForm.proveedor_id,
        conciliado: false,
      };
      if (sociedadActiva?.id) (movData as any).sociedad_id = sociedadActiva.id;
      const { error: movErr } = await supabase.from("movimientos").insert(movData as any);
      if (movErr) throw movErr;

      // If cruce with cheque, mark cheque as conciliado
      if (opForm.cheque_cruce_id) {
        const { error: cheqErr } = await supabase.from("movimientos").update({ conciliado: true } as any).eq("id", opForm.cheque_cruce_id);
        if (cheqErr) throw cheqErr;
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
      await fetchData();
    } catch (err) { alert("Error anulando OP: " + (err instanceof Error ? err.message : String(err))); }
  }

  async function handlePagarOP(id: string) {
    try {
      const { error } = await (supabase as any).from("ordenes_pago").update({ estado: "pagada" }).eq("id", id);
      if (error) throw error;
      await fetchData();
    } catch (err) { alert("Error marcando OP como pagada: " + (err instanceof Error ? err.message : String(err))); }
  }

  function handleGenerarComprobante(op: OrdenPagoRow) {
    const provNombre = op.proveedor_nombre;
    const totalRetenciones = op.monto_retencion + op.retencion_ganancias_monto;
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Comprobante OP</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; color: #333; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #FF4500; padding-bottom: 16px; margin-bottom: 24px; }
  .title { font-size: 22px; font-weight: bold; color: #FF4500; }
  .subtitle { font-size: 12px; color: #888; margin-top: 4px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 13px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
  .row .label { color: #666; }
  .row .value { font-weight: 600; }
  .totals { background: #f9f9f9; border-radius: 8px; padding: 16px; margin-top: 16px; }
  .totals .row { border-bottom: 1px solid #eee; }
  .totals .row:last-child { border-bottom: none; font-size: 16px; padding-top: 10px; }
  .retencion { color: #d97706; }
  .neto { color: #059669; font-size: 18px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 16px; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style>
</head><body>
<div class="header">
  <div><div class="title">Comprobante de Pago</div><div class="subtitle">Orden de Pago</div></div>
  <div style="text-align:right"><div style="font-size:12px;color:#888">Fecha</div><div style="font-weight:600">${formatDate(op.fecha)}</div></div>
</div>
<div class="section">
  <div class="section-title">Proveedor</div>
  <div class="row"><span class="label">Razon social</span><span class="value">${provNombre}</span></div>
</div>
<div class="section">
  <div class="section-title">Detalle del pago</div>
  <div class="row"><span class="label">Medio de pago</span><span class="value">${op.medio_pago === "transferencia" ? "Transferencia bancaria" : op.medio_pago === "cheque" ? "Cheque" : op.medio_pago === "echeq" ? "E-Cheq" : "Efectivo"}</span></div>
  <div class="row"><span class="label">Moneda</span><span class="value">${op.moneda}</span></div>
  <div class="row"><span class="label">Estado</span><span class="value">${op.estado === "pagada" ? "Pagada" : op.estado === "anulada" ? "Anulada" : "Pendiente"}</span></div>
  ${op.notas ? `<div class="row"><span class="label">Observaciones</span><span class="value">${op.notas}</span></div>` : ""}
</div>
<div class="totals">
  <div class="section-title">Importes</div>
  <div class="row"><span class="label">Monto bruto</span><span class="value">${formatCurrency(op.monto_bruto, op.moneda)}</span></div>
  ${op.monto_retencion > 0 ? `<div class="row"><span class="label">Retención (${op.retencion_pct}%)</span><span class="value retencion">- ${formatCurrency(op.monto_retencion, op.moneda)}</span></div>` : ""}
  ${op.retencion_ganancias_monto > 0 ? `<div class="row"><span class="label">Ret. Ganancias (${op.retencion_ganancias_pct}%)</span><span class="value retencion">- ${formatCurrency(op.retencion_ganancias_monto, op.moneda)}</span></div>` : ""}
  ${totalRetenciones > 0 ? `<div class="row"><span class="label">Total retenciones</span><span class="value retencion">- ${formatCurrency(totalRetenciones, op.moneda)}</span></div>` : ""}
  <div class="row"><span class="label">Neto a pagar</span><span class="value neto">${formatCurrency(op.neto, op.moneda)}</span></div>
</div>
<div class="footer">
  Lazzari Soluciones Industriales — Comprobante generado el ${new Date().toLocaleDateString("es-AR")}
  <br/><button class="no-print" onclick="window.print()" style="margin-top:12px;padding:8px 24px;background:#FF4500;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600">Imprimir</button>
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
    setGmError("");
    setGmProvSearch("");
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

      const insertData: Record<string, unknown> = {
        fecha: gmForm.fecha,
        descripcion: gmForm.descripcion,
        categoria: gmForm.categoria,
        tipo_gasto: gmForm.tipo_gasto,
        monto: gmForm.monto,
        moneda: gmForm.moneda,
        notas: gmForm.notas,
      };
      if (comprobanteUrl) insertData.comprobante_url = comprobanteUrl;
      if (gmForm.proveedor_id) insertData.proveedor_id = gmForm.proveedor_id;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { error } = await (supabase as any).from("gastos_manuales").insert(insertData);
      if (error) throw error;

      // Also create a movimiento
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
      const { error: movErr } = await supabase.from("movimientos").insert(movData as any);
      if (movErr) throw movErr;

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
  function openFCModal() {
    setFcForm(emptyFCForm);
    setFcError("");
    setFcProvSearch("");
    setFcFile(null);
    setFcModalOpen(true);
  }

  const fcIva = fcForm.subtotal * (fcForm.iva_porcentaje / 100);
  const fcTotal = fcForm.subtotal + fcIva + fcForm.percepciones;

  async function handleCreateFC() {
    if (!fcForm.proveedor_id) { setFcError("Seleccioná un proveedor"); return; }
    if (!fcForm.numero_factura.trim()) { setFcError("El número de factura es obligatorio"); return; }
    if (fcForm.subtotal <= 0) { setFcError("El subtotal debe ser mayor a 0"); return; }
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
        solo_iva: fcForm.solo_iva,
      };
      if (fcForm.orden_compra_id && !fcForm.solo_iva) insertData.orden_compra_id = fcForm.orden_compra_id;
      if (fcForm.fecha_vencimiento) insertData.fecha_vencimiento = fcForm.fecha_vencimiento;
      if (fcForm.cae.trim()) insertData.cae = fcForm.cae.trim();
      if (fcForm.percepciones_detalle.length > 0) insertData.percepciones_detalle = JSON.stringify(fcForm.percepciones_detalle);
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { data: fcData, error } = await (supabase as any).from("facturas_compra").insert(insertData).select("id").single();
      if (error) throw error;

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
      await (supabase as any).from("facturas_compra").delete().eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error eliminando FC:", err); }
  }

  async function handlePagarFC(id: string) {
    try {
      await (supabase as any).from("facturas_compra").update({ estado: "pagada" }).eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error marcando FC como pagada:", err); }
  }

  async function handleAnularFC(id: string) {
    if (!confirm("¿Seguro que querés anular esta factura?")) return;
    try {
      await (supabase as any).from("facturas_compra").update({ estado: "anulada" }).eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error anulando FC:", err); }
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
        numero: echeqForm.numero.trim(), banco_emisor: echeqForm.banco_emisor || null,
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
    } catch (err) { setEcheqError("Error al crear echeq"); console.error(err); }
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
    if (!confirm("¿Seguro que querés eliminar este echeq?")) return;
    try { const { error } = await (supabase as any).from("echeqs").delete().eq("id", id); if (error) throw error; await fetchData(); }
    catch (err) { console.error(err); }
  }

  // ── Derived calculations ──
  const totalCobros = movimientos.filter((m) => ["cobro", "cheque_recibido", "transferencia"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagos = movimientos.filter((m) => ["pago", "cheque_emitido"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const sinConciliar = movimientos.filter((m) => !m.conciliado).length;

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

  const tabs: { id: FinanzasTab; label: string }[] = [
    { id: "movimientos", label: "Movimientos" },
    { id: "facturas_compra", label: "Fact. Compra" },
    { id: "ordenes_pago", label: "OP" },
    { id: "gastos_manuales", label: "Gastos" },
    { id: "echeqs", label: "Echeqs" },
    { id: "cc_clientes", label: "CC Clientes" },
    { id: "cc_proveedores", label: "CC Prov." },
    { id: "extractos", label: "Extractos" },
    { id: "lineas_credito", label: "Crédito" },
    { id: "vencimientos", label: "Vencimientos" },
    { id: "gastos_fijos", label: "G. Fijos" },
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Cobros del mes" value={formatCurrency(totalCobros)} icon={ArrowDownLeft} iconColor="text-emerald-600" />
          <StatCard title="Pagos del mes" value={formatCurrency(totalPagos)} icon={ArrowUpRight} iconColor="text-red-500" />
          <StatCard title="Saldo CC clientes" value={formatCurrency(ccClientes.reduce((a, c) => a + c.saldo_cuenta_corriente, 0))} icon={Wallet} iconColor="text-blue-600" />
          <StatCard title="Credito disponible" value={formatCurrency(totalDisponibleCredito)} icon={CreditCard} iconColor="text-emerald-600" />
        </div>

        {/* Tabs */}
        <div className="w-full overflow-x-auto pb-1">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-max">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
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
                { key: "descripcion", label: "Descripcion", sortable: true, render: (row) => (
                  <div>
                    <span className="font-medium">{row.descripcion}</span>
                    {row.clientes?.razon_social && <p className="text-xs text-zinc-400">{row.clientes.razon_social}</p>}
                    {row.proveedores?.razon_social && <p className="text-xs text-zinc-400">{row.proveedores.razon_social}</p>}
                  </div>
                )},
                { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => {
                  const isIngreso = ["cobro", "cheque_recibido", "transferencia"].includes(row.tipo);
                  return <span className={`font-mono font-semibold block text-right ${isIngreso ? "text-emerald-600" : "text-red-600"}`}>{isIngreso ? "+" : "-"}{formatCurrency(row.monto)}</span>;
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
            />
          </Card>
          </>
        )}

        {/* ── Facturas de Compra ── */}
        {tab === "facturas_compra" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">
                Total pendiente: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                  {formatCurrency(facturasCompra.filter(f => f.estado === "pendiente").reduce((s, f) => s + f.total, 0))}
                </span>
              </p>
              <button onClick={openFCModal} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                <Plus className="h-4 w-4" /> Nueva factura de compra
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<FacturaCompraRow>
                columns={[
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "numero_factura", label: "Nro. Factura", sortable: true, render: (row) => <span className="font-mono font-medium">{row.numero_factura}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => (
                    <div>
                      <span className="font-medium">{row.proveedor_nombre}</span>
                      {row.oc_numero && <p className="text-xs text-zinc-400">OC: {row.oc_numero}</p>}
                      {(row as any).solo_iva && <Badge variant="purple">Solo IVA</Badge>}
                    </div>
                  )},
                  { key: "subtotal", label: "Subtotal", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.subtotal, row.moneda)}</span> },
                  { key: "iva", label: "IVA", className: "text-right", render: (row) => (
                    <div className="text-right">
                      <span className="font-mono text-zinc-500">{formatCurrency(row.iva, row.moneda)}</span>
                      <span className="text-xs text-zinc-400 ml-1">({row.iva_porcentaje}%)</span>
                    </div>
                  )},
                  { key: "percepciones", label: "Perc.", className: "text-right", render: (row) => row.percepciones > 0 ? <span className="font-mono text-zinc-500 block text-right">{formatCurrency(row.percepciones, row.moneda)}</span> : <span className="text-zinc-300 block text-right">—</span> },
                  { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.total, row.moneda)}</span> },
                  { key: "fecha_vencimiento", label: "Vto.", sortable: true, render: (row) => row.fecha_vencimiento ? <span className="text-zinc-500 text-xs">{formatDate(row.fecha_vencimiento)}</span> : <span className="text-zinc-300">—</span> },
                  { key: "estado", label: "Estado", sortable: true, render: (row) => (
                    <Badge variant={row.estado === "pagada" ? "success" : row.estado === "anulada" ? "danger" : "warning"}>
                      {row.estado === "pagada" ? "Pagada" : row.estado === "anulada" ? "Anulada" : "Pendiente"}
                    </Badge>
                  )},
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {row.archivo_url && (
                        <a href={row.archivo_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-orange-500 hover:bg-orange-100" title="Ver PDF adjunto">
                          <Paperclip className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {row.estado === "pendiente" && (
                        <>
                          <button onClick={() => handlePagarFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Marcar como pagada">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleAnularFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      <button onClick={() => handleDeleteFC(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Eliminar">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )},
                ]}
                data={facturasCompra}
                emptyMessage="No hay facturas de compra cargadas"
              />
            </Card>
          </>
        )}

        {/* ── Ordenes de Pago ── */}
        {tab === "ordenes_pago" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-500">
                Total pendiente: <span className="font-bold font-mono text-zinc-900 dark:text-white">
                  {formatCurrency(ordenesPago.filter(o => o.estado === "pendiente").reduce((s, o) => s + o.neto, 0))}
                </span>
              </p>
              <button onClick={openOPModal} className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
                <Plus className="h-4 w-4" /> Nueva OP
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<OrdenPagoRow>
                columns={[
                  { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
                  { key: "proveedor_nombre", label: "Proveedor", sortable: true, render: (row) => <span className="font-medium">{row.proveedor_nombre}</span> },
                  { key: "monto_bruto", label: "Monto bruto", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.monto_bruto, row.moneda)}</span> },
                  { key: "monto_retencion", label: "Retenciones", className: "text-right", sortable: true, render: (row) => {
                    const totalRet = row.monto_retencion + row.retencion_ganancias_monto;
                    return (
                      <div className="text-right">
                        {totalRet > 0 ? (
                          <>
                            <span className="font-mono text-amber-600">{formatCurrency(totalRet, row.moneda)}</span>
                            <div className="flex items-center justify-end gap-1 mt-0.5">
                              {row.retencion_pct > 0 && <span className="text-[10px] text-zinc-400">Ret {row.retencion_pct}%</span>}
                              {row.retencion_ganancias_monto > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-500 font-medium">
                                  <ShieldCheck className="h-2.5 w-2.5" />Gan {row.retencion_ganancias_pct}%
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </div>
                    );
                  }},
                  { key: "neto", label: "Neto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.neto, row.moneda)}</span> },
                  { key: "medio_pago", label: "Medio", render: (row) => <Badge variant="outline">{row.medio_pago === "transferencia" ? "Transferencia" : row.medio_pago === "cheque" ? "Cheque" : row.medio_pago === "echeq" ? "E-Cheq" : "Efectivo"}</Badge> },
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
                  {formatCurrency(gastosManuales.reduce((s, g) => s + g.monto, 0))}
                </span>
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
                  { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.monto, row.moneda)}</span> },
                  { key: "moneda", label: "Moneda", render: (row) => <Badge variant="outline">{row.moneda}</Badge> },
                  { key: "comprobante_url", label: "Comp.", render: (row) => row.comprobante_url ? (
                    <a href={row.comprobante_url} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600" title="Ver comprobante"><Paperclip className="h-4 w-4" /></a>
                  ) : <span className="text-zinc-300 text-xs">—</span> },
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
          <Card className="p-0 overflow-hidden">
            <DataTable<CCRow>
              columns={[
                { key: "razon_social", label: "Cliente", render: (row) => <span className="font-medium">{row.razon_social}</span> },
                { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                { key: "dias_cuenta_corriente", label: "Dias CC", render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago}</Badge> },
                { key: "limite_credito", label: "Limite", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limite_credito)}</span> },
                { key: "saldo_cuenta_corriente", label: "Saldo", className: "text-right", render: (row) => {
                  const pct = row.limite_credito ? (row.saldo_cuenta_corriente / row.limite_credito) * 100 : 0;
                  return (<div className="text-right"><span className={`font-mono font-semibold ${pct > 80 ? "text-red-600" : ""}`}>{formatCurrency(row.saldo_cuenta_corriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                }},
              ]}
              data={ccClientes}
            />
          </Card>
        )}

        {/* ── CC Proveedores ── */}
        {tab === "cc_proveedores" && (
          <Card className="p-0 overflow-hidden">
            <DataTable<CCRow>
              columns={[
                { key: "razon_social", label: "Proveedor", render: (row) => <span className="font-medium">{row.razon_social}</span> },
                { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                { key: "rubro", label: "Rubro", render: (row) => <Badge variant="info">{(row.rubro ?? "").split(" ")[0]}</Badge> },
                { key: "dias_cuenta_corriente", label: "Dias CC", render: (row) => <span>{row.dias_cuenta_corriente} dias</span> },
                { key: "forma_pago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.forma_pago}</Badge> },
                { key: "limite_credito", label: "Limite", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limite_credito)}</span> },
                { key: "saldo_cuenta_corriente", label: "Deuda", className: "text-right", render: (row) => {
                  const pct = row.limite_credito ? (row.saldo_cuenta_corriente / row.limite_credito) * 100 : 0;
                  return (<div className="text-right"><span className={`font-mono font-semibold text-red-600`}>{formatCurrency(row.saldo_cuenta_corriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                }},
              ]}
              data={ccProveedores}
            />
          </Card>
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
                <Plus className="h-4 w-4" /> Registrar echeq
              </button>
            </div>
            <Card className="p-0 overflow-hidden">
              <DataTable<EcheqRow>
                columns={[
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
                emptyMessage="No hay echeqs registrados"
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
                <h2 className="text-lg font-bold dark:text-white">Registrar Echeq</h2>
                <button onClick={() => setEcheqModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              {echeqError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{echeqError}</div>}
              <div className="space-y-4">
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
              <h2 className="text-lg font-bold mb-4 dark:text-white">{echeqActionModal === "endosar" ? "Endosar echeq" : "Depositar echeq"}</h2>
              <p className="text-sm text-zinc-500 mb-4">Echeq #{selectedEcheq.numero} — {formatCurrency(selectedEcheq.monto, selectedEcheq.moneda)}</p>
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

        {/* ── E-Cheques (legacy mock) ── */}
        {tab === "cheques" && (
          <Card>
            <CardHeader><CardTitle>E-Cheques</CardTitle></CardHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <p className="text-xs font-medium text-zinc-500 mb-3">Cheques recibidos</p>
                {movimientos.filter((m) => m.tipo === "cheque_recibido").map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-blue-50 p-3 mb-2"><div><p className="text-sm font-medium">{m.descripcion}</p><p className="text-xs text-zinc-400">{m.fecha}</p></div><span className="font-mono font-semibold text-blue-600">{formatCurrency(m.monto)}</span></div>
                ))}
              </div>
              <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                <p className="text-xs font-medium text-zinc-500 mb-3">Cheques emitidos</p>
                {movimientos.filter((m) => m.tipo === "cheque_emitido").map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-amber-50 p-3 mb-2"><div><p className="text-sm font-medium">{m.descripcion}</p><p className="text-xs text-zinc-400">{m.fecha}</p></div><span className="font-mono font-semibold text-amber-600">{formatCurrency(m.monto)}</span></div>
                ))}
              </div>
            </div>
          </Card>
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

        {/* ── Vencimientos ── */}
        {tab === "vencimientos" && (() => {
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
                const isActive = obj.activo && obj.periodoInicio <= new Date().toISOString().split("T")[0] && obj.periodoFin >= new Date().toISOString().split("T")[0];
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
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">Nueva Orden de Pago</h2>
              </div>
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {opError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{opError}</div>}
            <div className="space-y-4">
              {/* Proveedor selector with search */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Proveedor *</label>
                <div className="relative mt-1">
                  <div className="flex items-center border border-zinc-200 rounded-lg dark:border-zinc-700 overflow-hidden">
                    <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                    <input
                      value={proveedorSearch}
                      onChange={(e) => { setProveedorSearch(e.target.value); if (opForm.proveedor_id) setOpForm({ ...opForm, proveedor_id: "" }); }}
                      placeholder="Buscar proveedor..."
                      className="w-full px-2 py-2 text-sm bg-transparent dark:text-white outline-none"
                    />
                  </div>
                  {opForm.proveedor_id && (
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge variant="success">{proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social}</Badge>
                      <button onClick={() => { setOpForm({ ...opForm, proveedor_id: "" }); setProveedorSearch(""); setOpProvCondicion(null); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                      {opCondicionLoading && <span className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" />Consultando AFIP…</span>}
                      {!opCondicionLoading && opProvCondicion !== null && (
                        <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          opProvCondicion === "RI" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                          opProvCondicion === "Monotributo" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
                          "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                        }`}>
                          <ShieldCheck className="h-3 w-3" />
                          {opProvCondicion === "RI" ? "Responsable Inscripto" : opProvCondicion === "Monotributo" ? "Monotributo" : opProvCondicion || "Sin datos AFIP"}
                        </span>
                      )}
                    </div>
                  )}
                  {!opForm.proveedor_id && proveedorSearch.trim() && filteredProveedoresOP.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {filteredProveedoresOP.slice(0, 10).map(p => (
                        <button key={p.id} onClick={() => { setOpForm({ ...opForm, proveedor_id: p.id }); setProveedorSearch(p.razon_social); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex items-center justify-between gap-2">
                          <span>{p.razon_social}</span>
                          {p.cuit && <span className="text-xs text-zinc-400 font-mono shrink-0">{p.cuit}</span>}
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500">Monto bruto *</label>
                  <input type="number" value={opForm.monto_bruto || ""} onChange={(e) => setOpForm({ ...opForm, monto_bruto: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Moneda</label>
                  <select value={opForm.moneda} onChange={(e) => setOpForm({ ...opForm, moneda: e.target.value as "ARS" | "USD" })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {/* Retención IVA */}
              <div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-zinc-500">Ret. IVA (%)</label>
                  {opProvCondicion !== null && opForm.retencion_pct > 0 && (
                    <span className="text-xs bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">Auto AFIP</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" step="0.5" value={opForm.retencion_pct || ""} onChange={(e) => setOpForm({ ...opForm, retencion_pct: Number(e.target.value) })}
                    className="w-24 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="0" />
                  <span className="text-sm text-zinc-400">%</span>
                  <div className="flex gap-1 ml-2">
                    {[2, 3, 6].map(pct => (
                      <button key={pct} type="button" onClick={() => setOpForm({ ...opForm, retencion_pct: pct })}
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${opForm.retencion_pct === pct ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Retención Ganancias */}
              <div className="rounded-lg border border-violet-200 dark:border-violet-800 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-violet-500" />
                    <label className="text-xs font-semibold text-violet-700 dark:text-violet-300">Retención de Ganancias</label>
                    {opProvCondicion !== null && opForm.aplica_ganancias && (
                      <span className="text-xs bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400 px-1.5 py-0.5 rounded font-medium">Auto AFIP</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpForm({ ...opForm, aplica_ganancias: !opForm.aplica_ganancias, retencion_ganancias_pct: !opForm.aplica_ganancias ? 6 : 0 })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${opForm.aplica_ganancias ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${opForm.aplica_ganancias ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                {opForm.aplica_ganancias && (
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Porcentaje</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" step="0.5" value={opForm.retencion_ganancias_pct || ""} onChange={(e) => setOpForm({ ...opForm, retencion_ganancias_pct: Number(e.target.value) })}
                        className="w-24 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="0" />
                      <span className="text-sm text-zinc-400">%</span>
                      <div className="flex gap-1 ml-2">
                        {[2, 3, 6, 28].map(pct => (
                          <button key={pct} type="button" onClick={() => setOpForm({ ...opForm, retencion_ganancias_pct: pct })}
                            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${opForm.retencion_ganancias_pct === pct ? "bg-violet-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                    {opForm.monto_bruto > 0 && (
                      <p className="text-xs text-violet-600 dark:text-violet-400 mt-1.5">
                        Base imponible: {formatCurrency(opForm.monto_bruto, opForm.moneda)} → Retención: {formatCurrency(opRetencionGanancias, opForm.moneda)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Calculated fields */}
              {opForm.monto_bruto > 0 && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Monto bruto</span>
                    <span className="font-mono">{formatCurrency(opForm.monto_bruto, opForm.moneda)}</span>
                  </div>
                  {opRetencion > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Retención ({opForm.retencion_pct}%)</span>
                      <span className="font-mono text-amber-600">- {formatCurrency(opRetencion, opForm.moneda)}</span>
                    </div>
                  )}
                  {opRetencionGanancias > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500 flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-violet-500" />Ret. Ganancias ({opForm.retencion_ganancias_pct}%)</span>
                      <span className="font-mono text-violet-600">- {formatCurrency(opRetencionGanancias, opForm.moneda)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1.5">
                    <span className="text-zinc-700 dark:text-white">Neto a pagar</span>
                    <span className="font-mono text-emerald-600">{formatCurrency(opNeto, opForm.moneda)}</span>
                  </div>
                </div>
              )}

              {/* Medio de pago */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Medio de pago</label>
                <select value={opForm.medio_pago} onChange={(e) => setOpForm({ ...opForm, medio_pago: e.target.value, cheque_cruce_id: "" })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="echeq">E-Cheq</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </div>

              {/* Cruce de cheque */}
              {(opForm.medio_pago === "cheque" || opForm.medio_pago === "echeq") && (
                <div>
                  <label className="text-xs font-medium text-zinc-500">Cruzar con cheque recibido (opcional)</label>
                  <select value={opForm.cheque_cruce_id} onChange={(e) => setOpForm({ ...opForm, cheque_cruce_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    <option value="">— Sin cruce —</option>
                    {chequesRecibidos.map(ch => (
                      <option key={ch.id} value={ch.id}>
                        {ch.descripcion} — {formatCurrency(ch.monto)} — {formatDate(ch.fecha)}
                      </option>
                    ))}
                  </select>
                  {chequesRecibidos.length === 0 && (
                    <p className="text-xs text-zinc-400 mt-1">No hay cheques recibidos disponibles para cruzar</p>
                  )}
                </div>
              )}

              {/* Adjuntar comprobante */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Adjuntar comprobante (PDF)</label>
                <div className="mt-1 flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 hover:border-orange-400 hover:text-orange-500 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-orange-500">
                    <Upload className="h-4 w-4" />
                    {opFile ? opFile.name : "Seleccionar PDF"}
                    <input type="file" accept=".pdf,.jpg,.png" className="hidden" onChange={(e) => setOpFile(e.target.files?.[0] || null)} />
                  </label>
                  {opFile && <button onClick={() => setOpFile(null)} className="text-zinc-400 hover:text-red-500"><X className="h-4 w-4" /></button>}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <textarea value={opForm.notas} onChange={(e) => setOpForm({ ...opForm, notas: e.target.value })}
                  rows={2} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Notas, nro de comprobante, certificado de retención..." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setOpModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={handleCreateOP} disabled={opSaving || !opForm.proveedor_id || opForm.monto_bruto <= 0}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {opSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear OP
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
            {fcError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{fcError}</div>}
            <div className="space-y-4">
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
                  <label className="text-xs font-medium text-zinc-500">% IVA</label>
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
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">IVA ({fcForm.iva_porcentaje}%)</span>
                    <span className="font-mono text-zinc-600">{formatCurrency(fcIva, fcForm.moneda)}</span>
                  </div>
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

              {/* Solo IVA toggle */}
              <label className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <input type="checkbox" checked={fcForm.solo_iva} onChange={(e) => setFcForm({ ...fcForm, solo_iva: e.target.checked, orden_compra_id: e.target.checked ? "" : fcForm.orden_compra_id })}
                  className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                <div>
                  <span className="text-sm font-medium dark:text-white">Solo IVA (crédito fiscal)</span>
                  <p className="text-xs text-zinc-400">Factura que solo afecta libro IVA, sin vincular a OC ni compras</p>
                </div>
              </label>

              {/* OC opcional */}
              {!fcForm.solo_iva && (
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

      {/* ── OP Detail Panel ── */}
      {selectedOP && (
        <>
          <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setSelectedOP(null)} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white dark:bg-zinc-900 p-6 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-bold dark:text-white">Orden de Pago</h2>
                <Badge variant={selectedOP.estado === "pagada" ? "success" : selectedOP.estado === "anulada" ? "danger" : "warning"}>
                  {selectedOP.estado === "pagada" ? "Pagada" : selectedOP.estado === "anulada" ? "Anulada" : "Pendiente"}
                </Badge>
              </div>
              <button onClick={() => setSelectedOP(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>

            <div className="p-6 space-y-6">
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
                    <p className="text-xs font-medium text-zinc-500">Medio de pago</p>
                    <p className="font-medium dark:text-white">{selectedOP.medio_pago === "transferencia" ? "Transferencia" : selectedOP.medio_pago === "cheque" ? "Cheque" : selectedOP.medio_pago === "echeq" ? "E-Cheq" : "Efectivo"}</p>
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
                  {selectedOP.monto_retencion > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Retención ({selectedOP.retencion_pct}%)</span>
                      <span className="font-mono text-amber-600">- {formatCurrency(selectedOP.monto_retencion, selectedOP.moneda)}</span>
                    </div>
                  )}
                  {selectedOP.retencion_ganancias_monto > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3 text-violet-500" />
                        Ret. Ganancias ({selectedOP.retencion_ganancias_pct}%)
                      </span>
                      <span className="font-mono text-violet-600">- {formatCurrency(selectedOP.retencion_ganancias_monto, selectedOP.moneda)}</span>
                    </div>
                  )}
                  {(selectedOP.monto_retencion > 0 || selectedOP.retencion_ganancias_monto > 0) && (
                    <div className="flex items-center justify-between text-sm border-t border-zinc-100 dark:border-zinc-700 pt-2">
                      <span className="text-zinc-500">Total retenciones</span>
                      <span className="font-mono text-amber-600 font-medium">- {formatCurrency(selectedOP.monto_retencion + selectedOP.retencion_ganancias_monto, selectedOP.moneda)}</span>
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
              {(selectedOP.retencion_ganancias_monto > 0 || selectedOP.monto_retencion > 0) && (
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
                <h2 className="text-lg font-bold dark:text-white">Nuevo gasto manual</h2>
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
                  <label className="text-xs font-medium text-zinc-500">Categoría</label>
                  <select value={gmForm.categoria} onChange={(e) => setGmForm({ ...gmForm, categoria: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    {GASTO_CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500">Tipo de gasto</label>
                  <select value={gmForm.tipo_gasto} onChange={(e) => setGmForm({ ...gmForm, tipo_gasto: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                    {TIPO_GASTO_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
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
                Crear gasto
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
