export interface MatchableBankMovement {
  tipo: string;
  monto: number;
  moneda?: string | null;
  fecha: string;
  anulado?: boolean | null;
  conciliado?: boolean | null;
  cliente_id?: string | null;
  proveedor_id?: string | null;
  factura_id?: string | null;
  factura_compra_id?: string | null;
}

export function bankMovementDirection(m: MatchableBankMovement): "credito" | "debito" | null {
  if (["cobro", "deposito"].includes(m.tipo)) return "credito";
  if (["pago", "cheque_emitido"].includes(m.tipo)) return "debito";
  if (m.tipo !== "transferencia") return null;
  const incoming = Boolean(m.cliente_id || m.factura_id);
  const outgoing = Boolean(m.proveedor_id || m.factura_compra_id);
  return incoming === outgoing ? null : incoming ? "credito" : "debito";
}

export function canMatchBankMovement(
  row: { tipo: string; monto: number; fecha: string },
  movement: MatchableBankMovement,
  currency: string,
): boolean {
  if (!["ARS", "USD"].includes(currency) || movement.moneda !== currency) return false;
  if (movement.anulado || movement.conciliado || bankMovementDirection(movement) !== row.tipo) return false;
  const amount = Number(movement.monto), target = Number(row.monto);
  if (!Number.isFinite(amount) || !Number.isFinite(target) || amount <= 0 || target <= 0) return false;
  if (Math.round(amount * 100) !== Math.round(target * 100)) return false;
  const delta = Math.abs(Date.parse(movement.fecha.slice(0, 10)) - Date.parse(row.fecha.slice(0, 10)));
  return Number.isFinite(delta) && delta <= 3 * 86400000;
}
