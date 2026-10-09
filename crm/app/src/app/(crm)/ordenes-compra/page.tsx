"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { generateOrdenCompraPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import type { OCStatus } from "@/lib/types";
import {
  ShoppingCart, Clock, CheckCircle2, Truck, Loader2,
  X, Send, XCircle, Copy, Package, Mail, Phone, MapPin,
  FileText, ClipboardCopy, Check, Download, Merge, ChevronDown, ChevronRight, AlertTriangle,
  PackageCheck, MessageSquare, Edit3, Plus, Minus,
  Maximize2, Upload, Trash2, RefreshCw,
  Search, CreditCard, Lock, Sparkles,
} from "lucide-react";
import CargarFacturaOC, { type OCParaVincular } from "@/components/cargar-factura-oc";
import ConciliacionCompras from "@/components/conciliacion-compras";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@/lib/auth-context";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { attachPurchaseOrderInvoices } from "@/lib/purchase-order-invoice-links";
import { isOwnStockPurchaseOrder, purchaseOrderProviderLabel } from "@/lib/own-stock-purchase-orders";

const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "outline" | "purple" }> = {
  borrador: { label: "Borrador", variant: "outline" },
  pendiente: { label: "Pendiente", variant: "info" },
  enviada: { label: "Pendiente", variant: "info" },
  confirmada: { label: "Pendiente", variant: "info" },
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
  sociedad_id?: string | null;
  numero: string;
  proveedor_id: string | null;
  fecha: string;
  fecha_entrega_estimada: string | null;
  estado: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  presupuesto_origen_id: string | null;
  pedido: boolean;
  estado_pago: "pendiente" | "pagada";
  medio_pago: string | null;
  pagada_at: string | null;
  notas_recepcion: string | null;
  observaciones: string;
  created_at: string;
  created_by: string | null;
  proveedores: ProveedorInfo | null;
  created_by_profile: { full_name: string } | null;
  presupuesto_origen: { numero: string; modalidad_emision?: string | null } | null;
  orden_compra_items: { codigo: string | null; descripcion: string | null; cantidad: number; cantidad_recibida: number }[];
  facturas_vinculadas?: { id: string; numero_factura: string; tipo_comprobante: string; estado: string; total: number; moneda: string; archivo_url: string | null; archivo_nombre?: string | null }[];
  facturas_vinculadas_estado?: "conocido" | "desconocido";
}

const ocPagada = (oc: OCRow) => {
  if (oc.estado_pago === "pagada") return true;
  const facturas = (oc.facturas_vinculadas || []).filter((factura) => factura.estado !== "anulada");
  return facturas.length > 0 && facturas.every((factura) => factura.estado === "pagada");
};

const ocPagadaConTarjeta = (oc: OCRow) => oc.estado_pago === "pagada" && oc.medio_pago === "tarjeta";

// Una factura que ya fue aprobada por Finanzas no permite modificar la OC
// vinculada: conserva la trazabilidad entre el comprobante aprobado y el costo.
const ocTieneFacturaAprobada = (oc: OCRow) =>
  oc.facturas_vinculadas_estado === "desconocido" || (oc.facturas_vinculadas || []).some((factura) => ["pendiente", "recibida", "pagada"].includes(factura.estado));

// Una OC originada en un PR manual debe conservarse sin IVA durante todo su ciclo
// (creacion, edicion y division por proveedor). El chequeo del encabezado cubre
// tambien OCs historicas creadas sin IVA antes de guardar la modalidad de origen.
const ocCompraSinIva = (oc: OCRow) =>
  oc.presupuesto_origen?.modalidad_emision === "manual" || Number(oc.iva) === 0;

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
  proveedor_id: string | null;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
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

function ProveedorPicker({ value, options, onChange, placeholder = "Buscar proveedor...", compact = false, disabled = false }: {
  value: string;
  options: ProveedorOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState(selected?.razon_social || "");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
  useEffect(() => { setQuery(selected?.razon_social || ""); }, [selected?.razon_social]);
  const filteredOptions = options.filter((option) => option.razon_social.toLowerCase().includes(query.toLowerCase())).slice(0, 30);

  const updateDropPosition = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropUp = spaceBelow < 220 && rect.top > 220;
    setDropStyle({
      position: "fixed" as const,
      left: rect.left,
      width: Math.max(rect.width, 260),
      zIndex: 9999,
      ...(dropUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  };

  return <div className="relative" onClick={(event) => event.stopPropagation()}>
    <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 ${compact ? "h-3 w-3" : "h-4 w-4"}`} />
    <input ref={inputRef} value={query} disabled={disabled} onFocus={() => { if (disabled) return; updateDropPosition(); setOpen(true); }} onChange={(event) => { if (disabled) return; setQuery(event.target.value); updateDropPosition(); setOpen(true); if (value) onChange(""); }} placeholder={placeholder} className={`w-full rounded-lg border border-zinc-300 bg-white pr-8 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white ${compact ? "py-1 pl-7 text-xs" : "py-2 pl-9 text-sm"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`} />
    {query && <button type="button" onClick={() => { setQuery(""); onChange(""); setOpen(true); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"><X className="h-3.5 w-3.5" /></button>}
    {open && createPortal(
      <><div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} /><div style={dropStyle} className="max-h-52 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
      <button type="button" onClick={() => { onChange(""); setQuery(""); setOpen(false); }} className="block w-full px-3 py-2 text-left text-xs italic text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700">Sin proveedor</button>
      {filteredOptions.map((option) => <button type="button" key={option.id} onClick={() => { onChange(option.id); setQuery(option.razon_social); setOpen(false); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-zinc-700">{option.razon_social}</button>)}
      {filteredOptions.length === 0 && <p className="px-3 py-3 text-xs text-zinc-400">No se encontraron proveedores</p>}
    </div></>,
    document.body)}
  </div>;
}

export default function OrdenesCompraPage() {
  const { sociedadActiva, profile } = useUser();
  const canManageCompras = profile?.role === "super_admin" || profile?.role === "admin" || profile?.role === "administrativo" || profile?.role === "vendedor";
  const [filter, setFilter] = useState<OCStatus | "todas" | "pago_pendiente" | "pagada" | "recibida_parcial" | "cancelada">("todas");
  const [search, setSearch] = useState("");
  const [operadorFilter, setOperadorFilter] = useState("");
  const [ordenes, setOrdenes] = useState<OCRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [facturaLinksError, setFacturaLinksError] = useState("");

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

  // Cargar factura modal
  const [cargarFCOpen, setCargarFCOpen] = useState(false);
  const [cargarFCPreselectedId, setCargarFCPreselectedId] = useState<string | undefined>();
  const [conciliarOpen, setConciliarOpen] = useState(false);

  // Email modal
  const [emailModal, setEmailModal] = useState<{ open: boolean; id: string; to: string; subject: string; body: string; filename: string }>({ open: false, id: "", to: "", subject: "", body: "", filename: "" });

  // All profiles for operator dropdown
  const [allProfiles, setAllProfiles] = useState<{ id: string; full_name: string }[]>([]);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [formData, setFormData] = useState({
    proveedor_id: "",
    fecha: todayAR(),
    fecha_entrega_estimada: "",
    moneda: "ARS" as "ARS" | "USD",
    observaciones: "",
    presupuesto_origen_id: "",
    pagada_con_tarjeta: false,
  });
  const [presupuestosAprobados, setPresupuestosAprobados] = useState<{ id: string; numero: string; clienteNombre: string }[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Items for the create modal (used when NOT linked to a PR)
  interface CreateItem {
    _key: string;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    unidad: string;
    iva_porcentaje: number;
  }
  const [createItems, setCreateItems] = useState<CreateItem[]>([]);
  const [importingCreateOC, setImportingCreateOC] = useState(false);
  const importCreateOCRef = useRef<HTMLInputElement>(null);

  async function handleImportCreateCotizacion(file: File) {
    setImportingCreateOC(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-oc", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.success || !json.data) { alert(json.error || "No se pudo leer el archivo"); return; }
      const d = json.data;
      const newItems: CreateItem[] = (d.items || []).map((it: any, idx: number) => ({
        _key: `ci_${Date.now()}_${idx}`,
        codigo: it.codigo || "",
        descripcion: it.descripcion || "",
        cantidad: Number(it.cantidad) || 1,
        precio_unitario: Number(it.precio_unitario) || 0,
        unidad: it.unidad || "u",
        iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
      }));
      if (newItems.length > 0) {
        setCreateItems(prev => [...prev, ...newItems]);
        if (d.moneda && d.moneda !== formData.moneda) {
          alert(`Nota: la cotización está en ${d.moneda} pero la OC está en ${formData.moneda}`);
        }
      } else {
        alert("No se encontraron items en el archivo");
      }
    } catch (e) {
      alert("Error al procesar el archivo");
      console.error(e);
    } finally {
      setImportingCreateOC(false);
      if (importCreateOCRef.current) importCreateOCRef.current.value = "";
    }
  }

  const createItemsSubtotal = createItems.reduce((sum, it) => sum + it.cantidad * it.precio_unitario, 0);
  const createItemsIva = createItems.reduce((sum, it) => {
    const line = it.cantidad * it.precio_unitario;
    return sum + Math.round(line * (it.iva_porcentaje / 100) * 100) / 100;
  }, 0);
  const createItemsTotal = Math.round((createItemsSubtotal + createItemsIva) * 100) / 100;

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
    compra_sin_iva: boolean;
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
    origen: "presupuesto" | "orden_compra";
    item_id: string;
    oc_id?: string;
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
  const [importingOC, setImportingOC] = useState(false);
  const [assignPROpen, setAssignPROpen] = useState(false);
  const [assignPRSearch, setAssignPRSearch] = useState("");
  const [assignPROptions, setAssignPROptions] = useState<{ id: string; numero: string; cliente: string }[]>([]);
  const [assignPRLoading, setAssignPRLoading] = useState(false);
  const importOCRef = useRef<HTMLInputElement>(null);

  async function handleOpenAssignPR() {
    setAssignPROpen(true);
    setAssignPRSearch("");
    setAssignPRLoading(true);
    try {
      let q = supabase.from("presupuestos").select("id, numero, clientes(razon_social)").in("estado" as any, ["aprobado", "facturar", "facturado"]).order("created_at", { ascending: false }).limit(50);
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      const { data } = await q;
      setAssignPROptions((data || []).map((p: any) => ({ id: p.id, numero: p.numero, cliente: p.clientes?.razon_social || "" })));
    } catch { /* noop */ }
    setAssignPRLoading(false);
  }

  async function handleAssignPR(prId: string) {
    if (!detailOC) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de asignar el presupuesto"); return; }
    let query = supabase.from("ordenes_compra").update({ presupuesto_origen_id: prId } as any).eq("id", detailOC.id);
    query = query.eq("sociedad_id" as any, sociedadActiva.id) as any;
    const { error } = await query;
    if (error) { alert("Error al asignar PR: " + error.message); return; }
    const pr = assignPROptions.find(p => p.id === prId);
    setDetailOC({ ...detailOC, presupuesto_origen_id: prId, presupuesto_origen: pr ? { numero: pr.numero } : null });
    setOrdenes(prev => prev.map(o => o.id === detailOC.id ? { ...o, presupuesto_origen_id: prId, presupuesto_origen: pr ? { numero: pr.numero } : null } : o));
    setAssignPROpen(false);
  }

  async function handleUnassignPR() {
    if (!detailOC) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de desasignar el presupuesto"); return; }
    let query = supabase.from("ordenes_compra").update({ presupuesto_origen_id: null } as any).eq("id", detailOC.id);
    query = query.eq("sociedad_id" as any, sociedadActiva.id) as any;
    query = query.eq("presupuesto_origen_id" as any, detailOC.presupuesto_origen_id) as any;
    const { data, error } = await query.select("id").maybeSingle();
    if (error) { alert("Error al desasignar PR: " + error.message); return; }
    if (!data) { alert("No se desasignó el PR: la OC cambió o no tenés permiso para modificarla. Actualizá la pantalla y volvé a intentar."); return; }
    setDetailOC({ ...detailOC, presupuesto_origen_id: null, presupuesto_origen: null });
    setOrdenes(prev => prev.map(o => o.id === detailOC.id ? { ...o, presupuesto_origen_id: null, presupuesto_origen: null } : o));
  }

  async function handleImportCotizacion(file: File) {
    setImportingOC(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-oc", { method: "POST", body: formData });
      const json = await res.json();
      if (!json.success || !json.data) { alert(json.error || "No se pudo leer el archivo"); return; }
      const d = json.data;
      const newItems: DetailItem[] = (d.items || []).map((it: any, idx: number) => ({
        id: `new_${Date.now()}_${idx}`,
        codigo: it.codigo || "",
        descripcion: it.descripcion || "",
        cantidad: Number(it.cantidad) || 1,
        cantidad_recibida: 0,
        unidad: it.unidad || "u",
        precio_unitario: Number(it.precio_unitario) || 0,
        subtotal: (Number(it.cantidad) || 1) * (Number(it.precio_unitario) || 0),
        producto_id: null,
        iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
        proveedor_id: null,
      }));
      if (newItems.length > 0) {
        setEditItems(prev => [...prev, ...newItems]);
        if (d.moneda && d.moneda !== detailOC?.moneda) {
          alert(`Nota: la cotización está en ${d.moneda} pero la OC está en ${detailOC?.moneda || "ARS"}`);
        }
      } else {
        alert("No se encontraron items en el archivo");
      }
    } catch (e) {
      alert("Error al procesar el archivo");
      console.error(e);
    } finally {
      setImportingOC(false);
      if (importOCRef.current) importOCRef.current.value = "";
    }
  }
  const [editOC, setEditOC] = useState<{ proveedor_id: string; fecha_entrega_estimada: string; observaciones: string; pagada_con_tarjeta: boolean; moneda: string }>({ proveedor_id: "", fecha_entrega_estimada: "", observaciones: "", pagada_con_tarjeta: false, moneda: "ARS" });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Fetch main data ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setFacturaLinksError("");
    if (!sociedadActiva?.id) {
      setOrdenes([]);
      setFacturaLinksError("Seleccioná una sociedad para consultar las órdenes de compra.");
      setLoading(false);
      return;
    }
    try {
      let q = supabase
        .from("ordenes_compra")
        .select(`
          *,
          proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva),
          created_by_profile:created_by(full_name),
          presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision),
          orden_compra_items(codigo, descripcion, cantidad, cantidad_recibida)
        `)
        .order("created_at", { ascending: false });

      q = q.eq("sociedad_id" as any, sociedadActiva.id);

      const { data, error } = await q;

      if (error) throw error;
      const rows = (data || []) as unknown as OCRow[];
        const ids = rows.map((row) => row.id);
        let junctionRows: any[] = [];
        let legacyInvoices: any[] = [];
        let junctionErrorMessage = "";
        let legacyErrorMessage = "";
        if (ids.length > 0) {
          const { data: links, error: junctionError } = await (supabase as any)
            .from("factura_compra_ocs")
            .select("orden_compra_id, facturas_compra(id, numero_factura, tipo_comprobante, estado, total, moneda, archivo_url, archivo_nombre)")
            .in("orden_compra_id", ids);
          junctionRows = links || [];
          if (junctionError) junctionErrorMessage = junctionError.message;
          const { data: legacyRows, error: legacyError } = await (supabase as any)
            .from("facturas_compra")
            .select("id, numero_factura, tipo_comprobante, estado, total, moneda, archivo_url, archivo_nombre, orden_compra_id")
            .eq("sociedad_id", sociedadActiva.id)
            .in("orden_compra_id", ids);
          legacyInvoices = legacyRows || [];
          if (legacyError) legacyErrorMessage = legacyError.message;
        }
        const result = attachPurchaseOrderInvoices(rows, junctionRows, legacyInvoices, {
          junction: junctionErrorMessage,
          legacy: legacyErrorMessage,
        });
        setOrdenes(result.orders as OCRow[]);
        setFacturaLinksError(result.error);
    } catch (err) {
      console.error("Error cargando órdenes de compra:", err);
      setOrdenes([]);
      setFacturaLinksError(`No se pudieron cargar las órdenes de compra. No se muestran datos de ejemplo. ${err instanceof Error ? err.message : "Reintentá."}`);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sync detailOC with ordenes when list refreshes (e.g. after FC load)
  useEffect(() => {
    if (detailOC) {
      const updated = ordenes.find(o => o.id === detailOC.id);
      if (updated) setDetailOC(updated);
    }
  }, [ordenes]);

  // ── Fetch profiles for operator dropdown ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("profiles").select("id, full_name").order("full_name");
        if (data) setAllProfiles((data as any[]).filter(p => p.full_name));
      } catch { /* ignore */ }
    })();
  }, []);

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
        .select("id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, subtotal, producto_id, iva_porcentaje, proveedor_id" as any)
        .eq("orden_id", ocId)
        .order("orden", { ascending: true });
      if (!error && data) {
        setDetailItems((data as any[]).map((it: any) => ({ ...it, iva_porcentaje: Number(it.iva_porcentaje ?? 21), proveedor_id: it.proveedor_id || null })) as DetailItem[]);
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
    setFormData({ proveedor_id: "", fecha: todayAR(), fecha_entrega_estimada: "", moneda: "ARS", observaciones: "", presupuesto_origen_id: "", pagada_con_tarjeta: false });
    setCreateItems([]);
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
    if (!sociedadActiva?.id) { setFormError("Seleccioná una sociedad antes de crear la OC"); setFormLoading(false); return; }
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

      // Determine totals depending on source: PR items or manual createItems
      let finalSubtotal: number;
      let finalIva: number;
      let linkedPRManual = false;

      if (prItems.length > 0) {
        // Totals from PR items
        finalSubtotal = prItems.reduce((sum, it) => sum + (Number(it.precio_costo) || 0) * (Number(it.cantidad) || 0), 0);
        if (formData.presupuesto_origen_id) {
          const { data: linkedPR } = await (supabase as any)
            .from("presupuestos")
            .select("modalidad_emision")
            .eq("id", formData.presupuesto_origen_id)
            .single();
          linkedPRManual = linkedPR?.modalidad_emision === "manual";
        }
        finalIva = prItems.reduce((sum, it) => {
          if (linkedPRManual) return sum;
          const lineSubtotal = (Number(it.precio_costo) || 0) * (Number(it.cantidad) || 0);
          const ivaPct = Number(it.iva_porcentaje ?? 21) / 100;
          return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
        }, 0);
      } else {
        // Totals from manually added createItems
        finalSubtotal = createItemsSubtotal;
        finalIva = createItemsIva;
      }

      const { data: ocRow, error } = await supabase.from("ordenes_compra").insert({
        proveedor_id: formData.proveedor_id || null,
        fecha: formData.fecha,
        fecha_entrega_estimada: formData.fecha_entrega_estimada || null,
        moneda: formData.moneda,
        observaciones: formData.observaciones,
        estado: "enviada",
        subtotal: Math.round(finalSubtotal * 100) / 100,
        iva: Math.round(finalIva * 100) / 100,
        total: Math.round((finalSubtotal + finalIva) * 100) / 100,
        sociedad_id: sociedadActiva.id,
        presupuesto_origen_id: formData.presupuesto_origen_id || null,
        created_by: profile?.id || null,
        estado_pago: formData.pagada_con_tarjeta ? "pagada" : "pendiente",
        medio_pago: formData.pagada_con_tarjeta ? "tarjeta" : null,
        pagada_at: formData.pagada_con_tarjeta ? new Date().toISOString() : null,
      } as any).select("id").single();
      if (error) throw error;

      // Insert items: from PR or from manual createItems
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
          iva_porcentaje: linkedPRManual ? 0 : Number(it.iva_porcentaje ?? 21),
          orden: idx,
        }));
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error al insertar items de OC:", itemsErr);
          alert(`OC creada pero error al insertar items: ${itemsErr.message}`);
        }
      } else if (ocRow && createItems.length > 0) {
        const ocItems = createItems.map((it, idx) => ({
          orden_id: ocRow.id,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          cantidad: it.cantidad,
          cantidad_recibida: 0,
          unidad: it.unidad || "u",
          precio_unitario: it.precio_unitario,
          producto_id: null,
          iva_porcentaje: it.iva_porcentaje,
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de cancelar la OC"); return; }
    try {
      let cancelQuery = supabase.from("ordenes_compra").update({ estado: "cancelada" } as any).eq("id", oc.id);
      cancelQuery = cancelQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await cancelQuery;
      if (error) throw error;
      await fetchData();
      if (detailOC?.id === oc.id) { setDetailOC(null); setPanelFullscreen(false); }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al cancelar");
    }
  };

  const handleDeleteOC = async (oc: OCRow) => {
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de eliminar la OC"); return; }
    if (oc.sociedad_id && oc.sociedad_id !== sociedadActiva.id) { alert("La OC no pertenece a la sociedad activa"); return; }
    try {
      if (oc.facturas_vinculadas_estado === "desconocido") {
        alert("No se puede eliminar la OC porque no se pudo verificar si tiene facturas vinculadas. Reintentá cargar la lista antes de borrar.");
        return;
      }
      // Check linked FC — block deletion if any non-anulada FC exists
      const { data: linkedFCs, error: junctionError } = await (supabase as any)
        .from("factura_compra_ocs")
        .select("facturas_compra(id, estado)")
        .eq("orden_compra_id", oc.id);
      if (junctionError) throw junctionError;
      const activeFCs = (linkedFCs || []).filter((l: any) => {
        const fc = Array.isArray(l.facturas_compra) ? l.facturas_compra[0] : l.facturas_compra;
        return fc && fc.estado !== "anulada";
      });
      if (activeFCs.length > 0) {
        alert("No se puede eliminar esta OC porque tiene facturas de compra vinculadas. Anulá las facturas primero.");
        return;
      }
      const { data: legacyFCs, error: legacyError } = await (supabase as any)
        .from("facturas_compra")
        .select("id, estado")
        .eq("sociedad_id", sociedadActiva.id)
        .eq("orden_compra_id", oc.id);
      if (legacyError) throw legacyError;
      if ((legacyFCs || []).some((fc: any) => fc.estado !== "anulada")) {
        alert("No se puede eliminar esta OC porque tiene facturas de compra históricas vinculadas. Anulá las facturas primero.");
        return;
      }
    } catch (err) {
      alert(`No se pudo verificar si la OC tiene facturas vinculadas; no se eliminó. ${err instanceof Error ? err.message : "Reintentá y, si persiste, contactá soporte."}`);
      return;
    }
    if (!confirm(`¿Eliminar la OC ${oc.numero}? Esta acción no se puede deshacer.`)) return;
    try {
      // 1. Delete orden_compra_items
      const { error: itemsErr } = await supabase
        .from("orden_compra_items")
        .delete()
        .eq("orden_id", oc.id);
      if (itemsErr) throw itemsErr;
      // 2. Delete the OC itself
      let ocDelete = supabase
        .from("ordenes_compra")
        .delete()
        .eq("id", oc.id);
      ocDelete = ocDelete.eq("sociedad_id" as any, sociedadActiva.id);
      const { error: ocErr } = await ocDelete;
      if (ocErr) throw ocErr;
      // 3. Refresh and close panel
      await fetchData();
      if (detailOC?.id === oc.id) { setDetailOC(null); setPanelFullscreen(false); }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al eliminar OC");
    }
  };

  const handleAdvanceEstado = async (oc: OCRow, nuevoEstado: "pendiente" | "enviada") => {
    if (oc.estado !== "borrador") {
      alert(`La OC ${oc.numero || ""} ya está ${oc.estado}. No hace falta activarla nuevamente.`);
      return;
    }
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de activar la OC"); return; }
    try {
      const { data, error } = await (supabase as any)
        .from("ordenes_compra")
        .update({ estado: nuevoEstado })
        .eq("id", oc.id)
        .eq("sociedad_id", sociedadActiva.id)
        .eq("estado", "borrador")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message || "Error de base de datos al activar la OC");
      if (!data) throw new Error("No se modificó ninguna fila. La OC ya cambió de estado o pertenece a otra sociedad. Recargá la página.");
      await fetchData();
      if (detailOC?.id === oc.id) {
        setDetailOC({ ...oc, estado: nuevoEstado });
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "No se pudo activar la OC. Verificá la sociedad y el estado actual.");
    }
  };

  const handleRegistrarRecepcion = async () => {
    if (!detailOC) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de registrar la recepción"); return; }
    if (detailOC.sociedad_id && detailOC.sociedad_id !== sociedadActiva.id) { alert("La OC no pertenece a la sociedad activa"); return; }
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
        let estadoQuery = supabase.from("ordenes_compra").update({ estado: newEstado } as any).eq("id", detailOC.id);
        estadoQuery = estadoQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { error: estadoErr } = await estadoQuery;
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de registrar la recepción"); return; }
    if (detailOC.sociedad_id && detailOC.sociedad_id !== sociedadActiva.id) { alert("La OC no pertenece a la sociedad activa"); return; }
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
      const { error: estadoErr } = await (supabase as any).from("ordenes_compra").update({ estado: "recibida" }).eq("id", detailOC.id).eq("sociedad_id", sociedadActiva.id);
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
    if (detailOC.facturas_vinculadas_estado === "desconocido") {
      alert("No se puede editar esta OC hasta verificar sus facturas vinculadas. Reintentá cargar la lista.");
      return;
    }
    if (ocTieneFacturaAprobada(detailOC)) {
      alert("Esta OC no se puede editar porque tiene una factura aprobada por Finanzas. Anulá la factura o corregila desde Finanzas antes de modificarla.");
      return;
    }
    setEditItems(detailItems.map((it) => ({ ...it })));
    setEditOC({
      proveedor_id: detailOC.proveedor_id || "",
      fecha_entrega_estimada: detailOC.fecha_entrega_estimada || "",
      observaciones: detailOC.observaciones || "",
      pagada_con_tarjeta: ocPagadaConTarjeta(detailOC),
      moneda: detailOC.moneda || "ARS",
    });
    fetchProveedores();
    setEditMode(true);
  };

  const handleSaveEdit = async () => {
    if (!detailOC) return;
    if (detailOC.facturas_vinculadas_estado === "desconocido") { alert("No se puede guardar: no se pudo verificar el vínculo de facturas. Reintentá cargar la lista."); return; }
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de guardar la OC"); return; }
    if (detailOC.sociedad_id && detailOC.sociedad_id !== sociedadActiva.id) { alert("La OC no pertenece a la sociedad activa"); return; }
    setSavingEdit(true);
    try {
      const compraSinIva = ocCompraSinIva(detailOC);
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
          iva_porcentaje: compraSinIva ? 0 : (it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21),
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

      // Normaliza tambien items historicos: una OC de PR manual nunca debe
      // recuperar IVA por una edicion posterior.
      if (compraSinIva) {
        const { error: normalizeIvaError } = await supabase
          .from("orden_compra_items")
          .update({ iva_porcentaje: 0 } as any)
          .eq("orden_id", detailOC.id);
        if (normalizeIvaError) throw new Error(`Error al conservar la OC sin IVA: ${normalizeIvaError.message}`);
      }

      // 2. Recalculate OC totals using per-item IVA rates
      const newSubtotal = editItems.reduce((sum, it) => sum + Number(it.cantidad) * Number(it.precio_unitario), 0);
      const newIva = compraSinIva ? 0 : editItems.reduce((sum, it) => {
        const lineSubtotal = Number(it.cantidad) * Number(it.precio_unitario);
        const ivaPct = (it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21) / 100;
        return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
      }, 0);
      const newTotal = newSubtotal + newIva;
      const proveedorChanged = editOC.proveedor_id !== (detailOC.proveedor_id || "");

      if (proveedorChanged) {
        const { error: itemsProvErr } = await supabase
          .from("orden_compra_items")
          .update({ proveedor_id: editOC.proveedor_id || null } as any)
          .eq("orden_id", detailOC.id);
        if (itemsProvErr) throw new Error(`Error al actualizar proveedor de los items: ${itemsProvErr.message}`);
      }

      // 3. Determine new estado
      const allReceived = editItems.every((it) => Number(it.cantidad_recibida) >= Number(it.cantidad));
      const someReceived = editItems.some((it) => Number(it.cantidad_recibida) > 0);
      let newEstado = detailOC.estado;
      if (detailOC.estado !== "cancelada") {
        if (allReceived && editItems.length > 0) newEstado = "recibida";
        else if (someReceived) newEstado = "recibida_parcial";
        else if (detailOC.estado === "recibida" || detailOC.estado === "recibida_parcial") newEstado = "enviada";
      }

      // 4. Update OC header
      const { error: ocErr } = await (supabase as any)
        .from("ordenes_compra")
        .update({
          proveedor_id: editOC.proveedor_id || null,
          moneda: editOC.moneda || "ARS",
          subtotal: newSubtotal,
          iva: newIva,
          total: newTotal,
          estado: newEstado,
          fecha_entrega_estimada: editOC.fecha_entrega_estimada || null,
          observaciones: editOC.observaciones || "",
          estado_pago: editOC.pagada_con_tarjeta ? "pagada" : "pendiente",
          medio_pago: editOC.pagada_con_tarjeta ? "tarjeta" : null,
          pagada_at: editOC.pagada_con_tarjeta ? (detailOC.pagada_at || new Date().toISOString()) : null,
        } as any)
        .eq("id", detailOC.id)
        .eq("sociedad_id", sociedadActiva.id);
      if (ocErr) throw new Error(`Error al actualizar OC: ${ocErr.message}`);

      // 5. Refresh items from DB (new items need real IDs)
      await fetchDetailItems(detailOC.id);
      const { data: freshOC } = await supabase
        .from("ordenes_compra")
        .select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision), orden_compra_items(cantidad, cantidad_recibida)")
        .eq("id", detailOC.id)
        .single();
      if (freshOC) setDetailOC(prev => ({ ...(freshOC as unknown as OCRow), facturas_vinculadas: prev?.facturas_vinculadas || [] }));

      // Cascade OC item changes to PR (update precio_costo for matching items)
      if (detailOC.presupuesto_origen_id) {
        try {
          const { data: freshItems } = await supabase
            .from("orden_compra_items")
            .select("descripcion, precio_unitario")
            .eq("orden_id", detailOC.id);
          const { data: prItems } = await supabase
            .from("presupuesto_items")
            .select("id, descripcion, precio_costo")
            .eq("presupuesto_id", detailOC.presupuesto_origen_id);
          if (freshItems && prItems) {
            for (const ocIt of freshItems) {
              const ocDesc = (ocIt.descripcion || "").toLowerCase().trim();
              const prIt = prItems.find((p: any) => (p.descripcion || "").toLowerCase().trim() === ocDesc);
              if (prIt && Number(prIt.precio_costo) !== Number(ocIt.precio_unitario)) {
                await supabase
                  .from("presupuesto_items")
                  .update({ precio_costo: Number(ocIt.precio_unitario) } as any)
                  .eq("id", prIt.id);
              }
            }
          }
        } catch (cascadeErr) {
          console.error("Error cascading OC changes to PR:", cascadeErr);
        }
      }

      setEditMode(false);
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Error al guardar cambios");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleChangeOperador = async (ocId: string, newCreatedBy: string) => {
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de cambiar el operador"); return; }
    try {
      const { error } = await (supabase as any).from("ordenes_compra").update({ created_by: newCreatedBy || null }).eq("id", ocId).eq("sociedad_id", sociedadActiva.id);
      if (error) throw error;
      if (detailOC?.id === ocId) {
        const prof = allProfiles.find(p => p.id === newCreatedBy);
        setDetailOC({ ...detailOC, created_by: newCreatedBy || null, created_by_profile: prof ? { full_name: prof.full_name } : null });
      }
      await fetchData();
    } catch (err: any) {
      console.error("Error al cambiar operador:", err);
      alert("Error al cambiar operador: " + (err.message || err.code || "error de red, intentá de nuevo"));
    }
  };

  const handleSyncFromFC = async (oc: OCRow) => {
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de sincronizar la OC"); return; }
    try {
      // Buscar FC vinculada a esta OC
      const { data: links } = await (supabase as any)
        .from("factura_compra_ocs")
        .select("facturas_compra(id, moneda, subtotal, iva, total, estado)")
        .eq("orden_compra_id", oc.id);
      const fcs = (links || [])
        .map((l: any) => (Array.isArray(l.facturas_compra) ? l.facturas_compra[0] : l.facturas_compra))
        .filter((fc: any) => fc && fc.estado !== "anulada");
      if (fcs.length === 0) {
        // Try legacy column
        const { data: legacyFCs } = await (supabase as any)
          .from("facturas_compra")
          .select("id, moneda, subtotal, iva, total, estado")
          .eq("orden_compra_id", oc.id)
          .neq("estado", "anulada");
        if (!legacyFCs || legacyFCs.length === 0) { alert("No se encontró factura de compra vinculada a esta OC"); return; }
        fcs.push(...legacyFCs);
      }
      const fc = fcs[0];
      if (!confirm(`¿Actualizar la OC a moneda ${fc.moneda}?`)) return;
      const { error } = await (supabase as any)
        .from("ordenes_compra")
        .update({ moneda: fc.moneda } as any)
        .eq("id", oc.id)
        .eq("sociedad_id", sociedadActiva.id);
      if (error) throw error;
      // Refresh
      const { data: freshOC } = await supabase
        .from("ordenes_compra")
        .select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision), orden_compra_items(cantidad, cantidad_recibida)")
        .eq("id", oc.id)
        .single();
      if (freshOC) setDetailOC(freshOC as unknown as OCRow);
      await fetchData();
    } catch (err: any) {
      alert(err.message || "Error al sincronizar moneda");
    }
  };

  const buildOCSummaryText = (oc: OCRow) => {
    const prov = oc.proveedores;
    const proveedorLabel = purchaseOrderProviderLabel(oc);
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
      `*Proveedor:* ${proveedorLabel}`,
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
    const proveedorLabel = purchaseOrderProviderLabel(oc);
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
        razon_social: proveedorLabel,
        cuit: prov.cuit,
        condicion_iva: prov.condicion_iva,
        direccion: prov.direccion,
        localidad: prov.localidad,
        provincia: prov.provincia,
        email: prov.email,
        telefono: prov.telefono,
        forma_pago: prov.forma_pago,
      } : { razon_social: proveedorLabel },
      items: detailItems.map(it => ({
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precio_unitario: Number(it.precio_unitario),
        subtotal: Number(it.subtotal),
      })),
    }, soc);
    openPDFWindow(html, `${oc.numero}.pdf`);
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de actualizar el pedido"); return; }
    const newVal = !oc.pedido;
    try {
      const { error } = await (supabase as any)
        .from("ordenes_compra")
        .update({ pedido: newVal } as any)
        .eq("id", oc.id)
        .eq("sociedad_id", sociedadActiva.id);
      if (error) throw error;
      setOrdenes((prev) =>
        prev.map((o) => (o.id === oc.id ? { ...o, pedido: newVal } : o))
      );
      if (detailOC?.id === oc.id) setDetailOC({ ...oc, pedido: newVal });
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al actualizar pedido");
    }
  };

  // ── Pago directo con tarjeta (sin orden de pago) ────────────────
  const handleTogglePagoTarjeta = async (oc: OCRow, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de actualizar el pago"); return; }
    const marcarPagada = !ocPagadaConTarjeta(oc);
    try {
      const pagoPatch = {
        estado_pago: marcarPagada ? "pagada" : "pendiente",
        medio_pago: marcarPagada ? "tarjeta" : null,
        pagada_at: marcarPagada ? new Date().toISOString() : null,
      };
      const { error } = await (supabase as any).from("ordenes_compra").update(pagoPatch).eq("id", oc.id).eq("sociedad_id", sociedadActiva.id);
      if (error) throw error;
      setOrdenes((prev) => prev.map((row) => row.id === oc.id ? { ...row, ...pagoPatch } as OCRow : row));
      if (detailOC?.id === oc.id) setDetailOC((prev) => prev ? { ...prev, ...pagoPatch } as OCRow : prev);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al actualizar el pago");
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de guardar la nota"); return; }
    setSavingNota(true);
    try {
      const { error } = await (supabase as any)
        .from("ordenes_compra")
        .update({ notas_recepcion: notaPopoverText || null } as any)
        .eq("id", notaPopoverId)
        .eq("sociedad_id", sociedadActiva.id);
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
      `*Proveedor:* ${purchaseOrderProviderLabel(oc)}`,
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad"); return; }
    setConsolidateOpen(true);
    setConsolidateLoading(true);
    try {
      // Get approved presupuestos that have items with proveedor_id
      let prQuery = (supabase as any)
        .from("presupuestos")
        .select("id, numero, cliente_id, moneda, modalidad_emision, clientes(razon_social)")
        .eq("estado", "aprobado");
      if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: prs, error: prsError } = await prQuery;
      if (prsError) throw prsError;

      if (!prs || prs.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Get all presupuesto items with proveedor
      const prIds = prs.map((p: any) => p.id);
      const { data: items, error: pendingItemsError } = await (supabase as any)
        .from("presupuesto_items")
        .select("id, presupuesto_id, codigo, descripcion, cantidad, precio_costo, unidad, proveedor_id, proveedor_nombre, iva_porcentaje, costo_moneda")
        .in("presupuesto_id", prIds)
        .not("proveedor_id", "is", null);
      if (pendingItemsError) throw pendingItemsError;

      if (!items || items.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Get existing non-cancelled OCs with presupuesto_origen_id to know which PR+proveedor combos already have OC
      let existingOCsQuery = supabase
        .from("ordenes_compra")
        .select("presupuesto_origen_id, proveedor_id, observaciones")
        .not("estado", "eq", "cancelada");
      if (sociedadActiva?.id) existingOCsQuery = existingOCsQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { data: existingOCs, error: existingError } = await existingOCsQuery;
      if (existingError) throw existingError;
      const consolidatedIds = new Set((existingOCs || []).flatMap((oc: any) => String(oc.observaciones || "").match(/\[PR_ITEMS:([^\]]+)\]/)?.[1].split(",") || []));
      // Build a set of "presupuesto_id|proveedor_id" keys that already have an OC
      const ocCoveredKeys = new Set(
        (existingOCs || []).filter((oc: any) => !String(oc.observaciones || "").includes("[PR_ITEMS:")).map((oc: any) => `${oc.presupuesto_origen_id}|${oc.proveedor_id}`)
      );

      // Filter out items that already have an OC for their presupuesto+proveedor combo
      const pendingItems = items.filter(
        (item: any) => !consolidatedIds.has(item.id) && !ocCoveredKeys.has(`${item.presupuesto_id}|${item.proveedor_id}`)
      );

      if (pendingItems.length === 0) {
        setConsolidateGroups([]);
        setConsolidateLoading(false);
        return;
      }

      // Build proveedor groups
      const prMap = new Map<string, any>(prs.map((p: any) => [p.id, p]));
      const groups: Record<string, ProveedorGroup> = {};

      for (const item of pendingItems) {
        const pr = prMap.get(item.presupuesto_id);
        if (!pr || !item.proveedor_id) continue;
        const provId = item.proveedor_id as string;
        const itemCostoMoneda = (item.costo_moneda as string) || "ARS";
        const groupKey = `${provId}|${itemCostoMoneda}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            id: groupKey,
            nombre: (item.proveedor_nombre as string) || "Sin nombre",
            moneda: itemCostoMoneda,
            items: [],
            expanded: true,
          };
        }
        groups[groupKey].items.push({
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
          compra_sin_iva: (pr as any).modalidad_emision === "manual",
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
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de consolidar OCs"); return; }
    setConsolidateCreating(true);
    try {
      const today = todayAR();
      let created = 0;

      for (const group of consolidateGroups) {
        const selectedItems = group.items.filter(it => it.selected);
        if (selectedItems.length === 0) continue;

        const { data: currentOrders, error: currentError } = await (supabase as any).from("ordenes_compra")
          .select("presupuesto_origen_id, observaciones").eq("sociedad_id", sociedadActiva.id)
          .eq("proveedor_id", selectedItems[0].proveedor_id).neq("estado", "cancelada");
        if (currentError) throw currentError;
        const coveredIds = new Set((currentOrders || []).flatMap((oc: any) => String(oc.observaciones || "").match(/\[PR_ITEMS:([^\]]+)\]/)?.[1].split(",") || []));
        const coveredPRs = new Set((currentOrders || []).filter((oc: any) => !String(oc.observaciones || "").includes("[PR_ITEMS:")).map((oc: any) => oc.presupuesto_origen_id));
        if (selectedItems.some(it => coveredIds.has(it.item_id) || coveredPRs.has(it.pr_id))) {
          throw new Error("Algún artículo ya tiene una OC. Se actualizó la lista para evitar repetir la compra.");
        }
        if (selectedItems.some(it => !Number.isFinite(Number(it.cantidad)) || Number(it.cantidad) <= 0 || !Number.isFinite(Number(it.precio_costo)) || Number(it.precio_costo) < 0)) {
          throw new Error("Revisá cantidades y costos de los artículos antes de consolidar.");
        }

        const subtotal = selectedItems.reduce((sum, it) => sum + it.precio_costo * it.cantidad, 0);
        const iva = selectedItems.reduce((sum, it) => {
          const lineSubtotal = it.precio_costo * it.cantidad;
          const ivaPct = it.compra_sin_iva ? 0 : (it.iva_porcentaje ?? 21) / 100;
          return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
        }, 0);

        // Get unique PR IDs for observaciones and origin linking
        const prNums = [...new Set(selectedItems.map(it => it.pr_numero))];
        const prIds = [...new Set(selectedItems.map(it => it.pr_id))];
        const obs = `Consolidado de ${prNums.length} presupuesto(s): ${prNums.join(", ")} [PR_ITEMS:${selectedItems.map(it => it.item_id).join(",")}]`;

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: selectedItems[0].proveedor_id,
            fecha: today,
            moneda: group.moneda,
            estado: "enviada",
            subtotal: Math.round(subtotal * 100) / 100,
            iva,
            total: Math.round((subtotal + iva) * 100) / 100,
            observaciones: obs,
            sociedad_id: sociedadActiva.id,
            presupuesto_origen_id: prIds.length === 1 ? prIds[0] : null,
            created_by: profile?.id || null,
          } as any)
          .select("id")
          .single();

        if (ocErr || !ocRow) throw new Error(ocErr?.message || `No se pudo crear la OC de ${group.nombre}`);

        // Insert items
        const ocItems = selectedItems.map((it, idx) => ({
          orden_id: ocRow.id,
          codigo: it.codigo,
          descripcion: `${it.descripcion} [${it.pr_numero} - ${it.cliente_nombre}]`,
          cantidad: it.cantidad,
          cantidad_recibida: 0,
          unidad: it.unidad,
          precio_unitario: it.precio_costo,
          iva_porcentaje: it.compra_sin_iva ? 0 : it.iva_porcentaje ?? 21,
          orden: idx,
        }));

        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error al insertar items de OC consolidada:", itemsErr);
          const { error: cleanupError } = await (supabase as any).from("ordenes_compra").delete().eq("id", ocRow.id).eq("sociedad_id", sociedadActiva.id);
          throw new Error(`No se guardaron los artículos de ${group.nombre}: ${itemsErr.message}${cleanupError ? ". Revisar OC incompleta: " + ocRow.id : ""}`);
        }
        created++;
      }

      setConsolidateOpen(false);
      await fetchData();
      if (created > 0) setConsolidateSuccessMsg(`Se crearon ${created} OC(s) consolidada(s)`);
    } catch (err) {
      await fetchData();
      await openConsolidateModal();
      alert("Error al crear OCs consolidadas: " + (err instanceof Error ? err.message : String(err)));
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
      // Primero toma OCs ya creadas que siguen sin proveedor. Este era el caso
      // que quedaba invisible cuando el item original del PR ya estaba asignado.
      let ocQuery = (supabase as any)
        .from("ordenes_compra")
        .select("id, numero, moneda, observaciones, presupuesto_origen_id, orden_compra_items(id, codigo, descripcion, cantidad, precio_unitario, unidad, proveedor_id)")
        .is("proveedor_id", null)
        .neq("estado", "cancelada")
        .order("created_at", { ascending: false });
      if (sociedadActiva?.id) ocQuery = ocQuery.eq("sociedad_id", sociedadActiva.id);
      const { data: ocsSinProveedor, error: ocError } = await ocQuery;
      if (ocError) throw ocError;

      const itemsDeOC: ItemSinProveedor[] = (ocsSinProveedor || []).filter((oc: any) => !isOwnStockPurchaseOrder(oc)).flatMap((oc: any) =>
        (oc.orden_compra_items || [])
          .filter((item: any) => !item.proveedor_id)
          .map((item: any) => ({
            origen: "orden_compra" as const,
            item_id: item.id,
            oc_id: oc.id,
            pr_id: oc.presupuesto_origen_id || "",
            pr_numero: oc.numero || "OC sin numero",
            cliente_nombre: "Orden de compra ya creada",
            codigo: item.codigo || "",
            descripcion: item.descripcion || "",
            cantidad: Number(item.cantidad || 0),
            precio_costo: Number(item.precio_unitario || 0),
            unidad: item.unidad || "UN",
            moneda: oc.moneda || "ARS",
            proveedor_id: "",
          }))
      );

      // También incluye items de PR aprobados que todavía no generaron una OC.
      let prQuery = (supabase as any).from("presupuestos").select("id, numero, moneda, clientes(razon_social)").in("estado", ["aprobado", "remitido"]);
      if (sociedadActiva?.id) prQuery = prQuery.eq("sociedad_id", sociedadActiva.id);
      const { data: prs } = await prQuery;
      if (!prs || prs.length === 0) { setSinProveedorItems(itemsDeOC); return; }

      const prIds = prs.map((p: any) => p.id);
      const { data: items } = await supabase
        .from("presupuesto_items")
        .select("id, presupuesto_id, codigo, descripcion, cantidad, precio_costo, unidad, proveedor_id, costo_moneda, stock_propio" as any)
        .in("presupuesto_id", prIds) as { data: any[] | null };

      const prsConOC = new Set(ordenes.map((oc) => oc.presupuesto_origen_id).filter(Boolean));
      const sinProv = (items || []).filter((it: any) => !it.proveedor_id && !it.stock_propio && !prsConOC.has(it.presupuesto_id));
      const prMap = new Map((prs as any[]).map((p: any) => [p.id, p]));

      const itemsDePR: ItemSinProveedor[] = sinProv.map((it: any) => {
        const pr = prMap.get(it.presupuesto_id) as any;
        return {
          origen: "presupuesto" as const,
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
      });
      setSinProveedorItems([...itemsDeOC, ...itemsDePR]);

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
    const toUpdate = sinProveedorItems.filter(it => it.proveedor_id || (it as any)._stockPropio);
    if (toUpdate.length === 0) return;
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de asignar proveedores"); return; }
    setSinProveedorSaving(true);
    try {
      // Get proveedor names
      const provIds = [...new Set(toUpdate.filter(it => it.proveedor_id).map(it => it.proveedor_id))];
      const provNameMap = new Map(sinProveedorProvs.map(p => [p.id, p.razon_social]));

      let updated = 0;
      for (const item of toUpdate) {
        // Stock propio: mark on presupuesto_items
        if ((item as any)._stockPropio && item.origen === "presupuesto") {
          const { error } = await (supabase as any)
            .from("presupuesto_items")
            .update({ stock_propio: true })
            .eq("id", item.item_id);
          if (error) throw new Error(`No se pudo marcar stock propio en ${item.descripcion}: ${error.message}`);
          updated++;
          continue;
        }
        const tabla = item.origen === "orden_compra" ? "orden_compra_items" : "presupuesto_items";
        const payload = item.origen === "orden_compra"
          ? { proveedor_id: item.proveedor_id }
          : { proveedor_id: item.proveedor_id, proveedor_nombre: provNameMap.get(item.proveedor_id) || "" };
        const { error } = await (supabase as any)
          .from(tabla)
          .update({
            ...payload,
          })
          .eq("id", item.item_id);
        if (error) throw new Error(`No se pudo asignar el proveedor a ${item.descripcion}: ${error.message}`);
        updated++;
      }

      // Si todos los items de una OC quedaron con el mismo proveedor, también
      // completa el encabezado para que deje de figurar "Sin proveedor".
      const ocIds = [...new Set(toUpdate.filter((item) => item.oc_id).map((item) => item.oc_id as string))];
      for (const ocId of ocIds) {
        const { data: ocItems, error: ocItemsError } = await (supabase as any)
          .from("orden_compra_items")
          .select("proveedor_id")
          .eq("orden_id", ocId);
        if (ocItemsError) throw ocItemsError;
        const providerIds = [...new Set((ocItems || []).map((item: any) => item.proveedor_id).filter(Boolean))];
        const hasMissing = (ocItems || []).some((item: any) => !item.proveedor_id);
        if (!hasMissing && providerIds.length === 1) {
          const { error: headerError } = await (supabase as any).from("ordenes_compra").update({ proveedor_id: providerIds[0] }).eq("id", ocId).eq("sociedad_id", sociedadActiva.id);
          if (headerError) throw headerError;
        }
      }
      if (updated > 0) {
        setSinProveedorItems(prev => prev.filter(it => !it.proveedor_id));
        setConsolidateSuccessMsg(`Se asignó proveedor a ${updated} item(s)`);
        await fetchData();
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

  // ── Asignar proveedor a item de OC ─────────────────────────────
  const handleItemProveedorChange = async (itemId: string, provId: string) => {
    if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de asignar proveedores"); return; }
    if (!detailOC) return;
    if (detailOC.sociedad_id && detailOC.sociedad_id !== sociedadActiva.id) { alert("La OC no pertenece a la sociedad activa"); return; }
    const { error } = await supabase.from("orden_compra_items").update({ proveedor_id: provId || null } as any).eq("id", itemId);
    if (error) { alert("Error al asignar proveedor al item"); return; }
    setDetailItems(prev => prev.map(it => it.id === itemId ? { ...it, proveedor_id: provId || null } : it));
  };

  // ── Dividir OC por proveedor ──────────────────────────────────
  const [dividiendo, setDividiendo] = useState(false);
  const handleDividirPorProveedor = async () => {
    if (!detailOC || !sociedadActiva) return;
    // Agrupa lo asignado y conserva por separado lo que todavia no tiene proveedor.
    const groups = new Map<string, DetailItem[]>();
    const sinProveedor: DetailItem[] = [];
    for (const item of detailItems) {
      if (!item.proveedor_id) { sinProveedor.push(item); continue; }
      const list = groups.get(item.proveedor_id) || [];
      list.push(item);
      groups.set(item.proveedor_id, list);
    }

    if (groups.size === 0) {
      alert("Asigná al menos un proveedor a uno de los items para poder dividir la OC.");
      return;
    }

    if (groups.size === 1 && sinProveedor.length === 0) {
      // All items same proveedor — just assign to the OC header
      const provId = [...groups.keys()][0];
      if (provId && !detailOC.proveedor_id) {
    const { error } = await (supabase as any).from("ordenes_compra").update({ proveedor_id: provId }).eq("id", detailOC.id).eq("sociedad_id", sociedadActiva.id);
        if (error) { alert("Error al asignar proveedor"); return; }
        const { data: fresh } = await supabase.from("ordenes_compra").select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision), orden_compra_items(cantidad, cantidad_recibida)").eq("id", detailOC.id).single();
        if (fresh) setDetailOC(fresh as any);
        await fetchData();
        alert("Todos los items son del mismo proveedor. Se asignó a la OC.");
      } else {
        alert("Todos los items son del mismo proveedor. No es necesario dividir.");
      }
      return;
    }

    const divisionMessage = sinProveedor.length > 0
      ? `Se crearán ${groups.size} OC(s), una por cada proveedor asignado. Los ${sinProveedor.length} item(s) restantes seguirán en ${detailOC.numero} sin proveedor. ¿Continuar?`
      : `Se crearán ${groups.size} OC(s) nuevas, una por proveedor, y se reemplazará ${detailOC.numero}. ¿Continuar?`;
    if (!confirm(divisionMessage)) return;

    setDividiendo(true);
    const createdOcIds: string[] = [];
    let originalModified = false;
    try {
      const today = todayAR();
      let created = 0;
      for (const [provId, items] of groups) {
        const subtotal = items.reduce((sum, it) => sum + Number(it.precio_unitario) * Number(it.cantidad), 0);
        const iva = ocCompraSinIva(detailOC) ? 0 : items.reduce((sum, it) => {
          const lineSubtotal = Number(it.precio_unitario) * Number(it.cantidad);
          const ivaPct = (it.iva_porcentaje ?? 21) / 100;
          return sum + Math.round(lineSubtotal * ivaPct * 100) / 100;
        }, 0);

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: provId,
            fecha: detailOC.fecha || today,
            fecha_entrega_estimada: detailOC.fecha_entrega_estimada || null,
            moneda: detailOC.moneda,
            estado: "enviada",
            subtotal: Math.round(subtotal * 100) / 100,
            iva,
            total: Math.round((subtotal + iva) * 100) / 100,
            observaciones: detailOC.observaciones || `Dividida de ${detailOC.numero}`,
            sociedad_id: sociedadActiva.id,
            presupuesto_origen_id: detailOC.presupuesto_origen_id || null,
            created_by: profile?.id || null,
          } as any)
          .select("id")
          .single();

        if (ocErr || !ocRow) {
          throw new Error(`Error al crear OC para proveedor: ${ocErr?.message || "sin datos"}`);
        }
        createdOcIds.push(ocRow.id);

        const ocItems = items.map((it, idx) => ({
          orden_id: ocRow.id,
          codigo: it.codigo,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          cantidad_recibida: it.cantidad_recibida,
          unidad: it.unidad || "u",
          precio_unitario: it.precio_unitario,
          producto_id: it.producto_id || null,
          iva_porcentaje: ocCompraSinIva(detailOC) ? 0 : it.iva_porcentaje ?? 21,
          proveedor_id: provId,
          orden: idx,
        }));
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) throw new Error(`Error al insertar items: ${itemsErr.message}`);
        created++;
      }

      if (sinProveedor.length > 0) {
        // Quita de la OC original solamente los items que ya fueron separados.
        const assignedIds = detailItems.filter((item) => item.proveedor_id).map((item) => item.id);
        const { error: deleteAssignedError } = await supabase.from("orden_compra_items").delete().in("id", assignedIds);
        if (deleteAssignedError) throw new Error(`Error al separar items de la OC original: ${deleteAssignedError.message}`);
        originalModified = true;

        const subtotalRestante = sinProveedor.reduce((sum, item) => sum + Number(item.precio_unitario) * Number(item.cantidad), 0);
        const ivaRestante = ocCompraSinIva(detailOC) ? 0 : sinProveedor.reduce((sum, item) => {
          const subtotalItem = Number(item.precio_unitario) * Number(item.cantidad);
          return sum + Math.round(subtotalItem * ((item.iva_porcentaje ?? 21) / 100) * 100) / 100;
        }, 0);
        const { error: updateOriginalError } = await (supabase as any).from("ordenes_compra").update({
          proveedor_id: null,
          subtotal: Math.round(subtotalRestante * 100) / 100,
          iva: Math.round(ivaRestante * 100) / 100,
          total: Math.round((subtotalRestante + ivaRestante) * 100) / 100,
        } as any).eq("id", detailOC.id).eq("sociedad_id", sociedadActiva.id);
        if (updateOriginalError) throw new Error(`Error al actualizar la OC restante: ${updateOriginalError.message}`);

        await fetchDetailItems(detailOC.id);
        const { data: freshOriginal } = await supabase.from("ordenes_compra")
          .select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision), orden_compra_items(cantidad, cantidad_recibida)")
          .eq("id", detailOC.id).single();
        if (freshOriginal) setDetailOC(freshOriginal as unknown as OCRow);
        await fetchData();
        alert(`Se crearon ${created} OC(s). ${detailOC.numero} conserva ${sinProveedor.length} item(s) sin proveedor.`);
      } else {
        const { error: deleteItemsError } = await supabase.from("orden_compra_items").delete().eq("orden_id", detailOC.id);
        if (deleteItemsError) throw new Error(`Error al reemplazar items de la OC original: ${deleteItemsError.message}`);
        originalModified = true;
      const { error: deleteOCError } = await (supabase as any).from("ordenes_compra").delete().eq("id", detailOC.id).eq("sociedad_id", sociedadActiva.id);
        if (deleteOCError) throw new Error(`Error al reemplazar la OC original: ${deleteOCError.message}`);

        setDetailOC(null);
        setPanelFullscreen(false);
        await fetchData();
        alert(`Se crearon ${created} OC(s) nuevas, una por cada proveedor.`);
      }
    } catch (err) {
      // Si la division fallo antes de modificar la OC original, limpia las OCs nuevas incompletas.
      if (!originalModified && createdOcIds.length > 0) {
        await supabase.from("orden_compra_items").delete().in("orden_id", createdOcIds);
        let cleanupOCs = (supabase as any).from("ordenes_compra").delete().in("id", createdOcIds).eq("sociedad_id", sociedadActiva.id);
        await cleanupOCs;
      }
      alert("Error al dividir OC: " + (err as any)?.message);
    } finally {
      setDividiendo(false);
    }
  };

  // ── Computed ─────────────────────────────────────────────────────
  const filtered = ordenes.filter((oc) => {
    if (filter !== "todas") {
      if (filter === "pagada") {
        if (!ocPagada(oc)) return false;
      } else if (filter === "pago_pendiente") {
        if (ocPagada(oc) || oc.estado === "cancelada") return false;
      } else if (oc.estado !== filter) return false;
    }
    if (search.trim()) {
      const needle = search.trim().toLocaleLowerCase("es");
      const searchable = [
        oc.numero,
        purchaseOrderProviderLabel(oc),
        oc.proveedores?.razon_social,
        oc.proveedores?.cuit,
        oc.proveedores?.email,
        oc.presupuesto_origen?.numero,
        oc.created_by_profile?.full_name,
        oc.observaciones,
        ...oc.orden_compra_items.flatMap((item) => [item.codigo, item.descripcion]),
      ].filter(Boolean).join(" ").toLocaleLowerCase("es");
      if (!searchable.includes(needle)) return false;
    }
    if (operadorFilter && oc.created_by !== operadorFilter) return false;
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

  const operadores = Array.from(
    new Map(
      ordenes
        .filter((oc) => oc.created_by && oc.created_by_profile?.full_name)
        .map((oc) => [oc.created_by as string, oc.created_by_profile!.full_name])
    )
  ).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const ocEsteMes = ordenes.filter((oc) => {
    const d = new Date(oc.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const ocPendientes = ordenes.filter((oc) => ["pendiente", "enviada", "confirmada"].includes(oc.estado));
  const totalPendienteARS = ocPendientes.filter(oc => oc.moneda !== "USD").reduce((a, oc) => a + Number(oc.total), 0);
  const totalPendienteUSD = ocPendientes.filter(oc => oc.moneda === "USD").reduce((a, oc) => a + Number(oc.total), 0);
  const pendientesRecepcion = ordenes.filter((oc) =>
    ["pendiente", "enviada", "confirmada", "recibida_parcial"].includes(oc.estado)
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
        action={canManageCompras ? { label: "Nueva OC", onClick: openCreateModal } : undefined}
      />

      {/* Secondary action bar */}
      {canManageCompras && <div className="px-4 sm:px-8 pt-2 flex justify-end gap-3">
        <button
          onClick={() => setConciliarOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Conciliar facturas (IA)
        </button>
        <button
          onClick={() => { setCargarFCPreselectedId(undefined); setCargarFCOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Upload className="h-4 w-4" />
          Cargar factura
        </button>
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
      </div>}

      <div className="p-4 sm:p-8 space-y-6">
        {facturaLinksError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{facturaLinksError}</span>
            <button onClick={fetchData} className="ml-auto shrink-0 font-semibold underline">Reintentar</button>
          </div>
        )}
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
            ["pendiente", "enviada", "confirmada", "recibida_parcial"].includes(oc.estado)
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
          <StatCard title="Monto pendiente" value={`${formatCurrency(totalPendienteARS, "ARS")}${totalPendienteUSD > 0 ? ` + ${formatCurrency(totalPendienteUSD, "USD")}` : ""}`} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Pend. recepcion" value={String(pendientesRecepcion)} icon={Truck} iconColor="text-violet-600" />
          <StatCard title="Recibidas completas" value={String(ordenes.filter((oc) => oc.estado === "recibida").length)} icon={CheckCircle2} iconColor="text-emerald-600" />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["todas", "recibida_parcial", "recibida", "pago_pendiente", "pagada", "cancelada"] as const).map((status) => {
            const count = status === "todas" ? ordenes.length : ordenes.filter((oc) => status === "pagada" ? ocPagada(oc) : status === "pago_pendiente" ? !ocPagada(oc) && oc.estado !== "cancelada" : oc.estado === status).length;
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
                {status === "todas" ? "Todas" : status === "pagada" ? "Pagadas" : status === "pago_pendiente" ? "Pago pendiente" : (statusConfig[status] || { label: status }).label}
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${filter === status ? "bg-white/20" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] max-w-lg flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por N° OC, proveedor, PR o items..."
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <select
            value={operadorFilter}
            onChange={(event) => setOperadorFilter(event.target.value)}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los operadores</option>
            {operadores.map((operador) => <option key={operador.id} value={operador.id}>{operador.nombre}</option>)}
          </select>
        </div>

        <SmartFilters filters={smartFilterConfigs} values={smartFilterValues} onChange={setSmartFilterValues} />

        {/* Data table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<OCRow>
            columns={[
              {
                key: "fecha",
                label: "Fecha",
                sortable: true,
                sortValue: (row) => row.fecha || "",
                render: (row) => <span className="text-zinc-500">{formatDate(row.fecha)}</span>,
              },
              {
                key: "numero",
                label: "Orden de compra",
                sortable: true,
                sortValue: (row) => row.numero || "",
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-zinc-400" />
                    <span className="font-mono text-xs font-bold">{row.numero}</span>
                  </div>
                ),
              },
              {
                key: "presupuesto_origen_id",
                label: "PR origen",
                sortable: true,
                sortValue: (row) => row.presupuesto_origen?.numero || "",
                render: (row) =>
                  row.presupuesto_origen ? (
                    <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{(row.presupuesto_origen as { numero: string }).numero}</span>
                  ) : (
                    <span className="text-zinc-300">{"\u2014"}</span>
                  ),
              },
              {
                key: "proveedores",
                label: "Proveedor",
                sortable: true,
                sortValue: (row) => purchaseOrderProviderLabel(row),
                render: (row) => (
                  <div>
                    <span className={`font-medium ${!row.proveedores?.razon_social && !isOwnStockPurchaseOrder(row) ? "text-amber-500 italic" : isOwnStockPurchaseOrder(row) ? "text-blue-600 dark:text-blue-400" : ""}`}>{purchaseOrderProviderLabel(row)}</span>
                    {row.proveedores?.email && (
                      <a href={`mailto:${row.proveedores.email}`} className="text-xs text-zinc-400 hover:text-orange-500 truncate max-w-[200px] block" onClick={(e) => e.stopPropagation()}>{row.proveedores.email}</a>
                    )}
                  </div>
                ),
              },
              {
                key: "orden_compra_items",
                label: "Detalle",
                sortable: true,
                sortValue: (row) => row.orden_compra_items.map((item) => item.descripcion || item.codigo || "").join(" "),
                render: (row) => {
                  const descripciones = row.orden_compra_items.map((item) => item.descripcion || item.codigo).filter(Boolean) as string[];
                  const detalle = descripciones.length > 0 ? descripciones.slice(0, 2).join(", ") : `${row.orden_compra_items.length} items`;
                  return (
                    <div className="flex max-w-[320px] items-center gap-1.5" title={descripciones.join(", ")}>
                      <span className="truncate text-zinc-600 dark:text-zinc-300">{detalle}</span>
                      {descripciones.length > 2 && <span className="shrink-0 text-xs text-zinc-400">+{descripciones.length - 2}</span>}
                      {row.observaciones && (
                        <span title={row.observaciones} className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                          <MessageSquare className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: "created_by",
                label: "Operador",
                sortable: true,
                sortValue: (row) => row.created_by_profile?.full_name || "",
                render: (row) => <span className="font-medium">{row.created_by_profile?.full_name || "—"}</span>,
              },
              {
                key: "total",
                label: "Total",
                sortable: true,
                sortValue: (row) => Number(row.total),
                className: "text-right",
                render: (row) => (
                  <span className="font-mono font-semibold block text-right">
                    {formatCurrency(Number(row.total), row.moneda as "ARS" | "USD")}
                  </span>
                ),
              },
              {
                key: "facturas_vinculadas" as any,
                label: "Pago",
                sortable: true,
                sortValue: (row) => ocPagadaConTarjeta(row) ? "2 tarjeta" : ocPagada(row) ? "1 pagada" : "0 pendiente",
                render: (row) => {
                  if (row.estado === "cancelada") return <span className="text-zinc-300">—</span>;
                  if (ocPagadaConTarjeta(row)) {
                    return <Badge variant="success"><CreditCard className="mr-1 h-3 w-3" /> Pagada · Tarjeta</Badge>;
                  }
                  if (ocPagada(row)) return <Badge variant="success"><Check className="mr-1 h-3 w-3" /> Pagada</Badge>;
                  return <Badge variant="warning">Pendiente</Badge>;
                },
              },
              {
                key: "estado",
                label: "Pedido",
                sortable: true,
                sortValue: (row) => row.pedido ? 1 : 0,
                render: (row) => {
                  const isPedido = row.pedido ?? false;
                  if (!canManageCompras) {
                    return (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isPedido
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}>
                        {isPedido ? <><Check className="h-3 w-3" /> Si</> : <><X className="h-3 w-3" /> No</>}
                      </span>
                    );
                  }
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
                sortable: true,
                sortValue: (row) => {
                  const totalQty = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad), 0);
                  const recibido = row.orden_compra_items.reduce((a, i) => a + Number(i.cantidad_recibida), 0);
                  return totalQty > 0 ? recibido / totalQty : 0;
                },
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
                      {canManageCompras && (recibido > 0 || isLate) && row.estado !== "recibida" && (
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
                key: "observaciones",
                label: "FC",
                sortable: true,
                sortValue: (row) => (row.facturas_vinculadas || []).filter(f => f.estado !== "anulada").length,
                render: (row) => {
                  const fcs = (row.facturas_vinculadas || []).filter(f => f.estado !== "anulada");
                  if (row.estado === "cancelada") return <span className="text-zinc-300">{"\u2014"}</span>;
                  if (row.facturas_vinculadas_estado === "desconocido") return <span title="No se pudieron verificar los vínculos de facturas" className="text-amber-500"><AlertTriangle className="h-4 w-4" /></span>;
                  return fcs.length > 0
                    ? <span title="Factura compra cargada" className="text-emerald-500"><Check className="h-4 w-4" /></span>
                    : <span title="Sin factura compra" className="text-zinc-300"><X className="h-3.5 w-3.5" /></span>;
                },
              },
              {
                key: "created_at" as any,
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
            ]}
            data={filtered}
            onRowClick={handleRowClick}
          />
        </Card>
      </div>

      {/* ── Create OC Modal ─────────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-lg font-semibold dark:text-white">Nueva Orden de Compra</h2>
              <button onClick={() => setCreateOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {formError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{formError}</div>}
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Proveedor *</label>
                <ProveedorPicker value={formData.proveedor_id} options={proveedores} onChange={(proveedor_id) => {
                  const proveedor = proveedores.find((item) => item.id === proveedor_id);
                  const esMercadoLibre = proveedor?.razon_social.trim().toLowerCase() === "mercado libre";
                  setFormData((prev) => ({ ...prev, proveedor_id, pagada_con_tarjeta: esMercadoLibre ? true : prev.pagada_con_tarjeta }));
                }} />
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
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <input type="checkbox" checked={formData.pagada_con_tarjeta} onChange={(event) => setFormData((prev) => ({ ...prev, pagada_con_tarjeta: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-orange-600" />
                <span className="text-sm dark:text-zinc-200">
                  <strong className="flex items-center gap-1.5"><CreditCard className="h-4 w-4" /> Ya pagada con tarjeta</strong>
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">Queda pagada desde la OC, sin generar una orden de pago.</span>
                </span>
              </label>
              {/* ── Items section (only when NOT linked to a PR) ──── */}
              {!formData.presupuesto_origen_id && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium dark:text-zinc-300">Items</label>
                    <div className="flex items-center gap-2">
                      <input ref={importCreateOCRef} type="file" accept=".html,.htm,.pdf,image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCreateCotizacion(f); }} />
                      <button type="button" onClick={() => importCreateOCRef.current?.click()} disabled={importingCreateOC}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50">
                        {importingCreateOC ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {importingCreateOC ? "Leyendo..." : "Importar cotización"}
                      </button>
                      <button type="button" onClick={() => setCreateItems(prev => [...prev, { _key: `ci_${Date.now()}`, codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, unidad: "u", iva_porcentaje: 21 }])}
                        className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                        <Plus className="h-3 w-3" /> Agregar item
                      </button>
                    </div>
                  </div>
                  {createItems.length > 0 ? (
                    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-zinc-50 dark:bg-zinc-800 text-left text-xs text-zinc-500 uppercase">
                            <th className="px-2 py-1.5">Código</th>
                            <th className="px-2 py-1.5">Descripción</th>
                            <th className="px-2 py-1.5 text-right">Cant.</th>
                            <th className="px-2 py-1.5 text-right">P. Unit.</th>
                            <th className="px-2 py-1.5 text-right">IVA %</th>
                            <th className="px-2 py-1.5 text-right">Subtotal</th>
                            <th className="px-2 py-1.5 w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {createItems.map((item, idx) => (
                            <tr key={item._key} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                              <td className="px-2 py-1.5">
                                <input type="text" value={item.codigo}
                                  onChange={(e) => setCreateItems(prev => prev.map((it, i) => i === idx ? { ...it, codigo: e.target.value } : it))}
                                  placeholder="Código" className="w-20 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-1 text-xs font-mono dark:text-white" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="text" value={item.descripcion}
                                  onChange={(e) => setCreateItems(prev => prev.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))}
                                  placeholder="Descripción" className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-1 text-xs dark:text-white" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="number" step="any" min={0} value={item.cantidad}
                                  onChange={(e) => setCreateItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) || 0 } : it))}
                                  className="w-16 text-right rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-1 text-xs dark:text-white" />
                              </td>
                              <td className="px-2 py-1.5">
                                <input type="number" step="any" min={0} value={item.precio_unitario}
                                  onChange={(e) => setCreateItems(prev => prev.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) || 0 } : it))}
                                  className="w-24 text-right rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1.5 py-1 text-xs font-mono dark:text-white" />
                              </td>
                              <td className="px-2 py-1.5">
                                <select value={item.iva_porcentaje}
                                  onChange={(e) => setCreateItems(prev => prev.map((it, i) => i === idx ? { ...it, iva_porcentaje: Number(e.target.value) } : it))}
                                  className="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-1 text-xs dark:text-white">
                                  <option value={0}>0%</option>
                                  <option value={10.5}>10,5%</option>
                                  <option value={21}>21%</option>
                                  <option value={27}>27%</option>
                                </select>
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono text-xs">
                                {formatCurrency(item.cantidad * item.precio_unitario, formData.moneda)}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <button type="button" onClick={() => setCreateItems(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-red-400 hover:text-red-600">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Totals */}
                      <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm">
                        <div className="flex justify-end gap-6">
                          <span className="text-zinc-500">Subtotal: <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{formatCurrency(createItemsSubtotal, formData.moneda)}</span></span>
                          <span className="text-zinc-500">IVA: <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{formatCurrency(createItemsIva, formData.moneda)}</span></span>
                          <span className="text-zinc-500">Total: <span className="font-mono font-bold text-orange-600">{formatCurrency(createItemsTotal, formData.moneda)}</span></span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 text-center py-3 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg">
                      Sin items — agregá items manualmente o importá una cotización
                    </p>
                  )}
                </div>
              )}
              {formData.presupuesto_origen_id && (
                <p className="text-xs text-zinc-400 italic">Los items se importarán automáticamente del presupuesto vinculado.</p>
              )}
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
                <h2 className="text-lg font-semibold dark:text-white">Items y OC sin proveedor asignado</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Incluye presupuestos pendientes y órdenes de compra que todavía figuran sin proveedor.</p>
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
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Todos los items y las OC tienen proveedor</p>
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
                            <Badge variant={item.origen === "orden_compra" ? "warning" : "info"}>{item.origen === "orden_compra" ? "OC" : "PR"}</Badge>
                            <span className="text-xs text-zinc-400">{item.cliente_nombre}</span>
                            <span className="text-xs text-zinc-500">{item.cantidad} {item.unidad}</span>
                            {item.precio_costo > 0 && (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400">{formatCurrency(item.precio_costo, item.moneda as "ARS" | "USD")} c/u</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="min-w-[180px]"><ProveedorPicker
                            value={(item as any)._stockPropio ? "" : item.proveedor_id}
                            options={sinProveedorProvs}
                            onChange={(val) => {
                              setSinProveedorItems(prev => prev.map(it =>
                                it.item_id === item.item_id ? { ...it, proveedor_id: val, _stockPropio: false } as any : it
                              ));
                            }}
                            disabled={(item as any)._stockPropio}
                          /></div>
                          {item.origen === "presupuesto" && (
                            <button
                              type="button"
                              onClick={() => {
                                setSinProveedorItems(prev => prev.map(it =>
                                  it.item_id === item.item_id ? { ...it, _stockPropio: !(it as any)._stockPropio, proveedor_id: "" } as any : it
                                ));
                              }}
                              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors ${
                                (item as any)._stockPropio
                                  ? "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/40 dark:text-purple-400 dark:border-purple-700"
                                  : "bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-purple-50 hover:text-purple-600 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700"
                              }`}
                              title="Marcar como stock propio (no genera OC)"
                            >
                              <Package className="h-3 w-3 inline mr-1" />
                              Stock propio
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {sinProveedorItems.length > 0 && !sinProveedorLoading && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-sm text-zinc-500">
                  {sinProveedorItems.filter(it => it.proveedor_id || (it as any)._stockPropio).length} de {sinProveedorItems.length} items asignados
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setSinProveedorOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">
                    Cancelar
                  </button>
                  <button
                    onClick={handleAsignarProveedores}
                    disabled={sinProveedorSaving || sinProveedorItems.every(it => !it.proveedor_id && !(it as any)._stockPropio)}
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
            <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10 space-y-2">
              {/* Row 1: Number + close/fullscreen */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-lg font-semibold font-mono dark:text-white truncate">{detailOC.numero}</h2>
                  <Badge variant={
                    detailOC.estado === "recibida" ? "success"
                    : detailOC.estado === "recibida_parcial" ? "info"
                    : detailOC.estado === "cancelada" ? "danger"
                    : detailOC.estado === "confirmada" ? "purple"
                    : detailOC.estado === "enviada" ? "default"
                    : "outline"
                  }>
                    {detailOC.estado === "borrador" ? "Borrador"
                    : detailOC.estado === "enviada" ? "Activa"
                    : detailOC.estado === "confirmada" ? "Confirmada"
                    : detailOC.estado === "recibida_parcial" ? "Recibida parcial"
                    : detailOC.estado === "recibida" ? "Recibida"
                    : detailOC.estado === "cancelada" ? "Cancelada"
                    : detailOC.estado}
                  </Badge>
                  {ocPagadaConTarjeta(detailOC)
                    ? <Badge variant="success"><CreditCard className="mr-1 h-3 w-3" /> Tarjeta</Badge>
                    : ocPagada(detailOC)
                      ? <Badge variant="success">Pagada</Badge>
                      : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setDetailOC(null); setEditMode(false); setPanelFullscreen(false); }} className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              {/* Row 2: Origin + action icons */}
              <div className="flex items-center justify-between">
                <div>
                  {detailOC.presupuesto_origen && (
                    <p className="text-xs text-zinc-400">
                      Origen: <span className="font-mono text-blue-500">{(detailOC.presupuesto_origen as { numero: string }).numero}</span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {editMode ? (
                    <>
                      <button onClick={handleSaveEdit} disabled={savingEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                        {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar
                      </button>
                      <button onClick={() => setEditMode(false)} disabled={savingEdit}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                        <X className="h-3.5 w-3.5" /> Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      {canManageCompras && !ocTieneFacturaAprobada(detailOC) && (
                        <button onClick={startEditMode}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors" title="Editar OC">
                          <Edit3 className="h-3.5 w-3.5" /> Editar
                        </button>
                      )}
                      {canManageCompras && ocTieneFacturaAprobada(detailOC) && (
                        <span className="flex items-center gap-1 rounded-lg border border-amber-200 px-2 py-1 text-[11px] text-amber-600 dark:border-amber-900/50 dark:text-amber-400" title={detailOC.facturas_vinculadas_estado === "desconocido" ? "No se pudieron verificar los vínculos de facturas" : "La edición está bloqueada por una factura aprobada por Finanzas"}>
                          <Lock className="h-3 w-3" /> {detailOC.facturas_vinculadas_estado === "desconocido" ? "Vínculo sin verificar" : "Edición bloqueada"}
                        </span>
                      )}
                      <button onClick={handleCopySummary} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Copiar resumen">
                        {copiedSummary ? <Check className="h-4 w-4 text-emerald-500" /> : <ClipboardCopy className="h-4 w-4" />}
                      </button>
                      <button onClick={handleDownloadPDF} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Descargar PDF">
                        <Download className="h-4 w-4" />
                      </button>
                      {canManageCompras && <button
                        onClick={async () => {
                          const oc = detailOC;
                          const template = await loadEmailTemplate("orden_compra", sociedadActiva?.id || "");
                          const vars = { numero: oc.numero, sociedad: sociedadActiva?.razonSocial || "Lazzari", total: formatCurrency(oc.total, oc.moneda as "ARS" | "USD"), fecha: formatDate(oc.fecha), proveedor: purchaseOrderProviderLabel(oc) };
                          setEmailModal({ open: true, id: oc.id, to: oc.proveedores?.email || "", subject: applyTemplateVars(template.asunto, vars), body: applyTemplateVars(template.cuerpo, vars), filename: `${oc.numero}.pdf` });
                        }}
                        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Enviar por email">
                        <Mail className="h-4 w-4" />
                      </button>}
                      {canManageCompras && <button onClick={() => handleDeleteOC(detailOC)}
                        className="rounded p-1.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400" title="Eliminar OC">
                        <Trash2 className="h-4 w-4" />
                      </button>}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 py-5 pb-40 space-y-6">
              {/* ── Action Buttons ─────────────────────────────────────── */}
              {canManageCompras && !["cancelada"].includes(detailOC.estado) && (
                <div className="flex flex-wrap gap-2">
                  {detailOC.estado === "borrador" && (
                    <button
                      onClick={() => handleAdvanceEstado(detailOC, "enviada")}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                    >
                      <Send className="h-4 w-4" /> Activar OC
                    </button>
                  )}
                  {["pendiente", "enviada", "confirmada", "recibida_parcial"].includes(detailOC.estado) && detailItems.length > 0 && (
                    <button
                      onClick={handleMarcarTodoRecibido}
                      disabled={savingRecepcion === "all"}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
                    >
                      {savingRecepcion === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                      Marcar todo recibido
                    </button>
                  )}
                  {detailOC.proveedor_id && (
                    <button
                      onClick={() => { setCargarFCPreselectedId(detailOC.id); setCargarFCOpen(true); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                    >
                      <Upload className="h-4 w-4" /> Cargar factura de esta OC
                    </button>
                  )}
                  {(() => {
                    const fcs = (detailOC.facturas_vinculadas || []).filter(f => f.estado !== "anulada");
                    const fcMonedaDiff = fcs.length > 0 && fcs.some(f => f.moneda !== detailOC.moneda);
                    return fcMonedaDiff ? (
                      <button
                        onClick={() => handleSyncFromFC(detailOC)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        <RefreshCw className="h-4 w-4" /> Actualizar moneda desde FC
                      </button>
                    ) : null;
                  })()}
                  {ocPagadaConTarjeta(detailOC) && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                      <CreditCard className="h-4 w-4" /> Pagada con tarjeta
                    </div>
                  )}
                  {detailOC.estado !== "recibida" && (
                    <button
                      onClick={() => handleCancel(detailOC)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <XCircle className="h-4 w-4" /> Cancelar OC
                    </button>
                  )}
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
                {editMode ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">Proveedor de la OC</label>
                    <ProveedorPicker value={editOC.proveedor_id} options={proveedores} onChange={(proveedor_id) => {
                      const proveedor = proveedores.find((item) => item.id === proveedor_id);
                      const esMercadoLibre = proveedor?.razon_social.trim().toLowerCase() === "mercado libre";
                      setEditOC((prev) => ({ ...prev, proveedor_id, pagada_con_tarjeta: esMercadoLibre ? true : prev.pagada_con_tarjeta }));
                    }} />
                    <p className="text-xs text-zinc-400">Podés cambiarlo o dejar la OC sin proveedor y completarlo más adelante.</p>
                    <label className="flex cursor-pointer items-center gap-2 pt-2 text-sm dark:text-zinc-200">
                      <input type="checkbox" checked={editOC.pagada_con_tarjeta} onChange={(event) => setEditOC((prev) => ({ ...prev, pagada_con_tarjeta: event.target.checked }))} className="h-4 w-4 accent-orange-600" />
                      Pagada con tarjeta
                    </label>
                    <div className="pt-2">
                      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400 mb-1">Moneda</label>
                      <select
                        value={editOC.moneda}
                        onChange={(e) => setEditOC((prev) => ({ ...prev, moneda: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                      >
                        <option value="ARS">ARS — Pesos</option>
                        <option value="USD">USD — Dólares</option>
                      </select>
                    </div>
                  </div>
                ) : detailOC.proveedores ? (
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
                ) : isOwnStockPurchaseOrder(detailOC) ? (
                  <div className="flex items-center gap-3 rounded-lg bg-blue-50 px-3 py-3 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                    <Package className="h-5 w-5" />
                    <div>
                      <p className="font-semibold">Stock propio</p>
                      <p className="text-xs opacity-80">OC normal para recepción de mercadería propia; no requiere proveedor externo.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">Sin proveedor asignado</p>
                    {canManageCompras ? <>
                    <p className="text-xs text-zinc-400">Asigná un proveedor a toda la OC, o asigná proveedores por item en la tabla de abajo y dividí la OC.</p>
                    <div>
                      <ProveedorPicker
                        value=""
                        options={proveedores}
                        placeholder="Buscar proveedor para toda la OC..."
                        onChange={async (provId) => {
                          if (!provId || !detailOC) return;
                          if (!sociedadActiva?.id) { alert("Seleccioná una sociedad antes de asignar proveedor"); return; }
                          const { error } = await (supabase as any).from("ordenes_compra").update({ proveedor_id: provId }).eq("id", detailOC.id).eq("sociedad_id", sociedadActiva.id);
                          if (error) { alert("Error al asignar proveedor"); return; }
                          const { error: itemProvError } = await supabase.from("orden_compra_items").update({ proveedor_id: provId } as any).eq("orden_id", detailOC.id);
                          if (itemProvError) { alert("Se asignó la OC, pero no se pudo actualizar el proveedor de sus items"); return; }
                          // Re-fetch OC with full joins to get proveedor data
                          const { data: fresh } = await supabase.from("ordenes_compra").select("*, proveedores(razon_social, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), presupuesto_origen:presupuesto_origen_id(numero, modalidad_emision), orden_compra_items(cantidad, cantidad_recibida)").eq("id", detailOC.id).single();
                          if (fresh) setDetailOC(fresh as any);
                          await fetchData();
                        }}
                      />
                    </div>
                    {detailItems.some(it => it.proveedor_id) && (
                      <button
                        onClick={handleDividirPorProveedor}
                        disabled={dividiendo}
                        className="flex items-center gap-2 w-full justify-center px-3 py-2 text-sm font-medium rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition-colors"
                      >
                        {dividiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                        Dividir OC por proveedor
                      </button>
                    )}
                    </> : (
                      <p className="text-xs text-zinc-400">Esta orden todavía no tiene un proveedor asignado.</p>
                    )}
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
                <div className="relative">
                  <span className="text-zinc-400">PR origen</span>
                  {detailOC.presupuesto_origen ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Link href={`/presupuestos?selected=${detailOC.presupuesto_origen_id}`} className="font-mono text-blue-500 hover:text-blue-600 text-sm font-medium">
                        {(detailOC.presupuesto_origen as { numero: string }).numero}
                      </Link>
                      {canManageCompras && (
                        <button onClick={handleUnassignPR} className="text-zinc-900 hover:text-red-600 dark:text-white dark:hover:text-red-400" title="Quitar PR"><X className="h-3 w-3" /></button>
                      )}
                    </div>
                  ) : canManageCompras ? (
                    <div>
                      <button onClick={handleOpenAssignPR} className="text-xs text-orange-500 hover:text-orange-600 font-medium mt-0.5">+ Asignar PR</button>
                      {assignPROpen && (
                        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800 p-2">
                          <input
                            autoFocus
                            value={assignPRSearch}
                            onChange={e => setAssignPRSearch(e.target.value)}
                            placeholder="Buscar PR o cliente..."
                            className="w-full rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white mb-1"
                          />
                          <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {assignPRLoading ? (
                              <p className="text-xs text-zinc-400 p-2 text-center">Cargando...</p>
                            ) : assignPROptions.filter(p => {
                              const q = assignPRSearch.toLowerCase();
                              return !q || p.numero.toLowerCase().includes(q) || p.cliente.toLowerCase().includes(q);
                            }).slice(0, 15).map(pr => (
                              <button key={pr.id} onClick={() => handleAssignPR(pr.id)}
                                className="w-full text-left rounded px-2 py-1.5 text-xs hover:bg-orange-50 dark:hover:bg-zinc-700 flex items-center justify-between">
                                <span className="font-mono font-bold">{pr.numero}</span>
                                <span className="text-zinc-400 truncate ml-2">{pr.cliente}</span>
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setAssignPROpen(false)} className="w-full mt-1 text-xs text-zinc-400 hover:text-zinc-600 py-1">Cancelar</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="font-medium dark:text-white">{"\u2014"}</p>
                  )}
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <span className="text-zinc-400">Operador</span>
                  {canManageCompras ? (
                    <select
                      value={detailOC.created_by || ""}
                      onChange={(e) => handleChangeOperador(detailOC.id, e.target.value)}
                      className="mt-0.5 w-full max-w-xs rounded border border-zinc-200 bg-white px-2 py-1 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                    >
                      <option value="">Sin asignar</option>
                      {allProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  ) : (
                    <p className="font-medium dark:text-white">{detailOC.created_by_profile?.full_name || "\u2014"}</p>
                  )}
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
              {(detailOC.notas_recepcion || ["recibida_parcial", "pendiente", "enviada", "confirmada"].includes(detailOC.estado)) && (
                <div className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 flex items-center gap-1.5">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Nota de recepcion
                    </span>
                    {canManageCompras && <button
                      onClick={(e) => openNotaPopover(detailOC, e)}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      {detailOC.notas_recepcion ? "Editar" : "Agregar nota"}
                    </button>}
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

              {/* ── Facturas de compra vinculadas ──────────────────── */}
              {detailOC.estado !== "cancelada" && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-400" /> Facturas de compra
                    {detailOC.facturas_vinculadas_estado === "desconocido"
                      ? <Badge variant="warning">Vínculo no verificado</Badge>
                      : (detailOC.facturas_vinculadas || []).filter(f => f.estado !== "anulada").length > 0
                      ? <Badge variant="success">{(detailOC.facturas_vinculadas || []).filter(f => f.estado !== "anulada").length} cargada{(detailOC.facturas_vinculadas || []).filter(f => f.estado !== "anulada").length > 1 ? "s" : ""}</Badge>
                      : <Badge variant="outline">Sin factura</Badge>
                    }
                  </h3>
                  {detailOC.facturas_vinculadas_estado === "desconocido" && (
                    <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">No se pudo verificar si esta OC tiene otras facturas asociadas. La edición y eliminación quedan bloqueadas hasta volver a cargar.</p>
                  )}
                  {(detailOC.facturas_vinculadas || []).length > 0 ? (
                    <div className="space-y-2">
                      {(detailOC.facturas_vinculadas || []).map((fc, idx) => (
                        <div key={fc.id || idx} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant={fc.estado === "pagada" ? "success" : fc.estado === "anulada" ? "danger" : "warning"}>
                              {fc.estado === "pagada" ? "Pagada" : fc.estado === "anulada" ? "Anulada" : "Pendiente"}
                            </Badge>
                            <span className="font-medium dark:text-white truncate">{fc.tipo_comprobante || ""} {fc.numero_factura || `FC #${idx + 1}`}</span>
                            <span className="font-mono text-zinc-500">{formatCurrency(fc.total, fc.moneda as "ARS" | "USD")}</span>
                          </div>
                          {fc.archivo_url ? (
                            <a href={fc.archivo_url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 font-medium shrink-0">
                              <Download className="h-3.5 w-3.5" /> {fc.archivo_nombre || "Ver comprobante"}
                            </a>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-500 shrink-0" title="La factura está vinculada, pero no tiene archivo adjunto">
                              <AlertTriangle className="h-3.5 w-3.5" /> Sin archivo adjunto
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400 italic">No hay facturas de compra cargadas para esta OC.</p>
                  )}
                </div>
              )}

              {/* ── Items table ─────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Items ({(editMode ? editItems : detailItems).length})</h3>
                  <div className="flex items-center gap-2">
                    {editMode && (
                      <>
                        <input ref={importOCRef} type="file" accept=".html,.htm,.pdf,image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCotizacion(f); }} />
                        <button onClick={() => importOCRef.current?.click()} disabled={importingOC}
                          className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50">
                          {importingOC ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} {importingOC ? "Leyendo..." : "Importar cotización"}
                        </button>
                        <button onClick={() => setEditItems(prev => [...prev, { id: `new_${Date.now()}`, codigo: "", descripcion: "", cantidad: 1, cantidad_recibida: 0, unidad: "u", precio_unitario: 0, subtotal: 0, producto_id: null, iva_porcentaje: ocCompraSinIva(detailOC) ? 0 : 21, proveedor_id: null }])}
                          className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                          <Plus className="h-3 w-3" /> Agregar item
                        </button>
                      </>
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
                          {!detailOC.proveedores && !isOwnStockPurchaseOrder(detailOC) && <th className="px-3 py-2">Proveedor</th>}
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
                              {!detailOC.proveedores && !isOwnStockPurchaseOrder(detailOC) && (
                                <td className="px-3 py-2">
                                  {canManageCompras ? <ProveedorPicker value={item.proveedor_id || ""} options={proveedores} onChange={(proveedorId) => handleItemProveedorChange(item.id, proveedorId)} compact /> : (
                                    <span className="text-xs text-zinc-500">
                                      {proveedores.find(p => p.id === item.proveedor_id)?.razon_social || "Sin proveedor"}
                                    </span>
                                  )}
                                </td>
                              )}
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
              {canManageCompras && ["pendiente", "enviada", "confirmada", "recibida_parcial"].includes(detailOC.estado) && detailItems.length > 0 && !detailLoading && (
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

      {/* Conciliación de facturas de compra con IA */}
      {conciliarOpen && (
        <ConciliacionCompras
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          onClose={() => setConciliarOpen(false)}
          onSuccess={() => { setConciliarOpen(false); fetchData(); }}
        />
      )}

      {/* Modal cargar factura de compra */}
      {cargarFCOpen && (
        <CargarFacturaOC
          sociedadId={sociedadActiva?.id || ""}
          profileId={profile?.id || null}
          // Las OC en borrador también deben poder seleccionarse para cargar una
          // factura: el circuito de recepción/activación es independiente del
          // vínculo contable de la factura y, de lo contrario, quedan invisibles.
          ordenes={ordenes.filter(o => o.proveedor_id && o.estado !== "cancelada" && o.estado_pago !== "pagada").map(o => ({
            id: o.id,
            numero: o.numero,
            proveedor_id: o.proveedor_id!,
            proveedor_nombre: o.proveedores?.razon_social || "Sin proveedor",
            total: o.total,
            moneda: o.moneda,
            estado: (statusConfig[o.estado] || { label: o.estado }).label,
            fecha: o.fecha,
          }))}
          preselectedOCId={cargarFCPreselectedId}
          onClose={() => setCargarFCOpen(false)}
          onSuccess={() => { setCargarFCOpen(false); setCargarFCPreselectedId(undefined); fetchData(); }}
        />
      )}

      {/* Email compose modal */}
      <EmailComposeModal
        open={emailModal.open}
        onClose={() => setEmailModal(prev => ({ ...prev, open: false }))}
        documentType="orden_compra"
        sociedadId={sociedadActiva?.id}
        userEmail={profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined}
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        generatePdf={async () => {
          if (!detailOC || !sociedadActiva) throw new Error("No se encontró la OC");
          const oc = detailOC;
          const prov = oc.proveedores;
          const proveedorLabel = purchaseOrderProviderLabel(oc);
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
              razon_social: proveedorLabel,
              cuit: prov.cuit,
              condicion_iva: prov.condicion_iva,
              direccion: prov.direccion,
              localidad: prov.localidad,
              provincia: prov.provincia,
              email: prov.email,
              telefono: prov.telefono,
              forma_pago: prov.forma_pago,
            } : { razon_social: proveedorLabel },
            items: detailItems.map(it => ({
              codigo: it.codigo,
              descripcion: it.descripcion,
              cantidad: it.cantidad,
              unidad: it.unidad,
              precio_unitario: Number(it.precio_unitario),
              subtotal: Number(it.subtotal),
            })),
          }, soc);
          return htmlToPdfBase64(html);
        }}
      />
    </>
  );
}
