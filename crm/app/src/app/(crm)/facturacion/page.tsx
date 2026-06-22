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
  ShieldCheck, KeyRound, Server, ClipboardCopy, Plus, Minus, Mail,
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
  clientes: { razon_social: string; cuit: string; condicion_iva?: string; email?: string; telefono?: string; direccion?: string; localidad?: string; provincia?: string } | null;
}

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
  const [arcaStatus, setArcaStatus] = useState<{ connected: boolean; error?: string; production?: boolean; ptoVta?: number } | null>(null);

  // Emit modal
  const [emitOpen, setEmitOpen] = useState(false);
  const [emitStep, setEmitStep] = useState<"form" | "emitting" | "success" | "error">("form");
  const [emitResult, setEmitResult] = useState<any>(null);
  const [emitError, setEmitError] = useState("");
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [emitData, setEmitData] = useState({
    tipo: "FA",
    cliente_id: "",
    punto_venta: 15,
    moneda: "ARS" as "ARS" | "USD",
    tipo_cambio: 0,
    items: [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }] as EmitItem[],
  });

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

  const filteredFacturas = facturas.filter((f) => {
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && f.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && f.fecha > fechaFilter.to) return false;
    if (filterValues.tipo && f.tipo !== filterValues.tipo) return false;
    if (filterValues.estado && f.estado !== filterValues.estado) return false;
    const montoFilter = filterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && Number(f.total) < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && Number(f.total) > montoFilter.max) return false;
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

      if (!error && data && data.length > 0) {
        setFacturas(data as unknown as FacturaRow[]);
      } else {
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

  // Check ARCA status on mount
  useEffect(() => {
    fetch(`/api/facturacion?action=status&sociedad_id=${sociedadActiva?.id || ""}`)
      .then((r) => r.json())
      .then(setArcaStatus)
      .catch(() => setArcaStatus({ connected: false, error: "No se pudo verificar" }));
  }, [sociedadActiva]);

  // ── Emit handlers ──────────────────────────────────────────────
  const openEmitModal = (prefill?: { cliente_id: string; tipo?: string; items?: EmitItem[]; moneda?: "ARS" | "USD"; tipo_cambio?: number }) => {
    setEmitData({
      tipo: prefill?.tipo || "FB",
      cliente_id: prefill?.cliente_id || "",
      punto_venta: emisorData.ptoVta,
      moneda: prefill?.moneda || "ARS",
      tipo_cambio: prefill?.tipo_cambio || 0,
      items: prefill?.items || [{ descripcion: "", cantidad: 1, precio_unitario: 0, iva_porcentaje: 21 }],
    });
    setEmitStep("form");
    setEmitError("");
    setEmitResult(null);
    setEmitOpen(true);
    // Fetch clientes
    supabase.from("clientes").select("id, razon_social, cuit, condicion_iva").eq("activo", true).order("razon_social")
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

  const isFacturaA = emitData.tipo === "FA" || emitData.tipo === "NCA";

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

  // ── Detail actions ─────────────────────────────────────────────
  async function handleAnular(id: string) {
    if (!confirm("¿Seguro que queres anular esta factura?")) return;
    try {
      await supabase.from("facturas").update({ estado: "anulada" } as any).eq("id", id);
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura(null);
    } catch (err) { console.error("Error anulando:", err); }
  }

  async function handleMarcarPagada(id: string) {
    try {
      await supabase.from("facturas").update({ estado: "pagada" } as any).eq("id", id);
      await fetchData();
      if (detailFactura?.id === id) setDetailFactura((p) => p ? { ...p, estado: "pagada" } : null);
    } catch (err) { console.error("Error:", err); }
  }

  // ── Copy & PDF ─────────────────────────────────────────────────
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
      `Neto: ${formatCurrency(Number(f.subtotal))}`,
      `IVA: ${formatCurrency(Number(f.iva))}`,
      `*Total: ${formatCurrency(Number(f.total))}*`,
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
      ...detailItems.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} x ${formatCurrency(it.precio_unitario)} = ${formatCurrency(it.subtotal)}`),
      "",
      `Subtotal: ${formatCurrency(Number(f.subtotal))}`,
      `IVA: ${formatCurrency(Number(f.iva))}`,
      `TOTAL: ${formatCurrency(Number(f.total))}`,
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
    const letraComprobante = f.tipo.replace("NC", "").replace("ND", "");
    const isFacturaBPdf = f.tipo === "FB" || f.tipo === "NCB";

    // Build QR data URL for ARCA verification
    const isUSDPdf = f.moneda === "USD" && f.tipo_cambio;
    const qrData = JSON.stringify({
      ver: 1, fecha: f.fecha, cuit: emisorData.cuitNumero, ptoVta: f.punto_venta,
      tipoCmp: { FA: 1, FB: 6, FC: 11, NCA: 3, NCB: 8, NCC: 13 }[f.tipo] || 1,
      nroCmp: f.numero, importe: Number(f.total), moneda: "PES", ctz: 1,
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
      <div class="fc-cod">COD. ${String({ FA: 1, FB: 6, FC: 11, NCA: 3, NCB: 8, NCC: 13 }[f.tipo] || 0).padStart(2, "0")}</div>
    </div>
  </div>
  <div class="fc-right">
    <div class="comp-tipo">${f.tipo.startsWith("NC") ? "NOTA DE CREDITO" : "FACTURA"}</div>
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
      <td class="right mono">${formatCurrency(Number(it.precio_unitario))}</td>
      ${isFacturaBPdf ? "" : `<td class="right">${it.iva_porcentaje}%</td>`}
      <td class="right mono">${formatCurrency(Number(it.subtotal))}</td>
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
      ? `<div class="total-line"><span>Subtotal</span><span class="mono">${formatCurrency(Number(f.total))}</span></div>
         <div class="total-line" style="color:#888;font-size:10px"><span>IVA incluido en precio</span><span class="mono">${formatCurrency(Number(f.iva))}</span></div>
         <div class="total-line final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total))}</span></div>`
      : `<div class="total-line"><span>Neto gravado</span><span class="mono">${formatCurrency(Number(f.subtotal))}</span></div>
         <div class="total-line"><span>IVA 21%</span><span class="mono">${formatCurrency(Number(f.iva))}</span></div>
         <div class="total-line final"><span>TOTAL</span><span class="mono">${formatCurrency(Number(f.total))}</span></div>`}
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
                <span className="font-mono font-semibold block text-right">{formatCurrency(Number(r.total))}</span>
              )},
              { key: "cae", label: "CAE", render: (r) => r.cae
                ? <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">{r.cae.slice(-8)}</span>
                : <span className="text-zinc-300">{"\u2014"}</span>
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
              supabase.from("factura_items").select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden")
                .then(({ data }) => setDetailItems((data || []).map(d => ({ ...d, subtotal: d.subtotal ?? 0 }))));
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
                <div className={`h-2 w-2 rounded-full ${arcaStatus?.connected ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus?.connected ? `Produccion — PV ${arcaStatus.ptoVta}` : "Pendiente de configuracion"}
                </span>
              </div>
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
                <div className={`h-2 w-2 rounded-full ${arcaStatus?.connected ? "bg-emerald-500" : "bg-amber-400"}`} />
                <span className="text-xs text-zinc-500">
                  {arcaStatus?.connected ? "Certificado valido" : "Pendiente — subir .crt a crm/certs/"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
              <p className="text-xs font-medium text-zinc-500 mb-2">CUIT emisor</p>
              <p className="text-xl font-bold font-mono dark:text-white">20-37930912-8</p>
              <p className="text-xs text-zinc-400 mt-1">Augusto Lazzari</p>
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
                <h2 className="text-lg font-bold dark:text-white">Emitir factura ARCA</h2>
                <p className="text-sm text-zinc-400">Se autorizara en tiempo real con ARCA</p>
              </div>
              <button onClick={() => setEmitOpen(false)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {emitStep === "form" && (
              <div className="p-6 space-y-5">
                {emitError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{emitError}</div>}

                {/* Tipo + Cliente + PV */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Tipo *</label>
                    <select value={emitData.tipo} onChange={(e) => setEmitData((p) => ({ ...p, tipo: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <optgroup label="Facturas">
                        <option value="FA">Factura A</option>
                        <option value="FB">Factura B</option>
                      </optgroup>
                      <optgroup label="Notas de credito">
                        <option value="NCA">NC A</option>
                        <option value="NCB">NC B</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="col-span-7">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cliente *</label>
                    <select value={emitData.cliente_id} onChange={(e) => setEmitData((p) => ({ ...p, cliente_id: e.target.value }))} className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm dark:text-white">
                      <option value="">Seleccionar cliente...</option>
                      {!isFacturaA && <option value="consumidor_final">Consumidor Final</option>}
                      {clientes.map((c) => <option key={c.id} value={c.id}>{c.razon_social} — {c.cuit || "Sin CUIT"}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1 dark:text-zinc-300">PV</label>
                    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm font-mono text-zinc-500 dark:text-zinc-400">
                      {String(emitData.punto_venta).padStart(4, "0")}
                    </div>
                  </div>
                </div>

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
                    <div className="col-span-4">
                      <label className="block text-sm font-medium mb-1 dark:text-zinc-300">Cotizacion USD/ARS *</label>
                      <input type="number" step="0.01" min={0} value={emitData.tipo_cambio || ""} onChange={(e) => setEmitData((p) => ({ ...p, tipo_cambio: Number(e.target.value) }))} placeholder="Ej: 1450.00" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm font-mono dark:text-white" />
                    </div>
                  )}
                  {isUSD && (
                    <div className="col-span-4 flex items-end">
                      <p className="text-xs text-zinc-400 pb-2">ARCA requiere la cotizacion oficial para facturas en USD.</p>
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
                  <button onClick={handleEmit} className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                    <ShieldCheck className="h-4 w-4" /> Emitir con ARCA
                  </button>
                </div>
              </div>
            )}

            {emitStep === "emitting" && (
              <div className="p-12 flex flex-col items-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
                <p className="text-sm text-zinc-500">Autorizando con ARCA...</p>
                <p className="text-xs text-zinc-400">Esto puede tomar unos segundos</p>
              </div>
            )}

            {emitStep === "success" && emitResult && (
              <div className="p-8 space-y-6">
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/30">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h3 className="text-lg font-bold dark:text-white">Factura emitida exitosamente</h3>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Comprobante</span><span className="font-mono font-bold">{emitResult.comprobante}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">CAE</span><span className="font-mono">{emitResult.cae}</span></div>
                  <div className="flex justify-between"><span className="text-emerald-700 dark:text-emerald-400">Vto CAE</span><span>{emitResult.cae_vencimiento ? formatDate(emitResult.cae_vencimiento) : "\u2014"}</span></div>
                  <div className="flex justify-between border-t border-emerald-200 dark:border-emerald-700 pt-2"><span className="text-emerald-700 dark:text-emerald-400 font-semibold">Total</span><span className="font-mono font-bold">{formatCurrency(emitResult.total)}</span></div>
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
                            <td className="px-3 py-2 text-right font-mono text-zinc-600 dark:text-zinc-400">{formatCurrency(Number(it.precio_unitario))}</td>
                            <td className="px-3 py-2 text-right font-mono font-medium text-zinc-700 dark:text-zinc-300">{formatCurrency(Number(it.subtotal))}</td>
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
                    <span className="font-mono">{formatCurrency(Number(detailFactura.subtotal))}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 text-sm border-t border-zinc-100 dark:border-zinc-800">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(Number(detailFactura.iva))}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-sm border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 font-semibold">
                    <span className="text-zinc-700 dark:text-zinc-300">Total</span>
                    <span className="font-mono text-base">{formatCurrency(Number(detailFactura.total))}</span>
                  </div>
                  {detailFactura.moneda === "USD" && detailFactura.tipo_cambio && (
                    <div className="flex items-center justify-between px-4 py-2 text-xs border-t border-zinc-100 dark:border-zinc-800 text-zinc-400">
                      <span>Operacion en USD — TC: {Number(detailFactura.tipo_cambio).toLocaleString("es-AR")}</span>
                      <span className="font-mono">USD {(Number(detailFactura.total) / Number(detailFactura.tipo_cambio)).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Acciones */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Acciones</h4>
                <div className="space-y-2">
                  {detailFactura.estado === "emitida" && (
                    <>
                      <button onClick={() => handleMarcarPagada(detailFactura.id)} className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-emerald-950/30">
                        <CheckCircle2 className="h-4 w-4" /> Marcar como pagada
                      </button>
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
    </>
  );
}
