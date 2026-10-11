/**
 * Reglas puras sobre comprobantes de venta (facturas y notas de crédito).
 * Prueba: npx tsx scripts/test-ventas-documentos.ts
 */

export interface DocVenta {
  id: string;
  tipo: string | null | undefined;
  total: number | string | null | undefined;
  estado: string | null | undefined;
  factura_origen_id?: string | null;
}

/** NCA, NCB, NCEA, NCEB… */
export function esNotaCredito(tipo: string | null | undefined): boolean {
  return String(tipo || "").toUpperCase().startsWith("NC");
}

/**
 * B7 — Importe que suma (o resta) un comprobante en "lo facturado".
 *
 * - Factura no anulada: suma su total.
 * - Factura anulada: no suma (0).
 * - NC: resta su total, SALVO que su factura origen esté anulada. En ese caso la
 *   factura ya quedó afuera por anulada y restar la NC de nuevo la descontaría
 *   dos veces (el error B7). Una NC anulada tampoco resta.
 *
 * `estadoOrigen` es el estado de la factura origen de la NC (si se conoce).
 */
export function importeVentaNeto(doc: DocVenta, estadoOrigen?: string | null): number {
  const total = Number(doc.total) || 0;
  if (doc.estado === "anulada") return 0;
  if (esNotaCredito(doc.tipo)) {
    if (doc.factura_origen_id && estadoOrigen === "anulada") return 0;
    return -total;
  }
  return total;
}

/** Suma de lo facturado (facturas − NC) aplicando la regla B7. */
export function totalVentasNeto(
  docs: DocVenta[],
  estadoDe: (id: string) => string | null | undefined,
): number {
  let acc = 0;
  for (const d of docs) acc += importeVentaNeto(d, d.factura_origen_id ? estadoDe(d.factura_origen_id) : null);
  return Math.round(acc * 100) / 100;
}

/**
 * Letra (A/B/C) de un comprobante tal como lo devuelve la IA o el sistema:
 * "FA", "FCEA", "Factura A", "FC B 0001-00000045", "A"…
 */
export function letraComprobante(texto: string | null | undefined): "A" | "B" | "C" | null {
  const t = String(texto || "").toUpperCase().trim();
  if (!t) return null;
  const pegada = t.match(/^(?:FCE|FC|F|NDE|ND|NCE|NC)\s*([ABC])\b/);
  if (pegada) return pegada[1] as "A" | "B" | "C";
  const suelta = t.match(/(?:^|[^A-Z])([ABC])(?:[^A-Z]|$)/);
  return suelta ? (suelta[1] as "A" | "B" | "C") : null;
}

/**
 * Cobro por orden de pago: entre los comprobantes del sistema con el mismo
 * punto de venta y número, elige la factura correcta.
 * - Nunca toma una NC (tienen su propia numeración y pueden repetir el número).
 * - Si la OP trae la letra (A/B) y hay más de un candidato, usa la que coincide.
 */
export function elegirFacturaDeOrdenPago<T extends { tipo?: string | null; estado?: string | null }>(
  candidatos: T[],
  tipoEnOrden?: string | null,
  comprobanteEnOrden?: string | null,
): T | undefined {
  const facturas = candidatos.filter(f => !esNotaCredito(f.tipo) && f.estado !== "anulada");
  if (facturas.length <= 1) return facturas[0];
  const letra = letraComprobante(tipoEnOrden) || letraComprobante(comprobanteEnOrden);
  if (letra) {
    const misma = facturas.filter(f => letraComprobante(f.tipo) === letra);
    if (misma.length) return misma[0];
  }
  return facturas[0];
}
