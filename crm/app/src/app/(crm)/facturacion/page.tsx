"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";
import { mockFacturas } from "@/lib/mock-data";
import { Receipt, DollarSign, FileCheck, AlertTriangle, Loader2, XCircle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { formatDate } from "@/lib/utils";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  emitida: { label: "Emitida", variant: "info" },
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
  estado: string;
  clientes: { razon_social: string; cuit: string } | null;
}

export default function FacturacionPage() {
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
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
      key: "tipo",
      label: "Tipo",
      type: "select",
      options: [
        { value: "FA", label: "FA" },
        { value: "FB", label: "FB" },
        { value: "FC", label: "FC" },
        { value: "NCA", label: "NCA" },
        { value: "NCB", label: "NCB" },
        { value: "NCC", label: "NCC" },
      ],
    },
    {
      key: "estado",
      label: "Estado",
      type: "select",
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
    // fecha filter
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && f.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && f.fecha > fechaFilter.to) return false;

    // tipo filter
    const tipoFilter = filterValues.tipo as string;
    if (tipoFilter && f.tipo !== tipoFilter) return false;

    // estado filter
    const estadoFilter = filterValues.estado as string;
    if (estadoFilter && f.estado !== estadoFilter) return false;

    // monto filter
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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!modalOpen) return;
    supabase
      .from("clientes")
      .select("id, razon_social")
      .eq("activo", true)
      .order("razon_social")
      .then(({ data }) => {
        if (data) setClientes(data);
      });
  }, [modalOpen]);

  async function handleCreate() {
    setFormError(null);
    if (!formData.cliente_id) {
      setFormError("Selecciona un cliente.");
      return;
    }
    if (!formData.numero) {
      setFormError("Ingresa un numero de comprobante.");
      return;
    }
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
        tipo: "FA",
        cliente_id: "",
        punto_venta: 1,
        numero: 0,
        fecha: new Date().toISOString().slice(0, 10),
        subtotal: 0,
        iva: 0,
        total: 0,
      });
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al crear factura");
    } finally {
      setSaving(false);
    }
  }

  async function handleAnular(id: string) {
    if (!confirm("¿Seguro que queres anular esta factura?")) return;
    try {
      await supabase.from("facturas").update({ estado: "anulada" }).eq("id", id);
      await fetchData();
    } catch (err) {
      console.error("Error anulando factura:", err);
    }
  }

  const facturadoMes = facturas.reduce((a, f) => a + Number(f.total), 0);
  const pendientesCobro = facturas.filter(f => f.estado === "emitida").reduce((a, f) => a + Number(f.total), 0);
  const caeVigentes = facturas.filter(f => f.cae).length;

  if (loading) {
    return (
      <>
        <Header title="Facturación" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Facturación"
        subtitle="Comprobantes electrónicos AFIP"
        action={{ label: "Nueva factura", onClick: () => setModalOpen(true) }}
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={formatCurrency(facturadoMes)} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Comprobantes emitidos" value={String(facturas.length)} icon={Receipt} iconColor="text-blue-600" />
          <StatCard title="Pendientes de cobro" value={formatCurrency(pendientesCobro)} icon={AlertTriangle} iconColor="text-amber-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-emerald-600" />
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800 space-y-3">
            <h3 className="font-semibold text-zinc-900 dark:text-white">Comprobantes emitidos</h3>
            <SmartFilters
              filters={filterConfigs}
              values={filterValues}
              onChange={setFilterValues}
            />
          </div>
          <DataTable<FacturaRow>
            columns={[
              {
                key: "tipo", label: "Comprobante",
                render: (row) => (
                  <span className="font-mono text-xs font-bold">
                    {row.tipo} {String(row.punto_venta).padStart(4, "0")}-{String(row.numero).padStart(8, "0")}
                  </span>
                ),
              },
              { key: "clientes", label: "Cliente", sortable: false, render: (row) => <span className="font-medium">{row.clientes?.razon_social}</span> },
              { key: "fecha", label: "Fecha", sortable: true, render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span> },
              { key: "cae", label: "CAE", sortable: false, render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cae || "—"}</span> },
              { key: "total", label: "Total", className: "text-right", sortable: true, render: (row) => <span className="font-mono font-semibold block text-right">{formatCurrency(Number(row.total))}</span> },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "actions", label: "", sortable: false,
                render: (row) => row.estado === "emitida" ? (
                  <button onClick={(e) => { e.stopPropagation(); handleAnular(row.id); }} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-500" title="Anular">
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                ) : null,
              },
            ]}
            data={filteredFacturas}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integraciones AFIP</CardTitle>
            <Badge variant="warning">No configurado</Badge>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">WSFE (Factura electronica)</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-zinc-300" />
                <span className="text-sm font-medium text-zinc-500">Pendiente de configuracion</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">Requiere certificado digital de AFIP</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">Punto de venta</p>
              <p className="mt-2 text-lg font-bold dark:text-white">0001</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500">Ultimo comprobante</p>
              <p className="mt-2 text-lg font-bold font-mono dark:text-white">
                {facturas.length > 0 ? `${facturas[0].tipo} ${String(facturas[0].punto_venta).padStart(4, "0")}-${String(facturas[0].numero).padStart(8, "0")}` : "—"}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-lg mx-4">
            <CardHeader>
              <CardTitle>Nueva factura</CardTitle>
            </CardHeader>
            <div className="space-y-4 p-6 pt-0">
              {formError && (
                <p className="text-sm text-red-500">{formError}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tipo</label>
                  <select
                    value={formData.tipo}
                    onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    {["FA", "FB", "FC", "NCA", "NCB", "NCC"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente</label>
                  <select
                    value={formData.cliente_id}
                    onChange={(e) => setFormData({ ...formData, cliente_id: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Seleccionar...</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.razon_social}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Punto de venta</label>
                  <input
                    type="number"
                    value={formData.punto_venta}
                    onChange={(e) => setFormData({ ...formData, punto_venta: Number(e.target.value) })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Numero</label>
                  <input
                    type="number"
                    value={formData.numero}
                    onChange={(e) => setFormData({ ...formData, numero: Number(e.target.value) })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Fecha</label>
                  <input
                    type="date"
                    value={formData.fecha}
                    onChange={(e) => setFormData({ ...formData, fecha: e.target.value })}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subtotal</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.subtotal}
                    onChange={(e) => {
                      const subtotal = Number(e.target.value);
                      const iva = Math.round(subtotal * 0.21 * 100) / 100;
                      setFormData({ ...formData, subtotal, iva, total: Math.round((subtotal + iva) * 100) / 100 });
                    }}
                    className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">IVA (21%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.iva}
                    readOnly
                    className="w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Total</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total}
                    readOnly
                    className="w-full rounded-md border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Guardando..." : "Crear factura"}
                </button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
