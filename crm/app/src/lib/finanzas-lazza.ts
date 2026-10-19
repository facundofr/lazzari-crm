/**
 * Finanzas Lazza (Tanda 1, 18/10/2026): cuentas puras de Reportes básico, IVA y Vencimientos. Solo lectura.
 *
 * Reportes básico (todo en $, mes a mes, por sociedad):
 * - FACTURADO = facturas de venta del mes − NC del mes, neto + IVA = total. USD al TC de cada factura.
 *   Una factura anulada y la NC que la anuló desaparecen juntas (`filtrarParaGestion`).
 * - COSTO = costo de los ítems del PR de cada factura (cantidad × precio_costo, neto + IVA del ítem).
 *   Costo en US$ → al TC de la factura (si la factura es en $, al dólar BNA divisa del día de la factura).
 *   NC = mercadería devuelta: resta venta Y costo (parcial: costo del PR de origen × neto NC / neto factura).
 *   No usa las facturas de compra (Augusto 18/10).
 * - GASTOS del mes (gastos_manuales): fijos (tipo fijo o atados a un gasto fijo) y eventuales.
 * - OBJETIVOS sobre el NETO facturado.
 * IVA: débito de ventas (libro: factura anulada con CAE sigue y se compensa con su NC) − crédito de compras
 * (facturas de compra no anuladas; las NC de compra restan). Diferencia solo como referencia.
 * Vencimientos: facturas de venta y de compra con saldo, por fecha de vencimiento.
 *
 * Prueba: npx tsx scripts/test-finanzas-lazza.ts
 */
import { esNotaCredito, filtrarParaGestion, incluirEnLibroIVACompras, incluirEnLibroIVAVentas, normalizarMoneda, periodoDeFecha } from "./reportes-comprobantes";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => Number(v || 0) || 0;

export const OBJETIVOS_MES = { minimo: 64_000_000, bueno: 80_000_000, muyBueno: 96_000_000 } as const;
export type NivelObjetivo = "debajo" | "minimo" | "bueno" | "muy_bueno";

/** Dólar BNA divisa (venta) de un día. `null` = no hay cotización. */
export type TcDelDia = (fecha: string) => number | null;

/** Cotizaciones guardadas (fecha → venta) → TC del día o del último día hábil anterior (hasta 10 días atrás). */
export function armarTcDelDia(cotizaciones: { fecha: string; valor_venta: number | string | null }[]): TcDelDia {
  const lista = cotizaciones
    .map((c) => ({ fecha: String(c.fecha).slice(0, 10), venta: num(c.valor_venta) }))
    .filter((c) => c.venta > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return (fecha: string) => {
    const f = String(fecha || "").slice(0, 10);
    let mejor: { fecha: string; venta: number } | null = null;
    for (const c of lista) { if (c.fecha <= f) mejor = c; else break; }
    if (!mejor) return null;
    const dias = (Date.parse(`${f}T12:00:00Z`) - Date.parse(`${mejor.fecha}T12:00:00Z`)) / 86_400_000;
    return dias <= 10 ? mejor.venta : null;
  };
}

export function comprobanteVenta(f: { tipo?: string | null; punto_venta?: number | string | null; numero?: number | string | null }): string {
  return `${f.tipo || "FC"} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? 0).padStart(8, "0")}`;
}

// ── Reportes básico ─────────────────────────────────────────────────

export interface FacturaVentaFL {
  id: string;
  fecha: string;
  tipo: string | null;
  estado: string | null;
  moneda: string | null;
  subtotal: number | string | null;
  iva: number | string | null;
  total: number | string | null;
  tipo_cambio?: number | string | null;
  factura_origen_id?: string | null;
  presupuesto_id?: string | null;
  punto_venta?: number | string | null;
  numero?: number | string | null;
  cae?: string | null;
  cliente?: string | null;
}

export interface ItemCostoFL {
  presupuesto_id: string;
  cantidad: number | string | null;
  precio_costo: number | string | null;
  costo_moneda?: string | null;
  iva_porcentaje?: number | string | null;
}

export interface GastoFL {
  fecha: string;
  monto: number | string | null;
  moneda?: string | null;
  tipo_recurrencia?: string | null;
  gasto_fijo_id?: string | null;
}

export interface NetoIva { neto: number; iva: number; total: number }

export interface FilaReporte {
  facturaId: string;
  comprobante: string;
  fecha: string;
  cliente: string;
  presupuestoId: string | null;
  prNumero: string | null;
  esNC: boolean;
  /** Con signo (NC en negativo), en $. */
  venta: NetoIva;
  costo: NetoIva;
  /** Algo de esta fila no se pudo calcular bien (se explica en avisos). */
  aviso: string | null;
}

export interface AvisoPr {
  facturaId: string;
  comprobante: string;
  cliente: string;
  presupuestoId: string | null;
  prNumero: string | null;
  motivo: string;
}

export interface ReporteBasico {
  facturado: NetoIva;
  costo: NetoIva;
  gastos: { fijos: number; eventuales: number; total: number; enUsdSinCotizacion: number };
  objetivo: { neto: number; nivel: NivelObjetivo; proximo: { nombre: string; monto: number; falta: number } | null };
  filas: FilaReporte[];
  /** PR sin costo, facturas sin PR, NC sin factura de origen. */
  avisos: AvisoPr[];
  /** Comprobantes en US$ sin cotización: no suman. */
  sinCotizacion: string[];
}

const vacioNI = (): NetoIva => ({ neto: 0, iva: 0, total: 0 });
const sumarNI = (a: NetoIva, b: NetoIva, factor = 1) => { a.neto += b.neto * factor; a.iva += b.iva * factor; a.total += b.total * factor; };
const redondearNI = (a: NetoIva): NetoIva => ({ neto: r2(a.neto), iva: r2(a.iva), total: r2(a.total) });

function netoIvaFactura(f: FacturaVentaFL): NetoIva {
  const total = num(f.total);
  const tieneSub = f.subtotal !== null && f.subtotal !== undefined && f.subtotal !== "";
  const neto = tieneSub ? num(f.subtotal) : total;
  const iva = f.iva !== null && f.iva !== undefined && f.iva !== "" ? num(f.iva) : Math.max(0, total - neto);
  return { neto, iva, total };
}

/** TC para pasar a $ un comprobante: el suyo, o el BNA del día. `null` = no hay. ARS = 1. */
function tcComprobante(moneda: string | null | undefined, tipoCambio: unknown, fecha: string, tcDia: TcDelDia): number | null {
  if (normalizarMoneda(moneda) === "ARS") return 1;
  return num(tipoCambio) > 0 ? num(tipoCambio) : tcDia(fecha);
}

/** Costo de los ítems de un PR, en $, con el TC de la factura. `sinCosto` = ítems con costo 0 o vacío. */
export function costoDelPr(items: ItemCostoFL[], factura: Pick<FacturaVentaFL, "moneda" | "tipo_cambio" | "fecha">, tcDia: TcDelDia): { costo: NetoIva; sinCosto: number; sinTc: boolean } {
  const costo = vacioNI();
  let sinCosto = 0;
  let sinTc = false;
  for (const it of items) {
    const unit = num(it.precio_costo);
    if (unit <= 0) { sinCosto += 1; continue; }
    let neto = num(it.cantidad) * unit;
    if (normalizarMoneda(it.costo_moneda) === "USD") {
      // Factura en US$: su TC. Factura en $: dólar BNA del día de la factura.
      const tc = normalizarMoneda(factura.moneda) === "USD" && num(factura.tipo_cambio) > 0 ? num(factura.tipo_cambio) : tcDia(factura.fecha);
      if (!tc) { sinTc = true; continue; }
      neto *= tc;
    }
    const pct = it.iva_porcentaje === null || it.iva_porcentaje === undefined || it.iva_porcentaje === "" ? 21 : num(it.iva_porcentaje);
    const iva = neto * pct / 100;
    sumarNI(costo, { neto, iva, total: neto + iva });
  }
  return { costo: redondearNI(costo), sinCosto, sinTc };
}

export function nivelObjetivo(neto: number): ReporteBasico["objetivo"] {
  const escalones = [
    { nivel: "minimo" as const, nombre: "Mínimo", monto: OBJETIVOS_MES.minimo },
    { nivel: "bueno" as const, nombre: "Bueno", monto: OBJETIVOS_MES.bueno },
    { nivel: "muy_bueno" as const, nombre: "Muy bueno", monto: OBJETIVOS_MES.muyBueno },
  ];
  let nivel: NivelObjetivo = "debajo";
  for (const e of escalones) if (neto >= e.monto) nivel = e.nivel;
  const sig = escalones.find((e) => neto < e.monto);
  return { neto: r2(neto), nivel, proximo: sig ? { nombre: sig.nombre, monto: sig.monto, falta: r2(sig.monto - neto) } : null };
}

/**
 * @param facturas comprobantes de venta del mes (incluidas anuladas: se sacan con su NC)
 * @param origenes facturas de origen de las NC del mes (de cualquier fecha)
 * @param idsAnulados ids de facturas anuladas de cualquier fecha
 * @param items ítems de los PR de las facturas (y de las facturas de origen)
 * @param prNumero número de cada PR (para mostrar)
 */
export function reporteBasico(input: {
  periodo: string;
  facturas: FacturaVentaFL[];
  origenes: FacturaVentaFL[];
  idsAnulados: Iterable<string>;
  items: ItemCostoFL[];
  prNumero: Record<string, string>;
  gastos: GastoFL[];
  tcDia: TcDelDia;
}): ReporteBasico {
  const { periodo, tcDia } = input;
  const itemsPorPr = new Map<string, ItemCostoFL[]>();
  for (const it of input.items) {
    if (!itemsPorPr.has(it.presupuesto_id)) itemsPorPr.set(it.presupuesto_id, []);
    itemsPorPr.get(it.presupuesto_id)!.push(it);
  }
  const origenPorId = new Map<string, FacturaVentaFL>();
  for (const f of [...input.origenes, ...input.facturas]) origenPorId.set(f.id, f);

  const facturado = vacioNI();
  const costoTot = vacioNI();
  const filas: FilaReporte[] = [];
  const avisos: AvisoPr[] = [];
  const sinCotizacion: string[] = [];

  const delMes = filtrarParaGestion(input.facturas, input.idsAnulados)
    .filter((f) => periodoDeFecha(f.fecha) === periodo)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || comprobanteVenta(a).localeCompare(comprobanteVenta(b)));

  for (const f of delMes) {
    const nc = esNotaCredito(f.tipo);
    const signo = nc ? -1 : 1;
    const comp = comprobanteVenta(f);
    const cliente = f.cliente || "";
    const tc = tcComprobante(f.moneda, f.tipo_cambio, f.fecha, tcDia);
    if (!tc) {
      sinCotizacion.push(comp);
      filas.push({ facturaId: f.id, comprobante: comp, fecha: f.fecha, cliente, presupuestoId: f.presupuesto_id ?? null, prNumero: f.presupuesto_id ? input.prNumero[f.presupuesto_id] ?? null : null, esNC: nc, venta: vacioNI(), costo: vacioNI(), aviso: "En US$ sin cotización: no suma" });
      continue;
    }
    const base = netoIvaFactura(f);
    const venta: NetoIva = { neto: base.neto * tc * signo, iva: base.iva * tc * signo, total: base.total * tc * signo };
    sumarNI(facturado, venta);

    // Costo: de su PR (factura) o del PR de la factura de origen, proporcional (NC).
    let costo = vacioNI();
    let aviso: string | null = null;
    const facturaCosto = nc ? (f.factura_origen_id ? origenPorId.get(f.factura_origen_id) : undefined) : f;
    const prId = facturaCosto?.presupuesto_id ?? null;
    if (nc && !facturaCosto) {
      aviso = "NC sin factura de origen: no resta costo";
    } else if (!prId) {
      aviso = nc ? "La factura de origen no tiene PR: no resta costo" : "Factura sin PR: no tiene costo";
    } else {
      const items = itemsPorPr.get(prId) || [];
      const c = costoDelPr(items, facturaCosto!, tcDia);
      let prop = 1;
      if (nc) {
        const netoOrigen = netoIvaFactura(facturaCosto!).neto;
        prop = netoOrigen > 0 ? Math.min(1, base.neto / netoOrigen) : 1;
      }
      costo = { neto: c.costo.neto * prop * signo, iva: c.costo.iva * prop * signo, total: c.costo.total * prop * signo };
      if (!items.length) aviso = "El PR no tiene artículos con costo";
      else if (c.sinCosto) aviso = `${c.sinCosto} artículo${c.sinCosto === 1 ? "" : "s"} del PR sin costo`;
      else if (c.sinTc) aviso = "Costo en US$ sin cotización del día";
    }
    sumarNI(costoTot, costo);
    const prNumero = prId ? input.prNumero[prId] ?? null : null;
    if (aviso) avisos.push({ facturaId: f.id, comprobante: comp, cliente, presupuestoId: prId, prNumero, motivo: aviso });
    filas.push({ facturaId: f.id, comprobante: comp, fecha: f.fecha, cliente, presupuestoId: prId, prNumero, esNC: nc, venta: redondearNI(venta), costo: redondearNI(costo), aviso });
  }

  let fijos = 0, eventuales = 0, enUsdSinCotizacion = 0;
  for (const g of input.gastos) {
    if (periodoDeFecha(g.fecha) !== periodo) continue;
    const tc = tcComprobante(g.moneda, null, g.fecha, tcDia);
    if (!tc) { enUsdSinCotizacion += num(g.monto); continue; }
    const monto = num(g.monto) * tc;
    if (g.tipo_recurrencia === "fijo" || g.gasto_fijo_id) fijos += monto; else eventuales += monto;
  }

  const fact = redondearNI(facturado);
  return {
    facturado: fact,
    costo: redondearNI(costoTot),
    gastos: { fijos: r2(fijos), eventuales: r2(eventuales), total: r2(fijos + eventuales), enUsdSinCotizacion: r2(enUsdSinCotizacion) },
    objetivo: nivelObjetivo(fact.neto),
    filas,
    avisos,
    sinCotizacion,
  };
}

// ── IVA ─────────────────────────────────────────────────────────────

export interface FacturaCompraFL {
  id: string;
  fecha: string;
  tipo_comprobante: string | null;
  estado: string | null;
  moneda: string | null;
  subtotal?: number | string | null;
  iva: number | string | null;
  total?: number | string | null;
  solo_iva?: boolean | null;
  numero_factura?: string | null;
  proveedor?: string | null;
  fecha_vencimiento?: string | null;
  total_acreditado?: number | string | null;
  proveedor_id?: string | null;
  op_facturas_compra?: Array<{ monto: number | string | null; ordenes_pago?: { estado?: string | null } | null }> | null;
}

export interface FilaIva { id: string; fecha: string; comprobante: string; nombre: string; iva: number; soloIva?: boolean; aviso?: string }

export interface IvaMes {
  ventas: { facturas: number; nc: number; debito: number; filas: FilaIva[] };
  compras: { facturas: number; nc: number; credito: number; deSoloIva: number; filas: FilaIva[] };
  /** débito − crédito (positivo = a pagar), solo referencia. */
  diferencia: number;
  sinCotizacion: string[];
}

export function ivaDelMes(input: { periodo: string; ventas: FacturaVentaFL[]; compras: FacturaCompraFL[]; tcDia: TcDelDia }): IvaMes {
  const { periodo, tcDia } = input;
  const sinCotizacion: string[] = [];
  const v = { facturas: 0, nc: 0, debito: 0, filas: [] as FilaIva[] };
  for (const f of input.ventas) {
    if (periodoDeFecha(f.fecha) !== periodo || !incluirEnLibroIVAVentas(f)) continue;
    const comp = comprobanteVenta(f);
    const tc = tcComprobante(f.moneda, f.tipo_cambio, f.fecha, tcDia);
    if (!tc) { sinCotizacion.push(comp); v.filas.push({ id: f.id, fecha: f.fecha, comprobante: comp, nombre: f.cliente || "", iva: 0, aviso: "US$ sin cotización" }); continue; }
    const iva = netoIvaFactura(f).iva * tc;
    if (esNotaCredito(f.tipo)) v.nc += iva; else v.facturas += iva;
    v.filas.push({ id: f.id, fecha: f.fecha, comprobante: comp, nombre: f.cliente || "", iva: r2(esNotaCredito(f.tipo) ? -iva : iva) });
  }
  const c = { facturas: 0, nc: 0, credito: 0, deSoloIva: 0, filas: [] as FilaIva[] };
  for (const f of input.compras) {
    if (periodoDeFecha(f.fecha) !== periodo || !incluirEnLibroIVACompras(f)) continue;
    const comp = `${f.tipo_comprobante || "FC"} ${f.numero_factura || "S/N"}`;
    const tc = tcComprobante(f.moneda, null, f.fecha, tcDia);
    if (!tc) { sinCotizacion.push(comp); c.filas.push({ id: f.id, fecha: f.fecha, comprobante: comp, nombre: f.proveedor || "", iva: 0, aviso: "US$ sin cotización" }); continue; }
    const iva = num(f.iva) * tc;
    const nc = esNotaCredito(f.tipo_comprobante);
    if (nc) c.nc += iva; else c.facturas += iva;
    if (f.solo_iva) c.deSoloIva += nc ? -iva : iva;
    c.filas.push({ id: f.id, fecha: f.fecha, comprobante: comp, nombre: f.proveedor || "", iva: r2(nc ? -iva : iva), soloIva: !!f.solo_iva });
  }
  v.debito = r2(v.facturas - v.nc); v.facturas = r2(v.facturas); v.nc = r2(v.nc);
  c.credito = r2(c.facturas - c.nc); c.facturas = r2(c.facturas); c.nc = r2(c.nc); c.deSoloIva = r2(c.deSoloIva);
  const orden = (a: FilaIva, b: FilaIva) => a.fecha.localeCompare(b.fecha) || a.comprobante.localeCompare(b.comprobante);
  v.filas.sort(orden); c.filas.sort(orden);
  return { ventas: v, compras: c, diferencia: r2(v.debito - c.credito), sinCotizacion };
}

// ── Vencimientos ────────────────────────────────────────────────────

export interface PagoDirectoFC { factura_compra_id: string | null; monto: number | string | null; retencion_ganancias_monto?: number | string | null; anulado?: boolean | null; nota_credito_compra_id?: string | null }

/**
 * Saldo de una factura de compra. Misma regla que `calcularSaldosProveedores` (lib/saldo-proveedores):
 * total − max(total_acreditado, NC aplicadas) − pagos directos (con retención) − OP vigentes. "Pagada" = 0.
 */
export function saldoFacturaCompra(f: FacturaCompraFL, pagosDirectos: PagoDirectoFC[]): number {
  if (f.estado === "anulada" || f.estado === "pagada" || esNotaCredito(f.tipo_comprobante)) return 0;
  let directo = 0, creditoNC = 0;
  for (const p of pagosDirectos) {
    if (p.anulado || p.factura_compra_id !== f.id) continue;
    if (p.nota_credito_compra_id) creditoNC += num(p.monto); else directo += num(p.monto) + num(p.retencion_ganancias_monto);
  }
  const op = (f.op_facturas_compra || []).filter((l) => l?.ordenes_pago && l.ordenes_pago.estado !== "anulada").reduce((s, l) => s + num(l.monto), 0);
  return r2(Math.max(0, num(f.total) - Math.max(num(f.total_acreditado), creditoNC) - directo - op));
}

export interface FilaVencimiento {
  lado: "venta" | "compra";
  id: string;
  /** Vencimiento (o la fecha del comprobante si no tiene). */
  vence: string;
  sinVencimiento: boolean;
  comprobante: string;
  nombre: string;
  moneda: "ARS" | "USD";
  total: number;
  saldo: number;
  /** Días hasta el vencimiento (negativo = vencida). */
  dias: number;
}

const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

export function armarVencimientos(input: {
  hoy: string;
  ventas: (FacturaVentaFL & { fecha_vencimiento?: string | null })[];
  /** Cobrado por factura de venta (cobradoPorFactura de lib/saldo-clientes). */
  saldoVenta: (f: FacturaVentaFL) => number;
  compras: FacturaCompraFL[];
  pagosDirectos: PagoDirectoFC[];
}): FilaVencimiento[] {
  const out: FilaVencimiento[] = [];
  for (const f of input.ventas) {
    const saldo = input.saldoVenta(f);
    if (saldo <= 0.005) continue;
    const vence = String(f.fecha_vencimiento || f.fecha).slice(0, 10);
    out.push({ lado: "venta", id: f.id, vence, sinVencimiento: !f.fecha_vencimiento, comprobante: comprobanteVenta(f), nombre: f.cliente || "", moneda: normalizarMoneda(f.moneda), total: num(f.total), saldo, dias: diasEntre(input.hoy, vence) });
  }
  const porFactura = new Map<string, PagoDirectoFC[]>();
  for (const p of input.pagosDirectos) {
    if (!p.factura_compra_id) continue;
    if (!porFactura.has(p.factura_compra_id)) porFactura.set(p.factura_compra_id, []);
    porFactura.get(p.factura_compra_id)!.push(p);
  }
  for (const f of input.compras) {
    const saldo = saldoFacturaCompra(f, porFactura.get(f.id) || []);
    if (saldo <= 0.005) continue;
    const vence = String(f.fecha_vencimiento || f.fecha).slice(0, 10);
    out.push({ lado: "compra", id: f.id, vence, sinVencimiento: !f.fecha_vencimiento, comprobante: `${f.tipo_comprobante || "FC"} ${f.numero_factura || "S/N"}`, nombre: f.proveedor || "", moneda: normalizarMoneda(f.moneda), total: num(f.total), saldo, dias: diasEntre(input.hoy, vence) });
  }
  return out.sort((a, b) => a.vence.localeCompare(b.vence) || a.lado.localeCompare(b.lado) || a.nombre.localeCompare(b.nombre));
}
