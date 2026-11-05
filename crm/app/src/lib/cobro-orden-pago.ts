// «Cobrar todas las facturas de esta orden de pago» (auditoría UX 27/10/2026, arreglo 11): la OP del cliente ya leída por la IA
// trae varias facturas; se buscan todas en el sistema y se arma el cobro en dos pasos: primero las de pesos y después las de dólares.
// Las ya cobradas o que no están se informan y no se tocan. Misma regla que Facturación (facturacion-content.tsx, iniciarCobroOrdenPago).
// Función pura. Prueba: scripts/test-cobro-orden-pago.ts
import { comprobanteKey, prorratear, toNumber, type OpParsed } from "./orden-pago-plan";
import { elegirFacturaDeOrdenPago, esNotaCredito } from "./ventas-documentos";
import type { FacturaACobrar } from "./finanzas-lazza";

export interface FilaFacturaOP {
  id: string;
  tipo?: string | null;
  punto_venta?: number | string | null;
  numero?: number | string | null;
  fecha: string;
  estado?: string | null;
  moneda?: string | null;
  subtotal?: number | null;
  iva?: number | null;
  total?: number | null;
  total_acreditado?: number | null;
  tipo_cambio?: number | null;
}

/** Factura en US$ lista para la liquidación en dólares (mismo formato que FxSettlementDocument). */
export interface DocUsdOP { id: string; numero: string; saldo: number; total: number; subtotal?: number; cotizacion?: number }

export interface FacturasDeOrdenPago {
  /** La IA no leyó el detalle de facturas de la OP. */
  sinDetalle: boolean;
  ars: FacturaACobrar[];
  usd: DocUsdOP[];
  /** Lo que no se pudo cobrar (no está en el sistema, ya cobrada): se muestra, nunca frena. */
  avisos: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const claveDe = (f: FilaFacturaOP) => `${Number(f.punto_venta)}-${Number(f.numero)}`;
const nombreDe = (f: FilaFacturaOP) => `${f.tipo || ""} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? "").padStart(8, "0")}`.trim();

/** Números de factura que figuran en la OP (sin las NC), para buscarlos en la base. */
export function numerosDeOrdenPago(parsed: OpParsed): number[] {
  const claves = clavesDe(parsed);
  return Array.from(new Set(claves.map((c) => Number(c.clave.split("-")[1]))));
}

function clavesDe(parsed: OpParsed) {
  return (parsed.facturas_pagadas || [])
    .filter((f) => !String(f.tipo || "").toUpperCase().startsWith("NC"))
    .map((f) => ({ clave: comprobanteKey(f.punto_venta, f.numero, f.comprobante), texto: f.comprobante || `${f.punto_venta}-${f.numero}`, tipo: f.tipo || null, comprobante: f.comprobante || null }))
    .filter((c): c is { clave: string; texto: string; tipo: string | null; comprobante: string | null } => !!c.clave);
}

/**
 * `filas`: facturas del cliente con esos números (cualquier estado). `cobrado`: lo ya cobrado por factura (id → monto).
 * Devuelve las facturas con saldo separadas por moneda y los avisos de lo que no se puede cobrar.
 */
export function facturasDeOrdenPago(parsed: OpParsed, filas: FilaFacturaOP[], cobrado: Record<string, number>): FacturasDeOrdenPago {
  const claves = clavesDe(parsed);
  if (!claves.length) return { sinDetalle: true, ars: [], usd: [], avisos: [] };
  // Solo facturas: una NC puede tener el mismo punto de venta y número que la factura.
  const candidatas = filas.filter((f) => f.estado !== "anulada" && !esNotaCredito(f.tipo) && claves.some((c) => c.clave === claveDe(f)));
  const ars: FacturaACobrar[] = [];
  const usd: DocUsdOP[] = [];
  const avisos: string[] = [];
  const vistas = new Set<string>();
  for (const c of claves) {
    const f = elegirFacturaDeOrdenPago(candidatas.filter((x) => claveDe(x) === c.clave), c.tipo, c.comprobante);
    if (!f) { avisos.push(`${c.texto}: no está en el sistema para este cliente (o está anulada). Revisala.`); continue; }
    if (vistas.has(f.id)) continue; // la OP la nombra dos veces: se cobra una sola
    vistas.add(f.id);
    const numero = nombreDe(f);
    const saldo = r2(Number(f.total || 0) - Number(f.total_acreditado || 0) - (cobrado[f.id] || 0));
    if (saldo <= 0.01) { avisos.push(`${numero}: ya figura cobrada, no se vuelve a cobrar.`); continue; }
    if (String(f.moneda || "ARS").toUpperCase() === "USD") {
      usd.push({ id: f.id, numero, saldo, total: Number(f.total || 0), subtotal: Number(f.subtotal || 0), cotizacion: Number(f.tipo_cambio) || undefined });
    } else {
      ars.push({ id: f.id, numero, fecha: String(f.fecha).slice(0, 10), subtotal: Number(f.subtotal || 0), iva: Number(f.iva || 0), total: Number(f.total || 0), total_acreditado: Number(f.total_acreditado || 0), saldo, moneda: "ARS" });
    }
  }
  return { sinDetalle: false, ars, usd, avisos };
}

/** Avisos del paso a paso: con pesos y dólares son 2 pasos; con uno solo no hay paso. */
export function avisosDePaso(r: Pick<FacturasDeOrdenPago, "ars" | "usd" | "avisos">, paso: "ars" | "usd"): string[] {
  const pasos = (r.ars.length ? 1 : 0) + (r.usd.length ? 1 : 0);
  const lineas = pasos === 2 ? [paso === "ars" ? "Paso 1 de 2: facturas en pesos. Al confirmar se abre el cobro de las facturas en dólares." : "Paso 2 de 2: facturas en dólares."] : [];
  return [...lineas, ...r.avisos];
}

const esRetencionOP = (tipo: unknown) => /^(retencion|percepcion)_/.test(String(tipo || "").toLowerCase());

/** Base imponible que la IA dejó en las notas del certificado ("Base imponible 2315359.20", "base 18.139.802,14"). */
export function baseDelCertificado(texto: unknown): number {
  const m = String(texto || "").match(/base(?:\s+(?:imponible|acumulada|de\s+retenci[oó]n|retenci[oó]n|documento|sujeta))?\s*[:=]?\s*\$?\s*(\d[\d.,]*\d)/i);
  return m ? toNumber(m[1]) : 0;
}

/**
 * Certificado u OP del cliente que paga facturas en $ y en US$ y NO trae el importe de cada factura
 * (ej. certificados de retención de Corteva, 05/11/2026): antes cada paso cargaba las retenciones enteras (repetidas).
 * Se arma una copia por paso con solo su parte: retenciones según el neto de cada factura en pesos (US$ al cambio de cada
 * factura; si el certificado trae la base, la parte en dólares es la base menos el neto en pesos) y medios según el saldo.
 * Las copias no llevan facturas con importe (así el paso en dólares no deduce un tipo de cambio que el cliente no informó).
 */
export function repartirSinImportes(parsed: OpParsed, r: Pick<FacturasDeOrdenPago, "ars" | "usd">): { ars: OpParsed; usd: OpParsed; aviso: string | null } {
  const igual = { ars: parsed, usd: parsed };
  const sinImportes = (parsed.facturas_pagadas || []).every((f) => !(toNumber(f.importe_pagado) > 0));
  const conMonto = (parsed.pagos || []).filter((p) => toNumber(p.monto) > 0);
  if (!r.ars.length || !r.usd.length || !sinImportes || !conMonto.some((p) => esRetencionOP(p.tipo))) return { ...igual, aviso: null };
  if (r.usd.some((d) => !(Number(d.cotizacion) > 0))) {
    return { ...igual, aviso: "El certificado no trae el importe de cada factura y hay facturas en US$ sin cotización: revisá las retenciones de cada paso (pueden venir enteras)." };
  }
  const netoArs = r.ars.reduce((s, f) => s + (Number(f.subtotal) > 0 ? Number(f.subtotal) : f.saldo / 1.21), 0);
  const netoUsd = r.usd.reduce((s, d) => s + (Number(d.subtotal) > 0 ? Number(d.subtotal) : d.saldo / 1.21) * Number(d.cotizacion), 0);
  const saldoArs = r.ars.reduce((s, f) => s + f.saldo, 0);
  const saldoUsd = r.usd.reduce((s, d) => s + d.saldo * Number(d.cotizacion), 0);
  const partes = (p: (typeof conMonto)[number]) => {
    const totalC = Math.round(toNumber(p.monto) * 100);
    if (!esRetencionOP(p.tipo)) return prorratear(totalC, [Math.round(saldoArs * 100), Math.round(saldoUsd * 100)]);
    const n = p as typeof p & { notas?: string | null; concepto?: string | null };
    const base = baseDelCertificado(`${n.notas || ""} ${n.concepto || ""}`);
    const usd = base > netoArs + 1 ? base - netoArs : netoUsd;
    return prorratear(totalC, [Math.round(netoArs * 100), Math.round(usd * 100)]);
  };
  const ars: typeof conMonto = [], usd: typeof conMonto = [];
  let retArs = 0, retUsd = 0;
  for (const p of conMonto) {
    const [a, u] = partes(p);
    if (a > 0) ars.push({ ...p, monto: a / 100, detalle: null });
    if (u > 0) usd.push({ ...p, monto: u / 100, detalle: null });
    if (esRetencionOP(p.tipo)) { retArs += a; retUsd += u; }
  }
  const plata = (c: number) => (c / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const copia = (pagos: typeof conMonto): OpParsed => ({ ...parsed, facturas_pagadas: [], pagos, retenciones_repartidas: true });
  return {
    ars: copia(ars), usd: copia(usd),
    aviso: `El certificado no trae el importe de cada factura: las retenciones se repartieron según el neto de cada factura ($ ${plata(retArs)} a las de pesos y $ ${plata(retUsd)} a las de dólares). Revisalas antes de confirmar.`,
  };
}
