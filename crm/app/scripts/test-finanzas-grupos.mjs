// Prueba rápida: npx tsx scripts/test-finanzas-grupos.mjs
import assert from "node:assert/strict";
import { FINANZAS_GRUPOS, entradaDeTab, esFinanzasTab, grupoDeTab, pestanaInicial, tabReal } from "../src/lib/finanzas-grupos.ts";

// 16/10/2026 (unificación): 5 grupos — Hoy, Cobros, Pagos, Tesorería, Informes.
assert.deepEqual(FINANZAS_GRUPOS.map((g) => g.id), ["hoy", "cobrar", "pagar", "bancos", "informes"]);
assert.deepEqual(FINANZAS_GRUPOS.map((g) => g.label), ["Hoy", "Cobros", "Pagos", "Tesorería", "Informes"]);

// 13 pestañas en el menú (antes 23).
assert.equal(FINANZAS_GRUPOS.flatMap((g) => g.tabs).length, 13);

// Ninguna pantalla quedó afuera: todas son pestaña o vista de una pestaña.
for (const t of ["cuentas", "para_confirmar", "correo", "movimientos", "recibos", "facturas_compra", "ordenes_pago", "gastos_manuales", "echeqs",
  "cheques_tercero", "cc_clientes", "cc_proveedores", "extractos", "lineas_credito", "gastos_fijos", "objetivos", "facturacion", "retenciones",
  "revisar", "informes", "pagar_semana"]) {
  assert.ok(esFinanzasTab(t), `falta la pantalla ${t}`);
  assert.ok(entradaDeTab(t), `${t} no está en el menú`);
}
// Las unificadas de verdad abren la nueva.
assert.equal(tabReal("cobrar_clientes"), "cc_clientes");
assert.equal(tabReal("vencimientos"), "cc_proveedores");
assert.ok(esFinanzasTab("vencimientos"));
assert.equal(grupoDeTab("vencimientos"), "pagar");
assert.deepEqual(pestanaInicial({ tab: "cobrar_clientes" }, null), { grupo: "cobrar", tab: "cc_clientes" });
assert.deepEqual(pestanaInicial({}, { grupo: "pagar", tab: "vencimientos" }), { grupo: "pagar", tab: "cc_proveedores" });

// Vistas dentro de una pestaña.
assert.equal(entradaDeTab("correo")?.label, "Para hacer");
assert.equal(entradaDeTab("extractos")?.label, "Banco");
assert.equal(entradaDeTab("cheques_tercero")?.label, "Cheques");
assert.equal(entradaDeTab("recibos")?.label, "Movimientos");
assert.equal(entradaDeTab("gastos_fijos")?.label, "Gastos");
assert.equal(entradaDeTab("retenciones")?.label, "Informes");
assert.equal(grupoDeTab("correo"), "hoy");
assert.equal(grupoDeTab("para_confirmar"), "bancos");
assert.equal(grupoDeTab("lineas_credito"), "informes");
assert.equal(grupoDeTab("gastos_fijos"), "pagar");
assert.equal(grupoDeTab("recibos"), "bancos");

// Lo último guardado con grupos viejos ("deudas", "cheques") abre igual.
assert.deepEqual(pestanaInicial({}, { grupo: "deudas", tab: "lineas_credito" }), { grupo: "informes", tab: "lineas_credito" });
assert.deepEqual(pestanaInicial({}, { grupo: "cheques", tab: "echeqs" }), { grupo: "bancos", tab: "echeqs" });

// Inicio: link de factura > link de pestaña > lo último guardado > Hoy.
assert.deepEqual(pestanaInicial({ factura: "x", tab: "echeqs" }, { tab: "cuentas" }), { grupo: "cobrar", tab: "facturacion" });
assert.deepEqual(pestanaInicial({ tab: "cc_proveedores" }, { tab: "echeqs" }), { grupo: "pagar", tab: "cc_proveedores" });
assert.deepEqual(pestanaInicial({ tab: "basura" }, { grupo: "pagar", tab: "ordenes_pago" }), { grupo: "pagar", tab: "ordenes_pago" });
assert.deepEqual(pestanaInicial({}, { grupo: "x", tab: "otra" }), { grupo: "hoy", tab: "cuentas" });
assert.deepEqual(pestanaInicial({}, null), { grupo: "hoy", tab: "cuentas" });

console.log("finanzas-grupos: OK");
