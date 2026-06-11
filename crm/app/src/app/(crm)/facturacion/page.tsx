"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockFacturas } from "@/lib/mock-data";
import {
  Receipt, DollarSign, FileCheck, AlertTriangle, Loader2, XCircle,
  X, Eye, Download, Printer, CheckCircle2, Clock, Ban,
  ExternalLink, ShieldCheck, KeyRound, Server,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
};

const estadoIcon: Record<string, typeof Receipt> = {
  emitida: Clock,
  pagada: CheckCircle2,
  anulada: Ban,
  vencida: AlertTriangle,
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
  estado: string;
  clientes: { razon_social: string; cuit: string } | null;
}

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

export default function FacturacionPage() {
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string; cuit: string }[]>([]);
  const [detailFactura, setDetailFactura] = useState<FacturaRow | null>(null);
  const [formData, setFormData] = useState({
    tipo: "FA",
    cliente_id: "",
    punto_venta: 1,
    numero: 0,
    fecha: new Date().toISOString().slice(0, 10),
    subtotal: 0,
    iva: 0,
    total: 0,
  });

  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "tipo", label: "Tipo", type: "select",
      options: [
        { value: "FA", label: "Factura A" },
        { value: "FB", label: "Factura B" },
        { value: "FC", label: "Factura C" },
        { value: "NCA", label: "Nota Crédito A" },
        { value: "NCB", label: "Nota Crédito B" },
        { value: "NCC", label: "Nota Crédito C" },
      ],
    },
    {
      key: "estado", label: "Estado", type: "select",
      options: [
        { value: "emitida", label: "Emitida" },
        { value: "pagada", label: "Pagada" },
        { value: "anulada", label: "Anulada" },
        { value: "vencida", label: "Vencida" },
      ],
    },
    { key: "monto", label: "Monto", type: "number-range" },
  ];

  const [filterValues, setFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    tipo: "",
    estado: "",
    monto: {},
  });

  const filteredFacturas = facturas.filter((f) => {
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && f.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && f.fecha > fechaFilter.to) return false;
    const tipoFilter = filterValues.tipo as string;
    if (tipoFilter && f.tipo !== tipoFilter) return false;
    const estadoFilter = filterValues.estado as string;
    if (estadoFilter && f.estado !== estadoFilter) return false;
    const montoFilter = filterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && Number(f.total) < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && Number(f.total) > montoFilter.max) return false;
    return true;
  });

  const fetchData = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("facturas")
        .select(`*, clientes(razon_social, cuit)`)
        .order("fecha", { ascending: false });

      if (!error && data && data.length > 0) {
        setFacturas(data as unknown as FacturaRow[]);
      } else {
        setFacturas(mockFacturas.map((f) => ({
          id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
          cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
          subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
          clientes: { razon_social: f.clienteNombre, cuit: "" },
        })));
      }
    } catch {
      setFacturas(mockFacturas.map((f) => ({
        id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
        cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
        subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
        clientes: { razon_social: f.clienteNombre, cuit: "" },
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!modalOpen) return;
    supabase
      .from("clientes")
      .select("id, razon_social, cuit")
      .eq("activo", true)
      .order("razon_social")
      .then(({ data }) => {
        if (data) setClientes(data as { id: string; razon_social: string; cuit: string }[]);
      });
  }, [modalOpen]);

  async function handleCreate() {
    setFormError(null);
    if (!formData.cliente_id) { setFormError("Selecciona un cliente."); return; }
    if (!formData.numero) { setFormError("Ingresa un numero de comprobante."); return; }
    setSaving(true);
    try {
      const { error } = await (supabase.from("facturas") as any).insert({
        tipo: formData.tipo,
        cliente_id: formData.cliente_id,
        punto_venta: formData.punto_venta,
        numero: formData.numero,
        fecha: formData.fecha,
        subtotal: formData.subtotal,
        iva: formData.iva,
        total: formData.total,
        estado: "emitida",
      });
      if (error) throw error;
      setModalOpen(false);
      setFormData({
        tipo: "FA", cliente_id: "", punto_venta: 1, numero: 0,
        fecha: new Date().toISOString().slice(0, 10), subtotal: 0, iva: 0, total: 0,
      });
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al crear factura");
    } finally {
      setSaving(false);
    }
  }

  async function handleAnular(id: string) {
    if (!confirm("¿Seguro que querés anular esta factura? Esta acción no se puede deshacer.")) return;
    try {
      await supabase.from("facturas").update({ estado: "anulada" }).eq("id", id);
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura(null);
    } catch (err) {
      console.error("Error anulando factura:", err);
    }
  }

  async function handleMarcarPagada(id: string) {
    try {
      await supabase.from("facturas").update({ estado: "pagada" }).eq("id", id);
      await fetchData();
      if (detailFactura?.id === id) {
        setDetailFactura((prev) => prev ? { ...prev, estado: "pagada" } : null);
      }
    } catch (err) {
      console.error("Error marcando factura como pagada:", err);
    }
  }

  // KPIs
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const facturasEsteMes = facturas.filter((f) => {
    const d = new Date(f.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && f.estado !== "anulada";
  });
  const facturadoMes = facturasEsteMes.reduce((a, f) => a + Number(f.total), 0);
  const pendientesCobro = facturas.filter(f => f.estado === "emitida").reduce((a, f) => a + Number(f.total), 0);
  const facturasVencidas = facturas.filter(f => f.estado === "vencida").length;
  const caeVigentes = facturas.filter(f => f.cae && f.estado !== "anulada").length;

  if (loading) {
    return (
      <>
        <Header title="Facturación" subtitle="Comprobantes electrónicos" />
        <div className="flex items-center justify-center h-96">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            <span className="text-sm text-zinc-400">Cargando comprobantes...</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Facturación"
        subtitle="Comprobantes electrónicos AFIP"
        action={{ label: "Nuevo comprobante", onClick: () => setModalOpen(true) }}
      />
      <div className="p-6 lg:p-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={formatCurrency(facturadoMes)} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Pendientes de cobro" value={formatCurrency(pendientesCobro)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Comprobantes vencidos" value={String(facturasVencidas)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-blue-600" />
        </div>

        {/* Tabla principal */}
        <Card className="p-0 overflow-hidden">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-zinc-900 dark:text-white">Comprobantes emitidos</h3>
              <span className="text-xs text-zinc-400">{filteredFacturas.length} de {facturas.length}</span>
            </div>
            <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />
          </div>
          <DataTable<FacturaRow>
            columns={[
              {
                key: "tipo", label: "Comprobante",
                render: (row) => {
                  const Icon = estadoIcon[row.estado] || Receipt;
                  return (
                    <div className="flex items-center gap-2.5">
                      <div className={`rounded-md p-1.5 ${
                        row.estado === "pagada" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400" :
                        row.estado === "anulada" ? "bg-red-50 text-red-500 dark:bg-red-950 dark:text-red-400" :
                        row.estado === "vencida" ? "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400" :
                        "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                      }`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <span className="font-mono text-xs font-bold block">{formatComprobante(row.tipo, row.punto_venta, row.numero)}</span>
                        <span className="text-[10px] text-zinc-400">{row.tipo.startsWith("NC") ? "Nota de crédito" : "Factura"}</span>
                      </div>
                    </div>
                  );
                },
              },
              { key: "clientes", label: "Cliente", sortable: false, render: (row) => (
                <div>
                  <span className="font-medium block">{row.clientes?.razon_social}</span>
                  {row.clientes?.cuit && <span className="text-[10px] text-zinc-400">{row.clientes.cuit}</span>}
                </div>
              )},
              { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
              { key: "cae", label: "CAE", sortable: false, render: (row) => (
                row.cae ? (
                  <div>
                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400 block">{row.cae}</span>
                    {row.cae_vencimiento && <span className="text-[10px] text-zinc-400">Vto: {formatDate(row.cae_vencimiento)}</span>}
                  </div>
                ) : <span className="text-zinc-300 dark:text-zinc-600">Sin CAE</span>
              )},
              { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => (
                <span className="font-mono font-semibold block text-right">{formatCurrency(Number(row.total))}</span>
              )},
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setDetailFactura(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Ver detalle">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    {row.estado === "emitida" && (
                      <>
                        <button onClick={() => handleMarcarPagada(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-emerald-100 hover:text-emerald-600" title="Marcar pagada">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleAnular(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            data={filteredFacturas}
            onRowClick={setDetailFactura}
          />
        </Card>

        {/* AFIP Integration Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <CardTitle>Integración AFIP</CardTitle>
            </div>
            <Badge variant="warning">Próximamente</Badge>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
                  <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">WSFE</p>
                  <p className="text-xs text-zinc-400">Factura electrónica</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="text-xs text-zinc-500">Pendiente de configuración</span>
              </div>
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
                <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="text-xs text-zinc-500">No cargado</span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500 mb-2">Punto de venta</p>
              <p className="text-2xl font-bold font-mono dark:text-white">0001</p>
              <p className="text-xs text-zinc-400 mt-1">
                Último: {facturas.length > 0 ? formatComprobante(facturas[0].tipo, facturas[0].punto_venta, facturas[0].numero) : "—"}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Create Modal ──────────────────────────────────────────────── */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Nuevo comprobante</h2>
                <p className="text-sm text-zinc-400">Ingresá los datos del comprobante</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-5 p-6">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
                  {formError}
                </div>
              )}

              {/* Tipo + Cliente */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tipo *</label>
                  <select
                    value={formData.tipo}
                    onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    <optgroup label="Facturas">
                      <option value="FA">Factura A</option>
                      <option value="FB">Factura B</option>
                      <option value="FC">Factura C</option>
                    </optgroup>
                    <optgroup label="Notas de crédito">
                      <option value="NCA">NC A</option>
                      <option value="NCB">NC B</option>
                      <option value="NCC">NC C</option>
                    </optgroup>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente *</label>
                  <select
                    value={formData.cliente_id}
                    onChange={(e) => setFormData({ ...formData, cliente_id: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.razon_social}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Numeración */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Pto. venta</label>
                  <input
                    type="number" min={1}
                    value={formData.punto_venta}
                    onChange={(e) => setFormData({ ...formData, punto_venta: Number(e.target.value) })}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-mono focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Número *</label>
                  <input
                    type="number" min={1}
                    value={formData.numero || ""}
                    onChange={(e) => setFormData({ ...formData, numero: Number(e.target.value) })}
                    placeholder="00000001"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-mono focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Fecha</label>
                  <input
                    type="date"
                    value={formData.fecha}
                    onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Preview del comprobante */}
              {formData.numero > 0 && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5 text-center">
                  <span className="text-xs text-zinc-400">Comprobante: </span>
                  <span className="font-mono text-sm font-bold text-zinc-700 dark:text-zinc-300">
                    {formatComprobante(formData.tipo, formData.punto_venta, formData.numero)}
                  </span>
                </div>
              )}

              {/* Montos */}
              <div>
                <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">Importes</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-500">Neto gravado</label>
                    <input
                      type="number" step="0.01" min={0}
                      value={formData.subtotal || ""}
                      onChange={(e) => {
                        const subtotal = Number(e.target.value);
                        const iva = Math.round(subtotal * 0.21 * 100) / 100;
                        setFormData({ ...formData, subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100 });
                      }}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-mono focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-500">IVA (21%)</label>
                    <input
                      type="number" step="0.01"
                      value={formData.iva}
                      readOnly
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2.5 text-sm font-mono text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs text-zinc-500">Total</label>
                    <input
                      type="number" step="0.01"
                      value={formData.total}
                      readOnly
                      className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-mono font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
              <button
                type="button" onClick={() => setModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button" onClick={handleCreate} disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Guardando..." : "Crear comprobante"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Detail Side Panel ─────────────────────────────────────────── */}
      {detailFactura && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailFactura(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto animate-slide-in-right">
            {/* Header */}
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
              <button onClick={() => setDetailFactura(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Cliente */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Cliente</h4>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{detailFactura.clientes?.razon_social}</p>
                {detailFactura.clientes?.cuit && (
                  <p className="text-xs text-zinc-500 mt-0.5">CUIT: {detailFactura.clientes.cuit}</p>
                )}
              </div>

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
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                    Sin CAE asignado
                  </div>
                )}
              </div>

              {/* Importes */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Importes</h4>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-zinc-500">Neto gravado</span>
                    <span className="font-mono">{formatCurrency(Number(detailFactura.subtotal))}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(Number(detailFactura.iva))}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-sm border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <span className="text-zinc-700 dark:text-zinc-300">Total</span>
                    <span className="font-mono text-base">{formatCurrency(Number(detailFactura.total))}</span>
                  </div>
                </div>
              </div>

              {/* Acciones */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Acciones</h4>
                <div className="space-y-2">
                  {detailFactura.estado === "emitida" && (
                    <>
                      <button
                        onClick={() => handleMarcarPagada(detailFactura.id)}
                        className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Marcar como pagada
                      </button>
                      <button
                        onClick={() => handleAnular(detailFactura.id)}
                        className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                      >
                        <XCircle className="h-4 w-4" />
                        Anular comprobante
                      </button>
                    </>
                  )}
                  <button className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Printer className="h-4 w-4" />
                    Imprimir
                  </button>
                  <button className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Download className="h-4 w-4" />
                    Descargar PDF
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
