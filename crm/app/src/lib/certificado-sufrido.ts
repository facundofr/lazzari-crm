// Certificados de retenciones sufridas (Augusto 27/10/2026): «Cargar certificado (IA)» en Finanzas › Retenciones › Sufridas.
// La IA lee el papel (api/parse-certificado-retencion con PROMPT_CERTIFICADOS) → normalizarCertificados.
// proponerRetenciones propone a qué retención del CRM va cada certificado: mismo cliente, impuesto e importe, fecha cercana.
// Avisa y nunca frena; nunca se asigna solo: una persona confirma y se guarda en la tabla certificados_retencion.

export type ImpuestoCertificado = "IVA" | "Ganancias" | "IIBB" | "SUSS";

export interface CertificadoLeido {
  impuesto: ImpuestoCertificado | null;
  numero: string | null;
  /** AAAA-MM-DD. */
  fecha: string | null;
  /** Importe retenido, en pesos. */
  monto: number | null;
  /** Quién retuvo: el cliente que pagó. */
  agenteNombre: string | null;
  agenteCuit: string | null;
  /** A quién le retuvieron: nosotros (dice de qué sociedad es). */
  retenidoNombre: string | null;
  retenidoCuit: string | null;
  jurisdiccion: string | null;
  comprobantes: string[];
  referencia: string | null;
}

export const PROMPT_CERTIFICADOS = `Sos un experto en impuestos argentinos (ARCA, ex AFIP, y rentas provinciales).

Te paso un PDF o una imagen con uno o varios CERTIFICADOS DE RETENCIÓN que un cliente nos hizo al pagarnos: certificados de ARCA (IVA, Ganancias, SUSS), constancias o comprobantes de retención de Ingresos Brutos de cualquier provincia (ARBA, AGIP, Córdoba, Santa Fe, etc.) o un aviso / orden de pago que lista las retenciones con su N° de certificado. Un mismo archivo puede traer varios certificados (uno por impuesto) y varias páginas.

Devolvé SOLO un JSON con esta estructura exacta:

{
  "certificados": [
    {
      "impuesto": "IVA" | "Ganancias" | "IIBB" | "SUSS" | null,
      "numero": "N° del certificado tal como figura (con guiones y ceros), o null",
      "fecha": "YYYY-MM-DD fecha de emisión del certificado o de la retención, o null",
      "monto": 1234.56,
      "agente_razon_social": "quién retuvo (el agente de retención, el que paga), o null",
      "agente_cuit": "CUIT del agente de retención, solo números, o null",
      "retenido_razon_social": "a quién le retuvieron (el sujeto retenido, el que cobra), o null",
      "retenido_cuit": "CUIT del sujeto retenido, solo números, o null",
      "jurisdiccion": "provincia de la retención de IIBB, o null",
      "comprobantes": ["facturas o comprobantes que figuran como origen, tal cual"],
      "referencia_pago": "N° de la orden de pago, pago interno o aviso de pago, o null"
    }
  ]
}

Reglas:
- Una entrada por certificado. Si el mismo certificado aparece dos veces (en el resumen y en su constancia), es UNA sola entrada.
- "monto" es el IMPORTE RETENIDO (no la base imponible ni el total pagado), como número plano: $ 1.481.021,27 = 1481021.27.
- "numero" es el N° del certificado o constancia de retención: no el de la orden de pago, ni un CUIT, ni el de una factura. Copialo tal cual figura.
- "impuesto": IVA (impuesto al valor agregado), Ganancias (impuesto a las ganancias), IIBB (ingresos brutos, de cualquier jurisdicción) o SUSS (seguridad social). Si no se puede saber, null.
- El agente de retención es el que paga y retiene; el sujeto retenido es el que cobra. No los confundas.
- Las fechas en formato YYYY-MM-DD.
- Si un dato no figura, null (en "comprobantes", []). No inventes datos.
- Si el archivo no trae ningún certificado de retención, devolvé {"certificados": []}.
- Devolvé SOLO el JSON, sin texto adicional ni markdown.`;

const texto = (v: unknown): string | null => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t && !/^(null|undefined|n\/?a|-)$/i.test(t) ? t : null;
};
export const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const cuit = (v: unknown) => (soloDigitos(v).length === 11 ? soloDigitos(v) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Importe: número, o texto con miles y decimales argentinos ("1.481.021,27"), con punto decimal ("1481021.27") o en inglés ("1,481,021.27"). */
function importe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? r2(v) : null;
  let t = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (coma >= 0) t = /,\d{1,2}$/.test(t) && t.split(",").length === 2 ? t.replace(",", ".") : t.replace(/,/g, "");
  else if (t.split(".").length > 2) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? r2(n) : null;
}

/** AAAA-MM-DD o DD/MM/AAAA → AAAA-MM-DD; lo demás, null. */
function fecha(v: unknown): string | null {
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

function impuesto(v: unknown): ImpuestoCertificado | null {
  const t = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\biva\b|valor agregado/.test(t)) return "IVA";
  if (/ganancia/.test(t)) return "Ganancias";
  if (/ingresos brutos|\biibb\b|\bii\.?bb\.?\b|\bib\b/.test(t)) return "IIBB";
  if (/\bsuss\b|seguridad social/.test(t)) return "SUSS";
  return null;
}

/** N° de certificado para comparar: sin guiones ni ceros adelante ("0000-00074762" = "74762"); sin dígitos, el texto. */
export function claveNumero(n: string | null | undefined): string {
  const d = soloDigitos(n).replace(/^0+/, "");
  return d || String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Mismo certificado leído dos veces (en un archivo o subiendo el mismo archivo otra vez). */
export const claveCertificado = (c: CertificadoLeido) => `${c.impuesto || ""}|${claveNumero(c.numero)}|${c.monto ?? ""}`;

/** Lo que devuelve la IA → certificados prolijos, sin repetidos. */
export function normalizarCertificados(raw: unknown): CertificadoLeido[] {
  const lista: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { certificados?: unknown })?.certificados) ? (raw as { certificados: unknown[] }).certificados : [];
  const out: CertificadoLeido[] = [];
  const vistos = new Set<string>();
  for (const x of lista) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const c: CertificadoLeido = {
      impuesto: impuesto(o.impuesto),
      numero: texto(o.numero),
      fecha: fecha(o.fecha),
      monto: importe(o.monto),
      agenteNombre: texto(o.agente_razon_social),
      agenteCuit: cuit(o.agente_cuit),
      retenidoNombre: texto(o.retenido_razon_social),
      retenidoCuit: cuit(o.retenido_cuit),
      jurisdiccion: texto(o.jurisdiccion),
      comprobantes: Array.isArray(o.comprobantes) ? o.comprobantes.map(texto).filter((s): s is string => !!s) : [],
      referencia: texto(o.referencia_pago),
    };
    if (!c.numero && c.monto === null) continue;
    const k = claveCertificado(c);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(c);
  }
  return out;
}

/** Una retención sufrida del CRM (las filas «sufrida» de armarRetenciones). */
export interface RetencionSufrida {
  movimientoId: string;
  fecha: string;
  impuesto: string;
  monto: number;
  moneda: "ARS" | "USD";
  nombre: string;
  cuit: string;
  /** N° que ya tiene (cargado o escrito en el texto); null = falta. */
  certificado: string | null;
}

export type EstadoPropuesta = "coincide" | "difiere" | "sin_retencion" | "otra_sociedad" | "sin_numero";

export interface Propuesta {
  estado: EstadoPropuesta;
  /** La retención sin N° que se propone; null si no hay ninguna para proponer. */
  movimientoId: string | null;
  /** Certificado − CRM, en $ (centavos de redondeo o un importe distinto). */
  diferencia: number | null;
  /** La propuesta es de otro cliente del CRM: el CUIT del certificado no coincide. */
  otroCliente: boolean;
  /** Para elegir a mano: sin N°, del mismo cliente e impuesto (las más parecidas primero); sin CUIT en el certificado, las del impuesto de fecha cercana. */
  opciones: string[];
  /** El mismo N° ya está en otra retención del impuesto (y del cliente). */
  yaCargado: RetencionSufrida | null;
  /** El certificado es de otra sociedad: su nombre o CUIT. */
  otraSociedad: string | null;
}

/** Hasta $ 1 de diferencia es redondeo: coincide (y se muestra la diferencia). */
export const TOLERANCIA_CERTIFICADO = 1;
/** Con importe distinto solo se propone una retención del mismo cliente de hasta 60 días de diferencia. */
export const DIAS_CERTIFICADO = 60;

const dias = (a: string | null, b: string) => (a ? Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b.slice(0, 10)}T12:00:00Z`)) / 86_400_000 : 0);

/** La IA a veces da vuelta agente y retenido: si el «agente» somos nosotros, son al revés. */
export function corregirPartes(c: CertificadoLeido, cuitSociedad: string): CertificadoLeido {
  const nuestro = soloDigitos(cuitSociedad);
  return c.agenteCuit && c.agenteCuit === nuestro && c.retenidoCuit !== nuestro
    ? { ...c, agenteCuit: c.retenidoCuit, agenteNombre: c.retenidoNombre, retenidoCuit: c.agenteCuit, retenidoNombre: c.agenteNombre }
    : c;
}

interface Candidata { r: RetencionSufrida; rango: number; dif: number; dias: number; mismoCliente: boolean }

/**
 * Propone a qué retención sin N° va cada certificado, sin repetir retención:
 * 1° mismo cliente e importe (hasta $ 1); 2° otro cliente con el mismo importe y fecha cercana (la IA pudo leer mal el CUIT
 * o el CRM tener otro); 3° mismo cliente con importe distinto y fecha cercana. Primero se ubican los que coinciden.
 * El certificado de otra sociedad o sin N° no se propone; el que ya está cargado, solo si coincide el importe.
 */
export function proponerRetenciones(certs: CertificadoLeido[], retenciones: RetencionSufrida[], sociedad: { cuit: string; otras?: { nombre: string; cuit: string }[] }): Propuesta[] {
  const cuitSociedad = soloDigitos(sociedad.cuit);
  const libres = retenciones.filter((r) => !r.certificado);
  const analisis = certs.map((original) => {
    const c = corregirPartes(original, cuitSociedad);
    const mismoImpuesto = (r: RetencionSufrida) => !c.impuesto || r.impuesto === c.impuesto;
    const mismoCliente = (r: RetencionSufrida) => !!c.agenteCuit && soloDigitos(r.cuit) === c.agenteCuit;
    const yaCargado = c.numero ? retenciones.find((r) => r.certificado && claveNumero(r.certificado) === claveNumero(c.numero) && mismoImpuesto(r) && (!c.agenteCuit || mismoCliente(r))) ?? null : null;
    const otra = c.retenidoCuit && cuitSociedad && c.retenidoCuit !== cuitSociedad
      ? sociedad.otras?.find((s) => soloDigitos(s.cuit) === c.retenidoCuit)?.nombre || c.retenidoNombre || `CUIT ${c.retenidoCuit}`
      : null;
    const pool = libres.filter(mismoImpuesto);
    const candidatas: Candidata[] = [];
    if (c.numero && !otra) {
      for (const r of pool) {
        const dif = c.monto === null || r.moneda !== "ARS" ? Infinity : Math.abs(r2(c.monto - r.monto));
        const d = dias(c.fecha, r.fecha);
        const cliente = mismoCliente(r);
        const rango = cliente && dif <= TOLERANCIA_CERTIFICADO ? 0 : dif <= TOLERANCIA_CERTIFICADO && d <= DIAS_CERTIFICADO ? 1 : cliente && d <= DIAS_CERTIFICADO ? 2 : null;
        if (rango !== null) candidatas.push({ r, rango, dif, dias: d, mismoCliente: cliente });
      }
      candidatas.sort((a, b) => a.rango - b.rango || a.dif - b.dif || a.dias - b.dias);
    }
    const parecidas = (a: RetencionSufrida, b: RetencionSufrida) => {
      const dif = (r: RetencionSufrida) => (c.monto === null || r.moneda !== "ARS" ? Infinity : Math.abs(c.monto - r.monto));
      return dif(a) - dif(b) || dias(c.fecha, a.fecha) - dias(c.fecha, b.fecha);
    };
    // Con el CUIT del cliente, solo las suyas (si no tiene, no se ofrecen las de otros); sin CUIT, las del impuesto de fecha cercana.
    const opciones = (c.agenteCuit ? pool.filter(mismoCliente) : pool.filter((r) => dias(c.fecha, r.fecha) <= DIAS_CERTIFICADO)).sort(parecidas).map((r) => r.movimientoId);
    return { c, candidatas, yaCargado, otra, opciones };
  });
  const orden = analisis.map((_, i) => i).sort((a, b) => {
    const x = analisis[a].candidatas[0], y = analisis[b].candidatas[0];
    if (!x || !y) return x ? -1 : y ? 1 : a - b;
    return x.rango - y.rango || x.dif - y.dif || x.dias - y.dias || a - b;
  });
  const tomadas = new Set<string>();
  const out: Propuesta[] = new Array(certs.length);
  for (const i of orden) {
    const { c, candidatas, yaCargado, otra, opciones } = analisis[i];
    const base = { yaCargado, otraSociedad: otra, opciones: otra || !c.numero ? [] : opciones };
    if (!c.numero) { out[i] = { estado: "sin_numero", movimientoId: null, diferencia: null, otroCliente: false, ...base }; continue; }
    if (otra) { out[i] = { estado: "otra_sociedad", movimientoId: null, diferencia: null, otroCliente: false, ...base }; continue; }
    // Si el N° ya está cargado en otra retención, con importe distinto no se propone nada (se elige a mano si hace falta).
    const elegida = candidatas.find((x) => !tomadas.has(x.r.movimientoId) && !(yaCargado && x.rango === 2));
    if (!elegida) { out[i] = { estado: "sin_retencion", movimientoId: null, diferencia: null, otroCliente: false, ...base }; continue; }
    tomadas.add(elegida.r.movimientoId);
    const opcionesConElegida = base.opciones.includes(elegida.r.movimientoId) ? base.opciones : [elegida.r.movimientoId, ...base.opciones];
    out[i] = {
      estado: elegida.rango === 2 ? "difiere" : "coincide",
      movimientoId: elegida.r.movimientoId,
      diferencia: c.monto === null || elegida.r.moneda !== "ARS" ? null : r2(c.monto - elegida.r.monto),
      otroCliente: !!c.agenteCuit && !elegida.mismoCliente,
      ...base,
      opciones: opcionesConElegida,
    };
  }
  return out;
}
