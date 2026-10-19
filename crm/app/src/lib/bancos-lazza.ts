// Finanzas Lazza → Bancos (Tanda 3, 19/10/2026): cuentas con saldo según el banco, tarjetas por resumen y préstamos
// en dos partes ("Lo que debo" / "Lo que me deben"). Prueba: npx tsx scripts/test-bancos-lazza.ts

export interface CuotaPrestamo { numero: number; fecha_pago: string; total: number | string; estado: string; pagada_fecha?: string | null; notas?: string | null }

export interface ResumenPrestamo {
  /** Con tabla de cuotas (BNA) o sin cuotas fijas (familia: cada pago se anota como cuota pagada). */
  conCuotas: boolean;
  capital: number;
  pagado: number;
  falta: number;
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
  const conCuotas = pendientes.length > 0;
  const falta = conCuotas ? r2(pendientes.reduce((s, c) => s + Number(c.total || 0), 0)) : r2(Math.max(0, capital - pagado));
  return {
    conCuotas, capital, pagado, falta,
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
