// Facturas que corresponden a renglones de OC SIN proveedor (o con "Mercado Libre" como proveedor): la IA los encuentra
// y, con un clic, los pasa a una OC del proveedor real (el que factura). Prueba: scripts/test-oc-sin-proveedor.ts
// Regla de Augusto (16/10/2026): en las compras de Mercado Libre el proveedor de la OC es SIEMPRE el vendedor real.
import { heuristicEquivalences, matchPurchaseLines, type InvoiceLineInput, type OcLineInput } from "@/lib/purchase-matching";

export interface CandidataSinProveedor extends OcLineInput { moneda: string }
export interface CoincidenciaSinProveedor {
  ocLineId: string; ocId: string; ocNumero: string; descripcionOc: string; cantidad: number;
  facturaKey: string; origen: string; precioFactura: number; precioOc: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Renglones pendientes de OC que no tienen un proveedor real (sin proveedor, o proveedor de tipo Marketplace). */
export async function cargarLineasSinProveedor(db: any, sociedadId: string): Promise<CandidataSinProveedor[]> {
  const { data: mk } = await db.from("proveedores").select("id").eq("sociedad_id", sociedadId).ilike("rubro", "marketplace");
  const idsMarketplace: string[] = (mk || []).map((p: any) => p.id);
  let q = db.from("ordenes_compra").select("id, numero, fecha, estado, moneda, saldo_cerrado, proveedor_id").eq("sociedad_id", sociedadId).neq("estado", "cancelada");
  q = idsMarketplace.length ? q.or(`proveedor_id.is.null,proveedor_id.in.(${idsMarketplace.join(",")})`) : q.is("proveedor_id", null);
  const { data: ocs, error } = await q.order("fecha");
  if (error) throw error;
  const abiertas = (ocs || []).filter((o: any) => !o.saldo_cerrado);
  if (!abiertas.length) return [];
  const byId = new Map<string, any>(abiertas.map((o: any) => [o.id, o]));
  const out: CandidataSinProveedor[] = [];
  for (let i = 0; i < abiertas.length; i += 100) {
    const { data: lineas, error: e2 } = await db.from("orden_compra_items_pendientes")
      .select("id, orden_id, codigo, descripcion, cantidad_pendiente, precio_unitario").in("orden_id", abiertas.slice(i, i + 100).map((o: any) => o.id));
    if (e2) throw e2;
    for (const l of lineas || []) {
      const o = byId.get(l.orden_id); const cant = round2(Number(l.cantidad_pendiente));
      if (!o || !(cant > 0)) continue;
      out.push({ id: l.id, ocId: l.orden_id, ocNumero: o.numero, ocFecha: o.fecha, codigo: l.codigo, descripcion: l.descripcion, cantidad: cant, precio: Number(l.precio_unitario) || 0, moneda: o.moneda || "ARS" });
    }
  }
  return out;
}

/** Qué renglones sin proveedor cubre esta factura (código, equivalencia o nombre parecido con cantidad/precio). */
export function coincidenciasSinProveedor(factura: InvoiceLineInput[], candidatas: CandidataSinProveedor[], opciones: Parameters<typeof matchPurchaseLines>[4] = {}): CoincidenciaSinProveedor[] {
  if (!factura.length || !candidatas.length) return [];
  const eq = heuristicEquivalences(factura, candidatas, (opciones as any)?.tallesEspeciales || []);
  const r = matchPurchaseLines(factura, candidatas, eq, {}, opciones);
  const porId = new Map(candidatas.map(c => [c.id, c]));
  return r.asignaciones.map(a => ({
    ocLineId: a.ocLineId, ocId: a.ocId, ocNumero: a.ocNumero, descripcionOc: porId.get(a.ocLineId)?.descripcion || "", cantidad: a.cantidad,
    facturaKey: a.invoiceKey, origen: a.origen, precioFactura: a.precioFactura, precioOc: a.precioOc,
  }));
}

export interface ResultadoAsignar { movidos: number; ocDestino: string[]; avisos: string[] }

/**
 * Pasa renglones de OC (sin proveedor) a una OC del proveedor real, del mismo PR y moneda: usa una OC sin mandar que ya exista o crea una.
 * La OC que queda vacía se CANCELA (no se borra). No toca el PR. Se salta lo que ya tiene algo recibido.
 */
export async function asignarRenglonesAProveedor(db: any, args: { sociedadId: string; userId?: string | null; itemIds: string[]; proveedorId: string; proveedorNombre: string; nota?: string }): Promise<ResultadoAsignar> {
  const res: ResultadoAsignar = { movidos: 0, ocDestino: [], avisos: [] };
  if (!args.itemIds.length) return res;
  const { data: items, error: e0 } = await db.from("orden_compra_items").select("id, orden_id, cantidad_recibida, descripcion").in("id", args.itemIds);
  if (e0) throw e0;
  const porOrigen = new Map<string, any[]>();
  for (const it of items || []) {
    if (Number(it.cantidad_recibida) > 0) { res.avisos.push(`"${it.descripcion}" ya tiene algo recibido: no se movió`); continue; }
    porOrigen.set(it.orden_id, [...(porOrigen.get(it.orden_id) || []), it]);
  }
  if (!porOrigen.size) return res;
  const { data: origenes, error: e1 } = await db.from("ordenes_compra").select("id, numero, moneda, presupuesto_origen_id, observaciones, pedido").in("id", [...porOrigen.keys()]);
  if (e1) throw e1;
  const nota = args.nota ? ` · ${args.nota}` : "";
  const creadas = new Map<string, string>();
  for (const o of origenes || []) {
    const clave = `${o.presupuesto_origen_id}|${o.moneda}`;
    let destId = creadas.get(clave);
    if (!destId) {
      let q = db.from("ordenes_compra").select("id").eq("sociedad_id", args.sociedadId).eq("proveedor_id", args.proveedorId).eq("moneda", o.moneda).neq("estado", "cancelada").neq("id", o.id);
      q = o.presupuesto_origen_id ? q.eq("presupuesto_origen_id", o.presupuesto_origen_id) : q.is("presupuesto_origen_id", null);
      const { data: ex } = await q.eq("pedido", false).limit(1);
      destId = ex?.[0]?.id;
    }
    if (!destId) {
      const { data: nueva, error: e2 } = await db.from("ordenes_compra").insert({
        proveedor_id: args.proveedorId, presupuesto_origen_id: o.presupuesto_origen_id, sociedad_id: args.sociedadId, fecha: new Date().toLocaleDateString("en-CA", { timeZone: "America/Buenos_Aires" }),
        moneda: o.moneda, estado: "enviada", subtotal: 0, iva: 0, total: 0,
        observaciones: `Proveedor real ${args.proveedorNombre}: renglones pasados desde ${o.numero} al conciliar su factura${nota}`, created_by: args.userId || null,
      }).select("id").single();
      if (e2 || !nueva) throw new Error(e2?.message || "no se pudo crear la OC del proveedor");
      destId = nueva.id as string;
    }
    creadas.set(clave, destId as string);
    const ids = (porOrigen.get(o.id) || []).map(i => i.id);
    const { error: e3 } = await db.from("orden_compra_items").update({ orden_id: destId }).in("id", ids);
    if (e3) throw new Error(e3.message);
    res.movidos += ids.length; if (!res.ocDestino.includes(destId as string)) res.ocDestino.push(destId as string);
    const { count } = await db.from("orden_compra_items").select("id", { count: "exact", head: true }).eq("orden_id", o.id);
    if (count === 0) await db.from("ordenes_compra").update({ estado: "cancelada", observaciones: `${o.observaciones || ""} · Vacía: sus renglones pasaron a ${args.proveedorNombre}`.replace(/^ · /, "") }).eq("id", o.id).eq("sociedad_id", args.sociedadId);
    if (o.pedido) res.avisos.push(`${o.numero} ya figuraba como pedida: revisá con el proveedor anterior`);
  }
  return res;
}
