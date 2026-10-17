/**
 * Qué le falta a cada venta (presupuesto aprobado) y en qué bandeja de Ventas aparece.
 * Entrega, factura y cobro son independientes: una venta puede estar en varias bandejas.
 *
 * - Factura vigente: la última factura (no NC) que no esté anulada. Si una NC anuló la factura, hay que volver a facturar.
 * - Saldo: total − NC aplicadas (total_acreditado) − cobrado (misma regla que lib/saldo-clientes).
 * - Esperando OC: el cliente pide OC para facturar y el PR todavía no la tiene. Es un aviso: se puede facturar igual.
 *
 * Prueba: npx tsx scripts/test-ventas-etapas.ts
 */

import { esNotaCredito } from "./ventas-documentos";

export type BandejaVenta = "esperando_oc" | "facturar" | "entregar" | "cobrar" | "terminadas" | "todas";
export type PasoVenta = "oc" | "facturar" | "entregar" | "cobrar";

export interface VentaEtapaInput {
  fechaPr: string;
  totalPr: number;
  monedaPr: string;
  ocCliente: string | null;
  clientePideOc: boolean;
  facturas: { id: string; tipo: string; estado: string; fecha: string; total: number | string; total_acreditado?: number | string | null; moneda: string | null; fecha_vencimiento?: string | null }[];
  remitos: { estado: string }[];
}

export interface VentaEtapa {
  facturaVigenteId: string | null;
  facturada: boolean;
  refacturar: boolean;
  entregado: boolean;
  enEntrega: boolean;
  esperandoOc: boolean;
  /** Saldo pendiente de la factura vigente (null si no hay factura o no se sabe lo cobrado). */
  saldo: number | null;
  cobradoParcial: boolean;
  cobrado: boolean;
  vencida: boolean;
  pendientes: PasoVenta[];
  proximoPaso: PasoVenta | null;
  terminada: boolean;
  /** Días desde el PR (sin facturar) o desde la factura (sin cobrar). */
  dias: number;
  monedaVenta: "ARS" | "USD";
  /** Importe que se suma en la bandeja: saldo si hay factura, total del PR si no. */
  importe: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function diasEntre(desde: string, hoy: string): number {
  if (!desde) return 0;
  const a = new Date(desde.slice(0, 10) + "T12:00:00").getTime();
  const b = new Date(hoy + "T12:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function etapaVenta(v: VentaEtapaInput, cobradoPorFactura: Record<string, number> | null, hoy: string): VentaEtapa {
  const facturasOrdenadas = [...v.facturas].filter(f => !esNotaCredito(f.tipo)).sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
  const vigente = facturasOrdenadas.find(f => f.estado !== "anulada") || null;
  const facturada = !!vigente;
  const refacturar = !facturada && facturasOrdenadas.length > 0;
  // El remito se hace para entregar: con un remito ya cuenta como entregado (el estado del remito no se usa).
  const entregado = v.remitos.length > 0;
  const enEntrega = false;
  const esperandoOc = !facturada && v.clientePideOc && !(v.ocCliente || "").trim();

  let saldo: number | null = null;
  if (vigente && (cobradoPorFactura || vigente.estado === "pagada")) {
    const cobrado = vigente.estado === "pagada" && !cobradoPorFactura ? Number(vigente.total) : (cobradoPorFactura?.[vigente.id] || 0);
    saldo = r2(Math.max(0, (Number(vigente.total) || 0) - (Number(vigente.total_acreditado) || 0) - cobrado));
  }
  const cobrado = facturada && (vigente!.estado === "pagada" || (saldo !== null && saldo <= 0.01));
  const cobradoParcial = facturada && !cobrado && saldo !== null && saldo < r2((Number(vigente!.total) || 0) - (Number(vigente!.total_acreditado) || 0));
  const vencida = facturada && !cobrado && !!vigente!.fecha_vencimiento && vigente!.fecha_vencimiento! < hoy;

  const pendientes: PasoVenta[] = [];
  if (esperandoOc) pendientes.push("oc");
  if (!facturada) pendientes.push("facturar");
  if (!entregado) pendientes.push("entregar");
  if (facturada && !cobrado) pendientes.push("cobrar");

  const monedaVenta = ((vigente?.moneda || v.monedaPr) === "USD" ? "USD" : "ARS") as "ARS" | "USD";
  const importe = facturada ? (saldo ?? (Number(vigente!.total) || 0)) : (Number(v.totalPr) || 0);

  return {
    facturaVigenteId: vigente?.id || null,
    facturada, refacturar, entregado, enEntrega, esperandoOc,
    saldo, cobradoParcial, cobrado, vencida,
    pendientes,
    proximoPaso: pendientes[0] || null,
    terminada: pendientes.length === 0,
    dias: diasEntre(facturada && !cobrado ? vigente!.fecha : v.fechaPr, hoy),
    monedaVenta,
    importe: r2(importe),
  };
}

export function enBandeja(e: VentaEtapa, b: BandejaVenta): boolean {
  switch (b) {
    case "esperando_oc": return e.esperandoOc;
    case "facturar": return !e.facturada && !e.esperandoOc;
    case "entregar": return !e.entregado;
    case "cobrar": return e.facturada && !e.cobrado;
    case "terminadas": return e.terminada;
    default: return true;
  }
}

/** Cantidad y plata de una bandeja, pesos y dólares por separado. */
export function resumenBandeja(etapas: VentaEtapa[], b: BandejaVenta): { cantidad: number; ARS: number; USD: number } {
  const out = { cantidad: 0, ARS: 0, USD: 0 };
  for (const e of etapas) {
    if (!enBandeja(e, b)) continue;
    out.cantidad += 1;
    out[e.monedaVenta] = r2(out[e.monedaVenta] + e.importe);
  }
  return out;
}
