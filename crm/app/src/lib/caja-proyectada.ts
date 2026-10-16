/**
 * Caja proyectada de las próximas semanas, Cobrar por cliente y Pagar por semana (Finanzas, 16/10/2026).
 * Funciones puras: la pantalla les pasa lo que ya tiene cargado (saldos, cheques, facturas, gastos fijos).
 *
 * Reglas (pedido de Augusto 16/10/2026):
 * - Arranca con la plata de hoy (bancos + FCI + efectivo) y suma/resta día por día.
 * - Entradas: facturas de venta por vencimiento y cheques en cartera por fecha de pago.
 *   Lo vencido sin cobrar NO se cuenta (no se sabe cuándo entra): se muestra aparte.
 * - Salidas: cheques emitidos por fecha de pago, facturas de compra por vencimiento, gastos fijos del mes sin pagar.
 *   Lo atrasado se cuenta HOY (hay que pagarlo).
 * - Los préstamos que paga un tercero (BNA 1 Luis María, BNA 2 Andrés) NO entran en la caja: se muestran aparte.
 * - Avisa el primer día en que no alcanza; nunca traba.
 *
 * Prueba: npx tsx scripts/test-caja-proyectada.ts
 */

export type TipoCaja = "factura_venta" | "cheque_cartera" | "cheque_emitido" | "factura_compra" | "gasto_fijo";

export interface MovCaja {
  fecha: string;          // YYYY-MM-DD
  monto: number;          // siempre positivo, en pesos
  tipo: TipoCaja;
  detalle: string;        // "FA 0015-00000012 — Corteva Seeds"
  quien?: string | null;  // cliente / proveedor / a quién se entregó el cheque
  /** Si vino en dólares: importe original (se pasó a pesos con el TC). */
  usd?: number | null;
}

export interface DiaCaja {
  fecha: string;
  entra: number;
  sale: number;
  saldo: number;
  items: (MovCaja & { sentido: "entra" | "sale"; atrasado?: boolean })[];
}

export interface SemanaCaja { desde: string; hasta: string; entra: number; sale: number; saldoFinal: number }

export interface CajaProyectada {
  saldoInicial: number;
  dias: DiaCaja[];
  semanas: SemanaCaja[];
  /** Primer día con saldo negativo (no alcanza) y cuánto falta ese día. */
  primerFaltante: { fecha: string; falta: number } | null;
  minimo: { fecha: string; saldo: number };
  /** Salidas con fecha anterior a hoy: se cuentan hoy. */
  atrasado: number;
  /** Entradas vencidas sin cobrar: no se cuentan. */
  vencidoSinCobrar: { total: number; items: MovCaja[] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de la fecha. */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return sumarDias(fecha, -dow);
}

export function proyectarCaja(x: { hoy: string; dias?: number; saldoInicial: number; entradas: MovCaja[]; salidas: MovCaja[] }): CajaProyectada {
  const nDias = x.dias ?? 28;
  const fin = sumarDias(x.hoy, nDias - 1);
  const dias: DiaCaja[] = Array.from({ length: nDias }, (_, i) => ({ fecha: sumarDias(x.hoy, i), entra: 0, sale: 0, saldo: 0, items: [] }));
  const idx = new Map(dias.map((d, i) => [d.fecha, i]));
  const vencidas: MovCaja[] = [];
  let atrasado = 0;

  for (const e of x.entradas) {
    if (!(e.monto > 0)) continue;
    const f = e.fecha.slice(0, 10);
    if (f < x.hoy) { vencidas.push(e); continue; }
    if (f > fin) continue;
    const d = dias[idx.get(f)!];
    d.entra += e.monto;
    d.items.push({ ...e, sentido: "entra" });
  }
  for (const s of x.salidas) {
    if (!(s.monto > 0)) continue;
    const f = s.fecha.slice(0, 10);
    if (f > fin) continue;
    const esAtrasado = f < x.hoy;
    const d = dias[esAtrasado ? 0 : idx.get(f)!];
    if (esAtrasado) atrasado += s.monto;
    d.sale += s.monto;
    d.items.push({ ...s, sentido: "sale", atrasado: esAtrasado || undefined });
  }

  let saldo = x.saldoInicial;
  let primerFaltante: CajaProyectada["primerFaltante"] = null;
  let minimo = { fecha: x.hoy, saldo: x.saldoInicial };
  for (const d of dias) {
    d.entra = r2(d.entra);
    d.sale = r2(d.sale);
    saldo = r2(saldo + d.entra - d.sale);
    d.saldo = saldo;
    d.items.sort((a, b) => (a.sentido === b.sentido ? b.monto - a.monto : a.sentido === "entra" ? -1 : 1));
    if (saldo < minimo.saldo) minimo = { fecha: d.fecha, saldo };
    if (!primerFaltante && saldo < 0) primerFaltante = { fecha: d.fecha, falta: r2(-saldo) };
  }

  const semanas: SemanaCaja[] = [];
  for (const d of dias) {
    const desde = lunesDe(d.fecha);
    let w = semanas[semanas.length - 1];
    if (!w || w.desde !== desde) { w = { desde, hasta: sumarDias(desde, 6), entra: 0, sale: 0, saldoFinal: 0 }; semanas.push(w); }
    w.entra = r2(w.entra + d.entra);
    w.sale = r2(w.sale + d.sale);
    w.saldoFinal = d.saldo;
  }

  return {
    saldoInicial: x.saldoInicial, dias, semanas, primerFaltante, minimo, atrasado: r2(atrasado),
    vencidoSinCobrar: { total: r2(vencidas.reduce((s, e) => s + e.monto, 0)), items: vencidas.sort((a, b) => b.monto - a.monto) },
  };
}

export interface GastoFijoCaja {
  id: string;
  descripcion: string;
  monto: number;
  moneda: "ARS" | "USD";
  activo: boolean;
  diaVencimiento?: number | null;
  dolarReferencia?: number | null;
  /** Si lo factura un proveedor (ej. el contador) y la factura del mes ya está cargada, se cuenta la factura y no el gasto fijo. */
  proveedorId?: string | null;
}

/** Gastos fijos que vencen en la ventana y no están pagados ese mes. Sin día de vencimiento se toma el 10. */
export function gastosFijosEnVentana(x: {
  hoy: string; dias?: number; fijos: GastoFijoCaja[];
  pagos: { gasto_fijo_id?: string | null; fecha: string }[];
  /** Facturas de compra cargadas (proveedor y fecha): evita contar dos veces el gasto fijo y su factura. */
  facturasCompra?: { proveedor_id: string | null; fecha: string }[];
  /** Dólar para pasar a pesos los gastos en US$ que no tienen dólar de referencia. */
  dolar?: number | null;
}): { salidas: MovCaja[]; sinDolar: string[] } {
  const fin = sumarDias(x.hoy, (x.dias ?? 28) - 1);
  const meses: string[] = [];
  for (let m = x.hoy.slice(0, 7); m <= fin.slice(0, 7);) {
    meses.push(m);
    const [y, mm] = m.split("-").map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  }
  const salidas: MovCaja[] = [];
  const sinDolar: string[] = [];
  for (const g of x.fijos) {
    if (!g.activo || !(g.monto > 0)) continue;
    let monto = g.monto;
    let usd: number | null = null;
    if (g.moneda === "USD") {
      const tc = g.dolarReferencia || x.dolar || 0;
      if (!tc) { sinDolar.push(g.descripcion); continue; }
      usd = g.monto;
      monto = r2(g.monto * tc);
    }
    for (const mes of meses) {
      if (x.pagos.some((p) => p.gasto_fijo_id === g.id && p.fecha?.slice(0, 7) === mes)) continue;
      if (g.proveedorId && (x.facturasCompra || []).some((f) => f.proveedor_id === g.proveedorId && f.fecha?.slice(0, 7) === mes)) continue;
      const [y, mm] = mes.split("-").map(Number);
      const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate();
      const fecha = `${mes}-${String(Math.min(g.diaVencimiento || 10, ultimo)).padStart(2, "0")}`;
      if (fecha > fin) continue;
      // Un mes anterior al actual no se arrastra: solo el mes en curso puede estar atrasado.
      if (fecha < x.hoy && mes !== x.hoy.slice(0, 7)) continue;
      salidas.push({ fecha, monto, tipo: "gasto_fijo", detalle: g.descripcion, usd });
    }
  }
  return { salidas, sinDolar };
}

export interface DeudaCliente {
  entidad_id: string;
  entidad_nombre: string;
  documento: string;
  vencimiento: string;
  saldo: number;
  moneda: "ARS" | "USD";
}

export interface ClienteACobrar {
  cliente_id: string;
  nombre: string;
  ARS: { total: number; vencido: number };
  USD: { total: number; vencido: number };
  facturas: number;
  proximoVencimiento: string | null;
  /** Días de la factura más vencida (0 si ninguna vencida). */
  diasMasVencida: number;
  ultimoCobro: { fecha: string; monto: number } | null;
  documentos: DeudaCliente[];
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/** Un renglón por cliente: cuánto debe, cuánto está vencido, próximo vencimiento y último cobro. */
export function clientesACobrar(deudas: DeudaCliente[], hoy: string, ultimosCobros: Map<string, { fecha: string; monto: number }> = new Map(), tcUsd?: number | null): ClienteACobrar[] {
  const por = new Map<string, ClienteACobrar>();
  for (const d of deudas) {
    if (!(d.saldo > 0.005)) continue;
    let c = por.get(d.entidad_id);
    if (!c) {
      c = { cliente_id: d.entidad_id, nombre: d.entidad_nombre, ARS: { total: 0, vencido: 0 }, USD: { total: 0, vencido: 0 }, facturas: 0, proximoVencimiento: null, diasMasVencida: 0, ultimoCobro: ultimosCobros.get(d.entidad_id) || null, documentos: [] };
      por.set(d.entidad_id, c);
    }
    const m = c[d.moneda];
    m.total = r2(m.total + d.saldo);
    const venc = d.vencimiento.slice(0, 10);
    if (venc < hoy) { m.vencido = r2(m.vencido + d.saldo); c.diasMasVencida = Math.max(c.diasMasVencida, diasEntre(venc, hoy)); }
    else if (!c.proximoVencimiento || venc < c.proximoVencimiento) c.proximoVencimiento = venc;
    c.facturas++;
    c.documentos.push(d);
  }
  const pesos = (c: ClienteACobrar, k: "total" | "vencido") => c.ARS[k] + c.USD[k] * (tcUsd || 0);
  return [...por.values()]
    .map((c) => ({ ...c, documentos: c.documentos.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento)) }))
    .sort((a, b) => pesos(b, "vencido") - pesos(a, "vencido") || pesos(b, "total") - pesos(a, "total"));
}

export interface SemanaPagar { desde: string; hasta: string; total: number; items: MovCaja[] }

/** Pagar como línea de tiempo: lo atrasado y las próximas semanas (lunes a domingo), con cada pago. */
export function pagosPorSemana(salidas: MovCaja[], hoy: string, semanas = 4): { atrasado: SemanaPagar; semanas: SemanaPagar[]; despues: number } {
  const lunes = lunesDe(hoy);
  const ws: SemanaPagar[] = Array.from({ length: semanas }, (_, i) => ({ desde: sumarDias(lunes, i * 7), hasta: sumarDias(lunes, i * 7 + 6), total: 0, items: [] }));
  const atrasado: SemanaPagar = { desde: "", hasta: sumarDias(hoy, -1), total: 0, items: [] };
  let despues = 0;
  for (const s of salidas) {
    if (!(s.monto > 0)) continue;
    const f = s.fecha.slice(0, 10);
    if (f < hoy) { atrasado.items.push(s); atrasado.total = r2(atrasado.total + s.monto); continue; }
    const w = ws.find((x) => f >= x.desde && f <= x.hasta);
    if (!w) { despues = r2(despues + s.monto); continue; }
    w.items.push(s);
    w.total = r2(w.total + s.monto);
  }
  for (const w of [atrasado, ...ws]) w.items.sort((a, b) => a.fecha.localeCompare(b.fecha) || b.monto - a.monto);
  return { atrasado, semanas: ws, despues };
}
