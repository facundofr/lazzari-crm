// Recibos numerados (Augusto 19/10, "recibos B"): 1 recibo = 1 cobro, con su N° por sociedad (desde el 1000).
// La base arma los recibos (migración 20261019210000: tablas recibos + recibo_movimientos y un trigger);
// acá se juntan para mostrar: medios y retenciones, facturas que cobró, totales, anulado y conciliado.

export interface ReciboRow { id: string; numero: number; fecha: string; cliente_id: string | null }
export interface ReciboMovRow { recibo_id: string; movimiento_id: string }
export interface MovReciboRow {
  id: string;
  tipo: string | null;
  monto: number | string | null;
  monto_original?: number | string | null;
  moneda?: string | null;
  descripcion?: string | null;
  anulado?: boolean | null;
  conciliado?: boolean | null;
  factura_id?: string | null;
}
export interface AplicacionCobroRow { movimiento_id: string; factura_id: string; monto?: number | string | null }

export interface RenglonRecibo { tipo: string; medio: string; detalle: string; moneda: "ARS" | "USD"; monto: number; retencion: boolean }
export interface Recibo {
  id: string;
  numero: number;
  fecha: string;
  clienteId: string | null;
  cliente: string;
  renglones: RenglonRecibo[];
  /** Comprobantes cobrados, sin repetir. */
  facturas: string[];
  /** Ids de las facturas cobradas (para Finanzas Lazza › Facturas: "Cobrada con"). */
  facturaIds: string[];
  total: { ARS: number; USD: number };
  /** Todos sus movimientos anulados. */
  anulado: boolean;
  /** Todos sus medios (sin las retenciones) conciliados con el banco. */
  conciliado: boolean;
}

export const MEDIO_RECIBO: Record<string, string> = {
  cobro: "Cobro", transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", link_pago: "Link de pago", cheque_recibido: "Cheque",
  echeq: "E-Cheq", deposito: "Depósito", retencion_iva: "Ret. IVA", retencion_ganancias: "Ret. Ganancias",
  retencion_iibb: "Ret. IIBB", retencion_suss: "Ret. SUSS",
};

const n = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");

export function armarRecibos(args: {
  recibos: ReciboRow[];
  vinculos: ReciboMovRow[];
  movimientos: MovReciboRow[];
  aplicaciones?: AplicacionCobroRow[];
  /** factura_id → "FA 0015-00000123" */
  comprobantes?: Record<string, string>;
  /** cliente_id → razón social */
  clientes?: Record<string, string>;
}): Recibo[] {
  const movPorId = new Map(args.movimientos.map((m) => [m.id, m]));
  const movsDe: Record<string, MovReciboRow[]> = {};
  for (const v of args.vinculos) {
    const m = movPorId.get(v.movimiento_id);
    if (m) (movsDe[v.recibo_id] ||= []).push(m);
  }
  const factDeMov: Record<string, string[]> = {};
  for (const a of args.aplicaciones || []) (factDeMov[a.movimiento_id] ||= []).push(a.factura_id);

  return args.recibos.map((r) => {
    const movs = movsDe[r.id] || [];
    const vivos = movs.filter((m) => !m.anulado);
    const anulado = movs.length > 0 && vivos.length === 0;
    const medios = vivos.filter((m) => !String(m.tipo || "").startsWith("retencion_"));
    // Anulado: se muestra con lo que tenía (monto original), para poder verlo igual.
    const usar = anulado ? movs : vivos;
    const renglones: RenglonRecibo[] = usar
      .map((m) => {
        const tipo = String(m.tipo || "");
        const monto = r2(anulado ? n(m.monto_original ?? m.monto) : n(m.monto));
        return { tipo, medio: MEDIO_RECIBO[tipo] || tipo, detalle: String(m.descripcion || ""), moneda: mon(m.moneda), monto, retencion: tipo.startsWith("retencion_") };
      })
      .filter((x) => x.monto > 0.005)
      // Primero los medios (de mayor a menor), después las retenciones.
      .sort((a, b) => Number(a.retencion) - Number(b.retencion) || b.monto - a.monto);
    const total = { ARS: 0, USD: 0 };
    for (const x of renglones) total[x.moneda] = r2(total[x.moneda] + x.monto);
    const ids = new Set<string>();
    for (const m of usar) {
      if (m.factura_id) ids.add(m.factura_id);
      for (const f of factDeMov[m.id] || []) ids.add(f);
    }
    const facturas = [...ids].map((id) => args.comprobantes?.[id] || "").filter(Boolean).sort();
    return {
      id: r.id, numero: r.numero, fecha: String(r.fecha).slice(0, 10), clienteId: r.cliente_id,
      cliente: (r.cliente_id && args.clientes?.[r.cliente_id]) || "Cliente sin nombre",
      renglones, facturas, facturaIds: [...ids], total, anulado,
      // Las retenciones no pasan por el banco: cuenta solo lo que entró (transferencias, cheques, efectivo).
      conciliado: medios.length > 0 && medios.every((m) => !!m.conciliado),
    };
  }).sort((a, b) => b.numero - a.numero);
}

/** "$ 1.000 + US$ 50" a partir de los totales (para buscar y mostrar). */
export function textoTotalRecibo(t: { ARS: number; USD: number }, fmt: (v: number, m: "ARS" | "USD") => string): string {
  return [t.ARS > 0.005 ? fmt(t.ARS, "ARS") : "", t.USD > 0.005 ? fmt(t.USD, "USD") : ""].filter(Boolean).join(" + ") || fmt(0, "ARS");
}
