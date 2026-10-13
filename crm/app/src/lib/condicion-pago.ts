// Cómo se le paga a cada proveedor: condición (anticipado / contra entrega / cuenta corriente N días / escalonado de N a M días),
// medios aceptados, plazo del cheque y descuento por pago anticipado. Los días se cuentan desde la FECHA DE FACTURA.
// Los cheques se proponen en las fechas fijas del mes (cheque_fechas_mes, ej. octubre 12 · 21 · 31). Todo es sugerencia.
import { diaHabilDesde, sumarDias } from "./dias-habiles";

export type CondicionPago = "anticipado" | "contra_entrega" | "cuenta_corriente" | "escalonado";
export type MedioPago = "transferencia" | "echeq" | "cheque" | "tarjeta" | "efectivo";

export const CONDICIONES_PAGO: { value: CondicionPago; label: string }[] = [
  { value: "anticipado", label: "Anticipado" },
  { value: "contra_entrega", label: "Contra entrega" },
  { value: "cuenta_corriente", label: "Cuenta corriente" },
  { value: "escalonado", label: "Escalonado (de N a M días)" },
];
export const MEDIOS_PAGO: { value: MedioPago; label: string }[] = [
  { value: "transferencia", label: "Transferencia" },
  { value: "echeq", label: "eCheq" },
  { value: "cheque", label: "Cheque físico" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "efectivo", label: "Efectivo" },
];
export const DIAS_PAGO_OPCIONES = [0, 15, 30, 45, 60, 75, 90];

export interface PlanPago {
  condicion_pago?: string | null;
  dias_pago?: number | null;
  dias_pago_hasta?: number | null;
  medios_pago?: string[] | null;
  medio_pago_preferido?: string | null;
  plazo_cheque_dias?: number | null;
  descuento_pronto_pago?: number | null;
}

export interface FechasChequeMes {
  mes: string; // YYYY-MM-01
  dias: number[];
}

export interface ChequePropuesto {
  fecha: string; // fecha del cheque
  debito: string; // día hábil en que se debita
  monto: number;
}

const esCheque = (m?: string | null) => m === "echeq" || m === "cheque";

export function medioLabel(m?: string | null): string {
  return MEDIOS_PAGO.find((x) => x.value === m)?.label || "";
}

/** Texto corto: "Escalonado 30 a 75 días · eCheq · 5 % pronto pago". */
export function textoCondicionPago(p: PlanPago | null | undefined): string {
  if (!p?.condicion_pago) return "";
  let t = "";
  if (p.condicion_pago === "anticipado") t = "Anticipado";
  else if (p.condicion_pago === "contra_entrega") t = "Contra entrega";
  else if (p.condicion_pago === "cuenta_corriente") t = `Cuenta corriente ${p.dias_pago ?? "?"} días`;
  else if (p.condicion_pago === "escalonado") t = `Escalonado ${p.dias_pago ?? "?"} a ${p.dias_pago_hasta ?? "?"} días`;
  const medio = medioLabel(p.medio_pago_preferido);
  if (medio) t += ` · ${medio}`;
  if (esCheque(p.medio_pago_preferido) && p.plazo_cheque_dias && p.condicion_pago !== "escalonado") t += ` diferido ${p.plazo_cheque_dias} días`;
  if (p.descuento_pronto_pago) t += ` · ${p.descuento_pronto_pago} % pronto pago`;
  return t;
}

/** Qué le falta al plan (para el aviso amarillo). Vacío = está completo. Nunca bloquea. */
export function avisosPlanPago(p: PlanPago | null | undefined): string[] {
  const a: string[] = [];
  if (!p?.condicion_pago) return ["Falta indicar cómo pide cobrar el proveedor"];
  if (p.condicion_pago === "cuenta_corriente" && p.dias_pago == null) a.push("Faltan los días de cuenta corriente");
  if (p.condicion_pago === "escalonado") {
    if (p.dias_pago == null || p.dias_pago_hasta == null) a.push("Faltan los días del escalonado (desde y hasta)");
    else if (p.dias_pago_hasta < p.dias_pago) a.push("En el escalonado, 'hasta' es menor que 'desde'");
  }
  if (!p.medio_pago_preferido) a.push("Falta el medio de pago preferido");
  return a;
}

/** Días desde la factura hasta el primer pago (escalonado: el primero). */
function diasHastaVencer(p: PlanPago): number | null {
  if (p.condicion_pago === "anticipado" || p.condicion_pago === "contra_entrega") return 0;
  if (p.condicion_pago === "cuenta_corriente" || p.condicion_pago === "escalonado") return p.dias_pago ?? null;
  return null;
}

/** Vencimiento de la factura de compra = fecha de factura + días (escalonado: el primer vencimiento). null si no hay plan. */
export function vencimientoFactura(fechaFactura: string, p: PlanPago | null | undefined): string | null {
  if (!fechaFactura || !p?.condicion_pago) return null;
  const d = diasHastaVencer(p);
  return d == null ? null : sumarDias(fechaFactura, d);
}

function ultimoDiaDelMes(anio: number, mes1: number): number {
  return new Date(Date.UTC(anio, mes1, 0)).getUTCDate();
}

/** Fechas de cheque permitidas entre desde y hasta (inclusive). Un día 31 en un mes de 30 pasa al último día. */
export function fechasPermitidas(desde: string, hasta: string, config: FechasChequeMes[]): string[] {
  const out = new Set<string>();
  for (const c of config) {
    const [a, m] = c.mes.slice(0, 7).split("-").map(Number);
    const ult = ultimoDiaDelMes(a, m);
    for (const d of c.dias) {
      const f = `${c.mes.slice(0, 7)}-${String(Math.min(d, ult)).padStart(2, "0")}`;
      if (f >= desde && f <= hasta) out.add(f);
    }
  }
  return [...out].sort();
}

/** Meses entre dos fechas que no tienen las fechas de cheque cargadas (para avisar en Configuración). */
export function mesesSinConfigurar(desde: string, hasta: string, config: FechasChequeMes[]): string[] {
  const cargados = new Set(config.map((c) => c.mes.slice(0, 7)));
  const faltan: string[] = [];
  let m = desde.slice(0, 7);
  while (m <= hasta.slice(0, 7)) {
    if (!cargados.has(m)) faltan.push(m);
    const [a, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, "0")}`;
  }
  return faltan;
}

function repartir(monto: number, n: number): number[] {
  const cent = Math.round(monto * 100);
  const base = Math.floor(cent / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cent - base * (n - 1) : base) / 100);
}

const cheque = (fecha: string, monto: number): ChequePropuesto => ({ fecha, debito: diaHabilDesde(fecha), monto });

/**
 * Cheques sugeridos para pagar una factura según el plan del proveedor:
 * - Cuenta corriente N días: un cheque en la última fecha fija que no pase el vencimiento (si no hay, al vencimiento).
 * - Escalonado N a M: un cheque en cada fecha fija dentro del rango, el monto repartido en partes iguales.
 * - Anticipado / contra entrega: un cheque a la fecha de factura + plazo del cheque.
 * El plazo del cheque se suma en cuenta corriente y anticipado; en escalonado el rango ya son las fechas de los cheques.
 */
export function proponerCheques(
  fechaFactura: string,
  monto: number,
  p: PlanPago | null | undefined,
  config: FechasChequeMes[],
): ChequePropuesto[] {
  if (!fechaFactura || !p?.condicion_pago || !(monto > 0)) return [];
  const plazo = p.plazo_cheque_dias || 0;
  if (p.condicion_pago === "escalonado" && p.dias_pago != null && p.dias_pago_hasta != null) {
    const desde = sumarDias(fechaFactura, p.dias_pago);
    const hasta = sumarDias(fechaFactura, Math.max(p.dias_pago, p.dias_pago_hasta));
    const fechas = fechasPermitidas(desde, hasta, config);
    if (fechas.length === 0) return [cheque(hasta, monto)];
    const montos = repartir(monto, fechas.length);
    return fechas.map((f, i) => cheque(f, montos[i]));
  }
  const d = diasHastaVencer(p);
  if (d == null) return [];
  const limite = sumarDias(fechaFactura, d + plazo);
  if (p.condicion_pago !== "cuenta_corriente") return [cheque(limite, monto)];
  // Última fecha fija que no pasa el vencimiento, buscando hasta 45 días antes.
  const previas = fechasPermitidas(sumarDias(limite, -45), limite, config).filter((f) => f >= fechaFactura);
  return [cheque(previas.length ? previas[previas.length - 1] : limite, monto)];
}

const FORMA_PAGO_VIEJA: Record<string, string> = { transferencia: "Transferencia", echeq: "Echeq", cheque: "Cheque", tarjeta: "Tarjeta", efectivo: "Efectivo" };

/** forma_pago / dias_cuenta_corriente viejos (los usan Finanzas y la OP) a partir del plan nuevo. Si el plan no dice nada, quedan como estaban. */
export function legacyDesdePlan(p: PlanPago, actual: { forma_pago: string; dias_cuenta_corriente: number }): { forma_pago: string; dias_cuenta_corriente: number } {
  const forma_pago = FORMA_PAGO_VIEJA[p.medio_pago_preferido || ""] || actual.forma_pago;
  const d = p.condicion_pago ? diasHastaVencer(p) : null;
  return { forma_pago, dias_cuenta_corriente: d ?? actual.dias_cuenta_corriente };
}
