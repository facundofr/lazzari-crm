"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { Truck, Plus, X, Loader2, CheckCircle2, Clock, Package, MapPin } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency } from "@/lib/utils";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" | "danger" }> = {
  solicitado: { label: "Solicitado", variant: "warning" },
  en_transito: { label: "En tránsito", variant: "info" },
  entregado: { label: "Entregado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

interface TransporteRow {
  id: string;
  sociedad_id: string;
  fecha: string;
  cliente_id: string | null;
  remito_id: string | null;
  transportista: string;
  tipo_vehiculo: string | null;
  origen: string | null;
  destino: string | null;
  descripcion_carga: string | null;
  peso_kg: number | null;
  bultos: number | null;
  costo: number | null;
  moneda: string;
  comision_porcentaje: number | null;
  comision_monto: number | null;
  estado: string;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  clientes: { razon_social: string } | null;
}

export default function TransportesPage() {
  const { sociedadActiva } = useUser();
  const [transportes, setTransportes] = useState<TransporteRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    transportista: "",
    destino: "",
    origen: "",
    cliente_id: "",
    fecha: new Date().toISOString().split("T")[0],
    costo: "",
    moneda: "ARS" as "ARS" | "USD",
    bultos: "",
    descripcion_carga: "",
    tipo_vehiculo: "",
    notas: "",
  });

  // Detail panel
  const [detailTransporte, setDetailTransporte] = useState<TransporteRow | null>(null);

  // SmartFilters state
  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    estado: "",
    transportista: "",
  });

  const smartFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    {
      key: "estado",
      label: "Estado",
      type: "select",
      options: [
        { value: "solicitado", label: "Solicitado" },
        { value: "en_transito", label: "En tránsito" },
        { value: "entregado", label: "Entregado" },
        { value: "cancelado", label: "Cancelado" },
      ],
    },
    { key: "transportista", label: "Transportista", type: "select" as const, options: [] },
  ];

  const fetchData = useCallback(async () => {
    try {
      let q = (supabase as any)
        .from("transportes")
        .select(`*, clientes(razon_social)`)
        .order("fecha", { ascending: false });

      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

      const { data, error } = await q;

      if (!error && data) {
        setTransportes(data as unknown as TransporteRow[]);
      } else {
        setTransportes([]);
      }
    } catch {
      setTransportes([]);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleEstadoChange(id: string, estado: string) {
    try {
      await (supabase as any).from("transportes").update({ estado }).eq("id", id);
      await fetchData();
      if (detailTransporte?.id === id) {
        setDetailTransporte((prev) => prev ? { ...prev, estado } : null);
      }
    } catch (err) {
      console.error("Error updating transporte:", err);
    }
  }

  async function openCreateModal() {
    setCreateForm({
      transportista: "",
      destino: "",
      origen: "",
      cliente_id: "",
      fecha: new Date().toISOString().split("T")[0],
      costo: "",
      moneda: "ARS",
      bultos: "",
      descripcion_carga: "",
      tipo_vehiculo: "",
      notas: "",
    });
    const { data } = await supabase
      .from("clientes")
      .select("id, razon_social")
      .eq("activo", true)
      .order("razon_social");
    if (data) setClientes(data as { id: string; razon_social: string }[]);
    setCreateModalOpen(true);
  }

  async function handleCreateTransporte() {
    if (!createForm.transportista || !createForm.destino || !createForm.fecha) return;
    setCreating(true);
    try {
      await (supabase as any).from("transportes").insert({
        sociedad_id: sociedadActiva?.id,
        transportista: createForm.transportista,
        destino: createForm.destino,
        origen: createForm.origen || null,
        cliente_id: createForm.cliente_id || null,
        fecha: createForm.fecha,
        costo: createForm.costo ? Number(createForm.costo) : null,
        moneda: createForm.moneda,
        bultos: createForm.bultos ? Number(createForm.bultos) : null,
        descripcion_carga: createForm.descripcion_carga || null,
        tipo_vehiculo: createForm.tipo_vehiculo || null,
        notas: createForm.notas || null,
        estado: "solicitado",
      });
      setCreateModalOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Error creating transporte:", err);
    } finally {
      setCreating(false);
    }
  }

  function handleRowClick(row: TransporteRow) {
    setDetailTransporte(row);
  }

  // Apply filters
  const filteredTransportes = transportes.filter((t) => {
    const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && t.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && t.fecha > fechaFilter.to) return false;
    const estadoFilter = smartFilterValues.estado as string;
    if (estadoFilter && t.estado !== estadoFilter) return false;
    const transportistaFilter = smartFilterValues.transportista as string;
    if (transportistaFilter && !t.transportista.toLowerCase().includes(transportistaFilter.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <>
        <Header title="Transportes" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Transportes"
        subtitle="Gestión de viajes y comisiones"
        action={{ label: "Nuevo transporte", onClick: openCreateModal }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        <SmartFilters
          filters={smartFilterConfigs}
          values={smartFilterValues}
          onChange={setSmartFilterValues}
        />

        <Card className="p-0 overflow-hidden">
          <DataTable<TransporteRow>
            columns={[
              {
                key: "fecha",
                label: "Fecha",
                sortable: true,
                render: (row) => (
                  <span className="text-zinc-500 dark:text-zinc-400">{formatDate(row.fecha)}</span>
                ),
              },
              {
                key: "transportista",
                label: "Transporte",
                sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium dark:text-white">{row.transportista}</span>
                  </div>
                ),
              },
              {
                key: "origen",
                label: "Desde",
                sortable: false,
                render: (row) => (
                  <span className="text-sm dark:text-zinc-300">{row.origen || "—"}</span>
                ),
              },
              {
                key: "destino",
                label: "Hasta",
                sortable: false,
                render: (row) => (
                  <span className="text-sm dark:text-zinc-300">{row.destino || "—"}</span>
                ),
              },
              {
                key: "bultos",
                label: "Bultos",
                sortable: true,
                render: (row) => (
                  <span className="font-medium dark:text-white">{row.bultos != null ? row.bultos : "—"}</span>
                ),
              },
              {
                key: "costo",
                label: "Monto",
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm dark:text-white">
                    {row.costo != null ? formatCurrency(row.costo, row.moneda as "USD" | "ARS") : "—"}
                  </span>
                ),
              },
              {
                key: "estado",
                label: "Estado",
                sortable: true,
                render: (row) => {
                  const cfg = estadoConfig[row.estado] || { label: row.estado, variant: "info" as const };
                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                },
              },
              {
                key: "actions",
                label: "",
                sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {row.estado === "solicitado" && (
                      <button
                        onClick={() => handleEstadoChange(row.id, "en_transito")}
                        className="rounded p-1.5 text-zinc-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/30"
                        title="Marcar en tránsito"
                      >
                        <Truck className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {row.estado === "en_transito" && (
                      <button
                        onClick={() => handleEstadoChange(row.id, "entregado")}
                        className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30"
                        title="Marcar entregado"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {row.estado === "solicitado" && (
                      <button
                        onClick={() => handleEstadoChange(row.id, "cancelado")}
                        className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
                        title="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={filteredTransportes}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* ── Detail Side Panel ───────────────────────────────────────── */}
      {detailTransporte && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailTransporte(null)} />
          <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold dark:text-white">{detailTransporte.transportista}</h2>
                  <Badge variant={(estadoConfig[detailTransporte.estado] || { variant: "info" as const }).variant}>
                    {(estadoConfig[detailTransporte.estado] || { label: detailTransporte.estado }).label}
                  </Badge>
                </div>
                <p className="text-sm text-zinc-400 mt-0.5">{formatDate(detailTransporte.fecha)}</p>
              </div>
              <button onClick={() => setDetailTransporte(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action buttons */}
              {detailTransporte.estado !== "entregado" && detailTransporte.estado !== "cancelado" && (
                <div className="flex flex-wrap gap-2">
                  {detailTransporte.estado === "solicitado" && (
                    <button
                      onClick={() => { handleEstadoChange(detailTransporte.id, "en_transito"); setDetailTransporte({ ...detailTransporte, estado: "en_transito" }); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                    >
                      <Truck className="h-4 w-4" /> En tránsito
                    </button>
                  )}
                  {(detailTransporte.estado === "solicitado" || detailTransporte.estado === "en_transito") && (
                    <button
                      onClick={() => { handleEstadoChange(detailTransporte.id, "entregado"); setDetailTransporte({ ...detailTransporte, estado: "entregado" }); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Marcar entregado
                    </button>
                  )}
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Cliente</span>
                  <p className="font-medium dark:text-white">{detailTransporte.clientes?.razon_social || "—"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Tipo de vehículo</span>
                  <p className="font-medium dark:text-white">{detailTransporte.tipo_vehiculo || "—"}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Origen</span>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                    <p className="font-medium dark:text-white">{detailTransporte.origen || "—"}</p>
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">Destino</span>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-orange-500" />
                    <p className="font-medium dark:text-white">{detailTransporte.destino || "—"}</p>
                  </div>
                </div>
                <div>
                  <span className="text-zinc-400">Costo</span>
                  <p className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                    {detailTransporte.costo != null ? formatCurrency(detailTransporte.costo, detailTransporte.moneda as "USD" | "ARS") : "—"}
                  </p>
                </div>
                <div>
                  <span className="text-zinc-400">Bultos</span>
                  <p className="font-medium dark:text-white">
                    {detailTransporte.bultos != null ? detailTransporte.bultos : "—"}
                  </p>
                </div>
                {detailTransporte.comision_porcentaje != null && (
                  <div>
                    <span className="text-zinc-400">Comisión (%)</span>
                    <p className="font-medium dark:text-white">{detailTransporte.comision_porcentaje}%</p>
                  </div>
                )}
                {detailTransporte.comision_monto != null && (
                  <div>
                    <span className="text-zinc-400">Comisión ($)</span>
                    <p className="font-mono font-medium text-orange-600 dark:text-orange-400">
                      {formatCurrency(detailTransporte.comision_monto, detailTransporte.moneda as "USD" | "ARS")}
                    </p>
                  </div>
                )}
              </div>

              {/* Descripcion carga */}
              {detailTransporte.descripcion_carga && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="text-xs text-zinc-400 block mb-1">Descripción de carga</span>
                  <p className="text-sm dark:text-zinc-300">{detailTransporte.descripcion_carga}</p>
                </div>
              )}

              {/* Notas */}
              {detailTransporte.notas && (
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <span className="text-xs text-zinc-400 block mb-1">Notas</span>
                  <p className="text-sm dark:text-zinc-300">{detailTransporte.notas}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Create Modal ───────────────────────────────────────── */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-white">Nuevo Transporte</h2>
              <button onClick={() => setCreateModalOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Transportista *</label>
                <input
                  type="text"
                  value={createForm.transportista}
                  onChange={(e) => setCreateForm({ ...createForm, transportista: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Nombre del transportista"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Origen</label>
                  <input
                    type="text"
                    value={createForm.origen}
                    onChange={(e) => setCreateForm({ ...createForm, origen: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    placeholder="Ciudad de origen"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destino *</label>
                  <input
                    type="text"
                    value={createForm.destino}
                    onChange={(e) => setCreateForm({ ...createForm, destino: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    placeholder="Ciudad de destino"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                <select
                  value={createForm.cliente_id}
                  onChange={(e) => setCreateForm({ ...createForm, cliente_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha *</label>
                <input
                  type="date"
                  value={createForm.fecha}
                  onChange={(e) => setCreateForm({ ...createForm, fecha: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bultos</label>
                <input
                  type="number"
                  min="0"
                  value={createForm.bultos}
                  onChange={(e) => setCreateForm({ ...createForm, bultos: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Cantidad de bultos"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Monto</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.costo}
                    onChange={(e) => setCreateForm({ ...createForm, costo: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Moneda</label>
                  <select
                    value={createForm.moneda}
                    onChange={(e) => setCreateForm({ ...createForm, moneda: e.target.value as "ARS" | "USD" })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo de vehículo</label>
                <input
                  type="text"
                  value={createForm.tipo_vehiculo}
                  onChange={(e) => setCreateForm({ ...createForm, tipo_vehiculo: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  placeholder="Ej: Semi, Chasis, Balancín..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripción de carga</label>
                <textarea
                  value={createForm.descripcion_carga}
                  onChange={(e) => setCreateForm({ ...createForm, descripcion_carga: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  rows={2}
                  placeholder="Detalle de la mercadería..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notas</label>
                <textarea
                  value={createForm.notas}
                  onChange={(e) => setCreateForm({ ...createForm, notas: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  rows={2}
                  placeholder="Notas adicionales..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreateModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateTransporte}
                disabled={creating || !createForm.transportista || !createForm.destino}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {creating ? "Creando..." : "Crear Transporte"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
