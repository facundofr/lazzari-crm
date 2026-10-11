// npx tsx scripts/test-tipos-movimiento.ts
import assert from "node:assert/strict";
import { clasificarMovimiento, resumirCaja, esCobroDeCliente, sentidoAjuste } from "../src/lib/tipos-movimiento";

const C = "cli-1";
const P = "prov-1";

// Cobros de clientes por cualquier medio = ingreso
for (const tipo of ["cobro", "transferencia", "efectivo", "tarjeta", "cheque_recibido", "echeq", "deposito"]) {
  assert.equal(clasificarMovimiento({ tipo, cliente_id: C }), "ingreso", tipo);
}
// Retenciones que nos hacen los clientes: crédito fiscal, no egreso
for (const tipo of ["retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"]) {
  assert.equal(clasificarMovimiento({ tipo, cliente_id: C }), "retencion_sufrida", tipo);
  assert.equal(clasificarMovimiento({ tipo, proveedor_id: P }), "egreso", tipo);
}
// Pagos a proveedores
assert.equal(clasificarMovimiento({ tipo: "pago", proveedor_id: P }), "egreso");
assert.equal(clasificarMovimiento({ tipo: "cheque_emitido", proveedor_id: P }), "egreso");
assert.equal(clasificarMovimiento({ tipo: "transferencia", proveedor_id: P }), "egreso");
// Pago de gasto sin proveedor
assert.equal(clasificarMovimiento({ tipo: "pago" }), "egreso");
// Ajustes: nuevos y viejos (cobro/pago con prefijo)
assert.equal(clasificarMovimiento({ tipo: "ajuste", cliente_id: C }), "ajuste");
assert.equal(clasificarMovimiento({ tipo: "cobro", cliente_id: C, descripcion: "[Ajuste manual] redondeo" }), "ajuste");
assert.equal(clasificarMovimiento({ tipo: "pago", proveedor_id: P, descripcion: "[Ajuste manual] x" }), "ajuste");
// Anulados y aplicaciones de NC no mueven plata
assert.equal(clasificarMovimiento({ tipo: "cobro", cliente_id: C, anulado: true }), "neutro");
assert.equal(clasificarMovimiento({ tipo: "pago", proveedor_id: P, nota_credito_compra_id: "nc" }), "neutro");
// Transferencia sin entidad: no se sabe el sentido
assert.equal(clasificarMovimiento({ tipo: "transferencia" }), "neutro");

assert.equal(esCobroDeCliente({ tipo: "transferencia", cliente_id: C }), true);
assert.equal(esCobroDeCliente({ tipo: "retencion_iva", cliente_id: C }), false);
assert.equal(esCobroDeCliente({ tipo: "cobro", cliente_id: C, descripcion: "[Ajuste manual] a" }), false);

const r = resumirCaja([
  { tipo: "transferencia", cliente_id: C, monto: 1_000_000 },
  { tipo: "efectivo", cliente_id: C, monto: 500 },
  { tipo: "retencion_ganancias", cliente_id: C, monto: 300 },
  { tipo: "pago", proveedor_id: P, monto: 200 },
  { tipo: "retencion_ganancias", proveedor_id: P, monto: 20 },
  { tipo: "ajuste", cliente_id: C, monto: 9999 },
  { tipo: "cobro", cliente_id: C, monto: 77, anulado: true },
]);
assert.deepEqual(r, { ingresos: 1_000_500, egresos: 220, retencionesSufridas: 300, ajustes: 9999 });
// Sentido de los ajustes manuales (nuevos y viejos)
assert.equal(sentidoAjuste({ tipo: "ajuste", ajuste_sentido: "credito" }), "credito");
assert.equal(sentidoAjuste({ tipo: "ajuste", ajuste_sentido: "debito" }), "debito");
assert.equal(sentidoAjuste({ tipo: "cobro", descripcion: "[Ajuste manual] a" }), "credito");
assert.equal(sentidoAjuste({ tipo: "pago", descripcion: "[Ajuste manual] b" }), "debito");
assert.equal(sentidoAjuste({ tipo: "ajuste" }), null); // descuento del cobro masivo: no es ajuste de CC
assert.equal(sentidoAjuste({ tipo: "cobro", descripcion: "Cobro FC 1" }), null);

console.log("OK tipos-movimiento");
