/**
 * Búsqueda en la lista de costos (catalogo_costos) tolerante a cómo escribe la gente:
 * abreviaturas ("ant." = anteojo), códigos pegados ("CASCO3M"), plurales y acentos.
 * Se usa en la Cotización express y en la limpieza de OC.
 */
import { supabase } from "@/lib/supabase/client";

const db = supabase as any;

export type CatalogoCandidato = { id: string; proveedor: string; codigo: string; codigo_interno: string | null; descripcion: string; moneda: string; costo: number; precio_venta: number; marca?: string | null };

const STOP = new Set(["con", "para", "de", "del", "la", "el", "los", "las", "p", "y", "en", "x", "un", "una", "por", "tipo", "modelo", "mod", "color", "c", "s", "talle", "t"]);
const ABREV: Record<string, string> = { ant: "anteojo", g: "guante", gte: "guante", gtes: "guante", guantes: "guante", anteojos: "anteojo", barbijos: "barbijo", cascos: "casco", botines: "botin", endourales: "endoaural", endoaurales: "endoaural", endourale: "endoaural" };

export function normalizar(t: string) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/([a-z]{4,})(\d)/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim();
}
export function tokens(t: string) {
  return normalizar(t).split(" ").map(w => ABREV[w] || w).filter(w => w.length >= 2 && !STOP.has(w));
}
export const esCodigo = (w: string) => /\d/.test(w) && /[a-z]/.test(w) || /^\d{3,}$/.test(w);

function puntaje(c: CatalogoCandidato, toks: string[]) {
  const texto = ` ${normalizar(`${c.descripcion} ${c.codigo} ${c.codigo_interno || ""} ${c.marca || ""} ${c.proveedor}`)} `;
  let p = 0;
  for (const w of toks) {
    const raiz = w.length > 5 ? w.slice(0, w.length - 1) : w;
    if (texto.includes(` ${w} `)) p += esCodigo(w) ? 5 : 2;
    else if (texto.includes(raiz)) p += esCodigo(w) ? 3 : 1;
  }
  return p;
}

const COLS = "id, proveedor, codigo, codigo_interno, descripcion, moneda, costo, precio_venta, marca";

export type Prefs = { provs: string[]; soloProvs: boolean; marcas: string[]; soloMarcas: boolean };
export const SIN_PREFS: Prefs = { provs: [], soloProvs: false, marcas: [], soloMarcas: false };

export async function buscarCandidatos(texto: string, codigo = "", max = 15, prefs: Prefs = SIN_PREFS): Promise<CatalogoCandidato[]> {
  const toks = [...new Set(tokens(`${codigo} ${texto}`))];
  if (!toks.length) return [];
  const limpio = (w: string) => w.replace(/[,()%*\\]/g, "");
  const consultas: any[] = [];
  const codigos = toks.filter(esCodigo);
  const palabras = toks.filter(w => !esCodigo(w)).sort((a, b) => b.length - a.length);
  const base = (soloPref = false) => {
    let q = db.from("catalogo_costos").select(COLS).eq("activo", true);
    if (prefs.provs.length && (prefs.soloProvs || soloPref)) q = q.in("proveedor", prefs.provs);
    if (prefs.marcas.length && prefs.soloMarcas) q = q.in("marca", prefs.marcas);
    return q;
  };
  const y = (ws: string[], lim: number, soloPref = false) => {
    let q = base(soloPref);
    for (const w of ws) q = q.or(`descripcion.ilike.%${limpio(w)}%,codigo.ilike.%${limpio(w)}%,codigo_interno.ilike.%${limpio(w)}%,marca.ilike.%${limpio(w)}%,proveedor.ilike.%${limpio(w)}%`);
    return q.limit(lim);
  };
  if (codigo.trim()) consultas.push(base().or(`codigo.ilike.%${limpio(codigo.trim())}%,codigo_interno.ilike.%${limpio(codigo.trim())}%`).limit(20));
  if (codigos.length) consultas.push(y(codigos, 60));
  if (codigos.length && palabras.length) consultas.push(y([codigos[0], palabras[0]], 60));
  if (palabras.length >= 2) consultas.push(y(palabras.slice(0, 3), 80));
  if (palabras.length >= 2) consultas.push(y(palabras.slice(0, 2), 120));
  if (palabras.length) consultas.push(y([palabras[0]], 400));
  if (palabras.length >= 2) consultas.push(y([palabras[1]], 200));
  // Con proveedores preferidos: se busca también solo dentro de ellos, para que siempre aparezcan.
  if (prefs.provs.length && !prefs.soloProvs) {
    if (palabras.length) consultas.push(y([palabras[0]], 150, true));
    if (palabras.length >= 2) consultas.push(y(palabras.slice(0, 2), 100, true));
    if (codigos.length) consultas.push(y(codigos, 60, true));
  }
  const res = await Promise.all(consultas.map(q => q.then((r: any) => r.data || [], () => [])));
  const porId = new Map<string, CatalogoCandidato>();
  for (const lista of res) for (const r of lista) porId.set(r.id, { ...r, costo: Number(r.costo), precio_venta: Number(r.precio_venta) });
  const ordenados = [...porId.values()].map(c => ({ c, p: puntaje(c, toks) })).filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || a.c.costo - b.c.costo);
  // Primero el mejor de cada proveedor (para que no quede afuera ninguno que lo tenga), después el resto.
  const mejorTope = ordenados[0]?.p || 0;
  const porProv = new Map<string, { c: CatalogoCandidato; p: number }>();
  for (const x of ordenados) if (!porProv.has(x.c.proveedor) && x.p >= mejorTope * (prefs.provs.includes(x.c.proveedor) ? 0.35 : 0.6)) porProv.set(x.c.proveedor, x);
  const salida = [...porProv.values()];
  for (const x of ordenados) if (salida.length < max && !salida.includes(x)) salida.push(x);
  return salida.sort((a, b) => b.p - a.p || a.c.costo - b.c.costo).slice(0, Math.max(max, porProv.size)).map(x => x.c);
}
