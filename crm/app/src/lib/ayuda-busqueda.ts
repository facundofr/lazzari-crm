// Ayuda interna SIN IA: busca en la guía (docs/GUIA-USO.md → asistente-guia-datos.ts) por palabras,
// respetando lo que el rol puede ver. Todo corre en el navegador: no gasta nada.

import { GUIA_SECCIONES, type SeccionGuia } from "./asistente-guia-datos";
import { ROLE_PERMISSIONS, type Role } from "./types";

export type { SeccionGuia };

export function rolPuedeVer(role: Role | string, modulo: string | null): boolean {
  if (!modulo) return true;
  const permisos = ROLE_PERMISSIONS[role as Role] || [];
  return permisos.some((p) => p.module === "*" || p.module === modulo);
}

/** Secciones de la guía que ese rol puede ver. */
export function seccionesParaRol(role: Role | string, secciones: SeccionGuia[] = GUIA_SECCIONES): SeccionGuia[] {
  return secciones.filter((s) => rolPuedeVer(role, s.modulo));
}

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const STOP = new Set(("a al algo como con cual cuando de del donde el en es esa ese esta este hay hago hacer la las le lo los me mi " +
  "no o para pero por puedo que se si sin su sus un una uno y ya yo tengo quiero necesito cargo cargar ver veo").split(" "));

// Siglas y formas de decir lo mismo → palabras o FRASES que usa la guía (una frase cuenta solo si aparece entera).
const SINONIMOS: Record<string, string[]> = {
  nc: ["nota de credito"], nd: ["nota de debito"], op: ["orden de pago", "ordenes de pago"], oc: ["orden de compra", "oc"],
  pr: ["presupuesto"], fc: ["factura"], fa: ["factura"], fce: ["fce"], cc: ["cuenta corriente", "cc"],
  echeq: ["cheque", "e-cheq"], retencion: ["retenciones"], sicore: ["retenciones"],
  cobrar: ["cobro"], pagar: ["pago"], flete: ["envio", "transporte"], envio: ["flete"],
  vep: ["impuesto"], banco: ["extracto"], afip: ["arca"], borrar: ["eliminar", "anular"], eliminar: ["anular"],
  qr: ["carga manual"], bordado: ["personalizacion", "taller"], estampado: ["personalizacion", "taller"],
  whatsapp: ["copiar resumen"],
};

/** Términos a buscar: palabras de la consulta (sin las vacías), su singular y sinónimos (que pueden ser frases). */
export function palabrasClave(consulta: string): string[] {
  const base = normalizar(consulta).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1 && !STOP.has(w));
  const todas = new Set<string>();
  for (const w of base) {
    todas.add(w);
    if (w.length > 4 && w.endsWith("s")) todas.add(w.slice(0, -1)); // "facturas" → "factura"
    for (const s of SINONIMOS[w] || []) todas.add(normalizar(s));
  }
  // Frases de 2 o 3 palabras tal cual las escribió ("nota de credito", "gastos fijos"): pesan más si aparecen enteras.
  const crudas = normalizar(consulta).split(/[^a-z0-9ñ]+/).filter(Boolean);
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= crudas.length; i++) {
      const f = crudas.slice(i, i + n);
      if (!STOP.has(f[0]) && !STOP.has(f[n - 1])) todas.add(f.join(" "));
    }
  }
  return [...todas];
}

function tokens(s: string): string[] {
  return normalizar(s).split(/[^a-z0-9ñ]+/).filter(Boolean);
}

/** Cuántas veces aparece el término: una frase, entera; una palabra, como comienzo de palabra (≥3 letras) o exacta. */
function apariciones(termino: string, texto: string, toks: string[]): number {
  if (termino.includes(" ")) return texto.split(termino).length - 1;
  if (termino.length < 3) return toks.filter((t) => t === termino).length;
  return toks.filter((t) => t.startsWith(termino)).length;
}

export interface ResultadoAyuda { seccion: SeccionGuia; puntaje: number; extracto: string }

/** Busca en la guía. El título pesa más que el texto y las frases más que las palabras; devuelve las mejores. */
export function buscarEnGuia(consulta: string, secciones: SeccionGuia[], max = 4): ResultadoAyuda[] {
  const terminos = palabrasClave(consulta);
  if (!terminos.length) return [];
  const res: ResultadoAyuda[] = [];
  for (const s of secciones) {
    const titulo = normalizar(`${s.grupo} ${s.titulo}`);
    const texto = normalizar(s.texto);
    const tokTitulo = tokens(titulo);
    const tokTexto = tokens(texto);
    let puntaje = 0;
    let acierto = 0;
    for (const w of terminos) {
      const peso = w.includes(" ") ? 4 : 1;
      const enTitulo = apariciones(w, titulo, tokTitulo) > 0;
      const veces = apariciones(w, texto, tokTexto);
      if (enTitulo) puntaje += 6 * peso;
      puntaje += Math.min(veces, 4) * peso;
      if (enTitulo || veces) acierto += 1;
    }
    if (!puntaje) continue;
    puntaje *= 1 + acierto / terminos.length; // premia las que tienen más términos distintos
    res.push({ seccion: s, puntaje, extracto: extracto(s.texto, terminos) });
  }
  return res.sort((a, b) => b.puntaje - a.puntaje).slice(0, max);
}

/** Renglón de la guía donde aparecen más palabras buscadas (para mostrar debajo del título). */
function extracto(texto: string, palabras: string[]): string {
  const partes = texto.split(/\n|(?<=\.)\s+(?=\d\))|(?=\s\d\)\s)/).map((p) => p.trim()).filter(Boolean);
  let mejor = partes[0] || "";
  let mejorN = -1;
  for (const p of partes) {
    const n = palabras.filter((w) => normalizar(p).includes(w)).length;
    if (n > mejorN) { mejor = p; mejorN = n; }
  }
  return mejor.replace(/\*\*/g, "").slice(0, 220);
}

/**
 * Sección de la pantalla donde está el usuario. En Finanzas usa la pestaña (?tab=) por su nombre visible
 * (ej. "Órdenes de pago" → "Pagar → Órdenes de pago").
 */
export function seccionesDePantalla(pathname: string, secciones: SeccionGuia[], etiquetaPestana?: string | null): SeccionGuia[] {
  const ruta = "/" + (pathname.split("/")[1] || "");
  const deRuta = secciones.filter((s) => s.ruta === ruta);
  if (etiquetaPestana) {
    const e = normalizar(etiquetaPestana);
    const pestana = deRuta.filter((s) => normalizar(s.titulo).includes(e));
    if (pestana.length) return pestana;
  }
  return deRuta;
}

/** Texto plano de la guía para la IA (solo lo que el rol ve). */
export function guiaComoTexto(secciones: SeccionGuia[]): string {
  let grupo = "";
  const out: string[] = [];
  for (const s of secciones) {
    if (s.grupo !== grupo) { grupo = s.grupo; out.push(`\n## ${grupo}`); }
    out.push(`### ${s.titulo}${s.ruta ? ` (${s.ruta})` : ""}\n${s.texto}`);
  }
  return out.join("\n").trim();
}
