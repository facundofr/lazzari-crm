"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { generatePresupuestoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import { mockPresupuestos } from "@/lib/mock-data";
import type { Presupuesto, PRStatus } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Send, Eye, Copy, FileText, CheckCircle2, XCircle, Clock,
  PauseCircle, Edit3, Loader2, X, Trash2, ArrowRight, AlertTriangle, Plus, Minus,
  Printer, Sparkles, Download, ClipboardCopy, Check, Mail, GripVertical,
  Phone, CalendarClock, Inbox, Paperclip, Upload, Truck, Receipt,
  Maximize2, ImagePlus,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { useUser } from "@/lib/auth-context";
import { PendientesWidget } from "@/components/presupuestos/pendientes-widget";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";

/** Number input that allows typing decimals (e.g. "10.") without losing the dot */
function NumInput({ value, onChange, className, ...props }: { value: number | string; onChange: (n: number) => void; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  const [raw, setRaw] = useState<string>(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setRaw(value === 0 ? "" : String(value ?? "")); }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; const n = Number(raw) || 0; setRaw(n === 0 ? "" : String(n)); onChange(n); }}
      onChange={(e) => {
        const v = e.target.value.replace(",", ".");
        if (v === "" || v === "." || /^\d*\.?\d*$/.test(v)) {
          setRaw(v);
          const n = Number(v);
          if (!isNaN(n) && v !== "" && !v.endsWith(".")) onChange(n);
        }
      }}
      className={className}
      {...props}
    />
  );
}

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
  cotizacion_modalidad?: "divisas" | "billetes" | null;
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
  tipo_comprobante?: string | null;
  modalidad_emision?: string | null;
  archivo_url?: string | null;
  archivo_nombre?: string | null;
  sucursal_id?: string | null;
  contacto_id?: string | null;
  clientes?: { razon_social: string; cuit: string; email?: string | null; telefono?: string | null; direccion?: string | null; localidad?: string | null; provincia?: string | null; condicion_iva?: string | null } | null;
  created_by_profile?: { full_name: string } | null;
  vendedor_profile?: { full_name: string; avatar_url: string | null } | null;
  sucursal?: { nombre: string; direccion?: string | null; localidad?: string | null; provincia?: string | null } | null;
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
    cotizacionModalidad: row.cotizacion_modalidad ?? "divisas",
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
    sucursalDireccion: [row.sucursal?.direccion, row.sucursal?.localidad, row.sucursal?.provincia].filter(Boolean).join(", "),
    contactoNombre: row.contacto?.nombre ?? "",
    ocCliente: row.oc_cliente ?? "",
    tipoComprobante: row.tipo_comprobante ?? "",
    modalidadEmision: row.modalidad_emision ?? "sin_definir",
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
  remitido: { label: "Remitido", variant: "info", icon: Truck },
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
  variante?: string;
  categoria: string;
  unidad: string;
  precio_neto: number;
  precio: number;
  proveedor_nombre: string;
  proveedor_id: string;
  lista_nombre: string;
  lista_id: string;
  moneda: string;
}

interface PriceTier {
  lista_item_id: string;
  variante: string;
  min: number;
  max: number;
  precio_neto: number;
  moneda: string;
}

/** Parsea variantes tipo "1-9 un", "10-49", "50+", "hasta 20" → rango */
function parseQuantityRange(variante?: string | null): { min: number; max: number } | null {
  if (!variante) return null;
  const s = variante.trim();
  const rangeMatch = s.match(/^(\d+)\s*[-–a]\s*(\d+)/);
  if (rangeMatch) return { min: parseInt(rangeMatch[1]), max: parseInt(rangeMatch[2]) };
  const plusMatch = s.match(/^(\d+)\s*\+/);
  if (plusMatch) return { min: parseInt(plusMatch[1]), max: Infinity };
  const hastaMatch = s.match(/hasta\s+(\d+)/i);
  if (hastaMatch) return { min: 1, max: parseInt(hastaMatch[1]) };
  return null;
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
  const canDeletePresupuestos = Boolean(profile);
  const allEstados: (PRStatus | "facturado")[] = ["solicitud", "pendiente", "aprobado", "rechazado", "postergado", "vencido", "facturado"];
  const [selectedEstados, setSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const [vistaSeguimiento, setVistaSeguimiento] = useState(false);
  const [search, setSearch] = useState("");
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  // IDs de presupuestos que tienen factura/remito asociado
  const [facturadoIds, setFacturadoIds] = useState<Set<string>>(new Set());
  const [remitidoIds, setRemitidoIds] = useState<Set<string>>(new Set());
  // "parcial" = tiene remito pero faltan cantidades, "total" = todo remitido
  const [remitidoStatus, setRemitidoStatus] = useState<Record<string, "parcial" | "total">>({});

  // Remitar modal state
  interface RemitarItem {
    presupuesto_item_id: string;
    descripcion: string;
    cantidad_total: number;
    cantidad_remitida: number;
    cantidad_pendiente: number;
    cantidad_a_remitar: number;
    unidad: string;
    orden: number;
  }
  const [remitarModal, setRemitarModal] = useState<{ pr: Presupuesto; items: RemitarItem[] } | null>(null);
  const [remitarLoading, setRemitarLoading] = useState(false);

  // Detail panel
  const [selected, setSelected] = useState<Presupuesto | null>(null);
  const [panelFullscreen, setPanelFullscreen] = useState(false);

  // Vendedor & operador filter
  const [vendedorFilter, setVendedorFilter] = useState<string>("");
  const [operadorFilter, setOperadorFilter] = useState<string>("");
  const [vendedores, setVendedores] = useState<{id: string; full_name: string}[]>([]);

  // Email modal
  const [emailModal, setEmailModal] = useState<{ open: boolean; id: string; to: string; subject: string; body: string; filename: string }>({ open: false, id: "", to: "", subject: "", body: "", filename: "" });

  async function openEmailModal(pr: Presupuesto) {
    const clientEmail = (pr as any).clienteEmail || "";
    const template = await loadEmailTemplate("presupuesto", sociedadActiva?.id || "");
    const vars = {
      numero: pr.numero,
      sociedad: sociedadActiva?.razonSocial || "Lazzari",
      total: formatCurrency(pr.total, pr.moneda),
      fecha: formatDate(pr.fecha),
      cliente: pr.clienteNombre || "",
    };
    setEmailModal({
      open: true,
      id: pr.id,
      to: clientEmail,
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: `${pr.numero}.pdf`,
    });
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
  const [aiImage, setAiImage] = useState<{ data: string; media_type: string; name: string } | null>(null);
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

  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);

  const [cotizFecha, setCotizFecha] = useState("");

  async function fetchCotizBna(modalidad: "divisas" | "billetes" = "divisas", fecha?: string) {
    setCotizBnaLoading(true);
    try {
      const params = new URLSearchParams({ modalidad });
      if (fecha) params.set("fecha", fecha);
      const res = await fetch(`/api/cotizacion-bna?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad });
        setNewPR((p) => ({ ...p, tipo_cambio: data.valor_venta, cotizacion_modalidad: modalidad }));
      }
    } catch { /* silencioso */ } finally {
      setCotizBnaLoading(false);
    }
  }

  function tipoDocPorCondicion(condicion?: string | null): { tipo_comprobante: string; modalidad_emision: "electronica" | "manual" | "sin_definir" } {
    switch (condicion) {
      case "RI": return { tipo_comprobante: "A", modalidad_emision: "electronica" };
      case "Monotributo": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      case "Exento": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      case "Consumidor Final": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      default: return { tipo_comprobante: "", modalidad_emision: "sin_definir" };
    }
  }

  const [clientes, setClientes] = useState<{id: string; razon_social: string; markup_predeterminado?: number | null; condicion_iva?: string | null}[]>([]);
  const [proveedoresOptions, setProveedoresOptions] = useState<{id: string; razon_social: string}[]>([]);
  const [newPR, setNewPR] = useState({
    cliente_id: "",
    vendedor_id: "",
    sucursal_id: "",
    contacto_id: "",
    moneda: "USD" as "USD" | "ARS",
    tipo_cambio: 0,
    cotizacion_modalidad: "divisas" as "divisas" | "billetes",
    markup_general: 30,
    observaciones: "",
    notas_internas: "",
    vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    tipo_comprobante: "" as string,
    modalidad_emision: "sin_definir" as "electronica" | "manual" | "sin_definir",
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
  // Precios escalonados por cantidad: índice de item → tiers disponibles
  const [priceTiersMap, setPriceTiersMap] = useState<Record<number, PriceTier[]>>({});

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
          id, codigo, descripcion, variante, categoria, unidad, precio, precio_neto, lista_id,
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
          variante: d.variante ?? undefined,
          categoria: d.categoria ?? "",
          unidad: d.unidad ?? "UN",
          precio_neto: d.precio_neto ?? d.precio ?? 0,
          precio: d.precio ?? 0,
          proveedor_nombre: d.listas_precios?.proveedores?.razon_social ?? "—",
          proveedor_id: d.listas_precios?.proveedor_id ?? "",
          lista_nombre: d.listas_precios?.nombre ?? "",
          lista_id: d.lista_id ?? "",
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

  async function handleProductSelect(suggestion: ProductSuggestion) {
    const idx = productSearchIdx;
    setNewPR((prev) => {
      const items = [...prev.items];
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

    // Buscar escalones de precio (misma lista, mismo código, distintas variantes con rangos)
    if (suggestion.lista_id && suggestion.codigo) {
      try {
        const { data: siblings } = await supabase
          .from("lista_precios_items")
          .select("id, variante, precio_neto, precio")
          .eq("lista_id" as any, suggestion.lista_id)
          .eq("codigo", suggestion.codigo);

        if (siblings && siblings.length > 1) {
          const tiers: PriceTier[] = (siblings as any[])
            .map((s) => {
              const range = parseQuantityRange(s.variante);
              if (!range) return null;
              return { lista_item_id: s.id, variante: s.variante || "", min: range.min, max: range.max, precio_neto: s.precio_neto ?? s.precio ?? 0, moneda: suggestion.moneda };
            })
            .filter(Boolean)
            .sort((a, b) => a!.min - b!.min) as PriceTier[];
          if (tiers.length > 1) {
            setPriceTiersMap((prev) => ({ ...prev, [idx]: tiers }));
          }
        }
      } catch { /* ignore */ }
    }
  }

  async function handleAIGenerate() {
    if (!aiMessage.trim() && !aiImage) return;
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
          imagen: aiImage ? { data: aiImage.data, media_type: aiImage.media_type } : undefined,
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
        setAiImage(null);
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
        .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre, direccion, localidad, provincia), contacto:contacto_id(nombre), presupuesto_items(*)`)
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

  // Auto-select PR from URL ?selected=UUID
  useEffect(() => {
    if (loading || presupuestos.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const selId = params.get("selected");
    if (selId && !selected) {
      const found = presupuestos.find(p => p.id === selId);
      if (found) setSelected(found);
      // Clean URL param
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loading, presupuestos.length]);

  // Fetch items separately when selected PR has no items (fallback query omitted them)
  useEffect(() => {
    if (!selected?.id || selected.items.length > 0) return;
    (async () => {
      const { data } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", selected.id)
        .order("orden", { ascending: true });
      if (data && data.length > 0) {
        setSelected(prev => prev ? {
          ...prev,
          items: data.map((it: any, idx: number) => ({
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
            ivaPorcentaje: it.iva_porcentaje ?? 21,
            iva: it.iva,
            total: it.total,
          }))
        } : null);
      }
    })();
  }, [selected?.id]);

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
        let fq = supabase
          .from("facturas")
          .select("presupuesto_id")
          .not("presupuesto_id", "is", null);
        if (sociedadActiva?.id) fq = fq.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await fq;
        if (data) {
          setFacturadoIds(new Set(data.map((f: any) => f.presupuesto_id).filter(Boolean)));
        }
      } catch {
        // ignore
      }
    }
    async function fetchRemitidoIds() {
      try {
        let rq = (supabase as any)
          .from("remitos")
          .select("id, presupuesto_id")
          .not("presupuesto_id", "is", null);
        if (sociedadActiva?.id) rq = rq.eq("sociedad_id", sociedadActiva.id);
        const { data: remitos } = await rq;
        if (!remitos || remitos.length === 0) {
          setRemitidoIds(new Set());
          setRemitidoStatus({});
          return;
        }
        const prIds = [...new Set(remitos.map((r: any) => r.presupuesto_id).filter(Boolean))] as string[];
        setRemitidoIds(new Set(prIds));

        // Calculate partial vs total for each PR
        const remitoIds = remitos.map((r: any) => r.id);
        const { data: rItems } = await (supabase as any).from("remito_items").select("remito_id, descripcion, cantidad, orden, presupuesto_item_id").in("remito_id", remitoIds);
        // Build map: presupuesto_id → remito_ids
        const prRemitoMap: Record<string, string[]> = {};
        for (const r of remitos as any[]) {
          if (!r.presupuesto_id) continue;
          if (!prRemitoMap[r.presupuesto_id]) prRemitoMap[r.presupuesto_id] = [];
          prRemitoMap[r.presupuesto_id].push(r.id);
        }
        // Fetch PR items for these PRs
        const { data: prItems } = await supabase.from("presupuesto_items").select("id, presupuesto_id, descripcion, cantidad, orden").in("presupuesto_id", prIds);
        if (!prItems || !rItems) {
          setRemitidoStatus({});
          return;
        }
        const statusMap: Record<string, "parcial" | "total"> = {};
        for (const prId of prIds) {
          const myPrItems = (prItems as any[]).filter(i => i.presupuesto_id === prId);
          const myRemitoIds = prRemitoMap[prId] || [];
          const myRItems = (rItems as any[]).filter(i => myRemitoIds.includes(i.remito_id));
          // Sum remitido by presupuesto_item_id (preferred) or descripcion+orden (fallback)
          const remitidoByPiId: Record<string, number> = {};
          const remitidoByKey: Record<string, number> = {};
          for (const ri of myRItems) {
            if (ri.presupuesto_item_id) {
              remitidoByPiId[ri.presupuesto_item_id] = (remitidoByPiId[ri.presupuesto_item_id] || 0) + Number(ri.cantidad);
            } else {
              const key = `${ri.descripcion}__${ri.orden}`;
              remitidoByKey[key] = (remitidoByKey[key] || 0) + Number(ri.cantidad);
            }
          }
          let allDone = true;
          for (const pi of myPrItems) {
            const remitido = remitidoByPiId[pi.id] || remitidoByKey[`${pi.descripcion}__${pi.orden}`] || 0;
            if (remitido < Number(pi.cantidad)) { allDone = false; break; }
          }
          statusMap[prId] = allDone ? "total" : "parcial";
        }
        setRemitidoStatus(statusMap);
      } catch {
        // ignore
      }
    }
    fetchFacturadoIds();
    fetchRemitidoIds();
  }, [presupuestos, sociedadActiva?.id]);

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
        let q = (supabase as any)
          .from("clientes")
          .select("id, razon_social, markup_predeterminado, condicion_iva")
          .eq("activo", true)
          .order("razon_social");
        if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
        const { data } = await q;
        if (data) setClientes(data as {id: string; razon_social: string; markup_predeterminado?: number | null; condicion_iva?: string | null}[]);
      } catch { /* ignore */ }
    }
    async function fetchProveedoresForPR() {
      try {
        let q = supabase.from("proveedores").select("id, razon_social").eq("activo", true).order("razon_social");
        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await q;
        if (data) setProveedoresOptions(data as unknown as {id: string; razon_social: string}[]);
      } catch { /* ignore */ }
    }
    fetchClientes();
    fetchProveedoresForPR();
  }, [showNewPR, sociedadActiva]);

  function updateNewPRItem(index: number, field: keyof NewPRItem | "costo_moneda", value: string | number) {
    setNewPR((prev) => {
      const items = [...prev.items];
      const item = { ...items[index], [field]: value };

      // Auto-switch precio por escalon cuando cambia la cantidad
      if (field === "cantidad") {
        const tiers = priceTiersMap[index];
        if (tiers && tiers.length > 0) {
          const qty = Number(value);
          const matchingTier = tiers.find((t) => qty >= t.min && qty <= t.max);
          if (matchingTier && matchingTier.precio_neto !== item.precio_costo) {
            item.precio_costo = matchingTier.precio_neto;
            item.lista_item_id = matchingTier.lista_item_id;
            const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio);
            item.precio_venta = Number((costoConv * (1 + item.markup_porcentaje / 100)).toFixed(2));
            // Notificar el cambio de escalon (via setTimeout para salir del setState)
            setTimeout(() => toast.success(`Precio actualizado: ${matchingTier.variante}`), 0);
          }
        }
      }

      // Auto-calc precio_venta when costo, markup, or costo_moneda change
      if (field === "precio_costo" || field === "markup_porcentaje" || field === "costo_moneda") {
        const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio);
        item.precio_venta = Number((costoConv * (1 + item.markup_porcentaje / 100)).toFixed(2));
      }

      // Auto-calc markup when precio_venta changes manually
      if (field === "precio_venta") {
        const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio);
        if (costoConv > 0) {
          item.markup_porcentaje = Number((((Number(value) / costoConv) - 1) * 100).toFixed(2));
        }
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
    if (!esSolicitud && newPR.modalidad_emision !== "manual" && !["A", "B"].includes(newPR.tipo_comprobante)) {
      toast.warning("Selecciona tipo de documento (A o B)");
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
        codigo: it.codigo ?? "",
        descripcion: it.descripcion,
        categoria: it.categoria ?? null,
        cantidad: it.cantidad,
        unidad: it.unidad ?? "u",
        precio_costo: it.precio_costo ?? 0,
        markup_porcentaje: it.markup_porcentaje ?? 0,
        iva_porcentaje: it.iva_porcentaje ?? 21,
        // precio_venta, subtotal, iva, total son columnas generadas por DB — no se insertan
        orden: it.orden,
        proveedor_id: it.proveedor_id || null,
        lista_item_id: it.lista_item_id || null,
        proveedor_nombre: it.proveedor_nombre || null,
        costo_moneda: it.costo_moneda || "ARS",
      }));

      if (editingPRId) {
        // ── UPDATE existing PR ──
        // Editing a solicitud is its conversion to a PR: keep the same row/number.
        const updatePayload: Record<string, unknown> = {
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
            cotizacion_modalidad: newPR.moneda === "USD" ? newPR.cotizacion_modalidad : null,
            observaciones: newPR.observaciones,
            notas_internas: newPR.notas_internas,
            vencimiento: newPR.vencimiento,
            tipo_comprobante: newPR.tipo_comprobante || null,
            modalidad_emision: newPR.modalidad_emision,
        };
        if (esSolicitud) {
          updatePayload.estado = "pendiente";
          updatePayload.enviado_at = new Date().toISOString();
        }
        const { error } = await supabase
          .from("presupuestos")
          .update(updatePayload as any)
          .eq("id", editingPRId);
        if (error) throw new Error(error.message);

        // Replace items: delete old, insert new
        const { error: delItemsErr } = await supabase.from("presupuesto_items").delete().eq("presupuesto_id", editingPRId);
        if (delItemsErr) throw new Error("Error al actualizar items: " + delItemsErr.message);
        if (itemsWithTotals.length > 0) {
          const { error: itemsError } = await supabase.from("presupuesto_items").insert(buildItemRows(editingPRId) as any);
          if (itemsError) throw new Error("Error al guardar items: " + itemsError.message);
        }

        setShowNewPR(false);
        setEsSolicitud(false);
        setEditingPRId(null);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] });
        await fetchPresupuestos();
        toast.success("Presupuesto actualizado");
      } else {
        // ── CREATE new PR ──
        const today = todayAR();

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
            vencimiento: newPR.vencimiento,
            estado: esSolicitud ? "solicitud" : "pendiente",
            enviado_at: esSolicitud ? null : new Date().toISOString(),
            markup_general: newPR.markup_general,
            subtotal,
            iva: ivaTotal,
            total: subtotal + ivaTotal,
            moneda: newPR.moneda,
            tipo_cambio: newPR.moneda === "USD" && newPR.tipo_cambio > 0 ? newPR.tipo_cambio : null,
            cotizacion_modalidad: newPR.moneda === "USD" ? newPR.cotizacion_modalidad : null,
            observaciones: newPR.observaciones,
            notas_internas: newPR.notas_internas,
            tipo_comprobante: newPR.tipo_comprobante || null,
            modalidad_emision: newPR.modalidad_emision,
          } as any)
          .select()
          .single();

        if (error) throw new Error(error.message);

        if (newRow && itemsWithTotals.length > 0) {
          const { error: itemsError } = await supabase.from("presupuesto_items").insert(buildItemRows(newRow.id) as any);
          if (itemsError) throw new Error("Error al guardar items: " + itemsError.message);
        }

        setShowNewPR(false);
        setEsSolicitud(false);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] });

        // Fetch the newly created PR with full joins before refreshing the list
        const { data: fullRow } = await (supabase as any)
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre, direccion, localidad, provincia), contacto:contacto_id(nombre), presupuesto_items(*)`)
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

      // Get presupuesto header for numero and sociedad_id
      const { data: prHeader } = await (supabase as any)
        .from("presupuestos")
        .select("numero, sociedad_id")
        .eq("id", prId)
        .single();
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

      // Group items by proveedor_id (items sin proveedor van a key "__sin_proveedor__")
      const byProveedor: Record<string, any[]> = {};
      for (const item of items) {
        const provId = (item as any).proveedor_id || "__sin_proveedor__";
        if (!byProveedor[provId]) byProveedor[provId] = [];
        byProveedor[provId].push(item);
      }

      // Separate items with and without proveedor
      const sinProveedorCount = (byProveedor["__sin_proveedor__"] || []).length;
      const conProveedorIds = Object.keys(byProveedor).filter(k => k !== "__sin_proveedor__");

      if (conProveedorIds.length === 0 && sinProveedorCount === 0) {
        toast.info("PR aprobado. No se generaron OC (sin items).");
        return;
      }

      let ocsCreated = 0;
      const today = todayAR();

      // Only generate OCs for items that HAVE a proveedor assigned
      for (const provId of conProveedorIds) {
        const provItems = byProveedor[provId];
        const subtotal = provItems.reduce((sum, it) => sum + Number(it.precio_costo) * Number(it.cantidad), 0);
        const iva = provItems.reduce((sum, it) => sum + Number(it.precio_costo) * Number(it.cantidad) * ((Number(it.iva_porcentaje ?? 21)) / 100), 0);

        // Determine OC moneda from items' costo_moneda (cost currency), NOT from PR sale moneda
        // If items have mixed cost currencies, default to ARS
        const costoMonedas = new Set(provItems.map((it: any) => it.costo_moneda || "ARS"));
        const ocMoneda = costoMonedas.size === 1 ? [...costoMonedas][0] : "ARS";

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: provId,
            presupuesto_origen_id: prId,
            sociedad_id: sociedadId,
            fecha: today,
            moneda: ocMoneda,
            estado: "borrador",
            subtotal,
            iva,
            total: subtotal + iva,
            observaciones: `Generada automáticamente desde ${prNumero}`,
            created_by: profile?.id ?? (await supabase.auth.getUser()).data.user?.id ?? null,
          } as any)
          .select()
          .single();

        if (ocErr || !ocRow) {
          console.error("Error creating OC for proveedor:", provId, JSON.stringify(ocErr));
          toast.error(`Error al crear OC: ${ocErr?.message ?? "sin datos de respuesta"}`);
          continue;
        }

        // Create OC items (subtotal is GENERATED ALWAYS — don't insert it)
        const ocItems = provItems.map((it: any, idx: number) => ({
          orden_id: ocRow.id,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "Sin descripción",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "u",
          precio_unitario: Number(it.precio_costo) || 0,
          iva_porcentaje: Number(it.iva_porcentaje ?? 21),
          orden: idx + 1,
          cantidad_recibida: 0,
        }));
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error inserting OC items:", JSON.stringify(itemsErr));
          toast.error(`OC ${ocRow.numero ?? ""} creada pero falló la carga de items: ${itemsErr.message}`);
        }
        ocsCreated++;
      }

      // Also generate OC for items WITHOUT proveedor (so user can assign later)
      const sinProvItems = byProveedor["__sin_proveedor__"] || [];
      if (sinProvItems.length > 0) {
        const subtotalSP = sinProvItems.reduce((sum: number, it: any) => sum + Number(it.precio_costo) * Number(it.cantidad), 0);
        const ivaSP = sinProvItems.reduce((sum: number, it: any) => sum + Number(it.precio_costo) * Number(it.cantidad) * ((Number(it.iva_porcentaje ?? 21)) / 100), 0);
        const costoMonedasSP = new Set(sinProvItems.map((it: any) => it.costo_moneda || "ARS"));
        const ocMonedaSP = costoMonedasSP.size === 1 ? [...costoMonedasSP][0] : "ARS";

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: null,
            presupuesto_origen_id: prId,
            sociedad_id: sociedadId,
            fecha: todayAR(),
            moneda: ocMonedaSP,
            estado: "borrador",
            subtotal: subtotalSP,
            iva: ivaSP,
            total: subtotalSP + ivaSP,
            observaciones: `Generada desde ${prNumero} — asignar proveedor`,
            created_by: profile?.id ?? (await supabase.auth.getUser()).data.user?.id ?? null,
          } as any)
          .select()
          .single();

        if (!ocErr && ocRow) {
          const ocItemsSP = sinProvItems.map((it: any, idx: number) => ({
            orden_id: ocRow.id,
            codigo: it.codigo || "",
            descripcion: it.descripcion || "Sin descripción",
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || "u",
            precio_unitario: Number(it.precio_costo) || 0,
            iva_porcentaje: Number(it.iva_porcentaje ?? 21),
            orden: idx + 1,
            cantidad_recibida: 0,
          }));
          await supabase.from("orden_compra_items").insert(ocItemsSP as any);
          ocsCreated++;
        }
      }

      if (ocsCreated > 0) {
        toast.success(`Se generaron ${ocsCreated} orden(es) de compra automáticamente`);
      }

      // Notify about items without proveedor that were skipped
      if (sinProveedorCount > 0 && sinProvItems.length > 0) {
        toast.info(`${sinProveedorCount} item(s) sin proveedor — OC creada en borrador para asignar proveedor`);
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
        pendiente: "marcado como pendiente",
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
        const items = presupuesto_items.map(({ id: _iid, presupuesto_id: _pid, created_at: _ica, precio_venta: _pv, subtotal: _st, iva: _iv, total: _tot, ...itemRest }: Record<string, unknown>) => ({
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
      const { data: deletedId, error } = await (supabase as any).rpc("delete_presupuesto_safe", {
        p_presupuesto_id: id,
      });
      if (error) throw new Error(error.message);
      if (deletedId !== id) throw new Error("Supabase no confirmó la eliminación del presupuesto");
      setSelected(null);
      setPanelFullscreen(false);
      setPresupuestos(prev => prev.filter(p => p.id !== id));
      toast.success("Presupuesto eliminado");
      await fetchPresupuestos();
    } catch (err: unknown) {
      console.error("Error deleting:", err);
      const message = err instanceof Error ? err.message : "Error inesperado";
      toast.error(`No se pudo eliminar: ${message}`);
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

      const prMoneda = fullPR.moneda || "USD";
      const prTc = Number(fullPR.tipo_cambio) || 0;
      const items: NewPRItem[] = (fullPR.presupuesto_items || [])
        .sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
        .map((it: any) => {
          const costo = Number(it.precio_costo) || 0;
          const pv = Number(it.precio_venta) || 0;
          let markup = Number(it.markup_porcentaje) || 0;
          // Back-calculate markup if DB has null/0 but precio_venta and precio_costo exist
          if (!markup && costo > 0 && pv > 0) {
            const costoConv = convertCosto(costo, it.costo_moneda || "USD", prMoneda, prTc);
            if (costoConv > 0) {
              markup = Number((((pv / costoConv) - 1) * 100).toFixed(2));
            }
          }
          return {
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          categoria: it.categoria || "",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "UN",
          precio_costo: costo,
          markup_porcentaje: markup,
          precio_venta: pv,
          iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
          proveedor_nombre: it.proveedor_nombre || "",
          proveedor_id: it.proveedor_id || "",
          lista_item_id: it.lista_item_id || "",
          costo_moneda: (it.costo_moneda || "USD") as "ARS" | "USD",
        };
        });

      setNewPR({
        cliente_id: fullPR.cliente_id || "",
        vendedor_id: fullPR.vendedor_id || "",
        sucursal_id: fullPR.sucursal_id || "",
        contacto_id: fullPR.contacto_id || "",
        moneda: fullPR.moneda || "USD",
        tipo_cambio: Number(fullPR.tipo_cambio) || 0,
        cotizacion_modalidad: (fullPR.cotizacion_modalidad || "divisas") as "divisas" | "billetes",
        markup_general: Number(fullPR.markup_general) || 30,
        observaciones: fullPR.observaciones || "",
        notas_internas: fullPR.notas_internas || "",
        vencimiento: fullPR.vencimiento || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
        tipo_comprobante: (fullPR as any).tipo_comprobante || "",
        modalidad_emision: (fullPR as any).modalidad_emision || "sin_definir",
        items: items.length > 0 ? items : [{ ...emptyItem, markup_porcentaje: Number(fullPR.markup_general) || 30 }],
      });

      setEsSolicitud(fullPR.estado === "solicitud");
      setEditingPRId(pr.id);
      setClientSearch("");
      setSelected(null);
      setPanelFullscreen(false);
      setShowNewPR(true);
    } catch (err) {
      console.error("Error loading PR for edit:", err);
      toast.error("Error al cargar presupuesto para editar");
    }
  }

  async function openRemitarModal(pr: Presupuesto) {
    try {
      // Fetch PR items
      const { data: prItems, error: itemsErr } = await supabase
        .from("presupuesto_items")
        .select("id, descripcion, cantidad, unidad, orden")
        .eq("presupuesto_id", pr.id)
        .order("orden");

      if (itemsErr || !prItems || prItems.length === 0) {
        toast.warning("El presupuesto no tiene items para remitar");
        return;
      }

      // Fetch existing remitos for this PR
      const { data: existingRemitos } = await (supabase as any)
        .from("remitos")
        .select("id")
        .eq("presupuesto_id", pr.id);

      // Build map: presupuesto_item_id → total already remitido
      let remitidoByPiId: Record<string, number> = {};
      let remitidoByKey: Record<string, number> = {};
      if (existingRemitos && existingRemitos.length > 0) {
        const rIds = existingRemitos.map((r: any) => r.id);
        const { data: rItems } = await (supabase as any)
          .from("remito_items")
          .select("descripcion, cantidad, orden, presupuesto_item_id")
          .in("remito_id", rIds);
        if (rItems) {
          for (const ri of rItems as any[]) {
            if (ri.presupuesto_item_id) {
              remitidoByPiId[ri.presupuesto_item_id] = (remitidoByPiId[ri.presupuesto_item_id] || 0) + Number(ri.cantidad);
            } else {
              const key = `${ri.descripcion}__${ri.orden}`;
              remitidoByKey[key] = (remitidoByKey[key] || 0) + Number(ri.cantidad);
            }
          }
        }
      }

      const modalItems: RemitarItem[] = (prItems as any[]).map((it, idx) => {
        // Prefer presupuesto_item_id match, fallback to descripcion+orden
        const yaRemitido = remitidoByPiId[it.id] || remitidoByKey[`${it.descripcion}__${it.orden ?? idx}`] || 0;
        const pendiente = Math.max(0, Number(it.cantidad) - yaRemitido);
        return {
          presupuesto_item_id: it.id,
          descripcion: it.descripcion,
          cantidad_total: Number(it.cantidad),
          cantidad_remitida: yaRemitido,
          cantidad_pendiente: pendiente,
          cantidad_a_remitar: pendiente,
          unidad: it.unidad || "UN",
          orden: it.orden ?? idx,
        };
      });

      const totalPendiente = modalItems.reduce((s, i) => s + i.cantidad_pendiente, 0);
      if (totalPendiente <= 0) {
        toast.info("Todas las cantidades de este presupuesto ya fueron remitidas");
        return;
      }

      setRemitarModal({ pr, items: modalItems });
    } catch (err) {
      console.error("Error opening remitar modal:", err);
      toast.error("Error al preparar remito");
    }
  }

  async function handleRemitarConfirm() {
    if (!remitarModal || !sociedadActiva) return;
    const { pr, items } = remitarModal;
    const itemsToRemit = items.filter(i => i.cantidad_a_remitar > 0);
    if (itemsToRemit.length === 0) {
      toast.warning("Ingresá al menos una cantidad para remitar");
      return;
    }
    // Validate no item exceeds pending
    for (const it of itemsToRemit) {
      if (it.cantidad_a_remitar > it.cantidad_pendiente) {
        toast.error(`"${it.descripcion}" excede la cantidad pendiente (${it.cantidad_pendiente})`);
        return;
      }
    }

    setRemitarLoading(true);
    try {
      // Fetch presupuesto total for valor_declarado
      const { data: prHeader } = await supabase
        .from("presupuestos")
        .select("total, subtotal")
        .eq("id", pr.id)
        .single();
      const valorDeclarado = (prHeader as any)?.total || (prHeader as any)?.subtotal || null;

      // Get next remito number — parse max numeric suffix across ALL formats
      const { data: allRemitos } = await supabase
        .from("remitos")
        .select("numero")
        .order("created_at", { ascending: false })
        .limit(100);
      let maxNum = 0;
      if (allRemitos) {
        for (const r of allRemitos) {
          const parts = r.numero?.split("-");
          if (parts) {
            const lastPart = parseInt(parts[parts.length - 1]);
            if (!isNaN(lastPart) && lastPart > maxNum) maxNum = lastPart;
          }
        }
      }
      const nextNum = maxNum + 1;
      const numero = `R-0001-${String(nextNum).padStart(8, "0")}`;

      const { data: remitoData, error: remitoErr } = await (supabase as any)
        .from("remitos")
        .insert({
          numero,
          cliente_id: pr.clienteId,
          fecha: todayAR(),
          observaciones: `Generado desde presupuesto ${pr.numero}`,
          presupuesto_id: pr.id,
          estado: "pendiente",
          sociedad_id: sociedadActiva.id,
          created_by: profile?.id || null,
          oc_cliente: pr.ocCliente || null,
          valor_declarado: valorDeclarado ? Number(valorDeclarado) : null,
        })
        .select("id")
        .single();

      if (remitoErr || !remitoData) {
        toast.error("Error al crear remito: " + (remitoErr?.message || "sin datos"));
        return;
      }

      const remitoItems = itemsToRemit.map((it) => ({
        remito_id: remitoData.id,
        descripcion: it.descripcion,
        cantidad: it.cantidad_a_remitar,
        unidad: it.unidad,
        orden: it.orden,
        presupuesto_item_id: it.presupuesto_item_id || null,
      }));
      const { error: remitoItemsErr } = await (supabase as any).from("remito_items").insert(remitoItems);
      if (remitoItemsErr) {
        toast.error("Remito creado pero error en items: " + remitoItemsErr.message);
        return;
      }

      // Check if ALL quantities are now fully remitted
      const allFullyRemitted = items.every(i => {
        const willBeRemitted = i.cantidad_remitida + i.cantidad_a_remitar;
        return willBeRemitted >= i.cantidad_total;
      });

      if (allFullyRemitted) {
        await supabase.from("presupuestos").update({ estado: "remitido" } as any).eq("id", pr.id);
      }

      setRemitidoIds((prev) => new Set([...prev, pr.id]));
      setRemitarModal(null);
      toast.success(`Remito ${numero} creado con ${itemsToRemit.length} items`);
      await fetchPresupuestos();
    } catch (err) {
      console.error("Error creating remito:", err);
      toast.error("Error al crear remito");
    } finally {
      setRemitarLoading(false);
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
      p.sucursalNombre ? `Sucursal: ${p.sucursalNombre}` : null,
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
    if (!sociedadActiva) return;
    const soc = getSociedadPDF(sociedadActiva);
    const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
    const html = generatePresupuestoPDF({
      numero: pr.numero,
      fecha: pr.fecha,
      vencimiento: pr.vencimiento,
      estado: pr.estado,
      estadoLabel,
      moneda: pr.moneda,
      subtotal: pr.subtotal,
      iva: pr.iva,
      total: pr.total,
      observaciones: pr.observaciones,
      creadoPor: pr.creadoPor,
      clienteNombre: pr.clienteNombre,
      clienteCuit: p.clienteCuit,
      clienteCondicionIva: p.clienteCondicionIva,
      clienteEmail: p.clienteEmail,
      clienteTelefono: p.clienteTelefono,
      clienteDireccion: p.clienteDireccion,
      clienteLocalidad: p.clienteLocalidad,
      clienteProvincia: p.clienteProvincia,
      sucursalNombre: p.sucursalNombre,
      sucursalDireccion: p.sucursalDireccion,
      vendedorNombre: p.vendedorNombre,
      tipoComprobante: p.tipoComprobante,
      cotizacionModalidad: p.cotizacionModalidad,
      tipoCambio: p.tipoCambio,
      items: pr.items.map(it => ({
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precioVenta: it.precioVenta,
        total: it.total,
      })),
    }, soc);
    openPDFWindow(html, `${pr.numero}.pdf`);
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
              const refDate = new Date(fechaRef + (fechaRef.includes("T") ? "" : "T12:00:00"));
              const diffMs = today.getTime() - refDate.getTime();
              const diasSinRespuesta = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              let urgencia: "verde" | "amarillo" | "naranja" | "rojo";
              if (diasSinRespuesta >= 7) urgencia = "rojo";
              else if (diasSinRespuesta >= 5) urgencia = "naranja";
              else if (diasSinRespuesta >= 3) urgencia = "amarillo";
              else urgencia = "verde";
              return { ...pr, diasSinRespuesta, urgencia, fechaRef };
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

          const urgenciaLabels = { verde: "1-2 días", amarillo: "3-4 días", naranja: "5-6 días", rojo: "7+ días" };

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
                              <span className="text-[10px] font-medium uppercase mt-0.5">{pr.diasSinRespuesta === 1 ? "día" : "días"}</span>
                            </div>
                          </div>

                          {/* Info */}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-zinc-400">Enviado</span>
                              <p className="font-medium text-zinc-600 dark:text-zinc-300">{formatDate(pr.fechaRef)}</p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Sin respuesta</span>
                              <p className={`font-medium ${pr.diasSinRespuesta >= 7 ? "text-red-600 dark:text-red-400 font-semibold" : pr.diasSinRespuesta >= 5 ? "text-orange-600 dark:text-orange-400 font-semibold" : "text-zinc-600 dark:text-zinc-300"}`}>
                                {pr.diasSinRespuesta} {pr.diasSinRespuesta === 1 ? "día" : "días"}
                              </p>
                            </div>
                            <div>
                              <span className="text-zinc-400">Subtotal s/IVA</span>
                              <p className="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{formatCurrency(pr.subtotal, pr.moneda)}</p>
                              <p className="text-[10px] text-zinc-400">Total: {formatCurrency(pr.total, pr.moneda)}</p>
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
                key: "numero", label: "N°", sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-1.5">
                    {row.estado === "solicitud" ? <Inbox className="h-3.5 w-3.5 text-blue-400" /> : <FileText className="h-3.5 w-3.5 text-zinc-400" />}
                    <span className="font-mono text-xs font-bold">{row.estado === "solicitud" ? row.numero.replace("PR-", "SOL-") : row.numero}</span>
                  </div>
                ),
              },
              {
                key: "items", label: "Detalle", sortable: false,
                render: (row) => {
                  // Para solicitudes sin items, mostrar observaciones/notas como resumen
                  if (!row.items || row.items.length === 0) {
                    const texto = row.observaciones || (row as any).notasInternas || "";
                    if (!texto) return <span className="text-zinc-400 text-xs">—</span>;
                    const truncated = texto.length > 60 ? texto.slice(0, 57) + "..." : texto;
                    return <span className="text-xs text-blue-600 dark:text-blue-400 italic" title={texto}>{truncated}</span>;
                  }
                  const descs = row.items.slice(0, 2).map(it => it.descripcion || it.codigo || "").filter(Boolean);
                  let text = descs.join(", ");
                  if (text.length > 50) text = text.slice(0, 47) + "...";
                  else if (row.items.length > 2) text += "...";
                  return <span className="text-xs text-zinc-600 dark:text-zinc-400" title={row.items.map(it => it.descripcion).join(", ")}>{text}</span>;
                },
              },
              {
                key: "clienteNombre", label: "Cliente", sortable: true,
                render: (row) => <span className="font-medium text-xs">{row.clienteNombre}</span>,
              },
              {
                key: "sucursalNombre", label: "Sucursal", sortable: true,
                render: (row) => <span className="text-xs text-zinc-600 dark:text-zinc-300">{row.sucursalNombre || "—"}</span>,
              },
              {
                key: "subtotal", label: "Subtotal s/IVA", className: "text-right", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return (
                    <span className="font-mono text-xs block text-right whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {formatCurrency(row.subtotal, row.moneda)}
                    </span>
                  );
                },
              },
              {
                key: "total", label: "Total c/IVA", className: "text-right", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return (
                    <span className="font-mono text-xs font-semibold block text-right whitespace-nowrap">
                      {formatCurrency(row.total, row.moneda)}
                    </span>
                  );
                },
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
                key: "enviadoAt" as any, label: "Enviado", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return row.enviadoAt ? <span className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{formatDate(row.enviadoAt)}</span> : <span className="text-zinc-400 text-xs">—</span>;
                },
              },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = statusConfig[row.estado] || { label: row.estado, variant: "outline" as const, icon: Clock };
                  const Icon = cfg.icon;
                  const sinCostos = row.estado === "aprobado" && prsSinCostos.has(row.id);

                  // Indicador de vencimiento para PRs activos
                  let vencTag: React.ReactNode = null;
                  if (["pendiente", "postergado", "solicitud"].includes(row.estado) && row.vencimiento) {
                    const dias = Math.floor((new Date(row.vencimiento + "T23:59:59").getTime() - Date.now()) / 86400000);
                    if (dias < 0) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" title={`Venció hace ${Math.abs(dias)} días`}>VENCIDO</span>;
                    } else if (dias <= 5) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    } else if (dias <= 10) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    } else if (dias <= 20) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    }
                  }

                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      {vencTag}
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
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelected(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Ver">
                      <Eye className="h-4 w-4" />
                    </button>
                    {row.estado === "solicitud" ? (
                      <button
                        onClick={() => handleEditPR(row)}
                        className="flex items-center gap-1 rounded-md bg-orange-50 px-2 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                        title="Convertir esta solicitud en presupuesto"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        Convertir
                      </button>
                    ) : (
                      <button onClick={() => handleDuplicate(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar presupuesto">
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
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
                    {canDeletePresupuestos && (
                      <button
                        onClick={() => handleDelete(row.id)}
                        className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                        title="Eliminar presupuesto"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
          </>
        )}
      </div>

      {/* ==================== DETAIL SIDE PANEL ==================== */}
      {selected && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/20 transition-opacity" onClick={() => { setSelected(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-2xl"
          }>
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
                    title={selected.estado === "solicitud" ? "Convertir esta solicitud en presupuesto" : "Editar presupuesto"}
                  >
                    {selected.estado === "solicitud" ? <ArrowRight className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
                    {selected.estado === "solicitud" ? "Convertir" : "Editar"}
                  </button>
                )}
                {(selected.estado === "aprobado" || selected.estado === "remitido") && remitidoStatus[selected.id] !== "total" && (
                  <button
                    onClick={() => openRemitarModal(selected)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition-colors"
                    title="Generar remito"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    {remitidoStatus[selected.id] === "parcial" ? "Remitar pendiente" : "Remitar"}
                  </button>
                )}
                <button onClick={() => handleDuplicate(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar">
                  <Copy className="h-4 w-4" />
                </button>
                {canDeletePresupuestos && (
                  <button onClick={() => handleDelete(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setSelected(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
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
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Sucursal</p>
                  <p className="text-sm font-medium">{selected.sucursalNombre || "—"}</p>
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
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
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
                <div>
                  <p className="text-xs text-zinc-500 flex items-center gap-1"><Paperclip className="h-3 w-3" /> Archivo adjunto</p>
                  {(selected as any).archivoUrl ? (
                    <div className="flex items-center gap-2 mt-0.5">
                      <a href={(selected as any).archivoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400 truncate max-w-[180px]">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
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
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-1 cursor-pointer text-sm text-zinc-400 hover:text-orange-600 transition-colors mt-0.5">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Subir archivo</span>
                      <input type="file" className="hidden" onChange={async (e) => {
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
                      }} />
                    </label>
                  )}
                </div>
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
                          <td className="px-3 py-2 text-right font-mono hidden sm:table-cell">{formatCurrency(item.precioCosto, selected.moneda as "ARS" | "USD")}</td>
                          <td className="px-3 py-2 text-right hidden sm:table-cell">{item.markupPorcentaje}%</td>
                          <td className={`px-3 py-2 text-right font-mono ${belowCost ? "text-red-600 dark:text-red-400" : ""}`}>
                            <span className="inline-flex items-center gap-1">
                              {belowCost && <AlertTriangle className="h-3 w-3 shrink-0" />}
                              {formatCurrency(item.precioVenta, selected.moneda as "ARS" | "USD")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(item.total, selected.moneda as "ARS" | "USD")}</td>
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
        onClose={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
        title={editingPRId && esSolicitud ? "Convertir Solicitud en Presupuesto" : editingPRId ? "Editar Presupuesto" : esSolicitud ? "Nueva Solicitud" : "Nuevo Presupuesto"}
        description={editingPRId && esSolicitud ? "Completa la cotización. La solicitud se convertirá en PR sin crear un registro duplicado." : editingPRId ? "Modifica los datos del presupuesto existente" : esSolicitud ? "Registra un pedido de cliente para convertirlo luego en presupuesto" : "Completa los datos para crear un nuevo presupuesto"}
        size="xl"
        allowFullscreen
        footer={
          <>
            <button
              onClick={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
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
              {newPRSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPRId && esSolicitud ? <ArrowRight className="h-4 w-4" /> : editingPRId ? <Check className="h-4 w-4" /> : esSolicitud ? <Inbox className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {editingPRId && esSolicitud ? "Convertir en Presupuesto" : editingPRId ? "Guardar cambios" : esSolicitud ? "Crear Solicitud" : "Crear Presupuesto"}
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
                    <button key={c.id} onClick={() => { const mg = c.markup_predeterminado != null ? Number(c.markup_predeterminado) : undefined; const td = tipoDocPorCondicion(c.condicion_iva); setNewPR((p) => { const markup = mg ?? p.markup_general; return { ...p, cliente_id: c.id, markup_general: markup, ...td, items: p.items.map((it) => ({ ...it, markup_porcentaje: markup, precio_venta: Number(((it.costo_moneda === "USD" ? it.precio_costo * (p.tipo_cambio || 1) : it.precio_costo) * (1 + markup / 100)).toFixed(2)) })) }; }); setClientSearch(c.razon_social); setClientDropdownOpen(false); }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                      {c.razon_social}{c.markup_predeterminado != null && <span className="ml-auto text-xs text-zinc-400">{c.markup_predeterminado}%</span>}
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

            {/* Descripción de lo que necesita — se guarda en notas_internas (es info interna, no para el cliente) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                ¿Qué necesita el cliente?
              </label>
              <textarea
                value={newPR.notas_internas}
                onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
                rows={4}
                placeholder="Ej: Necesita válvulas para planta de gas, urgente para la semana que viene. Me va a mandar la lista por WhatsApp."
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
                        const mg = c.markup_predeterminado != null ? Number(c.markup_predeterminado) : undefined;
                        const td = tipoDocPorCondicion(c.condicion_iva);
                        setNewPR((p) => {
                          const markup = mg ?? p.markup_general;
                          return { ...p, cliente_id: c.id, markup_general: markup, ...td, items: p.items.map((it) => ({ ...it, markup_porcentaje: markup, precio_venta: Number(((it.costo_moneda === "USD" ? it.precio_costo * (p.tipo_cambio || 1) : it.precio_costo) * (1 + markup / 100)).toFixed(2)) })) };
                        });
                        setClientSearch(c.razon_social);
                        setClientDropdownOpen(false);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" : "text-zinc-700 dark:text-zinc-300"}`}
                    >
                      {c.razon_social}{c.markup_predeterminado != null && <span className="ml-auto text-xs text-zinc-400">{c.markup_predeterminado}%</span>}
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
            onChange={(e) => {
              const mon = e.target.value as "USD" | "ARS";
              setNewPR((p) => {
                const items = p.items.map(it => {
                  const costoConv = convertCosto(it.precio_costo, it.costo_moneda, mon, p.tipo_cambio);
                  return { ...it, precio_venta: Number((costoConv * (1 + it.markup_porcentaje / 100)).toFixed(2)) };
                });
                return { ...p, moneda: mon, items };
              });
              if (mon === "USD") fetchCotizBna("divisas");
            }}
            options={[{ value: "ARS", label: "ARS — Pesos" }, { value: "USD", label: "USD — Dolares" }]}
          />
          <div>
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
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-400">BNA:</span>
              <button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                {cotizBnaLoading ? "…" : "Divisas"}
              </button>
              <span className="text-xs text-zinc-300">·</span>
              <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                {cotizBnaLoading ? "…" : "Billetes"}
              </button>
              <input type="date" value={cotizFecha} onChange={e => setCotizFecha(e.target.value)} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
              {cotizBna && (
                <span className="text-xs text-zinc-400">
                  → Venta {cotizBna.modalidad}: {formatCurrency(cotizBna.valor_venta, "ARS")} ({cotizBna.fecha})
                </span>
              )}
            </div>
          </div>
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
          <Input
            label="Fecha de vencimiento"
            type="date"
            value={newPR.vencimiento}
            min={new Date().toISOString().split("T")[0]}
            onChange={(e) => setNewPR((p) => ({ ...p, vencimiento: e.target.value }))}
          />
          <Select
            label="Tipo de documento"
            value={newPR.tipo_comprobante === "A" ? "A" : newPR.tipo_comprobante === "B" ? "B" : newPR.modalidad_emision === "manual" ? "manual" : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "A") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "A", modalidad_emision: "electronica" }));
              } else if (v === "B") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "B", modalidad_emision: "electronica" }));
              } else if (v === "manual") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "", modalidad_emision: "manual" }));
              } else {
                setNewPR((p) => ({ ...p, tipo_comprobante: "", modalidad_emision: "sin_definir" }));
              }
            }}
            options={[
              { value: "", label: "Sin definir" },
              { value: "A", label: "A — Resp. Inscripto (IVA discriminado)" },
              { value: "B", label: "B — Consumidor Final / Monotributo / Exento (IVA incluido)" },
              { value: "manual", label: "Manual (sin ARCA)" },
            ]}
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
                Pegá el mensaje del cliente o subí una foto (captura de WhatsApp, mail, lista de productos, etc). La IA busca en las listas de precios y crea los items que no encuentre.
              </p>
              <textarea
                value={aiMessage}
                onChange={(e) => setAiMessage(e.target.value)}
                rows={3}
                placeholder="Ej: Necesito 3 válvulas esféricas de 2 pulgadas, 10 metros de caño SCH40 de 4 y un manómetro de glicerina..."
                className="w-full rounded-lg border border-orange-200 px-3 py-2 text-sm dark:border-orange-800 dark:bg-zinc-900 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-200 resize-none"
              />
              {/* Image upload */}
              <div className="flex items-center gap-3 mt-2">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300 transition-colors">
                  <ImagePlus className="h-4 w-4" />
                  <span>{aiImage ? "Cambiar foto" : "Adjuntar foto"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 10 * 1024 * 1024) { toast.error("Imagen muy grande (máx 10MB)"); return; }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const result = reader.result as string;
                        const base64 = result.split(",")[1];
                        const mediaType = file.type || "image/jpeg";
                        setAiImage({ data: base64, media_type: mediaType, name: file.name });
                      };
                      reader.readAsDataURL(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {aiImage && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 px-2 py-1 rounded-md">
                    <Check className="h-3 w-3" />
                    <span className="truncate max-w-[180px]">{aiImage.name}</span>
                    <button onClick={() => setAiImage(null)} className="text-red-400 hover:text-red-600 ml-1"><X className="h-3 w-3" /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mt-3">
                <button onClick={() => { setShowAIPanel(false); setAiMessage(""); setAiImage(null); }} className="text-xs text-zinc-500 hover:text-zinc-700">
                  Cancelar
                </button>
                <button
                  onClick={handleAIGenerate}
                  disabled={aiLoading || (!aiMessage.trim() && !aiImage)}
                  className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {aiLoading ? "Procesando..." : "Generar items"}
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
                  <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500 w-36">Proveedor</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-16">Cant.</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-36">P. Costo</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-20">Markup%</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-24">P. Venta</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-20">IVA%</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-zinc-500 w-28">Subtotal</th>
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
                        <select
                          value={item.proveedor_id || ""}
                          onChange={(e) => {
                            const provId = e.target.value;
                            const provNombre = proveedoresOptions.find(p => p.id === provId)?.razon_social || "";
                            setNewPR((prev) => {
                              const items = [...prev.items];
                              items[idx] = { ...items[idx], proveedor_id: provId, proveedor_nombre: provNombre };
                              return { ...prev, items };
                            });
                          }}
                          className="w-full rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100"
                          title={item.proveedor_nombre || "Sin proveedor"}
                        >
                          <option value="">—</option>
                          {proveedoresOptions.map(p => (
                            <option key={p.id} value={p.id}>{p.razon_social}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <NumInput value={item.cantidad} onChange={(n) => updateNewPRItem(idx, "cantidad", n)}
                            className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                          {priceTiersMap[idx] && priceTiersMap[idx].length > 0 && (
                            <span title={`Precios escalonados:\n${priceTiersMap[idx].map(t => `${t.variante}: ${t.moneda === "USD" ? "US$" : "$"}${t.precio_neto}`).join("\n")}`}
                              className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white font-bold cursor-help">
                              ↗
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => updateNewPRItem(idx, "costo_moneda", item.costo_moneda === "USD" ? "ARS" : "USD")} title="Click para cambiar moneda" className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-bold border cursor-pointer hover:opacity-80 transition-opacity ${
                            item.costo_moneda === "USD"
                              ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                              : "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}>
                            {item.costo_moneda === "USD" ? "US$" : "AR$"}
                          </button>
                          <NumInput value={item.precio_costo} onChange={(n) => updateNewPRItem(idx, "precio_costo", n)}
                            className="w-full min-w-0 rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={item.markup_porcentaje} onChange={(n) => updateNewPRItem(idx, "markup_porcentaje", n)}
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <NumInput value={item.precio_venta} onChange={(n) => updateNewPRItem(idx, "precio_venta", n)}
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
                      <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                        {formatCurrency(calcItemTotals(item).subtotal, newPR.moneda)}
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

        {/* Notas internas y Observaciones — en modo presupuesto, o al editar una solicitud */}
        {(!esSolicitud || editingPRId) && <>
        <Textarea
          label="Notas internas (solo uso interno)"
          value={newPR.notas_internas}
          onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
          rows={2}
          placeholder="Margen esperado, contexto de la negociacion, datos internos..."
        />

        <Textarea
          label="Observaciones (visibles para el cliente)"
          value={newPR.observaciones}
          onChange={(e) => setNewPR((p) => ({ ...p, observaciones: e.target.value }))}
          rows={2}
          placeholder="Condiciones de pago, plazo de entrega, aclaraciones..."
        />
        </>}
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
                  const email = (pr as any).clienteEmail || "";
                  const subject = encodeURIComponent(`Presupuesto ${pr.numero}`);
                  const body = encodeURIComponent(text);
                  window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
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
                          {s.variante && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                              {s.variante}
                            </span>
                          )}
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

      {/* ==================== REMITAR MODAL ==================== */}
      {remitarModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setRemitarModal(null)} />
          <div className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">Remitar — {remitarModal.pr.numero}</h3>
              <button onClick={() => setRemitarModal(null)} className="rounded p-1 text-zinc-400 hover:text-zinc-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Ingresá las cantidades a incluir en este remito. Los items con cantidad 0 no se incluyen.</p>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {remitarModal.items.map((item, idx) => (
                  <div key={idx} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{item.descripcion}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <span>Total: {item.cantidad_total} {item.unidad}</span>
                          {item.cantidad_remitida > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">Ya remitido: {item.cantidad_remitida}</span>
                          )}
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Pendiente: {item.cantidad_pendiente}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min={0}
                          max={item.cantidad_pendiente}
                          step="any"
                          value={item.cantidad_a_remitar || ""}
                          onChange={(e) => {
                            const val = Math.max(0, Math.min(Number(e.target.value), item.cantidad_pendiente));
                            setRemitarModal(prev => {
                              if (!prev) return prev;
                              const newItems = [...prev.items];
                              newItems[idx] = { ...newItems[idx], cantidad_a_remitar: val };
                              return { ...prev, items: newItems };
                            });
                          }}
                          className="w-20 rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-right font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                        />
                        <span className="text-xs text-zinc-400 w-6">{item.unidad}</span>
                      </div>
                    </div>
                    {item.cantidad_a_remitar > item.cantidad_pendiente && (
                      <p className="text-xs text-red-500 mt-1">Excede la cantidad pendiente</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm">
                <span className="text-zinc-600 dark:text-zinc-300 font-medium">Items a incluir</span>
                <span className="font-bold text-zinc-900 dark:text-white">{remitarModal.items.filter(i => i.cantidad_a_remitar > 0).length} de {remitarModal.items.length}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <button onClick={() => setRemitarModal(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
              <button
                onClick={handleRemitarConfirm}
                disabled={remitarLoading || remitarModal.items.every(i => i.cantidad_a_remitar <= 0)}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {remitarLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Generar remito
              </button>
            </div>
          </div>
        </>
      )}

      {/* ==================== EMAIL MODAL ==================== */}
      <EmailComposeModal
        open={emailModal.open}
        onClose={() => setEmailModal(prev => ({ ...prev, open: false }))}
        documentType="presupuesto"
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        generatePdf={async () => {
          const pr = presupuestos.find(p => p.id === emailModal.id);
          if (!pr || !sociedadActiva) throw new Error("No se encontró el presupuesto");
          const p = pr as any;
          const soc = getSociedadPDF(sociedadActiva);
          const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
          const html = generatePresupuestoPDF({
            numero: pr.numero,
            fecha: pr.fecha,
            vencimiento: pr.vencimiento,
            estado: pr.estado,
            estadoLabel,
            moneda: pr.moneda,
            subtotal: pr.subtotal,
            iva: pr.iva,
            total: pr.total,
            observaciones: pr.observaciones,
            creadoPor: pr.creadoPor,
            clienteNombre: pr.clienteNombre,
            clienteCuit: p.clienteCuit,
            clienteCondicionIva: p.clienteCondicionIva,
            clienteEmail: p.clienteEmail,
            clienteTelefono: p.clienteTelefono,
            clienteDireccion: p.clienteDireccion,
            clienteLocalidad: p.clienteLocalidad,
            clienteProvincia: p.clienteProvincia,
            sucursalNombre: p.sucursalNombre,
            sucursalDireccion: p.sucursalDireccion,
            vendedorNombre: p.vendedorNombre,
            tipoComprobante: p.tipoComprobante,
            cotizacionModalidad: p.cotizacionModalidad,
            tipoCambio: p.tipoCambio,
            items: pr.items.map(it => ({
              codigo: it.codigo,
              descripcion: it.descripcion,
              cantidad: it.cantidad,
              unidad: it.unidad,
              precioVenta: it.precioVenta,
              total: it.total,
            })),
          }, soc);
          return htmlToPdfBase64(html);
        }}
      />
    </>
  );
}
