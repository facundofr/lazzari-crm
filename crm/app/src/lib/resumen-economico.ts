// Resumen económico de Finanzas → Hoy (pedido de Augusto, 12/10/2026): "cómo estoy hoy" a primera vista.
// Lo que tengo − lo que debo = posición neta. Pesos y dólares siempre por separado; aparte, todo en pesos con el dólar BNA.
// Cada renglón se puede tildar o destildar: solo los tildados entran en la cuenta.
// Prueba: npx tsx scripts/test-resumen-economico.mjs

export type ClaveResumen =
  | "disponible" | "cartera" | "a_cobrar" | "vendido_sin_facturar"
  | "emitidos" | "a_pagar" | "deudas";

export interface Montos { ARS: number; USD: number }

export interface RenglonResumen {
  clave: ClaveResumen;
  titulo: string;
  lado: "tengo" | "debo";
  /** Tildado de entrada. */
  visible: boolean;
}

export const RENGLONES_RESUMEN: RenglonResumen[] = [
  { clave: "disponible", titulo: "Disponible (bancos + FCI + efectivo)", lado: "tengo", visible: true },
  { clave: "cartera", titulo: "Cheques en cartera", lado: "tengo", visible: true },
  { clave: "a_cobrar", titulo: "A cobrar (facturas de venta)", lado: "tengo", visible: true },
  { clave: "vendido_sin_facturar", titulo: "Vendido sin facturar", lado: "tengo", visible: false },
  { clave: "emitidos", titulo: "Cheques emitidos a debitar", lado: "debo", visible: true },
  { clave: "a_pagar", titulo: "A pagar (facturas de proveedores)", lado: "debo", visible: true },
  { clave: "deudas", titulo: "Deudas (créditos y préstamos)", lado: "debo", visible: true },
];

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const cero = (): Montos => ({ ARS: 0, USD: 0 });

/** Suma por moneda (cualquier moneda que no sea USD cuenta como pesos). */
export function sumarPorMoneda<T>(filas: T[], monto: (f: T) => number, moneda: (f: T) => string | null | undefined): Montos {
  const s = cero();
  for (const f of filas) {
    const v = Number(monto(f)) || 0;
    if (moneda(f) === "USD") s.USD += v; else s.ARS += v;
  }
  return { ARS: r2(s.ARS), USD: r2(s.USD) };
}

/**
 * Saldos de cuenta corriente (positivo = nos deben / debemos; negativo = a favor de la otra parte).
 * Devuelve el neto y, aparte, cuánto hay a favor de la otra parte (ya restado del neto).
 */
export function netoCuentaCorriente(saldos: Array<{ ARS: number; USD: number }>): { neto: Montos; aFavor: Montos } {
  const neto = cero();
  const aFavor = cero();
  for (const s of saldos) {
    for (const m of ["ARS", "USD"] as const) {
      const v = Number(s[m]) || 0;
      neto[m] += v;
      if (v < 0) aFavor[m] += -v;
    }
  }
  return { neto: { ARS: r2(neto.ARS), USD: r2(neto.USD) }, aFavor: { ARS: r2(aFavor.ARS), USD: r2(aFavor.USD) } };
}

export interface ResultadoResumen {
  tengo: Montos;
  debo: Montos;
  neto: Montos;
  /** Todo en pesos con el dólar dado; null si no hay dólar. */
  netoEnPesos: number | null;
}

/** Solo suman los renglones tildados. */
export function calcularResumen(montos: Partial<Record<ClaveResumen, Montos>>, tildados: Set<ClaveResumen>, dolar: number | null): ResultadoResumen {
  const tengo = cero();
  const debo = cero();
  for (const r of RENGLONES_RESUMEN) {
    if (!tildados.has(r.clave)) continue;
    const v = montos[r.clave];
    if (!v) continue;
    const destino = r.lado === "tengo" ? tengo : debo;
    destino.ARS += v.ARS;
    destino.USD += v.USD;
  }
  const neto = { ARS: r2(tengo.ARS - debo.ARS), USD: r2(tengo.USD - debo.USD) };
  return {
    tengo: { ARS: r2(tengo.ARS), USD: r2(tengo.USD) },
    debo: { ARS: r2(debo.ARS), USD: r2(debo.USD) },
    neto,
    netoEnPesos: dolar && dolar > 0 ? r2(neto.ARS + neto.USD * dolar) : null,
  };
}

/** Tildados guardados (texto con claves separadas por coma); si no hay nada guardado, los de fábrica. */
export function leerTildados(guardado: string | null | undefined): Set<ClaveResumen> {
  const validas = new Set(RENGLONES_RESUMEN.map((r) => r.clave));
  if (guardado == null) return new Set(RENGLONES_RESUMEN.filter((r) => r.visible).map((r) => r.clave));
  return new Set(guardado.split(",").map((s) => s.trim()).filter((s): s is ClaveResumen => validas.has(s as ClaveResumen)));
}
