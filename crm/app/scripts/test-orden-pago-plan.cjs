const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/orden-pago-plan.ts", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { buildOrdenPagoPlan, comprobanteKey, pagoOriginal } = context.exports;

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

// Caso real: OP Del Sol 0001-00018722 trae las facturas sin punto de venta ("FC 65").
const delSol = {
  orden_pago_cliente: "0001-00018722",
  facturas_pagadas: [
    { tipo: "FC", punto_venta: 1, numero: 65, comprobante: "FC 65", importe_pagado: 253387.55 },
    { tipo: "FC", punto_venta: null, numero: 67, comprobante: "FC 67", importe_pagado: 1206073.43 },
    { tipo: "FC", comprobante: "FC 68", importe_pagado: 1836717.86 },
  ],
  pagos: [
    { tipo: "echeq", monto: 3241696.55, fecha: "2026-12-30", referencia: "4074", banco: "Galicia" },
    { tipo: "retencion_ganancias", monto: 54482.29, certificado: "11760" },
  ],
};
const docsDelSol = [{ id: "65", numero: "FA 0015-00000065" }, { id: "67", numero: "FA 0015-00000067" }, { id: "68", numero: "FA 0015-00000068" }];
const sol = buildOrdenPagoPlan(delSol, docsDelSol);
assert.equal(sol.incluidas.length, 3);
assert.equal(sol.otras.length, 0);
assert.equal(sol.medios[0].monto, 3241696.55);
assert.equal(sol.retenciones[0].monto, 54482.29);
// Lo que leyó la IA de verdad (26/10): "FC 65 13/10/2026" → punto de venta 65, número 13 (el día).
const leidoAlReves = { ...delSol, facturas_pagadas: [
  { tipo: "FC", punto_venta: 65, numero: 13, importe_pagado: 253387.55 },
  { tipo: "FC", punto_venta: 67, numero: 14, importe_pagado: 1206073.43 },
  { tipo: "FC", punto_venta: 68, numero: 15, importe_pagado: 1836717.86 },
] };
const reves = buildOrdenPagoPlan(leidoAlReves, docsDelSol);
assert.equal(reves.incluidas.length, 3);
assert.equal(reves.otras.length, 0);
assert.equal(reves.medios[0].monto, 3241696.55);
// Un punto de venta propio (15) nunca se toma como número: la FA 15-70 no es la factura número 15.
const propio = buildOrdenPagoPlan({ facturas_pagadas: [{ punto_venta: 15, numero: 70, importe_pagado: 100 }], pagos: [{ tipo: "transferencia", monto: 100 }] },
  [{ id: "x", numero: "FA 0016-00000015" }, { id: "y", numero: "FA 0015-00000001" }]);
assert.equal(propio.incluidas.length, 0);
// Si dos facturas del formulario tienen el mismo número (otro punto de venta), no se adivina.
const dup = buildOrdenPagoPlan({ facturas_pagadas: [{ comprobante: "FC 65", importe_pagado: 100 }], pagos: [{ tipo: "transferencia", monto: 100 }] },
  [{ id: "a", numero: "FA 0015-00000065" }, { id: "b", numero: "FA 0016-00000065" }]);
assert.equal(dup.incluidas.length, 0);

// Caso real Rebsa (27/10/2026, OP 0001-00010132): dos eCheqs del mismo importe. Antes los dos medios tomaban el N° y la
// fecha de pago del primero (11520327, 07/11); cada uno tiene que quedar con los suyos (el segundo: 11520326, 23/11).
const rebsa = {
  orden_pago_cliente: "0001-00010132",
  facturas_pagadas: [{ tipo: "A", punto_venta: 15, numero: 85, importe_pagado: 538208 }],
  pagos: [
    { tipo: "echeq", monto: 269104, referencia: "11520327", banco: "Banco Provincia", cheque_numero: "11520327", cheque_fecha: "2026-11-07" },
    { tipo: "echeq", monto: 269104, referencia: "11520326", banco: "Banco Provincia", cheque_numero: "11520326", cheque_fecha: "2026-11-23" },
  ],
};
const planRebsa = buildOrdenPagoPlan(rebsa, [{ id: "fa85", numero: "FA 0015-00000085" }]);
const usadosRebsa = new Set();
const deRebsa = Array.from(planRebsa.medios, (m) => pagoOriginal(rebsa.pagos, usadosRebsa, m.tipo, m.monto, m.referencia));
assert.deepEqual(deRebsa.map((p) => [p.cheque_numero, p.cheque_fecha]), [["11520327", "2026-11-07"], ["11520326", "2026-11-23"]]);
// Sin referencia tampoco se repite: el segundo toma el pago que queda libre
const libres = new Set();
assert.deepEqual([pagoOriginal(rebsa.pagos, libres, "echeq", 269104), pagoOriginal(rebsa.pagos, libres, "echeq", 269104)].map((p) => p.cheque_numero), ["11520327", "11520326"]);
assert.equal(pagoOriginal(rebsa.pagos, libres, "echeq", 269104), null, "ya se usaron los dos");
assert.equal(pagoOriginal(rebsa.pagos, new Set(), "transferencia", 269104), null, "otro tipo");
// Primero por referencia, después por importe y si no, el primero libre del tipo
const mezcla = [{ tipo: "echeq", monto: 100, cheque_numero: "A" }, { tipo: "echeq", monto: 200, cheque_numero: "B" }, { tipo: "retencion_iibb", monto: 5, certificado: "C-1" }];
assert.equal(pagoOriginal(mezcla, new Set(), "echeq", 200).cheque_numero, "B");
assert.equal(pagoOriginal(mezcla, new Set(), "echeq", 200, "A").cheque_numero, "A");
assert.equal(pagoOriginal(mezcla, new Set(), "echeq", 999).cheque_numero, "A");
assert.equal(pagoOriginal(mezcla, new Set(), "retencion_iibb", 3, "C-1").certificado, "C-1");

// Solo certificados de retención (Cargill 04/11/2026): sin pagos leídos no avisa "no cierra" (el pago ya está en el formulario).
const cargill = {
  orden_pago_cliente: "2000083106",
  facturas_pagadas: [{ tipo: "A", punto_venta: 15, numero: 11, importe_pagado: 355341.31 }],
  pagos: [
    { tipo: "retencion_iva", monto: 30835.41, certificado: "0003-2026017714" },
    { tipo: "retencion_ganancias", monto: 1393.41, certificado: "0003-2026016788" },
    { tipo: "retencion_iibb", monto: 5139.23, certificado: "B20265011" },
  ],
};
const planCargill = buildOrdenPagoPlan(cargill, [{ id: "fa11", numero: "FA 0015-00000011" }]);
assert.equal(planCargill.retenciones.length, 3);
assert.equal(planCargill.medios.length, 0);
assert.ok(!planCargill.avisos.some((a) => a.includes("no cierra")), planCargill.avisos.join(" | "));
// Con un pago leído que no cierra, avisa igual
const noCierra = buildOrdenPagoPlan({ ...cargill, pagos: [...cargill.pagos, { tipo: "transferencia", monto: 300000 }] }, [{ id: "fa11", numero: "FA 0015-00000011" }]);
assert.ok(noCierra.avisos.some((a) => a.includes("no cierra")));

console.log("OK: orden de pago repartida por factura (caso Termo Córdoba).");
