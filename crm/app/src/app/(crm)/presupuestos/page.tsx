"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { mockPresupuestos } from "@/lib/mock-data";
import type { Presupuesto, PRStatus } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Send, Eye, Copy, FileText, CheckCircle2, XCircle, Clock,
  PauseCircle, Edit3, Loader2, X, Trash2, ArrowRight, AlertTriangle, Plus, Minus,
  Printer, Sparkles, Download, ClipboardCopy, Check,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
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
  tipo_cambio: number | null;
  observaciones: string;
  notas_internas: string;
  enviado_at?: string | null;
  respondido_at?: string | null;
  version?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  vendedor_id: string | null;
  clientes?: { razon_social: string; cuit: string; email?: string | null; telefono?: string | null; direccion?: string | null; localidad?: string | null; provincia?: string | null; condicion_iva?: string | null } | null;
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
    tipoCambio: row.tipo_cambio ?? null,
    observaciones: row.observaciones ?? "",
    notasInternas: row.notas_internas ?? "",
    creadoPor: (row as any).created_by_profile?.full_name ?? row.created_by ?? "",
    enviadoAt: row.enviado_at ?? undefined,
    respondidoAt: row.respondido_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vendedorNombre: row.vendedor_profile?.full_name ?? "",
    vendedorAvatar: row.vendedor_profile?.avatar_url ?? null,
    vendedorId: row.vendedor_id ?? null,
    clienteCuit: row.clientes?.cuit ?? "",
    clienteEmail: row.clientes?.email ?? "",
    clienteTelefono: row.clientes?.telefono ?? "",
    clienteDireccion: row.clientes?.direccion ?? "",
    clienteLocalidad: row.clientes?.localidad ?? "",
    clienteProvincia: row.clientes?.provincia ?? "",
    clienteCondicionIva: row.clientes?.condicion_iva ?? "",
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
  proveedor_nombre: string;
  proveedor_id: string;
  lista_item_id: string;
  costo_moneda: "ARS" | "USD";
}

// Autocomplete result from lista_precios_items
interface ProductSuggestion {
  id: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  unidad: string;
  precio_neto: number;
  precio: number;
  proveedor_nombre: string;
  proveedor_id: string;
  lista_nombre: string;
  moneda: string;
}

function calcItemTotals(item: NewPRItem) {
  const subtotal = item.cantidad * item.precio_venta;
  const iva = subtotal * (item.iva_porcentaje / 100);
  return { subtotal, iva, total: subtotal + iva };
}

const emptyItem: NewPRItem = {
  codigo: "", descripcion: "", categoria: "", cantidad: 1, unidad: "UN",
  precio_costo: 0, markup_porcentaje: 0, precio_venta: 0, iva_porcentaje: 21,
  proveedor_nombre: "", proveedor_id: "", lista_item_id: "", costo_moneda: "USD",
};

/** Convierte precio_costo a la moneda del presupuesto */
function convertCosto(costoBase: number, costoMoneda: string, prMoneda: string, tc: number): number {
  if (!tc || tc <= 0 || costoMoneda === prMoneda) return costoBase;
  // USD→ARS: multiplicar, ARS→USD: dividir
  if (costoMoneda === "USD" && prMoneda === "ARS") return costoBase * tc;
  if (costoMoneda === "ARS" && prMoneda === "USD") return costoBase / tc;
  return costoBase;
}

export default function PresupuestosPage() {
  const { profile } = useUser();
  const { toast } = useToast();
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

  // AI presupuesto
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  const [clientes, setClientes] = useState<{id: string; razon_social: string}[]>([]);
  const [newPR, setNewPR] = useState({
    cliente_id: "",
    vendedor_id: "",
    moneda: "USD" as "USD" | "ARS",
    tipo_cambio: 0,
    markup_general: 30,
    observaciones: "",
    notas_internas: "",
    items: [{ ...emptyItem }] as NewPRItem[],
  });

  // Client search
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  const filteredClientes = clientes.filter((c) =>
    c.razon_social.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Product search modal
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchIdx, setProductSearchIdx] = useState(0);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<ProductSuggestion[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);

  function openProductSearch(idx: number) {
    setProductSearchIdx(idx);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchOpen(true);
    setTimeout(() => productSearchInputRef.current?.focus(), 100);
  }

  async function doProductSearch(query: string) {
    if (query.length < 2) { setProductSearchResults([]); return; }
    setProductSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("lista_precios_items")
        .select(`
          id, codigo, descripcion, categoria, unidad, precio, precio_neto,
          listas_precios:lista_id(nombre, moneda, proveedor_id, proveedores:proveedor_id(razon_social))
        `)
        .or(`codigo.ilike.%${query}%,descripcion.ilike.%${query}%`)
        .limit(20);

      if (error || !data) { setProductSearchResults([]); return; }

      const mapped: ProductSuggestion[] = data
        .filter((d: any) => d.listas_precios)
        .map((d: any) => ({
          id: d.id,
          codigo: d.codigo ?? "",
          descripcion: d.descripcion ?? "",
          categoria: d.categoria ?? "",
          unidad: d.unidad ?? "UN",
          precio_neto: d.precio_neto ?? d.precio ?? 0,
          precio: d.precio ?? 0,
          proveedor_nombre: d.listas_precios?.proveedores?.razon_social ?? "—",
          proveedor_id: d.listas_precios?.proveedor_id ?? "",
          lista_nombre: d.listas_precios?.nombre ?? "",
          moneda: d.listas_precios?.moneda ?? "ARS",
        }));
      setProductSearchResults(mapped);
    } catch {
      setProductSearchResults([]);
    } finally {
      setProductSearchLoading(false);
    }
  }

  function handleProductSearchInput(value: string) {
    setProductSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => doProductSearch(value), 300);
  }

  function handleProductSelect(suggestion: ProductSuggestion) {
    setNewPR((prev) => {
      const items = [...prev.items];
      const idx = productSearchIdx;
      const markup = items[idx].markup_porcentaje || prev.markup_general;
      const costoMoneda = (suggestion.moneda || "USD") as "ARS" | "USD";
      const costoConv = convertCosto(suggestion.precio_neto, costoMoneda, prev.moneda, prev.tipo_cambio);
      const precioVenta = Number((costoConv * (1 + markup / 100)).toFixed(2));
      items[idx] = {
        ...items[idx],
        codigo: suggestion.codigo,
        descripcion: suggestion.descripcion,
        categoria: suggestion.categoria,
        unidad: suggestion.unidad,
        precio_costo: suggestion.precio_neto,
        costo_moneda: costoMoneda,
        markup_porcentaje: markup,
        precio_venta: precioVenta,
        proveedor_nombre: suggestion.proveedor_nombre,
        proveedor_id: suggestion.proveedor_id,
        lista_item_id: suggestion.id,
      };
      return { ...prev, items };
    });
    setProductSearchOpen(false);
  }

  async function handleAIGenerate() {
    if (!aiMessage.trim()) return;
    setAiLoading(true);
    setAiNotes("");
    try {
      const res = await fetch("/api/ai-presupuesto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensaje: aiMessage,
          cliente_id: newPR.cliente_id || null,
          moneda: newPR.moneda,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error de la IA");

      if (data.items && Array.isArray(data.items) && data.items.length > 0) {
        const newItems: NewPRItem[] = data.items.map((item: any) => {
          const markup = newPR.markup_general;
          const precioCosto = Number(item.precio_costo) || 0;
          const precioVenta = Number((precioCosto * (1 + markup / 100)).toFixed(2));
          return {
            codigo: item.codigo || "",
            descripcion: item.descripcion || "",
            categoria: item.categoria || "",
            cantidad: Number(item.cantidad) || 1,
            unidad: item.unidad || "UN",
            precio_costo: precioCosto,
            costo_moneda: (item.moneda || "USD") as "ARS" | "USD",
            markup_porcentaje: markup,
            precio_venta: precioVenta,
            iva_porcentaje: 21,
            proveedor_nombre: item.proveedor || "",
            proveedor_id: "",
            lista_item_id: item.lista_id || "",
          };
        });
        setNewPR((prev) => ({ ...prev, items: newItems }));
        if (data.notas_generales) setAiNotes(data.notas_generales);
        toast.success(`IA generó ${newItems.length} item(s)`);
        setShowAIPanel(false);
        setAiMessage("");
      } else {
        toast.warning("La IA no encontró productos para este pedido");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error inesperado";
      toast.error(`Error IA: ${msg}`);
    } finally {
      setAiLoading(false);
    }
  }

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
        .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), presupuesto_items(*)`)
        .order("created_at", { ascending: false });

      // If that fails, try without items
      if (res.error) {
        res = await supabase
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_id`)
          .order("created_at", { ascending: false });
      }

      // If still fails, try minimal
      if (res.error) {
        res = await supabase
          .from("presupuestos")
          .select(`*, vendedor_id`)
          .order("created_at", { ascending: false });
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

  function updateNewPRItem(index: number, field: keyof NewPRItem | "costo_moneda", value: string | number) {
    setNewPR((prev) => {
      const items = [...prev.items];
      const item = { ...items[index], [field]: value };
      // Auto-calc precio_venta when costo, markup, or costo_moneda change
      if (field === "precio_costo" || field === "markup_porcentaje" || field === "costo_moneda") {
        const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio);
        item.precio_venta = Number((costoConv * (1 + item.markup_porcentaje / 100)).toFixed(2));
      }
      items[index] = item;
      return { ...prev, items };
    });
  }

  async function handleCreatePR() {
    if (!newPR.cliente_id || !newPR.vendedor_id) {
      toast.warning("Selecciona un cliente y un vendedor");
      return;
    }
    const validItems = newPR.items.filter((it) => it.descripcion.trim() && it.cantidad > 0);
    if (validItems.length === 0) {
      toast.warning("Agrega al menos un item");
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
          tipo_cambio: newPR.moneda === "USD" && newPR.tipo_cambio > 0 ? newPR.tipo_cambio : null,
          observaciones: newPR.observaciones,
          notas_internas: newPR.notas_internas,
        } as any)
        .select()
        .single();

      if (error) throw new Error(error.message);

      if (newRow && itemsWithTotals.length > 0) {
        // precio_venta, subtotal, iva, total are GENERATED columns — don't insert them
        const items = itemsWithTotals.map((it) => ({
          presupuesto_id: newRow.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          categoria: it.categoria,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_costo: it.precio_costo,
          markup_porcentaje: it.markup_porcentaje,
          iva_porcentaje: it.iva_porcentaje,
          orden: it.orden,
          proveedor_id: it.proveedor_id || null,
          lista_item_id: it.lista_item_id || null,
          proveedor_nombre: it.proveedor_nombre || null,
        }));
        const { error: itemsError } = await supabase.from("presupuesto_items").insert(items as any);
        if (itemsError) console.error("Error inserting items:", itemsError);
      }

      setShowNewPR(false);
      setNewPR({ cliente_id: "", vendedor_id: "", moneda: "USD", tipo_cambio: 0, markup_general: 30, observaciones: "", notas_internas: "", items: [{ ...emptyItem }] });
      toast.success("Presupuesto creado correctamente");
      await fetchPresupuestos();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(`Error al crear presupuesto: ${msg}`);
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

  async function generateOCsFromPresupuesto(prId: string) {
    try {
      // Fetch presupuesto items with proveedor info
      const { data: items, error: itemsErr } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", prId);
      if (itemsErr || !items || items.length === 0) return;

      // Get presupuesto header for moneda and numero
      const { data: prHeader } = await supabase
        .from("presupuestos")
        .select("moneda, numero")
        .eq("id", prId)
        .single();
      const moneda = prHeader?.moneda ?? "USD";
      const prNumero = prHeader?.numero ?? "";

      // Group items by proveedor_id (skip items without proveedor)
      const byProveedor: Record<string, any[]> = {};
      for (const item of items) {
        const provId = (item as any).proveedor_id;
        if (!provId) continue;
        if (!byProveedor[provId]) byProveedor[provId] = [];
        byProveedor[provId].push(item);
      }

      const proveedorIds = Object.keys(byProveedor);
      if (proveedorIds.length === 0) {
        toast.info("PR aprobado. No se generaron OC (items sin proveedor asignado).");
        return;
      }

      let ocsCreated = 0;
      const today = new Date().toISOString().split("T")[0];

      for (const provId of proveedorIds) {
        const provItems = byProveedor[provId];
        const subtotal = provItems.reduce((sum, it) => sum + Number(it.precio_costo) * Number(it.cantidad), 0);
        const iva = subtotal * 0.21;

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: provId,
            presupuesto_origen_id: prId,
            fecha: today,
            moneda,
            estado: "borrador",
            subtotal,
            iva,
            total: subtotal + iva,
            observaciones: `Generada automáticamente desde ${prNumero}`,
            created_by: profile?.id,
          } as any)
          .select()
          .single();

        if (ocErr || !ocRow) {
          console.error("Error creating OC for proveedor:", provId, ocErr);
          continue;
        }

        // Create OC items (subtotal is GENERATED column — don't insert it)
        const ocItems = provItems.map((it: any, idx: number) => ({
          orden_id: ocRow.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          unidad: it.unidad,
          precio_unitario: Number(it.precio_costo),
          orden: idx + 1,
          cantidad_recibida: 0,
        }));
        await supabase.from("orden_compra_items").insert(ocItems);
        ocsCreated++;
      }

      if (ocsCreated > 0) {
        toast.success(`Se generaron ${ocsCreated} orden(es) de compra automáticamente`);
      }
    } catch (err) {
      console.error("Error generating OCs:", err);
      toast.warning("PR aprobado pero hubo un error al generar las OC");
    }
  }

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

      // When approved, auto-generate purchase orders grouped by supplier
      if (estado === "aprobado") {
        await generateOCsFromPresupuesto(id);
      }

      await fetchPresupuestos();
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, estado, motivoRechazo: motivo ?? prev.motivoRechazo } : null);
      }

      const statusLabels: Record<string, string> = {
        pendiente: "enviado al cliente",
        aprobado: "aprobado",
        rechazado: "rechazado",
        postergado: "postergado",
      };
      toast.success(`Presupuesto ${statusLabels[estado] ?? estado}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("Error updating estado:", msg);
      toast.error(`Error al cambiar estado: ${msg}`);
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
        toast.error("Error al duplicar presupuesto");
        return;
      }

      const { id: _id, numero: _num, created_at: _ca, updated_at: _ua, enviado_at: _ea, respondido_at: _ra, presupuesto_items, ...rest } = fullPR;

      const { data: newPRRow, error: insertError } = await supabase
        .from("presupuestos")
        .insert({ ...rest, estado: "borrador", version: 1 } as any)
        .select()
        .single();

      if (insertError || !newPRRow) {
        console.error("Error duplicating:", insertError);
        toast.error("Error al duplicar presupuesto");
        return;
      }

      if (presupuesto_items && presupuesto_items.length > 0) {
        const items = presupuesto_items.map(({ id: _iid, presupuesto_id: _pid, created_at: _ica, ...itemRest }: Record<string, unknown>) => ({
          ...itemRest,
          presupuesto_id: newPRRow.id,
        }));
        await supabase.from("presupuesto_items").insert(items as any);
      }

      toast.success("Presupuesto duplicado correctamente");
      await fetchPresupuestos();
    } catch (err) {
      console.error("Error duplicating PR:", err);
      toast.error("Error al duplicar presupuesto");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Seguro que queres eliminar este presupuesto?")) return;
    try {
      await supabase.from("presupuesto_items").delete().eq("presupuesto_id", id);
      await supabase.from("presupuestos").delete().eq("id", id);
      setSelected(null);
      toast.success("Presupuesto eliminado");
      await fetchPresupuestos();
    } catch (err) {
      console.error("Error deleting:", err);
      toast.error("Error al eliminar presupuesto");
    }
  }

  function handleRechazoConfirm() {
    if (rechazoModal && motivoRechazo.trim()) {
      handleEstadoChange(rechazoModal, "rechazado", motivoRechazo.trim());
      setRechazoModal(null);
      setMotivoRechazo("");
    }
  }

  function buildPRSummaryText(pr: Presupuesto) {
    const p = pr as any;
    const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
    const mon = pr.moneda;
    const lines = [
      `*PRESUPUESTO ${pr.numero}*`,
      "",
      `Fecha: ${formatDate(pr.fecha)}`,
      `Vencimiento: ${formatDate(pr.vencimiento)}`,
      `Estado: ${estadoLabel}`,
      `Moneda: ${mon}`,
      p.vendedorNombre ? `Vendedor: ${p.vendedorNombre}` : null,
      "",
      `*Cliente:* ${pr.clienteNombre}`,
      p.clienteCuit ? `CUIT: ${p.clienteCuit}` : null,
      p.clienteEmail ? `Email: ${p.clienteEmail}` : null,
      p.clienteTelefono ? `Tel: ${p.clienteTelefono}` : null,
      p.clienteDireccion ? `Dir: ${p.clienteDireccion}${p.clienteLocalidad ? `, ${p.clienteLocalidad}` : ""}${p.clienteProvincia ? `, ${p.clienteProvincia}` : ""}` : null,
      "",
      "*Items:*",
      ...pr.items.map((it, i) =>
        `${i + 1}. ${it.codigo} - ${it.descripcion}\n   ${it.cantidad} ${it.unidad} x ${formatCurrency(it.precioVenta, mon)} = ${formatCurrency(it.total, mon)}`
      ),
      "",
      `Subtotal: ${formatCurrency(pr.subtotal, mon)}`,
      `IVA: ${formatCurrency(pr.iva, mon)}`,
      `*Total: ${formatCurrency(pr.total, mon)}*`,
      pr.observaciones ? `\nObs: ${pr.observaciones}` : null,
    ];
    return lines.filter((l) => l !== null).join("\n");
  }

  const [copiedPR, setCopiedPR] = useState(false);
  function handleCopyPR(pr: Presupuesto) {
    navigator.clipboard.writeText(buildPRSummaryText(pr));
    setCopiedPR(true);
    setTimeout(() => setCopiedPR(false), 2000);
  }

  function handlePrint(pr: Presupuesto) {
    const p = pr as any;
    const mon = pr.moneda;
    const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;

    const itemRows = pr.items.map((it, i) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:12px">${i + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-family:'SF Mono','Consolas',monospace;font-size:11px">${it.codigo}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:12px">${it.descripcion}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:12px">${it.cantidad} ${it.unidad}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-family:'SF Mono','Consolas',monospace;font-size:11px">${formatCurrency(it.precioVenta, mon)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-family:'SF Mono','Consolas',monospace;font-size:11px;font-weight:600">${formatCurrency(it.total, mon)}</td>
      </tr>
    `).join("");

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${pr.numero} - Lazzari</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; padding: 0; color: #1a1a1a; font-size: 13px; line-height: 1.5; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px 48px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; margin-bottom: 24px; border-bottom: 3px solid #FF4500; }
  .brand { font-size: 20px; font-weight: 800; color: #FF4500; letter-spacing: -0.5px; }
  .brand-sub { font-size: 10px; color: #999; font-weight: 400; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 2px; }
  .doc-info { text-align: right; }
  .doc-type { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #888; font-weight: 600; }
  .doc-num { font-size: 20px; font-weight: 700; font-family: 'SF Mono', 'Consolas', monospace; margin: 4px 0; }
  .doc-estado { display: inline-block; padding: 2px 12px; border-radius: 12px; font-size: 10px; font-weight: 600; background: #f0f0f0; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  .doc-fecha { font-size: 11px; color: #888; margin-top: 6px; }
  .two-col { display: flex; gap: 32px; margin-bottom: 28px; }
  .col { flex: 1; }
  .section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1.5px; color: #FF4500; font-weight: 700; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
  .field { margin-bottom: 6px; }
  .field-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.3px; }
  .field-value { font-size: 13px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  thead th { background: #f8f8f8; padding: 10px 12px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: 600; border-bottom: 2px solid #eee; }
  tbody tr:last-child td { border-bottom: 2px solid #eee !important; }
  .totals-box { display: flex; justify-content: flex-end; margin-top: 12px; }
  .totals-inner { width: 280px; }
  .total-line { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; color: #666; }
  .total-line span:last-child { font-family: 'SF Mono', 'Consolas', monospace; font-size: 11px; color: #1a1a1a; }
  .total-final { display: flex; justify-content: space-between; padding: 10px 0; margin-top: 6px; border-top: 2px solid #1a1a1a; font-size: 16px; font-weight: 700; }
  .total-final span:last-child { font-family: 'SF Mono', 'Consolas', monospace; }
  .obs-box { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 14px 16px; margin-top: 20px; font-size: 12px; color: #555; }
  .obs-title { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #999; font-weight: 600; margin-bottom: 6px; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; display: flex; justify-content: space-between; font-size: 9px; color: #bbb; }
  @media print { .page { padding: 24px 32px; } }
</style></head><body>
<div class="page">

<div class="header">
  <div>
    <div class="brand">LAZZARI</div>
    <div class="brand-sub">Soluciones Industriales</div>
  </div>
  <div class="doc-info">
    <div class="doc-type">Presupuesto</div>
    <div class="doc-num">${pr.numero}</div>
    <div class="doc-estado">${estadoLabel}</div>
    <div class="doc-fecha">${formatDate(pr.fecha)} &bull; Vence: ${formatDate(pr.vencimiento)}</div>
  </div>
</div>

<div class="two-col">
  <div class="col">
    <div class="section-label">Cliente</div>
    <div class="field"><div class="field-value" style="font-size:15px;font-weight:700">${pr.clienteNombre}</div></div>
    ${p.clienteCuit ? `<div class="field"><div class="field-label">CUIT</div><div class="field-value">${p.clienteCuit}</div></div>` : ""}
    ${p.clienteCondicionIva ? `<div class="field"><div class="field-label">Cond. IVA</div><div class="field-value">${p.clienteCondicionIva}</div></div>` : ""}
  </div>
  <div class="col">
    <div class="section-label">Contacto</div>
    ${p.clienteEmail ? `<div class="field"><div class="field-label">Email</div><div class="field-value">${p.clienteEmail}</div></div>` : ""}
    ${p.clienteTelefono ? `<div class="field"><div class="field-label">Telefono</div><div class="field-value">${p.clienteTelefono}</div></div>` : ""}
    ${p.clienteDireccion ? `<div class="field"><div class="field-label">Direccion</div><div class="field-value">${p.clienteDireccion}${p.clienteLocalidad ? `, ${p.clienteLocalidad}` : ""}${p.clienteProvincia ? `, ${p.clienteProvincia}` : ""}</div></div>` : ""}
    ${p.vendedorNombre ? `<div class="field"><div class="field-label">Vendedor</div><div class="field-value">${p.vendedorNombre}</div></div>` : ""}
  </div>
</div>

<div class="section-label" style="margin-bottom:12px">Detalle</div>
<table>
  <thead><tr>
    <th style="text-align:center;width:36px">#</th>
    <th style="width:100px">Codigo</th>
    <th>Descripcion</th>
    <th style="text-align:right;width:80px">Cant.</th>
    <th style="text-align:right;width:110px">P. Venta</th>
    <th style="text-align:right;width:110px">Total</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="totals-box">
  <div class="totals-inner">
    <div class="total-line"><span>Subtotal</span><span>${formatCurrency(pr.subtotal, mon)}</span></div>
    <div class="total-line"><span>IVA</span><span>${formatCurrency(pr.iva, mon)}</span></div>
    <div class="total-final"><span>TOTAL (${mon})</span><span>${formatCurrency(pr.total, mon)}</span></div>
  </div>
</div>

${pr.observaciones ? `<div class="obs-box"><div class="obs-title">Observaciones</div>${pr.observaciones}</div>` : ""}

<div class="footer">
  <span>Lazzari Soluciones Industriales</span>
  <span>${pr.numero}${pr.creadoPor ? ` | ${pr.creadoPor}` : ""}</span>
  <span>${formatDate(new Date().toISOString())}</span>
</div>

</div></body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
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

  // Totals for the new PR form
  let newPRSub = 0;
  let newPRIva = 0;
  newPR.items.forEach((it) => {
    const t = calcItemTotals(it);
    newPRSub += t.subtotal;
    newPRIva += t.iva;
  });

  return (
    <>
      <Header
        title="Presupuestos"
        subtitle={`${presupuestos.length} presupuestos totales`}
        action={{ label: "Nuevo PR", onClick: () => setShowNewPR(true) }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        {/* Status tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todos", "borrador", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                filter === status
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
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
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por N de PR o cliente..."
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
                key: "numero", label: "N PR", sortable: true,
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
                    <button onClick={() => setSelected(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Ver">
                      <Eye className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDuplicate(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar">
                      <Copy className="h-4 w-4" />
                    </button>
                    {(row.estado === "borrador" || row.estado === "postergado") && (
                      <button onClick={() => handleEstadoChange(row.id, "pendiente")} className="rounded p-1.5 text-zinc-400 hover:bg-orange-100 hover:text-orange-600 dark:hover:bg-orange-950/40" title="Marcar como enviado">
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {row.estado === "rechazado" && (
                      <button onClick={() => handleEstadoChange(row.id, "borrador")} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Reabrir como borrador">
                        <Edit3 className="h-4 w-4" />
                      </button>
                    )}
                    {row.estado === "pendiente" && (
                      <>
                        <button onClick={() => handleEstadoChange(row.id, "aprobado")} className="rounded p-1.5 text-zinc-400 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-950/40" title="Aprobar">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setRechazoModal(row.id); setMotivoRechazo(""); }} className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/40" title="Rechazar">
                          <XCircle className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleEstadoChange(row.id, "postergado")} className="rounded p-1.5 text-zinc-400 hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-950/40" title="Postergar">
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

      {/* ==================== DETAIL SIDE PANEL ==================== */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 transition-opacity"
            onClick={() => setSelected(null)}
          />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right">
            {/* Panel header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 backdrop-blur-sm px-4 sm:px-6 py-4 dark:border-zinc-700 dark:bg-zinc-900/95">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white">PR {selected.numero}</h2>
                  {(() => {
                    const cfg = statusConfig[selected.estado];
                    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                  })()}
                </div>
                <p className="text-sm text-zinc-500 mt-0.5">{selected.clienteNombre}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleCopyPR(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                  title="Copiar resumen"
                >
                  {copiedPR ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {copiedPR ? "Copiado" : "Copiar"}
                </button>
                <button
                  onClick={() => handlePrint(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                  title="Descargar PDF"
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF
                </button>
                <button onClick={() => handleDuplicate(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar">
                  <Copy className="h-4 w-4" />
                </button>
                {selected.estado === "borrador" && (
                  <button onClick={() => handleDelete(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => setSelected(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
                  <p className="text-sm font-medium">{selected.moneda}{(selected as any).tipoCambio ? ` — TC: ${Number((selected as any).tipoCambio).toLocaleString("es-AR")}` : ""}</p>
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
                      <span>Atencion: {belowCostCount} item(s) con precio de venta menor al costo</span>
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
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 hidden sm:table-cell">P. Costo</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 hidden sm:table-cell">Markup</th>
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
                          <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{formatCurrency(item.precioCosto)}</td>
                          <td className="px-3 py-2 text-right hidden sm:table-cell">{item.markupPorcentaje}%</td>
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
                <div className="w-64 space-y-2 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="font-mono">{formatCurrency(selected.subtotal, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(selected.iva, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-zinc-200 pt-2 dark:border-zinc-700">
                    <span>Total</span>
                    <span className="font-mono text-orange-600 dark:text-orange-400">{formatCurrency(selected.total, selected.moneda)}</span>
                  </div>
                  {(selected as any).tipoCambio > 0 && (
                    <div className="text-xs text-zinc-400 text-right mt-1">TC aplicado: {Number((selected as any).tipoCambio).toLocaleString("es-AR")}</div>
                  )}
                </div>
              </div>

              {/* Notas internas (primero) */}
              {selected.notasInternas && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    Notas internas
                  </h3>
                  <p className="text-sm text-amber-700/80 dark:text-amber-400/80 whitespace-pre-wrap bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">{selected.notasInternas}</p>
                </div>
              )}
              {/* Observaciones (cliente) */}
              {selected.observaciones && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">Observaciones (cliente)</h3>
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
                    className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
                  >
                    <Send className="h-4 w-4" /> Marcar como enviado
                  </button>
                )}
                {selected.estado === "pendiente" && (
                  <>
                    <button
                      onClick={() => handleEstadoChange(selected.id, "aprobado")}
                      className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Aprobar
                    </button>
                    <button
                      onClick={() => { setRechazoModal(selected.id); setMotivoRechazo(""); }}
                      className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                    >
                      <XCircle className="h-4 w-4" /> Rechazar
                    </button>
                    <button
                      onClick={() => handleEstadoChange(selected.id, "postergado")}
                      className="flex items-center gap-2 rounded-lg border border-purple-300 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50 transition-colors dark:border-purple-700 dark:text-purple-400 dark:hover:bg-purple-950/30"
                    >
                      <PauseCircle className="h-4 w-4" /> Postergar
                    </button>
                  </>
                )}
                {selected.estado === "rechazado" && (
                  <button
                    onClick={() => { handleEstadoChange(selected.id, "borrador"); }}
                    className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <Edit3 className="h-4 w-4" /> Reabrir como borrador
                  </button>
                )}
                {selected.estado === "aprobado" && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Aprobado{selected.respondidoAt ? ` el ${formatDate(selected.respondidoAt)}` : ""}</span>
                    <ArrowRight className="h-4 w-4 ml-2" />
                    <span className="text-zinc-500">OC generadas — Listo para facturar</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== NUEVO PR MODAL ==================== */}
      <Modal
        open={showNewPR}
        onClose={() => setShowNewPR(false)}
        title="Nuevo Presupuesto"
        description="Completa los datos para crear un nuevo presupuesto"
        size="xl"
        footer={
          <>
            <button
              onClick={() => setShowNewPR(false)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreatePR}
              disabled={newPRSaving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {newPRSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Crear Presupuesto
            </button>
          </>
        }
      >
        {/* Creado por (auto) */}
        <div className="mb-5 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
          <span className="text-zinc-500">Creado por:</span>{" "}
          <span className="font-medium text-zinc-900 dark:text-white">{profile?.full_name ?? profile?.email ?? "---"}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="relative" ref={clientSearchRef}>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={clientSearch || (newPR.cliente_id ? clientes.find(c => c.id === newPR.cliente_id)?.razon_social || "" : "")}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientDropdownOpen(true);
                  if (!e.target.value) setNewPR((p) => ({ ...p, cliente_id: "" }));
                }}
                onFocus={() => setClientDropdownOpen(true)}
                placeholder="Buscar cliente..."
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-orange-600 dark:focus:ring-orange-900/30"
              />
              {newPR.cliente_id && (
                <button
                  onClick={() => { setNewPR((p) => ({ ...p, cliente_id: "" })); setClientSearch(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {clientDropdownOpen && clientSearch && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {filteredClientes.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                ) : (
                  filteredClientes.slice(0, 20).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setNewPR((p) => ({ ...p, cliente_id: c.id }));
                        setClientSearch(c.razon_social);
                        setClientDropdownOpen(false);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" : "text-zinc-700 dark:text-zinc-300"}`}
                    >
                      {c.razon_social}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <Select
            label="Vendedor *"
            value={newPR.vendedor_id}
            onChange={(e) => setNewPR((p) => ({ ...p, vendedor_id: e.target.value }))}
            placeholder="Seleccionar vendedor..."
            options={vendedores.map((v) => ({ value: v.id, label: v.full_name }))}
          />
          <Select
            label="Moneda presupuesto"
            value={newPR.moneda}
            onChange={(e) => setNewPR((p) => {
              const mon = e.target.value as "USD" | "ARS";
              const items = p.items.map(it => {
                const costoConv = convertCosto(it.precio_costo, it.costo_moneda, mon, p.tipo_cambio);
                return { ...it, precio_venta: Number((costoConv * (1 + it.markup_porcentaje / 100)).toFixed(2)) };
              });
              return { ...p, moneda: mon, items };
            })}
            options={[{ value: "ARS", label: "ARS — Pesos" }, { value: "USD", label: "USD — Dolares" }]}
          />
          <Input
            label="Tipo de cambio"
            type="number"
            step="0.01"
            value={newPR.tipo_cambio || ""}
            onChange={(e) => setNewPR((p) => {
              const tc = Number(e.target.value);
              const items = p.items.map(it => {
                const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, tc);
                return { ...it, precio_venta: Number((costoConv * (1 + it.markup_porcentaje / 100)).toFixed(2)) };
              });
              return { ...p, tipo_cambio: tc, items };
            })}
            placeholder="Solo si costo esta en otra moneda"
          />
          <Input
            label="Markup general %"
            type="number"
            value={newPR.markup_general}
            onChange={(e) => setNewPR((p) => {
              const mg = Number(e.target.value);
              const items = p.items.map(it => {
                const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, p.tipo_cambio);
                return { ...it, markup_porcentaje: mg, precio_venta: Number((costoConv * (1 + mg / 100)).toFixed(2)) };
              });
              return { ...p, markup_general: mg, items };
            })}
          />
        </div>

        {/* Items */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Items</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAIPanel(!showAIPanel)}
                className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400 dark:hover:bg-orange-950/50 transition-colors"
              >
                <Sparkles className="h-3 w-3" /> IA: armar desde mensaje
              </button>
              <button
                onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
                className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <Plus className="h-3 w-3" /> Agregar item
              </button>
            </div>
          </div>

          {/* AI Panel */}
          {showAIPanel && (
            <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50/50 p-4 dark:border-orange-800 dark:bg-orange-950/20">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-semibold text-orange-800 dark:text-orange-300">Pega el mensaje del cliente</span>
              </div>
              <p className="text-xs text-orange-600 dark:text-orange-400 mb-3">
                La IA va a buscar los productos en las listas de precios y armar los items del presupuesto automaticamente.
              </p>
              <textarea
                value={aiMessage}
                onChange={(e) => setAiMessage(e.target.value)}
                rows={4}
                placeholder="Ej: Necesito 3 válvulas esféricas de 2 pulgadas, 10 metros de caño SCH40 de 4 y un manómetro de glicerina..."
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm dark:border-orange-800 dark:bg-zinc-900 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200 resize-none"
              />
              <div className="flex items-center justify-between mt-3">
                <button onClick={() => { setShowAIPanel(false); setAiMessage(""); }} className="text-xs text-zinc-500 hover:text-zinc-700">
                  Cancelar
                </button>
                <button
                  onClick={handleAIGenerate}
                  disabled={aiLoading || !aiMessage.trim()}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiLoading ? "Buscando productos..." : "Generar items"}
                </button>
              </div>
            </div>
          )}

          {/* AI Notes */}
          {aiNotes && (
            <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-400">
              <span className="font-semibold">Notas de la IA:</span> {aiNotes}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                  <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500 w-20">Codigo</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500">Descripcion</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500 w-28">Proveedor</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-16">Cant.</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-36">P. Costo</th>
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
                        <div className="flex items-center gap-1">
                          <input value={item.codigo} onChange={(e) => updateNewPRItem(idx, "codigo", e.target.value)}
                            placeholder="Codigo"
                            className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                          <button type="button" onClick={() => openProductSearch(idx)} title="Buscar producto"
                            className="shrink-0 rounded border border-zinc-200 p-1 text-zinc-400 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-300 dark:border-zinc-700 dark:hover:bg-orange-950/30 dark:hover:text-orange-400 transition-colors">
                            <Search className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={item.descripcion} onChange={(e) => updateNewPRItem(idx, "descripcion", e.target.value)}
                          placeholder="Descripcion del item..."
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate block max-w-[120px]" title={item.proveedor_nombre}>
                          {item.proveedor_nombre || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.cantidad} onChange={(e) => updateNewPRItem(idx, "cantidad", Number(e.target.value))}
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => updateNewPRItem(idx, "costo_moneda" as any, item.costo_moneda === "USD" ? "ARS" : "USD")}
                            className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-bold border transition-colors ${
                              item.costo_moneda === "USD"
                                ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                : "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                            }`}
                            title="Click para cambiar moneda del costo"
                          >
                            {item.costo_moneda === "USD" ? "US$" : "AR$"}
                          </button>
                          <input type="number" value={item.precio_costo || ""} onChange={(e) => updateNewPRItem(idx, "precio_costo", Number(e.target.value))}
                            className="w-full min-w-0 rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={item.markup_porcentaje || ""} onChange={(e) => updateNewPRItem(idx, "markup_porcentaje", Number(e.target.value))}
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <input type="number" value={item.precio_venta || ""} onChange={(e) => updateNewPRItem(idx, "precio_venta", Number(e.target.value))}
                            className={`w-full rounded border px-1.5 py-1 text-xs text-right dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-100 ${belowCost ? "border-red-300 dark:border-red-700 focus:border-red-400" : "border-zinc-200 dark:border-zinc-700 focus:border-orange-400"}`} />
                          {belowCost && <AlertTriangle className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-red-500" />}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={item.iva_porcentaje} onChange={(e) => updateNewPRItem(idx, "iva_porcentaje", Number(e.target.value))}
                          className="w-full rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100">
                          <option value={21}>21</option>
                          <option value={10.5}>10.5</option>
                          <option value={27}>27</option>
                          <option value={0}>0</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        {newPR.items.length > 1 && (
                          <button onClick={() => setNewPR((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 transition-colors">
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
          <div className="flex justify-end mt-3">
            <div className="w-56 space-y-1 text-sm rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              <div className="flex justify-between"><span className="text-zinc-500">Subtotal</span><span className="font-mono">{formatCurrency(newPRSub, newPR.moneda)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(newPRIva, newPR.moneda)}</span></div>
              <div className="flex justify-between font-bold border-t border-zinc-200 pt-1 dark:border-zinc-700"><span>Total</span><span className="font-mono text-orange-600 dark:text-orange-400">{formatCurrency(newPRSub + newPRIva, newPR.moneda)}</span></div>
              {newPR.tipo_cambio > 0 && (
                <div className="text-xs text-zinc-400 text-right pt-1">TC aplicado: {newPR.tipo_cambio.toLocaleString("es-AR")}</div>
              )}
            </div>
          </div>
        </div>

        {/* Notas internas (NO se envian al cliente) — van primero */}
        <Textarea
          label="Notas internas (solo uso interno)"
          value={newPR.notas_internas}
          onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
          rows={2}
          placeholder="Margen esperado, contexto de la negociacion, datos internos..."
        />

        {/* Observaciones (van al cliente en PDF/WhatsApp) */}
        <Textarea
          label="Observaciones (visibles para el cliente)"
          value={newPR.observaciones}
          onChange={(e) => setNewPR((p) => ({ ...p, observaciones: e.target.value }))}
          rows={2}
          placeholder="Condiciones de pago, plazo de entrega, aclaraciones..."
        />
      </Modal>

      {/* ==================== RECHAZO MODAL ==================== */}
      <Modal
        open={!!rechazoModal}
        onClose={() => setRechazoModal(null)}
        title="Motivo de rechazo"
        description="Ingresa el motivo por el cual se rechaza este presupuesto"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setRechazoModal(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleRechazoConfirm}
              disabled={!motivoRechazo.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Confirmar rechazo
            </button>
          </>
        }
      >
        <Textarea
          value={motivoRechazo}
          onChange={(e) => setMotivoRechazo(e.target.value)}
          placeholder="Ingresa el motivo del rechazo..."
          rows={4}
          autoFocus
        />
      </Modal>

      {/* ==================== PRODUCT SEARCH MODAL ==================== */}
      {productSearchOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setProductSearchOpen(false)} />
          <div className="fixed inset-4 z-[60] m-auto h-fit max-h-[70vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
              <Search className="h-5 w-5 text-zinc-400" />
              <input
                ref={productSearchInputRef}
                value={productSearchQuery}
                onChange={(e) => handleProductSearchInput(e.target.value)}
                placeholder="Buscar por codigo o descripcion..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-white"
              />
              {productSearchLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              <button onClick={() => setProductSearchOpen(false)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto max-h-[50vh]">
              {productSearchResults.length > 0 ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {productSearchResults.map((s) => (
                    <button key={s.id} type="button" onClick={() => handleProductSelect(s)}
                      className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-orange-50 dark:hover:bg-zinc-800/60 transition-colors">
                      <div className="shrink-0 mt-0.5 rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                        <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400">{s.codigo}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{s.descripcion}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                            {s.proveedor_nombre}
                          </span>
                          {s.categoria && (
                            <span className="text-[10px] text-zinc-400">{s.categoria}</span>
                          )}
                          <span className="text-[10px] text-zinc-400">{s.unidad}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{formatCurrency(s.precio_neto, s.moneda as "USD" | "ARS")}</p>
                        <p className="text-[10px] text-zinc-400">{s.lista_nombre}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : productSearchQuery.length >= 2 && !productSearchLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">No se encontraron productos</p>
                  <p className="text-xs mt-1">Proba con otro codigo o descripcion</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">Escribi al menos 2 caracteres para buscar</p>
                  <p className="text-xs mt-1">Busca por codigo de proveedor o descripcion del producto</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
