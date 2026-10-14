// Mayúsculas solo donde hacen falta, para los PDF.
// Un tramo escrito TODO en mayúscula ("PROTECTOR AUDITIVO OPTIME II H520P3E CASCO") sale
// "Protector auditivo Optime II H520P3E casco". No cambia el dato guardado: solo cómo se imprime.
// Se respeta: lo que ya viene en mayúscula y minúscula, códigos y modelos con números (H520P3E, N95, 3M),
// siglas cortas (XL, PP, TPR, EPP), números romanos (II, III) y las marcas de la lista.

/** Marcas y modelos con su forma correcta (salen del catálogo y de los PR). Agregar acá si alguna sale mal. */
const MARCAS = [
  "3M", "DuPont", "Tychem", "Tyvek", "Kevlar", "Optime", "Securefit", "Ultrane", "Milenium", "Lincoln",
  "Bahco", "Bilvex", "Boris", "Bosch", "Calfor", "Candex", "Conarco", "Conoflex", "DeWalt", "Delta", "Dimavial",
  "Drago", "Dremel", "Dräger", "Ecoway", "Einhell", "Energizer", "Eram", "Eveready", "Ezeta", "Fadesa", "Firestone",
  "Fischer", "Fravida", "Freplast", "Gamax", "Gamisol", "Gaucho", "Gocer", "Grafa", "Guadal", "Häfele", "Irimo",
  "Karcher", "Kraftex", "Lakeland", "Ledvance", "Libus", "Loctite", "Mapa", "Mediglove", "Michelin", "Nubus",
  "Ombú", "Palenque", "Pampero", "Pegaso", "Penetrit", "Pequi", "Philips", "Pitts", "Prisina", "Prowork", "Pucará",
  "Pulqui", "Recumix", "Ringers", "Ringo", "Schneider", "Seakrome", "Sica", "Sika", "Sinteplast", "Stanley",
  "Startex", "Steck", "Streamlight", "Tyrolit", "Valvoline", "Voran", "WypAll", "Autopolish", "Mann",
];
/** Siglas de 4 letras o más que siempre van en mayúscula (las de 3 o menos ya se respetan solas). */
const SIGLAS = ["IRAM", "ANSI", "INTI", "NIOSH", "AISI", "SENASA", "ARCA", "AFIP", "CUIT", "OSHA"];
const MARCA_POR_CLAVE = new Map<string, string>([
  ...MARCAS.map((m): [string, string] => [m.toLocaleUpperCase("es-AR"), m]),
  ...SIGLAS.map((m): [string, string] => [m, m]),
  ["PLUS", "Plus"], ["OMBU", "Ombú"], ["DRAGER", "Dräger"], ["HAFELE", "Häfele"], ["PUCARA", "Pucará"],
]);

/** Palabras cortas que van en minúscula aunque tengan 3 letras o menos. */
const MINUSCULAS = new Set([
  "a", "al", "de", "del", "el", "la", "las", "lo", "los", "y", "e", "o", "u", "en", "con", "sin", "por", "para",
  "x", "c", "s", "un", "una", "uno", "dos", "mas", "más", "pie", "luz", "gas", "sol", "uso", "par", "ojo", "red",
  "tel", "kit", "set", "caja", "su", "sus", "que", "es", "se", "mm", "cm", "kg", "gr", "lt", "mts", "ml",
]);

const ROMANO = /^(I{1,3}|IV|VI{0,3}|IX)$/;
const LETRA_MINUSCULA = /\p{Ll}/u;
const LETRA_MAYUSCULA = /\p{Lu}/u;

/** Separadores de tramo: cada tramo se evalúa por separado ("Mapa · Guantes · ULTRANE 548 ..."). */
const SEPARADOR = /(\s+[·|]\s+|\s+-\s+|\s*\|\s*)/;

/** Palabras "largas" sin números: hacen falta al menos dos para tocar un texto ("CUBRE NUCA" sí; "ANT. FLEX O/I" no). */
function cantidadLargas(texto: string): number {
  return (texto.match(/[\p{L}\p{N}]+/gu) || []).filter((p) => p.length >= 4 && !/\p{N}/u.test(p)).length;
}

/** Corrige un tramo todo en mayúscula. Con `todoElTexto` (el texto entero estaba en mayúscula) no exige dos palabras largas por tramo. */
function corregirTramo(tramo: string, todoElTexto: boolean): string {
  if (LETRA_MINUSCULA.test(tramo)) return tramo; // ya tiene minúsculas: se deja como está
  if (!todoElTexto && cantidadLargas(tramo) < 2) return tramo;
  let primera = true;
  return tramo.replace(/[\p{L}\p{N}]+/gu, (palabra) => {
    const esPrimera = primera;
    primera = false;
    if (/\p{N}/u.test(palabra)) return palabra; // códigos y modelos: H520P3E, N95, 3M
    const marca = MARCA_POR_CLAVE.get(palabra.toLocaleUpperCase("es-AR"));
    if (marca) return marca;
    const minus = palabra.toLocaleLowerCase("es-AR");
    if (ROMANO.test(palabra) && palabra.length >= 2) return palabra;
    if (MINUSCULAS.has(minus)) return esPrimera ? capitalizar(minus) : minus;
    if (palabra.length <= 3) return palabra; // siglas: XL, PP, TPR, EPP
    return esPrimera ? capitalizar(minus) : minus;
  });
}

function capitalizar(s: string): string {
  return s.charAt(0).toLocaleUpperCase("es-AR") + s.slice(1);
}

/** Corrige los tramos escritos todo en mayúscula. Lo que ya está en mayúscula y minúscula no se toca. */
export function mayusculasNecesarias(texto: string | null | undefined): string {
  const t = String(texto ?? "");
  if (!LETRA_MAYUSCULA.test(t)) return t;
  const todoElTexto = !LETRA_MINUSCULA.test(t) && cantidadLargas(t) >= 2;
  return t.split(SEPARADOR).map((parte, i) => (i % 2 === 1 ? parte : corregirTramo(parte, todoElTexto))).join("");
}
