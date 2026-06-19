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
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2, CalendarDays, Clock, Plus, Pencil, Target, FileText, Receipt, Ban, Search } from "lucide-react";
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

type FinanzasTab = "movimientos" | "facturas_compra" | "ordenes_pago" | "gastos_manuales" | "cc_clientes" | "cc_proveedores" | "cheques" | "extractos" | "lineas_credito" | "vencimientos" | "gastos_fijos" | "objetivos";

// ── OP & Gastos types ──
interface ProveedorOption {
  id: string;
  razon_social: string;
}

interface OrdenPagoRow {
  id: string;
  fecha: string;
  proveedor_id: string;
  proveedor_nombre: string;
  monto_bruto: number;
  retencion_pct: number;
  monto_retencion: number;
  neto: number;
  moneda: "ARS" | "USD";
  medio_pago: string;
  cheque_cruce_id?: string;
  notas: string;
  estado: "pendiente" | "pagada" | "anulada";
  created_at: string;
}

interface GastoManualRow {
  id: string;
  fecha: string;
  descripcion: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  categoria: string;
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
  moneda: "ARS" as "ARS" | "USD",
  notas: "",
};

const GASTO_CATEGORIAS = ["Transporte", "Servicios", "Materiales", "Varios", "Comisiones", "Impuestos"] as const;

const emptyOPForm = {
  proveedor_id: "",
  monto_bruto: 0,
  moneda: "ARS" as "ARS" | "USD",
  retencion_pct: 0,
  medio_pago: "transferencia" as string,
  cheque_cruce_id: "",
  notas: "",
  fecha: new Date().toISOString().slice(0, 10),
};

const emptyGastoManualForm = {
  descripcion: "",
  proveedor_id: "",
  categoria: "Varios" as string,
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
  const { sociedadActiva } = useUser();
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
  const [gastosFijos, setGastosFijos] = useState<GastoFijo[]>(mockGastosFijos);
  const [objetivos, setObjetivos] = useState<Objetivo[]>(mockObjetivos);

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
  const [proveedoresOptions, setProveedoresOptions] = useState<ProveedorOption[]>([]);
  const [chequesRecibidos, setChequesRecibidos] = useState<MovimientoRow[]>([]);
  const [proveedorSearch, setProveedorSearch] = useState("");

  // Gastos manuales state
  const [gastosManuales, setGastosManuales] = useState<GastoManualRow[]>([]);
  const [gmModalOpen, setGmModalOpen] = useState(false);
  const [gmForm, setGmForm] = useState(emptyGastoManualForm);
  const [gmSaving, setGmSaving] = useState(false);
  const [gmError, setGmError] = useState("");
  const [gmProvSearch, setGmProvSearch] = useState("");

  // Facturas compra state
  const [facturasCompra, setFacturasCompra] = useState<FacturaCompraRow[]>([]);
  const [fcModalOpen, setFcModalOpen] = useState(false);
  const [fcForm, setFcForm] = useState(emptyFCForm);
  const [fcSaving, setFcSaving] = useState(false);
  const [fcError, setFcError] = useState("");
  const [fcProvSearch, setFcProvSearch] = useState("");
  const [ocOptions, setOcOptions] = useState<OCOption[]>([]);

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

        const [movRes, ccCliRes, ccProvRes, extRes, lcRes, gfRes, objRes] = await Promise.all([
          qMov,
          supabase
            .from("v_cuenta_corriente_clientes")
            .select("*"),
          supabase
            .from("v_cuenta_corriente_proveedores")
            .select("*"),
          supabase
            .from("extractos_bancarios")
            .select(`*, extracto_movimientos(*)`)
            .order("created_at", { ascending: false }),
          supabase
            .from("lineas_credito")
            .select(`*, proveedores(razon_social)`)
            .order("vencimiento"),
          supabase
            .from("gastos_fijos")
            .select("*")
            .order("categoria"),
          supabase
            .from("objetivos")
            .select("*, profiles:usuario_id(full_name)")
            .order("periodo_inicio", { ascending: false }),
        ]);

        // Use Supabase data if available, otherwise fall back to mock data mapped to snake_case
        if (movRes.data && movRes.data.length > 0) {
          setMovimientos(movRes.data as MovimientoRow[]);
        } else {
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

        if (ccCliRes.data && ccCliRes.data.length > 0) {
          setCcClientes(ccCliRes.data.map((r: any) => ({
            id: r.id,
            razon_social: r.razon_social,
            cuit: r.cuit,
            dias_cuenta_corriente: r.dias_cuenta_corriente,
            forma_pago: r.forma_pago,
            limite_credito: r.limite_credito,
            saldo_cuenta_corriente: r.saldo ?? r.saldo_cuenta_corriente ?? 0,
          })));
        } else {
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

        if (ccProvRes.data && ccProvRes.data.length > 0) {
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
        } else {
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

        if (extRes.data && extRes.data.length > 0) {
          setExtractos(extRes.data as ExtractoRow[]);
        } else {
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

        if (lcRes.data && lcRes.data.length > 0) {
          setLineasCredito(lcRes.data as LineaCreditoRow[]);
        } else {
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

        if (gfRes.data && gfRes.data.length > 0) {
          setGastosFijos(gfRes.data.map((g: any) => ({
            id: g.id, descripcion: g.descripcion, categoria: g.categoria,
            monto: Number(g.monto), moneda: g.moneda, activo: g.activo,
            notas: g.notas ?? "", createdAt: g.created_at,
          })));
        }

        if (objRes.data && objRes.data.length > 0) {
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
          let qProv = supabase.from("proveedores").select("id, razon_social").order("razon_social");
          if (sociedadActiva?.id) qProv = qProv.eq("sociedad_id" as any, sociedadActiva.id);
          const { data: provData } = await qProv;
          if (provData) setProveedoresOptions(provData as ProveedorOption[]);
        } catch { /* ignore */ }

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
          if (opData && opData.length > 0) {
            setOrdenesPago(opData.map((r: any) => ({
              id: r.id, fecha: r.fecha, proveedor_id: r.proveedor_id,
              proveedor_nombre: r.proveedores?.razon_social ?? "—",
              monto_bruto: Number(r.monto_bruto), retencion_pct: Number(r.retencion_pct ?? 0),
              monto_retencion: Number(r.monto_retencion ?? 0), neto: Number(r.neto),
              moneda: (r.moneda as "ARS" | "USD") ?? "ARS", medio_pago: r.medio_pago ?? "transferencia",
              cheque_cruce_id: r.cheque_cruce_id, notas: r.notas ?? "",
              estado: r.estado ?? "pendiente", created_at: r.created_at,
            })));
          }
        } catch { /* table may not exist yet, ignore */ }

        // Fetch gastos manuales
        try {
          let qGm = (supabase as any).from("gastos_manuales").select("*, proveedores(razon_social)").order("fecha", { ascending: false });
          if (sociedadActiva?.id) qGm = qGm.eq("sociedad_id", sociedadActiva.id);
          const { data: gmData } = await qGm;
          if (gmData && gmData.length > 0) {
            setGastosManuales(gmData.map((r: any) => ({
              id: r.id, fecha: r.fecha, descripcion: r.descripcion,
              proveedor_id: r.proveedor_id, proveedor_nombre: r.proveedores?.razon_social ?? undefined,
              categoria: r.categoria ?? "Varios", monto: Number(r.monto),
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
          if (fcData && fcData.length > 0) {
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
      const { error } = await supabase.from("movimientos").insert(movForm);
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
      await supabase.from("movimientos").update({ conciliado: true }).eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error conciliando:", err);
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
      await supabase.from("gastos_fijos").update({ activo: !activo } as any).eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error toggling gasto:", err);
    }
  }

  async function handleDeleteGasto(id: string) {
    if (!confirm("Seguro que queres eliminar este gasto fijo?")) return;
    try {
      await supabase.from("gastos_fijos").delete().eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error deleting gasto:", err);
    }
  }

  async function handleDeleteMov(id: string) {
    if (!confirm("¿Seguro que queres eliminar este movimiento?")) return;
    try {
      await supabase.from("movimientos").delete().eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error eliminando:", err);
    }
  }

  // ── OP handlers ──
  function openOPModal() {
    setOpForm(emptyOPForm);
    setOpError("");
    setProveedorSearch("");
    setOpModalOpen(true);
  }

  const opRetencion = opForm.monto_bruto * (opForm.retencion_pct / 100);
  const opNeto = opForm.monto_bruto - opRetencion;

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
        retencion_pct: opForm.retencion_pct,
        monto_retencion: opRetencion,
        neto: opNeto,
        moneda: opForm.moneda,
        medio_pago: opForm.medio_pago,
        notas: opForm.notas,
        estado: "pendiente",
      };
      if (opForm.cheque_cruce_id) insertData.cheque_cruce_id = opForm.cheque_cruce_id;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { error } = await (supabase as any).from("ordenes_pago").insert(insertData);
      if (error) throw error;

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
      await supabase.from("movimientos").insert(movData as any);

      // If cruce with cheque, mark cheque as conciliado
      if (opForm.cheque_cruce_id) {
        await supabase.from("movimientos").update({ conciliado: true } as any).eq("id", opForm.cheque_cruce_id);
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
      await (supabase as any).from("ordenes_pago").update({ estado: "anulada" }).eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error anulando OP:", err); }
  }

  async function handlePagarOP(id: string) {
    try {
      await (supabase as any).from("ordenes_pago").update({ estado: "pagada" }).eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error marcando OP como pagada:", err); }
  }

  // ── Gastos manuales handlers ──
  function openGMModal() {
    setGmForm(emptyGastoManualForm);
    setGmError("");
    setGmProvSearch("");
    setGmModalOpen(true);
  }

  async function handleCreateGM() {
    if (!gmForm.descripcion.trim()) { setGmError("La descripcion es obligatoria"); return; }
    if (gmForm.monto <= 0) { setGmError("El monto debe ser mayor a 0"); return; }
    setGmSaving(true);
    setGmError("");
    try {
      const insertData: Record<string, unknown> = {
        fecha: gmForm.fecha,
        descripcion: gmForm.descripcion,
        categoria: gmForm.categoria,
        monto: gmForm.monto,
        moneda: gmForm.moneda,
        notas: gmForm.notas,
      };
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
      await supabase.from("movimientos").insert(movData as any);

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
      await (supabase as any).from("gastos_manuales").delete().eq("id", id);
      await fetchData();
    } catch (err) { console.error("Error eliminando gasto:", err); }
  }

  // ── Facturas compra handlers ──
  function openFCModal() {
    setFcForm(emptyFCForm);
    setFcError("");
    setFcProvSearch("");
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
      };
      if (fcForm.orden_compra_id) insertData.orden_compra_id = fcForm.orden_compra_id;
      if (fcForm.fecha_vencimiento) insertData.fecha_vencimiento = fcForm.fecha_vencimiento;
      if (sociedadActiva?.id) insertData.sociedad_id = sociedadActiva.id;

      const { error } = await (supabase as any).from("facturas_compra").insert(insertData);
      if (error) throw error;

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

  const filteredProveedoresFC = fcProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(fcProvSearch.toLowerCase()))
    : proveedoresOptions;

  // OCs filtered by selected proveedor (for optional linking)
  const filteredOCsForFC = fcForm.proveedor_id
    ? ocOptions.filter(oc => oc.proveedor_id === fcForm.proveedor_id)
    : ocOptions;

  // Filtered proveedores for search
  const filteredProveedoresOP = proveedorSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(proveedorSearch.toLowerCase()))
    : proveedoresOptions;

  const filteredProveedoresGM = gmProvSearch.trim()
    ? proveedoresOptions.filter(p => p.razon_social.toLowerCase().includes(gmProvSearch.toLowerCase()))
    : proveedoresOptions;

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
    { id: "facturas_compra", label: "Facturas Compra" },
    { id: "ordenes_pago", label: "Ordenes de Pago" },
    { id: "gastos_manuales", label: "Gastos" },
    { id: "cc_clientes", label: "CC Clientes" },
    { id: "cc_proveedores", label: "CC Proveedores" },
    { id: "cheques", label: "E-Cheques" },
    { id: "extractos", label: "Extractos" },
    { id: "lineas_credito", label: "Lineas credito" },
    { id: "vencimientos", label: "Vencimientos" },
    { id: "gastos_fijos", label: "Gastos fijos" },
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
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}>
              {t.label}
            </button>
          ))}
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
                { key: "tipo", label: "Tipo", sortable: true, render: (row) => { const cfg = tipoConfig[row.tipo]; const Icon = cfg.icon; return (<div className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-400" /><Badge variant={cfg.variant}>{cfg.label}</Badge></div>); }},
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
                  { key: "monto_retencion", label: "Retención", className: "text-right", sortable: true, render: (row) => (
                    <div className="text-right">
                      <span className="font-mono text-amber-600">{formatCurrency(row.monto_retencion, row.moneda)}</span>
                      {row.retencion_pct > 0 && <span className="text-xs text-zinc-400 ml-1">({row.retencion_pct}%)</span>}
                    </div>
                  )},
                  { key: "neto", label: "Neto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.neto, row.moneda)}</span> },
                  { key: "medio_pago", label: "Medio", render: (row) => <Badge variant="outline">{row.medio_pago === "transferencia" ? "Transferencia" : row.medio_pago === "cheque" ? "Cheque" : row.medio_pago === "echeq" ? "E-Cheq" : "Efectivo"}</Badge> },
                  { key: "estado", label: "Estado", sortable: true, render: (row) => (
                    <Badge variant={row.estado === "pagada" ? "success" : row.estado === "anulada" ? "danger" : "warning"}>
                      {row.estado === "pagada" ? "Pagada" : row.estado === "anulada" ? "Anulada" : "Pendiente"}
                    </Badge>
                  )},
                  { key: "actions", label: "", sortable: false, render: (row) => (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                  { key: "monto", label: "Monto", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold text-red-600 block text-right">{formatCurrency(row.monto, row.moneda)}</span> },
                  { key: "moneda", label: "Moneda", render: (row) => <Badge variant="outline">{row.moneda}</Badge> },
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
                  const pct = (row.saldo_cuenta_corriente / row.limite_credito) * 100;
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
                  const pct = (row.saldo_cuenta_corriente / row.limite_credito) * 100;
                  return (<div className="text-right"><span className={`font-mono font-semibold text-red-600`}>{formatCurrency(row.saldo_cuenta_corriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100 dark:bg-zinc-700"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                }},
              ]}
              data={ccProveedores}
            />
          </Card>
        )}

        {/* ── E-Cheques ── */}
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

          // Mock data fallback if no items found
          if (items.length === 0) {
            items.push(
              { id: "mock-1", fecha: new Date("2026-06-15"), fechaStr: "2026-06-15", entidad: "Tenaris", descripcion: "Cheque emitido #4521", monto: 3855000, tipo: "cheque" },
              { id: "mock-2", fecha: new Date("2026-06-16"), fechaStr: "2026-06-16", entidad: "Duo Matic", descripcion: "FC proveedor A-0012-00045821", monto: 1200000, tipo: "factura" },
              { id: "mock-3", fecha: new Date("2026-06-30"), fechaStr: "2026-06-30", entidad: "Banco Nacion", descripcion: "Linea de credito bancaria — cuota mensual", monto: 3000000, tipo: "linea_credito" },
              { id: "mock-4", fecha: new Date("2026-06-20"), fechaStr: "2026-06-20", entidad: "Flexitallic", descripcion: "FC proveedor A-0008-00012390", monto: 450000, tipo: "factura" },
            );
          }

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
                    <div className="mt-1 flex items-center gap-1">
                      <Badge variant="success">{proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social}</Badge>
                      <button onClick={() => { setOpForm({ ...opForm, proveedor_id: "" }); setProveedorSearch(""); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                    </div>
                  )}
                  {!opForm.proveedor_id && proveedorSearch.trim() && filteredProveedoresOP.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {filteredProveedoresOP.slice(0, 8).map(p => (
                        <button key={p.id} onClick={() => { setOpForm({ ...opForm, proveedor_id: p.id }); setProveedorSearch(p.razon_social); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white">
                          {p.razon_social}
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

              {/* Retención */}
              <div>
                <label className="text-xs font-medium text-zinc-500">% Retención ganancias</label>
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

              {/* Calculated fields */}
              {opForm.monto_bruto > 0 && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Monto bruto</span>
                    <span className="font-mono">{formatCurrency(opForm.monto_bruto, opForm.moneda)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Retención ({opForm.retencion_pct}%)</span>
                    <span className="font-mono text-amber-600">- {formatCurrency(opRetencion, opForm.moneda)}</span>
                  </div>
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
                  {!fcForm.proveedor_id && fcProvSearch.trim() && filteredProveedoresFC.length > 0 && (
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
                  <label className="text-xs font-medium text-zinc-500">Percepciones</label>
                  <input type="number" value={fcForm.percepciones || ""} onChange={(e) => setFcForm({ ...fcForm, percepciones: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="0" />
                </div>
              </div>

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

              {/* OC opcional */}
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

              {/* Notas */}
              <div>
                <label className="text-xs font-medium text-zinc-500">Notas</label>
                <textarea value={fcForm.notas} onChange={(e) => setFcForm({ ...fcForm, notas: e.target.value })}
                  rows={2} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Observaciones, condiciones de pago..." />
              </div>
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

              <div>
                <label className="text-xs font-medium text-zinc-500">Categoría</label>
                <select value={gmForm.categoria} onChange={(e) => setGmForm({ ...gmForm, categoria: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                  {GASTO_CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
