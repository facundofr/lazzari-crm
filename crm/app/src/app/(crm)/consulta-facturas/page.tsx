"use client";

// Consulta de facturas (SOLO LECTURA), para todos los roles: facturas de venta y de compra.
// Venta: ver detalle, PDF y reenviarla al cliente por mail. Compra: ver detalle y el archivo del proveedor.
// No emite, no cobra, no paga, no anula: eso sigue en Finanzas (solo administración).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
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
import { cargarOPsDeFacturas, abrirOrdenPagoPDF, type OPResumen } from "@/lib/orden-pago-pdf";
import { Download, FileText, Mail, Paperclip, Search, X } from "lucide-react";

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

export default function ConsultaFacturasPage() {
  const { sociedadActiva, profile } = useUser();
  const { toast } = useToast();
  const [tab, setTab] = useState<"venta" | "compra">("venta");
  const [buscar, setBuscar] = useState("");
  const [ventas, setVentas] = useState<FacturaVenta[]>([]);
  const [compras, setCompras] = useState<FacturaCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venta, setVenta] = useState<FacturaVenta | null>(null);
  const [compra, setCompra] = useState<FacturaCompra | null>(null);
  const [itemsVenta, setItemsVenta] = useState<ItemVenta[]>([]);
  const [itemsCompra, setItemsCompra] = useState<ItemCompra[]>([]);
  const [opsCompra, setOpsCompra] = useState<OPResumen[] | null>(null);
  const [bajandoOP, setBajandoOP] = useState<string | null>(null);
  const [mail, setMail] = useState<{ open: boolean; to: string; subject: string; body: string; filename: string; sugeridos: { email: string; label?: string }[] }>({ open: false, to: "", subject: "", body: "", filename: "", sugeridos: [] });

  const cargar = useCallback(async () => {
    if (!sociedadActiva?.id) return;
    setCargando(true);
    setError(null);
    try {
      const [v, c] = await Promise.all([
        traerTodo<FacturaVenta>(() => (supabase as any).from("facturas")
          .select("id, tipo, punto_venta, numero, cliente_id, fecha, fecha_vencimiento, cae, cae_vencimiento, subtotal, iva, total, moneda, tipo_cambio, cotizacion_modalidad, estado, cheque_rechazado_at, presupuesto_id, oc_cliente, condicion_venta, observaciones, nota_interna, email_enviado_at, email_enviado_a, clientes(razon_social, cuit, condicion_iva, email, email_facturacion, telefono, direccion, localidad, provincia), presupuestos:presupuesto_id(numero, cotizacion_modalidad)")
          .eq("sociedad_id", sociedadActiva.id)
          .order("fecha", { ascending: false }).order("id", { ascending: true })),
        traerTodo<FacturaCompra>(() => (supabase as any).from("facturas_compra")
          .select("id, numero_factura, tipo_comprobante, fecha, fecha_vencimiento, subtotal, iva, percepciones, total, moneda, estado, notas, archivo_url, archivo_nombre, cae, proveedores(razon_social, nombre_fantasia, cuit), ordenes_compra:orden_compra_id(numero), factura_compra_ocs(ordenes_compra(numero))")
          .eq("sociedad_id", sociedadActiva.id)
          .order("fecha", { ascending: false }).order("id", { ascending: true })),
      ]);
      setVentas(v);
      setCompras(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron traer las facturas");
    } finally {
      setCargando(false);
    }
  }, [sociedadActiva?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const hoy = todayAR();
  const q = sinAcentos(buscar.trim());
  const ventasFiltradas = useMemo(() => !q ? ventas : ventas.filter((f) => sinAcentos([
    comprobante(f.tipo, f.punto_venta, f.numero), String(f.numero), f.clientes?.razon_social || "", f.clientes?.cuit || "",
    f.presupuestos?.numero || "", f.oc_cliente || "",
  ].join(" ")).includes(q)), [ventas, q]);
  const comprasFiltradas = useMemo(() => !q ? compras : compras.filter((f) => sinAcentos([
    f.numero_factura, f.tipo_comprobante || "", f.proveedores?.razon_social || "", f.proveedores?.nombre_fantasia || "", f.proveedores?.cuit || "",
    ocsDe(f).join(" "),
  ].join(" ")).includes(q)), [compras, q]);

  async function abrirVenta(f: FacturaVenta) {
    setVenta(f);
    setItemsVenta([]);
    const { data } = await (supabase as any).from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden");
    setItemsVenta((data || []).map((d: ItemVenta) => ({ ...d, subtotal: d.subtotal ?? 0 })));
  }

  async function abrirCompra(f: FacturaCompra) {
    setCompra(f);
    setItemsCompra([]);
    setOpsCompra(null);
    const [{ data }, ops] = await Promise.all([
      (supabase as any).from("facturas_compra_items")
        .select("codigo, descripcion, cantidad, precio_unitario, descuento_porcentaje, iva_porcentaje, unidad").eq("factura_compra_id", f.id),
      cargarOPsDeFacturas(supabase, [f.id]).catch(() => [] as OPResumen[]),
    ]);
    setItemsCompra(data || []);
    setOpsCompra(ops);
  }

  async function bajarOP(opId: string) {
    if (!sociedadActiva) return;
    setBajandoOP(opId);
    try { await abrirOrdenPagoPDF(supabase, opId, sociedadActiva); }
    catch (e) { toast.error(`No se pudo armar el PDF de la orden de pago: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBajandoOP(null); }
  }

  async function htmlVenta(f: FacturaVenta): Promise<string | null> {
    if (!sociedadActiva) return null;
    const { data } = await (supabase as any).from("factura_items")
      .select("descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal").eq("factura_id", f.id).order("orden");
    const items: ItemVenta[] = data || [];
    const cli = f.clientes;
    return generateFacturaPDF({
      tipo: f.tipo, punto_venta: f.punto_venta, numero: f.numero, fecha: f.fecha, fecha_vencimiento: f.fecha_vencimiento,
      nota_interna: f.nota_interna, observaciones: f.observaciones, condicion_venta: f.condicion_venta,
      moneda: f.moneda as Moneda, tipo_cambio: f.tipo_cambio,
      cotizacion_modalidad: f.cotizacion_modalidad || f.presupuestos?.cotizacion_modalidad || null,
      subtotal: Number(f.subtotal), iva: Number(f.iva), total: Number(f.total), cae: f.cae, cae_vencimiento: f.cae_vencimiento, oc_cliente: f.oc_cliente,
      cliente: cli ? { razon_social: cli.razon_social, cuit: cli.cuit, condicion_iva: cli.condicion_iva, direccion: cli.direccion, localidad: cli.localidad, provincia: cli.provincia, email: cli.email, telefono: cli.telefono } : null,
      items: items.map((it) => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: Number(it.precio_unitario), iva_porcentaje: it.iva_porcentaje, subtotal: Number(it.subtotal ?? 0) })),
    } as any, emisorDeSociedad(sociedadActiva.nombre), getSociedadPDF(sociedadActiva));
  }

  async function verPdf(f: FacturaVenta) {
    const html = await htmlVenta(f);
    if (html) openPDFWindow(html, documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social));
  }

  async function prepararMail(f: FacturaVenta) {
    const comp = comprobante(f.tipo, f.punto_venta, f.numero);
    const template = await loadEmailTemplate("factura", sociedadActiva?.id || "");
    const vars = {
      comprobante: comp, numero: comp, sociedad: sociedadActiva?.razonSocial || sociedadActiva?.nombre || "Lazzari",
      total: formatCurrency(Number(f.total), f.moneda as Moneda), fecha: formatDate(f.fecha), cliente: f.clientes?.razon_social || "",
    };
    const sugeridos: { email: string; label?: string }[] = [];
    for (const e of (f.clientes?.email_facturacion || "").split(",").map((s) => s.trim()).filter(Boolean)) sugeridos.push({ email: e, label: "Facturación" });
    if (f.clientes?.email && !sugeridos.some((s) => s.email === f.clientes!.email)) sugeridos.push({ email: f.clientes.email, label: "Cliente" });
    try {
      const { data: contactos } = await (supabase as any).from("contactos").select("nombre, email").eq("entity_type", "cliente").eq("entity_id", f.cliente_id);
      for (const c of contactos || []) if (c.email && !sugeridos.some((s) => s.email === c.email)) sugeridos.push({ email: c.email, label: c.nombre || "Contacto" });
    } catch { /* sin contactos */ }
    setMail({
      open: true,
      to: f.clientes?.email_facturacion?.split(",")[0]?.trim() || f.clientes?.email || "",
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: documentFilename(f.tipo, f.punto_venta, f.numero, f.clientes?.razon_social),
      sugeridos,
    });
  }

  const colVentas: Column<FacturaVenta>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => formatDate(f.fecha) },
    { key: "comp", label: "Comprobante", sortable: true, sortValue: (f) => `${f.tipo}${String(f.numero).padStart(8, "0")}`, render: (f) => <span className="font-mono text-xs">{comprobante(f.tipo, f.punto_venta, f.numero)}</span> },
    { key: "cliente", label: "Cliente", sortable: true, sortValue: (f) => f.clientes?.razon_social || "", render: (f) => f.clientes?.razon_social || "—" },
    { key: "pr", label: "PR / OC", render: (f) => <span className="text-xs text-zinc-500">{[f.presupuestos?.numero, f.oc_cliente ? `OC ${f.oc_cliente}` : null].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => Number(f.total), className: "text-right", render: (f) => <span className="tabular-nums">{formatCurrency(Number(f.total), f.moneda as Moneda)}</span> },
    { key: "estado", label: "Estado", render: (f) => { if (f.tipo.startsWith("NC") && f.estado !== "anulada") return <Badge variant="purple">Nota de crédito</Badge>; const e = ESTADO_VENTA[estadoVisibleFactura(f, f.fecha_vencimiento, hoy)] || { label: f.estado, variant: "default" as const }; return <Badge variant={e.variant}>{e.label}</Badge>; } },
    { key: "mail", label: "Enviada", render: (f) => f.email_enviado_at ? <span className="text-xs text-emerald-600" title={f.email_enviado_a || ""}>✓ {formatDate(f.email_enviado_at)}</span> : <span className="text-xs text-zinc-400">—</span> },
  ];

  const colCompras: Column<FacturaCompra>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => formatDate(f.fecha) },
    { key: "comp", label: "Comprobante", sortable: true, sortValue: (f) => f.numero_factura, render: (f) => <span className="font-mono text-xs">{[f.tipo_comprobante, f.numero_factura].filter(Boolean).join(" ")}</span> },
    { key: "prov", label: "Proveedor", sortable: true, sortValue: (f) => f.proveedores?.razon_social || "", render: (f) => f.proveedores?.nombre_fantasia || f.proveedores?.razon_social || "—" },
    { key: "oc", label: "OC", render: (f) => <span className="text-xs text-zinc-500">{ocsDe(f).join(", ") || "—"}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => Number(f.total), className: "text-right", render: (f) => <span className="tabular-nums">{formatCurrency(Number(f.total), f.moneda as Moneda)}</span> },
    { key: "estado", label: "Estado", render: (f) => <Badge variant={f.estado === "pagada" ? "success" : f.estado === "anulada" ? "default" : "info"}>{f.estado === "pagada" ? "Pagada" : f.estado === "anulada" ? "Anulada" : "A pagar"}</Badge> },
    { key: "archivo", label: "", render: (f) => f.archivo_url ? <Paperclip className="h-3.5 w-3.5 text-zinc-400" /> : null },
  ];

  const fila = (label: React.ReactNode, valor: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-zinc-500">{label}</span><span className="text-right text-zinc-900 dark:text-zinc-100">{valor}</span></div>
  );

  return (
    <>
      <Header title="Facturas" subtitle="Consulta de facturas de venta y de compra (solo lectura)" />
      <div className="space-y-2.5 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
            {(["venta", "compra"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${tab === t ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                {t === "venta" ? `De venta (${ventas.length})` : `De compra (${compras.length})`}
              </button>
            ))}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)}
              placeholder={tab === "venta" ? "Buscar por cliente, CUIT, número, PR u OC del cliente" : "Buscar por proveedor, CUIT, número u OC"}
              className="h-8 w-full rounded-lg border border-zinc-200 py-1 pl-8 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Card>
          {tab === "venta"
            ? <DataTable columns={colVentas} data={ventasFiltradas} onRowClick={abrirVenta} loading={cargando} emptyMessage="No hay facturas de venta con ese filtro" />
            : <DataTable columns={colCompras} data={comprasFiltradas} onRowClick={abrirCompra} loading={cargando} emptyMessage="No hay facturas de compra con ese filtro" />}
        </Card>
      </div>

      {venta && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setVenta(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white"><FileText className="h-4 w-4" /> {comprobante(venta.tipo, venta.punto_venta, venta.numero)}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{venta.clientes?.razon_social} · CUIT {venta.clientes?.cuit}</p>
              </div>
              <button type="button" onClick={() => setVenta(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => verPdf(venta)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /> Ver / bajar PDF</button>
              <button type="button" onClick={() => prepararMail(venta)} className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600"><Mail className="h-4 w-4" /> Reenviar al cliente</button>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fila("Fecha", formatDate(venta.fecha))}
              {fila("Vencimiento", venta.fecha_vencimiento ? formatDate(venta.fecha_vencimiento) : "—")}
              {fila("Estado", (ESTADO_VENTA[estadoVisibleFactura(venta, venta.fecha_vencimiento, hoy)] || { label: venta.estado }).label)}
              {fila("Presupuesto", venta.presupuestos?.numero || "—")}
              {fila("OC del cliente", venta.oc_cliente || "—")}
              {fila("Condición de venta", venta.condicion_venta || "—")}
              {fila("CAE", venta.cae ? `${venta.cae}${venta.cae_vencimiento ? ` (vto. ${formatDate(venta.cae_vencimiento)})` : ""}` : "—")}
              {fila("Enviada por mail", venta.email_enviado_at ? `${formatDate(venta.email_enviado_at)}${venta.email_enviado_a ? ` a ${venta.email_enviado_a}` : ""}` : "No figura enviada")}
              {fila("Subtotal", formatCurrency(Number(venta.subtotal), venta.moneda as Moneda))}
              {fila("IVA", formatCurrency(Number(venta.iva), venta.moneda as Moneda))}
              {fila(<b>Total</b>, <b>{formatCurrency(Number(venta.total), venta.moneda as Moneda)}</b>)}
            </div>
            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Renglones</h3>
            <div className="space-y-1">
              {itemsVenta.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                  <span className="text-zinc-800 dark:text-zinc-200">{it.cantidad} × {it.descripcion}</span>
                  <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{formatCurrency(Number(it.precio_unitario), venta.moneda as Moneda)}</span>
                </div>
              ))}
              {!itemsVenta.length && <p className="text-xs text-zinc-400">Cargando renglones…</p>}
            </div>
            {venta.observaciones && <p className="mt-3 whitespace-pre-wrap text-xs text-zinc-500">{venta.observaciones}</p>}
          </div>
        </div>
      )}

      {compra && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setCompra(null)}>
          <div className="h-full w-full max-w-xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900 dark:text-white"><FileText className="h-4 w-4" /> {[compra.tipo_comprobante, compra.numero_factura].filter(Boolean).join(" ")}</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{compra.proveedores?.razon_social}{compra.proveedores?.cuit ? ` · CUIT ${compra.proveedores.cuit}` : ""}</p>
              </div>
              <button type="button" onClick={() => setCompra(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            {compra.archivo_url && (
              <a href={compra.archivo_url} target="_blank" rel="noreferrer" className="mb-3 inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">
                <Paperclip className="h-4 w-4" /> Ver factura del proveedor{compra.archivo_nombre ? ` (${compra.archivo_nombre})` : ""}
              </a>
            )}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {fila("Fecha", formatDate(compra.fecha))}
              {fila("Vencimiento", compra.fecha_vencimiento ? formatDate(compra.fecha_vencimiento) : "—")}
              {fila("OC", ocsDe(compra).join(", ") || "—")}
              {fila("Estado", compra.estado === "pagada" ? "Pagada" : compra.estado === "anulada" ? "Anulada" : "A pagar")}
              {fila("CAE", compra.cae || "—")}
              {fila("Subtotal", formatCurrency(Number(compra.subtotal), compra.moneda as Moneda))}
              {fila("IVA", formatCurrency(Number(compra.iva), compra.moneda as Moneda))}
              {Number(compra.percepciones || 0) > 0 && fila("Percepciones", formatCurrency(Number(compra.percepciones), compra.moneda as Moneda))}
              {fila(<b>Total</b>, <b>{formatCurrency(Number(compra.total), compra.moneda as Moneda)}</b>)}
            </div>
            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Renglones</h3>
            <div className="space-y-1">
              {itemsCompra.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                  <span className="text-zinc-800 dark:text-zinc-200">{it.cantidad} {it.unidad || ""} × {it.codigo ? `[${it.codigo}] ` : ""}{it.descripcion}</span>
                  <span className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{formatCurrency(Number(it.precio_unitario), compra.moneda as Moneda)}{Number(it.descuento_porcentaje || 0) > 0 ? ` −${it.descuento_porcentaje}%` : ""}</span>
                </div>
              ))}
              {!itemsCompra.length && <p className="text-xs text-zinc-400">Sin renglones cargados (puede ser una factura cargada solo con totales).</p>}
            </div>
            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Órdenes de pago</h3>
            {opsCompra === null ? <p className="text-xs text-zinc-400">Buscando…</p> : opsCompra.length === 0 ? <p className="text-xs text-zinc-400">Sin orden de pago todavía.</p> : (
              <div className="space-y-1">
                {opsCompra.map((op) => (
                  <div key={op.id} className="flex items-center justify-between gap-2 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                    <span className="text-zinc-800 dark:text-zinc-200">{op.numero} · {formatDate(op.fecha)} · {formatCurrency(op.neto, op.moneda)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {op.certificado_retencion_url && <a href={op.certificado_retencion_url} target="_blank" rel="noreferrer" className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">Certificado</a>}
                      <button type="button" disabled={bajandoOP === op.id} onClick={() => bajarOP(op.id)} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"><Download className="h-3 w-3" /> {bajandoOP === op.id ? "Armando…" : "PDF"}</button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {compra.notas && <p className="mt-3 whitespace-pre-wrap text-xs text-zinc-500">{compra.notas}</p>}
          </div>
        </div>
      )}

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
        onSuccess={async (emailId) => {
          if (!venta) return;
          // Marca de envío con función de la base (los vendedores no pueden cambiar facturas).
          const { error: e } = await (supabase as any).rpc("marcar_factura_enviada", { p_factura_id: venta.id, p_to: mail.to || null, p_resend_id: emailId || null });
          if (e) console.error("No se pudo guardar la marca de envío:", e);
          toast.success("Factura enviada");
          setMail((m) => ({ ...m, open: false }));
          await cargar();
        }}
      />
    </>
  );
}
