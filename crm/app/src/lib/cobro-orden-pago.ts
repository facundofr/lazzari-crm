// «Cobrar todas las facturas de esta orden de pago» (auditoría UX 27/10/2026, arreglo 11): la OP del cliente ya leída por la IA
// trae varias facturas; se buscan todas en el sistema y se arma el cobro en dos pasos: primero las de pesos y después las de dólares.
// Las ya cobradas o que no están se informan y no se tocan. Misma regla que Facturación (facturacion-content.tsx, iniciarCobroOrdenPago).
// Función pura. Prueba: scripts/test-cobro-orden-pago.ts
import { comprobanteKey, type OpParsed } from "./orden-pago-plan";
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
