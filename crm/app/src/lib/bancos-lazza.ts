// Finanzas Lazza → Bancos (Tanda 3, 19/10/2026): cuentas con saldo según el banco, tarjetas por resumen y préstamos
// en dos partes ("Lo que debo" / "Lo que me deben"). Prueba: npx tsx scripts/test-bancos-lazza.ts

export interface CuotaPrestamo { numero: number; fecha_pago: string; total: number | string; estado: string; pagada_fecha?: string | null; notas?: string | null; capital?: number | string | null; interes?: number | string | null; cargos?: number | string | null }

export interface ResumenPrestamo {
  /** Con tabla de cuotas (BNA) o sin cuotas fijas (familia: cada pago se anota como cuota pagada). */
  conCuotas: boolean;
  capital: number;
  pagado: number;
  falta: number;
  /** Capital de las cuotas que faltan (BNA: el total de la cuota trae intereses y cargos). 0 si las cuotas no lo dicen. */
  capitalFalta: number;
  cuotasPagadas: number;
  cuotasTotal: number;
  vencidas: number;
  proxima: { fecha: string; monto: number } | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Con cuotas: pagado = suma de cuotas pagadas, falta = suma de las pendientes (cuota total con intereses).
 * Sin cuotas (todas las "cuotas" son pagos anotados): falta = capital − pagado.
 */
export function resumenPrestamo(p: { capital_total?: number | string | null }, cuotas: CuotaPrestamo[], hoy: string): ResumenPrestamo {
  const capital = Number(p.capital_total || 0);
  const pagadas = cuotas.filter((c) => c.estado === "pagada");
  const pendientes = cuotas.filter((c) => c.estado !== "pagada").sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
  const pagado = r2(pagadas.reduce((s, c) => s + Number(c.total || 0), 0));
  // Tabla del banco: alguna cuota pendiente o con capital cargado (así un BNA con todo pagado no pasa a "sin cuotas").
  const conCuotas = pendientes.length > 0 || cuotas.some((c) => c.capital !== null && c.capital !== undefined);
  const falta = conCuotas ? r2(pendientes.reduce((s, c) => s + Number(c.total || 0), 0)) : r2(Math.max(0, capital - pagado));
  return {
    conCuotas, capital, pagado, falta,
    capitalFalta: r2(pendientes.reduce((s, c) => s + Number(c.capital || 0), 0)),
    cuotasPagadas: pagadas.length, cuotasTotal: cuotas.length,
    vencidas: pendientes.filter((c) => c.fecha_pago.slice(0, 10) < hoy).length,
    proxima: pendientes[0] ? { fecha: pendientes[0].fecha_pago.slice(0, 10), monto: Number(pendientes[0].total || 0) } : null,
  };
}

/** Días desde el último saldo según el banco (para avisar si quedó viejo: más de 3 días). */
export function diasDesde(fecha: string | null | undefined, hoy: string): number | null {
  if (!fecha) return null;
  return Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${String(fecha).slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

export interface PesosCuenta { debe: number | null; vence: string | null; aPagar: number | null }

const numAR = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/**
 * BAVSA (cuenta en US$): lo que se debe en pesos y el vencimiento de la caución salen de las observaciones,
 * que se cargan con el resumen ("En pesos DEBE $ 8.305.981,90 … VENCE 22/10/2026, a pagar $ 8.339.143,35").
 * Sin esos datos devuelve null (la tarjeta sigue diciendo "en $: a definir").
 */
export function pesosDeObservaciones(obs: string | null | undefined): PesosCuenta | null {
  const t = String(obs || "");
  const debe = t.match(/en pesos debe \$\s*([\d.]+,\d{2})/i);
  const vence = t.match(/vence (\d{2})\/(\d{2})\/(\d{4})/i);
  const aPagar = t.match(/a pagar \$\s*([\d.]+,\d{2})/i);
  if (!debe && !vence) return null;
  return {
    debe: debe ? numAR(debe[1]) : null,
    vence: vence ? `${vence[3]}-${vence[2]}-${vence[1]}` : null,
    aPagar: aPagar ? numAR(aPagar[1]) : null,
  };
}
