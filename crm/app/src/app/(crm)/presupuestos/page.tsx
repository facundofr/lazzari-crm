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
  PauseCircle, Edit3, Loader2, X, Trash2, ArrowRight,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

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
  clientes?: { razon_social: string; cuit: string } | null;
  created_by_profile?: { full_name: string } | null;
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
    creadoPor: row.created_by_profile?.full_name ?? row.created_by ?? "",
    enviadoAt: row.enviado_at ?? undefined,
    respondidoAt: row.respondido_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const statusConfig: Record<PRStatus, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info"; icon: typeof Clock }> = {
  borrador: { label: "Borrador", variant: "outline", icon: Edit3 },
  pendiente: { label: "Pendiente", variant: "warning", icon: Clock },
  aprobado: { label: "Aprobado", variant: "success", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", variant: "danger", icon: XCircle },
  postergado: { label: "Postergado", variant: "purple", icon: PauseCircle },
  vencido: { label: "Vencido", variant: "danger", icon: Clock },
};

export default function PresupuestosPage() {
  const [filter, setFilter] = useState<PRStatus | "todos">("todos");
  const [search, setSearch] = useState("");
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail panel
  const [selected, setSelected] = useState<Presupuesto | null>(null);

  // Rechazo modal
  const [rechazoModal, setRechazoModal] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  const fetchPresupuestos = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("presupuestos")
        .select(`
          *,
          clientes(razon_social, cuit),
          created_by_profile:created_by(full_name),
          presupuesto_items(*)
        `)
        .order("fecha", { ascending: false });

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

  const filtered = presupuestos.filter((pr) => {
    if (filter !== "todos" && pr.estado !== filter) return false;
    if (search && !pr.numero.toLowerCase().includes(search.toLowerCase()) && !pr.clienteNombre.toLowerCase().includes(search.toLowerCase())) return false;
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
        action={{ label: "Nuevo PR", onClick: () => {} }}
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

        {/* Search */}
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
        </div>

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
                      {selected.items.map((item) => (
                        <tr key={item.id}>
                          <td className="px-3 py-2 font-mono text-xs">{item.codigo}</td>
                          <td className="px-3 py-2">{item.descripcion}</td>
                          <td className="px-3 py-2 text-right">{item.cantidad} {item.unidad}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.precioCosto)}</td>
                          <td className="px-3 py-2 text-right">{item.markupPorcentaje}%</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.precioVenta)}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(item.total)}</td>
                        </tr>
                      ))}
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
