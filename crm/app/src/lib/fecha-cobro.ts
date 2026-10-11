/**
 * Fecha de un cobro de cliente.
 *
 * El cobro se registra el día que se RECIBE el pago. Para una transferencia o un
 * depósito es la fecha de acreditación; para un cheque o eCheq es el día que lo
 * recibimos, nunca su fecha de pago (esa queda guardada en el cheque).
 * Una fecha futura no es un cobro: se descarta y se usa hoy.
 */

export interface PagoLeido {
  tipo?: string | null;
  fecha?: string | null;
  fecha_cobro?: string | null;
}

export const esCheque = (tipo: unknown) => {
  const t = String(tipo || "").toLowerCase();
  return t === "cheque" || t === "echeq" || t === "cheque_recibido";
};

const esFecha = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Fecha sugerida para un medio de cobro leído por IA. `hoy` en formato YYYY-MM-DD (Argentina). */
export function fechaMedioCobro(pago: PagoLeido, hoy: string): string {
  if (esCheque(pago.tipo)) return hoy;
  const f = esFecha(pago.fecha_cobro) ? pago.fecha_cobro : esFecha(pago.fecha) ? pago.fecha : null;
  return f && f <= hoy ? f : hoy;
}

/** Fecha sugerida para el cobro entero: la del primer medio que no sea cheque; si todos son cheques, hoy. */
export function fechaCobroSugerida(pagos: PagoLeido[], hoy: string): string {
  const otro = pagos.find(p => !esCheque(p.tipo) && !String(p.tipo || "").startsWith("retencion_"));
  return otro ? fechaMedioCobro(otro, hoy) : hoy;
}

/** Aviso (nunca bloqueo) si la fecha elegida para el cobro es futura. */
export function avisoFechaCobroFutura(fecha: string, hoy: string): string | null {
  if (!esFecha(fecha) || fecha <= hoy) return null;
  return `La fecha del cobro (${fecha.split("-").reverse().join("/")}) es futura. El cobro va con la fecha en que lo recibiste; la fecha de pago del cheque se guarda aparte. ¿Guardar igual?`;
}
