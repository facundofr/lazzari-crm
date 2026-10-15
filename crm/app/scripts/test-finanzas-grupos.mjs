// Prueba rápida: npx tsx scripts/test-finanzas-grupos.mjs
import assert from "node:assert/strict";
import { FINANZAS_GRUPOS, grupoDeTab, operacionVencimientos, pestanaInicial } from "../src/lib/finanzas-grupos.ts";

// Los 4 grupos, en orden (desde el 16/10/2026: Hoy, Cobrar, Pagar, Bancos; Cheques va en Pagar).
assert.deepEqual(FINANZAS_GRUPOS.map((g) => g.id), ["hoy", "cobrar", "pagar", "bancos"]);

// A la vista quedan 11 pestañas; el resto va en "Más".
assert.equal(FINANZAS_GRUPOS.flatMap((g) => g.tabs.filter((t) => !t.mas)).length, 11);
assert.equal(grupoDeTab("para_confirmar"), "hoy");
assert.equal(grupoDeTab("correo"), "hoy");
assert.equal(grupoDeTab("lineas_credito"), "pagar");
// Lo último guardado con grupos viejos ("deudas", "cheques") abre igual.
assert.deepEqual(pestanaInicial({}, { grupo: "deudas", tab: "lineas_credito" }), { grupo: "pagar", tab: "lineas_credito" });
assert.deepEqual(pestanaInicial({}, { grupo: "cheques", tab: "echeqs" }), { grupo: "pagar", tab: "echeqs" });

// Ninguna pestaña quedó afuera (incluye Gastos fijos, que antes estaba oculta).
const todas = new Set(FINANZAS_GRUPOS.flatMap((g) => g.tabs.map((t) => t.id)));
for (const t of ["cuentas", "para_confirmar", "correo", "movimientos", "recibos", "vencimientos", "facturas_compra", "ordenes_pago", "gastos_manuales", "echeqs",
  "cheques_tercero", "cc_clientes", "cc_proveedores", "extractos", "lineas_credito", "gastos_fijos", "objetivos", "facturacion", "retenciones", "revisar"]) {
  assert.ok(todas.has(t), `falta la pestaña ${t}`);
}

// Vencimientos está en Cobrar y en Pagar: respeta el grupo desde el que se abre.
assert.equal(grupoDeTab("vencimientos"), "cobrar");
assert.equal(grupoDeTab("vencimientos", "pagar"), "pagar");
assert.equal(grupoDeTab("vencimientos", "bancos"), "cobrar");
assert.equal(operacionVencimientos("cobrar"), "venta");
assert.equal(operacionVencimientos("pagar"), "compra");
assert.equal(grupoDeTab("echeqs", "hoy"), "pagar");
assert.equal(grupoDeTab("revisar"), "hoy");
assert.equal(grupoDeTab("gastos_fijos"), "pagar");

// Inicio: link de factura > link de pestaña > lo último guardado > Hoy.
assert.deepEqual(pestanaInicial({ factura: "x", tab: "echeqs" }, { tab: "cuentas" }), { grupo: "cobrar", tab: "facturacion" });
assert.deepEqual(pestanaInicial({ tab: "cc_proveedores" }, { tab: "echeqs" }), { grupo: "pagar", tab: "cc_proveedores" });
assert.deepEqual(pestanaInicial({ tab: "basura" }, { grupo: "pagar", tab: "vencimientos" }), { grupo: "pagar", tab: "vencimientos" });
assert.deepEqual(pestanaInicial({}, { grupo: "x", tab: "otra" }), { grupo: "hoy", tab: "cuentas" });
assert.deepEqual(pestanaInicial({}, null), { grupo: "hoy", tab: "cuentas" });

console.log("finanzas-grupos: OK");
