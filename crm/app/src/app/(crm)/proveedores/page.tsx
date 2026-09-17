"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { formatCurrency } from "@/lib/utils";
import { mockProveedores, mockListasPrecios } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
import type { Proveedor, ListaPrecios, ListaPreciosItem } from "@/lib/types";
import {
  Search, Filter, Download, MapPin, Phone, Mail, ListOrdered, Upload,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, X, Pencil, Tag,
  Sparkles, FileUp, Check, Trash2, Eye,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";

const CLASIFICACION_TAGS = [
  "Buen precio", "Precio alto", "Entrega rapida", "Entrega lenta",
  "Buena calidad", "Stock permanente", "Importador", "Nacional",
] as const;

const PROVINCIAS_ARGENTINA = [
  "Buenos Aires", "CABA", "Catamarca", "Chaco", "Chubut", "Córdoba",
  "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan",
  "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero",
  "Tierra del Fuego", "Tucumán",
];

const TAG_COLORS: Record<string, string> = {
  "Buen precio": "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400",
  "Entrega rapida": "bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-950 dark:text-green-400",
  "Buena calidad": "bg-teal-50 text-teal-700 ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-400",
  "Stock permanente": "bg-lime-50 text-lime-700 ring-1 ring-lime-200 dark:bg-lime-950 dark:text-lime-400",
  "Precio alto": "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950 dark:text-red-400",
  "Entrega lenta": "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-400",
  "Importador": "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-400",
  "Nacional": "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950 dark:text-sky-400",
};

function ClasificacionTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>{tag}</span>;
}

const estadoListaConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  vigente: { label: "Vigente", variant: "success" },
  vencida: { label: "Vencida", variant: "danger" },
  borrador: { label: "Borrador", variant: "warning" },
};

function mapSupabaseProveedor(row: Record<string, unknown>): Proveedor {
  return {
    id: row.id as string,
    razonSocial: row.razon_social as string,
    cuit: row.cuit as string,
    condicionIva: (row.condicion_iva as Proveedor["condicionIva"]) ?? "RI",
    email: row.email as string,
    telefono: row.telefono as string,
    direccion: row.direccion as string,
    localidad: row.localidad as string,
    provincia: row.provincia as string,
    banco: (row.banco as string) ?? "",
    cbu: (row.cbu as string) ?? "",
    aliasBancario: (row.alias_bancario as string) ?? "",
    numeroCuenta: (row.numero_cuenta as string) ?? "",
    titularCuenta: (row.titular_cuenta as string) ?? "",
    tipoCuenta: (row.tipo_cuenta as string) ?? "",
    contactos: (Array.isArray(row.contactos) ? row.contactos : []).map((c: Record<string, unknown>) => ({
      id: c.id as string, nombre: c.nombre as string, cargo: c.cargo as string,
      email: c.email as string, telefono: c.telefono as string, principal: c.principal as boolean,
    })),
    rubro: (row.rubro as string) ?? "",
    formaPago: (row.forma_pago as string) ?? "",
    diasCuentaCorriente: Number(row.dias_cuenta_corriente) || 0,
    limiteCredito: Number(row.limite_credito) || 0,
    saldoCuentaCorriente: Number(row.saldo_cuenta_corriente) || 0,
    listasDePrecios: (Array.isArray(row.listas_precios) ? row.listas_precios : []).map((lp: Record<string, unknown>) => lp.id as string),
    notas: (row.notas as string) ?? "",
    clasificacionTags: Array.isArray(row.clasificacion_tags) ? (row.clasificacion_tags as string[]) : [],
    marcas: (row.marcas as string) ?? "",
    clasificacionNota: (row.clasificacion_nota as string) ?? "",
    activo: (row.activo as boolean) ?? true,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    conceptoRetencionGanancias: (row.concepto_retencion_ganancias as string) ?? "",
    alicuotaGanancias: row.alicuota_ganancias != null ? Number(row.alicuota_ganancias) : null,
    exclusionRetencion: (row.exclusion_retencion as boolean) ?? false,
    exclusionRetencionDesde: (row.exclusion_retencion_desde as string) ?? null,
    exclusionRetencionHasta: (row.exclusion_retencion_hasta as string) ?? null,
    exclusionRetencionCert: (row.exclusion_retencion_cert as string) ?? null,
  } as Proveedor & { conceptoRetencionGanancias: string; alicuotaGanancias: number | null; exclusionRetencion: boolean; exclusionRetencionDesde: string | null; exclusionRetencionHasta: string | null; exclusionRetencionCert: string | null };
}

function mapSupabaseLista(row: Record<string, unknown>): ListaPrecios {
  const proveedores = row.proveedores as Record<string, unknown> | null;
  const items = Array.isArray(row.lista_precios_items) ? row.lista_precios_items : [];
  return {
    id: row.id as string,
    nombre: row.nombre as string,
    proveedorId: row.proveedor_id as string,
    proveedorNombre: (proveedores?.razon_social as string) ?? "",
    moneda: row.moneda as "USD" | "ARS",
    vigenciaDesde: row.vigencia_desde as string,
    vigenciaHasta: row.vigencia_hasta as string,
    estado: row.estado as ListaPrecios["estado"],
    items: items.map((item: Record<string, unknown>) => ({
      id: item.id as string, codigo: item.codigo as string, descripcion: item.descripcion as string,
      variante: (item.variante as string) || undefined,
      categoria: item.categoria as string, unidad: item.unidad as string, precio: Number(item.precio),
      descuento: Number(item.descuento) || 0, precioNeto: Number(item.precio_neto),
    })),
    archivoOrigen: row.archivo_origen as string,
    notas: (row.notas as string) ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const CONCEPTOS_RG830: Record<string, string> = {
  compraventa_bienes: "Compraventa de bienes",
  servicios: "Servicios y locaciones",
  honorarios: "Honorarios profesionales",
  alquileres_inmuebles: "Alquileres de inmuebles",
  alquileres_muebles: "Alquileres de muebles",
  intereses_financieros: "Intereses (financieras)",
  intereses_otros: "Intereses (otros)",
  transporte: "Transporte de carga",
  fletes: "Fletes",
  comisiones: "Comisiones",
  publicidad: "Publicidad y propaganda",
  seguros: "Seguros",
};

const emptyForm = {
  razon_social: "",
  cuit: "",
  condicion_iva: "RI",
  email: "",
  telefono: "",
  direccion: "",
  localidad: "",
  provincia: "",
  banco: "",
  cbu: "",
  alias_bancario: "",
  numero_cuenta: "",
  titular_cuenta: "",
  tipo_cuenta: "",
  rubro: "",
  forma_pago: "Transferencia",
  dias_cuenta_corriente: 30,
  limite_credito: 0,
  notas: "",
  clasificacion_tags: [] as string[],
  marcas: "",
  clasificacion_nota: "",
  concepto_retencion_ganancias: "" as string,
  alicuota_ganancias: null as number | null,
  exclusion_retencion: false,
  exclusion_retencion_desde: null as string | null,
  exclusion_retencion_hasta: null as string | null,
  exclusion_retencion_cert: null as string | null,
};

export default function ProveedoresPage() {
  const { sociedadActiva } = useUser();
  const [tab, setTab] = useState<"proveedores" | "listas">("proveedores");
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>({
    rubro: "",
    provincia: "",
    saldo: {},
    formaPago: "",
  });
  const [view, setView] = useState<"table" | "cards">("table");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterLista, setFilterLista] = useState<string>("todas");

  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [listas, setListas] = useState<ListaPrecios[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Auto-open create modal from ?crear= query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const crearNombre = params.get("crear");
    if (crearNombre) {
      setEditingId(null);
      setForm({ ...emptyForm, razon_social: crearNombre });
      setFormError("");
      setModalOpen(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Detail
  const [selectedProv, setSelectedProv] = useState<Proveedor | null>(null);
  type ProveedorContactoForm = { id?: string; nombre: string; cargo: string; email: string; telefono: string; whatsapp: string; principal: boolean; notas: string };
  const emptyProveedorContacto: ProveedorContactoForm = { nombre: "", cargo: "", email: "", telefono: "", whatsapp: "", principal: false, notas: "" };
  const [proveedorContactoForm, setProveedorContactoForm] = useState<ProveedorContactoForm>(emptyProveedorContacto);
  const [editingProveedorContacto, setEditingProveedorContacto] = useState(false);
  const [savingProveedorContacto, setSavingProveedorContacto] = useState(false);

  // AI Upload
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    nombre_lista: string;
    proveedor: string;
    moneda: string;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
    notas: string;
    items: Array<{
      codigo: string;
      descripcion: string;
      variante?: string;
      categoria: string;
      unidad: string;
      precio: number;
      descuento: number;
      precio_neto: number;
    }>;
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiProveedorId, setAiProveedorId] = useState("");
  const [aiNewProvOpen, setAiNewProvOpen] = useState(false);
  const [aiNewProvForm, setAiNewProvForm] = useState({ razon_social: "", cuit: "", rubro: "" });
  const [aiNewProvSaving, setAiNewProvSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [cuitLoading, setCuitLoading] = useState(false);

  async function handleCuitLookup() {
    const cuit = form.cuit.replace(/\D/g, "");
    if (cuit.length !== 11) { toast.warning("CUIT debe tener 11 digitos"); return; }
    setCuitLoading(true);
    try {
      const res = await fetch(`/api/cuit-lookup?cuit=${cuit}`);
      if (!res.ok) { toast.error("No se pudo consultar el CUIT"); return; }
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      setForm((prev) => ({
        ...prev,
        razon_social: data.razon_social || prev.razon_social,
        condicion_iva: data.condicion_iva || prev.condicion_iva,
        direccion: data.direccion || prev.direccion,
        localidad: data.localidad || prev.localidad,
        // Conservar la provincia histórica/comercial si ya estaba cargada;
        // la consulta de ARCA puede corresponder a otra sede fiscal.
        provincia: prev.provincia || data.provincia || "",
        concepto_retencion_ganancias: data.retencion_ganancias?.concepto || prev.concepto_retencion_ganancias,
        alicuota_ganancias: data.retencion_ganancias?.alicuota_inscripto ?? prev.alicuota_ganancias,
      }));
      if (!data.condicion_iva) {
        toast.warning("ARCA no pudo determinar la condicion IVA. Verificalo manualmente.");
      } else {
        const retInfo = data.retencion_ganancias ? ` | Ret. Gan.: ${data.retencion_ganancias.alicuota_inscripto}% (${data.retencion_ganancias.concepto_label})` : "";
        toast.success(`Datos cargados desde AFIP — ${data.condicion_iva === "RI" ? "Resp. Inscripto" : data.condicion_iva}${retInfo}`);
      }
    } catch { toast.error("Error al consultar CUIT"); }
    finally { setCuitLoading(false); }
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let provQuery = supabase.from("proveedores").select(`*, listas_precios(id, nombre, moneda, vigencia_hasta, estado)`).order("razon_social");
      let listasQuery = supabase.from("listas_precios").select(`*, proveedores(razon_social), lista_precios_items(*)`).order("created_at", { ascending: false });
      if (sociedadActiva?.id) {
        provQuery = provQuery.eq("sociedad_id" as any, sociedadActiva.id);
        listasQuery = listasQuery.eq("sociedad_id" as any, sociedadActiva.id);
      }
      const [provRes, listasRes] = await Promise.all([provQuery, listasQuery]);

      if (provRes.error) {
        setProveedores(mockProveedores);
      } else {
        setProveedores((provRes.data || []).map((r) => mapSupabaseProveedor(r as Record<string, unknown>)));
      }
      if (listasRes.error) {
        setListas(mockListasPrecios);
      } else {
        setListas((listasRes.data || []).map((r) => mapSupabaseLista(r as Record<string, unknown>)));
      }
    } catch (err) {
      console.error("Error fetching proveedores:", err);
      setProveedores(mockProveedores);
      setListas(mockListasPrecios);
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch contactos when a proveedor is selected (polymorphic table, no FK join)
  useEffect(() => {
    if (!selectedProv) return;
    async function fetchContactos() {
      try {
        const { data } = await supabase
          .from("contactos")
          .select("*")
          .eq("entity_type", "proveedor")
          .eq("entity_id", selectedProv!.id);
        if (data && data.length > 0) {
          const mapped = data.map((c: Record<string, unknown>) => ({
            id: c.id as string, nombre: (c.nombre as string) ?? "",
            cargo: (c.cargo as string) ?? "", email: (c.email as string) ?? "",
            telefono: (c.telefono as string) ?? "", whatsapp: (c.whatsapp as string) ?? "", notas: (c.notas as string) ?? "", principal: (c.principal as boolean) ?? false,
          }));
          setSelectedProv((prev) => prev ? { ...prev, contactos: mapped } : prev);
        }
      } catch (err) {
        console.error("Error fetching contactos:", err);
      }
    }
    fetchContactos();
  }, [selectedProv?.id]);

  function startProveedorContacto(contacto?: any) {
    setProveedorContactoForm(contacto ? { id: contacto.id, nombre: contacto.nombre ?? "", cargo: contacto.cargo ?? "", email: contacto.email ?? "", telefono: contacto.telefono ?? "", whatsapp: contacto.whatsapp ?? "", principal: !!contacto.principal, notas: contacto.notas ?? "" } : emptyProveedorContacto);
    setEditingProveedorContacto(true);
  }

  async function saveProveedorContacto() {
    if (!selectedProv || !proveedorContactoForm.nombre.trim()) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de guardar el contacto");
      return;
    }
    setSavingProveedorContacto(true);
    try {
      const payload = { nombre: proveedorContactoForm.nombre.trim(), cargo: proveedorContactoForm.cargo.trim() || null, email: proveedorContactoForm.email.trim() || null, telefono: proveedorContactoForm.telefono.trim() || null, whatsapp: proveedorContactoForm.whatsapp.trim() || null, notas: proveedorContactoForm.notas.trim() || null, principal: proveedorContactoForm.principal };
      const q = (supabase as any).from("contactos");
      const result = proveedorContactoForm.id
        ? await q.update(payload).eq("id", proveedorContactoForm.id).eq("entity_id", selectedProv.id)
        : await q.insert({ ...payload, entity_type: "proveedor", entity_id: selectedProv.id });
      if (result.error) throw result.error;
      const { data } = await q.select("*").eq("entity_type", "proveedor").eq("entity_id", selectedProv.id).order("principal", { ascending: false });
      setSelectedProv((prev) => prev ? { ...prev, contactos: (data ?? []) as any } : prev);
      setProveedorContactoForm(emptyProveedorContacto); setEditingProveedorContacto(false); toast.success("Contacto guardado");
    } catch { toast.error("No se pudo guardar el contacto"); } finally { setSavingProveedorContacto(false); }
  }

  async function deleteProveedorContacto(id: string) {
    if (!selectedProv) return;
    if (!sociedadActiva?.id) {
      toast.error("Seleccioná una sociedad antes de eliminar el contacto");
      return;
    }
    if (!confirm("¿Eliminar este contacto?")) return;
    const { error } = await (supabase as any).from("contactos").delete().eq("id", id).eq("entity_id", selectedProv.id);
    if (error) { toast.error("No se pudo eliminar el contacto"); return; }
    setSelectedProv((prev) => prev ? { ...prev, contactos: prev.contactos.filter((c) => c.id !== id) } : prev);
    toast.success("Contacto eliminado");
  }

  // Build filter configs dynamically from current data
  const filterConfigs: FilterConfig[] = [
    {
      key: "rubro",
      label: "Rubro",
      type: "select",
      options: Array.from(new Set(proveedores.map((p) => p.rubro).filter(Boolean)))
        .sort()
        .map((r) => ({ value: r, label: r })),
    },
    {
      key: "provincia",
      label: "Provincia",
      type: "select",
      options: Array.from(new Set(proveedores.map((p) => p.provincia).filter(Boolean)))
        .sort()
        .map((p) => ({ value: p, label: p })),
    },
    {
      key: "saldo",
      label: "Saldo CC",
      type: "number-range",
    },
    {
      key: "formaPago",
      label: "Forma de pago",
      type: "select",
      options: [
        { value: "Contado", label: "Contado" },
        { value: "Cuenta corriente", label: "Cuenta corriente" },
        { value: "Cheque", label: "Cheque" },
        { value: "Transferencia", label: "Transferencia" },
        { value: "Tarjeta", label: "Tarjeta" },
      ],
    },
  ];

  const filteredProveedores = proveedores.filter((p) => {
    // Text search
    if (search) {
      const q = search.toLowerCase();
      if (!p.razonSocial.toLowerCase().includes(q) && !p.cuit.includes(search) && !p.rubro.toLowerCase().includes(q)) return false;
    }
    // Smart filters
    if (filterValues.rubro && (filterValues.rubro as string) !== "" && p.rubro !== filterValues.rubro) return false;
    if (filterValues.provincia && (filterValues.provincia as string) !== "" && p.provincia !== filterValues.provincia) return false;
    if (filterValues.formaPago && (filterValues.formaPago as string) !== "" && p.formaPago !== filterValues.formaPago) return false;
    const saldoRange = filterValues.saldo as { min?: number; max?: number } | undefined;
    if (saldoRange) {
      if (saldoRange.min !== undefined && p.saldoCuentaCorriente < saldoRange.min) return false;
      if (saldoRange.max !== undefined && p.saldoCuentaCorriente > saldoRange.max) return false;
    }
    return true;
  });

  const filteredListas = listas.filter((lp) => {
    if (filterLista !== "todas" && lp.estado !== filterLista) return false;
    if (search && !lp.nombre.toLowerCase().includes(search.toLowerCase()) && !lp.proveedorNombre.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalDeuda = proveedores.reduce((a, p) => a + p.saldoCuentaCorriente, 0);
  const totalCredito = proveedores.reduce((a, p) => a + p.limiteCredito, 0);
  const listasVigentes = listas.filter((l) => l.estado === "vigente").length;
  const listasVencidas = listas.filter((l) => l.estado === "vencida").length;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(p: Proveedor) {
    setEditingId(p.id);
    setForm({
      razon_social: p.razonSocial, cuit: p.cuit, condicion_iva: p.condicionIva,
      email: p.email, telefono: p.telefono, direccion: p.direccion,
      localidad: p.localidad, provincia: p.provincia, rubro: p.rubro,
      banco: (p as any).banco ?? "", cbu: p.cbu ?? "", alias_bancario: p.aliasBancario ?? "", numero_cuenta: p.numeroCuenta ?? "",
      titular_cuenta: (p as any).titularCuenta ?? "", tipo_cuenta: (p as any).tipoCuenta ?? "",
      forma_pago: p.formaPago, dias_cuenta_corriente: p.diasCuentaCorriente,
      limite_credito: p.limiteCredito, notas: p.notas,
      clasificacion_tags: p.clasificacionTags ?? [], marcas: p.marcas ?? "",
      clasificacion_nota: p.clasificacionNota ?? "",
      concepto_retencion_ganancias: (p as any).conceptoRetencionGanancias ?? "",
      alicuota_ganancias: (p as any).alicuotaGanancias ?? null,
      exclusion_retencion: (p as any).exclusionRetencion ?? false,
      exclusion_retencion_desde: (p as any).exclusionRetencionDesde ?? null,
      exclusion_retencion_hasta: (p as any).exclusionRetencionHasta ?? null,
      exclusion_retencion_cert: (p as any).exclusionRetencionCert ?? null,
    });
    setFormError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.razon_social.trim() || !form.cuit.trim()) {
      setFormError("Razon social y CUIT son obligatorios");
      return;
    }
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      setFormError("Seleccioná una sociedad antes de guardar el proveedor");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        let updateQuery = supabase.from("proveedores").update(form as any).eq("id", editingId);
        updateQuery = updateQuery.eq("sociedad_id" as any, sociedadId);
        const { error } = await updateQuery;
        if (error) throw error;
      } else {
        const insertData = { ...form } as any;
        insertData.sociedad_id = sociedadId;
        const { error } = await supabase.from("proveedores").insert(insertData);
        if (error) throw error;
      }
      setModalOpen(false);
      setSelectedProv(null);
      await fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: string }).message)
          : "Error al guardar";
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  function openAiUpload() {
    setAiFile(null);
    setAiResult(null);
    setAiError("");
    setAiProveedorId("");
    setAiModalOpen(true);
  }

  async function handleAiParse() {
    if (!aiFile) return;
    setAiParsing(true);
    setAiError("");
    setAiResult(null);

    try {
      const formData = new FormData();
      formData.append("file", aiFile);

      const res = await fetch("/api/parse-lista-precios", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error || "Error al procesar el archivo");
        return;
      }

      setAiResult(data.data);

      // Auto-select proveedor if name matches
      if (data.data.proveedor) {
        const match = proveedores.find(
          (p) => p.razonSocial.toLowerCase().includes(data.data.proveedor.toLowerCase())
        );
        if (match) setAiProveedorId(match.id);
      }
    } catch {
      setAiError("Error de conexion. Intenta de nuevo.");
    } finally {
      setAiParsing(false);
    }
  }

  async function handleAiCreateNewProv() {
    if (!aiNewProvForm.razon_social.trim()) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      alert("Seleccioná una sociedad antes de crear el proveedor");
      return;
    }
    setAiNewProvSaving(true);
    try {
      const insertData: Record<string, unknown> = {
        razon_social: aiNewProvForm.razon_social.trim(),
        rubro: aiNewProvForm.rubro.trim() || "General",
        activo: true,
      };
      if (aiNewProvForm.cuit.trim()) insertData.cuit = aiNewProvForm.cuit.trim();
      insertData.sociedad_id = sociedadId;
      const { data, error } = await supabase.from("proveedores").insert(insertData as any).select("id").single();
      if (error) throw error;
      await fetchData();
      setAiProveedorId(data.id);
      setAiNewProvOpen(false);
      setAiNewProvForm({ razon_social: "", cuit: "", rubro: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: string }).message) : String(err);
      alert("Error creando proveedor: " + msg);
    } finally {
      setAiNewProvSaving(false);
    }
  }

  async function handleAiSave() {
    if (!aiResult || !aiProveedorId) return;
    const sociedadId = sociedadActiva?.id;
    if (!sociedadId) {
      toast.error("Seleccioná una sociedad antes de guardar la lista");
      return;
    }
    setAiSaving(true);

    try {
      // Create the lista
      const listaInsert: Record<string, unknown> = {
          nombre: aiResult.nombre_lista || `Lista ${new Date().toLocaleDateString("es-AR")}`,
          proveedor_id: aiProveedorId,
          moneda: aiResult.moneda === "USD" ? "USD" : "ARS",
          vigencia_desde: aiResult.vigencia_desde || new Date().toISOString().slice(0, 10),
          vigencia_hasta: aiResult.vigencia_hasta || new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().slice(0, 10),
          estado: "vigente",
          archivo_origen: aiFile?.name || null,
          notas: aiResult.notas || "",
      };
      listaInsert.sociedad_id = sociedadId;
      const { data: lista, error: listaError } = await supabase
        .from("listas_precios")
        .insert(listaInsert as any)
        .select("id")
        .single();

      if (listaError) throw listaError;

      // Insert items
      if (lista && aiResult.items.length > 0) {
        const items = aiResult.items.map((item) => ({
          lista_id: lista.id,
          codigo: item.codigo,
          descripcion: item.descripcion,
          variante: item.variante || null,
          categoria: item.categoria,
          unidad: item.unidad,
          precio: item.precio,
          descuento: item.descuento || 0,
          precio_neto: item.precio_neto,
          sociedad_id: sociedadId,
        }));

        const { error: itemsError } = await (supabase as any)
          .from("lista_precios_items")
          .insert(items);

        if (itemsError) throw itemsError;
      }

      toast.success(`Lista creada con ${aiResult.items.length} articulos`);
      setAiModalOpen(false);
      await fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: string }).message) : "Error al guardar";
      toast.error(msg);
    } finally {
      setAiSaving(false);
    }
  }

  function removeAiItem(index: number) {
    if (!aiResult) return;
    setAiResult({
      ...aiResult,
      items: aiResult.items.filter((_, i) => i !== index),
    });
  }

  function exportCSV() {
    const headers = ["Razon Social", "CUIT", "Rubro", "Email", "Telefono", "Localidad", "Provincia", "Forma Pago", "Saldo CC", "Limite Credito"];
    const rows = filteredProveedores.map((p) => [
      p.razonSocial, p.cuit, p.rubro, p.email, p.telefono, p.localidad, p.provincia, p.formaPago, p.saldoCuentaCorriente, p.limiteCredito,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proveedores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <>
        <Header title="Proveedores" subtitle="Cargando datos..." action={{ label: "Nuevo proveedor", onClick: () => {} }} />
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Proveedores"
        subtitle={`${proveedores.length} proveedores — ${listas.length} listas de precios`}
        action={{ label: tab === "proveedores" ? "Nuevo proveedor" : "Cargar lista con IA", onClick: tab === "proveedores" ? openCreate : openAiUpload }}
      />
      <div className="p-4 sm:p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Proveedores</p><p className="mt-1 text-2xl font-bold">{proveedores.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Deuda CC</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalDeuda, "ARS")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Credito total</p><p className="mt-1 text-2xl font-bold">{formatCurrency(totalCredito, "ARS")}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vigentes</p><p className="mt-1 text-2xl font-bold text-emerald-600">{listasVigentes}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vencidas</p><p className="mt-1 text-2xl font-bold text-red-600">{listasVencidas}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          {(["proveedores", "listas"] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setSearch(""); }}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700"}`}>
              {t === "proveedores" ? "Proveedores" : "Listas de precios"}
            </button>
          ))}
        </div>

        {/* -- TAB: Proveedores -- */}
        {tab === "proveedores" && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar por razon social, CUIT o rubro..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <button onClick={exportCSV} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /> Exportar</button>
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <button onClick={() => setView("table")} className={`px-3 py-2 text-xs font-medium ${view === "table" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tabla</button>
                <button onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-medium ${view === "cards" ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-white" : "bg-white text-zinc-400 dark:bg-zinc-900"}`}>Tarjetas</button>
              </div>
            </div>

            <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

            {view === "table" ? (
              <Card className="p-0 overflow-hidden">
                <DataTable<Proveedor>
                  columns={[
                    { key: "razonSocial", label: "Proveedor", sortable: true, render: (row) => (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-xs">{row.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                        <div><p className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</p><p className="text-xs text-zinc-400">{row.cuit}</p></div>
                      </div>
                    )},
                    { key: "rubro", label: "Rubro", sortable: true, render: (row) => <Badge variant="info">{row.rubro}</Badge> },
                    { key: "clasificacionTags" as keyof Proveedor, label: "Clasificacion", sortable: false, render: (row) => (
                      <div className="flex flex-wrap gap-1">
                        {row.clasificacionTags?.map((t) => <ClasificacionTag key={t} tag={t} />)}
                        {row.marcas && <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{row.marcas}</span>}
                      </div>
                    )},
                    { key: "localidad", label: "Ubicacion", sortable: true, render: (row) => <span className="text-zinc-500">{row.localidad}, {row.provincia}</span> },
                    { key: "formaPago", label: "Forma pago", sortable: true, render: (row) => <Badge variant="outline">{row.formaPago}</Badge> },
                    { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right text-red-600">{formatCurrency(row.saldoCuentaCorriente, "ARS")}</span> },
                    { key: "limiteCredito", label: "Limite", className: "text-right", sortable: true, render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limiteCredito, "ARS")}</span> },
                    { key: "actions", label: "", sortable: false, render: (row) => (
                      <button onClick={(e) => { e.stopPropagation(); openEdit(row); }} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )},
                  ]}
                  data={filteredProveedores}
                  onRowClick={(row) => setSelectedProv(row)}
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProveedores.map((prov) => {
                  const provListas = listas.filter((l) => l.proveedorId === prov.id);
                  return (
                    <Card key={prov.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedProv(prov)}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-sm">{prov.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                          <div><p className="font-semibold text-zinc-900 dark:text-white">{prov.razonSocial}</p><p className="text-xs text-zinc-400">{prov.cuit}</p></div>
                        </div>
                        <Badge variant="info">{prov.rubro.split(" ")[0]}</Badge>
                      </div>
                      <div className="mt-4 space-y-2 text-sm text-zinc-500">
                        <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {prov.localidad}, {prov.provincia}</div>
                        <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {prov.telefono || "—"}</div>
                        <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {prov.email ? <a href={`mailto:${prov.email}`} className="hover:text-orange-500">{prov.email}</a> : "—"}</div>
                        <div className="flex items-center gap-2"><ListOrdered className="h-3.5 w-3.5" /> {provListas.length} lista(s) — {provListas.filter(l => l.estado === "vigente").length} vigente(s)</div>
                      </div>
                      {(prov.clasificacionTags?.length > 0 || prov.marcas) && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {prov.clasificacionTags?.map((t) => <ClasificacionTag key={t} tag={t} />)}
                          {prov.marcas && <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{prov.marcas}</span>}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <div><p className="text-xs text-zinc-400">Saldo CC</p><p className="font-mono font-semibold text-red-600">{formatCurrency(prov.saldoCuentaCorriente, "ARS")}</p></div>
                        <div className="text-right"><p className="text-xs text-zinc-400">Forma pago</p><Badge variant="outline">{prov.formaPago}</Badge></div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* -- TAB: Listas de precios -- */}
        {tab === "listas" && (
          <>
            {listasVencidas > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <div><p className="font-medium text-amber-800">{listasVencidas} lista(s) vencida(s)</p><p className="text-sm text-amber-600">Solicita la actualizacion a los proveedores correspondientes.</p></div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(["todas", "vigente", "vencida", "borrador"] as const).map((estado) => {
                  const count = estado === "todas" ? listas.length : listas.filter(l => l.estado === estado).length;
                  return (
                    <button key={estado} onClick={() => setFilterLista(estado)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${filterLista === estado ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>
                      {estado === "todas" ? "Todas" : estadoListaConfig[estado].label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar lista o proveedor..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm text-zinc-900 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
              </div>
            </div>
            <div className="space-y-4">
              {filteredListas.map((lista) => {
                const isExpanded = expandedId === lista.id;
                const cfg = estadoListaConfig[lista.estado] || { label: lista.estado, variant: "outline" as const };
                return (
                  <Card key={lista.id} className="p-0 overflow-hidden">
                    <button onClick={() => setExpandedId(isExpanded ? null : lista.id)}
                      className="flex w-full items-center justify-between p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ListOrdered className="h-5 w-5" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-zinc-900 dark:text-white">{lista.nombre}</h3>
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <Badge variant="outline">{lista.moneda}</Badge>
                          </div>
                          <p className="text-sm text-zinc-500">{lista.proveedorNombre} — {lista.items.length} articulos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-zinc-400">Vigencia</p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">{lista.vigenciaDesde} — {lista.vigenciaHasta}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-200 dark:border-zinc-700">
                        {lista.notas && <div className="bg-zinc-50 dark:bg-zinc-800 px-5 py-2.5 text-sm text-zinc-500">{lista.notas}</div>}
                        <DataTable<ListaPreciosItem>
                          columns={[
                            { key: "codigo", label: "Codigo", render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
                            { key: "descripcion", label: "Articulo", render: (row) => <span className="font-medium">{row.descripcion}</span> },
                            { key: "variante", label: "Variante", render: (row) => <span className="text-zinc-500 text-xs">{row.variante || "—"}</span> },
                            { key: "categoria", label: "Categoria", render: (row) => <Badge variant="outline">{row.categoria}</Badge> },
                            { key: "unidad", label: "Un.", render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
                            { key: "precio", label: "P. Lista", className: "text-right", render: (row) => <span className="font-mono block text-right text-zinc-400 line-through">{lista.moneda === "USD" ? `USD ${row.precio.toFixed(2)}` : formatCurrency(row.precio)}</span> },
                            { key: "descuento", label: "Desc.", className: "text-right", render: (row) => row.descuento ? <span className="text-emerald-600 font-medium">{row.descuento}%</span> : <span className="text-zinc-300">—</span> },
                            { key: "precioNeto", label: "P. Neto", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{lista.moneda === "USD" ? `USD ${row.precioNeto.toFixed(2)}` : formatCurrency(row.precioNeto)}</span> },
                          ]}
                          data={lista.items}
                        />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Detail panel */}
      {selectedProv && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedProv(null)} />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{selectedProv.razonSocial}</h2>
                <p className="text-sm text-zinc-500">{selectedProv.cuit}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { openEdit(selectedProv); setSelectedProv(null); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => setSelectedProv(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-zinc-500">Rubro</p><p className="text-sm font-medium">{selectedProv.rubro || "—"}</p></div>
                <div><p className="text-xs text-zinc-500">Condicion IVA</p><p className="text-sm font-medium">{selectedProv.condicionIva}</p></div>
                <div><p className="text-xs text-zinc-500">Email</p><p className="text-sm font-medium">{selectedProv.email ? <a href={`mailto:${selectedProv.email}`} className="hover:text-orange-500">{selectedProv.email}</a> : "—"}</p></div>
                <div><p className="text-xs text-zinc-500">Telefono</p><p className="text-sm font-medium">{selectedProv.telefono ? <a href={`tel:${selectedProv.telefono}`} className="hover:text-orange-500">{selectedProv.telefono}</a> : "—"}</p></div>
                <div className="col-span-2"><p className="text-xs text-zinc-500">Direccion</p><p className="text-sm font-medium">{selectedProv.direccion || "—"}, {selectedProv.localidad}, {selectedProv.provincia}</p></div>
              </div>
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3">Comercial</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-zinc-500">Forma de pago</p><p className="text-sm font-medium">{selectedProv.formaPago}</p></div>
                  <div><p className="text-xs text-zinc-500">Dias CC</p><p className="text-sm font-medium">{selectedProv.diasCuentaCorriente}</p></div>
                  <div><p className="text-xs text-zinc-500">Limite credito</p><p className="text-sm font-medium">{formatCurrency(selectedProv.limiteCredito, "ARS")}</p></div>
                  <div><p className="text-xs text-zinc-500">Saldo CC</p><p className="text-sm font-medium text-red-600">{formatCurrency(selectedProv.saldoCuentaCorriente, "ARS")}</p></div>
                  {((selectedProv as any).conceptoRetencionGanancias || (selectedProv as any).alicuotaGanancias != null) && (
                    <>
                      <div><p className="text-xs text-zinc-500">Ret. Ganancias</p><p className="text-sm font-medium">{CONCEPTOS_RG830[(selectedProv as any).conceptoRetencionGanancias] || "—"}</p></div>
                      <div><p className="text-xs text-zinc-500">Alícuota</p><p className="text-sm font-medium text-violet-600">{(selectedProv as any).alicuotaGanancias != null ? `${(selectedProv as any).alicuotaGanancias}%` : "—"}</p></div>
                    </>
                  )}
                </div>
              </div>
              {(selectedProv.cbu || selectedProv.aliasBancario || selectedProv.numeroCuenta || (selectedProv as any).titularCuenta || (selectedProv as any).tipoCuenta || (selectedProv as any).banco) && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-3">Datos bancarios</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div><p className="text-xs text-zinc-500">Banco</p><p className="text-sm font-medium">{(selectedProv as any).banco || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Titular</p><p className="text-sm font-medium">{(selectedProv as any).titularCuenta || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Tipo de cuenta</p><p className="text-sm font-medium">{(selectedProv as any).tipoCuenta || "—"}</p></div>
                    <div className="col-span-2"><p className="text-xs text-zinc-500">CBU / CVU</p><p className="text-sm font-mono font-medium">{selectedProv.cbu || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">Alias</p><p className="text-sm font-medium">{selectedProv.aliasBancario || "—"}</p></div>
                    <div><p className="text-xs text-zinc-500">N° de cuenta</p><p className="text-sm font-medium">{selectedProv.numeroCuenta || "—"}</p></div>
                  </div>
                </div>
              )}
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold">Contactos comerciales</h3><button type="button" onClick={() => startProveedorContacto()} className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-600">Agregar contacto</button></div>
                {editingProveedorContacto && <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50/50 p-3 space-y-2 dark:border-orange-900/40 dark:bg-orange-900/10">
                  <div className="grid grid-cols-2 gap-2"><input placeholder="Nombre y apellido *" value={proveedorContactoForm.nombre} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, nombre: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /><input placeholder="Cargo" value={proveedorContactoForm.cargo} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, cargo: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                  <div className="grid grid-cols-2 gap-2"><input type="email" placeholder="Email" value={proveedorContactoForm.email} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, email: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /><input placeholder="WhatsApp / teléfono" value={proveedorContactoForm.whatsapp} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, whatsapp: e.target.value }))} className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
                  <textarea placeholder="Notas" rows={2} value={proveedorContactoForm.notas} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, notas: e.target.value }))} className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={proveedorContactoForm.principal} onChange={(e) => setProveedorContactoForm((p) => ({ ...p, principal: e.target.checked }))} /> Contacto principal</label>
                  <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingProveedorContacto(false)} className="rounded border px-2 py-1 text-xs">Cancelar</button><button type="button" disabled={savingProveedorContacto || !proveedorContactoForm.nombre.trim()} onClick={saveProveedorContacto} className="rounded bg-orange-500 px-2 py-1 text-xs text-white disabled:opacity-50">Guardar</button></div>
                </div>}
                {selectedProv.contactos?.length ? <div className="space-y-2">{selectedProv.contactos.map((c: any) => <div key={c.id} className="flex items-start justify-between rounded-lg bg-zinc-50 p-2.5 dark:bg-zinc-800"><div><p className="text-sm font-medium">{c.nombre} {c.principal && <span className="text-[10px] text-orange-600">Principal</span>}</p><p className="text-xs text-zinc-500">{[c.cargo, c.email, c.whatsapp || c.telefono].filter(Boolean).join(" · ") || "Sin datos"}</p></div><div className="flex gap-1"><button type="button" onClick={() => startProveedorContacto(c)} className="rounded p-1 text-zinc-400 hover:text-orange-500"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => deleteProveedorContacto(c.id)} className="rounded p-1 text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div> : <p className="text-sm italic text-zinc-400">Sin contactos registrados</p>}
              </div>
              {(selectedProv.clasificacionTags?.length > 0 || selectedProv.marcas || selectedProv.clasificacionNota) && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Tag className="h-4 w-4" /> Clasificacion</h3>
                  {selectedProv.clasificacionTags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {selectedProv.clasificacionTags.map((t) => <ClasificacionTag key={t} tag={t} />)}
                    </div>
                  )}
                  {selectedProv.marcas && (
                    <div className="mb-3">
                      <p className="text-xs text-zinc-500 mb-1">Marcas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedProv.marcas.split(",").map((m) => m.trim()).filter(Boolean).map((m) => (
                          <span key={m} className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium bg-violet-50 text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950 dark:text-violet-400">{m}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedProv.clasificacionNota && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1">Comentario</p>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selectedProv.clasificacionNota}</p>
                    </div>
                  )}
                </div>
              )}
              {selectedProv.notas && (
                <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold mb-2">Notas</h3>
                  <p className="text-sm text-zinc-600 whitespace-pre-wrap">{selectedProv.notas}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="fixed inset-4 z-50 m-auto h-fit max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">{editingId ? "Editar proveedor" : "Nuevo proveedor"}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100"><X className="h-4 w-4" /></button>
            </div>
            {formError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Razon social *</label>
                <input value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500">CUIT *</label>
                <div className="mt-1 flex gap-1">
                  <input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value })} onBlur={() => { if (form.cuit.replace(/\D/g, "").length === 11 && !form.razon_social) handleCuitLookup(); }} className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" placeholder="XX-XXXXXXXX-X" />
                  <button type="button" onClick={handleCuitLookup} disabled={cuitLoading} className="rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50 transition-colors whitespace-nowrap" title="Buscar en AFIP">
                    {cuitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Condición IVA</label>
                <select value={form.condicion_iva} onChange={(e) => setForm({ ...form, condicion_iva: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="RI">Responsable Inscripto</option>
                  <option value="Monotributista">Monotributista</option>
                  <option value="Exento">Exento</option>
                  <option value="No Responsable">No Responsable</option>
                  <option value="Consumidor Final">Consumidor Final</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Rubro</label><input value={form.rubro} onChange={(e) => setForm({ ...form, rubro: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Telefono</label><input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Direccion</label><input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Localidad</label><input value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Provincia</label>
                <select value={form.provincia} onChange={(e) => setForm({ ...form, provincia: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="">Seleccionar...</option>
                  {PROVINCIAS_ARGENTINA.map((provincia) => <option key={provincia} value={provincia}>{provincia}</option>)}
                </select>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Forma de pago</label>
                <select value={form.forma_pago} onChange={(e) => setForm({ ...form, forma_pago: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                  <option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cheque">Cheque</option><option value="Echeq">Echeq</option><option value="Efectivo">Efectivo</option><option value="Cuenta corriente">Cuenta corriente</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Tiempo de pago (días)</label><input type="number" list="tiempos-pago-proveedor" value={form.dias_cuenta_corriente} onChange={(e) => setForm({ ...form, dias_cuenta_corriente: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /><datalist id="tiempos-pago-proveedor"><option value="0" /><option value="15" /><option value="30" /><option value="45" /><option value="60" /></datalist></div>
              <div><label className="text-xs font-medium text-zinc-500">Limite credito</label><input type="number" value={form.limite_credito} onChange={(e) => setForm({ ...form, limite_credito: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div className="col-span-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold">Datos bancarios <span className="font-normal text-zinc-400">(opcionales)</span></h3>
              </div>
              <div><label className="text-xs font-medium text-zinc-500">Banco</label><select value={(form as any).banco} onChange={(e) => setForm({ ...form, banco: e.target.value } as any)} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"><option value="">Seleccionar...</option>{["Banco Nación","Banco Provincia","Banco Ciudad","Banco Galicia","Banco Santander","Banco BBVA","Banco Macro","Banco HSBC","Banco ICBC","Banco Patagonia","Banco Credicoop","Banco Comafi","Banco Itaú","Banco Supervielle","Banco Columbia","Brubank","Mercado Pago","Ualá","Naranja X","Otro"].map(b => <option key={b} value={b}>{b}</option>)}</select></div>
              <div><label className="text-xs font-medium text-zinc-500">CBU / CVU</label><input value={form.cbu} onChange={(e) => setForm({ ...form, cbu: e.target.value.replace(/\s/g, "") })} placeholder="22 dígitos" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Alias</label><input value={form.alias_bancario} onChange={(e) => setForm({ ...form, alias_bancario: e.target.value })} placeholder="alias.del.proveedor" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Titular</label><input value={(form as any).titular_cuenta} onChange={(e) => setForm({ ...form, titular_cuenta: e.target.value } as any)} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div><label className="text-xs font-medium text-zinc-500">Tipo de cuenta</label><select value={(form as any).tipo_cuenta} onChange={(e) => setForm({ ...form, tipo_cuenta: e.target.value } as any)} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"><option value="">Seleccionar...</option><option value="CC">Cuenta corriente (CC)</option><option value="CA">Caja de ahorro (CA)</option><option value="CVU">CVU</option></select></div>
              <div><label className="text-xs font-medium text-zinc-500">N° de cuenta</label><input value={form.numero_cuenta} onChange={(e) => setForm({ ...form, numero_cuenta: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              <div className="col-span-2"><label className="text-xs font-medium text-zinc-500">Notas</label><textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" /></div>
              {/* Retención Ganancias RG 830 */}
              <div className="col-span-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">Retención Ganancias (RG 830)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Concepto de retención</label>
                    <select value={form.concepto_retencion_ganancias} onChange={(e) => {
                      const concepto = e.target.value;
                      const alicuotas: Record<string, number> = { compraventa_bienes: 2, servicios: 2, honorarios: 2, alquileres_inmuebles: 6, alquileres_muebles: 2, intereses_financieros: 3, intereses_otros: 6, transporte: 0.25, fletes: 0.25, comisiones: 2, publicidad: 2, seguros: 2 };
                      setForm({ ...form, concepto_retencion_ganancias: concepto, alicuota_ganancias: concepto ? (alicuotas[concepto] ?? 2) : null });
                    }} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                      <option value="">Sin definir (usa tasa global)</option>
                      {Object.entries(CONCEPTOS_RG830).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-500">Alícuota inscripto (%)</label>
                    <input type="number" step="0.25" value={form.alicuota_ganancias ?? ""} onChange={(e) => setForm({ ...form, alicuota_ganancias: e.target.value ? Number(e.target.value) : null })}
                      placeholder="Ej: 2" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                    <p className="text-[10px] text-zinc-400 mt-0.5">Se auto-completa al consultar CUIT en ARCA</p>
                  </div>
                </div>
              </div>
              {/* Exclusión de retención */}
              <div className="col-span-2 flex items-start gap-4 mt-2">
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => setForm({ ...form, exclusion_retencion: !form.exclusion_retencion })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full ${form.exclusion_retencion ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${form.exclusion_retencion ? "translate-x-4.5" : "translate-x-0.5"}`} />
                  </button>
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Excluido de retención</span>
                </div>
                {form.exclusion_retencion && (
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] font-medium text-zinc-500">Desde</label>
                      <input type="date" value={form.exclusion_retencion_desde || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_desde: e.target.value || null })}
                        className="mt-0.5 w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-zinc-500">Hasta</label>
                      <input type="date" value={form.exclusion_retencion_hasta || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_hasta: e.target.value || null })}
                        className="mt-0.5 w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-zinc-500">Nro. certificado</label>
                      <input value={form.exclusion_retencion_cert || ""} onChange={(e) => setForm({ ...form, exclusion_retencion_cert: e.target.value || null })}
                        placeholder="Nro. cert." className="mt-0.5 w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                  </div>
                )}
              </div>
              {/* Clasificacion */}
              <div className="col-span-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Tag className="h-4 w-4" /> Clasificacion del proveedor</h3>
                <div className="flex flex-wrap gap-2">
                  {CLASIFICACION_TAGS.map((tag) => {
                    const selected = form.clasificacion_tags.includes(tag);
                    const color = selected ? TAG_COLORS[tag] : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500";
                    return (
                      <button key={tag} type="button" onClick={() => {
                        setForm({ ...form, clasificacion_tags: selected ? form.clasificacion_tags.filter((t) => t !== tag) : [...form.clasificacion_tags, tag] });
                      }} className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer border ${selected ? "border-transparent ring-1" : "border-zinc-200 dark:border-zinc-700"} ${color}`}>
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Marcas <span className="text-zinc-400 font-normal">(separadas por coma)</span></label>
                <input value={form.marcas} onChange={(e) => setForm({ ...form, marcas: e.target.value })} placeholder="Ej: Spirax Sarco, Valvitalia, FMC" className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-zinc-500">Comentario de clasificacion</label>
                <textarea value={form.clasificacion_nota} onChange={(e) => setForm({ ...form, clasificacion_nota: e.target.value })} rows={2} placeholder="Notas sobre precio, entrega, calidad..." className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200">
              <button onClick={() => setModalOpen(false)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* AI Upload Modal */}
      <Modal
        open={aiModalOpen}
        onClose={() => { if (!aiParsing) setAiModalOpen(false); }}
        title="Cargar lista de precios con IA"
        description="Subi un PDF o imagen de una lista de precios y la IA extrae los articulos automaticamente."
        size="xl"
        footer={
          aiResult ? (
            <>
              <button
                onClick={() => { setAiResult(null); setAiFile(null); }}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Volver a subir
              </button>
              <button
                onClick={handleAiSave}
                disabled={aiSaving || !aiProveedorId || aiResult.items.length === 0}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {aiSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Guardar lista ({aiResult.items.length} articulos)
              </button>
            </>
          ) : undefined
        }
      >
        {!aiResult ? (
          <div className="space-y-6">
            {/* File upload zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50 p-10 cursor-pointer hover:border-orange-400 hover:bg-orange-50/30 transition-colors dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-orange-500"
            >
              <div className="rounded-full bg-orange-100 p-3 dark:bg-orange-900/30">
                <FileUp className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {aiFile ? aiFile.name : "Click para seleccionar archivo"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  PDF, PNG, JPG o WEBP — maximo 20MB
                </p>
              </div>
              {aiFile && (
                <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 shadow-sm dark:bg-zinc-700">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{(aiFile.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setAiFile(file);
              }}
            />

            {aiError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
                {aiError}
              </div>
            )}

            <button
              onClick={handleAiParse}
              disabled={!aiFile || aiParsing}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {aiParsing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analizando con IA... puede tardar unos segundos
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Extraer articulos con IA
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* AI Result summary */}
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4 dark:bg-emerald-950/30 dark:border-emerald-800">
              <Sparkles className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  {aiResult.items.length} articulos extraidos
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {aiResult.nombre_lista} — {aiResult.moneda}
                  {aiResult.proveedor && ` — ${aiResult.proveedor}`}
                </p>
              </div>
            </div>

            {/* Proveedor selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Asignar a proveedor *
              </label>
              <select
                value={aiProveedorId}
                onChange={(e) => {
                  if (e.target.value === "__nuevo__") { setAiNewProvOpen(true); setAiNewProvForm({ razon_social: aiResult?.proveedor || "", cuit: "", rubro: "" }); }
                  else setAiProveedorId(e.target.value);
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
              >
                <option value="">Seleccionar proveedor...</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.razonSocial}</option>
                ))}
                <option value="__nuevo__">＋ Crear nuevo proveedor...</option>
              </select>
              {aiProveedorId && aiProveedorId !== "__nuevo__" && (
                <p className="text-xs text-emerald-600 mt-1">✓ {proveedores.find(p => p.id === aiProveedorId)?.razonSocial}</p>
              )}
              {/* Mini form para crear proveedor nuevo */}
              {aiNewProvOpen && (
                <div className="mt-3 rounded-xl border border-dashed border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800 p-4 space-y-3">
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">Nuevo proveedor</p>
                  <input value={aiNewProvForm.razon_social} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, razon_social: e.target.value })}
                    placeholder="Razón social *" className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={aiNewProvForm.cuit} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, cuit: e.target.value })}
                      placeholder="CUIT (opcional)" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                    <input value={aiNewProvForm.rubro} onChange={(e) => setAiNewProvForm({ ...aiNewProvForm, rubro: e.target.value })}
                      placeholder="Rubro (opcional)" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setAiNewProvOpen(false)} className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700">Cancelar</button>
                    <button onClick={handleAiCreateNewProv} disabled={aiNewProvSaving || !aiNewProvForm.razon_social.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                      {aiNewProvSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Crear proveedor
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Moneda</p>
                <p className="text-sm font-semibold">{aiResult.moneda}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Desde</p>
                <p className="text-sm font-semibold">{aiResult.vigencia_desde || "—"}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Hasta</p>
                <p className="text-sm font-semibold">{aiResult.vigencia_hasta || "—"}</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
                <p className="text-xs text-zinc-500">Articulos</p>
                <p className="text-sm font-semibold">{aiResult.items.length}</p>
              </div>
            </div>

            {aiResult.notas && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400">
                <strong>Notas de la IA:</strong> {aiResult.notas}
              </div>
            )}

            {/* Items table */}
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Codigo</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Descripcion</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500 hidden md:table-cell">Variante</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500 hidden sm:table-cell">Categoria</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-zinc-500">Un.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Precio</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500 hidden sm:table-cell">Desc.</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-zinc-500">Neto</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {aiResult.items.map((item, i) => (
                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2 font-mono text-xs font-bold">{item.codigo || "—"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{item.descripcion}</td>
                      <td className="px-3 py-2 text-zinc-500 hidden md:table-cell">{item.variante || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500 hidden sm:table-cell">{item.categoria}</td>
                      <td className="px-3 py-2 text-zinc-400">{item.unidad}</td>
                      <td className="px-3 py-2 text-right font-mono">{item.precio.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 hidden sm:table-cell">{item.descuento ? `${item.descuento}%` : "—"}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{item.precio_neto.toFixed(2)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeAiItem(i)} className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500" title="Quitar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
