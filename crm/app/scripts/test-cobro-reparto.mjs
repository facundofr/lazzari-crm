// Prueba de src/lib/cobro-reparto.ts — correr con: npx tsx scripts/test-cobro-reparto.mjs
import assert from "node:assert/strict";
import { repartirCobro, ordenarParaCobro, avisoDiferenciaCobro, facturasParaRegistrar } from "../src/lib/cobro-reparto.ts";

const fmt = (n) => `$${n.toFixed(2)}`;

// Caso real Del Sol (eCheq 3968): 5 facturas por $6.463.222,05, cheque por $6.210.728,30 → faltan $252.493,75.
const delSol = [
  { id: "a", numero: "FA 16-17", fecha: "2026-09-26", saldo: 1000000 },
  { id: "b", numero: "FA 16-18", fecha: "2026-09-25", saldo: 1370733.34 },
  { id: "c", numero: "FA 16-16", fecha: "2026-09-24", saldo: 2000000 },
  { id: "d", numero: "FA 15-45", fecha: "2026-09-10", saldo: 1092488.71 },
  { id: "e", numero: "FA 15-54", fecha: "2026-09-29", saldo: 1000000 },
];
const r = repartirCobro(delSol, 6210728.30);
assert.deepEqual(r.filas.map((f) => f.numero), ["FA 15-45", "FA 16-16", "FA 16-18", "FA 16-17", "FA 15-54"]);
assert.equal(r.falta, 252493.75);
assert.equal(r.sobra, 0);
assert.equal(r.filas[4].aplicado, 747506.25);
assert.equal(r.filas[4].queda, 252493.75);
assert.ok(r.filas.slice(0, 4).every((f) => f.queda === 0));
assert.match(avisoDiferenciaCobro(r, fmt), /Faltan \$252493\.75/);
assert.match(avisoDiferenciaCobro(r, fmt), /FA 15-54 queda con saldo \$252493\.75/);

// Lo que va a la base: con faltante, cada factura con lo que le toca; la base reparte en proporción → queda igual.
const pago = facturasParaRegistrar(r);
assert.deepEqual(pago.map((f) => f.saldo), [1092488.71, 2000000, 1370733.34, 1000000, 747506.25]);
// Simulación de la función de la base (proporción + resto a la última).
const total = 6210728.30, sumaSaldo = pago.reduce((s, f) => s + f.saldo, 0);
let acum = 0;
const aplicadoBase = pago.map((f, i) => { const a = i === pago.length - 1 ? Math.round((total - acum) * 100) / 100 : Math.round(total * (f.saldo / sumaSaldo) * 100) / 100; acum += a; return a; });
assert.deepEqual(aplicadoBase, [1092488.71, 2000000, 1370733.34, 1000000, 747506.25]);
// Facturas que no reciben nada no se mandan.
assert.deepEqual(facturasParaRegistrar(poco0()).map((f) => f.id), ["1"]);
function poco0() { return repartirCobro([{ id: "1", numero: "A", fecha: "2026-01-01", saldo: 100 }, { id: "2", numero: "B", fecha: "2026-01-02", saldo: 100 }], 50); }

// Justo: sin diferencia, sin aviso.
const justo = repartirCobro(delSol, 6463222.05);
assert.equal(justo.falta, 0);
assert.equal(justo.sobra, 0);
assert.equal(avisoDiferenciaCobro(justo, fmt), "");

// De más: sobra a favor del cliente.
const deMas = repartirCobro([{ id: "x", numero: "FA 1-1", fecha: "2026-10-01", saldo: 100 }], 150.5);
assert.equal(deMas.sobra, 50.5);
assert.equal(deMas.falta, 0);
assert.match(avisoDiferenciaCobro(deMas, fmt), /saldo a favor/);

// Pagó tan poco que dos facturas quedan con saldo.
const poco = repartirCobro([{ id: "1", numero: "A", fecha: "2026-01-01", saldo: 100 }, { id: "2", numero: "B", fecha: "2026-01-02", saldo: 100 }], 50);
assert.deepEqual(poco.filas.map((f) => f.queda), [50, 100]);
assert.equal(poco.falta, 150);

// Mismo día: por número (16-9 antes que 16-10).
assert.deepEqual(ordenarParaCobro([{ fecha: "2026-01-01", numero: "FA 16-10" }, { fecha: "2026-01-01", numero: "FA 16-9" }]).map((f) => f.numero), ["FA 16-9", "FA 16-10"]);

console.log("cobro-reparto OK");
