"use client";

/**
 * "Cargar factura" (Augusto 16/10): simple y separado de la carga vieja.
 * 1. Arrastrás o elegís el archivo. La IA lo lee; el proveedor se busca por CUIT (si no está: Crear proveedor con ARCA).
 * 2. Tildás una o más OC del proveedor (opcional: OC sin proveedor). Las que la factura cita vienen tildadas.
 * 3. Un renglón por artículo con ✅ / ⚠️ y botones cortos (ver lib/cargar-factura.ts). Nada frena: Guardar siempre.
 * Guardar usa guardar_conciliacion_compra (la misma de siempre): factura + renglones + asignaciones + costos al PR.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import { ProveedorFormModal } from "@/components/proveedor-form-modal";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { facturaDesdeDatos, lineKey, type FacturaCarga } from "@/lib/factura-compra-leida";
import { cargarLineasOc, sugerirEquivalencias, type AnalisisIA, type Manual, type OcLinea } from "@/lib/conciliacion-compras-analisis";
import { cargarLineasSinProveedor, asignarRenglonesAProveedor } from "@/lib/oc-sin-proveedor";
import { traerTarjetas, tarjetaSugerida, registrarPagoTarjeta, movimientoPagoTarjeta } from "@/lib/pago-tarjeta";
import { matchPurchaseLines, heuristicEquivalences, citaOc, parseVariant, puntajeParecido, type InvoiceLineInput } from "@/lib/purchase-matching";
import { armarRenglones, repartirEnvio, importePorOc, faltantesPorOc, cant, type RenglonVista } from "@/lib/cargar-factura";
import { AlertTriangle, Check, CreditCard, FileUp, Loader2, Sparkles, Truck, UserPlus, X } from "lucide-react";
import { linkArchivo } from "@/lib/archivo-link";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const SOCIEDAD_POR_CUIT: Record<string, { id: string; nombre: string }> = {
  "20379309128": { id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021", nombre: "Lazzari" },
  "30719396042": { id: "fee94607-747a-4e87-ba24-aff9032f7a56", nombre: "Grupo LA" },
};

type Proveedor = { id: string; razon_social: string; cuit: string | null; talles_especiales?: string[] | null; tolerancia_precio_pct?: number | null };
// sinProveedor = el renglón es de una OC sin proveedor o de otro proveedor (ej. Mercado Libre): al guardar pasa al proveedor real.
type Linea = OcLinea & { sinProveedor?: boolean };
type OcResumen = { ocId: string; ocNumero: string; fecha: string; unidades: number; renglones: number; sinProveedor: boolean; pr: string; cliente: string; provNombre: string; esML: boolean };
type InfoOc = { pr: string; cliente: string; medioPago: string; provNombre: string; esML: boolean };
const esMercadoLibre = (t: string | null | undefined) => /mercado\s*libre/i.test(String(t || ""));
type NoEsta = { tipo: "aparte" } | { tipo: "otra"; ocLineId: string; ocId: string; cantidad: number } | { tipo: "agregar"; ocId: string };

const btnSi = "rounded-md bg-violet-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-violet-700";
const btnNo = "rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
const elegido = "ring-2 ring-violet-400";

export default function CargarFacturaSimple({ sociedadId, onClose, onGuardada }: { sociedadId: string; onClose: () => void; onGuardada?: () => void }) {
  const { toast } = useToast();
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [factura, setFactura] = useState<FacturaCarga | null>(null);
  const [esNota, setEsNota] = useState(false);
  const [otraSociedad, setOtraSociedad] = useState("");
  const [duplicada, setDuplicada] = useState(false);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const [crearProv, setCrearProv] = useState(false);
  const [lineasProv, setLineasProv] = useState<Linea[]>([]);
  const [lineasSinProv, setLineasSinProv] = useState<Linea[]>([]);
  const [conSinProv, setConSinProv] = useState(false);
  const [infoOc, setInfoOc] = useState<Record<string, InfoOc>>({});
  // Vendedor nuevo (sin OC): se muestran todas las OC abiertas; el filtro achica a las de Mercado Libre.
  const [todasLasOc, setTodasLasOc] = useState(false);
  const [soloML, setSoloML] = useState(false);
  // Pago: null = lo que sugiere el sistema (Visa si la OC dice tarjeta o es de Mercado Libre).
  const [conVisa, setConVisa] = useState<boolean | null>(null);
  const [cargandoOcs, setCargandoOcs] = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [analisis, setAnalisis] = useState<AnalisisIA | null>(null);
  const [pensando, setPensando] = useState(false);
  // Decisiones (lo que no se toca queda con la opción por defecto).
  const [reclamar, setReclamar] = useState<Set<string>>(new Set());
  const [rechazadas, setRechazadas] = useState<Set<string>>(new Set());
  const [noEsta, setNoEsta] = useState<Record<string, NoEsta>>({});
  const [deMasAparte, setDeMasAparte] = useState<Set<string>>(new Set());
  const [cerrarOc, setCerrarOc] = useState<Set<string>>(new Set());
  const [envioEditado, setEnvioEditado] = useState<Record<string, Record<string, string>>>({});
  const [guardando, setGuardando] = useState(false);

  // ── 1. Leer el archivo ──
  async function leer(file: File) {
    setError(""); setLeyendo(true); setFactura(null); setProveedor(null); setLineasProv([]); setElegidas(new Set()); setAnalisis(null);
    setReclamar(new Set()); setRechazadas(new Set()); setNoEsta({}); setDeMasAparte(new Set()); setCerrarOc(new Set()); setEnvioEditado({});
    setConSinProv(false); setLineasSinProv([]); setTodasLasOc(false); setSoloML(false); setConVisa(null);
    try {
      const body = new FormData(); body.append("file", file);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer el archivo");
      const d = json.data || {};
      const f = facturaDesdeDatos(file, d);
      setFactura(f);
      setEsNota(/CR[EÉ]DITO|D[EÉ]BITO|^N\.?\s?[CD]\b/i.test(String(d.tipo_comprobante || "")));
      const soc = SOCIEDAD_POR_CUIT[digitos(d.cuit_receptor)];
      setOtraSociedad(soc && soc.id !== sociedadId ? soc.nombre : "");
      if (f.cuit.length === 11) {
        const { data: ps } = await db.from("proveedores").select("id, razon_social, cuit, talles_especiales, tolerancia_precio_pct").eq("sociedad_id", sociedadId).eq("activo", true);
        const p = ((ps || []) as Proveedor[]).find(x => digitos(x.cuit) === f.cuit);
        if (p) await elegirProveedor(p, f);
      }
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo");
    } finally { setLeyendo(false); }
  }

  // ── 2. Proveedor → sus OC con renglones pendientes ──
  async function elegirProveedor(p: Proveedor, f: FacturaCarga) {
    setProveedor(p); setCargandoOcs(true);
    try {
      const { data: dups } = await db.from("facturas_compra").select("numero_factura, estado").eq("sociedad_id", sociedadId).eq("proveedor_id", p.id).neq("estado", "anulada");
      const norm = (n: string) => { const m = String(n || "").replace(/\s+/g, "").match(/^(\d{1,5})[-/](\d{1,8})$/); return m ? `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}` : String(n || "").replace(/\s+/g, "").toUpperCase(); };
      setDuplicada(!!f.numero && (dups || []).some((x: any) => norm(x.numero_factura) === norm(f.numero)));
      const { lineas, legacy } = await cargarLineasOc(db, sociedadId, p.id);
      const usables = lineas.filter(l => !legacy.has(l.ocId));
      setLineasProv(usables);
      await traerInfoOc(usables.map(l => l.ocId));
      // Vendedor nuevo o sin OC: se muestran TODAS las OC abiertas (con el filtro "Solo Mercado Libre").
      if (!usables.length) {
        const ls = await cargarLineasAbiertas(db, sociedadId, p.id);
        setLineasSinProv(ls); setConSinProv(true); setTodasLasOc(true);
        await traerInfoOc(ls.map(l => l.ocId));
        void analizar(p, f, ls);
        return;
      }
      // Tildadas de entrada: las OC que la factura cita; si hay una sola OC, esa.
      const ocIds = [...new Set(usables.map(l => l.ocId))];
      const citadas = ocIds.filter(id => (f.ocRefs || []).some(r => citaOc(r, usables.find(l => l.ocId === id)?.ocNumero || "")));
      setElegidas(new Set(citadas.length ? citadas : ocIds.length === 1 ? ocIds : []));
      void analizar(p, f, usables);
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer las OC del proveedor");
    } finally { setCargandoOcs(false); }
  }

  async function traerInfoOc(ids: string[]) {
    const faltan = [...new Set(ids)].filter(id => !infoOc[id]);
    if (!faltan.length) return;
    const filas: any[] = [];
    for (let i = 0; i < faltan.length; i += 100) {
      const { data } = await db.from("ordenes_compra").select("id, medio_pago, observaciones, proveedores(razon_social, nombre_fantasia), presupuesto_origen:presupuesto_origen_id(numero, clientes(razon_social))").in("id", faltan.slice(i, i + 100));
      filas.push(...(data || []));
    }
    setInfoOc(prev => ({ ...prev, ...Object.fromEntries(filas.map((o: any) => {
      const provNombre = o.proveedores?.nombre_fantasia || o.proveedores?.razon_social || "";
      return [o.id, { pr: o.presupuesto_origen?.numero || "", cliente: o.presupuesto_origen?.clientes?.razon_social || "", medioPago: o.medio_pago || "", provNombre,
        esML: esMercadoLibre(provNombre) || esMercadoLibre(o.proveedores?.razon_social) || esMercadoLibre(o.observaciones) }];
    })) }));
  }

  // La IA busca equivalencias una vez contra TODAS las OC disponibles; tildar o destildar no la vuelve a llamar.
  async function analizar(p: Proveedor, f: FacturaCarga, ocs: Linea[]) {
    if (!ocs.length || !f.items.length) { setAnalisis(null); return; }
    setPensando(true);
    try {
      setAnalisis(await sugerirEquivalencias(supabase, {
        sociedadId, proveedorId: p.id, proveedorNombre: p.razon_social, lineasFactura: lineasDe(f), ocs, manual: {},
        opciones: { tallesEspeciales: p.talles_especiales || [], toleranciaPct: Number(p.tolerancia_precio_pct) || 0 },
      }));
    } catch { setAnalisis(null); /* sin IA: se usa similitud de nombres */ }
    finally { setPensando(false); }
  }

  async function verSinProveedor() {
    if (!proveedor || !factura) return;
    setConSinProv(true); setCargandoOcs(true);
    try {
      const ls = (await cargarLineasSinProveedor(db, sociedadId)).map(c => ({ ...c, ocEstado: "", descripcionOc: c.descripcion, sinProveedor: true }));
      setLineasSinProv(ls);
      await traerInfoOc(ls.map(l => l.ocId));
      void analizar(proveedor, factura, [...lineasProv, ...ls]);
    } catch (e: any) { toast.error(e?.message || "No se pudieron traer las OC sin proveedor"); }
    finally { setCargandoOcs(false); }
  }

  // ── 3. Cruce contra las OC tildadas ──
  const lineasFc = useMemo(() => (factura ? lineasDe(factura) : []), [factura]);
  const todas = useMemo(() => [...lineasProv, ...(conSinProv ? lineasSinProv : [])], [lineasProv, lineasSinProv, conSinProv]);
  const ocLinea = useMemo(() => new Map(todas.map(l => [l.id, { ocId: l.ocId, ocNumero: l.ocNumero, moneda: l.moneda, descripcion: l.descripcionOc || l.descripcion }])), [todas]);
  const ocsDisponibles = useMemo(() => {
    const m = new Map<string, OcResumen>();
    for (const l of todas) {
      const i = infoOc[l.ocId];
      const x = m.get(l.ocId) || { ocId: l.ocId, ocNumero: l.ocNumero, fecha: l.ocFecha, unidades: 0, renglones: 0, sinProveedor: !!l.sinProveedor, pr: i?.pr || "", cliente: i?.cliente || "", provNombre: i?.provNombre || "", esML: !!i?.esML };
      x.unidades = round2(x.unidades + l.cantidad); x.renglones++;
      m.set(l.ocId, x);
    }
    return [...m.values()].sort((a, b) => Number(elegidas.has(b.ocId)) - Number(elegidas.has(a.ocId)) || Number(a.sinProveedor) - Number(b.sinProveedor) || b.fecha.localeCompare(a.fecha));
  }, [todas, infoOc, elegidas]);
  const ocsVisibles = useMemo(() => (soloML ? ocsDisponibles.filter(o => o.esML || elegidas.has(o.ocId)) : ocsDisponibles), [ocsDisponibles, soloML, elegidas]);
  // Visa sugerida: compra de Mercado Libre u OC marcada "pagada con tarjeta". Se puede cambiar.
  const visaSugerida = useMemo(() => esMercadoLibre(proveedor?.razon_social) || [...elegidas].some(id => infoOc[id]?.medioPago === "tarjeta" || infoOc[id]?.esML), [proveedor, elegidas, infoOc]);
  const pagaVisa = conVisa ?? visaSugerida;

  const manual = useMemo<Manual>(() => {
    const m: Manual = {};
    for (const k of rechazadas) m[k] = "__extra__";
    for (const [k, d] of Object.entries(noEsta)) if (d.tipo === "otra") m[k] = [{ ocLineId: d.ocLineId, cantidad: d.cantidad }];
    return m;
  }, [rechazadas, noEsta]);
  const resultado = useMemo(() => {
    if (!factura || !elegidas.size) return null;
    const ocs = todas.filter(l => elegidas.has(l.ocId));
    const eq = analisis?.equivalencias || heuristicEquivalences(lineasFc, ocs, proveedor?.talles_especiales || []);
    return matchPurchaseLines(lineasFc, ocs, eq, manual, { tallesEspeciales: proveedor?.talles_especiales || [], toleranciaPct: Number(proveedor?.tolerancia_precio_pct) || 0 });
  }, [factura, elegidas, todas, analisis, lineasFc, manual, proveedor]);
  const renglones = useMemo(() => resultado ? armarRenglones({
    lineas: lineasFc, resultado, ocLinea, monedaFactura: factura?.moneda || "ARS", confianza: analisis?.confianza, motivo: analisis?.motivo, rechazadas,
  }) : [], [resultado, lineasFc, ocLinea, factura, analisis, rechazadas]);

  // Para lo que no está en las OC tildadas: el renglón más parecido de CUALQUIER OC del proveedor.
  const sugerencia = useMemo(() => {
    const m = new Map<string, { l: Linea; libre: number }>();
    if (!resultado) return m;
    const usado = new Map<string, number>();
    for (const a of resultado.asignaciones) usado.set(a.ocLineId, (usado.get(a.ocLineId) || 0) + a.cantidad);
    for (const r of renglones) {
      if (r.tipo !== "no_esta") continue;
      let mejor: { l: Linea; libre: number; p: number } | null = null;
      for (const l of todas) {
        const libre = round2(l.cantidad - (usado.get(l.id) || 0));
        if (rechazadas.has(r.key) && resultado.asignaciones.some(a => a.invoiceKey === r.key && a.ocLineId === l.id)) continue;
        const p = puntajeParecido({ descripcion: r.descripcion, cantidad: r.cantidad, precio: r.precio }, { descripcion: l.descripcion, precio: l.precio }, libre, { tallesEspeciales: proveedor?.talles_especiales || [] });
        if (p && p.puntaje >= 40 && (!mejor || p.puntaje > mejor.p)) mejor = { l, libre, p: p.puntaje };
      }
      if (mejor) m.set(r.key, mejor);
    }
    return m;
  }, [resultado, renglones, todas, rechazadas, proveedor]);

  // Envío: siempre a las OC, repartido por plata (se puede editar).
  const repartoEnvio = useMemo(() => {
    const imp = importePorOc(renglones.filter(r => r.tipo !== "envio"));
    const base = imp.length ? imp : [...elegidas].map(id => ({ ocId: id, ocNumero: ocsDisponibles.find(o => o.ocId === id)?.ocNumero || "", importe: 0 }));
    const out: Record<string, Array<{ ocId: string; ocNumero: string; monto: number }>> = {};
    for (const r of renglones) {
      if (r.tipo !== "envio") continue;
      const auto = repartirEnvio(round2(r.precio * r.cantidad), base);
      const ed = envioEditado[r.key] || {};
      out[r.key] = auto.map(p => ({ ...p, monto: ed[p.ocId] !== undefined ? Number(String(ed[p.ocId]).replace(",", ".")) || 0 : p.monto }));
    }
    return out;
  }, [renglones, elegidas, ocsDisponibles, envioEditado]);

  const faltantes = useMemo(() => (resultado ? faltantesPorOc(resultado, elegidas) : []), [resultado, elegidas]);
  const avisos = renglones.filter(r => r.tipo !== "ok" || r.compara === "mayor" || r.deMas > 0).length + faltantes.length;
  const plata = (n: number) => formatCurrency(n, factura?.moneda || "ARS");

  // Si una OC deja de estar tildada, sus decisiones de "otra OC" se limpian.
  useEffect(() => {
    setNoEsta(p => Object.fromEntries(Object.entries(p).filter(([, d]) => d.tipo === "aparte" || elegidas.has(d.ocId))));
  }, [elegidas]);

  function tildar(ocId: string) {
    setElegidas(p => { const n = new Set(p); if (n.has(ocId)) n.delete(ocId); else n.add(ocId); return n; });
  }

  // ── 4. Guardar ──
  async function guardar() {
    if (!factura || !proveedor) return;
    if (!factura.numero.trim()) { setError("Falta el número de la factura."); return; }
    setGuardando(true); setError("");
    const insertados: string[] = [];
    try {
      const asign: Array<{ key: string; orden_compra_item_id: string; cantidad: number; precio_factura: number; precio_oc: number; origen: string }> = [];
      const aparte: string[] = [], aReclamar: string[] = [], envios: string[] = [], recibirDespues: string[] = [];
      const sinProvOc = new Set(todas.filter(l => l.sinProveedor).map(l => l.ocId));
      const sinProvItems = new Set(todas.filter(l => l.sinProveedor).map(l => l.id));
      const conRenglonNuevo = new Set<string>();
      const nuevoRenglon = async (ocId: string, it: { descripcion: string; codigo: string; cantidad: number; precio: number; iva: number; llegado: boolean }) => {
        const { data: orden } = await db.from("orden_compra_items").select("orden").eq("orden_id", ocId).order("orden", { ascending: false }).limit(1);
        const llegadoYa = it.llegado && !sinProvOc.has(ocId);
        const { data, error: e } = await db.from("orden_compra_items").insert({
          orden_id: ocId, codigo: it.codigo, descripcion: it.descripcion, cantidad: it.cantidad, cantidad_recibida: llegadoYa ? it.cantidad : 0,
          unidad: "UN", precio_unitario: it.precio, iva_porcentaje: it.iva, orden: (Number(orden?.[0]?.orden) || 0) + 1,
        }).select("id").single();
        if (e || !data) throw new Error(`No se pudo sumar "${it.descripcion}" a la OC (${e?.message || "sin respuesta"})`);
        insertados.push(data.id); conRenglonNuevo.add(ocId);
        if (sinProvOc.has(ocId)) { sinProvItems.add(data.id); if (it.llegado) recibirDespues.push(data.id); }
        return data.id as string;
      };

      for (const r of renglones) {
        const it = factura.items[Number(r.key.split(":").pop())];
        const iva = Number(it?.iva_porcentaje ?? 21);
        if (r.tipo === "envio") {
          const partes = (repartoEnvio[r.key] || []).filter(p => p.monto > 0);
          if (!partes.length) { aparte.push(`${cant(r.cantidad)} × ${r.descripcion}`); continue; }
          for (const p of partes) {
            const id = await nuevoRenglon(p.ocId, { descripcion: `${r.descripcion} (FC ${factura.numero.trim()})`, codigo: it?.codigo || "", cantidad: 1, precio: p.monto, iva, llegado: true });
            asign.push({ key: r.key, orden_compra_item_id: id, cantidad: 1, precio_factura: p.monto, precio_oc: p.monto, origen: "envio" });
          }
          envios.push(`${r.descripcion}: ${partes.map(p => `${p.ocNumero} ${plata(p.monto)}`).join(" · ")}`);
          continue;
        }
        if (r.tipo === "no_esta") {
          const d = noEsta[r.key];
          if (d?.tipo === "agregar") {
            const id = await nuevoRenglon(d.ocId, { descripcion: r.descripcion, codigo: it?.codigo || "", cantidad: r.cantidad, precio: r.precio, iva, llegado: false });
            asign.push({ key: r.key, orden_compra_item_id: id, cantidad: r.cantidad, precio_factura: r.precio, precio_oc: r.precio, origen: "agregado" });
          } else aparte.push(`${cant(r.cantidad)} × ${r.descripcion}`);
          continue;
        }
        const mantenerCosto = r.compara === "otra_moneda" || (r.compara === "mayor" && reclamar.has(r.key));
        if (r.compara === "mayor" && reclamar.has(r.key)) aReclamar.push(`${r.descripcion} (factura ${plata(r.precio)} vs OC ${plata(r.precioOc)})`);
        for (const a of r.asignaciones) {
          asign.push({ key: r.key, orden_compra_item_id: a.ocLineId, cantidad: a.cantidad, precio_factura: mantenerCosto ? a.precioOc : a.precioFactura, precio_oc: a.precioOc, origen: a.origen });
        }
        if (r.deMas > 0) {
          if (r.deMasOcLineId && !deMasAparte.has(r.key)) {
            const po = r.asignaciones.find(a => a.ocLineId === r.deMasOcLineId)?.precioOc ?? r.precioOc;
            asign.push({ key: r.key, orden_compra_item_id: r.deMasOcLineId, cantidad: r.deMas, precio_factura: mantenerCosto ? po : r.precio, precio_oc: po, origen: "de_mas" });
          } else aparte.push(`${cant(r.deMas)} de más × ${r.descripcion}`);
        }
        if (r.sinOc > 0) aparte.push(`${cant(r.sinOc)} × ${r.descripcion}`);
      }

      // Renglones de OC sin proveedor que cubre esta factura: pasan al proveedor real (mismo id de renglón).
      const mover = [...new Set(asign.map(a => a.orden_compra_item_id).filter(id => sinProvItems.has(id)))];
      if (mover.length) {
        const r = await asignarRenglonesAProveedor(db, { sociedadId, itemIds: mover, proveedorId: proveedor.id, proveedorNombre: proveedor.razon_social, nota: `FC ${factura.numero.trim()}` });
        for (const a of r.avisos) if (!/ya tiene algo recibido/.test(a)) toast.warning(a);
        // Lo que ya tenía algo llegado no se mueve renglón por renglón: si la OC es de Mercado Libre o sin proveedor,
        // la OC entera pasa al vendedor real (regla de Augusto: en Mercado Libre el proveedor es siempre el vendedor).
        const { data: quedaron } = await db.from("orden_compra_items").select("id, orden_id, ordenes_compra(proveedor_id, numero, observaciones)").in("id", mover);
        for (const ocId of new Set(((quedaron || []) as any[]).filter(q => q.ordenes_compra?.proveedor_id !== proveedor.id).map(q => q.orden_id as string))) {
          const oc = (quedaron as any[]).find(q => q.orden_id === ocId)?.ordenes_compra;
          if (oc?.proveedor_id && !infoOc[ocId]?.esML) throw new Error(`La ${oc.numero} es de otro proveedor y ya tiene mercadería llegada: cambiale el proveedor desde la OC y volvé a cargar la factura.`);
          const { error: eP } = await db.from("ordenes_compra").update({ proveedor_id: proveedor.id, observaciones: `${oc?.observaciones || ""}
Proveedor real ${proveedor.razon_social} (FC ${factura.numero.trim()})`.trim() }).eq("id", ocId).eq("sociedad_id", sociedadId);
          if (eP) throw new Error(`No se pudo pasar la ${oc?.numero || "OC"} a ${proveedor.razon_social}: ${eP.message}`);
        }
        if (recibirDespues.length) for (const id of recibirDespues) await db.from("orden_compra_items").update({ cantidad_recibida: 1 }).eq("id", id);
      }

      // Total de las OC a las que se les sumó un renglón.
      for (const ocId of conRenglonNuevo) {
        const { data: its } = await db.from("orden_compra_items").select("orden_id, cantidad, precio_unitario, iva_porcentaje").eq("orden_id", ocId);
        if (!its?.length) continue;
        const neto = round2(its.reduce((t: number, i: any) => t + Number(i.cantidad) * Number(i.precio_unitario), 0));
        const iva = round2(its.reduce((t: number, i: any) => t + Number(i.cantidad) * Number(i.precio_unitario) * Number(i.iva_porcentaje ?? 21) / 100, 0));
        await db.from("ordenes_compra").update({ subtotal: neto, iva, total: round2(neto + iva), updated_at: new Date().toISOString() }).eq("id", ocId).eq("sociedad_id", sociedadId);
      }

      // Lo que se cruzó por parecido o por la IA se aprende para la próxima.
      const eqs = new Map<string, { producto_factura: string; producto_oc: string; codigo_proveedor: string | null }>();
      for (const r of renglones) for (const a of r.asignaciones) {
        if (a.origen === "codigo") continue;
        const pf = parseVariant(r.descripcion).producto, po = parseVariant(todas.find(l => l.id === a.ocLineId)?.descripcion || "").producto;
        if (pf && po) eqs.set(`${pf}|${po}`, { producto_factura: pf, producto_oc: po, codigo_proveedor: factura.items[Number(r.key.split(":").pop())]?.codigo || null });
      }
      const notas = [
        "Cargada con «Cargar factura»",
        envios.length ? `Envío sumado a la OC: ${envios.join("; ")}` : "",
        aparte.length ? `Fuera de OC: ${aparte.join("; ")}` : "",
        aReclamar.length ? `A reclamar al proveedor (precio): ${aReclamar.join("; ")}` : "",
      ].filter(Boolean).join("\n");
      const { data, error: eRpc } = await db.rpc("guardar_conciliacion_compra", {
        p_sociedad_id: sociedadId, p_factura_id: null,
        p_factura: {
          proveedor_id: proveedor.id, numero_factura: factura.numero.trim(), tipo_comprobante: factura.tipo, fecha: factura.fecha,
          fecha_vencimiento: factura.vencimiento || null, cae: factura.cae || null, moneda: factura.moneda, subtotal: factura.subtotal,
          iva: factura.iva, iva_porcentaje: factura.ivaPorcentaje, percepciones: factura.percepciones, total: factura.total, notas,
        },
        p_items: factura.items.map((it, i) => ({ key: lineKey(factura, i), ...it })),
        p_asignaciones: asign, p_borrador: false, p_aceptar_costos: true, p_equivalencias: [...eqs.values()], p_confirmar: true,
      });
      if (eRpc) throw new Error(eRpc.message);
      const facturaId = data?.factura_compra_id as string;

      if (factura.file && facturaId) {
        const ext = factura.file.name.split(".").pop() || "pdf";
        const path = `${sociedadId}/${facturaId}/factura.${ext}`;
        const { error: upErr } = await supabase.storage.from("facturas-compra").upload(path, factura.file, { upsert: true });
        if (!upErr) {
          const u = { publicUrl: linkArchivo("facturas-compra", path) };
          if (u?.publicUrl) await db.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: factura.file.name }).eq("id", facturaId);
        }
      }
      // Pago: con Visa queda pagada (el gasto va a la tarjeta); si no, va directo a Pagos (sin "Por aprobar").
      let pagoTxt = "va a Pagos";
      if (facturaId && pagaVisa) {
        const visa = tarjetaSugerida(await traerTarjetas(db, sociedadId), { ocConTarjeta: true });
        const r = visa ? await registrarPagoTarjeta(db, facturaId, visa, movimientoPagoTarjeta({
          sociedadId, proveedorId: proveedor.id, facturaId, tarjeta: visa, total: factura.total, moneda: factura.moneda, fecha: factura.fecha || todayAR(),
          comprobante: `${factura.tipo} ${factura.numero.trim()}`, proveedorNombre: proveedor.razon_social,
        })) : { error: "no hay ninguna tarjeta cargada" };
        if (r.error) { toast.warning(`No se pudo registrar el pago con Visa (${r.error}): la factura quedó para Pagos.`); await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion"); }
        else pagoTxt = `pagada con ${visa!.nombre}`;
      } else if (facturaId) {
        await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion");
      }
      const cerradas: string[] = [];
      for (const f of faltantes) if (cerrarOc.has(f.ocId)) {
        const { error: eC } = await db.rpc("cerrar_saldo_oc", { p_sociedad_id: sociedadId, p_oc_id: f.ocId, p_cerrar: true, p_motivo: `Vinieron ${cant(f.vienen)} de ${cant(f.total)}; el resto no llega (FC ${factura.numero.trim()})` });
        cerradas.push(eC ? `${f.ocNumero} no se pudo cerrar (${eC.message})` : f.ocNumero);
      }
      const pendientes = faltantes.filter(f => !cerrarOc.has(f.ocId)).map(f => `${f.ocNumero} (faltan ${cant(f.faltan)})`);
      toast.success([`✔ FC ${factura.numero.trim()} cargada`, pagoTxt, pendientes.length ? pendientes.join(", ") : "", cerradas.length ? `cerrada: ${cerradas.join(", ")}` : "",
        Number(data?.presupuestos_items_actualizados) ? `${data.presupuestos_items_actualizados} costo(s) actualizados en el PR` : ""].filter(Boolean).join(" · "));
      if (data?.aviso) toast.warning(String(data.aviso));
      for (const x of (data?.sin_presupuesto || []) as string[]) toast.warning(`No se encontró en el presupuesto: ${x}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onGuardada?.();
      onClose();
    } catch (e: any) {
      // La factura no se guardó: los renglones recién sumados a las OC se sacan (son de esta misma carga).
      if (insertados.length) await db.from("orden_compra_items").delete().in("id", insertados);
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  // ── Pantalla ──
  const listo = !!factura && !!proveedor && !esNota;
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && !leyendo && !guardando) void leer(f); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Cargar factura</h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {/* Archivo */}
        {!factura && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-8 text-sm text-zinc-500 hover:border-orange-400 dark:border-zinc-600">
            {leyendo ? <span className="flex items-center gap-2 text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /> La IA está leyendo la factura…</span>
              : <><FileUp className="h-6 w-6 text-orange-500" /> Arrastrá la factura acá o hacé clic para elegirla (PDF o foto)</>}
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={leyendo}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void leer(f); }} />
          </label>
        )}

        {factura && (
          <div className="space-y-3">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
              <b>{factura.tipo} {factura.numero || "sin número"}</b>
              <span className="text-zinc-500">{formatDate(factura.fecha || todayAR())}</span>
              <span className="font-medium">{proveedor?.razon_social || factura.razonSocialLeida || "Proveedor"}</span>
              <span className="text-xs text-zinc-500">CUIT {factura.cuit || "?"}</span>
              <span className="ml-auto font-semibold">{plata(factura.total)}</span>
              <button onClick={() => { setFactura(null); setProveedor(null); }} disabled={guardando} className="text-xs text-zinc-500 underline">Otra factura</button>
            </div>
            {otraSociedad && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Está a nombre de {otraSociedad}: cargala desde esa sociedad.</p>}
            {duplicada && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> Esta factura ya está cargada en el sistema.</p>}
            {esNota && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Es una nota de crédito o débito: este botón es para facturas. Cargala desde Órdenes de compra.</p>}
            {!proveedor && !esNota && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> El proveedor {factura.razonSocialLeida ? `«${factura.razonSocialLeida}» ` : ""}no está cargado.
                <button onClick={() => setCrearProv(true)} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white"><UserPlus className="h-3.5 w-3.5" /> Crear proveedor</button>
              </div>
            )}

            {/* OC */}
            {listo && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">¿De qué OC es? Tildá una o más {cargandoOcs && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}</p>
                {!ocsDisponibles.length && !cargandoOcs && <p className="text-sm text-zinc-500">{proveedor?.razon_social} no tiene OC con artículos pendientes.</p>}
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto overflow-x-hidden">
                  {ocsVisibles.map(o => (
                    <label key={o.ocId} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${elegidas.has(o.ocId) ? "border-violet-400 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30" : "border-zinc-200 dark:border-zinc-700"}`}>
                      <input type="checkbox" checked={elegidas.has(o.ocId)} onChange={() => tildar(o.ocId)} />
                      <b className="font-mono">{o.ocNumero}</b>
                      <span className="max-w-[180px] truncate text-zinc-500" title={`${o.pr} ${o.cliente}`}>{o.pr ? `${o.pr} · ` : ""}{o.cliente || formatDate(o.fecha)}</span>
                      <span className="text-zinc-400">{cant(o.unidades)} u.</span>
                      {o.sinProveedor && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{o.esML ? "Mercado Libre" : o.provNombre || "sin proveedor"}</span>}
                    </label>
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                  {todasLasOc && <span className="text-amber-700 dark:text-amber-400">{proveedor?.razon_social} no tiene OC: se muestran todas las OC abiertas.</span>}
                  {conSinProv && <label className="flex items-center gap-1"><input type="checkbox" checked={soloML} onChange={e => setSoloML(e.target.checked)} /> Solo Mercado Libre</label>}
                  {!conSinProv && <button onClick={() => void verSinProveedor()} className="text-zinc-500 underline">Buscar también en OC sin proveedor</button>}
                </div>
              </div>
            )}

            {/* Renglones */}
            {listo && resultado && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">
                  {pensando ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> La IA está comparando con las OC…</> : <><Sparkles className="h-3.5 w-3.5 text-violet-500" /> {avisos ? `${avisos} cosa(s) para mirar. Si no tocás nada, se guarda con la opción marcada.` : "Todo cierra con las OC."}</>}
                </div>
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {renglones.map(r => <Renglon key={r.key} r={r} plata={plata} sug={sugerencia.get(r.key)} elegidas={ocsDisponibles.filter(o => elegidas.has(o.ocId))}
                    reclamar={reclamar.has(r.key)} rechazada={rechazadas.has(r.key)} noEsta={noEsta[r.key]} deMasAparte={deMasAparte.has(r.key)} reparto={repartoEnvio[r.key]}
                    onReclamar={v => setReclamar(p => { const n = new Set(p); if (v) n.add(r.key); else n.delete(r.key); return n; })}
                    onRechazar={v => setRechazadas(p => { const n = new Set(p); if (v) n.add(r.key); else n.delete(r.key); return n; })}
                    onNoEsta={d => { if (d.tipo === "otra") setElegidas(p => new Set(p).add(d.ocId)); setNoEsta(p => ({ ...p, [r.key]: d })); }}
                    onDeMas={aparte => setDeMasAparte(p => { const n = new Set(p); if (aparte) n.add(r.key); else n.delete(r.key); return n; })}
                    onEnvio={(ocId, v) => setEnvioEditado(p => ({ ...p, [r.key]: { ...(p[r.key] || {}), [ocId]: v } }))} />)}
                  {faltantes.map(f => (
                    <li key={f.ocId} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="min-w-0 flex-1"><b className="font-mono">{f.ocNumero}</b>: vienen {cant(f.vienen)} de {cant(f.total)}. Faltan {cant(f.faltan)}.</span>
                      <button onClick={() => setCerrarOc(p => { const n = new Set(p); n.delete(f.ocId); return n; })} className={`${btnNo} ${!cerrarOc.has(f.ocId) ? elegido : ""}`}>Llegan después</button>
                      <button onClick={() => setCerrarOc(p => new Set(p).add(f.ocId))} className={`${btnNo} ${cerrarOc.has(f.ocId) ? elegido : ""}`}>Cerrar la OC en {cant(f.vienen)}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {listo && !resultado && ocsDisponibles.length > 0 && <p className="text-sm text-zinc-500">Tildá la o las OC de esta factura para ver cómo cierra.</p>}

            {listo && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">¿Cómo se paga?</span>
                <label className="flex items-center gap-1"><input type="radio" checked={!pagaVisa} onChange={() => setConVisa(false)} /> Va a Pagos</label>
                <label className="flex items-center gap-1"><input type="radio" checked={pagaVisa} onChange={() => setConVisa(true)} /> <CreditCard className="h-4 w-4 text-blue-600" /> Ya pagada con Visa</label>
                {visaSugerida && conVisa === null && <span className="text-xs text-zinc-500">(la OC es de Mercado Libre o se pagó con tarjeta)</span>}
              </div>
            )}
            {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} disabled={guardando} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-600">Cancelar</button>
              <button onClick={() => void guardar()} disabled={!listo || guardando || leyendo}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar
              </button>
            </div>
          </div>
        )}
        {error && !factura && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      </div>

      <ProveedorFormModal open={crearProv} proveedorId={null} consultarArcaAlAbrir
        inicial={{ cuit: factura?.cuit || "", razon_social: factura?.razonSocialLeida || "", nombre_fantasia: factura?.nombreFantasiaLeido || "" }}
        subtitulo="Se guarda y queda elegido en esta factura."
        onClose={() => setCrearProv(false)}
        onSaved={row => { setCrearProv(false); if (factura) void elegirProveedor({ id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string }, factura); }} />
    </div>
  );
}

/** Vendedor nuevo: renglones pendientes de TODAS las OC abiertas de la sociedad (de otros proveedores o sin proveedor). */
async function cargarLineasAbiertas(db: any, sociedadId: string, proveedorId: string): Promise<Linea[]> {
  const { data: ocs, error } = await db.from("ordenes_compra").select("id, numero, fecha, estado, moneda, saldo_cerrado, proveedor_id")
    .eq("sociedad_id", sociedadId).neq("estado", "cancelada").order("fecha");
  if (error) throw error;
  const abiertas = (ocs || []).filter((o: any) => !o.saldo_cerrado && o.proveedor_id !== proveedorId);
  const porId = new Map<string, any>(abiertas.map((o: any) => [o.id, o]));
  const out: Linea[] = [];
  for (let i = 0; i < abiertas.length; i += 100) {
    const { data: ls, error: e2 } = await db.from("orden_compra_items_pendientes").select("id, orden_id, codigo, descripcion, cantidad_pendiente, precio_unitario")
      .in("orden_id", abiertas.slice(i, i + 100).map((o: any) => o.id));
    if (e2) throw e2;
    for (const l of ls || []) {
      const o = porId.get(l.orden_id); const c = round2(Number(l.cantidad_pendiente));
      if (!o || !(c > 0)) continue;
      out.push({ id: l.id, ocId: o.id, ocNumero: o.numero, ocFecha: o.fecha || "", codigo: l.codigo, descripcion: l.descripcion, descripcionOc: l.descripcion,
        cantidad: c, precio: Number(l.precio_unitario) || 0, moneda: o.moneda || "ARS", ocEstado: o.estado || "", sinProveedor: true });
    }
  }
  return out;
}

function lineasDe(f: FacturaCarga): InvoiceLineInput[] {
  const ref = f.numero || f.localId;
  return f.items.map((it, i) => ({ key: lineKey(f, i), facturaRef: ref, codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio: round2(it.precio_unitario * (1 - (it.descuento_porcentaje || 0) / 100)) }));
}

/** Un renglón de la factura: qué pasó y, si hace falta, botones cortos. */
function Renglon({ r, plata, sug, elegidas, reclamar, rechazada, noEsta, deMasAparte, reparto, onReclamar, onRechazar, onNoEsta, onDeMas, onEnvio }: {
  r: RenglonVista; plata: (n: number) => string; sug?: { l: Linea; libre: number }; elegidas: OcResumen[];
  reclamar: boolean; rechazada: boolean; noEsta?: NoEsta; deMasAparte: boolean; reparto?: Array<{ ocId: string; ocNumero: string; monto: number }>;
  onReclamar: (v: boolean) => void; onRechazar: (v: boolean) => void; onNoEsta: (d: NoEsta) => void; onDeMas: (aparte: boolean) => void; onEnvio: (ocId: string, v: string) => void;
}) {
  const ocs = [...new Set(r.asignaciones.map(a => a.ocNumero))].join(", ");
  const ok = r.tipo === "ok" && r.compara !== "mayor" && !r.deMas;
  return (
    <li className="px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2">
        {r.tipo === "envio" ? <Truck className="h-4 w-4 text-sky-600" /> : ok ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
        <span className="min-w-0 flex-1"><b>{cant(r.cantidad)}</b> × {r.descripcion} <span className="text-xs text-zinc-400">{plata(r.precio)}</span></span>
        {r.tipo !== "envio" && r.tipo !== "no_esta" && <span className="font-mono text-xs text-zinc-500">→ {ocs}</span>}
      </div>
      <div className="ml-6 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
        {r.tipo === "dudoso" && <>
          <span>La IA lo tomó como «{r.asignaciones[0]?.descripcionOc}»{r.motivoIA ? ` (${r.motivoIA.slice(0, 80)})` : ""}.</span>
          <button onClick={() => onRechazar(false)} className={`${btnNo} ${!rechazada ? elegido : ""}`}>Sí, es ese</button>
          <button onClick={() => onRechazar(true)} className={btnNo}>No es</button>
        </>}
        {r.compara === "mayor" && <>
          <span>Precio: OC {plata(r.precioOc)} → factura {plata(r.precio)} (+{String(r.pct).replace(".", ",")} %).</span>
          <button onClick={() => onReclamar(false)} className={`${btnNo} ${!reclamar ? elegido : ""}`}>Actualizar costo</button>
          <button onClick={() => onReclamar(true)} className={`${btnNo} ${reclamar ? elegido : ""}`}>Reclamar al proveedor</button>
        </>}
        {r.compara === "menor" && <span className="text-emerald-700 dark:text-emerald-400">💚 Costo menor: OC {plata(r.precioOc)} → {plata(r.precio)} ({String(r.pct).replace(".", ",")} %). Se actualiza en la OC y el PR.</span>}
        {r.compara === "otra_moneda" && <span className="text-amber-700">La OC está en otra moneda: el costo no se cambia.</span>}
        {r.deMas > 0 && <>
          <span>Vienen {cant(r.deMas)} de más.</span>
          <button onClick={() => onDeMas(false)} className={`${btnNo} ${!deMasAparte ? elegido : ""}`} disabled={!r.deMasOcLineId}>Sumarlas a la OC</button>
          <button onClick={() => onDeMas(true)} className={`${btnNo} ${deMasAparte || !r.deMasOcLineId ? elegido : ""}`}>Va aparte</button>
        </>}
        {r.tipo === "no_esta" && <>
          <span>{rechazada ? "No es lo de la OC." : "No está en las OC tildadas."}</span>
          {sug && sug.libre > 0 && <button onClick={() => onNoEsta({ tipo: "otra", ocLineId: sug.l.id, ocId: sug.l.ocId, cantidad: Math.min(r.cantidad, sug.libre) })} className={btnSi}>Es «{sug.l.descripcion.slice(0, 40)}» de la {sug.l.ocNumero}</button>}
          {elegidas.map(o => <button key={o.ocId} onClick={() => onNoEsta({ tipo: "agregar", ocId: o.ocId })} className={`${btnNo} ${noEsta?.tipo === "agregar" && noEsta.ocId === o.ocId ? elegido : ""}`}>Agregarlo a la {o.ocNumero}</button>)}
          <button onClick={() => onNoEsta({ tipo: "aparte" })} className={`${btnNo} ${!noEsta || noEsta.tipo === "aparte" ? elegido : ""}`}>Va aparte</button>
        </>}
        {r.tipo === "envio" && (reparto?.length ? <>
          <span>Se suma a la OC:</span>
          {reparto.map(p => (
            <label key={p.ocId} className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 dark:bg-sky-950/30">
              <span className="font-mono">{p.ocNumero}</span>
              <input defaultValue={String(p.monto).replace(".", ",")} onChange={e => onEnvio(p.ocId, e.target.value)} inputMode="decimal"
                className="w-24 rounded border border-zinc-300 bg-white px-1 text-right dark:border-zinc-600 dark:bg-zinc-900" />
            </label>
          ))}
          {Math.abs(reparto.reduce((t, p) => t + p.monto, 0) - r.precio * r.cantidad) > 0.01 && <span className="text-amber-700">Suma {plata(reparto.reduce((t, p) => t + p.monto, 0))} y el envío es {plata(r.precio * r.cantidad)}.</span>}
        </> : <span>Tildá una OC para sumarle el envío.</span>)}
      </div>
    </li>
  );
}
