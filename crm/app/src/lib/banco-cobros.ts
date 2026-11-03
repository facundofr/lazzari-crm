/**
 * Bancos → Movimientos: qué es una transferencia que entró (Augusto 03/11/2026: "que ahí mismo me diga si está el cobro aplicado
 * o no, y si no está aplicado, poder aplicarlo desde ahí en caso de que no lleve retenciones").
 * - `textoAplicado`: si el cobro ya cargado está aplicado a facturas ("aplicado a FA 0015-00000052") o no ("sin factura del CRM").
 * - `facturasConSaldoExacto`: facturas en pesos con saldo igual a la transferencia. El saldo es el de lib/saldo-clientes
 *   (`cobradoPorFactura` + `saldoFacturaVenta`, el mismo de Cobranzas y Finanzas › Facturas): acá no se hace otra cuenta.
 * - `eventosRetencion` + `modelosRetencion` + `facturaMenosRetenciones`: la transferencia es una factura menos las retenciones que ese
 *   cliente hizo en su último cobro (Cargill 03/11: IVA 10,5 % y IIBB 1,75 % del neto, Ganancias 2 % de lo que pasa de $ 224.000).
 * Todo es sugerencia: una persona aprieta «Cobrar» y revisa la ventana de cobro de siempre antes de guardar. Nada se guarda solo.
 * Prueba: npx tsx scripts/test-banco-cobros.ts
 */

export type TipoRetencion = "retencion_iva" | "retencion_ganancias" | "retencion_iibb" | "retencion_suss";
export const TIPOS_RETENCION: TipoRetencion[] = ["retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"];
export const NOMBRE_RETENCION: Record<TipoRetencion, string> = { retencion_iva: "IVA", retencion_ganancias: "Ganancias", retencion_iibb: "IIBB", retencion_suss: "SUSS" };

/** Factura de venta con su saldo (el de lib/saldo-clientes), lista para sugerir. */
export interface FacturaBanco {
  id: string; clienteId: string; cliente: string; cuit: string | null; tipo: string;
  /** "FA 0015-00000011" (`comprobanteVenta`). */
  numero: string;
  fecha: string; moneda: "ARS" | "USD"; subtotal: number; total: number; saldo: number;
}
export interface RetencionEstimada { tipo: TipoRetencion; monto: number }
/** Una factura que puede ser la transferencia: exacta (sin retenciones) o la factura menos las retenciones de siempre del cliente. */
export interface SugerenciaFactura { factura: FacturaBanco; retenciones: RetencionEstimada[]; transferencia: number }
/** monto = tasa × (base − mínimo), si la base pasa el mínimo. */
export interface ReglaRetencion { tipo: TipoRetencion; tasa: number; minimo: number }
/** Las retenciones de un cobro (mismo cliente y fecha) y la base de las facturas que pagó. */
export interface EventoRetenciones { clienteId: string; fecha: string; base: number; retenciones: { tipo: TipoRetencion; monto: number }[] }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const esTipoRetencion = (t: unknown): t is TipoRetencion => TIPOS_RETENCION.includes(t as TipoRetencion);

/** "aplicado a FA 0015-00000052" / "aplicado a FA … y FA …" / "sin factura del CRM" (cobros del sistema anterior, ventas sin factura). */
export function textoAplicado(numeros: string[]): string {
  const u = [...new Set(numeros.filter(Boolean))];
  if (!u.length) return "sin factura del CRM";
  return `aplicado a ${u.length > 2 ? `${u.slice(0, 2).join(", ")} y ${u.length - 2} más` : u.join(" y ")}`;
}

/**
 * Base sobre la que el cliente calcula las retenciones: el neto en las A (FA, FCEA) y el total en las B, C y X
 * (Fundación Cargill FB 0015-00000007: Ganancias 2 % s/ total − $ 224.000).
 */
export function baseRetencion(f: { tipo?: string | null; subtotal?: number | string | null; total?: number | string | null }): number {
  const sub = Number(f.subtotal) || 0;
  return /A$/i.test(String(f.tipo || "").trim()) && sub > 0 ? r2(sub) : r2(Number(f.total) || 0);
}

/** Facturas en pesos con saldo igual a lo que entró. Si la línea del banco trae CUIT, solo las de ese cliente. */
export function facturasConSaldoExacto(linea: { importe: number; cuit?: string | null }, facturas: FacturaBanco[]): FacturaBanco[] {
  if (!(linea.importe > 0)) return [];
  const cuit = digitos(linea.cuit);
  return facturas.filter((f) => f.moneda === "ARS" && f.saldo > 0.005 && Math.abs(f.saldo - linea.importe) < 0.005 && (!cuit || digitos(f.cuit) === cuit));
}

/**
 * Agrupa las retenciones sufridas por cliente y fecha (un cobro) con la base de las facturas a las que se aplicaron
 * (aplicaciones del cobro o factura_id). Se saltean las anuladas, las de facturas en dólares y las que no tienen factura.
 */
export function eventosRetencion(input: {
  retenciones: { id: string; tipo: string | null; fecha: string; monto: number | string | null; cliente_id: string | null; factura_id?: string | null; anulado?: boolean | null }[];
  aplicaciones: { movimiento_id?: string | null; factura_id?: string | null }[];
  facturas: Map<string, { tipo?: string | null; subtotal?: number | string | null; total?: number | string | null; moneda?: string | null }>;
}): EventoRetenciones[] {
  const facturasDeMov = new Map<string, Set<string>>();
  for (const a of input.aplicaciones) {
    if (!a.movimiento_id || !a.factura_id) continue;
    facturasDeMov.set(a.movimiento_id, (facturasDeMov.get(a.movimiento_id) || new Set()).add(a.factura_id));
  }
  const grupos = new Map<string, { clienteId: string; fecha: string; facturas: Set<string>; retenciones: { tipo: TipoRetencion; monto: number }[] }>();
  for (const m of input.retenciones) {
    if (m.anulado || !m.cliente_id || !esTipoRetencion(m.tipo) || !(Number(m.monto) > 0)) continue;
    const fecha = String(m.fecha).slice(0, 10);
    const clave = `${m.cliente_id}|${fecha}`;
    const g = grupos.get(clave) || { clienteId: m.cliente_id, fecha, facturas: new Set<string>(), retenciones: [] };
    for (const id of facturasDeMov.get(m.id) || []) g.facturas.add(id);
    if (m.factura_id) g.facturas.add(m.factura_id);
    g.retenciones.push({ tipo: m.tipo, monto: r2(Number(m.monto)) });
    grupos.set(clave, g);
  }
  const out: EventoRetenciones[] = [];
  for (const g of grupos.values()) {
    const fs = [...g.facturas].map((id) => input.facturas.get(id));
    if (!fs.length || fs.some((f) => !f || String(f.moneda || "ARS").toUpperCase() !== "ARS")) continue;
    const base = r2(fs.reduce((s, f) => s + baseRetencion(f!), 0));
    if (base > 0) out.push({ clienteId: g.clienteId, fecha: g.fecha, base, retenciones: g.retenciones });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Mínimo no sujeto a retención de Ganancias por bienes (el de retencion_config.minimo_ganancias, hoy $ 224.000). */
export const MINIMOS_GANANCIAS = [224000];

/**
 * Cómo calculó el cliente cada retención en ese cobro. Ganancias: si da 2 % de lo que pasa del mínimo de bienes ($ 224.000),
 * se guarda así; si no, como un porcentaje de la base. IVA, IIBB y SUSS: porcentaje de la base.
 */
export function reglasDeEvento(ev: EventoRetenciones, minimos: number[] = MINIMOS_GANANCIAS): ReglaRetencion[] {
  const por = new Map<TipoRetencion, number>();
  for (const r of ev.retenciones) por.set(r.tipo, r2((por.get(r.tipo) || 0) + r.monto));
  const reglas: ReglaRetencion[] = [];
  for (const [tipo, monto] of por) {
    if (tipo === "retencion_ganancias") {
      const minimo = minimos.find((mn) => mn < ev.base && Math.abs(0.02 * (ev.base - mn) - monto) <= 1);
      if (minimo !== undefined) { reglas.push({ tipo, tasa: 0.02, minimo }); continue; }
    }
    reglas.push({ tipo, tasa: monto / ev.base, minimo: 0 });
  }
  return reglas.sort((a, b) => TIPOS_RETENCION.indexOf(a.tipo) - TIPOS_RETENCION.indexOf(b.tipo));
}

/** Por cliente, las reglas de su último cobro con retenciones. */
export function modelosRetencion(eventos: EventoRetenciones[]): Map<string, ReglaRetencion[]> {
  const ultimo = new Map<string, EventoRetenciones>();
  for (const ev of eventos) {
    const prev = ultimo.get(ev.clienteId);
    if (!prev || ev.fecha >= prev.fecha) ultimo.set(ev.clienteId, ev);
  }
  return new Map([...ultimo].map(([id, ev]) => [id, reglasDeEvento(ev)]));
}

export function estimarRetenciones(reglas: ReglaRetencion[], base: number): RetencionEstimada[] {
  return reglas.map((r) => ({ tipo: r.tipo, monto: r2(r.tasa * Math.max(0, base - r.minimo)) })).filter((r) => r.monto > 0);
}

/**
 * Facturas sin ningún cobro (saldo = total) cuyo total menos las retenciones de siempre del cliente da lo que entró
 * (hasta $ 1 de diferencia por redondeo, como «Cargar certificado»). Si la línea trae CUIT, solo las de ese cliente.
 */
export function facturaMenosRetenciones(
  linea: { importe: number; cuit?: string | null },
  facturas: FacturaBanco[],
  modelos: Map<string, ReglaRetencion[]>,
  tolerancia = 1,
): SugerenciaFactura[] {
  if (!(linea.importe > 0)) return [];
  const cuit = digitos(linea.cuit);
  const out: SugerenciaFactura[] = [];
  for (const f of facturas) {
    if (f.moneda !== "ARS" || !(f.saldo > 0.005) || Math.abs(f.saldo - f.total) >= 0.005 || (cuit && digitos(f.cuit) !== cuit)) continue;
    const reglas = modelos.get(f.clienteId);
    if (!reglas?.length) continue;
    const retenciones = estimarRetenciones(reglas, baseRetencion(f));
    if (!retenciones.length) continue;
    const transferencia = r2(f.saldo - retenciones.reduce((s, r) => s + r.monto, 0));
    if (Math.abs(transferencia - linea.importe) > tolerancia) continue;
    // El redondeo (hasta $ 1) va a la retención más grande: transferencia + retenciones = saldo, y la factura no queda con centavos.
    // El certificado se cruza igual («Cargar certificado» acepta hasta $ 1 de diferencia).
    const ajuste = r2(transferencia - linea.importe);
    if (ajuste) {
      const mayor = retenciones.reduce((a, b) => (b.monto > a.monto ? b : a));
      mayor.monto = r2(mayor.monto + ajuste);
    }
    out.push({ factura: f, retenciones, transferencia: r2(linea.importe) });
  }
  return out;
}

/**
 * Lo que se sugiere para una transferencia que entró sin cobro cargado: primero las facturas con saldo exacto; si no hay,
 * la factura menos las retenciones de siempre (solo si hay una sola, para no adivinar). Hasta 3 facturas exactas.
 */
export function sugerirFacturas(linea: { importe: number; cuit?: string | null }, facturas: FacturaBanco[], modelos: Map<string, ReglaRetencion[]>): SugerenciaFactura[] {
  const exactas = facturasConSaldoExacto(linea, facturas);
  if (exactas.length) return exactas.slice(0, 3).map((f) => ({ factura: f, retenciones: [], transferencia: f.saldo }));
  const conRet = facturaMenosRetenciones(linea, facturas, modelos);
  return conRet.length === 1 ? conRet : [];
}

// ── Avisos de pago que leyó el agente de correo (Augusto 03/11/2026: "el correo… que lea los que no leyó") ──

const TIPO_AVISO: Record<string, TipoRetencion> = { iva: "retencion_iva", ganancias: "retencion_ganancias", iibb: "retencion_iibb", suss: "retencion_suss" };
export interface RetencionAviso { tipo: TipoRetencion; monto: number; certificado: string | null }
/** Un aviso de pago de un cliente leído por el agente (agente_mail_procesados.datos.pago, dirección "recibido"). */
export interface AvisoPago {
  id: string; fecha: string; remitente: string; referencia: string | null; clienteCuit: string | null; clienteNombre: string | null;
  /** Lo que puede haber entrado al banco: el neto, el total menos las retenciones o el total (el aviso no siempre los distingue). */
  transferencias: number[];
  retenciones: RetencionAviso[];
  /** Facturas del CRM que el agente cruzó al leer el aviso, y los números que nombra el aviso. */
  facturasIds: string[]; facturasNumeros: string[];
}
export interface SugerenciaAviso { aviso: AvisoPago; clienteId: string; cliente: string; facturas: FacturaBanco[]; retenciones: RetencionAviso[]; transferencia: number }

export function avisosDeMails(filas: { id: string; fecha_mail?: string | null; remitente?: string | null; datos?: any }[]): AvisoPago[] {
  const out: AvisoPago[] = [];
  for (const f of filas) {
    const p = f.datos?.pago;
    if (!p || p.direccion !== "recibido") continue;
    const retenciones: RetencionAviso[] = (Array.isArray(p.retenciones) ? p.retenciones : [])
      .filter((r: any) => TIPO_AVISO[String(r?.tipo || "").toLowerCase()] && Number(r.monto) > 0)
      .map((r: any) => ({ tipo: TIPO_AVISO[String(r.tipo).toLowerCase()], monto: r2(Number(r.monto)), certificado: r.certificado ? String(r.certificado).trim() || null : null }));
    const sumaRet = r2(retenciones.reduce((s, r) => s + r.monto, 0));
    const ret = Number(p.retenciones_total) > 0 ? r2(Number(p.retenciones_total)) : sumaRet;
    const neto = Number(p.monto_neto) || 0, total = Number(p.monto_total) || 0;
    const transferencias = [...new Set([neto, total > 0 && ret > 0 ? r2(total - ret) : 0, total].filter((x) => x > 0).map(r2))];
    if (!transferencias.length) continue;
    out.push({
      id: f.id, fecha: String(p.fecha_pago || f.fecha_mail || "").slice(0, 10), remitente: String(f.remitente || ""),
      referencia: p.referencia ? String(p.referencia) : null, clienteCuit: digitos(p.cliente_cuit) || null, clienteNombre: p.cliente_nombre ? String(p.cliente_nombre) : null,
      transferencias, retenciones,
      facturasIds: (Array.isArray(f.datos?.cruce?.facturas) ? f.datos.cruce.facturas : []).map((x: any) => x?.id).filter(Boolean),
      facturasNumeros: (Array.isArray(p.facturas) ? p.facturas : []).map((x: any) => String(x?.numero || "")).filter(Boolean),
    });
  }
  return out;
}

/** "00016-00000018" o "FA 0016-00000018" → "16-18" (punto de venta y número, sin ceros). */
const pvNumero = (s: string) => { const m = String(s).match(/(\d+)\D+(\d+)\s*$/); return m ? `${Number(m[1])}-${Number(m[2])}` : null; };
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/**
 * Avisos de pago que explican una transferencia que entró: mismo importe (hasta $ 1), hasta 15 días de diferencia, el cliente por su
 * CUIT (si la línea trae CUIT, tiene que ser el mismo). Las facturas: las que cruzó el agente y siguen con saldo, o las que nombra el
 * aviso, o una sola con saldo igual a lo que entró más las retenciones. Las retenciones son las del aviso, con su N° de certificado.
 */
export function sugerirDesdeAvisos(
  linea: { importe: number; fecha: string; cuit?: string | null },
  avisos: AvisoPago[], facturas: FacturaBanco[], clientes: { id: string; razon_social: string; cuit: string | null }[],
): SugerenciaAviso[] {
  if (!(linea.importe > 0)) return [];
  const cuitLinea = digitos(linea.cuit);
  const out: SugerenciaAviso[] = [];
  const vistos = new Set<string>();
  for (const a of avisos) {
    if (!a.transferencias.some((t) => Math.abs(t - linea.importe) <= 1)) continue;
    if (a.fecha && Math.abs(diasEntre(a.fecha, linea.fecha)) > 15) continue;
    if (!a.clienteCuit || (cuitLinea && cuitLinea !== a.clienteCuit)) continue;
    const cs = clientes.filter((c) => digitos(c.cuit) === a.clienteCuit);
    if (cs.length !== 1) continue;
    const c = cs[0];
    const delCliente = facturas.filter((f) => f.clienteId === c.id && f.moneda === "ARS" && f.saldo > 0.005);
    const retTotal = r2(a.retenciones.reduce((s, r) => s + r.monto, 0));
    let fs = delCliente.filter((f) => a.facturasIds.includes(f.id));
    if (!fs.length) { const nums = new Set(a.facturasNumeros.map(pvNumero).filter(Boolean)); fs = delCliente.filter((f) => nums.has(pvNumero(f.numero))); }
    if (!fs.length) { const exactas = delCliente.filter((f) => Math.abs(f.saldo - (linea.importe + retTotal)) <= 1); if (exactas.length === 1) fs = exactas; }
    const retenciones = a.retenciones.map((r) => ({ ...r }));
    // Redondeo de hasta $ 1 entre las facturas y lo que entró + retenciones: a la retención más grande.
    const ajuste = fs.length && retenciones.length ? r2(fs.reduce((s, f) => s + f.saldo, 0) - linea.importe - retTotal) : 0;
    if (ajuste && Math.abs(ajuste) <= 1) { const mayor = retenciones.reduce((x, y) => (y.monto > x.monto ? y : x)); mayor.monto = r2(mayor.monto + ajuste); }
    // El mismo aviso reenviado ("RV: …") llega como otro mail: si propone lo mismo, se muestra una sola vez.
    const clave = `${c.id}|${fs.map((f) => f.id).sort().join(",")}|${retenciones.map((r) => `${r.tipo}:${r.monto}`).sort().join(",")}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ aviso: a, clienteId: c.id, cliente: c.razon_social, facturas: fs, retenciones, transferencia: r2(linea.importe) });
  }
  return out.slice(0, 2);
}
