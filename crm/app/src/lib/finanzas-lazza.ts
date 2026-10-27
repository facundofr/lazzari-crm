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
 * (facturas de compra no anuladas; las NC de compra restan) y del IVA de las comisiones del banco.
 * Estimado (arreglo 16, 27/10/2026): menos las retenciones de IVA sufridas con N° de certificado; las que no lo tienen
 * y las percepciones (IVA e IIBB juntos) van aparte. Los VEP de IVA de Gastos se comparan con el estimado. Solo referencia.
 * Vencimientos: facturas de venta y de compra con saldo, por fecha de vencimiento.
 *
 * Prueba: npx tsx scripts/test-finanzas-lazza.ts
 */
import { esNotaCredito, filtrarParaGestion, incluirEnLibroIVACompras, incluirEnLibroIVAVentas, normalizarMoneda, periodoDeFecha, sumarMeses } from "./reportes-comprobantes";
import { clasificarMovimiento, type LineaMov } from "./movimientos-banco";
import { sinCodigoBanco } from "./bbva-codigos";

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
  /** IVA, IIBB y otras percepciones en un solo número (la base no las separa). */
  percepciones?: number | string | null;
  total?: number | string | null;
  solo_iva?: boolean | null;
  numero_factura?: string | null;
  proveedor?: string | null;
  fecha_vencimiento?: string | null;
  total_acreditado?: number | string | null;
  proveedor_id?: string | null;
  op_facturas_compra?: Array<{ monto: number | string | null; ordenes_pago?: { estado?: string | null } | null }> | null;
}

/** Renglón de los "Ver …" de la pantalla IVA. `iva` es el importe del renglón: IVA, retención, percepción o VEP. */
export interface FilaIva { id: string; fecha: string; comprobante: string; nombre: string; iva: number; soloIva?: boolean; aviso?: string }

/** Retención de IVA que nos hizo un cliente (movimiento retencion_iva con cliente). */
export interface RetencionIvaFL { id: string; fecha: string; monto: number | string | null; moneda?: string | null; anulado?: boolean | null; descripcion?: string | null; cliente?: string | null }

/** Gasto de Gastos (ahí se cargan los VEP pagados). */
export interface GastoVepFL { id: string; fecha: string; monto: number | string | null; moneda?: string | null; descripcion?: string | null }

export interface IvaMes {
  ventas: { facturas: number; nc: number; debito: number; filas: FilaIva[] };
  /** crédito = facturas − NC + banco (IVA de las comisiones del banco, menos sus devoluciones). */
  compras: { facturas: number; nc: number; banco: number; credito: number; deSoloIva: number; filas: FilaIva[]; filasBanco: FilaIva[] };
  /** débito − crédito (positivo = a pagar). */
  diferencia: number;
  /** Retenciones de IVA sufridas en el mes: se restan solo las que tienen N° de certificado. */
  retenciones: { conCertificado: number; sinCertificado: number; filas: FilaIva[] };
  /** diferencia − retenciones con certificado: positivo = a pagar, negativo = a favor. Sin saldo de meses anteriores. */
  estimado: number;
  /**
   * VEP de IVA de este período cargados en Gastos. diferencia = pagado − estimado (null sin VEP); coincide = menos de
   * TOLERANCIA_VEP_IVA de diferencia. sinImpuesto = VEP del mes siguiente que no dicen qué impuesto pagaron.
   */
  vep: { pagado: number; filas: FilaIva[]; diferencia: number | null; coincide: boolean; sinImpuesto: { monto: number; filas: FilaIva[] } };
  /** Percepciones de las facturas de compra del mes (IVA e IIBB en un solo número): aparte, no se restan. */
  percepciones: { monto: number; filas: FilaIva[] };
  sinCotizacion: string[];
}

/** Diferencia entre el VEP y el estimado que se toma como redondeo ($). */
export const TOLERANCIA_VEP_IVA = 1000;

const MESES_IVA = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** N° de certificado: dígitos y guiones, con hasta 3 letras adelante ("RG 16418" de Limagrain). Una fecha ("15/10") no es N°. */
const NRO_CERTIFICADO = /^((?:[A-Z]{1,3} ?)?\d(?:[\d-]*\d)?)(?![\d/])/;
const SOLO_NRO_CERTIFICADO = /^(?:[A-Z]{1,3} ?)?\d(?:[\d-]*\d)?$/;

/**
 * N° de certificado escrito en la descripción de una retención sufrida (la base no tiene columna de certificado):
 * - "certificado 0000-00074421", "Cert: 34539", "Cert. N° 777", "certificado RG 16418";
 * - cobro en US$ (fx_settlements): "Cobro FX — retencion_iibb 000000001115 | TC 1530 del 2026-10-03";
 * - el N° al principio: "0000-00002291 — TERMO CORDOBA SAU — Retención Impuesto a las Ganancias …".
 * null si no dice ninguno o dice que falta ("certificado pendiente", "Cert. A CONFIRMAR", "a pedir", "certificado 15/10").
 */
export function certificadoDeRetencion(descripcion: string | null | undefined): string | null {
  const t = String(descripcion || "");
  for (const m of t.matchAll(/\bcert(?:ificado)?\b\.?\s*(?:n(?:ro|°|º)?\.?\s*)?:?\s*/gi)) {
    const nro = t.slice((m.index ?? 0) + m[0].length).match(NRO_CERTIFICADO);
    if (nro) return nro[1];
  }
  const fx = t.match(/—\s*retencion_[a-z]+\s+(.+?)\s*\|\s*TC\b/)?.[1];
  if (fx && SOLO_NRO_CERTIFICADO.test(fx)) return fx;
  return t.match(/^\s*(?!\d{4}-\d{2}-\d{2}\b)(\d[\d-]*\d)\s+—/)?.[1] ?? null;
}

/** Período escrito en un texto sin acentos: "período 09/2026", "09/2026", "septiembre 2026" o "2026-09". Las fechas no cuentan. */
function periodoEscrito(t: string): string | null {
  const armar = (mes: number, anio: string) => (mes >= 1 && mes <= 12 ? `${anio}-${String(mes).padStart(2, "0")}` : null);
  let m = t.match(/periodo\s*:?\s*(\d{1,2})[/-](20\d{2})\b/) || t.match(/(?:^|[^\d/])(\d{1,2})[/-](20\d{2})\b/);
  if (m) return armar(Number(m[1]), m[2]);
  m = t.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/);
  if (m) return armar(m[1] === "setiembre" ? 9 : MESES_IVA.indexOf(m[1]) + 1, m[2]);
  m = t.match(/\b(20\d{2})-(\d{2})\b(?!-\d)/);
  return m ? armar(Number(m[2]), m[1]) : null;
}

/**
 * Período (YYYY-MM) del IVA que pagó un gasto, o null si no es un VEP de IVA.
 * Es VEP de IVA si dice IVA y VEP, ARCA, AFIP, DDJJ o F.2002 (no cuentan "Compra crédito fiscal IVA" ni planes de pago).
 * El período es el escrito; si no dice, el mes anterior al pago (el IVA se paga el mes siguiente).
 */
export function periodoVepIva(g: Pick<GastoVepFL, "fecha" | "descripcion">): string | null {
  const t = sinAcentos(String(g.descripcion || ""));
  if (!/\biva\b/.test(t) || !/\b(vep|arca|afip|ddjj)\b|f\.?\s?2002/.test(t) || /credito fiscal|\bcompra\b|plan de (pagos|facilidades)|\bcuota\b/.test(t)) return null;
  const pago = periodoDeFecha(g.fecha);
  return periodoEscrito(t) ?? (pago ? sumarMeses(pago, -1) : null);
}

/** VEP que no dice qué impuesto pagó ("ARCA VEP — pago 17/09 (BBVA OP8721)"): se completa con «Leer VEP (IA)» en Gastos. */
export function esVepSinImpuesto(descripcion: string | null | undefined): boolean {
  const t = sinAcentos(String(descripcion || ""));
  return /\bvep\b/.test(t)
    && !/\b(iva|sicore|sire|ganancias|autonomos|iibb|ingresos brutos|arba|bienes personales|monotributo|suss|seguridad social|anticipo|plan|credito fiscal)\b|f\.?\s?931\b/.test(t);
}

export function ivaDelMes(input: {
  periodo: string; ventas: FacturaVentaFL[]; compras: FacturaCompraFL[]; tcDia: TcDelDia;
  /** A cuenta del mes (arreglo 16). Sin esto, el estimado es débito − crédito de las facturas, como antes. */
  retenciones?: RetencionIvaFL[]; lineasBanco?: LineaMov[]; gastos?: GastoVepFL[];
}): IvaMes {
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
  const c = { facturas: 0, nc: 0, banco: 0, credito: 0, deSoloIva: 0, filas: [] as FilaIva[], filasBanco: [] as FilaIva[] };
  const percepciones = { monto: 0, filas: [] as FilaIva[] };
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
    const perc = num(f.percepciones) * tc * (nc ? -1 : 1);
    if (perc) { percepciones.monto += perc; percepciones.filas.push({ id: f.id, fecha: f.fecha, comprobante: comp, nombre: f.proveedor || "", iva: r2(perc) }); }
  }
  // IVA de las comisiones del banco (la misma clasificación que Bancos > Ver por tipo): es crédito fiscal; una devolución resta.
  for (const l of input.lineasBanco || []) {
    if (periodoDeFecha(l.fecha) !== periodo) continue;
    const cl = clasificarMovimiento(l);
    if (cl.tipo !== "impuestos_comisiones" || cl.categoria !== "IVA") continue;
    const iva = Math.abs(num(l.monto)) * (cl.devolucion ? -1 : 1);
    c.banco += iva;
    c.filasBanco.push({ id: l.id, fecha: l.fecha, comprobante: cl.devolucion ? "Devolución" : "Banco", nombre: sinCodigoBanco(l.descripcion), iva: r2(iva) });
  }
  // Retenciones de IVA que nos hicieron los clientes: sin N° de certificado no se restan (Augusto 27/10).
  const retenciones = { conCertificado: 0, sinCertificado: 0, filas: [] as FilaIva[] };
  for (const m of input.retenciones || []) {
    if (m.anulado || periodoDeFecha(m.fecha) !== periodo) continue;
    const cert = certificadoDeRetencion(m.descripcion);
    const fila: FilaIva = { id: m.id, fecha: m.fecha, comprobante: cert ? `Cert. ${cert}` : "Sin certificado", nombre: m.cliente || "", iva: 0, aviso: cert ? undefined : "no se resta" };
    const tc = tcComprobante(m.moneda, null, m.fecha, tcDia);
    if (!tc) { sinCotizacion.push(`Retención ${fila.nombre}`.trim()); retenciones.filas.push({ ...fila, aviso: "US$ sin cotización" }); continue; }
    fila.iva = r2(num(m.monto) * tc);
    if (cert) retenciones.conCertificado += fila.iva; else retenciones.sinCertificado += fila.iva;
    retenciones.filas.push(fila);
  }
  // VEP de IVA de este período (se pagan el mes siguiente) y VEP del mes siguiente que no dicen qué impuesto pagaron.
  const vep = { pagado: 0, filas: [] as FilaIva[], diferencia: null as number | null, coincide: false, sinImpuesto: { monto: 0, filas: [] as FilaIva[] } };
  const mesDePago = sumarMeses(periodo, 1);
  for (const g of input.gastos || []) {
    const deEste = periodoVepIva(g) === periodo;
    if (!deEste && !(periodoDeFecha(g.fecha) === mesDePago && esVepSinImpuesto(g.descripcion))) continue;
    const tc = tcComprobante(g.moneda, null, g.fecha, tcDia);
    if (!tc) { sinCotizacion.push(g.descripcion || "VEP"); continue; }
    const fila: FilaIva = { id: g.id, fecha: g.fecha, comprobante: "VEP", nombre: g.descripcion || "", iva: r2(num(g.monto) * tc) };
    if (deEste) { vep.pagado += fila.iva; vep.filas.push(fila); } else { vep.sinImpuesto.monto += fila.iva; vep.sinImpuesto.filas.push(fila); }
  }
  v.debito = r2(v.facturas - v.nc); v.facturas = r2(v.facturas); v.nc = r2(v.nc);
  c.credito = r2(c.facturas - c.nc + c.banco); c.facturas = r2(c.facturas); c.nc = r2(c.nc); c.banco = r2(c.banco); c.deSoloIva = r2(c.deSoloIva);
  const diferencia = r2(v.debito - c.credito);
  retenciones.conCertificado = r2(retenciones.conCertificado); retenciones.sinCertificado = r2(retenciones.sinCertificado);
  const estimado = r2(diferencia - retenciones.conCertificado);
  vep.pagado = r2(vep.pagado); vep.sinImpuesto.monto = r2(vep.sinImpuesto.monto);
  if (vep.filas.length) { vep.diferencia = r2(vep.pagado - estimado); vep.coincide = Math.abs(vep.diferencia) < TOLERANCIA_VEP_IVA; }
  percepciones.monto = r2(percepciones.monto);
  const orden = (a: FilaIva, b: FilaIva) => a.fecha.localeCompare(b.fecha) || a.comprobante.localeCompare(b.comprobante);
  for (const filas of [v.filas, c.filas, c.filasBanco, retenciones.filas, vep.filas, vep.sinImpuesto.filas, percepciones.filas]) filas.sort(orden);
  return { ventas: v, compras: c, diferencia, retenciones, estimado, vep, percepciones, sinCotizacion };
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

/**
 * Saldo de centavos (arreglo 25, 27/10/2026): tiene saldo, pero menos de `tope` pesos en cada moneda (los US$ al dólar
 * `tc`; sin dólar, un saldo en US$ nunca cuenta como chico). Cuentas corrientes los oculta con "Ocultar menores a $ 100".
 */
export const saldoMenorA = (f: FilaCuentaCorriente, tc: number, tope = 100) => tieneSaldo(f) && Math.abs(f.saldo.ARS) < tope
  && (Math.abs(f.saldo.USD) < 0.01 || (tc > 0 && Math.abs(f.saldo.USD) * tc < tope));

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
  /** Corto: "OP-000083", "Pago directo" o, en las sufridas, "Recibo 1041" (arreglo 14). */
  origen: string;
  nombre: string;
  cuit: string;
  base: number | null;
  pct: number | null;
  monto: number;
  moneda: "ARS" | "USD";
  /** Sufridas: N° de certificado escrito en el texto (`certificadoDeRetencion`). En las practicadas no se usa. */
  certificado: string | null;
  /** Sufrida sin N° de certificado: sin el certificado no se puede computar. */
  faltaCertificado: boolean;
  /** Recibo del cobro en que entró la retención sufrida (para abrir su PDF). */
  recibo: { id: string; numero: number } | null;
  /** Texto completo de la retención sufrida: se ve al pasar el mouse, se busca y va al Excel. */
  detalle: string;
}

const IMPUESTO: Record<string, string> = { retencion_ganancias: "Ganancias", retencion_iva: "IVA", retencion_iibb: "IIBB", retencion_suss: "SUSS" };

/**
 * Misma regla que Finanzas → Retenciones: OP no anuladas con retención de Ganancias + pagos directos (tipo pago)
 * con retención. Además, las sufridas: movimientos retencion_* de un cliente, no anulados, con su N° de certificado
 * y su recibo (`recibos`: movimiento → recibo, de recibo_movimientos).
 */
export function armarRetenciones(input: {
  ops: { id: string; numero?: string | number | null; fecha: string; estado?: string | null; moneda?: string | null; retencion_ganancias_monto?: number | string | null; retencion_ganancias_pct?: number | string | null; base_retencion_ganancias?: number | string | null; proveedores?: { razon_social?: string | null; cuit?: string | null } | null }[];
  movimientos: { id: string; tipo: string | null; fecha: string; monto: number | string | null; moneda?: string | null; anulado?: boolean | null; descripcion?: string | null; cliente_id?: string | null; proveedor_id?: string | null; retencion_ganancias_monto?: number | string | null; retencion_ganancias_pct?: number | string | null; base_retencion_ganancias?: number | string | null; clientes?: { razon_social?: string | null; cuit?: string | null } | null; proveedores?: { razon_social?: string | null; cuit?: string | null } | null }[];
  recibos?: Record<string, { id: string; numero: number }>;
}): FilaRetencion[] {
  const out: FilaRetencion[] = [];
  const nulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : num(v));
  const practicada = { certificado: null, faltaCertificado: false, recibo: null, detalle: "" };
  for (const op of input.ops) {
    if (op.estado === "anulada" || num(op.retencion_ganancias_monto) <= 0) continue;
    // El N° ya viene como "OP-000083" (antes se veía "OP OP-000083").
    const nro = String(op.numero ?? "").trim();
    out.push({ id: `op-${op.id}`, fecha: String(op.fecha).slice(0, 10), lado: "practicada", impuesto: "Ganancias", origen: /^op\b/i.test(nro) ? nro : `OP ${nro}`.trim(),
      nombre: op.proveedores?.razon_social || "", cuit: op.proveedores?.cuit || "", base: nulo(op.base_retencion_ganancias), pct: nulo(op.retencion_ganancias_pct),
      monto: num(op.retencion_ganancias_monto), moneda: normalizarMoneda(op.moneda), ...practicada });
  }
  for (const m of input.movimientos) {
    if (m.anulado) continue;
    if (m.tipo === "pago" && num(m.retencion_ganancias_monto) > 0) {
      out.push({ id: `pd-${m.id}`, fecha: String(m.fecha).slice(0, 10), lado: "practicada", impuesto: "Ganancias", origen: "Pago directo",
        nombre: m.proveedores?.razon_social || "", cuit: m.proveedores?.cuit || "", base: nulo(m.base_retencion_ganancias), pct: nulo(m.retencion_ganancias_pct),
        monto: num(m.retencion_ganancias_monto), moneda: normalizarMoneda(m.moneda), ...practicada });
    } else if (String(m.tipo || "").startsWith("retencion_") && m.cliente_id) {
      const certificado = certificadoDeRetencion(m.descripcion);
      const recibo = input.recibos?.[m.id] ?? null;
      out.push({ id: `rs-${m.id}`, fecha: String(m.fecha).slice(0, 10), lado: "sufrida", impuesto: IMPUESTO[String(m.tipo)] || String(m.tipo), origen: recibo ? `Recibo ${recibo.numero}` : "",
        nombre: m.clientes?.razon_social || "", cuit: m.clientes?.cuit || "", base: null, pct: null, monto: num(m.monto), moneda: normalizarMoneda(m.moneda),
        certificado, faltaCertificado: !certificado, recibo, detalle: String(m.descripcion || "") });
    }
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Una quincena o el mes entero de un período "YYYY-MM": 1ª del 1 al 15, 2ª del 16 al último día (arreglo 15). */
export function rangoQuincena(mes: string, cual: "primera" | "segunda" | "mes"): { desde: string; hasta: string } {
  const ultimo = String(new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0");
  if (cual === "primera") return { desde: `${mes}-01`, hasta: `${mes}-15` };
  return { desde: `${mes}-${cual === "segunda" ? "16" : "01"}`, hasta: `${mes}-${ultimo}` };
}

export interface TramoQuincena { cual: "primera" | "segunda" | "mes"; desde: string; hasta: string; cantidad: number; total: { ARS: number; USD: number } }

/**
 * Retenciones practicadas de un mes por quincena (arreglo 15, 27/10/2026): la 1ª (1 al 15) es el pago a cuenta,
 * la 2ª va del 16 a fin de mes y el mes entero es lo que se presenta en el SICORE.
 */
export function practicadasPorQuincena(filas: FilaRetencion[], mes: string): TramoQuincena[] {
  return (["primera", "segunda", "mes"] as const).map((cual) => {
    const { desde, hasta } = rangoQuincena(mes, cual);
    const de = filas.filter((r) => r.lado === "practicada" && r.fecha >= desde && r.fecha <= hasta);
    const total = { ARS: 0, USD: 0 };
    for (const r of de) total[r.moneda] = r2(total[r.moneda] + r.monto);
    return { cual, desde, hasta, cantidad: de.length, total };
  });
}

const ORDEN_IMPUESTO = ["IVA", "Ganancias", "IIBB", "SUSS"];

export interface TotalRetencion { impuesto: string; moneda: "ARS" | "USD"; cantidad: number; monto: number; faltan: number; montoFalta: number }

/** Total por impuesto (IVA, Ganancias, IIBB, SUSS) y moneda, con lo que falta certificar (arreglo 14). */
export function totalesRetenciones(filas: FilaRetencion[]): TotalRetencion[] {
  const por = new Map<string, TotalRetencion>();
  for (const r of filas) {
    const k = `${r.impuesto}|${r.moneda}`;
    const t = por.get(k) || { impuesto: r.impuesto, moneda: r.moneda, cantidad: 0, monto: 0, faltan: 0, montoFalta: 0 };
    t.cantidad += 1;
    t.monto = r2(t.monto + r.monto);
    if (r.faltaCertificado) { t.faltan += 1; t.montoFalta = r2(t.montoFalta + r.monto); }
    por.set(k, t);
  }
  const orden = (i: string) => (ORDEN_IMPUESTO.includes(i) ? ORDEN_IMPUESTO.indexOf(i) : ORDEN_IMPUESTO.length);
  return [...por.values()].sort((a, b) => orden(a.impuesto) - orden(b.impuesto) || a.impuesto.localeCompare(b.impuesto) || a.moneda.localeCompare(b.moneda));
}

const ddmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * Excel de retenciones sufridas para el contador (arreglo 14): un renglón por retención, con el N° de certificado
 * o "falta", y abajo el total por impuesto con certificado, falta certificado y total. Los montos van como número.
 */
export function excelRetencionesSufridas(filas: FilaRetencion[]): (string | number)[][] {
  const conUSD = filas.some((r) => r.moneda === "USD");
  const signo = (m: "ARS" | "USD") => (m === "USD" ? "US$" : "$");
  const out: (string | number)[][] = [["Fecha", "Impuesto", "Cliente", "CUIT", "Certificado", "Recibo", ...(conUSD ? ["Moneda"] : []), "Retenido", "Detalle completo"]];
  for (const r of filas) out.push([ddmmaaaa(r.fecha), r.impuesto, r.nombre, r.cuit, r.certificado || "falta", r.recibo?.numero ?? "", ...(conUSD ? [signo(r.moneda)] : []), r.monto, r.detalle]);
  const totales = totalesRetenciones(filas);
  out.push([], ["Impuesto", "Con certificado", "Falta certificado", "Total"]);
  for (const t of totales) out.push([conUSD ? `${t.impuesto} (${signo(t.moneda)})` : t.impuesto, r2(t.monto - t.montoFalta), t.montoFalta, t.monto]);
  for (const m of ["ARS", "USD"] as const) {
    const de = totales.filter((t) => t.moneda === m);
    if (!de.length) continue;
    const suma = (f: (t: TotalRetencion) => number) => r2(de.reduce((s, t) => s + f(t), 0));
    out.push([conUSD ? `Total (${signo(m)})` : "Total", suma((t) => t.monto - t.montoFalta), suma((t) => t.montoFalta), suma((t) => t.monto)]);
  }
  return out;
}

// ── Cuentas corrientes en una sola moneda (Augusto 19/10/2026) ─────────
/**
 * Pasa el saldo de una cuenta a SU moneda, solo para mostrar: cliente con ficha "USD Divisa" → todo en US$ al
 * dólar divisa; "USD" (billete) → todo en US$ al billete; pesos o sin ficha (y proveedores) → todo en $ al divisa.
 * Sin dólar del tipo que corresponde usa el otro; sin ninguno devuelve el saldo como está.
 */
export function unificarMoneda(m: { ARS: number; USD: number }, monedaFicha: string | null | undefined, tc: { billete: number | null; divisa: number | null }): { ARS: number; USD: number } {
  const f = String(monedaFicha || "").trim().toLowerCase();
  const enUsd = f.startsWith("usd");
  const divisa = f.includes("divisa");
  const t = (enUsd && !divisa ? (tc.billete || tc.divisa) : (tc.divisa || tc.billete)) || 0;
  if (!(t > 0)) return { ...m };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return enUsd ? { ARS: 0, USD: r2(m.USD + m.ARS / t) } : { ARS: r2(m.ARS + m.USD * t), USD: 0 };
}

// ── Vencimientos editables (Augusto 19/10/2026) ──────────────────────
/** Fecha + días (AAAA-MM-DD). */
export function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha.slice(0, 10)}T12:00:00Z`) + Math.round(dias) * 86_400_000).toISOString().slice(0, 10);
}

/** La fila con un vencimiento nuevo (recalcula los días que faltan). */
export function conVencimiento(f: FilaVencimiento, vence: string, hoy: string): FilaVencimiento {
  return { ...f, vence, sinVencimiento: false, dias: diasEntre(hoy, vence) };
}

// ── Cobrar (19/10/2026): facturas de un cliente que se pueden cobrar ──
// Misma regla de saldo que Cuentas corrientes / Finanzas (saldoFacturaVenta); sin NC ni anuladas; de la más vieja a la más nueva.

export interface FacturaACobrar {
  id: string;
  numero: string;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  total_acreditado: number;
  saldo: number;
  moneda: "ARS" | "USD";
  tipo_cambio?: number;
}

export function facturasACobrar(
  facturas: { id: string; tipo?: string | null; punto_venta?: number | null; numero?: string | number | null; fecha: string; estado?: string | null; moneda?: string | null; subtotal?: number | null; iva?: number | null; total?: number | null; total_acreditado?: number | null; tipo_cambio?: number | null }[],
  cobrado: Record<string, number>,
): FacturaACobrar[] {
  const out: FacturaACobrar[] = [];
  for (const f of facturas) {
    if (f.estado === "anulada" || esNotaCredito(f.tipo || "")) continue;
    const saldo = r2(Math.max(0, (Number(f.total) || 0) - (Number(f.total_acreditado) || 0) - (cobrado[f.id] || 0)));
    if (saldo <= 0.005) continue;
    out.push({
      id: f.id,
      numero: `${f.tipo || ""} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? "").padStart(8, "0")}`.trim(),
      fecha: String(f.fecha).slice(0, 10),
      subtotal: Number(f.subtotal) || 0, iva: Number(f.iva) || 0, total: Number(f.total) || 0,
      total_acreditado: Number(f.total_acreditado) || 0, saldo,
      moneda: normalizarMoneda(f.moneda) === "USD" ? "USD" : "ARS",
      tipo_cambio: Number(f.tipo_cambio) || undefined,
    });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero));
}

/** Moneda de lo tildado: "ARS" o "USD"; null si no hay nada o si mezcla monedas (no se pueden sumar en un mismo cobro). */
export function monedaDelCobro(elegidas: Pick<FacturaACobrar, "moneda">[]): "ARS" | "USD" | null {
  const monedas = new Set(elegidas.map((f) => f.moneda));
  return monedas.size === 1 ? [...monedas][0] : null;
}

/** Pantalla Cobrar (19/10/2026): un renglón por cliente con facturas de venta con saldo (sale de Vencimientos). */
export interface ClienteACobrar {
  clienteId: string;
  nombre: string;
  facturas: number;
  saldo: { ARS: number; USD: number };
  vencido: { ARS: number; USD: number };
  /** Vencimiento más viejo (o el próximo). */
  primerVence: string;
  /** Días del vencimiento más viejo (negativo = vencido). */
  dias: number;
}

type DeudaPorEntidad = Omit<ClienteACobrar, "clienteId"> & { entidadId: string };

/** Un renglón por cliente (venta) o proveedor (compra) con facturas con saldo; primero la deuda más vieja. */
function deudaPorEntidad(vencimientos: FilaVencimiento[], lado: FilaVencimiento["lado"]): DeudaPorEntidad[] {
  const porEntidad = new Map<string, DeudaPorEntidad>();
  for (const v of vencimientos) {
    if (v.lado !== lado || !v.entidadId || v.saldo <= 0.005) continue;
    const c = porEntidad.get(v.entidadId) ?? { entidadId: v.entidadId, nombre: v.nombre, facturas: 0, saldo: { ARS: 0, USD: 0 }, vencido: { ARS: 0, USD: 0 }, primerVence: v.vence, dias: v.dias };
    c.facturas += 1;
    c.saldo[v.moneda] = r2(c.saldo[v.moneda] + v.saldo);
    if (v.dias < 0) c.vencido[v.moneda] = r2(c.vencido[v.moneda] + v.saldo);
    if (v.vence < c.primerVence) { c.primerVence = v.vence; c.dias = v.dias; }
    porEntidad.set(v.entidadId, c);
  }
  // Primero los que tienen la deuda más vieja.
  return [...porEntidad.values()].sort((a, b) => a.primerVence.localeCompare(b.primerVence) || a.nombre.localeCompare(b.nombre));
}

export function clientesACobrar(vencimientos: FilaVencimiento[]): ClienteACobrar[] {
  return deudaPorEntidad(vencimientos, "venta").map(({ entidadId, ...resto }) => ({ clienteId: entidadId, ...resto }));
}

/** Pantalla Pagar (19/10/2026): un renglón por proveedor con facturas de compra con saldo (sale de Vencimientos). */
export type ProveedorAPagar = Omit<ClienteACobrar, "clienteId"> & { proveedorId: string };

export function proveedoresAPagar(vencimientos: FilaVencimiento[]): ProveedorAPagar[] {
  return deudaPorEntidad(vencimientos, "compra").map(({ entidadId, ...resto }) => ({ proveedorId: entidadId, ...resto }));
}
