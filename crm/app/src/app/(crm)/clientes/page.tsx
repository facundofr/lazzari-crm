"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { Modal } from "@/components/ui/modal";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { mockClients, mockPresupuestos, mockFacturas } from "@/lib/mock-data";
import type { Client } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Download, MapPin, Phone, Mail, Loader2, Building2,
  Plus, X, Pencil, Trash2, ToggleLeft, ToggleRight, Send, Check,
  BarChart3, ShoppingBag, CalendarDays, TrendingUp, Cake,
  User, FileText, CreditCard, StickyNote, Clock, Receipt, Truck, Wallet,
  ChevronDown, ChevronRight, Package, ExternalLink, Copy, AlertCircle,
  Maximize2,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@/lib/auth-context";
import { Ficha360 } from "@/components/clientes/ficha-360";
import { AvisoDuplicadosCliente, SemaforoBCRAPrevio, type ClienteParecido } from "@/components/clientes/avisos-alta-cliente";
import { LeerDocumentoImpositivo } from "@/components/leer-documento-impositivo";
import { EliminarConMotivoModal } from "@/components/eliminar-con-motivo";
import { TIPO_DOCUMENTO_LABEL, type DatosImpositivos } from "@/lib/documento-impositivo";
import { traerTodo } from "@/lib/paginar";
import { traerSaldosClientes, saldoClienteEn, type SaldoCliente } from "@/lib/saldo-clientes";

const condicionLabels: Record<string, string> = {
  RI: "Resp. Inscripto",
  Monotributo: "Monotributo",
  Exento: "Exento",
  CF: "Cons. Final",
};

const provincias = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan",
  "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
  "Tierra del Fuego", "Tucumán",
];

function formatPersonName(value: string) {
  return value
    .toLocaleLowerCase("es-AR")
    .replace(/(^|[\s'-])(\p{L})/gu, (_, separator: string, letter: string) =>
      `${separator}${letter.toLocaleUpperCase("es-AR")}`
    );
}

interface ClienteRow {
  id: string;
  type: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string;
  email: string;
  telefono: string;
  direccion: string;
  localidad: string;
  provincia: string;
  cp: string;
  lista_precio: string;
  dias_cuenta_corriente: number;
  forma_pago: string;
  limite_credito: number;
  saldo_cuenta_corriente: number;
  notas: string;
  activo: boolean;
  assigned_to: string | null;
  markup_predeterminado?: number | null;
  moneda_predeterminada?: string | null;
  email_facturacion?: string | null;
  envio_automatico?: boolean;
  pide_oc_para_facturar?: boolean;
  flete?: string | null;
  alias_cbu?: string | null;
  tipo_cuenta?: string | null;
  fecha_pago?: string | null;
  email_comprobante?: string | null;
  created_at: string;
  updated_at: string;
  assigned_profile: { full_name: string } | null;
  contactos: unknown[];
  cliente_sucursales: unknown[];
}

function mapRow(row: ClienteRow): Client & { vendedorNombre: string; monedaPredeterminada: string; aliasCbu: string; tipoCuenta: string; fechaPago: string; emailComprobante: string; pideOcParaFacturar: boolean } {
  return {
    id: row.id,
    type: (row.type as Client["type"]) ?? "empresa",
    razonSocial: row.razon_social ?? "",
    cuit: row.cuit ?? "",
    condicionIva: (row.condicion_iva as Client["condicionIva"]) ?? "RI",
    email: row.email ?? "",
    telefono: row.telefono ?? "",
    direccion: row.direccion ?? "",
    localidad: row.localidad ?? "",
    provincia: row.provincia ?? "",
    cp: row.cp ?? "",
    listaPrecio: row.lista_precio ?? "",
    diasCuentaCorriente: Number(row.dias_cuenta_corriente) || 0,
    formaPago: row.forma_pago ?? "",
    limiteCredito: Number(row.limite_credito) || 0,
    saldoCuentaCorriente: Number(row.saldo_cuenta_corriente) || 0,
    notas: row.notas ?? "",
    activo: row.activo ?? true,
    assignedTo: row.assigned_to ?? undefined,
    markupPredeterminado: row.markup_predeterminado != null ? Number(row.markup_predeterminado) : null,
    monedaPredeterminada: (row.moneda_predeterminada as string) ?? "ARS",
    emailFacturacion: row.email_facturacion ?? null,
    envioAutomatico: row.envio_automatico ?? true,
    flete: row.flete ?? "",
    aliasCbu: row.alias_cbu ?? "",
    tipoCuenta: row.tipo_cuenta ?? "",
    fechaPago: row.fecha_pago ?? "",
    emailComprobante: row.email_comprobante ?? "",
    pideOcParaFacturar: row.pide_oc_para_facturar ?? false,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    contactos: Array.isArray(row.contactos) ? (row.contactos as Array<Record<string, unknown>>).map((c) => ({
      id: c.id as string,
      nombre: (c.nombre as string) ?? "",
      cargo: (c.cargo as string) ?? "",
      email: (c.email as string) ?? "",
      telefono: (c.telefono as string) ?? "",
      principal: (c.principal as boolean) ?? false,
      fechaCumpleanos: (c.fecha_cumpleanos as string) ?? null,
      notas: (c.notas as string) ?? null,
      sucursalId: (c.sucursal_id as string) ?? null,
      vendedorId: (c.vendedor_id as string) ?? null,
      vendedorNombre: null,
    })) : [],
    sucursales: Array.isArray(row.cliente_sucursales) ? (row.cliente_sucursales as Array<Record<string, unknown>>).map((s) => ({
      id: s.id as string,
      nombre: (s.nombre as string) ?? "",
      direccion: (s.direccion as string) ?? "",
      localidad: (s.localidad as string) ?? "",
      provincia: (s.provincia as string) ?? "",
      telefono: (s.telefono as string) ?? "",
      email: (s.email as string) ?? "",
      cp: (s.cp as string) ?? "",
    })) : [],
    vendedorNombre: row.assigned_profile?.full_name ?? "—",
  };
}

// saldoUSD: saldo real de cuenta corriente en dólares (saldoCuentaCorriente queda en pesos).
type ClienteExt = Client & { vendedorNombre: string; monedaPredeterminada: string; saldoUSD?: number };

interface ConsumoCategory {
  categoria: string;
  cantidad: number;
  total: number;
}

interface ConsumoData {
  categorias: ConsumoCategory[];
  totalFacturado: number;
  cantidadPresupuestos: number;
  ultimaCompra: string | null;
  loading: boolean;
}

interface FichaPresupuesto {
  id: string;
  numero: string;
  fecha: string;
  estado: string;
  total: number;
  moneda: string;
}

interface FichaFactura {
  id: string;
  tipo: string;
  numero: string;
  punto_venta: string;
  fecha: string;
  estado: string;
  total: number;
  moneda: string;
}

interface FichaItemCotizado {
  descripcion: string;
  cantidadTotal: number;
  vecesAparece: number;
}

interface FichaData {
  presupuestos: FichaPresupuesto[];
  facturas: FichaFactura[];
  itemsCotizados: FichaItemCotizado[];
  totalPresupuestos: number;
  totalFacturado: number;
  ultimoPresupuestoFecha: string | null;
  saldoCC: number;
  loading: boolean;
}

const emptyForm = {
  razon_social: "",
  cuit: "",
  type: "empresa" as string,
  condicion_iva: "RI" as string,
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  cp: "",
  lista_precio: "A",
  dias_cuenta_corriente: 30,
  forma_pago: "Transferencia",
  limite_credito: 0,
  notas: "",
  markup_predeterminado: null as number | null,
  moneda_predeterminada: "ARS",
  email_facturacion: "",
  envio_automatico: true,
  pide_oc_para_facturar: false,
  assigned_to: "" as string | null,
  flete: "",
  alias_cbu: "",
  tipo_cuenta: "",
  fecha_pago: "",
  email_comprobante: "",
};

type DetailTab = "datos" | "contactos" | "sucursales" | "relevamiento" | "historial" | "actividad" | "cc";

interface CCFactura {
  id: string;
  tipo: string;
  punto_venta: string;
  numero: string;
  fecha: string;
  fecha_vencimiento: string | null;
  total: number;
  moneda: string;
}

interface TimelineEvent {
  id: string;
  tipo: "presupuesto" | "factura" | "remito" | "movimiento";
  fecha: string;
  titulo: string;
  detalle: string;
  estado?: string;
  /** Link a un adjunto (ej. foto del remito firmado). */
  url?: string | null;
}

export default function ClientesPage() {
  const { sociedadActiva, sociedades, profile } = useUser();
  // Saldo real de cuenta corriente (B3): si no se pudo calcular, se avisa en pantalla.
  const [saldosError, setSaldosError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [clientes, setClientes] = useState<ClienteExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha alta", type: "date-range" },
    { key: "provincia", label: "Provincia", type: "select", options: provincias.map(p => ({ value: p, label: p })) },
    { key: "condicionIva", label: "Condición IVA", type: "select", options: [
      { value: "RI", label: "Resp. Inscripto" }, { value: "Monotributo", label: "Monotributo" },
      { value: "Exento", label: "Exento" }, { value: "CF", label: "Cons. Final" }
    ]},
    { key: "formaPago", label: "Forma de pago", type: "select", options: [
      { value: "Efectivo", label: "Efectivo" }, { value: "Cuenta corriente", label: "Cuenta corriente" },
      { value: "Cheque", label: "Cheque" }, { value: "Echeq", label: "Echeq" }, { value: "Transferencia", label: "Transferencia" }, { value: "Tarjeta", label: "Tarjeta" }
    ]},
    { key: "saldo", label: "Saldo CC", type: "number-range" },
    { key: "estado", label: "Estado", type: "select", options: [
      { value: "activo", label: "Activo" }, { value: "inactivo", label: "Inactivo" }
    ]},
  ];
  const [filterValues, setFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, provincia: "", condicionIva: "", formaPago: "", saldo: {}, estado: "" });

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [cuitLookupLoading, setCuitLookupLoading] = useState(false);
  const [cuitLookupMsg, setCuitLookupMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Sucursales in modal (edit mode only)
  type SucursalForm = { id: string; nombre: string; direccion: string; localidad: string; provincia: string; cp: string; telefono: string; email: string; isNew?: boolean };
  const emptySucursalForm = { nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "" };
  const [formSucursales, setFormSucursales] = useState<SucursalForm[]>([]);
  const [newSucursal, setNewSucursal] = useState(emptySucursalForm);
  const [showSucursalForm, setShowSucursalForm] = useState(false);
  const [sucursalesLoading, setSucursalesLoading] = useState(false);
  const [removedSucursalIds, setRemovedSucursalIds] = useState<string[]>([]);

  // Contactos CRUD desde panel de detalle
  type ContactoFormType = { nombre: string; cargo: string; email: string; telefono: string; whatsapp: string; sucursal_id: string; principal: boolean; notas: string };
  const emptyContactoForm: ContactoFormType = { nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" };
  const [addingContacto, setAddingContacto] = useState(false);
  const [editingContactoId, setEditingContactoId] = useState<string | null>(null);
  const [contactoForm, setContactoForm] = useState<ContactoFormType>(emptyContactoForm);
  const [savingContacto, setSavingContacto] = useState(false);

  // Contactos en modal (multi-contact)
  type ContactoModal = { id?: string; nombre: string; cargo: string; email: string; telefono: string; whatsapp: string; sucursal_id: string; principal: boolean; notas: string; isNew?: boolean };
  const emptyContactoModal: ContactoModal = { nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" };
  const [formContactos, setFormContactos] = useState<ContactoModal[]>([]);
  const [newContactoModal, setNewContactoModal] = useState<ContactoModal>(emptyContactoModal);
  const [showContactoModalForm, setShowContactoModalForm] = useState(false);
  const [removedContactoIds, setRemovedContactoIds] = useState<string[]>([]);
  const [contactosModalLoading, setContactosModalLoading] = useState(false);
  const [emailCobranzas, setEmailCobranzas] = useState("");

  // Sucursales CRUD desde panel de detalle
  type SucursalDetailForm = { nombre: string; direccion: string; localidad: string; provincia: string; cp: string; telefono: string; email: string; transportista_id: string; principal: boolean };
  const emptySucursalDetailForm: SucursalDetailForm = { nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "", transportista_id: "", principal: false };
  const [addingSucursal, setAddingSucursal] = useState(false);
  const [editingSucursalId, setEditingSucursalId] = useState<string | null>(null);
  const [sucursalDetailForm, setSucursalDetailForm] = useState<SucursalDetailForm>(emptySucursalDetailForm);
  const [savingSucursal, setSavingSucursal] = useState(false);

  // Detail
  const [selectedCliente, setSelectedCliente] = useState<ClienteExt | null>(null);
  const [clienteAEliminar, setClienteAEliminar] = useState<{ id: string; nombre: string } | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("datos");

  // Abrir un cliente directo desde otro módulo: /clientes?id=<cliente> (va a la Ficha 360).
  const abrirDesdeUrl = useRef(false);
  useEffect(() => {
    if (abrirDesdeUrl.current || clientes.length === 0 || typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) { abrirDesdeUrl.current = true; return; }
    const c = clientes.find((x) => x.id === id);
    if (c) { abrirDesdeUrl.current = true; setSelectedCliente(c); setDetailTab("historial"); }
  }, [clientes]);
  const [panelFullscreen, setPanelFullscreen] = useState(false);

  // Timeline / Activity
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Consumo analysis
  const [consumoData, setConsumoData] = useState<ConsumoData>({
    categorias: [],
    totalFacturado: 0,
    cantidadPresupuestos: 0,
    ultimaCompra: null,
    loading: false,
  });

  // Vendedores list (for assigning to contactos)
  const [vendedores, setVendedores] = useState<{id: string; full_name: string}[]>([]);

  // Transportistas catalog (for sucursales)
  const [transportistas, setTransportistas] = useState<{id: string; nombre: string}[]>([]);

  // Per-field form errors
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});

  // Relevamiento state
  interface FichaRelevamiento {
    id: string;
    fecha: string;
    tipo: string;
    descripcion: string;
    productos_interes: string | null;
    productos_habituales: string | null;
    frecuencia_compra: string | null;
    marcas_preferidas: string | null;
    talles: string | null;
    medidas: string | null;
    especificaciones: string | null;
    observaciones_generales: string | null;
    proxima_accion: string | null;
    fecha_proxima_accion: string | null;
    updated_at: string | null;
    profiles?: { full_name: string } | null;
  }
  const [fichasRelevamiento, setFichasRelevamiento] = useState<FichaRelevamiento[]>([]);
  const [relevLoading, setRelevLoading] = useState(false);
  const [relevModalOpen, setRelevModalOpen] = useState(false);
  const [relevEditingId, setRelevEditingId] = useState<string | null>(null);
  const [relevSaving, setRelevSaving] = useState(false);
  const emptyRelevForm = { descripcion: "", productos_habituales: "", frecuencia_compra: "", marcas_preferidas: "", talles: "", medidas: "", especificaciones: "", observaciones_generales: "", proxima_accion: "", fecha_proxima_accion: "" };
  const [relevForm, setRelevForm] = useState(emptyRelevForm);
  const [relevProdSearch, setRelevProdSearch] = useState("");
  const [relevProdResults, setRelevProdResults] = useState<{ codigo: string; descripcion: string; variante?: string; proveedor_nombre?: string }[]>([]);
  const [relevProdSearching, setRelevProdSearching] = useState(false);

  // Ficha completa
  const [fichaData, setFichaData] = useState<FichaData>({
    presupuestos: [],
    facturas: [],
    itemsCotizados: [],
    totalPresupuestos: 0,
    totalFacturado: 0,
    ultimoPresupuestoFecha: null,
    saldoCC: 0,
    loading: false,
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    presupuestos: true,
    facturas: false,
    items: false,
  });

  // Cuenta Corriente
  const [ccFacturas, setCcFacturas] = useState<CCFactura[]>([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [pendingCountMap, setPendingCountMap] = useState<Record<string, number>>({});

  // CUIT lookup from AFIP padron
  const handleCuitLookup = useCallback(async () => {
    const clean = form.cuit.replace(/\D/g, "");
    if (![7, 8, 11].includes(clean.length)) {
      setCuitLookupMsg({ type: "error", text: "Ingrese un DNI (7-8 dígitos) o CUIT (11 dígitos)" });
      return;
    }
    setCuitLookupLoading(true);
    setCuitLookupMsg(null);
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${clean}`);
      const data = await res.json();
      if (!res.ok) {
        setCuitLookupMsg({ type: "error", text: data.error || "Error consultando AFIP" });
        return;
      }
      setForm((prev) => ({
        ...prev,
        cuit: data.cuit || prev.cuit,
        razon_social: data.razon_social || prev.razon_social,
        condicion_iva: data.condicion_iva || prev.condicion_iva,
        direccion: data.direccion || prev.direccion,
        localidad: data.localidad || prev.localidad,
        // No pisar una provincia ya cargada: puede ser la dirección histórica
        // comercial del cliente y ARCA puede devolver otra sede fiscal.
        provincia: prev.provincia || data.provincia || "",
        cp: data.cp || prev.cp,
        type: data.tipo_persona === "JURIDICA" ? "empresa" : data.tipo_persona === "FISICA" ? "persona" : prev.type,
      }));
      if (!data.condicion_iva) {
        setCuitLookupMsg({ type: "error", text: `${data.razon_social} — ARCA no pudo determinar la condicion IVA. Verificalo manualmente y seleccionalo abajo.` });
      } else {
        const label = data.condicion_iva === "RI" ? "Resp. Inscripto" : data.condicion_iva === "Monotributo" ? "Monotributo" : data.condicion_iva === "Exento" ? "Exento" : "Cons. Final";
        const servicio = data.condicion_iva_servicio === "A5" ? " (verificado con ARCA A5)" : "";
        setCuitLookupMsg({ type: "success", text: `${data.razon_social} - ${label}${servicio}` });
      }
    } catch {
      setCuitLookupMsg({ type: "error", text: "Error de conexion al consultar AFIP" });
    } finally {
      setCuitLookupLoading(false);
    }
  }, [form.cuit]);

  // Fetch vendedores on mount
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

  // Fetch transportistas catalog
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    async function fetchTransportistas() {
      try {
        const { data } = await (supabase as any).from("transportistas").select("id, nombre").eq("activo", true).or(`sociedad_id.eq.${sociedadActiva?.id},sociedad_id.is.null`).order("nombre");
        if (data) setTransportistas(data as { id: string; nombre: string }[]);
      } catch { /* ignore */ }
    }
    fetchTransportistas();
  }, [sociedadActiva?.id]);

  async function doRelevProdSearch(term: string) {
    setRelevProdSearch(term);
    if (term.length < 2) { setRelevProdResults([]); return; }
    setRelevProdSearching(true);
    try {
      const { data } = await (supabase as any)
        .from("lista_precios_items")
        .select("codigo, descripcion, variante, listas_precios(proveedores(razon_social))")
        .or(`codigo.ilike.%${term}%,descripcion.ilike.%${term}%`)
        .limit(15);
      if (data) {
        setRelevProdResults(data.map((d: any) => ({
          codigo: d.codigo,
          descripcion: d.descripcion,
          variante: d.variante || undefined,
          proveedor_nombre: d.listas_precios?.proveedores?.razon_social || undefined,
        })));
      }
    } catch { setRelevProdResults([]); }
    finally { setRelevProdSearching(false); }
  }

  function addRelevProduct(prod: { codigo: string; descripcion: string; variante?: string }) {
    const label = `${prod.codigo} — ${prod.descripcion}${prod.variante ? ` (${prod.variante})` : ""}`;
    setRelevForm(p => ({
      ...p,
      productos_habituales: p.productos_habituales ? `${p.productos_habituales}\n${label}` : label,
    }));
    setRelevProdSearch("");
    setRelevProdResults([]);
  }

  // Fetch fichas de relevamiento when tab is selected
  useEffect(() => {
    if (!selectedCliente || detailTab !== "relevamiento") return;
    const clienteId = selectedCliente.id;
    setRelevLoading(true);
    async function fetchFichas() {
      try {
        const { data } = await (supabase as any)
          .from("fichas_relevamiento")
          .select("*, profiles:actualizado_por(full_name)")
          .eq("cliente_id", clienteId)
          .order("updated_at", { ascending: false });
        setFichasRelevamiento(data || []);
      } catch { setFichasRelevamiento([]); }
      finally { setRelevLoading(false); }
    }
    fetchFichas();
  }, [selectedCliente?.id, detailTab]);

  async function handleSaveRelevamiento() {
    if (!selectedCliente || !relevForm.descripcion.trim()) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      toast.error("Seleccioná una sociedad antes de guardar el relevamiento");
      return;
    }
    setRelevSaving(true);
    try {
      const payload = {
        cliente_id: selectedCliente.id,
        sociedad_id: sociedadId,
        descripcion: relevForm.descripcion.trim(),
        productos_habituales: relevForm.productos_habituales || null,
        frecuencia_compra: relevForm.frecuencia_compra || null,
        marcas_preferidas: relevForm.marcas_preferidas || null,
        talles: relevForm.talles || null,
        medidas: relevForm.medidas || null,
        especificaciones: relevForm.especificaciones || null,
        observaciones_generales: relevForm.observaciones_generales || null,
        proxima_accion: relevForm.proxima_accion || null,
        fecha_proxima_accion: relevForm.fecha_proxima_accion || null,
        actualizado_at: new Date().toISOString(),
      };
      if (relevEditingId) {
        let relevQuery = (supabase as any).from("fichas_relevamiento").update(payload).eq("id", relevEditingId);
        relevQuery = relevQuery.eq("sociedad_id", sociedadId);
        const { error } = await relevQuery;
        if (error) throw error;
        toast.success("Relevamiento actualizado");
      } else {
        const { error } = await (supabase as any).from("fichas_relevamiento").insert({ ...payload, fecha: todayAR(), tipo: "relevamiento" });
        if (error) throw error;
        toast.success("Relevamiento guardado");
      }
      setRelevModalOpen(false);
      setRelevEditingId(null);
      setRelevForm(emptyRelevForm);
      // Refresh
      const { data } = await (supabase as any).from("fichas_relevamiento").select("*, profiles:actualizado_por(full_name)").eq("cliente_id", selectedCliente.id).eq("sociedad_id", sociedadId).order("updated_at", { ascending: false });
      setFichasRelevamiento(data || []);
    } catch (err: any) { toast.error(err.message || "Error al guardar relevamiento"); }
    finally { setRelevSaving(false); }
  }

  useEffect(() => {
    if (!selectedCliente) return;
    const clienteId = selectedCliente.id;

    async function fetchConsumo() {
      setConsumoData((prev) => ({ ...prev, loading: true }));

      try {
        // Fetch approved presupuestos with items for this client
        let presQ = supabase
          .from("presupuestos")
          .select("id, fecha, total, presupuesto_items(categoria, cantidad, total)")
          .eq("cliente_id", clienteId)
          .eq("estado", "aprobado")
          .order("fecha", { ascending: false });
        if (sociedadActiva?.id) presQ = presQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: presupuestos, error: presError } = await presQ;

        // Fetch facturas total for this client
        let factQ = supabase
          .from("facturas")
          .select("total")
          .eq("cliente_id", clienteId);
        if (sociedadActiva?.id) factQ = factQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: facturas, error: factError } = await factQ;

        if (presError || factError) {
          // Fallback to mock data
          const mockPres = mockPresupuestos.filter(
            (p) => p.clienteId === clienteId && p.estado === "aprobado"
          );
          const catMap = new Map<string, { cantidad: number; total: number }>();
          for (const p of mockPres) {
            for (const item of p.items) {
              const cat = item.categoria || "Sin categoría";
              const existing = catMap.get(cat) || { cantidad: 0, total: 0 };
              catMap.set(cat, {
                cantidad: existing.cantidad + item.cantidad,
                total: existing.total + (item.total || item.subtotal || 0),
              });
            }
          }
          const categorias = Array.from(catMap.entries())
            .map(([categoria, data]) => ({ categoria, ...data }))
            .sort((a, b) => b.total - a.total);

          const mockFact = mockFacturas.filter((f) => f.clienteId === clienteId);
          const totalFact = mockFact.reduce((sum, f) => sum + f.total, 0);
          const ultimaFecha = mockPres.length > 0 ? mockPres[0].fecha : null;

          setConsumoData({
            categorias,
            totalFacturado: totalFact,
            cantidadPresupuestos: mockPres.length,
            ultimaCompra: ultimaFecha,
            loading: false,
          });
          return;
        }

        // Process real Supabase data
        const catMap = new Map<string, { cantidad: number; total: number }>();
        for (const p of presupuestos) {
          const items = (p as any).presupuesto_items || [];
          for (const item of items) {
            const cat = item.categoria || "Sin categoría";
            const existing = catMap.get(cat) || { cantidad: 0, total: 0 };
            catMap.set(cat, {
              cantidad: existing.cantidad + (item.cantidad || 0),
              total: existing.total + (item.total || 0),
            });
          }
        }
        const categorias = Array.from(catMap.entries())
          .map(([categoria, data]) => ({ categoria, ...data }))
          .sort((a, b) => b.total - a.total);

        const totalFacturado = facturas
          ? facturas.reduce((sum, f) => sum + (f.total || 0), 0)
          : 0;

        setConsumoData({
          categorias,
          totalFacturado,
          cantidadPresupuestos: presupuestos.length,
          ultimaCompra: presupuestos.length > 0 ? (presupuestos[0] as any).fecha : null,
          loading: false,
        });
      } catch (err) {
        console.error("Error fetching consumo:", err);
        setConsumoData({
          categorias: [],
          totalFacturado: 0,
          cantidadPresupuestos: 0,
          ultimaCompra: null,
          loading: false,
        });
      }
    }

    fetchConsumo();
  }, [selectedCliente?.id]);

  // La pestaña "Historial" ahora es la Ficha 360 (components/clientes/ficha-360.tsx), que carga sus propios datos.

  // Fetch timeline when actividad tab is selected
  useEffect(() => {
    if (!selectedCliente || detailTab !== "actividad") return;
    const clienteId = selectedCliente.id;
    setTimelineLoading(true);

    async function fetchTimeline() {
      const events: TimelineEvent[] = [];
      try {
        // Presupuestos
        let prsQ = supabase
          .from("presupuestos")
          .select("id, numero, fecha, total, estado, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (sociedadActiva?.id) prsQ = prsQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: prs } = await prsQ;
        if (prs) {
          for (const p of prs) {
            events.push({
              id: `pr-${p.id}`,
              tipo: "presupuesto",
              fecha: p.fecha,
              titulo: `Presupuesto ${p.numero || ""}`,
              detalle: `${formatCurrency(Number(p.total), (p.moneda as "ARS" | "USD") || "ARS")}`,
              estado: p.estado,
            });
          }
        }

        // Facturas
        let factsQ = supabase
          .from("facturas")
          .select("id, tipo, numero, punto_venta, fecha, total, estado, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (sociedadActiva?.id) factsQ = factsQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: facts } = await factsQ as { data: any[] | null };
        if (facts) {
          for (const f of facts) {
            const comprobante = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
            events.push({
              id: `fact-${f.id}`,
              tipo: "factura",
              fecha: f.fecha,
              titulo: `Factura ${comprobante}`,
              detalle: `${formatCurrency(Number(f.total), (f.moneda as "ARS" | "USD") || "ARS")}`,
              estado: f.estado,
            });
          }
        }

        // Remitos
        let remsQ = (supabase as any)
          .from("remitos")
          .select("id, numero, fecha, estado, foto_url, recibio")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (sociedadActiva?.id) remsQ = remsQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: rems } = await remsQ;
        if (rems) {
          for (const r of rems) {
            events.push({
              id: `rem-${r.id}`,
              tipo: "remito",
              fecha: r.fecha,
              titulo: `Remito ${r.numero || ""}`,
              // El remito se hace para entregar: siempre figura entregado.
              detalle: "Entregado" + ((r as any).recibio ? ` · recibió ${(r as any).recibio}` : ""),
              estado: "entregado",
              url: (r as any).foto_url || null,
            });
          }
        }

        // Movimientos (cobros)
        let movsQ = supabase
          .from("movimientos")
          .select("id, tipo, fecha, monto, descripcion, moneda")
          .eq("cliente_id", clienteId)
          .order("fecha", { ascending: false })
          .limit(20);
        if (sociedadActiva?.id) movsQ = movsQ.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: movs } = await movsQ;
        if (movs) {
          for (const m of movs) {
            events.push({
              id: `mov-${m.id}`,
              tipo: "movimiento",
              fecha: m.fecha,
              titulo: m.tipo === "cobro" ? "Cobro recibido" : m.tipo === "pago" ? "Pago" : (m.tipo || "Movimiento"),
              detalle: `${formatCurrency(Number(m.monto), (m.moneda as "ARS" | "USD") || "ARS")}${m.descripcion ? ` — ${m.descripcion}` : ""}`,
            });
          }
        }

        // Sort all events by date descending
        events.sort((a, b) => b.fecha.localeCompare(a.fecha));
        setTimeline(events);
      } catch (err) {
        console.error("Error fetching timeline:", err);
        setTimeline([]);
      } finally {
        setTimelineLoading(false);
      }
    }

    fetchTimeline();
  }, [selectedCliente?.id, detailTab]);

  // Fetch contactos when a client is selected (polymorphic table, no FK join)
  useEffect(() => {
    if (!selectedCliente) return;
    async function fetchContactos() {
      try {
        const { data } = await (supabase as any)
          .from("contactos")
          .select("*, vendedor:vendedor_id(id, full_name)")
          .eq("entity_type", "cliente")
          .eq("entity_id", selectedCliente!.id);
        if (data) {
          const mapped = data.map((c: Record<string, unknown>) => {
            const vendedor = c.vendedor as Record<string, unknown> | null;
            return {
              id: c.id as string,
              nombre: (c.nombre as string) ?? "",
              cargo: (c.cargo as string) ?? "",
              email: (c.email as string) ?? "",
              telefono: (c.telefono as string) ?? "",
              principal: (c.principal as boolean) ?? false,
              fechaCumpleanos: (c.fecha_cumpleanos as string) ?? null,
              notas: (c.notas as string) ?? null,
              sucursalId: (c.sucursal_id as string) ?? null,
              vendedorId: (c.vendedor_id as string) ?? null,
              vendedorNombre: vendedor ? (vendedor.full_name as string) : null,
            };
          });
          setSelectedCliente((prev) => prev ? { ...prev, contactos: mapped } : prev);
        }
      } catch (err) {
        console.error("Error fetching contactos:", err);
      }
    }
    fetchContactos();
  }, [selectedCliente?.id]);

  // Fetch CC (pending facturas) when CC tab is selected
  useEffect(() => {
    if (!selectedCliente || detailTab !== "cc") return;
    const clienteId = selectedCliente.id;
    setCcLoading(true);

    async function fetchCC() {
      try {
        let query = (supabase as any)
          .from("facturas")
          .select("id, tipo, punto_venta, numero, fecha, fecha_vencimiento, total, moneda")
          .eq("cliente_id", clienteId)
          .eq("estado", "emitida")
          .order("fecha");

        if (sociedadActiva?.id) {
          query = query.eq("sociedad_id", sociedadActiva.id);
        }

        const { data, error } = await query;
        if (error) {
          console.error("Error fetching CC facturas:", error);
          setCcFacturas([]);
        } else {
          setCcFacturas(
            (data || []).map((f: any) => ({
              id: f.id,
              tipo: f.tipo || "FC A",
              punto_venta: f.punto_venta || "0001",
              numero: f.numero || "",
              fecha: f.fecha || "",
              fecha_vencimiento: f.fecha_vencimiento || null,
              total: Number(f.total) || 0,
              moneda: f.moneda || "ARS",
            }))
          );
        }
      } catch (err) {
        console.error("Error fetching CC:", err);
        setCcFacturas([]);
      } finally {
        setCcLoading(false);
      }
    }

    fetchCC();
  }, [selectedCliente?.id, detailTab, sociedadActiva?.id]);

  // Fetch pending invoice counts for all clients (for badge in DataTable)
  useEffect(() => {
    if (clientes.length === 0) return;

    async function fetchPendingCounts() {
      try {
        let query = (supabase as any)
          .from("facturas")
          .select("cliente_id")
          .eq("estado", "emitida");

        if (sociedadActiva?.id) {
          query = query.eq("sociedad_id", sociedadActiva.id);
        }

        const { data, error } = await query;
        if (error || !data) return;

        const counts: Record<string, number> = {};
        for (const row of data as { cliente_id: string }[]) {
          counts[row.cliente_id] = (counts[row.cliente_id] || 0) + 1;
        }
        setPendingCountMap(counts);
      } catch {
        // ignore
      }
    }

    fetchPendingCounts();
  }, [clientes, sociedadActiva?.id]);

  const fetchClientes = useCallback(async () => {
    // Sin sociedad todavía (recién entra) no se busca: si no, trae los clientes de las dos y avisa un error de saldo que no es.
    if (!sociedadActiva?.id) return;
    try {
      // contactos is polymorphic (no FK to clientes), so we fetch it separately
      // Todos los clientes (Supabase corta en 1000 filas) y, en paralelo, su saldo real
      // de cuenta corriente: facturas − NC − cobros (con retenciones), ARS y USD aparte.
      // La columna clientes.saldo_cuenta_corriente no la actualiza nadie (B3).
      const armarQuery = () => {
        let query = supabase
          .from("clientes")
          .select(`*, assigned_profile:assigned_to(full_name), cliente_sucursales(*)`);
        if (sociedadActiva?.id) {
          query = query.eq("sociedad_id" as any, sociedadActiva.id);
        }
        return query.order("razon_social").order("id");
      };
      const [res, saldos] = await Promise.all([
        traerTodo<Record<string, unknown>>(armarQuery).then((data) => ({ data, error: null as unknown })).catch((e: unknown) => ({ data: null, error: e })),
        sociedadActiva?.id
          ? traerSaldosClientes(supabase, sociedadActiva.id, traerTodo).catch((e: unknown) => { console.error("Error calculando saldos de clientes:", e); return null; })
          : Promise.resolve(null as Record<string, SaldoCliente> | null),
      ]);
      const { data, error } = res;
      setSaldosError(saldos ? null : "No se pudo calcular el saldo de cuenta corriente: se muestra en 0. Recargá la página para reintentar.");

      if (error) {
        console.error("Error fetching clientes:", error);
        setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—", monedaPredeterminada: "ARS" })));
      } else if (data) {
        setClientes(data.map((row) => {
          const c = mapRow({ ...row, contactos: [] } as unknown as ClienteRow);
          return { ...c, saldoCuentaCorriente: saldoClienteEn(saldos, c.id, "ARS"), saldoUSD: saldoClienteEn(saldos, c.id, "USD") };
        }));
      } else {
        setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—", monedaPredeterminada: "ARS" })));
      }
    } catch (err) {
      console.error("Error fetching clientes:", err);
      setClientes(mockClients.map((c) => ({ ...c, vendedorNombre: "—", monedaPredeterminada: "ARS" })));
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva?.id]);

  useEffect(() => {
    fetchClientes();
  }, [fetchClientes]);

  const filtered = clientes.filter((c) => {
    const matchSearch =
      c.razonSocial.toLowerCase().includes(search.toLowerCase()) ||
      (c.cuit || "").includes(search) ||
      c.email.toLowerCase().includes(search.toLowerCase());
    const fProvincia = filterValues.provincia as string;
    const matchProvincia = !fProvincia || c.provincia === fProvincia;
    const fCondicion = filterValues.condicionIva as string;
    const matchCondicion = !fCondicion || c.condicionIva === fCondicion;
    const fFormaPago = filterValues.formaPago as string;
    const matchFormaPago = !fFormaPago || c.formaPago === fFormaPago;
    const fEstado = filterValues.estado as string;
    const matchEstado =
      !fEstado ||
      (fEstado === "activo" && c.activo) ||
      (fEstado === "inactivo" && !c.activo);
    const fFecha = filterValues.fecha as { from?: string; to?: string };
    const matchFechaFrom = !fFecha?.from || c.createdAt >= fFecha.from;
    const matchFechaTo = !fFecha?.to || c.createdAt.slice(0, 10) <= fFecha.to;
    const fSaldo = filterValues.saldo as { min?: number; max?: number };
    const matchSaldoMin = fSaldo?.min === undefined || c.saldoCuentaCorriente >= fSaldo.min;
    const matchSaldoMax = fSaldo?.max === undefined || c.saldoCuentaCorriente <= fSaldo.max;
    return matchSearch && matchProvincia && matchCondicion && matchFormaPago && matchEstado && matchFechaFrom && matchFechaTo && matchSaldoMin && matchSaldoMax;
  });

  const activos = clientes.filter((c) => c.activo).length;

  // CSV Export
  function exportCSV() {
    const headers = ["Razon Social", "CUIT", "Condicion IVA", "Email", "Telefono", "Localidad", "Provincia", "Lista Precio", "Saldo CC", "Limite Credito", "Estado"];
    const rows = filtered.map((c) => [
      c.razonSocial, c.cuit, condicionLabels[c.condicionIva] || c.condicionIva,
      c.email, c.telefono, c.localidad, c.provincia, c.listaPrecio,
      c.saldoCuentaCorriente, c.limiteCredito, c.activo ? "Activo" : "Inactivo",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Modal handlers
  function openCreate() {
    setEditingId(null);
    // Vendedor asignado: por defecto el usuario que da el alta (editable).
    const yo = profile?.id && vendedores.some((v) => v.id === profile.id) ? profile.id : null;
    setForm({ ...emptyForm, assigned_to: yo });
    setFormError("");
    setFormFieldErrors({});
    setCuitLookupMsg(null);
    setFormContactos([]);
    setRemovedContactoIds([]);
    setShowContactoModalForm(false);
    setNewContactoModal({ nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" });
    setEmailCobranzas("");
    setFormSucursales([]);
    setNewSucursal({ nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "" });
    setShowSucursalForm(false);
    setRemovedSucursalIds([]);
    setModalOpen(true);
  }

  function openEdit(c: ClienteExt) {
    setEditingId(c.id);
    setForm({
      razon_social: c.razonSocial,
      cuit: c.cuit,
      type: c.type,
      condicion_iva: c.condicionIva,
      email: c.email,
      telefono: c.telefono,
      direccion: c.direccion,
      localidad: c.localidad,
      provincia: c.provincia,
      cp: c.cp,
      lista_precio: c.listaPrecio,
      dias_cuenta_corriente: c.diasCuentaCorriente,
      forma_pago: c.formaPago,
      limite_credito: c.limiteCredito,
      notas: c.notas,
      markup_predeterminado: (c as any).markupPredeterminado ?? null,
      moneda_predeterminada: (c as any).monedaPredeterminada ?? "ARS",
      email_facturacion: c.emailFacturacion ?? "",
      envio_automatico: c.envioAutomatico ?? true,
      pide_oc_para_facturar: (c as any).pideOcParaFacturar ?? false,
      assigned_to: (c as any).assignedTo || null,
      flete: (c as any).flete || "",
      alias_cbu: (c as any).aliasCbu || "",
      tipo_cuenta: (c as any).tipoCuenta || "",
      fecha_pago: (c as any).fechaPago || "",
      email_comprobante: (c as any).emailComprobante || "",
    });
    setFormError("");
    setFormFieldErrors({});
    setCuitLookupMsg(null);
    setEmailCobranzas("");
    setRemovedSucursalIds([]);
    setRemovedContactoIds([]);
    setFormContactos([]);
    setShowContactoModalForm(false);
    setNewContactoModal({ nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" });
    setNewSucursal({ nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "" });
    setShowSucursalForm(false);
    // Fetch sucursales for this client
    setSucursalesLoading(true);
    (supabase as any)
      .from("cliente_sucursales")
      .select("id, nombre, direccion, localidad, provincia, cp, telefono, email")
      .eq("cliente_id", c.id)
      .eq("activo", true)
      .order("nombre")
      .then(({ data }: { data: any[] | null }) => {
        setFormSucursales(
          (data || []).map((s: any) => ({ id: s.id, nombre: s.nombre || "", direccion: s.direccion || "", localidad: s.localidad || "", provincia: s.provincia || "", cp: s.cp || "", telefono: s.telefono || "", email: s.email || "" }))
        );
        setSucursalesLoading(false);
      })
      .catch(() => {
        setFormSucursales(
          (c.sucursales || []).map((s) => ({ id: s.id, nombre: s.nombre, direccion: s.direccion || "", localidad: s.localidad || "", provincia: s.provincia || "", cp: s.cp || "", telefono: s.telefono || "", email: s.email || "" }))
        );
        setSucursalesLoading(false);
      });
    // Fetch contacts
    setContactosModalLoading(true);
    (supabase as any)
      .from("contactos")
      .select("id, nombre, cargo, email, telefono, whatsapp, sucursal_id, principal, notas")
      .eq("entity_type", "cliente")
      .eq("entity_id", c.id)
      .order("principal", { ascending: false })
      .then(({ data }: { data: any[] | null }) => {
        setFormContactos((data || []).map((ct: any) => ({
          id: ct.id, nombre: ct.nombre || "", cargo: ct.cargo || "",
          email: ct.email || "", telefono: ct.telefono || "",
          whatsapp: ct.whatsapp || "", sucursal_id: ct.sucursal_id || "",
          principal: ct.principal ?? false, notas: ct.notas || "",
        })));
        setContactosModalLoading(false);
      })
      .catch(() => {
        setFormContactos((c.contactos || []).map((ct) => ({
          id: ct.id, nombre: ct.nombre, cargo: ct.cargo || "",
          email: ct.email || "", telefono: ct.telefono || "",
          whatsapp: "", sucursal_id: ct.sucursalId || "",
          principal: ct.principal, notas: "",
        })));
        setContactosModalLoading(false);
      });
    setModalOpen(true);
  }

  // Email de cobranzas: no hay columna propia, se guarda como contacto con cargo "Cobranzas".
  function agregarContactoCobranzas() {
    const email = emailCobranzas.trim();
    if (!email) {
      toast.info("Escribí el email de cobranzas y apretá el botón");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) toast.warning("El email de cobranzas no parece válido: revisalo");
    if (formContactos.some((ct) => (ct.email || "").toLowerCase() === email.toLowerCase())) {
      toast.info("Ese email ya está en los contactos");
      return;
    }
    setFormContactos((prev) => [...prev, { ...emptyContactoModal, nombre: "Cobranzas", cargo: "Cobranzas", email, isNew: true }]);
    setEmailCobranzas("");
  }

  // Lector IA de papeles impositivos (constancia ARCA, exención, exclusión): el usuario ya confirmó la vista previa.
  function aplicarDocumentoImpositivo(d: DatosImpositivos) {
    const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    let provincia: string | null = null;
    if (d.provincia) {
      const p = sinTildes(d.provincia);
      provincia = /autonoma|capital federal|^caba$/.test(p) ? "CABA" : provincias.find((x) => sinTildes(x) === p) || null;
    }
    const cambios: string[] = [];
    const next = { ...form };
    if (d.cuit && !form.cuit.trim()) { next.cuit = d.cuit; cambios.push("CUIT"); }
    if (d.razon_social && !form.razon_social.trim()) { next.razon_social = d.razon_social; cambios.push("razón social"); }
    if (d.direccion && !form.direccion.trim()) { next.direccion = d.direccion; cambios.push("dirección"); }
    if (d.localidad && !form.localidad.trim()) { next.localidad = d.localidad; cambios.push("localidad"); }
    if (provincia && !form.provincia.trim()) { next.provincia = provincia; cambios.push("provincia"); }
    if (d.condicion_iva && d.condicion_iva in condicionLabels) {
      if (d.condicion_iva !== form.condicion_iva) cambios.push(`condición IVA → ${condicionLabels[d.condicion_iva]}`);
      next.condicion_iva = d.condicion_iva;
    }
    if (d.resumen) {
      const linea = `Doc. impositivo: ${d.resumen}`;
      if (!form.notas.includes(linea)) { next.notas = form.notas.trim() ? `${form.notas.trim()}\n${linea}` : linea; cambios.push("notas"); }
    }
    setForm(next);
    if (cambios.includes("CUIT")) setFormFieldErrors((p) => ({ ...p, cuit: "" }));
    if (cambios.includes("razón social")) setFormFieldErrors((p) => ({ ...p, razon_social: "" }));
    toast.info(`${TIPO_DOCUMENTO_LABEL[d.tipo_documento] || "Documento"}: ${cambios.length ? `se cargó ${cambios.join(", ")}` : "no había datos nuevos para cargar"}`);
  }

  // Aviso de duplicado → abrir el cliente existente (solo si es de la sociedad activa).
  function abrirClienteParecido(p: ClienteParecido) {
    const c = clientes.find((x) => x.id === p.id);
    if (c && p.sociedad_id === sociedadActiva?.id) {
      setModalOpen(false);
      setSelectedCliente(c);
      setDetailTab("datos");
      return;
    }
    const soc = sociedades.find((s) => s.id === p.sociedad_id)?.nombre || "otra sociedad";
    toast.info(`${p.razon_social} está en ${soc}: cambiá de sociedad para abrirlo`);
  }

  async function handleSave() {
    // Validación por campo
    const fieldErrs: Record<string, string> = {};
    if (!form.razon_social.trim()) fieldErrs.razon_social = "La razón social es obligatoria";
    const isCF = form.condicion_iva === "CF";
    if (!form.cuit.trim()) {
      if (!isCF) fieldErrs.cuit = "El CUIT/DNI es obligatorio";
    } else {
      const cleanCuit = form.cuit.replace(/\D/g, "");
      if (![7, 8, 11].includes(cleanCuit.length)) fieldErrs.cuit = "Ingrese un DNI (7-8 dígitos) o CUIT (11 dígitos)";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      fieldErrs.email = "El email no tiene un formato válido";
    }
    if (Object.keys(fieldErrs).length > 0) {
      setFormFieldErrors(fieldErrs);
      setFormError("");
      // Scroll to first error
      const firstKey = Object.keys(fieldErrs)[0];
      setTimeout(() => {
        const el = document.getElementById(`field-${firstKey}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }
    setFormFieldErrors({});
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      setFormError("Seleccioná una sociedad antes de guardar el cliente");
      toast.error("No hay una sociedad activa");
      return;
    }
    // Si escribió el email de cobranzas pero no apretó "+ Contacto de cobranzas", se agrega igual como contacto.
    let contactosAGuardar = formContactos;
    const emailCobr = emailCobranzas.trim();
    if (emailCobr) {
      if (!contactosAGuardar.some((ct) => (ct.email || "").trim().toLowerCase() === emailCobr.toLowerCase())) {
        contactosAGuardar = [...contactosAGuardar, { ...emptyContactoModal, nombre: "Cobranzas", cargo: "Cobranzas", email: emailCobr, isNew: true }];
        setFormContactos(contactosAGuardar);
      }
      setEmailCobranzas("");
    }
    setSaving(true);
    setFormError("");
    try {
      const { markup_predeterminado, ...formWithout } = form;
      const payload: Record<string, unknown> = {
        ...formWithout,
        markup_predeterminado: markup_predeterminado != null && markup_predeterminado !== (0 as any) ? markup_predeterminado : null,
        email_facturacion: form.email_facturacion?.trim() || null,
        assigned_to: (form as any).assigned_to || null,
        flete: (form as any).flete?.trim() || null,
        alias_cbu: form.alias_cbu?.trim() || null,
        tipo_cuenta: form.tipo_cuenta?.trim() || null,
        fecha_pago: form.fecha_pago?.trim() || null,
        email_comprobante: form.email_comprobante?.trim() || null,
      };
      payload.sociedad_id = sociedadId;
      if (editingId) {
        let clienteUpdate = supabase
          .from("clientes")
          .update(payload as any)
          .eq("id", editingId);
        clienteUpdate = clienteUpdate.eq("sociedad_id" as any, sociedadId);
        const { error } = await clienteUpdate;
        if (error) throw error;

        // Save sucursales changes
        // Delete removed sucursales
        for (const id of removedSucursalIds) {
          const { error: sucErr } = await (supabase as any)
            .from("cliente_sucursales")
            .update({ activo: false })
            .eq("id", id)
            .eq("cliente_id", editingId);
          if (sucErr) throw sucErr;
        }
        // Insert new sucursales
        const newSucs = formSucursales.filter((s) => s.isNew);
        const sucIdMapEdit = new Map<string, string>();
        for (const s of newSucs) {
          const { data: sucInsEdit, error: sucErr } = await (supabase as any)
            .from("cliente_sucursales")
            .insert({ cliente_id: editingId, nombre: s.nombre, direccion: s.direccion || null, localidad: s.localidad || null, provincia: s.provincia || null, cp: s.cp || null, telefono: s.telefono || null, email: s.email || null, activo: true })
            .select("id").single();
          if (sucErr) throw sucErr;
          if (sucInsEdit?.id) sucIdMapEdit.set(s.id, sucInsEdit.id as string);
        }
        // Contactos que apuntan a una sucursal recién agregada (id temporal "new-...") pasan al id real
        const mapSucIdEdit = (id: string) => (id && sucIdMapEdit.has(id) ? sucIdMapEdit.get(id)! : id && id.startsWith("new-") ? "" : id);
        // Update existing sucursales (non-new)
        const existingSucs = formSucursales.filter((s) => !s.isNew);
        for (const s of existingSucs) {
          const { error: sucErr } = await (supabase as any)
            .from("cliente_sucursales")
            .update({ nombre: s.nombre, direccion: s.direccion || null, localidad: s.localidad || null, provincia: s.provincia || null, cp: s.cp || null, telefono: s.telefono || null, email: s.email || null })
            .eq("id", s.id)
            .eq("cliente_id", editingId);
          if (sucErr) throw sucErr;
        }

        // Save contact changes
        for (const id of removedContactoIds) {
          await (supabase as any).from("contactos").delete().eq("id", id).eq("entity_type", "cliente").eq("entity_id", editingId);
        }
        const newContsEdit = contactosAGuardar.filter((ct) => ct.isNew);
        for (const ct of newContsEdit) {
          await (supabase as any).from("contactos").insert({
            entity_type: "cliente", entity_id: editingId,
            nombre: ct.nombre, cargo: ct.cargo || null,
            email: ct.email || null, telefono: ct.telefono || null,
            whatsapp: ct.whatsapp || null, sucursal_id: mapSucIdEdit(ct.sucursal_id) || null,
            principal: ct.principal, notas: ct.notas || null,
          });
        }
        const existingContsEdit = contactosAGuardar.filter((ct) => ct.id && !ct.isNew);
        for (const ct of existingContsEdit) {
          await (supabase as any).from("contactos").update({
            nombre: ct.nombre, cargo: ct.cargo || null,
            email: ct.email || null, telefono: ct.telefono || null,
            whatsapp: ct.whatsapp || null, sucursal_id: mapSucIdEdit(ct.sucursal_id) || null,
            principal: ct.principal, notas: ct.notas || null,
          }).eq("id", ct.id!).eq("entity_type", "cliente").eq("entity_id", editingId);
        }
        toast.success("Cliente actualizado correctamente");
      } else {
        const { data: inserted, error } = await supabase
          .from("clientes")
          .insert(payload as any)
          .select("id")
          .single();
        if (error) throw error;
        const newClientId = inserted.id;

        // Auto-crear "Sucursal Principal" si hay dirección y no se agregaron sucursales manualmente
        const hasAddress = form.direccion?.trim() || form.localidad?.trim() || form.provincia?.trim();
        if (hasAddress && formSucursales.length === 0) {
          await (supabase as any).from("cliente_sucursales").insert({
            cliente_id: newClientId,
            nombre: "Sucursal Principal",
            direccion: form.direccion?.trim() || null,
            localidad: form.localidad?.trim() || null,
            provincia: form.provincia?.trim() || null,
            cp: form.cp?.trim() || null,
            telefono: form.telefono?.trim() || null,
            email: form.email?.trim() || null,
            principal: true,
            activo: true,
          });
        }
        // Insertar sucursales agregadas manualmente (ids temporales "new-..." -> id real)
        const sucIdMap = new Map<string, string>();
        let sucFallo: string | null = null;
        for (const s of formSucursales.filter((s) => s.isNew)) {
          const { data: sucIns, error: sucErr } = await (supabase as any).from("cliente_sucursales").insert({
            cliente_id: newClientId, nombre: s.nombre, direccion: s.direccion || null,
            localidad: s.localidad || null, provincia: s.provincia || null, cp: s.cp || null,
            telefono: s.telefono || null, email: s.email || null, activo: true,
          }).select("id").single();
          if (sucErr || !sucIns?.id) {
            sucFallo = `No se pudo guardar la sucursal "${s.nombre}": ${sucErr?.message || "error desconocido"}`;
            break;
          }
          sucIdMap.set(s.id, sucIns.id as string);
        }
        // Si el contacto apunta a una sucursal temporal que no se guardó (se quitó o falló), queda sin sucursal.
        const mapSucId = (id: string) => (id && sucIdMap.has(id) ? sucIdMap.get(id)! : id && id.startsWith("new-") && !sucFallo ? "" : id);
        if (sucFallo) {
          // El cliente ya quedó guardado: pasamos el modal a modo edición para reintentar sin duplicarlo.
          setEditingId(newClientId);
          setFormSucursales((prev) => prev.map((s) => (sucIdMap.has(s.id) ? { ...s, id: sucIdMap.get(s.id)!, isNew: false } : s)));
          setFormContactos(contactosAGuardar.map((ct) => ({ ...ct, sucursal_id: mapSucId(ct.sucursal_id) })));
          setFormError(`El cliente se creó, pero falló una sucursal. ${sucFallo}. Revisá y apretá Guardar de nuevo.`);
          toast.error(sucFallo);
          await fetchClientes();
          return;
        }
        // Save new contacts for new client
        const newConts = contactosAGuardar.filter((ct) => ct.isNew);
        for (const ct of newConts) {
          await (supabase as any).from("contactos").insert({
            entity_type: "cliente", entity_id: newClientId,
            nombre: ct.nombre, cargo: ct.cargo || null,
            email: ct.email || null, telefono: ct.telefono || null,
            whatsapp: ct.whatsapp || null, sucursal_id: mapSucId(ct.sucursal_id) || null,
            principal: ct.principal, notas: ct.notas || null,
          });
        }
        toast.success("Cliente creado correctamente");
      }
      setModalOpen(false);
      await fetchClientes();
    } catch (err: unknown) {
      const dbError = err as { code?: string; message?: string } | null;
      const msg = dbError?.code === "23505"
        ? "Ya existe un cliente con ese CUIT/DNI en esta sociedad"
        : dbError?.message || (err instanceof Error ? err.message : "Error al guardar");
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActivo(c: ClienteExt) {
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      toast.error("Seleccioná una sociedad antes de cambiar el estado");
      return;
    }
    try {
      let clienteToggle = supabase.from("clientes").update({ activo: !c.activo }).eq("id", c.id);
      clienteToggle = clienteToggle.eq("sociedad_id" as any, sociedadId);
      const { error } = await clienteToggle;
      if (error) throw error;
      toast.info(c.activo ? "Cliente desactivado" : "Cliente activado");
      await fetchClientes();
    } catch (err) {
      console.error("Error toggling activo:", err);
      toast.error("Error al cambiar estado del cliente");
    }
  }

  // Eliminar pide motivo (ventanita). La base decide: con historial se desactiva, sin historial se borra; todo queda guardado.
  function handleDelete(c: ClienteExt) {
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de eliminar el cliente");
      return;
    }
    setClienteAEliminar({ id: c.id, nombre: c.razonSocial });
  }

  // Helpers
  function getInitials(name: string) {
    return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  }

  function toggleSection(key: string) {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function calcDiasMora(fecha: string): number {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const f = new Date(fecha + "T00:00:00");
    const diff = Math.floor((hoy.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  }

  function generateCCText(cliente: ClienteExt, facturas: CCFactura[]): string {
    const today = new Date().toLocaleDateString("es-AR");
    const lines: string[] = [];
    lines.push(`Estimado/a ${cliente.razonSocial},`);
    lines.push("");
    lines.push(`Le enviamos el detalle de su cuenta corriente al dia ${today}:`);
    lines.push("");
    lines.push("Comprobante | Fecha | Vencimiento | Monto | Dias de mora");
    lines.push("-----------------------------------------------------------");
    for (const f of facturas) {
      const comprobante = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
      const venc = f.fecha_vencimiento ? formatDate(f.fecha_vencimiento) : "—";
      const mora = calcDiasMora(f.fecha_vencimiento || f.fecha);
      lines.push(`${comprobante} | ${formatDate(f.fecha)} | ${venc} | ${formatCurrency(f.total, f.moneda as "ARS" | "USD")} | ${mora > 0 ? mora + " dias" : "Al dia"}`);
    }
    lines.push("");
    const totalsByMoneda: Record<string, number> = {};
    facturas.forEach((f) => { totalsByMoneda[f.moneda || "ARS"] = (totalsByMoneda[f.moneda || "ARS"] || 0) + f.total; });
    const totalParts = Object.entries(totalsByMoneda).map(([mon, total]) => formatCurrency(total, mon as "ARS" | "USD"));
    lines.push(`Total pendiente: ${totalParts.join(" + ")}`);
    lines.push("");
    lines.push("Quedamos a disposicion para cualquier consulta.");
    lines.push("Saludos cordiales,");
    lines.push(sociedadActiva?.nombre || "Lazzari Soluciones Industriales");
    return lines.join("\n");
  }

  function handleCopiarCC() {
    if (!selectedCliente) return;
    const text = generateCCText(selectedCliente, ccFacturas);
    navigator.clipboard.writeText(text).then(() => {
      toast.success("Cuenta corriente copiada al portapapeles");
    }).catch(() => {
      toast.error("No se pudo copiar al portapapeles");
    });
  }

  function handleEnviarCC() {
    if (!selectedCliente) return;
    const email = selectedCliente.emailFacturacion || selectedCliente.email;
    if (!email) {
      toast.error("El cliente no tiene email configurado");
      return;
    }
    const subject = encodeURIComponent(`Cuenta Corriente - ${selectedCliente.razonSocial}`);
    const body = encodeURIComponent(generateCCText(selectedCliente, ccFacturas));
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_self");
  }

  if (loading) {
    return (
      <>
        <Header title="Clientes" subtitle="Cargando..." action={{ label: "Nuevo cliente", onClick: () => {} }} />
        <div className="flex items-center justify-center p-24">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          <span className="ml-3 text-sm text-zinc-500">Cargando clientes...</span>
        </div>
      </>
    );
  }

  // Detail panel tab configs
  const detailTabs: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
    { key: "datos", label: "Datos", icon: <FileText className="h-3.5 w-3.5" /> },
    { key: "contactos", label: "Contactos", icon: <User className="h-3.5 w-3.5" /> },
    { key: "sucursales", label: "Sucursales", icon: <Building2 className="h-3.5 w-3.5" /> },
    { key: "relevamiento", label: "Relevamiento", icon: <ShoppingBag className="h-3.5 w-3.5" /> },
    { key: "historial", label: "Ficha 360", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: "actividad", label: "Actividad", icon: <Clock className="h-3.5 w-3.5" /> },
    { key: "cc", label: "Cta. Cte.", icon: <CreditCard className="h-3.5 w-3.5" /> },
  ];

  // Handler: assign vendedor to a contacto
  async function handleAssignVendedor(contactoId: string, vendedorId: string | null) {
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de asignar el vendedor");
      return;
    }
    try {
      const { error } = await (supabase as any)
        .from("contactos")
        .update({ vendedor_id: vendedorId })
        .eq("id", contactoId).eq("entity_type", "cliente").eq("entity_id", selectedCliente?.id);
      if (error) {
        toast.error("Error al asignar vendedor");
        return;
      }
      // Update local state
      const vendedorName = vendedorId ? vendedores.find((v) => v.id === vendedorId)?.full_name ?? null : null;
      setSelectedCliente((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          contactos: prev.contactos.map((c) =>
            c.id === contactoId ? { ...c, vendedorId, vendedorNombre: vendedorName } : c
          ),
        };
      });
      toast.success("Vendedor asignado correctamente");
    } catch {
      toast.error("Error al asignar vendedor");
    }
  }

  async function handleSaveSucursalDetail() {
    if (!selectedCliente || !sucursalDetailForm.nombre.trim()) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de guardar la sucursal");
      return;
    }
    setSavingSucursal(true);
    try {
      const sucursalPayload = {
        nombre: sucursalDetailForm.nombre.trim(),
        direccion: sucursalDetailForm.direccion || null,
        localidad: sucursalDetailForm.localidad || null,
        provincia: sucursalDetailForm.provincia || null,
        cp: sucursalDetailForm.cp || null,
        telefono: sucursalDetailForm.telefono || null,
        email: sucursalDetailForm.email || null,
        transportista_id: sucursalDetailForm.transportista_id || null,
        principal: sucursalDetailForm.principal,
      };
      if (editingSucursalId) {
        const { error } = await (supabase as any).from("cliente_sucursales").update(sucursalPayload).eq("id", editingSucursalId).eq("cliente_id", selectedCliente.id);
        if (error) throw error;
        // Si se marcó como principal, desmarcar las demás
        if (sucursalDetailForm.principal) {
          await (supabase as any).from("cliente_sucursales").update({ principal: false }).eq("cliente_id", selectedCliente.id).neq("id", editingSucursalId);
        }
        toast.success("Sucursal actualizada");
      } else {
        const { error } = await (supabase as any).from("cliente_sucursales").insert({ cliente_id: selectedCliente.id, ...sucursalPayload, activo: true });
        if (error) throw error;
        // Si se marcó como principal, desmarcar las demás
        if (sucursalDetailForm.principal) {
          const { data: newSuc } = await (supabase as any).from("cliente_sucursales").select("id").eq("cliente_id", selectedCliente.id).order("created_at", { ascending: false }).limit(1).single();
          if (newSuc) await (supabase as any).from("cliente_sucursales").update({ principal: false }).eq("cliente_id", selectedCliente.id).neq("id", newSuc.id);
        }
        toast.success("Sucursal agregada");
      }
      setAddingSucursal(false);
      setEditingSucursalId(null);
      setSucursalDetailForm(emptySucursalDetailForm);
      // Refresh sucursales
      const { data } = await (supabase as any).from("cliente_sucursales").select("id, nombre, direccion, localidad, provincia, cp, telefono, email, principal, transportista_id").eq("cliente_id", selectedCliente.id).eq("activo", true).order("principal", { ascending: false });
      if (data) {
        const tMap = new Map(transportistas.map(t => [t.id, t.nombre]));
        setSelectedCliente((prev) => prev ? { ...prev, sucursales: data.map((s: any) => ({ id: s.id, nombre: s.nombre ?? "", direccion: s.direccion ?? "", localidad: s.localidad ?? "", provincia: s.provincia ?? "", cp: s.cp ?? "", telefono: s.telefono ?? "", email: s.email ?? "", principal: s.principal ?? false, transportistaId: s.transportista_id ?? null, transportistaNombre: s.transportista_id ? tMap.get(s.transportista_id) ?? null : null })) } : prev);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al guardar sucursal");
    } finally {
      setSavingSucursal(false);
    }
  }

  async function handleDeleteSucursalDetail(sucursalId: string) {
    if (!selectedCliente) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de eliminar la sucursal");
      return;
    }
    try {
      const { error } = await (supabase as any).from("cliente_sucursales").update({ activo: false }).eq("id", sucursalId).eq("cliente_id", selectedCliente.id);
      if (error) throw error;
      setSelectedCliente((prev) => prev ? { ...prev, sucursales: (prev.sucursales || []).filter((s) => s.id !== sucursalId) } : prev);
      toast.success("Sucursal eliminada");
    } catch {
      toast.error("Error al eliminar sucursal");
    }
  }

  async function handleSaveContacto() {
    if (!selectedCliente || !contactoForm.nombre.trim()) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de guardar el contacto");
      return;
    }
    setSavingContacto(true);
    try {
      if (editingContactoId) {
        const { error } = await (supabase as any).from("contactos").update({
          nombre: contactoForm.nombre.trim(),
          cargo: contactoForm.cargo || null,
          email: contactoForm.email || null,
          telefono: contactoForm.telefono || null,
          whatsapp: contactoForm.whatsapp || null,
          sucursal_id: contactoForm.sucursal_id || null,
          principal: contactoForm.principal,
          notas: contactoForm.notas || null,
        }).eq("id", editingContactoId).eq("entity_type", "cliente").eq("entity_id", selectedCliente.id);
        if (error) throw error;
        toast.success("Contacto actualizado");
      } else {
        const { error } = await (supabase as any).from("contactos").insert({
          entity_type: "cliente",
          entity_id: selectedCliente.id,
          nombre: contactoForm.nombre.trim(),
          cargo: contactoForm.cargo || null,
          email: contactoForm.email || null,
          telefono: contactoForm.telefono || null,
          whatsapp: contactoForm.whatsapp || null,
          sucursal_id: contactoForm.sucursal_id || null,
          principal: contactoForm.principal,
          notas: contactoForm.notas || null,
        });
        if (error) throw error;
        toast.success("Contacto agregado");
      }
      setAddingContacto(false);
      setEditingContactoId(null);
      setContactoForm(emptyContactoForm);
      // Refresh contactos
      const { data } = await (supabase as any).from("contactos").select("*, vendedor:vendedor_id(id, full_name)").eq("entity_type", "cliente").eq("entity_id", selectedCliente.id);
      if (data) {
        setSelectedCliente((prev) => prev ? { ...prev, contactos: data.map((c: any) => ({ id: c.id, nombre: c.nombre ?? "", cargo: c.cargo ?? "", email: c.email ?? "", telefono: c.telefono ?? "", principal: c.principal ?? false, fechaCumpleanos: c.fecha_cumpleanos ?? null, notas: c.notas ?? null, sucursalId: c.sucursal_id ?? null, vendedorId: c.vendedor_id ?? null, vendedorNombre: c.vendedor?.full_name ?? null, whatsapp: c.whatsapp ?? "" })) } : prev);
      }
    } catch (err: any) {
      toast.error(err.message || "Error al guardar contacto");
    } finally {
      setSavingContacto(false);
    }
  }

  async function handleDeleteContacto(contactoId: string) {
    if (!selectedCliente) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de eliminar el contacto");
      return;
    }
    try {
      const { error } = await (supabase as any).from("contactos").delete().eq("id", contactoId).eq("entity_type", "cliente").eq("entity_id", selectedCliente.id);
      if (error) throw error;
      setSelectedCliente((prev) => prev ? { ...prev, contactos: prev.contactos.filter((c) => c.id !== contactoId) } : prev);
      toast.success("Contacto eliminado");
    } catch {
      toast.error("Error al eliminar contacto");
    }
  }

  return (
    <>
      <Header
        title="Clientes"
        subtitle={`${activos} clientes activos`}
        action={{ label: "Nuevo cliente", onClick: openCreate }}
      />
      <div className="p-3 sm:p-4 space-y-2.5">
        {/* Búsqueda, filtros y exportar en una sola línea (el panel de filtros abre abajo, a todo el ancho) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por razon social, CUIT o email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <SmartFilters className="contents [&>button]:mb-0 [&>div]:order-last [&>div]:basis-full" filters={filterConfigs} values={filterValues} onChange={setFilterValues} />
          <button onClick={exportCSV} className="ml-auto flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <Download className="h-4 w-4" /> Exportar
          </button>
        </div>
        {saldosError && <p className="text-xs text-amber-600">{saldosError}</p>}

        {/* Números rápidos en una línea */}
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Clientes</span> <b>{clientes.length}</b></span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-zinc-500">Saldo CC</span> <b className="font-mono">{formatCurrency(clientes.reduce((a, c) => a + c.saldoCuentaCorriente, 0), "ARS")}</b>
            {clientes.some((c) => (c.saldoUSD || 0) !== 0) && <b className="font-mono text-zinc-500"> + {formatCurrency(clientes.reduce((a, c) => a + (c.saldoUSD || 0), 0), "USD")}</b>}
          </span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Crédito otorgado</span> <b className="font-mono">{formatCurrency(clientes.reduce((a, c) => a + c.limiteCredito, 0), "ARS")}</b></span>
          <span className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900"><span className="text-zinc-500">Provincias</span> <b>{new Set(clientes.map((c) => c.provincia)).size}</b></span>
        </div>

        <Card className="p-0 overflow-hidden">
            <DataTable<ClienteExt>
              columns={[
                {
                  key: "razonSocial", label: "Razon social", sortable: true,
                  render: (row) => {
                    const pendCount = pendingCountMap[row.id] || 0;
                    return (
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-600 font-bold text-xs dark:bg-orange-900/30 dark:text-orange-400">
                        {getInitials(row.razonSocial)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-zinc-900 dark:text-white truncate">{row.razonSocial}</p>
                          {pendCount > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                              <AlertCircle className="h-2.5 w-2.5" />
                              {pendCount} pend.
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400">{row.cuit ? (row.cuit.replace(/\D/g, "").length <= 8 ? `DNI ${row.cuit}` : row.cuit) : "Sin CUIT/DNI"}</p>
                      </div>
                    </div>
                    );
                  },
                },
                { key: "localidad", label: "Ubicación", sortable: true, render: (row) => (
                  <span className="block max-w-[200px] truncate text-xs text-zinc-500" title={`${row.localidad}${row.provincia ? `, ${row.provincia}` : ""}`}>{row.localidad}{row.provincia ? `, ${row.provincia}` : ""}</span>
                )},
                { key: "sucursales", label: "Suc.", sortable: false, render: (row) => {
                  const n = row.sucursales?.length || 0;
                  return n > 0 ? (
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                      <Building2 className="h-3 w-3" /> {n}
                    </div>
                  ) : <span className="text-zinc-300 dark:text-zinc-600">—</span>;
                }},
                { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", sortable: true, render: (row) => (
                  <span className="font-mono text-xs block text-right">
                    <span className={row.saldoCuentaCorriente < 0 ? "text-emerald-600" : ""} title={row.saldoCuentaCorriente < 0 ? "Saldo a favor del cliente" : undefined}>{formatCurrency(row.saldoCuentaCorriente, "ARS")}</span>
                    {(row.saldoUSD || 0) !== 0 && <span className={`block ${(row.saldoUSD || 0) < 0 ? "text-emerald-600" : "text-zinc-500"}`}>{formatCurrency(row.saldoUSD || 0, "USD")}</span>}
                  </span>
                ) },
                { key: "activo", label: "Estado", sortable: true, render: (row) => <Badge variant={row.activo ? "success" : "danger"}>{row.activo ? "Activo" : "Inactivo"}</Badge> },
                {
                  key: "actions", label: "", sortable: false,
                  render: (row) => (
                    <div className="flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleActivo(row); }} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300" title={row.activo ? "Desactivar" : "Activar"}>
                        {row.activo ? <ToggleRight className="h-3.5 w-3.5 text-green-500" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ),
                },
              ]}
              data={filtered}
              onRowClick={(row) => { setSelectedCliente(row); setDetailTab("datos"); }}
            />
          </Card>
      </div>

      {/* ===================== DETAIL SIDE PANEL ===================== */}
      {selectedCliente && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/20 animate-fade-in" onClick={() => { setSelectedCliente(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-xl"
          }>
            {/* Panel header with avatar */}
            <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-4 p-4 sm:p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 text-white font-bold text-lg shadow-md">
                  {getInitials(selectedCliente.razonSocial)}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-white truncate">{selectedCliente.razonSocial}</h2>
                  <p className="text-sm text-zinc-500">{selectedCliente.cuit ? (selectedCliente.cuit.replace(/\D/g, "").length <= 8 ? `DNI ${selectedCliente.cuit}` : selectedCliente.cuit) : "Sin CUIT/DNI"}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setPanelFullscreen(!panelFullscreen)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => { openEdit(selectedCliente); setSelectedCliente(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(selectedCliente)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setSelectedCliente(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors" title="Cerrar">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 px-4 sm:px-6">
                {detailTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === tab.key
                        ? "border-orange-500 text-orange-600 dark:text-orange-400"
                        : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    }`}
                  >
                    {tab.icon}
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="p-4 sm:p-6 space-y-6">

              {/* ---- TAB: DATOS ---- */}
              {detailTab === "datos" && (
                <>
                  {/* Status + Type badges */}
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedCliente.activo ? "success" : "danger"}>
                      {selectedCliente.activo ? "Activo" : "Inactivo"}
                    </Badge>
                    <Badge variant="info">{selectedCliente.type === "empresa" ? "Empresa" : "Persona"}</Badge>
                  </div>

                  {/* General info */}
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Informacion general</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <InfoField label="Condicion IVA" value={condicionLabels[selectedCliente.condicionIva] || selectedCliente.condicionIva} />
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Email</p>
                        <p className="text-sm font-medium mt-0.5">{selectedCliente.email ? <a href={`mailto:${selectedCliente.email}`} className="text-orange-600 hover:underline">{selectedCliente.email}</a> : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Telefono</p>
                        <p className="text-sm font-medium mt-0.5">{selectedCliente.telefono ? <a href={`tel:${selectedCliente.telefono}`} className="text-orange-600 hover:underline">{selectedCliente.telefono}</a> : "—"}</p>
                      </div>
                      <InfoField label="Vendedor" value={selectedCliente.vendedorNombre} />
                      <div className="sm:col-span-2">
                        <InfoField
                          label="Direccion"
                          value={[selectedCliente.direccion, selectedCliente.localidad, selectedCliente.provincia, selectedCliente.cp].filter(Boolean).join(", ") || "—"}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Email de facturacion */}
                  <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                      <Send className="h-3.5 w-3.5" /> Facturacion electronica
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">Email facturacion</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm font-medium">
                            {selectedCliente.emailFacturacion ? (
                              <a href={`mailto:${selectedCliente.emailFacturacion}`} className="text-orange-600 hover:underline">{selectedCliente.emailFacturacion}</a>
                            ) : (
                              <span className="text-zinc-400 italic">Mismo email principal</span>
                            )}
                          </p>
                          <button
                            onClick={() => { openEdit(selectedCliente); setSelectedCliente(null); setPanelFullscreen(false); }}
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 transition-colors"
                            title="Editar email facturacion"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Datos para pagos */}
                  {((selectedCliente as any).aliasCbu || (selectedCliente as any).tipoCuenta || (selectedCliente as any).fechaPago || (selectedCliente as any).emailComprobante) && (
                    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                        <Wallet className="h-3.5 w-3.5" /> Datos para pagos
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {(selectedCliente as any).aliasCbu && <InfoField label="Alias / CBU" value={(selectedCliente as any).aliasCbu} />}
                        {selectedCliente.cuit && <InfoField label="CUIT / CUIL" value={selectedCliente.cuit} />}
                        {(selectedCliente as any).tipoCuenta && <InfoField label="CC / CA" value={(selectedCliente as any).tipoCuenta} />}
                        {(selectedCliente as any).fechaPago && <InfoField label="Fecha de pago" value={(selectedCliente as any).fechaPago} />}
                        {(selectedCliente as any).emailComprobante && (
                          <div>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Email para comprobante</p>
                            <p className="text-sm font-medium mt-0.5">
                              <a href={`mailto:${(selectedCliente as any).emailComprobante}`} className="text-orange-600 hover:underline">{(selectedCliente as any).emailComprobante}</a>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Commercial info */}
                  <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Datos comerciales</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <InfoField label="Lista de precios" value={selectedCliente.listaPrecio || "—"} />
                      <InfoField label="Forma de pago" value={selectedCliente.formaPago || "—"} />
                      <InfoField label="Dias CC" value={String(selectedCliente.diasCuentaCorriente)} />
                      <InfoField label="Limite credito" value={formatCurrency(selectedCliente.limiteCredito, "ARS")} />
                      <InfoField label="Saldo CC" value={formatCurrency(selectedCliente.saldoCuentaCorriente, "ARS") + ((selectedCliente as ClienteExt).saldoUSD ? ` · ${formatCurrency((selectedCliente as ClienteExt).saldoUSD || 0, "USD")}` : "")} highlight />
                      {selectedCliente.limiteCredito > 0 && selectedCliente.saldoCuentaCorriente >= selectedCliente.limiteCredito && (
                        <div className="col-span-2 sm:col-span-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                          Aviso de límite de crédito: el saldo alcanzó o superó el límite configurado.
                        </div>
                      )}
                      {(selectedCliente as any).flete && <InfoField label="Flete" value={(selectedCliente as any).flete} />}
                    </div>
                  </div>

                  {/* Notes */}
                  {selectedCliente.notas && (
                    <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
                        <StickyNote className="h-3.5 w-3.5" /> Notas
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3">{selectedCliente.notas}</p>
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: CONTACTOS ---- */}
              {detailTab === "contactos" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-zinc-500">{selectedCliente.contactos?.length || 0} contacto{(selectedCliente.contactos?.length || 0) !== 1 ? "s" : ""}</span>
                    {!addingContacto && !editingContactoId && (
                      <button onClick={() => { setAddingContacto(true); setContactoForm(emptyContactoForm); }} className="flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Agregar
                      </button>
                    )}
                  </div>

                  {/* Formulario agregar/editar contacto */}
                  {(addingContacto || editingContactoId) && (
                    <div ref={(el) => { if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} className="mb-4 rounded-lg border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-900/10 p-3 space-y-2">
                      <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">{editingContactoId ? "Editar contacto" : "Nuevo contacto"}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Nombre *" value={contactoForm.nombre} onChange={(e) => setContactoForm((p) => ({ ...p, nombre: e.target.value }))} />
                        <Input label="Cargo" value={contactoForm.cargo} onChange={(e) => setContactoForm((p) => ({ ...p, cargo: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Email" type="email" value={contactoForm.email} onChange={(e) => setContactoForm((p) => ({ ...p, email: e.target.value }))} />
                        <Input label="Teléfono" value={contactoForm.telefono} onChange={(e) => setContactoForm((p) => ({ ...p, telefono: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="WhatsApp" value={contactoForm.whatsapp} onChange={(e) => setContactoForm((p) => ({ ...p, whatsapp: e.target.value }))} />
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Sucursal</label>
                          <select value={contactoForm.sucursal_id} onChange={(e) => setContactoForm((p) => ({ ...p, sucursal_id: e.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                            <option value="">General</option>
                            {(selectedCliente.sucursales || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                          </select>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={contactoForm.principal} onChange={(e) => setContactoForm((p) => ({ ...p, principal: e.target.checked }))} className="h-3.5 w-3.5 rounded border-zinc-300 text-orange-500" />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">Contacto principal</span>
                      </label>
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => { setAddingContacto(false); setEditingContactoId(null); setContactoForm(emptyContactoForm); }} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                        <button type="button" onClick={handleSaveContacto} disabled={savingContacto || !contactoForm.nombre.trim()} className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                          {savingContacto && <Loader2 className="h-3 w-3 animate-spin" />} Guardar
                        </button>
                      </div>
                    </div>
                  )}

                  {(!selectedCliente.contactos || selectedCliente.contactos.length === 0) ? (
                    <EmptyState icon={<User className="h-6 w-6" />} text="Sin contactos registrados" />
                  ) : (
                    <div className="space-y-3">
                      {/* Group by sucursal */}
                      {(() => {
                        const sucursalMap = new Map<string, string>();
                        for (const s of selectedCliente.sucursales ?? []) {
                          sucursalMap.set(s.id, s.nombre);
                        }

                        const grouped: Record<string, typeof selectedCliente.contactos> = {};
                        for (const c of selectedCliente.contactos ?? []) {
                          const key = c.sucursalId && sucursalMap.has(c.sucursalId) ? c.sucursalId : "__general__";
                          if (!grouped[key]) grouped[key] = [];
                          grouped[key].push(c);
                        }

                        return Object.entries(grouped).map(([key, contacts]) => (
                          <div key={key}>
                            {key !== "__general__" && (
                              <p className="text-xs font-semibold text-zinc-500 mb-2 flex items-center gap-1.5">
                                <Building2 className="h-3 w-3 text-orange-500" />
                                {sucursalMap.get(key)}
                              </p>
                            )}
                            {key === "__general__" && Object.keys(grouped).length > 1 && (
                              <p className="text-xs font-semibold text-zinc-500 mb-2">Contactos generales</p>
                            )}
                            <div className="space-y-2">
                              {contacts.map((c) => (
                                <div key={c.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 bg-white dark:bg-zinc-800/50">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2.5">
                                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 font-medium text-xs dark:bg-zinc-700 dark:text-zinc-300">
                                        {getInitials(c.nombre)}
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.nombre}</p>
                                        {c.cargo && <p className="text-xs text-zinc-500">{c.cargo}</p>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      {c.principal && <Badge variant="info">Principal</Badge>}
                                      <button onClick={() => { setEditingContactoId(c.id); setAddingContacto(false); setContactoForm({ nombre: c.nombre, cargo: c.cargo || "", email: c.email || "", telefono: c.telefono || "", whatsapp: (c as any).whatsapp || "", sucursal_id: c.sucursalId || "", principal: c.principal, notas: c.notas || "" }); }} className="rounded p-1 text-zinc-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                                      <button onClick={() => handleDeleteContacto(c.id)} className="rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                                    </div>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-10">
                                    {c.email && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Mail className="h-3 w-3" /> {c.email}
                                      </div>
                                    )}
                                    {c.telefono && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Phone className="h-3 w-3" /> {c.telefono}
                                      </div>
                                    )}
                                    {c.fechaCumpleanos && (
                                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                                        <Cake className="h-3 w-3" /> {(() => {
                                          const d = new Date(c.fechaCumpleanos + "T00:00:00");
                                          return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  {c.notas && <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500 pl-10">{c.notas}</p>}
                                  <div className="mt-2 pl-10 flex items-center gap-2">
                                    <label className="text-xs text-zinc-500 whitespace-nowrap">Vendedor:</label>
                                    <select
                                      className="text-xs border border-zinc-200 dark:border-zinc-600 rounded-md px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white flex-1 max-w-[200px]"
                                      value={c.vendedorId ?? ""}
                                      onChange={(e) => handleAssignVendedor(c.id, e.target.value || null)}
                                    >
                                      <option value="">Sin asignar</option>
                                      {vendedores.map((v) => (
                                        <option key={v.id} value={v.id}>{v.full_name}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: SUCURSALES ---- */}
              {detailTab === "sucursales" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-zinc-500">{selectedCliente.sucursales?.length || 0} sucursal{(selectedCliente.sucursales?.length || 0) !== 1 ? "es" : ""}</span>
                    {!addingSucursal && !editingSucursalId && (
                      <button onClick={() => { setAddingSucursal(true); setSucursalDetailForm(emptySucursalDetailForm); }} className="flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors">
                        <Plus className="h-3.5 w-3.5" /> Nueva sucursal
                      </button>
                    )}
                  </div>

                  {/* Form agregar/editar sucursal */}
                  {(addingSucursal || editingSucursalId) && (
                    <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-900/10 p-3 space-y-2">
                      <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">{editingSucursalId ? "Editar sucursal" : "Nueva sucursal"}</p>
                      <Input label="Nombre *" value={sucursalDetailForm.nombre} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Sucursal Córdoba" />
                      <Input label="Dirección" value={sucursalDetailForm.direccion} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, direccion: e.target.value }))} placeholder="Calle y número" />
                      <div className="grid grid-cols-3 gap-2">
                        <Input label="Localidad" value={sucursalDetailForm.localidad} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, localidad: e.target.value }))} />
                        <Input label="CP" value={sucursalDetailForm.cp} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, cp: e.target.value }))} />
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Provincia</label>
                          <select value={sucursalDetailForm.provincia} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, provincia: e.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                            <option value="">—</option>
                            {provincias.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Teléfono" value={sucursalDetailForm.telefono} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, telefono: e.target.value }))} />
                        <Input label="Email" value={sucursalDetailForm.email} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, email: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Transportista asignado</label>
                        <select value={sucursalDetailForm.transportista_id} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, transportista_id: e.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="">Sin transportista definido</option>
                          {transportistas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                        </select>
                        {transportistas.length === 0 && (
                          <p className="text-xs text-zinc-400">Cargá transportistas desde el módulo Transportes → Catálogo</p>
                        )}
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={sucursalDetailForm.principal} onChange={(e) => setSucursalDetailForm((p) => ({ ...p, principal: e.target.checked }))} className="h-3.5 w-3.5 rounded border-zinc-300 text-orange-500" />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">Sucursal predeterminada</span>
                      </label>
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => { setAddingSucursal(false); setEditingSucursalId(null); setSucursalDetailForm(emptySucursalDetailForm); }} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                        <button type="button" onClick={handleSaveSucursalDetail} disabled={savingSucursal || !sucursalDetailForm.nombre.trim()} className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                          {savingSucursal && <Loader2 className="h-3 w-3 animate-spin" />} Guardar
                        </button>
                      </div>
                    </div>
                  )}

                  {(!selectedCliente.sucursales || selectedCliente.sucursales.length === 0) ? (
                    <EmptyState icon={<Building2 className="h-6 w-6" />} text="Sin sucursales registradas" />
                  ) : (
                    <div className="space-y-3">
                      {selectedCliente.sucursales.map((s) => {
                        const contactosSuc = (selectedCliente.contactos ?? []).filter((c) => c.sucursalId === s.id);
                        return (
                          <div key={s.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                            <div className="bg-zinc-50 p-3 dark:bg-zinc-800/50">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                                    <Building2 className="h-3.5 w-3.5 text-orange-500" />
                                    {s.nombre}
                                  </p>
                                  {s.principal && <Badge variant="info">Principal</Badge>}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => { setEditingSucursalId(s.id); setAddingSucursal(false); setSucursalDetailForm({ nombre: s.nombre, direccion: s.direccion || "", localidad: s.localidad || "", provincia: s.provincia || "", cp: s.cp || "", telefono: s.telefono || "", email: s.email || "", transportista_id: (s as any).transportistaId || "", principal: s.principal ?? false }); }} className="rounded p-1 text-zinc-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => handleDeleteSucursalDetail(s.id)} className="rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                              {(s.direccion || s.localidad || s.provincia) && (
                                <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                                  <MapPin className="h-3 w-3" />
                                  {[s.direccion, s.localidad, s.provincia].filter(Boolean).join(", ")}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-4 mt-1">
                                {s.telefono && <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Phone className="h-3 w-3" /> {s.telefono}</div>}
                                {s.email && <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Mail className="h-3 w-3" /> {s.email}</div>}
                                {(s as any).transportistaNombre && (
                                  <div className="flex items-center gap-1.5 text-xs text-zinc-500"><Truck className="h-3 w-3 text-blue-500" /> {(s as any).transportistaNombre}</div>
                                )}
                              </div>
                            </div>
                            {contactosSuc.length > 0 ? (
                              <div className="border-t border-zinc-100 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
                                {contactosSuc.map((c) => (
                                  <div key={c.id} className="px-3 py-2.5 bg-white dark:bg-zinc-900">
                                    <div className="flex items-center justify-between">
                                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.nombre}</p>
                                      {c.principal && <Badge variant="info">Principal</Badge>}
                                    </div>
                                    {c.cargo && <p className="text-xs text-zinc-500 mt-0.5">{c.cargo}</p>}
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                      {c.email && <div className="flex items-center gap-1 text-xs text-zinc-400"><Mail className="h-3 w-3" /> {c.email}</div>}
                                      {c.telefono && <div className="flex items-center gap-1 text-xs text-zinc-400"><Phone className="h-3 w-3" /> {c.telefono}</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 bg-white dark:bg-zinc-900 text-xs text-zinc-400 italic">Sin contactos — agregá uno desde la pestaña Contactos</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: RELEVAMIENTO ---- */}
              {detailTab === "relevamiento" && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Relevamiento de necesidades</p>
                      <p className="text-xs text-zinc-400 mt-0.5">Productos, marcas, frecuencias y especificaciones habituales del cliente</p>
                    </div>
                    <button onClick={() => { setRelevEditingId(null); setRelevForm(emptyRelevForm); setRelevModalOpen(true); }} className="flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600 transition-colors">
                      <Plus className="h-3.5 w-3.5" /> Nuevo registro
                    </button>
                  </div>

                  {relevLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                    </div>
                  ) : fichasRelevamiento.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <ShoppingBag className="h-8 w-8 text-zinc-300 mb-3" />
                      <p className="text-sm font-medium text-zinc-500">Sin relevamiento registrado</p>
                      <p className="text-xs text-zinc-400 mt-1">Cargá el primer registro para documentar las necesidades del cliente</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {fichasRelevamiento.map((f) => (
                        <div key={f.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                          <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3 flex items-center justify-between">
                            <div>
                              <p className="text-xs text-zinc-400">{formatDate(f.updated_at || f.fecha)}</p>
                              {f.profiles?.full_name && <p className="text-xs text-zinc-400">por {f.profiles.full_name}</p>}
                            </div>
                            <button onClick={() => { setRelevEditingId(f.id); setRelevForm({ descripcion: f.descripcion || "", productos_habituales: f.productos_habituales || "", frecuencia_compra: f.frecuencia_compra || "", marcas_preferidas: f.marcas_preferidas || "", talles: f.talles || "", medidas: f.medidas || "", especificaciones: f.especificaciones || "", observaciones_generales: f.observaciones_generales || "", proxima_accion: f.proxima_accion || "", fecha_proxima_accion: f.fecha_proxima_accion || "" }); setRelevModalOpen(true); }} className="rounded p-1 text-zinc-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
                          </div>
                          <div className="px-4 py-3 space-y-2 text-sm">
                            {f.descripcion && <p className="text-zinc-700 dark:text-zinc-300">{f.descripcion}</p>}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                              {f.productos_habituales && <div><span className="text-zinc-400">Productos habituales: </span><span className="text-zinc-700 dark:text-zinc-300">{f.productos_habituales}</span></div>}
                              {f.frecuencia_compra && <div><span className="text-zinc-400">Frecuencia: </span><span className="text-zinc-700 dark:text-zinc-300">{f.frecuencia_compra}</span></div>}
                              {f.marcas_preferidas && <div><span className="text-zinc-400">Marcas: </span><span className="text-zinc-700 dark:text-zinc-300">{f.marcas_preferidas}</span></div>}
                              {f.talles && <div><span className="text-zinc-400">Talles: </span><span className="text-zinc-700 dark:text-zinc-300">{f.talles}</span></div>}
                              {f.medidas && <div><span className="text-zinc-400">Medidas: </span><span className="text-zinc-700 dark:text-zinc-300">{f.medidas}</span></div>}
                              {f.especificaciones && <div className="col-span-2"><span className="text-zinc-400">Especificaciones: </span><span className="text-zinc-700 dark:text-zinc-300">{f.especificaciones}</span></div>}
                            </div>
                            {f.observaciones_generales && (
                              <div className="rounded bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{f.observaciones_generales}</div>
                            )}
                            {f.proxima_accion && (
                              <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
                                <CalendarDays className="h-3 w-3" />
                                Próxima acción: {f.proxima_accion}{f.fecha_proxima_accion ? ` — ${formatDate(f.fecha_proxima_accion)}` : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Modal relevamiento */}
                  {relevModalOpen && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                      <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-2xl overflow-y-auto max-h-[90vh]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
                          <h3 className="text-base font-semibold dark:text-white">{relevEditingId ? "Editar relevamiento" : "Nuevo relevamiento"}</h3>
                          <button onClick={() => setRelevModalOpen(false)} className="text-zinc-400 hover:text-zinc-600"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="px-6 py-4 space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Descripción general *</label>
                            <textarea value={relevForm.descripcion} onChange={e => setRelevForm(p => ({ ...p, descripcion: e.target.value }))} rows={3} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Descripción del relevamiento, contexto de la visita o la necesidad..." />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Productos/servicios habituales</label>
                            <div className="relative mb-2">
                              <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                  type="text"
                                  value={relevProdSearch}
                                  onChange={e => doRelevProdSearch(e.target.value)}
                                  placeholder="Buscar producto del catálogo..."
                                  className="w-full rounded-lg border border-zinc-300 pl-9 pr-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                                />
                                {relevProdSearching && <Loader2 className="h-4 w-4 animate-spin text-orange-500 absolute right-3 top-1/2 -translate-y-1/2" />}
                              </div>
                              {relevProdResults.length > 0 && (
                                <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl">
                                  {relevProdResults.map((p, i) => (
                                    <button key={i} type="button" onClick={() => addRelevProduct(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 dark:hover:bg-orange-900/20 border-b border-zinc-100 dark:border-zinc-700 last:border-0">
                                      <span className="font-mono text-orange-600 text-xs">{p.codigo}</span>{" "}
                                      <span className="text-zinc-700 dark:text-zinc-300">{p.descripcion}</span>
                                      {p.variante && <span className="ml-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">{p.variante}</span>}
                                      {p.proveedor_nombre && <span className="ml-1 text-xs text-zinc-400">({p.proveedor_nombre})</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <textarea value={relevForm.productos_habituales} onChange={e => setRelevForm(p => ({ ...p, productos_habituales: e.target.value }))} rows={3} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Válvulas de compuerta, mangueras hidráulicas..." />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Frecuencia de compra</label>
                              <input type="text" value={relevForm.frecuencia_compra} onChange={e => setRelevForm(p => ({ ...p, frecuencia_compra: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Mensual, trimestral..." />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Marcas preferidas</label>
                              <input type="text" value={relevForm.marcas_preferidas} onChange={e => setRelevForm(p => ({ ...p, marcas_preferidas: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Pavan, Parker..." />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Talles</label>
                              <input type="text" value={relevForm.talles} onChange={e => setRelevForm(p => ({ ...p, talles: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder='Ej: 1/2", 3/4", 1"' />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Medidas</label>
                              <input type="text" value={relevForm.medidas} onChange={e => setRelevForm(p => ({ ...p, medidas: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: DN25, DN50..." />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Especificaciones frecuentes</label>
                            <textarea value={relevForm.especificaciones} onChange={e => setRelevForm(p => ({ ...p, especificaciones: e.target.value }))} rows={2} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Acero inoxidable, presión máx. 16 bar..." />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Observaciones generales</label>
                            <textarea value={relevForm.observaciones_generales} onChange={e => setRelevForm(p => ({ ...p, observaciones_generales: e.target.value }))} rows={2} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Próxima acción</label>
                              <input type="text" value={relevForm.proxima_accion} onChange={e => setRelevForm(p => ({ ...p, proxima_accion: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Ej: Enviar cotización..." />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha próxima acción</label>
                              <input type="date" value={relevForm.fecha_proxima_accion} onChange={e => setRelevForm(p => ({ ...p, fecha_proxima_accion: e.target.value }))} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 px-6 pb-5">
                          <button onClick={() => setRelevModalOpen(false)} className="px-4 py-2 rounded-lg border border-zinc-300 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:text-zinc-300">Cancelar</button>
                          <button onClick={handleSaveRelevamiento} disabled={relevSaving || !relevForm.descripcion.trim()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50">
                            {relevSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: HISTORIAL (Ficha completa) ---- */}
              {detailTab === "historial" && (
                <Ficha360 sociedadId={sociedadActiva?.id} cliente={{ id: selectedCliente.id, razon_social: selectedCliente.razonSocial, cuit: selectedCliente.cuit, limite_credito: selectedCliente.limiteCredito }} />
              )}

              {detailTab === "actividad" && (
                <>
                  {timelineLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                      <span className="text-xs text-zinc-500">Cargando actividad...</span>
                    </div>
                  ) : timeline.length === 0 ? (
                    <EmptyState icon={<Clock className="h-6 w-6" />} text="Sin actividad registrada para este cliente" />
                  ) : (
                    <div className="relative">
                      {/* Vertical line */}
                      <div className="absolute left-4 top-2 bottom-2 w-px bg-zinc-200 dark:bg-zinc-700" />
                      <div className="space-y-0">
                        {timeline.map((ev, idx) => {
                          const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
                            presupuesto: { icon: <FileText className="h-3.5 w-3.5" />, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400" },
                            factura: { icon: <Receipt className="h-3.5 w-3.5" />, color: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400" },
                            remito: { icon: <Truck className="h-3.5 w-3.5" />, color: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400" },
                            movimiento: { icon: <Wallet className="h-3.5 w-3.5" />, color: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400" },
                          };
                          const cfg = iconMap[ev.tipo] || iconMap.presupuesto;
                          // Group by month
                          const evDate = new Date(ev.fecha + "T00:00:00");
                          const monthLabel = evDate.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
                          const prevDate = idx > 0 ? new Date(timeline[idx - 1].fecha + "T00:00:00") : null;
                          const prevMonth = prevDate ? prevDate.toLocaleDateString("es-AR", { month: "long", year: "numeric" }) : null;
                          const showMonth = monthLabel !== prevMonth;

                          return (
                            <div key={ev.id}>
                              {showMonth && (
                                <p className="ml-10 text-xs font-semibold uppercase tracking-wider text-zinc-400 pt-4 pb-1 first:pt-0">
                                  {monthLabel}
                                </p>
                              )}
                              <div className="flex items-start gap-3 py-2 pl-1">
                                <div className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${cfg.color}`}>
                                  {cfg.icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium dark:text-white truncate">{ev.titulo}</p>
                                    {ev.estado && (
                                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                                        ev.estado === "aprobado" || ev.estado === "emitida" || ev.estado === "entregado" || ev.estado === "pagada"
                                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                          : ev.estado === "rechazado" || ev.estado === "cancelada"
                                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                      }`}>
                                        {ev.estado}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-zinc-500 mt-0.5">{ev.detalle}{ev.url && <> · <a href={ev.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">📷 remito firmado</a></>}</p>
                                  <p className="text-[10px] text-zinc-400 mt-0.5">{formatDate(ev.fecha)}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ---- TAB: CUENTA CORRIENTE ---- */}
              {detailTab === "cc" && (
                <>
                  {ccLoading ? (
                    <div className="flex items-center gap-2 py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                      <span className="text-xs text-zinc-500">Cargando cuenta corriente...</span>
                    </div>
                  ) : ccFacturas.length === 0 ? (
                    <EmptyState icon={<CreditCard className="h-6 w-6" />} text="Sin facturas pendientes de cobro" />
                  ) : (
                    <div className="space-y-4">
                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCopiarCC}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copiar CC
                        </button>
                        <button
                          onClick={handleEnviarCC}
                          className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-medium text-white hover:bg-orange-600 transition-colors"
                        >
                          <Send className="h-3.5 w-3.5" />
                          Enviar CC
                        </button>
                      </div>

                      {/* Facturas pendientes table */}
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        <div className="bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-700">
                          <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                            Facturas pendientes de cobro ({ccFacturas.length})
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
                                <th className="text-left px-3 py-2 font-medium text-zinc-500">Comprobante</th>
                                <th className="text-left px-3 py-2 font-medium text-zinc-500">Fecha</th>
                                <th className="text-left px-3 py-2 font-medium text-zinc-500">Vencimiento</th>
                                <th className="text-right px-3 py-2 font-medium text-zinc-500">Monto</th>
                                <th className="text-right px-3 py-2 font-medium text-zinc-500">Dias mora</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {ccFacturas.map((f) => {
                                const comprobante = `${f.tipo} ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
                                const mora = calcDiasMora(f.fecha_vencimiento || f.fecha);
                                return (
                                  <tr key={f.id} className="bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                                    <td className="px-3 py-2.5 font-medium text-zinc-800 dark:text-zinc-200 whitespace-nowrap">{comprobante}</td>
                                    <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">{formatDate(f.fecha)}</td>
                                    <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">{f.fecha_vencimiento ? formatDate(f.fecha_vencimiento) : "—"}</td>
                                    <td className="px-3 py-2.5 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                                      {formatCurrency(f.total, f.moneda as "ARS" | "USD")}
                                    </td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                      {mora > 0 ? (
                                        <span className={`inline-flex items-center gap-0.5 font-medium ${mora > 30 ? "text-red-600 dark:text-red-400" : mora > 15 ? "text-orange-600 dark:text-orange-400" : "text-amber-600 dark:text-amber-400"}`}>
                                          {mora} d
                                        </span>
                                      ) : (
                                        <span className="text-green-600 dark:text-green-400 font-medium">Al dia</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Total row */}
                        <div className="border-t-2 border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-3 flex items-center justify-between">
                          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Total adeudado</span>
                          <div className="flex flex-col items-end gap-0.5">
                            {(() => {
                              const totals: Record<string, number> = {};
                              ccFacturas.forEach((f) => { totals[f.moneda || "ARS"] = (totals[f.moneda || "ARS"] || 0) + f.total; });
                              return Object.entries(totals).map(([mon, total]) => (
                                <span key={mon} className="text-sm font-bold font-mono text-red-600 dark:text-red-400">
                                  {formatCurrency(total, mon as "ARS" | "USD")}
                                </span>
                              ));
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===================== CREATE / EDIT MODAL ===================== */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Editar cliente" : "Nuevo cliente"}
        description={editingId ? "Modificá los datos del cliente" : "Empezá por el CUIT: se completan razón social, condición IVA y domicilio desde ARCA"}
        size="xl"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? "Guardar cambios" : "Crear cliente"}
            </button>
          </>
        }
      >
        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
            {formError}
          </div>
        )}

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800 [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {/* Section: Datos fiscales */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Datos fiscales</p>
              <LeerDocumentoImpositivo compacto cuitEsperado={form.cuit} onDatos={aplicarDocumentoImpositivo} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div id="field-cuit">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      label={form.condicion_iva === "CF" ? "CUIT / DNI" : "CUIT / DNI *"}
                      value={form.cuit}
                      onChange={(e) => { setForm({ ...form, cuit: e.target.value }); setCuitLookupMsg(null); setFormFieldErrors((p) => ({ ...p, cuit: "" })); }}
                      placeholder="DNI o CUIT"
                      error={formFieldErrors.cuit}
                      autoFocus={!editingId}
                      onBlur={() => {
                        const clean = form.cuit.replace(/\D/g, "");
                        if ([7, 8, 11].includes(clean.length)) handleCuitLookup();
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCuitLookup}
                    disabled={cuitLookupLoading}
                    className="mb-[1px] flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                    title="Consultar ARCA"
                  >
                    {cuitLookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    ARCA
                  </button>
                </div>
                {cuitLookupMsg && (
                  <p className={`mt-1 text-xs ${cuitLookupMsg.type === "error" ? "text-red-500 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                    {cuitLookupMsg.text}
                  </p>
                )}
              </div>
              <Select
                label="Condición IVA"
                value={form.condicion_iva}
                onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })}
                options={Object.entries(condicionLabels).map(([k, v]) => ({ value: k, label: v }))}
              />
              <Select
                label="Tipo"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                options={[
                  { value: "empresa", label: "Empresa" },
                  { value: "persona", label: "Persona" },
                ]}
              />
              <div className="sm:col-span-2 lg:col-span-3" id="field-razon_social">
                <Input
                  label="Razón social *"
                  value={form.razon_social}
                  onChange={(e) => { setForm({ ...form, razon_social: e.target.value }); setFormFieldErrors((p) => ({ ...p, razon_social: "" })); }}
                  placeholder="Nombre o razón social"
                  error={formFieldErrors.razon_social}
                />
              </div>
              {(form.cuit.replace(/\D/g, "").length === 11 || form.razon_social.trim().length >= 4) && (
                <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                  <SemaforoBCRAPrevio cuit={form.cuit} />
                  <AvisoDuplicadosCliente
                    cuit={form.cuit}
                    razonSocial={form.razon_social}
                    excluirId={editingId}
                    sociedades={sociedades}
                    onAbrir={abrirClienteParecido}
                  />
                </div>
              )}
              <div className="sm:col-span-2">
                <Input
                  label="Dirección"
                  value={form.direccion}
                  onChange={(e) => setForm({ ...form, direccion: e.target.value })}
                  placeholder="Calle y número"
                />
              </div>
              <Input
                label="Localidad"
                value={form.localidad}
                onChange={(e) => setForm({ ...form, localidad: e.target.value })}
              />
              <Select
                label="Provincia"
                value={form.provincia}
                onChange={(e) => setForm({ ...form, provincia: e.target.value })}
                options={provincias.map((p) => ({ value: p, label: p }))}
                placeholder="Seleccionar..."
              />
              <Input
                label="Código postal"
                value={form.cp}
                onChange={(e) => setForm({ ...form, cp: e.target.value })}
              />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Flete / Transporte</label>
                <select
                  value={(form as any).flete || ""}
                  onChange={(e) => setForm({ ...form, flete: e.target.value } as any)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">Sin transporte definido</option>
                  {transportistas.map((t) => <option key={t.id} value={t.nombre}>{t.nombre}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section: Contacto y facturación */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Contacto y facturación</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input
                label="Email de facturación"
                type="email"
                value={form.email_facturacion}
                onChange={(e) => setForm({ ...form, email_facturacion: e.target.value })}
                placeholder="Adonde van las facturas"
                hint="Si queda vacío se usa el email principal"
              />
              <div id="field-email">
                <Input
                  label="Email principal"
                  type="email"
                  value={form.email}
                  onChange={(e) => { setForm({ ...form, email: e.target.value }); setFormFieldErrors((p) => ({ ...p, email: "" })); }}
                  error={formFieldErrors.email}
                />
              </div>
              <Input
                label="Teléfono / WhatsApp"
                type="tel"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                placeholder="Ej: +54 9 11 1234-5678"
              />
              <div className="sm:col-span-2 lg:col-span-3 space-y-1.5">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email de cobranzas</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailCobranzas}
                    onChange={(e) => setEmailCobranzas(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregarContactoCobranzas(); } }}
                    placeholder="cobranzas@cliente.com"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={agregarContactoCobranzas}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> Contacto de cobranzas
                  </button>
                </div>
                {formContactos.some((ct) => (ct.cargo || "").toLowerCase() === "cobranzas") ? (
                  <p className="text-xs text-zinc-500">
                    Cobranzas: {formContactos.filter((ct) => (ct.cargo || "").toLowerCase() === "cobranzas").map((ct) => ct.email || ct.nombre).join(", ")} · se guarda en Contactos comerciales
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">Se guarda como contacto con cargo &quot;Cobranzas&quot;.</p>
                )}
              </div>
            </div>
          </div>

          {/* Section: Sucursales (alta y edición; en el alta quedan en memoria hasta guardar) */}
          {(
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Sucursales</p>
              {sucursalesLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando sucursales...
                </div>
              ) : (
                <>
                  {formSucursales.length > 0 ? (
                    <div className="space-y-2 mb-3">
                      {formSucursales.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                            <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{s.nombre}</span>
                            {s.isNew && (
                              <span className="text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded dark:bg-green-900/30 dark:text-green-400">Nueva</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (s.isNew) {
                                setFormSucursales((prev) => prev.filter((x) => x.id !== s.id));
                              } else {
                                setRemovedSucursalIds((prev) => [...prev, s.id]);
                                setFormSucursales((prev) => prev.filter((x) => x.id !== s.id));
                              }
                            }}
                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors"
                            title="Eliminar sucursal"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400 italic mb-3">Sin sucursales registradas</p>
                  )}
                  {!showSucursalForm ? (
                    <button
                      type="button"
                      onClick={() => setShowSucursalForm(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-700 transition-colors w-full justify-center"
                    >
                      <Plus className="h-3.5 w-3.5" /> Nueva sucursal
                    </button>
                  ) : (
                    <div className="rounded-lg border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-900/10 p-3 space-y-2">
                      <Input label="Nombre *" value={newSucursal.nombre} onChange={(e) => setNewSucursal((p) => ({ ...p, nombre: e.target.value }))} placeholder="Ej: Sucursal Córdoba" />
                      <Input label="Dirección" value={newSucursal.direccion} onChange={(e) => setNewSucursal((p) => ({ ...p, direccion: e.target.value }))} placeholder="Calle y número" />
                      <div className="grid grid-cols-3 gap-2">
                        <Input label="Localidad" value={newSucursal.localidad} onChange={(e) => setNewSucursal((p) => ({ ...p, localidad: e.target.value }))} />
                        <Input label="CP" value={newSucursal.cp} onChange={(e) => setNewSucursal((p) => ({ ...p, cp: e.target.value }))} />
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Provincia</label>
                          <select value={newSucursal.provincia} onChange={(e) => setNewSucursal((p) => ({ ...p, provincia: e.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                            <option value="">—</option>
                            {provincias.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Teléfono" value={newSucursal.telefono} onChange={(e) => setNewSucursal((p) => ({ ...p, telefono: e.target.value }))} />
                        <Input label="Email" value={newSucursal.email} onChange={(e) => setNewSucursal((p) => ({ ...p, email: e.target.value }))} />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="button" onClick={() => { setShowSucursalForm(false); setNewSucursal({ nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "" }); }} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                        <button type="button" onClick={() => { if (!newSucursal.nombre.trim()) return; setFormSucursales((prev) => [...prev, { id: `new-${Date.now()}`, ...newSucursal, nombre: newSucursal.nombre.trim(), isNew: true }]); setNewSucursal({ nombre: "", direccion: "", localidad: "", provincia: "", cp: "", telefono: "", email: "" }); setShowSucursalForm(false); }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600">Agregar</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Section: Contactos comerciales */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Contactos comerciales</p>
            {contactosModalLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando contactos...</div>
            ) : (
              <>
                {formContactos.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {formContactos.map((ct, idx) => (
                      <div key={ct.id || idx} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{ct.nombre}</span>
                            {ct.cargo && <span className="ml-2 text-xs text-zinc-400">{ct.cargo}</span>}
                            {ct.principal && <span className="ml-2 text-[10px] font-medium text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded dark:bg-orange-900/30 dark:text-orange-400">Principal</span>}
                            {ct.isNew && <span className="ml-2 text-[10px] font-medium text-green-600 bg-green-50 px-1.5 py-0.5 rounded dark:bg-green-900/30 dark:text-green-400">Nuevo</span>}
                          </div>
                          <button type="button" onClick={() => {
                            if (ct.id && !ct.isNew) setRemovedContactoIds((prev) => [...prev, ct.id!]);
                            setFormContactos((prev) => prev.filter((_, i) => i !== idx));
                          }} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors ml-2">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {(ct.email || ct.telefono || ct.notas) && (
                          <div className="flex flex-col gap-0.5 mt-1">
                            {(ct.email || ct.telefono) && (
                              <div className="flex gap-3">
                                {ct.email && <span className="text-xs text-zinc-400">{ct.email}</span>}
                                {ct.telefono && <span className="text-xs text-zinc-400">{ct.telefono}</span>}
                              </div>
                            )}
                            {ct.notas && <span className="text-xs text-zinc-400 italic">{ct.notas}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!showContactoModalForm ? (
                  <button type="button" onClick={() => setShowContactoModalForm(true)} className="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-700 transition-colors w-full justify-center">
                    <Plus className="h-3.5 w-3.5" /> Agregar contacto
                  </button>
                ) : (
                  <div className="rounded-lg border border-orange-200 bg-orange-50/50 dark:border-orange-900/40 dark:bg-orange-900/10 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Nombre y apellido *" value={newContactoModal.nombre} onChange={(e) => setNewContactoModal((p) => ({ ...p, nombre: formatPersonName(e.target.value) }))} placeholder="Juan Pérez" />
                      <Input label="Cargo" value={newContactoModal.cargo} onChange={(e) => setNewContactoModal((p) => ({ ...p, cargo: e.target.value }))} placeholder="Compras, Gerente..." />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input label="Email" type="email" value={newContactoModal.email} onChange={(e) => setNewContactoModal((p) => ({ ...p, email: e.target.value }))} />
                      <Input label="WhatsApp" value={newContactoModal.whatsapp} onChange={(e) => setNewContactoModal((p) => ({ ...p, whatsapp: e.target.value }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Sucursal</label>
                        <select value={newContactoModal.sucursal_id} onChange={(e) => setNewContactoModal((p) => ({ ...p, sucursal_id: e.target.value }))} className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="">— Sin asignar</option>
                          {formSucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                        </select>
                      </div>
                    </div>
                    <Textarea label="Comentario" value={newContactoModal.notas} onChange={(e) => setNewContactoModal((p) => ({ ...p, notas: e.target.value }))} placeholder="Horario de atención, preferencias, etc." rows={2} />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newContactoModal.principal} onChange={(e) => setNewContactoModal((p) => ({ ...p, principal: e.target.checked }))} className="h-4 w-4 rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">Contacto principal</span>
                    </label>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" onClick={() => { setShowContactoModalForm(false); setNewContactoModal({ nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" }); }} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700">Cancelar</button>
                      <button type="button" onClick={() => {
                        if (!newContactoModal.nombre.trim()) return;
                        setFormContactos((prev) => [...prev, { ...newContactoModal, nombre: formatPersonName(newContactoModal.nombre.trim()), isNew: true }]);
                        setNewContactoModal({ nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", sucursal_id: "", principal: false, notas: "" });
                        setShowContactoModalForm(false);
                      }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600">Agregar</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Section: Cobranza y pagos */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Datos para pagos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input
                label="Alias / CBU"
                value={form.alias_cbu}
                onChange={(e) => setForm({ ...form, alias_cbu: e.target.value })}
                placeholder="Alias o CBU del cliente"
              />
              <Select
                label="Tipo de cuenta"
                value={form.tipo_cuenta}
                onChange={(e) => setForm({ ...form, tipo_cuenta: e.target.value })}
                options={[
                  { value: "CC $", label: "Cuenta Corriente $" },
                  { value: "CA $", label: "Caja de Ahorro $" },
                  { value: "CC USD", label: "Cuenta Corriente USD" },
                  { value: "CA USD", label: "Caja de Ahorro USD" },
                ]}
                placeholder="Seleccionar..."
              />
              <Input
                label="Fecha de pago"
                value={form.fecha_pago}
                onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
                placeholder="Ej: 10 de cada mes, último viernes"
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <Input
                  label="Email para comprobantes de pago"
                  type="email"
                  value={form.email_comprobante}
                  onChange={(e) => setForm({ ...form, email_comprobante: e.target.value })}
                  placeholder="Email donde enviar comprobantes de pago"
                />
              </div>
            </div>
          </div>

          {/* Section: Comercial */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Comercial</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Vendedor asignado</label>
                <select
                  value={form.assigned_to || ""}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value || null })}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">Sin asignar</option>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.full_name}</option>)}
                </select>
              </div>
              <Select
                label="Lista de precios"
                value={form.lista_precio}
                onChange={(e) => setForm({ ...form, lista_precio: e.target.value })}
                options={[
                  { value: "A", label: "Lista A" },
                  { value: "B", label: "Lista B" },
                  { value: "C", label: "Lista C" },
                ]}
              />
              <Select
                label="Forma de pago"
                value={form.forma_pago}
                onChange={(e) => setForm({ ...form, forma_pago: e.target.value })}
                options={[
                  { value: "Transferencia", label: "Transferencia" },
                  { value: "Tarjeta", label: "Tarjeta" },
                  { value: "Cheque", label: "Cheque" },
                  { value: "Echeq", label: "Echeq" },
                  { value: "Efectivo", label: "Efectivo" },
                  { value: "Cuenta corriente", label: "Cuenta corriente" },
                ]}
              />
              <Input
                label="Tiempo de pago (días)"
                type="number"
                list="tiempos-pago"
                value={String(form.dias_cuenta_corriente)}
                onChange={(e) => setForm({ ...form, dias_cuenta_corriente: Number(e.target.value) })}
              />
              <datalist id="tiempos-pago"><option value="0" /><option value="15" /><option value="30" /><option value="45" /><option value="60" /></datalist>
              <Input
                label="Límite de crédito"
                type="number"
                value={String(form.limite_credito)}
                onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })}
              />
              <label className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200" title="Ventas muestra sus ventas en «Esperando OC» hasta que el presupuesto tenga la OC. Es solo un aviso: se puede facturar igual.">
                <input type="checkbox" className="mt-0.5" checked={!!form.pide_oc_para_facturar} onChange={(e) => setForm({ ...form, pide_oc_para_facturar: e.target.checked })} />
                <span>Pide OC para facturar<span className="block text-xs text-zinc-400">Ventas avisa «Esperando OC» (no bloquea)</span></span>
              </label>
              <Input
                label="Markup predeterminado (%)"
                type="number"
                value={form.markup_predeterminado != null ? String(form.markup_predeterminado) : ""}
                onChange={(e) => setForm({ ...form, markup_predeterminado: e.target.value ? Number(e.target.value) : null })}
                placeholder="Ej: 30"
              />
              <div className="sm:col-span-2 lg:col-span-3 space-y-1.5">
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Moneda y tipo de dólar predeterminado</label>
                <div className="flex gap-2">
                  {["ARS", "USD", "USD Divisa"].map(m => (
                    <button key={m} type="button" onClick={() => setForm({ ...form, moneda_predeterminada: m })}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${form.moneda_predeterminada === m ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      {m === "ARS" ? "Pesos" : m === "USD" ? "USD billete" : "USD divisa"}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500">Los presupuestos de este cliente toman este tipo de dólar automáticamente y avisan si se cotiza con otro.</p>
              </div>
            </div>
          </div>

          {/* Notas */}
          <div>
            <Textarea
              label="Notas"
              value={form.notas}
              onChange={(e) => setForm({ ...form, notas: e.target.value })}
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {clienteAEliminar && (
        <EliminarConMotivoModal
          tipo="cliente"
          id={clienteAEliminar.id}
          nombre={clienteAEliminar.nombre}
          onCerrar={() => setClienteAEliminar(null)}
          onListo={async (r) => {
            setClienteAEliminar(null);
            setSelectedCliente(null);
            setPanelFullscreen(false);
            if (r.accion === "desactivado") toast.info("Tiene historial: quedó desactivado (no se borró). El motivo quedó guardado.");
            else toast.success("Cliente eliminado. El motivo quedó guardado.");
            await fetchClientes();
          }}
        />
      )}
    </>
  );
}

/* ===================== HELPER COMPONENTS ===================== */

function InfoField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${highlight ? "text-orange-600 dark:text-orange-400 font-semibold" : "text-zinc-900 dark:text-white"}`}>{value}</p>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="mx-auto text-zinc-300 dark:text-zinc-600">{icon}</div>
      <p className="mt-2 text-sm text-zinc-400">{text}</p>
    </div>
  );
}
