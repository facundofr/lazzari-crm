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
  Printer, Sparkles, Download, ClipboardCopy, Check, Mail, GripVertical,
  Phone, CalendarClock, Inbox, Paperclip, Upload, Truck,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { useUser } from "@/lib/auth-context";
import { PendientesWidget } from "@/components/presupuestos/pendientes-widget";

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
  oc_cliente?: string | null;
  archivo_url?: string | null;
  archivo_nombre?: string | null;
  sucursal_id?: string | null;
  contacto_id?: string | null;
  clientes?: { razon_social: string; cuit: string; email?: string | null; telefono?: string | null; direccion?: string | null; localidad?: string | null; provincia?: string | null; condicion_iva?: string | null } | null;
  created_by_profile?: { full_name: string } | null;
  vendedor_profile?: { full_name: string; avatar_url: string | null } | null;
  sucursal?: { nombre: string } | null;
  contacto?: { nombre: string } | null;
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
    creadoPorId: row.created_by ?? "",
    enviadoAt: row.enviado_at ?? undefined,
    respondidoAt: row.respondido_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vendedorNombre: row.vendedor_profile?.full_name ?? "",
    vendedorAvatar: row.vendedor_profile?.avatar_url ?? null,
    vendedorId: row.vendedor_id ?? null,
    sucursalNombre: row.sucursal?.nombre ?? "",
    contactoNombre: row.contacto?.nombre ?? "",
    ocCliente: row.oc_cliente ?? "",
    clienteCuit: row.clientes?.cuit ?? "",
    clienteEmail: row.clientes?.email ?? "",
    clienteTelefono: row.clientes?.telefono ?? "",
    clienteDireccion: row.clientes?.direccion ?? "",
    clienteLocalidad: row.clientes?.localidad ?? "",
    clienteProvincia: row.clientes?.provincia ?? "",
    clienteCondicionIva: row.clientes?.condicion_iva ?? "",
    archivoUrl: row.archivo_url ?? null,
    archivoNombre: row.archivo_nombre ?? null,
  } as any;
}

const statusConfig: Record<PRStatus, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info"; icon: typeof Clock }> = {
  solicitud: { label: "Solicitud", variant: "info", icon: Inbox },
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
  const { profile, sociedadActiva } = useUser();
  const { toast } = useToast();
  const allEstados: (PRStatus | "facturado")[] = ["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido", "facturado"];
  const [selectedEstados, setSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const [vistaSeguimiento, setVistaSeguimiento] = useState(false);
  const [search, setSearch] = useState("");
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  // IDs de presupuestos que tienen factura/remito asociado
  const [facturadoIds, setFacturadoIds] = useState<Set<string>>(new Set());
  const [remitidoIds, setRemitidoIds] = useState<Set<string>>(new Set());

  // Detail panel
  const [selected, setSelected] = useState<Presupuesto | null>(null);

  // Vendedor & operador filter
  const [vendedorFilter, setVendedorFilter] = useState<string>("");
  const [operadorFilter, setOperadorFilter] = useState<string>("");
  const [vendedores, setVendedores] = useState<{id: string; full_name: string}[]>([]);

  // Email modal
  const [emailModal, setEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  async function openEmailModal(pr: Presupuesto) {
    const clientEmail = (pr as any).clienteEmail || "";
    // Try to get email template
    let subject = `Presupuesto N° ${pr.numero} - ${sociedadActiva?.razonSocial || "Lazzari"}`;
    let body = `Estimado/a,\n\nAdjuntamos el presupuesto N° ${pr.numero} para su consideración.\n\nQuedamos a disposición ante cualquier consulta.\nSaludos,\n${sociedadActiva?.razonSocial || "Lazzari"}`;
    try {
      const { data } = await (supabase as any).from("email_templates").select("asunto, cuerpo").eq("tipo", "presupuesto").eq("sociedad_id", sociedadActiva?.id).single();
      if (data) {
        subject = data.asunto.replace(/\{\{numero\}\}/g, pr.numero).replace(/\{\{sociedad\}\}/g, sociedadActiva?.razonSocial || "").replace(/\{\{cliente\}\}/g, pr.clienteNombre);
        body = data.cuerpo.replace(/\{\{numero\}\}/g, pr.numero).replace(/\{\{sociedad\}\}/g, sociedadActiva?.razonSocial || "").replace(/\{\{cliente\}\}/g, pr.clienteNombre);
      }
    } catch {}
    setEmailTo(clientEmail);
    setEmailSubject(subject);
    setEmailBody(body);
    setEmailModal(true);
  }

  async function handleSendEmail() {
    if (!emailTo || !selected) return;
    setEmailSending(true);
    try {
      // Use mailto as fallback (real sending requires backend integration)
      const mailtoUrl = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
      window.open(mailtoUrl, "_blank");
      toast.success("Se abrió el cliente de email");
      setEmailModal(false);
    } catch {
      toast.error("Error al preparar el email");
    } finally {
      setEmailSending(false);
    }
  }

  // Rechazo modal
  const [rechazoModal, setRechazoModal] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");

  // Costos faltantes modal (al aprobar)
  const [costosFaltantesModal, setCostosFaltantesModal] = useState<{ id: string; count: number; motivo?: string } | null>(null);
  // Track PRs aprobados con costos faltantes (set of PR ids)
  const [prsSinCostos, setPrsSinCostos] = useState<Set<string>>(new Set());

  // Nuevo PR modal
  const [showNewPR, setShowNewPR] = useState(false);
  const [newPRSaving, setNewPRSaving] = useState(false);
  const [postCreatePR, setPostCreatePR] = useState<Presupuesto | null>(null); // PR recién creado
  const [esSolicitud, setEsSolicitud] = useState(false); // Crear como solicitud
  const [editingPRId, setEditingPRId] = useState<string | null>(null); // null = crear, string = editar

  // Warning PRs previos
  const [prWarningModal, setPrWarningModal] = useState<{ matches: { numero: string; estado: string; fecha: string; codigos: string[] }[] } | null>(null);
  const prWarningBypassRef = useRef(false);

  // AI presupuesto
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNotes, setAiNotes] = useState("");
  // Drag-to-reorder items
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function reorderItems(fromIdx: number, toIdx: number) {
    setNewPR(prev => {
      const items = [...prev.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      return { ...prev, items };
    });
  }

  const [clientes, setClientes] = useState<{id: string; razon_social: string}[]>([]);
  const [newPR, setNewPR] = useState({
    cliente_id: "",
    vendedor_id: "",
    sucursal_id: "",
    contacto_id: "",
    moneda: "USD" as "USD" | "ARS",
    tipo_cambio: 0,
    markup_general: 30,
    observaciones: "",
    notas_internas: "",
    items: [{ ...emptyItem, markup_porcentaje: 30 }] as NewPRItem[],
  });

  // Sucursales y contactos del cliente seleccionado
  const [clienteSucursales, setClienteSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteContactos, setClienteContactos] = useState<{ id: string; nombre: string; cargo: string; sucursal_id: string | null }[]>([]);

  // Fetch sucursales + contactos cuando cambia el cliente
  useEffect(() => {
    if (!newPR.cliente_id) {
      setClienteSucursales([]);
      setClienteContactos([]);
      return;
    }
    (async () => {
      const [sucRes, conRes] = await Promise.all([
        (supabase as any).from("cliente_sucursales").select("id, nombre").eq("cliente_id", newPR.cliente_id).eq("activo", true).order("principal", { ascending: false }),
        (supabase as any).from("contactos").select("id, nombre, cargo, sucursal_id").eq("entity_type", "cliente").eq("entity_id", newPR.cliente_id).order("principal", { ascending: false }),
      ]);
      setClienteSucursales((sucRes.data || []) as { id: string; nombre: string }[]);
      setClienteContactos((conRes.data || []) as { id: string; nombre: string; cargo: string; sucursal_id: string | null }[]);
    })();
  }, [newPR.cliente_id]);

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
      let q = (supabase as any)
        .from("presupuestos")
        .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre), contacto:contacto_id(nombre), presupuesto_items(*)`)
        .order("created_at", { ascending: false });
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      let res: { data: any; error: any } = await q;

      // If that fails, try without items
      if (res.error) {
        let q2 = supabase
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_id`)
          .order("created_at", { ascending: false });
        if (sociedadActiva?.id) q2 = q2.eq("sociedad_id" as any, sociedadActiva.id);
        res = await q2;
      }

      // If still fails, try minimal
      if (res.error) {
        let q3 = supabase
          .from("presupuestos")
          .select(`*, vendedor_id`)
          .order("created_at", { ascending: false });
        if (sociedadActiva?.id) q3 = q3.eq("sociedad_id" as any, sociedadActiva.id);
        res = await q3;
      }

      const { data, error } = res;
      if (!error && data) {
        setPresupuestos((data as unknown as SupabasePresupuesto[]).map(mapToPresupuesto));
      } else if (error) {
        setPresupuestos(mockPresupuestos);
      }
    } catch {
      setPresupuestos(mockPresupuestos);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => {
    fetchPresupuestos();
  }, [fetchPresupuestos]);

  // Check approved PRs for missing costs
  useEffect(() => {
    async function checkAprobadosSinCostos() {
      const aprobados = presupuestos.filter(p => p.estado === "aprobado");
      if (aprobados.length === 0) return;
      try {
        const ids = aprobados.map(p => p.id);
        const { data: items } = await supabase
          .from("presupuesto_items")
          .select("presupuesto_id, precio_costo")
          .in("presupuesto_id", ids);
        if (!items) return;
        const sinCostoSet = new Set<string>();
        for (const it of items as any[]) {
          if (!it.precio_costo || Number(it.precio_costo) === 0) {
            sinCostoSet.add(it.presupuesto_id);
          }
        }
        setPrsSinCostos(sinCostoSet);
      } catch { /* ignore */ }
    }
    checkAprobadosSinCostos();
  }, [presupuestos]);

  // Fetch IDs de presupuestos facturados y remitidos
  useEffect(() => {
    async function fetchFacturadoIds() {
      try {
        const { data } = await supabase
          .from("facturas")
          .select("presupuesto_id")
          .not("presupuesto_id", "is", null);
        if (data) {
          setFacturadoIds(new Set(data.map((f: any) => f.presupuesto_id).filter(Boolean)));
        }
      } catch {
        // ignore
      }
    }
    async function fetchRemitidoIds() {
      try {
        const { data } = await supabase
          .from("remitos")
          .select("presupuesto_id")
          .not("presupuesto_id", "is", null);
        if (data) {
          setRemitidoIds(new Set(data.map((r: any) => r.presupuesto_id).filter(Boolean)));
        }
      } catch {
        // ignore
      }
    }
    fetchFacturadoIds();
    fetchRemitidoIds();
  }, [presupuestos]);

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
        let q = supabase
          .from("clientes")
          .select("id, razon_social")
          .eq("activo", true)
          .order("razon_social");
        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await q;
        if (data) setClientes(data);
      } catch { /* ignore */ }
    }
    fetchClientes();
  }, [showNewPR, sociedadActiva]);

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
    if (!newPR.cliente_id) {
      toast.warning("Selecciona un cliente");
      return;
    }
    if (!esSolicitud && !newPR.vendedor_id) {
      toast.warning("Selecciona un vendedor");
      return;
    }
    const validItems = newPR.items.filter((it) => it.descripcion.trim() && it.cantidad > 0);
    if (!esSolicitud && validItems.length === 0) {
      toast.warning("Agrega al menos un item");
      return;
    }

    // Check for previous PRs with same client + articles (skip if already bypassed)
    if (!prWarningBypassRef.current && validItems.length > 0) {
      try {
        const codigos = validItems.map((it) => it.codigo).filter(Boolean);
        if (codigos.length > 0) {
          // Find PRs for same client in last 12 months
          const twelveMonthsAgo = new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
          const { data: prevPRs } = await supabase
            .from("presupuestos")
            .select("id, numero, estado, fecha, presupuesto_items(codigo)")
            .eq("cliente_id", newPR.cliente_id)
            .gte("fecha", twelveMonthsAgo)
            .order("fecha", { ascending: false })
            .limit(50) as any;

          if (prevPRs && prevPRs.length > 0) {
            const matches: { numero: string; estado: string; fecha: string; codigos: string[] }[] = [];
            for (const pr of prevPRs) {
              // Skip self when editing
              if (editingPRId && pr.id === editingPRId) continue;
              const prCodigos = (pr.presupuesto_items || []).map((i: any) => i.codigo).filter(Boolean);
              const overlap = codigos.filter((c: string) => prCodigos.includes(c));
              if (overlap.length > 0) {
                matches.push({ numero: pr.numero, estado: pr.estado, fecha: pr.fecha, codigos: overlap });
              }
            }
            if (matches.length > 0) {
              setPrWarningModal({ matches });
              return; // Don't proceed — user must confirm
            }
          }
        }
      } catch { /* ignore check errors, proceed normally */ }
    }
    prWarningBypassRef.current = false; // Reset for next time

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

      const buildItemRows = (prId: string) => itemsWithTotals.map((it) => ({
        presupuesto_id: prId,
        codigo: it.codigo,
        descripcion: it.descripcion,
        categoria: it.categoria,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precio_costo: it.precio_costo,
        markup_porcentaje: it.markup_porcentaje,
        precio_venta: it.precio_venta,
        iva_porcentaje: it.iva_porcentaje,
        subtotal: it.subtotal,
        iva: it.iva,
        total: it.total,
        orden: it.orden,
        proveedor_id: it.proveedor_id || null,
        lista_item_id: it.lista_item_id || null,
        proveedor_nombre: it.proveedor_nombre || null,
      }));

      if (editingPRId) {
        // ── UPDATE existing PR ──
        const { error } = await supabase
          .from("presupuestos")
          .update({
            cliente_id: newPR.cliente_id,
            vendedor_id: newPR.vendedor_id,
            sucursal_id: newPR.sucursal_id || null,
            contacto_id: newPR.contacto_id || null,
            markup_general: newPR.markup_general,
            subtotal,
            iva: ivaTotal,
            total: subtotal + ivaTotal,
            moneda: newPR.moneda,
            tipo_cambio: newPR.moneda === "USD" && newPR.tipo_cambio > 0 ? newPR.tipo_cambio : null,
            observaciones: newPR.observaciones,
            notas_internas: newPR.notas_internas,
          } as any)
          .eq("id", editingPRId);
        if (error) throw new Error(error.message);

        // Replace items: delete old, insert new
        await supabase.from("presupuesto_items").delete().eq("presupuesto_id", editingPRId);
        if (itemsWithTotals.length > 0) {
          const { error: itemsError } = await supabase.from("presupuesto_items").insert(buildItemRows(editingPRId) as any);
          if (itemsError) console.error("Error inserting items:", itemsError);
        }

        setShowNewPR(false);
        setEsSolicitud(false);
        setEditingPRId(null);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, markup_general: 30, observaciones: "", notas_internas: "", items: [{ ...emptyItem, markup_porcentaje: 30 }] });
        await fetchPresupuestos();
        toast.success("Presupuesto actualizado");
      } else {
        // ── CREATE new PR ──
        const today = new Date().toISOString().split("T")[0];
        const vencimiento = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

        const { data: newRow, error } = await supabase
          .from("presupuestos")
          .insert({
            cliente_id: newPR.cliente_id,
            vendedor_id: newPR.vendedor_id || null,
            sucursal_id: newPR.sucursal_id || null,
            contacto_id: newPR.contacto_id || null,
            created_by: profile?.id,
            sociedad_id: sociedadActiva?.id || null,
            fecha: today,
            vencimiento,
            estado: esSolicitud ? "solicitud" : "pendiente",
            enviado_at: esSolicitud ? null : new Date().toISOString(),
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
          const { error: itemsError } = await supabase.from("presupuesto_items").insert(buildItemRows(newRow.id) as any);
          if (itemsError) console.error("Error inserting items:", itemsError);
        }

        setShowNewPR(false);
        setEsSolicitud(false);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, markup_general: 30, observaciones: "", notas_internas: "", items: [{ ...emptyItem, markup_porcentaje: 30 }] });

        // Fetch the newly created PR with full joins before refreshing the list
        const { data: fullRow } = await (supabase as any)
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre), contacto:contacto_id(nombre), presupuesto_items(*)`)
          .eq("id", newRow.id)
          .single();
        const createdPR = fullRow ? mapToPresupuesto(fullRow as any) : mapToPresupuesto(newRow as any);

        // Solo mostrar popup post-creacion para presupuestos, no para solicitudes
        if (!esSolicitud) {
          setPostCreatePR(createdPR);
        } else {
          toast.success(`Solicitud ${createdPR.numero} creada`);
        }

        await fetchPresupuestos();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(`Error al ${editingPRId ? "actualizar" : "crear"} presupuesto: ${msg}`);
    } finally {
      setNewPRSaving(false);
    }
  }

  // Helper: toggle estado in multi-select
  function toggleEstado(estado: string) {
    setSelectedEstados(prev => {
      const next = new Set(prev);
      if (estado === "todos") {
        // Si se clickea "Todos", seleccionar/deseleccionar todo
        if (next.has("todos")) {
          // Ya está "todos" activo — deseleccionar todo (dejar vacío = mostrar nada, mejor no permitir)
          return new Set(["todos"]);
        }
        return new Set(["todos"]);
      }
      // Quitar "todos" si estaba
      next.delete("todos");
      if (next.has(estado)) {
        next.delete(estado);
      } else {
        next.add(estado);
      }
      // Si no queda nada seleccionado, volver a "todos"
      if (next.size === 0) return new Set(["todos"]);
      // Si se seleccionaron todos los estados individuales, equivale a "todos"
      if (next.size === allEstados.length) return new Set(["todos"]);
      return next;
    });
    if (vistaSeguimiento) setVistaSeguimiento(false);
  }

  const isAllSelected = selectedEstados.has("todos");

  const filtered = presupuestos.filter((pr) => {
    // Estado filter (multi-select)
    if (!isAllSelected) {
      const prEsFacturado = facturadoIds.has(pr.id);
      const matchesEstado = selectedEstados.has(pr.estado);
      const matchesFacturado = selectedEstados.has("facturado") && prEsFacturado;
      if (!matchesEstado && !matchesFacturado) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const matchNumero = pr.numero.toLowerCase().includes(s);
      const matchCliente = pr.clienteNombre.toLowerCase().includes(s);
      const matchItems = pr.items?.some(it => (it.descripcion || "").toLowerCase().includes(s) || (it.codigo || "").toLowerCase().includes(s));
      if (!matchNumero && !matchCliente && !matchItems) return false;
    }
    if (vendedorFilter && (pr as any).vendedorId !== vendedorFilter) return false;
    if (operadorFilter && (pr as any).creadoPorId !== operadorFilter) return false;
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

  const counts: Record<string, number> = { todos: presupuestos.length, facturado: 0 };
  presupuestos.forEach((pr) => {
    counts[pr.estado] = (counts[pr.estado] || 0) + 1;
    if (facturadoIds.has(pr.id)) counts.facturado = (counts.facturado || 0) + 1;
  });

  async function generateOCsFromPresupuesto(prId: string) {
    try {
      // Fetch presupuesto items with proveedor info
      const { data: items, error: itemsErr } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", prId);
      if (itemsErr || !items || items.length === 0) return;

      // Get presupuesto header for moneda, numero, and sociedad_id
      const { data: prHeader } = await (supabase as any)
        .from("presupuestos")
        .select("moneda, numero, sociedad_id")
        .eq("id", prId)
        .single();
      const moneda = prHeader?.moneda ?? "USD";
      const prNumero = prHeader?.numero ?? "";
      const sociedadId = prHeader?.sociedad_id ?? sociedadActiva?.id ?? null;

      // Check if OCs already exist for this PR (avoid duplicates on re-approval)
      const { data: existingOCs } = await supabase
        .from("ordenes_compra")
        .select("id")
        .eq("presupuesto_origen_id", prId)
        .not("estado", "eq", "cancelada");
      if (existingOCs && existingOCs.length > 0) {
        toast.info("Este PR ya tiene OC generadas. No se crearon duplicados.");
        return;
      }

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
            sociedad_id: sociedadId,
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
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems);
        if (itemsErr) {
          console.error("Error inserting OC items:", itemsErr);
          toast.warning(`OC creada pero falló la carga de items: ${itemsErr.message}`);
        }
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
    // If approving, check for items with precio_costo === 0
    if (estado === "aprobado") {
      try {
        const { data: items } = await supabase
          .from("presupuesto_items")
          .select("id, precio_costo")
          .eq("presupuesto_id", id);
        const sinCosto = (items || []).filter((it: any) => !it.precio_costo || Number(it.precio_costo) === 0);
        if (sinCosto.length > 0) {
          // Show confirmation dialog instead of proceeding directly
          setCostosFaltantesModal({ id, count: sinCosto.length, motivo });
          return;
        }
      } catch {
        // If we can't check items, proceed anyway
      }
    }

    await doEstadoChange(id, estado, motivo);
  }

  async function doEstadoChange(id: string, estado: PRStatus, motivo?: string) {
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
        // Track if this PR has items without costs
        try {
          const { data: items } = await supabase
            .from("presupuesto_items")
            .select("id, precio_costo")
            .eq("presupuesto_id", id);
          const sinCosto = (items || []).filter((it: any) => !it.precio_costo || Number(it.precio_costo) === 0);
          if (sinCosto.length > 0) {
            setPrsSinCostos(prev => new Set(prev).add(id));
          }
        } catch { /* ignore */ }

        await generateOCsFromPresupuesto(id);
      }

      await fetchPresupuestos();
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, estado, motivoRechazo: motivo ?? prev.motivoRechazo } : null);
      }

      const statusLabels: Record<string, string> = {
        solicitud: "marcado como solicitud",
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
        .insert({ ...rest, estado: "pendiente", version: 1 } as any)
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

  async function handleEditPR(pr: Presupuesto) {
    try {
      // Fetch full PR with items
      const { data: fullPR, error } = await (supabase as any)
        .from("presupuestos")
        .select(`*, presupuesto_items(*)`)
        .eq("id", pr.id)
        .single();
      if (error || !fullPR) { toast.error("Error al cargar presupuesto"); return; }

      const items: NewPRItem[] = (fullPR.presupuesto_items || [])
        .sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
        .map((it: any) => ({
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          categoria: it.categoria || "",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "UN",
          precio_costo: Number(it.precio_costo) || 0,
          markup_porcentaje: Number(it.markup_porcentaje) || 0,
          precio_venta: Number(it.precio_venta) || 0,
          iva_porcentaje: Number(it.iva_porcentaje) || 21,
          proveedor_nombre: it.proveedor_nombre || "",
          proveedor_id: it.proveedor_id || "",
          lista_item_id: it.lista_item_id || "",
          costo_moneda: (it.costo_moneda || "USD") as "ARS" | "USD",
        }));

      setNewPR({
        cliente_id: fullPR.cliente_id || "",
        vendedor_id: fullPR.vendedor_id || "",
        sucursal_id: fullPR.sucursal_id || "",
        contacto_id: fullPR.contacto_id || "",
        moneda: fullPR.moneda || "USD",
        tipo_cambio: Number(fullPR.tipo_cambio) || 0,
        markup_general: Number(fullPR.markup_general) || 30,
        observaciones: fullPR.observaciones || "",
        notas_internas: fullPR.notas_internas || "",
        items: items.length > 0 ? items : [{ ...emptyItem, markup_porcentaje: Number(fullPR.markup_general) || 30 }],
      });

      setEsSolicitud(fullPR.estado === "solicitud");
      setEditingPRId(pr.id);
      setClientSearch("");
      setSelected(null);
      setShowNewPR(true);
    } catch (err) {
      console.error("Error loading PR for edit:", err);
      toast.error("Error al cargar presupuesto para editar");
    }
  }

  async function handleRemitar(pr: Presupuesto) {
    if (!confirm(`¿Generar remito desde ${pr.numero}?`)) return;
    try {
      // Fetch items
      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("descripcion, cantidad, unidad")
        .eq("presupuesto_id", pr.id)
        .order("orden");

      if (!items || items.length === 0) {
        toast.warning("El presupuesto no tiene items para remitar");
        return;
      }

      // Get next remito number
      const { data: lastRemito } = await supabase
        .from("remitos")
        .select("numero")
        .order("created_at", { ascending: false })
        .limit(1);
      let nextNum = 1;
      if (lastRemito && lastRemito.length > 0) {
        const parts = lastRemito[0].numero?.split("-");
        const n = parts?.length === 3 ? parseInt(parts[2]) : 0;
        if (n > 0) nextNum = n + 1;
      }
      const numero = `R-0001-${String(nextNum).padStart(8, "0")}`;

      const { data: remitoData, error: remitoErr } = await (supabase as any)
        .from("remitos")
        .insert({
          numero,
          cliente_id: pr.clienteId,
          fecha: new Date().toISOString().split("T")[0],
          observaciones: `Generado desde presupuesto ${pr.numero}`,
          presupuesto_id: pr.id,
          estado: "pendiente",
          sociedad_id: sociedadActiva?.id || null,
          created_by: profile?.id || null,
        })
        .select("id")
        .single();

      if (remitoErr || !remitoData) {
        toast.error("Error al crear remito");
        return;
      }

      const remitoItems = items.map((it: any, idx: number) => ({
        remito_id: remitoData.id,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad || "UN",
        orden: idx,
      }));
      await (supabase as any).from("remito_items").insert(remitoItems);

      toast.success(`Remito ${numero} creado exitosamente`);
    } catch (err) {
      console.error("Error creating remito:", err);
      toast.error("Error al crear remito");
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
        {/* Status multi-select toggles + seguimiento */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2 flex-wrap flex-1">
            {/* Botón "Todos" */}
            <button
              onClick={() => toggleEstado("todos")}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                isAllSelected && !vistaSeguimiento
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {isAllSelected && <Check className="h-3.5 w-3.5" />}
              Todos
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                isAllSelected && !vistaSeguimiento ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
              }`}>
                {counts.todos || 0}
              </span>
            </button>
            {/* Botones por estado */}
            {(["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as PRStatus[]).map((status) => {
              const active = !isAllSelected && selectedEstados.has(status);
              const activeColor = status === "solicitud" ? "bg-blue-600 text-white shadow-sm" : "bg-orange-500 text-white shadow-sm";
              return (
                <button
                  key={status}
                  onClick={() => toggleEstado(status)}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    active && !vistaSeguimiento
                      ? activeColor
                      : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" />}
                  {status === "solicitud" && <Inbox className="h-3.5 w-3.5" />}
                  {statusConfig[status].label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                    active && !vistaSeguimiento ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}>
                    {counts[status] || 0}
                  </span>
                </button>
              );
            })}
            {/* Botón Facturados */}
            {(() => {
              const active = !isAllSelected && selectedEstados.has("facturado");
              return (
                <button
                  onClick={() => toggleEstado("facturado")}
                  className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    active && !vistaSeguimiento
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" />}
                  <FileText className="h-3.5 w-3.5" />
                  Facturados
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                    active && !vistaSeguimiento ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}>
                    {counts.facturado || 0}
                  </span>
                </button>
              );
            })()}
          </div>
          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 shrink-0" />
          <button
            onClick={() => setVistaSeguimiento(!vistaSeguimiento)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              vistaSeguimiento
                ? "bg-orange-500 text-white shadow-sm"
                : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            <CalendarClock className="h-4 w-4" />
            Seguimiento
          </button>
          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700 shrink-0" />
          <PendientesWidget
            presupuestoOptions={presupuestos.map((p) => ({ id: p.id, numero: p.numero }))}
          />
        </div>

        {/* Search + Vendedor + Operador + Fecha filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por N° PR, cliente o items..."
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
          <select
            value={operadorFilter}
            onChange={(e) => setOperadorFilter(e.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los operadores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
        </div>

        {/* Smart filters */}
        <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

        {/* ==================== VISTA SEGUIMIENTO ==================== */}
        {vistaSeguimiento ? (() => {
          const today = new Date();
          const trackingPRs = presupuestos
            .filter((pr) => pr.estado === "solicitud" || pr.estado === "pendiente" || pr.estado === "postergado" || pr.estado === "vencido")
            .map((pr) => {
              const fechaRef = pr.enviadoAt || pr.fecha;
              const refDate = new Date(fechaRef);
              const diffMs = today.getTime() - refDate.getTime();
              const diasSinRespuesta = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              const vencDate = new Date(pr.vencimiento);
              const vencido = vencDate < today;
              let urgencia: "verde" | "amarillo" | "naranja" | "rojo";
              if (vencido || diasSinRespuesta > 21) urgencia = "rojo";
              else if (diasSinRespuesta > 14) urgencia = "naranja";
              else if (diasSinRespuesta > 7) urgencia = "amarillo";
              else urgencia = "verde";
              return { ...pr, diasSinRespuesta, vencido, urgencia, fechaRef };
            })
            .sort((a, b) => {
              const urgOrder = { rojo: 0, naranja: 1, amarillo: 2, verde: 3 };
              if (urgOrder[a.urgencia] !== urgOrder[b.urgencia]) return urgOrder[a.urgencia] - urgOrder[b.urgencia];
              return b.diasSinRespuesta - a.diasSinRespuesta;
            });

          const urgenciaColors = {
            verde: { border: "border-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500" },
            amarillo: { border: "border-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/20", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300", dot: "bg-yellow-500" },
            naranja: { border: "border-orange-400", bg: "bg-orange-50 dark:bg-orange-950/20", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", dot: "bg-orange-500" },
            rojo: { border: "border-red-400", bg: "bg-red-50 dark:bg-red-950/20", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-500" },
          };

          const urgenciaLabels = { verde: "< 7 dias", amarillo: "7-14 dias", naranja: "14-21 dias", rojo: "> 21 dias / vencido" };

          const countByUrgencia = { verde: 0, amarillo: 0, naranja: 0, rojo: 0 };
          trackingPRs.forEach((pr) => { countByUrgencia[pr.urgencia]++; });

          return (
            <div className="space-y-4">
              {/* Resumen de urgencia */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(["rojo", "naranja", "amarillo", "verde"] as const).map((urg) => (
                  <div key={urg} className={`rounded-lg border-l-4 ${urgenciaColors[urg].border} ${urgenciaColors[urg].bg} p-3`}>
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${urgenciaColors[urg].dot}`} />
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase">{urgenciaLabels[urg]}</span>
                    </div>
                    <p className="text-2xl font-bold mt-1 text-zinc-800 dark:text-zinc-100">{countByUrgencia[urg]}</p>
                  </div>
                ))}
              </div>

              {trackingPRs.length === 0 ? (
                <Card className="p-8 text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                  <p className="text-lg font-semibold text-zinc-700 dark:text-zinc-200">Sin presupuestos pendientes de seguimiento</p>
                  <p className="text-sm text-zinc-500 mt-1">Todos los presupuestos han sido respondidos</p>
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {trackingPRs.map((pr) => {
                    const colors = urgenciaColors[pr.urgencia];
                    const telefono = (pr as any).clienteTelefono;
                    return (
                      <Card
                        key={pr.id}
                        className={`border-l-4 ${colors.border} hover:shadow-md transition-shadow cursor-pointer`}
                        onClick={() => setSelected(pr)}
                      >
                        <div className="p-4 space-y-3">
                          {/* Header: numero + dias */}
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-bold text-zinc-800 dark:text-zinc-100">{pr.numero}</span>
                                {(() => {
                                  const cfg = statusConfig[pr.estado] || { label: pr.estado, variant: "outline" as const };
                                  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
                                })()}
                              </div>
                              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mt-1">{pr.clienteNombre}</p>
                            </div>
                            <div className={`flex flex-col items-center rounded-lg px-3 py-1.5 ${colors.badge}`}>
                              <span className="text-xl font-bold leading-none">{pr.diasSinRespuesta}</span>
                              <span className="text-[10px] font-medium uppercase mt-0.5">dias</span>
                            </div>
                          </div>

                          {/* Info */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-zinc-400">Enviado</span>
                              <p className="font-medium text-zinc-600 dark:text-zinc-300">{formatDate(pr.fechaRef)}</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Vence</span>
                              <p className={`font-medium ${pr.vencido ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}`}>
                                {formatDate(pr.vencimiento)}
                                {pr.vencido && <span className="ml-1 text-[10px] font-bold uppercase">Vencido</span>}
                              </p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Monto</span>
                              <p className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{formatCurrency(pr.total, pr.moneda)}</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Vendedor</span>
                              <p className="font-medium text-zinc-600 dark:text-zinc-300">{(pr as any).vendedorNombre || "—"}</p>
                            </div>
                          </div>

                          {/* Motivo postergacion */}
                          {pr.estado === "postergado" && pr.motivoRechazo && (
                            <div className="rounded-md bg-purple-50 dark:bg-purple-950/30 p-2 text-xs text-purple-700 dark:text-purple-300">
                              <span className="font-semibold">Motivo:</span> {pr.motivoRechazo}
                            </div>
                          )}

                          {/* Acciones rapidas */}
                          <div className="flex items-center gap-2 pt-1 border-t border-zinc-100 dark:border-zinc-800" onClick={(e) => e.stopPropagation()}>
                            <select
                              value=""
                              onChange={(e) => {
                                const newEstado = e.target.value as PRStatus;
                                if (!newEstado) return;
                                if (newEstado === "rechazado") {
                                  setRechazoModal(pr.id);
                                  setMotivoRechazo("");
                                } else {
                                  handleEstadoChange(pr.id, newEstado);
                                }
                              }}
                              className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            >
                              <option value="">Cambiar estado...</option>
                              {(["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as PRStatus[])
                                .filter((s) => s !== pr.estado)
                                .map((s) => {
                                  const cfg = statusConfig[s] || { label: s };
                                  return <option key={s} value={s}>{cfg.label}</option>;
                                })}
                            </select>
                            {telefono && (
                              <a
                                href={`tel:${telefono}`}
                                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40 transition-colors ml-auto"
                              >
                                <Phone className="h-3.5 w-3.5" />
                                Llamar
                              </a>
                            )}
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })() : (
          <>
        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<Presupuesto>
            columns={[
              {
                key: "fecha", label: "Fecha", sortable: true,
                render: (row) => {
                  const enviadoAt = row.enviadoAt;
                  const createdAt = row.createdAt;
                  const earliest = enviadoAt && createdAt
                    ? (new Date(enviadoAt) < new Date(createdAt) ? enviadoAt : createdAt)
                    : enviadoAt || createdAt;
                  return <span className="text-zinc-600 dark:text-zinc-300 text-xs whitespace-nowrap">{earliest ? formatDate(earliest) : "—"}</span>;
                },
              },
              {
                key: "numero", label: "N° PR", sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "items", label: "Resumen items", sortable: false,
                render: (row) => {
                  if (!row.items || row.items.length === 0) return <span className="text-zinc-400 text-xs">—</span>;
                  const descs = row.items.slice(0, 2).map(it => it.descripcion || it.codigo || "").filter(Boolean);
                  let text = descs.join(", ");
                  if (text.length > 50) text = text.slice(0, 47) + "...";
                  else if (row.items.length > 2) text += "...";
                  return <span className="text-xs text-zinc-600 dark:text-zinc-400" title={row.items.map(it => it.descripcion).join(", ")}>{text}</span>;
                },
              },
              {
                key: "total", label: "Monto", className: "text-right", sortable: true,
                render: (row) => (
                  <span className="font-mono text-xs font-semibold block text-right whitespace-nowrap">
                    {formatCurrency(row.total, row.moneda)}
                  </span>
                ),
              },
              {
                key: "clienteNombre", label: "Cliente", sortable: true,
                render: (row) => <span className="font-medium text-xs">{row.clienteNombre}</span>,
              },
              {
                key: "vendedorNombre" as any, label: "Vend / Op", sortable: true,
                render: (row) => {
                  const vend = (row as any).vendedorNombre;
                  const op = row.creadoPor;
                  const vendInitials = vend ? vend.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join("") : "";
                  const opInitials = op ? op.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join("") : "";
                  if (!vend && !op) return <span className="text-zinc-400 text-xs">—</span>;
                  if (vend === op || !op) {
                    return (
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-orange-100 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={vend}>
                        {vendInitials}
                      </span>
                    );
                  }
                  return (
                    <div className="flex items-center gap-1">
                      {vendInitials && <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-orange-100 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={`Vendedor: ${vend}`}>{vendInitials}</span>}
                      {opInitials && <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={`Operador: ${op}`}>{opInitials}</span>}
                    </div>
                  );
                },
              },
              {
                key: "enviadoAt" as any, label: "Fecha envio", sortable: true,
                render: (row) => {
                  return row.enviadoAt ? <span className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{formatDate(row.enviadoAt)}</span> : <span className="text-zinc-400 text-xs">—</span>;
                },
              },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = statusConfig[row.estado] || { label: row.estado, variant: "outline" as const, icon: Clock };
                  const Icon = cfg.icon;
                  const sinCostos = row.estado === "aprobado" && prsSinCostos.has(row.id);
                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      {sinCostos && (
                        <span title="Items sin costos cargados">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "tracking" as any, label: "Seguimiento", sortable: false,
                render: (row) => {
                  if (row.estado !== "aprobado") return <span className="text-zinc-300 text-xs">—</span>;
                  const entregado = remitidoIds.has(row.id);
                  const facturado = facturadoIds.has(row.id);
                  return (
                    <div className="flex items-center gap-1">
                      <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${entregado ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"}`} title={entregado ? "Tiene remito" : "Sin remito"}>
                        <Truck className="h-3 w-3" />{entregado ? "E" : "—"}
                      </span>
                      <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${facturado ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"}`} title={facturado ? "Tiene factura" : "Sin factura"}>
                        <FileText className="h-3 w-3" />{facturado ? "F" : "—"}
                      </span>
                    </div>
                  );
                },
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
                    <select
                      value=""
                      onChange={(e) => {
                        const newEstado = e.target.value as PRStatus;
                        if (!newEstado) return;
                        if (newEstado === "rechazado") {
                          setRechazoModal(row.id);
                          setMotivoRechazo("");
                        } else {
                          handleEstadoChange(row.id, newEstado);
                        }
                      }}
                      className="h-7 rounded border border-zinc-200 bg-white px-1 text-xs text-zinc-600 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      title="Cambiar estado"
                    >
                      <option value="">Cambiar...</option>
                      {(["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as PRStatus[])
                        .filter((s) => s !== row.estado)
                        .map((s) => {
                          const cfg = statusConfig[s] || { label: s };
                          return <option key={s} value={s}>{cfg.label}</option>;
                        })}
                    </select>
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
          </>
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
                    const cfg = statusConfig[selected.estado] || { label: selected.estado, variant: "outline" as const };
                    const sinCostos = selected.estado === "aprobado" && prsSinCostos.has(selected.id);
                    return (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        {sinCostos && (
                          <span title="Items sin costos cargados" className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-semibold">Sin costos</span>
                          </span>
                        )}
                      </div>
                    );
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
                <button
                  onClick={() => openEmailModal(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30 transition-colors"
                  title="Enviar por email"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Email
                </button>
                {["solicitud", "pendiente", "rechazado", "postergado", "aprobado"].includes(selected.estado) && (
                  <button
                    onClick={() => handleEditPR(selected)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                    title="Editar presupuesto"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Editar
                  </button>
                )}
                {selected.estado === "aprobado" && (
                  <button
                    onClick={() => handleRemitar(selected)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition-colors"
                    title="Generar remito"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    Remitar
                  </button>
                )}
                <button onClick={() => handleDuplicate(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar">
                  <Copy className="h-4 w-4" />
                </button>
                {["solicitud", "pendiente"].includes(selected.estado) && (
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
                  <select
                    value={(selected as any).vendedorId || ""}
                    onChange={async (e) => {
                      const newVendedorId = e.target.value || null;
                      const { error } = await supabase.from("presupuestos").update({ vendedor_id: newVendedorId } as any).eq("id", selected.id);
                      if (error) { toast.error("Error al cambiar vendedor"); return; }
                      const v = vendedores.find(v => v.id === newVendedorId);
                      setSelected({ ...selected, vendedorId: newVendedorId, vendedorNombre: v?.full_name || "" } as any);
                      await fetchPresupuestos();
                      toast.success("Vendedor actualizado");
                    }}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm font-medium dark:border-zinc-700 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Operador</p>
                  <select
                    value={(selected as any).creadoPorId || ""}
                    onChange={async (e) => {
                      const newOpId = e.target.value || null;
                      const { error } = await supabase.from("presupuestos").update({ created_by: newOpId } as any).eq("id", selected.id);
                      if (error) { toast.error("Error al cambiar operador"); return; }
                      const v = vendedores.find(v => v.id === newOpId);
                      setSelected({ ...selected, creadoPorId: newOpId || "", creadoPor: v?.full_name || "" } as any);
                      await fetchPresupuestos();
                      toast.success("Operador actualizado");
                    }}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-sm font-medium dark:border-zinc-700 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Moneda</p>
                  <p className="text-sm font-medium">{selected.moneda}{(selected as any).tipoCambio ? ` — TC: ${Number((selected as any).tipoCambio).toLocaleString("es-AR")}` : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Markup general</p>
                  <p className="text-sm font-medium">{selected.markupGeneral}%</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">OC del cliente</p>
                  {(selected as any).ocCliente ? (
                    <p className="text-sm font-medium font-mono text-blue-600 dark:text-blue-400">{(selected as any).ocCliente}</p>
                  ) : (
                    <button
                      onClick={async () => {
                        const oc = prompt("Número de OC del cliente:");
                        if (oc && oc.trim()) {
                          await supabase.from("presupuestos").update({ oc_cliente: oc.trim() } as any).eq("id", selected.id);
                          setSelected({ ...selected, ocCliente: oc.trim() } as any);
                          await fetchPresupuestos();
                          toast.success("OC del cliente guardada");
                        }
                      }}
                      className="text-sm text-orange-500 hover:text-orange-600 underline underline-offset-2"
                    >
                      + Adjuntar OC
                    </button>
                  )}
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
                        <th className="px-3 py-2 text-center text-xs font-semibold text-zinc-500" title="Entregado">E</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-zinc-500" title="Facturado">F</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {selected.items.map((item) => {
                        const belowCost = item.precioVenta < item.precioCosto;
                        const entregado = (item as any).entregado ?? false;
                        const facturado = (item as any).facturado ?? false;
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
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={entregado}
                              onChange={async (e) => {
                                const val = e.target.checked;
                                await supabase.from("presupuesto_items").update({ entregado: val } as any).eq("id", item.id);
                                setSelected({ ...selected, items: selected.items.map(it => it.id === item.id ? { ...it, entregado: val } as any : it) });
                              }}
                              className="h-4 w-4 accent-emerald-500 cursor-pointer"
                              title="Entregado"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={facturado}
                              onChange={async (e) => {
                                const val = e.target.checked;
                                await supabase.from("presupuesto_items").update({ facturado: val } as any).eq("id", item.id);
                                setSelected({ ...selected, items: selected.items.map(it => it.id === item.id ? { ...it, facturado: val } as any : it) });
                              }}
                              className="h-4 w-4 accent-blue-500 cursor-pointer"
                              title="Facturado"
                            />
                          </td>
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

              {/* Archivo adjunto */}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Archivo adjunto
                </h3>
                {(selected as any).archivoUrl ? (
                  <div className="flex items-center gap-2">
                    <a
                      href={(selected as any).archivoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <FileText className="h-4 w-4" />
                      {(selected as any).archivoNombre || "Descargar"}
                    </a>
                    <button
                      onClick={async () => {
                        const path = `pr/${selected.id}/${(selected as any).archivoNombre}`;
                        await supabase.storage.from("presupuestos").remove([path]);
                        await supabase.from("presupuestos").update({ archivo_url: null, archivo_nombre: null } as any).eq("id", selected.id);
                        setSelected({ ...selected, archivoUrl: null, archivoNombre: null } as any);
                        await fetchPresupuestos();
                        toast.success("Archivo eliminado");
                      }}
                      className="text-red-400 hover:text-red-600"
                      title="Eliminar archivo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-500 hover:text-orange-600 transition-colors">
                    <Upload className="h-4 w-4" />
                    <span>Subir archivo</span>
                    <input
                      type="file"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const path = `pr/${selected.id}/${file.name}`;
                        const { error: upErr } = await supabase.storage.from("presupuestos").upload(path, file, { upsert: true });
                        if (upErr) { toast.error("Error al subir archivo"); return; }
                        const { data: urlData } = supabase.storage.from("presupuestos").getPublicUrl(path);
                        await supabase.from("presupuestos").update({ archivo_url: urlData.publicUrl, archivo_nombre: file.name } as any).eq("id", selected.id);
                        setSelected({ ...selected, archivoUrl: urlData.publicUrl, archivoNombre: file.name } as any);
                        await fetchPresupuestos();
                        toast.success("Archivo adjuntado");
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>

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
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700 flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Cambiar estado:</label>
                <select
                  value=""
                  onChange={(e) => {
                    const newEstado = e.target.value as PRStatus;
                    if (!newEstado) return;
                    if (newEstado === "rechazado") {
                      setRechazoModal(selected.id);
                      setMotivoRechazo("");
                    } else {
                      handleEstadoChange(selected.id, newEstado);
                    }
                  }}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <option value="">Seleccionar...</option>
                  {(["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido"] as PRStatus[])
                    .filter((s) => s !== selected.estado)
                    .map((s) => {
                      const cfg = statusConfig[s] || { label: s };
                      return <option key={s} value={s}>{cfg.label}</option>;
                    })}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== NUEVO PR MODAL ==================== */}
      <Modal
        open={showNewPR}
        onClose={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, markup_general: 30, observaciones: "", notas_internas: "", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
        title={editingPRId ? "Editar Presupuesto" : esSolicitud ? "Nueva Solicitud" : "Nuevo Presupuesto"}
        description={editingPRId ? "Modifica los datos del presupuesto existente" : esSolicitud ? "Registra un pedido de cliente para convertirlo luego en presupuesto" : "Completa los datos para crear un nuevo presupuesto"}
        size="xl"
        footer={
          <>
            <button
              onClick={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, markup_general: 30, observaciones: "", notas_internas: "", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreatePR}
              disabled={newPRSaving}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors ${
                esSolicitud && !editingPRId ? "bg-blue-600 hover:bg-blue-700" : "bg-orange-500 hover:bg-orange-600"
              }`}
            >
              {newPRSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPRId ? <Check className="h-4 w-4" /> : esSolicitud ? <Inbox className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {editingPRId ? "Guardar cambios" : esSolicitud ? "Crear Solicitud" : "Crear Presupuesto"}
            </button>
          </>
        }
      >
        {/* Creado por (auto) */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800">
            <span className="text-zinc-500">{editingPRId ? "Editando:" : "Creado por:"}</span>{" "}
            <span className="font-medium text-zinc-900 dark:text-white">{editingPRId ? presupuestos.find(p => p.id === editingPRId)?.numero || "" : (profile?.full_name ?? profile?.email ?? "---")}</span>
          </div>
          {!editingPRId && <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setEsSolicitud(!esSolicitud)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                esSolicitud ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                  esSolicitud ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Inbox className={`h-4 w-4 ${esSolicitud ? "text-blue-600" : "text-zinc-400"}`} />
              <span className={`text-sm font-medium ${esSolicitud ? "text-blue-700 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                Crear como Solicitud
              </span>
            </div>
          </label>}
        </div>

        {/* ── MODO SOLICITUD: formulario simplificado ── */}
        {esSolicitud && !editingPRId ? (
          <div className="space-y-4">
            {/* Cliente */}
            <div className="relative" ref={clientSearchRef}>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={clientSearch || (newPR.cliente_id ? clientes.find(c => c.id === newPR.cliente_id)?.razon_social || "" : "")}
                  onChange={(e) => { setClientSearch(e.target.value); setClientDropdownOpen(true); if (!e.target.value) setNewPR((p) => ({ ...p, cliente_id: "" })); }}
                  onFocus={() => setClientDropdownOpen(true)}
                  placeholder="Buscar cliente..."
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
                {newPR.cliente_id && (
                  <button onClick={() => { setNewPR((p) => ({ ...p, cliente_id: "" })); setClientSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {clientDropdownOpen && clientSearch && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {filteredClientes.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                  ) : filteredClientes.slice(0, 20).map((c) => (
                    <button key={c.id} onClick={() => { setNewPR((p) => ({ ...p, cliente_id: c.id })); setClientSearch(c.razon_social); setClientDropdownOpen(false); }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                      {c.razon_social}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {clienteSucursales.length > 0 && (
                <Select label="Sucursal" value={newPR.sucursal_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, sucursal_id: e.target.value, contacto_id: "" }))}
                  placeholder="Sucursal (opcional)"
                  options={clienteSucursales.map((s) => ({ value: s.id, label: s.nombre }))}
                />
              )}
              {clienteContactos.length > 0 && (
                <Select label="Contacto solicitante" value={newPR.contacto_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, contacto_id: e.target.value }))}
                  placeholder="¿Quién solicitó? (opcional)"
                  options={(newPR.sucursal_id ? clienteContactos.filter((c) => !c.sucursal_id || c.sucursal_id === newPR.sucursal_id) : clienteContactos)
                    .map((c) => ({ value: c.id, label: c.cargo ? `${c.nombre} (${c.cargo})` : c.nombre }))}
                />
              )}
            </div>

            {/* Descripción de lo que necesita */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                ¿Qué necesita el cliente? <span className="text-zinc-400 font-normal">(opcional)</span>
              </label>
              <textarea
                value={newPR.observaciones}
                onChange={(e) => setNewPR((p) => ({ ...p, observaciones: e.target.value }))}
                rows={4}
                placeholder="Ej: Necesita válvulas para planta de gas, urgente para la semana que viene. Me va a mandar la lista por WhatsApp."
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Notas internas <span className="text-zinc-400 font-normal">(solo vos)</span>
              </label>
              <textarea
                value={newPR.notas_internas}
                onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
                rows={2}
                placeholder="Contexto interno, precio estimado, urgencia..."
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-none"
              />
            </div>
          </div>
        ) : (
        /* ── MODO PRESUPUESTO: formulario completo ── */
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
          {clienteSucursales.length > 0 && (
            <Select
              label="Sucursal"
              value={newPR.sucursal_id}
              onChange={(e) => setNewPR((p) => ({ ...p, sucursal_id: e.target.value, contacto_id: "" }))}
              placeholder="Seleccionar sucursal..."
              options={clienteSucursales.map((s) => ({ value: s.id, label: s.nombre }))}
            />
          )}
          {clienteContactos.length > 0 && (
            <Select
              label="Solicitante"
              value={newPR.contacto_id}
              onChange={(e) => setNewPR((p) => ({ ...p, contacto_id: e.target.value }))}
              placeholder="Seleccionar contacto..."
              options={
                (newPR.sucursal_id
                  ? clienteContactos.filter((c) => !c.sucursal_id || c.sucursal_id === newPR.sucursal_id)
                  : clienteContactos
                ).map((c) => ({ value: c.id, label: c.cargo ? `${c.nombre} (${c.cargo})` : c.nombre }))
              }
            />
          )}
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
        )}

        {/* Items — solo en modo presupuesto completo */}
        {(!esSolicitud || editingPRId) && <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Items</label>
              <button
                onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
                className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 shadow-sm transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Agregar item
              </button>
            </div>
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400 dark:hover:bg-orange-950/50 transition-colors"
            >
              <Sparkles className="h-3 w-3" /> IA: armar desde mensaje
            </button>
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
                  <th className="w-7"></th>
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
                    <tr
                      key={idx}
                      draggable
                      onDragStart={(e) => {
                        setDragIdx(idx);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverIdx(idx);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIdx !== null && dragIdx !== idx) {
                          reorderItems(dragIdx, idx);
                        }
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      className={`${belowCost ? "bg-red-50/60 dark:bg-red-950/20" : ""} ${dragIdx === idx ? "opacity-40" : ""} ${dragOverIdx === idx && dragIdx !== idx ? "border-t-2 border-blue-500" : ""}`}
                    >
                      <td className="px-1 py-1.5 cursor-grab active:cursor-grabbing">
                        <GripVertical className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
                      </td>
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
                          onKeyDown={(e) => {
                            // Prevent Enter on empty description of last item from triggering form actions
                            if (e.key === "Enter") {
                              e.preventDefault();
                              // Only move to next field if description is not empty
                              if (item.descripcion.trim()) {
                                const nextInput = (e.target as HTMLElement).closest("td")?.nextElementSibling?.querySelector("input, select") as HTMLElement;
                                nextInput?.focus();
                              }
                            }
                          }}
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
                          onKeyDown={(e) => {
                            // Auto-add new item when Tab on last field of last item
                            if (e.key === "Tab" && !e.shiftKey && idx === newPR.items.length - 1) {
                              e.preventDefault();
                              setNewPR((p) => {
                                const updated = { ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] };
                                // Focus the codigo input of the new row after render
                                setTimeout(() => {
                                  const table = (e.target as HTMLElement).closest("table");
                                  if (table) {
                                    const rows = table.querySelectorAll("tbody tr");
                                    const lastRow = rows[rows.length - 1];
                                    const firstInput = lastRow?.querySelector("input");
                                    firstInput?.focus();
                                  }
                                }, 50);
                                return updated;
                              });
                            }
                          }}
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
          {/* Bottom add item button */}
          <button
            onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50/50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-orange-600 dark:hover:text-orange-400 dark:hover:bg-orange-950/20 transition-colors"
          >
            <Plus className="h-3 w-3" /> Agregar item
          </button>
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
        </div>}

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

      {/* ==================== COSTOS FALTANTES MODAL ==================== */}
      <Modal
        open={!!costosFaltantesModal}
        onClose={() => setCostosFaltantesModal(null)}
        title="Items sin costos"
        description="Atención: hay items sin precio de costo cargado"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCostosFaltantesModal(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (costosFaltantesModal) {
                  doEstadoChange(costosFaltantesModal.id, "aprobado", costosFaltantesModal.motivo);
                  setCostosFaltantesModal(null);
                }
              }}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Aprobar de todos modos
            </button>
          </>
        }
      >
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4 dark:bg-amber-950/20 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Este presupuesto tiene <span className="font-bold">{costosFaltantesModal?.count} item(s)</span> sin costos cargados.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Puede continuar, pero deberá completar los costos luego.
            </p>
          </div>
        </div>
      </Modal>

      {/* ==================== PR PREVIOS WARNING MODAL ==================== */}
      <Modal
        open={!!prWarningModal}
        onClose={() => setPrWarningModal(null)}
        title="Artículos cotizados previamente"
        description="Se encontraron presupuestos anteriores para este cliente con artículos coincidentes"
        size="md"
        footer={
          <>
            <button
              onClick={() => setPrWarningModal(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setPrWarningModal(null);
                prWarningBypassRef.current = true;
                handleCreatePR();
              }}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Crear de todos modos
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 dark:bg-amber-950/20 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Estos artículos ya fueron cotizados para este cliente. Revisá el estado de los presupuestos anteriores antes de crear uno nuevo.
              </p>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {prWarningModal?.matches.map((m, i) => {
              const cfg = statusConfig[m.estado as PRStatus] || { label: m.estado, variant: "outline" as const };
              return (
                <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm font-medium dark:text-white">{m.numero}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      <span className="text-xs text-zinc-400">{formatDate(m.fecha)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Artículos: <span className="font-medium text-zinc-700 dark:text-zinc-300">{m.codigos.join(", ")}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
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

      {/* ==================== POST-CREATE MODAL ==================== */}
      {postCreatePR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold dark:text-white">Presupuesto creado</h3>
              <p className="text-sm text-zinc-500 mt-1">{postCreatePR.numero}</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const pr = postCreatePR;
                  const text = buildPRSummaryText(pr);
                  const email = pr.clienteNombre ? "" : "";
                  const subject = encodeURIComponent(`Presupuesto ${pr.numero}`);
                  const body = encodeURIComponent(text);
                  window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
                  setPostCreatePR(null);
                }}
                className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-700 transition-colors"
              >
                <Mail className="h-4 w-4" /> Enviar por correo
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildPRSummaryText(postCreatePR));
                  toast.success("Presupuesto copiado al portapapeles");
                  setPostCreatePR(null);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <ClipboardCopy className="h-4 w-4" /> Copiar resumen
              </button>
              <button
                onClick={() => {
                  setPostCreatePR(null);
                  setSelected(postCreatePR);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <Eye className="h-4 w-4" /> Ver presupuesto
              </button>
              <button
                onClick={() => setPostCreatePR(null)}
                className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mt-1"
              >
                Cerrar
              </button>
            </div>
          </Card>
        </div>
      )}

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

      {/* ==================== EMAIL MODAL ==================== */}
      {emailModal && (
        <>
          <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => setEmailModal(false)} />
          <div className="fixed inset-4 z-[70] m-auto h-fit max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-500" />
                <h3 className="font-semibold text-zinc-900 dark:text-white">Enviar por email</h3>
              </div>
              <button onClick={() => setEmailModal(false)} className="rounded p-1 text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Para</label>
                <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="email@cliente.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Asunto</label>
                <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Mensaje</label>
                <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={8} className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-none" />
              </div>
              <p className="text-xs text-zinc-400">El PDF se adjuntará desde tu cliente de email. Podés editar el template en Configuración.</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <button onClick={() => setEmailModal(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
              <button onClick={handleSendEmail} disabled={emailSending || !emailTo} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Enviar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
