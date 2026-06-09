"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { mockPresupuestos } from "@/lib/mock-data";
import type { Presupuesto, PRStatus } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Send, Eye, Copy, FileText, CheckCircle2, XCircle, Clock,
  PauseCircle, Edit3, Loader2, X, Trash2, ArrowRight, AlertTriangle, Plus, Minus,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { useUser } from "@/lib/auth-context";

interface SupabasePresupuesto {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  vencimiento: string;
  estado: PRStatus;
  motivo_rechazo?: string | null;
  markup_general: number;
  subtotal: number;
  iva: number;
  total: number;
  moneda: "USD" | "ARS";
  observaciones: string;
  enviado_at?: string | null;
  respondido_at?: string | null;
  version?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  vendedor_id: string | null;
  clientes?: { razon_social: string; cuit: string } | null;
  created_by_profile?: { full_name: string } | null;
  vendedor_profile?: { full_name: string; avatar_url: string | null } | null;
  presupuesto_items?: PresupuestoItem[];
}

interface PresupuestoItem {
  id?: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precio_costo: number;
  markup_porcentaje: number;
  precio_venta: number;
  subtotal: number;
  iva_porcentaje?: number;
  iva: number;
  total: number;
  orden?: number;
}

function mapToPresupuesto(row: SupabasePresupuesto): Presupuesto {
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    clienteNombre: row.clientes?.razon_social ?? "",
    fecha: row.fecha,
    vencimiento: row.vencimiento,
    estado: row.estado,
    motivoRechazo: row.motivo_rechazo ?? undefined,
    markupGeneral: row.markup_general,
    items: (row.presupuesto_items ?? []).map((it, idx) => ({
      id: it.id ?? `item-${idx}`,
      productoId: "",
      codigo: it.codigo,
      descripcion: it.descripcion,
      categoria: it.categoria,
      cantidad: it.cantidad,
      unidad: it.unidad,
      precioCosto: it.precio_costo,
      markupPorcentaje: it.markup_porcentaje,
      precioVenta: it.precio_venta,
      subtotal: it.subtotal,
      iva: it.iva,
      total: it.total,
    })),
    subtotal: row.subtotal,
    iva: row.iva,
    total: row.total,
    moneda: row.moneda,
    observaciones: row.observaciones ?? "",
    creadoPor: (row as any).created_by_profile?.full_name ?? row.created_by ?? "",
    enviadoAt: row.enviado_at ?? undefined,
    respondidoAt: row.respondido_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vendedorNombre: row.vendedor_profile?.full_name ?? "",
    vendedorAvatar: row.vendedor_profile?.avatar_url ?? null,
    vendedorId: row.vendedor_id ?? null,
  } as any;
}

const statusConfig: Record<PRStatus, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info"; icon: typeof Clock }> = {
  borrador: { label: "Borrador", variant: "outline", icon: Edit3 },
  pendiente: { label: "Pendiente", variant: "warning", icon: Clock },
  aprobado: { label: "Aprobado", variant: "success", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", variant: "danger", icon: XCircle },
  postergado: { label: "Postergado", variant: "purple", icon: PauseCircle },
  vencido: { label: "Vencido", variant: "danger", icon: Clock },
};

interface NewPRItem {
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precio_costo: number;
  markup_porcentaje: number;
  precio_venta: number;
  iva_porcentaje: number;
}

function calcItemTotals(item: NewPRItem) {
  const subtotal = item.cantidad * item.precio_venta;
  const iva = subtotal * (item.iva_porcentaje / 100);
  return { subtotal, iva, total: subtotal + iva };
}

const emptyItem: NewPRItem = {
  codigo: "", descripcion: "", categoria: "", cantidad: 1, unidad: "UN",
  precio_costo: 0, markup_porcentaje: 0, precio_venta: 0, iva_porcentaje: 21,
};

export default function PresupuestosPage() {
  const { profile } = useUser();
  const [filter, setFilter] = useState<PRStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail panel
  const [selected, setSelected] = useState<Presupuesto | null>(null);

  // Vendedor filter
  const [vendedorFilter, setVendedorFilter] = useState<string>("");
  const [vendedores, setVendedores] = useState<{id: string; full_name: string}[]>([]);

  // Rechazo modal
  const [rechazoModal, setRechazoModal] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  // Nuevo PR modal
  const [showNewPR, setShowNewPR] = useState(false);
  const [newPRSaving, setNewPRSaving] = useState(false);
  const [clientes, setClientes] = useState<{id: string; razon_social: string}[]>([]);
  const [newPR, setNewPR] = useState({
    cliente_id: "",
    vendedor_id: "",
    moneda: "USD" as "USD" | "ARS",
    markup_general: 30,
    observaciones: "",
    items: [{ ...emptyItem }] as NewPRItem[],
  });

  // Smart filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    { key: "moneda", label: "Moneda", type: "select", options: [{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }] },
    { key: "monto", label: "Monto total", type: "number-range" },
  ];
  const [filterValues, setFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, moneda: "", monto: {} });

  const fetchPresupuestos = useCallback(async () => {
    try {
      // First try with items + vendedor profile
      let res: { data: any; error: any } = await supabase
        .from("presupuestos")
        .select(`*, clientes(razon_social, cuit), vendedor_profile:vendedor_id(full_name, avatar_url), presupuesto_items(*)`)
        .order("fecha", { ascending: false });

      // If that fails, try without items
      if (res.error) {
        res = await supabase
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit), vendedor_id`)
          .order("fecha", { ascending: false });
      }

      // If still fails, try minimal
      if (res.error) {
        res = await supabase
          .from("presupuestos")
          .select(`*, vendedor_id`)
          .order("fecha", { ascending: false });
      }

      const { data, error } = res;
      if (!error && data && data.length > 0) {
        setPresupuestos((data as unknown as SupabasePresupuesto[]).map(mapToPresupuesto));
      } else {
        setPresupuestos(mockPresupuestos);
      }
    } catch {
      setPresupuestos(mockPresupuestos);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresupuestos();
  }, [fetchPresupuestos]);

  useEffect(() => {
    async function fetchVendedores() {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("role", ["vendedor", "admin", "super_admin"])
          .order("full_name");
        if (!error && data) {
          setVendedores(data as { id: string; full_name: string }[]);
        }
      } catch {
        // ignore
      }
    }
    fetchVendedores();
  }, []);

  useEffect(() => {
    if (!showNewPR) return;
    async function fetchClientes() {
      try {
        const { data } = await supabase
          .from("clientes")
          .select("id, razon_social")
          .eq("activo", true)
          .order("razon_social");
        if (data) setClientes(data);
      } catch { /* ignore */ }
    }
    fetchClientes();
  }, [showNewPR]);

  function updateNewPRItem(index: number, field: keyof NewPRItem, value: string | number) {
    setNewPR((prev) => {
      const items = [...prev.items];
      const item = { ...items[index], [field]: value };
      // Auto-calc precio_venta when costo or markup change
      if (field === "precio_costo" || field === "markup_porcentaje") {
        item.precio_venta = Number((item.precio_costo * (1 + item.markup_porcentaje / 100)).toFixed(2));
      }
      items[index] = item;
      return { ...prev, items };
    });
  }

  async function handleCreatePR() {
    if (!newPR.cliente_id || !newPR.vendedor_id) {
      alert("Seleccioná un cliente y un vendedor");
      return;
    }
    const validItems = newPR.items.filter((it) => it.descripcion.trim() && it.cantidad > 0);
    if (validItems.length === 0) {
      alert("Agregá al menos un item");
      return;
    }
    setNewPRSaving(true);
    try {
      // Calculate totals
      let subtotal = 0;
      let ivaTotal = 0;
      const itemsWithTotals = validItems.map((it, idx) => {
        const t = calcItemTotals(it);
        subtotal += t.subtotal;
        ivaTotal += t.iva;
        return { ...it, subtotal: t.subtotal, iva: t.iva, total: t.total, orden: idx + 1 };
      });

      const today = new Date().toISOString().split("T")[0];
      const vencimiento = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

      const { data: newRow, error } = await supabase
        .from("presupuestos")
        .insert({
          cliente_id: newPR.cliente_id,
          vendedor_id: newPR.vendedor_id,
          created_by: profile?.id,
          fecha: today,
          vencimiento,
          estado: "borrador",
          markup_general: newPR.markup_general,
          subtotal,
          iva: ivaTotal,
          total: subtotal + ivaTotal,
          moneda: newPR.moneda,
          observaciones: newPR.observaciones,
        } as any)
        .select()
        .single();

      if (error) throw new Error(error.message);

      if (newRow && itemsWithTotals.length > 0) {
        const items = itemsWithTotals.map((it) => ({
          presupuesto_id: newRow.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          categoria: it.categoria,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_costo: it.precio_costo,
          markup_porcentaje: it.markup_porcentaje,
          precio_venta: it.precio_venta,
          subtotal: it.subtotal,
          iva_porcentaje: it.iva_porcentaje,
          iva: it.iva,
          total: it.total,
          orden: it.orden,
        }));
        await supabase.from("presupuesto_items").insert(items);
      }

      setShowNewPR(false);
      setNewPR({ cliente_id: "", vendedor_id: "", moneda: "USD", markup_general: 30, observaciones: "", items: [{ ...emptyItem }] });
      await fetchPresupuestos();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      alert(`Error al crear presupuesto: ${msg}`);
    } finally {
      setNewPRSaving(false);
    }
  }

  const filtered = presupuestos.filter((pr) => {
    if (filter !== "todos" && pr.estado !== filter) return false;
    if (search && !pr.numero.toLowerCase().includes(search.toLowerCase()) && !pr.clienteNombre.toLowerCase().includes(search.toLowerCase())) return false;
    if (vendedorFilter && (pr as any).vendedorId !== vendedorFilter) return false;
    // Smart filters
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && pr.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && pr.fecha > fechaFilter.to) return false;
    const monedaFilter = filterValues.moneda as string;
    if (monedaFilter && pr.moneda !== monedaFilter) return false;
    const montoFilter = filterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && pr.total < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && pr.total > montoFilter.max) return false;
    return true;
  });

  const counts: Record<string, number> = { todos: presupuestos.length };
  presupuestos.forEach((pr) => { counts[pr.estado] = (counts[pr.estado] || 0) + 1; });

  async function handleEstadoChange(id: string, estado: PRStatus, motivo?: string) {
    try {
      const update: { estado: string; motivo_rechazo?: string; enviado_at?: string; respondido_at?: string } = { estado };
      if (motivo) update.motivo_rechazo = motivo;
      if (estado === "pendiente") update.enviado_at = new Date().toISOString();
      if (["aprobado", "rechazado", "postergado"].includes(estado)) update.respondido_at = new Date().toISOString();

      const { error, status, statusText } = await supabase
        .from("presupuestos")
        .update(update as any)
        .eq("id", id);
      if (error) throw new Error(`${error.message} (${error.code}) [${status} ${statusText}]`);
      await fetchPresupuestos();
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, estado, motivoRechazo: motivo ?? prev.motivoRechazo } : null);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("Error updating estado:", msg);
      alert(`Error al cambiar estado: ${msg}`);
    }
  }

  async function handleDuplicate(id: string) {
    try {
      const original = presupuestos.find((p) => p.id === id);
      if (!original) return;

      // Get full data from Supabase
      const { data: fullPR, error } = await supabase
        .from("presupuestos")
        .select(`*, presupuesto_items(*)`)
        .eq("id", id)
        .single();

      if (error || !fullPR) {
        console.error("Error fetching PR for duplicate:", error);
        return;
      }

      const { id: _id, numero: _num, created_at: _ca, updated_at: _ua, enviado_at: _ea, respondido_at: _ra, presupuesto_items, ...rest } = fullPR;

      const { data: newPR, error: insertError } = await supabase
        .from("presupuestos")
        .insert({ ...rest, estado: "borrador", version: 1 } as any)
        .select()
        .single();

      if (insertError || !newPR) {
        console.error("Error duplicating:", insertError);
        return;
      }

      if (presupuesto_items && presupuesto_items.length > 0) {
        const items = presupuesto_items.map(({ id: _iid, presupuesto_id: _pid, created_at: _ica, ...itemRest }: Record<string, unknown>) => ({
          ...itemRest,
          presupuesto_id: newPR.id,
        }));
        await supabase.from("presupuesto_items").insert(items as any);
      }

      await fetchPresupuestos();
    } catch (err) {
      console.error("Error duplicating PR:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Seguro que queres eliminar este presupuesto?")) return;
    try {
      await supabase.from("presupuesto_items").delete().eq("presupuesto_id", id);
      await supabase.from("presupuestos").delete().eq("id", id);
      setSelected(null);
      await fetchPresupuestos();
    } catch (err) {
      console.error("Error deleting:", err);
    }
  }

  function handleRechazoConfirm() {
    if (rechazoModal && motivoRechazo.trim()) {
      handleEstadoChange(rechazoModal, "rechazado", motivoRechazo.trim());
      setRechazoModal(null);
      setMotivoRechazo("");
    }
  }

  if (loading) {
    return (
      <>
        <Header title="Presupuestos" subtitle="Cargando..." action={{ label: "Nuevo PR", onClick: () => {} }} />
        <div className="flex items-center justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Presupuestos"
        subtitle={`${presupuestos.length} presupuestos totales`}
        action={{ label: "Nuevo PR", onClick: () => setShowNewPR(true) }}
      />
      <div className="p-8 space-y-6">
        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todos", "borrador", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                filter === status
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700"
              }`}
            >
              {status === "todos" ? "Todos" : statusConfig[status].label}
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                filter === status ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
              }`}>
                {counts[status] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search + Vendedor filter */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por N° PR o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <select
            value={vendedorFilter}
            onChange={(e) => setVendedorFilter(e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los vendedores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
        </div>

        {/* Smart filters */}
        <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<Presupuesto>
            columns={[
              {
                key: "numero", label: "N° PR", sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "clienteNombre", label: "Cliente", sortable: true,
                render: (row) => <span className="font-medium">{row.clienteNombre}</span>,
              },
              {
                key: "items", label: "Items", sortable: false,
                render: (row) => <span className="text-zinc-500">{row.items.length} lineas</span>,
              },
              {
                key: "total", label: "Total", className: "text-right", sortable: true,
                render: (row) => (
                  <span className="font-mono font-semibold block text-right">
                    {formatCurrency(row.total, row.moneda)}
                  </span>
                ),
              },
              {
                key: "vendedorNombre" as any, label: "Vendedor", sortable: true,
                render: (row) => {
                  const nombre = (row as any).vendedorNombre;
                  const avatar = (row as any).vendedorAvatar;
                  if (!nombre) return <span className="text-zinc-400">&mdash;</span>;
                  return (
                    <div className="flex items-center gap-2">
                      {avatar ? (
                        <img src={avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-orange-100 flex items-center justify-center text-xs font-bold text-orange-600">
                          {nombre.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm">{nombre}</span>
                    </div>
                  );
                },
              },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = statusConfig[row.estado];
                  const Icon = cfg.icon;
                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </div>
                  );
                },
              },
              {
                key: "fecha", label: "Fecha", sortable: true,
                render: (row) => (
                  <div>
                    <p className="text-zinc-600 dark:text-zinc-300">{formatDate(row.fecha)}</p>
                    <p className="text-xs text-zinc-400">Vence: {formatDate(row.vencimiento)}</p>
                  </div>
                ),
              },
              {
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelected(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Ver">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDuplicate(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Duplicar">
                      <Copy className="h-4 w-4" />
                    </button>
                    {(row.estado === "borrador" || row.estado === "postergado") && (
                      <button onClick={() => handleEstadoChange(row.id, "pendiente")} className="rounded p-1.5 text-zinc-400 hover:bg-orange-100 hover:text-orange-600" title="Enviar">
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {row.estado === "pendiente" && (
                      <>
                        <button onClick={() => handleEstadoChange(row.id, "aprobado")} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600" title="Aprobar">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setRechazoModal(row.id); setMotivoRechazo(""); }} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600" title="Rechazar">
                          <XCircle className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleEstadoChange(row.id, "postergado")} className="rounded p-1.5 text-zinc-400 hover:bg-purple-100 hover:text-purple-600" title="Postergar">
                          <PauseCircle className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            data={filtered}
            onRowClick={(row) => setSelected(row)}
          />
        </Card>

        {/* Motivos de rechazo */}
        {presupuestos.some((pr) => pr.motivoRechazo) && (
          <Card>
            <CardHeader>
              <CardTitle>Motivos de rechazo recientes</CardTitle>
            </CardHeader>
            <div className="space-y-3">
              {presupuestos
                .filter((pr) => pr.motivoRechazo)
                .slice(0, 5)
                .map((pr) => (
                  <div key={pr.id} className="flex items-start gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-950/30">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div>
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {pr.numero} — {pr.clienteNombre}
                      </p>
                      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{pr.motivoRechazo}</p>
                      {pr.respondidoAt && <p className="mt-1 text-xs text-zinc-400">{formatDate(pr.respondidoAt)}</p>}
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        )}
      </div>

      {/* Detail side panel */}
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelected(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-zinc-700">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">PR {selected.numero}</h2>
                  {(() => {
                    const cfg = statusConfig[selected.estado];
                    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                  })()}
                </div>
                <p className="text-sm text-zinc-500">{selected.clienteNombre}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDuplicate(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Duplicar">
                  <Copy className="h-4 w-4" />
                </button>
                {selected.estado === "borrador" && (
                  <button onClick={() => handleDelete(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {/* Info grid */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">Fecha</p>
                  <p className="text-sm font-medium">{formatDate(selected.fecha)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Vencimiento</p>
                  <p className="text-sm font-medium">{formatDate(selected.vencimiento)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Creado por</p>
                  <p className="text-sm font-medium">{selected.creadoPor}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Vendedor</p>
                  {(selected as any).vendedorNombre ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      {(selected as any).vendedorAvatar ? (
                        <img src={(selected as any).vendedorAvatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-orange-100 flex items-center justify-center text-[10px] font-bold text-orange-600">
                          {(selected as any).vendedorNombre.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <p className="text-sm font-medium">{(selected as any).vendedorNombre}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400">&mdash;</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Moneda</p>
                  <p className="text-sm font-medium">{selected.moneda}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Markup general</p>
                  <p className="text-sm font-medium">{selected.markupGeneral}%</p>
                </div>
                {selected.enviadoAt && (
                  <div>
                    <p className="text-xs text-zinc-500">Enviado</p>
                    <p className="text-sm font-medium">{formatDate(selected.enviadoAt)}</p>
                  </div>
                )}
              </div>

              {/* Items table */}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Items ({selected.items.length})</h3>
                {(() => {
                  const belowCostCount = selected.items.filter((item) => item.precioVenta < item.precioCosto).length;
                  return belowCostCount > 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400 mb-3">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Atención: {belowCostCount} item(s) con precio de venta menor al costo</span>
                    </div>
                  ) : null;
                })()}
                <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500">Codigo</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500">Descripcion</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500">Cant.</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500">P. Costo</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500">Markup</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500">P. Venta</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {selected.items.map((item) => {
                        const belowCost = item.precioVenta < item.precioCosto;
                        return (
                        <tr key={item.id} className={belowCost ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                          <td className="px-3 py-2 font-mono text-xs">{item.codigo}</td>
                          <td className="px-3 py-2">{item.descripcion}</td>
                          <td className="px-3 py-2 text-right">{item.cantidad} {item.unidad}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.precioCosto)}</td>
                          <td className="px-3 py-2 text-right">{item.markupPorcentaje}%</td>
                          <td className={`px-3 py-2 text-right font-mono ${belowCost ? "text-red-600 dark:text-red-400" : ""}`}>
                            <span className="inline-flex items-center gap-1">
                              {belowCost && <AlertTriangle className="h-3 w-3 shrink-0" />}
                              {formatCurrency(item.precioVenta)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(item.total)}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="font-mono">{formatCurrency(selected.subtotal, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(selected.iva, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t border-zinc-200 pt-2 dark:border-zinc-700">
                    <span>Total</span>
                    <span className="font-mono">{formatCurrency(selected.total, selected.moneda)}</span>
                  </div>
                </div>
              </div>

              {/* Observaciones */}
              {selected.observaciones && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Observaciones</h3>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selected.observaciones}</p>
                </div>
              )}

              {/* Motivo rechazo */}
              {selected.motivoRechazo && (
                <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">Motivo de rechazo</span>
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-300">{selected.motivoRechazo}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700 flex flex-wrap gap-2">
                {(selected.estado === "borrador" || selected.estado === "postergado") && (
                  <button
                    onClick={() => { handleEstadoChange(selected.id, "pendiente"); }}
                    className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
                  >
                    <Send className="h-4 w-4" /> Enviar al cliente
                  </button>
                )}
                {selected.estado === "pendiente" && (
                  <>
                    <button
                      onClick={() => handleEstadoChange(selected.id, "aprobado")}
                      className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Aprobar
                    </button>
                    <button
                      onClick={() => { setRechazoModal(selected.id); setMotivoRechazo(""); }}
                      className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      <XCircle className="h-4 w-4" /> Rechazar
                    </button>
                    <button
                      onClick={() => handleEstadoChange(selected.id, "postergado")}
                      className="flex items-center gap-2 rounded-lg border border-purple-300 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
                    >
                      <PauseCircle className="h-4 w-4" /> Postergar
                    </button>
                  </>
                )}
                {selected.estado === "aprobado" && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Aprobado{selected.respondidoAt ? ` el ${formatDate(selected.respondidoAt)}` : ""}</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                    <span className="text-zinc-500">Listo para facturar</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Nuevo PR modal */}
      {showNewPR && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setShowNewPR(false)} />
          <div className="fixed inset-4 z-[60] m-auto h-fit max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">Nuevo Presupuesto</h3>
              <button onClick={() => setShowNewPR(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Creado por (auto) */}
            <div className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
              <span className="text-zinc-500">Creado por:</span>{" "}
              <span className="font-medium text-zinc-900 dark:text-white">{profile?.full_name ?? profile?.email ?? "—"}</span>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              {/* Cliente */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Cliente *</label>
                <select
                  value={newPR.cliente_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, cliente_id: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">Seleccionar cliente...</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                </select>
              </div>
              {/* Vendedor */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Vendedor *</label>
                <select
                  value={newPR.vendedor_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, vendedor_id: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">Seleccionar vendedor...</option>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              {/* Moneda */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Moneda</label>
                <select
                  value={newPR.moneda}
                  onChange={(e) => setNewPR((p) => ({ ...p, moneda: e.target.value as "USD" | "ARS" }))}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </div>
              {/* Markup general */}
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-500">Markup general %</label>
                <input
                  type="number"
                  value={newPR.markup_general}
                  onChange={(e) => setNewPR((p) => ({ ...p, markup_general: Number(e.target.value) }))}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
            </div>

            {/* Items */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Items</label>
                <button
                  onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
                  className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  <Plus className="h-3 w-3" /> Agregar item
                </button>
              </div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                      <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500 w-20">Código</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500">Descripción</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-16">Cant.</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-24">P. Costo</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-20">Markup%</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-24">P. Venta</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-20">IVA%</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {newPR.items.map((item, idx) => {
                      const belowCost = item.precio_venta > 0 && item.precio_venta < item.precio_costo;
                      return (
                        <tr key={idx} className={belowCost ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                          <td className="px-2 py-1.5">
                            <input value={item.codigo} onChange={(e) => updateNewPRItem(idx, "codigo", e.target.value)}
                              className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={item.descripcion} onChange={(e) => updateNewPRItem(idx, "descripcion", e.target.value)}
                              placeholder="Descripción del item..."
                              className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={item.cantidad} onChange={(e) => updateNewPRItem(idx, "cantidad", Number(e.target.value))}
                              className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={item.precio_costo || ""} onChange={(e) => updateNewPRItem(idx, "precio_costo", Number(e.target.value))}
                              className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={item.markup_porcentaje || ""} onChange={(e) => updateNewPRItem(idx, "markup_porcentaje", Number(e.target.value))}
                              className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="relative">
                              <input type="number" value={item.precio_venta || ""} onChange={(e) => updateNewPRItem(idx, "precio_venta", Number(e.target.value))}
                                className={`w-full rounded border px-1.5 py-1 text-xs text-right dark:bg-zinc-800 dark:text-white ${belowCost ? "border-red-300 dark:border-red-700" : "border-zinc-200 dark:border-zinc-700"}`} />
                              {belowCost && <AlertTriangle className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-red-500" />}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={item.iva_porcentaje} onChange={(e) => updateNewPRItem(idx, "iva_porcentaje", Number(e.target.value))}
                              className="w-full rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                              <option value={21}>21</option>
                              <option value={10.5}>10.5</option>
                              <option value={27}>27</option>
                              <option value={0}>0</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            {newPR.items.length > 1 && (
                              <button onClick={() => setNewPR((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500">
                                <Minus className="h-3 w-3" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Items totals preview */}
              {(() => {
                let sub = 0, iva = 0;
                newPR.items.forEach((it) => { const t = calcItemTotals(it); sub += t.subtotal; iva += t.iva; });
                return (
                  <div className="flex justify-end mt-3">
                    <div className="w-56 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span className="font-mono">{formatCurrency(sub, newPR.moneda)}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(iva, newPR.moneda)}</span></div>
                      <div className="flex justify-between font-bold border-t border-zinc-200 pt-1 dark:border-zinc-700"><span>Total</span><span className="font-mono">{formatCurrency(sub + iva, newPR.moneda)}</span></div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Observaciones */}
            <div className="mb-6">
              <label className="mb-1 block text-xs font-medium text-zinc-500">Observaciones</label>
              <textarea
                value={newPR.observaciones}
                onChange={(e) => setNewPR((p) => ({ ...p, observaciones: e.target.value }))}
                rows={2}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                placeholder="Notas internas o para el cliente..."
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowNewPR(false)}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">
                Cancelar
              </button>
              <button onClick={handleCreatePR} disabled={newPRSaving}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {newPRSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Crear Presupuesto
              </button>
            </div>
          </div>
        </>
      )}

      {/* Rechazo modal */}
      {rechazoModal && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setRechazoModal(null)} />
          <div className="fixed inset-4 z-[60] m-auto h-fit max-h-[50vh] w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">Motivo de rechazo</h3>
            <textarea
              value={motivoRechazo}
              onChange={(e) => setMotivoRechazo(e.target.value)}
              placeholder="Ingresa el motivo del rechazo..."
              rows={4}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setRechazoModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Cancelar
              </button>
              <button
                onClick={handleRechazoConfirm}
                disabled={!motivoRechazo.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirmar rechazo
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
