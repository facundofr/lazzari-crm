// Finanzas > Hoy > Revisar (12/10/2026).
// A) Lo que se deja para revisar (tabla finanzas_revisar): motivos, a qué pestaña lleva "Abrir", orden.
// B) Lo que encuentra el sistema solo (sin guardar nada): fechas futuras, cheques vencidos en cartera, extracto sin cruzar.
// Solo avisa: nunca frena ninguna operación (regla 1).

export type RevisarEntidad =
  | "cheque" | "movimiento" | "factura_venta" | "factura_compra" | "orden_pago" | "extracto" | "cliente" | "proveedor" | "otro";

export const MOTIVOS_REVISAR: { id: string; label: string }[] = [
  { id: "diferencia_cobro", label: "Diferencia en un cobro" },
  { id: "retenciones", label: "Retenciones a confirmar" },
  { id: "fecha_recepcion", label: "Falta la fecha de recepción" },
  { id: "fecha_futura", label: "Fecha futura" },
  { id: "posible_duplicado", label: "¿Está duplicado?" },
  { id: "falta_cargar", label: "Falta cargar algo" },
  { id: "otro", label: "Otro" },
];

export function motivoLabel(id: string | null | undefined): string {
  return MOTIVOS_REVISAR.find((m) => m.id === id)?.label || (id ? id : "Otro");
}

export const ENTIDAD_LABEL: Record<RevisarEntidad, string> = {
  cheque: "Cheque", movimiento: "Cobro / pago", factura_venta: "Factura de venta", factura_compra: "Factura de compra",
  orden_pago: "Orden de pago", extracto: "Línea del extracto", cliente: "Cliente", proveedor: "Proveedor", otro: "Nota",
};

/** A qué lugar lleva "Abrir". `tab` = pestaña de Finanzas; `href` = otra pantalla o link con id. */
export function destinoEntidad(tipo: RevisarEntidad, id: string | null): { tab?: string; href?: string } | null {
  switch (tipo) {
    case "cheque": return { tab: "echeqs" };
    case "movimiento": return { tab: "movimientos" };
    case "factura_venta": return id ? { href: `/facturacion?factura=${id}` } : { tab: "facturacion" };
    case "factura_compra": return { tab: "facturas_compra" };
    case "orden_pago": return { tab: "ordenes_pago" };
    case "extracto": return { tab: "extractos" };
    case "cliente": return { href: "/clientes" };
    case "proveedor": return { href: "/proveedores" };
    default: return null;
  }
}

export interface ItemRevisar {
  id: string;
  estado: "pendiente" | "resuelto";
  recordar_el: string | null;
  created_at: string;
}

/** Pendientes primero; entre pendientes, los que ya tocan recordar (fecha ≤ hoy) arriba; después lo más nuevo. */
export function ordenarRevisar<T extends ItemRevisar>(items: T[], hoy: string): T[] {
  const peso = (i: T) => (i.estado !== "pendiente" ? 2 : i.recordar_el && i.recordar_el <= hoy ? 0 : 1);
  return [...items].sort((a, b) => peso(a) - peso(b)
    || (a.estado === "pendiente" && a.recordar_el && b.recordar_el ? a.recordar_el.localeCompare(b.recordar_el) : 0)
    || b.created_at.localeCompare(a.created_at));
}

/** ¿Está "dormido"? (pendiente, con fecha de recordar más adelante). */
export function estaPospuesto(i: ItemRevisar, hoy: string): boolean {
  return i.estado === "pendiente" && !!i.recordar_el && i.recordar_el > hoy;
}

// ── B) Lo que encuentra el sistema ─────────────────────────────────────────

export interface MovFuturo { id: string; fecha: string; monto: number; moneda?: string | null; tipo: string; descripcion?: string | null; anulado?: boolean | null }
export interface ChequeCartera { id: string; numero: string | null; monto: number; fecha_pago: string | null; estado: string; direccion: string; origen_nombre?: string | null }

export interface Hallazgo {
  clave: string;
  tipo: "fecha_futura" | "cheque_vencido" | "extracto_pendiente";
  titulo: string;
  detalle: string;
  importe: number | null;
  moneda: "ARS" | "USD";
  entidad: RevisarEntidad;
  entidad_id: string | null;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const TIPO_MOV: Record<string, string> = {
  cobro: "Cobro", pago: "Pago", cheque_recibido: "Cobro con cheque", retencion_ganancias: "Retención de Ganancias",
  retencion_iva: "Retención de IVA", retencion_iibb: "Retención de IIBB", retencion_suss: "Retención SUSS", ajuste: "Ajuste",
};

/**
 * Hallazgos automáticos.
 * - Movimientos (no anulados) con fecha posterior a hoy: casi siempre un cobro con la fecha del cheque en vez de la de recepción.
 * - Cheques recibidos en cartera con fecha de pago vencida hace más de `diasCheque` días: ¿se depositó?
 * - Líneas del extracto sin cruzar: un solo hallazgo con la cantidad.
 */
export function hallazgosAutomaticos(opts: {
  hoy: string;
  movimientos: MovFuturo[];
  cheques: ChequeCartera[];
  extractoPendientes: number;
  diasCheque?: number;
}): Hallazgo[] {
  const { hoy, diasCheque = 3 } = opts;
  const out: Hallazgo[] = [];
  for (const m of opts.movimientos) {
    if (m.anulado || !m.fecha || m.fecha <= hoy) continue;
    const [y, mm, d] = m.fecha.slice(0, 10).split("-");
    out.push({
      clave: `fut-${m.id}`, tipo: "fecha_futura",
      titulo: `${TIPO_MOV[m.tipo] || m.tipo} con fecha ${d}/${mm}/${y}`,
      detalle: `${m.descripcion || ""}`.trim() || "Fecha posterior a hoy: ¿es la fecha del cheque en vez de la de recepción?",
      importe: Number(m.monto) || 0, moneda: m.moneda === "USD" ? "USD" : "ARS", entidad: "movimiento", entidad_id: m.id,
    });
  }
  const limite = sumarDias(hoy, -diasCheque);
  for (const c of opts.cheques) {
    if (c.direccion !== "recibido" || c.estado !== "en_cartera" || !c.fecha_pago || c.fecha_pago >= limite) continue;
    const [y, mm, d] = c.fecha_pago.slice(0, 10).split("-");
    out.push({
      clave: `chq-${c.id}`, tipo: "cheque_vencido",
      titulo: `Cheque ${c.numero || "s/n"}${c.origen_nombre ? ` de ${c.origen_nombre}` : ""} en cartera`,
      detalle: `Fecha de pago ${d}/${mm}/${y}: ¿se depositó o se endosó?`,
      importe: Number(c.monto) || 0, moneda: "ARS", entidad: "cheque", entidad_id: c.id,
    });
  }
  if (opts.extractoPendientes > 0) {
    out.push({
      clave: "extracto", tipo: "extracto_pendiente",
      titulo: `${opts.extractoPendientes} línea${opts.extractoPendientes === 1 ? "" : "s"} del extracto sin cruzar`,
      detalle: "Están en Hoy > Extractos (filtro \"pendiente\").",
      importe: null, moneda: "ARS", entidad: "extracto", entidad_id: null,
    });
  }
  return out;
}
