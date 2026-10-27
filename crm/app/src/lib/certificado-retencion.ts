/**
 * Retención de Ganancias de un pago ya hecho: el certificado de la OP (auditoría UX 26/10/2026, arreglo 12) y el
 * control antes de bajar el TXT SICORE (arreglo 13).
 *
 * La OP guarda el bruto, el neto sin IVA (base), el % y lo retenido, pero no el concepto ni el mínimo con que se
 * calculó (guardarlos es la mejora H). Acá se rearma la misma cuenta que hace la OP (components/orden-pago-nueva.tsx):
 *   acumulado del mes = pagos anteriores del mes al proveedor (sin IVA) + neto sin IVA de este pago
 *   retención = (acumulado − mínimo) × % − lo retenido antes en el mes
 * El régimen sale del concepto que el proveedor tiene HOY, igual que en el TXT (api/sicore). Si con el mínimo de ese
 * concepto la cuenta no da lo retenido, se prueba con el de los otros conceptos (el proveedor cambió de concepto
 * después de la OP, caso OP-000049); si tampoco da (por ejemplo, un importe escrito a mano), no hay cuenta para mostrar.
 */
import { regimenSicore, REGIMEN_NOMBRE } from "@/lib/sicore-linea";
import { MINIMO_SERVICIOS, pctRetencion, reglaPorConcepto } from "@/lib/retencion-conceptos";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** "2 %", "0,25 %". */
export const pctTexto = (n: number) => `${r2(n).toLocaleString("es-AR")} %`;

/** Un pago al proveedor que suma al acumulado del mes: OP no anulada o pago directo de una factura. */
export interface PagoDelMes {
  id: string;
  proveedor_id: string;
  fecha: string;    // YYYY-MM-DD
  creado: string;   // created_at
  base: number;     // base_retencion_ganancias: sin IVA, en pesos
  retenido: number; // retencion_ganancias_monto
}

/**
 * Lo que la OP ya tenía en cuenta al hacerse: los pagos al mismo proveedor en el mismo mes cargados antes que ella
 * (la OP suma todo lo que había en el mes en ese momento, aunque tenga fecha posterior).
 */
export function pagosAnteriores(pago: PagoDelMes, todos: PagoDelMes[]): { base: number; retenido: number } {
  const creado = Date.parse(pago.creado);
  let base = 0, retenido = 0;
  for (const p of todos) {
    if (p.id === pago.id || p.proveedor_id !== pago.proveedor_id || p.fecha.slice(0, 7) !== pago.fecha.slice(0, 7)) continue;
    if (!(Date.parse(p.creado) < creado)) continue;
    base += Number(p.base) || 0;
    retenido += Number(p.retenido) || 0;
  }
  return { base: r2(base), retenido: r2(retenido) };
}

export interface DetalleRetencion {
  regimen: string;          // código SICORE del concepto de hoy, ej. "078" (el mismo que manda el TXT)
  regimenNombre: string;
  sinConcepto: boolean;     // el proveedor no tiene concepto: va como bienes
  bruto: number;            // importe pagado, con IVA
  base: number;             // neto sin IVA de este pago (la base que manda el TXT)
  basePrevia: number;       // pagos anteriores del mes, sin IVA
  acumulado: number;
  pct: number;              // el % con que se retuvo
  escala: boolean;          // honorarios: el % sale de la escala
  retenidoAntes: number;    // retenido antes en el mes
  retenido: number;         // retenido en este pago
  /** Mínimo con que la cuenta da lo retenido; null si no da con ninguno. */
  minimo: number | null;
  sujeto: number | null;              // acumulado − mínimo
  retencionAcumulada: number | null;  // sujeto × %
  minimoHoy: number;        // mínimo del concepto de hoy
  pctHoy: number;           // % que corresponde hoy: alícuota del proveedor, si no la del concepto, si no la de la sociedad
}

export function detalleRetencion(o: {
  concepto?: string | null;
  alicuotaProveedor?: number | null;
  minimoBienes: number;     // retencion_config.minimo_ganancias (hoy $ 224.000)
  tasaSociedad: number;     // retencion_config.tasa_ganancias_ri
  bruto: number;
  base: number;
  pct: number;
  retenido: number;
  anteriores: { base: number; retenido: number };
}): DetalleRetencion {
  const concepto = String(o.concepto || "").trim() || null;
  const regimen = regimenSicore(concepto);
  const reglaHoy = reglaPorConcepto(concepto, o.minimoBienes);
  const minimoHoy = reglaHoy ? reglaHoy.minimo : o.minimoBienes;
  const base = r2(o.base), basePrevia = r2(o.anteriores.base), retenidoAntes = r2(o.anteriores.retenido);
  const acumulado = r2(basePrevia + base);
  const pct = Number(o.pct) || 0;
  const retenido = r2(o.retenido);
  const retencionCon = (minimo: number) => r2(Math.max(0, Math.max(0, acumulado - minimo) * (pct / 100) - retenidoAntes));
  const minimo = [minimoHoy, o.minimoBienes, MINIMO_SERVICIOS].find((m) => Math.abs(retencionCon(m) - retenido) <= 0.05) ?? null;
  const sujeto = minimo === null ? null : r2(Math.max(0, acumulado - minimo));
  const pctHoy = pctRetencion(reglaHoy, Math.max(0, acumulado - minimoHoy), o.alicuotaProveedor, o.tasaSociedad);
  return {
    regimen, regimenNombre: REGIMEN_NOMBRE[regimen] || "", sinConcepto: !concepto,
    bruto: r2(o.bruto), base, basePrevia, acumulado, pct,
    escala: reglaHoy !== null && reglaHoy.pct === null && Math.abs(pct - pctHoy) <= 0.005,
    retenidoAntes, retenido, minimo, sujeto, retencionAcumulada: sujeto === null ? null : r2(sujeto * (pct / 100)),
    minimoHoy, pctHoy,
  };
}

/** Control antes de bajar el TXT SICORE: lo arma api/sicore (formato=json) y lo muestra Finanzas Lazza → Retenciones. */
export interface AvisosSicore {
  /** Proveedores sin concepto de Ganancias: van como régimen 78 (bienes). */
  sinConcepto: { proveedor: string; retenciones: number; retenido: number }[];
  /** Retenciones calculadas con un % o un mínimo distinto al del concepto de hoy (con el que las manda el TXT). */
  distintos: {
    comprobante: string; fecha: string; proveedor: string; regimen: string;
    pct: number; pctHoy: number; minimo: number | null; minimoHoy: number; difPct: boolean; difMinimo: boolean;
  }[];
}

/** Qué no coincide entre cómo se calculó la retención y el concepto que el proveedor tiene hoy (con el que va al TXT). */
export function diferenciasConHoy(d: DetalleRetencion): { pct: boolean; minimo: boolean } {
  return {
    pct: Math.abs(d.pct - d.pctHoy) > 0.005,
    minimo: d.minimo !== null && Math.abs(d.minimo - d.minimoHoy) > 0.5,
  };
}
