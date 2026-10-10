// Saldo a pagar por proveedor y fecha de la última compra.
// Misma fuente de verdad que la cuenta corriente de proveedores en Finanzas:
// facturas de compra no anuladas − (NC aplicadas + pagos directos con retenciones + OP vigentes)
// y, aparte, el crédito disponible de cada NC resta del saldo.
// La columna proveedores.saldo_cuenta_corriente NO se usa: es un campo viejo que nadie actualiza.

export interface FacturaCompraSaldo {
  id: string;
  proveedor_id: string | null;
  total: number | string | null;
  total_acreditado?: number | string | null;
  moneda?: string | null;
  estado?: string | null;
  tipo_comprobante?: string | null;
  fecha?: string | null;
  op_facturas_compra?: Array<{ monto: number | string | null; ordenes_pago?: { estado?: string | null } | null }> | null;
}

export interface MovimientoPagoFC {
  factura_compra_id: string | null;
  monto: number | string | null;
  retencion_ganancias_monto?: number | string | null;
  anulado?: boolean | null;
  nota_credito_compra_id?: string | null;
}

export interface MovimientoNC {
  nota_credito_compra_id: string | null;
  monto: number | string | null;
  anulado?: boolean | null;
}

export interface OrdenCompraFecha {
  proveedor_id: string | null;
  fecha: string | null;
  estado?: string | null;
}

export interface SaldoProveedor { ARS: number; USD: number }

const esNC = (f: { tipo_comprobante?: string | null }) => String(f.tipo_comprobante || "").toUpperCase().startsWith("NC");
const n = (v: unknown) => Number(v || 0) || 0;

export function calcularSaldosProveedores(
  facturas: FacturaCompraSaldo[],
  pagosDirectos: MovimientoPagoFC[],
  movimientosNC: MovimientoNC[],
): Record<string, SaldoProveedor> {
  const pagoDirecto: Record<string, number> = {};
  const creditoNC: Record<string, number> = {};
  for (const p of pagosDirectos) {
    if (p.anulado || !p.factura_compra_id) continue;
    if (p.nota_credito_compra_id) creditoNC[p.factura_compra_id] = (creditoNC[p.factura_compra_id] || 0) + n(p.monto);
    else pagoDirecto[p.factura_compra_id] = (pagoDirecto[p.factura_compra_id] || 0) + n(p.monto) + n(p.retencion_ganancias_monto);
  }
  const aplicadoPorNC: Record<string, number> = {};
  for (const m of movimientosNC) {
    if (m.anulado || !m.nota_credito_compra_id) continue;
    aplicadoPorNC[m.nota_credito_compra_id] = (aplicadoPorNC[m.nota_credito_compra_id] || 0) + n(m.monto);
  }

  const saldos: Record<string, SaldoProveedor> = {};
  for (const f of facturas) {
    if (!f.proveedor_id || f.estado === "anulada") continue;
    const moneda: "ARS" | "USD" = f.moneda === "USD" ? "USD" : "ARS";
    saldos[f.proveedor_id] ||= { ARS: 0, USD: 0 };
    if (esNC(f)) {
      const disponible = Math.max(0, n(f.total) - (aplicadoPorNC[f.id] || 0));
      if (disponible > 0.005) saldos[f.proveedor_id][moneda] -= disponible;
      continue;
    }
    const pagoOP = (f.op_facturas_compra || [])
      .filter((l) => l?.ordenes_pago && l.ordenes_pago.estado !== "anulada")
      .reduce((s, l) => s + n(l.monto), 0);
    // Una NC nueva deja dos rastros del mismo crédito (total_acreditado y un movimiento): se toma el mayor.
    const credito = Math.max(n(f.total_acreditado), creditoNC[f.id] || 0);
    saldos[f.proveedor_id][moneda] += Math.max(0, n(f.total) - credito - (pagoDirecto[f.id] || 0) - pagoOP);
  }
  return saldos;
}

/** Fecha (YYYY-MM-DD) de la última OC o factura de compra por proveedor. */
export function ultimaCompraPorProveedor(facturas: FacturaCompraSaldo[], ordenes: OrdenCompraFecha[]): Record<string, string> {
  const out: Record<string, string> = {};
  const anotar = (prov: string | null, fecha: string | null | undefined) => {
    if (!prov || !fecha) return;
    const f = String(fecha).slice(0, 10);
    if (!out[prov] || f > out[prov]) out[prov] = f;
  };
  for (const f of facturas) if (f.estado !== "anulada" && !esNC(f)) anotar(f.proveedor_id, f.fecha);
  for (const o of ordenes) if (o.estado !== "anulada" && o.estado !== "cancelada") anotar(o.proveedor_id, o.fecha);
  return out;
}

/** Arma el link de WhatsApp (Argentina) a partir de un teléfono cargado a mano. */
export function linkWhatsApp(telefono: string | null | undefined): string | null {
  let d = String(telefono || "").replace(/\D/g, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // "011 15-5555-1234": el 15 de celular sobra cuando quedan 12 dígitos
  if (d.length === 12) {
    for (const i of [2, 3, 4]) if (d.slice(i, i + 2) === "15") { d = d.slice(0, i) + d.slice(i + 2); break; }
  }
  if (d.length < 8) return null;
  return `https://wa.me/549${d}`;
}

/** "Localidad, Provincia" sin comas sueltas. */
export function textoLocalidad(localidad: string | null | undefined, provincia: string | null | undefined): string {
  const limpiar = (s: string | null | undefined) => String(s || "").replace(/^[\s,]+|[\s,]+$/g, "");
  return [limpiar(localidad), limpiar(provincia)].filter(Boolean).join(", ");
}
