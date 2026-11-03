/**
 * Contabilidad de gestión → Estado de resultados mensual, por lo DEVENGADO (Nati y Augusto, 23-29/10/2026). Etapa 1.
 * Cada sociedad por separado. No es un balance formal: el costo de lo vendido es el de cada cotización (no hay inventario valuado).
 *
 *   + Ventas                       facturas − NC, neto (lo mismo que Reportes)
 *   − Costos directos              mercadería (renglones facturados) · compras sin factura · compra de crédito fiscal IVA (lo pagado)
 *                                  · Transportes · colaboradores L-S-J · comisiones de venta (José) · consultoría · IIBB y tasas (% de ventas)
 *   = Resultado bruto
 *   − Estructura                   colaborador M · administrativos · bancarios
 *   = Resultado operativo
 *   ± Intereses                    préstamos, tarjetas, financiera, intereses ganados
 *   − Ganancias                    25% del resultado de cada mes
 *   = Resultado neto
 * Fuera del resultado (informativo): retiros de accionistas, impuestos que son pago (IVA, SICORE, anticipos, IIBB pagado),
 * Ley 25.413 (100% a cuenta de Ganancias, Nati 29/10), SIRCREB (a cuenta de IIBB) e IVA de las comisiones del banco.
 * En pantalla ese bloque va en dos partes (Nati 02/11, bloqueInformativo): a) plata que entró o salió y no es venta ni gasto,
 * por el mes en que se movió; b) ventas y gastos del mes que al último día del mes todavía no se cobraron o pagaron.
 * (`fuera`, por lo devengado, lo sigue usando Reportes para "No son gasto".)
 *
 * Cada gasto cuenta en el mes que dice su detalle ("Premio agosto", "Comisión septiembre 2026"); si no dice, en el de su fecha.
 * Desde octubre 2026, los premios, la comisión de José y los sueldos fijos que todavía no se cargaron van estimados en su mes.
 * Funciones puras. Prueba: npx tsx scripts/test-contabilidad.ts
 */
import { grupoDe } from "./gastos-lazza";
import { clasificarMovimiento } from "./movimientos-banco";
import { periodoDeFecha, sumarMeses } from "./reportes-comprobantes";
import type { TcDelDia } from "./finanzas-lazza";

export type LineaId =
  | "ventas" | "costo_mercaderia" | "compras_sin_factura" | "credito_fiscal_iva" | "transportes" | "colaboradores_lsj"
  | "comisiones" | "consultoria" | "iibb" | "colaborador_m" | "administrativos" | "bancarios" | "intereses" | "ganancias";
export type FueraId = "retiros" | "impuestos_pago" | "ley_25413" | "sircreb" | "iva_banco";
export type SubtotalId = "bruto" | "operativo" | "antes_ganancias" | "neto";
export type InfoAId = "a_retiros" | "a_impuestos_pago" | "a_ley_25413" | "a_sircreb" | "a_iva_banco" | "a_retenciones" | "a_total";
export type InfoBId = "b_ventas" | "b_mercaderia" | "b_transportes" | "b_sueldos" | "b_otros" | "b_visa" | "b_iibb" | "b_ganancias" | "b_falta_cobrar" | "b_falta_pagar";

export const LINEAS: { id: LineaId; nombre: string; que: string; bloque: "ventas" | "directos" | "estructura" | "financiero" | "ganancias" }[] = [
  { id: "ventas", nombre: "Ventas", que: "Facturas del mes − NC, neto de IVA (US$ al TC de cada factura)", bloque: "ventas" },
  { id: "costo_mercaderia", nombre: "Costo de mercadería", que: "Costo de los renglones facturados (el de cada cotización), neto", bloque: "directos" },
  { id: "compras_sin_factura", nombre: "Compras sin factura", que: "Reintegros y pagos sin comprobante de la venta, con el total", bloque: "directos" },
  { id: "credito_fiscal_iva", nombre: "Compra de crédito fiscal IVA", que: "Lo que se pagó (Augusto 29/10)", bloque: "directos" },
  { id: "transportes", nombre: "Transportes", que: "Facturas de transporte del mes (neto) y viajes", bloque: "directos" },
  { id: "colaboradores_lsj", nombre: "Colaboradores L-S-J", que: "Augusto, Sebastián y Jerónimo: sueldo, monotributo, mutual, Autónomos y premios", bloque: "directos" },
  { id: "comisiones", nombre: "Comisiones de venta", que: "José Alvarez: 90% del margen sin IVA de lo que vende", bloque: "directos" },
  { id: "consultoria", nombre: "Consultoría", que: "Natalia Inga (Augusto 28/10: es un costo)", bloque: "directos" },
  { id: "iibb", nombre: "IIBB y tasas", que: "IIBB y Seguridad e Higiene: % sobre las ventas del mes (6%, Nati 29/10)", bloque: "directos" },
  { id: "colaborador_m", nombre: "Colaborador M", que: "Mariana: sueldo, monotributo, mutual y premio", bloque: "estructura" },
  { id: "administrativos", nombre: "Gastos administrativos", que: "Local y servicios, profesionales, operativos, mantenimiento", bloque: "estructura" },
  { id: "bancarios", nombre: "Gastos bancarios", que: "Comisiones y mantenimiento de cuentas", bloque: "estructura" },
  { id: "intereses", nombre: "Intereses", que: "Préstamos, tarjetas, financiera e intereses ganados (+ o −)", bloque: "financiero" },
  { id: "ganancias", nombre: "Impuesto a las Ganancias", que: "25% del resultado del mes", bloque: "ganancias" },
];

export const FUERA: { id: FueraId; nombre: string; que: string }[] = [
  { id: "retiros", nombre: "Retiros de accionistas", que: "Gastos personales de Augusto pagados por la empresa (y su plan de ARBA)" },
  { id: "impuestos_pago", nombre: "Impuestos que son pago", que: "IVA, SICORE, anticipos de Ganancias, IIBB y tasas pagados (van al Cashflow)" },
  { id: "ley_25413", nombre: "Ley 25.413", que: "Débitos y créditos del banco: 100% a cuenta de Ganancias" },
  { id: "sircreb", nombre: "SIRCREB", que: "Retenciones de IIBB del banco: a cuenta de IIBB" },
  { id: "iva_banco", nombre: "IVA del banco", que: "IVA de las comisiones: crédito fiscal" },
];

/** Ganancias: 25% del resultado de cada mes; si el mes da pérdida, es positivo (descuenta del acumulado). Nati 29/10. */
export const TASA_GANANCIAS = 0.25;
/** IIBB y Seguridad e Higiene: 6% de las ventas (Nati 29/10). Se usa si la sociedad no guardó otro % en Contabilidad. */
export const IIBB_PCT_NATI = 6;
/** Desde este mes se estiman los premios y la comisión de José que todavía no se cargaron en Gastos (mismo mes que sus tarjetas). */
export const DESDE_ESTIMADOS = "2026-10";

/** Forma de pago de un gasto con la Mastercard personal de Augusto (su pago es retiro). */
export const MEDIO_MASTERCARD_PERSONAL = "tarjeta_mastercard_4775";

export interface GastoCont {
  id: string; fecha: string; descripcion: string | null; categoria: string | null; grupo?: string | null;
  monto: number | string | null; moneda?: string | null;
  /** Forma de pago (gastos_manuales.medio_pago): con la Mastercard personal no suma en retiros (cuenta su pago). */
  medio_pago?: string | null;
}
/** Línea del extracto del banco (extracto_movimientos), ya clasificada en Bancos. */
export interface LineaBancoCont {
  id: string; fecha: string; descripcion: string | null; monto: number | string | null; tipo: string | null;
  clasificacion: string | null; subtipo: string | null; match_movimiento_id?: string | null;
  /** Cuenta del otro lado (Bancos): en un pago de tarjeta, cuál tarjeta. */
  contra_cuenta_id?: string | null;
}
/** Renglón del resumen de la Visa (tarjeta_consumos) con el vencimiento de su resumen (cuando sale la plata). */
export interface ConsumoVisaCont {
  id: string; fecha: string; descripcion: string; importe: number | string; moneda: string | null;
  tipo: "consumo" | "cargo"; clase: string | null; vencimiento: string | null;
}
/** Lo de cada mes que sale de Reportes (reporteBasico): ventas, costo y transportes, netos. */
export interface BaseMes {
  ventas: number; costo: number; transportes: number; avisosCosto: number;
  /** Factura por factura (Reportes), para abrir Ventas y Costo de mercadería (Nati 02/11). Venta y costo netos, con signo (NC en −). */
  facturas?: FacturaER[];
}
export interface FacturaER { fecha: string; comprobante: string; cliente: string; prNumero: string | null; venta: number; costo: number; aviso: string | null }
export interface EstimadoMes { premios: { persona: string; monto: number }[]; comisionJose: number | null; sueldos?: SueldoFijo[] }

export interface ItemDetalle { fecha: string; detalle: string; monto: number; origen: "gasto" | "banco" | "estimado" | "calculo" | "factura"; aviso?: string | null }
export interface FilaER {
  id: LineaId | FueraId | SubtotalId | InfoAId | InfoBId; nombre: string; que: string;
  /** Con signo: ventas e ingresos en +, costos y gastos en −. */
  valores: Record<string, number>; total: number;
  detalle: Record<string, ItemDetalle[]>;
}
export interface EstadoResultados {
  periodos: string[];
  lineas: FilaER[];
  subtotales: Record<SubtotalId, FilaER>;
  fuera: FilaER[];
  /** % sobre ventas del acumulado (resultado bruto). */
  margenBruto: Record<string, number | null>;
  faltaPctIibb: boolean;
  avisos: string[];
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sinAcentos = (s: string | null | undefined) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Mes al que corresponde un gasto (devengado): el que nombra su detalle ("Premio agosto — …", "Alquiler — octubre 2026",
 * "Autónomos — período 09/2026");
 * si no nombra ninguno, el de su fecha. Sin año en el texto, el más cercano antes de la fecha (un premio de diciembre
 * pagado en enero es de diciembre del año anterior); se acepta hasta un mes después de la fecha (pago adelantado).
 */
export function mesDevengado(descripcion: string | null | undefined, fecha: string): string {
  const porFecha = periodoDeFecha(fecha);
  const texto = sinAcentos(descripcion).replace(/setiembre/g, "septiembre");
  // "ARCA período 09/2026" (Autónomos, VEP): ese mes.
  const periodo = texto.match(/\bperiodo\s+(0?[1-9]|1[0-2])\/(20\d\d)\b/);
  if (periodo) return `${periodo[2]}-${periodo[1].padStart(2, "0")}`;
  const m = texto.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b(?:\s+(?:de\s+)?(20\d\d))?/);
  if (!m) return porFecha;
  const mes = MESES.indexOf(m[1]) + 1;
  if (m[2]) return `${m[2]}-${String(mes).padStart(2, "0")}`;
  const anio = Number(porFecha.slice(0, 4));
  const mesFecha = Number(porFecha.slice(5, 7));
  const y = mes > mesFecha + 1 ? anio - 1 : anio;
  return `${y}-${String(mes).padStart(2, "0")}`;
}

const esMariana = (s: string) => /\bmariana\b|santinelli/.test(s);

/** A qué línea va un gasto cargado en Gastos (grupo + categoría + detalle). */
export function clasificarGasto(g: Pick<GastoCont, "grupo" | "categoria" | "descripcion">): LineaId | FueraId {
  const grupo = grupoDe(g);
  const cat = sinAcentos(g.categoria);
  const d = sinAcentos(g.descripcion);
  // El plan de pagos de ARBA es de Augusto, lo paga la empresa (Augusto 29/10): retiro, esté en el grupo que esté.
  if (/arba plan de pagos/.test(d)) return "retiros";
  if (grupo === "Personales") return "retiros";
  if (grupo === "Premios") return esMariana(d) ? "colaborador_m" : "colaboradores_lsj";
  if (grupo === "Personal") {
    if (cat === "comisiones") return "comisiones";
    return esMariana(d) ? "colaborador_m" : "colaboradores_lsj";
  }
  if (grupo === "Transportes" || cat === "transportes") return "transportes";
  if (grupo === "Impuestos") {
    if (/credito fiscal/.test(d)) return "credito_fiscal_iva";
    // Augusto 28/10: el despacho de la importación va a Operativos.
    if (/importacion|despacho/.test(d)) return "administrativos";
    // IIBB y tasas van al resultado como % de las ventas; lo pagado (y IVA, SICORE, anticipos de Ganancias) es solo Cashflow.
    return "impuestos_pago";
  }
  if (grupo === "Bancos y financieros") return cat === "bancarios" ? "bancarios" : "intereses";
  if (cat === "compras sin factura") return "compras_sin_factura";
  if (grupo === "Profesionales" && /\binga\b/.test(d)) return "consultoria";
  return "administrativos";
}

/**
 * A qué va una línea del banco. Solo las que no están ya cargadas como gasto (sin vincular a un movimiento).
 * Las devoluciones (crédito, subtipo "devolucion_…") van a la misma línea y restan. Sin clasificar todavía (las del último
 * extracto): por el código del banco, como el Cashflow ("Ver por tipo").
 */
export function clasificarLineaBanco(l: LineaBancoCont): LineaId | FueraId | null {
  const c = l.clasificacion;
  const s = String(l.subtipo || "").replace(/^devolucion_/, "");
  if (c === "gasto_bancario") return l.match_movimiento_id ? null : "bancarios";
  if (c === "intereses" && s === "intereses") return "intereses";
  if (c === "impuesto" && s === "ley_25413") return "ley_25413";
  if (c === "impuesto" && s === "sircreb") return "sircreb";
  if (c === "impuesto" && s === "iva") return "iva_banco";
  // Impuesto de sellos del banco (código 030): es un gasto del banco (Augusto 03/11, paso 3 punto 8; antes no entraba).
  if (c === "impuesto" && s === "sellos") return "bancarios";
  if (c || l.match_movimiento_id) return null;
  const m = clasificarMovimiento({ id: l.id, fecha: l.fecha, descripcion: l.descripcion || "", monto: Math.abs(num(l.monto)), tipo: l.tipo === "credito" ? "credito" : "debito", clasificacion: null, subtipo: null });
  if (m.tipo !== "impuestos_comisiones") return null;
  if (m.categoria === "Comisiones") return "bancarios";
  if (m.categoria === "IVA") return "iva_banco";
  if (/sircreb/i.test(m.categoria)) return "sircreb";
  if (/25\.413/.test(m.categoria)) return "ley_25413";
  return null;
}

/** Cargo del banco en el resumen de la Visa: IVA y percepciones (a cuenta, no es gasto), intereses o gasto del banco (sellos y otros). */
export function claseCargoVisa(descripcion: string | null | undefined): "iva_percepcion" | "intereses" | "bancarios" {
  const d = sinAcentos(descripcion);
  if (/\biva\b|percep|imp(uesto)?\.? ?pais|\brg ?\d|ganancias|\biibb\b|ing(resos)?\.? ?brutos/.test(d)) return "iva_percepcion";
  if (/interes|financ/.test(d)) return "intereses";
  return "bancarios";
}

const diasEntre = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
/** ¿Ya hay un gasto cargado con el mismo importe (±$ 1) y fecha cercana (25 días) en esos grupos? Así la Visa no se cuenta dos veces. */
function yaEnGastos(gastos: GastoCont[], importe: number, fecha: string, grupos: string[]): boolean {
  return gastos.some((g) => grupos.includes(grupoDe(g)) && Math.abs(num(g.monto) - importe) <= 1 && diasEntre(g.fecha, fecha) <= 25);
}
/** Importe en $ de un renglón de la Visa (US$ al dólar del día del consumo); null si falta el dólar. */
function pesosVisa(c: ConsumoVisaCont, tcDia: TcDelDia): number | null {
  const importe = num(c.importe);
  if (String(c.moneda || "").toUpperCase() !== "USD") return importe;
  const tc = tcDia(c.fecha);
  return tc ? r2(importe * tc) : null;
}

/** Gasto fijo de sueldo ("Sueldo Augusto", "Sueldo Mariana Santinelli"…), para estimar el del mes mientras no se carga. */
export interface SueldoFijo { descripcion: string; monto: number }

/**
 * Sueldos del mes que todavía no se cargaron (Augusto 29/10: lo que se paga a principio de mes es el sueldo del mes anterior).
 * Un sueldo está cargado si hay un gasto que empieza con el mismo detalle y es de ese mes ("Sueldo Augusto — septiembre 2026").
 */
export function sueldosPorCargar(mes: string, fijos: SueldoFijo[], gastos: Pick<GastoCont, "descripcion" | "fecha">[]): SueldoFijo[] {
  return fijos.filter((f) => {
    const d = sinAcentos(f.descripcion).trim();
    return f.monto > 0 && !gastos.some((g) => sinAcentos(g.descripcion).trim().startsWith(d) && mesDevengado(g.descripcion, g.fecha) === mes);
  });
}

/**
 * Estado de resultados de `periodos` (meses "AAAA-MM", en orden).
 * @param base       ventas, costo y transportes de cada mes (de reporteBasico)
 * @param gastos     gastos de los meses y de los 2-3 siguientes (los que se pagan después cuentan en su mes)
 * @param lineasBanco líneas del extracto de los meses
 * @param iibbPct    % de IIBB y tasas sobre las ventas (null = falta cargarlo: la línea queda en 0 y avisa)
 * @param estimados  premios y comisión de José de cada mes que todavía no están cargados en Gastos
 */
export function estadoDeResultados(input: {
  periodos: string[];
  base: Record<string, BaseMes>;
  gastos: GastoCont[];
  lineasBanco: LineaBancoCont[];
  tcDia: TcDelDia;
  iibbPct: number | null;
  estimados?: Record<string, EstimadoMes>;
  /** Renglones del resumen de la Visa: los cargos del banco (intereses, sellos) son gasto si no están ya en Gastos. */
  visa?: ConsumoVisaCont[];
}): EstadoResultados {
  const { periodos, base, tcDia } = input;
  const enRango = new Set(periodos);
  const avisos: string[] = [];
  const fila = (id: FilaER["id"], nombre: string, que: string): FilaER => ({
    id, nombre, que, valores: Object.fromEntries(periodos.map((p) => [p, 0])), total: 0, detalle: Object.fromEntries(periodos.map((p) => [p, []])),
  });
  const lineas = new Map<FilaER["id"], FilaER>();
  for (const l of LINEAS) lineas.set(l.id, fila(l.id, l.nombre, l.que));
  for (const l of FUERA) lineas.set(l.id, fila(l.id, l.nombre, l.que));
  const sumar = (id: FilaER["id"], p: string, monto: number, item?: ItemDetalle) => {
    const f = lineas.get(id)!;
    f.valores[p] += monto;
    if (item) f.detalle[p].push(item);
  };

  // Ventas, costo y transportes: los de Reportes.
  for (const p of periodos) {
    const b = base[p];
    if (!b) continue;
    sumar("ventas", p, b.ventas);
    sumar("costo_mercaderia", p, -b.costo);
    // Detalle factura por factura: el costo es solo el de compra de los artículos facturados (el de cada PR, sin el flete).
    for (const f of b.facturas || []) {
      const quien = `${f.comprobante} — ${f.cliente}${f.prNumero ? ` · ${f.prNumero}` : ""}`;
      lineas.get("ventas")!.detalle[p].push({ fecha: f.fecha, detalle: quien, monto: f.venta, origen: "factura", aviso: f.aviso });
      const margen = f.venta ? ` · margen ${Math.round(((f.venta - f.costo) / f.venta) * 100)} %` : "";
      lineas.get("costo_mercaderia")!.detalle[p].push({ fecha: f.fecha, detalle: `${quien}${margen}`, monto: -f.costo, origen: "factura", aviso: f.aviso });
    }
    sumar("transportes", p, -b.transportes, b.transportes ? { fecha: `${p}-01`, detalle: "Facturas de transporte del mes (neto)", monto: -b.transportes, origen: "calculo" } : undefined);
    if (b.avisosCosto > 0) avisos.push(`${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}: ${b.avisosCosto} factura(s) con el costo para revisar en Reportes (se ven marcadas al abrir Costo de mercadería).`);
  }

  // Gastos cargados, en su mes devengado. Montos con el total (los gastos sin factura entran con el IVA incluido).
  const descripciones = new Set<string>();
  for (const g of input.gastos) {
    descripciones.add(sinAcentos(g.descripcion).trim());
    const p = mesDevengado(g.descripcion, g.fecha);
    if (!enRango.has(p)) continue;
    let monto = num(g.monto);
    if (String(g.moneda || "").toUpperCase() === "USD") {
      const tc = tcDia(g.fecha);
      if (!tc) { avisos.push(`Gasto en US$ sin cotización del día (no suma): ${g.descripcion || ""} (${g.fecha}).`); continue; }
      monto *= tc;
    }
    const destino = clasificarGasto(g);
    // Intereses: los gastos restan (los intereses ganados vienen del banco, en +).
    sumar(destino, p, -monto, { fecha: g.fecha, detalle: g.descripcion || "", monto: -monto, origen: "gasto" });
  }

  // Líneas del banco: comisiones e intereses que no son un gasto cargado; impuestos del banco, informativos.
  for (const l of input.lineasBanco) {
    const p = periodoDeFecha(l.fecha);
    if (!enRango.has(p)) continue;
    const destino = clasificarLineaBanco(l);
    if (!destino) continue;
    const monto = l.tipo === "credito" ? num(l.monto) : -num(l.monto);
    sumar(destino, p, monto, { fecha: l.fecha, detalle: l.descripcion || "", monto, origen: "banco" });
  }

  // Cargos del banco en el resumen de la Visa (paso 3, punto 8): intereses e impuesto de sellos; el IVA y las percepciones no son
  // gasto (van en la parte a del bloque informativo). Si ya están cargados en Gastos, no se suman otra vez.
  for (const c of input.visa || []) {
    const p = periodoDeFecha(c.fecha);
    if (c.tipo !== "cargo" || !enRango.has(p)) continue;
    const clase = claseCargoVisa(c.descripcion);
    if (clase === "iva_percepcion") continue;
    const monto = pesosVisa(c, tcDia);
    if (monto === null) { avisos.push(`Cargo de la Visa en US$ sin cotización del día (no suma): ${c.descripcion} (${c.fecha}).`); continue; }
    if (yaEnGastos(input.gastos, monto, c.fecha, ["Bancos y financieros"])) continue;
    sumar(clase, p, -monto, { fecha: c.fecha, detalle: `Visa: ${c.descripcion}`, monto: -monto, origen: "banco" });
  }

  // Premios y comisión de José que corresponden al mes pero todavía no se cargaron (se cargan el mes siguiente).
  for (const p of periodos) {
    const e = input.estimados?.[p];
    if (!e || p < DESDE_ESTIMADOS) continue;
    for (const x of e.premios) {
      sumar(esMariana(sinAcentos(x.persona)) ? "colaborador_m" : "colaboradores_lsj", p, -x.monto,
        { fecha: `${p}-01`, detalle: `Premio de ${x.persona} (estimado: falta cargarlo en Gastos)`, monto: -x.monto, origen: "estimado" });
    }
    for (const x of e.sueldos || []) {
      sumar(esMariana(sinAcentos(x.descripcion)) ? "colaborador_m" : "colaboradores_lsj", p, -x.monto,
        { fecha: `${p}-01`, detalle: `${x.descripcion} (estimado: falta cargarlo en Gastos)`, monto: -x.monto, origen: "estimado" });
    }
    if (e.comisionJose) {
      sumar("comisiones", p, -e.comisionJose, { fecha: `${p}-01`, detalle: "Comisión de José Alvarez (estimada: falta cargarla en Gastos)", monto: -e.comisionJose, origen: "estimado" });
    }
  }

  // IIBB y tasas: % de las ventas.
  const faltaPctIibb = input.iibbPct === null || !(input.iibbPct >= 0);
  if (!faltaPctIibb) {
    for (const p of periodos) {
      const v = lineas.get("ventas")!.valores[p];
      const m = r2(v * input.iibbPct! / 100);
      if (m) sumar("iibb", p, -m, { fecha: `${p}-01`, detalle: `${input.iibbPct}% de las ventas`, monto: -m, origen: "calculo" });
    }
  }

  // Subtotales y Ganancias.
  const sub = {
    bruto: fila("bruto", "Resultado bruto", "Ventas − costos directos"),
    operativo: fila("operativo", "Resultado operativo", "Resultado bruto − estructura"),
    antes_ganancias: fila("antes_ganancias", "Resultado antes de Ganancias", "Resultado operativo ± intereses"),
    neto: fila("neto", "Resultado neto", "Después de Ganancias"),
  } satisfies Record<SubtotalId, FilaER>;
  const porBloque = (p: string, bloques: string[]) => LINEAS.filter((l) => bloques.includes(l.bloque)).reduce((s, l) => s + lineas.get(l.id)!.valores[p], 0);
  for (const p of periodos) {
    sub.bruto.valores[p] = porBloque(p, ["ventas", "directos"]);
    sub.operativo.valores[p] = porBloque(p, ["ventas", "directos", "estructura"]);
    sub.antes_ganancias.valores[p] = porBloque(p, ["ventas", "directos", "estructura", "financiero"]);
    const g = r2(-sub.antes_ganancias.valores[p] * TASA_GANANCIAS);
    sumar("ganancias", p, g, { fecha: `${p}-01`, detalle: `${TASA_GANANCIAS * 100}% del resultado del mes`, monto: g, origen: "calculo" });
    sub.neto.valores[p] = sub.antes_ganancias.valores[p] + g;
  }

  const cerrar = (f: FilaER) => {
    for (const p of periodos) f.valores[p] = r2(f.valores[p]);
    f.total = r2(periodos.reduce((s, p) => s + f.valores[p], 0));
    return f;
  };
  const ventas = cerrar(lineas.get("ventas")!);
  const margenBruto: Record<string, number | null> = {};
  for (const p of [...periodos, "total"]) {
    const v = p === "total" ? ventas.total : ventas.valores[p];
    const b = p === "total" ? periodos.reduce((s, x) => s + sub.bruto.valores[x], 0) : sub.bruto.valores[p];
    margenBruto[p] = v ? r2((b / v) * 100) : null;
  }
  return {
    periodos,
    lineas: LINEAS.map((l) => cerrar(lineas.get(l.id)!)),
    subtotales: { bruto: cerrar(sub.bruto), operativo: cerrar(sub.operativo), antes_ganancias: cerrar(sub.antes_ganancias), neto: cerrar(sub.neto) },
    fuera: FUERA.map((l) => cerrar(lineas.get(l.id)!)),
    margenBruto,
    faltaPctIibb,
    avisos,
  };
}

// ── Bloque informativo en dos partes (Nati 02/11/2026; Augusto aprobó los 8 puntos el 03/11) ──────────────────────

export const INFO_A: { id: InfoAId; nombre: string; que: string }[] = [
  { id: "a_retiros", nombre: "Retiros de accionistas", que: "Gastos personales de Augusto, su plan de ARBA, el pago de la Mastercard y los consumos personales de la Visa" },
  { id: "a_impuestos_pago", nombre: "Impuestos que son pago", que: "IVA, SICORE y anticipos de Ganancias (VEP). El IIBB no: su gasto ya es el % de las ventas" },
  { id: "a_ley_25413", nombre: "Ley 25.413", que: "Débitos y créditos del banco: 100% a cuenta de Ganancias" },
  { id: "a_sircreb", nombre: "SIRCREB", que: "Retenciones de IIBB del banco: a cuenta de IIBB" },
  { id: "a_iva_banco", nombre: "IVA del banco", que: "IVA de las comisiones (crédito fiscal) y el IVA y las percepciones de la Visa" },
  { id: "a_retenciones", nombre: "Retenciones que nos hicieron los clientes", que: "IVA, Ganancias, IIBB y SUSS: a cuenta de impuestos (plata que no entró)" },
];
export const INFO_B: { id: InfoBId; nombre: string; que: string; lado: "cobrar" | "pagar" }[] = [
  { id: "b_ventas", nombre: "Ventas sin cobrar", que: "Facturas del mes que al cierre seguían sin cobrar, neto de IVA (como la línea Ventas)", lado: "cobrar" },
  { id: "b_mercaderia", nombre: "Mercadería sin pagar", que: "Facturas de compra del mes sin pagar al cierre, neto. No es exactamente el costo de lo vendido: la diferencia es stock", lado: "pagar" },
  { id: "b_transportes", nombre: "Transportes sin pagar", que: "Facturas de transporte del mes sin pagar al cierre, neto", lado: "pagar" },
  { id: "b_sueldos", nombre: "Sueldos, premios y comisión sin pagar", que: "Los del mes que se pagan después: cargados con fecha posterior o estimados", lado: "pagar" },
  { id: "b_otros", nombre: "Otros gastos del mes pagados después", que: "Gastos del mes cargados con fecha posterior al cierre (ej.: alquiler de octubre pagado en noviembre)", lado: "pagar" },
  { id: "b_visa", nombre: "Consumos de la Visa del mes", que: "Se debitan con el resumen siguiente", lado: "pagar" },
  { id: "b_iibb", nombre: "IIBB y tasas del mes", que: "El % de las ventas: se paga el 22 del mes siguiente", lado: "pagar" },
  { id: "b_ganancias", nombre: "Ganancias del mes", que: "El 25 % del resultado: se paga en mayo", lado: "pagar" },
];

/** Factura de venta (o NC) con lo que hace falta para saber cuánto se debía al cierre de su mes. */
export interface VentaCierre {
  id: string; fecha: string; tipo: string | null; estado: string | null; comprobante: string; cliente: string;
  total: number | string | null; subtotal: number | string | null; moneda: string | null; tipo_cambio: number | string | null;
  total_acreditado?: number | string | null; factura_origen_id?: string | null;
}
/** Movimiento con factura (cobro o retención sufrida) y aplicación de un cobro consolidado, con su fecha. */
export interface CobroCierre { id: string; factura_id: string | null; monto: number | string | null; moneda?: string | null; anulado?: boolean | null; fecha: string }
export interface AplicacionCierre { movimiento_id: string | null; factura_id: string | null; monto: number | string | null; anulado?: boolean | null; fecha: string }
/** Factura de compra del mes con sus pagos con fecha (directos, NC aplicadas y OP no anuladas). */
export interface CompraCierre {
  id: string; fecha: string; tipo: string | null; tipo_comprobante: string | null; estado: string | null; solo_iva?: boolean | null;
  comprobante: string; proveedor: string; subtotal: number | string | null; total: number | string | null; moneda: string | null;
  total_acreditado?: number | string | null; pagos: { fecha: string; monto: number }[];
}
/** Retención que nos hizo un cliente (movimientos retencion_iva / _ganancias / _iibb / _suss con cliente o factura). */
export interface RetencionCont { fecha: string; tipo: string; monto: number | string | null; moneda: string | null; quien: string }

export interface BloqueInformativo { a: FilaER[]; totalA: FilaER; b: FilaER[]; faltaCobrar: FilaER; faltaPagar: FilaER }

const esNCVenta = (tipo: string | null | undefined) => String(tipo || "").toUpperCase().startsWith("NC");
const esNCCompra = (tipo: string | null | undefined) => /^NC/i.test(String(tipo || "").trim());
/** Último día que cuenta para "al cierre" de `p`: el último del mes; el mes en curso, hoy. */
export function cierreDe(p: string, hoy: string): string {
  const fin = new Date(Date.parse(`${sumarMeses(p, 1)}-01T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return hoy < fin ? hoy : fin;
}

/**
 * Saldo de cada factura de venta al cierre `fin` (en su moneda), con la regla de las cuentas corrientes (lib/saldo-clientes):
 * total − NC aplicadas hasta esa fecha (nunca más que su total_acreditado) − cobros y retenciones hasta esa fecha
 * (un cobro con aplicaciones se cuenta por ellas). Anuladas y NC = 0.
 */
export function saldosVentaAlCierre(fin: string, ventas: VentaCierre[], cobros: CobroCierre[], aplicaciones: AplicacionCierre[]): Record<string, number> {
  const monedaDe = new Map(ventas.map((f) => [f.id, String(f.moneda || "ARS").toUpperCase() === "USD" ? "USD" : "ARS"]));
  const cobrado: Record<string, number> = {};
  const aplicados = new Set<string>();
  for (const a of aplicaciones) {
    if (!a.factura_id || a.anulado || a.fecha > fin) continue;
    if (a.movimiento_id) aplicados.add(a.movimiento_id);
    cobrado[a.factura_id] = (cobrado[a.factura_id] || 0) + num(a.monto);
  }
  for (const m of cobros) {
    if (!m.factura_id || m.anulado || m.fecha > fin || aplicados.has(m.id)) continue;
    const mon = monedaDe.get(m.factura_id);
    if (mon && m.moneda && (String(m.moneda).toUpperCase() === "USD" ? "USD" : "ARS") !== mon) continue;
    cobrado[m.factura_id] = (cobrado[m.factura_id] || 0) + num(m.monto);
  }
  const nc: Record<string, number> = {};
  for (const f of ventas) {
    if (!esNCVenta(f.tipo) || f.estado === "anulada" || !f.factura_origen_id || f.fecha > fin) continue;
    nc[f.factura_origen_id] = (nc[f.factura_origen_id] || 0) + num(f.total);
  }
  const out: Record<string, number> = {};
  for (const f of ventas) {
    if (f.estado === "anulada" || esNCVenta(f.tipo) || f.fecha > fin) continue;
    const acreditado = Math.min(nc[f.id] || 0, num(f.total_acreditado));
    out[f.id] = r2(Math.max(0, num(f.total) - acreditado - (cobrado[f.id] || 0)));
  }
  return out;
}

/** Saldo de una factura de compra al cierre: total − NC (total_acreditado) − pagos hasta esa fecha. "Pagada" sin pagos cargados = 0. */
export function saldoCompraAlCierre(f: CompraCierre, fin: string): number {
  if (f.estado === "anulada" || esNCCompra(f.tipo_comprobante) || f.solo_iva || f.tipo === "solo_iva" || f.fecha > fin) return 0;
  if (f.estado === "pagada" && !f.pagos.length) return 0;
  const pagado = f.pagos.filter((x) => x.fecha <= fin).reduce((s, x) => s + num(x.monto), 0);
  return r2(Math.max(0, num(f.total) - num(f.total_acreditado) - pagado));
}

const IIBB_O_TASA = /\biibb\b|ingresos brutos|convenio multilateral|seguridad e higiene|\btasa\b/;

/**
 * Las dos partes del bloque informativo, para los meses del Estado de resultados `er`.
 * a) Por el mes en que se movió la plata (fecha del gasto, de la línea del banco, de la retención o del vencimiento del resumen de
 *    la Visa), con signo: + entró, − salió.
 * b) Al cierre de cada mes (el mes en curso, a hoy), en positivo: lo que faltaba cobrar o pagar de las ventas y gastos de ese mes.
 */
export function bloqueInformativo(x: {
  er: EstadoResultados; hoy: string; gastos: GastoCont[]; lineasBanco: LineaBancoCont[]; tcDia: TcDelDia;
  tarjetasPersonales: Set<string>; visa?: ConsumoVisaCont[]; retenciones: RetencionCont[];
  ventas: VentaCierre[]; cobros: CobroCierre[]; aplicaciones: AplicacionCierre[]; compras: CompraCierre[];
}): BloqueInformativo {
  const { er, tcDia } = x;
  const periodos = er.periodos;
  const enRango = new Set(periodos);
  const nueva = (id: InfoAId | InfoBId, nombre: string, que: string): FilaER => ({
    id, nombre, que, valores: Object.fromEntries(periodos.map((p) => [p, 0])), total: 0, detalle: Object.fromEntries(periodos.map((p) => [p, []])),
  });
  const filas = new Map<string, FilaER>();
  for (const f of [...INFO_A, ...INFO_B]) filas.set(f.id, nueva(f.id, f.nombre, f.que));
  const sumar = (id: InfoAId | InfoBId, p: string, monto: number, item: ItemDetalle) => {
    if (!enRango.has(p) || !monto) return;
    const f = filas.get(id)!;
    f.valores[p] += monto;
    f.detalle[p].push(item);
  };
  const pesos = (monto: number, moneda: string | null | undefined, fecha: string, tc?: number | string | null): number | null => {
    if (String(moneda || "").toUpperCase() !== "USD") return monto;
    const t = num(tc) || tcDia(fecha);
    return t ? r2(monto * t) : null;
  };

  // ── a) Gastos que no son gasto, por su fecha ──
  for (const g of x.gastos) {
    const destino = clasificarGasto(g);
    if (destino !== "retiros" && destino !== "impuestos_pago") continue;
    // Pagado con la Mastercard personal: el pago de la tarjeta ya cuenta entero como retiro (Augusto 03/11/2026: Apple, $ 18.932 de más).
    if (destino === "retiros" && g.medio_pago === MEDIO_MASTERCARD_PERSONAL) continue;
    const d = sinAcentos(g.descripcion);
    if (destino === "impuestos_pago" && IIBB_O_TASA.test(d) && !/reten|percep|sircreb/.test(d)) continue; // punto 2: el IIBB ya es el %
    const monto = pesos(num(g.monto), g.moneda, g.fecha);
    if (monto === null) continue;
    sumar(destino === "retiros" ? "a_retiros" : "a_impuestos_pago", periodoDeFecha(g.fecha), -monto, { fecha: g.fecha, detalle: g.descripcion || "", monto: -monto, origen: "gasto" });
  }
  // Líneas del banco: impuestos a cuenta y el pago de la tarjeta personal (si no está atado a un gasto ya contado).
  for (const l of x.lineasBanco) {
    const p = periodoDeFecha(l.fecha);
    const monto = l.tipo === "credito" ? num(l.monto) : -num(l.monto);
    const item: ItemDetalle = { fecha: l.fecha, detalle: l.descripcion || "", monto, origen: "banco" };
    const personal = !l.match_movimiento_id && ((l.clasificacion === "tarjeta" && !!l.contra_cuenta_id && x.tarjetasPersonales.has(l.contra_cuenta_id)) || l.clasificacion === "personal");
    if (personal) { sumar("a_retiros", p, monto, { ...item, detalle: `${item.detalle} (tarjeta o gasto personal)` }); continue; }
    const destino = clasificarLineaBanco(l);
    if (destino === "ley_25413") sumar("a_ley_25413", p, monto, item);
    else if (destino === "sircreb") sumar("a_sircreb", p, monto, item);
    else if (destino === "iva_banco") sumar("a_iva_banco", p, monto, item);
  }
  // Visa: consumos personales (retiro) e IVA y percepciones, en el mes del vencimiento de su resumen (cuando sale la plata).
  for (const c of x.visa || []) {
    const personal = c.tipo === "consumo" && c.clase === "personal";
    const aCuenta = c.tipo === "cargo" && claseCargoVisa(c.descripcion) === "iva_percepcion";
    if (!personal && !aCuenta) continue;
    const monto = pesosVisa(c, tcDia);
    if (monto === null) continue;
    if (personal && yaEnGastos(x.gastos, monto, c.fecha, ["Personales"])) continue;
    const fecha = c.vencimiento || c.fecha;
    sumar(personal ? "a_retiros" : "a_iva_banco", periodoDeFecha(fecha), -monto, { fecha, detalle: `Visa: ${c.descripcion} (consumo del ${c.fecha.slice(8, 10)}/${c.fecha.slice(5, 7)})`, monto: -monto, origen: "banco" });
  }
  // Retenciones que nos hicieron los clientes (punto 3).
  const IMP: Record<string, string> = { retencion_iva: "IVA", retencion_ganancias: "Ganancias", retencion_iibb: "IIBB", retencion_suss: "SUSS" };
  for (const r of x.retenciones) {
    const monto = pesos(num(r.monto), r.moneda, r.fecha);
    if (monto === null) continue;
    sumar("a_retenciones", periodoDeFecha(r.fecha), -monto, { fecha: r.fecha, detalle: `Retención ${IMP[r.tipo] || r.tipo} — ${r.quien}`, monto: -monto, origen: "banco" });
  }

  // ── b) Al cierre de cada mes ──
  for (const p of periodos) {
    const fin = cierreDe(p, x.hoy);
    const delMes = (f: string) => periodoDeFecha(f) === p && f <= fin;
    // Ventas sin cobrar (punto 4): el saldo de la factura en neto (subtotal/total), US$ al cambio de la factura.
    const saldos = saldosVentaAlCierre(fin, x.ventas, x.cobros, x.aplicaciones);
    for (const f of x.ventas) {
      const s = saldos[f.id];
      if (!s || !delMes(f.fecha) || !num(f.total)) continue;
      const neto = pesos(s * num(f.subtotal) / num(f.total), f.moneda, f.fecha, f.tipo_cambio);
      if (neto) sumar("b_ventas", p, r2(neto), { fecha: f.fecha, detalle: `${f.comprobante} — ${f.cliente}`, monto: r2(neto), origen: "factura" });
    }
    // Facturas de compra sin pagar (punto 5): mercadería y transportes, neto.
    for (const f of x.compras) {
      if (!delMes(f.fecha) || !num(f.total)) continue;
      const s = saldoCompraAlCierre(f, fin);
      const neto = s ? pesos(s * num(f.subtotal) / num(f.total), f.moneda, f.fecha) : null;
      if (neto) sumar(f.tipo === "transporte" ? "b_transportes" : "b_mercaderia", p, r2(neto), { fecha: f.fecha, detalle: `${f.comprobante} — ${f.proveedor}`, monto: r2(neto), origen: "factura" });
    }
    // Gastos del mes cargados con fecha posterior al cierre.
    for (const g of x.gastos) {
      if (mesDevengado(g.descripcion, g.fecha) !== p || g.fecha <= fin) continue;
      const destino = clasificarGasto(g);
      if (FUERA.some((f) => f.id === destino)) continue;
      const monto = pesos(num(g.monto), g.moneda, g.fecha);
      if (!monto) continue;
      const sueldo = destino === "colaboradores_lsj" || destino === "colaborador_m" || destino === "comisiones";
      sumar(sueldo ? "b_sueldos" : "b_otros", p, monto, { fecha: g.fecha, detalle: `${g.descripcion || ""} (pagado el ${g.fecha.slice(8, 10)}/${g.fecha.slice(5, 7)})`, monto, origen: "gasto" });
    }
    // Sueldos, premios y comisión estimados (todavía no cargados): los mismos del resultado.
    for (const id of ["colaboradores_lsj", "colaborador_m", "comisiones"] as LineaId[]) {
      for (const d of er.lineas.find((l) => l.id === id)!.detalle[p]) if (d.origen === "estimado") sumar("b_sueldos", p, -d.monto, { ...d, monto: -d.monto });
    }
    // Visa (punto 7): consumos y cargos del mes que se debitan con un resumen que vence después del cierre.
    for (const c of x.visa || []) {
      if (!delMes(c.fecha) || (c.vencimiento && c.vencimiento <= fin)) continue;
      if ((c.tipo === "consumo" && c.clase === "personal") || (c.tipo === "cargo" && claseCargoVisa(c.descripcion) === "iva_percepcion")) continue;
      const monto = pesosVisa(c, tcDia);
      if (monto) sumar("b_visa", p, monto, { fecha: c.fecha, detalle: `Visa: ${c.descripcion}${c.vencimiento ? ` (resumen que vence el ${c.vencimiento.slice(8, 10)}/${c.vencimiento.slice(5, 7)})` : ""}`, monto, origen: "banco" });
    }
    // IIBB y Ganancias del mes: nunca están pagados al cierre (se pagan el mes siguiente y en mayo).
    const iibb = -(er.lineas.find((l) => l.id === "iibb")!.valores[p] || 0);
    sumar("b_iibb", p, iibb, { fecha: `${p}-01`, detalle: "El % de las ventas del mes", monto: iibb, origen: "calculo" });
    const gan = -(er.lineas.find((l) => l.id === "ganancias")!.valores[p] || 0);
    sumar("b_ganancias", p, gan, { fecha: `${p}-01`, detalle: gan < 0 ? "El mes dio pérdida: descuenta" : "El 25 % del resultado del mes", monto: gan, origen: "calculo" });
  }

  const cerrar = (f: FilaER, acumula: boolean) => {
    for (const p of periodos) f.valores[p] = r2(f.valores[p]);
    f.total = acumula ? r2(periodos.reduce((s, p) => s + f.valores[p], 0)) : 0;
    return f;
  };
  const a = INFO_A.map((f) => cerrar(filas.get(f.id)!, true));
  const b = INFO_B.map((f) => cerrar(filas.get(f.id)!, false));
  const suma = (id: InfoAId | InfoBId, nombre: string, que: string, de: FilaER[], acumula: boolean) => {
    const f = nueva(id, nombre, que);
    for (const p of periodos) f.valores[p] = de.reduce((s, x) => s + x.valores[p], 0);
    return cerrar(f, acumula);
  };
  return {
    a, b,
    totalA: suma("a_total", "Total a)", "Lo que entró menos lo que salió que no es venta ni gasto", a, true),
    faltaCobrar: suma("b_falta_cobrar", "Falta cobrar", "Ventas del mes sin cobrar al cierre", b.filter((f) => f.id === "b_ventas"), false),
    faltaPagar: suma("b_falta_pagar", "Falta pagar", "Gastos del mes sin pagar al cierre", b.filter((f) => f.id !== "b_ventas"), false),
  };
}

/** Meses desde enero del año de `hasta` hasta `hasta`, en orden. */
export function mesesDelAnio(hasta: string): string[] {
  const out: string[] = [];
  for (let p = `${hasta.slice(0, 4)}-01`; p <= hasta; p = sumarMeses(p, 1)) out.push(p);
  return out;
}

/** % sobre ventas (para la columna del acumulado). */
export const pctSobreVentas = (valor: number, ventas: number): number | null => (ventas ? r2((valor / ventas) * 100) : null);

/** Planilla para Excel: una fila por línea, una columna por mes + total + % sobre ventas. */
export function planillaER(er: EstadoResultados, nombreMes: (p: string) => string, info?: BloqueInformativo): (string | number | null)[][] {
  const ventas = er.lineas.find((l) => l.id === "ventas")!.total;
  const fila = (f: FilaER, prefijo = "") => [prefijo + f.nombre, ...er.periodos.map((p) => f.valores[p]), f.total, pctSobreVentas(f.total, ventas)];
  const L = (id: LineaId) => er.lineas.find((l) => l.id === id)!;
  const bloque = (b: string) => LINEAS.filter((l) => l.bloque === b).map((l) => fila(L(l.id), "  "));
  return [
    ["Línea", ...er.periodos.map(nombreMes), "Acumulado", "% s/ventas"],
    fila(L("ventas")),
    ["Costos directos"], ...bloque("directos"),
    fila(er.subtotales.bruto),
    ["Estructura"], ...bloque("estructura"),
    fila(er.subtotales.operativo),
    ...bloque("financiero"),
    fila(er.subtotales.antes_ganancias),
    fila(L("ganancias")),
    fila(er.subtotales.neto),
    [],
    ...(info
      ? [
        ["Fuera del resultado (informativo)"],
        ["a) Plata que entró o salió y no es venta ni gasto (mes en que se movió)"], ...info.a.map((f) => fila(f, "  ")), fila(info.totalA, "  "),
        ["b) Ventas y gastos del mes todavía sin cobrar o pagar (al último día de cada mes)"],
        ...[...info.b, info.faltaCobrar, info.faltaPagar].map((f) => ["  " + f.nombre, ...er.periodos.map((p) => f.valores[p]), null, null]),
      ]
      : [["Fuera del resultado (informativo)"], ...er.fuera.map((f) => fila(f, "  "))]),
  ];
}
