// Prueba de lib/presupuesto-duplicar.ts. Correr desde crm/app: npx tsx scripts/test-presupuesto-duplicar.ts
import assert from "node:assert/strict";
import { armarDuplicadoPR } from "../src/lib/presupuesto-duplicar";

const original = {
  id: "viejo", numero: "PR-2026-0100", cliente_id: "c1", vendedor_id: "v1", created_by: "otro", sociedad_id: "s1",
  fecha: "2026-08-01", vencimiento: "2026-08-31", estado: "rechazado", motivo_rechazo: "caro", eliminado: true,
  listo_para_facturar: true, ia_armado_at: "2026-08-01T10:00:00Z", ia_resumen: "x", enviado_at: "2026-08-01T10:00:00Z",
  oc_cliente: "OC 9", archivo_url: "/api/archivo/a.pdf", fecha_vencimiento: "2026-09-01", origen_pedido: "mail",
  moneda: "USD", tipo_cambio: 1500, cotizacion_modalidad: "divisas", total: 121, observaciones: "obs",
  descuento_general_porcentaje: 5, costo_envio_interno: 3000, transportista_id: "t1", direccion_entrega: "Calle 1",
  presupuesto_items: [
    { id: "i2", presupuesto_id: "viejo", orden: 2, descripcion: "Guante", cantidad: 10, precio_venta: 5, subtotal: 50,
      cantidad_entregada: 10, cantidad_facturada: 10, ia_confianza: 0.9, created_at: "x" },
    { id: "i1", presupuesto_id: "viejo", orden: 1, descripcion: "Botín", cantidad: 2, precio_venta: 30, costo_moneda: "USD", precio_lista: 40 },
  ],
};

const d = armarDuplicadoPR(original, "2026-10-28", "yo");
const p = d.presupuesto as Record<string, unknown>;
assert.equal(p.fecha, "2026-10-28");
assert.equal(p.vencimiento, "2026-11-27");
assert.equal(p.estado, "pendiente");
assert.equal(p.created_by, "yo");
assert.equal(p.enviado_at, null);
for (const k of ["id", "numero", "sociedad_id", "motivo_rechazo", "eliminado", "listo_para_facturar", "ia_armado_at", "ia_resumen",
  "oc_cliente", "archivo_url", "fecha_vencimiento", "origen_pedido", "presupuesto_items"]) assert.equal(k in p, false, k);
assert.equal(p.cliente_id, "c1"); assert.equal(p.vendedor_id, "v1"); assert.equal(p.moneda, "USD"); assert.equal(p.tipo_cambio, 1500);
assert.equal(p.descuento_general_porcentaje, 5); assert.equal(p.observaciones, "obs");

// Renglones en orden, sin ids ni lo entregado/facturado
assert.deepEqual(d.renglones.map((r) => r.descripcion), ["Botín", "Guante"]);
assert.equal(d.renglones[0].costo_moneda, "USD"); assert.equal(d.renglones[0].precio_lista, 40);
for (const k of ["id", "presupuesto_id", "subtotal", "cantidad_entregada", "cantidad_facturada", "ia_confianza", "created_at"])
  assert.equal(k in d.renglones[1], false, k);

assert.deepEqual(d.aparte, { costo_envio_interno: 3000, transportista_id: "t1", direccion_entrega: "Calle 1" });
assert.deepEqual(armarDuplicadoPR({ cliente_id: "c" }, "2026-10-28", null).renglones, []);

console.log("test-presupuesto-duplicar OK");
