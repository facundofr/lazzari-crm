// Pago parcial dentro de una OP: si los medios no alcanzan el neto, se recorta lo aplicado
// a las facturas más nuevas (las viejas se cancelan primero) hasta que bruto − retención = medios.
// La retención depende de la base sin IVA de lo que se paga, por eso se itera.
import { roundPaymentMoney } from "@/lib/payment-money";

export type FacturaParcial = {
  id: string;
  fecha: string;
  /** Lo que se iba a pagar de esta factura (normalmente el saldo). */
  monto: number;
  /** Proporción sin IVA del total (subtotal / total; 1 si no discrimina IVA). */
  ratioNeto: number;
};

export type ResultadoParcial = {
  montos: Record<string, number>;
  /** Facturas que quedan con saldo: id → lo que queda debiendo de lo que se iba a pagar. */
  quedan: { id: string; resto: number }[];
  bruto: number;
  retencion: number;
  neto: number;
};

/** Reparte un bruto entre las facturas: completa las más viejas primero. */
export function repartirBruto(facturas: FacturaParcial[], bruto: number): Record<string, number> {
  const orden = [...facturas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const out: Record<string, number> = {};
  let resto = roundPaymentMoney(Math.max(0, bruto));
  for (const f of orden) {
    const usar = roundPaymentMoney(Math.min(f.monto, resto));
    out[f.id] = usar;
    resto = roundPaymentMoney(resto - usar);
  }
  return out;
}

/**
 * Busca cuánto aplicar a cada factura para que el neto (bruto − NC − retención) sea igual a los medios.
 * `retencionDe(base)` calcula la retención sobre la base sin IVA de lo que se paga.
 * `baseNC` / `montoNC`: notas de crédito aplicadas (restan del bruto y de la base).
 */
export function calcularPagoParcial(
  facturas: FacturaParcial[],
  medios: number,
  retencionDe: (baseSinIVA: number) => number,
  montoNC = 0,
  baseNC = 0,
): ResultadoParcial {
  const totalFC = roundPaymentMoney(facturas.reduce((s, f) => s + f.monto, 0));
  const evaluar = (montos: Record<string, number>) => {
    const brutoFC = roundPaymentMoney(facturas.reduce((s, f) => s + (montos[f.id] || 0), 0));
    const base = roundPaymentMoney(Math.max(0, facturas.reduce((s, f) => s + roundPaymentMoney((montos[f.id] || 0) * f.ratioNeto), 0) - baseNC));
    const retencion = roundPaymentMoney(retencionDe(base));
    const bruto = roundPaymentMoney(brutoFC - montoNC);
    return { brutoFC, bruto, retencion, neto: roundPaymentMoney(bruto - retencion) };
  };
  let objetivoFC = Math.min(totalFC, roundPaymentMoney(medios + montoNC));
  let montos = repartirBruto(facturas, objetivoFC);
  for (let i = 0; i < 30; i++) {
    const r = evaluar(montos);
    const falta = roundPaymentMoney(medios - r.neto);
    if (Math.abs(falta) < 0.005) break;
    // Cada peso de bruto agrega menos de un peso de neto (se lleva retención): se corrige de a poco.
    objetivoFC = roundPaymentMoney(Math.min(totalFC, Math.max(0, objetivoFC + falta)));
    montos = repartirBruto(facturas, objetivoFC);
  }
  const r = evaluar(montos);
  const quedan = facturas
    .map((f) => ({ id: f.id, resto: roundPaymentMoney(f.monto - (montos[f.id] || 0)) }))
    .filter((q) => q.resto > 0.004);
  return { montos, quedan, bruto: r.bruto, retencion: r.retencion, neto: r.neto };
}
