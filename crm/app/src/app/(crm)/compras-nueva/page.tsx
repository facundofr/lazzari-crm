"use client";

/**
 * Compras nueva (piloto automático, parte 1). Solo la ven los usuarios con la casilla "Prueba: Compras nueva".
 * Los vendedores venden: al aprobar un PR las OC se arman solas por proveedor y caen acá.
 * - Para pedir: un clic "Mail" o "WhatsApp" (y "Mandar todo por mail"). Sugerencia de juntar pedidos chicos en un proveedor.
 * - Esperando: lo que ya se pidió, con los días que pasaron.
 * - Preguntas: renglones sin proveedor, con proveedores sugeridos (lista de costos, compras anteriores e IA).
 * - "Decile a la IA": centralizar, sin stock, cambiar de proveedor → muestra el antes/después y se confirma.
 * Nunca toca el PR (ni su precio ni su total): solo mueve renglones entre OC sin mandar. Todo es sugerencia: nada frena.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import EnviarOCProveedor from "@/components/enviar-oc-proveedor";
import { useUser } from "@/lib/auth-context";
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
import { AlertTriangle, Check, Loader2, Mail, MessageCircle, MoreHorizontal, PackageX, RefreshCw, Send, Sparkles, Undo2 } from "lucide-react";

const db = supabase as any;

type Proveedor = { id: string; razon_social: string; nombre_fantasia: string | null; rubro: string | null; marcas: string | null };
type PR = { id: string; numero: string; cliente_id: string | null; moneda: string | null; tipo_cambio: number | null; tipo_cambio_divisas: number | null; descuento_general_porcentaje: number | null } | null;
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
type Movimiento = { item_ids: string[]; proveedor_id: string | null; motivo: string };

const SEL_OC = "id, numero, fecha, fecha_entrega_estimada, estado, moneda, subtotal, iva, total, observaciones, pedido, pedido_at, pedido_via, pedido_por, saldo_cerrado, proveedor_id, presupuesto_origen_id, created_at, "
  + "proveedores(razon_social, nombre_fantasia, cuit, email, telefono, direccion, localidad, provincia, forma_pago, condicion_iva), "
  + "presupuesto_origen:presupuesto_origen_id(id, numero, cliente_id, moneda, tipo_cambio, tipo_cambio_divisas, descuento_general_porcentaje)";

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
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [tab, setTab] = useState<"pedir" | "esperando" | "preguntas">("pedir");
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
  const [instruccion, setInstruccion] = useState("");
  const [pensando, setPensando] = useState(false);
  const [propuesta, setPropuesta] = useState<{ explicacion: string; movimientos: Movimiento[] } | null>(null);
  const [enviarIds, setEnviarIds] = useState<string[] | null>(null);
  // Reclamo de lo que falta (sin precios): OC abierta y texto editable.
  const [reclamo, setReclamo] = useState<{ id: string; texto: string } | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);

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

  const grupos = useMemo(() => {
    const g = new Map<string, OC[]>();
    for (const o of paraPedir) g.set(o.proveedor_id as string, [...(g.get(o.proveedor_id as string) || []), o]);
    return [...g.entries()].sort((a, b) => nombreProv(a[1][0].proveedores).localeCompare(nombreProv(b[1][0].proveedores)));
  }, [paraPedir]);

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

  async function mandarTodo() {
    const conMail = paraPedir.filter((o) => contactos[o.proveedor_id || ""]?.email);
    const sinMail = paraPedir.filter((o) => !contactos[o.proveedor_id || ""]?.email);
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

  async function preguntarIA() {
    const texto = instruccion.trim();
    if (!texto) return;
    const sinMandar = [...paraPedir, ...ocsSinProveedor];
    if (!sinMandar.length) { toast.info("No hay pedidos sin mandar para cambiar"); return; }
    setPensando(true);
    setPropuesta(null);
    try {
      const res = await fetch("/api/compras/instruccion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruccion: texto,
          pedidos: sinMandar.map((o) => ({
            numero: o.numero, proveedor_id: o.proveedor_id, proveedor: o.proveedor_id ? nombreProv(o.proveedores) : null,
            pr_numero: o.presupuesto_origen?.numero, cliente: clientes[o.presupuesto_origen?.cliente_id || ""], total: o.total, moneda: o.moneda,
            items: (itemsDe[o.id] || []).map((it) => ({ id: it.id, codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad })),
          })),
          proveedores: proveedores.map((p) => ({ id: p.id, nombre: nombreProv(p) + (p.nombre_fantasia && p.nombre_fantasia !== p.razon_social ? ` (${p.razon_social})` : "") })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "La IA no respondió");
      setPropuesta({ explicacion: data.explicacion || "", movimientos: data.movimientos || [] });
    } catch (e: any) {
      toast.error(e?.message || "La IA no respondió");
    } finally {
      setPensando(false);
    }
  }

  async function aplicarPropuesta() {
    if (!propuesta) return;
    setOcupado("ia");
    let ok = 0;
    const creadas = new Map<string, string>();
    for (const m of propuesta.movimientos) if (await moverRenglones(m.item_ids, m.proveedor_id, m.motivo ? `IA: ${m.motivo}` : "Pedido a la IA", creadas)) ok++;
    setOcupado(null);
    setPropuesta(null);
    setInstruccion("");
    toast.success(`Listo: ${ok} de ${propuesta.movimientos.length} cambio(s) hechos`);
    await cargar();
  }

  // ── Pantalla ───────────────────────────────────────────────────
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40";
  const itemPorId = (id: string) => items.find((i) => i.id === id);
  const ocDeItem = (id: string) => { const it = itemPorId(id); return it ? ocs.find((o) => o.id === it.orden_id) : undefined; };
  const prCliente = (o: OC) => [o.presupuesto_origen?.numero, clientes[o.presupuesto_origen?.cliente_id || ""]].filter(Boolean).join(" · ");

  return (
    <div>
      <Header title="Compras nueva" subtitle="Los pedidos se arman solos al aprobar un PR. Vos los mandás con un clic." />
      <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
        {/* Decile a la IA */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/20">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void preguntarIA(); }}>
            <Sparkles className="mt-1.5 h-4 w-4 shrink-0 text-violet-500" />
            <input value={instruccion} onChange={(e) => setInstruccion(e.target.value)} placeholder='Decile a la IA: "centralizá lo del PR-1234 en Funcional", "Mediglove no tiene guantes, pedíselos a Bioseif"…'
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
            <button type="submit" disabled={pensando || !instruccion.trim()} className={`${btn} bg-violet-600 text-white hover:bg-violet-700`}>
              {pensando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Ver qué haría
            </button>
          </form>
          {propuesta && (
            <div className="mt-2 rounded border border-violet-200 bg-white p-2 text-sm dark:border-violet-900 dark:bg-zinc-900">
              {propuesta.explicacion && <p className="mb-1 text-zinc-700 dark:text-zinc-300">{propuesta.explicacion}</p>}
              {propuesta.movimientos.length ? (
                <ul className="mb-2 space-y-0.5 text-xs">
                  {propuesta.movimientos.map((m, i) => (
                    <li key={i}>
                      {(() => { const ds = m.item_ids.map((id) => itemPorId(id)?.descripcion).filter(Boolean); return `${ds.length > 1 ? `${ds.length} renglones: ` : ""}${ds.slice(0, 3).join(", ")}${ds.length > 3 ? "…" : ""}`; })()}
                      <span className="text-zinc-400"> · de {[...new Set(m.item_ids.map((id) => { const o = ocDeItem(id); return o?.proveedor_id ? nombreProv(o.proveedores) : "sin proveedor"; }))].join(", ")} → </span>
                      <b>{m.proveedor_id ? nombreProv(provPorId[m.proveedor_id]) : "sin proveedor (Preguntas)"}</b>
                      {m.motivo && <span className="text-zinc-400"> ({m.motivo})</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mb-2 text-xs text-zinc-500">No hay cambios para hacer.</p>}
              <div className="flex gap-2">
                {!!propuesta.movimientos.length && <button onClick={() => void aplicarPropuesta()} disabled={ocupado === "ia"} className={`${btn} bg-violet-600 text-white`}>{ocupado === "ia" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Hacerlo</button>}
                <button onClick={() => setPropuesta(null)} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Descartar</button>
              </div>
            </div>
          )}
        </div>

        {/* Pestañas */}
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
          {([["pedir", "Para pedir", paraPedir.length], ["esperando", "Esperando", esperando.length], ["preguntas", "Preguntas", preguntas.length]] as const).map(([k, t, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              {t} <span className={`ml-1 rounded-full px-1.5 text-xs ${k === "preguntas" && n ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>{n}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            {tab === "pedir" && paraPedir.length > 0 && (
              <button onClick={() => void mandarTodo()} disabled={ocupado === "todo"} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`}>
                {ocupado === "todo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />} Mandar todo por mail
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

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
        {cargando && !ocs.length && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo las compras…</p>}

        {/* PARA PEDIR */}
        {tab === "pedir" && !cargando && (
          <div className="space-y-2">
            {centralizar.map((s) => (
              <div key={`${s.pr_id}|${s.moneda}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="min-w-0 flex-1">{s.pr_numero || "PR"}: {s.proveedores_a_mover.join(", ")} es poco ({formatCurrency(s.monto_a_mover, s.moneda)}). ¿Lo pedís todo a <b>{s.destino_nombre}</b> y te ahorrás un envío?</span>
                <button onClick={() => void aplicarCentralizar(s)} className={`${btn} bg-sky-600 text-white`}>Juntar en {s.destino_nombre}</button>
              </div>
            ))}
            {!grupos.length && <p className="py-6 text-center text-sm text-zinc-500">No hay nada para pedir. 🎉</p>}
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

        {/* ESPERANDO */}
        {tab === "esperando" && !cargando && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
            {!esperando.length && <p className="py-6 text-center text-sm text-zinc-500">No hay pedidos esperando.</p>}
            {esperando.map((o) => {
              const its = itemsDe[o.id] || [];
              const pend = its.filter((i) => Number(i.cantidad_recibida || 0) < Number(i.cantidad));
              const dias = diasDesde(o.pedido_at || o.created_at) ?? 0;
              const tarde = dias >= DIAS_AVISO_ESPERANDO;
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
                    <span className="ml-auto text-xs text-zinc-500">{pend.length} de {its.length} sin llegar · {formatCurrency(Number(o.total), mon(o.moneda))}</span>
                  </summary>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button onClick={() => setEnviarIds([o.id])} className={`${btn} border border-zinc-300 dark:border-zinc-600`}><Send className="h-3.5 w-3.5" /> Reenviar / reclamar</button>
                    {pend.length > 0 && <button onClick={() => setReclamo(reclamo?.id === o.id ? null : { id: o.id, texto: textoReclamoOC(o, pend.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion, falta: Number(i.cantidad) - Number(i.cantidad_recibida || 0), unidad: i.unidad })), pend.length < its.length) })} className={`${btn} border border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300`} title="Mensaje con solo lo que falta llegar, sin precios"><Send className="h-3.5 w-3.5" /> Reclamar lo que falta ({pend.length})</button>}
                    <button onClick={() => void deshacerPedido(o)} className={`${btn} border border-zinc-300 dark:border-zinc-600`} title="No se mandó: vuelve a Para pedir"><Undo2 className="h-3.5 w-3.5" /> Deshacer pedido</button>
                  </div>
                  {reclamo?.id === o.id && (
                    <div className="mt-2 space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/50 p-2 dark:border-sky-900 dark:bg-sky-950/20">
                      <textarea value={reclamo.texto} onChange={(e) => setReclamo({ id: o.id, texto: e.target.value })} rows={Math.min(14, 8 + pend.length * 2)} className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900" />
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => { const link = linkWhatsAppOC(contactos[o.proveedor_id || ""]?.whatsapp, reclamo.texto); if (!link) { toast.error("Este proveedor no tiene WhatsApp cargado: copiá el texto"); return; } window.open(link, "_blank"); }} className={`${btn} bg-emerald-600 text-white`}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
                        <button onClick={() => { const para = contactos[o.proveedor_id || ""]?.email || ""; window.open(`mailto:${para}?subject=${encodeURIComponent(`Seguimiento ${o.numero}`)}&body=${encodeURIComponent(reclamo.texto.replace(/\*/g, ""))}`, "_self"); }} className={`${btn} bg-sky-600 text-white`}><Mail className="h-3.5 w-3.5" /> Mail (se abre tu correo)</button>
                        <button onClick={async () => { try { await navigator.clipboard.writeText(reclamo.texto); toast.success("Copiado, sin precios"); } catch { toast.error("No se pudo copiar"); } }} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Copiar</button>
                        <span className="text-[10px] text-zinc-400">Solo lo que falta, sin precios.</span>
                      </div>
                    </div>
                  )}
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
            {!preguntas.length && <p className="py-6 text-center text-sm text-zinc-500">No hay preguntas. Todo tiene proveedor.</p>}
            {ocsSinProveedor.map((oc) => {
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

      {enviarIds && <EnviarOCProveedor ocIds={enviarIds} titulo="Pedido al proveedor" onClose={() => { setEnviarIds(null); void cargar(); }} />}
    </div>
  );
}
