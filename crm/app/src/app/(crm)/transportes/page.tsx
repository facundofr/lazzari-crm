"use client";

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/lib/supabase/client";
import {
  Truck, Plus, Minus, X, Loader2, CheckCircle2, Building2,
  MapPin, FileText, Phone, Mail, User, Pencil,
  ToggleLeft, ToggleRight, Package,
  ChevronRight, Calendar, DollarSign, Hash, Upload, Receipt,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency, todayAR } from "@/lib/utils";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { useToast } from "@/components/ui/toast";

// ── Tipos ─────────────────────────────────────────────────────────────

interface TransportistaRow {
  id: string;
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  contacto_principal: string | null;
  observaciones: string | null;
  activo: boolean;
  created_at: string;
}

interface ViajeRow {
  id: string;
  sociedad_id: string;
  fecha: string;
  tipo: "interno" | "externo";
  cliente_id: string | null;
  remito_id: string | null;
  transportista: string;
  transportista_id: string | null;
  tipo_vehiculo: string | null;
  origen: string | null;
  destino: string;
  descripcion_carga: string | null;
  peso_kg: number | null;
  costo: number | null;
  moneda: string;
  bultos: number | null;
  estado: string;
  notas: string | null;
  factura_compra_id: string | null;
  facturas_compra?: {
    id: string;
    numero_factura: string;
    archivo_url: string | null;
    estado: string;
  } | null;
  created_at: string;
}

interface ClienteOption {
  id: string;
  razon_social: string;
}

interface RemitoOption {
  id: string;
  numero: string;
}

interface ProveedorOption {
  id: string;
  razon_social: string;
  cuit: string | null;
}

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "info" | "danger" | "outline" }> = {
  solicitado: { label: "Solicitado", variant: "warning" },
  en_transito: { label: "En tránsito", variant: "info" },
  entregado: { label: "Entregado", variant: "success" },
  cancelado: { label: "Cancelado", variant: "danger" },
};

const tipoConfig: Record<string, { label: string; variant: "success" | "info" }> = {
  interno: { label: "Interno", variant: "success" },
  externo: { label: "Externo", variant: "info" },
};

// ── Componente principal ──────────────────────────────────────────────

export default function TransportesPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();

  // Tabs
  const [activeTab, setActiveTab] = useState<"viajes" | "catalogo">("viajes");

  // ─── Viajes state ───
  const [viajes, setViajes] = useState<ViajeRow[]>([]);
  const [loadingViajes, setLoadingViajes] = useState(true);
  const [selectedViaje, setSelectedViaje] = useState<ViajeRow | null>(null);
  const [showNuevoViaje, setShowNuevoViaje] = useState(false);
  const [editingViaje, setEditingViaje] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [searchText, setSearchText] = useState("");

  // ─── Catálogo state ───
  const [transportistas, setTransportistas] = useState<TransportistaRow[]>([]);
  const [loadingTransportistas, setLoadingTransportistas] = useState(false);
  const [selectedTransportista, setSelectedTransportista] = useState<TransportistaRow | null>(null);
  const [showNuevoTransportista, setShowNuevoTransportista] = useState(false);
  const [editingTransportista, setEditingTransportista] = useState(false);

  // ─── Options for selects ───
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [remitos, setRemitos] = useState<RemitoOption[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [saving, setSaving] = useState(false);

  // ─── Factura de transporte → Finanzas ───
  const [showFacturaViaje, setShowFacturaViaje] = useState(false);
  const [facturaViajeIds, setFacturaViajeIds] = useState<string[]>([]);
  const [facturaSaving, setFacturaSaving] = useState(false);
  const [facturaFile, setFacturaFile] = useState<File | null>(null);
  const [facturaForm, setFacturaForm] = useState({
    proveedor_id: "",
    numero_factura: "",
    fecha: todayAR(),
    total: "",
    iva_porcentaje: "21",
    moneda: "ARS",
    detalle: "",
  });

  // ─── AI parse factura ───
  const [facturaParsing, setFacturaParsing] = useState(false);
  const facturaParseRef = useRef<HTMLInputElement>(null);

  async function handleParseFactura(file: File) {
    setFacturaParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-cobro", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Error al leer comprobante");
      const d = json.data;
      setFacturaForm((f) => ({
        ...f,
        numero_factura: d.referencia || f.numero_factura,
        fecha: d.fecha || f.fecha,
        total: d.monto ? String(d.monto) : f.total,
        moneda: d.moneda === "USD" ? "USD" : f.moneda,
      }));
      // Also set the file as attachment
      setFacturaFile(file);
      toast.success("Datos extraídos del comprobante");
    } catch (e: any) {
      toast.error(e.message || "No se pudo leer el comprobante");
    } finally {
      setFacturaParsing(false);
    }
  }

  // ─── Nuevo viaje form ───
  const [formViaje, setFormViaje] = useState({
    tipo: "" as "" | "interno" | "externo",
    fecha: todayAR(),
    transportista_id: "",
    transportista: "",
    cliente_id: "",
    remito_id: "",
    destino: "",
    origen: "",
    costo: "",
    moneda: "ARS",
    bultos: "",
    descripcion_carga: "",
    notas: "",
  });

  // ─── Nuevo transportista form ───
  const [formTransportista, setFormTransportista] = useState({
    nombre: "",
    razon_social: "",
    cuit: "",
    telefono: "",
    email: "",
    direccion: "",
    localidad: "",
    provincia: "",
    contacto_principal: "",
    observaciones: "",
  });

  const socId = sociedadActiva?.id;

  // ── Fetch viajes ────────────────────────────────────────────────────
  const fetchViajes = useCallback(async () => {
    if (!socId) return;
    setLoadingViajes(true);
    try {
      const { data, error } = await (supabase as any)
        .from("transportes")
        .select("*")
        .or(`sociedad_id.eq.${socId},sociedad_id.is.null`)
        .order("fecha", { ascending: false });
      if (error) throw error;

      const rows = (data || []) as ViajeRow[];
      const facturaIds = [...new Set(rows.map((row) => row.factura_compra_id).filter(Boolean))] as string[];
      let facturasMap = new Map<string, ViajeRow["facturas_compra"]>();
      if (facturaIds.length > 0) {
        const { data: facturas, error: facturasError } = await (supabase as any)
          .from("facturas_compra")
          .select("id, numero_factura, archivo_url, estado")
          .in("id", facturaIds);
        if (facturasError) throw facturasError;
        facturasMap = new Map((facturas || []).map((factura: any) => [factura.id, factura]));
      }

      setViajes(rows.map((row) => ({
        ...row,
        facturas_compra: row.factura_compra_id ? facturasMap.get(row.factura_compra_id) || null : null,
      })));
    } catch (e: any) {
      console.error("Error fetching viajes:", e);
      toast.error("Error al cargar viajes");
    } finally {
      setLoadingViajes(false);
    }
  }, [socId]);

  // ── Fetch transportistas ────────────────────────────────────────────
  const fetchTransportistas = useCallback(async () => {
    if (!socId) return;
    setLoadingTransportistas(true);
    try {
      const { data, error } = await (supabase as any)
        .from("transportistas")
        .select("*")
        .or(`sociedad_id.eq.${socId},sociedad_id.is.null`)
        .order("nombre");
      if (error) throw error;
      setTransportistas(data || []);
    } catch (e: any) {
      console.error("Error fetching transportistas:", e);
    } finally {
      setLoadingTransportistas(false);
    }
  }, [socId]);

  // ── Fetch clientes + remitos + proveedores for selects ─────────────
  const fetchOptions = useCallback(async () => {
    if (!socId) return;
    const [cliRes, remRes, provRes] = await Promise.all([
      (supabase as any).from("clientes").select("id, razon_social").eq("sociedad_id", socId).order("razon_social"),
      (supabase as any).from("remitos").select("id, numero").eq("sociedad_id", socId).order("numero", { ascending: false }).limit(200),
      (supabase as any).from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", socId).eq("activo", true).order("razon_social"),
    ]);
    if (cliRes.data) setClientes(cliRes.data);
    if (remRes.data) setRemitos(remRes.data);
    if (provRes.data) setProveedores(provRes.data);
  }, [socId]);

  useEffect(() => {
    fetchViajes();
    fetchTransportistas();
    fetchOptions();
  }, [fetchViajes, fetchTransportistas, fetchOptions]);

  // Refresh selected viaje after data reload
  useEffect(() => {
    if (selectedViaje) {
      const updated = viajes.find((v) => v.id === selectedViaje.id);
      if (updated) setSelectedViaje(updated);
    }
  }, [viajes, selectedViaje?.id]);

  // ── Viaje CRUD ──────────────────────────────────────────────────────

  const resetFormViaje = () => {
    setFormViaje({
      tipo: "",
      fecha: todayAR(),
      transportista_id: "",
      transportista: "",
      cliente_id: "",
      remito_id: "",
      destino: "",
      origen: "",
      costo: "",
      moneda: "ARS",
      bultos: "",
      descripcion_carga: "",
      notas: "",
    });
  };

  const handleSaveViaje = async () => {
    if (!formViaje.tipo) { toast.error("Seleccioná tipo de viaje"); return; }
    if (formViaje.tipo === "externo" && !formViaje.destino.trim()) { toast.error("Destino es obligatorio"); return; }
    if (formViaje.tipo === "externo" && !formViaje.transportista_id) {
      toast.error("Seleccioná un transportista"); return;
    }

    setSaving(true);
    try {
      // Resolve transportista name
      let transportistaNombre = formViaje.transportista.trim();
      if (formViaje.tipo === "externo" && formViaje.transportista_id) {
        const t = transportistas.find((t) => t.id === formViaje.transportista_id);
        if (t) transportistaNombre = t.nombre;
      }
      if (!transportistaNombre) transportistaNombre = formViaje.tipo === "interno" ? "Interno" : "";

      const payload: any = {
        sociedad_id: socId,
        tipo: formViaje.tipo,
        fecha: formViaje.fecha,
        transportista: transportistaNombre,
        transportista_id: formViaje.tipo === "externo" ? formViaje.transportista_id || null : null,
        cliente_id: formViaje.cliente_id || null,
        remito_id: formViaje.remito_id || null,
        destino: formViaje.tipo === "interno" ? (formViaje.destino.trim() || "Interno") : formViaje.destino.trim(),
        origen: formViaje.origen.trim() || null,
        costo: formViaje.costo ? parseFloat(formViaje.costo) : null,
        moneda: formViaje.moneda,
        bultos: formViaje.bultos ? parseInt(formViaje.bultos) : null,
        descripcion_carga: formViaje.descripcion_carga.trim() || null,
        notas: formViaje.notas.trim() || null,
        estado: "solicitado",
        created_by: profile?.id || null,
      };

      if (editingViaje && selectedViaje) {
        delete payload.created_by;
        delete payload.estado;
        const { error } = await (supabase as any)
          .from("transportes")
          .update(payload)
          .eq("id", selectedViaje.id);
        if (error) throw error;
        toast.success("Viaje actualizado");
      } else {
        const { error } = await (supabase as any)
          .from("transportes")
          .insert(payload);
        if (error) throw error;
        toast.success("Viaje creado");
      }

      setShowNuevoViaje(false);
      setEditingViaje(false);
      resetFormViaje();
      fetchViajes();
    } catch (e: any) {
      console.error("Error guardando viaje:", e);
      toast.error(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteViaje = async (id: string) => {
    if (viajes.find((viaje) => viaje.id === id)?.factura_compra_id) {
      toast.error("No se puede eliminar un viaje que ya fue enviado a pagos");
      return;
    }
    if (!confirm("¿Eliminar este viaje?")) return;
    try {
      const { error } = await (supabase as any).from("transportes").delete().eq("id", id);
      if (error) throw error;
      toast.success("Viaje eliminado");
      setSelectedViaje(null);
      fetchViajes();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const handleEstadoChange = async (id: string, nuevoEstado: string) => {
    try {
      const { error } = await (supabase as any)
        .from("transportes")
        .update({ estado: nuevoEstado })
        .eq("id", id);
      if (error) throw error;
      toast.success(`Estado cambiado a ${estadoConfig[nuevoEstado]?.label || nuevoEstado}`);
      fetchViajes();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const startEditViaje = (v: ViajeRow) => {
    setFormViaje({
      tipo: v.tipo || "externo",
      fecha: v.fecha,
      transportista_id: v.transportista_id || "",
      transportista: v.transportista || "",
      cliente_id: v.cliente_id || "",
      remito_id: v.remito_id || "",
      destino: v.destino,
      origen: v.origen || "",
      costo: v.costo ? String(v.costo) : "",
      moneda: v.moneda || "ARS",
      bultos: v.bultos ? String(v.bultos) : "",
      descripcion_carga: v.descripcion_carga || "",
      notas: v.notas || "",
    });
    setEditingViaje(true);
    setShowNuevoViaje(true);
  };

  // ── Agregar parada (interno) ────────────────────────────────────────
  const handleAgregarParada = (viaje: ViajeRow) => {
    setFormViaje({
      tipo: "interno",
      fecha: viaje.fecha,
      transportista_id: "",
      transportista: viaje.transportista || "Interno",
      cliente_id: "",
      remito_id: "",
      destino: "",
      origen: viaje.destino, // origen = destino anterior
      costo: "",
      moneda: viaje.moneda || "ARS",
      bultos: "",
      descripcion_carga: "",
      notas: "",
    });
    setEditingViaje(false);
    setShowNuevoViaje(true);
  };

  // ── Transportista CRUD ──────────────────────────────────────────────

  const resetFormTransportista = () => {
    setFormTransportista({
      nombre: "", razon_social: "", cuit: "", telefono: "",
      email: "", direccion: "", localidad: "", provincia: "",
      contacto_principal: "", observaciones: "",
    });
  };

  const handleSaveTransportista = async () => {
    if (!formTransportista.nombre.trim()) { toast.error("Nombre es obligatorio"); return; }
    setSaving(true);
    try {
      const payload: any = {
        nombre: formTransportista.nombre.trim(),
        razon_social: formTransportista.razon_social.trim() || null,
        cuit: formTransportista.cuit.trim() || null,
        telefono: formTransportista.telefono.trim() || null,
        email: formTransportista.email.trim() || null,
        direccion: formTransportista.direccion.trim() || null,
        localidad: formTransportista.localidad.trim() || null,
        provincia: formTransportista.provincia.trim() || null,
        contacto_principal: formTransportista.contacto_principal.trim() || null,
        observaciones: formTransportista.observaciones.trim() || null,
      };

      if (editingTransportista && selectedTransportista) {
        const { error } = await (supabase as any)
          .from("transportistas")
          .update(payload)
          .eq("id", selectedTransportista.id);
        if (error) throw error;
        toast.success("Transportista actualizado");
      } else {
        payload.sociedad_id = socId;
        payload.created_by = profile?.id || null;
        const { error } = await (supabase as any)
          .from("transportistas")
          .insert(payload);
        if (error) throw error;
        toast.success("Transportista creado");
      }
      setShowNuevoTransportista(false);
      setEditingTransportista(false);
      resetFormTransportista();
      fetchTransportistas();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleTransportista = async (t: TransportistaRow) => {
    try {
      const { error } = await (supabase as any)
        .from("transportistas")
        .update({ activo: !t.activo })
        .eq("id", t.id);
      if (error) throw error;
      toast.success(`${t.nombre} ${!t.activo ? "activado" : "desactivado"}`);
      fetchTransportistas();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const handleDeleteTransportista = async (id: string) => {
    if (!confirm("¿Eliminar este transportista?")) return;
    try {
      const { error } = await (supabase as any).from("transportistas").delete().eq("id", id);
      if (error) throw error;
      toast.success("Transportista eliminado");
      setSelectedTransportista(null);
      fetchTransportistas();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
  };

  const startEditTransportista = (t: TransportistaRow) => {
    setFormTransportista({
      nombre: t.nombre,
      razon_social: t.razon_social || "",
      cuit: t.cuit || "",
      telefono: t.telefono || "",
      email: t.email || "",
      direccion: t.direccion || "",
      localidad: t.localidad || "",
      provincia: t.provincia || "",
      contacto_principal: t.contacto_principal || "",
      observaciones: t.observaciones || "",
    });
    setEditingTransportista(true);
    setShowNuevoTransportista(true);
  };

  // ── Helpers ─────────────────────────────────────────────────────────

  const getClienteName = (clienteId: string | null) => {
    if (!clienteId) return "—";
    const c = clientes.find((c) => c.id === clienteId);
    return c?.razon_social || "—";
  };

  const getRemitoNumero = (remitoId: string | null) => {
    if (!remitoId) return null;
    const r = remitos.find((r) => r.id === remitoId);
    return r?.numero || null;
  };

  const openFacturaParaPagos = (rows: ViajeRow[]) => {
    if (rows.length === 0) return;
    if (rows.some((row) => row.factura_compra_id)) {
      toast.error("Este viaje ya tiene una factura enviada a pagos");
      return;
    }

    const first = rows[0];
    const transportista = first.transportista_id
      ? transportistas.find((item) => item.id === first.transportista_id)
      : null;
    const normalizedName = (first.transportista || "").trim().toLowerCase();
    const proveedorSugerido = proveedores.find((proveedor) =>
      (transportista?.cuit && proveedor.cuit?.replace(/\D/g, "") === transportista.cuit.replace(/\D/g, ""))
      || proveedor.razon_social.trim().toLowerCase() === normalizedName
    );
    const total = rows.reduce((sum, row) => sum + Number(row.costo || 0), 0);

    setFacturaViajeIds(rows.map((row) => row.id));
    setFacturaFile(null);
    setFacturaForm({
      proveedor_id: proveedorSugerido?.id || "",
      numero_factura: "",
      fecha: todayAR(),
      total: total > 0 ? String(total) : "",
      iva_porcentaje: "21",
      moneda: first.moneda || "ARS",
      detalle: rows.length > 1
        ? `${rows.length} viajes internos del ${formatDate(first.fecha)} — ${first.transportista}`
        : `Viaje del ${formatDate(first.fecha)} — ${first.transportista}`,
    });
    setShowFacturaViaje(true);
  };

  const handleEnviarFacturaAPagos = async () => {
    const total = Number(facturaForm.total);
    const ivaPorcentaje = Number(facturaForm.iva_porcentaje);
    if (!facturaForm.proveedor_id) { toast.error("Seleccioná el proveedor que va a cobrar"); return; }
    if (!facturaForm.numero_factura.trim()) { toast.error("Ingresá el número de factura"); return; }
    if (!facturaFile) { toast.error("Adjuntá la factura en PDF o imagen"); return; }
    if (!total || total <= 0) { toast.error("Ingresá el total de la factura"); return; }
    if (facturaViajeIds.length === 0 || !socId) return;

    const subtotal = ivaPorcentaje > 0 ? total / (1 + ivaPorcentaje / 100) : total;
    const iva = total - subtotal;
    let createdFacturaId = "";
    let uploadedPath = "";
    setFacturaSaving(true);
    try {
      const { data: factura, error: facturaError } = await (supabase as any)
        .from("facturas_compra")
        .insert({
          numero_factura: facturaForm.numero_factura.trim(),
          proveedor_id: facturaForm.proveedor_id,
          fecha: facturaForm.fecha,
          subtotal: Math.round(subtotal * 100) / 100,
          iva_porcentaje: ivaPorcentaje,
          iva: Math.round(iva * 100) / 100,
          percepciones: 0,
          total: Math.round(total * 100) / 100,
          moneda: facturaForm.moneda,
          notas: `Factura de transporte — ${facturaForm.detalle}`,
          estado: "pendiente",
          solo_iva: false,
          tipo: "mercaderia",
          sociedad_id: socId,
          created_by: profile?.id || null,
        })
        .select("id")
        .single();
      if (facturaError || !factura?.id) throw facturaError || new Error("No se pudo crear la factura");
      createdFacturaId = factura.id;

      const extension = facturaFile.name.split(".").pop() || "pdf";
      uploadedPath = `${socId}/${createdFacturaId}/factura-transporte.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("facturas-compra")
        .upload(uploadedPath, facturaFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("facturas-compra").getPublicUrl(uploadedPath);
      const { error: archivoError } = await (supabase as any)
        .from("facturas_compra")
        .update({ archivo_url: urlData.publicUrl, archivo_nombre: facturaFile.name })
        .eq("id", createdFacturaId);
      if (archivoError) throw archivoError;

      const { error: linkError } = await (supabase as any)
        .from("transportes")
        .update({ factura_compra_id: createdFacturaId })
        .in("id", facturaViajeIds);
      if (linkError) throw linkError;

      toast.success("Factura enviada a Finanzas y pendiente de pago");
      setShowFacturaViaje(false);
      setFacturaViajeIds([]);
      setFacturaFile(null);
      await fetchViajes();
    } catch (e: any) {
      if (createdFacturaId) {
        await (supabase as any).from("facturas_compra").delete().eq("id", createdFacturaId);
      }
      if (uploadedPath) {
        await supabase.storage.from("facturas-compra").remove([uploadedPath]);
      }
      toast.error(`No se pudo enviar a pagos: ${e.message}`);
    } finally {
      setFacturaSaving(false);
    }
  };

  // ── Filtered viajes ─────────────────────────────────────────────────
  const filteredViajes = viajes.filter((v) => {
    if (filterValues.tipo && v.tipo !== filterValues.tipo) return false;
    if (filterValues.estado && v.estado !== filterValues.estado) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      const clienteNombre = getClienteName(v.cliente_id).toLowerCase();
      const transportistaNombre = (v.transportista || "").toLowerCase();
      const destino = (v.destino || "").toLowerCase();
      if (!clienteNombre.includes(s) && !transportistaNombre.includes(s) && !destino.includes(s)) return false;
    }
    return true;
  });

  // Paradas internas: viajes del mismo día y conductor
  const getParadasInternas = (viaje: ViajeRow) => {
    if (viaje.tipo !== "interno") return [];
    return viajes.filter(
      (v) => v.tipo === "interno" && v.fecha === viaje.fecha && v.transportista === viaje.transportista && v.id !== viaje.id
    );
  };

  // ── Filter config ──────────────────────────────────────────────────
  const viajeFilterConfig: FilterConfig[] = [
    { key: "tipo", type: "select", label: "Tipo", options: [
      { value: "interno", label: "Interno" },
      { value: "externo", label: "Externo" },
    ]},
    { key: "estado", type: "select", label: "Estado", options: [
      { value: "solicitado", label: "Solicitado" },
      { value: "en_transito", label: "En tránsito" },
      { value: "entregado", label: "Entregado" },
      { value: "cancelado", label: "Cancelado" },
    ]},
  ];

  // ── Viajes columns ─────────────────────────────────────────────────
  const viajeColumns = [
    { key: "fecha" as const, label: "Fecha", sortable: true, render: (v: ViajeRow) => formatDate(v.fecha) },
    { key: "tipo" as const, label: "Tipo", render: (v: ViajeRow) => {
      const cfg = tipoConfig[v.tipo] || tipoConfig.externo;
      return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
    }},
    { key: "transportista" as const, label: "Transportista / Conductor", sortable: true, render: (v: ViajeRow) => (
      <span className="font-medium">{v.transportista || "—"}</span>
    )},
    { key: "cliente_id" as const, label: "Cliente", render: (v: ViajeRow) => (
      <span className="max-w-[200px] truncate block">{getClienteName(v.cliente_id)}</span>
    )},
    { key: "destino" as const, label: "Destino", sortable: true },
    { key: "remito_id" as const, label: "Remito", render: (v: ViajeRow) => {
      const num = getRemitoNumero(v.remito_id);
      return num ? (
        <span className="text-orange-600 dark:text-orange-400 font-medium">{num}</span>
      ) : (
        <span className="text-zinc-400 text-sm">Sin remito</span>
      );
    }},
    { key: "costo" as const, label: "Costo", sortable: true, render: (v: ViajeRow) => (
      v.costo ? formatCurrency(v.costo, v.moneda as "ARS" | "USD") : "—"
    )},
    { key: "factura_compra_id" as const, label: "Factura", render: (v: ViajeRow) => (
      v.factura_compra_id ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (v.facturas_compra?.archivo_url) window.open(v.facturas_compra.archivo_url, "_blank", "noopener,noreferrer");
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
          title="Factura enviada a pagos"
        >
          <CheckCircle2 size={13} /> {v.facturas_compra?.numero_factura || "En pagos"}
        </button>
      ) : (
        <span className="text-zinc-400 text-sm">Sin factura</span>
      )
    )},
    { key: "estado" as const, label: "Estado", render: (v: ViajeRow) => {
      const cfg = estadoConfig[v.estado] || { label: v.estado, variant: "outline" as const };
      return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
    }},
  ];

  // ── Transportista columns ───────────────────────────────────────────
  const transportistaColumns = [
    { key: "nombre" as const, label: "Nombre", sortable: true, render: (t: TransportistaRow) => (
      <span className="font-medium">{t.nombre}</span>
    )},
    { key: "cuit" as const, label: "CUIT", render: (t: TransportistaRow) => t.cuit || "—" },
    { key: "telefono" as const, label: "Teléfono", render: (t: TransportistaRow) => t.telefono || "—" },
    { key: "localidad" as const, label: "Localidad", render: (t: TransportistaRow) => t.localidad || "—" },
    { key: "activo" as const, label: "Estado", render: (t: TransportistaRow) => (
      <Badge variant={t.activo ? "success" : "outline"}>{t.activo ? "Activo" : "Inactivo"}</Badge>
    )},
  ];

  // ── Render ──────────────────────────────────────────────────────────

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
  const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header
        title="Transportes"
        subtitle="Gestión de viajes y transportistas"
        action={
          activeTab === "viajes"
            ? { label: "Nuevo viaje", onClick: () => { resetFormViaje(); setEditingViaje(false); setShowNuevoViaje(true); } }
            : { label: "Nuevo transportista", onClick: () => { resetFormTransportista(); setEditingTransportista(false); setShowNuevoTransportista(true); } }
        }
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* ── Tabs ── */}
        <div className="mb-6 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => { setActiveTab("viajes"); setSelectedTransportista(null); }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "viajes"
                ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2"><Package size={16} /> Viajes</span>
          </button>
          <button
            onClick={() => { setActiveTab("catalogo"); setSelectedViaje(null); }}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "catalogo"
                ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2"><Building2 size={16} /> Catálogo transportistas</span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: VIAJES
           ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "viajes" && (
          <div className="flex gap-6">
            {/* Lista */}
            <div className={`transition-all ${selectedViaje ? "w-3/5" : "w-full"}`}>
              <Card className="p-0">
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <input
                      type="text"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Buscar cliente, transportista, destino..."
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                    />
                  </div>
                  <SmartFilters filters={viajeFilterConfig} values={filterValues} onChange={setFilterValues} />
                </div>
                {loadingViajes ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-orange-500" size={32} />
                  </div>
                ) : filteredViajes.length === 0 ? (
                  <EmptyState
                    icon={Truck}
                    title="Sin viajes"
                    description="Creá tu primer viaje con el botón de arriba"
                  />
                ) : (
                  <DataTable
                    columns={viajeColumns}
                    data={filteredViajes}
                    onRowClick={(v) => setSelectedViaje(v.id === selectedViaje?.id ? null : v)}
                    pageSize={15}
                  />
                )}
              </Card>

              {/* ── Viajes internos aggregation card ── */}
              {(() => {
                const internosAll = viajes.filter((v) => v.tipo === "interno");
                if (internosAll.length === 0) return null;

                // Group by (fecha, transportista, factura). Los viajes nuevos quedan
                // separados de un lote ya enviado a pagos para no alterar su importe.
                const groupMap = new Map<string, ViajeRow[]>();
                internosAll.forEach((v) => {
                  const key = `${v.fecha}||${v.transportista}||${v.factura_compra_id || "pendiente"}`;
                  const arr = groupMap.get(key) || [];
                  arr.push(v);
                  groupMap.set(key, arr);
                });

                const groups = Array.from(groupMap.entries())
                  .map(([key, rows]) => {
                    const [fecha, conductor, facturaKey] = key.split("||");
                    return {
                      fecha,
                      conductor,
                      facturaKey,
                      facturaId: rows[0]?.factura_compra_id || null,
                      rows,
                      costo: rows[0]?.costo ?? 0,
                      moneda: (rows[0]?.moneda || "ARS") as "ARS" | "USD",
                      factura: rows[0]?.facturas_compra || null,
                    };
                  })
                  .sort((a, b) => b.fecha.localeCompare(a.fecha));

                const handleAddInterno = async (fecha: string, conductor: string, costo: number, moneda: "ARS" | "USD" = "ARS") => {
                  try {
                    const { error } = await (supabase as any).from("transportes").insert({
                      sociedad_id: socId,
                      tipo: "interno",
                      fecha,
                      transportista: conductor,
                      transportista_id: null,
                      cliente_id: null,
                      remito_id: null,
                      destino: "Interno",
                      origen: null,
                      costo: costo || null,
                      moneda,
                      bultos: null,
                      descripcion_carga: null,
                      notas: null,
                      estado: "entregado",
                      created_by: profile?.id || null,
                    });
                    if (error) throw error;
                    toast.success("Viaje interno agregado");
                    fetchViajes();
                  } catch (e: any) {
                    toast.error(`Error: ${e.message}`);
                  }
                };

                const handleRemoveInterno = async (rows: ViajeRow[]) => {
                  if (rows.length === 0) return;
                  if (rows.some((row) => row.factura_compra_id)) {
                    toast.error("Este lote ya fue enviado a pagos y no se puede modificar");
                    return;
                  }
                  if (!confirm("¿Eliminar el último viaje interno de este grupo?")) return;
                  // Delete the most recently created
                  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
                  try {
                    const { error } = await (supabase as any).from("transportes").delete().eq("id", sorted[0].id);
                    if (error) throw error;
                    toast.success("Viaje interno eliminado");
                    fetchViajes();
                  } catch (e: any) {
                    toast.error(`Error: ${e.message}`);
                  }
                };

                const handleCostoChange = async (rows: ViajeRow[], nuevoCosto: number) => {
                  if (rows.some((row) => row.factura_compra_id)) {
                    toast.error("Este lote ya fue enviado a pagos y no se puede modificar");
                    return;
                  }
                  try {
                    const ids = rows.map((r) => r.id);
                    const { error } = await (supabase as any)
                      .from("transportes")
                      .update({ costo: nuevoCosto || null })
                      .in("id", ids);
                    if (error) throw error;
                    toast.success("Costo actualizado");
                    fetchViajes();
                  } catch (e: any) {
                    toast.error(`Error: ${e.message}`);
                  }
                };

                return (
                  <Card className="mt-6 p-0">
                    <div className="border-b border-zinc-200 dark:border-zinc-700 px-4 py-3">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
                        <Truck size={16} className="text-green-600" /> Viajes internos
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                            <th className="text-left px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Fecha</th>
                            <th className="text-left px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Conductor</th>
                            <th className="text-center px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Viajes</th>
                            <th className="text-right px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Costo unit.</th>
                            <th className="text-right px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Total</th>
                            <th className="text-right px-4 py-2 font-medium text-zinc-600 dark:text-zinc-400">Factura / pago</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map((g) => (
                            <tr key={`${g.fecha}-${g.conductor}-${g.facturaKey}`} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                              <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{formatDate(g.fecha)}</td>
                              <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-white">{g.conductor || "Sin conductor"}</td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => handleRemoveInterno(g.rows)}
                                    disabled={Boolean(g.facturaId)}
                                    className="rounded-md p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                                    title="Quitar viaje"
                                  >
                                    <Minus size={14} />
                                  </button>
                                  <span className="font-semibold text-zinc-900 dark:text-white min-w-[24px] text-center">{g.rows.length}</span>
                                  <button
                                    onClick={() => handleAddInterno(g.fecha, g.conductor, g.costo, g.moneda)}
                                    disabled={Boolean(g.facturaId)}
                                    className="rounded-md p-1 text-zinc-500 hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                                    title="Agregar viaje"
                                  >
                                    <Plus size={14} />
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  defaultValue={g.costo || ""}
                                  disabled={Boolean(g.facturaId)}
                                  onBlur={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (val !== (g.costo || 0)) handleCostoChange(g.rows, val);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  }}
                                  placeholder="0.00"
                                  className="w-24 text-right rounded border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:disabled:bg-zinc-800/50"
                                />
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium text-zinc-900 dark:text-white">
                                {formatCurrency(g.rows.length * (g.costo || 0), g.moneda)}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {g.facturaId ? (
                                  <button
                                    onClick={() => g.factura?.archivo_url && window.open(g.factura.archivo_url, "_blank", "noopener,noreferrer")}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400"
                                    title="Ver factura enviada a pagos"
                                  >
                                    <CheckCircle2 size={14} /> {g.factura?.numero_factura || "En pagos"}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => openFacturaParaPagos(g.rows)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                                  >
                                    <Receipt size={14} /> Cargar factura
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                );
              })()}
            </div>

            {/* Panel detalle viaje */}
            {selectedViaje && (
              <div className="w-2/5">
                <Card className="sticky top-6">
                  <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Detalle del viaje</h3>
                    <button onClick={() => setSelectedViaje(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="p-4 space-y-4">
                    {/* Estado + tipo */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {(() => {
                        const tc = tipoConfig[selectedViaje.tipo] || tipoConfig.externo;
                        return <Badge variant={tc.variant}>{tc.label}</Badge>;
                      })()}
                      {(() => {
                        const ec = estadoConfig[selectedViaje.estado] || { label: selectedViaje.estado, variant: "outline" as const };
                        return <Badge variant={ec.variant}>{ec.label}</Badge>;
                      })()}
                    </div>

                    {/* Info rows */}
                    <div className="space-y-3 text-sm">
                      <DetailRow icon={Calendar} label="Fecha" value={formatDate(selectedViaje.fecha)} />
                      <DetailRow icon={User} label={selectedViaje.tipo === "interno" ? "Conductor" : "Transportista"} value={selectedViaje.transportista || "—"} />
                      <DetailRow icon={Building2} label="Cliente" value={getClienteName(selectedViaje.cliente_id)} />
                      <DetailRow icon={MapPin} label="Origen" value={selectedViaje.origen || "—"} />
                      <DetailRow icon={MapPin} label="Destino" value={selectedViaje.destino} />
                      <DetailRow icon={FileText} label="Remito" value={getRemitoNumero(selectedViaje.remito_id) || "Sin remito"} />
                      <DetailRow icon={DollarSign} label="Costo" value={selectedViaje.costo ? formatCurrency(selectedViaje.costo, selectedViaje.moneda as "ARS" | "USD") : "—"} />
                      {selectedViaje.factura_compra_id && (
                        <DetailRow icon={Receipt} label="Factura en pagos" value={selectedViaje.facturas_compra?.numero_factura || "Registrada"} />
                      )}
                      {selectedViaje.bultos && <DetailRow icon={Package} label="Bultos" value={String(selectedViaje.bultos)} />}
                      {selectedViaje.descripcion_carga && <DetailRow icon={Hash} label="Carga" value={selectedViaje.descripcion_carga} />}
                      {selectedViaje.notas && (
                        <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700">
                          <p className="text-xs text-zinc-500 mb-1">Notas</p>
                          <p className="text-zinc-700 dark:text-zinc-300">{selectedViaje.notas}</p>
                        </div>
                      )}
                    </div>

                    {/* Paradas internas */}
                    {selectedViaje.tipo === "interno" && (() => {
                      const paradas = getParadasInternas(selectedViaje);
                      return paradas.length > 0 ? (
                        <div className="pt-3 border-t border-zinc-100 dark:border-zinc-700">
                          <p className="text-xs font-medium text-zinc-500 mb-2 uppercase">Otras paradas del viaje</p>
                          <div className="space-y-2">
                            {paradas.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => setSelectedViaje(p)}
                                className="w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-700 p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">{p.destino}</span>
                                  <ChevronRight size={14} className="text-zinc-400" />
                                </div>
                                <p className="text-xs text-zinc-500">{getClienteName(p.cliente_id)}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}

                    {/* Cambiar estado */}
                    <div className="pt-3 border-t border-zinc-100 dark:border-zinc-700">
                      <p className="text-xs font-medium text-zinc-500 mb-2 uppercase">Cambiar estado</p>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(estadoConfig).map(([key, cfg]) => (
                          <button
                            key={key}
                            disabled={selectedViaje.estado === key}
                            onClick={() => handleEstadoChange(selectedViaje.id, key)}
                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                              selectedViaje.estado === key
                                ? "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 cursor-not-allowed"
                                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-700">
                      {selectedViaje.factura_compra_id ? (
                        <button
                          onClick={() => selectedViaje.facturas_compra?.archivo_url && window.open(selectedViaje.facturas_compra.archivo_url, "_blank", "noopener,noreferrer")}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400"
                        >
                          <CheckCircle2 size={14} /> Ver factura enviada
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditViaje(selectedViaje)}
                            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                          >
                            <Pencil size={14} /> Editar
                          </button>
                          <button
                            onClick={() => openFacturaParaPagos(
                              selectedViaje.tipo === "interno"
                                ? [selectedViaje, ...getParadasInternas(selectedViaje)].filter((row) => !row.factura_compra_id)
                                : [selectedViaje]
                            )}
                            className="flex items-center gap-1.5 rounded-lg bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                          >
                            <Receipt size={14} /> Enviar factura a pagos
                          </button>
                          {selectedViaje.tipo === "interno" && (
                            <button
                              onClick={() => handleAgregarParada(selectedViaje)}
                              className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                              <Plus size={14} /> Parada
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteViaje(selectedViaje.id)}
                            className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30"
                          >
                            <X size={14} /> Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: CATÁLOGO TRANSPORTISTAS
           ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "catalogo" && (
          <div className="flex gap-6">
            <div className={`transition-all ${selectedTransportista ? "w-3/5" : "w-full"}`}>
              <Card className="p-0">
                {loadingTransportistas ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="animate-spin text-orange-500" size={32} />
                  </div>
                ) : transportistas.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="Sin transportistas"
                    description="Agregá transportistas para asignarlos a viajes externos"
                  />
                ) : (
                  <DataTable
                    columns={transportistaColumns}
                    data={transportistas}
                    onRowClick={(t) => setSelectedTransportista(t.id === selectedTransportista?.id ? null : t)}
                  />
                )}
              </Card>
            </div>

            {/* Panel detalle transportista */}
            {selectedTransportista && (
              <div className="w-2/5">
                <Card className="sticky top-6">
                  <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">{selectedTransportista.nombre}</h3>
                    <button onClick={() => setSelectedTransportista(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="p-4 space-y-3 text-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant={selectedTransportista.activo ? "success" : "outline"}>
                        {selectedTransportista.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>

                    {selectedTransportista.razon_social && <DetailRow icon={Building2} label="Razón social" value={selectedTransportista.razon_social} />}
                    {selectedTransportista.cuit && <DetailRow icon={Hash} label="CUIT" value={selectedTransportista.cuit} />}
                    {selectedTransportista.telefono && <DetailRow icon={Phone} label="Teléfono" value={selectedTransportista.telefono} />}
                    {selectedTransportista.email && <DetailRow icon={Mail} label="Email" value={selectedTransportista.email} />}
                    {selectedTransportista.contacto_principal && <DetailRow icon={User} label="Contacto" value={selectedTransportista.contacto_principal} />}
                    {selectedTransportista.direccion && <DetailRow icon={MapPin} label="Dirección" value={selectedTransportista.direccion} />}
                    {selectedTransportista.localidad && <DetailRow icon={MapPin} label="Localidad" value={selectedTransportista.localidad} />}
                    {selectedTransportista.provincia && <DetailRow icon={MapPin} label="Provincia" value={selectedTransportista.provincia} />}
                    {selectedTransportista.observaciones && (
                      <div className="pt-2 border-t border-zinc-100 dark:border-zinc-700">
                        <p className="text-xs text-zinc-500 mb-1">Observaciones</p>
                        <p className="text-zinc-700 dark:text-zinc-300">{selectedTransportista.observaciones}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-700">
                      <button
                        onClick={() => startEditTransportista(selectedTransportista)}
                        className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        <Pencil size={14} /> Editar
                      </button>
                      <button
                        onClick={() => handleToggleTransportista(selectedTransportista)}
                        className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        {selectedTransportista.activo ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                        {selectedTransportista.activo ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        onClick={() => handleDeleteTransportista(selectedTransportista.id)}
                        className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 ml-auto"
                      >
                        <X size={14} /> Eliminar
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: NUEVO/EDITAR VIAJE
         ══════════════════════════════════════════════════════════════════ */}
      {showNuevoViaje && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                {editingViaje ? "Editar viaje" : "Nuevo viaje"}
              </h2>
              <button onClick={() => { setShowNuevoViaje(false); setEditingViaje(false); resetFormViaje(); }} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {/* Paso 1: Tipo */}
              {!formViaje.tipo && !editingViaje ? (
                <div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">Seleccioná el tipo de viaje:</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setFormViaje((f) => ({ ...f, tipo: "interno" }))}
                      className="flex flex-col items-center gap-2 rounded-xl border-2 border-zinc-200 p-6 hover:border-green-500 hover:bg-green-50 dark:border-zinc-700 dark:hover:border-green-500 dark:hover:bg-green-900/10 transition-colors"
                    >
                      <Truck size={32} className="text-green-600" />
                      <span className="font-semibold text-zinc-900 dark:text-white">Interno</span>
                      <span className="text-xs text-zinc-500">Camión propio</span>
                    </button>
                    <button
                      onClick={() => setFormViaje((f) => ({ ...f, tipo: "externo" }))}
                      className="flex flex-col items-center gap-2 rounded-xl border-2 border-zinc-200 p-6 hover:border-blue-500 hover:bg-blue-50 dark:border-zinc-700 dark:hover:border-blue-500 dark:hover:bg-blue-900/10 transition-colors"
                    >
                      <Building2 size={32} className="text-blue-600" />
                      <span className="font-semibold text-zinc-900 dark:text-white">Externo</span>
                      <span className="text-xs text-zinc-500">Transportista tercero</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Tipo badge */}
                  <div className="flex items-center gap-2">
                    <Badge variant={formViaje.tipo === "interno" ? "success" : "info"}>
                      {formViaje.tipo === "interno" ? "Interno" : "Externo"}
                    </Badge>
                    {!editingViaje && (
                      <button
                        onClick={() => setFormViaje((f) => ({ ...f, tipo: "" as any }))}
                        className="text-xs text-zinc-500 hover:text-zinc-700 underline"
                      >
                        Cambiar
                      </button>
                    )}
                  </div>

                  {/* Transportista (externo) o Conductor (interno) */}
                  {formViaje.tipo === "externo" ? (
                    <div>
                      <label className={labelClass}>Transportista *</label>
                      <select
                        value={formViaje.transportista_id}
                        onChange={(e) => setFormViaje((f) => ({ ...f, transportista_id: e.target.value }))}
                        className={inputClass}
                      >
                        <option value="">Seleccionar transportista...</option>
                        {transportistas.filter((t) => t.activo).map((t) => (
                          <option key={t.id} value={t.id}>{t.nombre}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className={labelClass}>Conductor</label>
                      <input
                        type="text"
                        value={formViaje.transportista}
                        onChange={(e) => setFormViaje((f) => ({ ...f, transportista: e.target.value }))}
                        placeholder="Nombre del conductor (opcional)"
                        className={inputClass}
                      />
                    </div>
                  )}

                  {/* Fecha */}
                  <div>
                    <label className={labelClass}>Fecha</label>
                    <input
                      type="date"
                      value={formViaje.fecha}
                      onChange={(e) => setFormViaje((f) => ({ ...f, fecha: e.target.value }))}
                      className={inputClass}
                    />
                  </div>

                  {/* ── Campos solo para externo ── */}
                  {formViaje.tipo === "externo" && (
                    <>
                      {/* Cliente */}
                      <div>
                        <label className={labelClass}>Cliente</label>
                        <select
                          value={formViaje.cliente_id}
                          onChange={(e) => setFormViaje((f) => ({ ...f, cliente_id: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="">Sin cliente</option>
                          {clientes.map((c) => (
                            <option key={c.id} value={c.id}>{c.razon_social}</option>
                          ))}
                        </select>
                      </div>

                      {/* Remito */}
                      <div>
                        <label className={labelClass}>Remito</label>
                        <select
                          value={formViaje.remito_id}
                          onChange={(e) => setFormViaje((f) => ({ ...f, remito_id: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="">Sin remito</option>
                          {remitos.map((r) => (
                            <option key={r.id} value={r.id}>{r.numero}</option>
                          ))}
                        </select>
                      </div>

                      {/* Origen / Destino */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Origen</label>
                          <input
                            type="text"
                            value={formViaje.origen}
                            onChange={(e) => setFormViaje((f) => ({ ...f, origen: e.target.value }))}
                            placeholder="Origen"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Destino *</label>
                          <input
                            type="text"
                            value={formViaje.destino}
                            onChange={(e) => setFormViaje((f) => ({ ...f, destino: e.target.value }))}
                            placeholder="Destino"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      {/* Costo / Moneda / Bultos */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>Costo</label>
                          <input
                            type="number"
                            step="0.01"
                            value={formViaje.costo}
                            onChange={(e) => setFormViaje((f) => ({ ...f, costo: e.target.value }))}
                            placeholder="0.00"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Moneda</label>
                          <select
                            value={formViaje.moneda}
                            onChange={(e) => setFormViaje((f) => ({ ...f, moneda: e.target.value }))}
                            className={inputClass}
                          >
                            <option value="ARS">ARS</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Bultos</label>
                          <input
                            type="number"
                            value={formViaje.bultos}
                            onChange={(e) => setFormViaje((f) => ({ ...f, bultos: e.target.value }))}
                            placeholder="0"
                            className={inputClass}
                          />
                        </div>
                      </div>

                      {/* Descripcion carga */}
                      <div>
                        <label className={labelClass}>Descripción de carga</label>
                        <input
                          type="text"
                          value={formViaje.descripcion_carga}
                          onChange={(e) => setFormViaje((f) => ({ ...f, descripcion_carga: e.target.value }))}
                          placeholder="Ej: 3 pallets de válvulas"
                          className={inputClass}
                        />
                      </div>

                      {/* Notas */}
                      <div>
                        <label className={labelClass}>Notas</label>
                        <textarea
                          value={formViaje.notas}
                          onChange={(e) => setFormViaje((f) => ({ ...f, notas: e.target.value }))}
                          placeholder="Notas adicionales..."
                          rows={2}
                          className={inputClass}
                        />
                      </div>

                      {/* Sin remito warning */}
                      {!formViaje.remito_id && formViaje.costo && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
                          Sin remito asociado. El costo se registrará como gasto de transporte.
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {formViaje.tipo && (
              <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-700">
                <button
                  onClick={() => { setShowNuevoViaje(false); setEditingViaje(false); resetFormViaje(); }}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveViaje}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {editingViaje ? "Guardar cambios" : "Crear viaje"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: FACTURA DE TRANSPORTE → FINANZAS / PAGOS
         ══════════════════════════════════════════════════════════════════ */}
      {showFacturaViaje && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Enviar factura a pagos</h2>
                <p className="mt-0.5 text-xs text-zinc-500">Se registrará en Facturas de Compra como pendiente</p>
              </div>
              <button onClick={() => setShowFacturaViaje(false)} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300">
                <span className="font-medium">{facturaViajeIds.length} {facturaViajeIds.length === 1 ? "viaje" : "viajes"}</span>
                <span className="block text-xs mt-0.5">{facturaForm.detalle}</span>
              </div>

              <div>
                <label className={labelClass}>Proveedor que va a cobrar *</label>
                <select
                  value={facturaForm.proveedor_id}
                  onChange={(e) => setFacturaForm((form) => ({ ...form, proveedor_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">Seleccionar proveedor...</option>
                  {proveedores.map((proveedor) => (
                    <option key={proveedor.id} value={proveedor.id}>{proveedor.razon_social}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-400">Es quien aparecerá después para generar la orden de pago.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Número de factura *</label>
                  <input
                    value={facturaForm.numero_factura}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, numero_factura: e.target.value }))}
                    placeholder="Ej: 0001-00001234"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Fecha *</label>
                  <input
                    type="date"
                    value={facturaForm.fecha}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, fecha: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Total de la factura *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={facturaForm.total}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, total: e.target.value }))}
                    placeholder="0,00"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Moneda</label>
                  <select
                    value={facturaForm.moneda}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, moneda: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>IVA incluido en el total</label>
                  <select
                    value={facturaForm.iva_porcentaje}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, iva_porcentaje: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="0">0%</option>
                    <option value="10.5">10,5%</option>
                    <option value="21">21%</option>
                    <option value="27">27%</option>
                  </select>
                </div>
              </div>

              {Number(facturaForm.total) > 0 && (
                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Neto estimado: <span className="font-mono font-semibold">{formatCurrency(
                    Number(facturaForm.total) / (1 + Number(facturaForm.iva_porcentaje) / 100),
                    facturaForm.moneda as "ARS" | "USD"
                  )}</span>
                  <span className="mx-2 text-zinc-300">|</span>
                  IVA: <span className="font-mono font-semibold">{formatCurrency(
                    Number(facturaForm.total) - (Number(facturaForm.total) / (1 + Number(facturaForm.iva_porcentaje) / 100)),
                    facturaForm.moneda as "ARS" | "USD"
                  )}</span>
                </div>
              )}

              <div>
                <label className={labelClass}>Factura adjunta *</label>
                <div className="flex gap-2">
                  <label className="flex-1 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-sm text-zinc-600 hover:border-orange-400 hover:bg-orange-50/50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-orange-950/20">
                    <Upload size={18} className="text-orange-500" />
                    <span className="min-w-0 flex-1 truncate">{facturaFile?.name || "Seleccionar PDF o imagen"}</span>
                    <input
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => setFacturaFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  <input ref={facturaParseRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleParseFactura(f); e.target.value = ""; }} />
                  <button type="button" onClick={() => facturaParseRef.current?.click()} disabled={facturaParsing}
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    title="Leer datos automáticamente de la factura">
                    {facturaParsing ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    Leer
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-700">
              <button
                onClick={() => setShowFacturaViaje(false)}
                disabled={facturaSaving}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviarFacturaAPagos}
                disabled={facturaSaving}
                className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {facturaSaving ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                {facturaSaving ? "Enviando..." : "Enviar a pagos"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: NUEVO/EDITAR TRANSPORTISTA
         ══════════════════════════════════════════════════════════════════ */}
      {showNuevoTransportista && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                {editingTransportista ? "Editar transportista" : "Nuevo transportista"}
              </h2>
              <button onClick={() => { setShowNuevoTransportista(false); setEditingTransportista(false); resetFormTransportista(); }} className="text-zinc-400 hover:text-zinc-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Nombre *</label>
                  <input
                    type="text"
                    value={formTransportista.nombre}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, nombre: e.target.value }))}
                    className={inputClass}
                    placeholder="Nombre del transportista"
                  />
                </div>
                <div>
                  <label className={labelClass}>Razón social</label>
                  <input
                    type="text"
                    value={formTransportista.razon_social}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, razon_social: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>CUIT</label>
                  <input
                    type="text"
                    value={formTransportista.cuit}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, cuit: e.target.value }))}
                    className={inputClass}
                    placeholder="XX-XXXXXXXX-X"
                  />
                </div>
                <div>
                  <label className={labelClass}>Teléfono</label>
                  <input
                    type="text"
                    value={formTransportista.telefono}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, telefono: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    type="email"
                    value={formTransportista.email}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, email: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Contacto principal</label>
                  <input
                    type="text"
                    value={formTransportista.contacto_principal}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, contacto_principal: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Dirección</label>
                  <input
                    type="text"
                    value={formTransportista.direccion}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, direccion: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Localidad</label>
                  <input
                    type="text"
                    value={formTransportista.localidad}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, localidad: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Provincia</label>
                  <input
                    type="text"
                    value={formTransportista.provincia}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, provincia: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Observaciones</label>
                  <textarea
                    value={formTransportista.observaciones}
                    onChange={(e) => setFormTransportista((f) => ({ ...f, observaciones: e.target.value }))}
                    rows={2}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-700">
              <button
                onClick={() => { setShowNuevoTransportista(false); setEditingTransportista(false); resetFormTransportista(); }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveTransportista}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {editingTransportista ? "Guardar cambios" : "Crear transportista"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Row component ──────────────────────────────────────────────
function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} className="text-zinc-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="font-medium text-zinc-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}
