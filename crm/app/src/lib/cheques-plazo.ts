// Cheques: en qué plazo está cada uno (pedido de Augusto 16/10/2026: "me tiene que decir si algo está en fecha").
// - Propios (emitidos, sin debitar): "en fecha" = ya llegó su fecha de pago; el banco lo puede debitar hoy → tiene que haber plata.
// - Recibidos (en cartera): "en fecha" = ya se puede depositar.
// Solo informativo: nunca frena nada.

export type PlazoCheque = "en_fecha" | "esta_semana" | "mas_adelante";

export interface ChequeParaPlazo {
  direccion?: string | null;
  estado: string;
  fecha_pago: string | null;
  monto: number | string | null;
  moneda?: string | null;
}

const PENDIENTE_EMITIDO = ["entregado", "pendiente"];
const PENDIENTE_RECIBIDO = ["en_cartera"];

/** ¿El cheque sigue pendiente (propio sin debitar o recibido en cartera)? */
export function chequePendiente(ch: ChequeParaPlazo): boolean {
  return (ch.direccion === "emitido" ? PENDIENTE_EMITIDO : PENDIENTE_RECIBIDO).includes(ch.estado);
}

/** Domingo de la semana de `hoy` (AAAA-MM-DD). */
export function domingoDe(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

/** Plazo de un cheque pendiente; null si ya no está pendiente o no tiene fecha. */
export function plazoCheque(ch: ChequeParaPlazo, hoy: string): PlazoCheque | null {
  if (!chequePendiente(ch) || !ch.fecha_pago) return null;
  const f = String(ch.fecha_pago).slice(0, 10);
  if (f <= hoy) return "en_fecha";
  if (f <= domingoDe(hoy)) return "esta_semana";
  return "mas_adelante";
}

export interface TotalPlazo { cantidad: number; ARS: number; USD: number }
export type ResumenPlazos = Record<PlazoCheque, TotalPlazo>;

/** Totales por plazo de los cheques de una dirección ("emitido" o "recibido"). */
export function resumenPlazos(cheques: ChequeParaPlazo[], direccion: "emitido" | "recibido", hoy: string): ResumenPlazos {
  const vacio = (): TotalPlazo => ({ cantidad: 0, ARS: 0, USD: 0 });
  const r: ResumenPlazos = { en_fecha: vacio(), esta_semana: vacio(), mas_adelante: vacio() };
  for (const ch of cheques) {
    if ((ch.direccion === "emitido" ? "emitido" : "recibido") !== direccion) continue;
    const p = plazoCheque(ch, hoy);
    if (!p) continue;
    r[p].cantidad += 1;
    r[p][ch.moneda === "USD" ? "USD" : "ARS"] += Number(ch.monto) || 0;
  }
  for (const p of Object.values(r)) { p.ARS = Math.round(p.ARS * 100) / 100; p.USD = Math.round(p.USD * 100) / 100; }
  return r;
}

/** Rango de fechas de pago para filtrar la lista por plazo. */
export function rangoPlazo(p: PlazoCheque, hoy: string): { desde: string; hasta: string } {
  const manana = new Date(`${hoy}T12:00:00Z`);
  manana.setUTCDate(manana.getUTCDate() + 1);
  const domingo = domingoDe(hoy);
  const lunes = new Date(`${domingo}T12:00:00Z`);
  lunes.setUTCDate(lunes.getUTCDate() + 1);
  if (p === "en_fecha") return { desde: "", hasta: hoy };
  if (p === "esta_semana") return { desde: manana.toISOString().slice(0, 10), hasta: domingo };
  return { desde: lunes.toISOString().slice(0, 10), hasta: "" };
}
