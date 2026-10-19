// Saldo a favor con un proveedor (anticipos / pagos a cuenta) y cómo se aplica a sus facturas (Augusto 19/10).
// Ejemplo: a De Pascale se le paga antes y la factura llega después.
// Lo que hay a favor sale de las OP (misma regla que lib/saldo-proveedores → creditosProveedor):
//   - OP vigente SIN facturas vinculadas: todo el bruto es crédito (anticipo);
//   - más el saldo a favor que dejó la OP (saldos_favor_proveedor "disponible").
// Aplicar = vincular la OP a la factura (op_facturas_compra) con la RPC aplicar_saldo_favor_proveedor:
// la plata no se mueve; lo que sobra de la OP queda a favor. Nada se aplica solo: lo confirma una persona.

export interface OpSaldoFavorRow {
  id: string;
  numero?: string | null;
  fecha?: string | null;
  moneda?: string | null;
  monto_bruto: number | string | null;
  estado?: string | null;
  /** Solo para OP en US$ pagadas en pesos: la moneda de las facturas. Esas no se usan acá. */
  moneda_documentos?: string | null;
  op_facturas_compra?: Array<unknown> | null;
}

export interface SaldoFavorRow { orden_pago_id: string | null; saldo: number | string | null; estado?: string | null; moneda?: string | null }

export interface FuenteSaldoFavor {
  orden_pago_id: string;
  numero: string;
  fecha: string | null;
  moneda: "ARS" | "USD";
  disponible: number;
}

export interface AplicacionOP { orden_pago_id: string; monto: number }

const n = (v: unknown) => Number(v || 0) || 0;
export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const mon = (m: string | null | undefined): "ARS" | "USD" => (m === "USD" ? "USD" : "ARS");

/** Lo que hay a favor en cada OP del proveedor, de la más vieja a la más nueva. */
export function fuentesSaldoFavor(ops: OpSaldoFavorRow[], saldosFavor: SaldoFavorRow[]): FuenteSaldoFavor[] {
  const sf: Record<string, number> = {};
  for (const s of saldosFavor) {
    if (!s.orden_pago_id || (s.estado || "disponible") !== "disponible") continue;
    sf[s.orden_pago_id] = (sf[s.orden_pago_id] || 0) + n(s.saldo);
  }
  const out: FuenteSaldoFavor[] = [];
  for (const op of ops) {
    if (op.estado === "anulada") continue;
    if (op.moneda_documentos && op.moneda_documentos !== op.moneda) continue;
    const sinFacturas = (op.op_facturas_compra || []).length === 0;
    const disponible = round2((sinFacturas ? n(op.monto_bruto) : 0) + (sf[op.id] || 0));
    if (disponible <= 0.005) continue;
    out.push({ orden_pago_id: op.id, numero: String(op.numero || "OP"), fecha: op.fecha ? String(op.fecha).slice(0, 10) : null, moneda: mon(op.moneda), disponible });
  }
  return out.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "") || a.numero.localeCompare(b.numero));
}

/** Total a favor en una moneda. */
export function totalSaldoFavor(fuentes: FuenteSaldoFavor[], moneda: string | null | undefined): number {
  return round2(fuentes.filter((f) => f.moneda === mon(moneda)).reduce((s, f) => s + f.disponible, 0));
}

/**
 * Reparte el saldo a favor entre las facturas, en el orden en que vienen, usando primero las OP más viejas.
 * Solo usa OP de la misma moneda de cada factura. Nunca aplica más que el saldo de la factura.
 */
export function repartirSaldoFavor(
  fuentes: FuenteSaldoFavor[],
  facturas: Array<{ id: string; saldo: number; moneda?: string | null }>,
): Array<{ factura_id: string; aplicado: number; ops: AplicacionOP[] }> {
  const queda = fuentes.map((f) => ({ ...f }));
  const out: Array<{ factura_id: string; aplicado: number; ops: AplicacionOP[] }> = [];
  for (const fc of facturas) {
    let falta = round2(n(fc.saldo));
    const ops: AplicacionOP[] = [];
    for (const f of queda) {
      if (falta <= 0.005) break;
      if (f.moneda !== mon(fc.moneda) || f.disponible <= 0.005) continue;
      const usar = round2(Math.min(f.disponible, falta));
      ops.push({ orden_pago_id: f.orden_pago_id, monto: usar });
      f.disponible = round2(f.disponible - usar);
      falta = round2(falta - usar);
    }
    const aplicado = round2(ops.reduce((s, o) => s + o.monto, 0));
    if (aplicado > 0.005) out.push({ factura_id: fc.id, aplicado, ops });
  }
  return out;
}

/** "OP-000067, OP-000068 y OP-000069" */
export function listaOPs(fuentes: Array<{ numero: string }>): string {
  const nums = fuentes.map((f) => f.numero);
  return nums.length <= 1 ? nums.join("") : `${nums.slice(0, -1).join(", ")} y ${nums[nums.length - 1]}`;
}
