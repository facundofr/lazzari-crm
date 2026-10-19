// Finanzas Lazza → Facturas (Augusto 19/10/2026): una fila por factura, Ventas y Compras separadas, con saldo, estado,
// días al vencimiento y con qué se pagó/cobró (OP o recibo). Se tildan varias y se pagan/cobran con la ventana de siempre.
// Funciones puras (prueba: scripts/test-facturas-lazza.ts). Los saldos vienen de las mismas reglas de las cuentas corrientes.

export type LadoFactura = "venta" | "compra";
export type EstadoFactura = "pendiente" | "parcial" | "vencida" | "pagada" | "anulada" | "nc";
export type FiltroFacturas = "pendientes" | "vencidas" | "todas";
export type Moneda = "ARS" | "USD";

/** OP (compras) o recibo (ventas) con que se pagó/cobró la factura. */
export interface DocPago { tipo: "op" | "recibo"; id: string; numero: string }

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
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/** Vencida gana sobre parcial (lo urgente primero); el "parcial" se muestra aparte. */
export function estadoFactura(f: { anulada: boolean; nc: boolean; total: number; saldo: number; dias: number }): { estado: EstadoFactura; parcial: boolean } {
  if (f.anulada) return { estado: "anulada", parcial: false };
  if (f.nc) return { estado: "nc", parcial: false };
  if (f.saldo <= 0.005) return { estado: "pagada", parcial: false };
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
  }
}

export function armarFilasFacturas(input: { lado: LadoFactura; hoy: string; facturas: FacturaBase[]; docs?: Map<string, DocPago[]> }): FilaFactura[] {
  const out = input.facturas.map((f): FilaFactura => {
    const fecha = String(f.fecha).slice(0, 10);
    const vence = String(f.fecha_vencimiento || f.fecha).slice(0, 10);
    const dias = diasEntre(input.hoy, vence);
    const total = r2(num(f.total));
    const anulada = f.estado === "anulada";
    const saldo = anulada || f.nc ? 0 : r2(f.saldo);
    const { estado, parcial } = estadoFactura({ anulada, nc: f.nc, total, saldo, dias });
    return {
      lado: input.lado, id: f.id, entidadId: f.entidadId, nombre: f.nombre || "", fecha, vence, sinVencimiento: !f.fecha_vencimiento, dias,
      comprobante: f.comprobante, moneda: String(f.moneda || "").toUpperCase() === "USD" ? "USD" : "ARS", total, saldo, estado, parcial,
      ocCliente: f.ocCliente || "", vendedor: f.vendedor || "", docs: input.docs?.get(f.id) || [],
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

export function filtrarFacturas(filas: FilaFactura[], f: { filtro: FiltroFacturas; texto?: string }): FilaFactura[] {
  const q = sinAcentos((f.texto || "").trim());
  return filas.filter((x) => {
    if (f.filtro === "pendientes" && x.saldo <= 0.005) return false;
    if (f.filtro === "vencidas" && (x.saldo <= 0.005 || x.dias >= 0)) return false;
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
