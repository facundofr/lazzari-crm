/**
 * Resumen de cuenta corriente (Finanzas Lazza, Augusto 19/10/2026): TODOS los movimientos con un cliente o
 * proveedor, de la más vieja a la más nueva, con Debe / Haber y saldo acumulado.
 *
 * Suma con las MISMAS reglas que el saldo de la ficha (lib/saldo-clientes y lib/saldo-proveedores), así el
 * último saldo da igual al de arriba. Lo que esas reglas no cuentan se muestra igual, en gris y sin sumar:
 * anulados, cobros sin factura del CRM (sistema anterior), lo pagado de más sobre una factura, la factura de compra
 * "pagada" sin pago cargado, etc. Una factura anulada CON nota de crédito sí suma (Debe) y la NC entera va al Haber.
 *
 * Clientes: Debe = facturas (y ajustes débito); Haber = NC, cobros y retenciones aplicados (y ajustes crédito).
 * Proveedores: Debe = facturas (y ajustes a favor del proveedor); Haber = NC, OP (bruto) y pagos directos.
 * Saldo positivo = nos debe (cliente) / le debemos (proveedor). ARS y US$ siempre por separado.
 *
 * Prueba: npx tsx scripts/test-resumen-cuenta.ts
 */

export type MonedaRC = "ARS" | "USD";

export interface RenglonResumen {
  id: string;
  fecha: string;
  /** factura | nc | cobro | retencion | ajuste | op | pago | otro */
  clase: string;
  detalle: string;
  /** Texto completo del movimiento cuando el detalle se acortó (se ve al pasar el mouse y en el Excel). */
  completo?: string;
  nota?: string;
  moneda: MonedaRC;
  /** Importe del comprobante o movimiento (aunque no sume). */
  importe: number;
  debe: number;
  haber: number;
  /** false = se muestra en gris y no cambia el saldo. */
  suma: boolean;
  anulado: boolean;
  /** Saldo acumulado de su moneda después de este renglón. */
  saldo: number;
}

export interface ResumenCuenta {
  renglones: RenglonResumen[];
  saldo: Record<MonedaRC, number>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => Number(v || 0) || 0;
const mon = (m: string | null | undefined): MonedaRC => (m === "USD" ? "USD" : "ARS");
const dia = (f: string | null | undefined) => String(f || "").slice(0, 10);
const esNCTipo = (t: string | null | undefined) => String(t || "").toUpperCase().startsWith("NC");
const pesos = (v: number, m: MonedaRC) => `${m === "USD" ? "US$" : "$"} ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ORDEN: Record<string, number> = { factura: 0, ajuste: 1, nc: 2, op: 3, pago: 3, cobro: 3, retencion: 4, rechazo: 5, otro: 6 };

type Base = Omit<RenglonResumen, "saldo"> & { creado?: string };

function cerrar(base: Base[]): ResumenCuenta {
  const orden = [...base].sort((a, b) => a.fecha.localeCompare(b.fecha) || (ORDEN[a.clase] ?? 9) - (ORDEN[b.clase] ?? 9)
    || String(a.creado || "").localeCompare(String(b.creado || "")) || a.detalle.localeCompare(b.detalle));
  const saldo: Record<MonedaRC, number> = { ARS: 0, USD: 0 };
  const renglones = orden.map(({ creado: _c, ...r }) => {
    if (r.suma) saldo[r.moneda] = r2(saldo[r.moneda] + r.debe - r.haber);
    return { ...r, debe: r2(r.debe), haber: r2(r.haber), importe: r2(r.importe), saldo: saldo[r.moneda] };
  });
  return { renglones, saldo };
}

// ── Clientes ────────────────────────────────────────────────────

export interface FacturaVentaRC {
  id: string;
  tipo: string | null;
  punto_venta?: number | string | null;
  numero?: number | string | null;
  fecha: string | null;
  total: number | string | null;
  total_acreditado?: number | string | null;
  saldo_a_favor_cliente?: number | string | null;
  factura_origen_id?: string | null;
  moneda: string | null;
  estado: string | null;
}

export interface MovimientoRC {
  id: string;
  tipo: string | null;
  monto: number | string | null;
  monto_original?: number | string | null;
  moneda?: string | null;
  fecha: string | null;
  descripcion?: string | null;
  anulado?: boolean | null;
  anulado_at?: string | null;
  created_at?: string | null;
  factura_id?: string | null;
  ajuste_sentido?: string | null;
  // Proveedores
  factura_compra_id?: string | null;
  orden_pago_id?: string | null;
  nota_credito_compra_id?: string | null;
  retencion_ganancias_monto?: number | string | null;
}

export interface AplicacionRC { movimiento_id: string | null; factura_id: string | null; monto: number | string | null }
export interface NcAplicacionRC { nota_credito_id: string; factura_id: string | null }

export const comprobanteVentaRC = (f: Pick<FacturaVentaRC, "tipo" | "punto_venta" | "numero">) =>
  `${f.tipo || "FC"} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? 0).padStart(8, "0")}`;

const esRetencion = (t: string | null | undefined) => String(t || "").startsWith("retencion");
/** Marca que deja rechazar_cheque_recibido en la descripción del cobro que anula. */
const CHEQUE_RECHAZADO = /^\s*\[ANULADO · cheque rechazado\]\s*/i;
const textoMov = (m: MovimientoRC) => String(m.descripcion || m.tipo || "Movimiento").replace(/\s*\[[a-z]+-\d+\/\d+\]\s*$/i, "");

/** Recibo y cheque de un cobro (recibo_movimientos y echeqs), para el detalle corto. */
export interface InfoCobroRC { recibo?: number | null; cheque?: { numero?: string | null; banco?: string | null; estado?: string | null; fecha_deposito?: string | null; fecha_endoso?: string | null } | null }

const MEDIO_RC: Record<string, string> = {
  cobro: "Cobro", transferencia: "Transferencia", efectivo: "Efectivo", tarjeta: "Tarjeta", link_pago: "Link de pago", cheque_recibido: "Cheque",
  echeq: "Cheque", deposito: "Depósito", retencion_iva: "Ret. IVA", retencion_ganancias: "Ret. Ganancias", retencion_iibb: "Ret. IIBB", retencion_suss: "Ret. SUSS",
};
const BANCOS: [RegExp, string][] = [
  [/galicia/i, "Galicia"], [/naci[oó]n/i, "Nación"], [/provincia/i, "Provincia"], [/santander/i, "Santander"], [/bbva|franc[eé]s/i, "BBVA"],
  [/macro/i, "Macro"], [/credicoop/i, "Credicoop"], [/icbc/i, "ICBC"], [/patagonia/i, "Patagonia"], [/supervielle/i, "Supervielle"],
  [/ciudad/i, "Ciudad"], [/hipotecario/i, "Hipotecario"], [/comafi/i, "Comafi"], [/ita[uú]/i, "Itaú"], [/hsbc/i, "HSBC"], [/mercado\s*pago/i, "Mercado Pago"],
];
const bancoCorto = (t: string | null | undefined) => BANCOS.find(([re]) => re.test(String(t || "")))?.[1] || "";
const ddmmaaaa = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * Detalle corto de un cobro (Augusto 20/10: "tiene que ser más simple"): `Recibo 1022 · Cheque Galicia N° 131 · depositado 17/10/2026`.
 * Del cheque va la fecha de DEPÓSITO, no el vencimiento (Augusto 20/10); en cartera "sin depositar", endosado con su fecha.
 * Con los datos del cheque si están; si no, número y banco del texto. Los ajustes quedan con su texto.
 */
export function detalleCortoCobro(mv: MovimientoRC, texto: string, info?: InfoCobroRC): string {
  const tipo = String(mv.tipo || "");
  if (tipo === "ajuste" || mv.ajuste_sentido) return texto;
  const partes: string[] = [];
  if (info?.recibo) partes.push(`Recibo ${info.recibo}`);
  const ch = info?.cheque;
  if (ch || tipo === "cheque_recibido" || tipo === "echeq") {
    const nro = String(ch?.numero || texto.match(/(?:N°|eCheq)\s*(\d+)/i)?.[1] || "").replace(/^0+(?=\d)/, "");
    const banco = bancoCorto(ch?.banco) || bancoCorto(texto);
    partes.push(["Cheque", banco, nro && `N° ${nro}`].filter(Boolean).join(" "));
    if (ch?.fecha_deposito) partes.push(`depositado ${ddmmaaaa(String(ch.fecha_deposito))}`);
    else if (ch?.estado === "endosado") partes.push(ch.fecha_endoso ? `endosado ${ddmmaaaa(String(ch.fecha_endoso))}` : "endosado");
    else if (ch?.estado === "en_cartera") partes.push("sin depositar");
  } else if (esRetencion(tipo)) {
    const cert = texto.match(/cert(?:ificado)?\.?:?\s*([\d-]{3,})/i)?.[1];
    partes.push(`${MEDIO_RC[tipo] || "Retención"}${cert ? ` cert. ${cert}` : ""}`);
  } else {
    partes.push(MEDIO_RC[tipo] || "Cobro");
  }
  return partes.join(" · ");
}

export function resumenCliente(
  facturas: FacturaVentaRC[],
  movimientos: MovimientoRC[],
  aplicaciones: AplicacionRC[],
  infoCobros: Map<string, InfoCobroRC> = new Map(),
  /** nota_credito_venta_aplicaciones: NC que cancela varias facturas (la NC solo guarda la primera en factura_origen_id). */
  ncAplicaciones: NcAplicacionRC[] = [],
): ResumenCuenta {
  const base: Base[] = [];
  const facPorId = new Map(facturas.map((f) => [f.id, f]));
  // Qué facturas toca cada NC (vigente) y con qué NC quedó cada factura.
  const facturasDeNC = new Map<string, string[]>();
  const agregar = (ncId: string, facId: string | null | undefined) => {
    if (!facId || !facPorId.has(facId)) return;
    const l = facturasDeNC.get(ncId) || [];
    if (!l.includes(facId)) facturasDeNC.set(ncId, [...l, facId]);
  };
  for (const f of facturas) if (esNCTipo(f.tipo) && f.estado !== "anulada") agregar(f.id, f.factura_origen_id);
  for (const a of ncAplicaciones) if (facPorId.get(a.nota_credito_id)?.estado !== "anulada") agregar(a.nota_credito_id, a.factura_id);
  const ncsDeFactura = new Map<string, string[]>();
  for (const [ncId, ids] of facturasDeNC) for (const id of ids) ncsDeFactura.set(id, [...(ncsDeFactura.get(id) || []), comprobanteVentaRC(facPorId.get(ncId)!)]);
  // Factura anulada CON nota de crédito (Augusto 20/10): suma en Debe y la NC entera en Haber, así se lee la cuenta.
  // Sin NC (anulada antes de emitirse, etc.) sigue en gris.
  const anuladaConNC = (f: FacturaVentaRC) => f.estado === "anulada" && !esNCTipo(f.tipo) && ncsDeFactura.has(f.id);
  // Lo que todavía puede cobrarse de cada factura (total − NC aplicadas): lo cobrado de más no suma.
  const resto = new Map<string, number>();
  for (const f of facturas) if (!esNCTipo(f.tipo) && (f.estado !== "anulada" || anuladaConNC(f))) resto.set(f.id, Math.max(0, n(f.total) - n(f.total_acreditado)));

  for (const f of facturas) {
    const comp = comprobanteVentaRC(f);
    const m = mon(f.moneda);
    const total = n(f.total);
    if (anuladaConNC(f)) {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "factura", detalle: comp, nota: `anulada con ${ncsDeFactura.get(f.id)!.join(", ")}`, moneda: m, importe: total, debe: total, haber: 0, suma: true, anulado: false });
      continue;
    }
    if (f.estado === "anulada") {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: esNCTipo(f.tipo) ? "nc" : "factura", detalle: comp, nota: "anulada", moneda: m, importe: total, debe: 0, haber: 0, suma: false, anulado: true });
      continue;
    }
    if (!esNCTipo(f.tipo)) {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "factura", detalle: comp, moneda: m, importe: total, debe: total, haber: 0, suma: true, anulado: false });
      continue;
    }
    // NC: la parte aplicada baja la factura (total_acreditado) y lo que no se pudo aplicar queda a favor.
    const objetivo = (facturasDeNC.get(f.id) || []).map((id) => facPorId.get(id)!);
    const aFavor = n(f.saldo_a_favor_cliente);
    if (!objetivo.length) {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "nc", detalle: comp, nota: "sin factura asociada: queda a favor", moneda: m, importe: total, debe: 0, haber: total, suma: true, anulado: false });
    } else {
      const lista = objetivo.sort((a, b) => dia(a.fecha).localeCompare(dia(b.fecha)) || n(a.numero) - n(b.numero)).map(comprobanteVentaRC).join(", ");
      const verbo = objetivo.some((o) => o.estado === "anulada") ? "anula" : "aplicada a";
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "nc", detalle: comp, nota: `${verbo} ${lista}${aFavor > 0.005 ? ` · a favor ${pesos(aFavor, m)}` : ""}`, moneda: m, importe: total, debe: 0, haber: total, suma: true, anulado: false });
    }
  }

  const apsPorMov = new Map<string, AplicacionRC[]>();
  for (const a of aplicaciones) if (a.movimiento_id && a.factura_id) apsPorMov.set(a.movimiento_id, [...(apsPorMov.get(a.movimiento_id) || []), a]);

  // Cobros en orden de fecha: así lo cobrado de más queda en el último que se pasó.
  const movs = [...movimientos].sort((a, b) => dia(a.fecha).localeCompare(dia(b.fecha)) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const mv of movs) {
    const fecha = dia(mv.fecha);
    const mm = mon(mv.moneda);
    const clase = mv.tipo === "ajuste" || mv.ajuste_sentido ? "ajuste" : esRetencion(mv.tipo) ? "retencion" : "cobro";
    const texto = textoMov(mv).replace(CHEQUE_RECHAZADO, "").trim();
    const info = infoCobros.get(mv.id);
    const detalle = detalleCortoCobro(mv, texto, info);
    const completo = detalle !== texto ? texto : undefined;
    const creado = mv.created_at || undefined;
    // Cheque rechazado (Augusto 20/10): dos renglones que se cancelan, el cobro en Haber y el rechazo en Debe
    // (fecha del rechazo). No tocan lo que queda por cobrar de la factura: la deuda vuelve entera.
    if (mv.anulado && CHEQUE_RECHAZADO.test(String(mv.descripcion || ""))) {
      const importe = n(mv.monto_original ?? mv.monto);
      const nro = String(info?.cheque?.numero || texto.match(/(?:N°|eCheq)\s*(\d+)/i)?.[1] || "").replace(/^0+(?=\d)/, "");
      base.push({ completo, id: mv.id, fecha, clase, detalle, moneda: mm, importe, debe: 0, haber: importe, suma: true, anulado: false, creado });
      base.push({ completo, id: `${mv.id}-rechazo`, fecha: dia(mv.anulado_at) || fecha, clase: "rechazo", detalle: `Cheque rechazado${nro ? ` N° ${nro}` : ""}`, nota: "vuelve a deber lo que había cobrado", moneda: mm, importe, debe: importe, haber: 0, suma: true, anulado: false, creado });
      continue;
    }
    if (mv.anulado) {
      base.push({ completo, id: mv.id, fecha, clase, detalle, nota: "anulado", moneda: mm, importe: n(mv.monto_original ?? mv.monto), debe: 0, haber: 0, suma: false, anulado: true, creado });
      continue;
    }
    if (clase === "ajuste" && !(apsPorMov.get(mv.id)?.length) && !mv.factura_id) {
      const s = mv.ajuste_sentido;
      if (s === "debito" || s === "credito") base.push({ completo, id: mv.id, fecha, clase, detalle, moneda: mm, importe: n(mv.monto), debe: s === "debito" ? n(mv.monto) : 0, haber: s === "credito" ? n(mv.monto) : 0, suma: true, anulado: false, creado });
      else base.push({ completo, id: mv.id, fecha, clase, detalle, nota: "ajuste sin sentido: no suma", moneda: mm, importe: n(mv.monto), debe: 0, haber: 0, suma: false, anulado: false, creado });
      continue;
    }
    // Lo aplicado a cada factura, en la moneda de la factura.
    const aps: { factura_id: string; monto: number }[] = apsPorMov.get(mv.id)?.length
      ? apsPorMov.get(mv.id)!.map((a) => ({ factura_id: a.factura_id!, monto: n(a.monto) }))
      : mv.factura_id ? [{ factura_id: mv.factura_id, monto: n(mv.monto) }] : [];
    if (!aps.length) {
      const anterior = /sistema anterior/i.test(String(mv.descripcion || ""));
      base.push({ completo, id: mv.id, fecha, clase, detalle, nota: anterior ? "sist. anterior: no suma" : "sin factura aplicada: no suma", moneda: mm, importe: n(mv.monto), debe: 0, haber: 0, suma: false, anulado: false, creado });
      continue;
    }
    const porMoneda: Record<MonedaRC, { suma: number; aplicado: number; facturas: string[] }> = { ARS: { suma: 0, aplicado: 0, facturas: [] }, USD: { suma: 0, aplicado: 0, facturas: [] } };
    const notas: string[] = [];
    for (const a of aps) {
      const f = facPorId.get(a.factura_id);
      const fm = f ? mon(f.moneda) : mm;
      // Movimiento directo en otra moneda que su factura: la regla del saldo no lo suma.
      if (!apsPorMov.get(mv.id)?.length && f && mm !== fm) { notas.push(`otra moneda que ${comprobanteVentaRC(f)}: no suma`); continue; }
      const pm = porMoneda[fm];
      pm.aplicado += a.monto;
      if (f) pm.facturas.push(comprobanteVentaRC(f));
      if (!f || !resto.has(f.id)) { notas.push(`${f ? comprobanteVentaRC(f) : "factura"} anulada: no suma`); continue; }
      const queda = resto.get(f.id)!;
      const cuenta = Math.min(a.monto, queda);
      resto.set(f.id, r2(queda - cuenta));
      pm.suma += cuenta;
      if (a.monto - cuenta > 0.005) notas.push(`${pesos(r2(a.monto - cuenta), fm)} de más sobre ${comprobanteVentaRC(f)}: no suma`);
    }
    const monedas = (["ARS", "USD"] as MonedaRC[]).filter((k) => porMoneda[k].aplicado > 0.005);
    if (!monedas.length) {
      base.push({ completo, id: mv.id, fecha, clase, detalle, nota: notas.join(" · ") || "no suma", moneda: mm, importe: n(mv.monto), debe: 0, haber: 0, suma: false, anulado: false, creado });
      continue;
    }
    for (const k of monedas) {
      const pm = porMoneda[k];
      const extra = [...notas];
      // Lo que no quedó aplicado a ninguna factura (misma moneda) no suma.
      const sinAplicar = k === mm ? r2(n(mv.monto) - pm.aplicado) : 0;
      if (sinAplicar > 0.005) extra.push(`${pesos(sinAplicar, mm)} sin aplicar: no suma`);
      if (pm.facturas.length) extra.unshift(`aplicado a ${[...new Set(pm.facturas)].join(", ")}`);
      base.push({ completo, id: `${mv.id}${monedas.length > 1 ? `-${k}` : ""}`, fecha, clase, detalle, nota: extra.join(" · ") || undefined, moneda: k, importe: k === mm ? n(mv.monto) : pm.aplicado, debe: 0, haber: pm.suma, suma: pm.suma > 0.005, anulado: false, creado });
    }
  }
  return cerrar(base);
}

// ── Proveedores ─────────────────────────────────────────────────

export interface FacturaCompraRC {
  id: string;
  numero_factura?: string | null;
  tipo_comprobante?: string | null;
  fecha: string | null;
  total: number | string | null;
  total_acreditado?: number | string | null;
  moneda?: string | null;
  estado?: string | null;
  op_facturas_compra?: Array<{ monto: number | string | null; ordenes_pago?: { estado?: string | null; numero?: string | number | null } | null }> | null;
}

export interface OrdenPagoRC {
  id: string;
  numero?: string | number | null;
  fecha: string | null;
  monto_bruto: number | string | null;
  moneda?: string | null;
  estado?: string | null;
  created_at?: string | null;
  op_facturas_compra?: Array<{ factura_compra_id?: string | null; monto?: number | string | null }> | null;
}

export const comprobanteCompraRC = (f: Pick<FacturaCompraRC, "tipo_comprobante" | "numero_factura">) =>
  `${f.tipo_comprobante || "FC"} ${f.numero_factura || ""}`.trim();

export function resumenProveedor(
  facturas: FacturaCompraRC[],
  ordenes: OrdenPagoRC[],
  movimientos: MovimientoRC[],
  /** Sentido de un ajuste manual (lib/tipos-movimiento: sentidoAjuste): "credito" = a favor del proveedor. */
  sentidoAjuste: (m: MovimientoRC) => "credito" | "debito" | null,
  /** saldos_favor_proveedor (orden_pago_id, monto_original): lo pagado de más en una OP que quedó a favor. */
  saldosFavor: Array<{ orden_pago_id?: string | null; monto_original?: number | string | null }> = [],
): ResumenCuenta {
  const base: Base[] = [];
  const facPorId = new Map(facturas.map((f) => [f.id, f]));
  const pagosDirectos = movimientos.filter((m) => !m.anulado && m.tipo === "pago" && m.factura_compra_id && !m.nota_credito_compra_id && !m.orden_pago_id);
  const ncAplicada = new Set(movimientos.filter((m) => !m.anulado && m.nota_credito_compra_id && m.factura_compra_id).map((m) => m.factura_compra_id!));
  const conPagoDirecto = new Set(pagosDirectos.map((m) => m.factura_compra_id!));
  // Lo que todavía puede pagarse de cada factura con pagos directos (lo pagado de más no suma).
  const resto = new Map<string, number>();

  for (const f of facturas) {
    const comp = comprobanteCompraRC(f);
    const m = mon(f.moneda);
    const total = n(f.total);
    const nc = esNCTipo(f.tipo_comprobante);
    if (f.estado === "anulada") {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: nc ? "nc" : "factura", detalle: comp, nota: "anulada", moneda: m, importe: total, debe: 0, haber: 0, suma: false, anulado: true });
      continue;
    }
    if (nc) {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "nc", detalle: comp, moneda: m, importe: total, debe: 0, haber: total, suma: true, anulado: false });
      continue;
    }
    const ops = (f.op_facturas_compra || []).filter((l) => l?.ordenes_pago && l.ordenes_pago.estado !== "anulada");
    const nros = [...new Set(ops.map((l) => String(l.ordenes_pago?.numero ?? "")).filter(Boolean))];
    // "Pagada" sin ningún pago cargado (compras viejas con tarjeta): la regla del saldo no la cuenta como deuda.
    if (f.estado === "pagada" && !ops.length && !conPagoDirecto.has(f.id) && !ncAplicada.has(f.id) && n(f.total_acreditado) <= 0.005) {
      base.push({ id: f.id, fecha: dia(f.fecha), clase: "factura", detalle: comp, nota: "pagada sin pago cargado: no suma", moneda: m, importe: total, debe: 0, haber: 0, suma: false, anulado: false });
      continue;
    }
    const pagadoOP = ops.reduce((s, l) => s + n(l.monto), 0);
    resto.set(f.id, Math.max(0, total - n(f.total_acreditado) - pagadoOP));
    base.push({ id: f.id, fecha: dia(f.fecha), clase: "factura", detalle: comp, nota: nros.length ? `${f.estado === "pagada" ? "pagada" : "pagos"} con ${nros.join(", ")}` : f.estado === "pagada" ? "pagada" : undefined, moneda: m, importe: total, debe: total, haber: 0, suma: true, anulado: false });
  }

  // Lo que salió de verdad en cada OP (pagos + retenciones): si pasó el bruto y quedó como saldo a favor, suma.
  const aFavorPorOP = new Map<string, number>();
  for (const sf of saldosFavor) if (sf.orden_pago_id) aFavorPorOP.set(sf.orden_pago_id, (aFavorPorOP.get(sf.orden_pago_id) || 0) + n(sf.monto_original));
  const pagadoPorOP = new Map<string, number>();
  for (const m of movimientos) if (m.orden_pago_id && !m.anulado && !m.nota_credito_compra_id) pagadoPorOP.set(m.orden_pago_id, (pagadoPorOP.get(m.orden_pago_id) || 0) + n(m.monto));
  for (const op of ordenes) {
    const m = mon(op.moneda);
    const bruto = n(op.monto_bruto);
    const detalle = String(op.numero || "Orden de pago");
    if (op.estado === "anulada") {
      base.push({ id: op.id, fecha: dia(op.fecha), clase: "op", detalle, nota: "anulada", moneda: m, importe: bruto, debe: 0, haber: 0, suma: false, anulado: true, creado: op.created_at || undefined });
      continue;
    }
    const links = (op.op_facturas_compra || []).map((l) => ({ f: l.factura_compra_id ? facPorId.get(l.factura_compra_id) : undefined, monto: n(l.monto) })).filter((l) => l.f);
    const facs = [...new Set(links.map((l) => comprobanteCompraRC(l.f!)))];
    const nota = facs.length ? `paga ${facs.join(", ")}` : "pago a cuenta / anticipo";
    // OP en pesos que paga facturas en dólares (o al revés): cuenta lo aplicado, en la moneda de las facturas.
    const otraMoneda = links.length > 0 && links.every((l) => mon(l.f!.moneda) !== m);
    if (otraMoneda) {
      const fm = mon(links[0].f!.moneda);
      const aplicado = links.reduce((s, l) => s + l.monto, 0);
      base.push({ id: op.id, fecha: dia(op.fecha), clase: "op", detalle, nota: `${nota} · pagada con ${pesos(bruto, m)}`, moneda: fm, importe: aplicado, debe: 0, haber: aplicado, suma: true, anulado: false, creado: op.created_at || undefined });
      continue;
    }
    const pagado = r2(pagadoPorOP.get(op.id) || 0);
    const excedente = pagado - bruto > 0.005 ? r2(Math.min(pagado - bruto, aFavorPorOP.get(op.id) || 0)) : 0;
    base.push({ id: op.id, fecha: dia(op.fecha), clase: "op", detalle, nota: excedente ? `${nota} · ${pesos(excedente, m)} de más, quedó a favor` : nota, moneda: m, importe: bruto + excedente, debe: 0, haber: bruto + excedente, suma: true, anulado: false, creado: op.created_at || undefined });
  }

  const movs = [...movimientos].sort((a, b) => dia(a.fecha).localeCompare(dia(b.fecha)) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const mv of movs) {
    // Los movimientos de una OP ya están en su renglón (bruto); la aplicación de una NC no mueve plata.
    if (mv.orden_pago_id || mv.nota_credito_compra_id) continue;
    const fecha = dia(mv.fecha);
    const mm = mon(mv.moneda);
    const detalle = textoMov(mv);
    const creado = mv.created_at || undefined;
    const sentido = sentidoAjuste(mv);
    const clase = sentido || mv.tipo === "ajuste" ? "ajuste" : esRetencion(mv.tipo) ? "retencion" : "pago";
    if (mv.anulado) {
      base.push({ id: mv.id, fecha, clase, detalle, nota: "anulado", moneda: mm, importe: n(mv.monto_original ?? mv.monto), debe: 0, haber: 0, suma: false, anulado: true, creado });
      continue;
    }
    if (sentido) {
      base.push({ id: mv.id, fecha, clase, detalle, moneda: mm, importe: n(mv.monto), debe: sentido === "credito" ? n(mv.monto) : 0, haber: sentido === "debito" ? n(mv.monto) : 0, suma: true, anulado: false, creado });
      continue;
    }
    if (mv.tipo === "pago" && mv.factura_compra_id) {
      const f = facPorId.get(mv.factura_compra_id);
      const bruto = n(mv.monto) + n(mv.retencion_ganancias_monto);
      const nota = [f ? `paga ${comprobanteCompraRC(f)}` : "", n(mv.retencion_ganancias_monto) > 0.005 ? `incluye retención ${pesos(n(mv.retencion_ganancias_monto), mm)}` : ""].filter(Boolean);
      // Sobre una factura anulada lo pagado queda a favor (suma entero).
      if (!f || f.estado === "anulada" || !resto.has(f.id)) {
        base.push({ id: mv.id, fecha, clase: "pago", detalle, nota: nota.join(" · ") || undefined, moneda: mm, importe: bruto, debe: 0, haber: bruto, suma: true, anulado: false, creado });
        continue;
      }
      const queda = resto.get(f.id)!;
      const cuenta = Math.min(bruto, queda);
      resto.set(f.id, r2(queda - cuenta));
      if (bruto - cuenta > 0.005) nota.push(`${pesos(r2(bruto - cuenta), mm)} de más: no suma`);
      base.push({ id: mv.id, fecha, clase: "pago", detalle, nota: nota.join(" · ") || undefined, moneda: mm, importe: bruto, debe: 0, haber: cuenta, suma: cuenta > 0.005, anulado: false, creado });
      continue;
    }
    const anterior = /sistema anterior/i.test(String(mv.descripcion || ""));
    base.push({ id: mv.id, fecha, clase, detalle, nota: anterior ? "sist. anterior: no suma" : "sin factura ni OP: no suma", moneda: mm, importe: n(mv.monto), debe: 0, haber: 0, suma: false, anulado: false, creado });
  }
  return cerrar(base);
}

/** Diferencia entre el saldo del resumen y el de la ficha (para avisar si no cierran; nunca frena). */
export function diferenciaResumen(resumen: ResumenCuenta, saldoFicha: Record<MonedaRC, number>): Record<MonedaRC, number> {
  return { ARS: r2(resumen.saldo.ARS - n(saldoFicha.ARS)), USD: r2(resumen.saldo.USD - n(saldoFicha.USD)) };
}
