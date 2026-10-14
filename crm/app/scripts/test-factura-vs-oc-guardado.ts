// Simula, en memoria, lo que hace "Guardar" en Cargar factura con el caso Nexo (no toca la base).
import { reconcilePurchaseLines } from "../src/lib/purchase-invoice-reconciliation";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

const oc = { id: "oc1", orden_compra_items: [
  { id: "mesa", orden_id: "oc1", descripcion: "MESA DE REUNIONES", cantidad: 1, cantidad_recibida: 0, precio_unitario: 378800, iva_porcentaje: 21 },
  { id: "caja", orden_id: "oc1", descripcion: "OPCIONAL CAJA PORTA TOMA DE 2 BOCAS", cantidad: 1, cantidad_recibida: 0, precio_unitario: 49000, iva_porcentaje: 21 },
] as any[] };
const factura = [
  { tempId: "f1", descripcion: "Mesa de reuniones línea Pórtico", cantidad: 1, precio_unitario: 378800, iva_porcentaje: 21 },
  { tempId: "f2", descripcion: "Cajas porta toma de 2 bocas", cantidad: 2, precio_unitario: 49000, iva_porcentaje: 21 },
  { tempId: "f3", descripcion: "Costo de envio", cantidad: 1, precio_unitario: 90000, iva_porcentaje: 21 },
];
const asign: Record<string, string> = { f1: "mesa", f2: "caja" };
let rec = reconcilePurchaseLines(oc.orden_compra_items, factura, [], asign);
ok(rec.extras.length === 2, "sobran la caja de más y el envío");
// Decisión por defecto: todo a la misma OC.
for (const extra of rec.extras) {
  const target = asign[extra.tempId!];
  const line = target ? oc.orden_compra_items.find((l) => l.id === target) : null;
  if (line) line.cantidad += Number(extra.cantidad);
  else {
    const nueva = { id: `nuevo:${extra.tempId}`, orden_id: "oc1", descripcion: extra.descripcion, cantidad: extra.cantidad, cantidad_recibida: 0, precio_unitario: extra.precio_unitario, iva_porcentaje: 21 };
    oc.orden_compra_items.push(nueva);
    asign[extra.tempId!] = nueva.id;
  }
}
rec = reconcilePurchaseLines(oc.orden_compra_items, factura, [], asign);
ok(rec.extras.length === 0, "después de actualizar la OC no sobra nada (no se crea OC aparte)");
ok(oc.orden_compra_items.find((l) => l.id === "caja")!.cantidad === 2, "la caja pasa a 2 en la OC");
ok(rec.costs.some((c) => c.line.id === "nuevo:f3"), "el envío queda en la OC");
ok(rec.allQuantitiesBilled, "la OC queda facturada completa");
const neto = oc.orden_compra_items.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0);
ok(neto === 566800 && Math.round(neto * 1.21) === 685828, "OC nueva: neto 566.800, total 685.828 = factura");
console.log("TODO OK");
