// Prueba rápida: npx tsx scripts/test-finanzas-grupos.mjs
import assert from "node:assert/strict";
import { FINANZAS_GRUPOS, grupoDeTab, operacionVencimientos, pestanaInicial } from "../src/lib/finanzas-grupos.ts";

// Los 4 grupos, en orden (Cheques y Créditos juntos desde el 16/10/2026).
assert.deepEqual(FINANZAS_GRUPOS.map((g) => g.id), ["hoy", "cobrar", "pagar", "cheques"]);

// A la vista quedan 12 pestañas; el resto va en "Más".
assert.equal(FINANZAS_GRUPOS.flatMap((g) => g.tabs.filter((t) => !t.mas)).length, 12);
assert.equal(grupoDeTab("lineas_credito"), "cheques");
// Lo último guardado con el grupo viejo "deudas" abre igual.
assert.deepEqual(pestanaInicial({}, { grupo: "deudas", tab: "lineas_credito" }), { grupo: "cheques", tab: "lineas_credito" });

// Ninguna pestaña quedó afuera (incluye Gastos fijos, que antes estaba oculta).
const todas = new Set(FINANZAS_GRUPOS.flatMap((g) => g.tabs.map((t) => t.id)));
for (const t of ["cuentas", "movimientos", "recibos", "vencimientos", "facturas_compra", "ordenes_pago", "gastos_manuales", "echeqs",
  "cheques_tercero", "cc_clientes", "cc_proveedores", "extractos", "lineas_credito", "gastos_fijos", "objetivos", "facturacion", "retenciones", "revisar"]) {
  assert.ok(todas.has(t), `falta la pestaña ${t}`);
}

// Vencimientos está en Cobrar y en Pagar: respeta el grupo desde el que se abre.
assert.equal(grupoDeTab("vencimientos"), "cobrar");
assert.equal(grupoDeTab("vencimientos", "pagar"), "pagar");
assert.equal(grupoDeTab("vencimientos", "cheques"), "cobrar");
assert.equal(operacionVencimientos("cobrar"), "venta");
assert.equal(operacionVencimientos("pagar"), "compra");
assert.equal(grupoDeTab("echeqs", "hoy"), "cheques");
assert.equal(grupoDeTab("revisar"), "hoy");
assert.equal(grupoDeTab("gastos_fijos"), "pagar");

// Inicio: link de factura > link de pestaña > lo último guardado > Hoy.
assert.deepEqual(pestanaInicial({ factura: "x", tab: "echeqs" }, { tab: "cuentas" }), { grupo: "cobrar", tab: "facturacion" });
assert.deepEqual(pestanaInicial({ tab: "cc_proveedores" }, { tab: "echeqs" }), { grupo: "pagar", tab: "cc_proveedores" });
assert.deepEqual(pestanaInicial({ tab: "basura" }, { grupo: "pagar", tab: "vencimientos" }), { grupo: "pagar", tab: "vencimientos" });
assert.deepEqual(pestanaInicial({}, { grupo: "x", tab: "otra" }), { grupo: "hoy", tab: "cuentas" });
assert.deepEqual(pestanaInicial({}, null), { grupo: "hoy", tab: "cuentas" });

console.log("finanzas-grupos: OK");
