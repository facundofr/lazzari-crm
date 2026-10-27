/**
 * Retención de Ganancias de un pago ya hecho: el certificado de la OP (auditoría UX 26/10/2026, arreglo 12) y el
 * control antes de bajar el TXT SICORE (arreglo 13).
 *
 * Desde la mejora H (27/10/2026) la OP (o el pago directo) anota con qué se calculó la retención: el régimen, el mínimo,
 * los pagos anteriores del mes y lo retenido antes (columnas retencion_ganancias_*). Con eso el certificado y el TXT
 * no cambian si después se edita el proveedor. Las que no lo anotaron (de antes, o si falló la anotación) se rearman
 * con la misma cuenta que hace la OP (components/orden-pago-nueva.tsx):
 *   acumulado del mes = pagos anteriores del mes al proveedor (sin IVA) + neto sin IVA de este pago
 *   retención = (acumulado − mínimo) × % − lo retenido antes en el mes
 * Sin anotar, el régimen sale del concepto que el proveedor tiene HOY, igual que en el TXT (api/sicore). Si con el
 * mínimo de ese concepto la cuenta no da lo retenido, se prueba con el de los otros conceptos (el proveedor cambió de
 * concepto después de la OP, caso OP-000049); si tampoco da (por ejemplo, un importe escrito a mano), no hay cuenta.
 */
import { REGIMEN_NOMBRE, REGIMEN_RG830, regimenSicore } from "@/lib/sicore-linea";
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

/** Lo que la OP anotó al guardarse (mejora H): con qué régimen, mínimo y pagos del mes calculó la retención. */
export interface RetencionCongelada {
  regimen: string;       // código SICORE, ej. "078"
  minimo: number;        // mínimo no sujeto a retención que usó
  basePrevia: number;    // pagos anteriores del mes, sin IVA
  retenidoAntes: number; // retenido antes en el mes
}

/** Las columnas que anota la OP (o el pago directo) al guardarse con retención: el concepto del proveedor en ese momento. */
export function columnasRetencionCongelada(c: { concepto?: string | null; minimo: number; basePrevia: number; retenidoAntes: number }) {
  return {
    retencion_ganancias_regimen: regimenSicore(String(c.concepto || "").trim() || null),
    retencion_ganancias_minimo: r2(c.minimo),
    retencion_ganancias_base_previa: r2(c.basePrevia),
    retencion_ganancias_retenido_antes: r2(c.retenidoAntes),
  };
}

/** Lo anotado en una fila de ordenes_pago o movimientos; null si no se anotó (de antes de la mejora H o incompleto). */
export function retencionCongelada(fila: {
  retencion_ganancias_regimen?: string | null; retencion_ganancias_minimo?: number | string | null;
  retencion_ganancias_base_previa?: number | string | null; retencion_ganancias_retenido_antes?: number | string | null;
} | null | undefined): RetencionCongelada | null {
  const regimen = String(fila?.retencion_ganancias_regimen || "").trim();
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const minimo = num(fila?.retencion_ganancias_minimo), basePrevia = num(fila?.retencion_ganancias_base_previa);
  const retenidoAntes = num(fila?.retencion_ganancias_retenido_antes);
  if (!regimen || ![minimo, basePrevia, retenidoAntes].every(Number.isFinite)) return null;
  return { regimen, minimo, basePrevia, retenidoAntes };
}

export interface DetalleRetencion {
  regimen: string;          // código SICORE con que se calculó, ej. "078" (el que manda el TXT): el anotado o, sin anotar, el de hoy
  regimenNombre: string;
  regimenHoy: string;       // código del concepto que el proveedor tiene hoy
  congelada: boolean;       // la OP anotó cómo se calculó (mejora H)
  sinConcepto: boolean;     // el proveedor no tiene concepto hoy: va como bienes
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
  /** Pagos anteriores del mes rearmados (pagosAnteriores); con `congelada` no hacen falta. */
  anteriores?: { base: number; retenido: number };
  /** Lo que anotó la OP (mejora H): manda sobre el concepto de hoy. */
  congelada?: RetencionCongelada | null;
}): DetalleRetencion {
  const concepto = String(o.concepto || "").trim() || null;
  const c = o.congelada || null;
  const regimenHoy = regimenSicore(concepto);
  const regimen = c ? c.regimen : regimenHoy;
  const reglaHoy = reglaPorConcepto(concepto, o.minimoBienes);
  const minimoHoy = reglaHoy ? reglaHoy.minimo : o.minimoBienes;
  const base = r2(o.base);
  const basePrevia = r2(c ? c.basePrevia : o.anteriores?.base ?? 0), retenidoAntes = r2(c ? c.retenidoAntes : o.anteriores?.retenido ?? 0);
  const acumulado = r2(basePrevia + base);
  const pct = Number(o.pct) || 0;
  const retenido = r2(o.retenido);
  const retencionCon = (minimo: number) => r2(Math.max(0, Math.max(0, acumulado - minimo) * (pct / 100) - retenidoAntes));
  // Anotada: el mínimo que usó la OP (si con él no da lo retenido, el importe se escribió a mano). Sin anotar: el de hoy o el de otro concepto.
  const minimo = (c ? [c.minimo] : [minimoHoy, o.minimoBienes, MINIMO_SERVICIOS]).find((m) => Math.abs(retencionCon(m) - retenido) <= 0.05) ?? null;
  const sujeto = minimo === null ? null : r2(Math.max(0, acumulado - minimo));
  const pctHoy = pctRetencion(reglaHoy, Math.max(0, acumulado - minimoHoy), o.alicuotaProveedor, o.tasaSociedad);
  const pctEscala = (m: number) => pctRetencion({ minimo: m, pct: null }, Math.max(0, acumulado - m), null, 0);
  return {
    regimen, regimenNombre: REGIMEN_NOMBRE[regimen] || "", regimenHoy, congelada: !!c, sinConcepto: !concepto,
    bruto: r2(o.bruto), base, basePrevia, acumulado, pct,
    escala: c
      ? c.regimen === REGIMEN_RG830.honorarios && Math.abs(pct - pctEscala(c.minimo)) <= 0.005
      : reglaHoy !== null && reglaHoy.pct === null && Math.abs(pct - pctHoy) <= 0.005,
    retenidoAntes, retenido, minimo, sujeto, retencionAcumulada: sujeto === null ? null : r2(sujeto * (pct / 100)),
    minimoHoy, pctHoy,
  };
}

/** Control antes de bajar el TXT SICORE: lo arma api/sicore (formato=json) y lo muestra Finanzas Lazza → Retenciones. */
export interface AvisosSicore {
  /** Proveedores sin concepto de Ganancias hoy: sus retenciones se calcularon como bienes (régimen 78). */
  sinConcepto: { proveedor: string; retenciones: number; retenido: number }[];
  /**
   * Retenciones calculadas con otro régimen, % o mínimo que el del concepto de hoy. Las anotadas (congelada) van al TXT
   * como se calcularon; las de antes de la mejora H, con el régimen de hoy.
   */
  distintos: {
    comprobante: string; fecha: string; proveedor: string; regimen: string; regimenHoy: string; congelada: boolean;
    pct: number; pctHoy: number; minimo: number | null; minimoHoy: number; difPct: boolean; difMinimo: boolean; difRegimen: boolean;
  }[];
}

/** Qué no coincide entre cómo se calculó la retención y el concepto que el proveedor tiene hoy. */
export function diferenciasConHoy(d: DetalleRetencion): { pct: boolean; minimo: boolean; regimen: boolean } {
  return {
    pct: Math.abs(d.pct - d.pctHoy) > 0.005,
    minimo: d.minimo !== null && Math.abs(d.minimo - d.minimoHoy) > 0.5,
    regimen: d.regimen !== d.regimenHoy,
  };
}
