/**
 * Reparte una orden de pago de un cliente (leída por IA) entre las facturas.
 *
 * Una OP puede pagar varias facturas (en pesos y en dólares) con un solo depósito
 * y retenciones que no siempre vienen separadas por factura. Este módulo calcula,
 * para las facturas que se están cobrando en un formulario, qué parte del depósito
 * y de cada retención les corresponde, y deja informado lo que pertenece a otras
 * facturas para cargarlo aparte. No guarda nada: solo arma una propuesta que el
 * usuario revisa antes de confirmar.
 */

export interface OpFacturaPagada {
  tipo?: string | null;
  punto_venta?: number | string | null;
  numero?: number | string | null;
  comprobante?: string | null;
  importe_pagado?: number | string | null;
}

export interface OpPago {
  tipo?: string | null;
  monto?: number | string | null;
  fecha?: string | null;
  fecha_cobro?: string | null;
  referencia?: string | null;
  banco?: string | null;
  certificado?: string | null;
  organismo?: string | null;
  detalle?: Array<{ punto_venta?: number | string | null; numero?: number | string | null; comprobante?: string | null; importe?: number | string | null }> | null;
}

export interface OpParsed {
  orden_pago_cliente?: string | null;
  fecha_orden?: string | null;
  pagador?: { razon_social?: string | null; cuit?: string | null } | null;
  facturas_pagadas?: OpFacturaPagada[] | null;
  pagos?: OpPago[] | null;
}

/** Factura abierta en el formulario. `numero` formateado, ej. "FA 0015-00000007". */
export interface PlanDoc { id: string; numero: string }

export interface PlanMedio { tipo: string; monto: number; fecha: string; referencia: string; banco: string }
export interface PlanRetencion { tipo: string; monto: number; certificado: string; organismo: string }

export interface OrdenPagoPlan {
  referencia: string;
  fecha: string | null;
  pagadorCuit: string;
  /** Facturas del formulario que la OP paga, con el importe en pesos que cancela cada una. */
  incluidas: Array<{ docId: string; comprobante: string; importe: number; retenciones: number }>;
  /** Facturas de la OP que no están en el formulario (se cobran aparte). */
  otras: Array<{ comprobante: string; importe: number; retenciones: PlanRetencion[]; medios: number }>;
  /** Medios y retenciones que corresponden SOLO a las facturas del formulario. */
  medios: PlanMedio[];
  retenciones: PlanRetencion[];
  avisos: string[];
}

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const n = Number(value.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Clave "pv-numero" a partir de lo que devuelva la IA o del número formateado del sistema. */
export function comprobanteKey(pv: unknown, numero: unknown, texto?: unknown): string | null {
  const p = Number(pv), n = Number(numero);
  if (Number.isInteger(p) && Number.isInteger(n) && p > 0 && n > 0) return `${p}-${n}`;
  const t = typeof texto === "string" ? texto : "";
  const grupos = t.match(/\d+/g) || [];
  if (grupos.length >= 2) {
    const a = Number(grupos[grupos.length - 2]), b = Number(grupos[grupos.length - 1]);
    if (a > 0 && b > 0) return `${a}-${b}`;
  }
  if (grupos.length === 1 && grupos[0].length >= 9) {
    const d = grupos[0];
    const a = Number(d.slice(0, d.length - 8)), b = Number(d.slice(-8));
    if (a > 0 && b > 0) return `${a}-${b}`;
  }
  return null;
}

/** Reparte `total` (en centavos) en proporción a `pesos`; el último absorbe el redondeo. */
function prorratear(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((s, p) => s + p, 0);
  if (!suma) return pesos.map(() => 0);
  const out: number[] = [];
  let asignado = 0;
  pesos.forEach((p, i) => {
    const parte = i === pesos.length - 1 ? total - asignado : Math.round((total * p) / suma);
    out.push(parte);
    asignado += parte;
  });
  return out;
}

const esRetencion = (tipo: string) => tipo.startsWith("retencion_") || tipo.startsWith("percepcion_");

export function buildOrdenPagoPlan(parsed: OpParsed, docs: PlanDoc[]): OrdenPagoPlan {
  const avisos: string[] = [];
  const pagos = (parsed.pagos || []).filter(p => toNumber(p.monto) > 0);
  const retencionesOp = pagos.filter(p => esRetencion(String(p.tipo || "").toLowerCase()));
  const mediosOp = pagos.filter(p => !esRetencion(String(p.tipo || "").toLowerCase()));

  const docPorClave = new Map<string, PlanDoc>();
  for (const d of docs) {
    const k = comprobanteKey(null, null, d.numero);
    if (k) docPorClave.set(k, d);
  }

  // Facturas de la OP con su importe (las NC restan).
  type Linea = { clave: string; comprobante: string; importeC: number; doc: PlanDoc | null };
  const lineas: Linea[] = [];
  for (const f of parsed.facturas_pagadas || []) {
    const clave = comprobanteKey(f.punto_venta, f.numero, f.comprobante);
    const importe = toNumber(f.importe_pagado);
    if (!clave || !importe) continue;
    const signo = String(f.tipo || "").toUpperCase().startsWith("NC") ? -1 : 1;
    const [pv, num] = clave.split("-").map(Number);
    const comprobante = `${f.tipo ? `${String(f.tipo).toUpperCase()} ` : ""}${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
    lineas.push({ clave, comprobante, importeC: signo * cents(Math.abs(importe)), doc: docPorClave.get(clave) || null });
  }

  const referencia = String(parsed.orden_pago_cliente || "");
  const fecha = (mediosOp.find(m => m.fecha_cobro || m.fecha)?.fecha_cobro || mediosOp.find(m => m.fecha)?.fecha || parsed.fecha_orden || null) as string | null;
  const pagadorCuit = String(parsed.pagador?.cuit || "").replace(/\D/g, "");

  const mapMedio = (m: OpPago, montoC: number): PlanMedio => ({
    tipo: String(m.tipo || "transferencia").toLowerCase(),
    monto: fromCents(montoC),
    fecha: String(m.fecha_cobro || m.fecha || fecha || ""),
    referencia: String(m.referencia || referencia || ""),
    banco: String(m.banco || ""),
  });
  const mapRet = (r: OpPago, montoC: number): PlanRetencion => ({
    tipo: String(r.tipo || "").toLowerCase(),
    monto: fromCents(montoC),
    certificado: String(r.certificado || r.referencia || ""),
    organismo: String(r.organismo || ""),
  });

  // Sin detalle de facturas: se asume que toda la OP es para las facturas del formulario.
  if (!lineas.length) {
    avisos.push("La IA no encontró el detalle de facturas pagadas: se cargó la orden completa. Revisá que corresponda solo a estas facturas.");
    return {
      referencia, fecha, pagadorCuit, incluidas: [], otras: [],
      medios: mediosOp.map(m => mapMedio(m, cents(toNumber(m.monto)))),
      retenciones: retencionesOp.map(r => mapRet(r, cents(toNumber(r.monto)))),
      avisos,
    };
  }

  // Retenciones por factura: detalle explícito o, si no hay, proporcional al importe pagado.
  const retPorLinea: number[][] = lineas.map(() => retencionesOp.map(() => 0));
  retencionesOp.forEach((r, j) => {
    const totalC = cents(toNumber(r.monto));
    const detalle = (r.detalle || [])
      .map(d => ({ clave: comprobanteKey(d.punto_venta, d.numero, d.comprobante), importeC: cents(toNumber(d.importe)) }))
      .filter(d => d.clave && d.importeC > 0);
    const asignables = detalle.filter(d => lineas.some(l => l.clave === d.clave));
    const sumaDetalle = asignables.reduce((s, d) => s + d.importeC, 0);
    if (asignables.length && Math.abs(sumaDetalle - totalC) <= 100) {
      asignables.forEach(d => { const i = lineas.findIndex(l => l.clave === d.clave); retPorLinea[i][j] += d.importeC; });
      // Diferencia de centavos: a la factura de mayor importe dentro del detalle.
      const dif = totalC - sumaDetalle;
      if (dif) { const i = lineas.findIndex(l => l.clave === asignables[0].clave); retPorLinea[i][j] += dif; }
    } else {
      if (detalle.length) avisos.push(`El detalle por factura de la retención ${r.certificado || ""} no suma su total: se repartió en proporción a lo pagado.`);
      const partes = prorratear(totalC, lineas.map(l => Math.max(0, l.importeC)));
      partes.forEach((p, i) => { retPorLinea[i][j] += p; });
      if (lineas.length > 1) avisos.push(`La retención ${r.tipo === "retencion_ganancias" ? "de Ganancias" : ""} ${r.certificado || ""} no viene separada por factura: se repartió en proporción a lo pagado. Si el certificado trae el detalle, corregilo.`.replace(/\s+/g, " "));
    }
  });

  // Medios: primero cubren lo neto de las facturas del formulario; el resto queda para las otras.
  const netoLinea = lineas.map((l, i) => l.importeC - retPorLinea[i].reduce((s, x) => s + x, 0));
  const netoIncluidas = lineas.reduce((s, l, i) => s + (l.doc ? netoLinea[i] : 0), 0);
  const totalMediosC = mediosOp.reduce((s, m) => s + cents(toNumber(m.monto)), 0);
  const totalNetoC = netoLinea.reduce((s, n) => s + n, 0);
  if (Math.abs(totalMediosC - totalNetoC) > 100) {
    avisos.push(`La orden no cierra: facturas − retenciones = $${fromCents(totalNetoC).toFixed(2)}, pero los pagos suman $${fromCents(totalMediosC).toFixed(2)}. Revisá los importes.`);
  }

  const medios: PlanMedio[] = [];
  let pendiente = Math.max(0, netoIncluidas);
  for (const m of mediosOp) {
    if (pendiente <= 0) break;
    const montoC = cents(toNumber(m.monto));
    const usar = Math.min(montoC, pendiente);
    medios.push(mapMedio(m, usar));
    pendiente -= usar;
  }

  const retenciones: PlanRetencion[] = retencionesOp
    .map((r, j) => mapRet(r, lineas.reduce((s, l, i) => s + (l.doc ? retPorLinea[i][j] : 0), 0)))
    .filter(r => r.monto > 0);

  const incluidas = lineas.flatMap((l, i) => l.doc ? [{
    docId: l.doc.id, comprobante: l.doc.numero, importe: fromCents(l.importeC),
    retenciones: fromCents(retPorLinea[i].reduce((s, x) => s + x, 0)),
  }] : []);
  const otras = lineas.flatMap((l, i) => l.doc ? [] : [{
    comprobante: l.comprobante, importe: fromCents(l.importeC),
    retenciones: retencionesOp.map((r, j) => mapRet(r, retPorLinea[i][j])).filter(r => r.monto > 0),
    medios: fromCents(netoLinea[i]),
  }]);

  if (!incluidas.length) avisos.push("Ninguna de las facturas de este formulario figura en la orden de pago.");
  return { referencia, fecha, pagadorCuit, incluidas, otras, medios, retenciones, avisos };
}
