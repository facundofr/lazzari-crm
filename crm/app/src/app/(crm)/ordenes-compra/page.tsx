"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { generateOrdenCompraPDF, getSociedadPDF, openPDFWindow } from "@/lib/pdf-templates";
import { supabase } from "@/lib/supabase/client";
import { mockOrdenesCompra } from "@/lib/mock-data";
import type { OCStatus } from "@/lib/types";
import {
  ShoppingCart, Clock, CheckCircle2, Truck, Loader2,
  X, Send, XCircle, Copy, Package, Mail, Phone, MapPin,
  FileText, ClipboardCopy, Check, Download, Merge, ChevronDown, ChevronRight, AlertTriangle,
  PackageCheck, MessageSquare, Edit3, Plus, Minus,
  Maximize2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/lib/auth-context";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "outline" | "purple" }> = {
  borrador: { label: "Borrador", variant: "outline" },
  enviada: { label: "Enviada", variant: "info" },
  confirmada: { label: "Confirmada", variant: "warning" },
  recibida_parcial: { label: "Parcial", variant: "purple" },
  recibida: { label: "Recibida", variant: "success" },
  cancelada: { label: "Cancelada", variant: "danger" },
};

interface ProveedorInfo {
  razon_social: string;
  cuit: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  forma_pago: string | null;
  condicion_iva: string | null;
}

interface OCRow {
  id: string;
  numero: string;
  proveedor_id: string;
  fecha: string;
  fecha_entrega_estimada: string | null;
  estado: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  presupuesto_origen_id: string | null;
  pedido: boolean;
  notas_recepcion: string | null;
  observaciones: string;
  created_at: string;
  proveedores: ProveedorInfo | null;
  presupuesto_origen: { numero: string } | null;
  orden_compra_items: { cantidad: number; cantidad_recibida: number }[];
}

interface DetailItem {
  id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  cantidad_recibida: number;
  unidad: string | null;
  precio_unitario: number;
  subtotal: number;
  producto_id: string | null;
  iva_porcentaje: number;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
}

function mapMockToOCRow(oc: (typeof mockOrdenesCompra)[number]): OCRow {
  return {
    id: oc.id,
    numero: oc.numero,
    proveedor_id: oc.proveedorId,
    fecha: oc.fecha,
    fecha_entrega_estimada: oc.fechaEntregaEstimada,
    estado: oc.estado,
    subtotal: oc.subtotal,
    iva: oc.iva,
    total: oc.total,
    moneda: oc.moneda,
    presupuesto_origen_id: oc.presupuestoOrigenId || null,
    pedido: oc.estado !== "borrador",
    notas_recepcion: null,
    observaciones: oc.observaciones,
    created_at: oc.fecha,
    proveedores: { razon_social: oc.proveedorNombre, cuit: null, email: null, telefono: null, direccion: null, localidad: null, provincia: null, forma_pago: null, condicion_iva: null },
    presupuesto_origen: null,
    orden_compra_items: oc.items.map((i) => ({
      cantidad: i.cantidad,
      cantidad_recibida: i.cantidadRecibida,
    })),
  };
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-orange-500 transition-colors"
      title={label || "Copiar"}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label && <span>{copied ? "Copiado" : label}</span>}
    </button>
  );
}

export default function OrdenesCompraPage() {
  const { sociedadActiva, profile } = useUser();
  const [filter, setFilter] = useState<OCStatus | "todas">("todas");
  const [ordenes, setOrdenes] = useState<OCRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [smartFilterValues, setSmartFilterValues] = useState<FilterValues>({
    fecha: { from: "", to: "" },
    moneda: "",
    monto: {},
  });

  const smartFilterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    { key: "moneda", label: "Moneda", type: "select", options: [{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }] },
    { key: "monto", label: "Monto total", type: "number-range" },
  ];

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [formData, setFormData] = useState({
    proveedor_id: "",
    fecha: new Date().toISOString().slice(0, 10),
    fecha_entrega_estimada: "",
    moneda: "ARS" as "ARS" | "USD",
    observaciones: "",
    presupuesto_origen_id: "",
  });
  const [presupuestosAprobados, setPresupuestosAprobados] = useState<{ id: string; numero: string; clienteNombre: string }[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Consolidation modal
  interface PendingItem {
    pr_id: string;
    pr_numero: string;
    cliente_nombre: string;
    item_id: string;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio_costo: number;
    unidad: string;
    proveedor_id: string;
    proveedor_nombre: string;
    moneda: string;
    iva_porcentaje: number;
    selected: boolean;
  }
  interface ProveedorGroup {
    id: string;
    nombre: string;
    moneda: string;
    items: PendingItem[];
    expanded: boolean;
  }
  const [consolidateOpen, setConsolidateOpen] = useState(false);
  const [consolidateGroups, setConsolidateGroups] = useState<ProveedorGroup[]>([]);
  const [consolidateLoading, setConsolidateLoading] = useState(false);
  const [consolidateCreating, setConsolidateCreating] = useState(false);
  const [consolidateSuccessMsg, setConsolidateSuccessMsg] = useState("");

  // Items sin proveedor modal
  interface ItemSinProveedor {
    item_id: string;
    pr_id: string;
    pr_numero: string;
    cliente_nombre: string;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio_costo: number;
    unidad: string;
    moneda: string;
    proveedor_id: string; // to be assigned
  }
  const [sinProveedorOpen, setSinProveedorOpen] = useState(false);
  const [sinProveedorItems, setSinProveedorItems] = useState<ItemSinProveedor[]>([]);
  const [sinProveedorLoading, setSinProveedorLoading] = useState(false);
  const [sinProveedorSaving, setSinProveedorSaving] = useState(false);
  const [sinProveedorProvs, setSinProveedorProvs] = useState<ProveedorOption[]>([]);

  // Detail panel
  const [detailOC, setDetailOC] = useState<OCRow | null>(null);
  const [detailItems, setDetailItems] = useState<DetailItem[]>([]);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingRecepcion, setSavingRecepcion] = useState<string | null>(null);
  // Reception form: quantities being received in this batch (keyed by item id)
  const [recepcionQtys, setRecepcionQtys] = useState<Record<string, number>>({});
  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState<DetailItem[]>([]);
  const [editOC, setEditOC] = useState<{ fecha_entrega_estimada: string; observaciones: string }>({ fecha_entrega_estimada: "", observaciones: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Fetch main data ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("ordenes_compra")
        .select(`
          *,
          proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva),
          presupuesto_origen:presupuesto_origen_id(numero),
          orden_compra_items(cantidad, cantidad_recibida)
        `)
        .order("created_at", { ascending: false });

      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);

      const { data, error } = await q;

      if (!error && data) {
        setOrdenes(data as unknown as OCRow[]);
      } else if (error) {
        setOrdenes(mockOrdenesCompra.map(mapMockToOCRow));
      }
    } catch {
      setOrdenes(mockOrdenesCompra.map(mapMockToOCRow));
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fetch proveedores for the create modal ───────────────────────
  const fetchProveedores = useCallback(async () => {
    try {
      let q = supabase
        .from("proveedores")
        .select("id, razon_social")
        .eq("activo", true)
        .order("razon_social");
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q;
      if (data && data.length > 0) {
        setProveedores(data as unknown as ProveedorOption[]);
      }
    } catch { /* ignore */ }
  }, [sociedadActiva]);

  // ── Fetch detail items ───────────────────────────────────────────
  const fetchDetailItems = useCallback(async (ocId: string) => {
    setDetailLoading(true);
    try {
      const { data, error } = await supabase
        .from("orden_compra_items")
        .select("id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, subtotal, producto_id, iva_porcentaje" as any)
        .eq("orden_id", ocId)
        .order("orden", { ascending: true });
      if (!error && data) {
        setDetailItems((data as any[]).map((it: any) => ({ ...it, iva_porcentaje: Number(it.iva_porcentaje ?? 21) })) as DetailItem[]);
      } else {
        setDetailItems([]);
      }
    } catch {
      setDetailItems([]);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────
  const openCreateModal = () => {
    setFormData({ proveedor_id: "", fecha: new Date().toISOString().slice(0, 10), fecha_entrega_estimada: "", moneda: "ARS", observaciones: "", presupuesto_origen_id: "" });
    setFormError("");
    setCreateOpen(true);
    fetchProveedores();
    // Load approved presupuestos for linking
    (async () => {
      try {
        let q = (supabase as any).from("presupuestos").select("id, numero, clientes(razon_social)").eq("estado", "aprobado").order("created_at", { ascending: false }).limit(100);
        if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
        const { data } = await q;
        if (data) setPresupuestosAprobados(data.map((p: any) => ({ id: p.id, numero: p.numero, clienteNombre: p.clientes?.razon_social || "" })));
      } catch { /* ignore */ }
    })();
  };

  const handleCreate = async () => {
    // proveedor_id es opcional — se puede crear OC sin proveedor
    setFormLoading(true);
    setFormError("");
    try {
      // If linked to a PR, fetch its items to calculate totals and insert them
      let prItems: any[] = [];
      if (formData.presupuesto_origen_id) {
        let itemsQuery = supabase
          .from("presupuesto_items")
          .select("id, codigo, descripcion, cantidad, precio_costo, unidad, producto_id, proveedor_id, iva_porcentaje")
          .eq("presupuesto_id", formData.presupuesto_origen_id);
        // If a proveedor is selected, try items from that proveedor first
        if (formData.proveedor_id) {
          const { data: provItems } = await itemsQuery.eq("proveedor_id" as any, formData.proveedor_id) as { data: any[] | null };
          if (provItems && provItems.length > 0) {
            prItems = provItems;
          } else {
            // Fallback: fetch ALL items from the PR (proveedor_id may not be populated)
            const { data: allItems } = await supabase
              .from("presupuesto_items")
              .select("id, codigo, descripcion, cantidad, precio_costo, unidad, producto_id, proveedor_id, iva_porcentaje")
              .eq("presupuesto_id", formData.presupuesto_origen_id) as { data: any[] | null };
            prItems = allItems || [];
          }
        } else {
          const { data: fetchedItems } = await itemsQuery as { data: any[] | null };
          prItems = fetchedItems || [];
        }
      }

      const itemsSubtotal = prItems.reduce((sum, it) => sum + (Number(it.precio_costo) || 0) * (Number(it.cantidad) || 0), 0);
      const itemsIva = prItems.reduce((sum, it) => {
        const lineSubtotal = (Number(it.precio_costo) || 0) * (Number(it.cantidad) || 0);
        const ivaPct = Number(it.iva_porcentaje ?? 21) / 100;
        return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
      }, 0);

      const { data: ocRow, error } = await supabase.from("ordenes_compra").insert({
        proveedor_id: formData.proveedor_id || null,
        fecha: formData.fecha,
        fecha_entrega_estimada: formData.fecha_entrega_estimada || null,
        moneda: formData.moneda,
        observaciones: formData.observaciones,
        estado: "borrador",
        subtotal: Math.round(itemsSubtotal * 100) / 100,
        iva: itemsIva,
        total: Math.round((itemsSubtotal + itemsIva) * 100) / 100,
        sociedad_id: sociedadActiva?.id || null,
        presupuesto_origen_id: formData.presupuesto_origen_id || null,
        created_by: profile?.id || null,
      } as any).select("id").single();
      if (error) throw error;

      // Insert PR items as OC items
      if (ocRow && prItems.length > 0) {
        const ocItems = prItems.map((it, idx) => ({
          orden_id: ocRow.id,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          cantidad: it.cantidad,
          cantidad_recibida: 0,
          unidad: it.unidad || "u",
          precio_unitario: Number(it.precio_costo) || 0,
          producto_id: it.producto_id || null,
          iva_porcentaje: Number(it.iva_porcentaje ?? 21),
          orden: idx,
        }));
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error al insertar items de OC:", itemsErr);
          alert(`OC creada pero error al insertar items: ${itemsErr.message}`);
        }
      }

      setCreateOpen(false);
      await fetchData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al crear OC");
    } finally {
      setFormLoading(false);
    }
  };

  const handleRowClick = (row: OCRow) => {
    setDetailOC(row);
    fetchDetailItems(row.id);
    if (!row.proveedores) fetchProveedores();
  };

  const handleCancel = async (oc: OCRow) => {
    if (!confirm(`¿Cancelar la OC ${oc.numero}?`)) return;
    try {
      const { error } = await supabase.from("ordenes_compra").update({ estado: "cancelada" } as any).eq("id", oc.id);
      if (error) throw error;
      await fetchData();
      if (detailOC?.id === oc.id) { setDetailOC(null); setPanelFullscreen(false); }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al cancelar");
    }
  };

  const handleAdvanceEstado = async (oc: OCRow, nuevoEstado: "enviada" | "confirmada") => {
    try {
      const { error } = await supabase.from("ordenes_compra").update({ estado: nuevoEstado } as any).eq("id", oc.id);
      if (error) throw error;
      await fetchData();
      if (detailOC?.id === oc.id) {
        setDetailOC({ ...oc, estado: nuevoEstado });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al actualizar estado");
    }
  };

  const handleRegistrarRecepcion = async () => {
    if (!detailOC) return;
    // Check there's at least one item with qty > 0
    const hasQty = Object.values(recepcionQtys).some((v) => v > 0);
    if (!hasQty) { alert("Ingresa al menos una cantidad recibida"); return; }
    setSavingRecepcion("all");
    try {
      // For each item with qty > 0, update cantidad_recibida and stock
      for (const item of detailItems) {
        const qtyRecibida = recepcionQtys[item.id] || 0;
        if (qtyRecibida <= 0) continue;
        const newCantidadRecibida = Math.min(
          Number(item.cantidad_recibida) + qtyRecibida,
          Number(item.cantidad)
        );
        // Update orden_compra_items
        const { error: itemErr } = await supabase
          .from("orden_compra_items")
          .update({ cantidad_recibida: newCantidadRecibida } as any)
          .eq("id", item.id);
        if (itemErr) throw itemErr;

        // Atomic stock increment via RPC
        if (item.producto_id) {
          const { error: stockErr } = await supabase.rpc("increment_stock" as any, { producto_id: item.producto_id, cantidad: qtyRecibida });
          if (stockErr) {
            console.error("Error al actualizar stock:", stockErr);
            alert(`Error al actualizar stock del producto ${item.codigo}: ${(stockErr as any).message}`);
            throw stockErr;
          }
        }
      }

      // Compute new estado based on updated quantities
      const updatedItems = detailItems.map((it) => ({
        ...it,
        cantidad_recibida: Math.min(
          Number(it.cantidad_recibida) + (recepcionQtys[it.id] || 0),
          Number(it.cantidad)
        ),
      }));
      const allReceived = updatedItems.every((it) => Number(it.cantidad_recibida) >= Number(it.cantidad));
      const someReceived = updatedItems.some((it) => Number(it.cantidad_recibida) > 0);
      let newEstado = detailOC.estado;
      if (allReceived && updatedItems.length > 0) newEstado = "recibida";
      else if (someReceived) newEstado = "recibida_parcial";

      if (newEstado !== detailOC.estado) {
        const { error: estadoErr } = await supabase.from("ordenes_compra").update({ estado: newEstado } as any).eq("id", detailOC.id);
        if (estadoErr) {
          alert(`Error al actualizar estado de la OC: ${estadoErr.message}`);
          throw estadoErr;
        }
      }

      // Update local state
      setDetailItems(updatedItems);
      setDetailOC({ ...detailOC, estado: newEstado });
      setRecepcionQtys({});
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al registrar recepcion");
    } finally {
      setSavingRecepcion(null);
    }
  };

  const handleMarcarTodoRecibido = async () => {
    if (!detailOC || !confirm("¿Marcar todos los items como recibidos?")) return;
    // Fill recepcionQtys with pending amounts and call handleRegistrarRecepcion
    const qtys: Record<string, number> = {};
    for (const item of detailItems) {
      const pending = Number(item.cantidad) - Number(item.cantidad_recibida);
      if (pending > 0) qtys[item.id] = pending;
    }
    setRecepcionQtys(qtys);
    // We need to trigger the registration with these qtys directly
    setSavingRecepcion("all");
    try {
      for (const item of detailItems) {
        const qtyRecibida = qtys[item.id] || 0;
        if (qtyRecibida <= 0) continue;
        const { error: itemErr } = await supabase
          .from("orden_compra_items")
          .update({ cantidad_recibida: item.cantidad } as any)
          .eq("id", item.id);
        if (itemErr) {
          alert(`Error al actualizar item ${item.codigo}: ${itemErr.message}`);
          throw itemErr;
        }
        // Atomic stock increment via RPC
        if (item.producto_id) {
          const { error: stockErr } = await supabase.rpc("increment_stock" as any, { producto_id: item.producto_id, cantidad: qtyRecibida });
          if (stockErr) {
            alert(`Error al actualizar stock del producto ${item.codigo}: ${(stockErr as any).message}`);
            throw stockErr;
          }
        }
      }
      const { error: estadoErr } = await supabase.from("ordenes_compra").update({ estado: "recibida" } as any).eq("id", detailOC.id);
      if (estadoErr) {
        alert(`Error al marcar OC como recibida: ${estadoErr.message}`);
        throw estadoErr;
      }
      setDetailOC({ ...detailOC, estado: "recibida" });
      setDetailItems((prev) => prev.map((it) => ({ ...it, cantidad_recibida: it.cantidad })));
      setRecepcionQtys({});
      await fetchData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingRecepcion(null);
    }
  };

  const startEditMode = () => {
    if (!detailOC) return;
    setEditItems(detailItems.map((it) => ({ ...it })));
    setEditOC({
      fecha_entrega_estimada: detailOC.fecha_entrega_estimada || "",
      observaciones: detailOC.observaciones || "",
    });
    setEditMode(true);
  };

  const handleSaveEdit = async () => {
    if (!detailOC) return;
    setSavingEdit(true);
    try {
      // 1. Delete removed items
      const editIds = new Set(editItems.map(it => it.id));
      const deletedItems = detailItems.filter(it => !editIds.has(it.id));
      for (const del of deletedItems) {
        await supabase.from("orden_compra_items").delete().eq("id", del.id);
      }

      // 2. Insert new items (id starts with "new_")
      const newItems = editItems.filter(it => String(it.id).startsWith("new_"));
      if (newItems.length > 0) {
        const insertRows = newItems.map((it, idx) => ({
          orden_id: detailOC.id,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          cantidad: Number(it.cantidad) || 0,
          cantidad_recibida: 0,
          unidad: it.unidad || "u",
          precio_unitario: Number(it.precio_unitario) || 0,
          producto_id: it.producto_id || null,
          iva_porcentaje: Number(it.iva_porcentaje) || 21,
          orden: detailItems.length + idx,
        }));
        const { error: insErr } = await supabase.from("orden_compra_items").insert(insertRows as any);
        if (insErr) throw new Error(`Error al insertar items: ${insErr.message}`);
      }

      // 3. Update existing items (cantidad, precio_unitario, cantidad_recibida, codigo, descripcion) + adjust stock
      for (const edited of editItems) {
        if (String(edited.id).startsWith("new_")) continue;
        const original = detailItems.find(it => it.id === edited.id);
        if (!original) continue;

        const cantidadChanged = Number(edited.cantidad) !== Number(original.cantidad);
        const precioChanged = Number(edited.precio_unitario) !== Number(original.precio_unitario);
        const recibidaChanged = Number(edited.cantidad_recibida) !== Number(original.cantidad_recibida);
        const codigoChanged = edited.codigo !== original.codigo;
        const descChanged = edited.descripcion !== original.descripcion;

        if (cantidadChanged || precioChanged || recibidaChanged || codigoChanged || descChanged) {
          const updatePayload: any = {};
          if (cantidadChanged) updatePayload.cantidad = Number(edited.cantidad);
          if (precioChanged) updatePayload.precio_unitario = Number(edited.precio_unitario);
          if (recibidaChanged) updatePayload.cantidad_recibida = Number(edited.cantidad_recibida);
          if (codigoChanged) updatePayload.codigo = edited.codigo;
          if (descChanged) updatePayload.descripcion = edited.descripcion;

          const { error } = await supabase
            .from("orden_compra_items")
            .update(updatePayload)
            .eq("id", edited.id);
          if (error) throw new Error(`Error al actualizar item ${edited.codigo}: ${error.message}`);

          // Adjust stock if cantidad_recibida changed
          if (recibidaChanged && edited.producto_id) {
            const diff = Number(edited.cantidad_recibida) - Number(original.cantidad_recibida);
            if (diff !== 0) {
              const { error: stockErr } = await supabase.rpc("increment_stock" as any, {
                producto_id: edited.producto_id,
                cantidad: diff,
              });
              if (stockErr) throw new Error(`Error al ajustar stock de ${edited.codigo}: ${(stockErr as any).message}`);
            }
          }
        }
      }

      // 2. Recalculate OC totals using per-item IVA rates
      const newSubtotal = editItems.reduce((sum, it) => sum + Number(it.cantidad) * Number(it.precio_unitario), 0);
      const newIva = editItems.reduce((sum, it) => {
        const lineSubtotal = Number(it.cantidad) * Number(it.precio_unitario);
        const ivaPct = (Number(it.iva_porcentaje) || 21) / 100;
        return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
      }, 0);
      const newTotal = newSubtotal + newIva;

      // 3. Determine new estado
      const allReceived = editItems.every((it) => Number(it.cantidad_recibida) >= Number(it.cantidad));
      const someReceived = editItems.some((it) => Number(it.cantidad_recibida) > 0);
      let newEstado = detailOC.estado;
      if (detailOC.estado !== "cancelada") {
        if (allReceived && editItems.length > 0) newEstado = "recibida";
        else if (someReceived) newEstado = "recibida_parcial";
        else if (detailOC.estado === "recibida" || detailOC.estado === "recibida_parcial") newEstado = "confirmada";
      }

      // 4. Update OC header
      const { error: ocErr } = await supabase
        .from("ordenes_compra")
        .update({
          subtotal: newSubtotal,
          iva: newIva,
          total: newTotal,
          estado: newEstado,
          fecha_entrega_estimada: editOC.fecha_entrega_estimada || null,
          observaciones: editOC.observaciones || "",
        } as any)
        .eq("id", detailOC.id);
      if (ocErr) throw new Error(`Error al actualizar OC: ${ocErr.message}`);

      // 5. Refresh items from DB (new items need real IDs)
      await fetchDetailItems(detailOC.id);
      setDetailOC({
        ...detailOC,
        subtotal: newSubtotal,
        iva: newIva,
        total: newTotal,
        estado: newEstado,
        fecha_entrega_estimada: editOC.fecha_entrega_estimada || null,
        observaciones: editOC.observaciones || "",
        orden_compra_items: editItems.map((it) => ({ cantidad: Number(it.cantidad), cantidad_recibida: Number(it.cantidad_recibida) })),
      });
      setEditMode(false);
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Error al guardar cambios");
    } finally {
      setSavingEdit(false);
    }
  };

  const buildOCSummaryText = (oc: OCRow) => {
    const prov = oc.proveedores;
    const estadoLabel = (statusConfig[oc.estado] || { label: oc.estado }).label;
    const mon = oc.moneda as "ARS" | "USD";
    const lines = [
      `*ORDEN DE COMPRA ${oc.numero}*`,
      "",
      `Fecha: ${formatDate(oc.fecha)}`,
      oc.fecha_entrega_estimada ? `Entrega estimada: ${formatDate(oc.fecha_entrega_estimada)}` : null,
      `Estado: ${estadoLabel}`,
      `Moneda: ${oc.moneda}`,
      "",
      `*Proveedor:* ${prov?.razon_social || "\u2014"}`,
      prov?.cuit ? `CUIT: ${prov.cuit}` : null,
      prov?.email ? `Email: ${prov.email}` : null,
      prov?.telefono ? `Tel: ${prov.telefono}` : null,
      prov?.direccion ? `Dir: ${prov.direccion}${prov.localidad ? `, ${prov.localidad}` : ""}${prov.provincia ? `, ${prov.provincia}` : ""}` : null,
      prov?.forma_pago ? `Forma de pago: ${prov.forma_pago}` : null,
      "",
      "*Items:*",
      ...detailItems.map((it, i) =>
        `${i + 1}. ${it.codigo} - ${it.descripcion}\n   ${it.cantidad}${it.unidad ? ` ${it.unidad}` : ""} x ${formatCurrency(Number(it.precio_unitario), mon)} = ${formatCurrency(Number(it.subtotal), mon)}`
      ),
      "",
      `Subtotal: ${formatCurrency(Number(oc.subtotal), mon)}`,
      `IVA: ${formatCurrency(Number(oc.iva), mon)}`,
      `*Total: ${formatCurrency(Number(oc.total), mon)}*`,
      oc.observaciones ? `\nObs: ${oc.observaciones}` : null,
    ];
    return lines.filter((l) => l !== null).join("\n");
  };

  const handleDownloadPDF = () => {
    if (!detailOC || !sociedadActiva) return;
    const oc = detailOC;
    const prov = oc.proveedores;
    const estadoLabel = (statusConfig[oc.estado] || { label: oc.estado }).label;
    const mon = oc.moneda as "ARS" | "USD";
    const soc = getSociedadPDF(sociedadActiva);

    const html = generateOrdenCompraPDF({
      numero: oc.numero,
      fecha: oc.fecha,
      fecha_entrega_estimada: oc.fecha_entrega_estimada,
      estado: oc.estado,
      estadoLabel,
      moneda: mon,
      subtotal: Number(oc.subtotal),
      iva: Number(oc.iva),
      total: Number(oc.total),
      observaciones: oc.observaciones,
      presupuesto_origen: oc.presupuesto_origen ? { numero: (oc.presupuesto_origen as { numero: string }).numero } : null,
      proveedor: prov ? {
        razon_social: prov.razon_social,
        cuit: prov.cuit,
        condicion_iva: prov.condicion_iva,
        direccion: prov.direccion,
        localidad: prov.localidad,
        provincia: prov.provincia,
        email: prov.email,
        telefono: prov.telefono,
        forma_pago: prov.forma_pago,
      } : null,
      items: detailItems.map(it => ({
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precio_unitario: Number(it.precio_unitario),
        subtotal: Number(it.subtotal),
      })),
    }, soc);
    openPDFWindow(html);
  };

  const [copiedSummary, setCopiedSummary] = useState(false);
  const handleCopySummary = async () => {
    if (!detailOC) return;
    await navigator.clipboard.writeText(buildOCSummaryText(detailOC));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  // ── Toggle pedido Si/No ───────────────────────────────────────────
  const handleTogglePedido = async (oc: OCRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = !oc.pedido;
    try {
      const { error } = await supabase
        .from("ordenes_compra")
        .update({ pedido: newVal } as any)
        .eq("id", oc.id);
      if (error) throw error;
      setOrdenes((prev) =>
        prev.map((o) => (o.id === oc.id ? { ...o, pedido: newVal } : o))
      );
      if (detailOC?.id === oc.id) setDetailOC({ ...oc, pedido: newVal });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al actualizar pedido");
    }
  };

  // ── Notas de recepcion ────────────────────────────────────────────
  const [notaPopoverId, setNotaPopoverId] = useState<string | null>(null);
  const [notaPopoverText, setNotaPopoverText] = useState("");
  const [savingNota, setSavingNota] = useState(false);

  const openNotaPopover = (oc: OCRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotaPopoverId(oc.id);
    setNotaPopoverText(oc.notas_recepcion || "");
  };

  const handleSaveNotaRecepcion = async () => {
    if (!notaPopoverId) return;
    setSavingNota(true);
    try {
      const { error } = await supabase
        .from("ordenes_compra")
        .update({ notas_recepcion: notaPopoverText || null } as any)
        .eq("id", notaPopoverId);
      if (error) throw error;
      setOrdenes((prev) =>
        prev.map((o) =>
          o.id === notaPopoverId
            ? { ...o, notas_recepcion: notaPopoverText || null }
            : o
        )
      );
      if (detailOC?.id === notaPopoverId) {
        setDetailOC((prev) =>
          prev ? { ...prev, notas_recepcion: notaPopoverText || null } : prev
        );
      }
      setNotaPopoverId(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al guardar nota");
    } finally {
      setSavingNota(false);
    }
  };

  // ── Copy OC summary for proveedor (from table, without detail items) ──
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
  const handleCopyForProveedor = async (oc: OCRow, e: React.MouseEvent) => {
    e.stopPropagation();
    // Fetch items for this OC
    let itemLines = "";
    try {
      const { data } = await supabase
        .from("orden_compra_items")
        .select("codigo, descripcion, cantidad, unidad, precio_unitario" as any)
        .eq("orden_id", oc.id)
        .order("orden", { ascending: true });
      if (data && data.length > 0) {
        itemLines = (data as any[])
          .map(
            (it: any, i: number) =>
              `${i + 1}. ${it.codigo || ""} ${it.descripcion} — ${it.cantidad}${it.unidad ? ` ${it.unidad}` : ""}`
          )
          .join("\n");
      }
    } catch { /* ignore */ }

    const mon = oc.moneda as "ARS" | "USD";
    const lines = [
      `*ORDEN DE COMPRA ${oc.numero}*`,
      "",
      `Fecha: ${formatDate(oc.fecha)}`,
      oc.fecha_entrega_estimada
        ? `Entrega estimada: ${formatDate(oc.fecha_entrega_estimada)}`
        : null,
      `Moneda: ${oc.moneda}`,
      "",
      `*Proveedor:* ${oc.proveedores?.razon_social || "\u2014"}`,
      "",
      "*Items:*",
      itemLines || "(sin items)",
      "",
      `*Total: ${formatCurrency(Number(oc.total), mon)}*`,
      oc.observaciones ? `\nObs: ${oc.observaciones}` : null,
    ];
    const text = lines.filter((l) => l !== null).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedRowId(oc.id);
    setTimeout(() => setCopiedRowId(null), 2000);
  };

  // ── Consolidation logic ─────────────────────────────────────────
  const openConsolidateModal = async () => {
    setConsolidateOpen(true);
    setConsolidateLoading(true);
    try {
      // Get approved presupuestos that have items with proveedor_id
      let prQuery = supabase
        .from("presupuestos")
        .select("id, numero, cliente_id, moneda, clientes(razon_social)")
        .eq("estado", "aprobado");
      if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: prs } = await prQuery;

      if (!prs || prs.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Get all presupuesto items with proveedor
      const prIds = prs.map(p => p.id);
      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("id, presupuesto_id, codigo, descripcion, cantidad, precio_costo, unidad, proveedor_id, proveedor_nombre, iva_porcentaje, costo_moneda")
        .in("presupuesto_id", prIds)
        .not("proveedor_id", "is", null) as { data: any[] | null };

      if (!items || items.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Get existing non-cancelled OCs with presupuesto_origen_id to know which PR+proveedor combos already have OC
      let existingOCsQuery = supabase
        .from("ordenes_compra")
        .select("presupuesto_origen_id, proveedor_id")
        .not("presupuesto_origen_id", "is", null)
        .not("estado", "eq", "cancelada");
      if (sociedadActiva?.id) existingOCsQuery = existingOCsQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: existingOCs } = await existingOCsQuery;
      // Build a set of "presupuesto_id|proveedor_id" keys that already have an OC
      const ocCoveredKeys = new Set(
        (existingOCs || []).map((oc: any) => `${oc.presupuesto_origen_id}|${oc.proveedor_id}`)
      );

      // Filter out items that already have an OC for their presupuesto+proveedor combo
      const pendingItems = items.filter(
        (item: any) => !ocCoveredKeys.has(`${item.presupuesto_id}|${item.proveedor_id}`)
      );

      if (pendingItems.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Build proveedor groups
      const prMap = new Map(prs.map(p => [p.id, p]));
      const groups: Record<string, ProveedorGroup> = {};

      for (const item of pendingItems) {
        const pr = prMap.get(item.presupuesto_id);
        if (!pr || !item.proveedor_id) continue;
        const provId = item.proveedor_id as string;
        const itemCostoMoneda = (item.costo_moneda as string) || "ARS";
        if (!groups[provId]) {
          groups[provId] = {
            id: provId,
            nombre: (item.proveedor_nombre as string) || "Sin nombre",
            moneda: itemCostoMoneda,
            items: [],
            expanded: true,
          };
        }
        groups[provId].items.push({
          pr_id: pr.id,
          pr_numero: pr.numero || "",
          cliente_nombre: (pr.clientes as any)?.razon_social || "",
          item_id: item.id,
          codigo: item.codigo || "",
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_costo: item.precio_costo,
          unidad: item.unidad || "UN",
          proveedor_id: provId,
          proveedor_nombre: (item.proveedor_nombre as string) || "",
          moneda: itemCostoMoneda,
          iva_porcentaje: Number(item.iva_porcentaje ?? 21),
          selected: true,
        });
      }

      setConsolidateGroups(Object.values(groups));
    } catch (err) {
      console.error("Error loading consolidation data:", err);
      alert("Error al cargar datos de consolidación: " + (err as any)?.message);
      setConsolidateGroups([]);
    } finally {
      setConsolidateLoading(false);
    }
  };

  const toggleConsolidateItem = (provId: string, itemId: string) => {
    setConsolidateGroups(prev => prev.map(g =>
      g.id === provId ? { ...g, items: g.items.map(it => it.item_id === itemId ? { ...it, selected: !it.selected } : it) } : g
    ));
  };

  const toggleProveedorExpand = (provId: string) => {
    setConsolidateGroups(prev => prev.map(g =>
      g.id === provId ? { ...g, expanded: !g.expanded } : g
    ));
  };

  const toggleAllInGroup = (provId: string, selected: boolean) => {
    setConsolidateGroups(prev => prev.map(g =>
      g.id === provId ? { ...g, items: g.items.map(it => ({ ...it, selected })) } : g
    ));
  };

  const handleCreateConsolidatedOCs = async () => {
    setConsolidateCreating(true);
    try {
      const today = todayAR();
      let created = 0;

      for (const group of consolidateGroups) {
        const selectedItems = group.items.filter(it => it.selected);
        if (selectedItems.length === 0) continue;

        const subtotal = selectedItems.reduce((sum, it) => sum + it.precio_costo * it.cantidad, 0);
        const iva = selectedItems.reduce((sum, it) => {
          const lineSubtotal = it.precio_costo * it.cantidad;
          const ivaPct = (it.iva_porcentaje ?? 21) / 100;
          return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
        }, 0);

        // Get unique PR IDs for observaciones and origin linking
        const prNums = [...new Set(selectedItems.map(it => it.pr_numero))];
        const prIds = [...new Set(selectedItems.map(it => it.pr_id))];
        const obs = `Consolidado de ${prNums.length} presupuesto(s): ${prNums.join(", ")}`;

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: group.id,
            fecha: today,
            moneda: group.moneda,
            estado: "borrador",
            subtotal: Math.round(subtotal * 100) / 100,
            iva,
            total: Math.round((subtotal + iva) * 100) / 100,
            observaciones: obs,
            sociedad_id: sociedadActiva?.id || null,
            presupuesto_origen_id: prIds.length === 1 ? prIds[0] : null,
            created_by: profile?.id || null,
          } as any)
          .select("id")
          .single();

        if (ocErr || !ocRow) continue;

        // Insert items
        const ocItems = selectedItems.map((it, idx) => ({
          orden_id: ocRow.id,
          codigo: it.codigo,
          descripcion: `${it.descripcion} [${it.pr_numero} - ${it.cliente_nombre}]`,
          cantidad: it.cantidad,
          cantidad_recibida: 0,
          unidad: it.unidad,
          precio_unitario: it.precio_costo,
          iva_porcentaje: it.iva_porcentaje ?? 21,
          orden: idx,
        }));

        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error al insertar items de OC consolidada:", itemsErr);
          alert(`Error al insertar items para proveedor ${group.nombre}: ${itemsErr.message}`);
        }
        created++;
      }

      setConsolidateOpen(false);
      await fetchData();
      if (created > 0) setConsolidateSuccessMsg(`Se crearon ${created} OC(s) consolidada(s)`);
    } catch (err) {
      alert("Error al crear OCs consolidadas");
      console.error(err);
    } finally {
      setConsolidateCreating(false);
    }
  };

  // ── Items sin proveedor ────────────────────────────────────────
  const openSinProveedorModal = async () => {
    setSinProveedorOpen(true);
    setSinProveedorLoading(true);
    try {
      // Fetch approved/remitido PRs
      let prQuery = (supabase as any).from("presupuestos").select("id, numero, moneda, clientes(razon_social)").in("estado", ["aprobado", "remitido"]);
      if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id", sociedadActiva.id);
      const { data: prs } = await prQuery;
      if (!prs || prs.length === 0) { setSinProveedorItems([]); return; }

      const prIds = prs.map((p: any) => p.id);
      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("id, presupuesto_id, codigo, descripcion, cantidad, precio_costo, unidad, proveedor_id, costo_moneda")
        .in("presupuesto_id", prIds) as { data: any[] | null };

      const sinProv = (items || []).filter((it: any) => !it.proveedor_id);
      const prMap = new Map((prs as any[]).map((p: any) => [p.id, p]));

      setSinProveedorItems(sinProv.map((it: any) => {
        const pr = prMap.get(it.presupuesto_id) as any;
        return {
          item_id: it.id,
          pr_id: it.presupuesto_id,
          pr_numero: pr?.numero || "",
          cliente_nombre: pr?.clientes?.razon_social || "",
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          cantidad: it.cantidad,
          precio_costo: it.precio_costo || 0,
          unidad: it.unidad || "UN",
          moneda: (it.costo_moneda as string) || "ARS",
          proveedor_id: "",
        };
      }));

      // Load proveedores for assignment
      let provQ = supabase.from("proveedores").select("id, razon_social").eq("activo", true).order("razon_social");
      if (sociedadActiva?.id) provQ = provQ.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: provs } = await provQ;
      if (provs) setSinProveedorProvs(provs as unknown as ProveedorOption[]);
    } catch (err) {
      console.error("Error loading items sin proveedor:", err);
      alert("Error al cargar items sin proveedor: " + (err as any)?.message);
      setSinProveedorItems([]);
    } finally {
      setSinProveedorLoading(false);
    }
  };

  const handleAsignarProveedores = async () => {
    const toUpdate = sinProveedorItems.filter(it => it.proveedor_id);
    if (toUpdate.length === 0) return;
    setSinProveedorSaving(true);
    try {
      // Get proveedor names
      const provIds = [...new Set(toUpdate.map(it => it.proveedor_id))];
      const provNameMap = new Map(sinProveedorProvs.map(p => [p.id, p.razon_social]));

      let updated = 0;
      for (const item of toUpdate) {
        const { error } = await supabase
          .from("presupuesto_items")
          .update({
            proveedor_id: item.proveedor_id,
            proveedor_nombre: provNameMap.get(item.proveedor_id) || "",
          } as any)
          .eq("id", item.item_id);
        if (!error) updated++;
      }
      if (updated > 0) {
        setSinProveedorItems(prev => prev.filter(it => !it.proveedor_id));
        setConsolidateSuccessMsg(`Se asignó proveedor a ${updated} item(s)`);
      }
      if (sinProveedorItems.filter(it => !it.proveedor_id).length === 0) {
        setSinProveedorOpen(false);
      }
    } catch (err) {
      console.error("Error asignando proveedores:", err);
      alert("Error al asignar proveedores: " + (err as any)?.message);
    } finally {
      setSinProveedorSaving(false);
    }
  };

  // ── Computed ─────────────────────────────────────────────────────
  const filtered = ordenes.filter((oc) => {
    if (filter !== "todas" && oc.estado !== filter) return false;
    const fechaFilter = smartFilterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && oc.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && oc.fecha > fechaFilter.to) return false;
    const monedaFilter = smartFilterValues.moneda as string;
    if (monedaFilter && oc.moneda !== monedaFilter) return false;
    const montoFilter = smartFilterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && Number(oc.total) < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && Number(oc.total) > montoFilter.max) return false;
    return true;
  });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const ocEsteMes = ordenes.filter((oc) => {
    const d = new Date(oc.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const totalPendiente = ordenes
    .filter((oc) => ["enviada", "confirmada"].includes(oc.estado))
    .reduce((a, oc) => a + Number(oc.total), 0);
  const pendientesRecepcion = ordenes.filter((oc) =>
    ["enviada", "confirmada", "recibida_parcial"].includes(oc.estado)
  ).length;

  if (loading) {
    return (
      <>
        <Header title="Compras" subtitle="Cargando..." />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Compras"
        subtitle={`${ordenes.length} compras`}
        action={{ label: "Nueva OC", onClick: openCreateModal }}
      />

      {/* Secondary action bar */}
      <div className="px-4 sm:px-8 pt-2 flex justify-end gap-3">
        <button
          onClick={openSinProveedorModal}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
        >
          <AlertTriangle className="h-4 w-4" />
          Items sin proveedor
        </button>
        <button
          onClick={openConsolidateModal}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"
        >
          <Merge className="h-4 w-4" />
          Consolidar pedidos
        </button>
      </div>

      <div className="p-4 sm:p-8 space-y-6">
        {/* Success message */}
        {consolidateSuccessMsg && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {consolidateSuccessMsg}
            </div>
            <button onClick={() => setConsolidateSuccessMsg("")} className="text-emerald-500 hover:text-emerald-700"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Late delivery warning */}
        {(() => {
          const today = todayAR();
          const late = ordenes.filter(oc =>
            oc.fecha_entrega_estimada &&
            oc.fecha_entrega_estimada < today &&
            ["enviada", "confirmada", "recibida_parcial"].includes(oc.estado)
          );
          if (late.length === 0) return null;
          return (
            <div className="flex items-center gap-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span><strong>{late.length}</strong> OC con fecha de entrega vencida: {late.slice(0, 3).map(oc => oc.numero).join(", ")}{late.length > 3 ? ` y ${late.length - 3} más` : ""}</span>
            </div>
          );
        })()}

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total OC este mes" value={String(ocEsteMes.length)} icon={ShoppingCart} iconColor="text-blue-600" />
          <StatCard title="Monto pendiente" value={formatCurrency(totalPendiente)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Pend. recepcion" value={String(pendientesRecepcion)} icon={Truck} iconColor="text-violet-600" />
          <StatCard title="Recibidas completas" value={String(ordenes.filter((oc) => oc.estado === "recibida").length)} icon={CheckCircle2} iconColor="text-emerald-600" />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todas", "borrador", "enviada", "confirmada", "recibida_parcial", "recibida", "cancelada"] as const).map((status) => {
            const count = status === "todas" ? ordenes.length : ordenes.filter((oc) => oc.estado === status).length;
            if (status !== "todas" && count === 0) return null;
            return (
              <button
                key={status}
                onClick={() => setFilter(status)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                  filter === status
                    ? "bg-orange-500 text-white shadow-sm"
                    : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700"
                }`}
              >
                {status === "todas" ? "Todas" : statusConfig[status].label}
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${filter === status ? "bg-white/20" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <SmartFilters filters={smartFilterConfigs} values={smartFilterValues} onChange={setSmartFilterValues} />

        {/* Data table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<OCRow>
            columns={[
              {
                key: "numero",
                label: "N° OC",
                sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "proveedores",
                label: "Proveedor",
                sortable: true,
                render: (row) => (
                  <div>
                    <span className={`font-medium ${!row.proveedores?.razon_social ? "text-amber-500 italic" : ""}`}>{row.proveedores?.razon_social || "Sin proveedor"}</span>
                    {row.proveedores?.email && (
                      <a href={`mailto:${row.proveedores.email}`} className="text-xs text-zinc-400 hover:text-orange-500 truncate max-w-[200px] block" onClick={(e) => e.stopPropagation()}>{row.proveedores.email}</a>
                    )}
                  </div>
                ),
              },
              {
                key: "orden_compra_items",
                label: "Items",
                render: (row) => (
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">{row.orden_compra_items.length} items</span>
                    {row.observaciones && (
                      <span title={row.observaciones} className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 cursor-help">
                        <MessageSquare className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "fecha",
                label: "Fecha",
                sortable: true,
                render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span>,
              },
              {
                key: "total",
                label: "Total",
                sortable: true,
                className: "text-right",
                render: (row) => (
                  <span className="font-mono font-semibold block text-right">
                    {formatCurrency(Number(row.total), row.moneda as "ARS" | "USD")}
                  </span>
                ),
              },
              {
                key: "estado",
                label: "Pedido",
                sortable: true,
                render: (row) => {
                  const isPedido = row.pedido ?? false;
                  return (
                    <button
                      onClick={(e) => handleTogglePedido(row, e)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                        isPedido
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      }`}
                      title={isPedido ? "Pedido realizado" : "Marcar como pedido"}
                    >
                      {isPedido ? (
                        <><Check className="h-3 w-3" /> Si</>
                      ) : (
                        <><X className="h-3 w-3" /> No</>
                      )}
                    </button>
                  );
                },
              },
              {
                key: "id",
                label: "Recepcion",
                render: (row) => {
                  const totalQty = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad), 0);
                  const recibido = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad_recibida), 0);
                  const today = todayAR();
                  const isLate = row.fecha_entrega_estimada && row.fecha_entrega_estimada < today && row.estado !== "recibida" && row.estado !== "cancelada";

                  // Determine traffic-light color
                  let dotColor = "bg-red-500"; // Sin recepcion
                  let label = "Sin recepcion";
                  if (row.estado === "recibida" || (totalQty > 0 && recibido >= totalQty)) {
                    dotColor = "bg-emerald-500";
                    label = "Completo";
                  } else if (recibido > 0 || row.estado === "recibida_parcial") {
                    dotColor = "bg-amber-500";
                    label = `Parcial (${recibido}/${totalQty})`;
                  } else if (isLate) {
                    dotColor = "bg-amber-500";
                    label = "Demorado";
                  }

                  // Don't show for cancelled
                  if (row.estado === "cancelada") {
                    return <span className="text-zinc-300">{"\u2014"}</span>;
                  }

                  return (
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-3 w-3 rounded-full ${dotColor} shrink-0`}
                        title={label}
                      />
                      <span className="text-xs text-zinc-500 hidden sm:inline">{label}</span>
                      {/* Note icon for parcial/demorado */}
                      {(recibido > 0 || isLate) && row.estado !== "recibida" && (
                        <button
                          onClick={(e) => openNotaPopover(row, e)}
                          className={`p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${row.notas_recepcion ? "text-orange-500" : "text-zinc-300 hover:text-zinc-500"}`}
                          title={row.notas_recepcion || "Agregar nota de recepcion"}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "presupuesto_origen_id",
                label: "PR origen",
                render: (row) =>
                  row.presupuesto_origen ? (
                    <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{(row.presupuesto_origen as { numero: string }).numero}</span>
                  ) : (
                    <span className="text-zinc-300">{"\u2014"}</span>
                  ),
              },
              {
                key: "observaciones",
                label: "Enviar",
                render: (row) => (
                  <div onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => handleCopyForProveedor(row, e)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        copiedRowId === row.id
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-orange-50 text-orange-600 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:hover:bg-orange-900/40"
                      }`}
                      title="Copiar resumen para enviar al proveedor"
                    >
                      {copiedRowId === row.id ? (
                        <><Check className="h-3 w-3" /> Copiado</>
                      ) : (
                        <><ClipboardCopy className="h-3 w-3" /> Copiar</>
                      )}
                    </button>
                  </div>
                ),
              },
              {
                key: "acciones",
                label: "Acciones",
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {row.estado !== "recibida" && row.estado !== "cancelada" && (
                      <button onClick={() => handleCancel(row)} className="px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 transition-colors" title="Cancelar OC">
                        Cancelar
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={filtered}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* ── Create OC Modal ─────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold dark:text-white">Nueva Orden de Compra</h2>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {formError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</div>}
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Proveedor *</label>
                <select value={formData.proveedor_id} onChange={(e) => setFormData((p) => ({ ...p, proveedor_id: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                  <option value="">Seleccionar proveedor...</option>
                  {proveedores.map((prov) => <option key={prov.id} value={prov.id}>{prov.razon_social}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Vincular a PR (opcional)</label>
                <select value={formData.presupuesto_origen_id} onChange={(e) => setFormData((p) => ({ ...p, presupuesto_origen_id: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                  <option value="">Sin presupuesto asociado</option>
                  {presupuestosAprobados.map((p) => <option key={p.id} value={p.id}>{p.numero} — {p.clienteNombre}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Fecha</label>
                  <input type="date" value={formData.fecha} onChange={(e) => setFormData((p) => ({ ...p, fecha: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Entrega estimada</label>
                  <input type="date" value={formData.fecha_entrega_estimada} onChange={(e) => setFormData((p) => ({ ...p, fecha_entrega_estimada: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Moneda</label>
                <select value={formData.moneda} onChange={(e) => setFormData((p) => ({ ...p, moneda: e.target.value as "ARS" | "USD" }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                  <option value="ARS">ARS - Pesos</option>
                  <option value="USD">USD - Dolares</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold mb-1 text-amber-700 dark:text-amber-400">
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Observaciones / Instrucciones para el proveedor
                  </span>
                </label>
                <textarea value={formData.observaciones} onChange={(e) => setFormData((p) => ({ ...p, observaciones: e.target.value }))} rows={3} placeholder="Instrucciones de entrega, condiciones especiales, referencias de pedido..." className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm resize-none dark:text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 placeholder:text-amber-400/60" />
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">Se incluyen en el PDF y en el mensaje al proveedor</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
              <button onClick={() => setCreateOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
              <button onClick={handleCreate} disabled={formLoading} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors">
                {formLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear OC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Consolidation Modal ──────────────────────────────────────── */}
      {consolidateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">Consolidar pedidos por proveedor</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Agrupa items de presupuestos aprobados en una OC por proveedor</p>
              </div>
              <button onClick={() => setConsolidateOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {consolidateLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-500 mb-3" />
                  <p className="text-sm text-zinc-400">Buscando presupuestos aprobados...</p>
                </div>
              ) : consolidateGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Package className="h-10 w-10 text-zinc-300 mb-3" />
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">No hay items pendientes</p>
                  <p className="text-xs text-zinc-400 mt-1">Todos los presupuestos aprobados ya tienen OC generada, o no tienen proveedor asignado en sus items.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {consolidateGroups.map((group) => {
                    const selectedCount = group.items.filter(it => it.selected).length;
                    const totalGroup = group.items.filter(it => it.selected).reduce((s, it) => s + it.precio_costo * it.cantidad, 0);
                    return (
                      <div key={group.id} className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                        {/* Provider header */}
                        <div
                          className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 cursor-pointer"
                          onClick={() => toggleProveedorExpand(group.id)}
                        >
                          <div className="flex items-center gap-3">
                            {group.expanded ? <ChevronDown className="h-4 w-4 text-zinc-400" /> : <ChevronRight className="h-4 w-4 text-zinc-400" />}
                            <div>
                              <p className="font-semibold text-sm dark:text-white">{group.nombre}</p>
                              <p className="text-xs text-zinc-400">{selectedCount}/{group.items.length} items · {formatCurrency(totalGroup, group.moneda as "ARS" | "USD")}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleAllInGroup(group.id, selectedCount < group.items.length); }}
                              className="text-xs text-orange-500 hover:text-orange-600 font-medium"
                            >
                              {selectedCount === group.items.length ? "Deseleccionar" : "Seleccionar todos"}
                            </button>
                          </div>
                        </div>

                        {/* Items */}
                        {group.expanded && (
                          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {group.items.map((item) => (
                              <label
                                key={item.item_id}
                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={item.selected}
                                  onChange={() => toggleConsolidateItem(group.id, item.item_id)}
                                  className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {item.codigo && <span className="font-mono text-xs text-zinc-400">{item.codigo}</span>}
                                    <span className="text-sm font-medium truncate dark:text-white">{item.descripcion}</span>
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                    <span className="text-xs text-blue-500 font-mono">{item.pr_numero}</span>
                                    <span className="text-xs text-zinc-400">{item.cliente_nombre}</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-sm font-medium dark:text-white">{item.cantidad} {item.unidad}</p>
                                  <p className="text-xs text-zinc-400">{formatCurrency(item.precio_costo, item.moneda as "ARS" | "USD")} c/u</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {consolidateGroups.length > 0 && !consolidateLoading && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-sm text-zinc-500">
                  {consolidateGroups.reduce((s, g) => s + g.items.filter(it => it.selected).length, 0)} items en{" "}
                  {consolidateGroups.filter(g => g.items.some(it => it.selected)).length} proveedor(es)
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setConsolidateOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreateConsolidatedOCs}
                    disabled={consolidateCreating || consolidateGroups.every(g => g.items.every(it => !it.selected))}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {consolidateCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                    Crear OC consolidadas
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Items sin proveedor modal ──────────────────────────────── */}
      {sinProveedorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-semibold dark:text-white">Items sin proveedor asignado</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Items de presupuestos aprobados que no tienen proveedor — asigná uno para poder generar OC</p>
              </div>
              <button onClick={() => setSinProveedorOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {sinProveedorLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-orange-500 mb-3" />
                  <p className="text-sm text-zinc-400">Buscando items sin proveedor...</p>
                </div>
              ) : sinProveedorItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-400 mb-3" />
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Todos los items tienen proveedor</p>
                  <p className="text-xs text-zinc-400 mt-1">No hay items pendientes de asignación.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sinProveedorItems.map((item) => (
                    <div key={item.item_id} className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.codigo && <span className="font-mono text-xs text-zinc-400">{item.codigo}</span>}
                            <span className="text-sm font-medium dark:text-white">{item.descripcion}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-blue-500 font-mono">{item.pr_numero}</span>
                            <span className="text-xs text-zinc-400">{item.cliente_nombre}</span>
                            <span className="text-xs text-zinc-500">{item.cantidad} {item.unidad}</span>
                            {item.precio_costo > 0 && (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400">{formatCurrency(item.precio_costo, item.moneda as "ARS" | "USD")} c/u</span>
                            )}
                          </div>
                        </div>
                        <select
                          value={item.proveedor_id}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSinProveedorItems(prev => prev.map(it =>
                              it.item_id === item.item_id ? { ...it, proveedor_id: val } : it
                            ));
                          }}
                          className="text-sm border border-zinc-300 dark:border-zinc-600 rounded-md px-2 py-1.5 bg-white dark:bg-zinc-800 dark:text-white min-w-[180px]"
                        >
                          <option value="">Seleccionar proveedor...</option>
                          {sinProveedorProvs.map(p => (
                            <option key={p.id} value={p.id}>{p.razon_social}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {sinProveedorItems.length > 0 && !sinProveedorLoading && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-sm text-zinc-500">
                  {sinProveedorItems.filter(it => it.proveedor_id).length} de {sinProveedorItems.length} items con proveedor asignado
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setSinProveedorOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={handleAsignarProveedores}
                    disabled={sinProveedorSaving || sinProveedorItems.every(it => !it.proveedor_id)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                  >
                    {sinProveedorSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Guardar proveedores
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Nota recepcion popover ──────────────────────────────────── */}
      {notaPopoverId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setNotaPopoverId(null)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <h3 className="text-sm font-semibold dark:text-white flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-orange-500" />
                Nota de recepcion
              </h3>
              <button onClick={() => setNotaPopoverId(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-zinc-400">Indica fecha de llegada estimada, motivo de demora, o cualquier detalle relevante.</p>
              <textarea
                value={notaPopoverText}
                onChange={(e) => setNotaPopoverText(e.target.value)}
                rows={3}
                placeholder="Ej: Fecha de llegada estimada 25/06. Proveedor confirmo demora por falta de stock."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm resize-none dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>
            <div className="flex justify-end gap-3 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => setNotaPopoverId(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNotaRecepcion}
                disabled={savingNota}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {savingNota && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Side Panel ───────────────────────────────────────── */}
      {detailOC && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setDetailOC(null); setPanelFullscreen(false); setEditMode(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-2xl"
          }>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold font-mono dark:text-white">{detailOC.numero}</h2>
                  <Badge variant={detailOC.pedido ? "success" : "outline"}>
                    {detailOC.pedido ? "Pedido" : "No pedido"}
                  </Badge>
                  {(() => {
                    const totalQty = detailOC.orden_compra_items.reduce((a, i) => a + Number(i.cantidad), 0);
                    const recibido = detailOC.orden_compra_items.reduce((a, i) => a + Number(i.cantidad_recibida), 0);
                    const today = todayAR();
                    const isLate = detailOC.fecha_entrega_estimada && detailOC.fecha_entrega_estimada < today && detailOC.estado !== "recibida" && detailOC.estado !== "cancelada";
                    let dotColor = "bg-red-500";
                    if (detailOC.estado === "recibida" || (totalQty > 0 && recibido >= totalQty)) dotColor = "bg-emerald-500";
                    else if (recibido > 0 || detailOC.estado === "recibida_parcial") dotColor = "bg-amber-500";
                    else if (isLate) dotColor = "bg-amber-500";
                    if (detailOC.estado !== "cancelada") {
                      return <span className={`inline-block h-3 w-3 rounded-full ${dotColor}`} title="Recepcion" />;
                    }
                    return null;
                  })()}
                </div>
                {detailOC.presupuesto_origen && (
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Origen: <span className="font-mono text-blue-500">{(detailOC.presupuesto_origen as { numero: string }).numero}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {editMode ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                    >
                      {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      disabled={savingEdit}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={startEditMode}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                      title="Editar OC"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    <button
                      onClick={handleCopySummary}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      title="Copiar resumen"
                    >
                      {copiedSummary ? <Check className="h-4 w-4 text-emerald-500" /> : <ClipboardCopy className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={handleDownloadPDF}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      title="Descargar PDF"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </>
                )}
                <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setDetailOC(null); setEditMode(false); setPanelFullscreen(false); }} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* ── Action Buttons ─────────────────────────────────────── */}
              {!["recibida", "cancelada"].includes(detailOC.estado) && (
                <div className="flex flex-wrap gap-2">
                  {detailOC.estado === "borrador" && (
                    <button
                      onClick={() => handleAdvanceEstado(detailOC, "enviada")}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                    >
                      <Send className="h-4 w-4" /> Marcar como enviada
                    </button>
                  )}
                  {detailOC.estado === "enviada" && (
                    <button
                      onClick={() => handleAdvanceEstado(detailOC, "confirmada")}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Confirmar OC
                    </button>
                  )}
                  {["confirmada", "recibida_parcial"].includes(detailOC.estado) && detailItems.length > 0 && (
                    <button
                      onClick={handleMarcarTodoRecibido}
                      disabled={savingRecepcion === "all"}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
                    >
                      {savingRecepcion === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                      Marcar todo recibido
                    </button>
                  )}
                  <button
                    onClick={() => handleCancel(detailOC)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <XCircle className="h-4 w-4" /> Cancelar OC
                  </button>
                </div>
              )}

              {/* ── Proveedor Info ─────────────────────────────────────── */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Truck className="h-4 w-4 text-zinc-400" /> Proveedor
                  </h3>
                  {detailOC.proveedores?.razon_social && (
                    <CopyButton text={`${detailOC.proveedores.razon_social}${detailOC.proveedores.cuit ? ` - CUIT: ${detailOC.proveedores.cuit}` : ""}`} label="Copiar" />
                  )}
                </div>
                {detailOC.proveedores ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-base dark:text-white">{detailOC.proveedores.razon_social}</p>
                        {detailOC.proveedores.cuit && <p className="text-zinc-500">CUIT: {detailOC.proveedores.cuit}</p>}
                        {detailOC.proveedores.condicion_iva && <p className="text-zinc-400 text-xs">{detailOC.proveedores.condicion_iva}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      {detailOC.proveedores.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <a href={`mailto:${detailOC.proveedores.email}`} className="truncate hover:text-orange-500">{detailOC.proveedores.email}</a>
                          <CopyButton text={detailOC.proveedores.email} />
                        </div>
                      )}
                      {detailOC.proveedores.telefono && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span>{detailOC.proveedores.telefono}</span>
                          <CopyButton text={detailOC.proveedores.telefono} />
                        </div>
                      )}
                      {detailOC.proveedores.direccion && (
                        <div className="flex items-center gap-2 sm:col-span-2">
                          <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span className="truncate">
                            {detailOC.proveedores.direccion}
                            {detailOC.proveedores.localidad ? `, ${detailOC.proveedores.localidad}` : ""}
                            {detailOC.proveedores.provincia ? `, ${detailOC.proveedores.provincia}` : ""}
                          </span>
                          <CopyButton text={`${detailOC.proveedores.direccion}${detailOC.proveedores.localidad ? `, ${detailOC.proveedores.localidad}` : ""}${detailOC.proveedores.provincia ? `, ${detailOC.proveedores.provincia}` : ""}`} />
                        </div>
                      )}
                      {detailOC.proveedores.forma_pago && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span>Pago: {detailOC.proveedores.forma_pago}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Sin proveedor asignado</p>
                    <div>
                      <select
                        onChange={async (e) => {
                          const provId = e.target.value;
                          if (!provId || !detailOC) return;
                          const { error } = await supabase.from("ordenes_compra").update({ proveedor_id: provId } as any).eq("id", detailOC.id);
                          if (error) { alert("Error al asignar proveedor"); return; }
                          await fetchData();
                          // Reload detail
                          const updated = ordenes.find(o => o.id === detailOC.id);
                          if (updated) setDetailOC(updated);
                          else {
                            const { data: fresh } = await supabase.from("ordenes_compra").select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero), orden_compra_items(cantidad, cantidad_recibida)").eq("id", detailOC.id).single();
                            if (fresh) setDetailOC(fresh as any);
                          }
                        }}
                        className="w-full rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                        defaultValue=""
                      >
                        <option value="">Asignar proveedor...</option>
                        {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Info grid ──────────────────────────────────────────── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-zinc-400">Fecha</span>
                  <p className="font-medium dark:text-white">{formatDate(detailOC.fecha)}</p>
                </div>
                <div>
                  <span className="text-zinc-400">Entrega estimada</span>
                  {editMode ? (
                    <input type="date" value={editOC.fecha_entrega_estimada}
                      onChange={(e) => setEditOC((prev) => ({ ...prev, fecha_entrega_estimada: e.target.value }))}
                      className="w-full rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-2 py-1 text-sm dark:text-white mt-0.5" />
                  ) : (
                    <p className="font-medium dark:text-white">{detailOC.fecha_entrega_estimada ? formatDate(detailOC.fecha_entrega_estimada) : "\u2014"}</p>
                  )}
                </div>
                <div>
                  <span className="text-zinc-400">Moneda</span>
                  <p className="font-medium dark:text-white">{detailOC.moneda}</p>
                </div>
                <div>
                  <span className="text-zinc-400">PR origen</span>
                  <p className="font-medium dark:text-white">
                    {detailOC.presupuesto_origen ? (
                      <span className="font-mono text-blue-500">{(detailOC.presupuesto_origen as { numero: string }).numero}</span>
                    ) : "\u2014"}
                  </p>
                </div>
              </div>

              {/* Observaciones / Comentarios */}
              {editMode ? (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Observaciones
                  </div>
                  <textarea value={editOC.observaciones}
                    onChange={(e) => setEditOC((prev) => ({ ...prev, observaciones: e.target.value }))}
                    rows={3}
                    className="w-full rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                </div>
              ) : detailOC.observaciones ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Observaciones
                  </div>
                  <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">{detailOC.observaciones}</p>
                </div>
              ) : null}

              {/* Notas de recepcion */}
              {(detailOC.notas_recepcion || ["recibida_parcial", "confirmada", "enviada"].includes(detailOC.estado)) && (
                <div className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Nota de recepcion
                    </span>
                    <button
                      onClick={(e) => openNotaPopover(detailOC, e)}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      {detailOC.notas_recepcion ? "Editar" : "Agregar nota"}
                    </button>
                  </div>
                  {detailOC.notas_recepcion ? (
                    <p className="mt-1 text-zinc-700 dark:text-zinc-300 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                      {detailOC.notas_recepcion}
                    </p>
                  ) : (
                    <p className="mt-1 text-zinc-300 dark:text-zinc-600 italic">Sin notas</p>
                  )}
                </div>
              )}

              {/* ── Totals ─────────────────────────────────────────────── */}
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Subtotal</span>
                  <span className="font-mono">{formatCurrency(Number(detailOC.subtotal), detailOC.moneda as "ARS" | "USD")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">IVA</span>
                  <span className="font-mono">{formatCurrency(Number(detailOC.iva), detailOC.moneda as "ARS" | "USD")}</span>
                </div>
                <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold">
                  <span>Total</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{formatCurrency(Number(detailOC.total), detailOC.moneda as "ARS" | "USD")}</span>
                    <CopyButton text={formatCurrency(Number(detailOC.total), detailOC.moneda as "ARS" | "USD")} />
                  </div>
                </div>
              </div>

              {/* ── Items table ─────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Items ({(editMode ? editItems : detailItems).length})</h3>
                  <div className="flex items-center gap-2">
                    {editMode && (
                      <button onClick={() => setEditItems(prev => [...prev, { id: `new_${Date.now()}`, codigo: "", descripcion: "", cantidad: 1, cantidad_recibida: 0, unidad: "u", precio_unitario: 0, subtotal: 0, producto_id: null, iva_porcentaje: 21 }])}
                        className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                        <Plus className="h-3 w-3" /> Agregar item
                      </button>
                    )}
                    {detailItems.length > 0 && !editMode && (
                      <CopyButton
                        text={detailItems.map((it, i) => `${i + 1}. ${it.codigo} - ${it.descripcion} x${it.cantidad}`).join("\n")}
                        label="Copiar items"
                      />
                    )}
                  </div>
                </div>
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                  </div>
                ) : (editMode ? editItems : detailItems).length === 0 && !editMode ? (
                  <p className="text-sm text-zinc-400 py-4 text-center">Sin items — editá la OC para agregar</p>
                ) : (
                  <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800 text-left text-xs text-zinc-500 uppercase">
                          <th className="px-3 py-2">Codigo</th>
                          <th className="px-3 py-2">Descripcion</th>
                          <th className="px-3 py-2 text-right">Cant.</th>
                          <th className="px-3 py-2 text-right">P. Unit.</th>
                          <th className="px-3 py-2 text-right">Subtotal</th>
                          <th className="px-3 py-2 text-center">Recibido</th>
                          {editMode && <th className="px-3 py-2 w-8"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {(editMode ? editItems : detailItems).map((item, idx) => {
                          const pct = Number(item.cantidad) > 0
                            ? Math.round((Number(item.cantidad_recibida) / Number(item.cantidad)) * 100)
                            : 0;
                          return (
                            <tr key={item.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                              <td className="px-3 py-2 font-mono text-xs">
                                {editMode ? (
                                  <input type="text" value={item.codigo}
                                    onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, codigo: e.target.value } : it))}
                                    placeholder="Codigo" className="w-20 rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-xs font-mono" />
                                ) : item.codigo}
                              </td>
                              <td className="px-3 py-2 max-w-[200px] truncate" title={item.descripcion}>
                                {editMode ? (
                                  <input type="text" value={item.descripcion}
                                    onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))}
                                    placeholder="Descripcion" className="w-full rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm" />
                                ) : item.descripcion}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {editMode ? (
                                  <input type="number" step="any" min={0} value={item.cantidad}
                                    onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) || 0 } : it))}
                                    className="w-16 text-right rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm" />
                                ) : (
                                  <>{item.cantidad}{item.unidad ? ` ${item.unidad}` : ""}</>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {editMode ? (
                                  <input type="number" step="any" min={0} value={item.precio_unitario}
                                    onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) || 0 } : it))}
                                    className="w-20 text-right rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm font-mono" />
                                ) : (
                                  formatCurrency(Number(item.precio_unitario), detailOC.moneda as "ARS" | "USD")
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {editMode
                                  ? formatCurrency(Number(item.cantidad) * Number(item.precio_unitario), detailOC.moneda as "ARS" | "USD")
                                  : formatCurrency(Number(item.subtotal), detailOC.moneda as "ARS" | "USD")}
                              </td>
                              <td className="px-3 py-2">
                                {editMode ? (
                                  <div className="flex items-center justify-center">
                                    <input type="number" step="1" min={0} max={item.cantidad} value={item.cantidad_recibida}
                                      onChange={(e) => setEditItems((prev) => prev.map((it, i) => i === idx ? { ...it, cantidad_recibida: Math.max(0, Number(e.target.value) || 0) } : it))}
                                      className="w-16 text-center rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-sm" />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 justify-center">
                                    <div className="w-20">
                                      <div className="flex justify-between text-xs mb-0.5">
                                        <span>{item.cantidad_recibida}/{item.cantidad}</span>
                                      </div>
                                      <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                                        <div
                                          className={`h-1.5 rounded-full ${pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-amber-500" : "bg-zinc-300"}`}
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </td>
                              {editMode && (
                                <td className="px-1 py-2">
                                  <button onClick={() => setEditItems(prev => prev.filter((_, i) => i !== idx))}
                                    className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                                    <Minus className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Recepcion de mercaderia ─────────────────────────── */}
              {["confirmada", "recibida_parcial"].includes(detailOC.estado) && detailItems.length > 0 && !detailLoading && (
                <div className="rounded-lg border-2 border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold flex items-center gap-2 text-violet-700 dark:text-violet-300">
                      <PackageCheck className="h-4 w-4" />
                      Recepcion de mercaderia
                    </h3>
                    <button
                      onClick={handleMarcarTodoRecibido}
                      disabled={savingRecepcion === "all"}
                      className="text-xs font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200 transition-colors"
                    >
                      Marcar todo recibido
                    </button>
                  </div>

                  <div className="border border-violet-200 dark:border-violet-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-violet-50 dark:bg-violet-900/30 text-left text-xs text-violet-600 dark:text-violet-300 uppercase">
                          <th className="px-3 py-2">Descripcion</th>
                          <th className="px-3 py-2 text-center">Pedido</th>
                          <th className="px-3 py-2 text-center">Ya recibido</th>
                          <th className="px-3 py-2 text-center">Pendiente</th>
                          <th className="px-3 py-2 text-center">Recibir ahora</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {detailItems.map((item) => {
                          const pendiente = Math.max(0, Number(item.cantidad) - Number(item.cantidad_recibida));
                          const fullyReceived = pendiente === 0;
                          return (
                            <tr
                              key={item.id}
                              className={fullyReceived ? "opacity-50 bg-emerald-50/50 dark:bg-emerald-900/10" : ""}
                            >
                              <td className="px-3 py-2">
                                <div className="max-w-[220px] truncate" title={item.descripcion}>
                                  {item.codigo && <span className="font-mono text-xs text-zinc-400 mr-1">{item.codigo}</span>}
                                  {item.descripcion}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-center font-medium">{item.cantidad}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={Number(item.cantidad_recibida) > 0 ? "text-emerald-600 font-medium" : "text-zinc-400"}>
                                  {item.cantidad_recibida}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={pendiente > 0 ? "text-amber-600 font-medium" : "text-emerald-600"}>
                                  {pendiente}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center justify-center">
                                  {fullyReceived ? (
                                    <Check className="h-4 w-4 text-emerald-500" />
                                  ) : (
                                    <input
                                      type="number"
                                      min={0}
                                      max={pendiente}
                                      value={recepcionQtys[item.id] || 0}
                                      onChange={(e) => {
                                        const val = Math.min(Math.max(0, Number(e.target.value)), pendiente);
                                        setRecepcionQtys((prev) => ({ ...prev, [item.id]: val }));
                                      }}
                                      className="w-16 text-center rounded border border-violet-300 dark:border-violet-600 bg-white dark:bg-zinc-800 px-1 py-1 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                                      disabled={savingRecepcion !== null}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary + submit */}
                  {(() => {
                    const totalRecibiendo = Object.values(recepcionQtys).reduce((a, b) => a + b, 0);
                    return (
                      <div className="flex items-center justify-between pt-2">
                        <p className="text-sm text-violet-600 dark:text-violet-300">
                          {totalRecibiendo > 0
                            ? `Registrando ${totalRecibiendo} unidad(es) en esta recepcion`
                            : "Ingresa las cantidades recibidas"}
                        </p>
                        <button
                          onClick={handleRegistrarRecepcion}
                          disabled={savingRecepcion !== null || totalRecibiendo === 0}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
                        >
                          {savingRecepcion === "all" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <PackageCheck className="h-4 w-4" />
                          )}
                          Registrar recepcion
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
