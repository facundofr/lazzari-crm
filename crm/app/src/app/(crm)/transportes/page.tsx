"use client";

// Transportes: contador de viajes por transportista (versión simple, 19/10/2026, pedido de Augusto).
// - Mes con ◀ ▶ (corte mensual). Un renglón por transportista: − viajes +, y (solo los que no nos facturan) "$ a todos", total y Factura manual.
// - Clic en el nombre: sus viajes del mes (fecha, monto y nota editables; ✕ cancela, no borra). Tildar para facturar uno o más.
// - Los que no nos facturan: Factura manual a fin de mes; esos viajes pasan a un renglón "Facturado" y lo que falta queda abajo.
// - Las facturas de los que sí facturan se cargan con "Cargar factura" (la ventana de Compras Lazza), sin atar viajes.
// - Los viajes de remitos ("¿Quién lo lleva?") no aparecen acá: quedan solo en Remitos.
// Lógica pura en lib/transportes-anotador.ts.

import { Header } from "@/components/layout/header";
import { mostrarWhatsApp } from "@/lib/whatsapp-ar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { TransportesFacturas } from "@/components/transportes-facturas";
import ComprasLazzaFactura from "@/components/compras-lazza-factura";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/lib/supabase/client";
import { filtrarPorNombreODestino } from "@/lib/transportes-destinos";
import {
  Minus, Plus, X, Loader2, CheckCircle2, Building2,
  MapPin, Phone, Mail, User, Package, Hash, Upload, Receipt,
  ChevronLeft, ChevronRight, ChevronDown, RotateCcw,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency, todayAR } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { traerTodo } from "@/lib/paginar";
import { linkArchivo } from "@/lib/archivo-link";
import {
  claveViaje, montoInicial, montoViaje, viajesDelMes, sinLiquidar, viajeParaQuitar, fechaParaSumar, resumenMes, totalMontos,
  sumarMeses, leerMonto, esDeRemito, vigente, type ResumenTransportista,
} from "@/lib/transportes-anotador";

// ── Tipos ─────────────────────────────────────────────────────────────

interface TransportistaRow {
  id: string;
  proveedor_id?: string | null;
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
  precio_viaje_fijo?: number | null;
  no_factura?: boolean;
  destinos?: string | null;
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

interface ProveedorOption {
  id: string;
  razon_social: string;
  cuit: string | null;
}

const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

// ── Componente principal ──────────────────────────────────────────────

export default function TransportesPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const socId = sociedadActiva?.id;

  const [activeTab, setActiveTab] = useState<"viajes" | "catalogo" | "facturas">("viajes");
  const [busquedaCatalogo, setBusquedaCatalogo] = useState("");
  // "Cargar factura": la misma ventana de Compras Lazza, con Transporte elegido. facturasKey recarga la pestaña Facturas al guardar.
  const [cargandoFactura, setCargandoFactura] = useState(false);
  const [facturasKey, setFacturasKey] = useState(0);

  // ─── Datos ───
  const [viajes, setViajes] = useState<ViajeRow[]>([]);
  const [loadingViajes, setLoadingViajes] = useState(true);
  const [transportistas, setTransportistas] = useState<TransportistaRow[]>([]);
  const [loadingTransportistas, setLoadingTransportistas] = useState(false);
  const [selectedTransportista, setSelectedTransportista] = useState<TransportistaRow | null>(null);
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // ─── Contador ───
  const [mes, setMes] = useState(() => todayAR().slice(0, 7));
  const [abierto, setAbierto] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [verCancelados, setVerCancelados] = useState(false);
  const [montoGeneral, setMontoGeneral] = useState<Record<string, string>>({});

  useEffect(() => { setSeleccion(new Set()); }, [mes, abierto]);

  // ─── Factura de transporte → Finanzas ───
  const [showFacturaViaje, setShowFacturaViaje] = useState(false);
  const [facturaViajeIds, setFacturaViajeIds] = useState<string[]>([]);
  const [facturaSaving, setFacturaSaving] = useState(false);
  const [facturaFile, setFacturaFile] = useState<File | null>(null);
  const [facturaEsInterna, setFacturaEsInterna] = useState(false);
  const [facturaParsed, setFacturaParsed] = useState(false);
  const [facturaParseError, setFacturaParseError] = useState("");
  const [facturaForm, setFacturaForm] = useState({
    proveedor_id: "",
    tipo_comprobante: "FC A",
    numero_factura: "",
    fecha: todayAR(),
    fecha_vencimiento: "",
    cae: "",
    total: "",
    iva_porcentaje: "21",
    percepciones: "",
    moneda: "ARS",
    detalle: "",
    notas: "",
  });

  // ─── AI parse factura ───
  const [facturaParsing, setFacturaParsing] = useState(false);
  async function handleParseFactura(file: File) {
    setFacturaFile(file);
    setFacturaParsed(false);
    setFacturaParseError("");
    setFacturaParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Error al leer factura");
      const d = json.data;
      const rawTipo = String(d.tipo_comprobante || "").toUpperCase().trim();
      let tipoComprobante = facturaForm.tipo_comprobante;
      if (/NOTA\s*DE\s*PEDIDO|PRESUPUESTO|COTIZACI[OÓ]N|PROFORMA/.test(rawTipo)) tipoComprobante = "Otro";
      else if (/^NC/.test(rawTipo) || /NOTA\s+DE\s+CR[EÉ]DITO/.test(rawTipo)) {
        tipoComprobante = /\bB\b/.test(rawTipo) ? "NC B" : "NC A";
      } else if (/^ND/.test(rawTipo) || /NOTA\s+DE\s+D[EÉ]BITO/.test(rawTipo)) {
        tipoComprobante = /\bB\b/.test(rawTipo) ? "ND B" : "ND A";
      }
      else if (rawTipo.includes("RECIBO")) tipoComprobante = "Recibo";
      else if (/\bC\b/.test(rawTipo)) tipoComprobante = "FC C";
      else if (/\bB\b/.test(rawTipo)) tipoComprobante = "FC B";
      else if (/\bA\b/.test(rawTipo)) tipoComprobante = "FC A";

      const parsedCuit = String(d.proveedor?.cuit || "").replace(/\D/g, "");
      const parsedName = String(d.proveedor?.razon_social || "").trim().toLowerCase();
      const parsedProvider = proveedores.find((provider) => (
        (parsedCuit && String(provider.cuit || "").replace(/\D/g, "") === parsedCuit)
        || (parsedName && provider.razon_social.trim().toLowerCase() === parsedName)
      ));
      setFacturaForm((f) => ({
        ...f,
        proveedor_id: parsedProvider?.id || f.proveedor_id,
        tipo_comprobante: tipoComprobante,
        numero_factura: d.numero_factura || f.numero_factura,
        fecha: d.fecha || f.fecha,
        fecha_vencimiento: d.fecha_vencimiento || "",
        cae: d.cae || "",
        total: d.total ? String(d.total) : f.total,
        iva_porcentaje: d.iva_porcentaje != null ? String(d.iva_porcentaje) : f.iva_porcentaje,
        percepciones: d.percepciones != null ? String(Number(d.percepciones) || 0) : "",
        moneda: d.moneda === "USD" ? "USD" : d.moneda === "ARS" ? "ARS" : f.moneda,
        notas: d.notas || "",
      }));
      if (parsedProvider) setFacturaProvSearch(parsedProvider.razon_social);
      setFacturaParsed(true);
      toast.success("Factura adjuntada y leída. Revisá los datos antes de enviarla.");
    } catch (e: any) {
      const message = e.message || "No se pudo leer la factura";
      setFacturaParseError(message);
      toast.error(`${message}. El archivo quedó adjunto para que completes los datos manualmente.`);
    } finally {
      setFacturaParsing(false);
    }
  }

  const [facturaProvSearch, setFacturaProvSearch] = useState("");
  const [facturaProvDropdown, setFacturaProvDropdown] = useState(false);

  // ── Carga ───────────────────────────────────────────────────────────
  const fetchViajes = useCallback(async () => {
    if (!socId) return;
    setLoadingViajes(true);
    try {
      const rows = await traerTodo<ViajeRow>(() => (supabase as any)
        .from("transportes")
        .select("*")
        .or(`sociedad_id.eq.${socId},sociedad_id.is.null`)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false }));

      const ids = [...new Set(rows.map((r) => r.factura_compra_id).filter(Boolean))] as string[];
      const facturas: any[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await (supabase as any).from("facturas_compra").select("id, numero_factura, archivo_url, estado").in("id", ids.slice(i, i + 150));
        if (error) throw error;
        facturas.push(...(data || []));
      }
      const facturasMap = new Map(facturas.map((f: any) => [f.id, f]));
      setViajes(rows.map((row) => ({ ...row, facturas_compra: row.factura_compra_id ? facturasMap.get(row.factura_compra_id) || null : null })));
    } catch (e: any) {
      console.error("Error cargando viajes:", e);
      toast.error("Error al cargar viajes");
    } finally {
      setLoadingViajes(false);
    }
  }, [socId]);

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
      console.error("Error cargando transportistas:", e);
    } finally {
      setLoadingTransportistas(false);
    }
  }, [socId]);

  const fetchProveedores = useCallback(async () => {
    if (!socId) return;
    const data = await traerTodo<ProveedorOption>(() => (supabase as any).from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", socId).eq("activo", true).order("razon_social").order("id"))
      .catch(() => [] as ProveedorOption[]);
    setProveedores(data);
  }, [socId]);

  useEffect(() => {
    fetchViajes();
    fetchTransportistas();
    fetchProveedores();
  }, [fetchViajes, fetchTransportistas, fetchProveedores]);

  // ── Derivados ───────────────────────────────────────────────────────
  const catalogo = transportistas;
  const hoy = todayAR();

  // Renglones: los que tienen viajes en el mes (en $ y, si hubiera, en US$) y después los activos sin viajes.
  const filas = useMemo(() => {
    // Los que no nos facturan y ya tienen viajes facturados a mano: un renglón "Facturado" arriba y otro con lo que falta facturar abajo.
    const partir = (r: ResumenTransportista, moneda: "ARS" | "USD") => {
      const sinFactura = Boolean(transportistas.find((t) => t.id === r.clave)?.no_factura);
      if (!sinFactura || r.liquidados === 0) return [{ r, moneda, facturado: false }];
      const faltan = { ...r, viajes: r.pendientes.length, total: r.totalPendiente, liquidados: 0, sinMonto: r.pendientes.filter((v) => montoViaje(v) == null).length };
      const hechos = { ...r, viajes: r.liquidados, total: r.total - r.totalPendiente, sinMonto: 0, pendientes: [], totalPendiente: 0 };
      return [{ r: hechos, moneda, facturado: true }, { r: faltan, moneda, facturado: false }];
    };
    const ars = resumenMes(viajes, mes, catalogo, "ARS").flatMap((r) => partir(r, "ARS"));
    const usd = resumenMes(viajes, mes, catalogo, "USD").flatMap((r) => partir(r, "USD"));
    const usadas = new Set([...ars, ...usd].map((f) => f.r.clave));
    const vacios = transportistas
      .filter((t) => t.activo && !usadas.has(t.id))
      .map((t) => ({ r: { clave: t.id, nombre: t.nombre, viajes: 0, sinMonto: 0, total: 0, liquidados: 0, pendientes: [], totalPendiente: 0 } as ResumenTransportista, moneda: "ARS" as const, facturado: false }));
    return [...ars, ...usd, ...vacios];
  }, [viajes, mes, catalogo, transportistas]);

  const totalViajesMes = filas.reduce((s, f) => s + f.r.viajes, 0);
  const totalMesARS = filas.filter((f) => f.moneda === "ARS").reduce((s, f) => s + f.r.total, 0);

  const viajesAbiertos = useMemo(
    () => (abierto ? (viajesDelMes(viajes, mes, abierto, catalogo, verCancelados) as ViajeRow[]) : []),
    [viajes, mes, abierto, catalogo, verCancelados],
  );

  // ── Acciones ────────────────────────────────────────────────────────
  const sumarViaje = async (clave: string) => {
    if (!socId || ocupado) return;
    const t = transportistas.find((x) => x.id === clave);
    if (!t) { toast.error("Ese transportista no está en el catálogo. Cargalo en Proveedores y tildá \"Transporte\"."); return; }
    const anterior = viajes.find((v) => !esDeRemito(v) && claveViaje(v, catalogo) === clave);
    setOcupado(`fila:${clave}`);
    try {
      const { data, error } = await (supabase as any).from("transportes").insert({
        sociedad_id: socId,
        fecha: fechaParaSumar(mes, hoy),
        tipo: anterior?.tipo === "interno" ? "interno" : "externo",
        transportista: t.nombre,
        transportista_id: t.id,
        cliente_id: null,
        remito_id: null,
        destino: "",
        costo: montoInicial(t),
        moneda: "ARS",
        estado: "entregado",
        created_by: profile?.id || null,
      }).select("*").single();
      if (error) throw error;
      setViajes((prev) => [{ ...(data as ViajeRow), facturas_compra: null }, ...prev]);
    } catch (e: any) {
      toast.error(`No se pudo sumar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  const editarViaje = async (v: ViajeRow, patch: Partial<ViajeRow>) => {
    if (!socId) return;
    if (v.factura_compra_id) { toast.error("Ese viaje ya está facturado y en Pagos; no se puede cambiar."); return; }
    setOcupado(v.id);
    try {
      const { error } = await (supabase as any).from("transportes").update(patch).eq("id", v.id).eq("sociedad_id", socId).is("factura_compra_id", null);
      if (error) throw error;
      setViajes((prev) => prev.map((x) => (x.id === v.id ? { ...x, ...patch } : x)));
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  // "−": cancela (no borra) el último viaje del mes sin facturar.
  const quitarViaje = async (clave: string) => {
    if (ocupado) return;
    const v = viajeParaQuitar(viajes, mes, clave, catalogo) as ViajeRow | null;
    if (!v) { toast.error("No hay viajes sin facturar para sacar en este mes."); return; }
    await editarViaje(v, { estado: "cancelado" });
  };

  const aplicarMontoGeneral = async (clave: string, nombre: string) => {
    if (!socId || ocupado) return;
    const monto = leerMonto(montoGeneral[clave] || "");
    if (monto == null) { toast.error("Escribí un monto válido"); return; }
    const ids = sinLiquidar(viajesDelMes(viajes, mes, clave, catalogo)).map((v) => v.id);
    if (!ids.length) { toast.error("No hay viajes sin facturar en este mes"); return; }
    if (!confirm(`¿Poner ${formatCurrency(monto, "ARS")} a los ${ids.length} viaje${ids.length > 1 ? "s" : ""} sin facturar de ${nombre} en ${nombreMes(mes)}? Pisa los montos que tengan.`)) return;
    setOcupado(`fila:${clave}`);
    try {
      const { error } = await (supabase as any).from("transportes").update({ costo: monto }).in("id", ids).eq("sociedad_id", socId).is("factura_compra_id", null);
      if (error) throw error;
      setViajes((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, costo: monto } : x)));
      setMontoGeneral((m) => ({ ...m, [clave]: "" }));
      toast.success(`${nombre}: ${ids.length} viaje${ids.length > 1 ? "s" : ""} a ${formatCurrency(monto, "ARS")}`);
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  const tildar = (id: string) => setSeleccion((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Liquidar: los tildados de ese transportista; si no hay tildados, todos los del mes sin facturar.
  const liquidar = (r: ResumenTransportista, moneda: string) => {
    const pendientes = r.pendientes as ViajeRow[];
    const tildados = abierto === r.clave ? pendientes.filter((v) => seleccion.has(v.id)) : [];
    openFacturaParaPagos(tildados.length ? tildados : pendientes.filter((v) => (v.moneda || "ARS") === moneda));
  };

  // ── Pagos ───────────────────────────────────────────────────────────
  const openFacturaParaPagos = (rows: ViajeRow[]) => {
    if (rows.length === 0) return;
    if (rows.some((row) => row.factura_compra_id)) {
      toast.error("Este viaje ya tiene una factura enviada a pagos");
      return;
    }
    const firstTransportista = claveViaje(rows[0], catalogo);
    if (rows.some((row) => claveViaje(row, catalogo) !== firstTransportista)) {
      toast.error("Solo podés agrupar viajes del mismo transportista");
      return;
    }
    if (rows.some((row) => row.moneda !== rows[0].moneda)) {
      toast.error("Los viajes agrupados deben tener la misma moneda");
      return;
    }

    const first = rows[0];
    const transportista = transportistas.find((item) => item.id === firstTransportista) || null;
    const normalizedName = (first.transportista || "").trim().toLowerCase();
    const proveedorSugerido = proveedores.find((proveedor) =>
      proveedor.id === transportista?.proveedor_id
      || (transportista?.cuit && proveedor.cuit?.replace(/\D/g, "") === transportista.cuit.replace(/\D/g, ""))
      || proveedor.razon_social.trim().toLowerCase() === normalizedName
    );
    const total = totalMontos(rows);

    setFacturaViajeIds(rows.map((row) => row.id));
    setFacturaFile(null);
    setFacturaEsInterna(true);
    setFacturaParsed(false);
    setFacturaParseError("");
    setFacturaForm({
      proveedor_id: proveedorSugerido?.id || "",
      tipo_comprobante: "FC A",
      numero_factura: "",
      fecha: todayAR(),
      fecha_vencimiento: "",
      cae: "",
      total: total > 0 ? String(total) : "",
      iva_porcentaje: "21",
      percepciones: "",
      moneda: first.moneda || "ARS",
      detalle: rows.length > 1
        ? `${rows.length} viajes de ${nombreMes(first.fecha.slice(0, 7))} — ${transportista?.nombre || first.transportista}`
        : `Viaje del ${formatDate(first.fecha)} — ${first.transportista}`,
      notas: "",
    });
    setFacturaProvSearch(proveedorSugerido?.razon_social || "");
    setFacturaProvDropdown(false);
    setShowFacturaViaje(true);
  };

  const handleEnviarFacturaAPagos = async () => {
    const total = Number(facturaForm.total);
    const ivaPorcentaje = Number(facturaForm.iva_porcentaje);
    const percepciones = Number(facturaForm.percepciones || 0);
    if (!facturaForm.proveedor_id) { toast.error("Seleccioná el proveedor que va a cobrar"); return; }
    if (!facturaEsInterna && !facturaForm.numero_factura.trim()) { toast.error("Ingresá el número de factura"); return; }
    if (!facturaEsInterna && !facturaFile) { toast.error("Adjuntá la factura en PDF o imagen"); return; }
    if (!total || total <= 0) { toast.error("Ingresá el total de la factura"); return; }
    if (!facturaEsInterna && (percepciones < 0 || percepciones > total)) { toast.error("Revisá el importe de percepciones"); return; }
    if (facturaViajeIds.length === 0 || !socId) return;

    const numeroComprobante = facturaEsInterna ? `MAN-TR-${Date.now()}` : facturaForm.numero_factura.trim();
    const porcentajeAplicado = facturaEsInterna ? 0 : ivaPorcentaje;
    const percepcionesAplicadas = facturaEsInterna ? 0 : percepciones;
    const totalAntesPercepciones = total - percepcionesAplicadas;
    const subtotal = porcentajeAplicado > 0 ? totalAntesPercepciones / (1 + porcentajeAplicado / 100) : totalAntesPercepciones;
    const iva = totalAntesPercepciones - subtotal;
    let createdFacturaId = "";
    let uploadedPath = "";
    setFacturaSaving(true);
    try {
      // Check FC duplicada
      const { data: existing } = await (supabase as any).from("facturas_compra")
        .select("id").eq("numero_factura", numeroComprobante).eq("proveedor_id", facturaForm.proveedor_id).eq("sociedad_id", socId).limit(1);
      if (existing?.length) { toast.error("Ya existe una factura con ese número para este proveedor"); setFacturaSaving(false); return; }
      const { data: factura, error: facturaError } = await (supabase as any)
        .from("facturas_compra")
        .insert({
          numero_factura: numeroComprobante,
          tipo_comprobante: facturaEsInterna ? "FC Manual" : facturaForm.tipo_comprobante,
          proveedor_id: facturaForm.proveedor_id,
          fecha: facturaForm.fecha,
          fecha_vencimiento: facturaEsInterna ? null : facturaForm.fecha_vencimiento || null,
          subtotal: Math.round(subtotal * 100) / 100,
          iva_porcentaje: porcentajeAplicado,
          iva: Math.round(iva * 100) / 100,
          percepciones: Math.round(percepcionesAplicadas * 100) / 100,
          total: Math.round(total * 100) / 100,
          moneda: facturaForm.moneda,
          notas: ["Factura de transporte", facturaEsInterna ? "Comprobante manual sin factura fiscal" : "", facturaForm.detalle, facturaForm.notas.trim()].filter(Boolean).join(" — "),
          cae: facturaEsInterna ? null : facturaForm.cae.trim() || null,
          estado: "pendiente",
          solo_iva: false,
          tipo: "transporte",
          sociedad_id: socId,
          created_by: profile?.id || null,
        })
        .select("id")
        .single();
      if (facturaError || !factura?.id) throw facturaError || new Error("No se pudo crear la factura");
      createdFacturaId = factura.id;

      if (!facturaEsInterna && facturaFile) {
        const extension = facturaFile.name.split(".").pop() || "pdf";
        uploadedPath = `${socId}/${createdFacturaId}/factura-transporte.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("facturas-compra")
          .upload(uploadedPath, facturaFile, { upsert: true });
        if (uploadError) throw uploadError;

        const urlData = { publicUrl: linkArchivo("facturas-compra", uploadedPath) };
        const { error: archivoError } = await (supabase as any)
          .from("facturas_compra")
          .update({ archivo_url: urlData.publicUrl, archivo_nombre: facturaFile.name })
          .eq("id", createdFacturaId)
          .eq("sociedad_id", socId);
        if (archivoError) throw archivoError;
      }

      const { error: linkError } = await (supabase as any)
        .from("transportes")
        .update({ factura_compra_id: createdFacturaId })
        .in("id", facturaViajeIds)
        .eq("sociedad_id", socId);
      if (linkError) throw linkError;

      toast.success(facturaEsInterna ? "Factura manual enviada a Finanzas y pendiente de pago" : "Factura enviada a Finanzas y pendiente de pago");
      setShowFacturaViaje(false);
      setFacturaViajeIds([]);
      setFacturaFile(null);
      setSeleccion(new Set());
      await fetchViajes();
    } catch (e: any) {
      if (createdFacturaId) {
        await (supabase as any).from("facturas_compra").delete().eq("id", createdFacturaId).eq("sociedad_id", socId);
      }
      if (uploadedPath) {
        await supabase.storage.from("facturas-compra").remove([uploadedPath]);
      }
      toast.error(`No se pudo enviar a pagos: ${e.message}`);
    } finally {
      setFacturaSaving(false);
    }
  };

  // ── Columnas del catálogo ───────────────────────────────────────────
  const guardarDestinos = async (t: TransportistaRow, texto: string) => {
    const valor = texto.trim();
    if (valor === (t.destinos || "")) return;
    const { error } = await (supabase as any).from("transportistas").update({ destinos: valor || null }).eq("id", t.id);
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setTransportistas((prev) => prev.map((x) => (x.id === t.id ? { ...x, destinos: valor || null } : x)));
    toast.success(`${t.nombre}: destinos guardados`);
  };

  const cambiarNoFactura = async (t: TransportistaRow, valor: boolean) => {
    const { error } = await (supabase as any).from("transportistas").update({ no_factura: valor }).eq("id", t.id);
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setTransportistas((prev) => prev.map((x) => (x.id === t.id ? { ...x, no_factura: valor } : x)));
    toast.success(valor ? `${t.nombre}: No nos factura (se le crea factura manual)` : `${t.nombre}: Sí nos factura (se carga en Compras)`);
  };

  const transportistaColumns = [
    { key: "nombre" as const, label: "Nombre", sortable: true, render: (t: TransportistaRow) => (
      <span className="font-medium">{t.nombre}</span>
    )},
    { key: "cuit" as const, label: "CUIT", render: (t: TransportistaRow) => t.cuit || "—" },
    { key: "telefono" as const, label: "Teléfono", render: (t: TransportistaRow) => (t.telefono ? mostrarWhatsApp(t.telefono) : "—") },
    { key: "precio_viaje_fijo" as const, label: "$ fijo por viaje", render: (t: TransportistaRow) => t.precio_viaje_fijo != null ? formatCurrency(t.precio_viaje_fijo, "ARS") : "—" },
    { key: "destinos" as const, label: "Destinos", render: (t: TransportistaRow) => (
      <input
        key={`${t.id}:${t.destinos || ""}`}
        defaultValue={t.destinos || ""}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => guardarDestinos(t, e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Ej: Córdoba, Rosario"
        className="w-52 rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-zinc-300 focus:border-orange-500 focus:bg-white focus:outline-none dark:hover:border-zinc-600 dark:focus:bg-zinc-800"
      />
    )},
    { key: "no_factura" as const, label: "¿Nos factura?", render: (t: TransportistaRow) => (
      <div className="w-24" onClick={(e) => e.stopPropagation()} title="No: no nos hace factura, se le crea una factura manual desde Transportes. Sí: su factura se carga en Compras">
        <Select
          value={t.no_factura ? "no" : "si"}
          onChange={(e) => cambiarNoFactura(t, e.target.value === "no")}
          options={[{ value: "si", label: "Sí" }, { value: "no", label: "No" }]}
        />
      </div>
    )},
    { key: "activo" as const, label: "Estado", render: (t: TransportistaRow) => (
      <Badge variant={t.activo ? "success" : "outline"}>{t.activo ? "Activo" : "Inactivo"}</Badge>
    )},
  ];

  // ── Render ──────────────────────────────────────────────────────────
  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
  const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";
  const celda = "rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-zinc-300 focus:border-orange-500 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:hover:border-transparent dark:hover:border-zinc-600 dark:focus:bg-zinc-800";
  const botonMas = "flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";
  const mesActual = hoy.slice(0, 7);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header
        title="Transportes"
        subtitle="Contador de viajes por transportista"
        action={activeTab === "catalogo" ? { label: "Nuevo transportista", onClick: () => { window.location.href = "/proveedores?crear=&tipo=transportista"; } } : { label: "Cargar factura", onClick: () => setCargandoFactura(true) }}
      />

      <main className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        {/* ── Tabs ── */}
        <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          <button
            onClick={() => { setActiveTab("viajes"); setSelectedTransportista(null); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === "viajes" ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
          >
            <span className="flex items-center gap-2"><Package size={16} /> Viajes</span>
          </button>
          <button
            onClick={() => setActiveTab("catalogo")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === "catalogo" ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
          >
            <span className="flex items-center gap-2"><Building2 size={16} /> Catálogo transportistas</span>
          </button>
          <button
            onClick={() => setActiveTab("facturas")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === "facturas" ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
          >
            <span className="flex items-center gap-2"><Receipt size={16} /> Facturas</span>
          </button>
        </div>

        {activeTab === "viajes" && (loadingViajes && viajes.length === 0 ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-orange-500" size={32} /></div>
        ) : (
          <Card className="p-0">
            {/* ── Mes ── */}
            <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <button onClick={() => setMes((m) => sumarMeses(m, -1))} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Mes anterior"><ChevronLeft size={16} /></button>
              <span className="w-36 text-center text-sm font-semibold capitalize text-zinc-900 dark:text-white">{nombreMes(mes)}</span>
              <button onClick={() => setMes((m) => sumarMeses(m, 1))} disabled={mes >= mesActual} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label="Mes siguiente"><ChevronRight size={16} /></button>
              {mes !== mesActual && <button onClick={() => setMes(mesActual)} className="rounded px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30">Este mes</button>}
              <span className="ml-auto text-xs text-zinc-500">{totalViajesMes} viaje{totalViajesMes === 1 ? "" : "s"} · {formatCurrency(totalMesARS, "ARS")}</span>
            </div>

            {filas.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-zinc-400">No hay transportistas. Cargalos en Proveedores y tildá &quot;Transporte&quot;.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                      <th className="px-3 py-1.5 text-left font-medium">Transportista</th>
                      <th className="px-2 py-1.5 text-center font-medium">Viajes</th>
                      <th className="px-2 py-1.5 text-left font-medium" title="Pone ese monto a todos sus viajes del mes sin facturar (pisa lo que tengan)">$ a todos</th>
                      <th className="px-2 py-1.5 text-right font-medium">Total</th>
                      <th className="px-3 py-1.5 text-right font-medium">Factura manual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map(({ r, moneda, facturado }) => {
                      const enCatalogo = transportistas.some((t) => t.id === r.clave);
                      const noFactura = Boolean(transportistas.find((t) => t.id === r.clave)?.no_factura);
                      const esAbierto = abierto === r.clave;
                      const tildados = esAbierto ? r.pendientes.filter((v) => seleccion.has(v.id)) : [];
                      const aLiquidar = tildados.length ? tildados : r.pendientes;
                      const filaOcupada = ocupado === `fila:${r.clave}`;
                      if (facturado) return (
                        <tr key={`${r.clave}-${moneda}-facturado`} className="border-b border-zinc-100 dark:border-zinc-800">
                          <td className="px-3 py-1 pl-[30px] font-medium text-zinc-900 dark:text-white">{r.nombre}{moneda === "USD" && <span className="text-[11px] text-zinc-400"> (US$)</span>}</td>
                          <td className="px-2 py-1 text-center text-base font-semibold tabular-nums text-zinc-900 dark:text-white">{r.viajes}</td>
                          <td className="px-2 py-1"><span className="text-xs text-zinc-300 dark:text-zinc-600">—</span></td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(r.total, moneda)}</td>
                          <td className="px-3 py-1 text-right"><span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Facturado</span></td>
                        </tr>
                      );
                      return (
                        <Fragment key={`${r.clave}-${moneda}`}>
                          <tr className={`border-b border-zinc-100 dark:border-zinc-800 ${esAbierto ? "bg-orange-50/40 dark:bg-orange-950/10" : ""}`}>
                            <td className="px-3 py-1">
                              <button onClick={() => setAbierto(esAbierto ? null : r.clave)} className="flex items-center gap-1 text-left font-medium text-zinc-900 hover:text-orange-600 dark:text-white" title="Ver sus viajes del mes">
                                <ChevronDown size={13} className={`shrink-0 text-zinc-400 transition-transform ${esAbierto ? "" : "-rotate-90"}`} />
                                {r.nombre}{moneda === "USD" && <span className="text-[11px] text-zinc-400"> (US$)</span>}
                              </button>
                              {noFactura && r.sinMonto > 0 && (
                                <div className="pl-[18px] text-[11px] text-zinc-400">
                                  {r.sinMonto > 0 && <span className="text-amber-600">{r.sinMonto} sin monto</span>}
                                  
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              <div className="flex items-center justify-center gap-1.5">
                                <button onClick={() => quitarViaje(r.clave)} disabled={!!ocupado || r.pendientes.length === 0} className={botonMas} aria-label="Sacar el último viaje"><Minus size={13} /></button>
                                <span className="w-7 text-center text-base font-semibold tabular-nums text-zinc-900 dark:text-white">{r.viajes}</span>
                                <button onClick={() => sumarViaje(r.clave)} disabled={!!ocupado || !enCatalogo || moneda === "USD"} className={botonMas} aria-label="Sumar un viaje">
                                  {filaOcupada ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                                </button>
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              {noFactura && moneda === "ARS" && r.pendientes.length > 0 ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    value={montoGeneral[r.clave] || ""}
                                    onChange={(e) => setMontoGeneral((m) => ({ ...m, [r.clave]: e.target.value }))}
                                    onKeyDown={(e) => { if (e.key === "Enter") aplicarMontoGeneral(r.clave, r.nombre); }}
                                    placeholder="$"
                                    inputMode="decimal"
                                    className="w-20 rounded border border-zinc-300 px-1.5 py-1 text-right text-xs focus:border-orange-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                  />
                                  {(montoGeneral[r.clave] || "").trim() && (
                                    <button onClick={() => aplicarMontoGeneral(r.clave, r.nombre)} disabled={!!ocupado} className="rounded px-1.5 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30">Poner</button>
                                  )}
                                </div>
                              ) : <span className="text-xs text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{noFactura && r.viajes > 0 ? formatCurrency(r.total, moneda) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}</td>
                            <td className="px-3 py-1 text-right">
                              {r.pendientes.length > 0 && noFactura ? (
                                <button
                                  onClick={() => liquidar(r, moneda)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                                  title={tildados.length ? `Crear la factura manual con los ${tildados.length} tildados` : "Crear la factura manual con todos los del mes (o abrí y tildá los que quieras)"}
                                >
                                  <Receipt size={13} /> {tildados.length ? `${tildados.length} tildado${tildados.length > 1 ? "s" : ""}` : "Todo"} · {formatCurrency(totalMontos(aLiquidar), moneda)}
                                </button>
                              ) : null}
                            </td>
                          </tr>

                          {/* ── Viajes del mes de ese transportista ── */}
                          {esAbierto && (
                            <tr className="border-b border-zinc-200 dark:border-zinc-700">
                              <td colSpan={5} className="bg-zinc-50/60 px-3 py-2 dark:bg-zinc-900/40">
                                {viajesAbiertos.length === 0 ? (
                                  <p className="py-2 text-center text-xs text-zinc-400">Sin viajes en {nombreMes(mes)}. Sumalos con el +.</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-[11px] text-zinc-400">
                                        <th className="w-6" />
                                        <th className="px-1 py-1 text-left font-medium">Fecha</th>
                                        <th className="px-1 py-1 text-right font-medium">Monto</th>
                                        <th className="px-1 py-1 text-left font-medium">Nota</th>
                                        <th className="px-1 py-1 text-left font-medium">Factura</th>
                                        <th className="w-7" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {viajesAbiertos.map((v) => {
                                        const trabado = !!v.factura_compra_id;
                                        const cancelado = !vigente(v);
                                        const extra = v.destino && v.destino !== "Interno" ? v.destino : "";
                                        return (
                                          <tr key={v.id} className={cancelado ? "opacity-50" : ""}>
                                            <td className="px-1 py-0.5 text-center">
                                              {noFactura && !trabado && !cancelado && (
                                                <input type="checkbox" checked={seleccion.has(v.id)} onChange={() => tildar(v.id)} className="accent-orange-600" aria-label="Tildar para facturar" />
                                              )}
                                            </td>
                                            <td className="px-1 py-0.5">
                                              <input type="date" key={`f-${v.fecha}`} defaultValue={v.fecha} disabled={trabado || cancelado} onBlur={(e) => e.target.value && e.target.value !== v.fecha && editarViaje(v, { fecha: e.target.value })} className={`${celda} w-[118px]`} />
                                            </td>
                                            <td className="px-1 py-0.5 text-right">
                                              {!noFactura ? <span className="text-[11px] text-zinc-300 dark:text-zinc-600">—</span> : <input
                                                key={`c-${v.costo ?? ""}`}
                                                defaultValue={v.costo ?? ""}
                                                disabled={trabado || cancelado}
                                                placeholder="sin monto"
                                                inputMode="decimal"
                                                onBlur={(e) => {
                                                  const n = leerMonto(e.target.value);
                                                  if (n === undefined) { toast.error("Monto inválido"); return; }
                                                  if (n !== (v.costo != null ? Number(v.costo) : null)) editarViaje(v, { costo: n });
                                                }}
                                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                                className={`${celda} w-24 text-right tabular-nums placeholder:text-zinc-300 dark:placeholder:text-zinc-600`}
                                              />}
                                            </td>
                                            <td className="px-1 py-0.5">
                                              <input
                                                key={`n-${v.notas ?? ""}`}
                                                defaultValue={v.notas || ""}
                                                disabled={trabado || cancelado}
                                                placeholder="nota"
                                                onBlur={(e) => { const t = e.target.value.trim(); if (t !== (v.notas || "")) editarViaje(v, { notas: t || null }); }}
                                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                                className={`${celda} w-full min-w-[140px] placeholder:text-zinc-300 dark:placeholder:text-zinc-600`}
                                              />
                                              {extra && <div className="truncate px-1.5 text-[11px] text-zinc-400">{extra}</div>}
                                            </td>
                                            <td className="px-1 py-0.5 whitespace-nowrap">
                                              {trabado ? (
                                                <button onClick={() => v.facturas_compra?.archivo_url && window.open(v.facturas_compra.archivo_url, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700" title="Facturado y enviado a Pagos">
                                                  <CheckCircle2 size={12} /> {v.facturas_compra?.numero_factura || "En pagos"}
                                                </button>
                                              ) : cancelado ? <span className="text-[11px] text-red-500">cancelado</span> : <span className="text-[11px] text-zinc-300 dark:text-zinc-600">—</span>}
                                            </td>
                                            <td className="px-1 py-0.5 text-right">
                                              {!trabado && (cancelado ? (
                                                <button onClick={() => editarViaje(v, { estado: "entregado" })} disabled={ocupado === v.id} className="rounded p-1 text-zinc-400 hover:text-emerald-600" title="Volver a sumar"><RotateCcw size={13} /></button>
                                              ) : (
                                                <button onClick={() => editarViaje(v, { estado: "cancelado" })} disabled={ocupado === v.id} className="rounded p-1 text-zinc-300 hover:text-red-600 dark:text-zinc-600" title="Cancelar este viaje (no se borra)"><X size={13} /></button>
                                              ))}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                                <label className="mt-1 flex w-fit items-center gap-1 text-[11px] text-zinc-400"><input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> Ver cancelados</label>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}


        {/* ══════════════════════════════════════════════════════════════════
            TAB: CATÁLOGO TRANSPORTISTAS
           ══════════════════════════════════════════════════════════════════ */}
        {activeTab === "facturas" && socId && <TransportesFacturas key={facturasKey} socId={socId} />}

        {cargandoFactura && socId && (
          <ComprasLazzaFactura sociedadId={socId} tipoInicial="transporte" onClose={() => setCargandoFactura(false)}
            onGuardada={async () => { setFacturasKey((k) => k + 1); }} />
        )}

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
                    description="Marcá un proveedor como transportista para que aparezca automáticamente acá"
                  />
                ) : (
                  <>
                    <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
                      <input
                        value={busquedaCatalogo}
                        onChange={(e) => setBusquedaCatalogo(e.target.value)}
                        placeholder="Buscar por nombre o destino (ej: córdoba)"
                        className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      />
                    </div>
                  <DataTable
                    columns={transportistaColumns}
                    data={filtrarPorNombreODestino(transportistas, busquedaCatalogo)}
                    onRowClick={(t) => setSelectedTransportista(t.id === selectedTransportista?.id ? null : t)}
                  />
                  </>
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
                    {selectedTransportista.telefono && <DetailRow icon={Phone} label="Teléfono" value={mostrarWhatsApp(selectedTransportista.telefono)} />}
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

                    {/* La ficha maestra se administra desde Proveedores. */}
                    <div className="flex gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-700">
                      <button
                        onClick={() => { window.location.href = "/proveedores"; }}
                        className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        <Building2 size={14} /> Abrir ficha en Proveedores
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
          MODAL: FACTURA DE TRANSPORTE → FINANZAS / PAGOS
         ══════════════════════════════════════════════════════════════════ */}
      {showFacturaViaje && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl dark:bg-zinc-900 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Crear factura manual</h2>
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
                <div className="relative">
                  <input
                    type="text"
                    value={facturaProvSearch}
                    onChange={(e) => { setFacturaProvSearch(e.target.value); setFacturaProvDropdown(true); if (facturaForm.proveedor_id) setFacturaForm((form) => ({ ...form, proveedor_id: "" })); }}
                    onFocus={() => setFacturaProvDropdown(true)}
                    onBlur={() => setTimeout(() => setFacturaProvDropdown(false), 150)}
                    placeholder="Buscar proveedor..."
                    className={inputClass}
                  />
                  {facturaForm.proveedor_id && (
                    <button type="button" onClick={() => { setFacturaForm((form) => ({ ...form, proveedor_id: "" })); setFacturaProvSearch(""); }} className="absolute right-2 top-2.5 text-zinc-400 hover:text-zinc-600">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {facturaProvDropdown && (
                    <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                      {proveedores.filter(p => p.razon_social.toLowerCase().includes(facturaProvSearch.toLowerCase())).slice(0, 20).map((p) => (
                        <button key={p.id} type="button" onClick={() => { setFacturaForm((form) => ({ ...form, proveedor_id: p.id })); setFacturaProvSearch(p.razon_social); setFacturaProvDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-orange-50 dark:hover:bg-zinc-700">
                          {p.razon_social}
                        </button>
                      ))}
                      {proveedores.filter(p => p.razon_social.toLowerCase().includes(facturaProvSearch.toLowerCase())).length === 0 && (
                        <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-400">Es quien aparecerá después para generar la orden de pago.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {!facturaEsInterna && (
                  <>
                    <div>
                      <label className={labelClass}>Tipo de comprobante *</label>
                      <select
                        value={facturaForm.tipo_comprobante}
                        onChange={(e) => setFacturaForm((form) => ({ ...form, tipo_comprobante: e.target.value }))}
                        className={inputClass}
                      >
                        <option value="FC A">FC A</option>
                        <option value="FC B">FC B</option>
                        <option value="FC C">FC C</option>
                        <option value="ND A">ND A</option>
                        <option value="ND B">ND B</option>
                        <option value="NC A">NC A</option>
                        <option value="NC B">NC B</option>
                        <option value="Recibo">Recibo</option>
                        <option value="Otro">Otro</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Número de factura *</label>
                      <input
                        value={facturaForm.numero_factura}
                        onChange={(e) => setFacturaForm((form) => ({ ...form, numero_factura: e.target.value }))}
                        placeholder="Ej: 0001-00001234"
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className={labelClass}>Fecha *</label>
                  <input
                    type="date"
                    value={facturaForm.fecha}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, fecha: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                {!facturaEsInterna && (
                  <>
                    <div>
                      <label className={labelClass}>Vencimiento</label>
                      <input type="date" value={facturaForm.fecha_vencimiento} onChange={(e) => setFacturaForm((form) => ({ ...form, fecha_vencimiento: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>CAE</label>
                      <input value={facturaForm.cae} onChange={(e) => setFacturaForm((form) => ({ ...form, cae: e.target.value }))} className={inputClass} />
                    </div>
                  </>
                )}
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
                {!facturaEsInterna && <div className="col-span-2">
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
                </div>}
                {!facturaEsInterna && <div>
                  <label className={labelClass}>Percepciones</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={facturaForm.percepciones}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, percepciones: e.target.value }))}
                    placeholder="0,00"
                    className={inputClass}
                  />
                </div>}
                <div>
                  <label className={labelClass}>Observaciones</label>
                  <input
                    value={facturaForm.notas}
                    onChange={(e) => setFacturaForm((form) => ({ ...form, notas: e.target.value }))}
                    placeholder="Opcional"
                    className={inputClass}
                  />
                </div>
              </div>

              {!facturaEsInterna && Number(facturaForm.total) > 0 && (
                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Neto estimado: <span className="font-mono font-semibold">{formatCurrency(
                    (Number(facturaForm.total) - Number(facturaForm.percepciones || 0)) / (1 + Number(facturaForm.iva_porcentaje) / 100),
                    facturaForm.moneda as "ARS" | "USD"
                  )}</span>
                  <span className="mx-2 text-zinc-300">|</span>
                  IVA: <span className="font-mono font-semibold">{formatCurrency(
                    (Number(facturaForm.total) - Number(facturaForm.percepciones || 0))
                      - ((Number(facturaForm.total) - Number(facturaForm.percepciones || 0)) / (1 + Number(facturaForm.iva_porcentaje) / 100)),
                    facturaForm.moneda as "ARS" | "USD"
                  )}</span>
                  {Number(facturaForm.percepciones || 0) > 0 && (
                    <><span className="mx-2 text-zinc-300">|</span>Percepciones: <span className="font-mono font-semibold">{formatCurrency(Number(facturaForm.percepciones), facturaForm.moneda as "ARS" | "USD")}</span></>
                  )}
                </div>
              )}

              {!facturaEsInterna ? <div>
                <label className={labelClass}>Adjuntar y leer factura *</label>
                <div>
                  <label className={`flex items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-sm transition-colors ${facturaParsing ? "cursor-wait border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/20" : "cursor-pointer border-zinc-300 text-zinc-600 hover:border-orange-400 hover:bg-orange-50/50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-orange-950/20"}`}>
                    <Upload size={18} className="text-orange-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{facturaFile?.name || "Seleccionar PDF o imagen"}</span>
                      <span className="block text-xs text-zinc-400">{facturaParsing ? "Leyendo datos con IA..." : facturaFile ? "Elegí otro archivo para reemplazarlo y volver a leer" : "Al adjuntarla se completa el formulario automáticamente"}</span>
                    </span>
                    {facturaParsing && <Loader2 size={16} className="animate-spin" />}
                    <input
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={facturaParsing}
                      onChange={(e) => { const file = e.target.files?.[0]; if (file) handleParseFactura(file); e.target.value = ""; }}
                    />
                  </label>
                  {facturaParsed && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 dark:bg-green-950/30 dark:text-green-300">
                      <CheckCircle2 size={14} /> Factura leída. Revisá y corregí cualquier dato antes de enviarla.
                    </div>
                  )}
                  {facturaParseError && (
                    <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                      No se pudo leer automáticamente: {facturaParseError}. El archivo quedó adjunto y podés completar el formulario manualmente.
                    </div>
                  )}
                </div>
              </div> : (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                  El sistema generará una factura manual interna, sin PDF, número fiscal, IVA ni CAE, y la enviará a Finanzas para crear la orden de pago. No reemplaza una factura fiscal.
                </div>
              )}
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
