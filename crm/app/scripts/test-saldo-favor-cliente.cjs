const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync("src/lib/saldo-favor-cliente.ts", "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(output, context);
const { fuentesSaldoFavorCliente, repartirSaldoFavorCliente, faltaSegunOrden, cubreConSaldoFavor } = context.exports;

// Solo cuentan los ajustes de crédito sin factura y sin anular.
const fuentes = fuentesSaldoFavorCliente([
  { id: "sf", monto: "1242839.98", fecha: "2026-10-09", ajuste_sentido: "credito", factura_id: null, anulado: false },
  { id: "deb", monto: "100", fecha: "2026-10-01", ajuste_sentido: "debito", factura_id: null },
  { id: "anu", monto: "100", fecha: "2026-10-01", ajuste_sentido: "credito", anulado: true },
  { id: "atado", monto: "100", fecha: "2026-10-01", ajuste_sentido: "credito", factura_id: "x" },
]);
assert.equal(fuentes.length, 1);
assert.equal(fuentes[0].monto, 1242839.98);

// Caso real Del Sol: la OP 18722 paga la FA 68 por 1.836.717,86 (debe 3.079.557,84).
const facturas = [
  { id: "65", numero: "FA 0015-00000065", fecha: "2026-10-13", saldo: 253387.55 },
  { id: "67", numero: "FA 0015-00000067", fecha: "2026-10-14", saldo: 1206073.43 },
  { id: "68", numero: "FA 0015-00000068", fecha: "2026-10-15", saldo: 3079557.84 },
];
const falta = faltaSegunOrden(facturas, [
  { docId: "65", importe: 253387.55 }, { docId: "67", importe: 1206073.43 }, { docId: "68", importe: 1836717.86 },
]);
assert.equal(Object.keys(falta).join(), "68");
assert.equal(falta["68"], 1242839.98);
const ap = repartirSaldoFavorCliente(fuentes, facturas, falta);
assert.equal(ap.length, 1);
assert.equal(ap[0].factura_id, "68");
assert.equal(ap[0].monto, 1242839.98);

// Sin OP: va a la factura más nueva; si sobra, sigue con la anterior; nunca más de lo que debe.
const chico = repartirSaldoFavorCliente([{ id: "a", monto: 300, fecha: "2026-01-01", descripcion: "" }],
  [{ id: "v", numero: "FA 1", fecha: "2026-01-01", saldo: 1000 }, { id: "n", numero: "FA 2", fecha: "2026-02-01", saldo: 200 }]);
assert.equal(JSON.stringify(chico.map((a) => [a.factura_id, a.monto])), JSON.stringify([["n", 200], ["v", 100]]));

// Dos saldos a favor: se usa primero el más viejo.
const dos = repartirSaldoFavorCliente([{ id: "viejo", monto: 50, fecha: "2026-01-01", descripcion: "" }, { id: "nuevo", monto: 80, fecha: "2026-02-01", descripcion: "" }],
  [{ id: "f", numero: "FA 1", fecha: "2026-03-01", saldo: 100 }]);
assert.equal(JSON.stringify(dos.map((a) => [a.movimiento_id, a.monto])), JSON.stringify([["viejo", 50], ["nuevo", 50]]));

// Arreglo 24: se confirma con $ 0 solo si el saldo a favor cubre todo lo tildado y no hay medios ni retenciones.
const cubre = (aplicado, deuda, medios = 0, retenciones = 0) => cubreConSaldoFavor({ aplicado, deuda, medios, retenciones });
assert.equal(cubre(100, 100), true);
assert.equal(cubre(1242839.98, 1242839.98), true);
assert.equal(cubre(99.99, 100), false); // cubre solo una parte: pide plata, como antes
assert.equal(cubre(100, 100, 50), false); // con plata va por el cobro de siempre
assert.equal(cubre(100, 100, 0, 10), false); // con retenciones también
assert.equal(cubre(0, 0), false); // sin "Aplicar" tildado
const todo = repartirSaldoFavorCliente([{ id: "sf", monto: 9630, fecha: "2026-10-05", descripcion: "" }], [{ id: "f", numero: "FA 1", fecha: "2026-10-20", saldo: 9000 }]);
assert.equal(cubre(todo.reduce((s, a) => s + a.monto, 0), 9000), true); // sobran $ 630 a favor

console.log("OK: saldo a favor del cliente repartido (caso Del Sol OP 18722) y cobro solo con saldo a favor.");
