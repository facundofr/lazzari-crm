"use client";

/**
 * Compras nueva (piloto automático, parte 1). Solo la ven los usuarios con la casilla "Prueba: Compras nueva".
 * Los vendedores venden: al aprobar un PR las OC se arman solas por proveedor y caen acá.
 * - Para pedir: un clic "Mail" o "WhatsApp" (y "Mandar todo por mail"). Sugerencia de juntar pedidos chicos en un proveedor.
 * - Esperando: lo que ya se pidió, con los días que pasaron. "Foto del remito del proveedor": la IA lee qué llegó,
 *   lo carga como recibido en la OC (solo si está segura; si no, lo deja listo para confirmar), guarda la foto,
 *   avisa al vendedor y pregunta por lo que falta. Con Deshacer. No mueve stock.
 * - Preguntas: renglones sin proveedor, con proveedores sugeridos (lista de costos, compras anteriores e IA).
 * Nunca toca el PR (ni su precio ni su total): solo mueve renglones entre OC sin mandar. Todo es sugerencia: nada frena.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import EnviarOCProveedor from "@/components/enviar-oc-proveedor";
import ComprasListaOC from "@/components/compras-lista-oc";
import CargarFacturaSimple from "@/components/cargar-factura-simple";
import { useUser } from "@/lib/auth-context";
import { useCargaMasiva } from "@/components/carga-masiva-global";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { loadEmailTemplate, applyTemplateVars } from "@/lib/email-templates";
import { htmlToPdfBase64 } from "@/lib/pdf-templates";
import { textoOCParaProveedor, textoReclamoOC, linkWhatsAppOC, htmlOCParaProveedor, cuerpoMailConAviso, contactoVentas, type OCEnvio, type OCEnvioItem } from "@/lib/oc-envio";
import {
  sugerirProveedores, sugerirCentralizar, proveedoresSinStock, costoAlDia, diasDesde, normalizarTexto,
  DIAS_AVISO_ESPERANDO, MARGEN_MINIMO_COMPRAS, type FilaCatalogo, type CompraAnterior, type ProveedorSugerido,
} from "@/lib/compras-armado";
import { armarRecepcion, estadoPorRecibido, ocDelRemito, seguroParaCargar, type Recepcion } from "@/lib/compras-recepcion";
import { prepararArchivo } from "@/lib/preparar-foto";
import { coincideTodas, palabrasBusqueda } from "@/lib/buscar-texto";
import { AlertTriangle, Camera, Check, ExternalLink, FileUp, Loader2, Mail, MessageCircle, MoreHorizontal, PackageX, RefreshCw, Search, Send, Sparkles, Undo2, X } from "lucide-react";
import { linkArchivo } from "@/lib/archivo-link";

const db = supabase as any;

type Proveedor = { id: string; razon_social: string; nombre_fantasia: string | null; rubro: string | null; marcas: string | null };
type PR = { id: string; numero: string; cliente_id: string | null; moneda: string | null; tipo_cambio: number | null; tipo_cambio_divisas: number | null; descuento_general_porcentaje: number | null; vendedor_id: string | null; created_by: string | null } | null;
type OC = {
  id: string; numero: string; fecha: string; fecha_entrega_estimada: string | null; estado: string; moneda: string;
  subtotal: number; iva: number; total: number; observaciones: string | null; pedido: boolean;
  pedido_at: string | null; pedido_via: string | null; pedido_por: string | null; saldo_cerrado: boolean;
  proveedor_id: string | null; presupuesto_origen_id: string | null; created_at: string;
  proveedores: { razon_social: string; nombre_fantasia: string | null; cuit: string | null; email: string | null; telefono: string | null; direccion: string | null; localidad: string | null; provincia: string | null; forma_pago: string | null; condicion_iva: string | null } | null;
  presupuesto_origen: PR;
};
type Item = {
  id: string; orden_id: string; codigo: string | null; descripcion: string; cantidad: number; cantidad_recibida: number | null;
  unidad: string | null; precio_unitario: number; subtotal: number; iva_porcentaje: number | null; orden: number | null; presupuesto_item_id: string | null;
};
type PRItem = { id: string; precio_venta: number; descuento_porcentaje: number | null; costo_moneda: string | null };
type FilaLista = FilaCatalogo & { costo: number; moneda: string };
type Contacto = { email: string; whatsapp: string };
type Deshacer = { id: number; texto: string; fn: () => Promise<void> };
type RemitoOC = { id: string; orden_id: string; numero_remito: string | null; foto_url: string | null; created_at: string };
type LeidoRemito = {
  proveedor: string | null; proveedor_cuit: string | null; numero_remito: string | null; fecha: string | null; oc_numero: string | null; oc_id: string | null;
  renglones: { item_id: string | null; oc_id: string | null; descripcion: string; codigo: string | null; cantidad: number }[];
  anotaciones: string | null; segura: boolean; resumen: string;
};
/** Una foto de remito de proveedor: lo leído, la OC elegida, las cantidades (editables) y si ya se cargó. */
type FotoRemito = {
  key: string; nombre: string; url: string | null; leyendo: boolean; error?: string; leido?: LeidoRemito;
  oc_id: string | null; cant: Record<string, number>; cargado?: Recepcion; respondida?: boolean;
};

const SEL_OC = "id, numero, fecha, fecha_entrega_estimada, estado, moneda, subtotal, iva, total, observaciones, pedido, pedido_at, pedido_via, pedido_por, saldo_cerrado, proveedor_id, presupuesto_origen_id, created_at, "
  + "proveedores(razon_social, nombre_fantasia, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), "
  + "presupuesto_origen:presupuesto_origen_id(id, numero, cliente_id, moneda, tipo_cambio, tipo_cambio_divisas, descuento_general_porcentaje, vendedor_id, created_by)";

const esStockPropio = (o: OC) => !o.proveedor_id && /stock propio/i.test(o.observaciones || "");
const mon = (m: string | null | undefined) => (String(m || "ARS").toUpperCase().startsWith("USD") ? "USD" : "ARS") as "ARS" | "USD";
const nombreProv = (p: { razon_social?: string | null; nombre_fantasia?: string | null } | null | undefined) => (p?.nombre_fantasia || p?.razon_social || "Proveedor").trim();
const VIA: Record<string, string> = { mail: "mail", whatsapp: "WhatsApp", manual: "a mano" };
const hace = (dias: number) => (dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`);

/** Consulta .in() de a tandas (listas largas de ids). */
async function enTandas<T>(ids: string[], armar: (tanda: string[]) => any): Promise<T[]> {
  const out: T[] = [];
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await armar(unicos.slice(i, i + 100));
    if (error) throw error;
    out.push(...((data || []) as T[]));
  }
  return out;
}

export default function ComprasNuevaPage() {
  const { profile, sociedadActiva } = useUser();
  const { abrirCargaMasiva } = useCargaMasiva();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  // "oc" = lista de todas las OC (formato Presupuestos, Augusto 16/10). "esperando" quedó sin pestaña (reemplazada por "oc").
  const [tab, setTab] = useState<"pedir" | "oc" | "esperando" | "preguntas">("pedir");
  // "Cargar factura" simple (Augusto 16/10): reemplaza a la carga masiva vieja en esta pantalla.
  const [cargarFactura, setCargarFactura] = useState(false);
  // Buscador (OC, PR, cliente, proveedor, artículo o código) y filtro rápido de Esperando.
  const [busca, setBusca] = useState("");
  const [filtroEsp, setFiltroEsp] = useState<"todas" | "tarde" | "parcial">("todas");
  const [ocs, setOcs] = useState<OC[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [prItems, setPrItems] = useState<Record<string, PRItem>>({});
  const [lista, setLista] = useState<FilaLista[]>([]);
  const [mapaListas, setMapaListas] = useState<Record<string, string>>({});
  const [historial, setHistorial] = useState<CompraAnterior[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [contactos, setContactos] = useState<Record<string, Contacto>>({});
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sugIA, setSugIA] = useState<Record<string, ProveedorSugerido[]>>({});
  const [buscandoIA, setBuscandoIA] = useState(false);
  const [enviarIds, setEnviarIds] = useState<string[] | null>(null);
  // Reclamo de lo que falta (sin precios): OC abierta y texto editable.
  const [reclamo, setReclamo] = useState<{ id: string; texto: string } | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  // Foto del remito del proveedor (Esperando).
  const [fotos, setFotos] = useState<FotoRemito[]>([]);
  const [remitosOC, setRemitosOC] = useState<Record<string, RemitoOC[]>>({});
  const [faltaTablaRemitos, setFaltaTablaRemitos] = useState(false);
  const [deshacer, setDeshacer] = useState<Deshacer[]>([]);
  const contador = useRef(0);
  const inputFoto = useRef<HTMLInputElement>(null);
  const fotoPara = useRef<string | null>(null);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError("");
    try {
      const todas = await traerTodo<OC>(() => db.from("ordenes_compra").select(SEL_OC)
        .eq("sociedad_id", sociedadId).not("estado", "in", "(cancelada,recibida)").order("fecha", { ascending: true }).order("numero", { ascending: true }));
      const vivas = todas.filter((o) => !o.saldo_cerrado && !esStockPropio(o));
      const its = await enTandas<Item>(vivas.map((o) => o.id), (t) => db.from("orden_compra_items")
        .select("id, orden_id, codigo, descripcion, cantidad, cantidad_recibida, unidad, precio_unitario, subtotal, iva_porcentaje, orden, presupuesto_item_id").in("orden_id", t).order("orden"));
      const [pis, provs, conts, perfiles, clis, mapa, hist] = await Promise.all([
        enTandas<PRItem>(its.map((i) => i.presupuesto_item_id || ""), (t) => db.from("presupuesto_items").select("id, precio_venta, descuento_porcentaje, costo_moneda").in("id", t)),
        traerTodo<Proveedor & { activo: boolean }>(() => db.from("proveedores").select("id, razon_social, nombre_fantasia, rubro, marcas, activo").eq("sociedad_id", sociedadId).order("razon_social")),
        enTandas<any>(vivas.map((o) => o.proveedor_id || ""), (t) => db.from("contactos").select("entity_id, cargo, whatsapp, telefono, email, principal").eq("entity_type", "proveedor").in("entity_id", t).order("principal", { ascending: false })),
        db.from("profiles").select("id, full_name"),
        enTandas<{ id: string; razon_social: string }>(vivas.map((o) => o.presupuesto_origen?.cliente_id || ""), (t) => db.from("clientes").select("id, razon_social").in("id", t)),
        db.from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadId),
        traerTodo<any>(() => db.from("orden_compra_items").select("codigo, descripcion, ordenes_compra!inner(proveedor_id, sociedad_id, estado, fecha)")
          .eq("ordenes_compra.sociedad_id", sociedadId).not("ordenes_compra.proveedor_id", "is", null).neq("ordenes_compra.estado", "cancelada")),
      ]);
      // Lista de costos: solo los códigos que aparecen en los renglones.
      const codigos = [...new Set(its.map((i) => String(i.codigo || "").trim()).filter(Boolean))];
      const selLista = "codigo, codigo_interno, descripcion, proveedor, costo, moneda";
      const [l1, l2] = await Promise.all([
        enTandas<FilaLista>(codigos, (t) => db.from("catalogo_costos").select(selLista).eq("activo", true).in("codigo_interno", t)),
        enTandas<FilaLista>(codigos, (t) => db.from("catalogo_costos").select(selLista).eq("activo", true).in("codigo", t)),
      ]);
      const porVendedor: Record<string, any[]> = {};
      for (const c of conts) (porVendedor[c.entity_id] ||= []).push(c);
      const cs: Record<string, Contacto> = {};
      for (const [id, lst] of Object.entries(porVendedor)) {
        const v: any = contactoVentas(lst);
        cs[id] = { email: String(v?.email || "").trim(), whatsapp: String(v?.whatsapp || v?.telefono || "").trim() };
      }
      const mp: Record<string, string> = {};
      for (const m of (mapa.data || []) as { proveedor_lista: string; proveedor_id: string }[]) if (m.proveedor_lista && m.proveedor_id) mp[m.proveedor_lista.trim().toLowerCase()] = m.proveedor_id;
      setOcs(vivas);
      setItems(its);
      setPrItems(Object.fromEntries(pis.map((p) => [p.id, p])));
      setProveedores(provs.filter((p) => p.activo !== false));
      setContactos(cs);
      setNombres(Object.fromEntries(((perfiles.data || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || ""])));
      setClientes(Object.fromEntries(clis.map((c) => [c.id, c.razon_social])));
      setMapaListas(mp);
      setHistorial(hist.map((h: any) => ({ codigo: h.codigo, descripcion: h.descripcion, proveedor_id: h.ordenes_compra?.proveedor_id || null, fecha: h.ordenes_compra?.fecha || null })));
      const vistos = new Set<string>();
      setLista([...l1, ...l2].filter((f) => { const k = `${f.proveedor}|${f.codigo}|${f.codigo_interno}`; if (vistos.has(k)) return false; vistos.add(k); return true; }));
      // Remitos del proveedor ya cargados (foto). Si la tabla todavía no existe, se avisa y la foto no queda atada.
      try {
        const rems = await enTandas<RemitoOC>(vivas.map((o) => o.id), (t) => db.from("oc_remitos").select("id, orden_id, numero_remito, foto_url, created_at").eq("sociedad_id", sociedadId).eq("anulado", false).in("orden_id", t).order("created_at"));
        const porOC: Record<string, RemitoOC[]> = {};
        for (const r of rems) (porOC[r.orden_id] ||= []).push(r);
        setRemitosOC(porOC);
        setFaltaTablaRemitos(false);
      } catch {
        setRemitosOC({});
        setFaltaTablaRemitos(true);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer las compras");
    } finally {
      setCargando(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // ── Derivados ──────────────────────────────────────────────────
  const itemsDe = useMemo(() => {
    const m: Record<string, Item[]> = {};
    for (const it of items) (m[it.orden_id] ||= []).push(it);
    return m;
  }, [items]);
  const provPorId = useMemo(() => Object.fromEntries(proveedores.map((p) => [p.id, p])), [proveedores]);
  const opcionesProv = useMemo(() => proveedores.filter((p) => (p as any).activo !== false).map((p) => ({ valor: p.id, texto: nombreProv(p), detalle: p.nombre_fantasia && p.nombre_fantasia !== p.razon_social ? p.razon_social : (p.rubro || undefined) })), [proveedores]);

  // Una OC con algo recibido ya se pidió aunque nadie la haya marcado (OC viejas).
  const yaPedida = useCallback((o: OC) => o.pedido || (itemsDe[o.id] || []).some((i) => Number(i.cantidad_recibida) > 0), [itemsDe]);
  const paraPedir = useMemo(() => ocs.filter((o) => o.proveedor_id && !yaPedida(o) && (itemsDe[o.id] || []).length), [ocs, itemsDe, yaPedida]);
  const esperando = useMemo(() => ocs.filter((o) => o.proveedor_id && yaPedida(o))
    .sort((a, b) => (diasDesde(b.pedido_at || b.created_at) ?? 0) - (diasDesde(a.pedido_at || a.created_at) ?? 0)), [ocs, yaPedida]);
  const ocsSinProveedor = useMemo(() => ocs.filter((o) => !o.proveedor_id && (itemsDe[o.id] || []).length), [ocs, itemsDe]);
  const preguntas = useMemo(() => ocsSinProveedor.flatMap((o) => (itemsDe[o.id] || []).map((it) => ({ oc: o, it }))), [ocsSinProveedor, itemsDe]);

  // Lo que se ve en pantalla según el buscador (las acciones de "todo" siguen usando las listas completas).
  const palabras = useMemo(() => palabrasBusqueda(busca), [busca]);
  const coincideOC = useCallback((o: OC) => !palabras.length || coincideTodas(normalizarTexto([
    o.numero, o.presupuesto_origen?.numero, clientes[o.presupuesto_origen?.cliente_id || ""], o.proveedores?.razon_social, o.proveedores?.nombre_fantasia,
    ...(itemsDe[o.id] || []).map((i) => `${i.codigo || ""} ${i.descripcion || ""}`),
  ].filter(Boolean).join(" ")), palabras), [palabras, clientes, itemsDe]);
  const atrasada = useCallback((o: OC) => (diasDesde(o.pedido_at || o.created_at) ?? 0) >= DIAS_AVISO_ESPERANDO, []);
  const paraPedirVer = useMemo(() => paraPedir.filter(coincideOC), [paraPedir, coincideOC]);
  const esperandoBusca = useMemo(() => esperando.filter(coincideOC), [esperando, coincideOC]);
  const esperandoVer = useMemo(() => esperandoBusca.filter((o) => filtroEsp === "todas" || (filtroEsp === "tarde" ? atrasada(o) : o.estado === "recibida_parcial")), [esperandoBusca, filtroEsp, atrasada]);
  const ocsSinProveedorVer = useMemo(() => ocsSinProveedor.filter(coincideOC), [ocsSinProveedor, coincideOC]);
  const preguntasVer = useMemo(() => ocsSinProveedorVer.reduce((n, o) => n + (itemsDe[o.id] || []).length, 0), [ocsSinProveedorVer, itemsDe]);

  const grupos = useMemo(() => {
    const g = new Map<string, OC[]>();
    for (const o of paraPedirVer) g.set(o.proveedor_id as string, [...(g.get(o.proveedor_id as string) || []), o]);
    return [...g.entries()].sort((a, b) => nombreProv(a[1][0].proveedores).localeCompare(nombreProv(b[1][0].proveedores)));
  }, [paraPedirVer]);

  const centralizar = useMemo(() => {
    // El destino tiene que vender TODOS los renglones que se le pasan (en su lista o porque ya se los compramos).
    const puedeVender = (ocId: string, proveedorId: string) => (itemsDe[ocId] || []).every((it) =>
      sugerirProveedores({ codigo: it.codigo, descripcion: it.descripcion }, lista, mapaListas, historial).some((s) => s.proveedor_id === proveedorId));
    return sugerirCentralizar(paraPedir.map((o) => ({
      oc_id: o.id, pr_id: o.presupuesto_origen_id, pr_numero: o.presupuesto_origen?.numero || null,
      proveedor_id: o.proveedor_id as string, proveedor_nombre: nombreProv(o.proveedores), moneda: o.moneda, total: Number(o.total) || 0,
    })), undefined, puedeVender);
  }, [paraPedir, itemsDe, lista, mapaListas, historial]);

  /** Costo de la lista de hoy para un renglón: primero la lista del mismo proveedor de la OC. */
  const filaListaPara = useCallback((it: Item, proveedorId: string | null) => {
    const cod = normalizarTexto(it.codigo);
    if (!cod) return null;
    const cands = lista.filter((f) => normalizarTexto(f.codigo_interno) === cod || normalizarTexto(f.codigo) === cod);
    return cands.find((f) => proveedorId && mapaListas[String(f.proveedor || "").trim().toLowerCase()] === proveedorId) || (cands.length === 1 ? cands[0] : null);
  }, [lista, mapaListas]);

  const revisarCosto = useCallback((oc: OC, it: Item) => {
    const f = filaListaPara(it, oc.proveedor_id);
    const pi = it.presupuesto_item_id ? prItems[it.presupuesto_item_id] : null;
    const pr = oc.presupuesto_origen;
    return costoAlDia({
      costoOC: Number(it.precio_unitario) || 0, costoMoneda: pi?.costo_moneda || oc.moneda,
      costoLista: f ? Number(f.costo) : null, monedaLista: f?.moneda || null,
      venta: pi ? { precio_venta: Number(pi.precio_venta) || 0, descuento_porcentaje: pi.descuento_porcentaje } : null,
      descuentoGeneral: Number(pr?.descuento_general_porcentaje) || 0, prMoneda: pr?.moneda || "ARS",
      tc: Number(pr?.tipo_cambio) || 0, tcDivisas: Number(pr?.tipo_cambio_divisas) || 0,
    });
  }, [filaListaPara, prItems]);

  const sugerenciasDe = useCallback((oc: OC, it: Item): ProveedorSugerido[] => {
    const sinStock = new Set(proveedoresSinStock(oc.observaciones));
    const fuera = (id: string) => { const p = provPorId[id]; return !p || sinStock.has(normalizarTexto(p.razon_social)) || sinStock.has(normalizarTexto(p.nombre_fantasia)); };
    const locales = sugerirProveedores({ codigo: it.codigo, descripcion: it.descripcion }, lista, mapaListas, historial).filter((s) => !fuera(s.proveedor_id));
    const ia = (sugIA[it.id] || []).filter((s) => !fuera(s.proveedor_id) && !locales.some((l) => l.proveedor_id === s.proveedor_id));
    return [...locales, ...ia].slice(0, 3);
  }, [lista, mapaListas, historial, sugIA, provPorId]);

  // ── Acciones ───────────────────────────────────────────────────
  const ocParaEnvio = (o: OC): { oc: OCEnvio; items: OCEnvioItem[] } => ({
    oc: { ...o, proveedor: { ...(o.proveedores || {}), razon_social: o.proveedores?.razon_social || "Proveedor" }, presupuesto_origen: o.presupuesto_origen ? { numero: o.presupuesto_origen.numero } : null } as OCEnvio,
    items: (itemsDe[o.id] || []).map((it) => ({ codigo: it.codigo, descripcion: it.descripcion, cantidad: Number(it.cantidad), unidad: it.unidad, precio_unitario: Number(it.precio_unitario), subtotal: Number(it.subtotal) })),
  });

  async function marcarPedido(o: OC, via: "mail" | "whatsapp" | "manual"): Promise<boolean> {
    const cambios = { pedido: true, pedido_at: new Date().toISOString(), pedido_via: via, pedido_por: profile?.id || null };
    const { error: e } = await db.from("ordenes_compra").update(cambios).eq("id", o.id).eq("sociedad_id", sociedadId);
    if (e) { toast.error(`${o.numero}: no se pudo marcar como pedida (${e.message})`); return false; }
    setOcs((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...cambios } : x)));
    return true;
  }

  async function deshacerPedido(o: OC) {
    const cambios = { pedido: false, pedido_at: null, pedido_via: null, pedido_por: null };
    const { error: e } = await db.from("ordenes_compra").update(cambios).eq("id", o.id).eq("sociedad_id", sociedadId);
    if (e) { toast.error(`No se pudo deshacer: ${e.message}`); return; }
    setOcs((prev) => prev.map((x) => (x.id === o.id ? { ...x, ...cambios } : x)));
    toast.info(`${o.numero} volvió a "Para pedir"`);
  }

  /** Manda la OC por mail al contacto de Ventas del proveedor, con el PDF. Devuelve si salió. */
  async function enviarMail(o: OC): Promise<boolean> {
    const para = contactos[o.proveedor_id || ""]?.email;
    if (!para) { toast.error(`${nombreProv(o.proveedores)} no tiene mail de Ventas: cargalo con "…"`); return false; }
    if (!sociedadActiva) return false;
    const { oc, items: its } = ocParaEnvio(o);
    const template = await loadEmailTemplate("orden_compra", sociedadActiva.id);
    const vars = { numero: o.numero, sociedad: sociedadActiva.razonSocial || "Lazzari", total: formatCurrency(Number(o.total), mon(o.moneda)), fecha: formatDate(o.fecha), proveedor: oc.proveedor.razon_social };
    const cuerpo = cuerpoMailConAviso(applyTemplateVars(template.cuerpo, vars), o.numero);
    const pdfBase64 = await htmlToPdfBase64(htmlOCParaProveedor(oc, its, sociedadActiva));
    if (!pdfBase64) { toast.error(`${o.numero}: no se pudo armar el PDF; no se mandó`); return false; }
    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: para.split(/[,;]\s*/).map((x) => x.trim()).filter(Boolean),
        subject: applyTemplateVars(template.asunto, vars),
        bodyHtml: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6">${cuerpo.replace(/\n/g, "<br/>")}</div>`,
        pdfBase64, pdfFilename: `${o.numero}.pdf`, sociedadId: sociedadActiva.id, documentType: "orden_compra",
        userEmail: profile?.email ? `${profile.full_name || "Lazzari"} <${profile.email}>` : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) { toast.error(`${o.numero}: no salió el mail (${data.error || res.status})`); return false; }
    await marcarPedido(o, "mail");
    return true;
  }

  async function mandarMail(o: OC) {
    const para = contactos[o.proveedor_id || ""]?.email;
    if (!para) { setEnviarIds([o.id]); return; }
    if (!window.confirm(`¿Mandar ${o.numero} a ${nombreProv(o.proveedores)} (${para}) con el PDF?`)) return;
    setOcupado(o.id);
    try { if (await enviarMail(o)) toast.success(`${o.numero} mandada a ${para}`); }
    catch (e: any) { toast.error(`${o.numero}: ${e?.message || "error al mandar"}`); }
    finally { setOcupado(null); }
  }

  function mandarWhatsApp(o: OC) {
    const link = linkWhatsAppOC(contactos[o.proveedor_id || ""]?.whatsapp, textoOCParaProveedor(ocParaEnvio(o).oc, ocParaEnvio(o).items));
    if (!link) { setEnviarIds([o.id]); return; }
    window.open(link, "_blank", "noopener");
    void marcarPedido(o, "whatsapp").then((ok) => ok && toast.info(`${o.numero} quedó como pedida por WhatsApp (si no la mandaste, "Deshacer" en Esperando)`));
  }

  /** Manda por mail solo los pedidos que se ven (si hay búsqueda, los filtrados). */
  async function mandarTodo() {
    const conMail = paraPedirVer.filter((o) => contactos[o.proveedor_id || ""]?.email);
    const sinMail = paraPedirVer.filter((o) => !contactos[o.proveedor_id || ""]?.email);
    if (!conMail.length) { toast.warning("Ningún pedido tiene mail de Ventas: mandalos por WhatsApp o cargá el mail con \"…\""); return; }
    const detalle = conMail.map((o) => `• ${o.numero} → ${nombreProv(o.proveedores)} (${contactos[o.proveedor_id || ""].email})`).join("\n");
    if (!window.confirm(`Se mandan ${conMail.length} pedido(s) por mail con su PDF:\n\n${detalle}${sinMail.length ? `\n\n${sinMail.length} sin mail quedan para WhatsApp.` : ""}\n\n¿Mandar?`)) return;
    setOcupado("todo");
    let ok = 0;
    for (const o of conMail) {
      try { if (await enviarMail(o)) ok++; } catch (e: any) { toast.error(`${o.numero}: ${e?.message || "error"}`); }
    }
    setOcupado(null);
    toast.success(`Mandados ${ok} de ${conMail.length} por mail${sinMail.length ? ` · ${sinMail.length} sin mail: mandalos por WhatsApp` : ""}`);
  }

  /**
   * Mueve renglones a otro proveedor (o a "sin proveedor"). Va a una OC sin mandar del mismo PR y moneda
   * de ese proveedor, o crea una. Si la OC de origen queda vacía se cancela (no se borra). No toca el PR.
   */
  async function moverRenglones(itemIds: string[], destino: string | null, nota: string, creadas: Map<string, string> = new Map()): Promise<boolean> {
    const porOrigen = new Map<string, Item[]>();
    for (const id of itemIds) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      if (Number(it.cantidad_recibida) > 0) { toast.warning(`"${it.descripcion}" ya tiene algo recibido: cambialo desde Compras`); continue; }
      porOrigen.set(it.orden_id, [...(porOrigen.get(it.orden_id) || []), it]);
    }
    if (!porOrigen.size) return false;
    const nombreDestino = destino ? nombreProv(provPorId[destino]) : "sin proveedor";
    let todoBien = true;
    for (const [origenId, its] of porOrigen) {
      const origen = ocs.find((o) => o.id === origenId);
      if (!origen) continue;
      if (origen.proveedor_id === destino) continue;
      try {
        const clave = `${destino}|${origen.presupuesto_origen_id}|${mon(origen.moneda)}`;
        let dest = ocs.find((o) => o.id !== origen.id && o.proveedor_id === destino && !o.pedido && !esStockPropio(o)
          && o.presupuesto_origen_id === origen.presupuesto_origen_id && mon(o.moneda) === mon(origen.moneda))
          || (creadas.has(clave) ? ({ id: creadas.get(clave) } as OC) : undefined);
        const notaLinea = nota ? ` · ${nota}` : "";
        if (!dest) {
          const { data: nueva, error: e1 } = await db.from("ordenes_compra").insert({
            proveedor_id: destino, presupuesto_origen_id: origen.presupuesto_origen_id, sociedad_id: sociedadId,
            fecha: todayAR(), moneda: origen.moneda, estado: "enviada", subtotal: 0, iva: 0, total: 0,
            observaciones: `${destino ? "Armada en Compras nueva" : "Asignar proveedor"} desde ${origen.numero}${origen.presupuesto_origen?.numero ? ` (${origen.presupuesto_origen.numero})` : ""}${notaLinea}`,
            nota_ia: nota || null, created_by: profile?.id || null,
          }).select("id").single();
          if (e1 || !nueva) throw new Error(e1?.message || "no se pudo crear la OC");
          dest = { id: nueva.id } as OC;
          creadas.set(clave, nueva.id);
        } else if (nota && !creadas.has(clave)) {
          await db.from("ordenes_compra").update({ observaciones: `${dest.observaciones || ""}${notaLinea}`.replace(/^ · /, "") }).eq("id", dest.id).eq("sociedad_id", sociedadId);
        }
        const { error: e2 } = await db.from("orden_compra_items").update({ orden_id: dest.id }).in("id", its.map((i) => i.id));
        if (e2) throw new Error(e2.message);
        const { count: quedan } = await db.from("orden_compra_items").select("id", { count: "exact", head: true }).eq("orden_id", origen.id);
        if (quedan === 0) {
          await db.from("ordenes_compra").update({ estado: "cancelada", observaciones: `${origen.observaciones || ""} · Vacía: sus renglones pasaron a ${nombreDestino} (Compras nueva)`.replace(/^ · /, "") })
            .eq("id", origen.id).eq("sociedad_id", sociedadId);
        }
        if (origen.pedido) toast.warning(`${origen.numero} ya estaba pedida a ${nombreProv(origen.proveedores)}: avisale que saque ${its.length === 1 ? "ese renglón" : `esos ${its.length} renglones`}`);
      } catch (e: any) {
        todoBien = false;
        toast.error(`${origen.numero}: ${e?.message || "no se pudo mover"}`);
      }
    }
    return todoBien;
  }

  async function asignar(itemIds: string[], destino: string, nota = "") {
    setOcupado(itemIds.join(","));
    const ok = await moverRenglones(itemIds, destino, nota);
    setOcupado(null);
    setEligiendo(null);
    if (ok) toast.success(`Pasado a ${nombreProv(provPorId[destino])}: queda en "Para pedir"`);
    await cargar();
  }

  async function sinStock(oc: OC, it: Item) {
    const prov = nombreProv(oc.proveedores);
    if (!window.confirm(`¿${prov} no tiene stock de "${it.descripcion}"?\nEl renglón pasa a "Preguntas" para elegir otro proveedor.`)) return;
    setOcupado(it.id);
    const ok = await moverRenglones([it.id], null, `Sin stock en ${oc.proveedores?.razon_social || prov}: ${it.codigo || it.descripcion.slice(0, 40)}`);
    setOcupado(null);
    if (ok) toast.info("Pasado a Preguntas, con otros proveedores sugeridos");
    await cargar();
  }

  async function aplicarCentralizar(s: ReturnType<typeof sugerirCentralizar>[number]) {
    const ids = s.oc_ids.flatMap((id) => (itemsDe[id] || []).map((i) => i.id));
    if (!window.confirm(`¿Pasar ${ids.length} renglón(es) de ${s.proveedores_a_mover.join(", ")} a ${s.destino_nombre}?\nOjo: revisá con ${s.destino_nombre} que lo tenga y a qué precio (queda el costo actual).`)) return;
    await asignar(ids, s.destino_proveedor_id, `Centralizado en ${s.destino_nombre}`);
  }

  async function usarCostoLista(oc: OC, it: Item, costo: number) {
    if (!window.confirm(`¿Poner en ${oc.numero} el costo de la lista de hoy (${formatCurrency(costo, mon(oc.moneda))}) para "${it.descripcion}"?\nEl precio al cliente no cambia.`)) return;
    setOcupado(it.id);
    const { error: e } = await db.from("orden_compra_items").update({ precio_unitario: costo }).eq("id", it.id);
    setOcupado(null);
    if (e) { toast.error(`No se pudo: ${e.message}`); return; }
    toast.success("Costo actualizado en la OC");
    await cargar();
  }

  async function buscarConIA() {
    const sinSug = preguntas.filter(({ oc, it }) => !sugerenciasDe(oc, it).length);
    if (!sinSug.length) { toast.info("Todos los renglones ya tienen proveedores sugeridos"); return; }
    const conHistoria = new Set([...historial.map((h) => h.proveedor_id), ...Object.values(mapaListas)].filter(Boolean) as string[]);
    const candidatos = proveedores.filter((p) => conHistoria.has(p.id) || (p.rubro || "").trim() || (p.marcas || "").trim());
    setBuscandoIA(true);
    try {
      const res = await fetch("/api/compras/sugerir-proveedor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          renglones: sinSug.map(({ it }) => ({ id: it.id, codigo: it.codigo, descripcion: it.descripcion })),
          proveedores: candidatos.map((p) => ({ id: p.id, nombre: nombreProv(p), rubro: p.rubro, marcas: p.marcas })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "La IA no respondió");
      const nuevo: Record<string, ProveedorSugerido[]> = {};
      for (const s of data.sugerencias || []) nuevo[s.id] = (s.proveedores || []).map((p: any) => ({ proveedor_id: p.proveedor_id, motivo: `IA: ${p.motivo}`, puntos: 30 }));
      setSugIA((prev) => ({ ...prev, ...nuevo }));
      const n = Object.values(nuevo).filter((x) => x.length).length;
      toast[n ? "success" : "info"](n ? `La IA sugirió proveedor para ${n} renglón(es)` : "La IA no encontró proveedores razonables: elegilo a mano");
    } catch (e: any) {
      toast.error(e?.message || "La IA no respondió");
    } finally {
      setBuscandoIA(false);
    }
  }

  // ── Foto del remito del proveedor ──────────────────────────────
  const anotarDeshacer = useCallback((texto: string, fn: () => Promise<void>) => {
    contador.current += 1;
    const id = contador.current;
    setDeshacer((prev) => [{ id, texto, fn }, ...prev].slice(0, 6));
  }, []);
  async function hacerDeshacer(d: Deshacer) {
    setOcupado(`undo-${d.id}`);
    try { await d.fn(); toast.info(`Deshecho: ${d.texto}`); setDeshacer((prev) => prev.filter((x) => x.id !== d.id)); }
    catch (e: any) { toast.error(`No se pudo deshacer: ${e?.message || "error"}`); }
    finally { setOcupado(null); await cargar(); }
  }

  /** Avisa al vendedor del PR (campanita), si no es el mismo que la carga. Devuelve si se mandó el aviso. */
  async function avisarVendedor(o: OC, texto: string, titulo = "Llegó mercadería"): Promise<boolean> {
    const pr = o.presupuesto_origen;
    const destino = pr?.vendedor_id || pr?.created_by || null;
    if (!pr || !destino || destino === profile?.id) return false;
    const { error } = await db.from("alertas").insert({
      tipo: "seguimiento", title: `${titulo}: ${pr.numero}`, description: texto,
      entity_id: pr.id, entity_type: "presupuesto", module: "compras_nueva", user_id: destino, sociedad_id: sociedadId || null,
    });
    return !error;
  }

  /**
   * Carga como recibido en la OC lo que vino en el remito (con las cantidades de la base al momento, nunca más de lo pedido),
   * actualiza el estado de la OC, guarda el remito con la foto y avisa al vendedor. No mueve stock. Con Deshacer.
   */
  async function cargarRecibido(o: OC, cant: Record<string, number>, foto: { url: string | null; leido?: LeidoRemito }): Promise<Recepcion | null> {
    if (!sociedadId) return null;
    const { data: frescos, error: e0 } = await db.from("orden_compra_items").select("id, descripcion, codigo, cantidad, cantidad_recibida").eq("orden_id", o.id);
    if (e0) { toast.error(`${o.numero}: no se pudo leer la OC (${e0.message})`); return null; }
    const rec = armarRecepcion(frescos || [], Object.entries(cant).map(([item_id, cantidad]) => ({ item_id, cantidad })));
    if (!rec.cargas.length) { toast.warning(`${o.numero}: no hay nada para cargar (ya estaba recibido o las cantidades están en 0)`); return null; }
    // El estado de antes se lee antes de cargar: la base lo cambia sola al tocar lo recibido.
    const { data: actual } = await db.from("ordenes_compra").select("estado").eq("id", o.id).eq("sociedad_id", sociedadId).single();
    const estadoAntes: string = actual?.estado || o.estado;
    const hechas: Recepcion["cargas"] = [];
    for (const c of rec.cargas) {
      const { error: e } = await db.from("orden_compra_items").update({ cantidad_recibida: c.despues }).eq("id", c.item_id).eq("orden_id", o.id);
      if (e) {
        for (const h of hechas) await db.from("orden_compra_items").update({ cantidad_recibida: h.antes }).eq("id", h.item_id).eq("orden_id", o.id);
        toast.error(`${o.numero}: no se pudo cargar lo recibido (${e.message}); no quedó nada cargado`);
        return null;
      }
      hechas.push(c);
    }
    if (rec.estado) {
      const { error: e } = await db.from("ordenes_compra").update({ estado: rec.estado }).eq("id", o.id).eq("sociedad_id", sociedadId);
      if (e) toast.warning(`${o.numero}: se cargó lo recibido pero no cambió el estado (${e.message})`);
    }
    let registroId: string | null = null;
    if (!faltaTablaRemitos) {
      const { data: reg, error: e } = await db.from("oc_remitos").insert({
        sociedad_id: sociedadId, orden_id: o.id, proveedor_id: o.proveedor_id, numero_remito: foto.leido?.numero_remito || null,
        fecha_remito: foto.leido?.fecha || null, foto_url: foto.url, leido_ia: foto.leido || null, cargado: hechas,
        estado_antes: estadoAntes, estado_despues: rec.estado || estadoAntes, nota: foto.leido?.anotaciones || null, created_by: profile?.id || null,
      }).select("id").single();
      if (e) toast.warning(`${o.numero}: lo recibido quedó cargado, pero la foto no quedó atada a la OC (${e.message})`);
      else registroId = reg.id;
    } else if (foto.url) {
      toast.warning("Falta correr la migración oc_remitos: lo recibido quedó cargado, pero la foto no quedó atada a la OC");
    }
    const completo = rec.estado === "recibida";
    const avisado = await avisarVendedor(o, `${profile?.full_name || "Compras"} cargó el remito${foto.leido?.numero_remito ? ` ${foto.leido.numero_remito}` : ""} de ${nombreProv(o.proveedores)} (${o.numero}): ${completo ? "llegó todo" : `llegó una parte, faltan ${rec.faltan.length} renglón(es)`}.`).catch(() => false);
    anotarDeshacer(`recibido ${o.numero}`, () => deshacerRecibido(o, hechas, estadoAntes, registroId, avisado));
    return rec;
  }

  async function deshacerRecibido(o: OC, cargas: Recepcion["cargas"], estadoAntes: string, registroId: string | null, avisado: boolean) {
    const { data: frescos, error: e0 } = await db.from("orden_compra_items").select("id, cantidad, cantidad_recibida").eq("orden_id", o.id);
    if (e0) throw e0;
    const despues = ((frescos || []) as { id: string; cantidad: number; cantidad_recibida: number | null }[]).map((it) => {
      const c = cargas.find((x) => x.item_id === it.id);
      return c ? { ...it, cantidad_recibida: Math.max(0, Number(it.cantidad_recibida || 0) - c.cantidad) } : it;
    });
    for (const c of cargas) {
      const it = despues.find((x) => x.id === c.item_id);
      if (!it) continue;
      const { error } = await db.from("orden_compra_items").update({ cantidad_recibida: it.cantidad_recibida }).eq("id", it.id).eq("orden_id", o.id);
      if (error) throw error;
    }
    const { error: e1 } = await db.from("ordenes_compra").update({ estado: estadoPorRecibido(despues, estadoAntes) }).eq("id", o.id).eq("sociedad_id", sociedadId);
    if (e1) throw e1;
    if (registroId) await db.from("oc_remitos").update({ anulado: true }).eq("id", registroId).eq("sociedad_id", sociedadId);
    // El aviso de "Llegó mercadería" no se puede borrar (es del vendedor): se le manda la corrección.
    if (avisado) await avisarVendedor(o, `${profile?.full_name || "Compras"} deshizo la carga del remito de ${nombreProv(o.proveedores)} (${o.numero}): no cuenta como llegado.`, "Corrección, no llegó").catch(() => false);
    setFotos((prev) => prev.map((f) => (f.oc_id === o.id && f.cargado ? { ...f, cargado: undefined, respondida: false } : f)));
  }

  function elegirFoto(ocId: string | null) {
    fotoPara.current = ocId;
    inputFoto.current?.click();
  }

  async function leerRemitos(files: FileList | null) {
    if (!files?.length || !sociedadId) return;
    const para = fotoPara.current;
    fotoPara.current = null;
    setTab("oc");
    const candidatos = para ? esperando.filter((o) => o.id === para) : esperando;
    if (!candidatos.length) { toast.warning("No hay pedidos esperando para cruzar el remito"); return; }
    for (const file of Array.from(files).slice(0, 10)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setFotos((prev) => [{ key, nombre: file.name, url: null, leyendo: true, oc_id: para, cant: {} }, ...prev]);
      try {
        const prep = await prepararArchivo(file);
        const ruta = `remitos-proveedor/${sociedadId}/${key}.${prep.ext}`;
        const { error: eS } = await supabase.storage.from("comprobantes").upload(ruta, prep.blob, { contentType: prep.mediaType, upsert: false });
        const url = eS ? null : linkArchivo("comprobantes", ruta);
        const res = await fetch("/api/compras/leer-remito", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64: prep.base64, mediaType: prep.mediaType,
            ocs: candidatos.map((o) => ({
              id: o.id, numero: o.numero, proveedor: nombreProv(o.proveedores), cuit: o.proveedores?.cuit || null, fecha: (o.pedido_at || o.fecha || "").slice(0, 10),
              items: (itemsDe[o.id] || []).map((it) => ({ id: it.id, codigo: it.codigo, descripcion: it.descripcion, cantidad: Number(it.cantidad), recibida: Number(it.cantidad_recibida || 0) })),
            })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "La IA no pudo leer el remito");
        const leido = data as LeidoRemito;
        const ocId = para || ocDelRemito(leido, candidatos.map((o) => ({ id: o.id, numero: o.numero, proveedor: nombreProv(o.proveedores), proveedor_cuit: o.proveedores?.cuit })));
        const o = ocId ? candidatos.find((x) => x.id === ocId) || null : null;
        const its = o ? itemsDe[o.id] || [] : [];
        const cant: Record<string, number> = {};
        for (const r of leido.renglones) if (r.item_id && its.some((i) => i.id === r.item_id)) cant[r.item_id] = (cant[r.item_id] || 0) + Number(r.cantidad || 0);
        let cargado: Recepcion | undefined;
        if (o) {
          const rec = armarRecepcion(its, leido.renglones.map((r) => ({ item_id: r.item_id && its.some((i) => i.id === r.item_id) ? r.item_id : null, descripcion: r.descripcion, cantidad: r.cantidad })));
          // Segura (OC reconocida por la IA y todo atado sin pasarse): se carga sola, con Deshacer.
          if (seguroParaCargar(rec, leido.segura && leido.oc_id === o.id)) cargado = (await cargarRecibido(o, cant, { url, leido })) || undefined;
        }
        setFotos((prev) => prev.map((f) => (f.key === key ? {
          ...f, url, leyendo: false, leido, oc_id: ocId, cant, cargado,
          error: eS ? `La foto no se pudo guardar (${eS.message}); lo leído sirve igual` : undefined,
        } : f)));
      } catch (e: any) {
        setFotos((prev) => prev.map((f) => (f.key === key ? { ...f, leyendo: false, error: e?.message || "No se pudo leer" } : f)));
      }
    }
    await cargar();
  }

  async function confirmarFoto(f: FotoRemito) {
    const o = ocs.find((x) => x.id === f.oc_id);
    if (!o) { toast.warning("Elegí a qué OC corresponde el remito"); return; }
    setOcupado(`foto-${f.key}`);
    try {
      const rec = await cargarRecibido(o, f.cant, { url: f.url, leido: f.leido });
      if (rec) {
        setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, cargado: rec } : x)));
        toast.success(`${o.numero}: ${rec.estado === "recibida" ? "llegó todo" : "cargado lo que llegó"}`);
      }
    } finally { setOcupado(null); await cargar(); }
  }

  // ── Pantalla ───────────────────────────────────────────────────
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40";
  const itemPorId = (id: string) => items.find((i) => i.id === id);
  const ocDeItem = (id: string) => { const it = itemPorId(id); return it ? ocs.find((o) => o.id === it.orden_id) : undefined; };
  const prCliente = (o: OC) => [o.presupuesto_origen?.numero, clientes[o.presupuesto_origen?.cliente_id || ""]].filter(Boolean).join(" · ");
  const pendientesDe = (o: OC) => (itemsDe[o.id] || []).filter((i) => Number(i.cantidad_recibida || 0) < Number(i.cantidad));
  /** Abre el mensaje para reclamar solo lo que falta (sin precios). `id` dice dónde se muestra (la OC o la tarjeta de la foto). */
  const abrirReclamo = (o: OC, id: string) => {
    const its = itemsDe[o.id] || [];
    const pend = pendientesDe(o);
    setReclamo(reclamo?.id === id ? null : { id, texto: textoReclamoOC(o, pend.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, falta: Number(i.cantidad) - Number(i.cantidad_recibida || 0), unidad: i.unidad })), pend.length < its.length) });
  };
  const cajaReclamo = (o: OC, id: string) => reclamo?.id === id && (
    <div className="mt-2 space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/50 p-2 dark:border-sky-900 dark:bg-sky-950/20">
      <textarea value={reclamo.texto} onChange={(e) => setReclamo({ id, texto: e.target.value })} rows={Math.min(14, 8 + pendientesDe(o).length * 2)} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900" />
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => { const link = linkWhatsAppOC(contactos[o.proveedor_id || ""]?.whatsapp, reclamo.texto); if (!link) { toast.error("Este proveedor no tiene WhatsApp cargado: copiá el texto"); return; } window.open(link, "_blank"); }} className={`${btn} bg-emerald-600 text-white`}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
        <button onClick={() => { const para = contactos[o.proveedor_id || ""]?.email || ""; window.open(`mailto:${para}?subject=${encodeURIComponent(`Seguimiento ${o.numero}`)}&body=${encodeURIComponent(reclamo.texto.replace(/\*/g, ""))}`, "_self"); }} className={`${btn} bg-sky-600 text-white`}><Mail className="h-3.5 w-3.5" /> Mail (se abre tu correo)</button>
        <button onClick={async () => { try { await navigator.clipboard.writeText(reclamo.texto); toast.success("Copiado, sin precios"); } catch { toast.error("No se pudo copiar"); } }} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Copiar</button>
        <span className="text-[10px] text-zinc-400">Solo lo que falta, sin precios.</span>
      </div>
    </div>
  );

  /** Tarjeta de una foto de remito: lo que leyó la IA, cantidades para confirmar o lo que se cargó y la pregunta por lo que falta. */
  const tarjetaFoto = (f: FotoRemito) => {
    const o = f.oc_id ? ocs.find((x) => x.id === f.oc_id) : undefined;
    const its = o ? itemsDe[o.id] || [] : [];
    const l = f.leido;
    const sinAtar = l ? l.renglones.filter((r) => !r.item_id || !its.some((i) => i.id === r.item_id)) : [];
    const setCant = (id: string, v: number) => setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, cant: { ...x.cant, [id]: Math.max(0, v) } } : x)));
    const faltan = f.cargado ? f.cargado.faltan.map((x) => ({ ...x, it: itemPorId(x.item_id) })) : [];
    return (
      <div key={f.key} className={`rounded-lg border p-2 text-sm ${f.cargado ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : f.error && !l ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" : "border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20"}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Camera className="h-4 w-4 text-zinc-400" />
          <span className="text-xs text-zinc-500">{f.nombre}</span>
          {f.url && <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-xs text-sky-600 hover:underline"><ExternalLink className="h-3 w-3" /> ver foto</a>}
          {l && <span className="text-xs">{[l.proveedor, l.numero_remito ? `remito ${l.numero_remito}` : null, l.fecha ? formatDate(l.fecha) : null].filter(Boolean).join(" · ")}</span>}
          {f.leyendo && <span className="flex items-center gap-1 text-xs text-violet-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> La IA está leyendo el remito…</span>}
          {!f.leyendo && <button onClick={() => setFotos((prev) => prev.filter((x) => x.key !== f.key))} className="ml-auto text-xs text-zinc-400 hover:text-zinc-700" title="Sacar esta tarjeta (no deshace nada)">cerrar</button>}
        </div>
        {f.error && <p className="mt-1 text-xs text-red-600">{f.error}</p>}
        {l?.resumen && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"><Sparkles className="mr-1 inline h-3 w-3 text-violet-500" />{l.resumen}</p>}
        {l?.anotaciones && <p className="mt-0.5 text-xs text-amber-700">Anotado: {l.anotaciones}</p>}

        {/* Ya cargado: qué quedó y qué falta */}
        {f.cargado && (
          <div className="mt-1 space-y-1">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="mr-0.5 inline h-3.5 w-3.5" />
              {o?.numero || "OC"}: cargado {f.cargado.cargas.length} renglón(es) como recibido. {f.cargado.estado === "recibida" ? "Llegó todo." : `Faltan ${f.cargado.faltan.length} renglón(es).`} (Deshacer arriba)
            </p>
            {f.cargado.de_mas.length > 0 && <p className="text-xs text-amber-700">Vino de más: {f.cargado.de_mas.map((d) => `${d.cantidad} ${itemPorId(d.item_id)?.descripcion || ""}`).join(", ")} (se cargó hasta lo pedido)</p>}
            {o && faltan.length > 0 && !f.respondida && (
              <div className="rounded border border-amber-200 bg-amber-50/60 p-1.5 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">¿Lo que falta sigue llegando?</p>
                <ul className="my-1 space-y-0.5">
                  {faltan.map((x) => (
                    <li key={x.item_id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="w-12 text-right">{x.cantidad}</span>
                      <span className="min-w-0 flex-1 truncate">{x.it?.descripcion || "renglón"}</span>
                      {x.it && Number(x.it.cantidad_recibida || 0) === 0 && (
                        <button onClick={() => void sinStock(o, x.it!)} disabled={ocupado === x.item_id} className="flex items-center gap-0.5 text-zinc-400 hover:text-red-600" title="No viene más: pasa a Preguntas para elegir otro proveedor"><PackageX className="h-3.5 w-3.5" /> no viene</button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, respondida: true } : x)))} className={`${btn} border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900`}>Sigue llegando</button>
                  <button onClick={() => abrirReclamo(o, `foto:${f.key}`)} className={`${btn} border border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300`}><Send className="h-3.5 w-3.5" /> Reclamar lo que falta</button>
                </div>
                {cajaReclamo(o, `foto:${f.key}`)}
              </div>
            )}
          </div>
        )}

        {/* Para confirmar: la IA dudó o no encontró la OC */}
        {l && !f.cargado && !f.leyendo && (
          <div className="mt-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500">{o ? "OC:" : "¿De qué OC es?"}</span>
              <select value={f.oc_id || ""} onChange={(e) => setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, oc_id: e.target.value || null, cant: {} } : x)))}
                className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900">
                <option value="">Elegí la OC…</option>
                {esperando.map((x) => <option key={x.id} value={x.id}>{x.numero} · {nombreProv(x.proveedores)}{x.presupuesto_origen?.numero ? ` · ${x.presupuesto_origen.numero}` : ""}</option>)}
              </select>
              {o && <button onClick={() => setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, cant: Object.fromEntries(pendientesDe(o).map((i) => [i.id, Number(i.cantidad) - Number(i.cantidad_recibida || 0)])) } : x)))} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Llegó todo lo que falta</button>}
            </div>
            {o && (
              <table className="w-full text-xs">
                <thead><tr className="text-zinc-400"><th className="text-left font-normal">Renglón de la OC</th><th className="w-16 text-right font-normal">Pedido</th><th className="w-16 text-right font-normal">Ya llegó</th><th className="w-24 text-right font-normal">Llega ahora</th></tr></thead>
                <tbody>
                  {its.map((it) => {
                    const pend = Number(it.cantidad) - Number(it.cantidad_recibida || 0);
                    const v = f.cant[it.id] || 0;
                    return (
                      <tr key={it.id} className={v > 0 ? "font-medium" : "text-zinc-500"}>
                        <td className="truncate py-0.5">{it.codigo ? <span className="text-zinc-400">{it.codigo} · </span> : null}{it.descripcion}</td>
                        <td className="text-right">{Number(it.cantidad)}</td>
                        <td className="text-right">{Number(it.cantidad_recibida || 0)}</td>
                        <td className="text-right">
                          {pend > 0
                            ? <input type="number" min={0} value={v || ""} placeholder="0" onChange={(e) => setCant(it.id, Number(e.target.value) || 0)} className={`w-16 rounded border px-1 py-0.5 text-right dark:bg-zinc-900 ${v > pend ? "border-amber-400" : "border-zinc-300 dark:border-zinc-600"}`} title={v > pend ? `Faltaban ${pend}: se carga hasta lo pedido` : undefined} />
                            : <span className="text-emerald-600">completo</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {sinAtar.length > 0 && <p className="text-xs text-amber-700">En el remito pero no en {o ? o.numero : "la OC"}: {sinAtar.map((r) => `${r.cantidad} ${r.descripcion}`).join(", ")}</p>}
            {o && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => void confirmarFoto(f)} disabled={ocupado === `foto-${f.key}` || !Object.values(f.cant).some((v) => v > 0)} className={`${btn} bg-emerald-600 text-white`}>
                  {ocupado === `foto-${f.key}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Cargar lo recibido
                </button>
                <span className="text-[10px] text-zinc-400">Queda en la OC con la foto y le avisa al vendedor. No mueve stock. Con Deshacer.</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <Header title="Compras nueva" subtitle="Los pedidos se arman solos al aprobar un PR. Vos los mandás con un clic." />
      <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
        {/* Pestañas */}
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
          {([["pedir", "Para pedir", paraPedirVer.length], ["oc", "OC", ocs.length], ["preguntas", "Preguntas", preguntasVer]] as const).map(([k, t, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              {t} {k !== "oc" && <span className={`ml-1 rounded-full px-1.5 text-xs ${k === "preguntas" && n ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>{n}</span>}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            <button onClick={() => setCargarFactura(true)} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`} title="Subí la factura del proveedor: la IA la lee, elegís la o las OC y guardás">
              <FileUp className="h-3.5 w-3.5" /> Cargar factura
            </button>
            {tab === "pedir" && paraPedirVer.length > 0 && (
              <button onClick={() => void mandarTodo()} disabled={ocupado === "todo"} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`}>
                {ocupado === "todo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} {paraPedirVer.length < paraPedir.length ? `Mandar estos ${paraPedirVer.length} por mail` : "Mandar todo por mail"}
              </button>
            )}
            {tab === "esperando" && (
              <button onClick={abrirCargaMasiva} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`} title="Subí una o varias facturas de proveedor juntas: la IA las lee, busca su OC, las cruza y te pregunta solo lo que no cierra (sigue en segundo plano)">
                <FileUp className="h-3.5 w-3.5" /> Cargar facturas
              </button>
            )}
            {(tab === "esperando" || tab === "oc") && esperando.length > 0 && (
              <button onClick={() => elegirFoto(null)} className={`${btn} bg-violet-600 text-white hover:bg-violet-700`} title="Foto o PDF del remito que vino con la mercadería (varias a la vez): la IA lee qué llegó y lo carga en la OC">
                <Camera className="h-3.5 w-3.5" /> Foto del remito
              </button>
            )}
            {tab === "preguntas" && preguntas.length > 0 && (
              <button onClick={() => void buscarConIA()} disabled={buscandoIA} className={`${btn} bg-violet-600 text-white`}>
                {buscandoIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Buscar proveedor con IA
              </button>
            )}
            <button onClick={() => void cargar()} className="rounded p-1 text-zinc-400 hover:text-zinc-700" title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
          </div>
        </div>

        {/* Buscador y filtros (la pestaña OC tiene los suyos) */}
        {tab !== "oc" && <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar OC, PR, cliente, proveedor o artículo…"
              className="w-full rounded-md border border-zinc-300 bg-white py-1 pl-7 pr-7 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
            {busca && <button onClick={() => setBusca("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700" title="Borrar búsqueda"><X className="h-3.5 w-3.5" /></button>}
          </div>
          {tab === "esperando" && ([["todas", "Todas", esperandoBusca.length], ["tarde", "Atrasadas", esperandoBusca.filter(atrasada).length], ["parcial", "Llegó una parte", esperandoBusca.filter((o) => o.estado === "recibida_parcial").length]] as const).map(([k, t, n]) => (
            <button key={k} onClick={() => setFiltroEsp(k)} className={`${btn} border ${filtroEsp === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400"}`}>
              {t} <span className="text-zinc-400">{n}</span>
            </button>
          ))}
          {palabras.length > 0 && <span className="text-xs text-zinc-500">Las pestañas muestran lo que coincide con la búsqueda.</span>}
        </div>}

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
        {cargando && !ocs.length && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las compras…</p>}

        {/* PARA PEDIR */}
        {tab === "pedir" && !cargando && (
          <div className="space-y-2">
            {!palabras.length && centralizar.map((s) => (
              <div key={`${s.pr_id}|${s.moneda}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">{s.pr_numero || "PR"}: {s.proveedores_a_mover.join(", ")} es poco ({formatCurrency(s.monto_a_mover, s.moneda)}). ¿Lo pedís todo a <b>{s.destino_nombre}</b> y te ahorrás un envío?</span>
                <button onClick={() => void aplicarCentralizar(s)} className={`${btn} bg-sky-600 text-white`}>Juntar en {s.destino_nombre}</button>
              </div>
            ))}
            {!grupos.length && <p className="py-6 text-center text-sm text-zinc-500">{palabras.length ? "Nada para pedir coincide con la búsqueda." : "No hay nada para pedir. 🎉"}</p>}
            {grupos.map(([provId, lst]) => {
              const c = contactos[provId];
              return (
                <div key={provId} className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
                    <span className="font-semibold">{nombreProv(lst[0].proveedores)}</span>
                    <span className="text-xs text-zinc-500">{c?.email || <span className="text-amber-600">sin mail de Ventas</span>}{c?.whatsapp ? ` · WA ${c.whatsapp}` : ""}</span>
                  </div>
                  {lst.map((o) => {
                    const its = itemsDe[o.id] || [];
                    const dias = diasDesde(o.created_at) ?? 0;
                    return (
                      <div key={o.id} className="border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="font-mono text-xs font-semibold">{o.numero}</span>
                          <span className="text-xs text-zinc-500">{prCliente(o) || "sin PR"}</span>
                          {dias >= 3 && <span className="text-xs text-amber-600">armada {hace(dias)}</span>}
                          <span className="ml-auto font-medium">{formatCurrency(Number(o.total), mon(o.moneda))}</span>
                          <button onClick={() => void mandarMail(o)} disabled={ocupado === o.id || ocupado === "todo"} title={c?.email ? `Manda el PDF a ${c.email}` : "Falta el mail: se abre para cargarlo"} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`}>
                            {ocupado === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Mail
                          </button>
                          <button onClick={() => mandarWhatsApp(o)} title={c?.whatsapp ? "Abre WhatsApp con el pedido escrito" : "Falta el WhatsApp: se abre para cargarlo"} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
                          <button onClick={() => void marcarPedido(o, "manual").then((ok) => ok && toast.info(`${o.numero} pasó a Esperando`))} className={`${btn} border border-zinc-300 dark:border-zinc-600`} title="Ya se lo pediste por otro lado">Ya lo pedí</button>
                          <button onClick={() => setEnviarIds([o.id])} className="rounded p-1 text-zinc-400 hover:text-zinc-700" title="Más: cargar contacto, ver el mail antes, copiar, PDF"><MoreHorizontal className="h-4 w-4" /></button>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {its.map((it) => {
                            const r = revisarCosto(o, it);
                            return (
                              <li key={it.id} className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-600 dark:text-zinc-400">
                                <span className="w-10 text-right font-medium">{Number(it.cantidad)}</span>
                                <span className="min-w-0 flex-1 truncate">{it.codigo ? <span className="text-zinc-400">{it.codigo} · </span> : null}{it.descripcion}</span>
                                <span>{formatCurrency(Number(it.precio_unitario), mon(o.moneda))}</span>
                                {r.diferenciaPct !== null && Math.abs(r.diferenciaPct) >= 1 && (
                                  <button onClick={() => void usarCostoLista(o, it, r.costoLista as number)} disabled={ocupado === it.id} className={r.diferenciaPct > 0 ? "text-amber-600 hover:underline" : "text-emerald-600 hover:underline"} title="Click para usar el costo de la lista de hoy en esta OC">
                                    lista hoy {formatCurrency(r.costoLista as number, mon(o.moneda))} ({r.diferenciaPct > 0 ? "+" : ""}{r.diferenciaPct}%)
                                  </button>
                                )}
                                {r.bajoMinimo && <span className="flex items-center gap-0.5 text-red-600" title={`Margen mínimo ${MARGEN_MINIMO_COMPRAS}%: es un aviso, no frena nada`}><AlertTriangle className="h-3 w-3" /> margen {(r.margenLista ?? r.margenOC)?.toFixed(1)}%</span>}
                                <button onClick={() => void sinStock(o, it)} disabled={ocupado === it.id} className="text-zinc-400 hover:text-red-600" title="El proveedor no lo tiene: pasa a Preguntas para elegir otro"><PackageX className="h-3.5 w-3.5" /></button>
                                <button onClick={() => setEligiendo(eligiendo === it.id ? null : it.id)} className="text-zinc-400 hover:text-zinc-700 hover:underline" title="Pedírselo a otro proveedor">otro</button>
                                {eligiendo === it.id && (
                                  <div className="w-full pl-12 pt-1">
                                    <Autocompletar chico opciones={opcionesProv.filter((p) => p.valor !== o.proveedor_id)} placeholder="¿A qué proveedor?" onElegir={(v) => void asignar([it.id], v, `Cambiado de ${nombreProv(o.proveedores)}`)} />
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {deshacer.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
            <span className="text-zinc-500">Últimos cambios:</span>
            {deshacer.map((d) => (
              <button key={d.id} onClick={() => void hacerDeshacer(d)} disabled={ocupado === `undo-${d.id}`} className={`${btn} border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900`} title="Deshacer este cambio">
                <Undo2 className="h-3 w-3" /> {d.texto}
              </button>
            ))}
          </div>
        )}

        {/* FOTOS DEL REMITO DEL PROVEEDOR */}
        {(tab === "esperando" || tab === "oc") && faltaTablaRemitos && !cargando && (
          <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Falta correr la migración <b>oc_remitos</b>: la foto del remito se lee y carga lo recibido, pero no queda atada a la OC.</p>
        )}
        {(tab === "esperando" || tab === "oc") && fotos.length > 0 && <div className="space-y-2">{fotos.map(tarjetaFoto)}</div>}

        {cargarFactura && sociedadId && <CargarFacturaSimple sociedadId={sociedadId} onClose={() => setCargarFactura(false)} onGuardada={() => void cargar()} />}

        {/* OC: todas, con el formato de Presupuestos */}
        {tab === "oc" && <ComprasListaOC sociedadId={sociedadId} />}

        {/* ESPERANDO (sin pestaña: lo reemplaza "OC") */}
        {tab === "esperando" && !cargando && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
            {!esperandoVer.length && <p className="py-6 text-center text-sm text-zinc-500">{esperando.length ? "Ningún pedido esperando coincide con el filtro." : "No hay pedidos esperando."}</p>}
            {esperandoVer.map((o) => {
              const its = itemsDe[o.id] || [];
              const pend = its.filter((i) => Number(i.cantidad_recibida || 0) < Number(i.cantidad));
              const dias = diasDesde(o.pedido_at || o.created_at) ?? 0;
              const tarde = atrasada(o);
              return (
                <details key={o.id} className={`border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800 ${tarde ? "bg-amber-50/60 dark:bg-amber-950/10" : ""}`}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-mono text-xs font-semibold">{o.numero}</span>
                    <span className="font-medium">{nombreProv(o.proveedores)}</span>
                    <span className="text-xs text-zinc-500">{prCliente(o)}</span>
                    <span className={`text-xs ${tarde ? "font-medium text-amber-700" : "text-zinc-500"}`}>
                      {o.pedido_at ? `pedida ${hace(dias)}` : `armada ${hace(dias)}`}
                      {o.pedido_via ? ` por ${VIA[o.pedido_via] || o.pedido_via}` : ""}{o.pedido_por && nombres[o.pedido_por] ? ` (${nombres[o.pedido_por]})` : ""}
                    </span>
                    {o.estado === "recibida_parcial" && <span className="text-xs text-sky-600">llegó una parte</span>}
                    {(remitosOC[o.id] || []).map((r) => r.foto_url && (
                      <a key={r.id} href={r.foto_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 text-xs text-sky-600 hover:underline" title={`Remito del proveedor cargado el ${formatDate(r.created_at)}`}>
                        <Camera className="h-3 w-3" /> {r.numero_remito || "remito"}
                      </a>
                    ))}
                    <span className="ml-auto text-xs text-zinc-500">{pend.length} de {its.length} sin llegar · {formatCurrency(Number(o.total), mon(o.moneda))}</span>
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button onClick={() => setEnviarIds([o.id])} className={`${btn} border border-zinc-300 dark:border-zinc-600`}><Send className="h-3.5 w-3.5" /> Reenviar / reclamar</button>
                    <button onClick={() => elegirFoto(o.id)} className={`${btn} border border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300`} title="La IA lee qué llegó y lo carga en esta OC"><Camera className="h-3.5 w-3.5" /> Foto del remito</button>
                    {pend.length > 0 && <button onClick={() => abrirReclamo(o, o.id)} className={`${btn} border border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300`} title="Mensaje con solo lo que falta llegar, sin precios"><Send className="h-3.5 w-3.5" /> Reclamar lo que falta ({pend.length})</button>}
                    <button onClick={() => void deshacerPedido(o)} className={`${btn} border border-zinc-300 dark:border-zinc-600`} title="No se mandó: vuelve a Para pedir"><Undo2 className="h-3.5 w-3.5" /> Deshacer pedido</button>
                  </div>
                  {reclamo?.id === o.id && cajaReclamo(o, o.id)}
                  <ul className="mt-1 space-y-0.5">
                    {its.map((it) => (
                      <li key={it.id} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="w-16 text-right">{Number(it.cantidad_recibida || 0)}/{Number(it.cantidad)}</span>
                        <span className="min-w-0 flex-1 truncate">{it.codigo ? <span className="text-zinc-400">{it.codigo} · </span> : null}{it.descripcion}</span>
                        {Number(it.cantidad_recibida || 0) === 0 && (
                          <button onClick={() => void sinStock(o, it)} disabled={ocupado === it.id} className="flex items-center gap-0.5 text-zinc-400 hover:text-red-600" title="El proveedor avisó que no lo tiene"><PackageX className="h-3.5 w-3.5" /> sin stock</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}

        {/* PREGUNTAS */}
        {tab === "preguntas" && !cargando && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
            {!preguntasVer && <p className="py-6 text-center text-sm text-zinc-500">{preguntas.length ? "Ninguna pregunta coincide con la búsqueda." : "No hay preguntas. Todo tiene proveedor."}</p>}
            {ocsSinProveedorVer.map((oc) => {
              const its = itemsDe[oc.id] || [];
              // Proveedores sugeridos para varios renglones del pedido: un clic y va todo junto.
              const cuenta = new Map<string, number>();
              for (const it of its) for (const s of sugerenciasDe(oc, it)) cuenta.set(s.proveedor_id, (cuenta.get(s.proveedor_id) || 0) + 1);
              const comunes = [...cuenta.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2);
              const ids = its.map((i) => i.id);
              return (
                <div key={oc.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-700">
                  {its.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2 bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-800/50">
                      <span className="font-mono font-semibold">{oc.numero}</span>
                      <span className="text-zinc-500">{prCliente(oc) || "sin PR"} · {its.length} renglones · {formatCurrency(Number(oc.total), mon(oc.moneda))}</span>
                      <span className="ml-auto text-zinc-500">Todo a:</span>
                      {comunes.map(([pid, n]) => (
                        <button key={pid} onClick={() => void asignar(ids, pid, "Pedido entero")} disabled={ocupado === ids.join(",")} className={`${btn} border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300`} title={`Sugerido para ${n} de ${its.length} renglones`}>
                          {nombreProv(provPorId[pid])} <span className="font-normal text-zinc-400">({n}/{its.length})</span>
                        </button>
                      ))}
                      <div className="w-56"><Autocompletar chico opciones={opcionesProv} placeholder="Todo el pedido a…" onElegir={(v) => void asignar(ids, v, "Pedido entero")} /></div>
                    </div>
                  )}
                  {its.map((it) => {
                    const sug = sugerenciasDe(oc, it);
                    const sinStockEn = proveedoresSinStock(oc.observaciones);
                    return (
                      <div key={it.id} className="border-t border-zinc-100 px-3 py-2 first:border-0 dark:border-zinc-800">
                        <p className="text-sm">
                          <span className="font-medium">¿A quién le compro {Number(it.cantidad)} × {it.descripcion}?</span>
                          <span className="text-xs text-zinc-500"> {it.codigo ? `· ${it.codigo} ` : ""}· {formatCurrency(Number(it.precio_unitario), mon(oc.moneda))}{its.length === 1 ? ` · ${oc.numero}${prCliente(oc) ? ` · ${prCliente(oc)}` : ""}` : ""}</span>
                        </p>
                        {sinStockEn.length > 0 && <p className="text-xs text-red-600">Sin stock en: {sinStockEn.join(", ")}</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {sug.map((s) => (
                            <button key={s.proveedor_id} onClick={() => void asignar([it.id], s.proveedor_id)} disabled={ocupado === it.id} title={s.motivo}
                              className={`${btn} border ${s.puntos >= 80 ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-zinc-300 dark:border-zinc-600"}`}>
                              {nombreProv(provPorId[s.proveedor_id])} <span className="font-normal text-zinc-400">· {s.motivo}</span>
                            </button>
                          ))}
                          {!sug.length && <span className="text-xs text-zinc-400">Sin sugerencias: probá &quot;Buscar proveedor con IA&quot; o elegilo:</span>}
                          <div className="w-64"><Autocompletar chico opciones={opcionesProv} placeholder="Otro proveedor…" onElegir={(v) => void asignar([it.id], v)} /></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <input ref={inputFoto} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void leerRemitos(e.target.files); e.target.value = ""; }} />
      {enviarIds && <EnviarOCProveedor ocIds={enviarIds} titulo="Pedido al proveedor" onClose={() => { setEnviarIds(null); void cargar(); }} />}
    </div>
  );
}
