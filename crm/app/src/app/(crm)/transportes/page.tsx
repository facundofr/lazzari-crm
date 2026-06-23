"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { Truck, Plus, X, Loader2, CheckCircle2, Clock, Package, MapPin, FileText, Link2 } from "lucide-react";
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
  remitos: { numero: string; estado: string } | null;
}

export default function TransportesPage() {
  const { sociedadActiva } = useUser();
  const [transportes, setTransportes] = useState<TransporteRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string; direccion?: string; localidad?: string }[]>([]);
  const [remitosDisponibles, setRemitosDisponibles] = useState<{ id: string; numero: string; cliente_id: string; clienteNombre: string; estado: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    transportista: "",
    destino: "",
    origen: "",
    cliente_id: "",
    remito_id: "",
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
  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    transportista: "",
    destino: "",
    origen: "",
    costo: "",
    moneda: "ARS" as "ARS" | "USD",
    bultos: "",
    tipo_vehiculo: "",
    descripcion_carga: "",
    notas: "",
  });
  const [saving, setSaving] = useState(false);

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
        .select(`*, clientes(razon_social), remitos(numero, estado)`)
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
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleEstadoChange(id: string, estado: string) {
    try {
      const { error } = await (supabase as any).from("transportes").update({ estado }).eq("id", id);
      if (error) {
        alert("Error al actualizar estado: " + error.message);
        return;
      }
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
      remito_id: "",
      fecha: new Date().toISOString().split("T")[0],
      costo: "",
      moneda: "ARS",
      bultos: "",
      descripcion_carga: "",
      tipo_vehiculo: "",
      notas: "",
    });

    // Fetch clientes and remitos pendientes in parallel
    let clienteQ = supabase.from("clientes").select("id, razon_social, direccion, localidad").eq("activo", true).order("razon_social");
    if (sociedadActiva?.id) clienteQ = clienteQ.eq("sociedad_id" as any, sociedadActiva.id);

    let remitoQ = (supabase as any).from("remitos").select("id, numero, cliente_id, clientes(razon_social), estado").in("estado", ["pendiente", "parcial"]).order("fecha", { ascending: false });
    if (sociedadActiva?.id) remitoQ = remitoQ.eq("sociedad_id", sociedadActiva.id);

    const [clientesRes, remitosRes] = await Promise.all([clienteQ, remitoQ]);

    if (clientesRes.data) setClientes(clientesRes.data as any[]);
    if (remitosRes.data) {
      setRemitosDisponibles((remitosRes.data as any[]).map((r: any) => ({
        id: r.id,
        numero: r.numero,
        cliente_id: r.cliente_id,
        clienteNombre: r.clientes?.razon_social || "",
        estado: r.estado,
      })));
    }
    setCreateModalOpen(true);
  }

  async function handleCreateTransporte() {
    if (!createForm.transportista || !createForm.fecha) return;
    setCreating(true);
    try {
      const { error } = await (supabase as any).from("transportes").insert({
        sociedad_id: sociedadActiva?.id,
        transportista: createForm.transportista,
        destino: createForm.destino || null,
        origen: createForm.origen || null,
        cliente_id: createForm.cliente_id || null,
        remito_id: createForm.remito_id || null,
        fecha: createForm.fecha,
        costo: createForm.costo ? Number(createForm.costo) : null,
        moneda: createForm.moneda,
        bultos: createForm.bultos ? Number(createForm.bultos) : null,
        descripcion_carga: createForm.descripcion_carga || null,
        tipo_vehiculo: createForm.tipo_vehiculo || null,
        notas: createForm.notas || null,
        estado: "solicitado",
      });
      if (error) {
        alert("Error al crear transporte: " + error.message);
        return;
      }
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
    setEditing(false);
  }

  function startEditing() {
    if (!detailTransporte) return;
    setEditForm({
      transportista: detailTransporte.transportista,
      destino: detailTransporte.destino || "",
      origen: detailTransporte.origen || "",
      costo: detailTransporte.costo != null ? String(detailTransporte.costo) : "",
      moneda: detailTransporte.moneda as "ARS" | "USD",
      bultos: detailTransporte.bultos != null ? String(detailTransporte.bultos) : "",
      tipo_vehiculo: detailTransporte.tipo_vehiculo || "",
      descripcion_carga: detailTransporte.descripcion_carga || "",
      notas: detailTransporte.notas || "",
    });
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!detailTransporte) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("transportes").update({
        transportista: editForm.transportista,
        destino: editForm.destino || null,
        origen: editForm.origen || null,
        costo: editForm.costo ? Number(editForm.costo) : null,
        moneda: editForm.moneda,
        bultos: editForm.bultos ? Number(editForm.bultos) : null,
        tipo_vehiculo: editForm.tipo_vehiculo || null,
        descripcion_carga: editForm.descripcion_carga || null,
        notas: editForm.notas || null,
      }).eq("id", detailTransporte.id);
      if (error) {
        alert("Error al guardar: " + error.message);
        return;
      }
      setEditing(false);
      await fetchData();
      // Refresh detail
      const { data } = await (supabase as any).from("transportes").select("*, clientes(razon_social), remitos(numero, estado)").eq("id", detailTransporte.id).single();
      if (data) setDetailTransporte(data as unknown as TransporteRow);
    } catch (err) {
      console.error("Error saving:", err);
    } finally {
      setSaving(false);
    }
  }

  // When selecting a remito in create form, auto-fill cliente
  function handleRemitoSelect(remitoId: string) {
    const remito = remitosDisponibles.find(r => r.id === remitoId);
    setCreateForm(prev => ({
      ...prev,
      remito_id: remitoId,
      cliente_id: remito ? remito.cliente_id : prev.cliente_id,
    }));
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
        subtitle="Gestión de viajes y entregas"
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
                label: "Transportista",
                sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-zinc-400" />
                    <span className="font-medium dark:text-white">{row.transportista}</span>
                  </div>
                ),
              },
              {
                key: "clientes",
                label: "Cliente",
                sortable: false,
                render: (row) => (
                  <span className="text-sm dark:text-zinc-300">{row.clientes?.razon_social || "—"}</span>
                ),
              },
              {
                key: "destino",
                label: "Destino",
                sortable: false,
                render: (row) => (
                  <span className="text-sm dark:text-zinc-300">{row.destino || "—"}</span>
                ),
              },
              {
                key: "remito_id",
                label: "Remito",
                sortable: false,
                render: (row) => row.remitos ? (
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3 text-blue-500" />
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{row.remitos.numero}</span>
                  </div>
                ) : (
                  <span className="text-zinc-400">—</span>
                ),
              },
              {
                key: "costo",
                label: "Monto",
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm dark:text-white">
                    {row.costo != null ? formatCurrency(row.costo, row.moneda as "USD" | "ARS") : <span className="text-zinc-400">Sin costo</span>}
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

      {/* Detail Side Panel */}
      {detailTransporte && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setDetailTransporte(null); setEditing(false); }} />
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
              <div className="flex items-center gap-2">
                {!editing && detailTransporte.estado !== "entregado" && detailTransporte.estado !== "cancelado" && (
                  <button
                    onClick={startEditing}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Editar
                  </button>
                )}
                <button onClick={() => { setDetailTransporte(null); setEditing(false); }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Action buttons */}
              {!editing && detailTransporte.estado !== "entregado" && detailTransporte.estado !== "cancelado" && (
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

              {editing ? (
                /* Edit form */
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Transportista</label>
                    <input type="text" value={editForm.transportista} onChange={e => setEditForm({ ...editForm, transportista: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Origen</label>
                      <input type="text" value={editForm.origen} onChange={e => setEditForm({ ...editForm, origen: e.target.value })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destino</label>
                      <input type="text" value={editForm.destino} onChange={e => setEditForm({ ...editForm, destino: e.target.value })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Monto (opcional)</label>
                      <input type="number" step="0.01" value={editForm.costo} onChange={e => setEditForm({ ...editForm, costo: e.target.value })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Sin costo" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Moneda</label>
                      <select value={editForm.moneda} onChange={e => setEditForm({ ...editForm, moneda: e.target.value as "ARS" | "USD" })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Bultos</label>
                      <input type="number" min="0" value={editForm.bultos} onChange={e => setEditForm({ ...editForm, bultos: e.target.value })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tipo vehículo</label>
                      <input type="text" value={editForm.tipo_vehiculo} onChange={e => setEditForm({ ...editForm, tipo_vehiculo: e.target.value })}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Semi, Chasis..." />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripción de carga</label>
                    <textarea value={editForm.descripcion_carga} onChange={e => setEditForm({ ...editForm, descripcion_carga: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={2} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Notas</label>
                    <textarea value={editForm.notas} onChange={e => setEditForm({ ...editForm, notas: e.target.value })}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" rows={2} />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">
                      Cancelar
                    </button>
                    <button onClick={handleSaveEdit} disabled={saving || !editForm.transportista}
                      className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2">
                      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                        {detailTransporte.costo != null ? formatCurrency(detailTransporte.costo, detailTransporte.moneda as "USD" | "ARS") : <span className="text-zinc-400 font-sans">Sin costo asignado</span>}
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

                  {/* Linked remito */}
                  {detailTransporte.remitos && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3">
                      <span className="text-xs text-blue-500 block mb-1">Remito vinculado</span>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-500" />
                        <button
                          onClick={() => window.open("/remitos", "_self")}
                          className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {detailTransporte.remitos.numero}
                        </button>
                        <Badge variant={detailTransporte.remitos.estado === "entregado" ? "success" : detailTransporte.remitos.estado === "parcial" ? "info" : "warning"}>
                          {detailTransporte.remitos.estado}
                        </Badge>
                      </div>
                    </div>
                  )}

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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
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

              {/* Remito vinculado */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  <span className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Vincular a remito (opcional)</span>
                </label>
                <select
                  value={createForm.remito_id}
                  onChange={(e) => handleRemitoSelect(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                >
                  <option value="">Sin remito</option>
                  {remitosDisponibles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.numero} — {r.clienteNombre}
                    </option>
                  ))}
                </select>
                {createForm.remito_id && (
                  <p className="text-xs text-blue-500 mt-1">El cliente se seleccionó automáticamente del remito.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Cliente</label>
                <select
                  value={createForm.cliente_id}
                  onChange={(e) => setCreateForm({ ...createForm, cliente_id: e.target.value })}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  disabled={!!createForm.remito_id}
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
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
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Destino</label>
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
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Monto (opcional)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.costo}
                    onChange={(e) => setCreateForm({ ...createForm, costo: e.target.value })}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                    placeholder="Sin costo"
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
                disabled={creating || !createForm.transportista}
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
