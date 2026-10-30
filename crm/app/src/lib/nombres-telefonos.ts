// Formato parejo de nombres y teléfonos (Augusto 30/10/2026: "todo en el CRM tiene que respetar lo que va en mayúscula y
// en minúscula" y los celulares "algunos con guion, otros con la característica adelante, otros todo junto").
// Se usa al guardar (clientes, proveedores, contactos, sucursales, transportistas) y para el arreglo de los datos viejos.
// Funciones puras. Prueba: npx tsx scripts/test-nombres-telefonos.ts
import { guardarTelefono } from "./whatsapp-ar";

/** Palabras que van en minúscula salvo al principio. */
const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "o", "u", "en", "con", "por", "para", "al"]);
/** Siglas que siempre van en mayúscula (tipos de sociedad y organismos). */
const SIGLAS = new Set([
  "SA", "SAS", "SAU", "SAI", "SAC", "SAIC", "SAICF", "SAICYF", "SACI", "SACIF", "SACIFI", "SAIF", "SAICA", "SAICAF",
  "SRL", "SH", "SC", "SCA", "SCS", "SE", "SGR", "UTE", "YPF", "BBVA", "ARCA", "AFIP", "INTA", "INTI", "UTN", "UBA",
  "EPP", "ART", "ACA", "CRM", "IT", "TV", "GNC", "BID", "SGS", "USA", "AMBA", "CABA",
]);
const ROMANO = /^(II|III|IV|VI|VII|VIII|IX|XI|XII)$/;
const VOCAL = /[AEIOUÁÉÍÓÚÜ]/;

function capitalizar(p: string): string {
  const m = p.toLocaleLowerCase("es-AR");
  return m.charAt(0).toLocaleUpperCase("es-AR") + m.slice(1);
}

/**
 * Nombre con mayúscula al principio de cada palabra: "COOPERATIVA DE TRABAJO MILONGUITAS LIMITADA" →
 * "Cooperativa de Trabajo Milonguitas Limitada". Respeta siglas (S.A., S.R.L., B.I.D., SRL), iniciales sueltas,
 * números romanos y palabras con números. Si ya viene escrito en mayúscula y minúscula, no se toca.
 * No agrega tildes (no se puede saber si "JOSE" es "José").
 */
export function nombrePropio(texto: string | null | undefined): string {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  const tieneMayus = /\p{Lu}/u.test(t);
  const tieneMinus = /\p{Ll}/u.test(t);
  if (tieneMayus && tieneMinus) return t; // ya está escrito a mano: se respeta
  if (!tieneMayus && !tieneMinus) return t; // solo números o signos
  let primera = true;
  // Cada palabra con lo que la sigue (para ver si es una sigla con puntos: "S.A.", "B.I.D.").
  return t.replace(/[\p{L}\p{N}]+(\.?)/gu, (todo, punto: string, pos: number) => {
    const palabra = punto ? todo.slice(0, -1) : todo;
    const esPrimera = primera;
    primera = false;
    const may = palabra.toLocaleUpperCase("es-AR");
    const min = palabra.toLocaleLowerCase("es-AR");
    const anterior = pos > 0 ? t[pos - 1] : "";
    let r: string;
    if (/\p{N}/u.test(palabra)) r = may; // códigos y números
    else if (palabra.length === 1 && (punto || anterior === ".")) r = may; // S.A. / B.I.D.
    else if (SIGLAS.has(may) || ROMANO.test(may)) r = may;
    else if (MINUSCULAS.has(min) && !esPrimera) r = min;
    else if (palabra.length === 1) r = may; // iniciales: "Jose A Balseiro", "S A"
    else if (palabra.length <= 4 && !VOCAL.test(may)) r = may; // sin vocales = sigla: SRL, SH, CNP
    else r = capitalizar(palabra);
    return r + punto;
  });
}

/**
 * Teléfono como se guarda en todo el CRM (la misma regla que las dos casillas de WhatsApp, lib/whatsapp-ar.ts):
 * "2477 688498", "11 33968405", "351 8354530". Para mostrar lleva guion (mostrarWhatsApp: "2477 68-8498").
 * Si no queda en 10 números (le faltan, sobran o hay varios teléfonos juntos) lo devuelve como estaba.
 */
export function telefonoAR(texto: string | null | undefined): string {
  return guardarTelefono(texto);
}

/** true si el teléfono no se pudo dejar en el formato (para mostrarlo en la lista a revisar). */
export function telefonoARevisar(texto: string | null | undefined): boolean {
  const t = String(texto ?? "").trim();
  if (!t) return false;
  const g = guardarTelefono(t);
  return !/^\d{2,4} \d{6,8}$/.test(g) || g.replace(/\D/g, "").length !== 10;
}
