/**
 * "Cargar factura" simple (Augusto 16/10): la factura se cruza SOLO contra las OC que el usuario tildó.
 * Cada renglón queda en uno de estos casos (nada frena: lo que no se responde toma la opción por defecto):
 *  - ok: está en la OC, mismo precio.
 *  - precio mayor: [Actualizar costo] (por defecto) o [Reclamar al proveedor]. Precio menor: se actualiza solo.
 *  - de más: vienen más de lo pendiente → [Sumarlas a la OC] (por defecto) o [Va aparte].
 *  - no está: [Va a la OC sugerida] [Agregarlo a la OC] [Va aparte] (por defecto: aparte).
 *  - envío / flete / logística: SIEMPRE se suma a la OC; con varias OC se reparte por plata (editable).
 *  - dudoso: la IA lo asoció a un artículo parecido → [Sí, es ese] (por defecto) [No es].
 * Por OC que queda con pendientes: "vienen 18 de 20" → [Llegan después] (por defecto) [Cerrar la OC en 18].
 * Prueba: scripts/test-cargar-factura.ts
 */
import { esEnvio, parseVariant, samePrice, type InvoiceLineInput, type MatchResult } from "@/lib/purchase-matching";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OcInfo { ocId: string; ocNumero: string; moneda: string; descripcion: string }
export interface AsigVista { ocLineId: string; ocId: string; ocNumero: string; cantidad: number; precioFactura: number; precioOc: number; origen: string; descripcionOc: string }
export type TipoRenglon = "ok" | "envio" | "no_esta" | "dudoso";
export type ComparaPrecio = "igual" | "mayor" | "menor" | "otra_moneda";
export interface RenglonVista {
  key: string; descripcion: string; cantidad: number; precio: number;
  tipo: TipoRenglon;
  asignaciones: AsigVista[];
  compara: ComparaPrecio;
  precioOc: number;          // precio de la OC del primer renglón asignado
  pct: number;               // diferencia % factura vs OC
  deMas: number;             // unidades que vienen de más sobre lo pendiente
  deMasOcLineId: string | null;
  sinOc: number;             // unidades que no entraron en ninguna OC (no_esta, envío, o resto)
  motivoIA: string;
}

/** Arma la vista de cada renglón de la factura a partir del cruce. */
export function armarRenglones(args: {
  lineas: InvoiceLineInput[]; resultado: MatchResult; ocLinea: Map<string, OcInfo>; monedaFactura: string;
  confianza?: Record<string, string>; motivo?: Record<string, string>; rechazadas?: Set<string>;
}): RenglonVista[] {
  const { lineas, resultado, ocLinea, monedaFactura, confianza = {}, motivo = {}, rechazadas } = args;
  return lineas.map(l => {
    const as: AsigVista[] = resultado.asignaciones.filter(a => a.invoiceKey === l.key).map(a => ({
      ocLineId: a.ocLineId, ocId: a.ocId, ocNumero: a.ocNumero, cantidad: a.cantidad, precioFactura: a.precioFactura, precioOc: a.precioOc,
      origen: a.origen, descripcionOc: ocLinea.get(a.ocLineId)?.descripcion || "",
    }));
    const sa = resultado.sinAsignar.filter(s => s.invoiceKey === l.key);
    const deMasRow = sa.find(s => s.tipo === "de_mas");
    const sinOc = round2(sa.filter(s => s.tipo === "sin_oc").reduce((t, s) => t + s.cantidad, 0));
    const prod = parseVariant(l.descripcion).producto;
    const conf = confianza[prod];
    let tipo: TipoRenglon = "ok";
    if (esEnvio(l.descripcion) && !as.length) tipo = "envio";
    else if (!as.length || rechazadas?.has(l.key)) tipo = "no_esta";
    else if (as.some(a => a.origen === "parecido" || (a.origen === "equivalencia" && !!conf && conf !== "alta"))) tipo = "dudoso";
    const otraMoneda = as.some(a => (ocLinea.get(a.ocLineId)?.moneda || monedaFactura) !== monedaFactura);
    const p0 = as[0];
    let compara: ComparaPrecio = "igual";
    if (otraMoneda) compara = "otra_moneda";
    else if (p0 && !samePrice(l.precio, p0.precioOc)) compara = l.precio > p0.precioOc ? "mayor" : "menor";
    return {
      key: l.key, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, tipo,
      asignaciones: tipo === "no_esta" ? [] : as, compara: tipo === "no_esta" || tipo === "envio" ? "igual" : compara,
      precioOc: p0?.precioOc || 0, pct: p0 && p0.precioOc > 0 ? round2(((l.precio - p0.precioOc) / p0.precioOc) * 100) : 0,
      deMas: round2(deMasRow?.cantidad || 0), deMasOcLineId: deMasRow?.ocLineId || null,
      sinOc: tipo === "no_esta" ? l.cantidad : sinOc, motivoIA: motivo[prod] || "",
    };
  });
}

/** Reparte el envío entre las OC en proporción a la plata de cada una en la factura. El último absorbe el redondeo. */
export function repartirEnvio(monto: number, porOc: Array<{ ocId: string; ocNumero: string; importe: number }>): Array<{ ocId: string; ocNumero: string; monto: number }> {
  if (!porOc.length || !(monto > 0)) return [];
  const total = porOc.reduce((t, o) => t + Math.max(0, o.importe), 0);
  const out = porOc.map(o => ({ ocId: o.ocId, ocNumero: o.ocNumero, monto: round2(total > 0 ? monto * Math.max(0, o.importe) / total : monto / porOc.length) }));
  const resto = round2(monto - out.reduce((t, o) => t + o.monto, 0));
  out[out.length - 1].monto = round2(out[out.length - 1].monto + resto);
  return out;
}

/** Plata de la factura que va a cada OC (para repartir el envío). */
export function importePorOc(renglones: RenglonVista[]): Array<{ ocId: string; ocNumero: string; importe: number }> {
  const m = new Map<string, { ocId: string; ocNumero: string; importe: number }>();
  for (const r of renglones) for (const a of r.asignaciones) {
    const x = m.get(a.ocId) || { ocId: a.ocId, ocNumero: a.ocNumero, importe: 0 };
    x.importe = round2(x.importe + a.cantidad * r.precio);
    m.set(a.ocId, x);
  }
  return [...m.values()].sort((a, b) => b.importe - a.importe);
}

/** OC tildadas que la factura toca y dejan con pendientes: "vienen 18 de 20". */
export function faltantesPorOc(resultado: MatchResult, elegidas: Set<string>): Array<{ ocId: string; ocNumero: string; vienen: number; total: number; faltan: number }> {
  const out: Array<{ ocId: string; ocNumero: string; vienen: number; total: number; faltan: number }> = [];
  for (const ocId of resultado.ocsParciales) {
    if (!elegidas.has(ocId)) continue;
    const vienen = round2(resultado.asignaciones.filter(a => a.ocId === ocId).reduce((t, a) => t + a.cantidad, 0));
    const faltan = round2(resultado.pendientesOc.filter(p => p.ocId === ocId).reduce((t, p) => t + p.cantidad, 0));
    if (!(vienen > 0) || !(faltan > 0)) continue;
    const ocNumero = resultado.asignaciones.find(a => a.ocId === ocId)?.ocNumero || "";
    out.push({ ocId, ocNumero, vienen, total: round2(vienen + faltan), faltan });
  }
  return out;
}

/** "18 × Botín Prusiano" con la cantidad prolija. */
export const cant = (x: number) => (Number.isInteger(x) ? String(x) : String(round2(x)).replace(".", ","));
