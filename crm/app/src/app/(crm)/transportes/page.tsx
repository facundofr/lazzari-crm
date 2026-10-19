"use client";

// Transportes: anotador interno de viajes (19/10/2026, pedido de Augusto).
// - Viajes del día: − / + por transportista (cada + es un viaje). Los de "¿Quién lo lleva?" del remito entran solos con la leyenda "Remito".
// - Resumen del mes con "Liquidar" (manda a Pagos con factura o liquidación interna) y precio fijo por viaje (ej. Álvarez).
// - Historial: todo editable, con filtros; vista Lista o Grilla del mes. No tiene que coincidir nada: es un control nuestro.
// Lógica pura en lib/transportes-anotador.ts.

import { Header } from "@/components/layout/header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import {
  Truck, Minus, Plus, X, Loader2, CheckCircle2, Building2,
  MapPin, Phone, Mail, User, Package, Hash, Upload, Receipt,
  ChevronLeft, ChevronRight, List, LayoutGrid, RotateCcw, Ban,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useUser } from "@/lib/auth-context";
import { formatDate, formatCurrency, todayAR } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { traerTodo } from "@/lib/paginar";
import {
  claveViaje, precioViaje, ultimoPrecio, conteoDelDia, viajeParaQuitar, resumenMes, grillaMes, diasDelMes,
  filtrarHistorial, sumarDias, esDeRemito, esPropio, vigente, type FiltrosHistorial,
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

const VISTA_KEY = "transportes.vista";
const primeroDelMes = (f: string) => `${f.slice(0, 7)}-01`;
const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
const diaSemana = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString("es-AR", { weekday: "short" });

// ── Componente principal ──────────────────────────────────────────────

export default function TransportesPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const socId = sociedadActiva?.id;

  const [activeTab, setActiveTab] = useState<"viajes" | "catalogo">("viajes");

  // ─── Datos ───
  const [viajes, setViajes] = useState<ViajeRow[]>([]);
  const [loadingViajes, setLoadingViajes] = useState(true);
  const [transportistas, setTransportistas] = useState<TransportistaRow[]>([]);
  const [loadingTransportistas, setLoadingTransportistas] = useState(false);
  const [selectedTransportista, setSelectedTransportista] = useState<TransportistaRow | null>(null);
  const [clienteNombre, setClienteNombre] = useState<Map<string, string>>(new Map());
  const [remitoNumero, setRemitoNumero] = useState<Map<string, string>>(new Map());
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // ─── Anotador ───
  const [dia, setDia] = useState(() => todayAR());
  const [mes, setMes] = useState(() => todayAR().slice(0, 7));
  const [vista, setVista] = useState<"lista" | "grilla">("lista");
  const [filtros, setFiltros] = useState<FiltrosHistorial>(() => ({ clave: "", desde: primeroDelMes(todayAR()), hasta: "", origen: "", liquidado: "", verCancelados: false, texto: "" }));
  const [limite, setLimite] = useState(100);

  useEffect(() => {
    try { const v = localStorage.getItem(VISTA_KEY); if (v === "grilla" || v === "lista") setVista(v); } catch { /* sin storage */ }
  }, []);
  const cambiarVista = (v: "lista" | "grilla") => {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* sin storage */ }
  };

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

      const ids = (campo: "factura_compra_id" | "cliente_id" | "remito_id") => [...new Set(rows.map((r) => r[campo]).filter(Boolean))] as string[];
      const enTandas = async (tabla: string, campos: string, lista: string[]) => {
        const out: any[] = [];
        for (let i = 0; i < lista.length; i += 150) {
          const { data, error } = await (supabase as any).from(tabla).select(campos).in("id", lista.slice(i, i + 150));
          if (error) throw error;
          out.push(...(data || []));
        }
        return out;
      };
      const [facturas, clis, rems] = await Promise.all([
        enTandas("facturas_compra", "id, numero_factura, archivo_url, estado", ids("factura_compra_id")),
        enTandas("clientes", "id, razon_social", ids("cliente_id")),
        enTandas("remitos", "id, numero", ids("remito_id")),
      ]);
      const facturasMap = new Map(facturas.map((f: any) => [f.id, f]));
      setClienteNombre(new Map(clis.map((c: any) => [c.id, c.razon_social])));
      setRemitoNumero(new Map(rems.map((r: any) => [r.id, r.numero])));
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
  const activos = useMemo(() => transportistas.filter((t) => t.activo), [transportistas]);
  const nombreDeClave = useCallback((clave: string) => {
    const t = transportistas.find((x) => x.id === clave);
    if (t) return t.nombre;
    const v = viajes.find((x) => claveViaje(x, transportistas) === clave);
    return v?.transportista || clave.replace(/^n:/, "");
  }, [transportistas, viajes]);
  const fijoDe = useCallback((clave: string) => transportistas.find((t) => t.id === clave)?.precio_viaje_fijo ?? null, [transportistas]);

  const conteoHoy = useMemo(() => conteoDelDia(viajes, dia, catalogo), [viajes, dia, catalogo]);
  // Renglones del anotador: los activos del catálogo + cualquiera que tenga viajes ese día.
  const filasDia = useMemo(() => {
    const claves = activos.map((t) => t.id);
    for (const k of conteoHoy.keys()) if (!claves.includes(k)) claves.push(k);
    return claves;
  }, [activos, conteoHoy]);
  const totalDia = useMemo(() => [...conteoHoy.values()].reduce((s, c) => s + c.anotados + c.remito, 0), [conteoHoy]);

  const resumen = useMemo(() => resumenMes(viajes, mes, catalogo), [viajes, mes, catalogo]);
  const resumenUSD = useMemo(() => resumenMes(viajes, mes, catalogo, "USD"), [viajes, mes, catalogo]);
  const grilla = useMemo(() => grillaMes(viajes, mes, catalogo), [viajes, mes, catalogo]);

  const textoExtra = useCallback((v: ViajeRow) => [v.cliente_id ? clienteNombre.get(v.cliente_id) : "", v.remito_id ? remitoNumero.get(v.remito_id) : "", v.transportista_id ? nombreDeClave(v.transportista_id) : ""].join(" "), [clienteNombre, remitoNumero, nombreDeClave]);
  const historial = useMemo(() => filtrarHistorial(viajes, filtros, catalogo, textoExtra as any) as ViajeRow[], [viajes, filtros, catalogo, textoExtra]);
  const totalHistorial = useMemo(() => historial.filter((v) => vigente(v) && !esPropio(v)).reduce((s, v) => s + (precioViaje(v, fijoDe(claveViaje(v, catalogo))) || 0), 0), [historial, fijoDe, catalogo]);

  const opcionesTransportista = useMemo(() => {
    const ops = activos.map((t) => ({ value: t.id, label: t.nombre }));
    for (const r of resumen) if (!ops.some((o) => o.value === r.clave)) ops.push({ value: r.clave, label: r.nombre });
    return ops;
  }, [activos, resumen]);

  // ── Acciones del anotador ───────────────────────────────────────────
  const sumarViaje = async (clave: string) => {
    if (!socId || ocupado) return;
    const t = transportistas.find((x) => x.id === clave);
    if (!t) { toast.error("Ese transportista no está en el catálogo. Cargalo en Proveedores y tildá \"Transporte\"."); return; }
    const anterior = viajes.find((v) => !esDeRemito(v) && claveViaje(v, catalogo) === clave);
    setOcupado(`dia:${clave}`);
    try {
      const { data, error } = await (supabase as any).from("transportes").insert({
        sociedad_id: socId,
        fecha: dia,
        tipo: anterior?.tipo === "interno" ? "interno" : "externo",
        transportista: t.nombre,
        transportista_id: t.id,
        cliente_id: null,
        remito_id: null,
        destino: "",
        costo: t.precio_viaje_fijo ?? null,
        moneda: "ARS",
        estado: "entregado",
        created_by: profile?.id || null,
      }).select("*").single();
      if (error) throw error;
      setViajes((prev) => [{ ...(data as ViajeRow), facturas_compra: null }, ...prev]);
      const deRemito = conteoHoy.get(clave)?.remito || 0;
      if (deRemito > 0) toast.warning(`Anotado. Ojo: ese día ya hay ${deRemito} viaje${deRemito > 1 ? "s" : ""} de remito de ${t.nombre}.`);
    } catch (e: any) {
      toast.error(`No se pudo anotar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  const quitarViaje = async (clave: string) => {
    if (!socId || ocupado) return;
    const { id, motivo } = viajeParaQuitar(viajes, dia, clave, catalogo);
    if (!id) { toast.error(motivo || "No hay viaje para quitar"); return; }
    setOcupado(`dia:${clave}`);
    try {
      const { error } = await (supabase as any).from("transportes").delete().eq("id", id).eq("sociedad_id", socId).is("factura_compra_id", null);
      if (error) throw error;
      setViajes((prev) => prev.filter((v) => v.id !== id));
    } catch (e: any) {
      toast.error(`No se pudo quitar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  // ── Edición del historial (todo editable salvo lo liquidado) ─────────
  const editarViaje = async (v: ViajeRow, patch: Partial<ViajeRow>) => {
    if (!socId) return;
    if (v.factura_compra_id) { toast.error("Ese viaje ya se liquidó y está en Pagos; no se puede cambiar."); return; }
    setOcupado(v.id);
    try {
      const { error } = await (supabase as any).from("transportes").update(patch).eq("id", v.id).eq("sociedad_id", socId);
      if (error) throw error;
      setViajes((prev) => prev.map((x) => (x.id === v.id ? { ...x, ...patch } : x)));
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e.message}`);
    } finally {
      setOcupado(null);
    }
  };

  const cambiarTransportistaViaje = (v: ViajeRow, clave: string) => {
    const t = transportistas.find((x) => x.id === clave);
    if (!t) return;
    editarViaje(v, { transportista_id: t.id, transportista: t.nombre });
  };

  const cancelarViaje = (v: ViajeRow) => {
    if (!confirm(esDeRemito(v)
      ? "¿Sacar este viaje de la cuenta? Queda como cancelado (no se borra). Si el remito ya no lo lleva este transportista, mejor cambialo en el remito."
      : "¿Sacar este viaje de la cuenta? Queda como cancelado (no se borra) y lo podés volver a sumar.")) return;
    editarViaje(v, { estado: "cancelado" });
  };

  const guardarPrecioFijo = async (clave: string, texto: string) => {
    const t = transportistas.find((x) => x.id === clave);
    if (!t) return;
    const valor = texto.trim() === "" ? null : Number(texto.replace(/\./g, "").replace(",", "."));
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) { toast.error("Precio inválido"); return; }
    if ((t.precio_viaje_fijo ?? null) === valor) return;
    const { error } = await (supabase as any).from("transportistas").update({ precio_viaje_fijo: valor }).eq("id", t.id);
    if (error) {
      toast.error(/precio_viaje_fijo/.test(error.message || "") ? "Falta correr la migración del precio fijo (avisale a Claude)." : `No se pudo guardar: ${error.message}`);
      return;
    }
    setTransportistas((prev) => prev.map((x) => (x.id === t.id ? { ...x, precio_viaje_fijo: valor } : x)));
    toast.success(valor === null ? `${t.nombre}: sin precio fijo` : `${t.nombre}: ${formatCurrency(valor, "ARS")} por viaje`);
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
    const fijo = transportista?.precio_viaje_fijo ?? null;
    const total = rows.reduce((sum, row) => sum + (precioViaje(row, fijo) || 0), 0);

    setFacturaViajeIds(rows.map((row) => row.id));
    setFacturaFile(null);
    setFacturaEsInterna(false);
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
          tipo: "mercaderia",
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

        const { data: urlData } = supabase.storage.from("facturas-compra").getPublicUrl(uploadedPath);
        const { error: archivoError } = await (supabase as any)
          .from("facturas_compra")
          .update({ archivo_url: urlData.publicUrl, archivo_nombre: facturaFile.name })
          .eq("id", createdFacturaId)
          .eq("sociedad_id", socId);
        if (archivoError) throw archivoError;
      }

      const viajesLiquidados = viajes.filter((v) => facturaViajeIds.includes(v.id));
      const fijoLiq = transportistas.find((t) => viajesLiquidados[0] && t.id === claveViaje(viajesLiquidados[0], catalogo))?.precio_viaje_fijo ?? null;
      const sinPrecio = viajesLiquidados.filter((v) => v.costo == null).map((v) => v.id);
      if (fijoLiq != null && sinPrecio.length) {
        const { error: fijoError } = await (supabase as any).from("transportes").update({ costo: fijoLiq }).in("id", sinPrecio).eq("sociedad_id", socId);
        if (fijoError) throw fijoError;
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
  const transportistaColumns = [
    { key: "nombre" as const, label: "Nombre", sortable: true, render: (t: TransportistaRow) => (
      <span className="font-medium">{t.nombre}</span>
    )},
    { key: "cuit" as const, label: "CUIT", render: (t: TransportistaRow) => t.cuit || "—" },
    { key: "telefono" as const, label: "Teléfono", render: (t: TransportistaRow) => t.telefono || "—" },
    { key: "precio_viaje_fijo" as const, label: "$ fijo por viaje", render: (t: TransportistaRow) => t.precio_viaje_fijo != null ? formatCurrency(t.precio_viaje_fijo, "ARS") : "—" },
    { key: "activo" as const, label: "Estado", render: (t: TransportistaRow) => (
      <Badge variant={t.activo ? "success" : "outline"}>{t.activo ? "Activo" : "Inactivo"}</Badge>
    )},
  ];

  // ── Render ──────────────────────────────────────────────────────────
  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white";
  const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1";
  const celda = "rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-zinc-300 focus:border-orange-500 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:hover:border-transparent dark:hover:border-zinc-600 dark:focus:bg-zinc-800";
  const botonMas = "flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800";
  const hoy = todayAR();
  const nDias = diasDelMes(mes);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header
        title="Transportes"
        subtitle="Anotador de viajes y transportistas"
        action={activeTab === "catalogo" ? { label: "Nuevo transportista", onClick: () => { window.location.href = "/proveedores?crear=&tipo=transportista"; } } : undefined}
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
        </div>

        {activeTab === "viajes" && (loadingViajes && viajes.length === 0 ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-orange-500" size={32} /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-5">
              {/* ── Viajes del día ── */}
              <Card className="p-0 lg:col-span-2">
                <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white mr-auto">Viajes del día</span>
                  <button onClick={() => setDia((d) => sumarDias(d, -1))} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Día anterior"><ChevronLeft size={16} /></button>
                  <input type="date" value={dia} max={hoy} onChange={(e) => e.target.value && setDia(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                  <span className="w-8 text-xs text-zinc-500">{diaSemana(dia)}</span>
                  <button onClick={() => setDia((d) => (d < hoy ? sumarDias(d, 1) : d))} disabled={dia >= hoy} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800" aria-label="Día siguiente"><ChevronRight size={16} /></button>
                  {dia !== hoy && <button onClick={() => setDia(hoy)} className="rounded px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30">Hoy</button>}
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filasDia.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-zinc-400">No hay transportistas. Cargalos en Proveedores y tildá &quot;Transporte&quot;.</p>
                  )}
                  {filasDia.map((clave) => {
                    const c = conteoHoy.get(clave) || { anotados: 0, remito: 0 };
                    const enCatalogo = transportistas.some((t) => t.id === clave);
                    return (
                      <div key={clave} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">{nombreDeClave(clave)}</span>
                        {c.remito > 0 && (
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" title="Viajes que salen de los remitos (ya cuentan)">
                            +{c.remito} de remito
                          </span>
                        )}
                        <button onClick={() => quitarViaje(clave)} disabled={!!ocupado || c.anotados === 0} className={botonMas} aria-label="Quitar viaje"><Minus size={14} /></button>
                        <span className="w-6 text-center text-base font-semibold tabular-nums text-zinc-900 dark:text-white">{c.anotados}</span>
                        <button onClick={() => sumarViaje(clave)} disabled={!!ocupado || !enCatalogo} className={botonMas} aria-label="Sumar viaje">
                          {ocupado === `dia:${clave}` ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-zinc-200 px-3 py-1.5 text-right text-xs text-zinc-500 dark:border-zinc-700">
                  {totalDia} viaje{totalDia === 1 ? "" : "s"} el {formatDate(dia)} · se guarda solo
                </div>
              </Card>

              {/* ── Resumen del mes ── */}
              <Card className="p-0 lg:col-span-3">
                <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white mr-auto">Resumen de {nombreMes(mes)}</span>
                  <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                </div>
                {resumen.length === 0 && resumenUSD.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-zinc-400">Sin viajes en {nombreMes(mes)}.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                          <th className="px-3 py-1.5 text-left font-medium">Transportista</th>
                          <th className="px-2 py-1.5 text-right font-medium">Viajes</th>
                          <th className="px-2 py-1.5 text-right font-medium" title="Si lo completás, los viajes sin precio valen esto">$ fijo x viaje</th>
                          <th className="px-2 py-1.5 text-right font-medium">Total</th>
                          <th className="px-3 py-1.5 text-right font-medium">A liquidar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...resumen.map((r) => ({ r, moneda: "ARS" as const })), ...resumenUSD.map((r) => ({ r, moneda: "USD" as const }))].map(({ r, moneda }) => {
                          const enCatalogo = transportistas.find((t) => t.id === r.clave);
                          return (
                            <tr key={`${r.clave}-${moneda}`} className="border-b border-zinc-100 dark:border-zinc-800">
                              <td className="px-3 py-1.5">
                                <button onClick={() => { setFiltros((f) => ({ ...f, clave: r.clave, desde: `${mes}-01`, hasta: `${mes}-${String(diasDelMes(mes)).padStart(2, "0")}` })); cambiarVista("lista"); }} className="text-left font-medium text-zinc-900 hover:text-orange-600 dark:text-white" title="Ver sus viajes en el historial">
                                  {r.nombre}
                                </button>
                                <div className="text-[11px] text-zinc-400">
                                  {r.deRemito > 0 && <span>{r.deRemito} de remito</span>}
                                  {r.sinPrecio > 0 && <span className="text-amber-600">{r.deRemito > 0 ? " · " : ""}{r.sinPrecio} sin precio</span>}
                                  {r.liquidados > 0 && <span className="text-emerald-600">{r.deRemito + r.sinPrecio > 0 ? " · " : ""}{r.liquidados} liquidado{r.liquidados > 1 ? "s" : ""}</span>}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{r.viajes}</td>
                              <td className="px-2 py-1.5 text-right">
                                {enCatalogo && moneda === "ARS" ? (
                                  <input
                                    key={`${r.clave}-${enCatalogo.precio_viaje_fijo ?? ""}`}
                                    defaultValue={enCatalogo.precio_viaje_fijo ?? ""}
                                    onBlur={(e) => guardarPrecioFijo(r.clave, e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    placeholder="—"
                                    inputMode="decimal"
                                    className={`${celda} w-20 text-right`}
                                  />
                                ) : <span className="text-xs text-zinc-400">—</span>}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.total, moneda)}</td>
                              <td className="px-3 py-1.5 text-right">
                                {r.pendientes.length > 0 ? (
                                  <button
                                    onClick={() => openFacturaParaPagos(r.pendientes as ViajeRow[])}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                                    title={`Mandar ${r.pendientes.length} viaje${r.pendientes.length > 1 ? "s" : ""} a Pagos`}
                                  >
                                    <Receipt size={13} /> Liquidar {r.totalPendiente > 0 ? formatCurrency(r.totalPendiente, moneda) : "(sin precio)"}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Liquidado</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {/* ── Historial / Grilla ── */}
            <Card className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
                <span className="text-sm font-semibold text-zinc-900 dark:text-white">{vista === "lista" ? "Historial de viajes" : `Grilla de ${nombreMes(mes)}`}</span>
                <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
                  <button onClick={() => cambiarVista("lista")} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${vista === "lista" ? "bg-white shadow text-zinc-900 dark:bg-zinc-700 dark:text-white" : "text-zinc-500"}`}><List size={13} /> Lista</button>
                  <button onClick={() => cambiarVista("grilla")} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${vista === "grilla" ? "bg-white shadow text-zinc-900 dark:bg-zinc-700 dark:text-white" : "text-zinc-500"}`}><LayoutGrid size={13} /> Grilla del mes</button>
                </div>
                {vista === "lista" && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <input value={filtros.texto || ""} onChange={(e) => setFiltros((f) => ({ ...f, texto: e.target.value }))} placeholder="Buscar cliente, remito, destino…" className="w-48 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                    <Select className="!w-40 !py-1 !text-xs" value={filtros.clave || ""} onChange={(e) => setFiltros((f) => ({ ...f, clave: e.target.value }))} options={[{ value: "", label: "Todos los transportistas" }, ...opcionesTransportista]} />
                    <input type="date" value={filtros.desde || ""} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" title="Desde" />
                    <input type="date" value={filtros.hasta || ""} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" title="Hasta" />
                    <Select className="!w-28 !py-1 !text-xs" value={filtros.origen || ""} onChange={(e) => setFiltros((f) => ({ ...f, origen: e.target.value as FiltrosHistorial["origen"] }))} options={[{ value: "", label: "Todos" }, { value: "anotado", label: "Anotados" }, { value: "remito", label: "De remito" }]} />
                    <Select className="!w-32 !py-1 !text-xs" value={filtros.liquidado || ""} onChange={(e) => setFiltros((f) => ({ ...f, liquidado: e.target.value as FiltrosHistorial["liquidado"] }))} options={[{ value: "", label: "Liquidados o no" }, { value: "no", label: "Sin liquidar" }, { value: "si", label: "Liquidados" }]} />
                    <label className="flex items-center gap-1 text-xs text-zinc-500"><input type="checkbox" checked={!!filtros.verCancelados} onChange={(e) => setFiltros((f) => ({ ...f, verCancelados: e.target.checked }))} /> Cancelados</label>
                    <button onClick={() => setFiltros({ clave: "", desde: "", hasta: "", origen: "", liquidado: "", verCancelados: false, texto: "" })} className="rounded px-1.5 py-1 text-xs text-zinc-500 hover:text-orange-600" title="Ver todo">Ver todo</button>
                  </div>
                )}
                {vista === "grilla" && (
                  <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="ml-auto rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                )}
              </div>

              {vista === "grilla" ? (
                grilla.size === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-zinc-400">Sin viajes en {nombreMes(mes)}.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                          <th className="sticky left-0 bg-zinc-50 px-3 py-1.5 text-left font-medium dark:bg-zinc-800">Transportista</th>
                          {Array.from({ length: nDias }, (_, i) => i + 1).map((d) => {
                            const f = `${mes}-${String(d).padStart(2, "0")}`;
                            const finde = [0, 6].includes(new Date(`${f}T12:00:00`).getDay());
                            return <th key={d} className={`w-7 px-0.5 py-1.5 text-center font-medium ${finde ? "text-zinc-300 dark:text-zinc-600" : ""} ${f === dia ? "text-orange-600" : ""}`}>{d}</th>;
                          })}
                          <th className="px-3 py-1.5 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...grilla.entries()].sort((a, b) => nombreDeClave(a[0]).localeCompare(nombreDeClave(b[0]))).map(([clave, dias]) => (
                          <tr key={clave} className="border-b border-zinc-100 dark:border-zinc-800">
                            <td className="sticky left-0 max-w-[180px] truncate bg-white px-3 py-1 font-medium text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">{nombreDeClave(clave)}</td>
                            {Array.from({ length: nDias }, (_, i) => i + 1).map((d) => {
                              const n = dias.get(d) || 0;
                              const f = `${mes}-${String(d).padStart(2, "0")}`;
                              return (
                                <td key={d} className="px-0.5 py-1 text-center">
                                  {n > 0 ? (
                                    <button onClick={() => { setDia(f); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="h-6 w-6 rounded bg-orange-100 font-semibold text-orange-800 hover:bg-orange-200 dark:bg-orange-950/40 dark:text-orange-300" title={`${formatDate(f)}: ${n} viaje${n > 1 ? "s" : ""}`}>{n}</button>
                                  ) : <span className="text-zinc-200 dark:text-zinc-700">·</span>}
                                </td>
                              );
                            })}
                            <td className="px-3 py-1 text-right font-semibold tabular-nums">{[...dias.values()].reduce((s, n) => s + n, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : historial.length === 0 ? (
                <EmptyState icon={Truck} title="Sin viajes" description="No hay viajes con esos filtros" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">
                        <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                        <th className="px-2 py-1.5 text-left font-medium">Transportista</th>
                        <th className="px-2 py-1.5 text-left font-medium">Origen</th>
                        <th className="px-2 py-1.5 text-right font-medium">Precio</th>
                        <th className="px-2 py-1.5 text-left font-medium">Destino / notas</th>
                        <th className="px-2 py-1.5 text-left font-medium">Liquidado</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {historial.slice(0, limite).map((v) => {
                        const clave = claveViaje(v, catalogo);
                        const fijo = fijoDe(clave);
                        const trabado = !!v.factura_compra_id;
                        const cancelado = !vigente(v);
                        const sugerido = fijo ?? ultimoPrecio(viajes, clave, catalogo);
                        const cliente = v.cliente_id ? clienteNombre.get(v.cliente_id) : null;
                        const extra = [cliente, v.descripcion_carga, v.bultos ? `${v.bultos} bultos` : null].filter(Boolean).join(" · ");
                        return (
                          <tr key={v.id} className={`border-b border-zinc-100 dark:border-zinc-800 ${cancelado ? "opacity-50" : ""}`}>
                            <td className="px-1 py-0.5">
                              <input type="date" key={`f-${v.fecha}`} defaultValue={v.fecha} disabled={trabado || cancelado} onBlur={(e) => e.target.value && e.target.value !== v.fecha && editarViaje(v, { fecha: e.target.value })} className={`${celda} w-[118px]`} />
                            </td>
                            <td className="px-1 py-0.5">
                              {esPropio(v) ? (
                                <span className="px-1.5 text-xs text-zinc-500">{v.transportista}</span>
                              ) : (
                                <select value={transportistas.some((t) => t.id === clave) ? clave : ""} disabled={trabado || cancelado} onChange={(e) => cambiarTransportistaViaje(v, e.target.value)} className={`${celda} max-w-[190px]`}>
                                  {!transportistas.some((t) => t.id === clave) && <option value="">{v.transportista || "—"}</option>}
                                  {transportistas.filter((t) => t.activo || t.id === clave).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                                </select>
                              )}
                            </td>
                            <td className="px-2 py-0.5 whitespace-nowrap">
                              {esDeRemito(v) ? (
                                <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">Remito {v.remito_id ? remitoNumero.get(v.remito_id) || "" : ""}</span>
                              ) : (
                                <span className="text-[11px] text-zinc-400">Anotado</span>
                              )}
                              {cancelado && <span className="ml-1 text-[11px] text-red-500">cancelado</span>}
                            </td>
                            <td className="px-1 py-0.5 text-right">
                              <input
                                key={`c-${v.costo ?? ""}`}
                                defaultValue={v.costo ?? ""}
                                disabled={trabado || cancelado}
                                placeholder={sugerido != null ? `${fijo != null ? "fijo " : "últ. "}${Math.round(sugerido).toLocaleString("es-AR")}` : "sin precio"}
                                inputMode="decimal"
                                onBlur={(e) => {
                                  const t = e.target.value.trim();
                                  const n = t === "" ? null : Number(t.replace(/\./g, "").replace(",", "."));
                                  if (n !== null && (!Number.isFinite(n) || n < 0)) { toast.error("Precio inválido"); return; }
                                  if (n !== (v.costo ?? null)) editarViaje(v, { costo: n });
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                className={`${celda} w-24 text-right tabular-nums placeholder:text-zinc-300 dark:placeholder:text-zinc-600`}
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <div className="flex gap-1">
                                <input
                                  key={`d-${v.destino ?? ""}`}
                                  defaultValue={v.destino && v.destino !== "Interno" ? v.destino : ""}
                                  disabled={trabado || cancelado}
                                  placeholder="destino"
                                  onBlur={(e) => { const t = e.target.value.trim(); const actual = v.destino && v.destino !== "Interno" ? v.destino : ""; if (t !== actual) editarViaje(v, { destino: t }); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className={`${celda} w-32 placeholder:text-zinc-300 dark:placeholder:text-zinc-600`}
                                />
                                <input
                                  key={`n-${v.notas ?? ""}`}
                                  defaultValue={v.notas || ""}
                                  disabled={trabado || cancelado}
                                  placeholder="notas"
                                  onBlur={(e) => { const t = e.target.value.trim(); if (t !== (v.notas || "")) editarViaje(v, { notas: t || null }); }}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className={`${celda} min-w-[120px] flex-1 placeholder:text-zinc-300 dark:placeholder:text-zinc-600`}
                                />
                              </div>
                              {extra && <div className="truncate px-1.5 text-[11px] text-zinc-400">{extra}</div>}
                            </td>
                            <td className="px-2 py-0.5 whitespace-nowrap">
                              {v.factura_compra_id ? (
                                <button onClick={() => v.facturas_compra?.archivo_url && window.open(v.facturas_compra.archivo_url, "_blank", "noopener,noreferrer")} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700" title="Liquidado y enviado a Pagos">
                                  <CheckCircle2 size={12} /> {v.facturas_compra?.numero_factura || "En pagos"}
                                </button>
                              ) : <span className="text-[11px] text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                            <td className="px-1 py-0.5 text-right">
                              {!trabado && (cancelado ? (
                                <button onClick={() => editarViaje(v, { estado: esDeRemito(v) ? "solicitado" : "entregado" })} className="rounded p-1 text-zinc-400 hover:text-emerald-600" title="Volver a sumar"><RotateCcw size={13} /></button>
                              ) : (
                                <button onClick={() => cancelarViaje(v)} disabled={ocupado === v.id} className="rounded p-1 text-zinc-300 hover:text-red-600 dark:text-zinc-600" title="Sacar de la cuenta"><Ban size={13} /></button>
                              ))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-500">
                    <span>{historial.length} viaje{historial.length === 1 ? "" : "s"} · {formatCurrency(totalHistorial, "ARS")} (con precio fijo)</span>
                    {historial.length > limite && <button onClick={() => setLimite((l) => l + 200)} className="font-medium text-orange-600 hover:underline">Ver más</button>}
                  </div>
                </div>
              )}
            </Card>
          </div>
        ))}

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
                    description="Marcá un proveedor como transportista para que aparezca automáticamente acá"
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
                <label className={labelClass}>Respaldo del pago</label>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
                  <button type="button" onClick={() => setFacturaEsInterna(false)}
                    className={`rounded-md px-3 py-2 text-xs font-medium ${!facturaEsInterna ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white" : "text-zinc-500"}`}>
                    Con factura del transportista
                  </button>
                  <button type="button" onClick={() => { setFacturaEsInterna(true); setFacturaFile(null); setFacturaParsed(false); setFacturaParseError(""); }}
                    className={`rounded-md px-3 py-2 text-xs font-medium ${facturaEsInterna ? "bg-white text-zinc-900 shadow dark:bg-zinc-700 dark:text-white" : "text-zinc-500"}`}>
                    Factura manual · sin comprobante
                  </button>
                </div>
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
