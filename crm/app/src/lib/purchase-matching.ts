/**
 * Motor de emparejamiento de facturas de compra contra órdenes de compra.
 *
 * El cruce es por LÍNEA de artículo, no por total. Una línea de factura puede
 * repartirse entre varias OC y una OC puede completarse con varias facturas.
 *
 * Cómo decide:
 *  1. Separa cada descripción en producto + talle (+ dama/hombre):
 *     "PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 40" → producto "pantalon cargo elastizazdo beige pampero", talle "40".
 *     "Pampero Remera M/C Gris Mel. XL/MG"                    → producto "pampero remera m c gris mel", talle "XL".
 *  2. Decide qué producto de la factura es qué producto de la OC (equivalencias). Las
 *     propone la IA o, si no está disponible, una similitud de palabras. El usuario
 *     siempre puede corregirlas. Nunca se empareja un talle con otro distinto.
 *  3. Asigna cantidades: primero donde la cantidad coincide exacta, después reparte
 *     empezando por el precio más parecido y la OC más vieja.
 *
 * No guarda nada: devuelve una propuesta que el usuario revisa (semáforo).
 */

export interface InvoiceLineInput {
  key: string;               // identificador temporal de la línea de factura
  facturaRef?: string;       // número de factura (para carga múltiple)
  codigo?: string | null;
  descripcion: string;
  cantidad: number;
  precio: number;            // neto unitario (con descuento aplicado)
}

export interface OcLineInput {
  id: string;                // id de la línea de OC
  ocId: string;
  ocNumero: string;
  ocFecha: string;           // YYYY-MM-DD
  codigo?: string | null;
  descripcion: string;
  cantidad: number;          // cantidad pendiente de facturar
  precio: number;            // costo unitario de la OC
}

export interface Variant { producto: string; talle: string | null; genero: "F" | "M" | null }

export type Semaforo = "verde" | "amarillo" | "rojo";

export interface Asignacion {
  invoiceKey: string;
  ocLineId: string;
  ocId: string;
  ocNumero: string;
  cantidad: number;
  precioFactura: number;
  precioOc: number;
  diferencia: number;        // (precioFactura − precioOc) × cantidad
  semaforo: Exclude<Semaforo, "rojo">;
  /** "parecido": propuesta por nombre parecido + cantidad/precio (siempre amarilla, la confirma el usuario). */
  origen: "codigo" | "equivalencia" | "parecido" | "manual";
  nota?: string;             // ej.: "La OC pide reflectivo y la factura no lo menciona"
}

export interface MatchResult {
  asignaciones: Asignacion[];
  /**
   * Cantidades de factura que no entraron en ninguna OC.
   * - "sin_oc": el artículo no está en ninguna OC (rojo).
   * - "de_mas": el artículo está en la OC pero la factura trae más que lo pendiente (amarillo);
   *   `ocLineId` es el renglón de OC donde se cargó el resto.
   */
  sinAsignar: Array<{ invoiceKey: string; cantidad: number; motivo: string; tipo: "sin_oc" | "de_mas"; ocLineId?: string; ocNumero?: string }>;
  /** Cantidades de OC que siguen pendientes después de esta(s) factura(s). */
  pendientesOc: Array<{ ocLineId: string; ocId: string; ocNumero: string; cantidad: number }>;
  ocsCompletas: string[];
  ocsParciales: string[];
}

/** Equivalencias de producto: producto de factura → productos de OC que son el mismo artículo. */
export type Equivalencias = Record<string, string[]>;

/** Talle comodín para "talle especial" (ver opciones.tallesEspeciales de matchPurchaseLines). */
export const TALLE_ESPECIAL = "ESP";

const LETTER_SIZES = ["XXXXL", "XXXL", "XXL", "4XL", "3XL", "2XL", "XL", "XS", "S", "M", "L"];
const NORMALIZE_SIZE: Record<string, string> = { XXL: "2XL", XXXL: "3XL", XXXXL: "4XL", "2L": "2XL", "3L": "3XL", "4L": "4XL" }; // "T4L" es un error común por 4XL

export function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSize(raw: string): string {
  const up = raw.toUpperCase();
  return NORMALIZE_SIZE[up] || up;
}

/** Separa producto, talle y género de una descripción. */
export function parseVariant(descripcion: string): Variant {
  const original = String(descripcion || "");
  // "M/C" y "m/l" son manga corta / larga, no talles.
  let text = original
    .replace(/\[PR-[^\]]+\]/gi, " ")
    .replace(/\bm\s*\/\s*c\b/gi, " manga corta ")
    .replace(/\bm\s*\/\s*l\b/gi, " manga larga ");
  let talle: string | null = null;

  // "Talle especial", "T. ESP", "TALLES ESPECIALES": el proveedor agrupa varios talles grandes bajo un mismo precio.
  const especial = /\b(?:talles?|t\.?)\s*(?:especial(?:es)?|esp\.?)(?=\s|$|[^a-z])/i;
  if (especial.test(text)) {
    talle = TALLE_ESPECIAL;
    text = text.replace(especial, " ");
  }

  const patterns: RegExp[] = talle ? [] : [
    // "TALLE 40", "TALLE XL", "Talle: 3XL"
    /\btalle\s*:?\s*(\d{1,3}|\d?x{0,3}[sml]|xs)\b/i,
    // "T40", "T 40", "TXL", "T2XL", "T M"
    /\bt\s?(\d{2,3}|\d?x{0,3}l|xs|[sml])\b/i,
    // "XL/MG", "M/M", "2XL/MMG", "S/CH": talle internacional seguido de equivalencia
    /\b(\d?x{0,3}[sml]|xs)\s*\/\s*[a-z0-9]{1,4}\b/i,
    // talle al final: "... Beige 40", "... Arena M"
    /\b(\d{2,3}|\d?x{0,3}l|xs|[sml])\s*(?:\([^)]*\))?\s*$/i,
  ];
  for (const re of patterns) {
    // Se toma la última aparición: el talle suele ir al final de la descripción.
    const all = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
    const m = all[all.length - 1];
    if (m) {
      const value = m[1].replace(/\s/g, "");
      if (/^\d+$/.test(value) || LETTER_SIZES.includes(normalizeSize(value))) {
        talle = normalizeSize(value);
        text = text.replace(m[0], " ");
        break;
      }
    }
  }

  const norm = normalizeText(text);
  let genero: Variant["genero"] = null;
  if (/\b(dama|mujer|femenin[oa])\b/.test(norm)) genero = "F";
  else if (/\b(hombre|caballero|masculin[oa])\b/.test(norm) || /\bh\b/.test(norm)) genero = "M";

  const producto = norm
    .replace(/\b(talle|un|unidad|unidades)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { producto, talle, genero };
}

const STOPWORDS = new Set(["de", "la", "el", "con", "c", "y", "para", "sin", "x", "m", "por", "en", "un", "pampero"]);
function tokens(producto: string): Set<string> {
  return new Set(producto.split(" ").filter(t => t.length > 1 && !STOPWORDS.has(t)));
}

/** Similitud de palabras entre dos productos (0 a 1). Respaldo cuando no hay IA. */
export function productSimilarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some(x => x.length > 4 && t.length > 4 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5))))) inter++;
  return inter / Math.min(ta.size, tb.size);
}

/** Grupos de producto únicos de cada lado, con sus talles, para mostrar o mandar a la IA. */
export function productGroups(invoice: InvoiceLineInput[], ocs: OcLineInput[]) {
  const inv = new Map<string, { producto: string; ejemplo: string; talles: string[]; precios: number[]; codigos: string[] }>();
  for (const l of invoice) {
    const v = parseVariant(l.descripcion);
    const g = inv.get(v.producto) || { producto: v.producto, ejemplo: l.descripcion, talles: [], precios: [], codigos: [] };
    if (v.talle && !g.talles.includes(v.talle)) g.talles.push(v.talle);
    if (!g.precios.includes(l.precio)) g.precios.push(l.precio);
    if (l.codigo && !g.codigos.includes(l.codigo)) g.codigos.push(l.codigo);
    inv.set(v.producto, g);
  }
  const oc = new Map<string, { producto: string; ejemplo: string; talles: string[]; precios: number[]; ocs: string[] }>();
  for (const l of ocs) {
    const v = parseVariant(l.descripcion);
    const g = oc.get(v.producto) || { producto: v.producto, ejemplo: l.descripcion, talles: [], precios: [], ocs: [] };
    if (v.talle && !g.talles.includes(v.talle)) g.talles.push(v.talle);
    if (!g.precios.includes(l.precio)) g.precios.push(l.precio);
    if (!g.ocs.includes(l.ocNumero)) g.ocs.push(l.ocNumero);
    oc.set(v.producto, g);
  }
  return { factura: [...inv.values()], oc: [...oc.values()] };
}

/**
 * Equivalencias por similitud de palabras (sin IA). Para cada producto de factura
 * toma los productos de OC con la mejor similitud, si comparten talles.
 */
export function heuristicEquivalences(invoice: InvoiceLineInput[], ocs: OcLineInput[], tallesEspeciales: string[] = []): Equivalencias {
  const { factura, oc } = productGroups(invoice, ocs);
  const out: Equivalencias = {};
  for (const f of factura) {
    const scored = oc
      .map(o => ({ o, score: productSimilarity(f.producto, o.producto), talles: f.talles.filter(t => o.talles.some(ot => tallesCompatibles(t, ot, tallesEspeciales))).length }))
      .filter(x => x.score >= 0.5 && (x.talles > 0 || (!f.talles.length && !x.o.talles.length)));
    if (!scored.length) continue;
    const best = Math.max(...scored.map(x => x.score));
    out[f.producto] = scored.filter(x => x.score >= best - 0.15).map(x => x.o.producto);
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Precio igual si la diferencia es menor a $1 o al 0,1 %. */
export function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) < Math.max(1, Math.abs(b) * 0.001);
}

/**
 * Atributos que cambian el artículo.
 * - Agregados (reflectivo, bordado, estampa): se hacen aparte; si no coinciden se
 *   empareja igual pero en AMARILLO con una nota, para que alguien lo mire.
 * - Ignífugo: es una característica de la TELA (otro artículo). Si no coincide, no se empareja.
 */
const AGREGADOS: Array<[string, RegExp]> = [
  ["reflectivo", /\b(reflectiv[oa]s?|reflect|refl|cinta reflectiva)\b/],
  ["bordado", /\b(bordad[oa]s?|bordar)\b/],
  ["estampa", /\b(estampad[oa]s?|estampas?|serigrafia|vinilo)\b/],
];
const IGNIFUGO = /\b(ignifug[oa]s?|ignif|retardante|fr)\b/;
export function articleAttributes(descripcion: string) {
  const n = normalizeText(descripcion);
  const sin = (k: string) => new RegExp(`\\bsin\\s+${k}`).test(n);
  return {
    ignifugo: IGNIFUGO.test(n) && !sin("ignif"),
    agregados: AGREGADOS.filter(([k, re]) => re.test(n) && !sin(k.slice(0, 5))).map(([k]) => k),
  };
}
function attributeNote(factura: string, oc: string): string | undefined {
  const f = articleAttributes(factura), o = articleAttributes(oc);
  const notas: string[] = [];
  for (const k of o.agregados) if (!f.agregados.includes(k)) notas.push(`la OC pide ${k} y la factura no lo menciona`);
  for (const k of f.agregados) if (!o.agregados.includes(k)) notas.push(`la factura trae ${k} y la OC no`);
  return notas.length ? notas.join("; ").replace(/^./, c => c.toUpperCase()) : undefined;
}

/** Código comparable: sin espacios, guiones ni ceros adelante ("01234-A" → "1234a"). */
export function codeKey(code?: string | null): string {
  return normalizeText(String(code || "")).replace(/ /g, "").replace(/^0+(?=[0-9a-z])/, "");
}
/** Variantes del código: además del código entero, el código sin el talle pegado al final ("1234-42" con talle 42 → "1234"). */
function codeKeys(code: string | null | undefined, talle: string | null): string[] {
  const out = new Set<string>();
  const k = codeKey(code);
  if (!k) return [];
  out.add(k);
  const m = String(code || "").trim().match(/^(.+?)[\s\-_/.]+([a-z0-9]{1,4})$/i);
  if (m && talle && normalizeSize(m[2].toUpperCase()) === talle) {
    const base = codeKey(m[1]);
    if (base.length >= 3) out.add(base);
  }
  return [...out];
}
/** ¿Es el mismo código? Tolera ceros adelante, separadores y el talle pegado al final. */
export function mismoCodigo(a: string | null | undefined, talleA: string | null, b: string | null | undefined, talleB: string | null): boolean {
  const ka = codeKeys(a, talleA);
  if (!ka.length) return false;
  const kb = codeKeys(b, talleB);
  return kb.some(k => ka.includes(k));
}

/** Palabras en común entre dos productos (las de más de 4 letras valen si empiezan igual: "elastizado"/"elastizazdo"). */
export function palabrasEnComun(a: string, b: string): number {
  const ta = tokens(a), tb = [...tokens(b)];
  let n = 0;
  for (const t of ta) if (tb.some(x => x === t || (x.length > 4 && t.length > 4 && (x.startsWith(t.slice(0, 5)) || t.startsWith(x.slice(0, 5)))))) n++;
  return n;
}

export interface Parecido { puntaje: number; motivos: string[]; cantidadIgual: boolean }
/** Puntaje mínimo para proponer un renglón por parecido. */
export const PUNTAJE_PARECIDO = 40;

/**
 * ¿Qué tan probable es que el renglón de factura sea este renglón de OC, aunque el nombre no coincida?
 * Suma: nombre parecido (hasta 50), misma cantidad que lo pendiente (35) y precio parecido (15, o 5 si está cerca).
 * La cantidad sola nunca alcanza: tiene que haber al menos una palabra en común.
 * Nunca otro talle, otro género ni otra tela (ignífugo). Devuelve null si no puede ser.
 */
export function puntajeParecido(
  factura: { descripcion: string; cantidad: number; precio: number },
  oc: { descripcion: string; precio: number },
  pendienteOc: number,
  opciones: MatchOptions = {},
): Parecido | null {
  const vf = parseVariant(factura.descripcion), vo = parseVariant(oc.descripcion);
  if (vf.talle && vo.talle && !tallesCompatibles(vf.talle, vo.talle, opciones.tallesEspeciales || [])) return null;
  if (vf.genero && vo.genero && vf.genero !== vo.genero) return null;
  if (articleAttributes(factura.descripcion).ignifugo !== articleAttributes(oc.descripcion).ignifugo) return null;
  if (!(pendienteOc > 0)) return null;
  if (palabrasEnComun(vf.producto, vo.producto) === 0) return null;
  const sim = productSimilarity(vf.producto, vo.producto);
  const cantidadIgual = Math.abs(pendienteOc - (Number(factura.cantidad) || 0)) < 0.0001;
  const tol = Math.max(Number(opciones.toleranciaPct) || 0, 5);
  const precioCerca = precioAceptable(factura.precio, oc.precio, tol);
  const precioMedio = !precioCerca && oc.precio > 0 && Math.abs(factura.precio - oc.precio) / oc.precio <= 0.25;
  const motivos = [sim >= 0.5 ? "nombre parecido" : "alguna palabra en común"];
  if (cantidadIgual) motivos.push(`mismo pendiente (${pendienteOc})`);
  if (precioCerca) motivos.push("precio parecido");
  else if (precioMedio) motivos.push("precio cercano");
  const puntaje = Math.round(sim * 50 + (cantidadIgual ? 35 : 0) + (precioCerca ? 15 : precioMedio ? 5 : 0));
  return { puntaje, motivos, cantidadIgual };
}

/**
 * Asigna cantidades de factura a líneas de OC.
 * - `codigos`: equivalencias aprendidas código de proveedor → producto de OC (opcional).
 * - `manual`: asignaciones forzadas por el usuario: invoiceKey → [{ ocLineId, cantidad }] o "__extra__".
 */
export interface MatchOptions {
  /** Talles que el proveedor factura como "talle especial" (ej. ["3XL","4XL","5XL"]). */
  tallesEspeciales?: string[];
  /** Diferencia de precio (%) que se acepta como verde. */
  toleranciaPct?: number;
  /** OC que la factura cita impresa ("Su OC N° 1199"): facturaRef → ids de OC. Se prefieren al repartir. */
  ocPreferidas?: Record<string, string[]>;
}

/** ¿El número de OC citado en la factura ("1199", "OC 2026-1199", "01199") es esta OC ("OC-2026-1199")? */
export function citaOc(referencia: string, ocNumero: string): boolean {
  const ref = String(referencia || "").match(/\d+/g);
  const num = String(ocNumero || "").match(/\d+/g);
  if (!ref || !num) return false;
  const ultimo = (xs: string[]) => xs[xs.length - 1].replace(/^0+/, "");
  return ultimo(ref) !== "" && ultimo(ref) === ultimo(num);
}

/** ¿Son compatibles el talle de la factura y el de la OC? Nunca se mezcla un talle con otro distinto. */
export function tallesCompatibles(tf: string | null, to: string | null, especiales: string[] = []): boolean {
  if (!tf && !to) return true;
  if (tf === to) return true;
  const esp = new Set(especiales.map(t => normalizeSize(String(t).trim().toUpperCase())));
  if (tf === TALLE_ESPECIAL && to) return esp.has(to);
  if (to === TALLE_ESPECIAL && tf) return esp.has(tf);
  return false;
}

/** Precio dentro de la tolerancia del proveedor. */
export function precioAceptable(factura: number, oc: number, toleranciaPct = 0): boolean {
  if (samePrice(factura, oc)) return true;
  if (!(toleranciaPct > 0) || !(oc > 0)) return false;
  return Math.abs(factura - oc) / oc <= toleranciaPct / 100 + 1e-9;
}

export function matchPurchaseLines(
  invoice: InvoiceLineInput[],
  ocs: OcLineInput[],
  equivalencias: Equivalencias,
  manual: Record<string, Array<{ ocLineId: string; cantidad: number }> | "__extra__"> = {},
  opciones: MatchOptions = {},
): MatchResult {
  const especiales = opciones.tallesEspeciales || [];
  const tol = Number(opciones.toleranciaPct) || 0;
  const preferida = (l: InvoiceLineInput, ocId: string) => !!opciones.ocPreferidas?.[l.facturaRef || ""]?.includes(ocId);
  const remaining = new Map(ocs.map(o => [o.id, Math.max(0, Number(o.cantidad) || 0)]));
  const ocVariant = new Map(ocs.map(o => [o.id, parseVariant(o.descripcion)]));
  const asignaciones: Asignacion[] = [];
  const sinAsignar: MatchResult["sinAsignar"] = [];

  const push = (l: InvoiceLineInput, o: OcLineInput, cantidad: number, origen: Asignacion["origen"]) => {
    remaining.set(o.id, round2((remaining.get(o.id) || 0) - cantidad));
    const nota = attributeNote(l.descripcion, o.descripcion);
    asignaciones.push({
      invoiceKey: l.key, ocLineId: o.id, ocId: o.ocId, ocNumero: o.ocNumero, cantidad,
      precioFactura: l.precio, precioOc: o.precio, diferencia: round2((l.precio - o.precio) * cantidad),
      semaforo: precioAceptable(l.precio, o.precio, tol) && !nota ? "verde" : "amarillo", origen,
      ...(nota ? { nota } : {}),
    });
  };

  const candidatesFor = (l: InvoiceLineInput): Array<{ o: OcLineInput; origen: Asignacion["origen"] }> => {
    const v = parseVariant(l.descripcion);
    const ign = articleAttributes(l.descripcion).ignifugo;
    // Mismo código (tolerante); si los dos dicen talle, tiene que ser el mismo.
    const byCode = ocs.filter(o => {
      const ov = ocVariant.get(o.id)!;
      if (!mismoCodigo(l.codigo, v.talle, o.codigo, ov.talle)) return false;
      return !(v.talle && ov.talle && !tallesCompatibles(v.talle, ov.talle, especiales));
    });
    if (byCode.length) return byCode.map(o => ({ o, origen: "codigo" as const }));
    const productos = new Set([v.producto, ...(equivalencias[v.producto] || [])]);
    return ocs
      .filter(o => {
        const ov = ocVariant.get(o.id)!;
        if (!productos.has(ov.producto)) return false;
        if (!tallesCompatibles(v.talle, ov.talle, especiales)) return false; // nunca otro talle (salvo "talle especial")
        if (v.genero && ov.genero && v.genero !== ov.genero) return false;
        if (articleAttributes(o.descripcion).ignifugo !== ign) return false; // otra tela, otro artículo
        return true;
      })
      .map(o => ({ o, origen: "equivalencia" as const }));
  };

  const pending = new Map(invoice.map(l => [l.key, Number(l.cantidad) || 0]));

  // 0) Asignaciones manuales del usuario.
  for (const l of invoice) {
    const m = manual[l.key];
    if (!m) continue;
    if (m === "__extra__") { sinAsignar.push({ invoiceKey: l.key, cantidad: pending.get(l.key)!, tipo: "sin_oc", motivo: "Marcada como fuera de OC" }); pending.set(l.key, 0); continue; }
    for (const a of m) {
      const o = ocs.find(x => x.id === a.ocLineId);
      const disp = o ? remaining.get(o.id) || 0 : 0;
      const usar = Math.min(a.cantidad, disp, pending.get(l.key)!);
      if (o && usar > 0) { push(l, o, usar, "manual"); pending.set(l.key, round2(pending.get(l.key)! - usar)); }
    }
  }

  const candidates = new Map(invoice.map(l => [l.key, candidatesFor(l)]));

  // 1) Cantidad exacta: la línea entra entera en una sola línea de OC.
  //    a) Primero las que tienen UNA sola opción exacta: son seguras y "anclan" la factura a esa OC.
  //    b) Después las que tienen varias: gana la OC donde ya cayeron más líneas de la misma
  //       factura (una factura suele corresponder a pocas OC), luego el precio más parecido y la más vieja.
  const afinidad = new Map<string, number>();
  // La OC que la factura cita impresa pesa más que cualquier otra.
  for (const [ref, ids] of Object.entries(opciones.ocPreferidas || {})) for (const id of ids) afinidad.set(`${ref}|${id}`, 100);
  const anclar = (l: InvoiceLineInput, o: OcLineInput) => {
    const k = `${l.facturaRef || ""}|${o.ocId}`;
    afinidad.set(k, (afinidad.get(k) || 0) + 1);
  };
  const exactas = (l: InvoiceLineInput) => {
    const qty = pending.get(l.key)!;
    return candidates.get(l.key)!.filter(({ o }) => Math.abs((remaining.get(o.id) || 0) - qty) < 0.0001);
  };
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const l of invoice) {
      if (pending.get(l.key)! <= 0) continue;
      const ex = exactas(l);
      if (ex.length === 1) { push(l, ex[0].o, pending.get(l.key)!, ex[0].origen); anclar(l, ex[0].o); pending.set(l.key, 0); cambio = true; }
    }
  }
  for (const l of invoice) {
    if (pending.get(l.key)! <= 0) continue;
    const ex = exactas(l).sort((a, b) =>
      (afinidad.get(`${l.facturaRef || ""}|${b.o.ocId}`) || 0) - (afinidad.get(`${l.facturaRef || ""}|${a.o.ocId}`) || 0)
      || Math.abs(a.o.precio - l.precio) - Math.abs(b.o.precio - l.precio)
      || a.o.ocFecha.localeCompare(b.o.ocFecha));
    if (ex.length) { push(l, ex[0].o, pending.get(l.key)!, ex[0].origen); anclar(l, ex[0].o); pending.set(l.key, 0); }
  }

  // 2) Reparto: precio más parecido primero, después la OC más vieja.
  for (const l of invoice) {
    let qty = pending.get(l.key)!;
    if (qty <= 0) continue;
    const ordered = candidates.get(l.key)!
      .filter(({ o }) => (remaining.get(o.id) || 0) > 0)
      .sort((a, b) => {
        const pa = precioAceptable(l.precio, a.o.precio, tol) ? 0 : 1, pb = precioAceptable(l.precio, b.o.precio, tol) ? 0 : 1;
        return Number(preferida(l, b.o.ocId)) - Number(preferida(l, a.o.ocId)) || pa - pb || a.o.ocFecha.localeCompare(b.o.ocFecha) || a.o.ocNumero.localeCompare(b.o.ocNumero);
      });
    for (const { o, origen } of ordered) {
      if (qty <= 0) break;
      const usar = Math.min(qty, remaining.get(o.id) || 0);
      if (usar <= 0) continue;
      push(l, o, usar, origen);
      qty = round2(qty - usar);
    }
    pending.set(l.key, qty);
  }

  // 3) Parecidos: líneas que no encontraron ningún candidato (ni código ni equivalencia).
  //    Se puntúa cada renglón de OC con lugar (nombre + cantidad igual a lo pendiente + precio)
  //    y se asignan de mayor a menor puntaje. Quedan en amarillo para que alguien las mire.
  const pares: Array<{ l: InvoiceLineInput; o: OcLineInput; p: Parecido }> = [];
  for (const l of invoice) {
    if (pending.get(l.key)! <= 0 || candidates.get(l.key)!.length) continue;
    for (const o of ocs) {
      const p = puntajeParecido({ ...l, cantidad: pending.get(l.key)! }, o, remaining.get(o.id) || 0, opciones);
      if (p && preferida(l, o.ocId)) { p.puntaje += 15; p.motivos.push("la factura cita esta OC"); }
      if (p && p.puntaje >= PUNTAJE_PARECIDO) pares.push({ l, o, p });
    }
  }
  pares.sort((a, b) => b.p.puntaje - a.p.puntaje || a.o.ocFecha.localeCompare(b.o.ocFecha));
  for (const { l, o, p } of pares) {
    const qty = pending.get(l.key)!, disp = remaining.get(o.id) || 0;
    if (qty <= 0 || disp <= 0) continue;
    const usar = Math.min(qty, disp);
    push(l, o, usar, "parecido");
    const a = asignaciones[asignaciones.length - 1];
    a.semaforo = "amarillo";
    a.nota = [`Propuesto por parecido: ${p.motivos.join(", ")}`, a.nota].filter(Boolean).join(" · ");
    pending.set(l.key, round2(qty - usar));
  }

  // 4) Lo que quedó sin OC: si el artículo está en alguna OC es "de más"; si no, "sin OC".
  for (const l of invoice) {
    const qty = pending.get(l.key)!;
    if (qty <= 0) continue;
    const propias = asignaciones.filter(a => a.invoiceKey === l.key);
    const ref = propias.length ? ocs.find(o => o.id === propias[propias.length - 1].ocLineId) : candidates.get(l.key)![0]?.o;
    sinAsignar.push(ref
      ? { invoiceKey: l.key, cantidad: qty, tipo: "de_mas", ocLineId: ref.id, ocNumero: ref.ocNumero, motivo: `Facturado de más: ${qty} más de lo pendiente en la OC` }
      : { invoiceKey: l.key, cantidad: qty, tipo: "sin_oc", motivo: "No se encontró en ninguna OC" });
  }

  const pendientesOc = ocs
    .filter(o => (remaining.get(o.id) || 0) > 0.0001)
    .map(o => ({ ocLineId: o.id, ocId: o.ocId, ocNumero: o.ocNumero, cantidad: round2(remaining.get(o.id)!) }));
  const tocadas = new Set(asignaciones.map(a => a.ocId));
  const ocIds = [...new Set(ocs.map(o => o.ocId))];
  const ocsCompletas = ocIds.filter(id => tocadas.has(id) && !pendientesOc.some(p => p.ocId === id));
  const ocsParciales = ocIds.filter(id => tocadas.has(id) && pendientesOc.some(p => p.ocId === id));
  return { asignaciones, sinAsignar, pendientesOc, ocsCompletas, ocsParciales };
}
