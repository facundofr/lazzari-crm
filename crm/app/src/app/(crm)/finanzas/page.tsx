"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { mockMovimientos, mockClients, mockProveedores, mockExtractos, mockLineasCredito } from "@/lib/mock-data";
import type { Movimiento, ExtractoMovimiento, LineaCredito } from "@/lib/types";
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory, Loader2, X, Trash2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
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

type FinanzasTab = "movimientos" | "cc_clientes" | "cc_proveedores" | "cheques" | "extractos" | "lineas_credito";

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

  const fetchData = useCallback(async () => {
      setLoading(true);
      try {
        const [movRes, ccCliRes, ccProvRes, extRes, lcRes] = await Promise.all([
          supabase
            .from("movimientos")
            .select(`*, clientes(razon_social), proveedores(razon_social)`)
            .order("fecha", { ascending: false }),
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
  }, []);

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
      <div className="p-8 space-y-6">
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
              data={movimientos}
            />
          </Card>
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
      </div>

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
