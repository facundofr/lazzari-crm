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
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2, CalendarDays, Clock, Plus, Pencil, Target } from "lucide-react";
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

type FinanzasTab = "movimientos" | "cc_clientes" | "cc_proveedores" | "cheques" | "extractos" | "lineas_credito" | "vencimientos" | "gastos_fijos" | "objetivos";

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
    </>
  );
}
