/**
 * Resto a facturar (Augusto 26/10/2026): si al facturar un PR se sacan renglones o se baja la cantidad, lo que falta
 * queda como "resto" del mismo PR (tabla presupuesto_restos_facturar) para facturarlo después o marcarlo "No facturar".
 *
 * Cada renglón de la factura recuerda de qué renglón del PR salió (`prIdx`). Lo que falta = cantidad del PR − lo facturado
 * de ese renglón. Renglones agregados a mano (sin `prIdx`) no cuentan. Facturar de más no deja resto negativo.
 *
 * Prueba: npx tsx scripts/test-resto-facturar.ts
 */

export interface ItemPr {
  descripcion: string;
  cantidad: number | string;
  precio_venta: number | string | null;
  iva_porcentaje: number | string | null;
  total: number | string | null;
}

export interface ItemResto {
  descripcion: string;
  cantidad: number;
  precio_venta: number;
  iva_porcentaje: number;
  total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Neto unitario del renglón del PR (igual que precioNetoItemPresupuesto). */
function netoUnitario(it: ItemPr): number {
  if (it.precio_venta != null && it.precio_venta !== "") return Number(it.precio_venta) || 0;
  const iva = Number(it.iva_porcentaje ?? 21);
  const cantidad = Number(it.cantidad) || 1;
  return it.total ? Number(it.total) / cantidad / (1 + iva / 100) : 0;
}

export function restoSinFacturar(itemsPr: ItemPr[], facturados: { prIdx?: number | null; cantidad: number }[]): ItemResto[] {
  const porIdx = new Map<number, number>();
  for (const f of facturados) {
    if (f.prIdx == null) continue;
    porIdx.set(f.prIdx, (porIdx.get(f.prIdx) || 0) + (Number(f.cantidad) || 0));
  }
  const resto: ItemResto[] = [];
  itemsPr.forEach((it, idx) => {
    const falta = r4((Number(it.cantidad) || 0) - (porIdx.get(idx) || 0));
    if (falta <= 0.00005) return;
    const iva = Number(it.iva_porcentaje ?? 21);
    const precio = netoUnitario(it);
    resto.push({ descripcion: it.descripcion, cantidad: falta, precio_venta: precio, iva_porcentaje: iva, total: r2(falta * precio * (1 + iva / 100)) });
  });
  return resto;
}

export function totalesResto(items: ItemResto[]): { subtotal: number; total: number } {
  return {
    subtotal: r2(items.reduce((a, it) => a + it.cantidad * it.precio_venta, 0)),
    total: r2(items.reduce((a, it) => a + it.total, 0)),
  };
}

/** "800 Respirador N95 · 12 Suspensión H700" para la lista y la pregunta. */
export function detalleResto(items: ItemResto[]): string {
  return items.map((it) => `${Number(it.cantidad.toFixed(4))} ${it.descripcion}`).join(" · ");
}

/** Un resto guardado, como lo leen la lista y el panel del PR. */
export interface RestoPR {
  id: string;
  presupuesto_id: string;
  estado: "pendiente" | "facturado" | "no_facturar";
  moneda: string;
  total: number | string;
  items: ItemResto[];
  factura_resto?: { tipo: string; punto_venta: number | null; numero: number | null } | null;
}

function importe(moneda: string, n: number | string): string {
  const v = (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda === "USD" ? "US$" : "$"} ${v}`;
}

/** Cartel del resto dentro del PR: pendiente (ámbar, con Ir a Facturar) o ya resuelto (gris). */
export function cartelResto(r: RestoPR): { pendiente: boolean; titulo: string; detalle: string } {
  const detalle = detalleResto(r.items || []);
  if (r.estado === "pendiente") return { pendiente: true, titulo: `Resto a facturar: ${importe(r.moneda, r.total)}`, detalle };
  if (r.estado === "facturado") {
    const f = r.factura_resto;
    const nro = f ? ` en ${f.tipo} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? 0).padStart(8, "0")}` : "";
    return { pendiente: false, titulo: `Resto facturado${nro}: ${importe(r.moneda, r.total)}`, detalle };
  }
  return { pendiente: false, titulo: `Resto marcado No facturar: ${importe(r.moneda, r.total)}`, detalle };
}
