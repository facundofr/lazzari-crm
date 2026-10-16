"use client";

/**
 * Remitos nueva (al nivel de Compras nueva). Solo la ven los usuarios con la casilla "Prueba: Remitos nueva".
 * - Para entregar: PR con lo que falta entregar. "Listo" si llegó todo lo comprado → un clic "Hacer remito".
 *   Si llegó una parte: "Entregar lo que llegó". Se puede ajustar cantidades y sucursal antes.
 * - En camino: remitos pendientes con los días (amarillo ≥3, rojo ≥10), quién lo lleva, Entregado / Parcial,
 *   y la foto del remito firmado (la IA la lee, lo marca entregado y avisa al vendedor; si anotaron faltantes, pregunta).
 * - Preguntas: PR facturados sin remito, remitos sin PR, remitos pendientes viejos. Un clic para responder.
 * - "Decile a la IA": pedidos en palabras → muestra qué haría → "Hacerlo". Todo con Deshacer.
 * El remito sale igual que desde Presupuestos (Remito R con CAI si el PR no es manual). ARCA no se toca: se autoriza desde Remitos.
 * Nada frena: son avisos.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { useToast } from "@/components/ui/toast";
import { Autocompletar } from "@/components/ui/autocompletar";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatDate, todayAR } from "@/lib/utils";
import { diasDesde } from "@/lib/compras-armado";
import {
  renglonesParaEntregar, estadoEntrega, cantidadesRemito, semaforoEnCamino, sugerirPRParaRemito, atarRenglones, remitoDeLaFoto,
  DIAS_REMITO_VIEJO, DIAS_VOLVER_A_PREGUNTAR, type RenglonEntrega, type EstadoEntrega,
} from "@/lib/remitos-armado";
import { Camera, Check, ExternalLink, Loader2, PackageCheck, RefreshCw, Send, Sparkles, Truck, Undo2 } from "lucide-react";

const db = supabase as any;

type PR = {
  id: string; numero: string; cliente_id: string | null; estado: string; fecha: string | null; created_at: string;
  sucursal_id: string | null; modalidad_emision: string | null; oc_cliente: string | null; total: number | null; subtotal: number | null;
  vendedor_id: string | null; created_by: string | null;
};
type PRItem = { id: string; presupuesto_id: string; descripcion: string; cantidad: number; unidad: string | null; orden: number | null };
type Remito = {
  id: string; numero: string | null; cliente_id: string | null; presupuesto_id: string | null; fecha: string; estado: string;
  tipo_remito: string | null; cai_numero: string | null; nro_comprobante_cai: number | null; cae: string | null; oc_cliente: string | null;
  sucursal_id: string | null; transportista_id: string | null; observaciones: string | null; created_at: string;
  entregado_at?: string | null; entregado_por?: string | null; recibio?: string | null; foto_url?: string | null; foto_ia?: any; nota_ia?: string | null;
};
type RemitoItem = { id: string; remito_id: string; descripcion: string; cantidad: number; unidad: string | null; orden: number | null; presupuesto_item_id: string | null };
type Sucursal = { id: string; cliente_id: string; nombre: string; direccion: string | null; localidad: string | null };
type Respuesta = { id: string; tipo: string; entidad_id: string; respuesta: string; preguntar_desde: string | null };
type Deshacer = { id: number; texto: string; fn: () => Promise<void> };
type Accion =
  | { tipo: "crear_remito"; pr_id: string; sucursal_id: string | null; items: { presupuesto_item_id: string; cantidad: number }[]; motivo: string }
  | { tipo: "entregado"; remito_id: string; motivo: string }
  | { tipo: "ya_entregado_sin_remito"; pr_id: string; motivo: string }
  | { tipo: "transporte"; remito_id: string; transportista_id: string; motivo: string };
type FotoLeida = {
  key: string; nombre: string; url: string | null; remito_id: string | null; error?: string; aplicado?: boolean;
  numero?: string | null; cliente?: string | null; fecha_recibido?: string | null; firmado?: boolean; recibio?: string | null;
  anotaciones?: string | null; faltantes?: { descripcion: string; cantidad: number; presupuesto_item_id: string | null }[]; conforme?: boolean; resumen?: string;
};

const SEL_REMITO_BASE = "id, numero, cliente_id, presupuesto_id, fecha, estado, tipo_remito, cai_numero, nro_comprobante_cai, cae, oc_cliente, sucursal_id, transportista_id, observaciones, created_at";
const SEL_REMITO_NUEVO = `${SEL_REMITO_BASE}, entregado_at, entregado_por, recibio, foto_url, foto_ia, nota_ia`;
const ESTADO_TEXTO: Record<EstadoEntrega, string> = { listo: "Listo", parcial: "Llegó una parte", esperando: "Esperando compras", sin_compra: "Sin OC", completo: "Entregado" };
const ESTADO_COLOR: Record<EstadoEntrega, string> = {
  listo: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  parcial: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  esperando: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  sin_compra: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  completo: "bg-zinc-100 text-zinc-500",
};
const ORDEN_ESTADO: Record<EstadoEntrega, number> = { listo: 0, parcial: 1, sin_compra: 2, esperando: 3, completo: 4 };
const hace = (dias: number) => (dias <= 0 ? "hoy" : dias === 1 ? "ayer" : `hace ${dias} días`);
const cant = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString("es-AR", { maximumFractionDigits: 3 }));
const sumarDias = (iso: string, dias: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };

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

/** Achica la foto (lado mayor 1600 px, JPG) para que suba rápido y la IA la lea igual. Los PDF van como están. */
async function prepararArchivo(file: File): Promise<{ blob: Blob; mediaType: string; base64: string; ext: string }> {
  const aBase64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b); });
  if (file.type === "application/pdf") return { blob: file, mediaType: "application/pdf", base64: await aBase64(file), ext: "pdf" };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("No se pudo abrir la foto")); i.src = url; });
    const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo preparar la foto"))), "image/jpeg", 0.82));
    return { blob, mediaType: "image/jpeg", base64: await aBase64(blob), ext: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function RemitosNuevaPage() {
  const { profile, sociedadActiva } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [tab, setTab] = useState<"entregar" | "camino" | "preguntas">("entregar");
  const [prs, setPrs] = useState<PR[]>([]);
  const [prItems, setPrItems] = useState<PRItem[]>([]);
  const [remitos, setRemitos] = useState<Remito[]>([]);
  const [remitoItems, setRemitoItems] = useState<RemitoItem[]>([]);
  const [ocs, setOcs] = useState<{ id: string; presupuesto_origen_id: string; estado: string }[]>([]);
  const [ocItems, setOcItems] = useState<{ orden_id: string; presupuesto_item_id: string | null; cantidad: number; cantidad_recibida: number | null }[]>([]);
  const [clientes, setClientes] = useState<Record<string, string>>({});
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [transportistas, setTransportistas] = useState<{ id: string; nombre: string }[]>([]);
  const [respuestas, setRespuestas] = useState<Respuesta[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  // Ajustes antes de hacer el remito: cantidades por renglón y sucursal.
  const [ajuste, setAjuste] = useState<Record<string, { cant: Record<string, number>; sucursal: string }>>({});
  // PR que salen como remito interno sin CAI (no gasta número de CAI).
  const [sinCai, setSinCai] = useState<Record<string, boolean>>({});
  const [parcial, setParcial] = useState<{ remitoId: string; cant: Record<string, number>; nota: string } | null>(null);
  const [eligiendoTrans, setEligiendoTrans] = useState<string | null>(null);
  const [deshacer, setDeshacer] = useState<Deshacer[]>([]);
  const [instruccion, setInstruccion] = useState("");
  const [pensando, setPensando] = useState(false);
  const [propuesta, setPropuesta] = useState<{ explicacion: string; acciones: Accion[] } | null>(null);
  const [fotos, setFotos] = useState<FotoLeida[]>([]);
  const [leyendo, setLeyendo] = useState(0);
  const inputFoto = useRef<HTMLInputElement>(null);
  const fotoPara = useRef<string | null>(null);
  const contador = useRef(0);

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setCargando(true);
    setError("");
    try {
      const prsVivos = await traerTodo<PR>(() => db.from("presupuestos")
        .select("id, numero, cliente_id, estado, fecha, created_at, sucursal_id, modalidad_emision, oc_cliente, total, subtotal, vendedor_id, created_by")
        .eq("sociedad_id", sociedadId).in("estado", ["aprobado", "facturar", "facturado"]).order("id"));
      let rems: Remito[];
      let falta = false;
      try {
        rems = await traerTodo<Remito>(() => db.from("remitos").select(SEL_REMITO_NUEVO).eq("sociedad_id", sociedadId).order("id"));
      } catch (e: any) {
        if (!/column|entregado_at|foto_url/i.test(e?.message || "")) throw e;
        falta = true;
        rems = await traerTodo<Remito>(() => db.from("remitos").select(SEL_REMITO_BASE).eq("sociedad_id", sociedadId).order("id"));
      }
      // PR de los remitos que no están entre los vivos (ej. remitos de PR viejos): solo para mostrar el número.
      const prIds = prsVivos.map((p) => p.id);
      const [its, rits, ocsPR, trans, perfiles] = await Promise.all([
        enTandas<PRItem>(prIds, (t) => db.from("presupuesto_items").select("id, presupuesto_id, descripcion, cantidad, unidad, orden").in("presupuesto_id", t).order("orden")),
        enTandas<RemitoItem>(rems.map((r) => r.id), (t) => db.from("remito_items").select("id, remito_id, descripcion, cantidad, unidad, orden, presupuesto_item_id").in("remito_id", t).order("orden")),
        enTandas<{ id: string; presupuesto_origen_id: string; estado: string }>(prIds, (t) => db.from("ordenes_compra").select("id, presupuesto_origen_id, estado").in("presupuesto_origen_id", t).eq("sociedad_id", sociedadId)),
        db.from("transportistas").select("id, nombre").eq("activo", true).order("nombre"),
        db.from("profiles").select("id, full_name"),
      ]);
      const ocIts = await enTandas<any>(ocsPR.map((o) => o.id), (t) => db.from("orden_compra_items").select("orden_id, presupuesto_item_id, cantidad, cantidad_recibida").in("orden_id", t));
      const clienteIds = [...prsVivos.map((p) => p.cliente_id || ""), ...rems.map((r) => r.cliente_id || "")];
      const [clis, sucs] = await Promise.all([
        enTandas<{ id: string; razon_social: string }>(clienteIds, (t) => db.from("clientes").select("id, razon_social").in("id", t)),
        enTandas<Sucursal>(prsVivos.map((p) => p.cliente_id || ""), (t) => db.from("cliente_sucursales").select("id, cliente_id, nombre, direccion, localidad").in("cliente_id", t).eq("activo", true).order("principal", { ascending: false })),
      ]);
      let resp: Respuesta[] = [];
      if (!falta) {
        const { data: rs, error: eR } = await db.from("remito_respuestas").select("id, tipo, entidad_id, respuesta, preguntar_desde").eq("sociedad_id", sociedadId).eq("anulada", false);
        if (eR) falta = true; else resp = rs || [];
      }
      setPrs(prsVivos);
      setPrItems(its);
      setRemitos(rems);
      setRemitoItems(rits);
      setOcs(ocsPR);
      setOcItems(ocIts);
      setClientes(Object.fromEntries(clis.map((c) => [c.id, c.razon_social])));
      setSucursales(sucs);
      setTransportistas((trans.data || []) as { id: string; nombre: string }[]);
      setNombres(Object.fromEntries(((perfiles.data || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || ""])));
      setRespuestas(resp);
      setFaltaMigracion(falta);
    } catch (e: any) {
      setError(e?.message || "No se pudieron traer los remitos");
    } finally {
      setCargando(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  // ── Derivados ──────────────────────────────────────────────────
  const hoy = todayAR();
  const prPorId = useMemo(() => Object.fromEntries(prs.map((p) => [p.id, p])), [prs]);
  const remitoPorId = useMemo(() => Object.fromEntries(remitos.map((r) => [r.id, r])), [remitos]);
  const itemsDeRemito = useMemo(() => {
    const m: Record<string, RemitoItem[]> = {};
    for (const it of remitoItems) (m[it.remito_id] ||= []).push(it);
    return m;
  }, [remitoItems]);
  const remitosDePR = useMemo(() => {
    const m: Record<string, Remito[]> = {};
    for (const r of remitos) if (r.presupuesto_id) (m[r.presupuesto_id] ||= []).push(r);
    return m;
  }, [remitos]);
  const respuestaDe = useCallback((tipo: string, id: string) => respuestas.find((r) => r.tipo === tipo && r.entidad_id === id) || null, [respuestas]);
  const sucursalesDe = useCallback((clienteId: string | null) => sucursales.filter((s) => s.cliente_id === clienteId), [sucursales]);
  const nombreTrans = useCallback((id: string | null) => transportistas.find((t) => t.id === id)?.nombre || null, [transportistas]);

  /** Renglones y estado de entrega de cada PR. */
  const entregas = useMemo(() => {
    const itsPR: Record<string, PRItem[]> = {};
    for (const it of prItems) (itsPR[it.presupuesto_id] ||= []).push(it);
    const ocsPR: Record<string, { id: string; estado: string }[]> = {};
    for (const o of ocs) (ocsPR[o.presupuesto_origen_id] ||= []).push(o);
    const estadoOC = Object.fromEntries(ocs.map((o) => [o.id, o.estado]));
    const ocItsPorOC: Record<string, typeof ocItems> = {};
    for (const it of ocItems) (ocItsPorOC[it.orden_id] ||= []).push(it);
    const out: Record<string, { renglones: RenglonEntrega[]; estado: EstadoEntrega }> = {};
    for (const p of prs) {
      const remitidos = (remitosDePR[p.id] || []).flatMap((r) => itemsDeRemito[r.id] || []);
      const lineasOC = (ocsPR[p.id] || []).flatMap((o) => (ocItsPorOC[o.id] || []).map((i) => ({ ...i, estado_oc: estadoOC[o.id] })));
      const renglones = renglonesParaEntregar(itsPR[p.id] || [], remitidos, lineasOC, ocsPR[p.id] || []);
      out[p.id] = { renglones, estado: estadoEntrega(renglones) };
    }
    return out;
  }, [prs, prItems, ocs, ocItems, remitosDePR, itemsDeRemito]);

  const paraEntregar = useMemo(() => prs.filter((p) => {
    const e = entregas[p.id];
    if (!e || e.estado === "completo" || !e.renglones.length) return false;
    const r = respuestaDe("pr_sin_remito", p.id);
    if (r?.respuesta === "entregado_sin_remito") return false;
    // Facturado y sin ningún remito: primero se pregunta (puede ser una venta vieja que se entregó sin remito).
    if (p.estado === "facturado" && !(remitosDePR[p.id] || []).length && r?.respuesta !== "falta_entregar") return false;
    return true;
  }).sort((a, b) => ORDEN_ESTADO[entregas[a.id].estado] - ORDEN_ESTADO[entregas[b.id].estado] || String(a.fecha || a.created_at).localeCompare(String(b.fecha || b.created_at))),
  [prs, entregas, respuestaDe, remitosDePR]);

  const enCamino = useMemo(() => remitos.filter((r) => r.estado === "pendiente")
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))), [remitos]);

  const pregPR = useMemo(() => prs.filter((p) => p.estado === "facturado" && !(remitosDePR[p.id] || []).length
    && entregas[p.id] && entregas[p.id].estado !== "completo" && !respuestaDe("pr_sin_remito", p.id))
    .sort((a, b) => String(b.fecha || b.created_at).localeCompare(String(a.fecha || a.created_at))), [prs, remitosDePR, entregas, respuestaDe]);
  const pregSinPR = useMemo(() => remitos.filter((r) => !r.presupuesto_id && r.tipo_remito !== "muestra" && !/Tipo:\s*Muestra/i.test(r.observaciones || "") && !respuestaDe("remito_sin_pr", r.id)), [remitos, respuestaDe]);
  const pregViejos = useMemo(() => enCamino.filter((r) => {
    if ((diasDesde(r.fecha) ?? 0) < DIAS_REMITO_VIEJO) return false;
    const resp = respuestaDe("remito_viejo", r.id);
    return !resp || (resp.preguntar_desde ? resp.preguntar_desde <= hoy : false);
  }), [enCamino, respuestaDe, hoy]);
  const totalPreguntas = pregPR.length + pregSinPR.length + pregViejos.length;

  const nombreCliente = (id: string | null) => clientes[id || ""] || "Cliente";
  const numeroPR = (id: string | null) => (id ? prPorId[id]?.numero : null) || null;

  // ── Deshacer ───────────────────────────────────────────────────
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

  // ── Acciones ───────────────────────────────────────────────────
  /** Crea el remito igual que "Remitar" de Presupuestos (Remito R con CAI si el PR no es manual). Devuelve el número o null. */
  async function crearRemito(pr: PR, items: { presupuesto_item_id: string; descripcion: string; unidad: string; orden: number; cantidad: number }[], sucursalId: string | null, nota: string, sinNumeroCai = false): Promise<string | null> {
    if (!sociedadId || !items.length) return null;
    let cai: { cai_numero: string; punto_venta: number; nro_comprobante: number } | null = null;
    if (pr.modalidad_emision !== "manual" && !sinNumeroCai) {
      const { data: caiRows } = await db.rpc("next_cai_number", { p_sociedad_id: sociedadId, p_tipo: "remito_r" });
      if (caiRows && caiRows.length > 0) cai = caiRows[0];
    }
    const valor = Number(pr.total) || Number(pr.subtotal) || null;
    const insert: Record<string, unknown> = {
      numero: null, cliente_id: pr.cliente_id, fecha: todayAR(), estado: "pendiente", sociedad_id: sociedadId,
      observaciones: `Generado desde presupuesto ${pr.numero} (Remitos nueva)${sinNumeroCai ? " · Interno sin CAI" : ""}${nota ? ` · ${nota}` : ""}`,
      presupuesto_id: pr.id, created_by: profile?.id || null, oc_cliente: pr.oc_cliente || null,
      valor_declarado: valor, tipo_remito: "interno", sucursal_id: sucursalId || pr.sucursal_id || null,
    };
    if (!faltaMigracion && nota) insert.nota_ia = nota;
    if (cai) { insert.cai_numero = cai.cai_numero; insert.punto_venta_cai = cai.punto_venta; insert.nro_comprobante_cai = cai.nro_comprobante; }
    const { data: rem, error: e1 } = await db.from("remitos").insert(insert).select("id, numero").single();
    if (e1 || !rem) { toast.error(`${pr.numero}: no se pudo crear el remito (${e1?.message || "sin datos"})`); return null; }
    const { error: e2 } = await db.from("remito_items").insert(items.map((it) => ({
      remito_id: rem.id, descripcion: it.descripcion, cantidad: it.cantidad, unidad: it.unidad || "UN", orden: it.orden, presupuesto_item_id: it.presupuesto_item_id,
    })));
    if (e2) {
      await db.from("remitos").delete().eq("id", rem.id).eq("sociedad_id", sociedadId);
      toast.error(`${pr.numero}: no se pudieron guardar los renglones (${e2.message}); no quedó el remito`);
      return null;
    }
    anotarDeshacer(`remito ${rem.numero || ""} de ${pr.numero}`, async () => {
      const { data: actual } = await db.from("remitos").select("cae, estado").eq("id", rem.id).single();
      if (actual?.cae) throw new Error("ya está autorizado en ARCA: anulalo desde Remitos");
      const { error: a } = await db.from("remito_items").delete().eq("remito_id", rem.id);
      if (a) throw a;
      const { error: b } = await db.from("remitos").delete().eq("id", rem.id).eq("sociedad_id", sociedadId);
      if (b) throw b;
      if (cai) toast.warning(`El número de CAI ${cai.nro_comprobante} quedó usado (sin remito)`);
    });
    return rem.numero || "nuevo";
  }

  function itemsParaPR(pr: PR, modo: "todo" | "llego") {
    const e = entregas[pr.id];
    const aj = ajuste[pr.id];
    if (aj) {
      return e.renglones
        .map((r) => ({ presupuesto_item_id: r.presupuesto_item_id, descripcion: r.descripcion, unidad: r.unidad, orden: r.orden, cantidad: Math.min(r.pendiente, Math.max(0, Number(aj.cant[r.presupuesto_item_id] ?? 0))) }))
        .filter((r) => r.cantidad > 0);
    }
    return cantidadesRemito(e.renglones, modo);
  }

  async function hacerRemito(pr: PR, modo: "todo" | "llego") {
    const items = itemsParaPR(pr, modo);
    if (!items.length) { toast.warning(`${pr.numero}: no hay nada para entregar con esas cantidades`); return; }
    const suc = ajuste[pr.id]?.sucursal || pr.sucursal_id || null;
    const sucNombre = suc ? sucursales.find((s) => s.id === suc)?.nombre : null;
    const detalle = items.slice(0, 8).map((i) => `• ${cant(i.cantidad)} ${i.descripcion}`).join("\n") + (items.length > 8 ? `\n… y ${items.length - 8} más` : "");
    if (!window.confirm(`¿Hacer el remito${sinCai[pr.id] ? " interno (sin CAI)" : ""} de ${pr.numero} para ${nombreCliente(pr.cliente_id)}${sucNombre ? ` (${sucNombre})` : ""}?\n\n${detalle}`)) return;
    setOcupado(pr.id);
    try {
      const nro = await crearRemito(pr, items, suc, ajuste[pr.id] ? "Cantidades ajustadas" : modo === "llego" ? "Lo que llegó" : "", !!sinCai[pr.id]);
      if (nro) {
        toast.success(`Remito ${nro} listo: imprimilo desde Remitos (queda "En camino")`);
        setAjuste((prev) => { const n = { ...prev }; delete n[pr.id]; return n; });
        setAbierto(null);
      }
    } finally { setOcupado(null); await cargar(); }
  }

  /** Avisa al vendedor del PR (campanita), si no es el mismo que marca la entrega. */
  async function avisarVendedor(r: Remito, texto: string) {
    const pr = r.presupuesto_id ? prPorId[r.presupuesto_id] : null;
    const destino = pr?.vendedor_id || pr?.created_by || null;
    if (!destino || destino === profile?.id) return;
    await db.from("alertas").insert({
      tipo: "seguimiento", title: `Entregado: ${pr?.numero || r.numero}`, description: texto,
      entity_id: r.id, entity_type: "remito", module: "remitos", user_id: destino, sociedad_id: sociedadId || null,
    });
  }

  async function marcarEntregado(r: Remito, extra: { recibio?: string | null; foto_url?: string | null; foto_ia?: any; nota_ia?: string | null } = {}, silencioso = false): Promise<boolean> {
    const cambios: Record<string, unknown> = { estado: "entregado" };
    if (!faltaMigracion) {
      cambios.entregado_at = new Date().toISOString();
      cambios.entregado_por = profile?.id || null;
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== "") cambios[k] = v;
    }
    const { error: e } = await db.from("remitos").update(cambios).eq("id", r.id).eq("sociedad_id", sociedadId);
    if (e) { toast.error(`${r.numero}: no se pudo marcar entregado (${e.message})`); return false; }
    const antes: Record<string, unknown> = { estado: r.estado };
    if (!faltaMigracion) for (const k of Object.keys(cambios)) if (k !== "estado") antes[k] = (r as any)[k] ?? null;
    anotarDeshacer(`entregado ${r.numero}`, async () => {
      const { error: u } = await db.from("remitos").update(antes).eq("id", r.id).eq("sociedad_id", sociedadId);
      if (u) throw u;
    });
    const quien = extra.recibio ? ` · recibió ${extra.recibio}` : "";
    await avisarVendedor(r, `${profile?.full_name || "Alguien"} marcó entregado el remito ${r.numero} a ${nombreCliente(r.cliente_id)}${quien}`).catch(() => {});
    if (!silencioso) toast.success(`${r.numero} entregado${quien}`);
    return true;
  }

  async function entregado(r: Remito) {
    setOcupado(r.id);
    try { await marcarEntregado(r); } finally { setOcupado(null); await cargar(); }
  }

  function abrirParcial(r: Remito, faltantes: { presupuesto_item_id: string | null; descripcion: string; cantidad: number }[] = [], nota = "") {
    const its = itemsDeRemito[r.id] || [];
    const c: Record<string, number> = {};
    for (const it of its) {
      const f = faltantes.find((x) => (x.presupuesto_item_id && x.presupuesto_item_id === it.presupuesto_item_id));
      c[it.id] = Math.max(0, Number(it.cantidad) - (f ? f.cantidad : 0));
    }
    setParcial({ remitoId: r.id, cant: c, nota });
    setTab("camino");
  }

  /**
   * Entrega parcial, igual que en Remitos: el remito queda "parcial" con lo entregado y lo que falta pasa a un remito nuevo "pendiente".
   * No se puede deshacer de un clic (hay un remito nuevo): se confirma antes.
   */
  async function guardarParcial() {
    if (!parcial || !sociedadId) return;
    const r = remitoPorId[parcial.remitoId];
    if (!r) return;
    const its = itemsDeRemito[r.id] || [];
    const faltan = its.filter((it) => (parcial.cant[it.id] ?? Number(it.cantidad)) < Number(it.cantidad));
    if (!faltan.length) { setOcupado(r.id); try { await marcarEntregado(r, { nota_ia: parcial.nota || null }); setParcial(null); } finally { setOcupado(null); await cargar(); } return; }
    const resumen = faltan.map((it) => `• faltan ${cant(Number(it.cantidad) - (parcial.cant[it.id] ?? 0))} ${it.descripcion}`).join("\n");
    if (!window.confirm(`${r.numero} queda como entregado en parte y lo que falta va a un remito nuevo "En camino":\n\n${resumen}\n\n¿Seguir?`)) return;
    setOcupado(r.id);
    try {
      for (const it of its) {
        const entregadoCant = Math.max(0, Math.min(Number(it.cantidad), parcial.cant[it.id] ?? Number(it.cantidad)));
        if (entregadoCant === Number(it.cantidad)) continue;
        if (entregadoCant === 0) { const { error: e } = await db.from("remito_items").delete().eq("id", it.id).eq("remito_id", r.id); if (e) throw e; }
        else { const { error: e } = await db.from("remito_items").update({ cantidad: entregadoCant }).eq("id", it.id).eq("remito_id", r.id); if (e) throw e; }
      }
      const cambios: Record<string, unknown> = { estado: "parcial" };
      if (!faltaMigracion) { cambios.entregado_at = new Date().toISOString(); cambios.entregado_por = profile?.id || null; if (parcial.nota) cambios.nota_ia = parcial.nota; }
      const { error: eU } = await db.from("remitos").update(cambios).eq("id", r.id).eq("sociedad_id", sociedadId);
      if (eU) throw eU;
      let cai: { cai_numero: string; punto_venta: number; nro_comprobante: number } | null = null;
      if (r.cai_numero) {
        const { data: caiRows } = await db.rpc("next_cai_number", { p_sociedad_id: sociedadId, p_tipo: "remito_r" });
        if (caiRows && caiRows.length > 0) cai = caiRows[0];
      }
      const ins: Record<string, unknown> = {
        numero: null, cliente_id: r.cliente_id, fecha: todayAR(), estado: "pendiente", sociedad_id: sociedadId,
        observaciones: `Saldo pendiente de remito ${r.numero}`, presupuesto_id: r.presupuesto_id, created_by: profile?.id || null,
        oc_cliente: r.oc_cliente, sucursal_id: r.sucursal_id, tipo_remito: r.tipo_remito || "interno", transportista_id: r.transportista_id,
      };
      if (cai) { ins.cai_numero = cai.cai_numero; ins.punto_venta_cai = cai.punto_venta; ins.nro_comprobante_cai = cai.nro_comprobante; }
      const { data: nuevo, error: eN } = await db.from("remitos").insert(ins).select("id, numero").single();
      if (eN || !nuevo) throw new Error(eN?.message || "no se pudo crear el remito con lo que falta");
      const { error: eI } = await db.from("remito_items").insert(faltan.map((it) => ({
        remito_id: nuevo.id, descripcion: it.descripcion, cantidad: Number(it.cantidad) - (parcial.cant[it.id] ?? 0), unidad: it.unidad || "UN", orden: it.orden, presupuesto_item_id: it.presupuesto_item_id,
      })));
      if (eI) throw eI;
      await avisarVendedor(r, `${profile?.full_name || "Alguien"} entregó en parte el remito ${r.numero}; lo que falta quedó en ${nuevo.numero}`).catch(() => {});
      toast.success(`${r.numero} entregado en parte; lo que falta quedó en ${nuevo.numero}`);
      setParcial(null);
    } catch (e: any) {
      toast.error(`${r.numero}: ${e?.message || "no se pudo guardar la entrega parcial"} (revisalo en Remitos)`);
    } finally { setOcupado(null); await cargar(); }
  }

  async function ponerTransporte(r: Remito, transportistaId: string) {
    const antes = r.transportista_id;
    const { error: e } = await db.from("remitos").update({ transportista_id: transportistaId }).eq("id", r.id).eq("sociedad_id", sociedadId);
    if (e) { toast.error(`No se pudo: ${e.message}`); return false; }
    anotarDeshacer(`${r.numero} lo lleva ${nombreTrans(transportistaId)}`, async () => {
      const { error: u } = await db.from("remitos").update({ transportista_id: antes }).eq("id", r.id).eq("sociedad_id", sociedadId);
      if (u) throw u;
    });
    return true;
  }

  async function responder(tipo: "pr_sin_remito" | "remito_sin_pr" | "remito_viejo", entidadId: string, respuesta: string, texto: string, preguntarDesde: string | null = null) {
    if (faltaMigracion) { toast.error("Falta correr la migración de Remitos nueva"); return false; }
    const { data, error: e } = await db.from("remito_respuestas").insert({
      sociedad_id: sociedadId, tipo, entidad_id: entidadId, respuesta, preguntar_desde: preguntarDesde, created_by: profile?.id || null,
    }).select("id").single();
    if (e || !data) { toast.error(`No se pudo guardar la respuesta: ${e?.message || ""}`); return false; }
    anotarDeshacer(texto, async () => {
      const { error: u } = await db.from("remito_respuestas").update({ anulada: true }).eq("id", data.id);
      if (u) throw u;
    });
    return true;
  }

  async function responderPR(p: PR, respuesta: "entregado_sin_remito" | "falta_entregar") {
    setOcupado(p.id);
    try {
      if (await responder("pr_sin_remito", p.id, respuesta, `${p.numero}: ${respuesta === "entregado_sin_remito" ? "ya se entregó" : "falta entregar"}`)) {
        toast.success(respuesta === "entregado_sin_remito" ? `${p.numero}: listo, no se pregunta más` : `${p.numero} pasó a "Para entregar"`);
      }
    } finally { setOcupado(null); await cargar(); }
  }

  async function asignarPR(r: Remito, prId: string) {
    const pr = prPorId[prId];
    if (!pr) return;
    setOcupado(r.id);
    try {
      const its = itemsDeRemito[r.id] || [];
      const atados = atarRenglones(its.filter((i) => !i.presupuesto_item_id), prItems.filter((i) => i.presupuesto_id === prId));
      const { error: e } = await db.from("remitos").update({ presupuesto_id: prId, ...(r.oc_cliente ? {} : { oc_cliente: pr.oc_cliente }) }).eq("id", r.id).eq("sociedad_id", sociedadId);
      if (e) throw e;
      for (const [itemId, piId] of Object.entries(atados)) await db.from("remito_items").update({ presupuesto_item_id: piId }).eq("id", itemId).eq("remito_id", r.id);
      anotarDeshacer(`${r.numero} → ${pr.numero}`, async () => {
        const { error: u } = await db.from("remitos").update({ presupuesto_id: null, oc_cliente: r.oc_cliente }).eq("id", r.id).eq("sociedad_id", sociedadId);
        if (u) throw u;
        const ids = Object.keys(atados);
        if (ids.length) await db.from("remito_items").update({ presupuesto_item_id: null }).in("id", ids).eq("remito_id", r.id);
      });
      toast.success(`${r.numero} atado a ${pr.numero}${Object.keys(atados).length ? ` (${Object.keys(atados).length} renglones)` : ""}`);
    } catch (e: any) {
      toast.error(`No se pudo: ${e?.message || "error"}`);
    } finally { setOcupado(null); await cargar(); }
  }

  // ── Foto del remito firmado ────────────────────────────────────
  function elegirFoto(remitoId: string | null) {
    fotoPara.current = remitoId;
    inputFoto.current?.click();
  }

  async function leerFotos(files: FileList | null) {
    if (!files?.length || !sociedadId) return;
    const para = fotoPara.current;
    fotoPara.current = null;
    setTab("camino");
    const candidatos = para ? enCamino.filter((r) => r.id === para) : enCamino;
    const lista = Array.from(files).slice(0, 10);
    setLeyendo((n) => n + lista.length);
    for (const file of lista) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setFotos((prev) => [{ key, nombre: file.name, url: null, remito_id: para }, ...prev]);
      try {
        const prep = await prepararArchivo(file);
        const ruta = `remitos/${sociedadId}/${key}.${prep.ext}`;
        const { error: eS } = await supabase.storage.from("comprobantes").upload(ruta, prep.blob, { contentType: prep.mediaType, upsert: false });
        const url = eS ? null : supabase.storage.from("comprobantes").getPublicUrl(ruta).data.publicUrl;
        const res = await fetch("/api/remitos/leer-foto", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64: prep.base64, mediaType: prep.mediaType,
            remitos: candidatos.map((r) => ({ id: r.id, numero: r.numero, cai: r.nro_comprobante_cai, cliente: nombreCliente(r.cliente_id), fecha: r.fecha, items: (itemsDeRemito[r.id] || []).map((i) => ({ presupuesto_item_id: i.presupuesto_item_id, descripcion: i.descripcion, cantidad: i.cantidad })) })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "La IA no pudo leer la foto");
        const remitoId = para || data.remito_id || remitoDeLaFoto({ numero: data.numero, cliente: data.cliente },
          candidatos.map((r) => ({ id: r.id, numero: r.numero, nro_comprobante_cai: r.nro_comprobante_cai, cliente: nombreCliente(r.cliente_id) })));
        const leida: FotoLeida = { key, nombre: file.name, url, remito_id: remitoId, ...data };
        if (eS) leida.error = `La foto no se pudo guardar (${eS.message}); lo leído sirve igual`;
        // Conforme y sin dudas: la IA lo marca entregado sola (con Deshacer).
        if (remitoId && data.conforme && data.firmado) {
          const r = enCamino.find((x) => x.id === remitoId);
          if (r && await marcarEntregado(r, { recibio: data.recibio, foto_url: url, foto_ia: data, nota_ia: data.anotaciones }, true)) leida.aplicado = true;
        }
        setFotos((prev) => prev.map((f) => (f.key === key ? leida : f)));
      } catch (e: any) {
        setFotos((prev) => prev.map((f) => (f.key === key ? { ...f, error: e?.message || "No se pudo leer" } : f)));
      } finally {
        setLeyendo((n) => n - 1);
      }
    }
    await cargar();
  }

  async function aplicarFoto(f: FotoLeida, remitoId: string) {
    const r = remitoPorId[remitoId];
    if (!r) return;
    setOcupado(f.key);
    try {
      if (await marcarEntregado(r, { recibio: f.recibio, foto_url: f.url, foto_ia: f, nota_ia: f.anotaciones })) setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, remito_id: remitoId, aplicado: true } : x)));
    } finally { setOcupado(null); await cargar(); }
  }

  // ── Decile a la IA ─────────────────────────────────────────────
  async function preguntarIA() {
    const texto = instruccion.trim();
    if (!texto) return;
    setPensando(true);
    setPropuesta(null);
    try {
      const prsIA = [...paraEntregar, ...pregPR].map((p) => ({
        id: p.id, numero: p.numero, cliente: nombreCliente(p.cliente_id), sin_remito: !(remitosDePR[p.id] || []).length && p.estado === "facturado",
        sucursales: sucursalesDe(p.cliente_id).map((s) => ({ id: s.id, nombre: [s.nombre, s.localidad].filter(Boolean).join(" · ") })),
        items: entregas[p.id].renglones.map((r) => ({ presupuesto_item_id: r.presupuesto_item_id, descripcion: r.descripcion, pendiente: r.pendiente, disponible: r.disponible })),
      }));
      const res = await fetch("/api/remitos/instruccion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruccion: texto, prs: prsIA, transportistas,
          remitos: enCamino.map((r) => ({ id: r.id, numero: r.numero, cliente: nombreCliente(r.cliente_id), pr: numeroPR(r.presupuesto_id), items: itemsDeRemito[r.id] || [] })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "La IA no respondió");
      setPropuesta({ explicacion: data.explicacion || "", acciones: data.acciones || [] });
    } catch (e: any) {
      toast.error(e?.message || "La IA no respondió");
    } finally {
      setPensando(false);
    }
  }

  function textoAccion(a: Accion): string {
    if (a.tipo === "crear_remito") {
      const pr = prPorId[a.pr_id];
      const ren = entregas[a.pr_id]?.renglones || [];
      const its = a.items.map((i) => `${cant(i.cantidad)} ${ren.find((r) => r.presupuesto_item_id === i.presupuesto_item_id)?.descripcion || "?"}`);
      const suc = a.sucursal_id ? sucursales.find((s) => s.id === a.sucursal_id)?.nombre : null;
      return `Remito de ${pr?.numero} (${nombreCliente(pr?.cliente_id || null)})${suc ? ` a ${suc}` : ""}: ${its.slice(0, 4).join(", ")}${its.length > 4 ? ` y ${its.length - 4} más` : ""}`;
    }
    if (a.tipo === "entregado") return `Marcar entregado ${remitoPorId[a.remito_id]?.numero}`;
    if (a.tipo === "ya_entregado_sin_remito") return `${prPorId[a.pr_id]?.numero}: ya se entregó (sin remito)`;
    return `${remitoPorId[a.remito_id]?.numero} lo lleva ${nombreTrans(a.transportista_id)}`;
  }

  async function aplicarPropuesta() {
    if (!propuesta) return;
    setOcupado("ia");
    let ok = 0;
    try {
      for (const a of propuesta.acciones) {
        try {
          if (a.tipo === "crear_remito") {
            const pr = prPorId[a.pr_id];
            const ren = entregas[a.pr_id]?.renglones || [];
            const items = a.items.map((i) => { const r = ren.find((x) => x.presupuesto_item_id === i.presupuesto_item_id); return r ? { presupuesto_item_id: r.presupuesto_item_id, descripcion: r.descripcion, unidad: r.unidad, orden: r.orden, cantidad: Math.min(r.pendiente, i.cantidad) } : null; })
              .filter((x): x is NonNullable<typeof x> => !!x && x.cantidad > 0);
            if (pr && items.length && await crearRemito(pr, items, a.sucursal_id, a.motivo ? `IA: ${a.motivo}` : "Pedido a la IA")) ok++;
          } else if (a.tipo === "entregado") {
            const r = remitoPorId[a.remito_id];
            if (r && await marcarEntregado(r, { nota_ia: a.motivo || null }, true)) ok++;
          } else if (a.tipo === "ya_entregado_sin_remito") {
            const p = prPorId[a.pr_id];
            if (p && await responder("pr_sin_remito", p.id, "entregado_sin_remito", `${p.numero}: ya se entregó`)) ok++;
          } else if (a.tipo === "transporte") {
            const r = remitoPorId[a.remito_id];
            if (r && await ponerTransporte(r, a.transportista_id)) ok++;
          }
        } catch (e: any) { toast.error(e?.message || "Una acción falló"); }
      }
    } finally {
      setOcupado(null);
      toast.success(`Listo: ${ok} de ${propuesta.acciones.length} hecho(s). Si algo no iba, "Deshacer" arriba.`);
      setPropuesta(null);
      setInstruccion("");
      await cargar();
    }
  }

  // ── Pantalla ───────────────────────────────────────────────────
  const btn = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40";
  const opcionesTrans = transportistas.map((t) => ({ valor: t.id, texto: t.nombre }));
  const colorDias = { verde: "text-zinc-500", amarillo: "font-medium text-amber-600", rojo: "font-medium text-red-600" } as const;

  return (
    <div>
      <Header title="Remitos nueva" subtitle="Lo que falta entregar se arma solo. Vos hacés el remito con un clic." />
      <div className="mx-auto max-w-6xl space-y-3 p-4 md:p-6">
        {faltaMigracion && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            Falta correr la migración de Remitos nueva: se puede hacer remitos y marcar entregas, pero no guarda foto, quién recibió ni las respuestas.
          </p>
        )}

        {/* Decile a la IA */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/20">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void preguntarIA(); }}>
            <Sparkles className="mt-1.5 h-4 w-4 shrink-0 text-violet-500" />
            <input value={instruccion} onChange={(e) => setInstruccion(e.target.value)} placeholder='Decile a la IA: "entregá lo de Corteva menos los guantes", "partilo en 2 sucursales", "el R-1234 ya llegó"…'
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
            <button type="submit" disabled={pensando || !instruccion.trim()} className={`${btn} bg-violet-600 text-white hover:bg-violet-700`}>
              {pensando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Ver qué haría
            </button>
          </form>
          {propuesta && (
            <div className="mt-2 rounded border border-violet-200 bg-white p-2 text-sm dark:border-violet-900 dark:bg-zinc-900">
              {propuesta.explicacion && <p className="mb-1 text-zinc-700 dark:text-zinc-300">{propuesta.explicacion}</p>}
              {propuesta.acciones.length ? (
                <ul className="mb-2 list-disc space-y-0.5 pl-5 text-xs">
                  {propuesta.acciones.map((a, i) => <li key={i}>{textoAccion(a)}{a.motivo && <span className="text-zinc-400"> ({a.motivo})</span>}</li>)}
                </ul>
              ) : <p className="mb-2 text-xs text-zinc-500">No hay nada para hacer.</p>}
              <div className="flex gap-2">
                {!!propuesta.acciones.length && <button onClick={() => void aplicarPropuesta()} disabled={ocupado === "ia"} className={`${btn} bg-violet-600 text-white`}>{ocupado === "ia" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Hacerlo</button>}
                <button onClick={() => setPropuesta(null)} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Descartar</button>
              </div>
            </div>
          )}
        </div>

        {/* Deshacer */}
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

        {/* Pestañas */}
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
          {([["entregar", "Para entregar", paraEntregar.length], ["camino", "En camino", enCamino.length], ["preguntas", "Preguntas", totalPreguntas]] as const).map(([k, t, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${tab === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              {t} <span className={`ml-1 rounded-full px-1.5 text-xs ${k === "preguntas" && n ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>{n}</span>
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 pb-1">
            <button onClick={() => elegirFoto(null)} disabled={leyendo > 0} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`} title="Sacale una foto (o subí varias): la IA reconoce el remito y lo marca entregado">
              {leyendo > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} {leyendo > 0 ? `Leyendo ${leyendo}…` : "Foto del remito firmado"}
            </button>
            <Link href="/remitos" className="rounded p-1 text-zinc-400 hover:text-zinc-700" title="Remitos de siempre (imprimir, PDF, ARCA)"><ExternalLink className="h-4 w-4" /></Link>
            <button onClick={() => void cargar()} className="rounded p-1 text-zinc-400 hover:text-zinc-700" title="Actualizar"><RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} /></button>
          </div>
          <input ref={inputFoto} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { void leerFotos(e.target.files); e.target.value = ""; }} />
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
        {cargando && !prs.length && !remitos.length && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo los remitos…</p>}

        {/* PARA ENTREGAR */}
        {tab === "entregar" && !cargando && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
            {!paraEntregar.length && <p className="py-6 text-center text-sm text-zinc-500">No hay nada para entregar. 🎉</p>}
            {paraEntregar.map((p) => {
              const e = entregas[p.id];
              const falta = e.renglones.filter((r) => r.pendiente > 0);
              const llegoAlgo = falta.some((r) => (r.disponible ?? 0) > 0);
              const sucs = sucursalesDe(p.cliente_id);
              const aj = ajuste[p.id];
              const yaRemitos = (remitosDePR[p.id] || []).length;
              const vendedor = nombres[p.vendedor_id || p.created_by || ""] || "";
              const dias = diasDesde(p.fecha || p.created_at) ?? 0;
              return (
                <div key={p.id} className="border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTADO_COLOR[e.estado]}`}>{ESTADO_TEXTO[e.estado]}</span>
                    <span className="font-mono text-xs font-semibold">{p.numero}</span>
                    <span className="font-medium">{nombreCliente(p.cliente_id)}</span>
                    <span className="w-full text-xs text-zinc-500 sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate">
                      {falta.length} renglón(es) por entregar{yaRemitos ? ` · ya hay ${yaRemitos} remito(s)` : ""}{p.estado === "facturado" ? " · facturado" : ""}{p.oc_cliente ? ` · OC ${p.oc_cliente}` : ""}{vendedor ? ` · ${vendedor}` : ""} · {hace(dias)}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      {e.estado === "parcial" && !aj && (
                        <button onClick={() => void hacerRemito(p, "llego")} disabled={ocupado === p.id} className={`${btn} bg-sky-600 text-white hover:bg-sky-700`} title="Remito solo con lo que llegó; lo demás queda para después">
                          {ocupado === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />} Entregar lo que llegó
                        </button>
                      )}
                      <button onClick={() => void hacerRemito(p, "todo")} disabled={ocupado === p.id}
                        className={`${btn} ${e.estado === "listo" || aj ? "bg-orange-500 text-white hover:bg-orange-600" : "border border-zinc-300 dark:border-zinc-600"}`}
                        title={e.estado === "listo" ? "Llegó todo: remito con todo lo que falta" : aj ? "Remito con las cantidades que pusiste" : "Todavía no figura todo recibido: lo podés hacer igual"}>
                        {ocupado === p.id && !llegoAlgo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {aj ? "Hacer remito (ajustado)" : e.estado === "listo" ? "Hacer remito" : "Hacer remito igual"}
                      </button>
                      <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} className="text-xs text-zinc-400 hover:text-zinc-700 hover:underline">{abierto === p.id ? "cerrar" : "ver / ajustar"}</button>
                    </div>
                  </div>
                  {abierto === p.id && (
                    <div className="mt-1 space-y-1 pl-2">
                      {sucs.length > 1 && (
                        <label className="flex items-center gap-2 text-xs text-zinc-600">
                          Sucursal:
                          <select value={aj?.sucursal ?? (p.sucursal_id || "")} onChange={(ev) => setAjuste((prev) => ({ ...prev, [p.id]: { cant: prev[p.id]?.cant || Object.fromEntries(falta.map((r) => [r.presupuesto_item_id, r.pendiente])), sucursal: ev.target.value } }))}
                            className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-900">
                            <option value="">Dirección principal</option>
                            {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.localidad ? ` · ${s.localidad}` : ""}</option>)}
                          </select>
                          <span className="text-zinc-400">(para partir en 2 sucursales: hacé un remito, cambiá la sucursal y hacé el otro, o pedíselo a la IA)</span>
                        </label>
                      )}
                      <ul className="space-y-0.5">
                        {falta.map((r) => (
                          <li key={r.presupuesto_item_id} className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-600 dark:text-zinc-400">
                            <input type="number" min={0} max={r.pendiente} step="any" value={aj?.cant[r.presupuesto_item_id] ?? r.pendiente}
                              onChange={(ev) => setAjuste((prev) => ({ ...prev, [p.id]: { sucursal: prev[p.id]?.sucursal ?? (p.sucursal_id || ""), cant: { ...(prev[p.id]?.cant || Object.fromEntries(falta.map((x) => [x.presupuesto_item_id, x.pendiente]))), [r.presupuesto_item_id]: Number(ev.target.value) } } }))}
                              className="w-16 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right text-xs dark:border-zinc-600 dark:bg-zinc-900" />
                            <span className="text-zinc-400">de {cant(r.pendiente)}</span>
                            <span className="min-w-0 flex-1 truncate">{r.descripcion}</span>
                            <span className={r.disponible === null ? "text-zinc-400" : r.disponible >= r.pendiente ? "text-emerald-600" : r.disponible > 0 ? "text-sky-600" : "text-amber-600"}>
                              {r.disponible === null ? "sin OC" : r.disponible >= r.pendiente ? "llegó" : r.disponible > 0 ? `llegó ${cant(r.disponible)}` : "no llegó"}
                            </span>
                            {r.remitido > 0 && <span className="text-zinc-400">· entregado {cant(r.remitido)}</span>}
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap items-center gap-3">
                        {p.modalidad_emision !== "manual" && (
                          <label className="flex items-center gap-1.5 text-xs text-zinc-600" title="Remito interno: no usa un número de CAI (ej. entrega interna o prueba)">
                            <input type="checkbox" checked={!!sinCai[p.id]} onChange={(ev) => setSinCai((prev) => ({ ...prev, [p.id]: ev.target.checked }))} className="h-3.5 w-3.5 accent-orange-600" />
                            Sin CAI (remito interno)
                          </label>
                        )}
                        {aj && <button onClick={() => setAjuste((prev) => { const n = { ...prev }; delete n[p.id]; return n; })} className="text-xs text-zinc-400 hover:underline">volver a lo sugerido</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* EN CAMINO */}
        {tab === "camino" && !cargando && (
          <div className="space-y-2">
            {fotos.length > 0 && (
              <div className="space-y-1 rounded-lg border border-orange-200 bg-orange-50/40 p-2 dark:border-orange-900 dark:bg-orange-950/10">
                {fotos.map((f) => {
                  const r = f.remito_id ? remitoPorId[f.remito_id] : null;
                  const cargandoFoto = !f.error && f.resumen === undefined;
                  return (
                    <div key={f.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {cargandoFoto ? <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-500" /> : <Camera className="h-3.5 w-3.5 text-orange-500" />}
                      {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">{f.nombre}</a> : <span>{f.nombre}</span>}
                      {cargandoFoto && <span className="text-zinc-500">la IA la está leyendo…</span>}
                      {f.error && <span className="text-red-600">{f.error}</span>}
                      {f.resumen !== undefined && (
                        <>
                          <span className="text-zinc-700 dark:text-zinc-300">{f.resumen}</span>
                          {r && <span className="font-mono font-semibold">{r.numero}</span>}
                          {f.recibio && <span className="text-zinc-500">recibió {f.recibio}</span>}
                          {!f.firmado && <span className="text-amber-600">sin firma</span>}
                          {f.aplicado && r && r.estado !== "pendiente" ? <span className="font-medium text-emerald-600">✓ marcado entregado (Deshacer arriba)</span> : (
                            <span className="flex flex-wrap items-center gap-1.5">
                              {!r && (
                                <span className="w-56"><Autocompletar chico opciones={enCamino.map((x) => ({ valor: x.id, texto: `${x.numero} · ${nombreCliente(x.cliente_id)}` }))} placeholder="¿De qué remito es?" onElegir={(v) => setFotos((prev) => prev.map((x) => (x.key === f.key ? { ...x, remito_id: v } : x)))} /></span>
                              )}
                              {r && !!f.faltantes?.length && (
                                <>
                                  <span className="text-amber-700">Anotaron: {f.faltantes.map((x) => `faltan ${cant(x.cantidad)} ${x.descripcion}`).join(", ")}</span>
                                  <button onClick={() => abrirParcial(r, f.faltantes || [], `Foto: ${f.anotaciones || ""}`.trim())} className={`${btn} bg-sky-600 text-white`}>Entregó en parte</button>
                                </>
                              )}
                              {r && <button onClick={() => void aplicarFoto(f, r.id)} disabled={ocupado === f.key} className={`${btn} bg-emerald-600 text-white`}>Entregado {f.faltantes?.length ? "igual" : ""}</button>}
                              <button onClick={() => setFotos((prev) => prev.filter((x) => x.key !== f.key))} className="text-zinc-400 hover:underline">descartar</button>
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
              {!enCamino.length && <p className="py-6 text-center text-sm text-zinc-500">No hay remitos en camino.</p>}
              {enCamino.map((r) => {
                const s = semaforoEnCamino(r.fecha);
                const its = itemsDeRemito[r.id] || [];
                const trans = nombreTrans(r.transportista_id);
                return (
                  <div key={r.id} className={`border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800 ${s.color === "rojo" ? "bg-red-50/50 dark:bg-red-950/10" : s.color === "amarillo" ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-mono text-xs font-semibold">{r.numero}</span>
                      <span className="font-medium">{nombreCliente(r.cliente_id)}</span>
                      <span className="text-xs text-zinc-500">{numeroPR(r.presupuesto_id) || "sin PR"} · {its.length} renglón(es)</span>
                      <span className={`text-xs ${colorDias[s.color]}`}>salió {hace(s.dias)}</span>
                      <button onClick={() => setEligiendoTrans(eligiendoTrans === r.id ? null : r.id)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 hover:underline" title="¿Quién lo lleva?">
                        <Truck className="h-3.5 w-3.5" /> {trans || "¿quién lo lleva?"}
                      </button>
                      <div className="ml-auto flex items-center gap-1.5">
                        <button onClick={() => elegirFoto(r.id)} disabled={leyendo > 0} className="rounded p-1 text-zinc-400 hover:text-orange-600" title="Foto del remito firmado"><Camera className="h-4 w-4" /></button>
                        <button onClick={() => abrirParcial(r)} className={`${btn} border border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300`} title="Entregó una parte: lo que falta queda en un remito nuevo">Parcial</button>
                        <button onClick={() => void entregado(r)} disabled={ocupado === r.id} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                          {ocupado === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Entregado
                        </button>
                      </div>
                    </div>
                    {eligiendoTrans === r.id && (
                      <div className="mt-1 w-64"><Autocompletar chico opciones={opcionesTrans} placeholder="Transportista…" onElegir={(v) => { void ponerTransporte(r, v).then((ok) => { if (ok) { setEligiendoTrans(null); void cargar(); } }); }} /></div>
                    )}
                    {parcial?.remitoId === r.id && (
                      <div className="mt-1 space-y-1 rounded border border-sky-200 bg-sky-50/50 p-2 dark:border-sky-900 dark:bg-sky-950/20">
                        <p className="text-xs text-zinc-600">¿Cuánto entregó de cada renglón? Lo que falte va a un remito nuevo &quot;En camino&quot;.</p>
                        {its.map((it) => (
                          <div key={it.id} className="flex items-center gap-2 text-xs">
                            <input type="number" min={0} max={Number(it.cantidad)} step="any" value={parcial.cant[it.id] ?? Number(it.cantidad)}
                              onChange={(ev) => setParcial({ ...parcial, cant: { ...parcial.cant, [it.id]: Number(ev.target.value) } })}
                              className="w-16 rounded border border-zinc-300 bg-white px-1 py-0.5 text-right dark:border-zinc-600 dark:bg-zinc-900" />
                            <span className="text-zinc-400">de {cant(Number(it.cantidad))}</span>
                            <span className="truncate">{it.descripcion}</span>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button onClick={() => void guardarParcial()} disabled={ocupado === r.id} className={`${btn} bg-sky-600 text-white`}>{ocupado === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Guardar entrega</button>
                          <button onClick={() => setParcial(null)} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PREGUNTAS */}
        {tab === "preguntas" && !cargando && (
          <div className="space-y-3">
            {!totalPreguntas && <p className="py-6 text-center text-sm text-zinc-500">No hay preguntas. 🎉</p>}

            {pregViejos.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50">Remitos que salieron hace más de {DIAS_REMITO_VIEJO} días y siguen en camino</p>
                {pregViejos.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 px-3 py-1.5 text-sm last:border-0 dark:border-zinc-800">
                    <span className="font-medium">¿Se entregó el {r.numero} de {nombreCliente(r.cliente_id)}?</span>
                    <span className="text-xs text-zinc-500">{numeroPR(r.presupuesto_id) || "sin PR"} · {formatDate(r.fecha)}</span>
                    <div className="ml-auto flex gap-1.5">
                      <button onClick={() => void entregado(r)} disabled={ocupado === r.id} className={`${btn} bg-emerald-600 text-white`}>Sí, se entregó</button>
                      <button onClick={() => abrirParcial(r)} className={`${btn} border border-sky-300 text-sky-700`}>En parte</button>
                      <button onClick={() => void responder("remito_viejo", r.id, "sigue_en_camino", `${r.numero}: sigue en camino`, sumarDias(hoy, DIAS_VOLVER_A_PREGUNTAR)).then(() => cargar())} className={`${btn} border border-zinc-300 dark:border-zinc-600`} title={`Se vuelve a preguntar en ${DIAS_VOLVER_A_PREGUNTAR} días`}>Todavía no</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pregSinPR.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50">Remitos sin PR: ¿a qué venta van?</p>
                {pregSinPR.map((r) => {
                  const its = itemsDeRemito[r.id] || [];
                  const cands = prs.filter((p) => p.cliente_id === r.cliente_id).map((p) => ({ id: p.id, numero: p.numero, cliente_id: p.cliente_id, fecha: p.fecha || p.created_at, items: prItems.filter((i) => i.presupuesto_id === p.id) }));
                  const sug = sugerirPRParaRemito({ cliente_id: r.cliente_id, fecha: r.fecha, items: its }, cands);
                  return (
                    <div key={r.id} className="border-b border-zinc-100 px-3 py-1.5 last:border-0 dark:border-zinc-800">
                      <p className="text-sm">
                        <span className="font-medium">{r.numero} · {nombreCliente(r.cliente_id)}</span>
                        <span className="text-xs text-zinc-500"> · {formatDate(r.fecha)} · {its.slice(0, 3).map((i) => `${cant(Number(i.cantidad))} ${i.descripcion}`).join(", ")}{its.length > 3 ? "…" : ""}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {sug.map((s) => (
                          <button key={s.pr_id} onClick={() => void asignarPR(r, s.pr_id)} disabled={ocupado === r.id} title={s.motivo}
                            className={`${btn} border ${s.puntos >= 80 ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-zinc-300 dark:border-zinc-600"}`}>
                            {s.numero} <span className="font-normal text-zinc-400">· {s.motivo}</span>
                          </button>
                        ))}
                        {!sug.length && <span className="text-xs text-zinc-400">Sin PR parecido de este cliente.</span>}
                        {cands.length > 0 && <span className="w-48"><Autocompletar chico opciones={cands.map((c) => ({ valor: c.id, texto: c.numero }))} placeholder="Otro PR…" onElegir={(v) => void asignarPR(r, v)} /></span>}
                        <button onClick={() => void responder("remito_sin_pr", r.id, "sin_pr", `${r.numero}: no va con PR`).then(() => cargar())} className={`${btn} border border-zinc-300 dark:border-zinc-600`} title="Ej.: reposición, cambio, envío suelto">No va con PR</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pregPR.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50">Ventas facturadas sin ningún remito: ¿se entregaron?</p>
                {pregPR.map((p) => {
                  const falta = entregas[p.id].renglones.filter((r) => r.pendiente > 0);
                  return (
                    <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 px-3 py-1.5 text-sm last:border-0 dark:border-zinc-800">
                      <span className="font-mono text-xs font-semibold">{p.numero}</span>
                      <span className="font-medium">{nombreCliente(p.cliente_id)}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{formatDate(p.fecha || p.created_at)} · {falta.slice(0, 2).map((r) => `${cant(r.pendiente)} ${r.descripcion}`).join(", ")}{falta.length > 2 ? ` y ${falta.length - 2} más` : ""}</span>
                      <div className="flex gap-1.5">
                        <button onClick={() => void responderPR(p, "entregado_sin_remito")} disabled={ocupado === p.id} className={`${btn} bg-emerald-600 text-white`}>Ya se entregó</button>
                        <button onClick={() => void responderPR(p, "falta_entregar").then(() => setTab("entregar"))} disabled={ocupado === p.id} className={`${btn} bg-orange-500 text-white`} title="Pasa a Para entregar con el remito armado">Hacer remito</button>
                        <button onClick={() => void responderPR(p, "falta_entregar")} disabled={ocupado === p.id} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>Falta entregar</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
