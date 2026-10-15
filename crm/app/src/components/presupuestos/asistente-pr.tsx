"use client";

/**
 * Asistente IA del editor de PR: un CHAT. El vendedor le habla (y le adjunta el Excel, PDF o foto del pedido), la IA (Opus 5.5)
 * arma un BORRADOR del presupuesto que se ve a la derecha, hace preguntas con botones cuando duda y se va corrigiendo mensaje a mensaje
 * ("cambiá el casco por Libus", "ese dejalo a 12 dólares", "mantené el precio del PR 1203", "buscá lo más barato respetando marcas").
 * Todo es sugerencia: recién cuando el vendedor aprieta "Reemplazar" o "Agregar" pasa al PR. Cada respuesta se puede deshacer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FileUp, Loader2, Paperclip, Send, Sparkles, Undo2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { convertirAMonedaPR, type CatalogoItemParaPR } from "@/components/presupuestos/catalogo-picker";
import { leerExcel, leerBase64, separarTalle } from "@/components/presupuestos/cotizacion-express";
import { buscarCandidatos, normalizar, type CatalogoCandidato as Cand } from "@/lib/catalogo-busqueda";
import { claveArticulo } from "@/lib/presupuesto-ayudas";
import { proponerPrecio, semaforoLinea, margenSobreCosto, redondear2, MARGEN_MINIMO_IA, type Confianza, type Semaforo } from "@/lib/presupuesto-ia";

const db = supabase as any;

type Fuente = { tipo: "pr"; numero: string; fecha: string } | { tipo: "manual" } | { tipo: "markup"; pct: number };
type Linea = {
  id: string; descripcion: string; cantidad: number; talle: string; codigo: string;
  candidatos: Cand[]; elegido: number | null; confianza: Confianza; nota: string; incluir: boolean;
  provPref?: string; marcasOblig?: string[];
  precioFijo: number | null; markupFijo: number | null; fuente: Fuente | null;
};
type Pregunta = { pregunta: string; opciones: string[]; respondida?: string };
type Msg = { id: string; rol: "yo" | "ia"; texto: string; preguntas?: Pregunta[]; resumen?: string[]; adjunto?: string };
type Archivo = { nombre: string; lineas: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }>; preguntas: Array<{ linea?: string; pregunta: string }> };
type Accion = { tipo: string; [k: string]: any };

interface Props {
  open: boolean;
  onClose: () => void;
  prMoneda: string;
  tc: number;
  tcDivisas: number;
  clienteNombre: string;
  clienteId?: string;
  sociedadId?: string;
  renglonesPR: number;
  prsCliente: Array<{ numero: string; fecha: string; estado: string }>;
  /** Último precio (neto) al que se le vendió cada artículo a este cliente (clave = claveArticulo). */
  ultimos: Map<string, { precio: number; moneda: string; fecha: string; numero: string }>;
  proveedorDeLista: (nombre: string) => Promise<string>;
  onAplicar: (items: CatalogoItemParaPR[], reemplazar: boolean) => void;
  textoInicial?: string;
}

const fmt = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLOR: Record<Semaforo, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  amarillo: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  rojo: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};
const SEMAFORO_TXT: Record<Semaforo, string> = { verde: "Listo", amarillo: "Revisar", rojo: "Falta" };
const uid = () => Math.random().toString(36).slice(2, 9);
const SUGERENCIAS = [
  "Armame el presupuesto con el Excel que adjunto",
  "Si un artículo ya está en un PR anterior de este cliente, mantené ese precio",
  "Buscá lo más barato respetando las marcas que te pido",
];

export default function AsistentePR({ open, onClose, prMoneda, tc, tcDivisas, clienteNombre, clienteId, sociedadId, renglonesPR, prsCliente, ultimos, proveedorDeLista, onAplicar, textoInicial }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const lineasRef = useRef<Linea[]>([]);
  const [deshacer, setDeshacer] = useState<Array<{ lineas: Linea[]; mensajeId: string }>>([]);
  const [texto, setTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imagen, setImagen] = useState<{ data: string; media_type: string; name: string } | null>(null);
  const [leido, setLeido] = useState<Archivo | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const finRef = useRef<HTMLDivElement>(null);
  useEffect(() => { lineasRef.current = lineas; }, [lineas]);
  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, progreso]);
  useEffect(() => { if (open) { setMsgs([]); setLineas([]); lineasRef.current = []; setDeshacer([]); setTexto(textoInicial || ""); setArchivo(null); setImagen(null); setLeido(null); setError(""); setProgreso(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const prefsTc = { tc, tcDivisas };

  // ── cálculo de cada renglón ──
  const calc = useMemo(() => (l: Linea) => {
    const cand = l.elegido !== null ? l.candidatos[l.elegido] || null : null;
    const costo = cand ? convertirAMonedaPR(cand.costo, cand.moneda, prMoneda, tc, tcDivisas) : null;
    const ventaLista = cand ? convertirAMonedaPR(cand.precio_venta, cand.moneda, prMoneda, tc, tcDivisas) : null;
    const u = cand ? ultimos.get(claveArticulo(cand.codigo_interno || cand.codigo, cand.descripcion)) : undefined;
    const prop = cand ? proponerPrecio({ costo, ventaLista, ultimo: u && u.moneda === prMoneda ? { precio: u.precio, fecha: u.fecha, numero: u.numero } : null }) : null;
    let precio = 0, origen = "sin precio", nota = "";
    if (l.precioFijo !== null) { precio = l.precioFijo; origen = l.fuente?.tipo === "pr" ? `PR ${l.fuente.numero}` : "fijado"; }
    else if (l.markupFijo !== null && costo && costo > 0) { precio = redondear2(costo * (1 + l.markupFijo / 100)); origen = `markup ${l.markupFijo}%`; }
    else if (prop) { precio = prop.precio; origen = prop.origen === "ultimo" ? "último precio" : prop.origen === "lista" ? "lista" : "sin precio"; nota = prop.nota; }
    const margen = costo && costo > 0 && precio > 0 ? margenSobreCosto(precio, costo) : null;
    const bajo = margen !== null && margen < MARGEN_MINIMO_IA;
    const sem = semaforoLinea({ confianza: l.confianza, tieneArticulo: !!cand || l.precioFijo !== null, precio, cantidad: l.cantidad, bajoMinimo: bajo, sinCosto: !(costo && costo > 0), avisoExtra: !!cand && costo === null });
    return { cand, costo, precio, origen, nota, margen, bajo, sem };
  }, [prMoneda, tc, tcDivisas, ultimos]);
  const filas = lineas.map(l => ({ l, c: calc(l) }));
  const incluidas = filas.filter(f => f.l.incluir);
  const totalVenta = incluidas.reduce((s, f) => s + f.c.precio * f.l.cantidad, 0);

  // ── búsqueda y elección de artículos (misma IA de la Cotización express) ──
  async function buscarYElegir(base: Linea[], indicaciones = "") {
    for (let i = 0; i < base.length; i += 6) {
      setProgreso(`Buscando en la lista de costos… ${Math.min(i + 6, base.length)} de ${base.length}`);
      await Promise.all(base.slice(i, i + 6).map(async l => {
        const marcas = l.marcasOblig || [];
        const consultas = [buscarCandidatos(l.descripcion, l.codigo, 15), ...marcas.map(m => buscarCandidatos(`${l.descripcion} ${m}`, l.codigo, 15))];
        const res = await Promise.all(consultas);
        const vistos = new Set<string>(); const out: Cand[] = [];
        for (const r of res) for (const c of r) if (!vistos.has(c.id)) { vistos.add(c.id); out.push(c); }
        l.candidatos = out;
      }));
    }
    setProgreso("La IA está eligiendo el artículo de cada renglón…");
    const marcasTodas = [...new Set(base.flatMap(l => l.marcasOblig || []))];
    const res = await fetch("/api/cotizacion-express", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modo: "elegir", moneda_comparable: prMoneda === "ARS" ? "ARS" : "USD",
        pedidos: base.filter(l => l.candidatos.length).map(l => ({
          id: l.id, descripcion: l.descripcion, talle: l.talle, codigo: l.codigo, proveedor_preferido: l.provPref || "",
          ya_vendido: [],
          candidatos: l.candidatos.map(c => { const cp = convertirAMonedaPR(c.costo, c.moneda, prMoneda, tc, tcDivisas); return { proveedor: c.proveedor, codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca, moneda: c.moneda, costo: c.costo, costo_comparable: cp === null ? null : Math.round(cp * 100) / 100 }; }),
        })),
        preferencias: { indicaciones, marcas: marcasTodas, solo_marcas: marcasTodas.length > 0 },
      }),
    });
    const d = await res.json().catch(() => ({}));
    const porId = new Map<string, any>((d.elecciones || []).map((e: any) => [String(e.id), e]));
    for (const l of base) {
      const e = porId.get(l.id);
      const idx = e && e.indice !== null && e.indice !== undefined && l.candidatos[Number(e.indice)] ? Number(e.indice) : null;
      if (e) { l.elegido = idx; l.confianza = idx === null ? "ninguna" : (["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media"); l.nota = e.nota || ""; }
      else if (l.candidatos.length) { l.elegido = 0; l.confianza = "baja"; l.nota = "Sugerido por parecido (la IA no contestó)"; }
      else { l.elegido = null; l.confianza = "ninguna"; }
    }
    return base;
  }

  const nuevaLinea = (p: { descripcion: string; cantidad?: number; talle?: string; codigo?: string; marca?: string }, id: string): Linea => {
    const st = separarTalle(String(p.descripcion || ""));
    return { id, descripcion: st.descripcion, cantidad: Number(p.cantidad) > 0 ? Number(p.cantidad) : 1, talle: String(p.talle || st.talle || "").toUpperCase(), codigo: String(p.codigo || ""),
      candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, marcasOblig: p.marca ? [String(p.marca)] : undefined, precioFijo: null, markupFijo: null, fuente: null };
  };
  const objetivo = (cur: Linea[], sel: unknown): Linea[] => {
    if (Array.isArray(sel)) { const ids = new Set(sel.map(String)); return cur.filter(l => ids.has(l.id)); }
    if (sel === "sin_precio_pr") return cur.filter(l => l.fuente?.tipo !== "pr");
    return cur;
  };

  // ── ejecución de las acciones que decide la IA ──
  async function ejecutar(acciones: Accion[], archivoLeido: Archivo | null): Promise<string[]> {
    const resumen: string[] = [];
    let cur: Linea[] = lineasRef.current.map(l => ({ ...l }));
    const publicar = (n: Linea[]) => { cur = n; lineasRef.current = n; setLineas(n); };
    for (const a of acciones) {
      try {
        if (a.tipo === "armar") {
          const pedidos = a.desde_archivo ? (archivoLeido?.lineas || []) : (Array.isArray(a.pedidos) ? a.pedidos : []);
          if (!pedidos.length) { resumen.push("No encontré artículos para armar."); continue; }
          const base = pedidos.map((p: any, i: number) => nuevaLinea(p, `${Date.now().toString(36)}${i}`));
          await buscarYElegir(base);
          publicar(a.modo === "sumar" ? [...cur, ...base] : base);
          resumen.push(`Armé ${base.length} renglones${a.desde_archivo ? " del archivo" : ""}.`);
          if (a.desde_archivo) setLeido(null);
        } else if (a.tipo === "precio_pr") {
          const nums: string[] = (Array.isArray(a.prs) ? a.prs : []).map((x: unknown) => String(x).replace(/\D/g, "").slice(-5)).filter((x: string) => x.length >= 3);
          if (!nums.length) { resumen.push("No me dijiste de qué PR tomar los precios."); continue; }
          const rs = await Promise.all(nums.map(n => db.from("presupuestos").select("numero, moneda, fecha, presupuesto_items(codigo, descripcion, precio_venta)").eq("sociedad_id", sociedadId).ilike("numero", `%-${n}`).limit(1)));
          const prs = rs.flatMap((r: any) => r.data || []).sort((x: any, y: any) => String(x.fecha).localeCompare(String(y.fecha)));
          if (!prs.length) { resumen.push(`No encontré el PR ${nums.join(", ")}.`); continue; }
          const mapa = new Map<string, { precio: number; numero: string; fecha: string }>();
          for (const p of prs) { if (p.moneda !== prMoneda) { resumen.push(`${p.numero} está en otra moneda: no lo usé.`); continue; } for (const it of p.presupuesto_items || []) { const k = claveArticulo(it.codigo, it.descripcion); const pr = Number(it.precio_venta) || 0; if (k && pr > 0) mapa.set(k, { precio: pr, numero: p.numero, fecha: String(p.fecha || "") }); } }
          const objetivos = new Set(objetivo(cur, a.lineas).map(l => l.id));
          let ok = 0, no = 0;
          publicar(cur.map(l => {
            if (!objetivos.has(l.id)) return l;
            const cand = l.elegido !== null ? l.candidatos[l.elegido] : null;
            const u = mapa.get(claveArticulo(cand?.codigo_interno || cand?.codigo || l.codigo, cand?.descripcion || l.descripcion)) || mapa.get(claveArticulo(l.codigo, l.descripcion));
            if (!u) { no++; return l; }
            ok++; return { ...l, precioFijo: u.precio, markupFijo: null, fuente: { tipo: "pr", numero: u.numero, fecha: u.fecha } };
          }));
          resumen.push(`${ok} renglón(es) toman el precio de ${[...new Set(prs.map((p: any) => p.numero))].join(", ")}${no ? `; ${no} no coinciden` : ""}.`);
        } else if (a.tipo === "mejores_costos") {
          const objs = objetivo(cur, a.lineas).filter(l => l.incluir);
          if (!objs.length) { resumen.push("No hay renglones para buscar mejores costos."); continue; }
          const marcas: string[] = Array.isArray(a.marcas) ? a.marcas.map(String) : [];
          const provs: string[] = Array.isArray(a.proveedores) ? a.proveedores.map(String) : [];
          const copias = objs.map(l => ({ ...l, marcasOblig: marcas.length ? marcas : l.marcasOblig, provPref: provs[0] || l.provPref, candidatos: [] as Cand[], elegido: null as number | null }));
          const costoAntes = new Map(objs.map(l => { const c = calc(l); return [l.id, c.costo] as const; }));
          await buscarYElegir(copias, `BUSCAR EL MEJOR COSTO: elegí el candidato MÁS BARATO (menor costo comparable) entre los que sean EXACTAMENTE el mismo artículo (misma marca, modelo y características; el talle no cambia el artículo). ${provs.length ? `Proveedores obligatorios: ${provs.join(", ")}. ` : ""}Nunca elijas uno distinto solo por ser más barato.`);
          let mejoras = 0; let ahorro = 0;
          publicar(cur.map(l => {
            const n = copias.find(c => c.id === l.id); if (!n || n.elegido === null) return l;
            const nuevo = convertirAMonedaPR(n.candidatos[n.elegido].costo, n.candidatos[n.elegido].moneda, prMoneda, tc, tcDivisas);
            const antes = costoAntes.get(l.id);
            if (nuevo === null || (antes != null && antes > 0 && nuevo >= antes * 0.995)) return l; // no es más barato: queda como estaba
            mejoras++; if (antes) ahorro += (antes - nuevo) * l.cantidad;
            return { ...l, candidatos: n.candidatos, elegido: n.elegido, confianza: n.confianza, nota: `Mejor costo${antes ? `: ${((1 - nuevo / antes) * 100).toFixed(1)}% menos` : ""}${n.nota ? ` · ${n.nota}` : ""}` };
          }));
          resumen.push(mejoras ? `Mejoré el costo de ${mejoras} renglón(es)${ahorro > 0 ? ` (ahorro ${fmt(ahorro, prMoneda)})` : ""}${marcas.length ? `, respetando ${marcas.join(", ")}` : ""}.` : "No encontré el mismo artículo más barato.");
        } else if (a.tipo === "ajustar") {
          const instr = String(a.instruccion || "").trim(); if (!instr) continue;
          setProgreso("La IA está ajustando el borrador…");
          const res = await fetch("/api/cotizacion-express", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            modo: "ajustar", instruccion: instr,
            lineas: cur.map(l => { const c = l.elegido !== null ? l.candidatos[l.elegido] : null; return { id: l.id, descripcion: l.descripcion, cantidad: l.cantidad, talle: l.talle, incluida: l.incluir, articulo: c ? `${c.proveedor} · ${c.descripcion}${c.marca ? ` · ${c.marca}` : ""}` : "" }; }),
          }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "No pude ajustar");
          const quitar = new Set<string>((d.quitar || []).map(String));
          let nuevas = cur.filter(l => !quitar.has(l.id)).map(l => ({ ...l }));
          const aBuscar: Linea[] = [];
          for (const c of d.cambiar || []) {
            const l = nuevas.find(x => x.id === String(c.id)); if (!l) continue;
            let re = false;
            if (Number(c.cantidad) > 0) l.cantidad = Number(c.cantidad);
            if (c.talle != null && String(c.talle).toUpperCase() !== l.talle) { l.talle = String(c.talle).toUpperCase(); re = true; }
            if (c.descripcion && String(c.descripcion) !== l.descripcion) { l.descripcion = String(c.descripcion); re = true; }
            if (c.proveedor_preferido) { l.provPref = String(c.proveedor_preferido); re = true; }
            if (re) { l.candidatos = []; l.elegido = null; l.precioFijo = null; l.fuente = null; aBuscar.push(l); }
          }
          for (const ag of d.agregar || []) { if (ag?.descripcion) { const n = nuevaLinea(ag, `${Date.now().toString(36)}${nuevas.length}`); if (ag.proveedor_preferido) n.provPref = String(ag.proveedor_preferido); nuevas.push(n); aBuscar.push(n); } }
          if (aBuscar.length) await buscarYElegir(aBuscar);
          publicar(nuevas);
          resumen.push(d.resumen || `${d.agregar?.length || 0} agregados · ${d.cambiar?.length || 0} cambiados · ${quitar.size} quitados.`);
          for (const p of d.preguntas || []) if (p?.pregunta) resumen.push(`❓ ${p.pregunta}`);
        } else if (a.tipo === "precio" || a.tipo === "markup" || a.tipo === "precio_automatico") {
          const objs = new Set(objetivo(cur, a.lineas).map(l => l.id));
          publicar(cur.map(l => !objs.has(l.id) ? l : a.tipo === "precio" ? { ...l, precioFijo: Number(a.precio) > 0 ? Number(a.precio) : null, markupFijo: null, fuente: { tipo: "manual" as const } }
            : a.tipo === "markup" ? { ...l, markupFijo: Number(a.porcentaje) >= 0 ? Number(a.porcentaje) : null, precioFijo: null, fuente: { tipo: "markup" as const, pct: Number(a.porcentaje) } }
            : { ...l, precioFijo: null, markupFijo: null, fuente: null }));
          resumen.push(a.tipo === "precio" ? `Precio fijado en ${fmt(Number(a.precio), prMoneda)} (${objs.size} renglón/es).` : a.tipo === "markup" ? `Markup ${a.porcentaje}% (${objs.size} renglón/es).` : `${objs.size} renglón(es) vuelven al precio automático.`);
        }
      } catch (e) { resumen.push(`⚠️ ${a.tipo}: ${e instanceof Error ? e.message : "error"}`); }
    }
    return resumen;
  }

  // ── conversación ──
  async function leerAdjunto(): Promise<Archivo | null> {
    if (!archivo && !imagen) return leido;
    setProgreso("Leyendo el archivo…");
    const esExcel = !!archivo && /\.(xlsx|xls|xlsm|csv|ods)$/i.test(archivo.name);
    const esPdf = !!archivo && /\.pdf$/i.test(archivo.name);
    const nombre = archivo?.name || imagen?.name || "archivo";
    let lineasX: Archivo["lineas"] = []; let extra = "";
    if (esExcel) { const r = await leerExcel(archivo!); lineasX = r.lineas; extra = r.texto; }
    let preguntas: Archivo["preguntas"] = [];
    if (!lineasX.length) {
      const res = await fetch("/api/cotizacion-express", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        modo: "extraer", mensaje: extra, imagen: imagen ? { data: imagen.data, media_type: imagen.media_type } : undefined, pdf: esPdf ? { data: await leerBase64(archivo!) } : undefined,
      }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No pude leer el archivo");
      lineasX = (d.lineas || []).map((l: any) => { const st = separarTalle(l.descripcion || ""); return { descripcion: st.descripcion, talle: String(l.talle || st.talle || "").toUpperCase(), codigo: String(l.codigo || ""), cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1 }; });
      preguntas = Array.isArray(d.preguntas) ? d.preguntas : [];
    }
    return { nombre, lineas: lineasX, preguntas };
  }

  async function enviar(textoDirecto?: string) {
    const t = (textoDirecto ?? texto).trim();
    if ((!t && !archivo && !imagen) || trabajando) return;
    setError(""); setTrabajando(true);
    const adjunto = archivo?.name || imagen?.name;
    const yo: Msg = { id: uid(), rol: "yo", texto: t || "(archivo adjunto)", adjunto };
    const previos = [...msgs];
    setMsgs([...previos, yo]); setTexto("");
    try {
      let arch = leido;
      if (archivo || imagen) { arch = await leerAdjunto(); setLeido(arch); setArchivo(null); setImagen(null); }
      setProgreso("La IA está pensando…");
      const resumenBorrador = lineasRef.current.map(l => { const c = calc(l); return { id: l.id, descripcion: l.descripcion, talle: l.talle, cantidad: l.cantidad, articulo: c.cand ? `${c.cand.proveedor} · ${c.cand.descripcion}${c.cand.marca ? ` · ${c.cand.marca}` : ""}` : "", costo: c.costo !== null ? Number(c.costo.toFixed(2)) : null, precio: Number(c.precio.toFixed(2)), fuente: c.origen, nota: l.nota }; });
      const res = await fetch("/api/presupuestos/asistente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        mensajes: [...previos, yo].map(m => ({ rol: m.rol === "ia" ? "ia" : "yo", texto: `${m.texto}${m.preguntas?.length ? `\n[Preguntas: ${m.preguntas.map(p => `${p.pregunta}${p.respondida ? ` → ${p.respondida}` : ""}`).join(" | ")}]` : ""}${m.resumen?.length ? `\n[Hecho: ${m.resumen.join(" ")}]` : ""}` })),
        borrador: resumenBorrador, archivo: arch, contexto: { cliente: clienteNombre, moneda: prMoneda, renglonesPR, prsCliente },
      }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "La IA no pudo responder");
      const respId = uid();
      if ((d.acciones || []).length) setDeshacer(p => [...p.slice(-9), { lineas: lineasRef.current.map(l => ({ ...l })), mensajeId: respId }]);
      const resumen = (d.acciones || []).length ? await ejecutar(d.acciones, arch) : [];
      setMsgs(m => [...m, { id: respId, rol: "ia", texto: d.respuesta || (resumen.length ? "Listo." : "…"), preguntas: (d.preguntas || []).length ? d.preguntas : undefined, resumen: resumen.length ? resumen : undefined }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setTrabajando(false); setProgreso(""); }
  }

  function responder(msgId: string, i: number, opcion: string) {
    setMsgs(ms => ms.map(m => (m.id === msgId && m.preguntas ? { ...m, preguntas: m.preguntas.map((p, j) => (j === i ? { ...p, respondida: opcion } : p)) } : m)));
    void enviar(opcion);
  }
  function deshacerUltimo() {
    setDeshacer(p => p); const u = deshacer[deshacer.length - 1]; if (!u) return;
    setLineas(u.lineas); lineasRef.current = u.lineas; setDeshacer(deshacer.slice(0, -1));
    setMsgs(m => [...m, { id: uid(), rol: "ia", texto: "Deshice la última respuesta." }]);
  }
  async function tomarImagen(f: File) {
    if (f.size > 10 * 1024 * 1024) { setError("Imagen muy grande (máx 10MB)"); return; }
    setArchivo(null); setImagen({ data: await leerBase64(f), media_type: f.type || "image/png", name: f.name || "captura.png" });
  }
  const elegirArchivo = (f: File | undefined | null) => { if (!f) return; if (f.type.startsWith("image/")) void tomarImagen(f); else { setImagen(null); setArchivo(f); } };

  // ── pasar al PR ──
  async function aplicar(reemplazar: boolean) {
    const out: CatalogoItemParaPR[] = [];
    for (const { l, c } of incluidas) {
      const desc = (d: string) => l.talle && !normalizar(d).includes(`talle ${normalizar(l.talle)}`) ? `${d} - Talle ${l.talle}` : d;
      const cand = c.cand;
      const precio = redondear2(c.precio);
      if (!cand) { out.push({ codigo: l.codigo || "", descripcion: desc(l.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN", precio_costo: 0, markup_porcentaje: 0, precio_venta: precio, iva_porcentaje: 21, proveedor_nombre: "", proveedor_id: "", stock_propio: false, lista_item_id: "", costo_moneda: prMoneda === "ARS" ? "ARS" : "USD" }); continue; }
      const costoPR = c.costo ?? 0;
      out.push({
        codigo: cand.codigo_interno || cand.codigo, descripcion: desc(cand.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN",
        precio_costo: cand.costo, markup_porcentaje: costoPR > 0 && precio > 0 ? Math.max(0, redondear2((precio / costoPR - 1) * 100)) : 0,
        precio_venta: precio, iva_porcentaje: 21, proveedor_nombre: cand.proveedor, proveedor_id: await proveedorDeLista(cand.proveedor), proveedor_lista: cand.proveedor,
        stock_propio: false, lista_item_id: "", costo_moneda: cand.moneda === "ARS" ? "ARS" : String(cand.moneda).toLowerCase().includes("divisa") ? "USD Divisa" : "USD",
      });
    }
    onAplicar(out, reemplazar); onClose();
  }

  if (!open || typeof document === "undefined") return null;
  const sinTc = !(tc > 0 || tcDivisas > 0) && prMoneda === "ARS";
  void prefsTc;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); elegirArchivo(e.dataTransfer.files?.[0]); }}
      onMouseDown={e => { if (e.target === e.currentTarget && !trabajando && !msgs.length) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Sparkles className="h-5 w-5 text-orange-500" /> Asistente IA <span className="text-xs font-normal text-zinc-400">· {clienteNombre || "sin cliente"} · {prMoneda === "ARS" ? "pesos" : "USD"}</span></h2>
            <p className="text-xs text-zinc-500">Hablale como a una persona: adjuntá el Excel, pedile lo que necesitás y corregilo mensaje a mensaje. Recién pasa al PR cuando vos lo decidís.</p>
          </div>
          <button onClick={onClose} disabled={trabajando}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(340px,2fr)_3fr]">
          {/* CHAT */}
          <div className="flex min-h-0 flex-col border-b border-zinc-200 md:border-b-0 md:border-r dark:border-zinc-700">
            <div className="min-h-[200px] flex-1 space-y-3 overflow-y-auto p-4">
              {!msgs.length && (
                <div className="space-y-2 text-sm text-zinc-500">
                  <p>Contame qué necesitás. Algunos ejemplos:</p>
                  {SUGERENCIAS.map(s => <button key={s} onClick={() => setTexto(s)} className="block w-full rounded-lg border border-zinc-200 px-3 py-2 text-left text-xs hover:border-orange-300 hover:bg-orange-50 dark:border-zinc-700 dark:hover:bg-orange-950/20">{s}</button>)}
                </div>
              )}
              {msgs.map(m => (
                <div key={m.id} className={m.rol === "yo" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[92%] space-y-1.5 rounded-2xl px-3 py-2 text-sm ${m.rol === "yo" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"}`}>
                    {m.adjunto && <p className="flex items-center gap-1 text-[11px] opacity-80"><Paperclip className="h-3 w-3" /> {m.adjunto}</p>}
                    <p className="whitespace-pre-wrap">{m.texto}</p>
                    {m.resumen?.map((r, i) => <p key={i} className="text-xs text-emerald-700 dark:text-emerald-400">✓ {r}</p>)}
                    {m.preguntas?.map((p, i) => (
                      <div key={i} className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                        <p className="font-medium">{p.pregunta}</p>
                        {p.respondida ? <p className="mt-1 text-emerald-700">→ {p.respondida}</p> : (p.opciones.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{p.opciones.map(o => <button key={o} disabled={trabajando} onClick={() => responder(m.id, i, o)} className="rounded-full border border-sky-300 bg-white px-2 py-0.5 hover:bg-sky-100 disabled:opacity-50 dark:bg-zinc-900">{o}</button>)}</div>)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {progreso && <p className="flex items-center gap-2 text-xs text-orange-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {progreso}</p>}
              {error && <p className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> {error}</p>}
              <div ref={finRef} />
            </div>
            <div className="space-y-1.5 border-t border-zinc-200 p-3 dark:border-zinc-700">
              {(archivo || imagen || leido) && <p className="flex items-center gap-1 text-xs text-emerald-700"><FileUp className="h-3.5 w-3.5" /> {archivo?.name || imagen?.name || `${leido?.nombre} (leído: ${leido?.lineas.length} renglones)`}
                {(archivo || imagen) && <button onClick={() => { setArchivo(null); setImagen(null); }} className="ml-1 text-zinc-400 hover:text-red-600"><X className="h-3 w-3" /></button>}</p>}
              <div className="flex gap-2">
                <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 text-zinc-500 hover:border-orange-400 hover:text-orange-600 dark:border-zinc-600" title="Adjuntar Excel, CSV, PDF o foto del pedido">
                  <Paperclip className="h-4 w-4" />
                  <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.csv,.ods,.pdf,image/*" onChange={e => { elegirArchivo(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2}
                  onPaste={e => { const it = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/")); const f = it?.getAsFile(); if (f) { e.preventDefault(); void tomarImagen(f); } }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                  placeholder="Escribile a la IA… (Enter envía, Shift+Enter salto de línea)"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
                <button onClick={() => void enviar()} disabled={trabajando || (!texto.trim() && !archivo && !imagen)} className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-lg bg-orange-500 text-white disabled:opacity-50">{trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
              </div>
            </div>
          </div>

          {/* BORRADOR */}
          <div className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 px-4 py-2 text-xs">
              <span className="font-semibold dark:text-white">Borrador del presupuesto</span>
              <span className="text-zinc-500">{incluidas.length} renglones · {fmt(totalVenta, prMoneda)} sin IVA</span>
              {sinTc && <span className="text-amber-600">⚠️ falta el dólar del PR</span>}
              <button onClick={deshacerUltimo} disabled={!deshacer.length || trabajando} className="ml-auto flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"><Undo2 className="h-3 w-3" /> Deshacer lo último</button>
            </div>
            <div className="min-h-[200px] flex-1 overflow-auto px-4 pb-2">
              {!filas.length ? <p className="py-10 text-center text-sm text-zinc-400">Todavía no hay renglones. Adjuntá el pedido o decile qué armar.</p> : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><tr>
                    <th className="px-1.5 py-1.5"><input type="checkbox" checked={lineas.every(l => l.incluir)} onChange={e => setLineas(ls => ls.map(l => ({ ...l, incluir: e.target.checked })))} /></th>
                    <th className="px-1.5">Pedido</th><th className="w-14 px-1.5">Cant.</th><th className="px-1.5">Artículo y proveedor</th><th className="px-1.5 text-right">Costo</th><th className="w-24 px-1.5 text-right">Precio</th><th className="px-1.5 text-right">Margen</th><th className="px-1.5">Estado</th>
                  </tr></thead>
                  <tbody>{filas.map(({ l, c }) => (
                    <tr key={l.id} className={`border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200 ${l.incluir ? "" : "opacity-40"}`}>
                      <td className="px-1.5 py-1.5"><input type="checkbox" checked={l.incluir} onChange={e => setLineas(ls => ls.map(x => (x.id === l.id ? { ...x, incluir: e.target.checked } : x)))} /></td>
                      <td className="max-w-[170px] px-1.5 py-1.5">{l.descripcion}{l.talle && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">T {l.talle}</span>}</td>
                      <td className="px-1.5 py-1"><input type="number" min={0} step="any" value={l.cantidad} onChange={e => setLineas(ls => ls.map(x => (x.id === l.id ? { ...x, cantidad: Number(e.target.value) || 0 } : x)))} className="w-14 rounded border border-zinc-200 px-1 py-0.5 text-right dark:border-zinc-700 dark:bg-zinc-800" /></td>
                      <td className="max-w-[260px] px-1.5 py-1.5">
                        {c.cand ? <><span className="font-medium">{c.cand.proveedor}</span> · {c.cand.codigo_interno || c.cand.codigo}<span className="block text-zinc-500">{c.cand.descripcion}{c.cand.marca ? ` · ${c.cand.marca}` : ""}</span></> : <span className="text-red-600">Sin artículo en la lista</span>}
                        {(l.nota || c.nota) && <span className="block text-[10px] text-amber-700 dark:text-amber-400">{[l.nota, c.nota].filter(Boolean).join(" · ")}</span>}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right">{c.costo !== null && c.cand ? fmt(c.costo, prMoneda) : "—"}</td>
                      <td className="px-1.5 py-1 text-right">
                        <input type="number" min={0} step="0.01" value={c.precio || ""} placeholder="0" onChange={e => setLineas(ls => ls.map(x => (x.id === l.id ? { ...x, precioFijo: e.target.value === "" ? null : Number(e.target.value), markupFijo: null, fuente: { tipo: "manual" } } : x)))}
                          className="w-24 rounded border border-zinc-200 px-1 py-0.5 text-right font-semibold dark:border-zinc-700 dark:bg-zinc-800" />
                        <span className="block text-[10px] text-zinc-400">{c.origen}</span>
                      </td>
                      <td className={`whitespace-nowrap px-1.5 py-1.5 text-right ${c.bajo ? "font-semibold text-red-600" : ""}`}>{c.margen !== null ? `${c.margen.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—"}</td>
                      <td className="px-1.5 py-1.5"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR[c.sem]}`}>{SEMAFORO_TXT[c.sem]}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <span className="mr-auto text-[11px] text-zinc-400">Margen mínimo {MARGEN_MINIMO_IA}% = solo aviso. El PR no cambia hasta que apretás uno de estos botones.</span>
          <button onClick={onClose} disabled={trabajando} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cerrar</button>
          <button disabled={!incluidas.length || trabajando} onClick={() => { if (window.confirm("Se reemplazan TODOS los renglones actuales del PR por este borrador. ¿Seguir?")) void aplicar(true); }} className="rounded-lg border border-orange-400 px-4 py-2 text-sm font-medium text-orange-700 disabled:opacity-50 dark:text-orange-300">Reemplazar los renglones del PR</button>
          <button disabled={!incluidas.length || trabajando} onClick={() => void aplicar(false)} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Agregar {incluidas.length} al PR</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
