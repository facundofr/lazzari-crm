// Saldo a pagar por proveedor y fecha de la última compra.
// Misma fuente de verdad que la cuenta corriente de proveedores en Finanzas:
// facturas de compra no anuladas − (NC aplicadas + pagos directos con retenciones + OP vigentes)
// y, aparte, el crédito disponible de cada NC resta del saldo.
// También restan los créditos a favor: saldos_favor_proveedor disponibles, OP sin facturas
// (anticipos / pagos a cuenta), pagos que quedaron sobre facturas anuladas y ajustes manuales.
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

/** Crédito a nuestro favor con un proveedor (positivo = baja la deuda; negativo = la sube). */
export interface CreditoProveedor {
  proveedor_id: string | null;
  moneda?: string | null;
  monto: number | string | null;
  /** Solo para mostrar en el detalle de la cuenta corriente. */
  detalle?: string;
  fecha?: string | null;
}

export interface SaldoFavorProveedorRow { proveedor_id: string | null; moneda?: string | null; saldo: number | string | null; estado?: string | null; created_at?: string | null }
export interface OrdenPagoCreditoRow {
  id: string;
  proveedor_id: string | null;
  moneda?: string | null;
  monto_bruto: number | string | null;
  estado?: string | null;
  numero?: string | number | null;
  fecha?: string | null;
  op_facturas_compra?: Array<unknown> | null;
}
export interface AjusteProveedorRow {
  proveedor_id: string | null;
  moneda?: string | null;
  monto: number | string | null;
  anulado?: boolean | null;
  fecha?: string | null;
  descripcion?: string | null;
  /** "credito" = a favor del proveedor (le debemos más); "debito" = cargo al proveedor. */
  ajuste_sentido?: string | null;
}

/**
 * Arma la lista de créditos a favor a partir de:
 * - saldos_favor_proveedor en estado "disponible" (excedentes de OP),
 * - OP vigentes sin ninguna factura vinculada (anticipos / pagos a cuenta: el bruto es crédito),
 * - ajustes manuales de cuenta corriente (tipo "ajuste").
 */
export function creditosProveedor(
  saldosFavor: SaldoFavorProveedorRow[] = [],
  ordenesPago: OrdenPagoCreditoRow[] = [],
  ajustes: AjusteProveedorRow[] = [],
): CreditoProveedor[] {
  const out: CreditoProveedor[] = [];
  for (const s of saldosFavor) {
    if ((s.estado || "disponible") !== "disponible" || n(s.saldo) <= 0.005) continue;
    out.push({ proveedor_id: s.proveedor_id, moneda: s.moneda, monto: n(s.saldo), detalle: "Saldo a favor de una OP", fecha: s.created_at ? String(s.created_at).slice(0, 10) : null });
  }
  for (const op of ordenesPago) {
    if (op.estado === "anulada" || (op.op_facturas_compra || []).length > 0 || n(op.monto_bruto) <= 0.005) continue;
    out.push({ proveedor_id: op.proveedor_id, moneda: op.moneda, monto: n(op.monto_bruto), detalle: `Pago a cuenta / anticipo${op.numero ? ` · OP ${op.numero}` : ""}`, fecha: op.fecha ?? null });
  }
  for (const a of ajustes) {
    if (a.anulado || (a.ajuste_sentido !== "credito" && a.ajuste_sentido !== "debito")) continue;
    out.push({
      proveedor_id: a.proveedor_id, moneda: a.moneda,
      monto: a.ajuste_sentido === "credito" ? -n(a.monto) : n(a.monto),
      detalle: a.descripcion || "Ajuste manual", fecha: a.fecha ?? null,
    });
  }
  return out;
}

/** Pagos que quedaron sobre facturas anuladas: no se pierden, quedan a favor (para mostrar en el detalle). */
export function pagosSobreFacturasAnuladas(facturas: FacturaCompraSaldo[], pagosDirectos: MovimientoPagoFC[]): CreditoProveedor[] {
  const directo: Record<string, number> = {};
  for (const p of pagosDirectos) {
    if (p.anulado || !p.factura_compra_id || p.nota_credito_compra_id) continue;
    directo[p.factura_compra_id] = (directo[p.factura_compra_id] || 0) + n(p.monto) + n(p.retencion_ganancias_monto);
  }
  const out: CreditoProveedor[] = [];
  for (const f of facturas) {
    if (f.estado !== "anulada" || esNC(f) || !f.proveedor_id) continue;
    const pagado = pagosOP(f) + (directo[f.id] || 0);
    if (pagado > 0.005) out.push({ proveedor_id: f.proveedor_id, moneda: f.moneda, monto: pagado, detalle: "Pagado sobre una factura anulada", fecha: f.fecha ?? null });
  }
  return out;
}

/**
 * Trae de la base los créditos a favor de los proveedores de una sociedad (saldos a favor de OP,
 * OP sin facturas y ajustes manuales). `traerTodo` y `sentidoAjuste` se reciben por parámetro
 * para que este archivo siga siendo puro y se pueda probar sin base.
 */
export async function traerCreditosProveedores(
  db: any,
  sociedadId: string,
  traerTodo: <T = any>(armar: () => any) => Promise<T[]>,
  sentidoAjuste: (m: { tipo?: string | null; descripcion?: string | null; ajuste_sentido?: string | null }) => "credito" | "debito" | null,
): Promise<CreditoProveedor[]> {
  const camposAjuste = "id, proveedor_id, moneda, monto, anulado, fecha, descripcion, tipo";
  const armarAjustes = (campos: string) => () => db.from("movimientos").select(campos)
    .eq("sociedad_id", sociedadId).not("proveedor_id", "is", null)
    .or('tipo.eq.ajuste,descripcion.ilike."[Ajuste manual]*"').order("id");
  const [saldosFavor, ordenes, ajustesRaw] = await Promise.all([
    traerTodo<SaldoFavorProveedorRow>(() => db.from("saldos_favor_proveedor")
      .select("id, proveedor_id, moneda, saldo, estado, created_at").eq("sociedad_id", sociedadId).eq("estado", "disponible").order("id")),
    traerTodo<OrdenPagoCreditoRow>(() => db.from("ordenes_pago")
      .select("id, proveedor_id, moneda, monto_bruto, estado, numero, fecha, op_facturas_compra(factura_compra_id)")
      .eq("sociedad_id", sociedadId).neq("estado", "anulada").order("id")),
    // ajuste_sentido llega con la migración 20261011100000; si todavía no está, se usa la descripción.
    traerTodo<any>(armarAjustes(`${camposAjuste}, ajuste_sentido`)).catch(() => traerTodo<any>(armarAjustes(camposAjuste))),
  ]);
  const ajustes: AjusteProveedorRow[] = ajustesRaw.map((m: any) => ({ ...m, ajuste_sentido: sentidoAjuste(m) }));
  return creditosProveedor(saldosFavor, ordenes, ajustes);
}

const esNC = (f: { tipo_comprobante?: string | null }) => String(f.tipo_comprobante || "").toUpperCase().startsWith("NC");
const n = (v: unknown) => Number(v || 0) || 0;
const pagosOP = (f: FacturaCompraSaldo) => (f.op_facturas_compra || [])
  .filter((l) => l?.ordenes_pago && l.ordenes_pago.estado !== "anulada")
  .reduce((s, l) => s + n(l.monto), 0);

export function calcularSaldosProveedores(
  facturas: FacturaCompraSaldo[],
  pagosDirectos: MovimientoPagoFC[],
  movimientosNC: MovimientoNC[],
  creditos: CreditoProveedor[] = [],
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
    if (!f.proveedor_id) continue;
    const moneda: "ARS" | "USD" = f.moneda === "USD" ? "USD" : "ARS";
    if (f.estado === "anulada") {
      // Lo que se pagó sobre una factura anulada no se pierde: queda a favor.
      if (esNC(f)) continue;
      const pagado = pagosOP(f) + (pagoDirecto[f.id] || 0);
      if (pagado > 0.005) {
        saldos[f.proveedor_id] ||= { ARS: 0, USD: 0 };
        saldos[f.proveedor_id][moneda] -= pagado;
      }
      continue;
    }
    saldos[f.proveedor_id] ||= { ARS: 0, USD: 0 };
    if (esNC(f)) {
      const disponible = Math.max(0, n(f.total) - (aplicadoPorNC[f.id] || 0));
      if (disponible > 0.005) saldos[f.proveedor_id][moneda] -= disponible;
      continue;
    }
    const pagoOP = pagosOP(f);
    // Una NC nueva deja dos rastros del mismo crédito (total_acreditado y un movimiento): se toma el mayor.
    const credito = Math.max(n(f.total_acreditado), creditoNC[f.id] || 0);
    saldos[f.proveedor_id][moneda] += Math.max(0, n(f.total) - credito - (pagoDirecto[f.id] || 0) - pagoOP);
  }
  for (const c of creditos) {
    if (!c.proveedor_id || Math.abs(n(c.monto)) <= 0.005) continue;
    const moneda: "ARS" | "USD" = c.moneda === "USD" ? "USD" : "ARS";
    saldos[c.proveedor_id] ||= { ARS: 0, USD: 0 };
    saldos[c.proveedor_id][moneda] -= n(c.monto);
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
