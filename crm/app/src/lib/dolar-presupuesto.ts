// Dólar para presupuestos (Augusto 13/10): el sistema guarda el BNA todos los días (cron) y las pantallas leen
// lo guardado, nunca esperan al BNA. Los presupuestos usan el cierre del día hábil anterior.
// Costo en "USD" = dólar billete; costo en "USD Divisa" (o "USD divisa" en la lista) = dólar divisa.
import { diaHabilAnterior } from "@/lib/dias-habiles";
import { isTrustedBnaCache } from "@/lib/bna-historical";

export type DolarGuardado = { valor: number; fecha: string; manual: boolean };
export type DolaresGuardados = { billete: DolarGuardado | null; divisa: DolarGuardado | null; fechaBuscada: string };

export const hoyAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" });

/** Fecha del dólar para presupuestar: cierre del día hábil anterior (feriados incluidos). */
export function fechaDolarPresupuesto(hoy: string = hoyAR()): string {
  return diaHabilAnterior(hoy);
}

export function esCostoUsd(moneda: string | null | undefined): boolean {
  return String(moneda || "").toUpperCase().startsWith("USD");
}

export function esCostoDivisa(moneda: string | null | undefined): boolean {
  return esCostoUsd(moneda) && String(moneda).toLowerCase().includes("divisa");
}

/** TC que corresponde a un costo en dólares: divisa → divisa (si no hay, billete); billete → billete (si no hay, divisa). */
export function tcParaCosto(costoMoneda: string, tcBillete: number, tcDivisa: number): number {
  const b = tcBillete > 0 ? tcBillete : 0;
  const d = tcDivisa > 0 ? tcDivisa : 0;
  return esCostoDivisa(costoMoneda) ? (d || b) : (b || d);
}

/** Convierte el costo de un artículo a la moneda del presupuesto. Sin TC devuelve el costo sin convertir. */
export function convertirCostoPR(costo: number, costoMoneda: string, prMoneda: string, tc: number, tcDivisas = 0): number {
  const usd = esCostoUsd(costoMoneda);
  if (usd && prMoneda === "ARS") {
    const t = tcParaCosto(costoMoneda, tc, tcDivisas);
    return t > 0 ? costo * t : costo;
  }
  if (!usd && prMoneda === "USD") {
    const t = tc > 0 ? tc : tcDivisas;
    return t > 0 ? costo / t : costo;
  }
  return costo;
}

/** De las filas guardadas (más nuevas primero) toma la última confiable (BNA verificado o cargada a mano) de cada tipo. */
export function elegirDolares(
  filas: Array<{ fecha: string; tipo: string; valor_venta: number | string; fuente?: string; es_manual?: boolean }>,
  fechaBuscada: string,
): DolaresGuardados {
  const tomar = (tipo: string): DolarGuardado | null => {
    const f = filas
      .filter((r) => r.tipo === tipo && String(r.fecha).slice(0, 10) <= fechaBuscada && isTrustedBnaCache(r) && Number(r.valor_venta) > 0)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
    return f ? { valor: Number(f.valor_venta), fecha: String(f.fecha).slice(0, 10), manual: !!f.es_manual } : null;
  };
  return { billete: tomar("oficial_billetes"), divisa: tomar("oficial_divisas"), fechaBuscada };
}

/** true si falta el dólar o es más viejo que el que corresponde (hay que avisar y dejar cargarlo a mano). */
export function dolarAtrasado(d: DolarGuardado | null, fechaBuscada: string): boolean {
  return !d || d.fecha < fechaBuscada;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "billete $ 1.535 · cierre 09/10" */
export function etiquetaDolar(tipo: "billete" | "divisa", d: DolarGuardado | null): string {
  if (!d) return `${tipo}: sin cotización`;
  return `${tipo} $ ${d.valor.toLocaleString("es-AR", { maximumFractionDigits: 2 })} · cierre ${ddmm(d.fecha)}${d.manual ? " (a mano)" : ""}`;
}

// Se lee una sola vez por fecha mientras la pantalla está abierta.
const cache = new Map<string, Promise<DolaresGuardados>>();

export function leerDolaresGuardados(db: any, fecha: string = fechaDolarPresupuesto()): Promise<DolaresGuardados> {
  const previo = cache.get(fecha);
  if (previo) return previo;
  const p = (async () => {
    const { data, error } = await db
      .from("cotizaciones_dolar")
      .select("fecha, tipo, valor_venta, fuente, es_manual")
      .in("tipo", ["oficial_billetes", "oficial_divisas"])
      .lte("fecha", fecha)
      .order("fecha", { ascending: false })
      .limit(30);
    if (error) throw error;
    return elegirDolares(data || [], fecha);
  })();
  cache.set(fecha, p);
  p.catch(() => cache.delete(fecha));
  return p;
}

export function olvidarDolaresGuardados() {
  cache.clear();
}
