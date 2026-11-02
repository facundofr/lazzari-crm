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

export interface GastoCont {
  id: string; fecha: string; descripcion: string | null; categoria: string | null; grupo?: string | null;
  monto: number | string | null; moneda?: string | null;
}
/** Línea del extracto del banco (extracto_movimientos), ya clasificada en Bancos. */
export interface LineaBancoCont {
  id: string; fecha: string; descripcion: string | null; monto: number | string | null; tipo: string | null;
  clasificacion: string | null; subtipo: string | null; match_movimiento_id?: string | null;
}
/** Lo de cada mes que sale de Reportes (reporteBasico): ventas, costo y transportes, netos. */
export interface BaseMes { ventas: number; costo: number; transportes: number; avisosCosto: number }
export interface EstimadoMes { premios: { persona: string; monto: number }[]; comisionJose: number | null; sueldos?: SueldoFijo[] }

export interface ItemDetalle { fecha: string; detalle: string; monto: number; origen: "gasto" | "banco" | "estimado" | "calculo" }
export interface FilaER {
  id: LineaId | FueraId | SubtotalId; nombre: string; que: string;
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
  if (c || l.match_movimiento_id) return null;
  const m = clasificarMovimiento({ id: l.id, fecha: l.fecha, descripcion: l.descripcion || "", monto: Math.abs(num(l.monto)), tipo: l.tipo === "credito" ? "credito" : "debito", clasificacion: null, subtipo: null });
  if (m.tipo !== "impuestos_comisiones") return null;
  if (m.categoria === "Comisiones") return "bancarios";
  if (m.categoria === "IVA") return "iva_banco";
  if (/sircreb/i.test(m.categoria)) return "sircreb";
  if (/25\.413/.test(m.categoria)) return "ley_25413";
  return null;
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
    sumar("transportes", p, -b.transportes, b.transportes ? { fecha: `${p}-01`, detalle: "Facturas de transporte del mes (neto)", monto: -b.transportes, origen: "calculo" } : undefined);
    if (b.avisosCosto > 0) avisos.push(`${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}: ${b.avisosCosto} factura(s) con el costo para revisar en Reportes.`);
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

/** Meses desde enero del año de `hasta` hasta `hasta`, en orden. */
export function mesesDelAnio(hasta: string): string[] {
  const out: string[] = [];
  for (let p = `${hasta.slice(0, 4)}-01`; p <= hasta; p = sumarMeses(p, 1)) out.push(p);
  return out;
}

/** % sobre ventas (para la columna del acumulado). */
export const pctSobreVentas = (valor: number, ventas: number): number | null => (ventas ? r2((valor / ventas) * 100) : null);

/** Planilla para Excel: una fila por línea, una columna por mes + total + % sobre ventas. */
export function planillaER(er: EstadoResultados, nombreMes: (p: string) => string): (string | number | null)[][] {
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
    ["Fuera del resultado (informativo)"], ...er.fuera.map((f) => fila(f, "  ")),
  ];
}
