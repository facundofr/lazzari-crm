/**
 * Cálculos del Plan de pagos a proveedores.
 *
 * Retención de Ganancias (RG 830), igual que en la Orden de pago:
 *  1. Se acumulan las bases sin IVA pagadas al proveedor en el mes (pagos anteriores + este).
 *  2. Si el acumulado no llega al mínimo no imponible (según el concepto del proveedor), no se retiene.
 *  3. Retención = (acumulado − mínimo) × alícuota − lo ya retenido en el mes (honorarios: por escala).
 *  4. Si el resultado es menor al importe mínimo de retención (art. 29), no se retiene.
 * Como el plan junta todas las facturas del proveedor, el mínimo y la escala se aplican una sola vez.
 */
import { isResponsableInscripto } from "@/lib/fiscal-condition";
import { importeRetencionOP, minimoDelConcepto, propuestaRetencionOP, proveedorExcluido, type ProveedorFiscal } from "@/lib/retencion-conceptos";

export { proveedorExcluido, type ProveedorFiscal };

export const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface RetencionConfig {
  aplica_ganancias: boolean;
  minimo_ganancias: number;
  tasa_ganancias_ri: number;
  minimo_retencion_ganancias: number;
}

export const RETENCION_DEFAULT: RetencionConfig = {
  aplica_ganancias: true,
  minimo_ganancias: 224000,
  tasa_ganancias_ri: 2,
  minimo_retencion_ganancias: 240,
};


/** ¿El comprobante no discrimina IVA? (factura C, o proveedor monotributista / exento). */
export function sinIVA(tipoComprobante: string, condicionIva?: string | null): boolean {
  return /\bC\b|\sC$/i.test(String(tipoComprobante || "")) || /monotrib|exento/i.test(String(condicionIva || ""));
}

/** Parte sin IVA (y sin percepciones) de un importe pagado de una factura. */
export function baseSinIVADe(monto: number, f: { subtotal: number; total: number; tipo_comprobante: string }, condicionIva?: string | null): number {
  if (!(f.total > 0)) return 0;
  const ratio = sinIVA(f.tipo_comprobante, condicionIva) ? 1 : f.subtotal > 0 ? Math.min(1, f.subtotal / f.total) : 1;
  return r2(monto * ratio);
}


export interface ResultadoRetencion {
  aplica: boolean;
  pct: number;
  base: number;          // base sin IVA de este pago
  retencion: number;     // importe a retener
  motivo: string;        // explicación corta para mostrar
}

/** La misma cuenta que la Orden de pago (lib/retencion-conceptos: propuestaRetencionOP + importeRetencionOP), con el motivo. */
export function calcularRetencionGanancias(opts: {
  proveedor: ProveedorFiscal;
  config: RetencionConfig;
  fecha: string;
  baseEstePago: number;
  baseMesPrevia: number;
  retenidoMes: number;
}): ResultadoRetencion {
  const { proveedor, config, fecha, baseEstePago, baseMesPrevia, retenidoMes } = opts;
  const base = r2(Math.max(0, baseEstePago));
  if (!config.aplica_ganancias) return { aplica: false, pct: 0, base, retencion: 0, motivo: "La sociedad no retiene Ganancias" };
  if (proveedorExcluido(proveedor, fecha)) return { aplica: false, pct: 0, base, retencion: 0, motivo: "Proveedor con certificado de exclusión vigente" };
  if (!isResponsableInscripto(proveedor.condicion_iva)) return { aplica: false, pct: 0, base, retencion: 0, motivo: "No es Responsable Inscripto" };
  const p = propuestaRetencionOP({ proveedor, condicionIva: proveedor.condicion_iva, aplicaSociedad: true, minimoBienes: config.minimo_ganancias,
    tasaGlobal: config.tasa_ganancias_ri, fecha, basePrevia: baseMesPrevia, baseEstaOP: base });
  if (!p.aplica) return { aplica: false, pct: 0, base, retencion: 0, motivo: "No supera el mínimo no imponible del mes" };
  const r = importeRetencionOP({ aplica: true, pct: p.pct, minimo: minimoDelConcepto(proveedor.concepto_retencion_ganancias, config.minimo_ganancias),
    basePrevia: baseMesPrevia, baseEstaOP: base, retenidoMes, minimoRetencion: config.minimo_retencion_ganancias });
  if (!r.retencion) return { aplica: true, pct: p.pct, base, retencion: 0, motivo: "La retención no llega al importe mínimo (art. 29)" };
  const escala = (proveedor.concepto_retencion_ganancias || "").trim() === "honorarios";
  return { aplica: true, pct: p.pct, base, retencion: r.retencion, motivo: escala ? "Escala de honorarios sobre el acumulado del mes menos lo ya retenido" : `${p.pct} % sobre el acumulado del mes menos lo ya retenido` };
}

/** Reparte las NC entre las facturas, en orden. Devuelve [{nc_id, factura_compra_id, monto}]. */
export function repartirNC(
  facturas: Array<{ id: string; monto: number }>,
  ncs: Array<{ id: string; monto: number }>,
): Array<{ nc_id: string; factura_compra_id: string; monto: number }> {
  const out: Array<{ nc_id: string; factura_compra_id: string; monto: number }> = [];
  const resto = facturas.map(f => ({ id: f.id, resto: r2(f.monto) }));
  for (const nc of ncs) {
    let disponible = r2(nc.monto);
    for (const f of resto) {
      if (disponible <= 0.004) break;
      const usar = r2(Math.min(disponible, f.resto));
      if (usar <= 0.004) continue;
      out.push({ nc_id: nc.id, factura_compra_id: f.id, monto: usar });
      f.resto = r2(f.resto - usar);
      disponible = r2(disponible - usar);
    }
  }
  return out;
}

/** Similitud simple de nombres para emparejar un comprobante con el proveedor (0 a 1). */
export function similitudNombre(a: string, b: string): number {
  const norm = (t: string) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|sa|srl|sas|sociedad|anonima)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w.length > 2);
  const ta = new Set(norm(a)), tb = new Set(norm(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}
