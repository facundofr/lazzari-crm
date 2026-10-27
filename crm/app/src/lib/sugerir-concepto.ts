/**
 * Concepto de Ganancias (RG 830) sugerido para los proveedores que no lo tienen, por lo que les compramos (mejora H de
 * la auditoría de Impuestos, 27/10/2026). Solo sugiere: lo confirma una persona en Finanzas Lazza → Retenciones →
 * «Sin concepto», que guarda el concepto y la alícuota como la ficha del proveedor.
 * - Marcado como transportista → transporte.
 * - Si no, lo que dice la mayoría de los renglones de sus facturas de compra: fletes y viajes → transporte; honorarios;
 *   almacenaje, depósito fiscal y servicios → servicios; artículos → bienes (si empatan, bienes).
 * - Sin renglones con detalle (o sin facturas cargadas) → sin sugerencia: se elige a mano.
 * Las facturas de compra no tienen artículos del catálogo (producto_id vacío): se mira la descripción.
 */

export type ConceptoSugerido = "compraventa_bienes" | "servicios" | "transporte" | "honorarios";

export interface SugerenciaConcepto {
  concepto: ConceptoSugerido | null;
  motivo: string;
}

const SIN_DETALLE = /sin detalle de art[ií]culos/i;
const HONORARIOS = /\bhonorario/i;
const TRANSPORTE = /\bflete|\btransporte|\bviajes?\b|\bacarreo/i;
const SERVICIOS = /almacenaje|dep[oó]sito fiscal|habilitaci[oó]n|verificaci[oó]n|\bservicios?\b|mantenimiento|reparaci[oó]n|asesoramiento|consultor[ií]a|\babono\b|\blimpieza\b/i;
/** Si empatan, gana el primero. */
const ORDEN: ConceptoSugerido[] = ["compraventa_bienes", "servicios", "transporte", "honorarios"];

/** Qué es un renglón de factura de compra; null si no tiene detalle. */
export function claseRenglon(descripcion: string | null | undefined): ConceptoSugerido | null {
  const d = String(descripcion || "").trim();
  if (!d || SIN_DETALLE.test(d)) return null;
  if (HONORARIOS.test(d)) return "honorarios";
  if (TRANSPORTE.test(d)) return "transporte";
  if (SERVICIOS.test(d)) return "servicios";
  return "compraventa_bienes";
}

const corto = (s: string, n = 45) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** `renglones`: descripciones de los renglones de sus facturas de compra (y «Factura de transporte» por las de transporte). */
export function sugerirConcepto(p: { esTransportista?: boolean | null; renglones: string[] }): SugerenciaConcepto {
  if (p.esTransportista) return { concepto: "transporte", motivo: "Marcado como transportista" };
  const cuenta = new Map<ConceptoSugerido, { n: number; ejemplo: string }>();
  let total = 0;
  for (const r of p.renglones) {
    const clase = claseRenglon(r);
    if (!clase) continue;
    total++;
    const x = cuenta.get(clase) || { n: 0, ejemplo: String(r) };
    x.n++;
    cuenta.set(clase, x);
  }
  if (!total) return { concepto: null, motivo: p.renglones.length ? "Facturas sin detalle" : "Sin facturas cargadas" };
  const [concepto, x] = [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n || ORDEN.indexOf(a[0]) - ORDEN.indexOf(b[0]))[0];
  return { concepto, motivo: `${x.n} de ${total} ${total === 1 ? "renglón" : "renglones"}: «${corto(x.ejemplo)}»` };
}

/** Desde cuándo se miran los pagos para armar la lista: el 1° del mes anterior. */
export function desdeSinConcepto(hoy: string): string {
  const [y, m] = hoy.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}
