/**
 * Análisis de una conciliación de compras (sin guardar nada): trae las líneas de OC pendientes
 * del proveedor, pide equivalencias a la IA (más las aprendidas) y clasifica cada línea de factura
 * en verde / amarillo / rojo. Lo usan la pantalla de conciliación y el cruce automático de la carga masiva.
 */
import {
  matchPurchaseLines, parseVariant,
  type Equivalencias, type InvoiceLineInput, type OcLineInput, type MatchResult, type MatchOptions, type Asignacion,
} from "@/lib/purchase-matching";

export type Confianza = "alta" | "media" | "baja";
export interface OcLinea extends OcLineInput { moneda: string; ocEstado: string; descripcionOc?: string }
export type Manual = Record<string, Array<{ ocLineId: string; cantidad: number }> | "__extra__">;
export interface AnalisisIA { equivalencias: Equivalencias; confianza: Record<string, Confianza>; motivo: Record<string, string>; iaInfo: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Líneas de OC del proveedor que todavía esperan factura (las OC con saldo cerrado no). */
export async function cargarLineasOc(db: any, sociedadId: string, proveedorId: string, manual: Manual = {}): Promise<{ lineas: OcLinea[]; legacy: Set<string> }> {
  const { data: ocs, error: e1 } = await db.from("ordenes_compra")
    .select("id, numero, fecha, estado, moneda, estado_facturacion, saldo_cerrado")
    .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId)
    .neq("estado", "cancelada").order("fecha");
  if (e1) throw e1;
  // No se filtra por estado_facturacion: una conciliación parcial retomada puede haber completado una OC.
  // Las OC con el saldo cerrado ya no esperan facturas.
  const abiertas = (ocs || []).filter((o: any) => !o.saldo_cerrado);
  const ids = abiertas.map((o: any) => o.id);
  if (!ids.length) return { lineas: [], legacy: new Set() };
  const [{ data: lineas, error: e2 }, { data: links }, { data: conAsig }] = await Promise.all([
    db.from("orden_compra_items_pendientes").select("id, orden_id, codigo, descripcion, cantidad_pendiente, precio_unitario, codigo_proveedor, descripcion_proveedor, talle").in("orden_id", ids),
    db.from("factura_compra_ocs").select("orden_compra_id").in("orden_compra_id", ids),
    db.from("factura_compra_asignaciones").select("orden_compra_id").in("orden_compra_id", ids),
  ]);
  if (e2) throw e2;
  // OC vinculadas con el sistema viejo (sin detalle por línea): se consideran ya facturadas.
  const nuevas = new Set((conAsig || []).map((a: any) => a.orden_compra_id));
  const legacy = new Set<string>((links || []).map((l: any) => l.orden_compra_id).filter((id: string) => !nuevas.has(id)));
  // Si se retoma una conciliación parcial, lo que ella misma asignó vuelve a estar disponible.
  const propias = new Map<string, number>();
  for (const arr of Object.values(manual)) if (arr !== "__extra__") for (const a of arr) propias.set(a.ocLineId, (propias.get(a.ocLineId) || 0) + a.cantidad);
  const byId = new Map(abiertas.map((o: any) => [o.id, o]));
  const out: OcLinea[] = (lineas || []).map((l: any) => {
    const o: any = byId.get(l.orden_id);
    return {
      id: l.id, ocId: l.orden_id, ocNumero: o?.numero || String(l.orden_id).slice(0, 8), ocFecha: o?.fecha || "",
      // Si la OC ya se ordenó contra la lista del proveedor, se compara con cómo lo llama el proveedor.
      codigo: l.codigo_proveedor || l.codigo,
      descripcion: l.descripcion_proveedor ? `${l.descripcion_proveedor}${l.talle ? ` TALLE ${l.talle}` : ""}` : l.descripcion,
      descripcionOc: l.descripcion,
      cantidad: round2(Number(l.cantidad_pendiente) + (propias.get(l.id) || 0)),
      precio: Number(l.precio_unitario) || 0, moneda: o?.moneda || "ARS", ocEstado: o?.estado || "",
    };
  }).filter((l: OcLinea) => l.cantidad > 0);
  return { lineas: out, legacy };
}

/** Equivalencias de producto: IA (con una segunda pasada sobre lo que sobró) + las aprendidas del proveedor. */
export async function sugerirEquivalencias(db: any, args: {
  sociedadId: string; proveedorId: string; proveedorNombre: string;
  lineasFactura: InvoiceLineInput[]; ocs: OcLinea[]; manual: Manual; opciones: MatchOptions;
}): Promise<AnalisisIA> {
  const { sociedadId, proveedorId, proveedorNombre, lineasFactura, ocs, manual, opciones } = args;
  const { data: aprendidas } = await db.from("proveedor_equivalencias").select("producto_factura, producto_oc")
    .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId);
  const eq: Equivalencias = {}; const conf: Record<string, Confianza> = {}; const mot: Record<string, string> = {};
  const res = await fetch("/api/conciliar-compra", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proveedor: proveedorNombre, factura: lineasFactura, ocs, tallesEspeciales: opciones.tallesEspeciales }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "No se pudo conciliar");
  Object.assign(eq, json.equivalencias || {}); Object.assign(conf, json.confianza || {}); Object.assign(mot, json.motivo || {});
  for (const a of (aprendidas || []) as Array<{ producto_factura: string; producto_oc: string }>) {
    eq[a.producto_factura] = [...new Set([...(eq[a.producto_factura] || []), a.producto_oc])];
    conf[a.producto_factura] = "alta";
    mot[a.producto_factura] = "Aprendido de conciliaciones anteriores.";
  }
  // Segunda pasada: si quedaron líneas sin OC y OC con pendientes, se le pregunta a la IA
  // solo por lo que sobró (a veces un mismo artículo de la factura va a dos OC con nombres distintos).
  if (json.ia) {
    const r1 = matchPurchaseLines(lineasFactura, ocs, eq, manual, opciones);
    if (r1.sinAsignar.length && r1.pendientesOc.length) {
      const restoF = r1.sinAsignar.map(x => ({ ...lineasFactura.find(l => l.key === x.invoiceKey)!, cantidad: x.cantidad }));
      const restoO = r1.pendientesOc.map(p => ({ ...ocs.find(o => o.id === p.ocLineId)!, cantidad: p.cantidad }));
      try {
        const res2 = await fetch("/api/conciliar-compra", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ proveedor: proveedorNombre, factura: restoF, ocs: restoO, tallesEspeciales: opciones.tallesEspeciales }),
        });
        const j2 = await res2.json();
        if (res2.ok && j2.ia) for (const [prod, os] of Object.entries(j2.equivalencias || {}) as Array<[string, string[]]>) {
          eq[prod] = [...new Set([...(eq[prod] || []), ...os])];
          conf[prod] = conf[prod] === "alta" && j2.confianza?.[prod] === "alta" ? "alta" : "media";
          if (j2.motivo?.[prod]) mot[prod] = [mot[prod], j2.motivo[prod]].filter(Boolean).join(" · ");
        }
      } catch { /* si falla, queda lo de la primera pasada */ }
    }
  }
  const iaInfo = json.ia ? `Sugerencias de IA${json.modelo ? ` (${json.modelo})` : ""}` : json.aviso || "Sin IA: se usó similitud de nombres.";
  return { equivalencias: eq, confianza: conf, motivo: mot, iaInfo };
}

export type ColorLinea = "verde" | "amarillo" | "rojo" | "fuera";

/** Semáforo de una línea de factura después del cruce. */
export function semaforoLinea(
  key: string, descripcion: string, resultado: MatchResult,
  ctx: { manual: Manual; confianza: Record<string, Confianza>; revisadas?: Set<string> },
): ColorLinea {
  if (ctx.manual[key] === "__extra__") return "fuera";
  const revisada = !!ctx.revisadas?.has(key);
  const sa = resultado.sinAsignar.find(s => s.invoiceKey === key);
  if (sa?.tipo === "sin_oc") return "rojo";
  if (sa?.tipo === "de_mas") return revisada ? "verde" : "amarillo";
  const as: Asignacion[] = resultado.asignaciones.filter(a => a.invoiceKey === key);
  const prod = parseVariant(descripcion).producto;
  const dudosa = as.some(a => a.origen === "equivalencia") && ctx.confianza[prod] && ctx.confianza[prod] !== "alta";
  if (as.some(a => a.semaforo === "amarillo") || dudosa) return revisada ? "verde" : "amarillo";
  return "verde";
}

export function contarSemaforo(lineas: InvoiceLineInput[], resultado: MatchResult, ctx: { manual: Manual; confianza: Record<string, Confianza>; revisadas?: Set<string> }) {
  const c = { verde: 0, amarillo: 0, rojo: 0, fuera: 0 };
  for (const l of lineas) c[semaforoLinea(l.key, l.descripcion, resultado, ctx)]++;
  return c;
}
