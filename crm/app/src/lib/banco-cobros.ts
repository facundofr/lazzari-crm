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
