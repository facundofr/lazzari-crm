/**
 * Saldo a favor de un cliente → aplicarlo a las facturas que se cobran (Augusto 26/10/2026).
 *
 * Saldo a favor = movimientos "ajuste" con ajuste_sentido 'credito', sin factura y sin anular
 * (pagos de más que deja el cobro masivo, una factura pagada y después anulada, ajustes manuales).
 * Misma regla que lib/saldo-clientes.ts (ajustes). Lo guarda la RPC aplicar_saldo_favor_cliente
 * (migración 20261026160000). Nada se aplica solo: una persona tilda "Aplicar".
 *
 * Prueba: node scripts/test-saldo-favor-cliente.cjs
 */

export interface FuenteSaldoFavorCliente { id: string; monto: number; fecha: string; descripcion: string }
export interface FacturaSaldoFavor { id: string; numero: string; fecha: string; saldo: number }
export interface AplicacionSaldoFavor { movimiento_id: string; factura_id: string; numero: string; monto: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Saldos a favor disponibles (ya filtrados por cliente y moneda), del más viejo al más nuevo. */
export function fuentesSaldoFavorCliente(rows: Array<{ id: string; monto: unknown; fecha?: string | null; descripcion?: string | null; anulado?: boolean | null; factura_id?: string | null; ajuste_sentido?: string | null }>, aplicados: Set<string> = new Set()): FuenteSaldoFavorCliente[] {
  return rows
    .filter((m) => !m.anulado && !m.factura_id && m.ajuste_sentido === "credito" && !aplicados.has(m.id) && r2(Number(m.monto) || 0) > 0)
    .map((m) => ({ id: m.id, monto: r2(Number(m.monto) || 0), fecha: String(m.fecha || ""), descripcion: String(m.descripcion || "") }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Reparte el saldo a favor entre las facturas del cobro.
 * Primero van las facturas a las que la OP les paga de menos (`faltaPorFactura`, hasta esa diferencia),
 * después lo que quede, de la factura más nueva a la más vieja (el cobro se aplica de la más vieja a la más nueva,
 * así el saldo a favor y la plata no se pisan). Nunca más de lo que debe cada factura ni más de lo que hay a favor.
 */
export function repartirSaldoFavorCliente(
  fuentes: FuenteSaldoFavorCliente[],
  facturas: FacturaSaldoFavor[],
  faltaPorFactura: Record<string, number> = {},
): AplicacionSaldoFavor[] {
  const pendientes = fuentes.map((f) => ({ ...f, queda: f.monto }));
  const deuda = new Map(facturas.map((f) => [f.id, r2(Math.max(0, f.saldo))]));
  const out: AplicacionSaldoFavor[] = [];
  const aplicar = (f: FacturaSaldoFavor, tope: number) => {
    let resto = r2(Math.min(tope, deuda.get(f.id) || 0));
    for (const p of pendientes) {
      if (resto <= 0) break;
      const usar = r2(Math.min(p.queda, resto));
      if (usar <= 0) continue;
      const previa = out.find((a) => a.movimiento_id === p.id && a.factura_id === f.id);
      if (previa) previa.monto = r2(previa.monto + usar);
      else out.push({ movimiento_id: p.id, factura_id: f.id, numero: f.numero, monto: usar });
      p.queda = r2(p.queda - usar);
      resto = r2(resto - usar);
      deuda.set(f.id, r2((deuda.get(f.id) || 0) - usar));
    }
  };
  const masNuevaPrimero = [...facturas].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero, "es", { numeric: true }));
  for (const f of masNuevaPrimero) if ((faltaPorFactura[f.id] || 0) > 0) aplicar(f, faltaPorFactura[f.id]);
  for (const f of masNuevaPrimero) aplicar(f, Infinity);
  return out;
}

/** Lo que la OP le paga de menos a cada factura del cobro (saldo − pagado según la OP). */
export function faltaSegunOrden(facturas: FacturaSaldoFavor[], incluidas: Array<{ docId: string; importe: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of incluidas) {
    const f = facturas.find((x) => x.id === i.docId);
    if (!f) continue;
    const falta = r2(f.saldo - i.importe);
    if (falta >= 0.01) out[f.id] = falta;
  }
  return out;
}
