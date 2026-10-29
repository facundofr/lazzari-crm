"use client";

// Lista de presupuestos (la pantalla "de siempre"). Desde el 20/10/2026 se muestra como pestaña "Presupuestos" de /presupuestos (antes era la página /presupuestos sola).

import { AvisoBCRA, avisoBCRARojo } from "@/components/clientes/bcra-card";
import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { OcClienteBloque } from "@/components/presupuestos/oc-cliente-bloque";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { generatePresupuestoPDF, getSociedadPDF, openPDFWindow, htmlToPdfBase64 } from "@/lib/pdf-templates";
import type { Presupuesto, PRStatus } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import {
  Search, Send, Eye, Copy, FileText, CheckCircle2, XCircle, Clock,
  PauseCircle, Edit3, Loader2, X, Trash2, ArrowRight, AlertTriangle, Plus, Minus,
  Printer, Sparkles, Download, ClipboardCopy, Check, Mail, GripVertical,
  Phone, CalendarClock, Inbox, Paperclip, Upload, Truck, Receipt,
  Maximize2, ImagePlus,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { SmartFilters, type FilterConfig, type FilterValues } from "@/components/ui/smart-filters";
import { useUser } from "@/lib/auth-context";
import CatalogoPicker, { filaListaAItem, traerListaCompleta, buscarProveedorCRM, type FilaLista } from "@/components/presupuestos/catalogo-picker";
import DescripcionLista from "@/components/presupuestos/descripcion-lista";
import { type FilaPrecioAnterior, type LineaCosto, type MejorCosto } from "@/components/presupuestos/precios-costos-ia";
import { claveArticulo, ultimosPrecios, filaPorCodigo, resumenPresupuesto, precioDesdeMarkup, type PRVendido } from "@/lib/presupuesto-ayudas";
import AsistentePR from "@/components/presupuestos/asistente-pr";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { useRefrescarAlVolver } from "@/lib/use-refrescar";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import EnviarOCProveedor from "@/components/enviar-oc-proveedor";
import { calculateOwnStockPurchaseOrder, groupOwnStockItemsByCurrency, normalizePurchaseCurrency } from "@/lib/own-stock-purchase-orders";
import { estadoPorRecibido } from "@/lib/compras-recepcion";
import { calculateNetPrice, parseQuantityRange, type PriceListRule } from "@/lib/price-list-rules";
import { observacionesParaCliente } from "@/lib/observaciones-cliente";
import { margenPR, MARGEN_MINIMO_PR, gastosPorcentajePR, margenNetoPct, costoEnMonedaPR } from "@/lib/presupuesto-margen";
import { RemitoVentana } from "@/components/remito-ventana";
import { traerSaldoUnCliente } from "@/lib/cuenta-corriente-cliente";
import { VentaCaidaOCs } from "@/components/presupuestos/venta-caida-ocs";
import { superaLimiteCredito } from "@/lib/saldo-clientes";
import { enviosPorPR, textoEnvio, type EnvioPR } from "@/lib/presupuesto-envios";
import { parseCantidadAR, textoCantidadValido, numeroAEditable, formatCantidad, avisosRenglon, renglonesSinPrecio } from "@/lib/numero-ar";
import { convertirCostoPR, leerDolaresGuardados, fechaDolarPresupuesto, dolarAtrasado, etiquetaDolar, esCostoUsd, esCostoDivisa, tcParaCosto, type DolaresGuardados } from "@/lib/dolar-presupuesto";

/** Number input that allows typing decimals (e.g. "10.") without losing the dot.
 *  `miles`: se escribe a la argentina ("1.000" = mil, coma decimal); lo usa Cantidad. */
function NumInput({ value, onChange, className, miles, ...props }: { value: number | string; onChange: (n: number) => void; className?: string; miles?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type">) {
  const mostrar = (v: number | string) => (miles ? numeroAEditable(Number(v) || 0) : (v === 0 ? "" : String(v ?? "")));
  const [raw, setRaw] = useState<string>(miles ? mostrar(value) : String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setRaw(mostrar(value)); }, [value]);
  if (miles) return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        // Cantidad sin coma: si quedó algo que no es entero ("29.9"), vuelve al valor anterior.
        const n = raw.trim() === "" ? 0 : parseCantidadAR(raw);
        if (isNaN(n)) { setRaw(mostrar(value)); return; }
        setRaw(numeroAEditable(n)); onChange(n);
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/,/g, "");
        if (!textoCantidadValido(v)) return;
        setRaw(v);
        const n = parseCantidadAR(v);
        if (!isNaN(n)) onChange(n);
      }}
      className={className}
      {...props}
    />
  );
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; const n = Number(raw) || 0; setRaw(n === 0 ? "" : String(n)); onChange(n); }}
      onChange={(e) => {
        const v = e.target.value.replace(",", ".");
        if (v === "" || v === "." || /^\d*\.?\d*$/.test(v)) {
          setRaw(v);
          const n = Number(v);
          if (!isNaN(n) && v !== "" && !v.endsWith(".")) onChange(n);
        }
      }}
      className={className}
      {...props}
    />
  );
}

/** Compact proveedor picker for PR item rows — searchable with portal dropdown */
function ProveedorItemPicker({ value, stockPropio, options, onChange, nombreLista }: {
  value: string;
  stockPropio: boolean;
  /** Proveedor como figura en la lista de costos, cuando todavía no está vinculado con uno del CRM. */
  nombreLista?: string;
  options: { id: string; razon_social: string }[];
  onChange: (provId: string, provNombre: string, esStockPropio: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const label = stockPropio ? "Stock propio" : (options.find(p => p.id === value)?.razon_social || "");

  const filtered = useMemo(() => {
    if (!q.trim()) return options.slice(0, 30);
    const lower = q.toLowerCase();
    return options.filter(p => p.razon_social.toLowerCase().includes(lower)).slice(0, 30);
  }, [options, q]);

  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 200 && r.top > 200;
    setStyle({
      position: "fixed", left: r.left, width: Math.max(r.width, 220), zIndex: 9999,
      ...(up ? { bottom: window.innerHeight - r.top + 2 } : { top: r.bottom + 2 }),
    });
  }, []);

  useEffect(() => { if (open) updatePos(); }, [open, updatePos]);

  return (
    <div className="relative">
      {open ? (
        <input
          ref={inputRef}
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => { updatePos(); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar proveedor..."
          className="w-full rounded border border-orange-400 px-1.5 py-1 text-xs dark:border-orange-600 dark:bg-zinc-800 dark:text-white focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setQ(""); setOpen(true); }}
          className="w-full text-left rounded border border-zinc-200 px-1.5 py-1 text-xs truncate dark:border-zinc-700 dark:bg-zinc-800 dark:text-white hover:border-orange-300"
          title={label || (nombreLista ? `En la lista figura "${nombreLista}". Elegí a qué proveedor del CRM corresponde y queda guardado.` : "Sin proveedor")}
        >
          {label || (nombreLista ? <span className="font-medium text-red-600">⚠ {nombreLista}</span> : <span className="text-zinc-400">Sin proveedor</span>)}
        </button>
      )}
      {open && typeof document !== "undefined" && createPortal(
        <div style={style} className="rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 max-h-48 overflow-y-auto">
          <button type="button" onMouseDown={e => { e.preventDefault(); onChange("", "", false); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Sin proveedor
          </button>
          <button type="button" onMouseDown={e => { e.preventDefault(); onChange("", "Stock propio", true); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30">
            Stock propio — genera OC interna
          </button>
          {filtered.map(p => (
            <button key={p.id} type="button" onMouseDown={e => { e.preventDefault(); onChange(p.id, p.razon_social, false); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-orange-50 dark:hover:bg-orange-900/20 ${p.id === value ? "bg-orange-50 font-semibold dark:bg-orange-900/30" : ""}`}>
              {p.razon_social}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-xs text-zinc-400">Sin resultados</p>}
        </div>,
        document.body
      )}
    </div>
  );
}

interface SupabasePresupuesto {
  id: string;
  numero: string;
  cliente_id: string;
  fecha: string;
  vencimiento: string;
  estado: PRStatus;
  motivo_rechazo?: string | null;
  markup_general: number;
  descuento_general_porcentaje?: number | null;
  subtotal: number;
  iva: number;
  total: number;
  moneda: "USD" | "ARS";
  tipo_cambio: number | null;
  tipo_cambio_divisas?: number | null;
  cotizacion_modalidad?: "divisas" | "billetes" | null;
  observaciones: string;
  notas_internas: string;
  enviado_at?: string | null;
  respondido_at?: string | null;
  version?: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  vendedor_id: string | null;
  oc_cliente?: string | null;
  oc_cliente_fecha?: string | null;
  tipo_comprobante?: string | null;
  modalidad_emision?: string | null;
  archivo_url?: string | null;
  archivo_nombre?: string | null;
  sucursal_id?: string | null;
  contacto_id?: string | null;
  clientes?: { razon_social: string; cuit: string; email?: string | null; telefono?: string | null; direccion?: string | null; localidad?: string | null; provincia?: string | null; condicion_iva?: string | null; limite_credito?: number | null; saldo_cuenta_corriente?: number | null } | null;
  created_by_profile?: { full_name: string } | null;
  vendedor_profile?: { full_name: string; avatar_url: string | null } | null;
  sucursal?: { nombre: string; direccion?: string | null; localidad?: string | null; provincia?: string | null } | null;
  contacto?: { nombre: string } | null;
  presupuesto_items?: PresupuestoItem[];
}

interface PresupuestoItem {
  id?: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precio_costo: number;
  costo_moneda?: string;
  markup_porcentaje: number;
  precio_venta: number;
  precio_lista?: number | null;
  subtotal: number;
  iva_porcentaje?: number;
  iva: number;
  total: number;
  orden?: number;
}

function mapToPresupuesto(row: SupabasePresupuesto): Presupuesto {
  const isManual = row.modalidad_emision === "manual";
  return {
    id: row.id,
    numero: row.numero,
    clienteId: row.cliente_id,
    clienteNombre: row.clientes?.razon_social ?? "",
    fecha: row.fecha,
    vencimiento: row.vencimiento,
    estado: row.estado,
    motivoRechazo: row.motivo_rechazo ?? undefined,
    markupGeneral: row.markup_general,
    descuentoGeneralPorcentaje: Number(row.descuento_general_porcentaje) || 0,
    items: (row.presupuesto_items ?? []).map((it, idx) => ({
      id: it.id ?? `item-${idx}`,
      productoId: "",
      codigo: it.codigo,
      descripcion: it.descripcion,
      categoria: it.categoria,
      cantidad: it.cantidad,
      unidad: it.unidad,
      precioCosto: it.precio_costo,
      costoMoneda: (it.costo_moneda || "ARS") as "ARS" | "USD" | "USD Divisa",
      markupPorcentaje: it.markup_porcentaje,
      precioVenta: it.precio_venta,
      precioLista: it.precio_lista ?? null,
      subtotal: it.subtotal,
      ivaPorcentaje: it.iva_porcentaje ?? 21,
      iva: isManual ? 0 : it.iva,
      total: isManual ? Number(it.cantidad) * Number(it.precio_venta) : it.total,
    })),
    subtotal: row.subtotal,
    iva: row.iva,
    total: row.total,
    moneda: row.moneda,
    tipoCambio: row.tipo_cambio ?? null,
    tipoCambioDivisas: row.tipo_cambio_divisas ?? null,
    cotizacionModalidad: row.cotizacion_modalidad ?? "divisas",
    observaciones: row.observaciones ?? "",
    notasInternas: row.notas_internas ?? "",
    costoEnvioInterno: Number((row as any).costo_envio_interno) || 0,
    creadoPor: (row as any).created_by_profile?.full_name ?? row.created_by ?? "",
    creadoPorId: row.created_by ?? "",
    enviadoAt: row.enviado_at ?? undefined,
    respondidoAt: row.respondido_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vendedorNombre: row.vendedor_profile?.full_name ?? "",
    vendedorAvatar: row.vendedor_profile?.avatar_url ?? null,
    vendedorId: row.vendedor_id ?? null,
    sucursalNombre: row.sucursal?.nombre ?? "",
    sucursalDireccion: [row.sucursal?.direccion, row.sucursal?.localidad, row.sucursal?.provincia].filter(Boolean).join(", "),
    contactoNombre: row.contacto?.nombre ?? "",
    contactoEmail: (row.contacto as any)?.email ?? "",
    ocCliente: row.oc_cliente ?? "",
    ocClienteFecha: row.oc_cliente_fecha ?? null,
    tipoComprobante: row.tipo_comprobante ?? "",
    modalidadEmision: row.modalidad_emision ?? "sin_definir",
    clienteCuit: row.clientes?.cuit ?? "",
    clienteEmail: row.clientes?.email ?? "",
    clienteEmailFacturacion: (row.clientes as any)?.email_facturacion ?? "",
    creadorEmail: (row.created_by_profile as any)?.email ?? "",
    creadorNombre: row.created_by_profile?.full_name ?? "",
    clienteTelefono: row.clientes?.telefono ?? "",
    clienteDireccion: row.clientes?.direccion ?? "",
    clienteLocalidad: row.clientes?.localidad ?? "",
    clienteProvincia: row.clientes?.provincia ?? "",
    clienteCondicionIva: row.clientes?.condicion_iva ?? "",
    clienteLimiteCredito: Number(row.clientes?.limite_credito) || 0,
    clienteSaldoCC: Number(row.clientes?.saldo_cuenta_corriente) || 0,
    archivoUrl: row.archivo_url ?? null,
    archivoNombre: row.archivo_nombre ?? null,
    listoParaFacturar: (row as any).listo_para_facturar ?? false,
    eliminado: (row as any).eliminado ?? false,
  } as any;
}

const statusConfig: Record<PRStatus, { label: string; variant: "success" | "warning" | "danger" | "purple" | "outline" | "info"; icon: typeof Clock }> = {
  solicitud: { label: "Solicitud", variant: "info", icon: Inbox },
  pendiente: { label: "Pendiente", variant: "warning", icon: Clock },
  aprobado: { label: "Aprobado", variant: "success", icon: CheckCircle2 },
  rechazado: { label: "Rechazado", variant: "danger", icon: XCircle },
  postergado: { label: "Postergado", variant: "purple", icon: PauseCircle },
  vencido: { label: "Vencido", variant: "danger", icon: Clock },
  remitido: { label: "Remitido", variant: "info", icon: Truck },
  facturar: { label: "Facturar", variant: "info" as const, icon: Receipt },
  facturado: { label: "Facturado", variant: "purple" as const, icon: Receipt },
};

// Estados que se eligen a mano. Postergado se elige dentro de "Rechazado"; facturado y vencido se ponen solos
// (al emitir la factura y con el aviso diario); "facturar" quedó del circuito anterior a Ventas.
const ESTADOS_MANUALES: PRStatus[] = ["solicitud", "pendiente", "aprobado", "rechazado"];

interface NewPRItem {
  id?: string;                     // id del renglón en la base (al editar): así la edición lo actualiza en su lugar
  codigo: string;
  descripcion: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precio_costo: number;
  markup_porcentaje: number;
  precio_venta: number;
  iva_porcentaje: number;
  proveedor_nombre: string;
  proveedor_id: string;
  stock_propio: boolean;
  lista_item_id: string;
  costo_moneda: "ARS" | "USD" | "USD Divisa";
  proveedor_lista?: string;        // proveedor como figura en la lista de costos (no se guarda en la base)
  descuento_porcentaje?: number;   // descuento del artículo (%), sobre el precio de lista
  price_rule_source?: {
    precio: number;
    precio_neto_base: number;
    descuento: number;
    categoria: string;
    variante?: string;
    reglas: PriceListRule[];
  };
}

// Autocomplete result from lista_precios_items
interface ProductSuggestion {
  id: string;
  codigo: string;
  descripcion: string;
  variante?: string;
  categoria: string;
  unidad: string;
  precio_neto: number;
  precio: number;
  precio_neto_base: number;
  descuento: number;
  reglas: PriceListRule[];
  proveedor_nombre: string;
  proveedor_id: string;
  lista_nombre: string;
  lista_id: string;
  moneda: string;
}

interface PriceTier {
  lista_item_id: string;
  variante: string;
  min: number;
  max: number;
  precio_neto: number;
  precio: number;
  precio_neto_base: number;
  descuento: number;
  categoria: string;
  reglas: PriceListRule[];
  moneda: string;
}

// precio_venta en el formulario = precio de LISTA (costo + markup).
// Precio neto = lista − descuento del artículo − descuento general (ambos antes del IVA).
// En la base se guarda el NETO en precio_venta (así facturación, PDF y OC siguen igual)
// y la lista y el descuento en precio_lista / descuento_porcentaje.
// Margen: una sola regla (lib/presupuesto-margen, auditoría H43): NETO de gastos e impuestos (7 % ARCA, 2 % manual).
const MARGEN_MINIMO = MARGEN_MINIMO_PR;
function precioNeto(item: NewPRItem, descGeneral = 0): number {
  const dl = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0));
  const dg = Math.min(100, Math.max(0, Number(descGeneral) || 0));
  return Math.round(item.precio_venta * (1 - dl / 100) * (1 - dg / 100) * 100) / 100;
}

function calcItemTotals(item: NewPRItem, descGeneral = 0) {
  const subtotal = item.cantidad * precioNeto(item, descGeneral);
  const iva = subtotal * (item.iva_porcentaje / 100);
  return { subtotal, iva, total: subtotal + iva };
}

const emptyItem: NewPRItem = {
  codigo: "", descripcion: "", categoria: "", cantidad: 1, unidad: "UN",
  precio_costo: 0, markup_porcentaje: 0, precio_venta: 0, iva_porcentaje: 21,
  proveedor_nombre: "", proveedor_id: "", stock_propio: false, lista_item_id: "", costo_moneda: "USD",
};

const COSTO_MONEDAS = ["ARS", "USD", "USD Divisa"] as const;
function nextCostoMoneda(current: string): string {
  // AR$ → US$ billete → US$ divisa
  const idx = COSTO_MONEDAS.indexOf(current as typeof COSTO_MONEDAS[number]);
  return COSTO_MONEDAS[(idx + 1) % COSTO_MONEDAS.length];
}

/** Convierte precio_costo a la moneda del presupuesto */
function convertCosto(costoBase: number, costoMoneda: string, prMoneda: string, tc: number, tcDivisas?: number): number {
  // US$ billete × billete, US$ divisa × divisa (lib/dolar-presupuesto).
  return convertirCostoPR(costoBase, costoMoneda, prMoneda, tc, tcDivisas || 0);
}

export default function PresupuestosLista() {
  const { profile, sociedadActiva, sociedades, setSociedadActiva } = useUser();
  const fetchPRSeq = useRef(0);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [descGeneral, setDescGeneral] = useState(0);
  const [catalogoFila, setCatalogoFila] = useState<number | null>(null); // fila desde la que se abrió la lista (lupa)
  // Ancho de columnas de la tabla de ítems (se arrastra el borde del título; se recuerda en este navegador)
  // La descripción (con el código adentro) no tiene ancho fijo: ocupa lo que sobra, así la tabla no tiene scroll lateral.
  const COLS_DEFAULT: Record<string, number> = { proveedor: 150, cantidad: 64, costo: 130, markup: 70, venta: 100, desc: 70, iva: 64, subtotal: 112 };
  const [verIva, setVerIva] = useState(false); // la columna IVA se ve sola si algún renglón no es 21 %
  const [verRepetir, setVerRepetir] = useState(false);
  const [repitiendo, setRepitiendo] = useState(false);
  const vinculosListaRef = useRef<Record<string, string> | null>(null); // nombre en la lista de costos → proveedor del CRM
  const [colW, setColW] = useState<Record<string, number>>(COLS_DEFAULT);
  useEffect(() => {
    try { const g = JSON.parse(localStorage.getItem("pr_col_widths") || "null"); if (g && typeof g === "object") setColW((w) => ({ ...w, ...g })); } catch { /* sin preferencias guardadas */ }
  }, []);
  function empezarResize(col: string, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = colW[col] || COLS_DEFAULT[col] || 100;
    const mover = (ev: MouseEvent) => setColW((w) => ({ ...w, [col]: Math.max(50, Math.min(700, w0 + ev.clientX - x0)) }));
    const soltar = () => {
      window.removeEventListener("mousemove", mover); window.removeEventListener("mouseup", soltar);
      setColW((w) => { try { localStorage.setItem("pr_col_widths", JSON.stringify(w)); } catch { /* ignore */ } return w; });
    };
    window.addEventListener("mousemove", mover); window.addEventListener("mouseup", soltar);
  }
  const { toast } = useToast();
  const canDeletePresupuestos = profile?.role === "super_admin" || profile?.role === "admin";
  // Vendedores: eliminan solo SUS presupuestos (los que crearon) y sin aprobar. Siempre es ocultar (eliminado = true), nunca borrar.
  const puedeEliminarPR = (pr: { estado: string; creadoPorId?: string } | null | undefined) => !!pr && (canDeletePresupuestos
    || (profile?.role === "vendedor" && !!profile?.id && (pr as any).creadoPorId === profile.id && !["aprobado", "facturar", "facturado"].includes(pr.estado)));
  const allEstados: PRStatus[] = ["solicitud", "pendiente", "aprobado", "facturar", "rechazado", "postergado", "vencido", "facturado"];
  const [selectedEstados, setSelectedEstados] = useState<Set<string>>(new Set(["todos"]));
  const [vistaSeguimiento, setVistaSeguimiento] = useState(false);
  const [search, setSearch] = useState("");
  const [showPapelera, setShowPapelera] = useState(false);
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([]);
  const [loading, setLoading] = useState(true);
  // IDs de presupuestos que tienen factura/remito asociado
  const [facturadoIds, setFacturadoIds] = useState<Set<string>>(new Set());
  const [remitidoIds, setRemitidoIds] = useState<Set<string>>(new Set());
  // "parcial" = tiene remito pero faltan cantidades, "total" = todo remitido
  const [remitidoStatus, setRemitidoStatus] = useState<Record<string, "parcial" | "total">>({});

  // Remitar: ventana única de remitos (components/remito-ventana)
  const [remitarPrId, setRemitarPrId] = useState<string | null>(null);

  // Detail panel
  const [selected, setSelected] = useState<Presupuesto | null>(null);
  const [panelFullscreen, setPanelFullscreen] = useState(false);
  // Preferencias del detalle que se recuerdan en esta compu: pantalla completa y ocultar costos (para mostrarle la pantalla al cliente).
  const [ocultarCostos, setOcultarCostos] = useState(false);
  useEffect(() => { try { setOcultarCostos(localStorage.getItem("lz-pr-ocultar-costos") === "1"); } catch { /* sin localStorage */ } }, []);
  useEffect(() => {
    if (!selected?.id) return;
    try { if (localStorage.getItem("lz-pr-fullscreen") === "1") setPanelFullscreen(true); } catch { /* sin localStorage */ }
  }, [selected?.id]);
  const toggleFullscreen = () => { const v = !panelFullscreen; setPanelFullscreen(v); try { localStorage.setItem("lz-pr-fullscreen", v ? "1" : "0"); } catch { /* sin localStorage */ } };
  const toggleOcultarCostos = () => { const v = !ocultarCostos; setOcultarCostos(v); try { localStorage.setItem("lz-pr-ocultar-costos", v ? "1" : "0"); } catch { /* sin localStorage */ } };

  // Vendedor & operador filter
  const [vendedorFilter, setVendedorFilter] = useState<string>("");
  const [operadorFilter, setOperadorFilter] = useState<string>("");
  const [vendedores, setVendedores] = useState<{id: string; full_name: string}[]>([]);
  // Envíos por mail de cada PR (presupuesto_envios, Augusto 28/10): todos, el más nuevo primero.
  const [envios, setEnvios] = useState<Map<string, EnvioPR[]>>(new Map());
  const nombreUsuario = (id: string | null) => (id ? vendedores.find(v => v.id === id)?.full_name : null);

  // Email modal
  const [emailModal, setEmailModal] = useState<{ open: boolean; id: string; to: string; subject: string; body: string; filename: string }>({ open: false, id: "", to: "", subject: "", body: "", filename: "" });

  /** Aviso (nunca frena) antes de enviar o descargar: renglones sin precio. true = seguir. */
  function seguirConFaltantesDePrecio(pr: Presupuesto, accion: string): boolean {
    const faltan = renglonesSinPrecio((pr.items || []).map((it) => ({ cantidad: it.cantidad, precio: it.precioVenta, descripcion: it.descripcion })));
    if (faltan.length === 0) return true;
    const lista = faltan.slice(0, 10).map((r) => `• ${r.descripcion}`).join("\n") + (faltan.length > 10 ? `\n… y ${faltan.length - 10} más` : "");
    return window.confirm(`⚠️ ${pr.numero}: ${faltan.length} renglón(es) sin precio:\n\n${lista}\n\n¿${accion} igual?`);
  }

  async function openEmailModal(pr: Presupuesto) {
    if (!seguirConFaltantesDePrecio(pr, "Enviar")) return;
    const contactoEmail = (pr as any).contactoEmail || "";
    const clientEmail = (pr as any).clienteEmail || "";
    const emailFact = (pr as any).clienteEmailFacturacion || "";
    const template = await loadEmailTemplate("presupuesto", sociedadActiva?.id || "");
    const vars = {
      numero: pr.numero,
      sociedad: sociedadActiva?.razonSocial || "Lazzari",
      total: formatCurrency(pr.total, pr.moneda),
      fecha: formatDate(pr.fecha),
      cliente: pr.clienteNombre || "",
    };
    setEmailModal({
      open: true,
      id: pr.id,
      // En presupuestos el contacto elegido es quien solicitó la cotización.
      // Se propone primero, conservando facturación y el email general como
      // alternativas editables en el compositor.
      to: contactoEmail || emailFact.split(",")[0]?.trim() || clientEmail,
      subject: applyTemplateVars(template.asunto, vars),
      body: applyTemplateVars(template.cuerpo, vars),
      filename: `${pr.numero}.pdf`,
    });
  }

  // Rechazo modal
  const [rechazoModal, setRechazoModal] = useState<string | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState("");
  const [rechazoTipo, setRechazoTipo] = useState<"rechazado" | "postergado">("rechazado");

  // Costos faltantes modal (al aprobar)
  const [costosFaltantesModal, setCostosFaltantesModal] = useState<{ id: string; count: number; motivo?: string } | null>(null);
  // Al aprobar un PR se propone mandar sus OC a cada proveedor (WhatsApp / mail).
  const [enviarOCs, setEnviarOCs] = useState<{ ids: string[]; titulo: string } | null>(null);
  // Track PRs aprobados con costos faltantes (set of PR ids)
  const [prsSinCostos, setPrsSinCostos] = useState<Set<string>>(new Set());
  // Aviso de límite de crédito con el saldo real de Finanzas (auditoría 28/10/2026, H30). Solo si el cliente tiene límite.
  // Venta caída con OC vivas (auditoría H09): aviso con la lista para decidir qué hacer.
  const [ventaCaida, setVentaCaida] = useState<{ prId: string; numero: string } | null>(null);
  const [limiteExcedido, setLimiteExcedido] = useState<{ prId: string; excedido: boolean } | null>(null);
  const selLimite = Number((selected as any)?.clienteLimiteCredito) || 0;
  useEffect(() => {
    const prId = selected?.id, clienteId = selected?.clienteId, socId = sociedadActiva?.id;
    if (!prId || !clienteId || !socId || selLimite <= 0) { setLimiteExcedido(null); return; }
    let vivo = true;
    traerSaldoUnCliente(supabase, socId, clienteId)
      .then((s) => { if (vivo) setLimiteExcedido({ prId, excedido: superaLimiteCredito(selLimite, s) }); })
      .catch(() => { if (vivo) setLimiteExcedido(null); });
    return () => { vivo = false; };
  }, [selected?.id, selected?.clienteId, sociedadActiva?.id, selLimite]);


  // Nuevo PR modal
  const [showNewPR, setShowNewPR] = useState(false);
  useEffect(() => { if (!showNewPR) setDescGeneral(0); }, [showNewPR]);
  const [newPRSaving, setNewPRSaving] = useState(false);
  const [postCreatePR, setPostCreatePR] = useState<Presupuesto | null>(null); // PR recién creado
  const [esSolicitud, setEsSolicitud] = useState(false); // Crear como solicitud
  const [editingPRId, setEditingPRId] = useState<string | null>(null); // null = crear, string = editar

  // Warning PRs previos
  const [prWarningModal, setPrWarningModal] = useState<{ matches: { numero: string; estado: string; fecha: string; codigos: string[] }[] } | null>(null);
  const prWarningBypassRef = useRef(false);

  const [showExpress, setShowExpress] = useState(false);
  // Solicitud: además de escribir lo que pide el cliente, se pueden elegir productos como en un PR (o armarlos con IA).
  const [solicitudItems, setSolicitudItems] = useState(false);
  const [expressTexto, setExpressTexto] = useState("");
  useEffect(() => { if (!showNewPR) { setSolicitudItems(false); setExpressTexto(""); } }, [showNewPR]);
  // Drag-to-reorder items
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function reorderItems(fromIdx: number, toIdx: number) {
    setNewPR(prev => {
      const items = [...prev.items];
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      return { ...prev, items };
    });
  }

  const [cotizBna, setCotizBna] = useState<{ valor_venta: number; fecha: string; fuente: string; modalidad: string } | null>(null);
  const [cotizBnaLoading, setCotizBnaLoading] = useState(false);

  const [cotizFecha, setCotizFecha] = useState("");
  const [dolaresGuardados, setDolaresGuardados] = useState<DolaresGuardados | null>(null);

  /** Tipo de dólar con el que cotiza un proveedor, según sus listas de costos (DPS y Segufer = divisa). */
  async function dolarDelProveedor(provId: string, provNombre: string): Promise<"USD" | "USD Divisa" | null> {
    const db = supabase as any;
    const nombres = new Set<string>([provNombre].filter(Boolean));
    const prov = proveedoresOptions.find((o) => o.id === provId) as any;
    if (prov?.nombre_fantasia) nombres.add(prov.nombre_fantasia);
    if (sociedadActiva?.id) {
      const { data } = await db.from("catalogo_proveedores").select("proveedor_lista").eq("sociedad_id", sociedadActiva.id).eq("proveedor_id", provId);
      (data || []).forEach((r: any) => r.proveedor_lista && nombres.add(r.proveedor_lista));
    }
    if (!nombres.size) return null;
    const { data } = await db.from("catalogo_costos").select("moneda").in("proveedor", [...nombres]).ilike("moneda", "USD%").limit(20);
    const filas = (data || []) as Array<{ moneda: string }>;
    if (!filas.length) return null;
    const divisas = filas.filter((r) => esCostoDivisa(r.moneda)).length;
    return divisas * 2 > filas.length ? "USD Divisa" : "USD";
  }

  /** PR en pesos: completa dólar billete y divisa con lo guardado (cierre del día hábil anterior). */
  async function cargarDolaresPesos(preservarPrecios: boolean) {
    let g: DolaresGuardados;
    try { g = await leerDolaresGuardados(supabase); } catch { return; }
    setDolaresGuardados(g);
    setNewPR((p) => {
      if (p.moneda !== "ARS") return p;
      const tc = p.tipo_cambio > 0 ? p.tipo_cambio : (g.billete?.valor || 0);
      const tcD = p.tipo_cambio_divisas > 0 ? p.tipo_cambio_divisas : (g.divisa?.valor || 0);
      if (tc === p.tipo_cambio && tcD === p.tipo_cambio_divisas) return p;
      const items = preservarPrecios ? p.items : p.items.map(it => {
        if (!esCostoUsd(it.costo_moneda)) return it;
        const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, tc, tcD);
        return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
      });
      return { ...p, tipo_cambio: tc, tipo_cambio_divisas: tcD, items };
    });
  }

  async function fetchCotizBna(
    modalidad: "divisas" | "billetes" = "divisas",
    fecha?: string,
    options: { preserveItemPrices?: boolean } = {},
  ): Promise<boolean> {
    setCotizBnaLoading(true);
    try {
      // Primero lo guardado en la base (el cron trae el BNA todos los días): no se espera al BNA.
      const fechaBuscada = fecha || fechaDolarPresupuesto();
      let data: { valor_venta: number; fecha: string; fuente: string } | null = null;
      try {
        const g = await leerDolaresGuardados(supabase, fechaBuscada);
        setDolaresGuardados(g);
        const d = modalidad === "billetes" ? g.billete : g.divisa;
        if (d && !dolarAtrasado(d, fechaBuscada)) data = { valor_venta: d.valor, fecha: d.fecha, fuente: d.manual ? "manual" : "BNA guardado" };
      } catch { /* sin acceso a lo guardado: va al BNA */ }
      if (!data) {
        // No está guardado: lo pide al BNA (la API lo guarda) y, si falla, usa el último guardado.
        const params = new URLSearchParams({ modalidad, fecha: fechaBuscada });
        const res = await fetch(`/api/cotizacion-bna?${params}`);
        if (res.ok) data = await res.json();
      }
      if (data) {
        setCotizBna({ valor_venta: data.valor_venta, fecha: data.fecha, fuente: data.fuente, modalidad });
        if (modalidad === "divisas") {
          setNewPR((p) => {
            // Un precio de venta ya confirmado es el dato contractual del PR.
            // Al abrir un PR existente sólo necesitamos cargar la cotización para
            // futuras ediciones de costo; no debemos reconstruir silenciosamente
            // el precio desde un markup redondeado.
            const items = options.preserveItemPrices ? p.items : p.items.map(it => {
              const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, p.tipo_cambio, data.valor_venta);
              return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
            });
            return { ...p, tipo_cambio_divisas: data.valor_venta, ...(p.moneda === "USD" ? { tipo_cambio: 0 } : {}), cotizacion_modalidad: modalidad, items };
          });
        } else {
          setNewPR((p) => {
            const items = options.preserveItemPrices ? p.items : p.items.map(it => {
              const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, data.valor_venta, p.tipo_cambio_divisas);
              return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
            });
            return { ...p, tipo_cambio: data.valor_venta, ...(p.moneda === "USD" ? { tipo_cambio_divisas: 0 } : {}), cotizacion_modalidad: modalidad, items };
          });
        }
        return true;
      }
      return false;
    } catch { return false; } finally {
      setCotizBnaLoading(false);
    }
  }

  function tipoDocPorCondicion(condicion?: string | null): { tipo_comprobante: string; modalidad_emision: "electronica" | "manual" | "sin_definir" } {
    switch (condicion) {
      case "RI": return { tipo_comprobante: "A", modalidad_emision: "electronica" };
      case "Monotributo": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      case "Exento": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      case "Consumidor Final": return { tipo_comprobante: "B", modalidad_emision: "electronica" };
      default: return { tipo_comprobante: "", modalidad_emision: "sin_definir" };
    }
  }

  const [clientes, setClientes] = useState<{id: string; razon_social: string; markup_predeterminado?: number | null; condicion_iva?: string | null}[]>([]);
  const [proveedoresOptions, setProveedoresOptions] = useState<{id: string; razon_social: string}[]>([]);
  const [newPR, setNewPR] = useState({
    cliente_id: "",
    vendedor_id: "",
    sucursal_id: "",
    contacto_id: "",
    moneda: "USD" as "USD" | "ARS",
    tipo_cambio: 0,
    tipo_cambio_divisas: 0,
    cotizacion_modalidad: "divisas" as "divisas" | "billetes",
    markup_general: 30,
    observaciones: "",
    notas_internas: "",
    costo_envio_interno: "" as string,
    vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    tipo_comprobante: "" as string,
    modalidad_emision: "sin_definir" as "electronica" | "manual" | "sin_definir",
    items: [{ ...emptyItem, markup_porcentaje: 30 }] as NewPRItem[],
  });

  // Sucursales y contactos del cliente seleccionado
  const [clienteSucursales, setClienteSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [clienteContactos, setClienteContactos] = useState<{ id: string; nombre: string; cargo: string; sucursal_id: string | null }[]>([]);

  // Fetch sucursales + contactos cuando cambia el cliente
  useEffect(() => {
    if (!newPR.cliente_id) {
      setClienteSucursales([]);
      setClienteContactos([]);
      return;
    }
    (async () => {
      const [sucRes, conRes] = await Promise.all([
        (supabase as any).from("cliente_sucursales").select("id, nombre").eq("cliente_id", newPR.cliente_id).eq("activo", true).order("principal", { ascending: false }),
        (supabase as any).from("contactos").select("id, nombre, cargo, sucursal_id").eq("entity_type", "cliente").eq("entity_id", newPR.cliente_id).order("principal", { ascending: false }),
      ]);
      setClienteSucursales((sucRes.data || []) as { id: string; nombre: string }[]);
      setClienteContactos((conRes.data || []) as { id: string; nombre: string; cargo: string; sucursal_id: string | null }[]);
    })();
  }, [newPR.cliente_id]);

  // PR en pesos: el dólar sale de lo guardado (no se espera al BNA). Al editar, no se tocan los precios ya dados.
  useEffect(() => {
    if (!showNewPR || newPR.moneda !== "ARS") return;
    if (newPR.tipo_cambio > 0 && newPR.tipo_cambio_divisas > 0) return;
    void cargarDolaresPesos(!!editingPRId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewPR, newPR.moneda, editingPRId]);

  // Lo que carga el usuario: si cambió desde que se abrió, Escape / clic afuera / X preguntan antes de cerrar (Augusto 21/10).
  const firmaPR = (p: typeof newPR) => JSON.stringify([p.cliente_id, p.observaciones, p.notas_internas,
    p.items.map((i) => [i.codigo, i.descripcion, i.cantidad, i.precio_costo, i.precio_venta, i.proveedor_id])]);
  const firmaAlAbrir = useRef("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showNewPR) firmaAlAbrir.current = firmaPR(newPR); }, [showNewPR]);
  const hayCambiosPR = showNewPR && firmaPR(newPR) !== firmaAlAbrir.current;

  // Client search
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  const filteredClientes = clientes.filter((c) =>
    c.razon_social.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // Product search modal
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchIdx, setProductSearchIdx] = useState(0);
  const [productSearchQuery, setProductSearchQuery] = useState("");
  const [productSearchResults, setProductSearchResults] = useState<ProductSuggestion[]>([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  // Precios escalonados por cantidad: índice de item → tiers disponibles
  const [priceTiersMap, setPriceTiersMap] = useState<Record<number, PriceTier[]>>({});

  function openProductSearch(idx: number) {
    setProductSearchIdx(idx);
    setProductSearchQuery("");
    setProductSearchResults([]);
    setProductSearchOpen(true);
    setTimeout(() => productSearchInputRef.current?.focus(), 100);
  }

  async function doProductSearch(query: string) {
    if (query.length < 2) { setProductSearchResults([]); return; }
    setProductSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("lista_precios_items")
        .select(`
          id, codigo, descripcion, variante, categoria, unidad, precio, precio_neto, descuento, lista_id,
          listas_precios:lista_id(nombre, moneda, proveedor_id, proveedores:proveedor_id(razon_social))
        `)
        .or(`codigo.ilike.%${query}%,descripcion.ilike.%${query}%`)
        .eq("sociedad_id" as any, sociedadActiva?.id || "")
        .limit(20);

      if (error || !data) { setProductSearchResults([]); return; }

      const listIds = [...new Set((data as any[]).map(item => item.lista_id).filter(Boolean))];
      let rulesByList: Record<string, PriceListRule[]> = {};
      if (listIds.length > 0 && sociedadActiva?.id) {
        const { data: rules } = await (supabase as any).from("lista_precios_reglas").select("*")
          .in("lista_id", listIds).eq("sociedad_id", sociedadActiva.id).eq("activa", true);
        rulesByList = (rules || []).reduce((acc: Record<string, PriceListRule[]>, rule: PriceListRule) => {
          (acc[rule.lista_id] ||= []).push(rule);
          return acc;
        }, {});
      }

      const mapped: ProductSuggestion[] = data
        .filter((d: any) => d.listas_precios)
        .map((d: any) => {
          const reglas = rulesByList[d.lista_id] || [];
          const calculated = calculateNetPrice({ precio: d.precio, precio_neto: d.precio_neto, descuento: d.descuento, categoria: d.categoria, variante: d.variante }, reglas, null, todayAR());
          return {
            id: d.id, codigo: d.codigo ?? "", descripcion: d.descripcion ?? "", variante: d.variante ?? undefined,
            categoria: d.categoria ?? "", unidad: d.unidad ?? "UN", precio_neto: calculated.netPrice,
            precio_neto_base: calculated.baseNet, descuento: Number(d.descuento) || 0, reglas, precio: d.precio ?? 0,
            proveedor_nombre: d.listas_precios?.proveedores?.razon_social ?? "—", proveedor_id: d.listas_precios?.proveedor_id ?? "",
            lista_nombre: d.listas_precios?.nombre ?? "", lista_id: d.lista_id ?? "", moneda: d.listas_precios?.moneda ?? "ARS",
          };
        });
      setProductSearchResults(mapped);
    } catch {
      setProductSearchResults([]);
    } finally {
      setProductSearchLoading(false);
    }
  }

  function handleProductSearchInput(value: string) {
    setProductSearchQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => doProductSearch(value), 300);
  }

  async function handleProductSelect(suggestion: ProductSuggestion) {
    const idx = productSearchIdx;
    const selectedQuantity = Number(newPR.items[idx]?.cantidad) || 1;
    const selectedNet = calculateNetPrice({ precio: suggestion.precio, precio_neto: suggestion.precio_neto_base, descuento: suggestion.descuento, categoria: suggestion.categoria, variante: suggestion.variante }, suggestion.reglas, selectedQuantity, todayAR()).netPrice;
    setNewPR((prev) => {
      const items = [...prev.items];
      const markup = items[idx].markup_porcentaje || prev.markup_general;
      const costoMoneda = (suggestion.moneda || "USD") as "ARS" | "USD";
      const costoConv = convertCosto(selectedNet, costoMoneda, prev.moneda, prev.tipo_cambio, prev.tipo_cambio_divisas);
      const precioVenta = Number((costoConv * (1 + markup / 100)).toFixed(2));
      items[idx] = {
        ...items[idx],
        codigo: suggestion.codigo,
        descripcion: suggestion.descripcion,
        categoria: suggestion.categoria,
        unidad: suggestion.unidad,
        precio_costo: selectedNet,
        costo_moneda: costoMoneda,
        markup_porcentaje: markup,
        precio_venta: precioVenta,
        proveedor_nombre: suggestion.proveedor_nombre,
        proveedor_id: suggestion.proveedor_id,
        stock_propio: false,
        lista_item_id: suggestion.id,
        price_rule_source: { precio: suggestion.precio, precio_neto_base: suggestion.precio_neto_base, descuento: suggestion.descuento, categoria: suggestion.categoria, variante: suggestion.variante, reglas: suggestion.reglas },
      };
      return { ...prev, items };
    });
    setProductSearchOpen(false);

    // Buscar escalones de precio (misma lista, mismo código, distintas variantes con rangos)
    if (suggestion.lista_id && suggestion.codigo) {
      try {
        const { data: siblings } = await supabase
          .from("lista_precios_items")
          .select("id, variante, categoria, descuento, precio_neto, precio")
          .eq("lista_id" as any, suggestion.lista_id)
          .eq("sociedad_id" as any, sociedadActiva?.id || "")
          .eq("codigo", suggestion.codigo);

        if (siblings && siblings.length > 1) {
          const tiers: PriceTier[] = (siblings as any[])
            .map((s) => {
              const range = parseQuantityRange(s.variante);
              if (!range) return null;
              const calculated = calculateNetPrice({ precio: s.precio, precio_neto: s.precio_neto, descuento: s.descuento, categoria: s.categoria, variante: s.variante }, suggestion.reglas, range.min, todayAR());
              return { lista_item_id: s.id, variante: s.variante || "", min: range.min, max: range.max, precio_neto: calculated.netPrice, precio: Number(s.precio) || 0, precio_neto_base: calculated.baseNet, descuento: Number(s.descuento) || 0, categoria: s.categoria || "", reglas: suggestion.reglas, moneda: suggestion.moneda };
            })
            .filter(Boolean)
            .sort((a, b) => a!.min - b!.min) as PriceTier[];
          if (tiers.length > 1) {
            setPriceTiersMap((prev) => ({ ...prev, [idx]: tiers }));
          }
        }
      } catch { /* ignore */ }
    }
  }

  const cargarEnvios = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const filas: EnvioPR[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await (supabase as any).from("presupuesto_envios")
        .select("presupuesto_id, enviado_at, enviado_por, enviado_a").in("presupuesto_id", ids.slice(i, i + 150));
      filas.push(...((data || []) as EnvioPR[]));
    }
    const nuevos = enviosPorPR(filas);
    setEnvios(prev => {
      const m = new Map(prev);
      for (const id of ids) { const l = nuevos.get(id); if (l) m.set(id, l); else m.delete(id); }
      return m;
    });
  }, []);
  useEffect(() => { cargarEnvios(presupuestos.map(p => p.id)); }, [presupuestos, cargarEnvios]);

  // Smart filters
  const filterConfigs: FilterConfig[] = [
    { key: "fecha", label: "Fecha", type: "date-range" },
    { key: "moneda", label: "Moneda", type: "select", options: [{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }] },
    { key: "monto", label: "Monto total", type: "number-range" },
  ];
  const [filterValues, setFilterValues] = useState<FilterValues>({ fecha: { from: "", to: "" }, moneda: "", monto: {} });

  const fetchPresupuestos = useCallback(async () => {
    // Sin sociedad todavía no se pide nada: si no, viene la lista de las dos sociedades.
    if (!sociedadActiva?.id) return;
    // Si llega tarde la respuesta de un pedido anterior (otra sociedad), no pisa la lista.
    const seq = ++fetchPRSeq.current;
    try {
      // First try with items + vendedor profile
      let q = (supabase as any)
        .from("presupuestos")
        .select(`*, clientes(razon_social, cuit, email, email_facturacion, telefono, direccion, localidad, provincia, condicion_iva, limite_credito, saldo_cuenta_corriente), created_by_profile:created_by(full_name, email), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre, direccion, localidad, provincia), contacto:contacto_id(nombre, email), presupuesto_items(*)`)
        .order("created_at", { ascending: false });
      if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
      let res: { data: any; error: any } = await q;

      // If that fails, try without items
      if (res.error) {
        let q2 = supabase
          .from("presupuestos")
          .select(`*, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva, limite_credito, saldo_cuenta_corriente), created_by_profile:created_by(full_name), vendedor_id`)
          .order("created_at", { ascending: false });
        if (sociedadActiva?.id) q2 = q2.eq("sociedad_id" as any, sociedadActiva.id);
        res = await q2;
      }

      // If still fails, try minimal
      if (res.error) {
        let q3 = supabase
          .from("presupuestos")
          .select(`*, vendedor_id`)
          .order("created_at", { ascending: false });
        if (sociedadActiva?.id) q3 = q3.eq("sociedad_id" as any, sociedadActiva.id);
        res = await q3;
      }

      const { data, error } = res;
      if (seq !== fetchPRSeq.current) return;
      if (!error && data) {
        setPresupuestos((data as unknown as SupabasePresupuesto[]).map(mapToPresupuesto));
      } else if (error) {
        setPresupuestos([]);
        toast.error("No se pudieron cargar los presupuestos. Recargá la página.");
      }
    } catch {
      setPresupuestos([]);
        toast.error("No se pudieron cargar los presupuestos. Recargá la página.");
    } finally {
      setLoading(false);
    }
  }, [sociedadActiva]);

  useEffect(() => {
    fetchPresupuestos();
  }, [fetchPresupuestos]);
  // Si la pantalla quedó abierta, al volver se actualizan los estados (ej. un PR que ya se facturó).
  useRefrescarAlVolver(fetchPresupuestos);

  // Auto-select PR from URL ?selected=UUID. El buscador de arriba avisa con "lz-abrir-pr" (si ya estás en esta pantalla la URL cambia pero la página no se vuelve a cargar).
  const [abrirPedido, setAbrirPedido] = useState<{ id: string } | null>(null);
  useEffect(() => {
    const onAbrir = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (id) setAbrirPedido({ id }); };
    window.addEventListener("lz-abrir-pr", onAbrir);
    return () => window.removeEventListener("lz-abrir-pr", onAbrir);
  }, []);
  useEffect(() => {
    if (loading || presupuestos.length === 0) return;
    const selId = abrirPedido?.id || new URLSearchParams(window.location.search).get("selected");
    if (!selId) return;
    const found = presupuestos.find(p => p.id === selId);
    if (found) setSelected(found);
    setAbrirPedido(null);
    // Clean URL param (la URL del buscador puede llegar un instante después)
    window.history.replaceState({}, "", window.location.pathname);
    window.setTimeout(() => { if (window.location.search.includes("selected=")) window.history.replaceState({}, "", window.location.pathname); }, 800);
  }, [loading, presupuestos.length, abrirPedido]);

  // Fetch items separately when selected PR has no items (fallback query omitted them)
  useEffect(() => {
    if (!selected?.id || selected.items.length > 0) return;
    (async () => {
      const { data } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", selected.id)
        .order("orden", { ascending: true });
      if (data && data.length > 0) {
        setSelected(prev => prev ? {
          ...prev,
          items: data.map((it: any, idx: number) => ({
            id: it.id ?? `item-${idx}`,
            productoId: "",
            codigo: it.codigo,
            descripcion: it.descripcion,
            categoria: it.categoria,
            cantidad: it.cantidad,
            unidad: it.unidad,
            precioCosto: it.precio_costo,
            costoMoneda: (it.costo_moneda || "ARS") as "ARS" | "USD" | "USD Divisa",
            markupPorcentaje: it.markup_porcentaje,
            precioVenta: it.precio_venta,
            subtotal: it.subtotal,
            ivaPorcentaje: it.iva_porcentaje ?? 21,
            iva: (prev as any).modalidadEmision === "manual" ? 0 : it.iva,
            total: (prev as any).modalidadEmision === "manual"
              ? Number(it.cantidad) * Number(it.precio_venta)
              : it.total,
          }))
        } : null);
      }
    })();
  }, [selected?.id]);

  // Al recargar la lista (ej. después de editar y guardar), el PR abierto toma los datos nuevos:
  // si no, el panel y el PDF seguían con los precios de antes hasta volver a abrirlo.
  useEffect(() => {
    setSelected(prev => {
      if (!prev) return prev;
      const fresco = presupuestos.find(p => p.id === prev.id);
      return fresco && fresco.items.length > 0 ? fresco : prev;
    });
  }, [presupuestos]);

  // Check approved PRs for missing costs
  useEffect(() => {
    async function checkAprobadosSinCostos() {
      const aprobados = presupuestos.filter(p => p.estado === "aprobado");
      if (aprobados.length === 0) return;
      try {
        const ids = aprobados.map(p => p.id);
        const { data: items } = await supabase
          .from("presupuesto_items")
          .select("presupuesto_id, precio_costo")
          .in("presupuesto_id", ids);
        if (!items) return;
        const sinCostoSet = new Set<string>();
        for (const it of items as any[]) {
          if (!it.precio_costo || Number(it.precio_costo) === 0) {
            sinCostoSet.add(it.presupuesto_id);
          }
        }
        setPrsSinCostos(sinCostoSet);
      } catch { /* ignore */ }
    }
    checkAprobadosSinCostos();
  }, [presupuestos]);

  // Fetch IDs de presupuestos facturados y remitidos
  useEffect(() => {
    async function fetchFacturadoIds() {
      try {
        let fq = supabase
          .from("facturas")
          .select("presupuesto_id")
          .not("presupuesto_id", "is", null)
          .neq("estado" as any, "anulada");
        if (sociedadActiva?.id) fq = fq.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await fq;
        if (data) {
          setFacturadoIds(new Set(data.map((f: any) => f.presupuesto_id).filter(Boolean)));
        }
      } catch {
        // ignore
      }
    }
    async function fetchRemitidoIds() {
      try {
        let rq = (supabase as any)
          .from("remitos")
          .select("id, presupuesto_id")
          .eq("anulado", false)
          .not("presupuesto_id", "is", null);
        if (sociedadActiva?.id) rq = rq.eq("sociedad_id", sociedadActiva.id);
        const { data: remitos } = await rq;
        if (!remitos || remitos.length === 0) {
          setRemitidoIds(new Set());
          setRemitidoStatus({});
          return;
        }
        const prIds = [...new Set(remitos.map((r: any) => r.presupuesto_id).filter(Boolean))] as string[];
        setRemitidoIds(new Set(prIds));

        // Calculate partial vs total for each PR
        const remitoIds = remitos.map((r: any) => r.id);
        const { data: rItems } = await (supabase as any).from("remito_items").select("remito_id, descripcion, cantidad, orden, presupuesto_item_id").in("remito_id", remitoIds);
        // Build map: presupuesto_id → remito_ids
        const prRemitoMap: Record<string, string[]> = {};
        for (const r of remitos as any[]) {
          if (!r.presupuesto_id) continue;
          if (!prRemitoMap[r.presupuesto_id]) prRemitoMap[r.presupuesto_id] = [];
          prRemitoMap[r.presupuesto_id].push(r.id);
        }
        // Fetch PR items for these PRs
        const { data: prItems } = await supabase.from("presupuesto_items").select("id, presupuesto_id, descripcion, cantidad, orden").in("presupuesto_id", prIds);
        if (!prItems || !rItems) {
          setRemitidoStatus({});
          return;
        }
        const statusMap: Record<string, "parcial" | "total"> = {};
        for (const prId of prIds) {
          const myPrItems = (prItems as any[]).filter(i => i.presupuesto_id === prId);
          const myRemitoIds = prRemitoMap[prId] || [];
          const myRItems = (rItems as any[]).filter(i => myRemitoIds.includes(i.remito_id));
          // Sum remitido by presupuesto_item_id (preferred) or descripcion+orden (fallback)
          const remitidoByPiId: Record<string, number> = {};
          const remitidoByKey: Record<string, number> = {};
          for (const ri of myRItems) {
            if (ri.presupuesto_item_id) {
              remitidoByPiId[ri.presupuesto_item_id] = (remitidoByPiId[ri.presupuesto_item_id] || 0) + Number(ri.cantidad);
            } else {
              const key = `${ri.descripcion}__${ri.orden}`;
              remitidoByKey[key] = (remitidoByKey[key] || 0) + Number(ri.cantidad);
            }
          }
          let allDone = true;
          for (const pi of myPrItems) {
            const remitido = remitidoByPiId[pi.id] || remitidoByKey[`${pi.descripcion}__${pi.orden}`] || 0;
            if (remitido < Number(pi.cantidad)) { allDone = false; break; }
          }
          statusMap[prId] = allDone ? "total" : "parcial";
        }
        setRemitidoStatus(statusMap);
      } catch {
        // ignore
      }
    }
    fetchFacturadoIds();
    fetchRemitidoIds();
  }, [presupuestos, sociedadActiva?.id]);

  useEffect(() => {
    async function fetchVendedores() {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("role", ["vendedor", "administrativo", "admin", "super_admin"])
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

  // Auto-load BNA rate when PR form opens (for USD cost conversion)
  useEffect(() => {
    if (showNewPR && !cotizBna) fetchCotizBna("divisas");
  }, [showNewPR]);

  useEffect(() => {
    if (!showNewPR) return;
    async function fetchClientes() {
      try {
        let q = (supabase as any)
          .from("clientes")
          .select("id, razon_social, markup_predeterminado, moneda_predeterminada, condicion_iva")
          .eq("activo", true)
          .order("razon_social");
        if (sociedadActiva?.id) q = q.eq("sociedad_id", sociedadActiva.id);
        const { data } = await q;
        if (data) setClientes(data as {id: string; razon_social: string; markup_predeterminado?: number | null; condicion_iva?: string | null}[]);
      } catch { /* ignore */ }
    }
    async function fetchProveedoresForPR() {
      try {
        let q = supabase.from("proveedores").select("id, razon_social").eq("activo", true).order("razon_social");
        if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
        const { data } = await q;
        if (data) setProveedoresOptions(data as unknown as {id: string; razon_social: string}[]);
      } catch { /* ignore */ }
    }
    fetchClientes();
    fetchProveedoresForPR();
  }, [showNewPR, sociedadActiva]);

  // En un presupuesto nuevo, sugerir automáticamente al usuario logueado como
  // vendedor. El campo sigue siendo editable y no se pisa una selección manual.
  useEffect(() => {
    if (!showNewPR || editingPRId || esSolicitud || newPR.vendedor_id || !profile?.id) return;
    const loggedInVendedor = vendedores.find((v) => v.id === profile.id);
    if (loggedInVendedor) {
      setNewPR((prev) => prev.vendedor_id ? prev : { ...prev, vendedor_id: loggedInVendedor.id });
    }
  }, [showNewPR, editingPRId, esSolicitud, newPR.vendedor_id, profile?.id, vendedores]);

  function updateNewPRItem(index: number, field: keyof NewPRItem | "costo_moneda", value: string | number) {
    setNewPR((prev) => {
      const items = [...prev.items];
      const item = { ...items[index], [field]: value };

      // Auto-switch precio por escalon cuando cambia la cantidad
      if (field === "cantidad") {
        if (item.price_rule_source) {
          const source = item.price_rule_source;
          item.precio_costo = calculateNetPrice({ precio: source.precio, precio_neto: source.precio_neto_base, descuento: source.descuento, categoria: source.categoria, variante: source.variante }, source.reglas, Number(value), todayAR()).netPrice;
        }
        const tiers = priceTiersMap[index];
        if (tiers && tiers.length > 0) {
          const qty = Number(value);
          const matchingTier = tiers.find((t) => qty >= t.min && qty <= t.max);
          const effectiveTierPrice = matchingTier ? calculateNetPrice({ precio: matchingTier.precio, precio_neto: matchingTier.precio_neto_base, descuento: matchingTier.descuento, categoria: matchingTier.categoria, variante: matchingTier.variante }, matchingTier.reglas, qty, todayAR()).netPrice : null;
          if (matchingTier && effectiveTierPrice !== null && effectiveTierPrice !== item.precio_costo) {
            item.precio_costo = effectiveTierPrice;
            item.lista_item_id = matchingTier.lista_item_id;
            item.price_rule_source = { precio: matchingTier.precio, precio_neto_base: matchingTier.precio_neto_base, descuento: matchingTier.descuento, categoria: matchingTier.categoria, variante: matchingTier.variante, reglas: matchingTier.reglas };
            const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio, prev.tipo_cambio_divisas);
            item.precio_venta = precioDesdeMarkup(costoConv, item.markup_porcentaje, item.precio_venta);
            // Notificar el cambio de escalon (via setTimeout para salir del setState)
            setTimeout(() => toast.success(`Precio actualizado: ${matchingTier.variante}`), 0);
          }
        }
        if (item.price_rule_source) {
          const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio, prev.tipo_cambio_divisas);
          item.precio_venta = precioDesdeMarkup(costoConv, item.markup_porcentaje, item.precio_venta);
        }
      }

      // Auto-calc precio_venta when costo, markup, or costo_moneda change
      if (field === "precio_costo" || field === "markup_porcentaje" || field === "costo_moneda") {
        const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio, prev.tipo_cambio_divisas);
        item.precio_venta = precioDesdeMarkup(costoConv, item.markup_porcentaje, item.precio_venta);
      }

      // Auto-calc markup when precio_venta changes manually
      if (field === "precio_venta") {
        const costoConv = convertCosto(item.precio_costo, item.costo_moneda, prev.moneda, prev.tipo_cambio, prev.tipo_cambio_divisas);
        if (costoConv > 0) {
          // Sin redondear: así rearmar el precio desde el markup da exacto el precio escrito (se ve con 2 decimales).
          item.markup_porcentaje = ((Number(value) / costoConv) - 1) * 100;
        }
      }
      items[index] = item;
      return { ...prev, items };
    });
  }

  // ── Ayudas de la ventana (Augusto 13/10): último precio al cliente, buscar en la lista al escribir, repetir un PR ──
  // Último precio (neto) al que se le vendió cada artículo a este cliente (presupuestos aprobados / facturados).
  const ultimosDelCliente = useMemo(() => {
    if (!newPR.cliente_id) return new Map<string, { precio: number; moneda: string; fecha: string; numero: string }>();
    const vendidos: PRVendido[] = presupuestos
      .filter((p) => p.clienteId === newPR.cliente_id && p.id !== editingPRId && !(p as any).eliminado
        && (["aprobado", "facturar", "facturado"].includes(p.estado) || facturadoIds.has(p.id)))
      .map((p) => ({ numero: p.numero, fecha: p.fecha || "", moneda: p.moneda, items: p.items.map((it) => ({ codigo: it.codigo, descripcion: it.descripcion, precioVenta: Number(it.precioVenta) })) }));
    return ultimosPrecios(vendidos);
  }, [presupuestos, newPR.cliente_id, editingPRId, facturadoIds]);
  // "Precios y costos (IA)": mantener el último precio al cliente y buscar mejores costos.
  const [showPC, setShowPC] = useState(false);
  const preciosAnteriores: FilaPrecioAnterior[] = useMemo(() => {
    const out: FilaPrecioAnterior[] = [];
    newPR.items.forEach((it, idx) => {
      const u = ultimosDelCliente.get(claveArticulo(it.codigo, it.descripcion));
      if (!u || u.moneda !== newPR.moneda) return;
      const neto = precioNeto(it, descGeneral);
      if (neto > 0 && Math.abs(neto - u.precio) > 0.004) out.push({ idx, descripcion: it.descripcion, actual: neto, anterior: u.precio, numero: u.numero, fecha: u.fecha });
    });
    return out;
  }, [newPR.items, newPR.moneda, ultimosDelCliente, descGeneral]);
  function aplicarPreciosAnteriores(cambios: Array<{ idx: number; precio: number }>) {
    // igual que el "usar" de cada renglón: sin descuento y con ese precio; el markup se recalcula solo
    setNewPR((p) => ({ ...p, items: p.items.map((x, i) => (cambios.some((c) => c.idx === i) ? { ...x, descuento_porcentaje: 0 } : x)) }));
    for (const c of cambios) updateNewPRItem(c.idx, "precio_venta", c.precio);
    toast.success(`${cambios.length} precio(s) vuelven al último que pagó el cliente`);
  }
  async function aplicarMejoresCostos(cambios: MejorCosto[]) {
    const provIds = await Promise.all(cambios.map((c) => proveedorDeLista(c.cand.proveedor)));
    setNewPR((p) => ({
      ...p,
      items: p.items.map((x, i) => {
        const k = cambios.findIndex((c) => c.idx === i);
        if (k < 0) return x;
        const c = cambios[k];
        const costoMoneda = c.cand.moneda === "ARS" ? "ARS" : String(c.cand.moneda).toLowerCase().includes("divisa") ? "USD Divisa" : "USD";
        const costoConv = convertCosto(c.cand.costo, costoMoneda, p.moneda, p.tipo_cambio, p.tipo_cambio_divisas);
        // El precio de venta NO cambia: se recalcula el markup (sube el margen).
        return { ...x, proveedor_nombre: c.cand.proveedor, proveedor_lista: c.cand.proveedor, proveedor_id: provIds[k] || "", costo_moneda: costoMoneda as NewPRItem["costo_moneda"], precio_costo: c.cand.costo, price_rule_source: undefined,
          markup_porcentaje: costoConv > 0 && x.precio_venta > 0 ? ((x.precio_venta / costoConv) - 1) * 100 : x.markup_porcentaje };
      }),
    }));
    toast.success(`${cambios.length} costo(s) mejorados: el precio de venta no cambió, subió el margen`);
  }
  // Presupuestos anteriores del cliente, para "Repetir presupuesto anterior".
  const anterioresDelCliente = useMemo(() => presupuestos
    .filter((p) => !!newPR.cliente_id && p.clienteId === newPR.cliente_id && p.id !== editingPRId && !(p as any).eliminado && p.estado !== "solicitud")
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.numero.localeCompare(a.numero))
    .slice(0, 12), [presupuestos, newPR.cliente_id, editingPRId]);

  /** Proveedor del CRM para un nombre de la lista de costos: vínculo guardado o nombre parecido. */
  async function proveedorDeLista(nombre: string): Promise<string> {
    if (!vinculosListaRef.current) {
      vinculosListaRef.current = {};
      if (sociedadActiva?.id) {
        const { data } = await (supabase as any).from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadActiva.id);
        vinculosListaRef.current = Object.fromEntries((data || []).map((v: any) => [v.proveedor_lista, v.proveedor_id]));
      }
    }
    return vinculosListaRef.current[nombre] || buscarProveedorCRM(nombre, proveedoresOptions);
  }

  /** Artículo elegido en la descripción (lista de costos) → reemplaza el renglón, conserva la cantidad. */
  async function elegirDeLista(idx: number, fila: FilaLista) {
    const base = filaListaAItem(fila, newPR.moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas, await proveedorDeLista(fila.proveedor));
    if (!base) {
      toast.warning("Falta el dólar del presupuesto: lo traigo del BNA. Elegilo de nuevo en un segundo.");
      const cli = clientes.find((c) => c.id === newPR.cliente_id) as any;
      void fetchCotizBna(cli?.moneda_predeterminada === "USD" ? "billetes" : "divisas");
      return;
    }
    setNewPR((p) => ({ ...p, items: p.items.map((it, i) => (i === idx ? { ...base, cantidad: it.cantidad || 1, iva_porcentaje: it.iva_porcentaje ?? 21 } : it)) }));
    focoPendiente.current = { campo: "cant", idx }; // el cursor pasa a la cantidad del mismo renglón
  }
  // Foco después de dibujar los renglones (agregar renglón / elegir de la lista).
  const focoPendiente = useRef<{ campo: "desc" | "cant"; idx: number } | null>(null);
  useEffect(() => {
    const f = focoPendiente.current;
    if (!f) return;
    focoPendiente.current = null;
    const els = document.querySelectorAll<HTMLInputElement>(f.campo === "desc" ? "[data-desc]" : "[data-pr-cant]");
    (f.idx < 0 ? els[els.length - 1] : els[f.idx])?.focus();
  }, [newPR.items]);
  // La lista de costos se trae al abrir la ventana, así la búsqueda en la descripción responde al toque.
  useEffect(() => { if (showNewPR) void traerListaCompleta().catch(() => { /* sin lista: se carga a mano */ }); }, [showNewPR]);

  /** Enter en el último renglón (con algo escrito) agrega otro y pone el cursor en su descripción. */
  function agregarRenglonYEnfocar() {
    focoPendiente.current = { campo: "desc", idx: -1 };
    setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }));
  }

  /** Copia los artículos de un presupuesto anterior del cliente con los precios de HOY de la lista de costos. */
  async function repetirPresupuesto(prId: string) {
    setRepitiendo(true);
    try {
      const [{ data: its, error }, lista] = await Promise.all([
        (supabase as any).from("presupuesto_items").select("*").eq("presupuesto_id", prId).order("orden", { ascending: true }),
        traerListaCompleta().catch(() => [] as FilaLista[]),
      ]);
      if (error) { toast.error(`No se pudo traer el presupuesto: ${error.message}`); return; }
      const { moneda, tipo_cambio: tc, tipo_cambio_divisas: tcD, markup_general: mg } = newPR;
      let conLista = 0, sinLista = 0;
      const nuevos: NewPRItem[] = [];
      for (const it of its || []) {
        const fila = filaPorCodigo(lista, it.codigo || "");
        const base = fila ? filaListaAItem(fila, moneda, tc, tcD, it.proveedor_id || await proveedorDeLista(fila.proveedor)) : null;
        if (base) {
          conLista++;
          nuevos.push({ ...base, descripcion: it.descripcion || base.descripcion, cantidad: Number(it.cantidad) || 1, iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21, unidad: it.unidad || "UN", stock_propio: !!it.stock_propio });
          continue;
        }
        // No está en la lista de hoy: queda el costo anterior con su markup, recalculado con el dólar de hoy.
        sinLista++;
        const costo = Number(it.precio_costo) || 0;
        const cm = (it.costo_moneda || "ARS") as NewPRItem["costo_moneda"];
        const markup = it.markup_porcentaje != null ? Number(it.markup_porcentaje) : mg;
        nuevos.push({
          ...emptyItem, codigo: it.codigo || "", descripcion: it.descripcion || "", categoria: it.categoria || "", cantidad: Number(it.cantidad) || 1, unidad: it.unidad || "UN",
          precio_costo: costo, costo_moneda: cm, markup_porcentaje: markup,
          precio_venta: costo > 0 ? Number((convertCosto(costo, cm, moneda, tc, tcD) * (1 + markup / 100)).toFixed(2)) : Number(it.precio_lista ?? it.precio_venta) || 0,
          iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
          proveedor_nombre: it.proveedor_nombre || "", proveedor_id: it.proveedor_id || "", stock_propio: !!it.stock_propio,
        });
      }
      if (!nuevos.length) { toast.warning("Ese presupuesto no tiene artículos"); return; }
      setNewPR((p) => ({ ...p, items: [...p.items.filter((x) => x.codigo.trim() || x.descripcion.trim()), ...nuevos] }));
      setVerRepetir(false);
      toast.success(`${nuevos.length} artículos copiados: ${conLista} con precio de hoy de la lista${sinLista ? ` · ${sinLista} no están en la lista (quedó el costo anterior, revisalos)` : ""}`);
    } finally { setRepitiendo(false); }
  }

  async function handleCreatePR() {
    if (!newPR.cliente_id) {
      toast.warning("Selecciona un cliente");
      return;
    }
    if (!esSolicitud && !newPR.vendedor_id) {
      toast.warning("Selecciona un vendedor");
      return;
    }
    if (!esSolicitud && newPR.modalidad_emision !== "manual" && !["A", "B"].includes(newPR.tipo_comprobante)) {
      toast.warning("Selecciona tipo de documento (A o B)");
      return;
    }
    const itemsCargados = newPR.items.filter((it) => it.descripcion.trim() && it.cantidad > 0);
    // Solicitud solo con texto: la base pide al menos un renglón, así que lo pedido queda como
    // un renglón a cotizar (sin costo ni precio). Al convertirla en PR se reemplaza por los artículos.
    const textoSolicitud = newPR.notas_internas.trim();
    const validItems = esSolicitud && itemsCargados.length === 0 && textoSolicitud
      ? [{ ...emptyItem, descripcion: textoSolicitud.slice(0, 500), cantidad: 1 }]
      : itemsCargados;
    if (validItems.length === 0) {
      toast.warning(esSolicitud ? "Escribí qué necesita el cliente o elegí productos" : "Agrega al menos un item");
      return;
    }

    // Check for previous PRs with same client + articles (skip if already bypassed)
    if (!prWarningBypassRef.current && validItems.length > 0) {
      try {
        const codigos = validItems.map((it) => it.codigo).filter(Boolean);
        if (codigos.length > 0) {
          // Find PRs for same client in last 12 months
          const twelveMonthsAgo = new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
          const { data: prevPRs } = await supabase
            .from("presupuestos")
            .select("id, numero, estado, fecha, presupuesto_items(codigo)")
            .eq("cliente_id", newPR.cliente_id)
            .gte("fecha", twelveMonthsAgo)
            .order("fecha", { ascending: false })
            .limit(50) as any;

          if (prevPRs && prevPRs.length > 0) {
            const matches: { numero: string; estado: string; fecha: string; codigos: string[] }[] = [];
            for (const pr of prevPRs) {
              // Skip self when editing
              if (editingPRId && pr.id === editingPRId) continue;
              const prCodigos = (pr.presupuesto_items || []).map((i: any) => i.codigo).filter(Boolean);
              const overlap = codigos.filter((c: string) => prCodigos.includes(c));
              if (overlap.length > 0) {
                matches.push({ numero: pr.numero, estado: pr.estado, fecha: pr.fecha, codigos: overlap });
              }
            }
            if (matches.length > 0) {
              setPrWarningModal({ matches });
              return; // Don't proceed — user must confirm
            }
          }
        }
      } catch { /* ignore check errors, proceed normally */ }
    }
    prWarningBypassRef.current = false; // Reset for next time

    // Alertas (no bloquean): margen real bajo el mínimo y tipo de dólar distinto al del cliente.
    {
      // Mismo margen neto que la lista y la ventana (H43). Sin dólar no se calcula ese renglón (no se inventa un margen).
      const gastos = gastosPorcentajePR(newPR.modalidad_emision);
      const bajos: string[] = [];
      let netoTot = 0, costoTot = 0, sinDolar = 0;
      for (const it of validItems) {
        const costoConv = costoEnMonedaPR(it.precio_costo, it.costo_moneda, newPR.moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas);
        if (costoConv === null) { sinDolar++; continue; }
        const neto = precioNeto(it, descGeneral);
        netoTot += neto * it.cantidad; costoTot += costoConv * it.cantidad;
        const m = margenNetoPct(neto, costoConv, gastos);
        if (m !== null && m < MARGEN_MINIMO) bajos.push(`${it.codigo || it.descripcion.slice(0, 30)} (${m.toFixed(1)}%)`);
      }
      const margenTot = margenNetoPct(netoTot, costoTot, gastos);
      const avisos: string[] = [];
      if (bajos.length || (margenTot !== null && margenTot < MARGEN_MINIMO)) {
        avisos.push(`Margen neto total: ${margenTot === null ? "—" : margenTot.toFixed(1) + "%"} (mínimo ${MARGEN_MINIMO}%, descontando ${gastos}% de gastos e impuestos).` + (bajos.length ? `\nArtículos bajo el mínimo: ${bajos.slice(0, 8).join(", ")}${bajos.length > 8 ? "…" : ""}` : ""));
      }
      if (sinDolar) avisos.push(`${sinDolar} artículo(s) con costo en otra moneda y sin dólar cargado: no se pudo calcular su margen.`);
      const cli = clientes.find((c) => c.id === newPR.cliente_id) as any;
      const pref = cli?.moneda_predeterminada === "USD" ? "billetes" : cli?.moneda_predeterminada === "USD Divisa" ? "divisas" : null;
      if (newPR.moneda === "USD" && pref && newPR.cotizacion_modalidad && newPR.cotizacion_modalidad !== pref) {
        avisos.push(`Este cliente cotiza en USD ${pref === "divisas" ? "divisa" : "billete"} y el presupuesto está en USD ${newPR.cotizacion_modalidad === "divisas" ? "divisa" : "billete"}.`);
      }
      if (avisos.length) {
        if (!window.confirm(`Atención:\n\n${avisos.join("\n\n")}\n\n¿Guardar igual?`)) return;
        if (bajos.length || (margenTot !== null && margenTot < MARGEN_MINIMO)) {
          // Queda registrado para el futuro centro de alertas.
          (supabase as any).from("notificaciones").insert({
            sociedad_id: sociedadActiva?.id || null,
            tipo: "margen_bajo",
            titulo: `Presupuesto con margen real ${margenTot === null ? "—" : margenTot.toFixed(1) + "%"}${cli?.razon_social ? ` — ${cli.razon_social}` : ""}`,
            detalle: avisos.join("\n"),
            referencia_tipo: "presupuesto",
            referencia_id: editingPRId || null,
            creado_por: profile?.id || null,
          }).then(() => undefined, () => undefined);
        }
      }
    }

    setNewPRSaving(true);
    try {
      // En un PR manual, el precio ingresado por el usuario ya es el precio final.
      // No se agrega IVA al presupuesto (si luego se factura, se extrae del total final).
      const isManualPR = newPR.modalidad_emision === "manual";
      let subtotal = 0;
      let ivaTotal = 0;
      const itemsWithTotals = validItems.map((it, idx) => {
        const t = calcItemTotals(it, descGeneral);
        subtotal += t.subtotal;
        ivaTotal += isManualPR ? 0 : t.iva;
        return {
          ...it,
          // En el PR manual no se muestra ni suma IVA, pero conservamos la
          // alícuota interna para facturación y órdenes de compra posteriores.
          iva_porcentaje: it.iva_porcentaje,
          subtotal: t.subtotal,
          iva: isManualPR ? 0 : t.iva,
          total: isManualPR ? t.subtotal : t.total,
          orden: idx + 1,
        };
      });

      // Con el id de cada renglón la base lo actualiza en su lugar y no se cortan los vínculos con OC y remitos
      // (auditoría 28/10/2026, H06). Un id repetido (renglón copiado) va sin id: es un renglón nuevo.
      const idsVistos = new Set<string>();
      const idRenglon = (id?: string) => (id && !idsVistos.has(id) ? (idsVistos.add(id), id) : null);
      const buildItemRows = () => { idsVistos.clear(); return itemsWithTotals.map((it) => ({
        id: idRenglon(it.id),
        codigo: it.codigo ?? "",
        descripcion: it.descripcion,
        categoria: it.categoria ?? null,
        cantidad: it.cantidad,
        unidad: it.unidad ?? "u",
        precio_costo: it.precio_costo ?? 0,
        markup_porcentaje: Math.round((it.markup_porcentaje ?? 0) * 100) / 100,
        precio_venta: precioNeto(it, descGeneral),
        precio_lista: it.precio_venta ?? 0,
        descuento_porcentaje: Number(it.descuento_porcentaje) || 0,
        iva_porcentaje: it.iva_porcentaje ?? 21,
        // subtotal, iva y total los recalcula Supabase desde el precio de venta exacto.
        orden: it.orden,
        proveedor_id: it.proveedor_id || null,
        stock_propio: Boolean(it.stock_propio),
        lista_item_id: it.lista_item_id || null,
        proveedor_nombre: it.proveedor_nombre || null,
        costo_moneda: it.costo_moneda || "ARS",
      })); };

      if (editingPRId) {
        // ── UPDATE existing PR ──
        // Editing a solicitud is its conversion to a PR: keep the same row/number.
        const updatePayload: Record<string, unknown> = {
            cliente_id: newPR.cliente_id,
            vendedor_id: newPR.vendedor_id,
            sucursal_id: newPR.sucursal_id || null,
            contacto_id: newPR.contacto_id || null,
            markup_general: newPR.markup_general,
            subtotal,
            iva: ivaTotal,
            total: subtotal + ivaTotal,
            moneda: newPR.moneda,
            tipo_cambio: newPR.tipo_cambio > 0 ? newPR.tipo_cambio : null,
            tipo_cambio_divisas: newPR.tipo_cambio_divisas > 0 ? newPR.tipo_cambio_divisas : null,
            descuento_general_porcentaje: descGeneral || 0,
            cotizacion_modalidad: newPR.moneda === "USD" ? newPR.cotizacion_modalidad : null,
            observaciones: newPR.observaciones,
            notas_internas: newPR.notas_internas,
            vencimiento: newPR.vencimiento,
            tipo_comprobante: newPR.tipo_comprobante || null,
            modalidad_emision: newPR.modalidad_emision,
        };
        if (esSolicitud) {
          updatePayload.estado = "pendiente";
          updatePayload.enviado_at = new Date().toISOString();
        }
        const { error } = await (supabase as any).rpc("actualizar_presupuesto_atomico", {
          p_presupuesto_id: editingPRId,
          p_sociedad_id: sociedadActiva?.id,
          p_update: updatePayload,
          p_items: buildItemRows(),
        });
        if (error) throw new Error(error.message);
        await guardarEnvioInterno(editingPRId);

        // Sync existing OCs with updated PR items. Lo ya recibido se conserva (la OC queda con lo que falta).
        const ocsSynced = await syncOCsFromPR(editingPRId, newPR.modalidad_emision === "manual");

        setShowNewPR(false);
        setEsSolicitud(false);
        setEditingPRId(null);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, tipo_cambio_divisas: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", costo_envio_interno: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] });
        await fetchPresupuestos();
        toast.success(ocsSynced > 0 ? `Presupuesto actualizado — ${ocsSynced} OC actualizada(s) y marcada(s) como pendiente` : "Presupuesto actualizado");
      } else {
        // ── CREATE new PR ──
        const today = todayAR();

        const presupuestoPayload = {
            cliente_id: newPR.cliente_id,
            vendedor_id: newPR.vendedor_id || null,
            sucursal_id: newPR.sucursal_id || null,
            contacto_id: newPR.contacto_id || null,
            created_by: profile?.id,
            sociedad_id: sociedadActiva?.id || null,
            fecha: today,
            vencimiento: newPR.vencimiento,
            estado: esSolicitud ? "solicitud" : "pendiente",
            enviado_at: esSolicitud ? null : new Date().toISOString(),
            markup_general: newPR.markup_general,
            subtotal,
            iva: ivaTotal,
            total: subtotal + ivaTotal,
            moneda: newPR.moneda,
            tipo_cambio: newPR.tipo_cambio > 0 ? newPR.tipo_cambio : null,
            tipo_cambio_divisas: newPR.tipo_cambio_divisas > 0 ? newPR.tipo_cambio_divisas : null,
            descuento_general_porcentaje: descGeneral || 0,
            cotizacion_modalidad: newPR.moneda === "USD" ? newPR.cotizacion_modalidad : null,
            observaciones: newPR.observaciones,
            notas_internas: newPR.notas_internas,
            tipo_comprobante: newPR.tipo_comprobante || null,
            modalidad_emision: newPR.modalidad_emision,
          };

        const { data: newRowId, error } = await (supabase as any).rpc("crear_presupuesto_atomico", {
          p_sociedad_id: sociedadActiva?.id,
          p_presupuesto: presupuestoPayload,
          p_items: buildItemRows(),
        });

        if (error) throw new Error(error.message);
        if (!newRowId) throw new Error("Supabase no devolvio el presupuesto creado");
        await guardarEnvioInterno(String(newRowId));

        setShowNewPR(false);
        setEsSolicitud(false);
        setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, tipo_cambio_divisas: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", costo_envio_interno: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] });

        // Fetch the newly created PR with full joins before refreshing the list
        const { data: fullRow, error: reloadError } = await (supabase as any)
          .from("presupuestos")
          .select(`*, listo_para_facturar, clientes(razon_social, cuit, email, telefono, direccion, localidad, provincia, condicion_iva, limite_credito, saldo_cuenta_corriente), created_by_profile:created_by(full_name), vendedor_profile:vendedor_id(full_name, avatar_url), sucursal:sucursal_id(nombre, direccion, localidad, provincia), contacto:contacto_id(nombre, email), presupuesto_items(*)`)
          .eq("id", newRowId)
          .single();
        if (fullRow) {
          const createdPR = mapToPresupuesto(fullRow as any);
          // Solo mostrar popup post-creacion para presupuestos, no para solicitudes
          if (!esSolicitud) {
            setPostCreatePR(createdPR);
          } else {
            toast.success(`Solicitud ${createdPR.numero} creada`);
          }
        } else {
          // La escritura atómica ya terminó. Una falla de recarga no debe informar
          // que la creación falló ni inducir al usuario a duplicar el presupuesto.
          console.error("El presupuesto fue creado pero no se pudo recargar:", reloadError);
          toast.success(esSolicitud ? "Solicitud creada correctamente" : "Presupuesto creado correctamente");
        }

        try {
          await fetchPresupuestos();
        } catch (refreshError) {
          console.error("El presupuesto fue creado pero falló la actualización del listado:", refreshError);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      toast.error(`Error al ${editingPRId ? "actualizar" : "crear"} presupuesto: ${msg}`);
    } finally {
      setNewPRSaving(false);
    }
  }

  // Helper: toggle estado in multi-select
  function toggleEstado(estado: string) {
    setSelectedEstados(prev => {
      const next = new Set(prev);
      if (estado === "todos") {
        // Si se clickea "Todos", seleccionar/deseleccionar todo
        if (next.has("todos")) {
          // Ya está "todos" activo — deseleccionar todo (dejar vacío = mostrar nada, mejor no permitir)
          return new Set(["todos"]);
        }
        return new Set(["todos"]);
      }
      // Quitar "todos" si estaba
      next.delete("todos");
      if (next.has(estado)) {
        next.delete(estado);
      } else {
        next.add(estado);
      }
      // Si no queda nada seleccionado, volver a "todos"
      if (next.size === 0) return new Set(["todos"]);
      // Si se seleccionaron todos los estados individuales, equivale a "todos"
      if (next.size === allEstados.length) return new Set(["todos"]);
      return next;
    });
    if (vistaSeguimiento) setVistaSeguimiento(false);
  }

  const isAllSelected = selectedEstados.has("todos");

  const filtered = presupuestos.filter((pr) => {
    // Papelera filter
    const isEliminado = !!(pr as any).eliminado;
    if (showPapelera) return isEliminado;
    if (isEliminado) return false;
    // Estado filter (multi-select)
    if (!isAllSelected) {
      const prEsFacturado = facturadoIds.has(pr.id);
      const matchesEstado = selectedEstados.has(pr.estado);
      const matchesFacturado = selectedEstados.has("facturado") && prEsFacturado;
      if (!matchesEstado && !matchesFacturado) return false;
    } else if (!search.trim() && (facturadoIds.has(pr.id) || pr.estado === "facturado")) {
      // "Todos" no muestra los facturados (ocupan lugar): están en el botón "Facturado" y aparecen al buscar.
      return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const matchNumero = pr.numero.toLowerCase().includes(s);
      const matchCliente = pr.clienteNombre.toLowerCase().includes(s);
      const matchItems = pr.items?.some(it => (it.descripcion || "").toLowerCase().includes(s) || (it.codigo || "").toLowerCase().includes(s));
      if (!matchNumero && !matchCliente && !matchItems) return false;
    }
    if (vendedorFilter && (pr as any).vendedorId !== vendedorFilter) return false;
    if (operadorFilter && (pr as any).creadoPorId !== operadorFilter) return false;
    // Smart filters
    const fechaFilter = filterValues.fecha as { from?: string; to?: string } | undefined;
    if (fechaFilter?.from && pr.fecha < fechaFilter.from) return false;
    if (fechaFilter?.to && pr.fecha > fechaFilter.to) return false;
    const monedaFilter = filterValues.moneda as string;
    if (monedaFilter && pr.moneda !== monedaFilter) return false;
    const montoFilter = filterValues.monto as { min?: number; max?: number } | undefined;
    if (montoFilter?.min !== undefined && pr.total < montoFilter.min) return false;
    if (montoFilter?.max !== undefined && pr.total > montoFilter.max) return false;
    return true;
  });

  const activePRs = presupuestos.filter(pr => !(pr as any).eliminado);
  const counts: Record<string, number> = { todos: activePRs.length, facturado: 0 };
  const totals: Record<string, { ARS: number; USD: number }> = {};
  // Ganancia estimada de lo pendiente (para ver cuánto hay en juego y meterle pilas para cerrarlo).
  const gananciaPendiente = { ARS: 0, USD: 0 };
  // Los montos de los recuadros (Pendiente, Aprobado, Facturado) son solo del MES CORRIENTE, por fecha del PR.
  const mesActual = todayAR().slice(0, 7);
  const mesNombre = new Date(`${mesActual}-15T12:00:00`).toLocaleDateString("es-AR", { month: "long" });
  const countsMes: Record<string, number> = {};
  activePRs.forEach((pr) => {
    const estado = (facturadoIds.has(pr.id) || pr.estado === "facturado") ? "facturado" : pr.estado;
    if (pr.estado !== "facturado") counts[pr.estado] = (counts[pr.estado] || 0) + 1;
    if (estado === "facturado") counts.facturado = (counts.facturado || 0) + 1;
    if (String(pr.fecha || "").slice(0, 7) !== mesActual) return;
    countsMes[estado] = (countsMes[estado] || 0) + 1;
    if (!totals[estado]) totals[estado] = { ARS: 0, USD: 0 };
    totals[estado][pr.moneda === "USD" ? "USD" : "ARS"] += pr.total;
    if (!totals.todos) totals.todos = { ARS: 0, USD: 0 };
    totals.todos[pr.moneda === "USD" ? "USD" : "ARS"] += pr.total;
    if (pr.estado === "pendiente" && estado === "pendiente") {
      gananciaPendiente[pr.moneda === "USD" ? "USD" : "ARS"] += margenPR({ moneda: pr.moneda, tipoCambio: pr.tipoCambio, tipoCambioDivisas: pr.tipoCambioDivisas, modalidadEmision: (pr as any).modalidadEmision, costoEnvioInterno: (pr as any).costoEnvioInterno, items: pr.items || [] }).ganancia;
    }
  });
  // El botón "Todos" cuenta solo lo que muestra (sin facturados).
  counts.todos = Math.max(0, counts.todos - (counts.facturado || 0));

  // Flete interno: solo interno, resta de la ganancia, nunca va al cliente. Se guarda aparte del guardado atómico;
  // si la columna todavía no existe (migración sin correr) avisa y no frena el guardado.
  async function guardarEnvioInterno(prId: string) {
    const monto = Math.max(0, Number(newPR.costo_envio_interno) || 0);
    // Si no hay envío y antes tampoco había, no se toca la base (así nada falla antes de correr la migración).
    const teniaAntes = Number((presupuestos.find((p) => p.id === prId) as any)?.costoEnvioInterno) > 0;
    if (monto === 0 && !teniaAntes) return;
    const { error } = await (supabase as any).from("presupuestos")
      .update({ costo_envio_interno: monto })
      .eq("id", prId).eq("sociedad_id", sociedadActiva?.id);
    if (error) toast.warning("El presupuesto se guardó, pero no el envío interno (" + error.message + ")");
  }

  // Sync existing OCs when PR items change
  async function syncOCsFromPR(prId: string, isManual: boolean): Promise<number> {
    try {
      // Get active OCs linked to this PR
      const { data: ocs } = await supabase
        .from("ordenes_compra")
        .select("id, proveedor_id, moneda, observaciones, estado")
        .eq("presupuesto_origen_id", prId)
        .not("estado", "eq", "cancelada");
      if (!ocs || ocs.length === 0) return 0;

      // Get fresh PR items
      const { data: prItems } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", prId);
      if (!prItems) return 0;

      // Renglones del PR ya atados a un renglón de alguna OC viva (Compras nueva los puede mover de proveedor).
      const ocDeRenglon = new Map<string, string>();
      try {
        const { data: atados } = await (supabase as any).from("orden_compra_items")
          .select("presupuesto_item_id, orden_id, ordenes_compra!inner(estado)")
          .in("presupuesto_item_id", prItems.map((it: any) => it.id)).neq("ordenes_compra.estado", "cancelada");
        for (const a of (atados || []) as { presupuesto_item_id: string; orden_id: string }[]) ocDeRenglon.set(a.presupuesto_item_id, a.orden_id);
      } catch { /* sin el dato, se arma como siempre */ }

      for (const oc of ocs) {
        // Match PR items to this OC by proveedor_id
        const isStockOwnOC = !oc.proveedor_id && String((oc as any).observaciones || "").includes("Stock propio");
        const enOtraOC = (it: any) => { const o = ocDeRenglon.get(it.id); return !!o && o !== oc.id; };
        const matchingItems = prItems.filter((it: any) => ocDeRenglon.get(it.id) === oc.id || (!enOtraOC(it) && (isStockOwnOC
          ? Boolean(it.stock_propio) && normalizePurchaseCurrency(it.costo_moneda) === normalizePurchaseCurrency(oc.moneda)
          : it.proveedor_id === oc.proveedor_id && !it.stock_propio)));
        if (matchingItems.length === 0) continue;

        // Se actualizan los renglones de la OC en su lugar (no se borran): así se conserva lo recibido
        // y los datos del proveedor/talle. Un renglón nuevo del PR se agrega; uno sacado del PR se borra
        // solo si no llegó nada.
        const { data: viejosRaw } = await (supabase as any).from("orden_compra_items").select("*").eq("orden_id", oc.id);
        const viejos: any[] = [...(viejosRaw || [])];
        const norm = (t: any) => String(t || "").trim().toLowerCase();
        const sacar = (pred: (v: any) => boolean) => { const k = viejos.findIndex(pred); return k >= 0 ? viejos.splice(k, 1)[0] : null; };
        const ocItems: any[] = [];
        for (let idx = 0; idx < matchingItems.length; idx++) {
          const it: any = matchingItems[idx];
          const viejo = sacar((v) => v.presupuesto_item_id === it.id)
            || (norm(it.codigo) ? sacar((v) => norm(v.codigo) === norm(it.codigo)) : null)
            || sacar((v) => norm(v.descripcion) === norm(it.descripcion));
          const datos = {
            codigo: it.codigo || "",
            descripcion: it.descripcion || "Sin descripción",
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || "u",
            precio_unitario: Number(it.precio_costo) || 0,
            iva_porcentaje: isManual ? 0 : Number(it.iva_porcentaje ?? 21),
            orden: idx + 1,
            presupuesto_item_id: it.id,
            moneda: normalizePurchaseCurrency(it.costo_moneda),
          };
          if (viejo) {
            await (supabase as any).from("orden_compra_items").update(datos).eq("id", viejo.id);
            ocItems.push({ ...datos, cantidad_recibida: Number(viejo.cantidad_recibida) || 0 });
          } else {
            const nuevoItem = { ...datos, orden_id: oc.id, cantidad_recibida: 0 };
            await (supabase as any).from("orden_compra_items").insert(nuevoItem);
            ocItems.push(nuevoItem);
          }
        }
        // Renglones que ya no están en el PR: se borran solo si no llegó nada (si llegó algo, quedan).
        for (const v of viejos) {
          if (Number(v.cantidad_recibida) > 0) {
            ocItems.push({ ...v, precio_unitario: Number(v.precio_unitario) || 0, cantidad: Number(v.cantidad) || 0, iva_porcentaje: Number(v.iva_porcentaje ?? 21) });
          } else {
            await (supabase as any).from("orden_compra_items").delete().eq("id", v.id);
          }
        }

        // Recalculate OC totals
        const ocSubtotal = ocItems.reduce((sum, it) => sum + it.precio_unitario * it.cantidad, 0);
        const ocIva = isManual ? 0 : ocItems.reduce((sum, it) => sum + it.precio_unitario * it.cantidad * (it.iva_porcentaje / 100), 0);

        // Determine moneda from items
        const costoMonedas = new Set(matchingItems.map((it: any) => (it.costo_moneda || "ARS").startsWith("USD") ? "USD" : "ARS"));
        const ocMoneda = costoMonedas.size === 1 ? [...costoMonedas][0] : "ARS";

        const hayRecibido = ocItems.some((i) => Number(i.cantidad_recibida) > 0);
        await (supabase as any)
          .from("ordenes_compra")
          // Sin nada recibido la OC conserva su estado (antes ponía "pendiente", que no existe y fallaba en silencio: auditoría H56).
          .update({ subtotal: ocSubtotal, iva: ocIva, total: ocSubtotal + ocIva, moneda: ocMoneda, estado: hayRecibido ? estadoPorRecibido(ocItems, oc.estado || "enviada") : (oc.estado || "enviada") })
          .eq("id", oc.id);
      }
      return ocs.length;
    } catch (err) {
      console.error("Error syncing OCs from PR:", err);
      return 0;
    }
  }

  async function generateOCsFromPresupuesto(prId: string) {
    try {
      // Fetch presupuesto items with proveedor info
      const { data: itemsDb, error: itemsErr } = await supabase
        .from("presupuesto_items")
        .select("*")
        .eq("presupuesto_id", prId);
      if (itemsErr || !itemsDb || itemsDb.length === 0) return;
      let items = itemsDb;

      // Get presupuesto header for numero and sociedad_id
      const { data: prHeader } = await (supabase as any)
        .from("presupuestos")
        .select("numero, sociedad_id, modalidad_emision, iva, created_by")
        .eq("id", prId)
        .single();
      const prNumero = prHeader?.numero ?? "";
      const sociedadId = prHeader?.sociedad_id ?? sociedadActiva?.id ?? null;
      const prCreatedBy = prHeader?.created_by ?? null;
      // PR manual = sin IVA. Doble chequeo: modalidad_emision O iva encabezado = 0
      const compraSinIva = prHeader?.modalidad_emision === "manual" || Number(prHeader?.iva) === 0;

      // Check if OCs already exist for this PR (avoid duplicates on re-approval)
      const { data: existingOCs } = await supabase
        .from("ordenes_compra")
        .select("id")
        .eq("presupuesto_origen_id", prId)
        .not("estado", "eq", "cancelada");
      // Re-aprobar (auditoría 28/10/2026, H44): si el PR ya tiene OC, solo se proponen OC para los renglones que no están
      // en ninguna (por ejemplo, si la primera vez falló un proveedor). Se pregunta antes: nada se arma solo.
      if (existingOCs && existingOCs.length > 0) {
        const { data: cubiertos } = await (supabase as any).from("orden_compra_items").select("presupuesto_item_id")
          .in("orden_id", existingOCs.map((o: { id: string }) => o.id));
        const ya = new Set(((cubiertos || []) as { presupuesto_item_id: string | null }[]).map((c) => c.presupuesto_item_id).filter(Boolean));
        const faltan = items.filter((it: any) => !ya.has(it.id));
        if (faltan.length === 0) {
          toast.info("Este PR ya tiene OC para todos sus renglones. No se crearon duplicados.");
          return;
        }
        const muestra = faltan.slice(0, 3).map((it: any) => it.descripcion).join(", ") + (faltan.length > 3 ? "…" : "");
        if (!confirm(`Este PR ya tiene ${existingOCs.length} OC, pero ${faltan.length} renglón(es) no están en ninguna: ${muestra}.

¿Armo OC solo para esos?`)) {
          toast.info("No se crearon OC nuevas.");
          return;
        }
        items = faltan;
      }

      // Los items de stock propio conservan su costo para el margen y ahora generan
      // una OC interna real, para que también puedan pasar por recepción y dejar
      // trazabilidad del ingreso al circuito de compras.
      const stockItemsCount = items.filter((item: any) => Boolean(item.stock_propio)).length;
      // Supabase generated types lag this table's costo_moneda column; keep the
      // row shape explicit here because internal purchase orders are grouped by it.
      const stockItems = (items as any[]).filter((item: any) => Boolean(item.stock_propio));
      const itemsAComprar = items.filter((item: any) => !item.stock_propio);

      // Group purchasable items by proveedor_id (items sin proveedor van a key "__sin_proveedor__")
      const byProveedor: Record<string, any[]> = {};
      for (const item of itemsAComprar) {
        const provId = (item as any).proveedor_id || "__sin_proveedor__";
        if (!byProveedor[provId]) byProveedor[provId] = [];
        byProveedor[provId].push(item);
      }

      // Separate items with and without proveedor
      const sinProveedorCount = (byProveedor["__sin_proveedor__"] || []).length;
      const conProveedorIds = Object.keys(byProveedor).filter(k => k !== "__sin_proveedor__");

      if (conProveedorIds.length === 0 && sinProveedorCount === 0 && stockItemsCount === 0) {
        toast.info("PR aprobado. No se generaron OC (sin items).");
        return;
      }

      let ocsCreated = 0;
      let ocCreationFailed = false;
      let stockItemsWithOC = 0;
      const today = todayAR();

      // Only generate OCs for items that HAVE a proveedor assigned
      for (const provId of conProveedorIds) {
        const provItems = byProveedor[provId];

        // Skip OC if ALL items for this proveedor have zero cost
        const allZeroCost = provItems.every((it: any) => Number(it.precio_costo) === 0);
        if (allZeroCost) {
          console.warn(`Skipping OC for proveedor ${provId}: all ${provItems.length} item(s) have precio_costo = 0`);
          toast.warning(`OC no generada para un proveedor: todos los items tienen costo $0`);
          continue;
        }

        const subtotal = provItems.reduce((sum, it) => sum + Number(it.precio_costo) * Number(it.cantidad), 0);
        const iva = compraSinIva ? 0 : provItems.reduce((sum, it) => sum + Number(it.precio_costo) * Number(it.cantidad) * ((Number(it.iva_porcentaje ?? 21)) / 100), 0);

        // Determine OC moneda from items' costo_moneda (cost currency), NOT from PR sale moneda
        // If items have mixed cost currencies, default to ARS
        const costoMonedas = new Set(provItems.map((it: any) => (it.costo_moneda || "ARS").startsWith("USD") ? "USD" : "ARS"));
        const ocMoneda = costoMonedas.size === 1 ? [...costoMonedas][0] : "ARS";

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: provId,
            presupuesto_origen_id: prId,
            sociedad_id: sociedadId,
            fecha: today,
            moneda: ocMoneda,
            estado: "enviada",
            subtotal,
            iva,
            total: subtotal + iva,
            observaciones: `Generada automáticamente desde ${prNumero}`,
            created_by: prCreatedBy ?? profile?.id ?? (await supabase.auth.getUser()).data.user?.id ?? null,
          } as any)
          .select()
          .single();

        if (ocErr || !ocRow) {
          console.error("Error creating OC for proveedor:", provId, JSON.stringify(ocErr));
          toast.error(`Error al crear OC: ${ocErr?.message ?? "sin datos de respuesta"}`);
          ocCreationFailed = true;
          continue;
        }

        // Create OC items (subtotal is GENERATED ALWAYS — don't insert it)
        const ocItems = provItems.map((it: any, idx: number) => ({
          orden_id: ocRow.id,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "Sin descripción",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "u",
          precio_unitario: Number(it.precio_costo) || 0,
          iva_porcentaje: compraSinIva ? 0 : Number(it.iva_porcentaje ?? 21),
          orden: idx + 1,
          cantidad_recibida: 0,
          presupuesto_item_id: it.id,
          // Cada renglón guarda la moneda de su costo: una OC puede tener renglones en pesos y en dólares (auditoría H42).
          moneda: normalizePurchaseCurrency(it.costo_moneda),
        }));
        const { error: itemsErr } = await supabase.from("orden_compra_items").insert(ocItems as any);
        if (itemsErr) {
          console.error("Error inserting OC items:", JSON.stringify(itemsErr));
          // Sin renglones la OC no sirve: se borra el encabezado para que re-aprobar la vuelva a armar (auditoría H44).
          const { data: borrada } = await supabase.from("ordenes_compra").delete().eq("id", ocRow.id).eq("sociedad_id" as any, sociedadId).select("id").maybeSingle();
          toast.error(borrada
            ? `No se generó una OC: falló la carga de sus renglones (${itemsErr.message}). Aprobá de nuevo para reintentar.`
            : `OC ${ocRow.numero ?? ""} creada pero falló la carga de items: ${itemsErr.message}`);
          ocCreationFailed = true;
          continue;
        }
        ocsCreated++;
      }

      // Stock propio no tiene proveedor externo, pero necesita una OC interna
      // real para entrar al circuito de recepción. Se separa por moneda de costo.
      if (stockItems.length > 0) {
        for (const { moneda, items: currencyItems } of groupOwnStockItemsByCurrency(stockItems)) {
          const totals = calculateOwnStockPurchaseOrder(currencyItems, compraSinIva);
          if (totals.subtotal <= 0) {
            console.warn(`Skipping internal stock OC ${moneda}: total cost is zero`);
            toast.warning(`OC interna de stock propio ${moneda} no generada: el costo total es $0`);
            continue;
          }

          const { data: stockOC, error: stockOCErr } = await supabase
            .from("ordenes_compra")
            .insert({
              proveedor_id: null,
              presupuesto_origen_id: prId,
              sociedad_id: sociedadId,
              fecha: today,
              moneda,
              estado: "enviada",
              ...totals,
              observaciones: `Stock propio — OC generada desde ${prNumero}`,
              created_by: prCreatedBy ?? profile?.id ?? (await supabase.auth.getUser()).data.user?.id ?? null,
            } as any)
            .select()
            .single();
          if (stockOCErr || !stockOC) {
            console.error("Error creating internal stock OC:", JSON.stringify(stockOCErr));
            toast.error(`No se pudo crear la OC interna de stock propio ${moneda}: ${stockOCErr?.message ?? "sin respuesta"}`);
            ocCreationFailed = true;
            continue;
          }

          const stockOCItems = currencyItems.map((it: any, idx: number) => ({
            orden_id: stockOC.id,
            codigo: it.codigo || "",
            descripcion: it.descripcion || "Sin descripción",
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || "u",
            precio_unitario: Number(it.precio_costo) || 0,
            iva_porcentaje: compraSinIva ? 0 : Number(it.iva_porcentaje ?? 21),
            orden: idx + 1,
            cantidad_recibida: 0,
            presupuesto_item_id: it.id,
            moneda: normalizePurchaseCurrency(it.costo_moneda),
          }));
          const { error: stockItemsErr } = await supabase.from("orden_compra_items").insert(stockOCItems as any);
          if (stockItemsErr) {
            console.error("Error inserting internal stock OC items:", JSON.stringify(stockItemsErr));
            const { data: deletedOC, error: cleanupError } = await supabase.from("ordenes_compra").delete().eq("id", stockOC.id).eq("sociedad_id" as any, sociedadId).select("id").maybeSingle();
            toast.error(cleanupError || !deletedOC
              ? `OC ${stockOC.numero ?? ""} ${moneda} quedó incompleta (sin items) y no se pudo limpiar. Contactá soporte con ID ${stockOC.id}.`
              : `No se generó la OC interna ${moneda}: falló la carga de sus items y se limpió el encabezado.`);
            ocCreationFailed = true;
            continue;
          }
          ocsCreated++;
          stockItemsWithOC += currencyItems.length;
        }
      }

      // Also generate OC for items WITHOUT proveedor (so user can assign later)
      const sinProvItems = byProveedor["__sin_proveedor__"] || [];
      const sinProvAllZeroCost = sinProvItems.length > 0 && sinProvItems.every((it: any) => Number(it.precio_costo) === 0);
      if (sinProvAllZeroCost) {
        console.warn(`Skipping OC sin proveedor: all ${sinProvItems.length} item(s) have precio_costo = 0`);
        toast.warning(`OC sin proveedor no generada: todos los items tienen costo $0`);
      } else if (sinProvItems.length > 0) {
        const subtotalSP = sinProvItems.reduce((sum: number, it: any) => sum + Number(it.precio_costo) * Number(it.cantidad), 0);
        const ivaSP = compraSinIva ? 0 : sinProvItems.reduce((sum: number, it: any) => sum + Number(it.precio_costo) * Number(it.cantidad) * ((Number(it.iva_porcentaje ?? 21)) / 100), 0);
        const costoMonedasSP = new Set(sinProvItems.map((it: any) => (it.costo_moneda || "ARS").startsWith("USD") ? "USD" : "ARS"));
        const ocMonedaSP = costoMonedasSP.size === 1 ? [...costoMonedasSP][0] : "ARS";

        const { data: ocRow, error: ocErr } = await supabase
          .from("ordenes_compra")
          .insert({
            proveedor_id: null,
            presupuesto_origen_id: prId,
            sociedad_id: sociedadId,
            fecha: todayAR(),
            moneda: ocMonedaSP,
            estado: "enviada",
            subtotal: subtotalSP,
            iva: ivaSP,
            total: subtotalSP + ivaSP,
            observaciones: `Generada desde ${prNumero} — asignar proveedor`,
            created_by: prCreatedBy ?? profile?.id ?? (await supabase.auth.getUser()).data.user?.id ?? null,
          } as any)
          .select()
          .single();

        if (!ocErr && ocRow) {
          const ocItemsSP = sinProvItems.map((it: any, idx: number) => ({
            orden_id: ocRow.id,
            codigo: it.codigo || "",
            descripcion: it.descripcion || "Sin descripción",
            cantidad: Number(it.cantidad) || 1,
            unidad: it.unidad || "u",
            precio_unitario: Number(it.precio_costo) || 0,
            iva_porcentaje: compraSinIva ? 0 : Number(it.iva_porcentaje ?? 21),
            orden: idx + 1,
            cantidad_recibida: 0,
            presupuesto_item_id: it.id,
            moneda: normalizePurchaseCurrency(it.costo_moneda),
          }));
          const { error: itemsSPError } = await supabase.from("orden_compra_items").insert(ocItemsSP as any);
          if (itemsSPError) {
            const { data: deletedOC, error: cleanupError } = await supabase.from("ordenes_compra").delete().eq("id", ocRow.id).eq("sociedad_id" as any, sociedadId).select("id").maybeSingle();
            toast.error(cleanupError || !deletedOC
              ? `OC ${ocRow.numero ?? ""} quedó incompleta (sin items) y no se pudo limpiar. Contactá soporte con ID ${ocRow.id}.`
              : `No se generó la OC sin proveedor: falló la carga de sus items y se limpió el encabezado.`);
            ocCreationFailed = true;
          } else {
            ocsCreated++;
          }
        } else {
          console.error("Error creating OC without provider:", JSON.stringify(ocErr));
          toast.error(`No se pudo crear la OC sin proveedor: ${ocErr?.message ?? "sin respuesta"}`);
          ocCreationFailed = true;
        }
      }

      if (ocCreationFailed) {
        toast.warning(ocsCreated > 0
          ? `Generación parcial: ${ocsCreated} OC(s) completas; una o más fallaron. Revisá los avisos antes de continuar.`
          : "No se completó la generación de todas las OCs. Revisá los avisos antes de continuar.");
      } else if (ocsCreated > 0) {
        toast.success(`Se generaron ${ocsCreated} orden(es) de compra automáticamente`);
      }

      // Notify about items without proveedor that were skipped
      if (sinProveedorCount > 0 && sinProvItems.length > 0) {
        toast.info(`${sinProveedorCount} item(s) sin proveedor — OC creada en borrador para asignar proveedor`);
      }
      if (stockItemsWithOC > 0) toast.info(`${stockItemsWithOC} item(s) de stock propio: OC(s) interna(s) creada(s) como enviada(s), listas para recibir`);
    } catch (err) {
      console.error("Error generating OCs:", err);
      toast.warning("PR aprobado pero hubo un error al generar las OC");
    }
  }

  async function handleEstadoChange(id: string, estado: PRStatus, motivo?: string) {
    // If approving, check for items with precio_costo === 0
    if (estado === "aprobado") {
      try {
        const { data: items } = await supabase
          .from("presupuesto_items")
          .select("id, precio_costo")
          .eq("presupuesto_id", id);
        const sinCosto = (items || []).filter((it: any) => !it.precio_costo || Number(it.precio_costo) === 0);
        if (sinCosto.length > 0) {
          // Show confirmation dialog instead of proceeding directly
          setCostosFaltantesModal({ id, count: sinCosto.length, motivo });
          return;
        }
      } catch {
        // If we can't check items, proceed anyway
      }
    }

    await doEstadoChange(id, estado, motivo);
  }

  async function doEstadoChange(id: string, estado: PRStatus, motivo?: string) {
    try {
      const update: { estado: string; motivo_rechazo?: string; enviado_at?: string; respondido_at?: string } = { estado };
      if (motivo) update.motivo_rechazo = motivo;
      if (estado === "pendiente") update.enviado_at = new Date().toISOString();
      if (["aprobado", "rechazado", "postergado"].includes(estado)) update.respondido_at = new Date().toISOString();

      let estadoQuery = supabase
        .from("presupuestos")
        .update(update as any)
        .eq("id", id);
      if (sociedadActiva?.id) estadoQuery = estadoQuery.eq("sociedad_id" as any, sociedadActiva.id);
      const { error, status, statusText } = await estadoQuery;
      if (error) throw new Error(`${error.message} (${error.code}) [${status} ${statusText}]`);

      // When approved, auto-generate purchase orders grouped by supplier
      if (estado === "aprobado") {
        // Augusto 20/10: cliente en rojo en el BCRA → aviso al aprobar (nunca frena).
        void avisoBCRARojo(presupuestos.find(p => p.id === id)?.clienteId).then(t => { if (t) toast.warning(t); });
        // Track if this PR has items without costs
        try {
          const { data: items } = await supabase
            .from("presupuesto_items")
            .select("id, precio_costo")
            .eq("presupuesto_id", id);
          const sinCosto = (items || []).filter((it: any) => !it.precio_costo || Number(it.precio_costo) === 0);
          if (sinCosto.length > 0) {
            setPrsSinCostos(prev => new Set(prev).add(id));
          }
        } catch { /* ignore */ }

        await generateOCsFromPresupuesto(id);
        // Compras nueva: si alguien se encarga de compras (casilla en Configuración → Usuarios),
        // el vendedor no manda nada: los pedidos quedan en "Compras nueva → Para pedir".
        let comprasSeEncarga = !!profile?.prueba_compras_nueva;
        if (!comprasSeEncarga && profile?.role === "vendedor") {
          try {
            const { data: compradores } = await (supabase as any).from("profiles").select("id").eq("prueba_compras_nueva", true).eq("active", true).limit(1);
            comprasSeEncarga = !!compradores?.length;
          } catch { /* si no se puede saber, sigue como siempre */ }
        }
        if (comprasSeEncarga) {
          toast.info(profile?.prueba_compras_nueva ? "Pedidos armados: están en Compras Lazza, Por pedir." : "Listo: Compras se encarga de pedirle a los proveedores.");
        } else
        // Propuesta: enviar ya las OC con proveedor que todavía no se pidieron (sugerencia, se puede cerrar).
        try {
          const { data: ocsPR } = await (supabase as any).from("ordenes_compra").select("id, numero")
            .eq("presupuesto_origen_id", id).not("proveedor_id", "is", null).neq("estado", "cancelada").or("pedido.is.null,pedido.eq.false");
          if (ocsPR?.length) {
            const pr = presupuestos.find(p => p.id === id);
            setEnviarOCs({ ids: ocsPR.map((o: { id: string }) => o.id), titulo: `PR ${pr?.numero || ""} aprobado: ¿enviamos ${ocsPR.length === 1 ? "la OC" : `las ${ocsPR.length} OC`} al proveedor?` });
          }
        } catch { /* la propuesta es opcional: nunca frena la aprobación */ }
      }

      if (estado === "rechazado") setVentaCaida({ prId: id, numero: presupuestos.find((p) => p.id === id)?.numero || "El PR" });
      await fetchPresupuestos();
      if (selected?.id === id) {
        setSelected((prev) => prev ? { ...prev, estado, motivoRechazo: motivo ?? prev.motivoRechazo } : null);
      }

      const statusLabels: Record<string, string> = {
        solicitud: "marcado como solicitud",
        pendiente: "marcado como pendiente",
        aprobado: "aprobado",
        rechazado: "rechazado",
        postergado: "postergado",
      };
      toast.success(`Presupuesto ${statusLabels[estado] ?? estado}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error("Error updating estado:", msg);
      toast.error(`Error al cambiar estado: ${msg}`);
    }
  }

  async function handleDuplicate(id: string) {
    try {
      const original = presupuestos.find((p) => p.id === id);
      if (!original) return;

      // Get full data from Supabase
      const { data: fullPR, error } = await supabase
        .from("presupuestos")
        .select(`*, presupuesto_items(*)`)
        .eq("id", id)
        .single();

      if (error || !fullPR) {
        console.error("Error fetching PR for duplicate:", error);
        toast.error("Error al duplicar presupuesto");
        return;
      }

      const { id: _id, numero: _num, created_at: _ca, updated_at: _ua, enviado_at: _ea, respondido_at: _ra, presupuesto_items, ...rest } = fullPR;

      const { data: newPRRow, error: insertError } = await supabase
        .from("presupuestos")
        // La OC del cliente, su fecha y el adjunto son de la operación original: el duplicado arranca sin ellos.
        .insert({ ...rest, estado: "pendiente", version: 1, oc_cliente: null, oc_cliente_fecha: null, archivo_url: null, archivo_nombre: null } as any)
        .select()
        .single();

      if (insertError || !newPRRow) {
        console.error("Error duplicating:", insertError);
        toast.error("Error al duplicar presupuesto");
        return;
      }

      if (presupuesto_items && presupuesto_items.length > 0) {
        const items = presupuesto_items.map(({ id: _iid, presupuesto_id: _pid, created_at: _ica, subtotal: _st, iva: _iv, total: _tot, ...itemRest }: Record<string, unknown>) => ({
          ...itemRest,
          presupuesto_id: newPRRow.id,
        }));
        await supabase.from("presupuesto_items").insert(items as any);
      }

      toast.success("Presupuesto duplicado correctamente");
      await fetchPresupuestos();
    } catch (err) {
      console.error("Error duplicating PR:", err);
      toast.error("Error al duplicar presupuesto");
    }
  }

  async function handleDelete(id: string) {
    const pr = presupuestos.find((p) => p.id === id) || (selected?.id === id ? selected : null);
    // Se pide el motivo (se puede dejar vacío); Cancelar no elimina nada.
    const motivo = window.prompt(`¿Eliminar ${pr?.numero || "este presupuesto"}? Escribí el motivo (podés dejarlo vacío) y apretá Aceptar.`, "");
    if (motivo === null) return;
    try {
      // OC vinculadas: solo admin decide cancelarlas (el vendedor no toca OC).
      let cancelOCsToo = false;
      if (canDeletePresupuestos) {
        let ocQuery = supabase.from("ordenes_compra").select("id, numero").eq("presupuesto_origen_id", id).not("estado", "eq", "cancelada");
        if (sociedadActiva?.id) ocQuery = ocQuery.eq("sociedad_id" as any, sociedadActiva.id);
        const { data: linkedOCs } = await ocQuery;
        const hasOCs = linkedOCs && linkedOCs.length > 0;
        cancelOCsToo = !!hasOCs && confirm(`Este presupuesto tiene ${linkedOCs!.length} OC vinculada(s) (${linkedOCs!.map((oc: any) => oc.numero).join(", ")}). ¿Querés cancelarlas también?`);
      }

      const nota = `[${formatDate(todayAR())}] Eliminado por ${profile?.full_name || "usuario"}${motivo.trim() ? `: ${motivo.trim()}` : ""}`;
      const notasInternas = [String(pr?.notasInternas || "").trim(), nota].filter(Boolean).join("\n");
      let prDelete = supabase.from("presupuestos").update({ eliminado: true, notas_internas: notasInternas } as any).eq("id", id);
      if (sociedadActiva?.id) prDelete = prDelete.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await prDelete;
      if (error) throw new Error(error.message);

      if (cancelOCsToo) {
        let cancelOCs = supabase.from("ordenes_compra").update({ estado: "cancelada" } as any).eq("presupuesto_origen_id", id).not("estado", "eq", "cancelada");
        if (sociedadActiva?.id) cancelOCs = cancelOCs.eq("sociedad_id" as any, sociedadActiva.id);
        await cancelOCs;
      }

      setSelected(null);
      setPanelFullscreen(false);
      setPresupuestos(prev => prev.map(p => p.id === id ? { ...p, eliminado: true, notasInternas } as any : p));
      toast.success(cancelOCsToo ? "Presupuesto eliminado (OCs canceladas)" : "Presupuesto eliminado");
    } catch (err: unknown) {
      console.error("Error deleting:", err);
      const message = err instanceof Error ? err.message : "Error inesperado";
      toast.error(`No se pudo eliminar: ${message}`);
    }
  }

  // PR vencido → 5 días más desde hoy (Augusto 20/10). Si estaba en "vencido" vuelve a Pendiente.
  async function extenderVencimiento5(pr: Presupuesto) {
    const [y, mo, d] = todayAR().split("-").map(Number);
    const nuevo = new Date(Date.UTC(y, mo - 1, d + 5)).toISOString().slice(0, 10);
    const estado = pr.estado === "vencido" ? "pendiente" : pr.estado;
    let q = supabase.from("presupuestos").update({ vencimiento: nuevo, estado } as any).eq("id", pr.id);
    if (sociedadActiva?.id) q = q.eq("sociedad_id" as any, sociedadActiva.id);
    const { data, error } = await q.select("id");
    if (error || !data?.length) { toast.error(error ? `No se pudo extender: ${error.message}` : "No se pudo extender: ese PR es de otro vendedor"); return; }
    setPresupuestos(prev => prev.map(p => p.id === pr.id ? { ...p, vencimiento: nuevo, estado } as any : p));
    setSelected(prev => prev && prev.id === pr.id ? { ...prev, vencimiento: nuevo, estado } as any : prev);
    toast.success(`${pr.numero}: válido hasta ${formatDate(nuevo)}`);
  }

  async function handleRestore(id: string) {
    try {
      let restorePR = supabase.from("presupuestos").update({ eliminado: false } as any).eq("id", id);
      if (sociedadActiva?.id) restorePR = restorePR.eq("sociedad_id" as any, sociedadActiva.id);
      const { error } = await restorePR;
      if (error) throw new Error(error.message);
      setPresupuestos(prev => prev.map(p => p.id === id ? { ...p, eliminado: false } as any : p));
      // Solo un PR aprobado arma OC al restaurarse (auditoría H45: antes le creaba OC aunque estuviera pendiente).
      const restaurado = presupuestos.find((p) => p.id === id);
      if (restaurado?.estado === "aprobado") {
        await generateOCsFromPresupuesto(id);
        toast.success("Presupuesto restaurado");
      } else {
        toast.success("Presupuesto restaurado (no se arman OC: no está aprobado)");
      }
    } catch {
      toast.error("Error al restaurar");
    }
  }

  async function handleDeletePermanent(id: string) {
    if (!confirm("Eliminar PERMANENTEMENTE? Esta accion no se puede deshacer.")) return;
    try {
      const { data: deletedId, error } = await (supabase as any).rpc("delete_presupuesto_safe", {
        p_presupuesto_id: id,
      });
      if (error) throw new Error(error.message);
      if (deletedId !== id) throw new Error("Supabase no confirmó la eliminación del presupuesto");
      toast.success("Presupuesto eliminado permanentemente");
      await fetchPresupuestos();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error inesperado";
      toast.error(`No se pudo eliminar: ${message}`);
    }
  }

  async function handleEditPR(pr: Presupuesto) {
    try {
      // Fetch full PR with items
      const { data: fullPR, error } = await (supabase as any)
        .from("presupuestos")
        .select(`*, presupuesto_items(*)`)
        .eq("id", pr.id)
        .single();
      if (error || !fullPR) { toast.error("Error al cargar presupuesto"); return; }
      // PR de la otra sociedad: se pasa a esa sociedad para que carguen su cliente, sus listas y se guarde bien.
      if (fullPR.sociedad_id && sociedadActiva?.id && fullPR.sociedad_id !== sociedadActiva.id) {
        const otra = sociedades.find((s) => s.id === fullPR.sociedad_id);
        if (otra) { setSociedadActiva(otra); toast.info(`${fullPR.numero} es de ${otra.nombre}: cambié a ${otra.nombre}.`); }
        else toast.warning(`${fullPR.numero} es de otra sociedad: puede que no cargue el cliente.`);
      }

      const prMoneda = fullPR.moneda || "USD";
      setDescGeneral(Number(fullPR.descuento_general_porcentaje) || 0);
      const prTc = Number(fullPR.tipo_cambio) || 0;
      const items: NewPRItem[] = (fullPR.presupuesto_items || [])
        .sort((a: any, b: any) => (a.orden || 0) - (b.orden || 0))
        .map((it: any) => {
          const costo = Number(it.precio_costo) || 0;
          const pv = Number(it.precio_lista ?? it.precio_venta) || 0;
          let markup = Number(it.markup_porcentaje) || 0;
          // Back-calculate markup if DB has null/0 but precio_venta and precio_costo exist.
          // Si está guardado (con 2 decimales), se usa el exacto del precio: así no se corre el precio al rearmarlo.
          if (costo > 0 && pv > 0) {
            const prTcDivisas = Number(fullPR.tipo_cambio_divisas) || 0;
            const costoConv = convertCosto(costo, it.costo_moneda || "ARS", prMoneda, prTc, prTcDivisas);
            if (costoConv > 0) {
              const exacto = ((pv / costoConv) - 1) * 100;
              if (!markup || Math.abs(exacto - markup) < 0.006) markup = exacto;
            }
          }
          return {
          id: it.id || undefined,
          codigo: it.codigo || "",
          descripcion: it.descripcion || "",
          categoria: it.categoria || "",
          cantidad: Number(it.cantidad) || 1,
          unidad: it.unidad || "UN",
          precio_costo: costo,
          markup_porcentaje: markup,
          precio_venta: pv,
          descuento_porcentaje: Number(it.descuento_porcentaje) || 0,
          iva_porcentaje: it.iva_porcentaje != null ? Number(it.iva_porcentaje) : 21,
          proveedor_nombre: it.proveedor_nombre || "",
          proveedor_id: it.proveedor_id || "",
          stock_propio: Boolean(it.stock_propio),
          lista_item_id: it.lista_item_id || "",
          costo_moneda: (it.costo_moneda || "ARS") as "ARS" | "USD" | "USD Divisa",
        };
        });

      setNewPR({
        cliente_id: fullPR.cliente_id || "",
        vendedor_id: fullPR.vendedor_id || "",
        sucursal_id: fullPR.sucursal_id || "",
        contacto_id: fullPR.contacto_id || "",
        moneda: fullPR.moneda || "USD",
        tipo_cambio: Number(fullPR.tipo_cambio) || 0,
        tipo_cambio_divisas: Number(fullPR.tipo_cambio_divisas) || 0,
        cotizacion_modalidad: (fullPR.cotizacion_modalidad || "divisas") as "divisas" | "billetes",
        markup_general: Number(fullPR.markup_general) || 30,
        observaciones: fullPR.observaciones || "",
        notas_internas: fullPR.notas_internas || "",
        costo_envio_interno: Number((fullPR as any).costo_envio_interno) > 0 ? String(Number((fullPR as any).costo_envio_interno)) : "",
        vencimiento: fullPR.vencimiento || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
        tipo_comprobante: (fullPR as any).tipo_comprobante || "",
        modalidad_emision: (fullPR as any).modalidad_emision || "sin_definir",
        items: items.length > 0 ? items : [{ ...emptyItem, markup_porcentaje: Number(fullPR.markup_general) || 30 }],
      });

      setEsSolicitud(fullPR.estado === "solicitud");
      setEditingPRId(pr.id);
      setClientSearch("");
      setSelected(null);
      setPanelFullscreen(false);
      setShowNewPR(true);
      // Sólo hace falta cotización si hay costos en USD. Al cargarla para editar,
      // conservar siempre el precio de venta exacto que ya fue aceptado.
      const needsDivisasRate = items.some((item) => item.costo_moneda === "USD" || item.costo_moneda === "USD Divisa");
      // En pesos el dólar lo completa el efecto de PR en pesos (billete y divisa, sin tocar precios).
      if (needsDivisasRate && prMoneda !== "ARS" && !Number(fullPR.tipo_cambio_divisas)) {
        fetchCotizBna("divisas", undefined, { preserveItemPrices: true });
      }
    } catch (err) {
      console.error("Error loading PR for edit:", err);
      toast.error("Error al cargar presupuesto para editar");
    }
  }

  function handleRechazoConfirm() {
    if (rechazoModal && motivoRechazo.trim()) {
      handleEstadoChange(rechazoModal, rechazoTipo, motivoRechazo.trim());
      setRechazoModal(null);
      setMotivoRechazo("");
      setRechazoTipo("rechazado");
    }
  }

  function buildPRSummaryText(pr: Presupuesto) {
    const p = pr as any;
    const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
    const mon = pr.moneda;
    const isB = p.tipoComprobante === "B";
    const isManual = p.modalidadEmision === "manual";
    const manualTotal = pr.items.reduce((sum, it) => sum + it.cantidad * it.precioVenta, 0);
    const lines = [
      `*PRESUPUESTO ${pr.numero}*`,
      "",
      `Fecha: ${formatDate(pr.fecha)}`,
      `Vencimiento: ${formatDate(pr.vencimiento)}`,
      `Estado: ${estadoLabel}`,
      `Moneda: ${mon}`,
      p.vendedorNombre ? `Vendedor: ${p.vendedorNombre}` : null,
      "",
      `*Cliente:* ${pr.clienteNombre}`,
      p.clienteCuit ? `CUIT: ${p.clienteCuit}` : null,
      p.clienteEmail ? `Email: ${p.clienteEmail}` : null,
      p.clienteTelefono ? `Tel: ${p.clienteTelefono}` : null,
      p.clienteDireccion ? `Dir: ${p.clienteDireccion}${p.clienteLocalidad ? `, ${p.clienteLocalidad}` : ""}${p.clienteProvincia ? `, ${p.clienteProvincia}` : ""}` : null,
      p.sucursalNombre ? `Sucursal: ${p.sucursalNombre}` : null,
      "",
      "*Items:*",
      ...pr.items.map((it, i) => {
        const ivaPct = Number(it.ivaPorcentaje ?? (it.subtotal ? (it.iva / it.subtotal) * 100 : 21));
        const precioUnitarioCliente = isB ? it.precioVenta * (1 + ivaPct / 100) : it.precioVenta;
        const totalCliente = isB ? it.total : it.cantidad * it.precioVenta;
        return `${i + 1}. ${it.codigo} - ${it.descripcion}\n   ${it.cantidad} ${it.unidad} x ${formatCurrency(precioUnitarioCliente, mon)} = ${formatCurrency(totalCliente, mon)}`;
      }),
      "",
      isManual ? null : `Subtotal: ${formatCurrency(isB ? pr.total : pr.subtotal, mon)}`,
      isManual ? null : (isB ? `IVA contenido: ${formatCurrency(pr.iva, mon)}` : `IVA: ${formatCurrency(pr.iva, mon)}`),
      `*Total: ${formatCurrency(isManual ? manualTotal : pr.total, mon)}*`,
      observacionesParaCliente(pr.observaciones) ? `\nObs: ${observacionesParaCliente(pr.observaciones)}` : null,
    ];
    return lines.filter((l) => l !== null).join("\n");
  }

  const [copiedPR, setCopiedPR] = useState(false);
  function handleCopyPR(pr: Presupuesto) {
    navigator.clipboard.writeText(buildPRSummaryText(pr));
    setCopiedPR(true);
    setTimeout(() => setCopiedPR(false), 2000);
  }

  async function loadSucursalForPDF(pr: Presupuesto) {
    const fallback = {
      nombre: pr.sucursalNombre || "",
      direccion: pr.sucursalDireccion || "",
    };
    if (!pr.sucursalId) return fallback;

    const { data, error } = await (supabase as any)
      .from("cliente_sucursales")
      .select("nombre, direccion, localidad, provincia")
      .eq("id", pr.sucursalId)
      .maybeSingle();
    if (error || !data) return fallback;

    return {
      nombre: data.nombre || fallback.nombre,
      direccion: [data.direccion, data.localidad, data.provincia].filter(Boolean).join(", ") || fallback.direccion,
    };
  }

  async function handlePrint(pr: Presupuesto) {
    const p = pr as any;
    if (!sociedadActiva) return;
    if (!seguirConFaltantesDePrecio(pr, "Descargar")) return;
    const sucursalPDF = await loadSucursalForPDF(pr);
    const soc = getSociedadPDF(sociedadActiva);
    const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
    const html = generatePresupuestoPDF({
      numero: pr.numero,
      fecha: pr.fecha,
      vencimiento: pr.vencimiento,
      estado: pr.estado,
      estadoLabel,
      moneda: pr.moneda,
      subtotal: pr.subtotal,
      iva: pr.iva,
      total: pr.total,
      observaciones: pr.observaciones,
      creadoPor: pr.creadoPor,
      clienteNombre: pr.clienteNombre,
      clienteCuit: p.clienteCuit,
      clienteCondicionIva: p.clienteCondicionIva,
      clienteEmail: p.clienteEmail,
      clienteTelefono: p.clienteTelefono,
      sucursalNombre: sucursalPDF.nombre,
      sucursalDireccion: sucursalPDF.direccion,
      vendedorNombre: p.vendedorNombre,
      tipoComprobante: p.tipoComprobante,
      modalidadEmision: p.modalidadEmision,
      cotizacionModalidad: p.cotizacionModalidad,
      tipoCambio: p.tipoCambio,
      tipoCambioDivisas: (p as any).tipoCambioDivisas,
      descuentoGeneralPorcentaje: pr.descuentoGeneralPorcentaje,
      items: pr.items.map(it => ({
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        unidad: it.unidad,
        precioVenta: it.precioVenta,
        precioLista: it.precioLista,
        total: it.total,
        ivaPorcentaje: it.ivaPorcentaje ?? (it.subtotal ? (it.iva / it.subtotal) * 100 : 21),
      })),
    }, soc);
    await openPDFWindow(html, `${pr.numero}.pdf`);
  }

  if (loading) {
    return (
      <>
        <Header title="Presupuestos" subtitle="Cargando..." action={{ label: "Nuevo PR", onClick: () => {} }} />
        <div className="flex items-center justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
        </div>
      </>
    );
  }

  // Totals for the new PR form
  let newPRSub = 0;
  let newPRIva = 0;
  newPR.items.forEach((it) => {
    const t = calcItemTotals(it, descGeneral);
    newPRSub += t.subtotal;
    newPRIva += newPR.modalidad_emision === "manual" ? 0 : t.iva;
  });
  // Resumen fijo abajo de la ventana: subtotal, IVA, total, margen y ganancia (margen < 15 % en rojo: aviso, nunca bloquea).
  const resumenPR = resumenPresupuesto(newPR.items.map((it) => ({
    cantidad: it.cantidad, neto: precioNeto(it, descGeneral), iva: newPR.modalidad_emision === "manual" ? 0 : it.iva_porcentaje,
    costo: costoEnMonedaPR(it.precio_costo, it.costo_moneda, newPR.moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas),
  })), MARGEN_MINIMO, gastosPorcentajePR(newPR.modalidad_emision));
  const mostrarIva = verIva || newPR.items.some((it) => Number(it.iva_porcentaje) !== 21);
  const colsVisibles = Object.keys(COLS_DEFAULT).filter((c) => c !== "iva" || mostrarIva);

  return (
    <>
      <Header
        title="Presupuestos"
        subtitle={`${presupuestos.length} presupuestos totales`}
        action={{ label: "Nuevo PR", onClick: () => setShowNewPR(true) }}
      />
      <div className="p-3 sm:p-4 space-y-2.5">
        {/* Vencidos de los últimos 30 días: ventas para recuperar */}
        {!showPapelera && (() => {
          const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
          const venc = presupuestos.filter((pr) => pr.estado === "vencido" && !(pr as any).eliminado && String(pr.vencimiento || pr.fecha || "").slice(0, 10) >= desde);
          if (venc.length === 0) return null;
          const ars = venc.filter((pr) => pr.moneda !== "USD").reduce((a, pr) => a + (Number(pr.subtotal) || 0), 0);
          const usd = venc.filter((pr) => pr.moneda === "USD").reduce((a, pr) => a + (Number(pr.subtotal) || 0), 0);
          return (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 min-w-0">
                <b>{venc.length} {venc.length === 1 ? "vencido" : "vencidos"}</b> (últimos 30 días) · {usd > 0 && <b className="font-mono">{formatCurrency(usd, "USD")}</b>}{usd > 0 && ars > 0 && " + "}{ars > 0 && <b className="font-mono">{formatCurrency(ars, "ARS")}</b>} sin IVA — ventas para recuperar
              </span>
              <button type="button" onClick={() => { setVistaSeguimiento(false); setSelectedEstados(new Set(["vencido"])); }} className="rounded-md bg-red-600 px-2.5 py-0.5 font-semibold text-white hover:bg-red-700">Ver →</button>
            </div>
          );
        })()}
        {/* Status multi-select toggles + seguimiento */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 flex-wrap flex-1">
            {/* Botón "Todos" */}
            <button
              onClick={() => toggleEstado("todos")}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap ${
                isAllSelected && !vistaSeguimiento
                  ? "bg-orange-500 text-white shadow-sm"
                  : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {isAllSelected && <Check className="h-3.5 w-3.5" />}
              Todos
              <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                isAllSelected && !vistaSeguimiento ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
              }`}>
                {counts.todos || 0}
              </span>
            </button>
            {/* Botones por estado */}
            {(["solicitud", "pendiente", "vencido", "aprobado", "facturar", "rechazado", "postergado", "facturado"] as PRStatus[]).map((status) => {
              const active = !isAllSelected && selectedEstados.has(status);
              const activeColor = status === "solicitud" ? "bg-blue-600 text-white shadow-sm" : status === "facturar" ? "bg-blue-500 text-white shadow-sm" : status === "facturado" ? "bg-purple-600 text-white shadow-sm" : status === "vencido" ? "bg-red-600 text-white shadow-sm" : "bg-orange-500 text-white shadow-sm";
              const vencidoRojo = status === "vencido" && (counts.vencido || 0) > 0;
              return (
                <button
                  key={status}
                  onClick={() => toggleEstado(status)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap ${
                    active && !vistaSeguimiento
                      ? activeColor
                      : vencidoRojo
                        ? "bg-red-50 text-red-700 border border-red-300 hover:bg-red-100 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
                        : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {active && <Check className="h-3.5 w-3.5" />}
                  {status === "solicitud" && <Inbox className="h-3.5 w-3.5" />}
                  {(status === "facturar" || status === "facturado") && <Receipt className="h-3.5 w-3.5" />}
                  {statusConfig[status].label}
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${
                    active && !vistaSeguimiento ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"
                  }`}>
                    {counts[status] || 0}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setVistaSeguimiento(!vistaSeguimiento)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors whitespace-nowrap ${
              vistaSeguimiento
                ? "bg-orange-500 text-white shadow-sm"
                : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            <CalendarClock className="h-4 w-4" />
            Seguimiento
          </button>
        </div>

        {/* Totals by estado */}
        {!showPapelera && !vistaSeguimiento && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400" title="Los montos de estos recuadros son solo de los presupuestos del mes corriente">Montos de {mesNombre}</span>
            {(isAllSelected
              ? ["pendiente", "aprobado", "facturar", "facturado"] as const
              : [...selectedEstados].filter(s => s !== "todos") as string[]
            ).map((estado) => {
              const t = totals[estado] || { ARS: 0, USD: 0 }; // sin movimientos este mes: se muestra en cero
              if (!t) return null;
              const cfg = statusConfig[estado as PRStatus] || { label: estado, variant: "outline" as const };
              return (
                <div key={estado} className="flex items-baseline gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 dark:border-zinc-800 dark:bg-zinc-900">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{cfg.label} ({countsMes[estado] || 0})</span>
                  {t.USD > 0 && <span className="font-mono text-[13px] font-bold text-zinc-900 dark:text-white">{formatCurrency(t.USD, "USD")}</span>}
                  {t.ARS > 0 && <span className={`font-mono ${t.USD > 0 ? "text-xs text-zinc-500 dark:text-zinc-400" : "text-[13px] font-bold dark:text-zinc-100"}`}>{t.USD > 0 ? "+ " : ""}{formatCurrency(t.ARS, "ARS")}</span>}
                  {t.USD === 0 && t.ARS === 0 && <span className="font-mono text-[13px] text-zinc-300 dark:text-zinc-600">—</span>}
                  {estado === "pendiente" && (gananciaPendiente.USD !== 0 || gananciaPendiente.ARS !== 0) && (
                    <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400" title="Ganancia estimada de los pendientes, descontando 7 % de gastos (2 % si es manual). Solo interno.">
                      · Ganancia {gananciaPendiente.USD !== 0 ? formatCurrency(gananciaPendiente.USD, "USD") : ""}{gananciaPendiente.USD !== 0 && gananciaPendiente.ARS !== 0 ? " + " : ""}{gananciaPendiente.ARS !== 0 ? formatCurrency(gananciaPendiente.ARS, "ARS") : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Search + Vendedor + Operador + Fecha filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Buscar por N° PR, cliente o items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            />
          </div>
          <select
            value={vendedorFilter}
            onChange={(e) => setVendedorFilter(e.target.value)}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los vendedores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
          <select
            value={operadorFilter}
            onChange={(e) => setOperadorFilter(e.target.value)}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <option value="">Todos los operadores</option>
            {vendedores.map((v) => (
              <option key={v.id} value={v.id}>{v.full_name}</option>
            ))}
          </select>
          <SmartFilters filters={filterConfigs} values={filterValues} onChange={setFilterValues} className="contents" />
        </div>

        {/* ==================== VISTA SEGUIMIENTO ==================== */}
        {vistaSeguimiento ? (() => {
          const today = new Date();
          const trackingPRs = presupuestos
            .filter((pr) => {
              if ((pr as any).eliminado) return false;
              if (pr.estado !== "solicitud" && pr.estado !== "pendiente" && pr.estado !== "postergado" && pr.estado !== "vencido") return false;
              if (search) {
                const s = search.toLowerCase();
                if (!pr.numero.toLowerCase().includes(s) && !pr.clienteNombre.toLowerCase().includes(s) && !pr.items?.some(it => (it.descripcion || "").toLowerCase().includes(s) || (it.codigo || "").toLowerCase().includes(s))) return false;
              }
              if (vendedorFilter && (pr as any).vendedorId !== vendedorFilter) return false;
              if (operadorFilter && (pr as any).creadoPorId !== operadorFilter) return false;
              return true;
            })
            .map((pr) => {
              const fechaRef = pr.enviadoAt || pr.fecha;
              const refDate = new Date(fechaRef + (fechaRef.includes("T") ? "" : "T12:00:00"));
              const diffMs = today.getTime() - refDate.getTime();
              const diasSinRespuesta = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
              let urgencia: "verde" | "amarillo" | "naranja" | "rojo";
              if (diasSinRespuesta >= 7) urgencia = "rojo";
              else if (diasSinRespuesta >= 5) urgencia = "naranja";
              else if (diasSinRespuesta >= 3) urgencia = "amarillo";
              else urgencia = "verde";
              return { ...pr, diasSinRespuesta, urgencia, fechaRef };
            })
            .sort((a, b) => {
              const urgOrder = { rojo: 0, naranja: 1, amarillo: 2, verde: 3 };
              if (urgOrder[a.urgencia] !== urgOrder[b.urgencia]) return urgOrder[a.urgencia] - urgOrder[b.urgencia];
              return b.diasSinRespuesta - a.diasSinRespuesta;
            });

          const urgenciaColors = {
            verde: { border: "border-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/20", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500" },
            amarillo: { border: "border-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950/20", badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300", dot: "bg-yellow-500" },
            naranja: { border: "border-orange-400", bg: "bg-orange-50 dark:bg-orange-950/20", badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", dot: "bg-orange-500" },
            rojo: { border: "border-red-400", bg: "bg-red-50 dark:bg-red-950/20", badge: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-500" },
          };

          const urgenciaLabels = { verde: "1-2 días", amarillo: "3-4 días", naranja: "5-6 días", rojo: "7+ días" };

          const countByUrgencia = { verde: 0, amarillo: 0, naranja: 0, rojo: 0 };
          trackingPRs.forEach((pr) => { countByUrgencia[pr.urgencia]++; });

          return (
            <div className="space-y-2">
              {/* Resumen de urgencia: chips chicos */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(["rojo", "naranja", "amarillo", "verde"] as const).map((urg) => (
                  <span key={urg} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${urgenciaColors[urg].badge}`}>
                    <span className={`h-2 w-2 rounded-full ${urgenciaColors[urg].dot}`} />
                    {urgenciaLabels[urg]} <b>{countByUrgencia[urg]}</b>
                  </span>
                ))}
              </div>

              {trackingPRs.length === 0 ? (
                <Card className="p-5 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Sin presupuestos pendientes de seguimiento</p>
                </Card>
              ) : (
                <Card className="p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-[11px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800">
                        <th className="px-2 py-1.5">Días</th>
                        <th className="px-2 py-1.5">N°</th>
                        <th className="px-2 py-1.5">Estado</th>
                        <th className="px-2 py-1.5">Cliente</th>
                        <th className="px-2 py-1.5 hidden md:table-cell">Vendedor</th>
                        <th className="px-2 py-1.5">Enviado</th>
                        <th className="px-2 py-1.5 text-right">Subtotal s/IVA</th>
                        <th className="px-2 py-1.5 hidden lg:table-cell">Motivo</th>
                        <th className="px-2 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {trackingPRs.map((pr) => {
                        const colors = urgenciaColors[pr.urgencia];
                        const telefono = (pr as any).clienteTelefono;
                        const cfg = statusConfig[pr.estado] || { label: pr.estado, variant: "outline" as const };
                        return (
                          <tr key={pr.id} onClick={() => setSelected(pr)} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                            <td className="px-2 py-1 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${colors.badge}`} title={`${pr.diasSinRespuesta} ${pr.diasSinRespuesta === 1 ? "día" : "días"} sin respuesta`}>
                                <span className={`h-2 w-2 rounded-full ${colors.dot}`} />{pr.diasSinRespuesta}d
                              </span>
                            </td>
                            <td className="px-2 py-1 font-mono font-semibold whitespace-nowrap text-zinc-800 dark:text-zinc-100">{pr.numero}</td>
                            <td className="px-2 py-1"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
                            <td className="px-2 py-1 max-w-[220px] truncate font-medium text-zinc-700 dark:text-zinc-300" title={pr.clienteNombre}>{pr.clienteNombre}</td>
                            <td className="px-2 py-1 hidden md:table-cell text-zinc-500 whitespace-nowrap">{(pr as any).vendedorNombre || "—"}</td>
                            <td className="px-2 py-1 text-zinc-500 whitespace-nowrap">{formatDate(pr.fechaRef)}</td>
                            <td className="px-2 py-1 text-right font-mono whitespace-nowrap font-semibold whitespace-nowrap text-zinc-700 dark:text-zinc-200" title={`Total: ${formatCurrency(pr.total, pr.moneda)}`}>{formatCurrency(pr.subtotal, pr.moneda)}</td>
                            <td className="px-2 py-1 hidden lg:table-cell max-w-[200px] truncate text-purple-700 dark:text-purple-300" title={pr.motivoRechazo || ""}>{pr.estado === "postergado" ? pr.motivoRechazo || "" : ""}</td>
                            <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1">
                                <select
                                  value=""
                                  onChange={(e) => {
                                    const newEstado = e.target.value as PRStatus;
                                    if (!newEstado) return;
                                    if (newEstado === "rechazado") {
                                      setRechazoModal(pr.id);
                                      setMotivoRechazo("");
                                    } else {
                                      handleEstadoChange(pr.id, newEstado);
                                    }
                                  }}
                                  className="h-6 rounded-md border border-zinc-200 bg-white px-1 text-[11px] text-zinc-600 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                >
                                  <option value="">Estado…</option>
                                  {ESTADOS_MANUALES
                                    .filter((s) => s !== pr.estado || s === "rechazado")
                                    .map((s) => {
                                      const c = statusConfig[s] || { label: s };
                                      return <option key={s} value={s}>{c.label}</option>;
                                    })}
                                </select>
                                {telefono && (
                                  <a href={`tel:${telefono}`} title={`Llamar: ${telefono}`}
                                    className="flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40">
                                    <Phone className="h-3 w-3" />Llamar
                                  </a>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          );
        })() : (
          <>
        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <DataTable<Presupuesto>
            columns={[
              {
                key: "fecha", label: "Fecha", sortable: true,
                render: (row) => {
                  const enviadoAt = row.enviadoAt;
                  const createdAt = row.createdAt;
                  const earliest = enviadoAt && createdAt
                    ? (new Date(enviadoAt) < new Date(createdAt) ? enviadoAt : createdAt)
                    : enviadoAt || createdAt;
                  return <span className="text-zinc-600 dark:text-zinc-300 text-xs whitespace-nowrap">{earliest ? formatDate(earliest) : "—"}</span>;
                },
              },
              {
                key: "numero", label: "N°", sortable: true,
                render: (row) => (
                  <div className="flex items-center gap-1.5">
                    {row.estado === "solicitud" ? <Inbox className="h-3.5 w-3.5 text-blue-400" /> : <FileText className="h-3.5 w-3.5 text-zinc-400" />}
                    <span className="font-mono text-xs font-bold whitespace-nowrap">{row.estado === "solicitud" ? row.numero.replace("PR-", "SOL-") : row.numero}</span>
                    {(envios.get(row.id)?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400" title={`Enviado por mail:\n${envios.get(row.id)!.map(e => textoEnvio(e, nombreUsuario)).join("\n")}`}>
                        <Mail className="h-3 w-3" />{envios.get(row.id)!.length > 1 ? envios.get(row.id)!.length : ""}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "items", label: "Detalle", sortable: false,
                render: (row) => {
                  // Para solicitudes sin items, mostrar observaciones/notas como resumen
                  if (!row.items || row.items.length === 0) {
                    const texto = row.observaciones || (row as any).notasInternas || "";
                    if (!texto) return <span className="text-zinc-400 text-xs">—</span>;
                    const truncated = texto.length > 60 ? texto.slice(0, 57) + "..." : texto;
                    return <span className="text-xs text-blue-600 dark:text-blue-400 italic" title={texto}>{truncated}</span>;
                  }
                  const descs = row.items.slice(0, 2).map(it => it.descripcion || it.codigo || "").filter(Boolean);
                  let text = descs.join(", ");
                  if (text.length > 50) text = text.slice(0, 47) + "...";
                  else if (row.items.length > 2) text += "...";
                  return <span className="block max-w-[260px] truncate text-xs text-zinc-600 dark:text-zinc-400" title={row.items.map(it => it.descripcion).join(", ")}>{text}</span>;
                },
              },
              {
                key: "clienteNombre", label: "Cliente", sortable: true,
                render: (row) => <span className="block max-w-[200px] truncate font-medium text-xs" title={row.clienteNombre}>{row.clienteNombre}</span>,
              },
              {
                key: "sucursalNombre", label: "Sucursal", sortable: true,
                render: (row) => <span className="block max-w-[130px] truncate text-xs text-zinc-600 dark:text-zinc-300" title={row.sucursalNombre || ""}>{row.sucursalNombre || "—"}</span>,
              },
              {
                key: "subtotal", label: "Subtotal s/IVA", className: "text-right", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return (
                    <span className="font-mono text-xs block text-right whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                      {formatCurrency(row.subtotal, row.moneda)}
                    </span>
                  );
                },
              },
              {
                key: "total", label: "Total c/IVA", className: "text-right", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return (
                    <span className="font-mono text-xs font-semibold block text-right whitespace-nowrap">
                      {formatCurrency(row.total, row.moneda)}
                    </span>
                  );
                },
              },
              {
                key: "ganancia" as any, label: "Ganancia / Margen", className: "text-right", sortable: true,
                sortValue: (row: Presupuesto) => {
                  const m = margenPR({ moneda: row.moneda, tipoCambio: row.tipoCambio, tipoCambioDivisas: row.tipoCambioDivisas, modalidadEmision: (row as any).modalidadEmision, costoEnvioInterno: (row as any).costoEnvioInterno, items: row.items || [] });
                  if (m.margenPct === null) return null;
                  // Para ordenar USD y pesos juntos, la ganancia en US$ se pasa a pesos con el dólar del PR.
                  const tc = row.moneda === "USD" ? (Number(row.tipoCambio) || Number(row.tipoCambioDivisas) || 1) : 1;
                  return m.ganancia * tc;
                },
                render: (row: Presupuesto) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  const m = margenPR({ moneda: row.moneda, tipoCambio: row.tipoCambio, tipoCambioDivisas: row.tipoCambioDivisas, modalidadEmision: (row as any).modalidadEmision, costoEnvioInterno: (row as any).costoEnvioInterno, items: row.items || [] });
                  if (m.margenPct === null) return <span className="text-zinc-400 text-xs" title="Este PR no tiene costos cargados">—</span>;
                  const color = m.margenPct < MARGEN_MINIMO_PR ? "text-red-600 dark:text-red-400" : m.margenPct < MARGEN_MINIMO_PR + 5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
                  return (
                    <div className="text-right whitespace-nowrap" title={`Venta ${formatCurrency(m.venta, row.moneda)} − ${m.gastosPct} % de gastos e impuestos − costo ${formatCurrency(m.costo, row.moneda)}. Solo interno.`}>
                      <span className={`font-mono text-xs font-semibold ${color}`}>{m.margenPct.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
                      <span className="ml-1.5 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{formatCurrency(m.ganancia, row.moneda)}</span>
                    </div>
                  );
                },
              },
              {
                key: "vendedorNombre" as any, label: "Vend / Op", sortable: true,
                render: (row) => {
                  const vend = (row as any).vendedorNombre;
                  const op = row.creadoPor;
                  const vendInitials = vend ? vend.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join("") : "";
                  const opInitials = op ? op.split(/\s+/).map((w: string) => w.charAt(0).toUpperCase()).join("") : "";
                  if (!vend && !op) return <span className="text-zinc-400 text-xs">—</span>;
                  if (vend === op || !op) {
                    return (
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-orange-100 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={vend}>
                        {vendInitials}
                      </span>
                    );
                  }
                  return (
                    <div className="flex items-center gap-1">
                      {vendInitials && <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-orange-100 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300" title={`Vendedor: ${vend}`}>{vendInitials}</span>}
                      {opInitials && <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={`Operador: ${op}`}>{opInitials}</span>}
                    </div>
                  );
                },
              },
              {
                key: "enviadoAt" as any, label: "Enviado", sortable: true,
                render: (row) => {
                  if (row.estado === "solicitud") return <span className="text-zinc-400 text-xs">—</span>;
                  return row.enviadoAt ? <span className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{formatDate(row.enviadoAt)}</span> : <span className="text-zinc-400 text-xs">—</span>;
                },
              },
              {
                key: "estado", label: "Estado", sortable: true,
                render: (row) => {
                  const cfg = statusConfig[row.estado] || { label: row.estado, variant: "outline" as const, icon: Clock };
                  const Icon = cfg.icon;
                  const sinCostos = row.estado === "aprobado" && prsSinCostos.has(row.id);

                  // Indicador de vencimiento para PRs activos
                  let vencTag: React.ReactNode = null;
                  let vencido = row.estado === "vencido";
                  if (["pendiente", "postergado", "solicitud"].includes(row.estado) && row.vencimiento) {
                    const dias = Math.floor((new Date(row.vencimiento + "T23:59:59").getTime() - Date.now()) / 86400000);
                    if (dias < 0) {
                      vencido = true;
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" title={`Venció hace ${Math.abs(dias)} días`}>VENCIDO</span>;
                    } else if (dias <= 5) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    } else if (dias <= 10) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    } else if (dias <= 20) {
                      vencTag = <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={`Vence en ${dias} días`}>{dias}d</span>;
                    }
                  }

                  return (
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5" />
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      {vencTag}
                      {vencido && !showPapelera && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); void extenderVencimiento5(row); }}
                          title="Extender vencimiento 5 días (desde hoy)"
                          className="whitespace-nowrap rounded border border-orange-300 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30">
                          Extender 5 días
                        </button>
                      )}
                      {sinCostos && (
                        <span title="Items sin costos cargados">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </div>
                  );
                },
              },
                {
                key: "actions", label: "", sortable: false,
                render: (row) => (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {showPapelera ? (
                      <>
                        <button onClick={() => handleRestore(row.id)} className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400" title="Restaurar">
                          <ArrowRight className="h-3.5 w-3.5" /> Restaurar
                        </button>
                        <button onClick={() => handleDeletePermanent(row.id)} className="rounded p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40" title="Eliminar permanentemente">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setSelected(row)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Ver">
                          <Eye className="h-4 w-4" />
                        </button>
                        {row.estado === "solicitud" ? (
                          <button
                            onClick={() => handleEditPR(row)}
                            className="flex items-center gap-1 rounded-md bg-orange-50 px-2 py-1.5 text-xs font-medium text-orange-600 hover:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-400"
                            title="Convertir esta solicitud en presupuesto"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Convertir
                          </button>
                        ) : (
                          <button onClick={() => handleDuplicate(row.id)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar presupuesto">
                            <Copy className="h-4 w-4" />
                          </button>
                        )}
                        <select
                          value=""
                          onChange={(e) => {
                            const newEstado = e.target.value as PRStatus;
                            if (!newEstado) return;
                            if (newEstado === "rechazado") {
                              setRechazoModal(row.id);
                              setMotivoRechazo("");
                            } else {
                              handleEstadoChange(row.id, newEstado);
                            }
                          }}
                          className="h-7 rounded border border-zinc-200 bg-white px-1 text-xs text-zinc-600 focus:border-orange-300 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          title="Cambiar estado"
                        >
                          <option value="">Cambiar...</option>
                          {ESTADOS_MANUALES
                            .filter((s) => s !== row.estado || s === "rechazado")
                            .map((s) => {
                              const cfg = statusConfig[s] || { label: s };
                              return <option key={s} value={s}>{cfg.label}</option>;
                            })}
                        </select>
                        {puedeEliminarPR(row) && (
                          <button
                            onClick={() => handleDelete(row.id)}
                            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                            title="Eliminar presupuesto"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            data={filtered}
            onRowClick={(row) => setSelected(row)}
          />
        </Card>

        {/* Motivos de rechazo: se sacó de esta pantalla (pedido de Augusto, 14/10); el motivo sigue en el detalle de cada PR. */}
          </>
        )}
      </div>

      {/* ==================== DETAIL SIDE PANEL ==================== */}
      {selected && (
        <>
          {panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setPanelFullscreen(false)} />
          )}
          {!panelFullscreen && (
            <div className="fixed inset-0 z-40 bg-black/20 transition-opacity" onClick={() => { setSelected(null); setPanelFullscreen(false); }} />
          )}
          <div className={panelFullscreen
            ? "@container fixed inset-4 z-50 overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl animate-slide-in-right"
            : "@container fixed right-0 top-0 z-50 h-full w-full overflow-y-auto bg-white shadow-2xl dark:bg-zinc-900 animate-slide-in-right max-w-3xl"
          }>
            {/* Panel header */}
            <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-zinc-200 bg-white/95 backdrop-blur-sm px-3 @lg:px-5 py-2 dark:border-zinc-700 dark:bg-zinc-900/95">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <h2 className="whitespace-nowrap text-base font-bold text-zinc-900 @lg:text-lg dark:text-white">{selected.numero}</h2>
                  {(() => {
                    const cfg = statusConfig[selected.estado] || { label: selected.estado, variant: "outline" as const };
                    const sinCostos = selected.estado === "aprobado" && prsSinCostos.has(selected.id);
                    return (
                      <div className="flex items-center gap-1.5">
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                        {sinCostos && (
                          <span title="Items sin costos cargados" className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="text-[10px] font-semibold">Sin costos</span>
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <p className="truncate text-sm text-zinc-500" title={selected.clienteNombre}>{selected.clienteNombre}</p>
                {limiteExcedido?.prId === selected.id && limiteExcedido.excedido && (
                  <div className="flex items-center gap-1 mt-1 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> Límite de crédito excedido
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => handleCopyPR(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                  title="Copiar resumen"
                >
                  {copiedPR ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  <span className="hidden @2xl:inline">{copiedPR ? "Copiado" : "Copiar"}</span>
                </button>
                <button
                  onClick={() => handlePrint(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                  title="Descargar PDF"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden @2xl:inline">PDF</span>
                </button>
                <button
                  onClick={() => openEmailModal(selected)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30 transition-colors"
                  title="Enviar por email"
                >
                  <Mail className="h-3.5 w-3.5" />
                  <span className="hidden @2xl:inline">Email</span>
                </button>
                {(
                  <button
                    onClick={() => handleEditPR(selected)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 transition-colors"
                    title={selected.estado === "solicitud" ? "Convertir esta solicitud en presupuesto" : "Editar presupuesto"}
                  >
                    {selected.estado === "solicitud" ? <ArrowRight className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
                    <span className="hidden @2xl:inline">{selected.estado === "solicitud" ? "Convertir" : "Editar"}</span>
                  </button>
                )}
                {selected.estado !== "solicitud" && remitidoStatus[selected.id] !== "total" && (
                  <button
                    onClick={() => setRemitarPrId(selected.id)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950/30 transition-colors"
                    title="Generar remito"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span className="hidden @xl:inline">{remitidoStatus[selected.id] === "parcial" ? "Remitar pendiente" : "Remitar"}</span>
                  </button>
                )}
                <button onClick={() => handleDuplicate(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title="Duplicar">
                  <Copy className="h-4 w-4" />
                </button>
                {puedeEliminarPR(selected) && (
                  <button onClick={() => handleDelete(selected.id)} className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40" title="Eliminar">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button onClick={toggleFullscreen} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800" title={panelFullscreen ? "Reducir" : "Ampliar"}>
                  <Maximize2 className="h-4 w-4" />
                </button>
                <button onClick={() => { setSelected(null); setPanelFullscreen(false); }} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="p-3 @lg:p-4 space-y-3">
              {/* Info grid */}
              <div className="grid grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-4 gap-x-3 gap-y-1.5">
                <div>
                  <p className="text-xs text-zinc-500">Fecha</p>
                  <p className="text-sm font-medium">{formatDate(selected.fecha)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Vencimiento</p>
                  <p className="text-sm font-medium">{formatDate(selected.vencimiento)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Creado por</p>
                  <p className="text-sm font-medium">{selected.creadoPor}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Vendedor</p>
                  <select
                    value={(selected as any).vendedorId || ""}
                    onChange={async (e) => {
                      const newVendedorId = e.target.value || null;
                      let updateQuery = supabase.from("presupuestos").update({ vendedor_id: newVendedorId } as any).eq("id", selected.id);
                      if (sociedadActiva?.id) updateQuery = updateQuery.eq("sociedad_id" as any, sociedadActiva.id);
                      const { error } = await updateQuery;
                      if (error) { toast.error("Error al cambiar vendedor"); return; }
                      const v = vendedores.find(v => v.id === newVendedorId);
                      setSelected({ ...selected, vendedorId: newVendedorId, vendedorNombre: v?.full_name || "" } as any);
                      await fetchPresupuestos();
                      toast.success("Vendedor actualizado");
                    }}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Sucursal</p>
                  <p className="text-sm font-medium">{selected.sucursalNombre || "—"}</p>
                </div>
                {(selected as any).contactoNombre && (
                  <div>
                    <p className="text-xs text-zinc-500">Solicitante</p>
                    <p className="text-sm font-medium">{(selected as any).contactoNombre}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-zinc-500">Operador</p>
                  <select
                    value={(selected as any).creadoPorId || ""}
                    onChange={async (e) => {
                      const newOpId = e.target.value || null;
                      if (!newOpId) return;
                      const { error } = await (supabase as any).rpc("change_pr_operator", {
                        p_presupuesto_id: selected.id,
                        p_new_operator_id: newOpId,
                        p_sociedad_id: sociedadActiva?.id,
                      });
                      if (error) { toast.error("Error al cambiar operador: " + error.message); return; }
                      const v = vendedores.find(v => v.id === newOpId);
                      setSelected({ ...selected, creadoPorId: newOpId || "", creadoPor: v?.full_name || "" } as any);
                      await fetchPresupuestos();
                      toast.success("Operador actualizado");
                    }}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                  >
                    <option value="">Sin asignar</option>
                    {vendedores.map(v => (
                      <option key={v.id} value={v.id}>{v.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Moneda</p>
                  <p className="text-sm font-medium">{selected.moneda}{selected.moneda === "USD" && (selected as any).cotizacionModalidad ? ` ${(selected as any).cotizacionModalidad === "billetes" ? "(Billete)" : "(Divisa)"}` : ""}{(selected as any).tipoCambio ? ` — TC: ${Number((selected as any).tipoCambio).toLocaleString("es-AR")}` : ""}</p>
                </div>
                {!ocultarCostos && <div>
                  {(() => {
                    // Margen real de hoy (costos y precios actuales de los renglones + envío interno): se recalcula cada vez que se abre el PR.
                    const m = margenPR({ moneda: selected.moneda, tipoCambio: selected.tipoCambio, tipoCambioDivisas: selected.tipoCambioDivisas, modalidadEmision: (selected as any).modalidadEmision, costoEnvioInterno: (selected as any).costoEnvioInterno, items: selected.items || [] });
                    const color = m.margenPct === null ? "text-zinc-400" : m.margenPct < MARGEN_MINIMO_PR ? "text-red-600" : m.margenPct < MARGEN_MINIMO_PR + 5 ? "text-amber-600" : "text-emerald-600";
                    return <>
                      <p className="text-xs text-zinc-500" title={`Venta − ${m.gastosPct} % de gastos e impuestos − costo actual. Se recalcula solo con los costos y precios de hoy. Solo interno.`}>Margen real (ganancia)</p>
                      <p className={`text-sm font-medium ${color}`}>{m.margenPct === null ? "—" : `${m.margenPct.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% · ${formatCurrency(m.ganancia, selected.moneda)}`}</p>
                    </>;
                  })()}
                </div>}
                <OcClienteBloque
                  pr={{ id: selected.id, ocCliente: (selected as any).ocCliente || "", ocClienteFecha: (selected as any).ocClienteFecha || "", archivoUrl: (selected as any).archivoUrl || "", archivoNombre: (selected as any).archivoNombre || "", notasInternas: String(selected.notasInternas || "") }}
                  sociedadId={sociedadActiva?.id}
                  usuario={profile?.full_name || undefined}
                  onGuardado={async (c) => { setSelected({ ...selected, ...c, ocCliente: c.ocCliente ?? (selected as any).ocCliente, ocClienteFecha: c.ocClienteFecha ?? (selected as any).ocClienteFecha, archivoUrl: c.archivoUrl ?? (selected as any).archivoUrl, archivoNombre: c.archivoNombre ?? (selected as any).archivoNombre, notasInternas: c.notasInternas ?? selected.notasInternas } as any); await fetchPresupuestos(); }}
                />
                {(envios.get(selected.id)?.length ?? 0) > 0 ? (
                  <div className="col-span-full">
                    <p className="text-xs text-zinc-500">Enviado por mail ({envios.get(selected.id)!.length})</p>
                    {envios.get(selected.id)!.map((e, i) => (
                      <p key={i} className="flex items-center gap-1 text-sm"><Mail className="h-3.5 w-3.5 shrink-0 text-emerald-600" />{textoEnvio(e, nombreUsuario)}</p>
                    ))}
                  </div>
                ) : selected.enviadoAt && (
                  <div>
                    <p className="text-xs text-zinc-500">Enviado</p>
                    <p className="text-sm font-medium">{formatDate(selected.enviadoAt)}</p>
                  </div>
                )}
              </div>

              {/* Items table */}
              <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Items ({selected.items.length})</h3>
                  <button type="button" onClick={toggleOcultarCostos} className="rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" title="Oculta costo, markup y margen (por ejemplo, para mostrarle la pantalla al cliente). Se recuerda en esta compu.">
                    {ocultarCostos ? "Mostrar costos" : "Ocultar costos"}
                  </button>
                </div>
                {(() => {
                  // Franja de resumen: ítems · total · ganancia · margen · sin costo.
                  const m = margenPR({ moneda: selected.moneda, tipoCambio: selected.tipoCambio, tipoCambioDivisas: selected.tipoCambioDivisas, modalidadEmision: (selected as any).modalidadEmision, costoEnvioInterno: (selected as any).costoEnvioInterno, items: selected.items || [] });
                  const sinCosto = selected.items.filter((it) => !(Number(it.precioCosto) > 0)).length;
                  const conAviso = selected.items.filter((it) => avisosRenglon({ cantidad: it.cantidad, unidad: it.unidad, precio: it.precioVenta, descripcion: it.descripcion }).length > 0).length;
                  const color = m.margenPct === null ? "text-zinc-400" : m.margenPct < MARGEN_MINIMO_PR ? "text-red-600" : m.margenPct < MARGEN_MINIMO_PR + 5 ? "text-amber-600" : "text-emerald-600";
                  return (
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
                      <span><b>{selected.items.length}</b> ítems</span>
                      <span>Total <b className="font-mono">{formatCurrency(selected.total, selected.moneda)}</b></span>
                      {!ocultarCostos && m.margenPct !== null && <span className={color}>Ganancia <b className="font-mono">{formatCurrency(m.ganancia, selected.moneda)}</b> · margen <b>{m.margenPct.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></span>}
                      {!ocultarCostos && sinCosto > 0 && <span className="text-amber-600">⚠️ {sinCosto} sin costo</span>}
                      {conAviso > 0 && <span className="text-amber-600">⚠️ {conAviso} con aviso (precio 0 o cantidad con decimales)</span>}
                    </div>
                  );
                })()}
                {(() => {
                  const belowCostCount = selected.items.filter((item) => {
                    const costoConv = convertCosto(item.precioCosto, (item as any).costoMoneda || "ARS", selected.moneda, selected.tipoCambio || 0, (selected as any).tipoCambioDivisas || 0);
                    return item.precioVenta < costoConv;
                  }).length;
                  return belowCostCount > 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400 mb-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>Atencion: {belowCostCount} item(s) con precio de venta menor al costo</span>
                    </div>
                  ) : null;
                })()}
                {/* Celular: cada renglón como tarjeta */}
                <div className="space-y-1.5 @xl:hidden">
                  {selected.items.map((item) => {
                    const costoConv = convertCosto(item.precioCosto, (item as any).costoMoneda || "ARS", selected.moneda, selected.tipoCambio || 0, (selected as any).tipoCambioDivisas || 0);
                    const belowCost = item.precioVenta < costoConv;
                    const av = avisosRenglon({ cantidad: item.cantidad, unidad: item.unidad, precio: item.precioVenta, descripcion: item.descripcion });
                    return (
                      <div key={`card-${item.id}`} className={`rounded-lg border px-2.5 py-1.5 text-xs ${belowCost ? "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20" : "border-zinc-200 dark:border-zinc-700"}`}>
                        <p className="font-medium text-zinc-800 dark:text-zinc-100">{item.descripcion}</p>
                        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-zinc-500">
                          <span>{item.codigo ? <span className="font-mono">{item.codigo} · </span> : null}{formatCantidad(item.cantidad)} {item.unidad} × <span className="font-mono">{formatCurrency(item.precioVenta, selected.moneda as "ARS" | "USD")}</span></span>
                          <b className="font-mono text-zinc-800 dark:text-zinc-100">{formatCurrency(item.total, selected.moneda as "ARS" | "USD")}</b>
                        </div>
                        {!ocultarCostos && <p className="text-[10px] text-zinc-400">Costo {formatCurrency(item.precioCosto, (item.costoMoneda?.startsWith("USD") ? "USD" : "ARS") as "ARS" | "USD")} · markup {item.markupPorcentaje}%</p>}
                        {av.length > 0 && <p className="text-[10px] text-amber-600">⚠️ {av.join(" · ")}</p>}
                      </div>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 @xl:block">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                        <th className="px-3 py-1.5 text-left text-xs font-semibold text-zinc-500">Descripción</th>
                        <th className="px-3 py-1.5 text-right text-xs font-semibold text-zinc-500">Cant.</th>
                        {!ocultarCostos && <th className="px-3 py-1.5 text-right text-xs font-semibold text-zinc-500 hidden sm:table-cell">P. Costo</th>}
                        {!ocultarCostos && <th className="px-3 py-1.5 text-right text-xs font-semibold text-zinc-500 hidden sm:table-cell">Markup</th>}
                        <th className="px-3 py-1.5 text-right text-xs font-semibold text-zinc-500">P. Venta</th>
                        <th className="px-3 py-1.5 text-right text-xs font-semibold text-zinc-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {selected.items.map((item) => {
                        const costoConv = convertCosto(item.precioCosto, (item as any).costoMoneda || "ARS", selected.moneda, selected.tipoCambio || 0, (selected as any).tipoCambioDivisas || 0);
                        const belowCost = item.precioVenta < costoConv;
                        const av = avisosRenglon({ cantidad: item.cantidad, unidad: item.unidad, precio: item.precioVenta, descripcion: item.descripcion });
                        return (
                        <tr key={item.id} className={belowCost ? "bg-red-50/60 dark:bg-red-950/20" : ""}>
                          <td className="px-3 py-1.5 leading-snug">{item.descripcion}{item.codigo && <span className="ml-1 font-mono text-[10px] text-zinc-400">{item.codigo}</span>}{av.length > 0 && <div className="text-[10px] text-amber-600" title="Es un aviso, no frena nada">⚠️ {av.join(" · ")}</div>}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{formatCantidad(item.cantidad)} {item.unidad}</td>
                          {!ocultarCostos && <td className="px-3 py-1.5 text-right font-mono hidden sm:table-cell">
                            <div>{formatCurrency(item.precioCosto, (item.costoMoneda?.startsWith("USD") ? "USD" : "ARS") as "ARS" | "USD")}</div>
                            {item.costoMoneda !== selected.moneda && costoConv > 0 && (
                              <div className="text-[10px] text-zinc-400">≈ {formatCurrency(costoConv, selected.moneda as "ARS" | "USD")}</div>
                            )}
                          </td>}
                          {!ocultarCostos && <td className="px-3 py-1.5 text-right hidden sm:table-cell">{item.markupPorcentaje}%</td>}
                          <td className={`px-3 py-1.5 text-right font-mono ${belowCost ? "text-red-600 dark:text-red-400" : ""}`}>
                            <span className="inline-flex items-center gap-1">
                              {belowCost && <AlertTriangle className="h-3 w-3 shrink-0" />}
                              {formatCurrency(item.precioVenta, selected.moneda as "ARS" | "USD")}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold">{formatCurrency(item.total, selected.moneda as "ARS" | "USD")}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 rounded-lg bg-zinc-50 px-4 py-2.5 dark:bg-zinc-800/50">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="font-mono">{formatCurrency(selected.subtotal, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">IVA</span>
                    <span className="font-mono">{formatCurrency(selected.iva, selected.moneda)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
                    <span>Total</span>
                    <span className="font-mono text-orange-600 dark:text-orange-400">{formatCurrency(selected.total, selected.moneda)}</span>
                  </div>
                  {(selected as any).tipoCambio > 0 && (
                    <div className="text-xs text-zinc-400 text-right mt-1">TC aplicado: {Number((selected as any).tipoCambio).toLocaleString("es-AR")}</div>
                  )}
                </div>
              </div>

              {/* Notas internas (primero) */}
              {selected.notasInternas && (
                <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    Notas internas
                  </h3>
                  <p className="text-sm text-amber-700/80 dark:text-amber-400/80 whitespace-pre-wrap bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2">{selected.notasInternas}</p>
                </div>
              )}
              {/* Observaciones (cliente) */}
              {selected.observaciones && (
                <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700">
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Observaciones (cliente)</h3>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{selected.observaciones}</p>
                </div>
              )}


              {/* Motivo rechazo */}
              {selected.motivoRechazo && (
                <div className="rounded-lg bg-red-50 px-4 py-2.5 dark:bg-red-950/30">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-semibold text-red-700 dark:text-red-400">Motivo de rechazo</span>
                  </div>
                  <p className="text-sm text-red-600 dark:text-red-300">{selected.motivoRechazo}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="border-t border-zinc-200 pt-3 dark:border-zinc-700 flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Cambiar estado:</label>
                <select
                  value=""
                  onChange={(e) => {
                    const newEstado = e.target.value as PRStatus;
                    if (!newEstado) return;
                    if (newEstado === "rechazado") {
                      setRechazoModal(selected.id);
                      setMotivoRechazo("");
                    } else {
                      handleEstadoChange(selected.id, newEstado);
                    }
                  }}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  <option value="">Seleccionar...</option>
                  {ESTADOS_MANUALES
                    .filter((s) => s !== selected.estado || s === "rechazado")
                    .map((s) => {
                      const cfg = statusConfig[s] || { label: s };
                      return <option key={s} value={s}>{cfg.label}</option>;
                    })}
                </select>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ==================== NUEVO PR MODAL ==================== */}
      <Modal
        open={showNewPR}
        onClose={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, tipo_cambio_divisas: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", costo_envio_interno: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
        title={editingPRId && esSolicitud ? "Convertir solicitud en presupuesto" : editingPRId ? "Editar presupuesto" : esSolicitud ? "Nueva solicitud" : "Nuevo presupuesto"}
        description={editingPRId && esSolicitud ? "Completa la cotización. La solicitud se convertirá en PR sin crear un registro duplicado." : editingPRId ? "Modifica los datos del presupuesto existente" : esSolicitud ? "Registra un pedido de cliente para convertirlo luego en presupuesto" : "Completa los datos para crear un nuevo presupuesto"}
        size="2xl"
        allowFullscreen
        confirmarCierre={hayCambiosPR ? "¿Estás seguro que deseas salir sin guardar? Se pierde lo que cargaste en este presupuesto." : undefined}
        footer={
          <>
            {/* Subtotal, IVA, total, margen y ganancia: van en el recuadro de totales, debajo del descuento general (Augusto 20/10). */}
            <button
              onClick={() => { setShowNewPR(false); setEsSolicitud(false); setEditingPRId(null); setNewPR({ cliente_id: "", vendedor_id: "", sucursal_id: "", contacto_id: "", moneda: "USD", tipo_cambio: 0, tipo_cambio_divisas: 0, cotizacion_modalidad: "divisas", markup_general: 30, observaciones: "", notas_internas: "", costo_envio_interno: "", vencimiento: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tipo_comprobante: "", modalidad_emision: "sin_definir", items: [{ ...emptyItem, markup_porcentaje: 30 }] }); setClientSearch(""); }}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreatePR}
              disabled={newPRSaving}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors ${
                esSolicitud && !editingPRId ? "bg-blue-600 hover:bg-blue-700" : "bg-orange-500 hover:bg-orange-600"
              }`}
            >
              {newPRSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingPRId && esSolicitud ? <ArrowRight className="h-4 w-4" /> : editingPRId ? <Check className="h-4 w-4" /> : esSolicitud ? <Inbox className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              {editingPRId && esSolicitud ? "Convertir en presupuesto" : editingPRId ? "Guardar cambios" : esSolicitud ? "Crear solicitud" : "Crear presupuesto"}
            </button>
          </>
        }
      >
        {/* Creado por (auto) */}
        <div className="mb-2 flex items-center justify-between gap-4">
          <div className="rounded-lg bg-zinc-50 px-3 py-1 text-xs dark:bg-zinc-800">
            <span className="text-zinc-500">{editingPRId ? "Editando:" : "Creado por:"}</span>{" "}
            <span className="font-medium text-zinc-900 dark:text-white">{editingPRId ? presupuestos.find(p => p.id === editingPRId)?.numero || "" : (profile?.full_name ?? profile?.email ?? "---")}</span>
          </div>
          {!editingPRId && <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setEsSolicitud(!esSolicitud)}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                esSolicitud ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                  esSolicitud ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Inbox className={`h-4 w-4 ${esSolicitud ? "text-blue-600" : "text-zinc-400"}`} />
              <span className={`text-sm font-medium ${esSolicitud ? "text-blue-700 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-400"}`}>
                Crear como Solicitud
              </span>
            </div>
          </label>}
        </div>

        {/* ── MODO SOLICITUD: formulario simplificado ── */}
        {esSolicitud && !editingPRId ? (
          <div className="space-y-4">
            {/* Cliente */}
            <div className="relative" ref={clientSearchRef}>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente *</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={clientSearch || (newPR.cliente_id ? clientes.find(c => c.id === newPR.cliente_id)?.razon_social || "" : "")}
                  onChange={(e) => { setClientSearch(e.target.value); setClientDropdownOpen(true); if (!e.target.value) setNewPR((p) => ({ ...p, cliente_id: "" })); }}
                  onFocus={() => setClientDropdownOpen(true)}
                  placeholder="Buscar cliente..."
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
                {newPR.cliente_id && (
                  <button onClick={() => { setNewPR((p) => ({ ...p, cliente_id: "" })); setClientSearch(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {clientDropdownOpen && clientSearch && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {filteredClientes.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                  ) : filteredClientes.slice(0, 20).map((c) => (
                    <button key={c.id} onClick={() => { const mg = c.markup_predeterminado != null ? Number(c.markup_predeterminado) : undefined; const td = tipoDocPorCondicion(c.condicion_iva); const monedaCliente = (c as any).moneda_predeterminada as string | undefined; const monOvr: Record<string,unknown> = {}; if (monedaCliente === "USD" || monedaCliente === "USD Divisa") { monOvr.moneda = "USD"; monOvr.cotizacion_modalidad = monedaCliente === "USD" ? "billetes" : "divisas"; } else if (monedaCliente === "ARS") { monOvr.moneda = "ARS"; } setNewPR((p) => { const markup = mg ?? p.markup_general; const mon = (monOvr.moneda as string) || p.moneda; return { ...p, cliente_id: c.id, markup_general: markup, ...monOvr, ...td, items: p.items.map((it) => it.proveedor_lista ? it : ({ ...it, markup_porcentaje: markup, precio_venta: Number((convertCosto(it.precio_costo, it.costo_moneda, mon, p.tipo_cambio, p.tipo_cambio_divisas) * (1 + markup / 100)).toFixed(2)) })) }; }); setClientSearch(c.razon_social); setClientDropdownOpen(false); if (monOvr.moneda === "USD") fetchCotizBna((monOvr.cotizacion_modalidad as "divisas"|"billetes") || "divisas"); }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400" : "text-zinc-700 dark:text-zinc-300"}`}>
                      {c.razon_social}{((c as any).moneda_predeterminada === "USD" || (c as any).moneda_predeterminada === "USD Divisa") && <span className="ml-1 text-[10px] text-blue-500">{(c as any).moneda_predeterminada === "USD" ? "USD Billete" : "USD Divisa"}</span>}{c.markup_predeterminado != null && <span className="ml-auto text-xs text-zinc-400">{c.markup_predeterminado}%</span>}
                    </button>
                  ))}
                </div>
              )}
              {newPR.cliente_id && <div className="mt-2"><AvisoBCRA clienteId={newPR.cliente_id} /></div>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {clienteSucursales.length > 0 && (
                <Select label="Sucursal" value={newPR.sucursal_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, sucursal_id: e.target.value, contacto_id: "" }))}
                  placeholder="Sucursal (opcional)"
                  options={clienteSucursales.map((s) => ({ value: s.id, label: s.nombre }))}
                />
              )}
              {clienteContactos.length > 0 && (
                <Select label="Contacto solicitante" value={newPR.contacto_id}
                  onChange={(e) => setNewPR((p) => ({ ...p, contacto_id: e.target.value }))}
                  placeholder="¿Quién solicitó? (opcional)"
                  options={(newPR.sucursal_id ? clienteContactos.filter((c) => !c.sucursal_id || c.sucursal_id === newPR.sucursal_id) : clienteContactos)
                    .map((c) => ({ value: c.id, label: c.cargo ? `${c.nombre} (${c.cargo})` : c.nombre }))}
                />
              )}
            </div>

            {/* Descripción de lo que necesita — se guarda en notas_internas (es info interna, no para el cliente) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                ¿Qué necesita el cliente?
              </label>
              <textarea
                value={newPR.notas_internas}
                onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
                rows={4}
                placeholder="Ej: 20 pares de botines con puntera talle 42, 50 guantes de nitrilo T9 y 10 cascos blancos. Urgente para la semana que viene."
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white resize-none"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setExpressTexto(newPR.notas_internas); setSolicitudItems(true); setShowExpress(true); }}
                  className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400"
                  title="La IA lee lo que escribiste, busca cada artículo en la lista de costos y te deja revisar antes de agregar">
                  <Sparkles className="h-3 w-3" /> Armar con IA
                </button>
                {!solicitudItems && (
                  <button type="button" onClick={() => setSolicitudItems(true)} className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    <Plus className="h-3 w-3" /> Elegir productos (como en un PR)
                  </button>
                )}
                <span className="text-[11px] text-zinc-400">Las dos formas sirven: el texto queda en notas internas y los productos, como renglones.</span>
              </div>
            </div>
          </div>
        ) : (
        /* ── MODO PRESUPUESTO: formulario completo (datos en una fila, campos chicos) ── */
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-11 gap-x-2 gap-y-2 mb-3 items-start [&_label]:text-xs [&_label]:mb-0.5 [&>div]:space-y-0.5 [&_input:not([type=checkbox])]:h-8 [&_select]:h-8 [&_input]:py-1 [&_select]:py-1 [&_select]:px-2">
          <div className="relative col-span-2" ref={clientSearchRef}>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={clientSearch || (newPR.cliente_id ? clientes.find(c => c.id === newPR.cliente_id)?.razon_social || "" : "")}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setClientDropdownOpen(true);
                  if (!e.target.value) setNewPR((p) => ({ ...p, cliente_id: "" }));
                }}
                onFocus={() => setClientDropdownOpen(true)}
                placeholder="Buscar cliente..."
                className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:focus:border-orange-600 dark:focus:ring-orange-900/30"
              />
              {newPR.cliente_id && (
                <button
                  onClick={() => { setNewPR((p) => ({ ...p, cliente_id: "" })); setClientSearch(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {clientDropdownOpen && clientSearch && (
              <div className="absolute left-0 top-full z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {filteredClientes.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-zinc-400">Sin resultados</div>
                ) : (
                  filteredClientes.slice(0, 20).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const mg = c.markup_predeterminado != null ? Number(c.markup_predeterminado) : undefined;
                        const td = tipoDocPorCondicion(c.condicion_iva);
                        const monedaCliente = (c as any).moneda_predeterminada as string | undefined;
                        const monedaOverride: Partial<typeof newPR> = {};
                        if (monedaCliente === "USD" || monedaCliente === "USD Divisa") {
                          monedaOverride.moneda = "USD";
                          monedaOverride.cotizacion_modalidad = monedaCliente === "USD" ? "billetes" : "divisas";
                        } else if (monedaCliente === "ARS") {
                          monedaOverride.moneda = "ARS";
                        }
                        setNewPR((p) => {
                          const markup = mg ?? p.markup_general;
                          const mon = monedaOverride.moneda ?? p.moneda;
                          return { ...p, cliente_id: c.id, markup_general: markup, ...td, ...monedaOverride, items: p.items.map((it) => it.proveedor_lista ? it : ({ ...it, markup_porcentaje: markup, precio_venta: Number((convertCosto(it.precio_costo, it.costo_moneda, mon, p.tipo_cambio, p.tipo_cambio_divisas) * (1 + markup / 100)).toFixed(2)) })) };
                        });
                        setClientSearch(c.razon_social);
                        setClientDropdownOpen(false);
                        if (monedaOverride.moneda === "USD") fetchCotizBna(monedaOverride.cotizacion_modalidad || "divisas");
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${c.id === newPR.cliente_id ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" : "text-zinc-700 dark:text-zinc-300"}`}
                    >
                      {c.razon_social}{c.markup_predeterminado != null && <span className="ml-auto text-xs text-zinc-400">{c.markup_predeterminado}%</span>}
                    </button>
                  ))
                )}
              </div>
            )}
            {newPR.cliente_id && <div className="mt-1"><AvisoBCRA clienteId={newPR.cliente_id} /></div>}
          </div>
          <Select
            label="Vendedor *"
            value={newPR.vendedor_id}
            onChange={(e) => setNewPR((p) => ({ ...p, vendedor_id: e.target.value }))}
            placeholder="Seleccionar vendedor..."
            options={vendedores.map((v) => ({ value: v.id, label: v.full_name }))}
          />
          {clienteSucursales.length > 0 && (
            <Select
              label="Sucursal"
              value={newPR.sucursal_id}
              onChange={(e) => setNewPR((p) => ({ ...p, sucursal_id: e.target.value, contacto_id: "" }))}
              placeholder="Seleccionar sucursal..."
              options={clienteSucursales.map((s) => ({ value: s.id, label: s.nombre }))}
            />
          )}
          {clienteContactos.length > 0 && (
            <Select
              label="Solicitante"
              value={newPR.contacto_id}
              onChange={(e) => setNewPR((p) => ({ ...p, contacto_id: e.target.value }))}
              placeholder="Seleccionar contacto..."
              options={
                (newPR.sucursal_id
                  ? clienteContactos.filter((c) => !c.sucursal_id || c.sucursal_id === newPR.sucursal_id)
                  : clienteContactos
                ).map((c) => ({ value: c.id, label: c.cargo ? `${c.nombre} (${c.cargo})` : c.nombre }))
              }
            />
          )}
          <Select
            label="Moneda"
            value={newPR.moneda}
            onChange={(e) => {
              const mon = e.target.value as "USD" | "ARS";
              const modal = (newPR.cotizacion_modalidad || "divisas") as "divisas" | "billetes";
              setNewPR((p) => {
                // En pesos se guardan los dos dólares (billete y divisa) para convertir cada costo con el suyo.
                // En dólares queda solo el del tipo del presupuesto (es el que divide los costos en pesos).
                const tc = mon === "ARS" ? (p.tipo_cambio || dolaresGuardados?.billete?.valor || 0) : (modal === "billetes" ? p.tipo_cambio : 0);
                const tcD = mon === "ARS" ? (p.tipo_cambio_divisas || dolaresGuardados?.divisa?.valor || 0) : (modal === "divisas" ? p.tipo_cambio_divisas : 0);
                const items = p.items.map(it => {
                  const costoConv = convertCosto(it.precio_costo, it.costo_moneda, mon, tc, tcD);
                  return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
                });
                return { ...p, moneda: mon, tipo_cambio: tc, tipo_cambio_divisas: tcD, items };
              });
              if (mon === "ARS") void cargarDolaresPesos(false);
              else fetchCotizBna(modal);
            }}
            options={[{ value: "ARS", label: "$ Pesos" }, { value: "USD", label: "US$ Dólares" }]}
          />
          {newPR.moneda === "USD" && <div className="col-span-2 grid grid-cols-2 gap-2">
            <Input
              label="TC Billetes"
              type="number"
              step="0.01"
              value={newPR.tipo_cambio || ""}
              onChange={(e) => setNewPR((p) => {
                const tc = Number(e.target.value);
                const items = p.items.map(it => {
                  const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, tc, 0);
                  return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
                });
                return { ...p, tipo_cambio: tc, tipo_cambio_divisas: 0, cotizacion_modalidad: "billetes" as const, items };
              })}
              placeholder="Billetes"
            />
            <Input
              label="TC Divisas"
              type="number"
              step="0.01"
              value={newPR.tipo_cambio_divisas || ""}
              onChange={(e) => setNewPR((p) => {
                const tcD = Number(e.target.value);
                const items = p.items.map(it => {
                  const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, 0, tcD);
                  return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
                });
                return { ...p, tipo_cambio_divisas: tcD, tipo_cambio: 0, cotizacion_modalidad: "divisas" as const, items };
              })}
              placeholder="Divisas"
            />
          </div>}
          {newPR.moneda === "USD" && <div className="col-span-full lg:col-span-6 order-last self-center">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-zinc-400">BNA:</span>
              <button type="button" onClick={() => fetchCotizBna("divisas", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                {cotizBnaLoading ? "…" : "Divisas"}
              </button>
              <span className="text-xs text-zinc-300">·</span>
              <button type="button" onClick={() => fetchCotizBna("billetes", cotizFecha || undefined)} disabled={cotizBnaLoading} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                {cotizBnaLoading ? "…" : "Billetes"}
              </button>
              <input type="date" value={cotizFecha} onChange={e => setCotizFecha(e.target.value)} className="text-xs border border-zinc-300 dark:border-zinc-600 rounded px-1 py-0.5 bg-white dark:bg-zinc-800 dark:text-white" title="Fecha cotización (vacío = día hábil anterior)" />
              {cotizBna && (
                <span className="text-xs text-zinc-400">
                  → Venta {cotizBna.modalidad}: {formatCurrency(cotizBna.valor_venta, "ARS")} ({cotizBna.fecha})
                </span>
              )}
            </div>
          </div>}
          {newPR.moneda === "ARS" && (() => {
            // PR en pesos: los costos en US$ se pasan a pesos con su dólar (billete o divisa). Editable.
            const fechaB = dolaresGuardados?.fechaBuscada || fechaDolarPresupuesto();
            const cambiar = (campo: "tipo_cambio" | "tipo_cambio_divisas", valor: number) => setNewPR((p) => {
              const tc = campo === "tipo_cambio" ? valor : p.tipo_cambio;
              const tcD = campo === "tipo_cambio_divisas" ? valor : p.tipo_cambio_divisas;
              const items = p.items.map(it => {
                if (!esCostoUsd(it.costo_moneda)) return it;
                const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, tc, tcD);
                return { ...it, precio_venta: precioDesdeMarkup(costoConv, it.markup_porcentaje, it.precio_venta) };
              });
              return { ...p, tipo_cambio: tc, tipo_cambio_divisas: tcD, items };
            });
            const fila = (tipo: "billete" | "divisa", campo: "tipo_cambio" | "tipo_cambio_divisas") => {
              const guardado = tipo === "billete" ? dolaresGuardados?.billete ?? null : dolaresGuardados?.divisa ?? null;
              const valor = newPR[campo];
              const aMano = !!guardado && valor > 0 && valor !== guardado.valor;
              return (
                <label className="flex items-center gap-1">
                  <span className="text-zinc-500">US$ {tipo}</span>
                  <NumInput value={valor} onChange={(n) => cambiar(campo, n)}
                    className="w-24 rounded border border-zinc-200 px-1.5 py-0.5 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none" />
                  <span className={`text-[10px] ${aMano ? "text-amber-600" : "text-zinc-400"}`}>
                    {aMano ? "a mano" : guardado ? etiquetaDolar(tipo, guardado).replace(/^.*· /, "") : ""}
                  </span>
                </label>
              );
            };
            const atrasado = !!dolaresGuardados && (dolarAtrasado(dolaresGuardados.billete, fechaB) || dolarAtrasado(dolaresGuardados.divisa, fechaB));
            return (
              <div className="col-span-full order-last rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs [&_input]:!h-6">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium text-zinc-600 dark:text-zinc-300">Dólar para costos en US$:</span>
                  {fila("billete", "tipo_cambio")}
                  {fila("divisa", "tipo_cambio_divisas")}
                </div>
                {atrasado && (
                  <div className="mt-1 text-amber-700 dark:text-amber-400">⚠️ No está guardado el dólar del cierre del {fechaB.slice(8, 10)}/{fechaB.slice(5, 7)}: se usa el último guardado. Si querés, cargalo a mano.</div>
                )}
              </div>
            );
          })()}
          {newPR.moneda === "USD" && newPR.cliente_id && (() => {
            const cli = clientes.find((c) => c.id === newPR.cliente_id) as any;
            if (!cli) return null;
            const pref: "divisas" | "billetes" | null = cli.moneda_predeterminada === "USD" ? "billetes" : cli.moneda_predeterminada === "USD Divisa" ? "divisas" : null;
            const actual = (newPR.cotizacion_modalidad || "divisas") as "divisas" | "billetes";
            const nombre = (m: string) => (m === "divisas" ? "USD divisa" : "USD billete");
            const guardar = async () => {
              const valor = actual === "divisas" ? "USD Divisa" : "USD";
              const { error } = await (supabase as any).from("clientes").update({ moneda_predeterminada: valor }).eq("id", cli.id);
              if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
              setClientes((prev) => prev.map((c) => (c.id === cli.id ? ({ ...c, moneda_predeterminada: valor } as any) : c)));
              toast.success(`${cli.razon_social}: queda ${nombre(actual)} como predeterminado`);
            };
            return (
              <div className={`col-span-full lg:col-span-5 order-last rounded-lg border px-3 py-1 text-xs ${pref && pref !== actual ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"}`}>
                Tipo de dólar del cliente: <b>{pref ? nombre(pref) : "sin definir"}</b>
                {pref && pref !== actual && <> · <b>¡Este presupuesto está en {nombre(actual)}!</b> <button type="button" onClick={() => fetchCotizBna(pref)} className="underline">Pasar a {nombre(pref)}</button></>}
                {pref !== actual && <> · <button type="button" onClick={guardar} className="underline">Guardar {nombre(actual)} como predeterminado del cliente</button></>}
              </div>
            );
          })()}
          <Input
            label="Markup %"
            type="number"
            value={newPR.markup_general}
            onChange={(e) => setNewPR((p) => {
              const mg = Number(e.target.value);
              const items = p.items.map(it => {
                const costoConv = convertCosto(it.precio_costo, it.costo_moneda, p.moneda, p.tipo_cambio, p.tipo_cambio_divisas);
                return { ...it, markup_porcentaje: mg, precio_venta: Number((costoConv * (1 + mg / 100)).toFixed(2)) };
              });
              return { ...p, markup_general: mg, items };
            })}
          />
          <Input
            label="Vence"
            type="date"
            value={newPR.vencimiento}
            min={new Date().toISOString().split("T")[0]}
            onChange={(e) => setNewPR((p) => ({ ...p, vencimiento: e.target.value }))}
          />
          <Select
            label="Documento"
            value={newPR.tipo_comprobante === "A" ? "A" : newPR.tipo_comprobante === "B" ? "B" : newPR.modalidad_emision === "manual" ? "manual" : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "A") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "A", modalidad_emision: "electronica" }));
              } else if (v === "B") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "B", modalidad_emision: "electronica" }));
              } else if (v === "manual") {
                setNewPR((p) => ({ ...p, tipo_comprobante: "", modalidad_emision: "manual" }));
              } else {
                setNewPR((p) => ({ ...p, tipo_comprobante: "", modalidad_emision: "sin_definir" }));
              }
            }}
            options={[
              { value: "", label: "Sin definir" },
              { value: "A", label: "A (IVA aparte)" },
              { value: "B", label: "B (IVA incluido)" },
              { value: "manual", label: "Manual (sin ARCA)" },
            ]}
          />
        </div>
        )}

        {/* Items — en modo presupuesto, o en la solicitud si eligió cargar productos */}
        {(!esSolicitud || editingPRId || solicitudItems) && <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Items</label>
              <button
                onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
                className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 shadow-sm transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Agregar item
              </button>
              <button
                type="button"
                onClick={() => { setColW(COLS_DEFAULT); try { localStorage.removeItem("pr_col_widths"); } catch { /* ignore */ } }}
                title="Volver al ancho original de las columnas"
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                Restablecer columnas
              </button>
              {!mostrarIva && (
                <button type="button" onClick={() => setVerIva(true)} title="Todos los artículos van con IVA 21 %. Tocá para ver la columna y cambiarlo."
                  className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
                  IVA 21 % · cambiar
                </button>
              )}
              <button
                onClick={() => { setCatalogoFila(null); setShowCatalogo(true); }}
                className="flex items-center gap-1.5 rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30 transition-colors"
              >
                <Search className="h-3.5 w-3.5" /> Lista de costos
              </button>
              {newPR.cliente_id && anterioresDelCliente.length > 0 && (
                <div className="relative">
                  <button type="button" onClick={() => setVerRepetir((v) => !v)} disabled={repitiendo}
                    title="Copia los artículos de un presupuesto anterior de este cliente, con los precios de hoy de la lista de costos"
                    className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
                    {repitiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} Repetir presupuesto anterior
                  </button>
                  {verRepetir && (
                    <div className="absolute left-0 top-full z-40 mt-1 w-[26rem] max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                      <div className="px-3 py-1.5 text-[10px] text-zinc-400">Se copian los artículos con el precio de HOY de la lista de costos</div>
                      {anterioresDelCliente.map((p) => (
                        <button key={p.id} type="button" onClick={() => void repetirPresupuesto(p.id)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-orange-50 dark:hover:bg-orange-950/30">
                          <span className="w-24 shrink-0 font-mono text-zinc-700 dark:text-zinc-200">{p.numero}</span>
                          <span className="w-16 shrink-0 text-zinc-500">{p.fecha ? `${p.fecha.slice(8, 10)}/${p.fecha.slice(5, 7)}/${p.fecha.slice(2, 4)}` : ""}</span>
                          <span className="flex-1 truncate text-zinc-500">{p.items.length} art. · {p.estado}</span>
                          <span className="shrink-0 font-mono text-zinc-700 dark:text-zinc-200">{formatCurrency(p.total, p.moneda)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => { setExpressTexto(""); setShowExpress(true); }}
              className="flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400 dark:hover:bg-orange-950/50 transition-colors"
            >
              <Sparkles className="h-3 w-3" /> Asistente IA
            </button>
          </div>

          <AsistentePR
            open={showExpress}
            onClose={() => setShowExpress(false)}
            textoInicial={expressTexto}
            prMoneda={newPR.moneda}
            tc={newPR.tipo_cambio}
            tcDivisas={newPR.tipo_cambio_divisas}
            clienteNombre={(clientes.find((c) => c.id === newPR.cliente_id) as any)?.razon_social || ""}
            clienteId={newPR.cliente_id}
            sociedadId={sociedadActiva?.id}
            renglonesPR={newPR.items.filter((it) => it.descripcion.trim()).length}
            prsCliente={presupuestos
              .filter((p) => !!newPR.cliente_id && p.clienteId === newPR.cliente_id && p.id !== editingPRId && !(p as any).eliminado && p.estado !== "solicitud")
              .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || b.numero.localeCompare(a.numero))
              .slice(0, 40)
              .map((p) => ({ numero: p.numero, fecha: p.fecha || "", estado: p.estado }))}
            ultimos={ultimosDelCliente}
            proveedorDeLista={proveedorDeLista}
            onAplicar={(nuevos, reemplazar) => setNewPR((p) => ({
              ...p,
              items: reemplazar ? nuevos : [...p.items.filter((it) => it.codigo.trim() || it.descripcion.trim()), ...nuevos],
            }))}
          />

          <CatalogoPicker
            open={showCatalogo}
            onClose={() => { setShowCatalogo(false); setCatalogoFila(null); }}
            prMoneda={newPR.moneda}
            tc={newPR.tipo_cambio}
            tcDivisas={newPR.tipo_cambio_divisas}
            proveedoresCRM={proveedoresOptions}
            sociedadId={sociedadActiva?.id}
            onPedirTc={() => {
              const cli = clientes.find((c) => c.id === newPR.cliente_id) as any;
              return fetchCotizBna(cli?.moneda_predeterminada === "USD" ? "billetes" : "divisas");
            }}
            onAgregar={(nuevos) => setNewPR((p) => {
              // Abierta desde la lupa de una fila: lo elegido reemplaza esa fila (y el resto se inserta debajo).
              if (catalogoFila !== null && p.items[catalogoFila] && nuevos.length) {
                const items = [...p.items];
                items.splice(catalogoFila, 1, ...nuevos);
                return { ...p, items };
              }
              return {
              ...p,
              // Las líneas vacías (sin código ni descripción) se reemplazan por lo elegido en la lista.
              items: [...p.items.filter((it) => it.codigo.trim() || it.descripcion.trim()), ...nuevos],
            };
            })}
          />

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
            <table className="w-full table-fixed text-sm [&_td]:border-r [&_td]:border-zinc-200 dark:[&_td]:border-zinc-700 [&_th]:border-r [&_th]:border-zinc-300 dark:[&_th]:border-zinc-600" style={{ minWidth: 70 + 300 + colsVisibles.reduce((x, c) => x + (colW[c] || COLS_DEFAULT[c] || 80), 0) }}>
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                  <th className="w-7"></th>
                  <th className="px-2 py-2 text-left text-xs font-semibold text-zinc-500">
                    Código · Descripción <span className="font-normal text-zinc-400">(escribí y elegí de la lista; Enter en el último agrega otro)</span>
                  </th>
                  {([["proveedor", "Proveedor", "text-left"], ["cantidad", "Cant.", "text-right"], ["costo", "P. Costo", "text-right"], ["markup", "Markup%", "text-right"], ["venta", "P. Lista", "text-right"], ["desc", "Desc.%", "text-right"], ["iva", "IVA%", "text-right"], ["subtotal", "Subtotal", "text-right"]] as const).filter(([col]) => col !== "iva" || mostrarIva).map(([col, label, align]) => (
                    <th key={col} style={{ width: colW[col] }} className={`relative px-2 py-2 ${align} text-xs font-semibold text-zinc-500`}>
                      {label}
                      <span onMouseDown={(e) => empezarResize(col, e)} title="Arrastrá para cambiar el ancho"
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-orange-400/60" />
                    </th>
                  ))}
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {newPR.items.map((item, idx) => {
                  const costoConvForm = convertCosto(item.precio_costo, item.costo_moneda, newPR.moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas);
                  const belowCost = item.precio_venta > 0 && item.precio_venta < costoConvForm;
                  return (
                    <tr
                      key={idx}
                      draggable
                      onDragStart={(e) => {
                        setDragIdx(idx);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverIdx(idx);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIdx !== null && dragIdx !== idx) {
                          reorderItems(dragIdx, idx);
                        }
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || idx !== newPR.items.length - 1) return;
                        if ((e.target as HTMLElement).tagName !== "INPUT") return;
                        if (!item.codigo.trim() && !item.descripcion.trim()) return;
                        e.preventDefault();
                        agregarRenglonYEnfocar();
                      }}
                      className={`${belowCost ? "bg-red-50/60 dark:bg-red-950/20" : ""} ${dragIdx === idx ? "opacity-40" : ""} ${dragOverIdx === idx && dragIdx !== idx ? "border-t-2 border-blue-500" : ""}`}
                    >
                      <td className="px-1 py-1.5 cursor-grab active:cursor-grabbing">
                        <GripVertical className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <input value={item.codigo} onChange={(e) => updateNewPRItem(idx, "codigo", e.target.value)}
                            placeholder="Código" title={item.codigo}
                            className="w-24 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                          <DescripcionLista value={item.descripcion} onChange={(t) => updateNewPRItem(idx, "descripcion", t)}
                            onElegir={(f) => void elegirDeLista(idx, f)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              if (!item.descripcion.trim()) return;
                              // En los renglones del medio, Enter pasa a la cantidad; en el último lo maneja el renglón (agrega otro).
                              if (idx < newPR.items.length - 1) { e.stopPropagation(); (document.querySelectorAll<HTMLInputElement>("[data-pr-cant]")[idx])?.focus(); }
                            }}
                            placeholder="Escribí para buscar en la lista de costos, o cargalo a mano…"
                            className="min-w-0 flex-1 rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                          <button type="button" onClick={() => { setCatalogoFila(idx); setShowCatalogo(true); }} title="Abrir la lista de costos completa"
                            className="shrink-0 rounded border border-zinc-200 p-1 text-zinc-400 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-300 dark:border-zinc-700 dark:hover:bg-orange-950/30 dark:hover:text-orange-400 transition-colors">
                            <Search className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {(() => {
                          // Último precio al que se le vendió este artículo a este cliente
                          const u = ultimosDelCliente.get(claveArticulo(item.codigo, item.descripcion));
                          if (!u) return null;
                          const misma = u.moneda === newPR.moneda;
                          const neto = precioNeto(item, descGeneral);
                          const dif = misma && neto > 0 ? ((neto / u.precio) - 1) * 100 : null;
                          return (
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-400" title={`Último precio vendido a este cliente (neto, sin IVA) en ${u.numero}`}>
                              <span>Últ. venta {formatCurrency(u.precio, u.moneda as "USD" | "ARS")} · {u.fecha.slice(8, 10)}/{u.fecha.slice(5, 7)}/{u.fecha.slice(2, 4)} · {u.numero}</span>
                              {dif !== null && Math.abs(dif) >= 0.05 && <span className={dif < 0 ? "text-amber-600" : "text-zinc-400"}>({dif > 0 ? "+" : ""}{dif.toFixed(1)}% hoy)</span>}
                              {misma && Math.abs(neto - u.precio) > 0.004 && (
                                <button type="button" className="underline hover:text-violet-800" onClick={() => {
                                  setNewPR((p) => ({ ...p, items: p.items.map((x, i) => (i === idx ? { ...x, descuento_porcentaje: 0 } : x)) }));
                                  updateNewPRItem(idx, "precio_venta", u.precio);
                                }}>usar</button>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5">
                        <ProveedorItemPicker
                          value={item.proveedor_id || ""}
                          stockPropio={!!item.stock_propio}
                          options={proveedoresOptions}
                          nombreLista={!item.proveedor_id && !item.stock_propio ? (item.proveedor_lista || item.proveedor_nombre || "") : ""}
                          onChange={(provId, provNombre, esStockPropio) => {
                            // Auto-detect own sociedad as stock propio
                            const ownNames = ["lazzari", "grupo la", "augusto lazzari"];
                            const isOwnSociedad = !esStockPropio && provNombre && ownNames.some(n => provNombre.toLowerCase().includes(n));
                            // Memoria: el nombre de la lista de costos queda vinculado al proveedor del CRM elegido.
                            const lista = (item.proveedor_lista || (!item.proveedor_id && !item.stock_propio ? item.proveedor_nombre : "") || "").trim();
                            let recordar = false;
                            if (lista && provId && !esStockPropio && !isOwnSociedad && provId !== item.proveedor_id) {
                              recordar = !item.proveedor_id
                                || window.confirm(`¿De ahora en más "${lista}" de la lista de costos es siempre ${provNombre}?\n\nAceptar = guardarlo para siempre (y cambiarlo en todas las filas de este presupuesto)\nCancelar = cambiar solo esta fila`);
                            }
                            setNewPR((prev) => {
                              const items = prev.items.map((it, i) => {
                                if (i === idx) return { ...it, proveedor_id: isOwnSociedad ? "" : provId, proveedor_nombre: isOwnSociedad ? "Stock propio" : provNombre, stock_propio: esStockPropio || !!isOwnSociedad, proveedor_lista: provId ? (lista || it.proveedor_lista) : "" };
                                const suLista = (it.proveedor_lista || (!it.proveedor_id && !it.stock_propio ? it.proveedor_nombre : "") || "").trim();
                                if (recordar && suLista === lista && !it.stock_propio) return { ...it, proveedor_id: provId, proveedor_nombre: provNombre, proveedor_lista: lista };
                                return it;
                              });
                              return { ...prev, items };
                            });
                            if (recordar && sociedadActiva?.id) {
                              void (async () => {
                                const db = supabase as any;
                                const { error } = await db.from("catalogo_proveedores").upsert({ sociedad_id: sociedadActiva.id, proveedor_lista: lista, proveedor_id: provId }, { onConflict: "sociedad_id,proveedor_lista" });
                                if (error) { toast.error(`No se pudo guardar el vínculo: ${error.message}`); return; }
                                await db.from("proveedores").update({ nombre_fantasia: lista }).eq("id", provId).is("nombre_fantasia", null);
                                toast.success(`Guardado: "${lista}" de la lista = ${provNombre}`);
                              })();
                            }
                            if (isOwnSociedad) toast.info("Proveedor propio detectado → marcado como stock propio");
                            // Artículo cargado a mano en US$: el dólar (billete/divisa) es el del proveedor elegido.
                            if (provId && !esStockPropio && !isOwnSociedad && !item.lista_item_id && esCostoUsd(item.costo_moneda)) {
                              void dolarDelProveedor(provId, provNombre).then((m) => {
                                if (m && m !== item.costo_moneda) {
                                  updateNewPRItem(idx, "costo_moneda", m);
                                  toast.info(`${provNombre} cotiza en ${m === "USD Divisa" ? "dólar divisa" : "dólar billete"}: costo recalculado`);
                                }
                              });
                            }
                          }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <NumInput miles value={item.cantidad} onChange={(n) => updateNewPRItem(idx, "cantidad", n)} data-pr-cant=""
                            title="Se escribe a la argentina: 1.000 = mil"
                            className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                          {priceTiersMap[idx] && priceTiersMap[idx].length > 0 && (
                            <span title={`Precios escalonados:\n${priceTiersMap[idx].map(t => `${t.variante}: ${t.moneda === "USD" ? "US$" : "$"}${t.precio_neto}`).join("\n")}`}
                              className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-blue-500 text-[8px] text-white font-bold cursor-help">
                              ↗
                            </span>
                          )}
                        </div>
                        {(() => {
                          const av = avisosRenglon({ cantidad: item.cantidad, unidad: item.unidad, precio: item.precio_venta, descripcion: item.descripcion });
                          return av.length > 0 ? <div className="mt-0.5 text-right text-[10px] leading-tight text-amber-600" title={`${av.join(" · ")} (es un aviso, se puede guardar igual)`}>⚠️ {av.join(" · ")}</div> : null;
                        })()}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => updateNewPRItem(idx, "costo_moneda", nextCostoMoneda(item.costo_moneda))} title="Click para cambiar moneda (AR$ / US$ billete / US$ divisa)" className={`shrink-0 rounded px-1.5 py-1 text-[10px] font-bold border cursor-pointer hover:opacity-80 transition-opacity ${
                            item.costo_moneda === "USD" || item.costo_moneda === "USD Divisa"
                              ? "border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                              : "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}>
                            {esCostoDivisa(item.costo_moneda) ? "US$ div" : esCostoUsd(item.costo_moneda) ? "US$" : "AR$"}
                          </button>
                          <NumInput value={item.precio_costo} onChange={(n) => updateNewPRItem(idx, "precio_costo", n)}
                            className="w-full min-w-0 rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                        </div>
                        {newPR.moneda === "ARS" && esCostoUsd(item.costo_moneda) && item.precio_costo > 0 && (() => {
                          const t = tcParaCosto(item.costo_moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas);
                          return (
                            <div className={`mt-0.5 text-right text-[10px] ${t > 0 ? "text-zinc-400" : "text-amber-600"}`} title="Costo en pesos con el dólar del presupuesto">
                              {t > 0
                                ? `× ${esCostoDivisa(item.costo_moneda) ? "divisa" : "billete"} ${t.toLocaleString("es-AR")} = $ ${(item.precio_costo * t).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : "⚠️ falta el dólar"}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={Math.round(item.markup_porcentaje * 100) / 100} onChange={(n) => updateNewPRItem(idx, "markup_porcentaje", n)}
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                        {item.markup_porcentaje > 999 && <span className="text-[9px] text-amber-500" title="Markup muy alto">!</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="relative">
                          <NumInput value={item.precio_venta} onChange={(n) => updateNewPRItem(idx, "precio_venta", n)}
                            className={`w-full rounded border px-1.5 py-1 text-xs text-right dark:bg-zinc-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-orange-100 ${belowCost ? "border-red-300 dark:border-red-700 focus:border-red-400" : "border-zinc-200 dark:border-zinc-700 focus:border-orange-400"}`} />
                          {belowCost && <AlertTriangle className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-red-500" />}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <NumInput value={item.descuento_porcentaje || 0}
                          onChange={(n) => setNewPR((p) => ({ ...p, items: p.items.map((x, i) => i === idx ? { ...x, descuento_porcentaje: Math.min(100, Math.max(0, n)) } : x) }))}
                          className="w-full rounded border border-zinc-200 px-1.5 py-1 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100" />
                        {(() => {
                          const neto = precioNeto(item, descGeneral);
                          const costoMg = costoEnMonedaPR(item.precio_costo, item.costo_moneda, newPR.moneda, newPR.tipo_cambio, newPR.tipo_cambio_divisas);
                          if (costoMg === null || !(costoMg > 0) || !(neto > 0)) return null;
                          const m = margenNetoPct(neto, costoMg, gastosPorcentajePR(newPR.modalidad_emision));
                          if (m === null) return null;
                          const color = m < MARGEN_MINIMO ? "text-red-600" : m < MARGEN_MINIMO + 5 ? "text-amber-600" : "text-emerald-600";
                          return <div className={`mt-0.5 text-right text-[10px] font-semibold ${color}`} title="Margen neto sobre el costo (con descuentos, menos gastos e impuestos)">mg {m.toFixed(1)}%</div>;
                        })()}
                      </td>
                      {mostrarIva && <td className="px-2 py-1.5">
                        <select value={item.iva_porcentaje} onChange={(e) => updateNewPRItem(idx, "iva_porcentaje", Number(e.target.value))}
                          onKeyDown={(e) => {
                            // Auto-add new item when Tab on last field of last item
                            if (e.key === "Tab" && !e.shiftKey && idx === newPR.items.length - 1) {
                              e.preventDefault();
                              setNewPR((p) => {
                                const updated = { ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] };
                                // Focus the codigo input of the new row after render
                                setTimeout(() => {
                                  const table = (e.target as HTMLElement).closest("table");
                                  if (table) {
                                    const rows = table.querySelectorAll("tbody tr");
                                    const lastRow = rows[rows.length - 1];
                                    const firstInput = lastRow?.querySelector("input");
                                    firstInput?.focus();
                                  }
                                }, 50);
                                return updated;
                              });
                            }
                          }}
                          className="w-full rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-100">
                          <option value={21}>21</option>
                          <option value={10.5}>10.5</option>
                          <option value={27}>27</option>
                          <option value={0}>0</option>
                        </select>
                      </td>}
                      <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                        {formatCurrency(calcItemTotals(item, descGeneral).subtotal, newPR.moneda)}
                      </td>
                      <td className="px-2 py-1.5">
                        {newPR.items.length > 1 && (
                          <button onClick={() => setNewPR((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 transition-colors">
                            <Minus className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Bottom add item button */}
          <button
            onClick={() => setNewPR((p) => ({ ...p, items: [...p.items, { ...emptyItem, markup_porcentaje: p.markup_general }] }))}
            className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-orange-400 hover:text-orange-600 hover:bg-orange-50/50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-orange-600 dark:hover:text-orange-400 dark:hover:bg-orange-950/20 transition-colors"
          >
            <Plus className="h-3 w-3" /> Agregar item
          </button>
          {/* Totales (Augusto 20/10): todo junto debajo del descuento general. Fila 1 = lo del cliente; fila 2 = desglose interno. Sin envío interno. */}
          <div className="flex justify-end mt-3">
            <div className="w-full max-w-md space-y-1.5 text-sm rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
              {(() => {
                let lista = 0, conDescArt = 0;
                for (const it of newPR.items) {
                  lista += it.cantidad * it.precio_venta;
                  conDescArt += it.cantidad * precioNeto(it, 0);
                }
                const descArt = lista - conDescArt;
                const descGen = conDescArt - newPRSub;
                const r = resumenPR;
                const m = newPR.moneda;
                // Margen neto (descontando gastos e impuestos: 7 % ARCA, 2 % manual) = el mismo de la lista y del aviso al guardar (H43).
                // El color de margen y ganancia sale del neto.
                const colorNeto = r.margenNeto === null ? "text-zinc-400" : r.margenNeto < MARGEN_MINIMO ? "text-red-600" : r.margenNeto < MARGEN_MINIMO + 5 ? "text-amber-600" : "text-emerald-600";
                const color = colorNeto;
                const celda = "flex flex-col";
                const rotulo = "text-[10px] uppercase tracking-wide text-zinc-400";
                return <>
                  {(descArt > 0.004 || descGeneral > 0) && <div className="flex justify-between"><span className="text-zinc-500">Precio de lista</span><span className="font-mono">{formatCurrency(lista, m)}</span></div>}
                  {descArt > 0.004 && <div className="flex justify-between"><span className="text-zinc-500">Desc. por artículo</span><span className="font-mono text-red-600">−{formatCurrency(descArt, m)}</span></div>}
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-zinc-500">Descuento general</span>
                    <span className="flex items-center gap-1">
                      {descGen > 0.004 && <span className="font-mono text-xs text-red-600">−{formatCurrency(descGen, m)}</span>}
                      <NumInput value={descGeneral} onChange={(n) => setDescGeneral(Math.min(100, Math.max(0, n)))}
                        className="w-14 rounded border border-zinc-200 px-1 py-0.5 text-xs text-right dark:border-zinc-700 dark:bg-zinc-800 dark:text-white focus:border-orange-400 focus:outline-none" />
                      <span className="text-xs text-zinc-500">%</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
                    <div className={celda}><span className={rotulo}>Subtotal</span><b className="font-mono text-zinc-800 dark:text-zinc-100">{formatCurrency(r.subtotal, m)}</b></div>
                    <div className={celda}><span className={rotulo}>IVA</span><b className="font-mono text-zinc-800 dark:text-zinc-100">{newPR.modalidad_emision === "manual" ? "—" : formatCurrency(r.iva, m)}</b></div>
                    <div className={`${celda} text-right`}><span className={rotulo}>Total</span><b className="font-mono text-orange-600 dark:text-orange-400">{formatCurrency(r.total, m)}</b></div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 border-t border-dashed border-zinc-300 pt-1.5 text-xs dark:border-zinc-600" title={`Solo interno: no sale en el PDF. Neto = menos ${gastosPorcentajePR(newPR.modalidad_emision)}% de gastos e impuestos sobre la venta.`}>
                    <div className={`${celda} ${color}`}><span className={rotulo}>Margen 🔒</span><b className="font-mono">{r.margen === null ? "—" : `${r.margen.toFixed(1)}%`}</b></div>
                    <div className={`${celda} ${color}`}><span className={rotulo}>Ganancia</span><b className="font-mono">{r.ganancia === null ? "—" : formatCurrency(r.ganancia, m)}</b></div>
                    <div className={`${celda} ${colorNeto}`}><span className={rotulo}>Margen neto</span><b className="font-mono">{r.margenNeto === null ? "—" : `${r.margenNeto.toFixed(1)}%`}</b></div>
                    <div className={`${celda} ${colorNeto} text-right`}><span className={rotulo}>Ganancia neta</span><b className="font-mono">{r.gananciaNeta === null ? "—" : formatCurrency(r.gananciaNeta, m)}</b></div>
                  </div>
                  {r.bajoMargen > 0 && <div className="text-xs text-red-600" title="Es un aviso: se puede guardar igual">⚠️ {r.bajoMargen} art. con margen neto &lt; {MARGEN_MINIMO}%</div>}
                  {r.sinDolar > 0 && <div className="text-xs text-amber-600" title="Cargá el dólar del PR para calcularlo">⚠️ {r.sinDolar} art. sin dólar: su margen no se calcula</div>}
                </>;
              })()}
              {newPR.moneda === "USD" && (newPR.tipo_cambio > 0 || newPR.tipo_cambio_divisas > 0) && (
                <div className="text-xs text-zinc-400 text-right pt-1 space-x-2">
                  {newPR.tipo_cambio > 0 && <span>TC Billetes: {newPR.tipo_cambio.toLocaleString("es-AR")}</span>}
                  {newPR.tipo_cambio_divisas > 0 && <span>TC Divisas: {newPR.tipo_cambio_divisas.toLocaleString("es-AR")}</span>}
                </div>
              )}
            </div>
          </div>
        </div>}

        {/* Notas internas y Observaciones — en modo presupuesto, o al editar una solicitud */}
        {(!esSolicitud || editingPRId) && <>
        <Textarea
          label="Notas internas (solo uso interno)"
          value={newPR.notas_internas}
          onChange={(e) => setNewPR((p) => ({ ...p, notas_internas: e.target.value }))}
          rows={2}
          placeholder="Margen esperado, contexto de la negociacion, datos internos..."
        />

        <Textarea
          label="Observaciones (visibles para el cliente)"
          value={newPR.observaciones}
          onChange={(e) => setNewPR((p) => ({ ...p, observaciones: e.target.value }))}
          rows={2}
          placeholder="Condiciones de pago, plazo de entrega, aclaraciones..."
        />
        </>}
      </Modal>

      {/* ==================== COSTOS FALTANTES MODAL ==================== */}
      <Modal
        open={!!costosFaltantesModal}
        onClose={() => setCostosFaltantesModal(null)}
        title="Items sin costos"
        description="Atención: hay items sin precio de costo cargado"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setCostosFaltantesModal(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (costosFaltantesModal) {
                  doEstadoChange(costosFaltantesModal.id, "aprobado", costosFaltantesModal.motivo);
                  setCostosFaltantesModal(null);
                }
              }}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Aprobar de todos modos
            </button>
          </>
        }
      >
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4 dark:bg-amber-950/20 dark:border-amber-800">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Este presupuesto tiene <span className="font-bold">{costosFaltantesModal?.count} item(s)</span> sin costos cargados.
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Puede continuar, pero deberá completar los costos luego.
            </p>
          </div>
        </div>
      </Modal>

      {/* ==================== PR PREVIOS WARNING MODAL ==================== */}
      <Modal
        open={!!prWarningModal}
        onClose={() => setPrWarningModal(null)}
        title="Artículos cotizados previamente"
        description="Se encontraron presupuestos anteriores para este cliente con artículos coincidentes"
        size="md"
        footer={
          <>
            <button
              onClick={() => setPrWarningModal(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setPrWarningModal(null);
                prWarningBypassRef.current = true;
                handleCreatePR();
              }}
              className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
            >
              Crear de todos modos
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 dark:bg-amber-950/20 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Estos artículos ya fueron cotizados para este cliente. Revisá el estado de los presupuestos anteriores antes de crear uno nuevo.
              </p>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {prWarningModal?.matches.map((m, i) => {
              const cfg = statusConfig[m.estado as PRStatus] || { label: m.estado, variant: "outline" as const };
              return (
                <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm font-medium dark:text-white">{m.numero}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      <span className="text-xs text-zinc-400">{formatDate(m.fecha)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Artículos: <span className="font-medium text-zinc-700 dark:text-zinc-300">{m.codigos.join(", ")}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* ==================== RECHAZO MODAL ==================== */}
      <Modal
        open={!!rechazoModal}
        onClose={() => { setRechazoModal(null); setRechazoTipo("rechazado"); }}
        title="Rechazar presupuesto"
        description="Elegí si se rechaza o se posterga, y anotá el motivo"
        size="sm"
        footer={
          <>
            <button
              onClick={() => { setRechazoModal(null); setRechazoTipo("rechazado"); }}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleRechazoConfirm}
              disabled={!motivoRechazo.trim()}
              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors ${rechazoTipo === "postergado" ? "bg-purple-600 hover:bg-purple-700" : "bg-red-600 hover:bg-red-700"}`}
            >
              {rechazoTipo === "postergado" ? "Confirmar postergado" : "Confirmar rechazo"}
            </button>
          </>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-2">
          {([["rechazado", "Rechazado", "No lo compra"], ["postergado", "Postergado", "Lo deja para más adelante"]] as const).map(([v, titulo, ayuda]) => (
            <button key={v} type="button" onClick={() => setRechazoTipo(v)}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${rechazoTipo === v ? (v === "rechazado" ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300" : "border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300") : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
              <span className="block font-semibold">{titulo}</span>
              <span className="block text-xs opacity-75">{ayuda}</span>
            </button>
          ))}
        </div>
        <Textarea
          value={motivoRechazo}
          onChange={(e) => setMotivoRechazo(e.target.value)}
          placeholder={rechazoTipo === "postergado" ? "¿Por qué lo posterga? (ej: vuelve a pedir en marzo)" : "Ingresa el motivo del rechazo..."}
          rows={4}
          autoFocus
        />
      </Modal>

      {/* ==================== POST-CREATE MODAL ==================== */}
      {postCreatePR && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold dark:text-white">Presupuesto creado</h3>
              <p className="text-sm text-zinc-500 mt-1">{postCreatePR.numero}</p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const pr = postCreatePR;
                  const text = buildPRSummaryText(pr);
                  const email = (pr as any).clienteEmail || "";
                  const subject = encodeURIComponent(`Presupuesto ${pr.numero}`);
                  const body = encodeURIComponent(text);
                  window.open(`mailto:${email}?subject=${subject}&body=${body}`, "_blank");
                  setPostCreatePR(null);
                }}
                className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-700 transition-colors"
              >
                <Mail className="h-4 w-4" /> Enviar por correo
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(buildPRSummaryText(postCreatePR));
                  toast.success("Presupuesto copiado al portapapeles");
                  setPostCreatePR(null);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <ClipboardCopy className="h-4 w-4" /> Copiar resumen
              </button>
              <button
                onClick={() => {
                  setPostCreatePR(null);
                  setSelected(postCreatePR);
                }}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                <Eye className="h-4 w-4" /> Ver presupuesto
              </button>
              <button
                onClick={() => setPostCreatePR(null)}
                className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 mt-1"
              >
                Cerrar
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ==================== PRODUCT SEARCH MODAL ==================== */}
      {productSearchOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setProductSearchOpen(false)} />
          <div className="fixed inset-4 z-[60] m-auto h-fit max-h-[70vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
              <Search className="h-5 w-5 text-zinc-400" />
              <input
                ref={productSearchInputRef}
                value={productSearchQuery}
                onChange={(e) => handleProductSearchInput(e.target.value)}
                placeholder="Buscar por codigo o descripcion..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-white"
              />
              {productSearchLoading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
              <button onClick={() => setProductSearchOpen(false)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto max-h-[50vh]">
              {productSearchResults.length > 0 ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {productSearchResults.map((s) => (
                    <button key={s.id} type="button" onClick={() => handleProductSelect(s)}
                      className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-orange-50 dark:hover:bg-zinc-800/60 transition-colors">
                      <div className="shrink-0 mt-0.5 rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                        <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400">{s.codigo}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{s.descripcion}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400">
                            {s.proveedor_nombre}
                          </span>
                          {s.variante && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                              {s.variante}
                            </span>
                          )}
                          {s.categoria && (
                            <span className="text-[10px] text-zinc-400">{s.categoria}</span>
                          )}
                          <span className="text-[10px] text-zinc-400">{s.unidad}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{formatCurrency(s.precio_neto, s.moneda as "USD" | "ARS")}</p>
                        <p className="text-[10px] text-zinc-400">{s.lista_nombre}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : productSearchQuery.length >= 2 && !productSearchLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">No se encontraron productos</p>
                  <p className="text-xs mt-1">Proba con otro codigo o descripcion</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
                  <Search className="h-8 w-8 mb-2" />
                  <p className="text-sm">Escribi al menos 2 caracteres para buscar</p>
                  <p className="text-xs mt-1">Busca por codigo de proveedor o descripcion del producto</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== REMITAR (ventana única) ==================== */}
      <RemitoVentana open={!!remitarPrId} prId={remitarPrId} onClose={() => setRemitarPrId(null)} onGuardado={() => { void fetchPresupuestos(); }} />

      {/* ==================== EMAIL MODAL ==================== */}
      <EmailComposeModal
        open={emailModal.open}
        onClose={() => setEmailModal(prev => ({ ...prev, open: false }))}
        documentType="presupuesto"
        documentId={emailModal.id}
        onSuccess={() => cargarEnvios([emailModal.id])}
        sociedadId={sociedadActiva?.id}
        userEmail={profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined}
        defaultTo={emailModal.to}
        defaultSubject={emailModal.subject}
        defaultBody={emailModal.body}
        pdfFilename={emailModal.filename}
        suggestedEmails={(() => {
          const pr = presupuestos.find(p => p.id === emailModal.id);
          if (!pr) return [];
          const suggestions: { email: string; label?: string }[] = [];
          const contactoEmail = (pr as any).contactoEmail;
          const clienteEmail = (pr as any).clienteEmail;
          if (contactoEmail && !suggestions.some(s => s.email === contactoEmail)) suggestions.push({ email: contactoEmail, label: (pr as any).contactoNombre || "Solicitante" });
          const emailFact = (pr as any).clienteEmailFacturacion;
          if (emailFact) {
            for (const e of emailFact.split(",").map((s: string) => s.trim()).filter(Boolean)) {
              if (!suggestions.some(s => s.email === e)) suggestions.push({ email: e, label: "Facturación" });
            }
          }
          if (clienteEmail && !suggestions.some(s => s.email === clienteEmail)) suggestions.push({ email: clienteEmail, label: "Email cliente" });
          const creadorEmail = (pr as any).creadorEmail;
          if (creadorEmail && !suggestions.some(s => s.email === creadorEmail)) suggestions.push({ email: creadorEmail, label: `Creador: ${(pr as any).creadorNombre || ""}` });
          return suggestions;
        })()}
        generatePdf={async () => {
          const pr = presupuestos.find(p => p.id === emailModal.id);
          if (!pr || !sociedadActiva) throw new Error("No se encontró el presupuesto");
          const p = pr as any;
          const sucursalPDF = await loadSucursalForPDF(pr);
          const soc = getSociedadPDF(sociedadActiva);
          const estadoLabel = (statusConfig[pr.estado] || { label: pr.estado }).label;
          const html = generatePresupuestoPDF({
            numero: pr.numero,
            fecha: pr.fecha,
            vencimiento: pr.vencimiento,
            estado: pr.estado,
            estadoLabel,
            moneda: pr.moneda,
            subtotal: pr.subtotal,
            iva: pr.iva,
            total: pr.total,
            observaciones: pr.observaciones,
            creadoPor: pr.creadoPor,
            clienteNombre: pr.clienteNombre,
            clienteCuit: p.clienteCuit,
            clienteCondicionIva: p.clienteCondicionIva,
            clienteEmail: p.clienteEmail,
            clienteTelefono: p.clienteTelefono,
            sucursalNombre: sucursalPDF.nombre,
            sucursalDireccion: sucursalPDF.direccion,
            vendedorNombre: p.vendedorNombre,
            tipoComprobante: p.tipoComprobante,
            modalidadEmision: p.modalidadEmision,
            cotizacionModalidad: p.cotizacionModalidad,
            tipoCambio: p.tipoCambio,
            tipoCambioDivisas: (p as any).tipoCambioDivisas,
            descuentoGeneralPorcentaje: pr.descuentoGeneralPorcentaje,
            items: pr.items.map(it => ({
              codigo: it.codigo,
              descripcion: it.descripcion,
              cantidad: it.cantidad,
              unidad: it.unidad,
              precioVenta: it.precioVenta,
              precioLista: it.precioLista,
              total: it.total,
              ivaPorcentaje: it.ivaPorcentaje ?? (it.subtotal ? (it.iva / it.subtotal) * 100 : 21),
            })),
          }, soc);
          return htmlToPdfBase64(html);
        }}
      />
      {ventaCaida && <VentaCaidaOCs prId={ventaCaida.prId} prNumero={ventaCaida.numero} onClose={() => setVentaCaida(null)} />}
      {enviarOCs && <EnviarOCProveedor ocIds={enviarOCs.ids} titulo={enviarOCs.titulo} onClose={() => setEnviarOCs(null)} />}
    </>
  );
}
