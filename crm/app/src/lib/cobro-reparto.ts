// Cobro masivo con diferencia (12/10/2026, regla 1: avisa y pregunta, nunca frena).
// Reparte lo cobrado (medios + retenciones) entre las facturas, de la más vieja a la más nueva:
// cada una se llena hasta su saldo y lo que falta queda en la última. Lo que sobra queda a favor del cliente.

export interface FacturaReparto { id: string; numero: string; fecha: string; saldo: number }
export interface FilaReparto extends FacturaReparto { aplicado: number; queda: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Más vieja primero; mismo día, por número. */
export function ordenarParaCobro<T extends { fecha: string; numero: string }>(facturas: T[]): T[] {
  return [...facturas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero, "es", { numeric: true }));
}

/**
 * `aplicado` va en la moneda de las facturas (en USD: pesos ÷ tipo de cambio).
 * Devuelve cómo queda cada factura, cuánto falta (pagó de menos) y cuánto sobra (pagó de más).
 */
export function repartirCobro(facturas: FacturaReparto[], aplicado: number): { filas: FilaReparto[]; falta: number; sobra: number } {
  let resto = r2(Math.max(0, aplicado));
  const filas = ordenarParaCobro(facturas).map((f) => {
    const saldo = r2(Math.max(0, f.saldo));
    const a = r2(Math.min(saldo, resto));
    resto = r2(resto - a);
    return { ...f, saldo, aplicado: a, queda: r2(saldo - a) };
  });
  const totalSaldo = r2(filas.reduce((s, f) => s + f.saldo, 0));
  const falta = r2(Math.max(0, totalSaldo - Math.max(0, aplicado)));
  return { filas, falta: falta < 0.01 ? 0 : falta, sobra: resto < 0.01 ? 0 : resto };
}

/**
 * Facturas para `registrar_cobro_masivo` (función de la base, ver supabase/diagnostico/registrar_cobro_masivo_actual.sql):
 * la base reparte lo cobrado EN PROPORCIÓN al "saldo" que recibe y la última se lleva el resto; el estado (pagada/parcial)
 * lo calcula con sus propios totales. Por eso, si falta plata, se le manda a cada factura lo que le toca como "saldo"
 * y se dejan afuera las que no reciben nada (si no, quedarían "parcial" con $0). Sin faltante, va el saldo real.
 */
export function facturasParaRegistrar(r: { filas: FilaReparto[]; falta: number }): { id: string; numero: string; saldo: number }[] {
  if (r.falta <= 0) return r.filas.map((f) => ({ id: f.id, numero: f.numero, saldo: f.saldo }));
  return r.filas.filter((f) => f.aplicado > 0).map((f) => ({ id: f.id, numero: f.numero, saldo: f.aplicado }));
}

/** Texto del cartel que pregunta antes de guardar. Vacío si no hay diferencia. */
export function avisoDiferenciaCobro(r: { filas: FilaReparto[]; falta: number; sobra: number }, formato: (n: number) => string): string {
  if (r.falta > 0) {
    const conSaldo = r.filas.filter((f) => f.queda > 0);
    const detalle = conSaldo.map((f) => `${f.numero} queda con saldo ${formato(f.queda)}`).join("; ");
    return `Faltan ${formato(r.falta)} para cancelar todas las facturas.\nSe aplica empezando por la más vieja: ${detalle}.\n\n¿Registrar el cobro igual?`;
  }
  if (r.sobra > 0) {
    return `Sobran ${formato(r.sobra)}: el cliente pagó de más. La base los suma a la última factura (queda pagada) y hoy no se ven como saldo a favor en la cuenta corriente.\n\n¿Registrar el cobro igual?`;
  }
  return "";
}
