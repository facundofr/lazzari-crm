"use client";

// Consulta de facturas (SOLO LECTURA), para todos los roles: facturas de venta y de compra.
// Venta: ver detalle, PDF y reenviarla al cliente por mail. Compra: ver detalle y el archivo del proveedor.
// No emite, no cobra, no paga, no anula: eso sigue en Finanzas (solo administración).
// La usan el menú "Facturas" (/consulta-facturas) y Finanzas Lazza (`completa`: pestaña "Todas" + filtros de estado, moneda y fechas,
// y en compras la columna "OP" al final para descargar la orden de pago que la pagó — Augusto 19/10/2026).
// En Finanzas Lazza (`completa`) las facturas de venta con saldo tienen "Cobrar": la misma liquidación de Finanzas (finanzas-lazza/cobrar.tsx).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { generateFacturaPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64, documentFilename } from "@/lib/pdf-templates";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { estadoVisibleFactura } from "@/lib/estado-factura-venta";
import { emisorDeSociedad } from "@/lib/emisor-sociedad";
import { cargarOPsDeFacturas, abrirOrdenPagoPDF, opsPorFactura, type OPResumen } from "@/lib/orden-pago-pdf";
import { CreditCard, Download, Eye, FileText, HandCoins, Mail, Paperclip, Search, X } from "lucide-react";
import { movimientoPagoTarjeta, registrarPagoTarjeta, tarjetaSugerida, traerTarjetas, type Tarjeta } from "@/lib/pago-tarjeta";
import { CobrarCliente } from "@/components/finanzas-lazza/cobrar";
import { EnviarOrdenPago, verOP } from "@/components/finanzas-lazza/orden-pago-doc";
import { destinatariosCortos } from "@/lib/envio-factura-texto";

type Moneda = "ARS" | "USD";

interface FacturaVenta {
  id: string;
  tipo: string;
  punto_venta: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  fecha_vencimiento: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  tipo_cambio: number | null;
  cotizacion_modalidad: "divisas" | "billetes" | null;
  estado: string;
  cheque_rechazado_at?: string | null;
  presupuesto_id: string | null;
  oc_cliente: string | null;
  condicion_venta: string | null;
  observaciones: string | null;
  nota_interna: string | null;
  email_enviado_at: string | null;
  email_enviado_a: string | null;
  clientes: { razon_social: string; cuit: string; condicion_iva?: string; email?: string; email_facturacion?: string; telefono?: string; direccion?: string; localidad?: string; provincia?: string } | null;
  presupuestos: { numero: string; cotizacion_modalidad?: "divisas" | "billetes" | null } | null;
}

interface FacturaCompra {
  id: string;
  numero_factura: string;
  tipo_comprobante: string | null;
  fecha: string;
  fecha_vencimiento: string | null;
  subtotal: number;
  iva: number;
  percepciones: number | null;
  total: number;
  moneda: string;
  estado: string;
  notas: string | null;
  archivo_url: string | null;
  archivo_nombre: string | null;
  cae: string | null;
  proveedores: { razon_social: string; nombre_fantasia: string | null; cuit: string | null } | null;
  ordenes_compra: { numero: string } | null;
  factura_compra_ocs?: { ordenes_compra: { numero: string } | null }[] | null;
}

const SELECT_VENTA = "id, tipo, punto_venta, numero, cliente_id, fecha, fecha_vencimiento, cae, cae_vencimiento, subtotal, iva, total, moneda, tipo_cambio, cotizacion_modalidad, estado, cheque_rechazado_at, presupuesto_id, oc_cliente, condicion_venta, observaciones, nota_interna, email_enviado_at, email_enviado_a, clientes(razon_social, cuit, condicion_iva, email, email_facturacion, telefono, direccion, localidad, provincia), presupuestos:presupuesto_id(numero, cotizacion_modalidad)";
const SELECT_COMPRA = "id, proveedor_id, numero_factura, tipo_comprobante, fecha, fecha_vencimiento, subtotal, iva, percepciones, total, moneda, estado, notas, archivo_url, archivo_nombre, cae, proveedores(razon_social, nombre_fantasia, cuit), ordenes_compra:orden_compra_id(numero), factura_compra_ocs(ordenes_compra(numero))";

// Todas las OC de la factura (la columna vieja orden_compra_id y la tabla factura_compra_ocs).
const ocsDe = (f: FacturaCompra) => Array.from(new Set([f.ordenes_compra?.numero, ...(f.factura_compra_ocs || []).map((x) => x.ordenes_compra?.numero)].filter(Boolean) as string[]));

type ItemVenta = { descripcion: string; cantidad: number; precio_unitario: number; iva_porcentaje: number; subtotal: number };
type ItemCompra = { codigo: string | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_porcentaje: number | null; iva_porcentaje: number | null; unidad: string | null };

const comprobante = (tipo: string, pv: number, num: number) => `${tipo} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ESTADO_VENTA: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" | "info" }> = {
  pagada: { label: "Cobrada", variant: "success" },
  pendiente: { label: "Pendiente", variant: "info" },
  vencida: { label: "Vencida", variant: "danger" },
  parcial: { label: "Cobro parcial", variant: "warning" },
  anulada: { label: "Anulada", variant: "default" },
  cheque_rechazado: { label: "Cheque rechazado", variant: "danger" },
};

type EstadoFiltro = "" | "pendiente" | "cerrada" | "nc" | "anulada";

/** Fila de la vista "Todas" (venta y compra juntas). */
interface FilaTodas {
  id: string;
  lado: "venta" | "compra";
  fecha: string;
  comprobante: string;
  nombre: string;
  ref: string;
  total: number;
  moneda: Moneda;
  estado: { label: string; variant: "success" | "warning" | "danger" | "default" | "info" | "purple" };
  venta?: FacturaVenta;
  compra?: FacturaCompra;
}

export function FacturasConsulta({ completa = false }: { completa?: boolean }) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [tab, setTab] = useState<"todas" | "venta" | "compra">(completa ? "todas" : "venta");
  const [buscar, setBuscar] = useState("");
  const [fEstado, setFEstado] = useState<EstadoFiltro>("");
  const [fMoneda, setFMoneda] = useState<"" | Moneda>("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [ventas, setVentas] = useState<FacturaVenta[]>([]);
  const [compras, setCompras] = useState<FacturaCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venta, setVenta] = useState<FacturaVenta | null>(null);
  const [compra, setCompra] = useState<FacturaCompra | null>(null);
  const [bajandoOP, setBajandoOP] = useState<string | null>(null);
  const [opsDeFC, setOpsDeFC] = useState<Map<string, OPResumen[]>>(new Map());
  const [cobrando, setCobrando] = useState<FacturaVenta | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadActiva?.id) return;
    setCargando(true);
    setError(null);
    try {
      const [v, c] = await Promise.all([
        traerTodo<FacturaVenta>(() => (supabase as any).from("facturas")
          .select(SELECT_VENTA)
          .eq("sociedad_id", sociedadActiva.id)
          .order("fecha", { ascending: false }).order("id", { ascending: true })),
        traerTodo<FacturaCompra>(() => (supabase as any).from("facturas_compra")
          .select(SELECT_COMPRA)
          .eq("sociedad_id", sociedadActiva.id)
          .order("fecha", { ascending: false }).order("id", { ascending: true })),
      ]);
      setVentas(v);
      setCompras(c);
      if (completa) opsPorFactura(supabase, c.map((f) => f.id)).then(setOpsDeFC).catch(() => setOpsDeFC(new Map()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron traer las facturas");
    } finally {
      setCargando(false);
    }
  }, [sociedadActiva?.id, completa]);

  useEffect(() => { cargar(); }, [cargar]);

  const hoy = todayAR();
  const q = sinAcentos(buscar.trim());
  // Filtros de estado, moneda y fechas (solo en la versión completa).
  const pasaFiltros = useCallback((tipo: string | null, estado: string, moneda: string, fecha: string) => {
    if (fMoneda && (moneda === "USD" ? "USD" : "ARS") !== fMoneda) return false;
    const f = String(fecha || "").slice(0, 10);
    if (fDesde && f < fDesde) return false;
    if (fHasta && f > fHasta) return false;
    if (fEstado) {
      const nc = String(tipo || "").toUpperCase().startsWith("NC");
      const clase: EstadoFiltro = estado === "anulada" ? "anulada" : nc ? "nc" : estado === "pagada" ? "cerrada" : "pendiente";
      if (clase !== fEstado) return false;
    }
    return true;
  }, [fEstado, fMoneda, fDesde, fHasta]);
  const ventasFiltradas = useMemo(() => ventas.filter((f) => pasaFiltros(f.tipo, f.estado, f.moneda, f.fecha)).filter((f) => !q || sinAcentos([
    comprobante(f.tipo, f.punto_venta, f.numero), String(f.numero), f.clientes?.razon_social || "", f.clientes?.cuit || "",
    f.presupuestos?.numero || "", f.oc_cliente || "",
  ].join(" ")).includes(q)), [ventas, q, pasaFiltros]);
  const comprasFiltradas = useMemo(() => compras.filter((f) => pasaFiltros(f.tipo_comprobante, f.estado, f.moneda, f.fecha)).filter((f) => !q || sinAcentos([
    f.numero_factura, f.tipo_comprobante || "", f.proveedores?.razon_social || "", f.proveedores?.nombre_fantasia || "", f.proveedores?.cuit || "",
    ocsDe(f).join(" "),
  ].join(" ")).includes(q)), [compras, q, pasaFiltros]);
  const todasFiltradas = useMemo<FilaTodas[]>(() => [
    ...ventasFiltradas.map((f): FilaTodas => ({
      id: `v-${f.id}`, lado: "venta", fecha: f.fecha, comprobante: comprobante(f.tipo, f.punto_venta, f.numero),
      nombre: f.clientes?.razon_social || "—", ref: [f.presupuestos?.numero, f.oc_cliente ? `OC ${f.oc_cliente}` : null].filter(Boolean).join(" · "),
      total: Number(f.total), moneda: f.moneda === "USD" ? "USD" : "ARS", estado: estadoVenta(f), venta: f,
    })),
    ...comprasFiltradas.map((f): FilaTodas => ({
      id: `c-${f.id}`, lado: "compra", fecha: f.fecha, comprobante: [f.tipo_comprobante, f.numero_factura].filter(Boolean).join(" "),
      nombre: f.proveedores?.nombre_fantasia || f.proveedores?.razon_social || "—", ref: ocsDe(f).join(", "),
      total: Number(f.total), moneda: f.moneda === "USD" ? "USD" : "ARS", estado: estadoCompra(f), compra: f,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha)), [ventasFiltradas, comprasFiltradas]); // eslint-disable-line react-hooks/exhaustive-deps

  function estadoVenta(f: FacturaVenta): FilaTodas["estado"] {
    if (f.tipo.startsWith("NC") && f.estado !== "anulada") return { label: "Nota de crédito", variant: "purple" };
    return ESTADO_VENTA[estadoVisibleFactura(f, f.fecha_vencimiento, hoy)] || { label: f.estado, variant: "default" };
  }
  function estadoCompra(f: FacturaCompra): FilaTodas["estado"] {
    if (String(f.tipo_comprobante || "").toUpperCase().startsWith("NC") && f.estado !== "anulada") return { label: "Nota de crédito", variant: "purple" };
    return f.estado === "pagada" ? { label: "Pagada", variant: "success" } : f.estado === "anulada" ? { label: "Anulada", variant: "default" } : { label: "A pagar", variant: "info" };
  }

  function abrirVenta(f: FacturaVenta) { setVenta(f); }
  function abrirCompra(f: FacturaCompra) { setCompra(f); }

  async function bajarOP(opId: string) {
    if (!sociedadActiva) return;
    setBajandoOP(opId);
    try { await abrirOrdenPagoPDF(supabase, opId, sociedadActiva); }
    catch (e) { toast.error(`No se pudo armar el PDF de la orden de pago: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBajandoOP(null); }
  }

  // Cobrar (solo Finanzas Lazza): facturas de venta impagas; el saldo real lo verifica la ventana de cobro.
  const cobrable = (f: FacturaVenta) => completa && !!f.cliente_id && ["emitida", "parcial", "vencida"].includes(f.estado) && !String(f.tipo || "").toUpperCase().startsWith("NC");
  const botonCobrar = (f: FacturaVenta) => (cobrable(f) ? (
    <button type="button" onClick={(e) => { e.stopPropagation(); setCobrando(f); }} title="Cobrar esta factura (podés sumar otras del cliente)"
      className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
      <HandCoins className="h-3.5 w-3.5" /> Cobrar
    </button>
  ) : null);

  const colVentas: Column<FacturaVenta>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => formatDate(f.fecha) },
    { key: "comp", label: "Comprobante", sortable: true, sortValue: (f) => `${f.tipo}${String(f.numero).padStart(8, "0")}`, render: (f) => <span className="font-mono text-xs">{comprobante(f.tipo, f.punto_venta, f.numero)}</span> },
    { key: "cliente", label: "Cliente", sortable: true, sortValue: (f) => f.clientes?.razon_social || "", render: (f) => f.clientes?.razon_social || "—" },
    { key: "pr", label: "PR / OC", render: (f) => <span className="text-xs text-zinc-500">{[f.presupuestos?.numero, f.oc_cliente ? `OC ${f.oc_cliente}` : null].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => Number(f.total), className: "text-right", render: (f) => <span className="tabular-nums">{formatCurrency(Number(f.total), f.moneda as Moneda)}</span> },
    { key: "estado", label: "Estado", render: (f) => { const e = estadoVenta(f); return <Badge variant={e.variant}>{e.label}</Badge>; } },
    { key: "mail", label: "Enviada", render: (f) => f.email_enviado_at ? (
      <span className="block max-w-[220px]" title={`Enviada el ${formatDate(f.email_enviado_at)}${f.email_enviado_a ? ` a ${f.email_enviado_a}` : ""}`}>
        <span className="text-xs text-emerald-600">✓ {formatDate(f.email_enviado_at)}</span>
        {destinatariosCortos(f.email_enviado_a) && <span className="block truncate text-[10px] text-zinc-400">{destinatariosCortos(f.email_enviado_a)}</span>}
      </span>
    ) : <span className="text-xs text-zinc-400">—</span> },
    ...(completa ? [{ key: "cobrar", label: "", render: botonCobrar }] : []),
  ];

  // Columna OP: cada orden de pago (sin anuladas) que pagó la factura, con su PDF.
  const celdaOP = (facturaId: string) => {
    const ops = opsDeFC.get(facturaId) || [];
    if (!ops.length) return <span className="text-xs text-zinc-300">—</span>;
    return (
      <span className="flex flex-col items-start gap-0.5">
        {ops.map((op) => (
          <button key={op.id} type="button" disabled={bajandoOP === op.id} onClick={(e) => { e.stopPropagation(); bajarOP(op.id); }} title="Descargar la orden de pago"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1 font-mono text-xs text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-zinc-800">
            <Download className="h-3 w-3" /> {bajandoOP === op.id ? "Armando…" : op.numero}
          </button>
        ))}
      </span>
    );
  };

  const colCompras: Column<FacturaCompra>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => formatDate(f.fecha) },
    { key: "comp", label: "Comprobante", sortable: true, sortValue: (f) => f.numero_factura, render: (f) => <span className="font-mono text-xs">{[f.tipo_comprobante, f.numero_factura].filter(Boolean).join(" ")}</span> },
    { key: "prov", label: "Proveedor", sortable: true, sortValue: (f) => f.proveedores?.razon_social || "", render: (f) => f.proveedores?.nombre_fantasia || f.proveedores?.razon_social || "—" },
    { key: "oc", label: "OC", render: (f) => <span className="text-xs text-zinc-500">{ocsDe(f).join(", ") || "—"}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => Number(f.total), className: "text-right", render: (f) => <span className="tabular-nums">{formatCurrency(Number(f.total), f.moneda as Moneda)}</span> },
    { key: "estado", label: "Estado", render: (f) => <Badge variant={f.estado === "pagada" ? "success" : f.estado === "anulada" ? "default" : "info"}>{f.estado === "pagada" ? "Pagada" : f.estado === "anulada" ? "Anulada" : "A pagar"}</Badge> },
    { key: "archivo", label: "", render: (f) => f.archivo_url ? <Paperclip className="h-3.5 w-3.5 text-zinc-400" /> : null },
    ...(completa ? [{ key: "op", label: "OP", render: (f: FacturaCompra) => celdaOP(f.id) }] : []),
  ];

  const colTodas: Column<FilaTodas>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => formatDate(f.fecha) },
    { key: "lado", label: "Tipo", sortable: true, sortValue: (f) => f.lado, render: (f) => <Badge variant={f.lado === "venta" ? "success" : "warning"}>{f.lado === "venta" ? "Venta" : "Compra"}</Badge> },
    { key: "comp", label: "Comprobante", sortable: true, sortValue: (f) => f.comprobante, render: (f) => <span className="font-mono text-xs">{f.comprobante}</span> },
    { key: "nombre", label: "Cliente / Proveedor", sortable: true, sortValue: (f) => f.nombre, render: (f) => f.nombre },
    { key: "ref", label: "PR / OC", render: (f) => <span className="text-xs text-zinc-500">{f.ref || "—"}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="tabular-nums">{formatCurrency(f.total, f.moneda)}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (f) => f.estado.label, render: (f) => <Badge variant={f.estado.variant}>{f.estado.label}</Badge> },
    ...(completa ? [{ key: "op", label: "OP / Cobrar", render: (f: FilaTodas) => (f.compra ? celdaOP(f.compra.id) : f.venta ? botonCobrar(f.venta) : null) }] : []),
  ];

  const fila = (label: React.ReactNode, valor: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-zinc-500">{label}</span><span className="text-right text-zinc-900 dark:text-zinc-100">{valor}</span></div>
  );

  return (
    <>
      <div className={completa ? "space-y-2.5" : "space-y-2.5 p-3 sm:p-4"}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
            {(completa ? (["todas", "venta", "compra"] as const) : (["venta", "compra"] as const)).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${tab === t ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                {t === "todas" ? `Todas (${todasFiltradas.length})` : t === "venta" ? `De venta (${(completa ? ventasFiltradas : ventas).length})` : `De compra (${(completa ? comprasFiltradas : compras).length})`}
              </button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder={tab === "venta" ? "Buscar por cliente, CUIT, número, PR u OC del cliente" : tab === "compra" ? "Buscar por proveedor, CUIT, número u OC" : "Buscar por cliente o proveedor, CUIT, número, PR u OC"}
              className="h-8 w-full rounded-lg border border-zinc-200 py-1 pl-8 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
          {completa && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <select value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoFiltro)} className="h-8 rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="cerrada">Cobradas / pagadas</option>
                <option value="nc">Notas de crédito</option>
                <option value="anulada">Anuladas</option>
              </select>
              <select value={fMoneda} onChange={(e) => setFMoneda(e.target.value as "" | Moneda)} className="h-8 rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">$ y US$</option><option value="ARS">$</option><option value="USD">US$</option>
              </select>
              <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} title="Desde" className="h-8 rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-900" />
              <input type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} title="Hasta" className="h-8 rounded-lg border border-zinc-200 px-2 dark:border-zinc-700 dark:bg-zinc-900" />
              {(fEstado || fMoneda || fDesde || fHasta) && <button type="button" onClick={() => { setFEstado(""); setFMoneda(""); setFDesde(""); setFHasta(""); }} className="text-xs text-orange-600 hover:underline">Limpiar</button>}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Card>
          {tab === "todas"
            ? <DataTable columns={colTodas} data={todasFiltradas} onRowClick={(f) => (f.venta ? abrirVenta(f.venta) : f.compra ? abrirCompra(f.compra) : undefined)} loading={cargando} emptyMessage="No hay facturas con ese filtro" />
            : tab === "venta"
            ? <DataTable columns={colVentas} data={ventasFiltradas} onRowClick={abrirVenta} loading={cargando} emptyMessage="No hay facturas de venta con ese filtro" />
            : <DataTable columns={colCompras} data={comprasFiltradas} onRowClick={abrirCompra} loading={cargando} emptyMessage="No hay facturas de compra con ese filtro" />}
        </Card>
      </div>

      {venta && <FichaFacturaVenta factura={venta} onClose={() => setVenta(null)} cobrable={cobrable(venta)} onCobrar={() => setCobrando(venta)} onEnviada={() => void cargar()} />}
      {compra && <FichaFacturaCompra factura={compra} onClose={() => setCompra(null)} conAcciones={completa} />}
      {cobrando && sociedadActiva?.id && (
        <CobrarCliente sociedadId={sociedadActiva.id} clienteId={cobrando.cliente_id} clienteNombre={cobrando.clientes?.razon_social || ""} preseleccion={[cobrando.id]}
          onClose={() => setCobrando(null)} onCobrado={() => { setVenta(null); void cargar(); }} />
      )}
    </>
  );
}

// ── Fichas de una factura (las usan esta consulta y Finanzas Lazza › Facturas) ──

const filaFicha = (label: React.ReactNode, valor: React.ReactNode) => (
  <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-zinc-500">{label}</span><span className="text-right text-zinc-900 dark:text-zinc-100">{valor}</span></div>
);
const botonFicha = "inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800";

/** Trae la factura por id si no vino armada. */
function useFactura<T>(tabla: string, select: string, factura?: T | null, facturaId?: string | null): T | null {
  const [cargada, setCargada] = useState<T | null>(factura ?? null);
  useEffect(() => {
    if (factura) { setCargada(factura); return; }
    if (!facturaId) return;
    let vivo = true;
    (supabase as any).from(tabla).select(select).eq("id", facturaId).maybeSingle().then(({ data }: any) => { if (vivo) setCargada(data || null); });
    return () => { vivo = false; };
  }, [tabla, select, factura, facturaId]);
  return cargada;
}

/**
 * Ficha de una factura de venta: datos, renglones, Ver / Descargar el PDF y Enviar al cliente (marca de enviada).
 * `extra`: lo que se muestra abajo (en Finanzas Lazza: "Cobrada con", los recibos con Ver / Descargar / Enviar).
 */
export function FichaFacturaVenta({ factura, facturaId, cobrable = false, onCobrar, onClose, onEnviada, extra }: {
  factura?: FacturaVenta | null; facturaId?: string | null; cobrable?: boolean; onCobrar?: () => void;
  onClose: () => void; onEnviada?: () => void; extra?: React.ReactNode;
}) {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const venta = useFactura<FacturaVenta>("facturas", SELECT_VENTA, factura, facturaId);
  const [items, setItems] = useState<ItemVenta[] | null>(null);
  const [mail, setMail] = useState<{ open: boolean; to: string; subject: string; body: string; filename: string; sugeridos: { email: string; label?: string }[] }>({ open: false, to: "", subject: "", body: "", filename: "", sugeridos: [] });
  const hoy = todayAR();

  useEffect(() => {
    if (!venta?.id) return;
    let vivo = true;
    setItems(null);
    (supabase as any).from("factura_items").select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", venta.id).order("orden")
      .then(({ data }: any) => { if (vivo) setItems((data || []).map((d: ItemVenta) => ({ ...d, subtotal: d.subtotal ?? 0 }))); });
    return () => { vivo = false; };
  }, [venta?.id]);

  async function htmlVenta(f: FacturaVenta): Promise<string | null> {
    if (!sociedadActiva) return null;
    const { data } = await (supabase as any).from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden");
    const its: ItemVenta[] = data || [];
    const cli = f.clientes;
    return generateFacturaPDF({
      tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero, fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento,
      nota_interna: f.nota_interna, observaciones: f.observaciones, condicion_venta: f.condicion_venta,
      moneda: f.moneda as Moneda, tipo_cambio: f.tipo_cambio,
      cotizacion_modalidad: f.cotizacion_modalidad || f.presupuestos?.cotizacion_modalidad || null,
      subtotal: Number(f.subtotal), iva: Number(f.iva), total: Number(f.total), cae: f.cae, cae_vencimiento: f.cae_vencimiento, oc_cliente: f.oc_cliente,
      cliente: cli ? { razon_social: cli.razon_social, cuit: cli.cuit, condicion_iva: cli.condicion_iva, direccion: cli.direccion, localidad: cli.localidad, provincia: cli.provincia, email: cli.email, telefono: cli.telefono } : null,
      items: its.map((it) => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje, subtotal: Number(it.subtotal ?? 0) })),
    } as any, emisorDeSociedad(sociedadActiva.nombre), getSociedadPDF(sociedadActiva));
  }

  async function pdf(f: FacturaVenta, ver: boolean) {
    const html = await htmlVenta(f);
    if (html) openPDFWindow(html, ver ? undefined : documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social), ver);
  }

  async function prepararMail(f: FacturaVenta) {
    const comp = comprobante(f.tipo, f.punto_venta, f.numero);
    const template = await loadEmailTemplate("factura", sociedadActiva?.id || "");
    const vars = {
      comprobante: comp, numero: comp, sociedad: sociedadActiva?.razonSocial || sociedadActiva?.nombre || "Lazzari",
      total: formatCurrency(Number(f.total), f.moneda as Moneda), fecha: formatDate(f.fecha), cliente: f.clientes?.razon_social || "",
    };
    const sugeridos: { email: string; label?: string }[] = [];
    for (const e of (f.clientes?.email_facturacion || "").split(",").map((x) => x.trim()).filter(Boolean)) sugeridos.push({ email: e, label: "Facturación" });
    if (f.clientes?.email && !sugeridos.some((x) => x.email === f.clientes!.email)) sugeridos.push({ email: f.clientes.email, label: "Cliente" });
    try {
      const { data: contactos } = await (supabase as any).from("contactos").select("nombre, email").eq("entity_type", "cliente").eq("entity_id", f.cliente_id);
      for (const c of contactos || []) if (c.email && !sugeridos.some((x) => x.email === c.email)) sugeridos.push({ email: c.email, label: c.nombre || "Contacto" });
    } catch { /* sin contactos */ }
    // El solicitante del PR va primero y marcado en "Para".
    let solicitante = "";
    if (f.presupuesto_id) {
      try {
        const { data: pr } = await (supabase as any).from("presupuestos").select("contacto:contacto_id(nombre, email)").eq("id", f.presupuesto_id).maybeSingle();
        solicitante = String(pr?.contacto?.email || "").trim();
        if (solicitante) {
          const label = `⭐ Solicitante: ${pr.contacto.nombre || solicitante}`;
          const ya = sugeridos.find((x) => x.email.toLowerCase() === solicitante.toLowerCase());
          if (ya) ya.label = label; else sugeridos.unshift({ email: solicitante, label });
        }
      } catch { /* sin PR */ }
    }
    const base = f.clientes?.email_facturacion?.split(",")[0]?.trim() || f.clientes?.email || "";
    setMail({
      open: true,
      to: [base, solicitante].filter((e, i, arr) => e && arr.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i).join(", "),
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social),
      sugeridos,
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
        <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
          {!venta ? <p className="text-sm text-zinc-500">Cargando…</p> : (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white"><FileText className="h-4 w-4" /> {comprobante(venta.tipo, venta.punto_venta, venta.numero)}</h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{venta.clientes?.razon_social} · CUIT {venta.clientes?.cuit}</p>
                </div>
                <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => pdf(venta, true)} className={botonFicha}><Eye className="h-4 w-4" /> Ver</button>
                <button type="button" onClick={() => pdf(venta, false)} className={botonFicha}><Download className="h-4 w-4" /> Descargar</button>
                <button type="button" onClick={() => prepararMail(venta)} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"><Mail className="h-4 w-4" /> Enviar al cliente</button>
                {cobrable && onCobrar && <button type="button" onClick={onCobrar} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"><HandCoins className="h-4 w-4" /> Cobrar</button>}
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filaFicha("Fecha", formatDate(venta.fecha))}
                {filaFicha("Vencimiento", venta.fecha_vencimiento ? formatDate(venta.fecha_vencimiento) : "—")}
                {filaFicha("Estado", (ESTADO_VENTA[estadoVisibleFactura(venta, venta.fecha_vencimiento, hoy)] || { label: venta.estado }).label)}
                {filaFicha("Presupuesto", venta.presupuestos?.numero || "—")}
                {filaFicha("OC del cliente", venta.oc_cliente || "—")}
                {filaFicha("Condición de venta", venta.condicion_venta || "—")}
                {filaFicha("CAE", venta.cae ? `${venta.cae}${venta.cae_vencimiento ? ` (vto. ${formatDate(venta.cae_vencimiento)})` : ""}` : "—")}
                {filaFicha("Enviada por mail", venta.email_enviado_at ? `${formatDate(venta.email_enviado_at)}${venta.email_enviado_a ? ` a ${venta.email_enviado_a}` : ""}` : "No figura enviada")}
                {filaFicha("Subtotal", formatCurrency(Number(venta.subtotal), venta.moneda as Moneda))}
                {filaFicha("IVA", formatCurrency(Number(venta.iva), venta.moneda as Moneda))}
                {filaFicha(<b>Total</b>, <b>{formatCurrency(Number(venta.total), venta.moneda as Moneda)}</b>)}
              </div>
              {extra}
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Renglones</h3>
              <div className="space-y-1">
                {(items || []).map((it, i) => (
                  <div key={i} className="flex justify-between gap-3 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                    <span className="text-zinc-800 dark:text-zinc-200">{it.cantidad} × {it.descripcion}</span>
                    <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{formatCurrency(Number(it.precio_unitario), venta.moneda as Moneda)}</span>
                  </div>
                ))}
                {items === null ? <p className="text-xs text-zinc-400">Cargando renglones…</p> : !items.length && <p className="text-xs text-zinc-400">Sin renglones.</p>}
              </div>
              {venta.observaciones && <p className="mt-3 whitespace-pre-wrap text-xs text-zinc-500">{venta.observaciones}</p>}
            </>
          )}
        </div>
      </div>
      <EmailComposeModal
        open={mail.open}
        onClose={() => setMail((m) => ({ ...m, open: false }))}
        documentType="factura"
        sociedadId={sociedadActiva?.id}
        userEmail={profile?.email || undefined}
        suggestedEmails={mail.sugeridos}
        guardarContacto={venta?.cliente_id ? { entityType: "cliente", entityId: venta.cliente_id, cargo: "Administración" } : undefined}
        defaultTo={mail.to}
        defaultSubject={mail.subject}
        defaultBody={mail.body}
        pdfFilename={mail.filename}
        generatePdf={async () => {
          if (!venta) throw new Error("Factura no encontrada");
          const html = await htmlVenta(venta);
          if (!html) throw new Error("No se pudo generar el PDF");
          return htmlToPdfBase64(html);
        }}
        onSuccess={async (emailId, enviadoA) => {
          if (!venta) return;
          // Marca de envío con función de la base (los vendedores no pueden cambiar facturas).
          const { error: e } = await (supabase as any).rpc("marcar_factura_enviada", { p_factura_id: venta.id, p_to: (enviadoA?.length ? enviadoA.join(", ") : mail.to) || null, p_resend_id: emailId || null });
          if (e) console.error("No se pudo guardar la marca de envío:", e);
          toast.success("Factura enviada");
          setMail((m) => ({ ...m, open: false }));
          onEnviada?.();
        }}
      />
    </>
  );
}

/**
 * Ficha de una factura de compra: datos, renglones, archivo del proveedor (Ver / Descargar) y las OP que la pagaron.
 * `conAcciones` (Finanzas Lazza): en cada OP, Ver, Descargar y Enviar por mail (la misma ventana de la OP).
 */
export function FichaFacturaCompra({ factura, facturaId, onClose, conAcciones = false, onCambio }: {
  factura?: FacturaCompra | null; facturaId?: string | null; onClose: () => void; conAcciones?: boolean;
  /** Después de marcarla pagada con tarjeta (para recargar la lista de atrás). */
  onCambio?: () => void;
}) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const compra = useFactura<FacturaCompra>("facturas_compra", SELECT_COMPRA, factura, facturaId);
  const [items, setItems] = useState<ItemCompra[] | null>(null);
  const [ops, setOps] = useState<OPResumen[] | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  // "Vino a Pagos pero se pagó con tarjeta" (20/10): la misma función de la base que Compras Lazza (paga solo el saldo, no duplica).
  const [tarjetas, setTarjetas] = useState<Tarjeta[] | null>(null);
  const [tarjetaId, setTarjetaId] = useState("");
  const [marcando, setMarcando] = useState(false);
  const sePuedeConTarjeta = conAcciones && !!compra && !["pagada", "anulada"].includes(compra.estado) && !String(compra.tipo_comprobante || "").toUpperCase().startsWith("NC");

  useEffect(() => {
    if (!sePuedeConTarjeta || tarjetas || !sociedadActiva?.id) return;
    traerTarjetas(supabase, sociedadActiva.id).then((t) => {
      setTarjetas(t);
      setTarjetaId((tarjetaSugerida(t, { ocConTarjeta: true }) || t[0])?.id || "");
    }).catch(() => setTarjetas([]));
  }, [sePuedeConTarjeta, tarjetas, sociedadActiva?.id]);

  async function pagadaConTarjeta() {
    const t = (tarjetas || []).find((x) => x.id === tarjetaId);
    if (!compra || !t || !sociedadActiva) return;
    if (!confirm(`¿Marcar ${[compra.tipo_comprobante, compra.numero_factura].filter(Boolean).join(" ")} como pagada con ${t.nombre}?\n\nSe registra el pago por lo que falta pagar, sale de Pagos y la deuda pasa a la tarjeta.`)) return;
    setMarcando(true);
    const r = await registrarPagoTarjeta(supabase, compra.id, t, movimientoPagoTarjeta({
      sociedadId: sociedadActiva.id, proveedorId: (compra as any).proveedor_id || "", facturaId: compra.id, tarjeta: t, total: Number(compra.total), moneda: compra.moneda,
      fecha: compra.fecha, comprobante: [compra.tipo_comprobante, compra.numero_factura].filter(Boolean).join(" "), proveedorNombre: compra.proveedores?.razon_social,
    }));
    setMarcando(false);
    if (r.error) { toast.error(`No se pudo registrar el pago con tarjeta: ${r.error}`); return; }
    toast.success(`Pagada con ${t.nombre}`);
    onCambio?.();
    onClose();
  }

  useEffect(() => {
    if (!compra?.id) return;
    let vivo = true;
    setItems(null); setOps(null);
    Promise.all([
      (supabase as any).from("facturas_compra_items").select("codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, iva_porcentaje, unidad").eq("factura_compra_id", compra.id),
      cargarOPsDeFacturas(supabase, [compra.id]).catch(() => [] as OPResumen[]),
    ]).then(([{ data }, o]) => { if (vivo) { setItems(data || []); setOps(o); } });
    return () => { vivo = false; };
  }, [compra?.id]);

  async function op(opId: string, ver: boolean) {
    if (!sociedadActiva) return;
    setBajando(opId);
    try {
      if (ver) await verOP(opId, sociedadActiva);
      else await abrirOrdenPagoPDF(supabase, opId, sociedadActiva);
    } catch (e) { toast.error(`No se pudo armar el PDF de la orden de pago: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBajando(null); }
  }

  const chico = "inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800";
  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
        <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
          {!compra ? <p className="text-sm text-zinc-500">Cargando…</p> : (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white"><FileText className="h-4 w-4" /> {[compra.tipo_comprobante, compra.numero_factura].filter(Boolean).join(" ")}</h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{compra.proveedores?.razon_social}{compra.proveedores?.cuit ? ` · CUIT ${compra.proveedores.cuit}` : ""}</p>
                </div>
                <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                {compra.archivo_url ? (
                  <>
                    <a href={compra.archivo_url} target="_blank" rel="noreferrer" className={botonFicha}><Eye className="h-4 w-4" /> Ver factura del proveedor</a>
                    <a href={compra.archivo_url} download={compra.archivo_nombre || true} target="_blank" rel="noreferrer" className={botonFicha}><Download className="h-4 w-4" /> Descargar</a>
                  </>
                ) : <span className="text-xs text-zinc-400">Sin archivo del proveedor cargado.</span>}
              </div>
              {sePuedeConTarjeta && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-sm dark:border-blue-900 dark:bg-blue-950/30">
                  <CreditCard className="h-4 w-4 text-blue-600" />
                  <span className="text-blue-800 dark:text-blue-200">¿Ya se pagó con tarjeta?</span>
                  {tarjetas === null ? <span className="text-xs text-zinc-500">Buscando tarjetas…</span> : tarjetas.length === 0 ? <span className="text-xs text-zinc-500">No hay tarjetas cargadas (Bancos).</span> : (
                    <>
                      <select value={tarjetaId} onChange={(e) => setTarjetaId(e.target.value)} className="h-7 rounded border border-zinc-200 bg-white px-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                        {tarjetas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                      </select>
                      <button type="button" disabled={marcando || !tarjetaId} onClick={pagadaConTarjeta}
                        className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">{marcando ? "Guardando…" : "Marcar pagada con tarjeta"}</button>
                    </>
                  )}
                </div>
              )}
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filaFicha("Fecha", formatDate(compra.fecha))}
                {filaFicha("Vencimiento", compra.fecha_vencimiento ? formatDate(compra.fecha_vencimiento) : "—")}
                {filaFicha("OC", ocsDe(compra).join(", ") || "—")}
                {filaFicha("Estado", compra.estado === "pagada" ? "Pagada" : compra.estado === "anulada" ? "Anulada" : "A pagar")}
                {filaFicha("CAE", compra.cae || "—")}
                {filaFicha("Subtotal", formatCurrency(Number(compra.subtotal), compra.moneda as Moneda))}
                {filaFicha("IVA", formatCurrency(Number(compra.iva), compra.moneda as Moneda))}
                {Number(compra.percepciones || 0) > 0 && filaFicha("Percepciones", formatCurrency(Number(compra.percepciones), compra.moneda as Moneda))}
                {filaFicha(<b>Total</b>, <b>{formatCurrency(Number(compra.total), compra.moneda as Moneda)}</b>)}
              </div>
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Órdenes de pago</h3>
              {ops === null ? <p className="text-xs text-zinc-400">Buscando…</p> : ops.length === 0 ? <p className="text-xs text-zinc-400">Sin orden de pago todavía.</p> : (
                <div className="space-y-1">
                  {ops.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                      <span className="text-zinc-800 dark:text-zinc-200">{o.numero} · {formatDate(o.fecha)} · {formatCurrency(o.neto, o.moneda)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {o.certificado_retencion_url && <a href={o.certificado_retencion_url} target="_blank" rel="noreferrer" className={chico}>Certificado</a>}
                        {conAcciones && <button type="button" disabled={bajando === o.id} onClick={() => op(o.id, true)} className={chico}><Eye className="h-3 w-3" /> Ver</button>}
                        <button type="button" disabled={bajando === o.id} onClick={() => op(o.id, false)} className={chico}><Download className="h-3 w-3" /> {bajando === o.id ? "Armando…" : conAcciones ? "Descargar" : "PDF"}</button>
                        {conAcciones && <button type="button" onClick={() => setEnviando(o.id)} className={chico}><Mail className="h-3 w-3" /> Enviar</button>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Renglones</h3>
              <div className="space-y-1">
                {(items || []).map((it, i) => (
                  <div key={i} className="flex justify-between gap-3 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                    <span className="text-zinc-800 dark:text-zinc-200">{it.cantidad} {it.unidad || ""} × {it.codigo ? `[${it.codigo}] ` : ""}{it.descripcion}</span>
                    <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{formatCurrency(Number(it.precio_unitario), compra.moneda as Moneda)}{Number(it.descuento_porcentaje || 0) > 0 ? ` −${it.descuento_porcentaje}%` : ""}</span>
                  </div>
                ))}
                {items !== null && !items.length && <p className="text-xs text-zinc-400">Sin renglones cargados (puede ser una factura cargada solo con totales).</p>}
              </div>
              {compra.notas && <p className="mt-3 whitespace-pre-wrap text-xs text-zinc-500">{compra.notas}</p>}
            </>
          )}
        </div>
      </div>
      {enviando && <EnviarOrdenPago opId={enviando} onClose={() => setEnviando(null)} />}
    </>
  );
}
