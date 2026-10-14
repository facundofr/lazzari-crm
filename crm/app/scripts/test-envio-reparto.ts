import assert from "node:assert/strict";
import { repartirEnvio, repartoPorPR } from "../src/lib/envio-reparto";

const suma = (o: Record<string, number>) => Math.round(Object.values(o).reduce((s, v) => s + v, 0) * 100) / 100;

// 90.000 entre OC de 500.000 / 300.000 / 100.000 → 50.000 / 30.000 / 10.000
const r = repartirEnvio(90000, [{ id: "a", peso: 500000 }, { id: "b", peso: 300000 }, { id: "c", peso: 100000 }]);
assert.deepEqual(r, { a: 50000, b: 30000, c: 10000 });

// Centavos: nunca se pierde ni se inventa plata (100 entre 3 iguales = 33,34 + 33,33 + 33,33)
const t = repartirEnvio(100, [{ id: "a", peso: 1 }, { id: "b", peso: 1 }, { id: "c", peso: 1 }]);
assert.equal(suma(t), 100);
assert.ok(Object.values(t).every((v) => v === 33.33 || v === 33.34));

// Una sola OC se lleva todo; sin pesos reparte parejo; sin envío da 0
assert.deepEqual(repartirEnvio(1234.56, [{ id: "a", peso: 10 }]), { a: 1234.56 });
assert.equal(suma(repartirEnvio(10, [{ id: "a", peso: 0 }, { id: "b", peso: 0 }])), 10);
assert.deepEqual(repartirEnvio(0, [{ id: "a", peso: 5 }]), { a: 0 });
assert.deepEqual(repartirEnvio(50, []), {});

// Varias OC del mismo PR se suman; OC sin PR queda aparte (no se pierde: se informa)
const g = repartoPorPR({ a: 50000, b: 30000, c: 10000 }, { a: "pr1", b: "pr1", c: null });
assert.deepEqual(g.porPR, { pr1: 80000 });
assert.equal(g.sinPR, 10000);
console.log("OK test-envio-reparto");
