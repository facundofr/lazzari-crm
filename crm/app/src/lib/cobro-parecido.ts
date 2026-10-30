/**
 * Cobros repetidos (auditoría de la plata 30/10/2026, Tanda A punto 6). Avisan y preguntan, nunca frenan (regla 1).
 *  - Renglones repetidos en un mismo cobro (D5: el mismo medio e importe cargado dos veces).
 *  - Cobro o pago suelto parecido: mismo cliente o proveedor, importe ±$ 1 y fecha a 5 días o menos. Un cobro cargado sin
 *    factura ("Nuevo movimiento") no baja la cuenta corriente, así que la factura se podía volver a cobrar.
 * Funciones puras. Prueba: npx tsx scripts/test-cobro-parecido.ts
 */

export const DIAS_PARECIDO = 5;
export const TOLERANCIA_PARECIDO = 1;

/** Tipos de movimiento que son plata de un cliente (sin retenciones ni ajustes). */
export const TIPOS_COBRO = ["cobro", "transferencia", "efectivo", "deposito", "cheque_recibido", "link_pago"] as const;

/** Los renglones que se repiten en el mismo cobro: uno por grupo, con cuántas veces está. */
export function renglonesRepetidos<T>(renglones: T[], igual: (a: T, b: T) => boolean): { renglon: T; veces: number }[] {
  const grupos: { renglon: T; veces: number }[] = [];
  for (const r of renglones) {
    const g = grupos.find((x) => igual(x.renglon, r));
    if (g) g.veces++; else grupos.push({ renglon: r, veces: 1 });
  }
  return grupos.filter((g) => g.veces > 1);
}

const dias = (a: string, b: string) => Math.abs(Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86_400_000;

/** El movimiento ya cargado que se parece a uno nuevo (importe ±$ 1, a 5 días o menos, misma moneda); el más cercano en fecha. */
export function movimientoParecido<M extends { fecha: string; monto: number | string; moneda?: string | null }>(
  nuevo: { fecha: string; monto: number; moneda?: string | null },
  cargados: M[],
): M | null {
  if (!(nuevo.monto > 0)) return null;
  const cerca = cargados.filter((m) => (!nuevo.moneda || !m.moneda || m.moneda === nuevo.moneda)
    && Math.abs(Number(m.monto) - nuevo.monto) <= TOLERANCIA_PARECIDO && dias(m.fecha, nuevo.fecha) <= DIAS_PARECIDO);
  return cerca.sort((a, b) => dias(a.fecha, nuevo.fecha) - dias(b.fecha, nuevo.fecha))[0] || null;
}

/** "2026-10-30" ± días, para buscar en la base solo lo que puede parecerse. */
export function rangoParecido(fechas: string[]): { desde: string; hasta: string } | null {
  const validas = fechas.map((f) => String(f).slice(0, 10)).filter((f) => !Number.isNaN(Date.parse(f))).sort();
  if (!validas.length) return null;
  const mover = (f: string, n: number) => new Date(Date.parse(f) + n * 86_400_000).toISOString().slice(0, 10);
  return { desde: mover(validas[0], -DIAS_PARECIDO), hasta: mover(validas[validas.length - 1], DIAS_PARECIDO) };
}
