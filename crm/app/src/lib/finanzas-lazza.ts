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
  cliente_id?: string | null;
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
  /** Neto de venta − neto de costo − gastos del mes (Augusto 18/10). */
  resultado: number;
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
    resultado: r2(fact.neto - r2(costoTot.neto) - r2(fijos + eventuales)),
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
  /** Cliente o proveedor. */
  entidadId: string | null;
  /** Fecha de la factura. */
  fecha: string;
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

export interface FiltroVencimientos {
  lado?: "todo" | "venta" | "compra";
  /** Busca en comprobante y cliente/proveedor (sin acentos ni mayúsculas). */
  texto?: string;
  moneda?: "" | "ARS" | "USD";
  situacion?: "" | "vencidas" | "por_vencer";
  /** Rango de fechas sobre la fecha de la factura o sobre el vencimiento. */
  campoFecha?: "fecha" | "vence";
  desde?: string;
  hasta?: string;
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarVencimientos(filas: FilaVencimiento[], f: FiltroVencimientos): FilaVencimiento[] {
  const q = sinAcentos((f.texto || "").trim());
  const campo = f.campoFecha || "vence";
  return filas.filter((x) => {
    if (f.lado && f.lado !== "todo" && x.lado !== f.lado) return false;
    if (f.moneda && x.moneda !== f.moneda) return false;
    if (f.situacion === "vencidas" && x.dias >= 0) return false;
    if (f.situacion === "por_vencer" && x.dias < 0) return false;
    if (f.desde && x[campo] < f.desde) return false;
    if (f.hasta && x[campo] > f.hasta) return false;
    if (q && !sinAcentos(`${x.comprobante} ${x.nombre}`).includes(q)) return false;
    return true;
  });
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
    out.push({ lado: "venta", id: f.id, entidadId: f.cliente_id ?? null, fecha: String(f.fecha).slice(0, 10), vence, sinVencimiento: !f.fecha_vencimiento, comprobante: comprobanteVenta(f), nombre: f.cliente || "", moneda: normalizarMoneda(f.moneda), total: num(f.total), saldo, dias: diasEntre(input.hoy, vence) });
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
    out.push({ lado: "compra", id: f.id, entidadId: f.proveedor_id ?? null, fecha: String(f.fecha).slice(0, 10), vence, sinVencimiento: !f.fecha_vencimiento, comprobante: `${f.tipo_comprobante || "FC"} ${f.numero_factura || "S/N"}`, nombre: f.proveedor || "", moneda: normalizarMoneda(f.moneda), total: num(f.total), saldo, dias: diasEntre(input.hoy, vence) });
  }
  return out.sort((a, b) => a.vence.localeCompare(b.vence) || a.lado.localeCompare(b.lado) || a.nombre.localeCompare(b.nombre));
}

// ── Cuentas corrientes (clientes y proveedores en una sola lista) ───

export type Semaforo = "verde" | "amarillo" | "rojo" | "gris";

export interface FilaCuentaCorriente {
  /** "c-<id>" o "p-<id>" (único en la lista). */
  id: string;
  lado: "cliente" | "proveedor";
  entidadId: string;
  nombre: string;
  cuit: string;
  /** Positivo = nos debe (cliente) / le debemos (proveedor); negativo = a favor. */
  saldo: { ARS: number; USD: number };
  vencido: { ARS: number; USD: number };
  facturas: number;
  proximoVencimiento: string | null;
  bcra: Semaforo | null;
}

export function armarCuentasCorrientes(input: {
  clientes: { id: string; razon_social: string | null; cuit?: string | null }[];
  proveedores: { id: string; razon_social: string | null; cuit?: string | null }[];
  saldosClientes: Record<string, { ARS: { saldo: number }; USD: { saldo: number } }>;
  saldosProveedores: Record<string, { ARS: number; USD: number }>;
  vencimientos: FilaVencimiento[];
  bcraClientes?: Record<string, Semaforo>;
  bcraProveedores?: Record<string, Semaforo>;
}): FilaCuentaCorriente[] {
  const extra = new Map<string, { vencido: { ARS: number; USD: number }; facturas: number; proximo: string | null }>();
  for (const v of input.vencimientos) {
    if (!v.entidadId) continue;
    const k = `${v.lado === "venta" ? "c" : "p"}-${v.entidadId}`;
    const e = extra.get(k) || { vencido: { ARS: 0, USD: 0 }, facturas: 0, proximo: null };
    e.facturas += 1;
    if (v.dias < 0) e.vencido[v.moneda] += v.saldo;
    else if (!e.proximo || v.vence < e.proximo) e.proximo = v.vence;
    extra.set(k, e);
  }
  const fila = (lado: "cliente" | "proveedor", ent: { id: string; razon_social: string | null; cuit?: string | null }, saldo: { ARS: number; USD: number }, bcra: Semaforo | null): FilaCuentaCorriente => {
    const id = `${lado === "cliente" ? "c" : "p"}-${ent.id}`;
    const e = extra.get(id);
    return {
      id, lado, entidadId: ent.id, nombre: ent.razon_social || "Sin nombre", cuit: ent.cuit || "",
      saldo: { ARS: r2(saldo.ARS), USD: r2(saldo.USD) },
      vencido: { ARS: r2(e?.vencido.ARS || 0), USD: r2(e?.vencido.USD || 0) },
      facturas: e?.facturas || 0, proximoVencimiento: e?.proximo ?? null, bcra,
    };
  };
  const out: FilaCuentaCorriente[] = [];
  for (const c of input.clientes) {
    const s = input.saldosClientes[c.id];
    out.push(fila("cliente", c, { ARS: s?.ARS.saldo || 0, USD: s?.USD.saldo || 0 }, input.bcraClientes?.[c.id] ?? null));
  }
  for (const p of input.proveedores) {
    const s = input.saldosProveedores[p.id];
    out.push(fila("proveedor", p, { ARS: s?.ARS || 0, USD: s?.USD || 0 }, input.bcraProveedores?.[p.id] ?? null));
  }
  return out;
}

/** Con saldo distinto de cero (en cualquier moneda). */
export const tieneSaldo = (f: FilaCuentaCorriente) => Math.abs(f.saldo.ARS) >= 0.01 || Math.abs(f.saldo.USD) >= 0.01;

/** Último informe BCRA que no sea "gris" (error) por entidad; las filas vienen del más nuevo al más viejo. */
export function semaforoPorEntidad(filas: { entidad_id: string | null; semaforo: string | null }[]): Record<string, Semaforo> {
  const out: Record<string, Semaforo> = {};
  for (const f of filas) {
    if (!f.entidad_id || out[f.entidad_id] || !f.semaforo || f.semaforo === "gris") continue;
    if (f.semaforo === "verde" || f.semaforo === "amarillo" || f.semaforo === "rojo") out[f.entidad_id] = f.semaforo;
  }
  return out;
}

// ── Retenciones (practicadas y sufridas) ────────────────────────────

export interface FilaRetencion {
  id: string;
  fecha: string;
  /** Practicada = la hicimos nosotros al pagar; sufrida = nos la hizo un cliente al cobrar. */
  lado: "practicada" | "sufrida";
  impuesto: string;
  origen: string;
  nombre: string;
  cuit: string;
  base: number | null;
  pct: number | null;
  monto: number;
  moneda: "ARS" | "USD";
}

const IMPUESTO: Record<string, string> = { retencion_ganancias: "Ganancias", retencion_iva: "IVA", retencion_iibb: "IIBB", retencion_suss: "SUSS" };

/**
 * Misma regla que Finanzas → Retenciones: OP no anuladas con retención de Ganancias + pagos directos (tipo pago)
 * con retención. Además, las sufridas: movimientos retencion_* de un cliente, no anulados.
 */
export function armarRetenciones(input: {
  ops: { id: string; numero?: string | number | null; fecha: string; estado?: string | null; moneda?: string | null; retencion_ganancias_monto?: number | string | null; retencion_ganancias_pct?: number | string | null; base_retencion_ganancias?: number | string | null; proveedores?: { razon_social?: string | null; cuit?: string | null } | null }[];
  movimientos: { id: string; tipo: string | null; fecha: string; monto: number | string | null; moneda?: string | null; anulado?: boolean | null; descripcion?: string | null; cliente_id?: string | null; proveedor_id?: string | null; retencion_ganancias_monto?: number | string | null; retencion_ganancias_pct?: number | string | null; base_retencion_ganancias?: number | string | null; clientes?: { razon_social?: string | null; cuit?: string | null } | null; proveedores?: { razon_social?: string | null; cuit?: string | null } | null }[];
}): FilaRetencion[] {
  const out: FilaRetencion[] = [];
  const nulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  for (const op of input.ops) {
    if (op.estado === "anulada" || num(op.retencion_ganancias_monto) <= 0) continue;
    out.push({ id: `op-${op.id}`, fecha: String(op.fecha).slice(0, 10), lado: "practicada", impuesto: "Ganancias", origen: `OP ${op.numero ?? ""}`.trim(),
      nombre: op.proveedores?.razon_social || "", cuit: op.proveedores?.cuit || "", base: nulo(op.base_retencion_ganancias), pct: nulo(op.retencion_ganancias_pct),
      monto: num(op.retencion_ganancias_monto), moneda: normalizarMoneda(op.moneda) });
  }
  for (const m of input.movimientos) {
    if (m.anulado) continue;
    if (m.tipo === "pago" && num(m.retencion_ganancias_monto) > 0) {
      out.push({ id: `pd-${m.id}`, fecha: String(m.fecha).slice(0, 10), lado: "practicada", impuesto: "Ganancias", origen: "Pago directo",
        nombre: m.proveedores?.razon_social || "", cuit: m.proveedores?.cuit || "", base: nulo(m.base_retencion_ganancias), pct: nulo(m.retencion_ganancias_pct),
        monto: num(m.retencion_ganancias_monto), moneda: normalizarMoneda(m.moneda) });
    } else if (String(m.tipo || "").startsWith("retencion_") && m.cliente_id) {
      out.push({ id: `rs-${m.id}`, fecha: String(m.fecha).slice(0, 10), lado: "sufrida", impuesto: IMPUESTO[String(m.tipo)] || String(m.tipo), origen: m.descripcion || "",
        nombre: m.clientes?.razon_social || "", cuit: m.clientes?.cuit || "", base: null, pct: null, monto: num(m.monto), moneda: normalizarMoneda(m.moneda) });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
