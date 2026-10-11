// Una sola regla de "qué es plata" para los movimientos de Finanzas.
// - ingreso: entra plata (cobros de clientes por cualquier medio).
// - egreso: sale plata (pagos a proveedores, cheques propios, retenciones que practicamos).
// - retencion_sufrida: retención que nos hizo un cliente. NO es plata que sale:
//   es crédito fiscal y se muestra aparte.
// - ajuste: ajuste manual de cuenta corriente. Mueve el saldo del cliente/proveedor, no la caja.
// - neutro: no toca la caja (anulados, aplicaciones de NC, tipos desconocidos).

export type ClaseMovimiento = "ingreso" | "egreso" | "retencion_sufrida" | "ajuste" | "neutro";

export interface MovimientoClasificable {
  tipo: string | null | undefined;
  cliente_id?: string | null;
  proveedor_id?: string | null;
  anulado?: boolean | null;
  descripcion?: string | null;
  nota_credito_compra_id?: string | null;
  ajuste_sentido?: string | null;
}

/** Medios con los que un cliente nos paga. */
export const TIPOS_COBRO = ["cobro", "transferencia", "efectivo", "tarjeta", "cheque_recibido", "echeq", "deposito"] as const;
/** Medios con los que pagamos a un proveedor. */
export const TIPOS_PAGO = ["pago", "cheque_emitido", "transferencia", "efectivo", "tarjeta", "echeq"] as const;
export const TIPOS_RETENCION = ["retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"] as const;

const esRetencion = (tipo: string) => tipo.startsWith("retencion_");

/** Los ajustes viejos se grababan como cobro/pago con este prefijo en la descripción. */
export function esAjusteManual(m: Pick<MovimientoClasificable, "tipo" | "descripcion">): boolean {
  return m.tipo === "ajuste" || /^\s*\[Ajuste manual\]/i.test(String(m.descripcion || ""));
}

/**
 * Sentido de un ajuste manual de cuenta corriente:
 * "credito" = a favor del cliente/proveedor; "debito" = cargo al cliente/proveedor.
 * Los nuevos lo guardan en ajuste_sentido; los viejos eran cobro (crédito) o pago (débito)
 * con "[Ajuste manual]" en la descripción. Cualquier otro movimiento: null.
 */
export function sentidoAjuste(m: { tipo?: string | null; descripcion?: string | null; ajuste_sentido?: string | null }): "credito" | "debito" | null {
  if (m.ajuste_sentido === "credito" || m.ajuste_sentido === "debito") return m.ajuste_sentido;
  if (!/^\s*\[Ajuste manual\]/i.test(String(m.descripcion || ""))) return null;
  if (m.tipo === "cobro") return "credito";
  if (m.tipo === "pago") return "debito";
  return null;
}

export function clasificarMovimiento(m: MovimientoClasificable): ClaseMovimiento {
  const tipo = String(m.tipo || "");
  if (m.anulado) return "neutro";
  if (esAjusteManual(m)) return "ajuste";
  // Aplicar una NC de compra no mueve plata.
  if (m.nota_credito_compra_id) return "neutro";
  const cliente = Boolean(m.cliente_id);
  const proveedor = Boolean(m.proveedor_id);

  if (esRetencion(tipo)) {
    if (cliente) return "retencion_sufrida";
    if (proveedor) return "egreso";
    return "neutro";
  }
  if (cliente && !proveedor) {
    return (TIPOS_COBRO as readonly string[]).includes(tipo) ? "ingreso" : tipo === "pago" || tipo === "cheque_emitido" ? "egreso" : "neutro";
  }
  if (proveedor && !cliente) {
    return (TIPOS_PAGO as readonly string[]).includes(tipo) ? "egreso" : tipo === "cobro" || tipo === "deposito" || tipo === "cheque_recibido" ? "ingreso" : "neutro";
  }
  // Sin cliente ni proveedor (o con los dos): se decide solo por el tipo, como antes.
  if (tipo === "cobro" || tipo === "cheque_recibido" || tipo === "deposito") return "ingreso";
  if (tipo === "pago" || tipo === "cheque_emitido") return "egreso";
  return "neutro";
}

/** ¿Es un cobro de cliente (para recibos, CC y filtros)? */
export function esCobroDeCliente(m: MovimientoClasificable): boolean {
  return Boolean(m.cliente_id) && clasificarMovimiento(m) === "ingreso";
}

export interface ResumenCaja { ingresos: number; egresos: number; retencionesSufridas: number; ajustes: number }

/** Suma un conjunto de movimientos (de una sola moneda) según su clase. Los ajustes NO entran a la caja. */
export function resumirCaja(movs: Array<MovimientoClasificable & { monto: number | string | null }>): ResumenCaja {
  const r: ResumenCaja = { ingresos: 0, egresos: 0, retencionesSufridas: 0, ajustes: 0 };
  for (const m of movs) {
    const monto = Number(m.monto || 0) || 0;
    switch (clasificarMovimiento(m)) {
      case "ingreso": r.ingresos += monto; break;
      case "egreso": r.egresos += monto; break;
      case "retencion_sufrida": r.retencionesSufridas += monto; break;
      case "ajuste": r.ajustes += monto; break;
      default: break;
    }
  }
  return r;
}
