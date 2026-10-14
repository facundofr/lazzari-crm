// ¿Cubro los gastos fijos del mes? — cuenta pura, solo informativa (nunca bloquea nada).
// Lo que paga sueldos y alquiler es la GANANCIA, no la venta: ganancia del mes = venta neta − gastos (2 % / 7 %) − costo de lo vendido
// (misma cuenta que la columna Ganancia/Margen de Presupuestos, `margenPR`, con el envío interno incluido).
// "Lo vendido del mes" = presupuestos Aprobado / Facturar / Facturado con fecha del mes corriente.
import { margenPR, type PRMargenEntrada } from "./presupuesto-margen";

export interface PRDelMes extends PRMargenEntrada {
  id: string;
  /** Estado del PR (para separar lo que falta facturar). */
  estado?: string;
}

export interface FijoEntrada {
  monto: number;
  moneda: string;
  activo: boolean;
  /** Dólar de referencia de este gasto (Finanzas > Gastos fijos). Si falta, se usa `dolarFijos`. */
  dolar?: number | null;
}

export interface CoberturaEntrada {
  prs: PRDelMes[];
  fijos: FijoEntrada[];
  /** Dólar de respaldo para los fijos en US$ que no tienen el suyo. Sin ninguno, no se pueden pasar a pesos. */
  dolarFijos: number;
  /** Día del mes (1..31) y cantidad de días del mes, para saber el ritmo. */
  diaDelMes: number;
  diasDelMes: number;
}

export interface Cobertura {
  /** Venta neta (sin IVA) del mes en pesos, de los PR que tienen costo cargado y TC si hace falta. */
  ventaNeta: number;
  /** Venta neta de los PR sin costo cargado (no entran en la ganancia). */
  ventaSinCosto: number;
  ganancia: number;
  /** Ganancia ÷ venta (de los PR con costo). null si todavía no hay datos. */
  margenSobreVenta: number | null;
  fijosARS: number;
  fijosUSD: number;
  /** Fijos totales en pesos; null si hay fijos en US$ y falta cargar el dólar. */
  fijosTotal: number | null;
  /** Ganancia ÷ fijos × 100 (null si no se puede calcular). */
  coberturaPct: number | null;
  /** Lo que falta de ganancia para cubrir (0 si ya se cubrió). */
  faltaGanancia: number | null;
  /** Venta que falta hacer para cubrir, con el margen del mes. null si no hay margen todavía. */
  faltaVender: number | null;
  /** Ganancia estimada a fin de mes si sigue el ritmo. */
  gananciaProyectada: number | null;
  prSinCosto: number;
  prSinTC: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularCobertura(e: CoberturaEntrada): Cobertura {
  let ventaNeta = 0, ventaSinCosto = 0, ganancia = 0, prSinCosto = 0, prSinTC = 0;
  for (const pr of e.prs) {
    const m = margenPR(pr);
    let tc = 1;
    if (pr.moneda === "USD") {
      tc = Number(pr.tipoCambio) > 0 ? Number(pr.tipoCambio) : Number(pr.tipoCambioDivisas) > 0 ? Number(pr.tipoCambioDivisas) : 0;
      if (!tc) { prSinTC++; continue; }
    }
    if (m.margenPct === null) { prSinCosto++; ventaSinCosto += m.venta * tc; continue; }
    ventaNeta += m.venta * tc;
    ganancia += m.ganancia * tc;
  }
  const fijosARS = e.fijos.filter((f) => f.activo && f.moneda !== "USD").reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const fijosUSD = e.fijos.filter((f) => f.activo && f.moneda === "USD").reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const usd = e.fijos.filter((f) => f.activo && f.moneda === "USD" && (Number(f.monto) || 0) > 0);
  const dolarDe = (f: FijoEntrada) => (Number(f.dolar) > 0 ? Number(f.dolar) : e.dolarFijos > 0 ? e.dolarFijos : 0);
  const faltaDolar = usd.some((f) => !(dolarDe(f) > 0));
  const fijosTotal = faltaDolar ? null : r2(fijosARS + usd.reduce((s, f) => s + (Number(f.monto) || 0) * dolarDe(f), 0));
  const margenSobreVenta = ventaNeta > 0 ? ganancia / ventaNeta : null;
  const coberturaPct = fijosTotal && fijosTotal > 0 ? Math.round((ganancia / fijosTotal) * 100) : null;
  const faltaGanancia = fijosTotal === null ? null : Math.max(0, r2(fijosTotal - ganancia));
  const faltaVender = faltaGanancia === null ? null : faltaGanancia === 0 ? 0 : margenSobreVenta && margenSobreVenta > 0 ? r2(faltaGanancia / margenSobreVenta) : null;
  const ritmo = e.diasDelMes > 0 ? Math.min(1, Math.max(e.diaDelMes, 1) / e.diasDelMes) : 1;
  const gananciaProyectada = ganancia > 0 ? r2(ganancia / ritmo) : null;
  return {
    ventaNeta: r2(ventaNeta), ventaSinCosto: r2(ventaSinCosto), ganancia: r2(ganancia), margenSobreVenta,
    fijosARS: r2(fijosARS), fijosUSD: r2(fijosUSD), fijosTotal, coberturaPct, faltaGanancia, faltaVender, gananciaProyectada,
    prSinCosto, prSinTC,
  };
}
