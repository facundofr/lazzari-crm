// Mayúsculas solo cuando hace falta (Augusto 17/10/2026).
// Los nombres y artículos vienen casi todos EN MAYÚSCULAS (ARCA, proveedores, listas). Acá se pasan a:
// - nombres (empresas y personas): "AMOBLAMIENTOS NEXO DE GARBUGLIO S.A." → "Amoblamientos Nexo de Garbuglio S.A."
// - artículos: "MESA DE REUNIONES 1,60 X 0,90 MTS" → "Mesa de reuniones 1,60 x 0,90 mts"
// Se respetan siglas (S.A., SRL, EPP, IVA), códigos y modelos (N95, 3M, 8210), talles (XL) y marcas (Ombú, Libus).
// Solo se tocan textos que están TODOS en mayúsculas: si alguien ya lo escribió bien, queda como está.

const CONECTORES = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "al", "para", "por", "con", "sin", "o", "u", "x"]);

/** Formas societarias y siglas que siempre van en mayúscula. */
const SIGLAS = new Set([
  "SA", "SRL", "SAS", "SAU", "SACI", "SAIC", "SAICA", "SACIF", "SACIFI", "SACIFIA", "SAICYF", "SCA", "SH", "SE", "UTE", "SGR", "SC", "SCS", "CIA",
  "EPP", "IVA", "ARCA", "AFIP", "BCRA", "ART", "ISO", "IRAM", "ANSI", "NIOSH", "CE", "UV", "LED", "USB", "PVC", "TPU", "PU", "EVA", "HD", "ABS", "NBR", "HDPE",
  "ATT", "CAS", "CB", "DF", "DPS", "MRK", "MSA", "SPI", "STP", "TKW", "YPF", "AFA", "BBVA", "BNA", "ACA", "AMBA", "CABA", "UNT", "UBA", "INTA", "INTI", "SENASA",
  "EN", "RX", "PP", "PE", "PET", "PPE", "PFF", "FFP", "FFP1", "FFP2", "FFP3", "KN95", "N95",
]);
/** "EN" es sigla de norma solo si va seguido de un número (EN 388); si no, es "en". */
const SIGLA_CON_NUMERO = new Set(["EN"]);

/** Talles: van en mayúscula en los artículos. */
const TALLES = new Set(["XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL", "2XL", "3XL", "4XL", "5XL", "U"]);

/** Unidades: en minúscula. */
const UNIDADES = new Set(["MTS", "MT", "MTRS", "M2", "M3", "MM", "CM", "KG", "KGS", "GR", "GRS", "LT", "LTS", "ML", "CC", "UN", "UNID", "UND", "PAR", "PARES", "PZA", "PZAS", "CJ", "CJA", "ROLLO", "PULG"]);

/** Marcas del catálogo (palabras sueltas) que van con mayúscula inicial dentro de un artículo. */
const MARCAS = new Set([
  "AUTOPOLISH", "BAHCO", "BILVEX", "DECKER", "BORIS", "BOSCH", "CALFOR", "CANDEX", "CONARCO", "CONOFLEX", "DEWALT", "FORZA", "DIMAVIAL", "DRÄGER", "DRAGER",
  "DRAGO", "DREMEL", "ECOWAY", "EINHELL", "ENERGIZER", "ERAM", "ESAB", "EVEREADY", "EZETA", "FADESA", "FIRESTONE", "FISCHER", "FRAVIDA", "FREPLAST", "GAMAX",
  "GAMISOL", "GOCER", "GRAFA", "GUADAL", "HÄFELE", "HAFELE", "IRIMO", "KARCHER", "KÄRCHER", "KRAFTEX", "LAKELAND", "LEDVANCE", "LIBUS", "LOCTITE", "MANN", "MEDIGLOVE",
  "MICHELIN", "NUBUS", "OMBÚ", "OMBU", "PALENQUE", "PAMPERO", "PEGASO", "PENETRIT", "PEQUI", "PHILIPS", "PITTS", "PRISINA", "PROWORK", "PUCARÁ", "PUCARA", "PULQUI",
  "RECUMIX", "RINGERS", "RINGO", "SCHNEIDER", "SEAKROME", "SICA", "SIKA", "SINTEPLAST", "STANLEY", "STARTEX", "STECK", "STREAMLIGHT", "TYROLIT", "VALVOLINE",
  "VORAN", "WYPALL", "MONTAGNE", "FORZA", "DUPONT", "TYVEK", "TYCHEM", "HONEYWELL", "ANSELL", "KIMBERLY", "CLARK", "STEELPRO", "WORKSAFE", "MAKITA", "TRAMONTINA", "CAT", "CATERPILLAR",
  "VICSA", "SEGUSOL", "NORSEG", "ARGENTINA", "BUENOS", "AIRES", "CÓRDOBA", "CORDOBA", "ROSARIO", "SANTA", "FE", "MENDOZA", "PERGAMINO", "COLÓN", "COLON",
]);

/** ¿Está todo en mayúsculas? (al menos 3 letras y ninguna minúscula) */
export function estaEnMayusculas(s: string): boolean {
  if (!s) return false;
  const letras = s.replace(/&[a-z]+;/g, "").replace(/[^A-Za-zÁÉÍÓÚÜÑÄÖáéíóúüñäö]/g, "");
  return letras.length >= 3 && letras === letras.toLocaleUpperCase("es-AR") && letras !== letras.toLocaleLowerCase("es-AR");
}

const capital = (w: string) => w.charAt(0).toLocaleUpperCase("es-AR") + w.slice(1).toLocaleLowerCase("es-AR");
const sinPuntos = (w: string) => w.replace(/\./g, "");

/** Palabra que se deja tal cual (código, modelo, sigla con puntos, número). */
function esCodigo(w: string): boolean {
  if (/\d/.test(w) && /[A-Za-zÁÉÍÓÚÑ]/.test(w)) return true; // N95, 3M, 8210-N, H540
  if (/^[A-ZÁÉÍÓÚÑ](\.[A-ZÁÉÍÓÚÑ])+\.?$/.test(w)) return true; // S.A., S.R.L.
  return false;
}

/** Corta en palabras sin perder los separadores ("TALLE 40/41 - AZUL" → ["TALLE"," ","40/41"," - ","AZUL"]). */
function partes(s: string): string[] {
  return s.split(/([\s/,;:()\-+"]+)/);
}

function siguientePalabra(ps: string[], i: number): string {
  for (let j = i + 1; j < ps.length; j++) if (ps[j] && !/^[\s/,;:()\-+"]+$/.test(ps[j])) return ps[j];
  return "";
}

/** Nombre de empresa o persona: cada palabra con mayúscula inicial, conectores en minúscula, siglas enteras. */
export function nombrePropio(s: string | null | undefined): string {
  if (!s || !estaEnMayusculas(s)) return s ?? "";
  const ps = partes(s.trim().replace(/&amp;/g, "&"));
  let primera = true;
  let anteriorSuelta = false;
  return ps.map((w) => {
    if (!w || /^[\s/,;:()\-+"]+$/.test(w)) return w;
    const base = sinPuntos(w).toLocaleUpperCase("es-AR");
    const suelta = base.length === 1;
    let out: string;
    if (suelta && anteriorSuelta) out = w; // iniciales: "S A", "S R L"
    else if (esCodigo(w) || /^\d/.test(w)) out = w;
    else if (SIGLAS.has(base) && !SIGLA_CON_NUMERO.has(base)) out = w;
    else if (!primera && CONECTORES.has(w.toLocaleLowerCase("es-AR"))) out = w.toLocaleLowerCase("es-AR");
    else out = capital(w);
    primera = false;
    anteriorSuelta = suelta;
    return out;
  }).join("");
}

/** Artículo: solo la primera letra en mayúscula; se respetan siglas, códigos, talles y marcas; unidades en minúscula. */
export function textoArticulo(s: string | null | undefined): string {
  if (!s || !estaEnMayusculas(s)) return s ?? "";
  const ps = partes(s.trim());
  let primera = true;
  return ps.map((w, i) => {
    if (!w || /^[\s/,;:()\-+"]+$/.test(w)) return w;
    const base = sinPuntos(w).toLocaleUpperCase("es-AR");
    const sig = siguientePalabra(ps, i);
    let out: string;
    if (/^\d/.test(w) && !/[A-Za-zÁÉÍÓÚÑ]/.test(w)) out = w; // 1,60 · 40/41
    else if (UNIDADES.has(base) && !primera) out = w.toLocaleLowerCase("es-AR");
    else if (esCodigo(w)) out = w;
    else if (SIGLA_CON_NUMERO.has(base)) out = /^\d/.test(sig) ? w : primera ? capital(w) : w.toLocaleLowerCase("es-AR");
    else if (SIGLAS.has(base) || (TALLES.has(base) && !primera && base !== "U")) out = w;
    else if (MARCAS.has(base)) out = capital(w);
    else if (base === "X" && !primera) out = "x";
    else if (w.length === 1 && !primera && w !== "P" && !CONECTORES.has(w.toLocaleLowerCase("es-AR"))) out = w; // talle "T 40"
    else out = primera ? capital(w) : w.toLocaleLowerCase("es-AR");
    primera = false;
    return out;
  }).join("");
}

/** Campos que se muestran como nombre o como artículo. */
export const CAMPOS_NOMBRE = new Set(["razon_social", "nombre_fantasia", "localidad", "provincia", "direccion"]);
export const CAMPO_ARTICULO = "descripcion";
/** Tablas (o relaciones con ese nombre) cuyo "descripcion" es un artículo. */
export const TABLAS_ARTICULO = new Set([
  "presupuesto_items", "orden_compra_items", "orden_compra_items_pendientes", "remito_items", "factura_items", "facturas_compra_items", "muestra_envio_items",
  "muestra_productos", "nota_credito_items", "catalogo_costos", "lista_precios_items", "v_comparador_precios", "productos",
]);
/** Tablas cuyo "nombre" es una persona. */
export const TABLAS_NOMBRE_PERSONA = new Set(["contactos", "contacto"]);

/**
 * Recorre lo que devuelve la base y arregla las mayúsculas de nombres y artículos (solo para mostrar).
 * `tabla` = la tabla pedida; las relaciones anidadas usan su propio nombre (ej. clientes(razon_social)).
 */
export function arreglarMayusculas<T>(dato: T, tabla = ""): T {
  const visitar = (v: unknown, t: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => visitar(x, t));
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const val = o[k];
      if (typeof val === "string") {
        if (CAMPOS_NOMBRE.has(k)) o[k] = nombrePropio(val);
        else if (k === CAMPO_ARTICULO && TABLAS_ARTICULO.has(t)) o[k] = textoArticulo(val);
        else if (k === "nombre" && TABLAS_NOMBRE_PERSONA.has(t)) o[k] = nombrePropio(val);
      } else if (val && typeof val === "object") {
        o[k] = visitar(val, k);
      }
    }
    return o;
  };
  return visitar(dato, tabla) as T;
}
