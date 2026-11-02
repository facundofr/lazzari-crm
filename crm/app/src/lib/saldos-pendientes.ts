// Saldos chicos fuera de pendientes y colores de vencimiento (Augusto 02/11/2026).
// - "No quiero que se esconda una factura chica, sino que sean SALDOS menores a 20.000 que me dé la opción de sacarlos de
//   pendientes, y obviamente que queden en las cuentas corrientes": el tilde aparece solo en facturas ya pagadas en parte
//   (saldo menor que el total) con un saldo menor a $ 20.000 (los dólares, al dólar divisa del día). Las sacadas no se muestran
//   en Cobrar, Pagar, Vencimientos, Cobranzas ni el Inicio; Cuentas corrientes no cambia (tabla saldos_fuera_de_pendientes).
// - "Un poco más de color a las facturas vencidas y por vencer": vencida = rojo; por vencer (de hoy a 7 días) = naranja.
// Prueba: scripts/test-saldos-pendientes.ts
export const SALDO_CHICO = 20000;
export const DIAS_POR_VENCER = 7;

export interface SaldoFactura { lado: "venta" | "compra"; id: string; total: number; saldo: number; moneda: "ARS" | "USD" }

/** Clave de una factura en el conjunto de las sacadas (las de venta y las de compra son tablas distintas). */
export const claveSaldo = (f: Pick<SaldoFactura, "lado" | "id">) => `${f.lado}:${f.id}`;

/** El saldo en pesos (los dólares al dólar del día; sin dólar no se puede saber: null). */
export function saldoEnPesos(f: Pick<SaldoFactura, "saldo" | "moneda">, dolar: number | null): number | null {
  if (f.moneda !== "USD") return f.saldo;
  return dolar ? f.saldo * dolar : null;
}

/** Se puede sacar de pendientes: factura ya pagada en parte y con un saldo menor a $ 20.000. Una factura chica sin pagar, no. */
export function esSaldoChico(f: Pick<SaldoFactura, "total" | "saldo" | "moneda">, dolar: number | null): boolean {
  if (!(f.saldo > 0.005) || !(f.saldo < f.total - 0.005)) return false;
  const pesos = saldoEnPesos(f, dolar);
  return pesos !== null && pesos < SALDO_CHICO;
}

/** Separa lo pendiente de lo que se sacó de pendientes. */
export function separarSacados<T extends Pick<SaldoFactura, "lado" | "id">>(filas: T[], sacados: ReadonlySet<string>): { pendientes: T[]; sacados: T[] } {
  const pendientes: T[] = [];
  const fuera: T[] = [];
  for (const f of filas) (sacados.has(claveSaldo(f)) ? fuera : pendientes).push(f);
  return { pendientes, sacados: fuera };
}

export type TonoVence = "vencida" | "por_vencer" | null;

/** Vencida (ya pasó) o por vencer (de hoy a 7 días). Sin saldo no hay color. */
export function tonoVence(dias: number, conSaldo = true): TonoVence {
  if (!conSaldo) return null;
  if (dias < 0) return "vencida";
  return dias <= DIAS_POR_VENCER ? "por_vencer" : null;
}

/** "vencida hace 12 d", "vence hoy", "vence en 3 d", "en 20 d". */
export function textoVence(dias: number): string {
  if (dias < 0) return `vencida hace ${-dias} d`;
  if (dias === 0) return "vence hoy";
  return dias <= DIAS_POR_VENCER ? `vence en ${dias} d` : `en ${dias} d`;
}
