// Inicio de Augusto (02/11/2026, boceto D elegido con Augusto): la plata de un vistazo y todo en pesos.
// Solo cuentas (sin base): a cobrar y a pagar por plazo (vencido, esta semana, las 3 siguientes, más adelante), los cheques
// propios a cubrir por fecha, la agenda de esta semana y las frases de arriba (armadas con los números, sin IA).
// Reglas: los saldos por factura son los de Finanzas (traerDeudas → armarVencimientos); los cheques, los de Cheques
// (lib/cheques-lazza: en fecha desde la fecha de pago hasta 30 días; pasados los 30 días el cheque venció y no se cubre).
// Lo que falta cobrar o pagar en dólares pasa a pesos con el dólar divisa del BNA del día (el de Finanzas); lo facturado va
// con el cambio de cada factura (facturadoMesNeto.equivalenteARS). Nunca se compara con el saldo del banco (Augusto 28/10).
// Prueba: scripts/test-tablero-inicio.ts
import type { FilaVencimiento } from "./finanzas-lazza";
import { domingoDe } from "./cheques-plazo";
import { fechaACubrir as fechaACubrirComun } from "./cheques-lazza";
import { normalizarMoneda } from "./reportes-comprobantes";

export interface ChequeTablero {
  id: string;
  numero: string | null;
  monto: number | string | null;
  moneda?: string | null;
  fecha_pago: string | null;
  estado: string;
  direccion?: string | null;
  destino_nombre?: string | null;
  /** Estado según el banco (reporte eCheq): PAGADO = ya debitado, no se cubre. */
  estadoBanco?: string | null;
}

export interface Semana { desde: string; hasta: string }

/** Importes por plazo, en pesos. `semanas[0]` es esta semana. */
export interface Plazos {
  vencido: number;
  semanas: number[];
  despues: number;
  total: number;
  /** Dólares que están adentro del total (en dólares), para mostrar "incluye US$ …". */
  usd: number;
  cantidad: number;
}

export interface ItemAgenda {
  fecha: string;
  tipo: "cobro" | "pago" | "cheque";
  nombre: string;
  detalle: string;
  pesos: number;
  usd: number | null;
  entidadId: string | null;
  /** Cheques del mismo día y del mismo destinatario van juntos en un renglón (los cobros y pagos, de a uno). */
  cantidad: number;
  /** Cheque con la fecha de pago ya pasada (en fecha): el banco lo puede debitar cualquier día. */
  enFechaDesde?: string;
}

const masDias = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const esUsd = (m: string | null | undefined) => normalizarMoneda(m) === "USD";

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreDia = (f: string) => DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()];

/** Esta semana (de hoy al domingo; un domingo, hasta el domingo que viene) y las siguientes, de lunes a domingo. */
export function semanasTablero(hoy: string, cuantas = 4): Semana[] {
  let desde = hoy;
  let hasta = domingoDe(hoy);
  if (hasta === hoy) hasta = masDias(hoy, 7);
  const out: Semana[] = [];
  for (let i = 0; i < cuantas; i++) {
    out.push({ desde, hasta });
    desde = masDias(hasta, 1);
    hasta = masDias(hasta, 7);
  }
  return out;
}

/** Un importe en pesos: los dólares, al dólar del día (sin dólar del día no se pueden pasar y cuentan 0). */
export function aPesos(monto: number, moneda: string | null | undefined, dolar: number | null): number {
  return esUsd(moneda) ? (dolar ? monto * dolar : 0) : monto;
}

const vacio = (n: number): Plazos => ({ vencido: 0, semanas: Array(n).fill(0), despues: 0, total: 0, usd: 0, cantidad: 0 });
const cerrar = (p: Plazos): Plazos => ({ ...p, vencido: r2(p.vencido), semanas: p.semanas.map(r2), despues: r2(p.despues), total: r2(p.total), usd: r2(p.usd) });

/** A cobrar (lado "venta") o a pagar ("compra") por plazo. Vencido = vencía antes de hoy. */
export function plazosFacturas(filas: FilaVencimiento[], lado: "venta" | "compra", hoy: string, dolar: number | null, semanas: Semana[]): Plazos {
  const p = vacio(semanas.length);
  for (const f of filas) {
    if (f.lado !== lado || !(f.saldo > 0.005)) continue;
    const pesos = aPesos(f.saldo, f.moneda, dolar);
    if (esUsd(f.moneda)) p.usd += f.saldo;
    p.total += pesos;
    p.cantidad++;
    if (f.vence < hoy) { p.vencido += pesos; continue; }
    const i = semanas.findIndex((s) => f.vence >= s.desde && f.vence <= s.hasta);
    if (i >= 0) p.semanas[i] += pesos; else p.despues += pesos;
  }
  return cerrar(p);
}

/** Fecha de pago de un cheque propio que todavía hay que cubrir, o null. La regla es la de todo el CRM (lib/cheques-lazza, P07);
 *  los que el banco ya debitó según el extracto los saca la pantalla antes de llamar (leerChequesDebitados). */
function fechaACubrir(ch: ChequeTablero, hoy: string): string | null {
  // La fecha de pago original (la agenda muestra "en fecha desde …"); el que ya está en fecha cuenta esta semana.
  return fechaACubrirComun(ch, hoy) ? String(ch.fecha_pago).slice(0, 10) : null;
}

/** Cheques propios a cubrir por plazo. Los que ya están en fecha cuentan en esta semana: el banco los puede debitar cualquier día. */
export function plazosCheques(cheques: ChequeTablero[], hoy: string, dolar: number | null, semanas: Semana[]): Plazos {
  const p = vacio(semanas.length);
  for (const ch of cheques) {
    const f = fechaACubrir(ch, hoy);
    if (!f) continue;
    const monto = Number(ch.monto) || 0;
    const pesos = aPesos(monto, ch.moneda, dolar);
    if (esUsd(ch.moneda)) p.usd += monto;
    p.total += pesos;
    p.cantidad++;
    const i = f < hoy ? 0 : semanas.findIndex((s) => f >= s.desde && f <= s.hasta);
    if (i >= 0) p.semanas[i] += pesos; else p.despues += pesos;
  }
  return cerrar(p);
}

/** Cheques a cubrir de esta semana, día por día (los que ya están en fecha, hoy). */
export function chequesPorDia(cheques: ChequeTablero[], hoy: string, dolar: number | null, semana: Semana): Array<{ fecha: string; pesos: number; cantidad: number }> {
  const dias: Array<{ fecha: string; pesos: number; cantidad: number }> = [];
  for (let f = semana.desde; f <= semana.hasta; f = masDias(f, 1)) dias.push({ fecha: f, pesos: 0, cantidad: 0 });
  for (const ch of cheques) {
    const f = fechaACubrir(ch, hoy);
    if (!f || f > semana.hasta) continue;
    const d = dias.find((x) => x.fecha === (f < hoy ? hoy : f));
    if (!d) continue;
    d.pesos += aPesos(Number(ch.monto) || 0, ch.moneda, dolar);
    d.cantidad++;
  }
  return dias.map((d) => ({ ...d, pesos: r2(d.pesos) }));
}

/**
 * Lo que vence esta semana, por fecha: cobros, pagos y cheques a cubrir. Lo vencido no va: está en los números de arriba.
 * Los cheques del mismo día y del mismo destinatario van en un solo renglón (02/11: 11 cheques de Star Tex el mismo día).
 */
export function agendaSemana(filas: FilaVencimiento[], cheques: ChequeTablero[], hoy: string, dolar: number | null, semana: Semana): ItemAgenda[] {
  const out: ItemAgenda[] = [];
  for (const f of filas) {
    if (!(f.saldo > 0.005) || f.vence < hoy || f.vence > semana.hasta) continue;
    out.push({
      fecha: f.vence, tipo: f.lado === "venta" ? "cobro" : "pago", nombre: f.nombre, detalle: f.comprobante,
      pesos: r2(aPesos(f.saldo, f.moneda, dolar)), usd: esUsd(f.moneda) ? r2(f.saldo) : null, entidadId: f.entidadId, cantidad: 1,
    });
  }
  const juntos = new Map<string, ItemAgenda>();
  for (const ch of cheques) {
    const f = fechaACubrir(ch, hoy);
    if (!f || f > semana.hasta) continue;
    const fecha = f < hoy ? hoy : f;
    const monto = Number(ch.monto) || 0;
    const clave = `${fecha}|${(ch.destino_nombre || "").trim().toUpperCase()}`;
    const x = juntos.get(clave) || { fecha, tipo: "cheque" as const, nombre: ch.destino_nombre || "", detalle: "", pesos: 0, usd: null, entidadId: null, cantidad: 0 };
    x.pesos += aPesos(monto, ch.moneda, dolar);
    if (esUsd(ch.moneda)) x.usd = (x.usd || 0) + monto;
    x.cantidad++;
    x.detalle = x.cantidad > 1 ? `${x.cantidad} cheques` : `Cheque ${ch.numero || "s/n"}`;
    if (f < hoy && (!x.enFechaDesde || f < x.enFechaDesde)) x.enFechaDesde = f;
    juntos.set(clave, x);
  }
  for (const x of juntos.values()) out.push({ ...x, pesos: r2(x.pesos), usd: x.usd === null ? null : r2(x.usd) });
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.pesos - a.pesos);
}

/** $ 3,2 M · $ 950 mil · $ 197. */
export function pesosCorto(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 999_950) return `${s}$ ${(a / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (a >= 1_000) return `${s}$ ${Math.round(a / 1_000).toLocaleString("es-AR")} mil`;
  return `${s}$ ${Math.round(a).toLocaleString("es-AR")}`;
}

/** "hoy", "miércoles", "lunes y viernes", "lunes, miércoles y viernes". */
export function listaDias(fechas: string[], hoy: string): string {
  const n = [...new Set(fechas)].sort().map((f) => (f === hoy ? "hoy" : nombreDia(f)));
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} y ${n[n.length - 1]}`;
}

/** Un trozo de frase: texto común o un número resaltado. */
export type Parte = string | { fuerte: string; tono?: "naranja" | "rojo" };

export interface DatosFrases {
  hoy: string;
  /** Facturado del mes en pesos (null = no se pudo calcular). */
  facturado: number | null;
  /** El mes anterior hasta el mismo día. */
  facturadoAnterior: number | null;
  objetivo: number | null;
  cheques: { cantidad: number; pesos: number; fechas: string[] };
  pagosSemana: number;
  vencidoCobrar: number;
  mayorVencido: { nombre: string; pesos: number } | null;
}

/** Las 3 frases de arriba (sin IA): cómo va el mes, qué hay que cubrir esta semana y lo vencido para cobrar. */
export function frasesInicio(d: DatosFrases): Parte[][] {
  const out: Parte[][] = [];
  const mes = Number(d.hoy.slice(5, 7)) - 1;
  const dia = Number(d.hoy.slice(8, 10));
  if (d.facturado !== null && Math.abs(d.facturado) < 0.5) {
    out.push([`${MESES[mes][0].toUpperCase()}${MESES[mes].slice(1)} todavía no tiene facturas.`]);
  } else if (d.facturado !== null) {
    const nombreMes = MESES[mes];
    const f: Parte[] = dia <= 7
      ? [`${nombreMes[0].toUpperCase()}${nombreMes.slice(1)} arrancó con `, { fuerte: `${pesosCorto(d.facturado)} facturados` }]
      : [`En ${nombreMes} llevás `, { fuerte: `${pesosCorto(d.facturado)} facturados` }];
    if (dia > 7 && d.objetivo && d.objetivo > 0) f.push(`, el ${Math.round((d.facturado / d.objetivo) * 100)} % del objetivo`);
    // Contra el mes anterior hasta el mismo día, recién desde el día 8 (los primeros días dependen de qué día de la semana cayeron).
    if (dia > 7 && d.facturadoAnterior !== null && d.facturadoAnterior > 0) {
      const anterior = MESES[(mes + 11) % 12];
      const dif = (d.facturado - d.facturadoAnterior) / d.facturadoAnterior;
      f.push(Math.abs(dif) < 0.05
        ? `, parecido a ${anterior} a esta altura`
        : `, ${dif > 0 ? "más" : "menos"} que ${anterior} a esta altura (${pesosCorto(d.facturadoAnterior)})`);
    }
    out.push([...f, "."]);
  }
  const s: Parte[] = [];
  if (d.cheques.cantidad > 0) {
    const dias = new Set(d.cheques.fechas).size <= 3 ? ` (${listaDias(d.cheques.fechas, d.hoy)})` : "";
    s.push("Esta semana hay que cubrir ", { fuerte: `${d.cheques.cantidad} cheque${d.cheques.cantidad > 1 ? "s" : ""} por ${pesosCorto(d.cheques.pesos)}`, tono: "naranja" }, dias);
    if (d.pagosSemana > 0.005) s.push(` y vencen ${pesosCorto(d.pagosSemana)} de pagos`);
  } else if (d.pagosSemana > 0.005) {
    s.push(`Esta semana no hay cheques para cubrir y vencen ${pesosCorto(d.pagosSemana)} de pagos`);
  } else {
    s.push("Esta semana no hay cheques para cubrir ni pagos que venzan");
  }
  out.push([...s, "."]);
  if (d.vencidoCobrar > 0.005) {
    const v: Parte[] = ["Para cobrar hay ", { fuerte: `${pesosCorto(d.vencidoCobrar)} vencidos`, tono: "rojo" }];
    if (d.mayorVencido) v.push(`: lo más grande es ${d.mayorVencido.nombre} (${pesosCorto(d.mayorVencido.pesos)})`);
    out.push([...v, "."]);
  } else {
    out.push(["No hay nada vencido para cobrar."]);
  }
  return out;
}

/** El cliente que más debe vencido, en pesos. */
export function mayorVencido(filas: FilaVencimiento[], hoy: string, dolar: number | null): { nombre: string; pesos: number } | null {
  const porCliente = new Map<string, { nombre: string; pesos: number }>();
  for (const f of filas) {
    if (f.lado !== "venta" || !(f.saldo > 0.005) || f.vence >= hoy) continue;
    const k = f.entidadId || f.nombre;
    const x = porCliente.get(k) || { nombre: f.nombre, pesos: 0 };
    x.pesos += aPesos(f.saldo, f.moneda, dolar);
    porCliente.set(k, x);
  }
  const top = [...porCliente.values()].sort((a, b) => b.pesos - a.pesos)[0];
  return top ? { nombre: top.nombre, pesos: r2(top.pesos) } : null;
}
