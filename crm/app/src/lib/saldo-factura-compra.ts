// Saldo de UNA factura de compra y control de duplicados.
// Misma regla que la base (public.fc_compra_pagado) y que Finanzas / lib/saldo-proveedores.ts:
//   cancelado = OP vigentes + pagos directos (con su retención) + crédito de NC contado UNA vez.
// Una NC deja dos rastros del mismo crédito (total_acreditado y un movimiento con
// nota_credito_compra_id): se toma el mayor de los dos, nunca la suma.

const n = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface PagosFacturaCompra {
  /** Total del comprobante. */
  total: number | string | null;
  /** facturas_compra.total_acreditado */
  total_acreditado?: number | string | null;
  /** Suma de op_facturas_compra.monto de OP no anuladas. */
  pago_op?: number | string | null;
  /** Pagos directos (movimientos tipo pago SIN nota_credito_compra_id), con retención incluida. */
  pago_directo?: number | string | null;
  /** Movimientos tipo pago CON nota_credito_compra_id (no anulados). */
  credito_nc_movimientos?: number | string | null;
}

export function canceladoFacturaCompra(f: PagosFacturaCompra): number {
  const credito = Math.max(n(f.total_acreditado), n(f.credito_nc_movimientos));
  return r2(n(f.pago_op) + n(f.pago_directo) + credito);
}

export function saldoFacturaCompra(f: PagosFacturaCompra): number {
  return r2(Math.max(0, n(f.total) - canceladoFacturaCompra(f)));
}

/** "fc  a" → "FC A". Sin tipo, la base usa "FC A". */
export function normalizarTipoComprobanteCompra(tipo: string | null | undefined): string {
  const t = String(tipo || "").trim().replace(/\s+/g, " ").toUpperCase();
  return t || "FC A";
}

export interface ComprobanteCompraExistente {
  numero_factura: string | null;
  tipo_comprobante?: string | null;
  estado?: string | null;
}

/**
 * Comprobantes ya cargados que repiten número y TIPO (FC A, FC B, NC A… son series distintas).
 * Las anuladas no cuentan. `canonico` normaliza el número (p. ej. 1-45 → 00001-00000045).
 */
export function duplicadosComprobanteCompra<T extends ComprobanteCompraExistente>(
  existentes: T[],
  nuevo: { numero_factura: string; tipo_comprobante?: string | null },
  canonico: (numero: string) => string,
): T[] {
  const numero = canonico(nuevo.numero_factura.trim());
  const tipo = normalizarTipoComprobanteCompra(nuevo.tipo_comprobante);
  return existentes.filter(e =>
    e.estado !== "anulada"
    && normalizarTipoComprobanteCompra(e.tipo_comprobante) === tipo
    && canonico(String(e.numero_factura || "")) === numero);
}
