"use client";

/**
 * Compras Lazza › Cargar factura (Augusto 16/10): MUY simple y permisivo. Es para que los chicos carguen las facturas
 * y saber más o menos cuánto se gastó por PR.
 * 1. Subís el PDF: lo lee el SISTEMA (QR de ARCA o texto, sin IA). Si no puede, "Leer con IA".
 * 2. Proveedor por CUIT. Se eligen una o más OC (con su detalle). También: OC sin proveedor y OC de otros proveedores
 *    (pregunta "¿seguro?" y si pasa toda la OC o solo algunos artículos a este proveedor).
 * 3. Augusto 18/10: "solo que le carguen la factura a la OC y listo": NO se compara con la OC, no se suman envío ni
 *    diferencias y no se toca ningún precio (ni OC ni PR). La OC queda facturada (o en parte).
 * 4. Pago como siempre (Pagos o Visa), email y CBU/alias del proveedor si faltan, y "Nota para Finanzas".
 * 5. Nota de crédito: sin OC y sin forma de pago; va a la cuenta corriente del proveedor como crédito
 *    (registrar_nota_credito_compra_v2, la misma de Finanzas). La nota de débito no se carga acá.
 * Guardar usa guardar_conciliacion_compra (la de siempre), sin aceptar costos ni aprender equivalencias.
 */
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { ProveedorFormModal } from "@/components/proveedor-form-modal";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { facturaDesdeDatos, lineKey, type FacturaCarga } from "@/lib/factura-compra-leida";
import { leerFacturaLocal } from "@/lib/leer-factura-local";
import { asignarRenglonesAProveedor } from "@/lib/oc-sin-proveedor";
import { traerTarjetas, tarjetaSugerida, registrarPagoTarjeta, movimientoPagoTarjeta } from "@/lib/pago-tarjeta";
import { citaOc } from "@/lib/purchase-matching";
import { cant } from "@/lib/cargar-factura";
import { aFacturarPorRenglon, ivaYPercepciones, netoFactura, tipoNotaCredito, vencimientoPorDias, type LineaOc } from "@/lib/compras-lazza";
import { coincideTodas, normalizarTexto, palabrasBusqueda } from "@/lib/buscar-texto";
import { AlertTriangle, Check, CreditCard, FileUp, Loader2, Search, Sparkles, UserPlus, X } from "lucide-react";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** "1.234,56", "1234,56" o "1234.56" → 1234.56 */
const num = (v: string) => { const t = String(v || "").replace(/[^\d.,-]/g, ""); return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0; };
const aTexto = (n: number) => String(round2(n)).replace(".", ",");
const SOCIEDAD_POR_CUIT: Record<string, { id: string; nombre: string }> = {
  "20379309128": { id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021", nombre: "Lazzari" },
  "30719396042": { id: "fee94607-747a-4e87-ba24-aff9032f7a56", nombre: "Grupo LA" },
};
const esMercadoLibre = (t: string | null | undefined) => /mercado\s*libre/i.test(String(t || ""));

type Proveedor = { id: string; razon_social: string; cuit: string | null; talles_especiales?: string[] | null; medio_pago_preferido?: string | null; plazo_cheque_dias?: number | null; dias_pago?: number | null; email?: string | null; cbu?: string | null; alias_bancario?: string | null };
type FormaPago = "transferencia" | "echeq";
const DIAS_RAPIDOS = [0, 15, 30, 45, 60];
type Fuente = "prov" | "sin" | "otros";
type Linea = { id: string; codigo: string | null; descripcion: string; cantidad: number; recibida: number; pendiente: number; precio: number; iva: number };
type Oc = {
  id: string; numero: string; fecha: string; moneda: string; proveedorId: string | null; provNombre: string; pr: string; cliente: string;
  medioPago: string; esML: boolean; fuente: Fuente; lineas: Linea[]; texto: string;
};
/** propia = OC de este proveedor. toda = la OC entera pasa a este proveedor. articulos = solo esos renglones. */
type Eleccion = { modo: "propia" | "toda" | "articulos"; itemIds: Set<string> };

const chip = "rounded-md border px-2 py-1 text-xs";
const btnSi = "rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700";
const btnNo = "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
const elegido = "ring-2 ring-violet-400";

/** OC abiertas con algo pendiente de facturar, con su detalle (cuánto pidió, cuánto llegó y precio). */
async function traerOcs(sociedadId: string, fuente: Fuente, proveedorId: string, soloId?: string): Promise<Oc[]> {
  // soloId: una OC puntual (el "+" de la lista), aunque ya esté facturada entera: una OC puede tener varias facturas.
  if (soloId) {
    const { data, error } = await db.from("ordenes_compra").select("id, numero, fecha, moneda, proveedor_id, medio_pago, observaciones, proveedores(razon_social, nombre_fantasia), presupuesto_origen:presupuesto_origen_id(numero, clientes(razon_social))").eq("id", soloId).eq("sociedad_id", sociedadId);
    if (error) throw error;
    return armarOcs((data || []) as any[], fuente, false);
  }
  let q = db.from("ordenes_compra").select("id, numero, fecha, moneda, proveedor_id, medio_pago, observaciones, proveedores(razon_social, nombre_fantasia), presupuesto_origen:presupuesto_origen_id(numero, clientes(razon_social))")
    .eq("sociedad_id", sociedadId).neq("estado", "cancelada").not("saldo_cerrado", "is", true).or("estado_facturacion.is.null,estado_facturacion.neq.facturada");
  q = fuente === "prov" ? q.eq("proveedor_id", proveedorId) : fuente === "sin" ? q.is("proveedor_id", null) : q.neq("proveedor_id", proveedorId);
  const { data: ocs, error } = await q.order("fecha", { ascending: false }).limit(fuente === "otros" ? 400 : 1000);
  if (error) throw error;
  return armarOcs(((ocs || []) as any[]).filter(o => !(!o.proveedor_id && /stock propio/i.test(o.observaciones || ""))), fuente, true);
}

/** OC con sus renglones (pedido, llegado, pendiente de facturar y precio). soloPendientes: sin las que no tienen nada por facturar. */
async function armarOcs(lista: any[], fuente: Fuente, soloPendientes: boolean): Promise<Oc[]> {
  const ids = lista.map(o => o.id);
  const pend: any[] = [], rec: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const t = ids.slice(i, i + 100);
    const [a, b] = await Promise.all([
      db.from("orden_compra_items_pendientes").select("id, orden_id, codigo, descripcion, cantidad, precio_unitario, iva_porcentaje, cantidad_pendiente, orden").in("orden_id", t).order("orden"),
      db.from("orden_compra_items").select("id, cantidad_recibida").in("orden_id", t),
    ]);
    if (a.error) throw a.error;
    pend.push(...(a.data || [])); rec.push(...(b.data || []));
  }
  const recibida = new Map(rec.map((r: any) => [r.id, Number(r.cantidad_recibida) || 0]));
  const porOc = new Map<string, Linea[]>();
  for (const l of pend) (porOc.get(l.orden_id) || porOc.set(l.orden_id, []).get(l.orden_id)!).push({
    id: l.id, codigo: l.codigo, descripcion: l.descripcion, cantidad: Number(l.cantidad) || 0, recibida: recibida.get(l.id) || 0,
    pendiente: Math.max(0, round2(Number(l.cantidad_pendiente) || 0)), precio: Number(l.precio_unitario) || 0, iva: Number(l.iva_porcentaje ?? 21),
  });
  return lista.map(o => {
    const provNombre = o.proveedores?.nombre_fantasia || o.proveedores?.razon_social || "";
    const lineas = porOc.get(o.id) || [];
    return {
      id: o.id, numero: o.numero, fecha: o.fecha || "", moneda: o.moneda || "ARS", proveedorId: o.proveedor_id, provNombre,
      pr: o.presupuesto_origen?.numero || "", cliente: o.presupuesto_origen?.clientes?.razon_social || "", medioPago: o.medio_pago || "",
      esML: esMercadoLibre(provNombre) || esMercadoLibre(o.proveedores?.razon_social) || esMercadoLibre(o.observaciones), fuente, lineas,
      texto: normalizarTexto([o.numero, o.presupuesto_origen?.numero, o.presupuesto_origen?.clientes?.razon_social, provNombre, ...lineas.map(l => `${l.codigo || ""} ${l.descripcion}`)].join(" ")),
    };
  }).filter(o => !soloPendientes || o.lineas.some(l => l.pendiente > 0));
}

export default function ComprasLazzaFactura({ sociedadId, ocInicial, onClose }: {
  sociedadId: string;
  /** "+" en la columna Factura de la lista: la factura es de esta OC (viene elegida). */
  ocInicial?: { id: string; numero: string } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { profile } = useUser();
  const [leyendo, setLeyendo] = useState(false);
  const [leyendoIA, setLeyendoIA] = useState(false);
  const [error, setError] = useState("");
  const [factura, setFactura] = useState<FacturaCarga | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [origen, setOrigen] = useState<"sistema" | "ia" | "">("");
  const [noSeLeyo, setNoSeLeyo] = useState(false);
  // Nota de débito: no se carga acá. Nota de crédito: sí (factura.tipo "NC …").
  const [esNota, setEsNota] = useState(false);
  const ncKey = useRef<string | null>(null);
  const [otraSociedad, setOtraSociedad] = useState("");
  const [duplicada, setDuplicada] = useState(false);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [crearProv, setCrearProv] = useState(false);
  const [ocs, setOcs] = useState<Oc[]>([]);
  const [cargadas, setCargadas] = useState<Set<Fuente>>(new Set());
  const [cargandoOcs, setCargandoOcs] = useState<Fuente | null>(null);
  const [ver, setVer] = useState<Fuente>("prov");
  const [busca, setBusca] = useState("");
  const [elegidas, setElegidas] = useState<Map<string, Eleccion>>(new Map());
  const [preguntar, setPreguntar] = useState<{ oc: Oc; articulos: Set<string> | null } | null>(null);
  const [netoTxt, setNetoTxt] = useState("");
  const [conVisa, setConVisa] = useState<boolean | null>(null);
  // Para Pagos: transferencia o eCheq y a cuántos días (null = lo que sugiere el proveedor).
  const [forma, setForma] = useState<FormaPago | null>(null);
  const [diasTxt, setDiasTxt] = useState<string | null>(null);
  // Nota para Finanzas (opcional): queda en las notas de la factura.
  const [notaPago, setNotaPago] = useState("");
  // Recordatorio: si al proveedor le falta el email o los datos bancarios, se completan acá y se guardan en el proveedor.
  const [emailProv, setEmailProv] = useState("");
  const [bancoProv, setBancoProv] = useState("");
  const [guardandoProv, setGuardandoProv] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const plata = (n: number) => formatCurrency(n, factura?.moneda || "ARS");

  // ── 1. Leer (sistema primero; IA opcional) ──
  function reiniciar() {
    ncKey.current = null;
    setError(""); setFactura(null); setProveedor(null); setOcs([]); setCargadas(new Set()); setElegidas(new Map()); setVer("prov"); setBusca("");
    setConVisa(null); setForma(null); setDiasTxt(null); setNotaPago(""); setDuplicada(false); setEsNota(false); setOtraSociedad(""); setNoSeLeyo(false); setOrigen("");
  }

  async function leer(file: File) {
    reiniciar(); setArchivo(file); setLeyendo(true);
    try {
      const local = await leerFacturaLocal(file).catch(() => null);
      if (!local) { setNoSeLeyo(true); return; }
      await usarDatos(file, local.data, "sistema");
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo");
    } finally { setLeyendo(false); }
  }

  async function leerConIA() {
    if (!archivo) return;
    setLeyendoIA(true); setError("");
    try {
      const body = new FormData(); body.append("file", archivo);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "La IA no pudo leer el archivo");
      setNoSeLeyo(false);
      await usarDatos(archivo, json.data || {}, "ia");
    } catch (e: any) {
      setError(e?.message || "La IA no pudo leer el archivo");
    } finally { setLeyendoIA(false); }
  }

  async function usarDatos(file: File, d: any, como: "sistema" | "ia") {
    const leida = facturaDesdeDatos(file, d);
    const nc = tipoNotaCredito(d.tipo_comprobante);
    const f = nc ? { ...leida, tipo: nc } : leida;
    setFactura(f); setOrigen(como);
    setEsNota(!nc && /D[EÉ]BITO|^N\.?\s?D\b/i.test(String(d.tipo_comprobante || "")));
    const soc = SOCIEDAD_POR_CUIT[digitos(d.cuit_receptor)];
    setOtraSociedad(soc && soc.id !== sociedadId ? soc.nombre : "");
    setNetoTxt(aTexto(netoFactura(f).neto));
    if (proveedor && digitos(proveedor.cuit) === f.cuit) return; // releída con IA: mismo proveedor, mismas OC
    if (f.cuit.length === 11) {
      const { data: ps } = await db.from("proveedores").select("id, razon_social, cuit, talles_especiales, medio_pago_preferido, plazo_cheque_dias, dias_pago, email, cbu, alias_bancario").eq("sociedad_id", sociedadId).eq("activo", true);
      const p = ((ps || []) as Proveedor[]).find(x => digitos(x.cuit) === f.cuit);
      if (p) await elegirProveedor(p, f);
    }
  }

  // ── 2. Proveedor → sus OC ──
  async function elegirProveedor(p: Proveedor, f: FacturaCarga) {
    const { data: dups } = await db.from("facturas_compra").select("numero_factura, tipo_comprobante").eq("sociedad_id", sociedadId).eq("proveedor_id", p.id).neq("estado", "anulada");
    const norm = (n: string) => { const m = String(n || "").replace(/\s+/g, "").match(/^(\d{1,5})[-/](\d{1,8})$/); return m ? `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}` : String(n || "").replace(/\s+/g, "").toUpperCase(); };
    setDuplicada(!!f.numero && (dups || []).some((x: any) => norm(x.numero_factura) === norm(f.numero) && String(x.tipo_comprobante || "FC A").toUpperCase() === f.tipo.toUpperCase()));
    setProveedor(p); // después del chequeo de duplicada: el aviso sale junto con el proveedor
    if (f.tipo.startsWith("NC")) return; // nota de crédito: sin OC
    const propias = await cargarFuente("prov", p.id, true);
    const citadas = propias.filter(o => (f.ocRefs || []).some(r => citaOc(r, o.numero)));
    // Desde el "+" de una OC: esa OC viene elegida. Si es de otro proveedor o sin proveedor, pregunta "¿seguro?".
    if (ocInicial) {
      let propia = propias.find(o => o.id === ocInicial.id);
      if (!propia) {
        const { data: ocP } = await db.from("ordenes_compra").select("proveedor_id").eq("id", ocInicial.id).single();
        if (ocP?.proveedor_id === p.id) {
          // Del mismo proveedor pero ya facturada entera: se trae igual (factura extra, ej. un flete).
          propia = (await traerOcs(sociedadId, "prov", p.id, ocInicial.id).catch(() => []))[0];
          if (propia) { const o = propia; setOcs(prev => [...prev.filter(x => x.id !== o.id), o]); }
        }
      }
      if (propia) { setElegidas(new Map([[propia.id, { modo: "propia", itemIds: new Set() }]])); return; }
      setElegidas(new Map());
      const { data: oc } = await db.from("ordenes_compra").select("proveedor_id").eq("id", ocInicial.id).single();
      const fuente: Fuente = oc?.proveedor_id ? "otros" : "sin";
      setVer(fuente);
      let otra = (await cargarFuente(fuente, p.id, true)).find(o => o.id === ocInicial.id);
      if (!otra) {
        // Ya facturada entera (o fuera de la lista): se trae sola. Una OC puede tener más de una factura.
        otra = (await traerOcs(sociedadId, fuente, p.id, ocInicial.id).catch(() => []))[0];
        if (otra) { const o = otra; setOcs(prev => [...prev.filter(x => x.id !== o.id), o]); }
      }
      if (otra) setPreguntar({ oc: otra, articulos: null });
      else toast.warning(`No se encontró la ${ocInicial.numero}: elegí la OC de la lista.`);
      return;
    }
    const inicial = citadas.length ? citadas : propias.length === 1 ? propias : [];
    setElegidas(new Map(inicial.map(o => [o.id, { modo: "propia", itemIds: new Set() }])));
    if (!propias.length) { setVer("sin"); void cargarFuente("sin", p.id, true); }
  }

  /** forzar: proveedor nuevo (el estado de la factura anterior todavía no se limpió en este render). */
  async function cargarFuente(fuente: Fuente, provId = proveedor?.id || "", forzar = false): Promise<Oc[]> {
    if (!provId) return [];
    if (!forzar && cargadas.has(fuente)) return ocs.filter(o => o.fuente === fuente);
    setCargandoOcs(fuente);
    try {
      const nuevas = await traerOcs(sociedadId, fuente, provId);
      setOcs(prev => [...(forzar && fuente === "prov" ? [] : prev.filter(o => o.fuente !== fuente)), ...nuevas]);
      setCargadas(prev => forzar && fuente === "prov" ? new Set([fuente]) : new Set(prev).add(fuente));
      return nuevas;
    } catch (e: any) {
      toast.error(e?.message || "No se pudieron traer las OC");
      return [];
    } finally { setCargandoOcs(null); }
  }

  function verFuente(f: Fuente) { setVer(f); setBusca(""); void cargarFuente(f); }

  function tildar(o: Oc) {
    if (elegidas.has(o.id)) { setElegidas(p => { const n = new Map(p); n.delete(o.id); return n; }); return; }
    if (o.fuente === "prov") { setElegidas(p => new Map(p).set(o.id, { modo: "propia", itemIds: new Set() })); return; }
    setPreguntar({ oc: o, articulos: null });
  }

  // ── 3. Cálculos ──
  const palabras = useMemo(() => palabrasBusqueda(busca), [busca]);
  const ocsVer = useMemo(() => ocs.filter(o => o.fuente === ver && (!palabras.length || coincideTodas(o.texto, palabras))), [ocs, ver, palabras]);
  const ocsElegidas = useMemo(() => ocs.filter(o => elegidas.has(o.id)), [ocs, elegidas]);
  /** Renglones que entran en esta factura (en "solo algunos artículos", solo esos). */
  // Factura parcial: si en la OC llegó algo sin facturar, entra solo eso (el resto queda abierto para la próxima factura).
  // En "solo algunos artículos" entran los que se tildaron, enteros.
  const lineas = useMemo<LineaOc[]>(() => ocsElegidas.flatMap(o => {
    const e = elegidas.get(o.id)!;
    const cant = e.modo === "articulos" ? new Map(o.lineas.map(l => [l.id, l.pendiente])) : aFacturarPorRenglon(o.lineas).cantidades;
    return o.lineas.filter(l => (cant.get(l.id) || 0) > 0 && (e.modo !== "articulos" || e.itemIds.has(l.id)))
      .map(l => ({ id: l.id, ocId: o.id, codigo: l.codigo, descripcion: l.descripcion, pendiente: cant.get(l.id) || 0, precio: l.precio, moneda: o.moneda }));
  }), [ocsElegidas, elegidas]);
  const visaSugerida = esMercadoLibre(proveedor?.razon_social) || ocsElegidas.some(o => o.medioPago === "tarjeta" || o.esML);
  const pagaVisa = conVisa ?? visaSugerida;
  const formaPago: FormaPago = forma ?? (/cheq/i.test(proveedor?.medio_pago_preferido || "") ? "echeq" : "transferencia");
  const diasSugeridos = formaPago === "echeq" ? (proveedor?.plazo_cheque_dias ?? proveedor?.dias_pago) : proveedor?.dias_pago;
  const dias = diasTxt ?? (diasSugeridos != null ? String(diasSugeridos) : "");
  const vencePago = factura ? vencimientoPorDias(factura.fecha, dias, factura.vencimiento) : null;
  // IVA y percepciones (leída por QR el IVA viene en 0: IVA = neto × alícuota y lo que sobra son percepciones, ej. IIBB).
  const impuestos = factura ? ivaYPercepciones({ total: factura.total, neto: num(netoTxt), iva: factura.iva, percepciones: factura.percepciones, ivaPorcentaje: factura.ivaPorcentaje }) : { iva: 0, percepciones: 0, percepcionEstimada: false };
  const ivaFactura = impuestos.iva;
  const percepcionesFactura = impuestos.percepciones;
  const faltaEmail = !!proveedor && !String(proveedor.email || "").trim();
  const faltaBanco = !!proveedor && !String(proveedor.cbu || "").trim() && !String(proveedor.alias_bancario || "").trim();

  async function guardarDatosProveedor() {
    if (!proveedor) return;
    const cambios: Record<string, string> = {};
    if (faltaEmail && emailProv.trim()) cambios.email = emailProv.trim();
    const b = bancoProv.trim();
    // 22 números = CBU/CVU; si no, es el alias.
    if (faltaBanco && b) { if (/^\d{22}$/.test(b.replace(/\s+/g, ""))) cambios.cbu = b.replace(/\s+/g, ""); else cambios.alias_bancario = b; }
    if (!Object.keys(cambios).length) return;
    setGuardandoProv(true);
    try {
      const { error: e } = await db.from("proveedores").update(cambios).eq("id", proveedor.id).eq("sociedad_id", sociedadId);
      if (e) throw e;
      setProveedor({ ...proveedor, ...cambios });
      setEmailProv(""); setBancoProv("");
      toast.success(`Guardado en ${proveedor.razon_social}`);
    } catch (e: any) {
      toast.error(`No se pudo guardar en el proveedor (${e?.message || "error"})`);
    } finally { setGuardandoProv(false); }
  }
  const textoPago = `Pago: ${formaPago === "echeq" ? "eCheq" : "transferencia"}${dias.trim() ? ` a ${Math.round(num(dias))} días` : ""}`;
  const listo = !!factura && !!proveedor && !esNota;
  const esNC = !!factura && factura.tipo.startsWith("NC");
  const cuantas = (f: Fuente) => ocs.filter(o => o.fuente === f).length;

  // ── 4. Guardar ──
  /** PDF de la factura / NC al Storage (si falla, el comprobante ya quedó: no se avisa). */
  async function subirArchivo(facturaId: string) {
    if (!archivo) return;
    const path = `${sociedadId}/${facturaId}/factura.${archivo.name.split(".").pop() || "pdf"}`;
    const { error: upErr } = await supabase.storage.from("facturas-compra").upload(path, archivo, { upsert: true });
    if (upErr) return;
    const { data: u } = supabase.storage.from("facturas-compra").getPublicUrl(path);
    if (u?.publicUrl) await db.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: archivo.name }).eq("id", facturaId);
  }

  // Nota de crédito: sin OC ni pago; queda como crédito en la cuenta corriente del proveedor (se usa al pagarle).
  async function guardarNC() {
    if (!factura || !proveedor) return;
    const numero = factura.numero.trim();
    setGuardando(true); setError("");
    try {
      if (!ncKey.current) ncKey.current = crypto.randomUUID();
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const items = factura.items.length ? factura.items.map(it => ({ codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, descuento_porcentaje: it.descuento_porcentaje, unidad: it.unidad, iva_porcentaje: it.iva_porcentaje }))
        : [{ codigo: null, descripcion: "Nota de crédito (sin detalle de artículos)", cantidad: 1, precio_unitario: num(netoTxt), descuento_porcentaje: 0, unidad: "UN", iva_porcentaje: iva }];
      const notas = [notaPago.trim() ? `Nota para Finanzas: ${notaPago.trim()}` : "", "Cargada con «Compras Lazza» (sin OC)"].filter(Boolean).join("\n");
      const { data, error: e } = await db.rpc("registrar_nota_credito_compra_v2", {
        p_sociedad_id: sociedadId, p_request_key: ncKey.current,
        p_factura: {
          numero_factura: numero, tipo_comprobante: factura.tipo, proveedor_id: proveedor.id, fecha: factura.fecha || todayAR(),
          subtotal: num(netoTxt), iva_porcentaje: factura.ivaPorcentaje, iva: ivaFactura, percepciones: percepcionesFactura, total: factura.total,
          moneda: factura.moneda, tipo: "mercaderia", notas, cae: factura.cae || null,
        },
        p_items: items, p_aplicaciones: [],
      });
      if (e) throw new Error(e.message);
      if (!data?.factura_compra_id) throw new Error("La base no confirmó la nota de crédito. No se guardó nada.");
      await subirArchivo(data.factura_compra_id);
      toast.success(`✔ ${factura.tipo} ${numero} cargada · queda como crédito de ${proveedor.razon_social}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(`No se pudo guardar la nota de crédito: ${e?.message || "error"}`);
    } finally { setGuardando(false); }
  }

  async function guardar() {
    if (!factura || !proveedor) return;
    if (!factura.numero.trim()) { setError("Falta el número de la factura."); return; }
    if (esNC) return guardarNC();
    setGuardando(true); setError("");
    const numero = factura.numero.trim();
    const insertados: string[] = [];
    const vueltaProveedor: Array<{ ocId: string; proveedorId: string | null; observaciones: string | null }> = [];
    const vueltaRenglones: Array<{ itemId: string; ordenId: string }> = [];
    const canceladas: string[] = [];
    try {
      // a) OC sin proveedor o de otro proveedor → pasan a este proveedor (toda la OC o solo esos artículos).
      const ocFinal = new Map<string, string>();
      for (const o of ocsElegidas) {
        const e = elegidas.get(o.id)!;
        ocFinal.set(o.id, o.id);
        if (e.modo === "toda") {
          const { data: antes } = await db.from("ordenes_compra").select("proveedor_id, observaciones").eq("id", o.id).single();
          const { error: eP } = await db.from("ordenes_compra").update({
            proveedor_id: proveedor.id, observaciones: `${antes?.observaciones || ""}\nProveedor real ${proveedor.razon_social} (FC ${numero}${o.provNombre ? `; antes ${o.provNombre}` : ""})`.trim(),
          }).eq("id", o.id).eq("sociedad_id", sociedadId);
          if (eP) throw new Error(`No se pudo pasar la ${o.numero} a ${proveedor.razon_social}: ${eP.message}`);
          vueltaProveedor.push({ ocId: o.id, proveedorId: antes?.proveedor_id ?? o.proveedorId, observaciones: antes?.observaciones ?? null });
        } else if (e.modo === "articulos") {
          const ids = [...e.itemIds];
          const r = await asignarRenglonesAProveedor(db, { sociedadId, userId: profile?.id, itemIds: ids, proveedorId: proveedor.id, proveedorNombre: proveedor.razon_social, nota: `FC ${numero}`, conRecibido: true });
          for (const id of ids) vueltaRenglones.push({ itemId: id, ordenId: o.id });
          const { data: quedo } = await db.from("ordenes_compra").select("estado").eq("id", o.id).single();
          if (quedo?.estado === "cancelada") canceladas.push(o.id);
          if (r.ocDestino[0]) ocFinal.set(o.id, r.ocDestino[0]);
        }
      }

      // b) OC elegida sin nada pendiente (ej. ya facturada entera): un renglón en $0 para que la factura quede atada
      //    a esa OC (una OC puede tener varias facturas). No se suman envío ni diferencias (Augusto 18/10).
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const nuevoRenglon = async (ocId: string, descripcion: string) => {
        const { data: orden } = await db.from("orden_compra_items").select("orden").eq("orden_id", ocId).order("orden", { ascending: false }).limit(1);
        const { data, error: e } = await db.from("orden_compra_items").insert({
          orden_id: ocId, codigo: "", descripcion, cantidad: 1, cantidad_recibida: 1, unidad: "UN", precio_unitario: 0, iva_porcentaje: iva,
          orden: (Number(orden?.[0]?.orden) || 0) + 1,
        }).select("id").single();
        if (e || !data) throw new Error(`No se pudo atar la factura a la OC (${e?.message || "sin respuesta"})`);
        insertados.push(data.id);
        return data.id as string;
      };
      const vinculos: string[] = [];
      const conAlgo = new Set(lineas.map(l => ocFinal.get(l.ocId) || l.ocId));
      for (const o of ocsElegidas) {
        const destino = ocFinal.get(o.id)!;
        if (!conAlgo.has(destino)) { vinculos.push(await nuevoRenglon(destino, `FC ${numero} (sin renglones pendientes)`)); conAlgo.add(destino); }
      }

      // c) Factura + asignaciones (a precio de OC: no se toca ningún costo). Sin artículos leídos, un renglón "Factura sin detalle" con el neto.
      const items = factura.items.length
        ? factura.items.map((it, i) => ({ key: lineKey(factura, i), ...it }))
        : [{ key: "fc", codigo: "", descripcion: "Factura (sin detalle de artículos)", cantidad: 1, precio_unitario: num(netoTxt), descuento_porcentaje: 0, iva_porcentaje: iva, unidad: "UN" }];
      const keyBase = items[0].key;
      const asign = [
        ...lineas.map(l => ({ key: keyBase, orden_compra_item_id: l.id, cantidad: l.pendiente, precio_factura: l.precio, precio_oc: l.precio, origen: "lazza" })),
        ...vinculos.map(id => ({ key: keyBase, orden_compra_item_id: id, cantidad: 1, precio_factura: 0, precio_oc: 0, origen: "vinculo" })),
      ];
      const notas = [
        pagaVisa ? "" : textoPago,
        notaPago.trim() ? `Nota para Finanzas: ${notaPago.trim()}` : "",
        "Cargada con «Compras Lazza»",
      ].filter(Boolean).join("\n");
      const { data, error: eRpc } = await db.rpc("guardar_conciliacion_compra", {
        p_sociedad_id: sociedadId, p_factura_id: null,
        p_factura: {
          proveedor_id: proveedor.id, numero_factura: numero, tipo_comprobante: factura.tipo, fecha: factura.fecha,
          fecha_vencimiento: pagaVisa ? factura.vencimiento || null : vencimientoPorDias(factura.fecha, dias, factura.vencimiento), cae: factura.cae || null, moneda: factura.moneda, subtotal: num(netoTxt),
          iva: ivaFactura, iva_porcentaje: factura.ivaPorcentaje, percepciones: percepcionesFactura, total: factura.total, notas,
        },
        // Solo ata la factura a la OC: no se tocan los costos de la OC ni del PR.
        p_items: items, p_asignaciones: asign, p_borrador: false, p_aceptar_costos: false, p_equivalencias: [], p_confirmar: true,
      });
      if (eRpc) throw new Error(eRpc.message);
      const facturaId = data?.factura_compra_id as string;

      // d) PDF y pago (si algo de esto falla, la factura ya quedó: solo se avisa).
      if (facturaId) await subirArchivo(facturaId);
      let pagoTxt = "va a Pagos";
      if (facturaId && pagaVisa) {
        const visa = tarjetaSugerida(await traerTarjetas(db, sociedadId), { ocConTarjeta: true });
        const r = visa ? await registrarPagoTarjeta(db, facturaId, visa, movimientoPagoTarjeta({
          sociedadId, proveedorId: proveedor.id, facturaId, tarjeta: visa, total: factura.total, moneda: factura.moneda, fecha: factura.fecha || todayAR(),
          comprobante: `${factura.tipo} ${numero}`, proveedorNombre: proveedor.razon_social,
        })) : { error: "no hay ninguna tarjeta cargada" };
        if (r.error) { toast.warning(`No se pudo registrar el pago con Visa (${r.error}): la factura quedó para Pagos.`); await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion"); }
        else pagoTxt = `pagada con ${visa!.nombre}`;
      } else if (facturaId) {
        await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion");
      }
      toast.success([`✔ FC ${numero} cargada`, pagoTxt].join(" · "));
      if (data?.aviso) toast.warning(String(data.aviso));
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      // No se guardó la factura: se vuelve atrás lo que se tocó en esta misma carga.
      if (insertados.length) await db.from("orden_compra_items").delete().in("id", insertados);
      for (const v of vueltaRenglones) await db.from("orden_compra_items").update({ orden_id: v.ordenId }).eq("id", v.itemId);
      for (const id of canceladas) await db.from("ordenes_compra").update({ estado: "enviada" }).eq("id", id).eq("sociedad_id", sociedadId);
      for (const v of vueltaProveedor) await db.from("ordenes_compra").update({ proveedor_id: v.proveedorId, observaciones: v.observaciones }).eq("id", v.ocId).eq("sociedad_id", sociedadId);
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  // ── Pantalla ──
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && !leyendo && !guardando) void leer(f); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Cargar factura <span className="text-sm font-normal text-zinc-500">· {ocInicial ? <>de la <span className="font-mono">{ocInicial.numero}</span></> : "Compras Lazza"}</span></h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {!factura && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-8 text-sm text-zinc-500 hover:border-orange-400 dark:border-zinc-600">
            {leyendo ? <span className="flex items-center gap-2 text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /> Leyendo la factura…</span>
              : <><FileUp className="h-6 w-6 text-orange-500" /> Arrastrá la factura acá o hacé clic para elegirla (PDF o foto)</>}
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={leyendo || leyendoIA}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void leer(f); }} />
          </label>
        )}
        {!factura && noSeLeyo && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" /> El sistema no pudo leer «{archivo?.name}» solo (sin QR ni texto).
            <button onClick={() => void leerConIA()} disabled={leyendoIA} className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white">
              {leyendoIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Leer con IA
            </button>
          </div>
        )}

        {factura && (
          <div className="space-y-3">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
              <b>{factura.tipo}</b>
              <input value={factura.numero} onChange={e => setFactura({ ...factura, numero: e.target.value })} placeholder="Número" className="w-36 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-semibold dark:border-zinc-600 dark:bg-zinc-900" />
              <span className="text-zinc-500">{formatDate(factura.fecha || todayAR())}</span>
              <span className="font-medium">{proveedor?.razon_social || factura.razonSocialLeida || "Proveedor"}</span>
              <span className="text-xs text-zinc-500">CUIT {factura.cuit || "?"}</span>
              {/* Neto + IVA (lo que cuesta la mercadería); las percepciones aparte, en chico */}
              <span className="ml-auto text-right leading-tight">
                <span className="font-semibold">{plata(round2(num(netoTxt) + ivaFactura))}</span> <span className="text-xs text-zinc-500">neto + IVA</span>
                {percepcionesFactura > 0 && <span className="block text-[11px] text-zinc-500">+ percep.{impuestos.percepcionEstimada ? " (calculada)" : ""} {plata(percepcionesFactura)} = total {plata(factura.total)}</span>}
              </span>
              <button onClick={() => { reiniciar(); setArchivo(null); }} disabled={guardando} className="text-xs text-zinc-500 underline">Otra factura</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{origen === "ia" ? `✨ Leída con IA · ${factura.items.length} artículo(s)` : "Leída por el sistema (sin IA)"}</span>
            </div>
            {otraSociedad && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Está a nombre de {otraSociedad}: cargala desde esa sociedad.</p>}
            {duplicada && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {esNC ? "Esta nota de crédito" : "Esta factura"} ya está cargada en el sistema.</p>}
            {esNota && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Es una nota de débito: esta pantalla es para facturas y notas de crédito.</p>}
            {!proveedor && !esNota && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> {factura.cuit ? `El proveedor CUIT ${factura.cuit} no está cargado.` : "No se leyó el CUIT del proveedor."}
                {factura.cuit && <button onClick={() => setCrearProv(true)} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white"><UserPlus className="h-3.5 w-3.5" /> Crear proveedor</button>}
              </div>
            )}

            {/* Nota de crédito: sin OC, a la cuenta corriente del proveedor */}
            {listo && esNC && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Nota de crédito: no se ata a ninguna OC. Va a la cuenta corriente de <b>{proveedor!.razon_social}</b> como crédito (se usa al pagarle).
              </p>
            )}

            {/* OC */}
            {listo && !esNC && (
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">¿De qué OC es?</span>
                  {([["prov", `De ${proveedor!.razon_social}`], ["sin", "OC sin proveedor"], ["otros", "OC de otros proveedores"]] as const).map(([k, t]) => (
                    <button key={k} onClick={() => verFuente(k)} className={`${chip} ${ver === k ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-violet-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                      {t}{cargadas.has(k) ? ` (${cuantas(k)})` : ""} {cargandoOcs === k && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                    </button>
                  ))}
                  {ver !== "prov" && (
                    <div className="relative ml-auto">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar OC, PR, cliente o artículo…" className="h-7 w-56 rounded-lg border border-zinc-200 bg-white pl-7 text-xs dark:border-zinc-700 dark:bg-zinc-900" />
                    </div>
                  )}
                </div>
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {!ocsVer.length && cargandoOcs !== ver && <p className="text-sm text-zinc-500">{ver === "prov" ? `${proveedor!.razon_social} no tiene OC pendientes de facturar.` : "No hay OC para mostrar."}</p>}
                  {/* Las elegidas de otras listas también se ven arriba. */}
                  {[...ocsElegidas.filter(o => o.fuente !== ver), ...ocsVer].map(o => <TarjetaOc key={o.id} o={o} e={elegidas.get(o.id)} plata={(n: number) => formatCurrency(n, o.moneda as any)} onTildar={() => tildar(o)} />)}
                </div>
              </div>
            )}

            {listo && !esNC && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">¿Cómo se paga?</span>
                <label className="flex items-center gap-1"><input type="radio" checked={!pagaVisa} onChange={() => setConVisa(false)} /> Va a Pagos</label>
                <label className="flex items-center gap-1"><input type="radio" checked={pagaVisa} onChange={() => setConVisa(true)} /> <CreditCard className="h-4 w-4 text-blue-600" /> Ya pagada con Visa</label>
                {visaSugerida && conVisa === null && <span className="text-xs text-zinc-500">(la OC es de Mercado Libre o se pagó con tarjeta)</span>}
              </div>
            )}
            {listo && !esNC && !pagaVisa && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Para Pagos</span>
                {(["transferencia", "echeq"] as const).map(f => (
                  <button key={f} onClick={() => { setForma(f); setDiasTxt(null); }} className={`${btnNo} ${formaPago === f ? elegido : ""}`}>{f === "echeq" ? "eCheq" : "Transferencia"}</button>
                ))}
                <span className="ml-2 text-xs text-zinc-500">a</span>
                <input value={dias} onChange={e => setDiasTxt(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" aria-label="Días"
                  className="w-12 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right dark:border-zinc-600 dark:bg-zinc-900" />
                <span className="text-xs text-zinc-500">días</span>
                {DIAS_RAPIDOS.map(d => <button key={d} onClick={() => setDiasTxt(String(d))} className={`rounded px-1.5 py-0.5 text-xs ${dias === String(d) ? "bg-violet-600 text-white" : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}>{d}</button>)}
                {vencePago && <span className="text-xs text-zinc-500">vence {vencePago.split("-").reverse().join("/")}</span>}
              </div>
            )}
            {listo && (faltaEmail || (faltaBanco && !pagaVisa && !esNC)) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-amber-700 dark:text-amber-400">A {proveedor!.razon_social} le falta {[faltaEmail && "el email", faltaBanco && !pagaVisa && !esNC && "los datos bancarios"].filter(Boolean).join(" y ")}:</span>
                {faltaEmail && <input value={emailProv} onChange={e => setEmailProv(e.target.value)} placeholder="Email" type="email"
                  className="w-48 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-900" />}
                {faltaBanco && !pagaVisa && !esNC && <input value={bancoProv} onChange={e => setBancoProv(e.target.value)} placeholder="CBU o alias"
                  className="w-56 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-900" />}
                <button onClick={() => void guardarDatosProveedor()} disabled={guardandoProv || !(emailProv.trim() || bancoProv.trim())} className={`${btnSi} disabled:opacity-40`}>
                  {guardandoProv ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Guardar en el proveedor"}
                </button>
              </div>
            )}
            {listo && (
              <input value={notaPago} onChange={e => setNotaPago(e.target.value)} placeholder="Nota para Finanzas (opcional)"
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
            )}
            {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              {listo && !esNC && !ocsElegidas.length && <span className="mr-auto text-xs text-zinc-600 dark:text-zinc-300">Sin OC: la factura va directo a la cuenta corriente de {proveedor!.razon_social}.</span>}
              <button onClick={onClose} disabled={guardando} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-600">Cancelar</button>
              <button onClick={() => void guardar()} disabled={!listo || guardando || leyendoIA}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {esNC ? "Guardar NC" : "Guardar"}
              </button>
            </div>
          </div>
        )}
        {error && !factura && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      </div>

      {/* ¿Seguro? OC sin proveedor o de otro proveedor */}
      {preguntar && proveedor && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setPreguntar(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-4 text-sm shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={e => e.stopPropagation()}>
            <p className="mb-2 font-semibold">
              {preguntar.oc.proveedorId ? <>La <span className="font-mono">{preguntar.oc.numero}</span> es de <b>{preguntar.oc.provNombre}</b>. ¿Seguro que es de {proveedor.razon_social}?</>
                : <>La <span className="font-mono">{preguntar.oc.numero}</span> no tiene proveedor. Pasa a <b>{proveedor.razon_social}</b>.</>}
            </p>
            {!preguntar.articulos ? (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setElegidas(p => new Map(p).set(preguntar.oc.id, { modo: "toda", itemIds: new Set() })); setPreguntar(null); }} className={btnSi}>Sí, toda la OC</button>
                <button onClick={() => setPreguntar({ ...preguntar, articulos: new Set(preguntar.oc.lineas.filter(l => l.pendiente > 0).map(l => l.id)) })} className={btnNo}>Solo algunos artículos</button>
                <button onClick={() => setPreguntar(null)} className={`${btnNo} ml-auto`}>Cancelar</button>
              </div>
            ) : (
              <>
                <p className="mb-1 text-xs text-zinc-500">Tildá los artículos de esta factura:</p>
                <ul className="mb-3 max-h-60 space-y-0.5 overflow-y-auto">
                  {preguntar.oc.lineas.filter(l => l.pendiente > 0).map(l => (
                    <li key={l.id}><label className="flex items-center gap-2">
                      <input type="checkbox" checked={preguntar.articulos!.has(l.id)} onChange={() => setPreguntar(p => { if (!p?.articulos) return p; const n = new Set(p.articulos); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return { ...p, articulos: n }; })} />
                      <span><b>{cant(l.pendiente)}</b> × {l.descripcion}</span>
                    </label></li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button disabled={!preguntar.articulos.size} onClick={() => { setElegidas(p => new Map(p).set(preguntar.oc.id, { modo: "articulos", itemIds: preguntar.articulos! })); setPreguntar(null); }} className={`${btnSi} disabled:opacity-40`}>Listo ({preguntar.articulos.size})</button>
                  <button onClick={() => setPreguntar(null)} className={`${btnNo} ml-auto`}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ProveedorFormModal open={crearProv} proveedorId={null} consultarArcaAlAbrir
        inicial={{ cuit: factura?.cuit || "", razon_social: factura?.razonSocialLeida || "", nombre_fantasia: factura?.nombreFantasiaLeido || "" }}
        subtitulo="Se guarda y queda elegido en esta factura."
        onClose={() => setCrearProv(false)}
        onSaved={row => { setCrearProv(false); if (factura) void elegirProveedor({ id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string }, factura); }} />
    </div>
  );
}

/** Una OC con su detalle, para darse cuenta rápido a cuál corresponde la factura. */
function TarjetaOc({ o, e, plata, onTildar }: { o: Oc; e?: Eleccion; plata: (n: number) => string; onTildar: () => void }) {
  const { cantidades, porLlegado } = aFacturarPorRenglon(o.lineas);
  const pend = o.lineas.filter(l => (cantidades.get(l.id) || 0) > 0).map(l => ({ ...l, pendiente: cantidades.get(l.id) || 0 }));
  const neto = round2(pend.reduce((t, l) => t + l.pendiente * l.precio, 0));
  const quedaAfuera = porLlegado && o.lineas.some(l => (cantidades.get(l.id) || 0) < l.pendiente - 0.0001);
  const pedido = round2(o.lineas.reduce((t, l) => t + l.cantidad, 0)), llego = round2(o.lineas.reduce((t, l) => t + Math.min(l.recibida, l.cantidad), 0));
  const muestra = pend.slice(0, 4);
  return (
    <label className={`block cursor-pointer rounded-lg border px-2 py-1.5 text-xs ${e ? "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"}`}>
      <div className="flex flex-wrap items-center gap-x-2">
        <input type="checkbox" checked={!!e} onChange={onTildar} />
        <b className="font-mono">{o.numero}</b>
        <span className="text-zinc-500">{formatDate(o.fecha)}</span>
        {(o.pr || o.cliente) && <span className="max-w-[260px] truncate"><span className="font-mono text-zinc-500">{o.pr}</span>{o.cliente ? ` · ${o.cliente}` : ""}</span>}
        {o.fuente !== "prov" && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{o.esML ? "Mercado Libre" : o.provNombre || "sin proveedor"}</span>}
        {e?.modo === "toda" && <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">pasa entera</span>}
        {e?.modo === "articulos" && <span className="rounded bg-violet-100 px-1 text-[10px] text-violet-700">{e.itemIds.size} artículo(s)</span>}
        <span className="ml-auto text-zinc-500">llegó {cant(llego)} / {cant(pedido)}</span>
        {quedaAfuera && <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" title="Se factura solo lo que ya llegó; lo que falta queda abierto para la próxima factura">lo que llegó</span>}
        <b>{plata(neto)}</b>
      </div>
      <div className="ml-5 mt-0.5 text-zinc-600 dark:text-zinc-400" title={pend.map(l => `${cant(l.pendiente)} × ${l.descripcion}`).join("\n")}>
        {muestra.map(l => `${cant(l.pendiente)} × ${l.descripcion}`).join(" · ")}{pend.length > muestra.length ? ` · +${pend.length - muestra.length} más` : ""}
      </div>
    </label>
  );
}
