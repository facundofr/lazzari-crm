"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { SmartFilters, FilterConfig, FilterValues } from "@/components/ui/smart-filters";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { mockFacturas } from "@/lib/mock-data";
import {
  Receipt, DollarSign, FileCheck, AlertTriangle, Loader2, XCircle,
  X, Printer, CheckCircle2, Clock, Ban, Copy, Download, Check,
  ShieldCheck, KeyRound, Server, ClipboardCopy, Plus, Minus, Mail, FileText, Search,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";

const estadoConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" }> = {
  emitida: { label: "Emitida", variant: "info" },
  pagada: { label: "Pagada", variant: "success" },
  anulada: { label: "Anulada", variant: "danger" },
  vencida: { label: "Vencida", variant: "warning" },
};

interface FacturaRow {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  cae: string | null;
  cae_vencimiento: string | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  estado: string;
  presupuesto_id: string | null;
  oc_cliente?: string | null;
  factura_origen_id?: string | null;
  total_acreditado?: number | null;
  clientes: { razon_social: string; cuit: string; condicion_iva?: string; email?: string; telefono?: string; direccion?: string; localidad?: string; provincia?: string } | null;
}

type NcItem = { descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number };

interface ClienteOption {
  id: string;
  razon_social: string;
  cuit: string;
  condicion_iva: string | null;
}

interface EmitItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
}

function formatComprobante(tipo: string, pv: number, num: number) {
  return `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

export default function FacturacionPage() {
  const { sociedadActiva } = useUser();

  const emisorData = useMemo(() => {
    if (sociedadActiva?.nombre === "Grupo LA") {
      return {
        razonSocial: "Grupo LA Servicios Integrales SAS",
        cuit: "30-71939604-2",
        cuitNumero: 30719396042,
        condicionIva: "Responsable Inscripto",
        domicilio: "",
        ptoVta: 10,
      };
    }
    return {
      razonSocial: "Lazzari Soluciones Industriales",
      cuit: "20-37930912-8",
      cuitNumero: 20379309128,
      condicionIva: "Responsable Inscripto",
      domicilio: "",
      ptoVta: 15,
    };
  }, [sociedadActiva]);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailFactura, setDetailFactura] = useState<FacturaRow | null>(null);
  const [detailItems, setDetailItems] = useState<{ descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number; subtotal: number }[]>([]);

  // ARCA status
  const [arcaStatus, setArcaStatus] = useState<{ connected: boolean; certOk?: boolean; error?: string; afipError?: string; production?: boolean; ptoVta?: number } | null>(null);

  // Emit modal
  const [emitOpen, setEmitOpen] = useState(false);
  const [emitStep, setEmitStep] = useState<"form" | "emitting" | "success" | "error">("form");
  const [emitResult, setEmitResult] = useState<any>(null);
  const [emitError, setEmitError] = useState("");
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [emitManual, setEmitManual] = useState(false);
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
        setEmitData((p) => ({ ...p, tipo_cambio: data.valor_venta }));
      }
    } catch { /* silencioso */ } finally {
      setCotizBnaLoading(false);
    }
  }
  const [emitData, setEmitData] = useState({
    tipo: "FA",
    cliente_id: "",
    punto_venta: 15,
    numero_manual: "",
    moneda: "ARS" as "ARS" | "USD",
    tipo_cambio: 0,
    items: [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] as EmitItem[],
  });

  // ── NC (Nota de Crédito) modal ────────────────────────────────
  const [ncOpen, setNcOpen] = useState(false);
  const [ncFactura, setNcFactura] = useState<FacturaRow | null>(null);
  const [ncItems, setNcItems] = useState<NcItem[]>([]);
  const [ncManual, setNcManual] = useState(false);
  const [ncNumero, setNcNumero] = useState("");
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState("");
  const [ncStep, setNcStep] = useState<"form" | "saving" | "success" | "error">("form");
  const [ncResult, setNcResult] = useState<string>("");
  const [detailNCs, setDetailNCs] = useState<FacturaRow[]>([]);

  const isFacturaANc = ncFactura?.tipo === "FA" || ncFactura?.tipo === "FCEA";

  const ncTotals = ncItems.reduce((acc, it) => {
    if (isFacturaANc) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    } else {
      const total = it.cantidad * it.precio_unitario;
      const neto = Math.round(total / 1.21 * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
    }
  }, { neto: 0, iva: 0, total: 0 });

  async function openNcModal(factura: FacturaRow) {
    // Cargar items de la factura original
    const { data: items } = await supabase
      .from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje")
      .eq("factura_id", factura.id)
      .order("orden");

    setNcFactura(factura);
    setNcItems(
      items && items.length > 0
        ? items.map(it => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), iva_porcentaje: Number(it.iva_porcentaje) || 21 }))
        : [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }]
    );
    setNcManual(arcaStatus !== null && arcaStatus.certOk === false);
    setNcNumero("");
    setNcError("");
    setNcStep("form");
    setNcResult("");
    setNcOpen(true);
  }

  async function handleCreateNC() {
    if (!ncFactura) return;
    if (ncItems.some(it => !it.descripcion || it.precio_unitario <= 0)) {
      setNcError("Completa todos los items con descripción y precio"); return;
    }
    if (ncManual && (!ncNumero || Number(ncNumero) <= 0)) {
      setNcError("Ingresá el número de comprobante"); return;
    }

    const ncTipo = ncFactura.tipo === "FCEA" ? "NCEA" : ncFactura.tipo === "FCEB" ? "NCEB" : ncFactura.tipo === "FA" ? "NCA" : "NCB";
    setNcStep("saving");
    setNcError("");

    try {
      if (!ncManual) {
        // Electrónica via ARCA
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/facturacion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            tipo: ncTipo,
            cliente_id: ncFactura.cliente_id,
            punto_venta: emisorData.ptoVta,
            moneda: ncFactura.moneda || "ARS",
            tipo_cambio: ncFactura.tipo_cambio || null,
            items: ncItems,
            sociedad_id: sociedadActiva?.id,
            factura_origen_id: ncFactura.id,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Error al emitir NC");

        // Actualizar total_acreditado en la factura original
        await (supabase as any).from("facturas").update({
          total_acreditado: (Number(ncFactura.total_acreditado) || 0) + ncTotals.total,
        }).eq("id", ncFactura.id);

        setNcResult(data.factura.comprobante + (data.factura.cae ? ` — CAE: ${data.factura.cae}` : ""));
      } else {
        // Manual sin ARCA
        const today = new Date().toISOString().split("T")[0];
        const { data: newNc, error: ncErr } = await (supabase as any)
          .from("facturas")
          .insert({
            tipo: ncTipo,
            punto_venta: emisorData.ptoVta,
            numero: Number(ncNumero),
            cliente_id: ncFactura.cliente_id,
            fecha: today,
            cae: null,
            cae_vencimiento: null,
            subtotal: ncTotals.neto,
            iva: ncTotals.iva,
            total: ncTotals.total,
            moneda: ncFactura.moneda || "ARS",
            tipo_cambio: ncFactura.tipo_cambio || null,
            estado: "emitida",
            sociedad_id: sociedadActiva?.id || null,
            factura_origen_id: ncFactura.id,
          })
          .select("id")
          .single();

        if (ncErr) throw new Error(ncErr.message);

        if (newNc) {
          const itemRows = ncItems.map((it, idx) => {
            return { factura_id: newNc.id, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, iva_porcentaje: isFacturaANc ? it.iva_porcentaje : 21, orden: idx };
          });
          await (supabase as any).from("factura_items").insert(itemRows);
        }

        await (supabase as any).from("facturas").update({
          total_acreditado: (Number(ncFactura.total_acreditado) || 0) + ncTotals.total,
        }).eq("id", ncFactura.id);

        setNcResult(formatComprobante(ncTipo, emisorData.ptoVta, Number(ncNumero)) + " (manual)");
      }

      setNcStep("success");
      await fetchData();
    } catch (err: unknown) {
      setNcError(err instanceof Error ? err.message : "Error al crear NC");
      setNcStep("error");
    } finally {
      setNcSaving(false);
    }
  }

  // Filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    { key: "tipo", label: "Tipo", type: "select", options: [
      { value: "FA", label: "Factura A" }, { value: "FB", label: "Factura B" },
      { value: "NCA", label: "NC A" }, { value: "NCB", label: "NC B" },
    ]},
    { key: "estado", label: "Estado", type: "select", options: [
      { value: "emitida", label: "Emitida" }, { value: "pagada", label: "Pagada" },
      { value: "anulada", label: "Anulada" }, { value: "vencida", label: "Vencida" },
    ]},
    { key: "monto", label: "Monto", type: "number-range" },
  ];
  const [filterValues, setFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, tipo: "", estado: "", monto: {} });
  const [clienteSearch, setClienteSearch] = useState("");

  const filteredFacturas = facturas.filter((f) => {
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && f.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && f.fecha > fechaFilter.to) return false;
    if (filterValues.tipo && f.tipo !== filterValues.tipo) return false;
    if (filterValues.estado && f.estado !== filterValues.estado) return false;
    const montoFilter = filterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && Number(f.total) < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && Number(f.total) > montoFilter.max) return false;
    if (clienteSearch.trim()) {
      const nombre = (f.clientes?.razon_social || "").toLowerCase();
      if (!nombre.includes(clienteSearch.trim().toLowerCase())) return false;
    }
    return true;
  });

  // ── Fetch data ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      let query = supabase
        .from("facturas")
        .select(`*, clientes(razon_social, cuit, condicion_iva, email, telefono, direccion, localidad, provincia)`)
        .order("created_at", { ascending: false });

      if (sociedadActiva?.id) {
        query = query.eq("sociedad_id" as any, sociedadActiva.id);
      }

      const { data, error } = await query;

      if (!error && data) {
        setFacturas(data as unknown as FacturaRow[]);
      } else if (error) {
        setFacturas(mockFacturas.map((f) => ({
          id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
          cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
          subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
          moneda: "ARS", tipo_cambio: null,
          presupuesto_id: null,
          clientes: { razon_social: f.clienteNombre, cuit: "" },
        })));
      }
    } catch {
      setFacturas(mockFacturas.map((f) => ({
        id: f.id, tipo: f.tipo, punto_venta: f.puntoVenta, numero: f.numero,
        cliente_id: f.clienteId, fecha: f.fecha, cae: f.cae, cae_vencimiento: f.caeVencimiento,
        subtotal: f.subtotal, iva: f.iva, total: f.total, estado: f.estado,
        moneda: "ARS", tipo_cambio: null,
        presupuesto_id: null,
        clientes: { razon_social: f.clienteNombre, cuit: "" },
      })));
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Check ARCA status when sociedad changes
  useEffect(() => {
    if (!sociedadActiva?.id) return;
    setArcaStatus(null); // reset to loading while fetching
    fetch(`/api/facturacion?action=status&sociedad_id=${sociedadActiva.id}`)
      .then((r) => r.ok ? r.json() : r.json().catch(() => null).then((body: any) => {
        // API returned non-OK status — assume cert exists, connectivity may fail (normal on Vercel)
        return { connected: false, certOk: true, afipError: body?.error || `HTTP ${r.status}`, ptoVta: body?.ptoVta };
      }))
      .then((data: any) => {
        // Guard against unexpected response shapes — if certOk is missing, default to true
        if (data && typeof data === "object" && data.certOk !== undefined) {
          setArcaStatus(data);
        } else {
          setArcaStatus({ connected: false, certOk: true, afipError: "No se pudo verificar estado — puede emitir igualmente", ptoVta: data?.ptoVta });
        }
      })
      .catch(() => setArcaStatus({ connected: false, certOk: true, error: "No se pudo verificar estado — puede emitir igualmente" }));
  }, [sociedadActiva?.id]);

  // ── Emit handlers ──────────────────────────────────────────────
  const openEmitModal = (prefill?: { cliente_id: string; tipo?: string; items?: EmitItem[]; moneda?: "ARS" | "USD"; tipo_cambio?: number }) => {
    // Solo forzar manual si certOk es explícitamente false (certificado no encontrado)
    const forceManual = arcaStatus !== null && arcaStatus.certOk === false;
    setEmitManual(forceManual);
    setCotizBna(null);
    setEmitData({
      tipo: prefill?.tipo || (forceManual ? "X" : "FB"),
      cliente_id: prefill?.cliente_id || "",
      punto_venta: emisorData.ptoVta,
      numero_manual: "",
      moneda: prefill?.moneda || "ARS",
      tipo_cambio: prefill?.tipo_cambio || 0,
      items: prefill?.items || [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }],
    });
    setEmitStep("form");
    setEmitError("");
    setEmitResult(null);
    setEmitOpen(true);
    // Fetch clientes
    const q = supabase.from("clientes").select("id, razon_social, cuit, condicion_iva").eq("activo", true).order("razon_social");
    (sociedadActiva?.id ? q.eq("sociedad_id" as any, sociedadActiva.id) : q)
      .then(({ data }) => { if (data) setClientes(data as ClienteOption[]); });
  };

  const addItem = () => setEmitData((p) => ({ ...p, items: [...p.items, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] }));
  const removeItem = (idx: number) => setEmitData((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const updateItem = (idx: number, field: keyof EmitItem, value: string | number) => {
    setEmitData((p) => ({
      ...p,
      items: p.items.map((it, i) => i === idx ? { ...it, [field]: value } : it),
    }));
  };

  const isFacturaA = emitData.tipo === "FA" || emitData.tipo === "NCA" || emitData.tipo === "NDA" || emitData.tipo === "FCEA" || emitData.tipo === "NCEA";

  const isUSD = emitData.moneda === "USD";
  const tc = emitData.tipo_cambio || 0;

  const emitTotals = emitData.items.reduce((acc, it) => {
    if (isFacturaA) {
      const neto = it.cantidad * it.precio_unitario;
      const iva = neto * (it.iva_porcentaje / 100);
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva };
    } else {
      const total = it.cantidad * it.precio_unitario;
      const neto = Math.round(total / 1.21 * 100) / 100;
      const iva = Math.round((total - neto) * 100) / 100;
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + total };
    }
  }, { neto: 0, iva: 0, total: 0 });

  const handleEmit = async () => {
    if (!emitData.cliente_id) { setEmitError("Selecciona un cliente"); return; }
    if (emitData.items.some((it) => !it.descripcion || it.precio_unitario <= 0)) {
      setEmitError("Completa todos los items con descripcion y precio"); return;
    }
    if (isUSD && (!tc || tc <= 0)) {
      setEmitError("Factura en USD requiere tipo de cambio (cotizacion ARCA)"); return;
    }

    setEmitStep("emitting");
    setEmitError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/facturacion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          tipo: emitData.tipo,
          cliente_id: emitData.cliente_id,
          punto_venta: emitData.punto_venta,
          moneda: emitData.moneda,
          tipo_cambio: isUSD ? tc : null,
          items: emitData.items,
          sociedad_id: sociedadActiva?.id,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEmitResult(data.factura);
        setEmitStep("success");
        await fetchData();
      } else {
        setEmitError(data.error || "Error al emitir factura");
        setEmitStep("error");
      }
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error de conexion");
      setEmitStep("error");
    }
  };

  const handleEmitManual = async () => {
    if (!emitData.cliente_id) { setEmitError("Selecciona un cliente"); return; }
    if (emitData.items.some((it) => !it.descripcion || it.precio_unitario <= 0)) {
      setEmitError("Completa todos los items con descripcion y precio"); return;
    }
    const numManual = Number(emitData.numero_manual);
    if (!numManual || numManual <= 0) {
      setEmitError("Ingresa el numero de comprobante"); return;
    }

    setEmitStep("emitting");
    setEmitError("");

    try {
      const cliente = clientes.find(c => c.id === emitData.cliente_id);
      const today = new Date().toISOString().split("T")[0];

      // Insert factura directly without ARCA
      const { data: newFactura, error: facturaErr } = await (supabase as any)
        .from("facturas")
        .insert({
          tipo: emitData.tipo,
          punto_venta: emitData.punto_venta,
          numero: numManual,
          cliente_id: emitData.cliente_id === "consumidor_final" ? null : emitData.cliente_id,
          fecha: today,
          cae: null,
          cae_vencimiento: null,
          subtotal: emitTotals.neto,
          iva: emitTotals.iva,
          total: emitTotals.total,
          moneda: emitData.moneda,
          tipo_cambio: emitData.moneda === "USD" && emitData.tipo_cambio > 0 ? emitData.tipo_cambio : null,
          estado: "emitida",
          sociedad_id: sociedadActiva?.id || null,
        })
        .select("id")
        .single();

      if (facturaErr) throw new Error(facturaErr.message);

      // Insert items
      if (newFactura) {
        const itemRows = emitData.items.map((it, idx) => ({
            factura_id: newFactura.id,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            iva_porcentaje: isFacturaA ? it.iva_porcentaje : 21,
            orden: idx,
          }));
        await (supabase as any).from("factura_items").insert(itemRows);
      }

      const comp = formatComprobante(emitData.tipo, emitData.punto_venta, numManual);
      setEmitResult({
        comprobante: comp,
        cae: null,
        cae_vencimiento: null,
        total: emitTotals.total,
        manual: true,
        cliente: cliente?.razon_social || "Consumidor Final",
      });
      setEmitStep("success");
      await fetchData();
    } catch (err: unknown) {
      setEmitError(err instanceof Error ? err.message : "Error al guardar factura");
      setEmitStep("error");
    }
  };

  // ── Detail actions ─────────────────────────────────────────────
  async function handleAnular(id: string) {
    if (!confirm("¿Seguro que queres anular esta factura?")) return;
    try {
      const { error } = await supabase.from("facturas").update({ estado: "anulada" } as any).eq("id", id);
      if (error) { alert(error.message); return; }
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura(null);
    } catch (err) { console.error("Error anulando:", err); }
  }

  async function handleMarcarPagada(id: string) {
    try {
      const { error } = await supabase.from("facturas").update({ estado: "pagada" } as any).eq("id", id);
      if (error) { alert(error.message); return; }
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura((p) => p ? { ...p, estado: "pagada" } : null);
    } catch (err) { console.error("Error:", err); }
  }

  // ── Copy & PDF ─────────────────────────────────────────────────
  // Cobro modal
  const [cobroModalId, setCobroModalId] = useState<string | null>(null);
  type CobroLinea = { tipo: "cobro" | "transferencia" | "efectivo" | "cheque_recibido" | "retencion_iibb" | "retencion_ganancias" | "retencion_iva"; monto: string; descripcion: string };
  const [cobroLineas, setCobroLineas] = useState<CobroLinea[]>([{ tipo: "transferencia", monto: "", descripcion: "" }]);
  const [cobroFecha, setCobroFecha] = useState(new Date().toISOString().split("T")[0]);
  const [cobroSaving, setCobroSaving] = useState(false);
  const [cobroPrevios, setCobroPrevios] = useState<number>(0);
  const [cobroPreviosLoading, setCobroPreviosLoading] = useState(false);

  async function fetchCobrosPrevios(facturaId: string): Promise<number> {
    const { data: movs } = await (supabase as any).from("movimientos").select("monto").eq("factura_id", facturaId);
    return (movs || []).reduce((s: number, m: any) => s + Number(m.monto), 0);
  }

  async function openCobroModal(factura: FacturaRow) {
    setCobroPreviosLoading(true);
    setCobroPrevios(0);
    setCobroFecha(new Date().toISOString().split("T")[0]);
    setCobroModalId(factura.id);
    try {
      const previos = await fetchCobrosPrevios(factura.id);
      setCobroPrevios(previos);
      const saldoReal = Number(factura.total) - Number(factura.total_acreditado || 0) - previos;
      setCobroLineas([{ tipo: "transferencia", monto: String(Math.max(0, Math.round(saldoReal * 100) / 100)), descripcion: "" }]);
    } catch {
      const saldoFallback = Number(factura.total) - Number(factura.total_acreditado || 0);
      setCobroLineas([{ tipo: "transferencia", monto: String(Math.max(0, saldoFallback)), descripcion: "" }]);
    } finally {
      setCobroPreviosLoading(false);
    }
  }

  async function handleRegistrarCobro() {
    const lineasValidas = cobroLineas.filter(l => Number(l.monto) > 0);
    if (!cobroModalId || lineasValidas.length === 0) return;
    const factura = facturas.find(f => f.id === cobroModalId);
    if (!factura) return;
    const totalLineas = lineasValidas.reduce((s, l) => s + Number(l.monto), 0);
    const saldo = Number(factura.total) - Number(factura.total_acreditado || 0) - cobroPrevios;
    if (totalLineas > saldo + 0.01) {
      alert(`El total de cobros ($${totalLineas.toLocaleString()}) supera el saldo pendiente ($${Math.max(0, saldo).toLocaleString()})`);
      return;
    }
    setCobroSaving(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const lineasPayload = lineasValidas.map(l => ({
        tipo: l.tipo,
        monto: Number(l.monto),
        descripcion: l.descripcion || `Cobro ${formatComprobante(factura.tipo, factura.punto_venta, factura.numero)}`,
      }));
      const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc("registrar_cobro", {
        p_factura_id: cobroModalId,
        p_lineas: lineasPayload,
        p_fecha: cobroFecha,
        p_sociedad_id: sociedadActiva?.id || null,
        p_created_by: userId,
      });
      if (rpcErr) throw rpcErr;

      setCobroModalId(null);
      await fetchData();
      if (detailFactura?.id === cobroModalId) {
        setDetailFactura(prev => prev ? { ...prev, estado: rpcResult?.pagada ? "pagada" : prev.estado } : null);
      }
    } catch (err: any) {
      alert("Error al registrar cobro: " + (err.message || JSON.stringify(err)));
    } finally {
      setCobroSaving(false);
    }
  }

  const [copied, setCopied] = useState(false);
  function handleCopy(f: FacturaRow) {
    const lines = [
      `*${formatComprobante(f.tipo, f.punto_venta, f.numero)}*`,
      "",
      `Fecha: ${formatDate(f.fecha)}`,
      `Estado: ${estadoConfig[f.estado]?.label || f.estado}`,
      "",
      `*Emisor:* ${emisorData.razonSocial}`,
      `CUIT: ${emisorData.cuit}`,
      "",
      `*Cliente:* ${f.clientes?.razon_social || "\u2014"}`,
      f.clientes?.cuit ? `CUIT: ${f.clientes.cuit}` : null,
      "",
      `Neto: ${formatCurrency(Number(f.subtotal), f.moneda as "USD" | "ARS")}`,
      `IVA: ${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}`,
      `*Total: ${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}*`,
      f.cae ? `\nCAE: ${f.cae}` : null,
      f.cae_vencimiento ? `Vto CAE: ${formatDate(f.cae_vencimiento)}` : null,
    ];
    navigator.clipboard.writeText(lines.filter(Boolean).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function buildFacturaSummaryText(f: FacturaRow) {
    const comp = formatComprobante(f.tipo, f.punto_venta, f.numero);
    const lines = [
      `${comp}`,
      "",
      `Fecha: ${formatDate(f.fecha)}`,
      `Estado: ${estadoConfig[f.estado]?.label || f.estado}`,
      "",
      `Emisor: ${emisorData.razonSocial}`,
      `CUIT: ${emisorData.cuit}`,
      "",
      `Cliente: ${f.clientes?.razon_social || "\u2014"}`,
      f.clientes?.cuit ? `CUIT: ${f.clientes.cuit}` : null,
      f.oc_cliente ? `OC Cliente: ${f.oc_cliente}` : null,
      "",
      "DETALLE:",
      ...detailItems.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} x ${formatCurrency(it.precio_unitario, f.moneda as "USD" | "ARS")} = ${formatCurrency(it.subtotal, f.moneda as "USD" | "ARS")}`),
      "",
      `Subtotal: ${formatCurrency(Number(f.subtotal), f.moneda as "USD" | "ARS")}`,
      `IVA: ${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}`,
      `TOTAL: ${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}`,
      f.moneda === "USD" && f.tipo_cambio ? `Moneda: USD — TC: ${Number(f.tipo_cambio).toLocaleString("es-AR")}` : null,
      f.cae ? `\nCAE: ${f.cae}` : null,
      f.cae_vencimiento ? `Vto CAE: ${formatDate(f.cae_vencimiento)}` : null,
    ];
    return lines.filter(Boolean).join("\n");
  }

  function handleEmailFactura(f: FacturaRow) {
    const text = buildFacturaSummaryText(f);
    const comp = formatComprobante(f.tipo, f.punto_venta, f.numero);
    const emailTo = f.clientes?.email || "";
    const subject = encodeURIComponent(comp);
    const body = encodeURIComponent(text);
    window.open(`mailto:${encodeURIComponent(emailTo)}?subject=${subject}&body=${body}`, "_blank");
  }

  async function handlePrintFactura(f: FacturaRow) {
    // Ensure items are loaded before generating PDF
    let pdfItems = detailItems;
    if (pdfItems.length === 0) {
      const { data } = await supabase.from("factura_items")
        .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal")
        .eq("factura_id", f.id).order("orden");
      pdfItems = (data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }));
    }

    const cli = f.clientes;
    const comp = formatComprobante(f.tipo, f.punto_venta, f.numero);
    const letraComprobante = f.tipo.slice(-1);
    const isFacturaBPdf = f.tipo === "FB" || f.tipo === "NCB" || f.tipo === "X" || f.tipo === "NDB";

    // Build QR data URL for ARCA verification
    const isUSDPdf = f.moneda === "USD" && f.tipo_cambio;
    const qrData = JSON.stringify({
      ver: 1, fecha: f.fecha, cuit: emisorData.cuitNumero, ptoVta: f.punto_venta,
      tipoCmp: ({ FA: 1, FB: 6, FC: 11, NCA: 3, NCB: 8, NCC: 13, FCEA: 201, FCEB: 206, NCEA: 203, NCEB: 208 } as Record<string, number>)[f.tipo] || 1,
      nroCmp: f.numero, importe: Number(f.total), moneda: isUSDPdf ? "DOL" : "PES", ctz: isUSDPdf ? Number(f.tipo_cambio) : 1,
      tipoDocRec: cli?.cuit ? 80 : 99, nroDocRec: cli?.cuit ? Number(cli.cuit.replace(/-/g, "")) : 0,
      tipoCodAut: "E", codAut: Number(f.cae || 0),
    });
    const qrBase64 = btoa(qrData);
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${comp}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; padding: 0; color: #1a1a1a; font-size: 12px; line-height: 1.4; }
  .page { max-width: 800px; margin: 0 auto; padding: 32px 40px; }
  .fc-header { display: flex; border: 2px solid #1a1a1a; margin-bottom: 20px; }
  .fc-left, .fc-right { flex: 1; padding: 16px; }
  .fc-center { width: 60px; display: flex; align-items: flex-start; justify-content: center; padding-top: 12px; border-left: 2px solid #1a1a1a; border-right: 2px solid #1a1a1a; }
  .fc-letra { font-size: 28px; font-weight: 900; }
  .fc-cod { font-size: 8px; color: #666; text-align: center; margin-top: 2px; }
  .emisor-name { font-size: 16px; font-weight: 700; }
  .emisor-detail { font-size: 10px; color: #555; margin-top: 4px; }
  .comp-tipo { font-size: 14px; font-weight: 700; text-align: right; }
  .comp-num { font-size: 16px; font-weight: 700; font-family: monospace; text-align: right; margin-top: 4px; }
  .comp-fecha { font-size: 11px; color: #555; text-align: right; margin-top: 6px; }
  .two-col { display: flex; gap: 24px; margin-bottom: 16px; padding: 12px; border: 1px solid #ddd; border-radius: 4px; }
  .col { flex: 1; }
  .field-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 600; }
  .field-value { font-size: 12px; font-weight: 500; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead th { background: #f5f5f5; padding: 8px 10px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #666; font-weight: 600; border-bottom: 2px solid #ddd; }
  tbody td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 11px; }
  .mono { font-family: 'Consolas', monospace; }
  .right { text-align: right; }
  .totals { display: flex; justify-content: flex-end; }
  .totals-inner { width: 260px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
  .total-line { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 11px; }
  .total-line.final { background: #f5f5f5; font-weight: 700; font-size: 14px; border-top: 2px solid #1a1a1a; padding: 10px 12px; }
  .cae-section { margin-top: 20px; padding: 12px; border: 1px solid #ddd; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
  .cae-info { }
  .cae-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; font-weight: 600; }
  .cae-value { font-size: 14px; font-weight: 700; font-family: monospace; margin-top: 2px; }
  .cae-vto { font-size: 10px; color: #666; margin-top: 2px; }
  .qr-box { text-align: center; }
  .qr-box img { width: 100px; height: 100px; }
  .qr-text { font-size: 8px; color: #888; margin-top: 2px; }
  .footer { margin-top: 24px; text-align: center; font-size: 9px; color: #bbb; border-top: 1px solid #eee; padding-top: 8px; }
  @media print { .page { padding: 16px 24px; } }
</style></head><body>
<div class="page">

<div class="fc-header">
  <div class="fc-left">
    <div class="emisor-name">${emisorData.razonSocial}</div>
    <div class="emisor-detail">CUIT: ${emisorData.cuit}</div>
    <div class="emisor-detail">${emisorData.condicionIva}</div>
    ${emisorData.domicilio ? `<div class="emisor-detail">${emisorData.domicilio}</div>` : ""}
  </div>
  <div class="fc-center">
    <div>
      <div class="fc-letra">${letraComprobante}</div>
      <div class="fc-cod">COD. ${String({ FA: 1, FB: 6, X: 0, NCA: 3, NCB: 8, NDA: 2, NDB: 7, FCEA: 201, FCEB: 206, NCEA: 203, NCEB: 208 }[f.tipo] || 0).padStart(2, "0")}</div>
    </div>
  </div>
  <div class="fc-right">
    <div class="comp-tipo">${f.tipo === "X" ? "FACTURA (INTERNA)" : f.tipo.startsWith("ND") ? "NOTA DE DÉBITO" : f.tipo.startsWith("NCE") ? "NOTA DE CRÉDITO ELECTRÓNICA" : f.tipo.startsWith("NC") ? "NOTA DE CRÉDITO" : f.tipo.startsWith("FCE") ? "FACTURA DE CRÉDITO ELECTRÓNICA" : "FACTURA"}</div>
    <div class="comp-num">N° ${String(f.punto_venta).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}</div>
    <div class="comp-fecha">Fecha: ${formatDate(f.fecha)}</div>
  </div>
</div>

<div class="two-col">
  <div class="col">
    <div class="field-label">Cliente</div>
    <div class="field-value" style="font-size:14px;font-weight:700">${cli?.razon_social || "\u2014"}</div>
    ${cli?.cuit ? `<div class="field-label">CUIT</div><div class="field-value">${cli.cuit}</div>` : ""}
    ${cli?.condicion_iva ? `<div class="field-label">Cond. IVA</div><div class="field-value">${cli.condicion_iva}</div>` : ""}
  </div>
  <div class="col">
    ${cli?.direccion ? `<div class="field-label">Domicilio</div><div class="field-value">${cli.direccion}${cli.localidad ? `, ${cli.localidad}` : ""}${cli.provincia ? `, ${cli.provincia}` : ""}</div>` : ""}
    ${cli?.email ? `<div class="field-label">Email</div><div class="field-value">${cli.email}</div>` : ""}
    ${cli?.telefono ? `<div class="field-label">Telefono</div><div class="field-value">${cli.telefono}</div>` : ""}
    ${f.oc_cliente ? `<div class="field-label" style="margin-top:8px">OC Cliente</div><div class="field-value" style="color:#2563EB;font-weight:700;font-size:13px">${f.oc_cliente}</div>` : ""}
  </div>
</div>

<table>
  <thead><tr>
    <th style="width:50%">Descripcion</th>
    <th class="right">Cantidad</th>
    <th class="right">P. Unitario</th>
    ${isFacturaBPdf ? "" : `<th class="right">IVA %</th>`}
    <th class="right">Subtotal</th>
  </tr></thead>
  <tbody>
    ${pdfItems.length > 0 ? pdfItems.map(it => `
    <tr>
      <td>${it.descripcion}</td>
      <td class="right mono">${it.cantidad}</td>
      <td class="right mono">${formatCurrency(Number(it.precio_unitario), f.moneda as "USD" | "ARS")}</td>
      ${isFacturaBPdf ? "" : `<td class="right">${it.iva_porcentaje}%</td>`}
      <td class="right mono">${formatCurrency(Number(it.subtotal), f.moneda as "USD" | "ARS")}</td>
    </tr>`).join("") : `
    <tr>
      <td colspan="${isFacturaBPdf ? 4 : 5}" style="text-align:center;color:#888;padding:16px">
        Items detallados no disponibles
      </td>
    </tr>`}
  </tbody>
</table>

<div class="totals">
  <div class="totals-inner">
    ${isUSDPdf ? `<div class="total-line" style="color:#888;font-size:10px"><span>Operacion en USD — TC: ${Number(f.tipo_cambio).toLocaleString("es-AR")}</span><span class="mono">USD ${(Number(f.total) / Number(f.tipo_cambio!)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ""}
    ${isFacturaBPdf
      ? `<div class="total-line"><span>Subtotal</span><span class="mono">${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}</span></div>
         <div class="total-line" style="color:#888;font-size:10px"><span>IVA incluido en precio</span><span class="mono">${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}</span></div>
         <div class="total-line final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}</span></div>`
      : `<div class="total-line"><span>Neto gravado</span><span class="mono">${formatCurrency(Number(f.subtotal), f.moneda as "USD" | "ARS")}</span></div>
         <div class="total-line"><span>IVA 21%</span><span class="mono">${formatCurrency(Number(f.iva), f.moneda as "USD" | "ARS")}</span></div>
         <div class="total-line final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total), f.moneda as "USD" | "ARS")}</span></div>`}
  </div>
</div>

${f.cae ? `
<div class="cae-section">
  <div class="cae-info">
    <div class="cae-label">CAE</div>
    <div class="cae-value">${f.cae}</div>
    ${f.cae_vencimiento ? `<div class="cae-vto">Vencimiento: ${formatDate(f.cae_vencimiento)}</div>` : ""}
  </div>
  <div class="qr-box">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(qrUrl)}" alt="QR ARCA" />
    <div class="qr-text">Verificar en ARCA</div>
  </div>
</div>
` : ""}

<div class="footer">
  ${comp} &mdash; ${emisorData.razonSocial} &mdash; CUIT ${emisorData.cuit}
</div>

</div></body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
  }

  // ── KPIs ───────────────────────────────────────────────────────
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const facturasEsteMes = facturas.filter((f) => {
    const d = new Date(f.fecha);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear && f.estado !== "anulada";
  });
  const facturadoMes = facturasEsteMes.reduce((a, f) => a + Number(f.total), 0);
  const pendientesCobro = facturas.filter(f => f.estado === "emitida").reduce((a, f) => a + Number(f.total), 0);
  const facturasVencidas = facturas.filter(f => f.estado === "vencida").length;
  const caeVigentes = facturas.filter(f => f.cae && f.estado !== "anulada").length;

  if (loading) {
    return (
      <>
        <Header title="Facturacion" subtitle="Comprobantes electronicos" />
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Facturacion"
        subtitle="Comprobantes electronicos ARCA"
        action={{ label: "Emitir factura", onClick: openEmitModal }}
      />
      <div className="p-6 lg:p-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Facturado este mes" value={formatCurrency(facturadoMes)} icon={DollarSign} iconColor="text-emerald-600" />
          <StatCard title="Pendientes de cobro" value={formatCurrency(pendientesCobro)} icon={Clock} iconColor="text-amber-500" />
          <StatCard title="Comprobantes vencidos" value={String(facturasVencidas)} icon={AlertTriangle} iconColor="text-red-500" />
          <StatCard title="CAE vigentes" value={String(caeVigentes)} icon={FileCheck} iconColor="text-blue-600" />
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            value={clienteSearch}
            onChange={(e) => setClienteSearch(e.target.value)}
            placeholder="Buscar por cliente (razón social)..."
            className="w-full rounded-lg border border-zinc-200 pl-9 pr-8 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white placeholder:text-zinc-400"
          />
          {clienteSearch && (
            <button onClick={() => setClienteSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} />

        {/* Data table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<FacturaRow>
            columns={[
              { key: "numero", label: "Comprobante", sortable: true, render: (r) => (
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-zinc-400" />
                  <span className="font-mono text-xs font-bold">{formatComprobante(r.tipo, r.punto_venta, r.numero)}</span>
                </div>
              )},
              { key: "clientes", label: "Cliente", sortable: true, render: (r) => <span className="font-medium">{r.clientes?.razon_social || "\u2014"}</span> },
              { key: "oc_cliente", label: "OC Cliente", render: (r) => r.oc_cliente
                ? <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{r.oc_cliente}</span>
                : <span className="text-zinc-300">{"\u2014"}</span>
              },
              { key: "fecha", label: "Fecha", sortable: true, render: (r) => <span className="text-zinc-500">{formatDate(r.fecha)}</span> },
              { key: "total", label: "Total", sortable: true, className: "text-right", render: (r) => (
                <span className="font-mono font-semibold block text-right">{formatCurrency(Number(r.total), r.moneda as "USD" | "ARS")}</span>
              )},
              { key: "cae", label: "CAE", render: (r) => r.cae
                ? <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{r.cae.slice(-8)}</span>
                : <span className="text-xs text-zinc-400 italic">Manual</span>
              },
              { key: "estado", label: "Estado", sortable: true, render: (r) => (
                <Badge variant={estadoConfig[r.estado]?.variant || "info"}>
                  {estadoConfig[r.estado]?.label || r.estado}
                </Badge>
              )},
              { key: "acciones", label: "", render: (r) => (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {r.estado === "emitida" && (
                    <button onClick={() => handleMarcarPagada(r.id)} className="px-2 py-1 rounded text-xs font-medium border border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30 transition-colors">
                      Marcar pagada
                    </button>
                  )}
                </div>
              )},
            ]}
            data={filteredFacturas}
            onRowClick={(f) => {
              setDetailFactura(f);
              setDetailNCs([]);
              supabase.from("factura_items").select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden")
                .then(({ data }) => setDetailItems((data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }))));
              // Cargar NCs relacionadas a esta factura
              (supabase as any).from("facturas").select("id, tipo, punto_venta, numero, fecha, cae, total, estado")
                .eq("factura_origen_id", f.id).order("fecha", { ascending: false })
                .then(({ data }: { data: FacturaRow[] | null }) => setDetailNCs(data || []));
            }}
          />
        </Card>

        {/* ARCA Status Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600" />
              <CardTitle>Conexion ARCA</CardTitle>
            </div>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-blue-50 p-2 dark:bg-blue-950">
                  <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">WSFE</p>
                  <p className="text-xs text-zinc-400">Factura electronica</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${arcaStatus?.connected ? "bg-emerald-500" : arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.certOk ? "bg-amber-400" : "bg-red-400"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus === null ? "Verificando..." : arcaStatus.connected ? `Produccion — PV ${arcaStatus.ptoVta}` : arcaStatus?.certOk ? `Configurado — PV ${arcaStatus.ptoVta}` : "Sin conexion"}
                </span>
              </div>
              {arcaStatus && !arcaStatus.connected && arcaStatus.afipError && (
                <p className="text-xs text-amber-500 mt-1 leading-tight">AFIP no responde ahora (normal)</p>
              )}
              {arcaStatus && !arcaStatus.connected && arcaStatus.error && !arcaStatus.certOk && (
                <p className="text-xs text-red-500 mt-1 leading-tight">{arcaStatus.error}</p>
              )}
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700 space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-950">
                  <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Certificado digital</p>
                  <p className="text-xs text-zinc-400">Requerido para emitir</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${arcaStatus === null ? "bg-zinc-300 dark:bg-zinc-600 animate-pulse" : arcaStatus?.connected || arcaStatus?.certOk ? "bg-emerald-500" : "bg-red-400"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus === null ? "Verificando..." : arcaStatus?.connected || arcaStatus?.certOk ? "Certificado configurado" : "Certificado no configurado"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500 mb-2">CUIT emisor</p>
              <p className="text-xl font-bold font-mono dark:text-white">{emisorData.cuit}</p>
              <p className="text-xs text-zinc-400 mt-1">{emisorData.razonSocial}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Emit Modal ──────────────────────────────────────────────── */}
      {emitOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">{emitManual ? "Factura manual" : "Emitir factura ARCA"}</h2>
                <p className="text-sm text-zinc-400">{emitManual ? "Se guarda sin autorizar en ARCA (sin CAE)" : "Se autorizara en tiempo real con ARCA"}</p>
              </div>
              <button onClick={() => setEmitOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {emitStep === "form" && (
              <div className="p-6 space-y-5">
                {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{emitError}</div>}

                {/* Toggle ARCA / Manual */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <button
                      onClick={() => { setEmitManual(false); setEmitData((p) => ({ ...p, tipo: p.tipo === "X" ? "FA" : p.tipo })); }}
                      disabled={arcaStatus !== null && arcaStatus.certOk === false}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!emitManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                    </button>
                    <button
                      onClick={() => { setEmitManual(true); setEmitData((p) => ({ ...p, tipo: "X" })); }}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${emitManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> ARCA no configurado para esta sociedad — solo modo manual disponible.
                    </p>
                  )}
                </div>

                {/* Tipo + Cliente + PV */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Tipo *</label>
                    <select value={emitData.tipo} onChange={(e) => setEmitData((p) => ({ ...p, tipo: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      {emitManual && (
                        <optgroup label="Manual (sin ARCA)">
                          <option value="X">Factura X (interna)</option>
                          <option value="NDA">ND A</option>
                          <option value="NDB">ND B</option>
                        </optgroup>
                      )}
                      <optgroup label="Facturas">
                        <option value="FA">Factura A</option>
                        <option value="FB">Factura B</option>
                      </optgroup>
                      <optgroup label="Factura de Crédito Electrónica">
                        <option value="FCEA">FCE A (MiPyMEs)</option>
                        <option value="FCEB">FCE B (MiPyMEs)</option>
                      </optgroup>
                      <optgroup label="Notas de crédito">
                        <option value="NCA">NC A</option>
                        <option value="NCB">NC B</option>
                        <option value="NCEA">NCE A (MiPyMEs)</option>
                        <option value="NCEB">NCE B (MiPyMEs)</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="col-span-7">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                    <select value={emitData.cliente_id} onChange={(e) => setEmitData((p) => ({ ...p, cliente_id: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <option value="">Seleccionar cliente...</option>
                      {(!isFacturaA || emitData.tipo === "X") && <option value="consumidor_final">Consumidor Final</option>}
                      {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social} — {c.cuit || "Sin CUIT"}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">PV</label>
                    {emitManual ? (
                      <input type="number" min={1} value={emitData.punto_venta} onChange={(e) => setEmitData((p) => ({ ...p, punto_venta: Number(e.target.value) }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    ) : (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-500 dark:text-zinc-400">
                        {String(emitData.punto_venta).padStart(4, "0")}
                      </div>
                    )}
                  </div>
                </div>

                {emitManual && (
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-4">
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                      <input type="number" min={1} value={emitData.numero_manual} onChange={(e) => setEmitData((p) => ({ ...p, numero_manual: e.target.value }))} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="col-span-8 flex items-end">
                      <p className="text-xs text-amber-600 dark:text-amber-400 pb-2">Esta factura no se autoriza con ARCA. No tendrá CAE.</p>
                    </div>
                  </div>
                )}

                {/* Moneda + Tipo de cambio */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-4">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Moneda factura</label>
                    <select value={emitData.moneda} onChange={(e) => setEmitData((p) => ({ ...p, moneda: e.target.value as "ARS" | "USD" }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <option value="ARS">ARS — Pesos</option>
                      <option value="USD">USD — Dolares</option>
                    </select>
                  </div>
                  {isUSD && (
                    <div className="col-span-8">
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cotizacion USD/ARS *</label>
                      <input type="number" step="0.01" min={0} value={emitData.tipo_cambio || ""} onChange={(e) => setEmitData((p) => ({ ...p, tipo_cambio: Number(e.target.value) }))} placeholder="Ej: 1450.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
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
                        {cotizBna && <span className="text-xs text-zinc-400">→ Venta {cotizBna.modalidad}: ${cotizBna.valor_venta.toLocaleString("es-AR")} ({cotizBna.fecha})</span>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Items */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium dark:text-zinc-300">Items *</label>
                    <button onClick={addItem} className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium">
                      <Plus className="h-3 w-3" /> Agregar item
                    </button>
                  </div>
                  <div className="space-y-3">
                    {emitData.items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaA ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripcion</label>}
                          <input
                            value={item.descripcion} onChange={(e) => updateItem(idx, "descripcion", e.target.value)}
                            placeholder="Ej: Valvula esferica 1/2"
                            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white"
                          />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cantidad</label>}
                          <input type="number" min={1} value={item.cantidad} onChange={(e) => updateItem(idx, "cantidad", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaA ? "Neto unit." : "Precio"}</label>}
                          <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => updateItem(idx, "precio_unitario", Number(e.target.value))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        {isFacturaA && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select value={item.iva_porcentaje} onChange={(e) => updateItem(idx, "iva_porcentaje", Number(e.target.value))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {emitData.items.length > 1 && (
                            <button onClick={() => removeItem(idx)} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals preview */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaA ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(emitTotals.neto, isUSD ? "USD" : "ARS")}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(emitTotals.iva, isUSD ? "USD" : "ARS")}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total</span><span className="font-mono">{formatCurrency(emitTotals.total, isUSD ? "USD" : "ARS")}</span>
                    </div>
                  )}
                  {isUSD && tc > 0 && (
                    <div className="text-xs text-zinc-400 text-right">Cotizacion ARCA: 1 USD = {tc.toLocaleString("es-AR")} ARS</div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  {emitManual ? (
                    <button onClick={handleEmitManual} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-zinc-700 text-white hover:bg-zinc-800 transition-colors">
                      <FileCheck className="h-4 w-4" /> Guardar manual
                    </button>
                  ) : (
                    <button onClick={handleEmit} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                      <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                    </button>
                  )}
                </div>
              </div>
            )}

            {emitStep === "emitting" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">{emitManual ? "Guardando factura..." : "Autorizando con ARCA..."}</p>
                {!emitManual && <p className="text-xs text-zinc-400">Esto puede tomar unos segundos</p>}
              </div>
            )}

            {emitStep === "success" && emitResult && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">{emitResult.manual ? "Factura guardada" : "Factura emitida exitosamente"}</h3>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Comprobante</span><span className="font-mono font-bold">{emitResult.comprobante}</span></div>
                  {emitResult.manual ? (
                    <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="text-zinc-400 italic">Sin CAE (manual)</span></div>
                  ) : (
                    <>
                      <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="font-mono">{emitResult.cae}</span></div>
                      <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Vto CAE</span><span>{emitResult.cae_vencimiento ? formatDate(emitResult.cae_vencimiento) : "\u2014"}</span></div>
                    </>
                  )}
                  <div className="flex justify-between border-t border-emerald-200 dark:border-emerald-700 pt-2"><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Total</span><span className="font-mono font-bold">{formatCurrency(emitResult.total, emitData.moneda)}</span></div>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}

            {emitStep === "error" && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                    <XCircle className="h-8 w-8 text-red-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">Error al emitir</h3>
                  <p className="text-sm text-red-600 text-center max-w-md">{emitError}</p>
                </div>
                <div className="flex justify-center gap-3">
                  <button onClick={() => setEmitStep("form")} className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">Intentar de nuevo</button>
                  <button onClick={() => setEmitOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cerrar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail Side Panel ─────────────────────────────────────────── */}
      {detailFactura && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetailFactura(null)} />
          <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 shadow-2xl overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 py-4 border-b border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700">
              <div>
                <h2 className="font-mono text-lg font-bold dark:text-white">
                  {formatComprobante(detailFactura.tipo, detailFactura.punto_venta, detailFactura.numero)}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={estadoConfig[detailFactura.estado]?.variant || "info"}>
                    {estadoConfig[detailFactura.estado]?.label || detailFactura.estado}
                  </Badge>
                  <span className="text-xs text-zinc-400">{formatDate(detailFactura.fecha)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEmailFactura(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Enviar por correo">
                  <Mail className="h-3.5 w-3.5" /> Email
                </button>
                <button onClick={() => handleCopy(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" title="Copiar resumen">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
                <button onClick={() => handlePrintFactura(detailFactura)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <Download className="h-3.5 w-3.5" /> PDF
                </button>
                {(detailFactura.tipo === "FA" || detailFactura.tipo === "FB" || detailFactura.tipo === "FCEA" || detailFactura.tipo === "FCEB") && detailFactura.estado !== "anulada" && (
                  <button
                    onClick={() => openNcModal(detailFactura)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30 transition-colors"
                    title="Emitir Nota de Crédito"
                  >
                    <XCircle className="h-3.5 w-3.5" /> NC
                  </button>
                )}
                <button onClick={() => setDetailFactura(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-6">
              {/* Cliente */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Cliente</h4>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{detailFactura.clientes?.razon_social}</p>
                {detailFactura.clientes?.cuit && <p className="text-xs text-zinc-500 mt-0.5">CUIT: {detailFactura.clientes.cuit}</p>}
                {detailFactura.clientes?.condicion_iva && <p className="text-xs text-zinc-400">{detailFactura.clientes.condicion_iva}</p>}
              </div>

              {/* OC Cliente */}
              {detailFactura.oc_cliente && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">OC Cliente</h4>
                  <p className="font-mono text-sm font-medium text-blue-600 dark:text-blue-400">{detailFactura.oc_cliente}</p>
                </div>
              )}

              {/* CAE */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">CAE</h4>
                {detailFactura.cae ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{detailFactura.cae}</span>
                    </div>
                    {detailFactura.cae_vencimiento && (
                      <p className="text-xs text-emerald-600/70 mt-1 ml-6">Vencimiento: {formatDate(detailFactura.cae_vencimiento)}</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50">Sin CAE — factura no autorizada por ARCA</div>
                )}
              </div>

              {/* Items */}
              {detailItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Items</h4>
                  <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                          <th className="text-left px-3 py-2 font-medium text-zinc-500">Descripcion</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">Cant.</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">P.Unit.</th>
                          <th className="text-right px-3 py-2 font-medium text-zinc-500">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailItems.map((it, idx) => (
                          <tr key={idx} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{it.descripcion}</td>
                            <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{it.cantidad}</td>
                            <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(it.precio_unitario), detailFactura.moneda as "USD" | "ARS")}</td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">{formatCurrency(Number(it.subtotal), detailFactura.moneda as "USD" | "ARS")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Importes */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Importes</h4>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-zinc-500">Neto gravado</span>
                    <span className="font-mono">{formatCurrency(Number(detailFactura.subtotal), detailFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(Number(detailFactura.iva), detailFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-sm border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <span className="text-zinc-700 dark:text-zinc-300">Total</span>
                    <span className="font-mono text-base">{formatCurrency(Number(detailFactura.total), detailFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {detailFactura.moneda === "USD" && detailFactura.tipo_cambio && (
                    <div className="flex items-center justify-between px-4 py-2 text-xs border-t border-zinc-100 dark:border-zinc-800 text-zinc-400">
                      <span>Operacion en USD — TC: {Number(detailFactura.tipo_cambio).toLocaleString("es-AR")}</span>
                      <span className="font-mono">USD {(Number(detailFactura.total) / Number(detailFactura.tipo_cambio)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notas de crédito relacionadas */}
              {detailNCs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Notas de crédito</h4>
                  <div className="space-y-1.5">
                    {detailNCs.map((nc) => (
                      <div key={nc.id} className="flex items-center justify-between rounded-lg border border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs">
                        <div>
                          <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">{formatComprobante(nc.tipo, nc.punto_venta, nc.numero)}</span>
                          <span className="text-zinc-400 ml-2">{formatDate(nc.fecha)}</span>
                          {nc.cae && <span className="text-emerald-600 dark:text-emerald-400 ml-2">CAE ✓</span>}
                        </div>
                        <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">{formatCurrency(Number(nc.total), detailFactura.moneda as "USD" | "ARS")}</span>
                      </div>
                    ))}
                  </div>
                  {Number(detailFactura.total_acreditado) > 0 && (
                    <div className="mt-2 flex justify-between text-xs text-amber-700 dark:text-amber-400 font-medium px-1">
                      <span>Total acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(detailFactura.total_acreditado), detailFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Acciones */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Acciones</h4>
                <div className="space-y-2">
                  {detailFactura.estado === "emitida" && (
                    <>
                      <button onClick={() => openCobroModal(detailFactura)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-emerald-950/30">
                        <DollarSign className="h-4 w-4" /> Registrar cobro
                      </button>
                      {["FA", "FB", "FCEA", "FCEB"].includes(detailFactura.tipo) && (
                        <button onClick={() => openNcModal(detailFactura)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-blue-950/30">
                          <FileText className="h-4 w-4" /> Emitir Nota de Crédito
                        </button>
                      )}
                      <button onClick={() => handleAnular(detailFactura.id)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-red-950/30">
                        <XCircle className="h-4 w-4" /> Anular comprobante
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cobro Modal ──────────────────────────────────────────── */}
      {cobroModalId && (() => {
        const f = facturas.find(ff => ff.id === cobroModalId);
        if (!f) return null;
        const saldo = Number(f.total) - Number(f.total_acreditado || 0) - cobroPrevios;
        const totalLineas = cobroLineas.reduce((s, l) => s + Number(l.monto || 0), 0);
        const lineasValidas = cobroLineas.some(l => Number(l.monto) > 0);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
                <div>
                  <h3 className="font-semibold dark:text-white">Registrar cobro</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {formatComprobante(f.tipo, f.punto_venta, f.numero)} — Total: {formatCurrency(Number(f.total), f.moneda as "ARS" | "USD")}
                  </p>
                  {cobroPreviosLoading ? (
                    <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Calculando saldo...</p>
                  ) : (
                    <p className="text-xs font-medium mt-0.5" style={{ color: (saldo - totalLineas) > 0 ? "#f59e0b" : "#10b981" }}>
                      {cobroPrevios > 0 && `Cobrado: ${formatCurrency(cobroPrevios, f.moneda as "ARS" | "USD")} — `}
                      Saldo pendiente: {formatCurrency(Math.max(0, saldo - totalLineas), f.moneda as "ARS" | "USD")}
                    </p>
                  )}
                </div>
                <button onClick={() => setCobroModalId(null)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              <div className="p-5 space-y-4">
                {/* Fecha comun */}
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fecha *</label>
                  <input type="date" value={cobroFecha} onChange={(e) => setCobroFecha(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                </div>

                {/* Lineas de pago */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Medios de pago</label>
                    <button onClick={() => setCobroLineas(prev => [...prev, { tipo: "transferencia", monto: "", descripcion: "" }])}
                      className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium">
                      <Plus className="h-3 w-3" /> Agregar medio
                    </button>
                  </div>
                  <div className="space-y-3">
                    {cobroLineas.map((linea, idx) => (
                      <div key={idx} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select value={linea.tipo} onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, tipo: e.target.value as any } : l))}
                            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm dark:text-white">
                            <option value="transferencia">Transferencia</option>
                            <option value="efectivo">Efectivo</option>
                            <option value="cheque_recibido">Cheque</option>
                            <option value="retencion_iibb">Ret. IIBB</option>
                            <option value="retencion_ganancias">Ret. Ganancias</option>
                            <option value="retencion_iva">Ret. IVA</option>
                            <option value="cobro">Otro</option>
                          </select>
                          <input type="number" step="0.01" placeholder="Monto" value={linea.monto}
                            onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, monto: e.target.value } : l))}
                            className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono dark:text-white" />
                          {cobroLineas.length > 1 && (
                            <button onClick={() => setCobroLineas(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <input type="text" placeholder="Descripcion (opcional)" value={linea.descripcion}
                          onChange={(e) => setCobroLineas(prev => prev.map((l, i) => i === idx ? { ...l, descripcion: e.target.value } : l))}
                          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs dark:text-white" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totales */}
                {totalLineas > 0 && (
                  <div className="space-y-1 px-1">
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-zinc-500">Total a registrar:</span>
                      <span className="font-mono dark:text-white">{formatCurrency(totalLineas, f.moneda as "ARS" | "USD")}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Saldo restante:</span>
                      <span className={`font-mono font-medium ${saldo - totalLineas <= 0 ? "text-emerald-600" : "text-amber-600"}`}>
                        {formatCurrency(Math.max(0, saldo - totalLineas), f.moneda as "ARS" | "USD")}
                      </span>
                    </div>
                  </div>
                )}

                {totalLineas >= saldo && saldo > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">Cubre el saldo completo — la factura se marcara como pagada</p>
                  </div>
                )}
                {totalLineas > saldo && saldo > 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">El monto excede el saldo pendiente por {formatCurrency(totalLineas - saldo, f.moneda as "ARS" | "USD")}</p>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
                <button onClick={() => setCobroModalId(null)} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
                <button onClick={handleRegistrarCobro} disabled={cobroSaving || !lineasValidas}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {cobroSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Registrar cobro{cobroLineas.length > 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── NC Modal ─────────────────────────────────────────────── */}
      {ncOpen && ncFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 bg-white dark:bg-zinc-900 z-10">
              <div>
                <h2 className="text-lg font-bold dark:text-white">Nota de Crédito</h2>
                <p className="text-sm text-zinc-400">
                  Para {formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)} — {ncFactura.clientes?.razon_social}
                </p>
              </div>
              <button onClick={() => setNcOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {ncStep === "form" && (
              <div className="p-6 space-y-5">
                {ncError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{ncError}</div>}

                {/* Referencia a la factura original */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-zinc-500">Comprobante original</span>
                    <span className="font-mono font-semibold">{formatComprobante(ncFactura.tipo, ncFactura.punto_venta, ncFactura.numero)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Total original</span>
                    <span className="font-mono">{formatCurrency(Number(ncFactura.total), ncFactura.moneda as "USD" | "ARS")}</span>
                  </div>
                  {Number(ncFactura.total_acreditado) > 0 && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400 mt-1">
                      <span>Ya acreditado</span>
                      <span className="font-mono">{formatCurrency(Number(ncFactura.total_acreditado), ncFactura.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                {/* Toggle ARCA / Manual */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 p-2">
                    <button
                      onClick={() => setNcManual(false)}
                      disabled={arcaStatus !== null && arcaStatus.certOk === false}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${!ncManual ? "bg-orange-500 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" /> Con ARCA
                    </button>
                    <button
                      onClick={() => setNcManual(true)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${ncManual ? "bg-zinc-700 text-white dark:bg-zinc-600" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                    >
                      <FileCheck className="h-3.5 w-3.5" /> Manual (sin CAE)
                    </button>
                  </div>
                  {arcaStatus !== null && arcaStatus.certOk === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> ARCA no configurado — solo modo manual disponible.
                    </p>
                  )}
                </div>

                {/* Número manual */}
                {ncManual && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">N° Comprobante *</label>
                      <input type="number" min={1} value={ncNumero} onChange={(e) => setNcNumero(e.target.value)} placeholder="00000001" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                    <div className="flex items-end pb-2">
                      <p className="text-xs text-amber-600 dark:text-amber-400">Sin CAE. Ajustá el número al talonario.</p>
                    </div>
                  </div>
                )}

                {/* Items NC — editables para NC parcial */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium dark:text-zinc-300">
                      Items a acreditar <span className="text-xs font-normal text-zinc-400">(editá para NC parcial)</span>
                    </label>
                    <button
                      onClick={() => setNcItems(p => [...p, { descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }])}
                      className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      <Plus className="h-3 w-3" /> Agregar
                    </button>
                  </div>
                  <div className="space-y-2">
                    {ncItems.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                        <div className={isFacturaANc ? "col-span-5" : "col-span-7"}>
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Descripción</label>}
                          <input value={item.descripcion} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, descripcion: e.target.value } : it))} placeholder="Descripción" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">Cant.</label>}
                          <input type="number" min={0} step="0.01" value={item.cantidad} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, cantidad: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        <div className="col-span-2">
                          {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">{isFacturaANc ? "Neto unit." : "Precio"}</label>}
                          <input type="number" step="0.01" min={0} value={item.precio_unitario || ""} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, precio_unitario: Number(e.target.value) } : it))} placeholder="0.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                        </div>
                        {isFacturaANc && (
                          <div className="col-span-2">
                            {idx === 0 && <label className="block text-xs text-zinc-400 mb-1">IVA %</label>}
                            <select value={item.iva_porcentaje} onChange={(e) => setNcItems(p => p.map((it, i) => i === idx ? { ...it, iva_porcentaje: Number(e.target.value) } : it))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                              <option value={21}>21%</option>
                              <option value={10.5}>10.5%</option>
                              <option value={27}>27%</option>
                              <option value={0}>0%</option>
                            </select>
                          </div>
                        )}
                        <div className="col-span-1 flex items-end">
                          {ncItems.length > 1 && (
                            <button onClick={() => setNcItems(p => p.filter((_, i) => i !== idx))} className="p-2 rounded hover:bg-red-50 text-red-400 hover:text-red-500">
                              <Minus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2 text-sm">
                  {isFacturaANc ? (
                    <>
                      <div className="flex justify-between"><span className="text-zinc-500">Neto gravado</span><span className="font-mono">{formatCurrency(ncTotals.neto, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-500">IVA</span><span className="font-mono">{formatCurrency(ncTotals.iva, ncFactura?.moneda as "USD" | "ARS")}</span></div>
                      <div className="flex justify-between border-t border-zinc-200 dark:border-zinc-700 pt-2 font-semibold text-base">
                        <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total NC</span><span className="font-mono">{formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setNcOpen(false)} className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:text-zinc-300 transition-colors">Cancelar</button>
                  <button
                    onClick={handleCreateNC}
                    disabled={ncSaving || ncTotals.total <= 0}
                    className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 ${ncManual ? "bg-zinc-700 hover:bg-zinc-800" : "bg-orange-500 hover:bg-orange-600"}`}
                  >
                    {ncManual ? <FileCheck className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {ncManual ? "Guardar NC manual" : "Emitir NC con ARCA"}
                  </button>
                </div>
              </div>
            )}

            {ncStep === "saving" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">{ncManual ? "Guardando nota de crédito..." : "Autorizando NC con ARCA..."}</p>
              </div>
            )}

            {ncStep === "success" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Nota de Crédito emitida</h3>
                <p className="text-sm font-mono text-emerald-700 dark:text-emerald-400">{ncResult}</p>
                <p className="text-xs text-zinc-400">Total acreditado: {formatCurrency(ncTotals.total, ncFactura?.moneda as "USD" | "ARS")}</p>
                <button onClick={() => setNcOpen(false)} className="mt-2 px-6 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">Cerrar</button>
              </div>
            )}

            {ncStep === "error" && (
              <div className="p-8 flex flex-col items-center gap-4">
                <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-lg font-bold dark:text-white">Error al emitir NC</h3>
                <p className="text-sm text-red-600 dark:text-red-400 text-center">{ncError}</p>
                <button onClick={() => setNcStep("form")} className="px-6 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">Volver</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
