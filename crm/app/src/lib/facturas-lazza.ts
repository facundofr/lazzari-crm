// Finanzas Lazza → Facturas (Augusto 19/10/2026): una fila por factura, Ventas y Compras separadas, con saldo, estado,
// días al vencimiento y con qué se pagó/cobró (OP o recibo). Se tildan varias y se pagan/cobran con la ventana de siempre.
// Funciones puras (prueba: scripts/test-facturas-lazza.ts). Los saldos vienen de las mismas reglas de las cuentas corrientes.

export type LadoFactura = "venta" | "compra";
export type EstadoFactura = "pendiente" | "parcial" | "vencida" | "pagada" | "anulada" | "nc" | "cheque_cartera" | "cheque_depositado" | "cheque_endosado";
export type FiltroFacturas = "pendientes" | "por_vencer" | "vencidas" | "todas";
export type Moneda = "ARS" | "USD";

/** OP (compras) o recibo (ventas) con que se pagó/cobró la factura. */
export interface DocPago { tipo: "op" | "recibo"; id: string; numero: string }

/**
 * Cheque con que se cobró la factura y que todavía no se acreditó (Augusto 20/10: "no las des por cobradas hasta que
 * no lo verifiques"). La factura no dice "Cobrada" hasta que el cheque pase a cobrado (al cruzar el extracto del banco).
 * Fecha: la del depósito (o la del endoso). El saldo no cambia: si el cheque vuelve, el rechazo reabre la factura.
 */
export interface ChequeFactura { estado: "cartera" | "depositado" | "endosado"; fecha: string | null; numero: string }

export interface FilaFactura {
  lado: LadoFactura;
  id: string;
  /** Cliente o proveedor. */
  entidadId: string | null;
  nombre: string;
  /** Fecha de la factura. */
  fecha: string;
  /** Vencimiento (o la fecha de la factura si no tiene). */
  vence: string;
  sinVencimiento: boolean;
  /** Días hasta el vencimiento (negativo = vencida). */
  dias: number;
  comprobante: string;
  moneda: Moneda;
  total: number;
  saldo: number;
  estado: EstadoFactura;
  /** Tiene algo pagado/cobrado pero no todo. */
  parcial: boolean;
  /** Solo ventas. */
  ocCliente: string;
  vendedor: string;
  docs: DocPago[];
  /** Solo ventas: cheque sin acreditar con que se cobró. */
  cheque?: ChequeFactura;
  /** Neto (sin IVA), en la moneda de la factura. */
  neto: number;
  /** Solo ventas: cuándo se mandó por mail (null = no figura enviada) y estado del mail ("bounced" = rebotó). */
  enviada: string | null;
  envioEstado: string | null;
  /** Marcada a mano como "Enviada por fuera" (sin mail del sistema). */
  porFuera?: boolean;
}

export interface FacturaBase {
  id: string;
  entidadId: string | null;
  nombre: string;
  fecha: string;
  fecha_vencimiento?: string | null;
  comprobante: string;
  moneda: string | null;
  total: number | string | null;
  /** Estado guardado en la base (solo importa "anulada"). */
  estado: string | null;
  nc: boolean;
  saldo: number;
  ocCliente?: string | null;
  vendedor?: string | null;
  neto?: number | string | null;
  enviada?: string | null;
  envioEstado?: string | null;
  porFuera?: boolean;
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/** Vencida gana sobre parcial (lo urgente primero); el "parcial" se muestra aparte. */
export function estadoFactura(f: { anulada: boolean; nc: boolean; total: number; saldo: number; dias: number; cheque?: ChequeFactura }): { estado: EstadoFactura; parcial: boolean } {
  if (f.anulada) return { estado: "anulada", parcial: false };
  if (f.nc) return { estado: "nc", parcial: false };
  if (f.saldo <= 0.005) return { estado: f.cheque ? `cheque_${f.cheque.estado}` : "pagada", parcial: false };
  const parcial = f.saldo < num(f.total) - 0.005;
  if (f.dias < 0) return { estado: "vencida", parcial };
  return { estado: parcial ? "parcial" : "pendiente", parcial };
}

export function etiquetaEstado(e: EstadoFactura, lado: LadoFactura): string {
  switch (e) {
    case "pendiente": return "Pendiente";
    case "parcial": return "Parcial";
    case "vencida": return "Vencida";
    case "pagada": return lado === "venta" ? "Cobrada" : "Pagada";
    case "anulada": return "Anulada";
    case "nc": return "Nota de crédito";
    case "cheque_cartera": return "Cheque en cartera";
    case "cheque_depositado": return "Cheque depositado";
    case "cheque_endosado": return "Cheque endosado";
  }
}

const PRIORIDAD_CHEQUE: Record<ChequeFactura["estado"], number> = { cartera: 0, depositado: 1, endosado: 2 };

/**
 * factura_id → el cheque sin acreditar con que se cobró (en cartera, depositado o endosado). Si hay varios, el más
 * atrasado (en cartera antes que depositado). Cheques de cobros anulados no cuentan.
 */
export function chequesSinAcreditarPorFactura(
  cheques: { movimiento_id: string | null; estado: string | null; numero?: string | null; fecha_deposito?: string | null; fecha_endoso?: string | null }[],
  movimientos: { id: string; factura_id?: string | null; anulado?: boolean | null }[],
  aplicaciones: { movimiento_id?: string | null; factura_id: string | null; movimientos?: { anulado?: boolean | null } | { anulado?: boolean | null }[] | null }[],
): Map<string, ChequeFactura> {
  const ESTADO: Record<string, ChequeFactura["estado"]> = { en_cartera: "cartera", depositado: "depositado", endosado: "endosado" };
  const porMov = new Map<string, ChequeFactura>();
  for (const c of cheques) {
    const estado = ESTADO[String(c.estado || "")];
    if (!estado || !c.movimiento_id) continue;
    const fecha = (estado === "endosado" ? c.fecha_endoso : estado === "depositado" ? c.fecha_deposito : null) || null;
    porMov.set(c.movimiento_id, { estado, fecha: fecha ? String(fecha).slice(0, 10) : null, numero: String(c.numero || "").replace(/^0+(?=\d)/, "") });
  }
  const out = new Map<string, ChequeFactura>();
  const poner = (facturaId: string | null | undefined, ch: ChequeFactura | undefined) => {
    if (!facturaId || !ch) return;
    const ya = out.get(facturaId);
    if (!ya || PRIORIDAD_CHEQUE[ch.estado] < PRIORIDAD_CHEQUE[ya.estado]) out.set(facturaId, ch);
  };
  const anulado = (a: (typeof aplicaciones)[number]) => [a.movimientos].flat().some((m) => m?.anulado);
  const conAplicacion = new Set<string>();
  for (const a of aplicaciones) {
    if (!a.movimiento_id) continue;
    conAplicacion.add(a.movimiento_id);
    if (!anulado(a)) poner(a.factura_id, porMov.get(a.movimiento_id));
  }
  for (const m of movimientos) if (!m.anulado && !conAplicacion.has(m.id)) poner(m.factura_id, porMov.get(m.id));
  return out;
}

export function armarFilasFacturas(input: { lado: LadoFactura; hoy: string; facturas: FacturaBase[]; docs?: Map<string, DocPago[]>; cheques?: Map<string, ChequeFactura> }): FilaFactura[] {
  const out = input.facturas.map((f): FilaFactura => {
    const fecha = String(f.fecha).slice(0, 10);
    const vence = String(f.fecha_vencimiento || f.fecha).slice(0, 10);
    const dias = diasEntre(input.hoy, vence);
    const total = r2(num(f.total));
    const anulada = f.estado === "anulada";
    const saldo = anulada || f.nc ? 0 : r2(f.saldo);
    const cheque = input.cheques?.get(f.id);
    const { estado, parcial } = estadoFactura({ anulada, nc: f.nc, total, saldo, dias, cheque });
    return {
      lado: input.lado, id: f.id, entidadId: f.entidadId, nombre: f.nombre || "", fecha, vence, sinVencimiento: !f.fecha_vencimiento, dias,
      comprobante: f.comprobante, moneda: String(f.moneda || "").toUpperCase() === "USD" ? "USD" : "ARS", total, saldo, estado, parcial,
      ocCliente: f.ocCliente || "", vendedor: f.vendedor || "", docs: input.docs?.get(f.id) || [], ...(cheque ? { cheque } : {}),
      neto: f.neto === null || f.neto === undefined ? total : r2(num(f.neto)), enviada: f.enviada ? String(f.enviada).slice(0, 10) : null, envioEstado: f.envioEstado || null, porFuera: !!f.porFuera,
    };
  });
  return ordenarFacturas(out);
}

/** Con saldo primero, por vencimiento (la más vencida arriba); después el resto, de la más nueva a la más vieja. */
export function ordenarFacturas(filas: FilaFactura[]): FilaFactura[] {
  return [...filas].sort((a, b) => {
    const da = a.saldo > 0.005 ? 0 : 1, db = b.saldo > 0.005 ? 0 : 1;
    if (da !== db) return da - db;
    if (da === 0) return a.vence.localeCompare(b.vence) || a.nombre.localeCompare(b.nombre);
    return b.fecha.localeCompare(a.fecha) || a.nombre.localeCompare(b.nombre);
  });
}

/** Enviada por mail = tiene fecha de envío y no rebotó (lo mismo que muestra la columna "Enviada"). */
export const facturaEnviada = (x: FilaFactura) => !!x.enviada && x.envioEstado !== "bounced";

/** `envio`: "si" = solo enviadas por mail, "no" = solo no enviadas (o rebotadas), "" = todas. */
export function filtrarFacturas(filas: FilaFactura[], f: { filtro: FiltroFacturas; texto?: string; envio?: "" | "si" | "no" }): FilaFactura[] {
  const q = sinAcentos((f.texto || "").trim());
  return filas.filter((x) => {
    if (f.envio === "si" && !facturaEnviada(x)) return false;
    if (f.envio === "no" && facturaEnviada(x)) return false;
    if (f.filtro === "pendientes" && x.saldo <= 0.005) return false;
    if (f.filtro === "vencidas" && (x.saldo <= 0.005 || x.dias >= 0)) return false;
    if (f.filtro === "por_vencer" && (x.saldo <= 0.005 || x.dias < 0 || x.dias > DIAS_POR_VENCER)) return false;
    if (q && !sinAcentos(`${x.comprobante} ${x.nombre} ${x.ocCliente} ${x.vendedor} ${x.docs.map((d) => d.numero).join(" ")}`).includes(q)) return false;
    return true;
  });
}

export function totalesFacturas(filas: FilaFactura[]): { cantidad: number; saldo: Record<Moneda, number>; vencido: Record<Moneda, number> } {
  const t = { cantidad: filas.length, saldo: { ARS: 0, USD: 0 }, vencido: { ARS: 0, USD: 0 } };
  for (const f of filas) {
    if (f.saldo <= 0.005) continue;
    t.saldo[f.moneda] = r2(t.saldo[f.moneda] + f.saldo);
    if (f.dias < 0) t.vencido[f.moneda] = r2(t.vencido[f.moneda] + f.saldo);
  }
  return t;
}

/** Se puede tildar: tiene saldo y tiene cliente/proveedor. */
export const sePuedeTildar = (f: FilaFactura) => f.saldo > 0.005 && !!f.entidadId;

/**
 * Lo tildado → con qué se abre la ventana de pago/cobro. Una OP/un cobro es de UN proveedor/cliente y de UNA moneda:
 * si hay más, se sigue con el primero que se tildó y se avisa (nunca frena).
 */
export function prepararSeleccion(tildadas: FilaFactura[], lado: LadoFactura): { entidadId: string; nombre: string; ids: string[]; moneda: Moneda; saldo: number; avisos: string[] } | null {
  const validas = tildadas.filter(sePuedeTildar);
  if (!validas.length) return null;
  const primera = validas[0];
  const deLaEntidad = validas.filter((f) => f.entidadId === primera.entidadId);
  const enMoneda = deLaEntidad.filter((f) => f.moneda === primera.moneda);
  const avisos: string[] = [];
  const otras = [...new Set(validas.filter((f) => f.entidadId !== primera.entidadId).map((f) => f.nombre || "sin nombre"))];
  if (otras.length) {
    avisos.push(lado === "compra"
      ? `Una OP es de un solo proveedor. Tildaste ${primera.nombre} y ${otras.join(", ")}: sigo con ${primera.nombre}; las otras pagalas después.`
      : `Un cobro es de un solo cliente. Tildaste ${primera.nombre} y ${otras.join(", ")}: sigo con ${primera.nombre}; las otras cobralas después.`);
  }
  if (enMoneda.length < deLaEntidad.length) {
    avisos.push(`Tildaste facturas en $ y en US$: van por separado. Sigo con las de ${primera.moneda === "USD" ? "US$" : "$"}.`);
  }
  return { entidadId: primera.entidadId!, nombre: primera.nombre, ids: enMoneda.map((f) => f.id), moneda: primera.moneda, saldo: r2(enMoneda.reduce((s, f) => s + f.saldo, 0)), avisos };
}

/** factura_id → recibos que la cobraron (sin anulados), del más nuevo al más viejo. */
export function recibosPorFactura(recibos: { id: string; numero: number; anulado: boolean; facturaIds: string[] }[]): Map<string, DocPago[]> {
  const out = new Map<string, DocPago[]>();
  for (const r of [...recibos].sort((a, b) => b.numero - a.numero)) {
    if (r.anulado) continue;
    for (const fid of r.facturaIds) {
      const l = out.get(fid) || [];
      if (!l.some((d) => d.id === r.id)) l.push({ tipo: "recibo", id: r.id, numero: `Recibo ${r.numero}` });
      out.set(fid, l);
    }
  }
  return out;
}

/** "Por vencer" = vence hoy o en los próximos 7 días (Augusto 20/10). */
export const DIAS_POR_VENCER = 7;

/** Cantidad y monto de las vencidas y de las que vencen en los próximos 7 días (con saldo). */
export function resumenVencimientos(filas: FilaFactura[]): Record<"vencidas" | "porVencer", { cantidad: number; monto: Record<Moneda, number> }> {
  const out = { vencidas: { cantidad: 0, monto: { ARS: 0, USD: 0 } }, porVencer: { cantidad: 0, monto: { ARS: 0, USD: 0 } } };
  for (const f of filas) {
    if (f.saldo <= 0.005) continue;
    const g = f.dias < 0 ? out.vencidas : f.dias <= DIAS_POR_VENCER ? out.porVencer : null;
    if (!g) continue;
    g.cantidad += 1;
    g.monto[f.moneda] = r2(g.monto[f.moneda] + f.saldo);
  }
  return out;
}

export interface ComprobanteMes { tipo: string | null; subtotal: number | string | null; iva: number | string | null; total: number | string | null; moneda: string | null; tipo_cambio?: number | string | null; cae?: string | null }

/**
 * Facturado del mes en $ (Augusto 20/10: "lo que va facturado x mes, pasalo a $ARG. Neto + iva"): facturas con CAE
 * del mes menos las NC del mes; lo que está en US$ pasa a $ con la cotización de cada factura. Las anuladas cuentan
 * (su NC las resta). Los comprobantes X (sin CAE) no suman: van aparte. Sin cotización: no suma y se avisa.
 */
export function facturadoDelMes(comprobantes: ComprobanteMes[]): { neto: number; iva: number; total: number; facturas: number; nc: number; sinTC: number; x: { cantidad: number; total: number } } {
  const out = { neto: 0, iva: 0, total: 0, facturas: 0, nc: 0, sinTC: 0, x: { cantidad: 0, total: 0 } };
  for (const c of comprobantes) {
    const tipo = String(c.tipo || "").toUpperCase();
    const usd = String(c.moneda || "").toUpperCase() === "USD";
    const tc = usd ? num(c.tipo_cambio) : 1;
    if (usd && tc <= 0) { out.sinTC += 1; continue; }
    if (tipo === "X" || !c.cae) { out.x.cantidad += 1; out.x.total = r2(out.x.total + num(c.total) * tc); continue; }
    const signo = tipo.startsWith("NC") ? -1 : 1;
    if (signo < 0) out.nc += 1; else out.facturas += 1;
    out.neto = r2(out.neto + signo * num(c.subtotal) * tc);
    out.iva = r2(out.iva + signo * num(c.iva) * tc);
    out.total = r2(out.total + signo * num(c.total) * tc);
  }
  return out;
}

/** "Augusto Lazzari" → "AL". */
export const iniciales = (nombre: string | null | undefined) =>
  String(nombre || "").trim().split(/\s+/).filter(Boolean).slice(0, 3).map((p) => p[0]!.toUpperCase()).join("");
