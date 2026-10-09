const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/orden-pago-plan.ts", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { buildOrdenPagoPlan, comprobanteKey } = context.exports;

assert.equal(comprobanteKey(null, null, "FA 0015-00000007"), "15-7");
assert.equal(comprobanteKey(null, null, "0001500000007"), "15-7");
assert.equal(comprobanteKey("15", "7", null), "15-7");

// Caso real: OP Termo Córdoba 000100015536 (una factura en pesos y una en dólares).
const termo = {
  orden_pago_cliente: "000100015536",
  fecha_orden: "2026-10-02",
  pagador: { razon_social: "TERMO CORDOBA SAU", cuit: "30-71537802-3" },
  facturas_pagadas: [
    { tipo: "FA", punto_venta: 15, numero: 4, comprobante: "0001500000004", importe_pagado: 186340.00 },
    { tipo: "FA", punto_venta: 15, numero: 7, comprobante: "0001500000007", importe_pagado: 1277198.10 },
  ],
  pagos: [
    { tipo: "deposito", monto: 1422660.67, fecha: "2026-10-02", referencia: "000100015536" },
    { tipo: "retencion_ganancias", monto: 19710.63, certificado: "000000002302" },
    { tipo: "retencion_iibb", monto: 21166.80, certificado: "000000001115",
      detalle: [{ punto_venta: 15, numero: 4, importe: 2695.00 }, { punto_venta: 15, numero: 7, importe: 18471.80 }] },
  ],
};

// Formulario de dólares: solo la FA 0007.
const usd = buildOrdenPagoPlan(termo, [{ id: "fa7", numero: "FA 0015-00000007" }]);
assert.equal(usd.fecha, "2026-10-02");
assert.equal(usd.pagadorCuit, "30715378023");
assert.equal(usd.incluidas.length, 1);
assert.equal(usd.incluidas[0].importe, 1277198.10);
const ret = Object.fromEntries(usd.retenciones.map(r => [r.tipo, r.monto]));
assert.equal(ret.retencion_iibb, 18471.80);
assert.equal(ret.retencion_ganancias, 17201.04);
assert.equal(usd.medios.length, 1);
assert.equal(usd.medios[0].monto, 1241525.26);
assert.equal(Math.round((usd.medios[0].monto + ret.retencion_iibb + ret.retencion_ganancias) * 100), 127719810);
assert.equal(usd.otras.length, 1);
assert.equal(usd.otras[0].importe, 186340);
assert.equal(usd.otras[0].medios, 181135.41);

// Formulario de pesos: solo la FA 0004.
const ars = buildOrdenPagoPlan(termo, [{ id: "fa4", numero: "FA 0015-00000004" }]);
assert.equal(ars.medios[0].monto, 181135.41);
const retArs = Object.fromEntries(ars.retenciones.map(r => [r.tipo, r.monto]));
assert.equal(retArs.retencion_iibb, 2695.00);
assert.equal(retArs.retencion_ganancias, 2509.59);

// Las dos juntas: se usa la orden completa, sin "otras".
const ambas = buildOrdenPagoPlan(termo, [{ id: "fa4", numero: "FA 0015-00000004" }, { id: "fa7", numero: "FA 0015-00000007" }]);
assert.equal(ambas.otras.length, 0);
assert.equal(ambas.medios[0].monto, 1422660.67);
assert.equal(ambas.retenciones.reduce((s, r) => s + r.monto, 0).toFixed(2), "40877.43");

// Sin detalle de facturas: se carga la orden completa con un aviso.
const sinDetalle = buildOrdenPagoPlan({ pagos: termo.pagos }, [{ id: "fa7", numero: "FA 0015-00000007" }]);
assert.equal(sinDetalle.medios[0].monto, 1422660.67);
assert.ok(sinDetalle.avisos.some(a => a.includes("no encontró el detalle")));

console.log("OK: orden de pago repartida por factura (caso Termo Córdoba).");
