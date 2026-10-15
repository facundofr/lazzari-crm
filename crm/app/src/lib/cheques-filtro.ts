/**
 * Buscador y filtros de la pestaña Cheques.
 * El texto busca en número, banco, origen, destino y observaciones (sin importar tildes ni mayúsculas)
 * y también por importe: "7623000", "7.623.000" o "7.623.000,00" encuentran un cheque de $7.623.000.
 */

export interface ChequeFiltrable {
  numero?: string | null;
  banco_emisor?: string | null;
  origen_nombre?: string | null;
  destino_nombre?: string | null;
  observaciones?: string | null;
  monto?: number | string | null;
  estado?: string | null;
  direccion?: string | null;
  tipo_cheque?: string | null;
  fecha_pago?: string | null;
}

export interface FiltrosCheques {
  texto?: string;
  estado?: string;
  direccion?: string;
  tipo?: string;
  /** YYYY-MM-DD, fecha de pago del cheque */
  desde?: string;
  hasta?: string;
}

const normalizar = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Si el texto parece un importe, devuelve su valor en centavos. */
function importeBuscado(texto: string): number | null {
  const t = texto.trim();
  if (!/^\$?\s*[\d.,]+$/.test(t)) return null;
  let limpio = t.replace(/[$\s]/g, "");
  if (/,\d{1,2}$/.test(limpio)) limpio = limpio.replace(/\./g, "").replace(",", ".");
  else limpio = limpio.replace(/[.,]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/**
 * Filtro por defecto de Cheques (16/10/2026): solo lo que falta mover (propios a pagar y recibidos en cartera o depositados).
 * Lo cobrado, anulado, rechazado o endosado es historial: se ve eligiendo "Todos (historial)".
 */
export const ESTADO_PENDIENTES = "_pendientes";
export const ESTADOS_PENDIENTES = ["pendiente", "entregado", "en_cartera", "depositado"];

export function filtrarCheques<T extends ChequeFiltrable>(cheques: T[], f: FiltrosCheques): T[] {
  const texto = normalizar(f.texto).trim();
  const importe = texto ? importeBuscado(texto) : null;
  const palabras = texto.split(/\s+/).filter(Boolean);
  return cheques.filter((c) => {
    if (f.estado === ESTADO_PENDIENTES) { if (!ESTADOS_PENDIENTES.includes(String(c.estado))) return false; }
    else if (f.estado && c.estado !== f.estado) return false;
    if (f.direccion && (c.direccion || "recibido") !== f.direccion) return false;
    if (f.tipo && c.tipo_cheque !== f.tipo) return false;
    if (f.desde && (!c.fecha_pago || c.fecha_pago < f.desde)) return false;
    if (f.hasta && (!c.fecha_pago || c.fecha_pago > f.hasta)) return false;
    if (!palabras.length) return true;
    if (importe !== null && Math.round(Number(c.monto || 0) * 100) === importe) return true;
    const campos = normalizar([c.numero, c.banco_emisor, c.origen_nombre, c.destino_nombre, c.observaciones].join(" "));
    return palabras.every((p) => campos.includes(p));
  });
}

/** Motivos de rechazo para el desplegable ("Otro" permite escribirlo). */
export const MOTIVOS_RECHAZO_CHEQUE = [
  "Sin fondos suficientes",
  "Cuenta cerrada o suspendida",
  "Orden de no pagar del librador",
  "eCheq repudiado",
  "Firma no válida o defectos formales",
  "Presentado fuera de término",
  "Endoso irregular",
] as const;
