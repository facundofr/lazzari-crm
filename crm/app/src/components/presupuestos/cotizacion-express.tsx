"use client";

/**
 * Cotización express: el vendedor tira un Excel, un PDF, una foto o pega el mensaje del cliente,
 * y se arma la lista de artículos buscando cada uno en la lista de costos (catalogo_costos).
 * La IA solo sugiere: todo se revisa en la tabla antes de agregarlo al presupuesto.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles, Search, FileUp, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { convertirAMonedaPR, normalizarProveedor, buscarProveedorCRM, type CatalogoItemParaPR } from "@/components/presupuestos/catalogo-picker";
import { Autocompletar } from "@/components/ui/autocompletar";
import { buscarCandidatos, normalizar, SIN_PREFS, type Prefs, type CatalogoCandidato as Cand } from "@/lib/catalogo-busqueda";

const db = supabase as any;

type Confianza = "alta" | "media" | "baja" | "ninguna" | "manual";
type Linea = { id: string; descripcion: string; cantidad: number; talle: string; codigo: string; candidatos: Cand[]; elegido: number | null; confianza: Confianza; nota: string; incluir: boolean; buscar: string; buscando?: boolean; provPref?: string };
type Pedido = { descripcion: string; cantidad: number; talle: string; codigo: string };
type Pregunta = { linea?: string; pregunta: string };

interface Props {
  open: boolean;
  onClose: () => void;
  prMoneda: string;
  tc: number;
  tcDivisas: number;
  /** reemplazar = true: los renglones actuales del presupuesto se reemplazan por estos ("rehacer el PR" desde el Excel). */
  onAgregar: (items: CatalogoItemParaPR[], reemplazar?: boolean) => void;
  onPedirTc?: () => void | Promise<boolean>;
  proveedoresCRM?: Array<{ id: string; razon_social: string }>;
  sociedadId?: string;
  /** Texto que ya escribió el vendedor (ej. la Solicitud): se precarga en el mensaje. */
  textoInicial?: string;
}

export function separarTalle(desc: string): { descripcion: string; talle: string } {
  const m = String(desc).match(/^(.*?)[\s\-–,]*\btalle\s*:?\s*([A-Za-z0-9/]+)\s*$/i);
  return m ? { descripcion: m[1].trim(), talle: m[2].toUpperCase() } : { descripcion: String(desc).trim(), talle: "" };
}

export async function leerExcel(file: File): Promise<{ lineas: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }>; texto: string }> {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const lineas: Array<{ descripcion: string; cantidad: number; talle: string; codigo: string }> = [];
  let texto = "";
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre];
    const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    let h = -1, cDesc = -1, cCant = -1, cCod = -1, cTalle = -1;
    for (let i = 0; i < Math.min(filas.length, 20) && h < 0; i++) {
      const f = filas[i].map((x: any) => normalizar(String(x)));
      const d = f.findIndex(x => /^(descrip|articulo|producto|detalle|item|material)/.test(x));
      if (d >= 0) {
        h = i; cDesc = d;
        cCant = f.findIndex(x => /^(cant|qty|unid)/.test(x));
        cCod = f.findIndex(x => /^(cod|sku|ref)/.test(x));
        cTalle = f.findIndex(x => /^talle/.test(x));
      }
    }
    if (h < 0) { texto += `\n${XLSX.utils.sheet_to_csv(ws)}`; continue; }
    for (const f of filas.slice(h + 1)) {
      const raw = String(f[cDesc] ?? "").trim();
      if (!raw || /^total/i.test(raw)) continue;
      const st = separarTalle(raw);
      const cant = cCant >= 0 ? Number(String(f[cCant]).replace(",", ".")) : 1;
      lineas.push({ descripcion: st.descripcion, talle: cTalle >= 0 && String(f[cTalle]).trim() ? String(f[cTalle]).trim().toUpperCase() : st.talle, codigo: cCod >= 0 ? String(f[cCod] ?? "").trim() : "", cantidad: cant > 0 ? cant : 1 });
    }
  }
  return { lineas, texto: texto.trim() };
}

export const leerBase64 = (file: File) => new Promise<string>((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => mal(new Error("No se pudo leer el archivo"));
  r.readAsDataURL(file);
});

const fmt = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COLOR: Record<Confianza, string> = {
  alta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  media: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  baja: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  ninguna: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  manual: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
};
const ETIQUETA: Record<Confianza, string> = { alta: "Seguro", media: "Revisar", baja: "Alternativa", ninguna: "No está", manual: "Elegido" };

export default function CotizacionExpress({ open, onClose, prMoneda, tc, tcDivisas, onAgregar, onPedirTc, proveedoresCRM, sociedadId, textoInicial }: Props) {
  const [mensaje, setMensaje] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [imagen, setImagen] = useState<{ data: string; media_type: string; name: string } | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [fase, setFase] = useState<"entrada" | "preguntas" | "revision">("entrada");
  // Preguntas de la IA (le falta un dato que cambia el artículo): al leer el pedido y al ajustar.
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [respuestas, setRespuestas] = useState<string[]>([]);
  const [pedidosPend, setPedidosPend] = useState<Pedido[]>([]);
  const [respuestasPrevias, setRespuestasPrevias] = useState("");
  const [instruccion, setInstruccion] = useState("");
  const [ultimaInstruccion, setUltimaInstruccion] = useState("");
  const [preguntasAj, setPreguntasAj] = useState<Pregunta[]>([]);
  const [respuestasAj, setRespuestasAj] = useState<string[]>([]);
  const [resumenAj, setResumenAj] = useState("");
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [notas, setNotas] = useState("");
  const [catProvs, setCatProvs] = useState<string[]>([]);
  const [catMarcas, setCatMarcas] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(SIN_PREFS);
  const [indicaciones, setIndicaciones] = useState("");
  const [provIds, setProvIds] = useState<Array<{ id: string; razon_social: string; nombre_fantasia?: string | null }>>([]);
  const [vinculos, setVinculos] = useState<Record<string, string>>({});
  const tcPedido = useRef(false);

  useEffect(() => { if (open && textoInicial?.trim()) setMensaje(textoInicial); }, [open, textoInicial]);

  useEffect(() => {
    if (!open) { tcPedido.current = false; return; }
    (async () => {
      let qp = db.from("proveedores").select("id, razon_social, nombre_fantasia").eq("activo", true);
      if (sociedadId) qp = qp.eq("sociedad_id", sociedadId);
      const { data } = await qp;
      setProvIds(data || []);
      if (sociedadId) {
        const { data: vs } = await db.from("catalogo_proveedores").select("proveedor_lista, proveedor_id").eq("sociedad_id", sociedadId);
        setVinculos(Object.fromEntries((vs || []).map((v: any) => [v.proveedor_lista, v.proveedor_id])));
      }
    })();
  }, [open, sociedadId]);

  useEffect(() => {
    if (!open || catProvs.length) return;
    (async () => {
      const sp = new Set<string>(), sm = new Set<string>();
      for (let desde = 0; desde < 80000; desde += 1000) {
        const { data } = await db.from("catalogo_costos").select("proveedor, marca").eq("activo", true).range(desde, desde + 999);
        (data || []).forEach((r: any) => { if (r.proveedor) sp.add(r.proveedor); if (r.marca) sm.add(r.marca); });
        if (!data || data.length < 1000) break;
      }
      setCatProvs([...sp].sort((a, b) => a.localeCompare(b, "es")));
      setCatMarcas([...sm].sort((a, b) => a.localeCompare(b, "es")));
    })();
  }, [open, catProvs.length]);

  const proveedorId = (nombre: string) => {
    if (vinculos[nombre]) return vinculos[nombre];
    const nf = normalizarProveedor(nombre);
    const f = provIds.find(p => p.nombre_fantasia && normalizarProveedor(p.nombre_fantasia) === nf);
    if (nf && f) return f.id;
    return buscarProveedorCRM(nombre, provIds.length ? provIds : (proveedoresCRM || []));
  };

  async function vincular(nombreLista: string, idCRM: string) {
    if (!idCRM) return;
    setVinculos(v => ({ ...v, [nombreLista]: idCRM }));
    if (sociedadId) await db.from("catalogo_proveedores").upsert({ sociedad_id: sociedadId, proveedor_lista: nombreLista, proveedor_id: idCRM }, { onConflict: "sociedad_id,proveedor_lista" });
    await db.from("proveedores").update({ nombre_fantasia: nombreLista }).eq("id", idCRM).is("nombre_fantasia", null);
  }

  const sinTc = useMemo(() => lineas.some(l => l.incluir && l.elegido !== null && convertirAMonedaPR(1, l.candidatos[l.elegido]?.moneda || prMoneda, prMoneda, tc, tcDivisas) === null), [lineas, prMoneda, tc, tcDivisas]);
  const [tcFallo, setTcFallo] = useState(false);
  const pedirTc = async () => {
    if (!onPedirTc) return;
    setTcFallo(false);
    const ok = await onPedirTc();
    if (ok === false) setTcFallo(true);
  };
  useEffect(() => { if (sinTc && onPedirTc && !tcPedido.current) { tcPedido.current = true; void pedirTc(); } }, [sinTc, onPedirTc]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setMensaje(""); setArchivo(null); setImagen(null); setLineas([]); setFase("entrada"); setProgreso(""); setError(""); setNotas("");
    setPreguntas([]); setRespuestas([]); setPedidosPend([]); setRespuestasPrevias(""); setInstruccion(""); setUltimaInstruccion(""); setPreguntasAj([]); setRespuestasAj([]); setResumenAj("");
  }
  function cerrar() { reset(); onClose(); }

  async function tomarImagen(file: File) {
    if (file.size > 10 * 1024 * 1024) { setError("Imagen muy grande (máx 10MB)"); return; }
    setImagen({ data: await leerBase64(file), media_type: file.type || "image/png", name: file.name || "captura.png" });
  }

  const textoRespuestas = (ps: Pregunta[], rs: string[]) => ps.map((p, i) => `${p.linea ? `[${p.linea}] ` : ""}${p.pregunta} → ${String(rs[i] || "").trim() || "(sin respuesta)"}`).join("\n");

  /** Busca candidatos en la lista de costos y la IA elige el de cada línea (modifica y devuelve las mismas líneas). */
  async function buscarYElegir(base: Linea[]): Promise<Linea[]> {
    const prefsDe = (l: Linea): Prefs => {
      if (!l.provPref) return prefs;
      const pp = normalizar(l.provPref);
      const enLista = catProvs.find((p) => normalizar(p) === pp) || catProvs.find((p) => normalizar(p).includes(pp) || pp.includes(normalizar(p)));
      return enLista ? { ...prefs, provs: [...new Set([...prefs.provs, enLista])] } : prefs;
    };
    // 1) candidatos de la lista de costos (de a 6 en paralelo)
    for (let i = 0; i < base.length; i += 6) {
      setProgreso(`Buscando en la lista de costos… ${Math.min(i + 6, base.length)} de ${base.length}`);
      await Promise.all(base.slice(i, i + 6).map(async l => { l.candidatos = await buscarCandidatos(`${l.descripcion}`, l.codigo, 15, prefsDe(l)); }));
    }

    // 2) la IA elige el candidato correcto en cada línea
    setProgreso("La IA está eligiendo el artículo de cada línea…");
    const res = await fetch("/api/cotizacion-express", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "elegir", pedidos: base.map(l => ({ id: l.id, descripcion: l.descripcion, talle: l.talle, codigo: l.codigo, proveedor_preferido: l.provPref || "", candidatos: l.candidatos.map(c => { const cp = convertirAMonedaPR(c.costo, c.moneda, prMoneda, tc, tcDivisas); return { proveedor: c.proveedor, codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca, moneda: c.moneda, costo: c.costo, costo_comparable: cp === null ? null : Math.round(cp * 100) / 100 }; }) })), moneda_comparable: prMoneda === "ARS" ? "ARS" : "USD", preferencias: { proveedores: prefs.provs, solo_proveedores: prefs.soloProvs, marcas: prefs.marcas, solo_marcas: prefs.soloMarcas, indicaciones: indicaciones.trim() } }),
    });
    const d = await res.json().catch(() => ({}));
    const porId = new Map<string, any>((d.elecciones || []).map((e: any) => [String(e.id), e]));
    for (const l of base) {
      const e = porId.get(l.id);
      const idx = e && e.indice !== null && e.indice !== undefined && l.candidatos[Number(e.indice)] ? Number(e.indice) : null;
      if (e) { l.elegido = idx; l.confianza = idx === null ? "ninguna" : (["alta", "media", "baja"].includes(e.confianza) ? e.confianza : "media"); l.nota = e.nota || ""; }
      else if (l.candidatos.length) { l.elegido = 0; l.confianza = "baja"; l.nota = "Sugerido por similitud (sin IA)"; }
      else { l.elegido = null; l.confianza = "ninguna"; }
    }
    return base;
  }

  async function armarDesdePedidos(pedidos: Pedido[]) {
    pedidos = pedidos.filter(p => p.descripcion);
    if (!pedidos.length) throw new Error("No encontré artículos. Probá pegando el texto o subiendo otro archivo.");
    const base: Linea[] = pedidos.map((p, i) => ({ id: String(i), ...p, candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, buscar: "" }));
    await buscarYElegir(base);
    setLineas(base); setFase("revision"); setProgreso("");
  }

  /** respuestasNuevas: lo que contestó el vendedor a las preguntas de la IA (vuelve a leer el pedido con eso). */
  async function armar(respuestasNuevas = "") {
    setError(""); setNotas("");
    try {
      let pedidos: Pedido[] = [];
      const esExcel = archivo && /\.(xlsx|xls|xlsm|csv|ods)$/i.test(archivo.name);
      const esPdf = archivo && /\.pdf$/i.test(archivo.name);
      let textoExtra = "";
      if (esExcel) {
        setProgreso("Leyendo la planilla…");
        const r = await leerExcel(archivo!);
        pedidos = r.lineas; textoExtra = r.texto;
      }
      if (!pedidos.length && (mensaje.trim() || imagen || esPdf || textoExtra)) {
        setProgreso("La IA está leyendo el pedido…");
        const todasRespuestas = [respuestasPrevias, respuestasNuevas].filter(Boolean).join("\n");
        const res = await fetch("/api/cotizacion-express", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modo: "extraer",
            mensaje: [mensaje, textoExtra].filter(Boolean).join("\n\n"),
            imagen: imagen ? { data: imagen.data, media_type: imagen.media_type } : undefined,
            pdf: esPdf ? { data: await leerBase64(archivo!) } : undefined,
            respuestas: todasRespuestas || undefined,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "La IA no pudo leer el pedido");
        if (d.notas) setNotas(d.notas);
        setRespuestasPrevias(todasRespuestas);
        pedidos = (d.lineas || []).map((l: any) => {
          const st = separarTalle(l.descripcion || "");
          return { descripcion: st.descripcion, talle: String(l.talle || st.talle || "").toUpperCase(), codigo: String(l.codigo || ""), cantidad: Number(l.cantidad) > 0 ? Number(l.cantidad) : 1 };
        });
        const ps: Pregunta[] = Array.isArray(d.preguntas) ? d.preguntas.filter((p: any) => p?.pregunta) : [];
        if (ps.length) {
          // Le falta un dato que cambia el artículo: se pregunta antes de buscar (nunca inventa). Se puede seguir sin responder.
          setPedidosPend(pedidos); setPreguntas(ps); setRespuestas(ps.map(() => "")); setFase("preguntas"); setProgreso("");
          return;
        }
      }
      await armarDesdePedidos(pedidos);
    } catch (e) {
      setProgreso(""); setError(e instanceof Error ? e.message : "Error inesperado");
    }
  }

  async function seguirSinResponder() {
    setError("");
    try { await armarDesdePedidos(pedidosPend); } catch (e) { setProgreso(""); setError(e instanceof Error ? e.message : "Error inesperado"); }
  }

  /** "Decile a la IA qué cambiar": agrega, cambia (cantidad, talle, artículo, proveedor) o quita líneas. Se puede repetir. */
  async function ajustar(respuestasTxt = "") {
    const base = respuestasTxt ? ultimaInstruccion : instruccion.trim();
    if (!base) return;
    const instr = respuestasTxt ? `${base}\nRespuestas a tus preguntas:\n${respuestasTxt}` : base;
    setError(""); setResumenAj(""); setProgreso("La IA está ajustando la cotización…");
    try {
      const res = await fetch("/api/cotizacion-express", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: "ajustar", instruccion: instr,
          lineas: lineas.map(l => { const c = l.elegido !== null ? l.candidatos[l.elegido] : null; return { id: l.id, descripcion: l.descripcion, cantidad: l.cantidad, talle: l.talle, incluida: l.incluir, articulo: c ? `${c.proveedor} · ${c.descripcion}${c.marca ? ` · ${c.marca}` : ""}` : "" }; }),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "La IA no pudo ajustar la cotización");
      const quitar = new Set<string>((d.quitar || []).map(String));
      let nuevas = lineas.filter(l => !quitar.has(l.id));
      const aBuscar: Linea[] = [];
      for (const c of d.cambiar || []) {
        const l = nuevas.find(x => x.id === String(c.id));
        if (!l) continue;
        const n: Linea = { ...l };
        let rebuscar = false;
        if (Number(c.cantidad) > 0) n.cantidad = Number(c.cantidad);
        if (c.talle != null && String(c.talle).toUpperCase() !== l.talle) { n.talle = String(c.talle).toUpperCase(); rebuscar = true; }
        if (c.descripcion && String(c.descripcion) !== l.descripcion) { n.descripcion = String(c.descripcion); rebuscar = true; }
        if (c.proveedor_preferido) { n.provPref = String(c.proveedor_preferido); rebuscar = true; }
        if (rebuscar) { n.candidatos = []; aBuscar.push(n); }
        nuevas = nuevas.map(x => (x.id === n.id ? n : x));
      }
      let max = Math.max(-1, ...lineas.map(l => Number(l.id)).filter(Number.isFinite));
      for (const a of d.agregar || []) {
        if (!a?.descripcion) continue;
        const st = separarTalle(String(a.descripcion));
        const n: Linea = { id: String(++max), descripcion: st.descripcion, talle: String(a.talle || st.talle || "").toUpperCase(), codigo: String(a.codigo || ""), cantidad: Number(a.cantidad) > 0 ? Number(a.cantidad) : 1, candidatos: [], elegido: null, confianza: "ninguna", nota: "", incluir: true, buscar: "", provPref: a.proveedor_preferido ? String(a.proveedor_preferido) : "" };
        nuevas.push(n); aBuscar.push(n);
      }
      if (aBuscar.length) {
        const hechas = await buscarYElegir(aBuscar);
        const porId = new Map(hechas.map(h => [h.id, h]));
        nuevas = nuevas.map(l => porId.get(l.id) || l);
      }
      setLineas(nuevas);
      const ps: Pregunta[] = Array.isArray(d.preguntas) ? d.preguntas.filter((p: any) => p?.pregunta) : [];
      setPreguntasAj(ps); setRespuestasAj(ps.map(() => ""));
      setUltimaInstruccion(base);
      setResumenAj(d.resumen || `${d.agregar?.length || 0} agregadas · ${d.cambiar?.length || 0} cambiadas · ${quitar.size} quitadas`);
      if (!respuestasTxt) setInstruccion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado");
    } finally {
      setProgreso("");
    }
  }

  // Buscador por línea: se abre debajo de la fila, busca mientras escribís y elegís con un clic.
  const [abierto, setAbierto] = useState<string | null>(null);
  const [busq, setBusq] = useState("");
  const [resultados, setResultados] = useState<Cand[]>([]);
  const [cargandoBusq, setCargandoBusq] = useState(false);
  const [filtroProv, setFiltroProv] = useState("");
  useEffect(() => {
    if (!abierto || busq.trim().length < 2) { setResultados([]); return; }
    let cancelado = false;
    const t = setTimeout(async () => {
      setCargandoBusq(true);
      const r = await buscarCandidatos(busq, "", 80);
      if (!cancelado) { setResultados(r); setCargandoBusq(false); }
    }, 300);
    return () => { cancelado = true; clearTimeout(t); };
  }, [abierto, busq]);
  function abrirBusqueda(l: Linea) {
    if (abierto === l.id) { setAbierto(null); return; }
    setAbierto(l.id); setFiltroProv(""); setBusq(l.buscar || l.descripcion);
  }
  function elegirResultado(id: string, c: Cand) {
    setLineas(ls => ls.map(l => l.id === id ? { ...l, candidatos: [c, ...l.candidatos.filter(k => k.id !== c.id)], elegido: 0, confianza: "manual", nota: "", buscar: busq } : l));
    setAbierto(null);
  }

  const upd = (id: string, cambios: Partial<Linea>) => setLineas(ls => ls.map(l => l.id === id ? { ...l, ...cambios } : l));

  function agregar(reemplazar = false) {
    const out: CatalogoItemParaPR[] = [];
    for (const l of lineas) {
      if (!l.incluir) continue;
      const desc = (d: string) => l.talle && !normalizar(d).includes(`talle ${normalizar(l.talle)}`) ? `${d} - Talle ${l.talle}` : d;
      const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
      if (!c) {
        out.push({ codigo: l.codigo || "", descripcion: desc(l.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN", precio_costo: 0, markup_porcentaje: 0, precio_venta: 0, iva_porcentaje: 21, proveedor_nombre: "", proveedor_id: "", stock_propio: false, lista_item_id: "", costo_moneda: prMoneda === "ARS" ? "ARS" : "USD" });
        continue;
      }
      const costoPR = convertirAMonedaPR(c.costo, c.moneda, prMoneda, tc, tcDivisas);
      const ventaPR = convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas);
      if (costoPR === null || ventaPR === null) continue;
      out.push({
        codigo: c.codigo_interno || c.codigo, descripcion: desc(c.descripcion), categoria: "", cantidad: l.cantidad, unidad: "UN",
        precio_costo: c.costo, markup_porcentaje: costoPR > 0 ? Math.round(((ventaPR / costoPR) - 1) * 10000) / 100 : 0,
        precio_venta: Math.round(ventaPR * 100) / 100, iva_porcentaje: 21, proveedor_nombre: c.proveedor, proveedor_id: proveedorId(c.proveedor), proveedor_lista: c.proveedor,
        stock_propio: false, lista_item_id: "", costo_moneda: c.moneda === "ARS" ? "ARS" : c.moneda === "USD divisa" ? "USD Divisa" : "USD",
      });
    }
    onAgregar(out, reemplazar);
    cerrar();
  }

  if (!open || typeof document === "undefined") return null;
  const incluidas = lineas.filter(l => l.incluir);
  const cuenta = (c: Confianza) => lineas.filter(l => l.confianza === c).length;
  const totalVenta = incluidas.reduce((s, l) => {
    const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
    const v = c ? convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas) : 0;
    return s + (v || 0) * l.cantidad;
  }, 0);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" onMouseDown={e => { if (e.target === e.currentTarget && fase === "entrada" && !progreso) cerrar(); }}>
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Sparkles className="h-5 w-5 text-orange-500" /> Cotización express</h2>
            <p className="text-xs text-zinc-500">Tirá un Excel, PDF o foto, o pegá el mensaje del cliente. Se busca cada artículo en la lista de costos y vos revisás antes de agregar.</p>
          </div>
          <button onClick={cerrar} disabled={!!progreso}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        {fase === "entrada" && <div className="space-y-3 overflow-y-auto p-5">
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (!f) return; if (f.type.startsWith("image/")) { void tomarImagen(f); } else setArchivo(f); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-orange-300 bg-orange-50/50 p-6 text-sm text-orange-700 hover:border-orange-500 dark:border-orange-800 dark:bg-orange-950/20 dark:text-orange-300">
            <FileUp className="h-6 w-6" />
            <span className="font-medium">Arrastrá o elegí un Excel, CSV, PDF o imagen</span>
            {archivo && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {archivo.name}</span>}
            {imagen && <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="h-3 w-3" /> {imagen.name}</span>}
            <input type="file" className="hidden" accept=".xlsx,.xls,.xlsm,.csv,.ods,.pdf,image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (f.type.startsWith("image/")) { setArchivo(null); void tomarImagen(f); } else { setImagen(null); setArchivo(f); } }} />
          </label>
          <textarea
            value={mensaje}
            onChange={e => setMensaje(e.target.value)}
            onPaste={e => { const it = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/")); const f = it?.getAsFile(); if (f) { e.preventDefault(); void tomarImagen(f); } }}
            rows={6}
            placeholder="…o pegá acá el mensaje / mail / WhatsApp del cliente, o una captura (Ctrl+V)"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          {(archivo || imagen) && <button onClick={() => { setArchivo(null); setImagen(null); }} className="text-xs text-zinc-500 hover:text-red-600">Quitar archivo</button>}
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">Preferencias (opcional)</p>
            <div className="grid gap-3 md:grid-cols-2">
              {([["provs", "soloProvs", "Proveedores", catProvs, "Solo estos (centralizar la cotización)"], ["marcas", "soloMarcas", "Marcas", catMarcas, "Solo estas marcas"]] as const).map(([k, kSolo, titulo, opciones, txtSolo]) => (
                <div key={k}>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-zinc-500">{titulo}</label>
                    {prefs[k].length > 0 && <label className="flex items-center gap-1 text-[11px] text-zinc-600 dark:text-zinc-300"><input type="checkbox" checked={prefs[kSolo]} onChange={e => setPrefs(p => ({ ...p, [kSolo]: e.target.checked }))} /> {txtSolo}</label>}
                  </div>
                  <Autocompletar mostrarSinEscribir
                    opciones={opciones.filter(o => !prefs[k].includes(o)).map(o => ({ valor: o, texto: o }))}
                    placeholder={`Escribí para buscar ${titulo.toLowerCase()}…`}
                    onElegir={v => setPrefs(p => ({ ...p, [k]: p[k].includes(v) ? p[k] : [...p[k], v] }))}
                    className="mt-1 w-full border-zinc-200 dark:border-zinc-700" />
                  {prefs[k].length > 0 && <div className="mt-1 flex flex-wrap gap-1">{prefs[k].map(v => <span key={v} className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">{v}<button onClick={() => setPrefs(p => ({ ...p, [k]: p[k].filter(x => x !== v) }))}><X className="h-3 w-3" /></button></span>)}</div>}
                  {prefs[k].length > 0 && !prefs[kSolo] && <p className="mt-0.5 text-[10px] text-zinc-400">Se prefieren; si no lo tienen, busca en el resto.</p>}
                </div>
              ))}
            </div>
            <label className="mt-3 block text-[11px] text-zinc-500">Otras indicaciones para la IA</label>
            <input value={indicaciones} onChange={e => setIndicaciones(e.target.value)} placeholder="Ej: lo más económico · calzado con puntera de composite · todo en color naranja · priorizar stock nacional" className="mt-1 w-full rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
          </div>
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {progreso && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
        </div>}

        {fase === "preguntas" && <div className="space-y-3 overflow-y-auto p-5">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
            <p className="mb-2 font-semibold">La IA necesita estos datos para no inventar ({pedidosPend.length} artículos leídos):</p>
            <div className="space-y-2">
              {preguntas.map((p, i) => (
                <label key={i} className="block text-xs">
                  <span className="font-medium">{p.linea ? <span className="opacity-70">{p.linea}: </span> : null}{p.pregunta}</span>
                  <input value={respuestas[i] || ""} onChange={e => setRespuestas(rs => rs.map((r, j) => (j === i ? e.target.value : r)))}
                    onKeyDown={e => { if (e.key === "Enter" && !progreso) void armar(textoRespuestas(preguntas, respuestas)); }}
                    placeholder="Tu respuesta (podés dejarla vacía)" className="mt-0.5 w-full rounded border border-sky-200 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-sky-800 dark:bg-zinc-800 dark:text-white" />
                </label>
              ))}
            </div>
          </div>
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {progreso && <p className="flex items-center gap-2 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
        </div>}

        {fase === "revision" && <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-5 py-2 text-xs">
            <span className="text-zinc-500">{lineas.length} líneas:</span>
            {(["alta", "media", "baja", "manual", "ninguna"] as Confianza[]).filter(c => cuenta(c)).map(c => <span key={c} className={`rounded-full px-2 py-0.5 font-medium ${COLOR[c]}`}>{cuenta(c)} {ETIQUETA[c]}</span>)}
            {sinTc && !tcFallo && <span className="text-amber-600">Trayendo tipo de cambio BNA…</span>}
            {sinTc && tcFallo && <span className="text-red-600">No se pudo traer el BNA. Cargá el tipo de cambio en el presupuesto o <button onClick={() => { tcPedido.current = true; void pedirTc(); }} className="underline">reintentá</button>.</span>}
            {notas && <span className="text-zinc-500">· {notas}</span>}
          </div>
          <div className="px-5 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
              <input value={instruccion} onChange={e => setInstruccion(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !progreso) void ajustar(); }}
                placeholder="Decile a la IA qué cambiar: agregame 20 guantes nitrilo T9 · cambiá los anteojos a Segufer · sacá los cascos"
                className="min-w-[260px] flex-1 rounded border border-orange-200 px-2 py-1 text-xs dark:border-orange-800 dark:bg-zinc-800 dark:text-white" />
              <button onClick={() => void ajustar()} disabled={!!progreso || !instruccion.trim()} className="flex items-center gap-1 rounded bg-orange-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                {progreso ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Aplicar
              </button>
            </div>
            {progreso && <p className="mt-1 flex items-center gap-1 text-xs text-orange-600"><Loader2 className="h-3 w-3 animate-spin" /> {progreso}</p>}
            {error && <p className="mt-1 text-xs text-red-600">⚠️ {error}</p>}
            {resumenAj && !progreso && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">✓ {resumenAj}. Revisá y seguí editando a mano si hace falta.</p>}
            {preguntasAj.length > 0 && (
              <div className="mt-1.5 space-y-1 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                <p className="font-semibold">La IA pregunta antes de cambiar (no inventa):</p>
                {preguntasAj.map((p, i) => (
                  <label key={i} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">{p.linea ? <span className="opacity-70">{p.linea}: </span> : null}{p.pregunta}</span>
                    <input value={respuestasAj[i] || ""} onChange={e => setRespuestasAj(rs => rs.map((r, j) => (j === i ? e.target.value : r)))} className="w-48 rounded border border-sky-200 bg-white px-1.5 py-0.5 text-zinc-800 dark:border-sky-800 dark:bg-zinc-800 dark:text-white" />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => void ajustar(textoRespuestas(preguntasAj, respuestasAj))} disabled={!!progreso} className="rounded bg-sky-600 px-2.5 py-0.5 font-medium text-white disabled:opacity-50">Responder y aplicar</button>
                  <button onClick={() => setPreguntasAj([])} className="rounded border border-sky-300 px-2.5 py-0.5">Dejar así</button>
                </div>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  <th className="px-2 py-2"><input type="checkbox" checked={lineas.every(l => l.incluir)} onChange={e => setLineas(ls => ls.map(l => ({ ...l, incluir: e.target.checked })))} /></th>
                  <th className="px-2">Pedido del cliente</th><th className="px-2 w-16">Cant.</th><th className="px-2">Artículo de la lista</th>
                  <th className="px-2 text-right">Costo</th><th className="px-2 text-right">Venta ({prMoneda === "ARS" ? "$" : "US$"})</th><th className="px-2">Estado</th><th className="px-2">Cambiar</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const c = l.elegido !== null ? l.candidatos[l.elegido] : null;
                  const venta = c ? convertirAMonedaPR(c.precio_venta, c.moneda, prMoneda, tc, tcDivisas) : null;
                  return <Fragment key={l.id}><tr className={`border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200 ${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} ${l.incluir ? "" : "opacity-40"}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={l.incluir} onChange={e => upd(l.id, { incluir: e.target.checked })} /></td>
                    <td className="max-w-[220px] px-2 py-2">{l.descripcion}{l.talle && <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">T {l.talle}</span>}{l.codigo && <span className="block text-[10px] text-zinc-400">cód. {l.codigo}</span>}</td>
                    <td className="px-2 py-1.5"><input type="number" min={0} step="any" value={l.cantidad} onChange={e => upd(l.id, { cantidad: Number(e.target.value) || 0 })} className="w-16 rounded border border-zinc-200 px-1 py-0.5 text-right dark:border-zinc-700 dark:bg-zinc-800" /></td>
                    <td className="px-2 py-1.5">
                      <select value={l.elegido ?? ""} onChange={e => upd(l.id, { elegido: e.target.value === "" ? null : Number(e.target.value), confianza: e.target.value === "" ? "ninguna" : "manual", nota: "" })} className="w-full max-w-[420px] rounded border border-zinc-200 px-1 py-1 dark:border-zinc-700 dark:bg-zinc-800">
                        <option value="">— Sin artículo (cargar precio a mano) —</option>
                        {l.candidatos.map((k, j) => { const cp = convertirAMonedaPR(k.costo, k.moneda, prMoneda, tc, tcDivisas); return <option key={k.id} value={j}>{k.proveedor} · {k.codigo_interno || k.codigo} · {k.descripcion} · {fmt(k.costo, k.moneda)}{cp !== null && (k.moneda.toUpperCase().startsWith("USD") !== (prMoneda === "USD")) ? ` (≈ ${fmt(cp, prMoneda)})` : ""}</option>; })}
                      </select>
                      {l.nota && <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">{l.nota}</p>}
                      {c && <div className={`mt-1 flex items-center gap-1 text-[10px] ${proveedorId(c.proveedor) ? "text-zinc-500" : "text-red-600"}`}>
                        <span className="whitespace-nowrap">{proveedorId(c.proveedor) ? `“${c.proveedor}” de la lista =` : `⚠ “${c.proveedor}” no está vinculado →`}</span>
                        <Autocompletar chico mostrarSinEscribir
                          opciones={[...(provIds.length ? provIds : (proveedoresCRM || []))].sort((a, b) => a.razon_social.localeCompare(b.razon_social, "es")).map(p => ({ valor: p.id, texto: p.razon_social }))}
                          placeholder={proveedorId(c.proveedor) ? ((provIds.length ? provIds : (proveedoresCRM || [])).find(p => p.id === proveedorId(c.proveedor))?.razon_social || "Cambiar…") : "Escribí el proveedor del CRM…"}
                          onElegir={v => vincular(c.proveedor, v)}
                          className={`w-[200px] ${proveedorId(c.proveedor) ? "border-zinc-200 placeholder:text-zinc-700 dark:border-zinc-700 dark:placeholder:text-zinc-300" : "border-red-200 dark:border-red-800"}`} />
                      </div>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">{c ? fmt(c.costo, c.moneda) : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold">{venta !== null && c ? fmt(venta, prMoneda) : "—"}</td>
                    <td className="px-2 py-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COLOR[l.confianza]}`}>{ETIQUETA[l.confianza]}</span></td>
                    <td className="px-2 py-1.5">
                      <button onClick={() => abrirBusqueda(l)} className={`flex items-center gap-1 rounded border px-2 py-1 whitespace-nowrap ${abierto === l.id ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30" : "border-zinc-200 text-zinc-600 hover:border-orange-400 hover:text-orange-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
                        <Search className="h-3.5 w-3.5" /> {abierto === l.id ? "Cerrar" : "Buscar"}
                      </button>
                    </td>
                  </tr>
                  {abierto === l.id && <tr className="bg-orange-50/60 dark:bg-orange-950/20"><td colSpan={8} className="px-3 py-2">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Search className="h-4 w-4 text-orange-500" />
                      <input autoFocus value={busq} onChange={e => setBusq(e.target.value)} placeholder="Palabras, código o proveedor (ej: endoaural segutecnica)" className="min-w-[260px] flex-1 rounded border border-orange-300 px-2 py-1 text-xs dark:border-orange-800 dark:bg-zinc-800 dark:text-white" />
                      {cargandoBusq && <Loader2 className="h-4 w-4 animate-spin text-orange-500" />}
                      {[...new Set(resultados.map(r => r.proveedor))].length > 1 && <select value={filtroProv} onChange={e => setFiltroProv(e.target.value)} className="rounded border border-zinc-200 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800">
                        <option value="">Todos los proveedores</option>
                        {[...new Set(resultados.map(r => r.proveedor))].sort().map(pv => <option key={pv} value={pv}>{pv}</option>)}
                      </select>}
                      <span className="text-[10px] text-zinc-500">{resultados.length} resultados · clic para elegir</span>
                    </div>
                    <div className="max-h-64 overflow-auto rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                      {resultados.filter(r => !filtroProv || r.proveedor === filtroProv).map((r, j) => {
                        const cp = convertirAMonedaPR(r.costo, r.moneda, prMoneda, tc, tcDivisas);
                        const vp = convertirAMonedaPR(r.precio_venta, r.moneda, prMoneda, tc, tcDivisas);
                        return <button key={r.id} onClick={() => elegirResultado(l.id, r)} className={`grid w-full grid-cols-[150px_110px_1fr_110px_110px] gap-2 border-b border-zinc-100 px-2 py-1.5 text-left text-xs hover:bg-orange-100 dark:border-zinc-800 dark:hover:bg-orange-900/30 ${j % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}>
                          <span className="truncate font-medium" title={r.proveedor}>{r.proveedor}</span>
                          <span className="truncate text-zinc-500">{r.codigo_interno || r.codigo}</span>
                          <span className="truncate" title={r.descripcion}>{r.descripcion}</span>
                          <span className="text-right">{fmt(r.costo, r.moneda)}{cp !== null && r.moneda.toUpperCase().startsWith("USD") !== (prMoneda === "USD") ? <span className="block text-[10px] text-zinc-400">≈ {fmt(cp, prMoneda)}</span> : null}</span>
                          <span className="text-right font-semibold">{vp !== null ? fmt(vp, prMoneda) : "—"}</span>
                        </button>;
                      })}
                      {!cargandoBusq && busq.trim().length >= 2 && !resultados.length && <p className="p-3 text-center text-xs text-zinc-400">Sin resultados. Probá con menos palabras o con el código.</p>}
                    </div>
                  </td></tr>}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>
        </div>}

        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div className="text-xs text-zinc-500">
            {fase === "revision" && <>Total venta (lista, sin IVA): <b className="text-zinc-800 dark:text-white">{fmt(totalVenta, prMoneda)}</b> · Las líneas “Sin artículo” entran con precio 0 para completar a mano.</>}
          </div>
          <div className="flex gap-2">
            {fase !== "entrada" && <button onClick={() => { setFase("entrada"); setLineas([]); setPreguntas([]); setPreguntasAj([]); setResumenAj(""); }} disabled={!!progreso} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Volver</button>}
            <button onClick={cerrar} disabled={!!progreso} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cancelar</button>
            {fase === "preguntas" && <>
              <button onClick={() => void seguirSinResponder()} disabled={!!progreso} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Seguir sin responder</button>
              <button onClick={() => void armar(textoRespuestas(preguntas, respuestas))} disabled={!!progreso} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{progreso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Seguir con mis respuestas</button>
            </>}
            {fase === "preguntas" ? null : fase === "entrada"
              ? <button onClick={() => void armar()} disabled={!!progreso || (!mensaje.trim() && !archivo && !imagen)} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{progreso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Armar cotización</button>
              : <>
                <button onClick={() => { if (window.confirm("Se reemplazan TODOS los renglones actuales del presupuesto por estos. ¿Seguir?")) agregar(true); }} disabled={!incluidas.length || sinTc} className="rounded-lg border border-orange-400 px-3 py-2 text-sm font-medium text-orange-700 disabled:opacity-50 dark:text-orange-300" title="Rehace el presupuesto con lo que leyó (por ejemplo, de tu Excel)">Reemplazar los renglones del PR</button>
                <button onClick={() => agregar(false)} disabled={!incluidas.length || sinTc} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Agregar {incluidas.length} al presupuesto</button>
              </>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
