// Prueba rápida de lib/ia-acciones.ts (correr con: npx tsx scripts/test-ia-acciones.ts)
import assert from "node:assert/strict";
import { limpiarCambios, diferencias, planDeshacer, resumenCambio, tituloRegistro, esTabla } from "../src/lib/ia-acciones";

// Solo campos permitidos; precios y razón social se ignoran.
const l1 = limpiarCambios("proveedores", { email: "  compras@nexo.com ", razon_social: "X", cbu: "0170 0123 4000 0001 2345 67", precio: 10 });
assert.deepEqual(l1.ignorados.sort(), ["precio", "razon_social"]);
assert.equal(l1.cambios.email, "compras@nexo.com");
assert.equal(l1.cambios.cbu, "0170012340000001234567");
assert.equal(l1.avisos.length, 0);

// Avisos que no frenan.
const l2 = limpiarCambios("proveedores", { email: "compras-nexo", cbu: "123" });
assert.equal(l2.avisos.length, 2);
assert.equal(l2.errores.length, 0);
assert.equal(l2.cambios.cbu, "123");

// Varios mails juntos.
assert.equal(limpiarCambios("facturas", { email_enviado_a: "a@x.com; b@y.com" }).cambios.email_enviado_a, "a@x.com, b@y.com");

// Cantidad inválida = error; el proveedor del renglón no se toca en la Etapa 1.
const l3 = limpiarCambios("orden_compra_items", { cantidad_recibida: "-2", proveedor_id: "Nexo" });
assert.equal(l3.errores.length, 1);
assert.deepEqual(l3.ignorados, ["proveedor_id"]);
assert.equal(limpiarCambios("orden_compra_items", { cantidad_recibida: "1,5" }).cambios.cantidad_recibida, 1.5);

// Vacío = null.
assert.equal(limpiarCambios("clientes", { telefono: "  " }).cambios.telefono, null);

// Diferencias: solo lo que cambia.
const d = diferencias("clientes", { email: "a@x.com", telefono: null }, { email: "a@x.com", telefono: "1234" });
assert.equal(d.length, 1);
assert.equal(d[0].campo, "telefono");
assert.equal(d[0].antes, null);
assert.equal(diferencias("orden_compra_items", { cantidad_recibida: "1.00" }, { cantidad_recibida: 1 }).length, 0);

// Deshacer: no pisa lo que alguien cambió después.
const p = planDeshacer({ email: "nuevo@x.com", telefono: "999" }, { email: null, telefono: "111" }, { email: "nuevo@x.com", telefono: "222" });
assert.deepEqual(p.revertir, { email: null });
assert.deepEqual(p.tocadosDespues, ["telefono"]);

assert.match(resumenCambio("proveedores", "Nexo", d), /^Proveedor Nexo · Teléfono: 1234$/);
assert.equal(tituloRegistro("facturas", { tipo: "factura_a", punto_venta: 15, numero: 41 }), "FACTURA A 15-41");
assert.equal(esTabla("clientes"), true);
assert.equal(esTabla("listas_precios"), false);
assert.equal(esTabla("toString"), false);

console.log("test-ia-acciones OK");
