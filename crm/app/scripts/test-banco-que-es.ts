// Prueba rápida: npx tsx scripts/test-banco-que-es.ts
import assert from "node:assert/strict";
import { jsonDeTexto, textoContextoQueEs, validarQueEs, type ContextoQueEs } from "../src/lib/banco-que-es";

const c: ContextoQueEs = {
  empresa: "Lazzari",
  linea: { id: "l1", fecha: "2026-11-02", concepto: "TRANSF.BANEL 930004164421182", importe: 1223987.45, cuenta: "CC EPP" },
  movimientos: [{ id: "m1", fecha: "2026-11-01", importe: 600000, texto: "Cobro Juan" }, { id: "m2", fecha: "2026-11-02", importe: 623987.45, texto: "Cobro Juan" }],
  facturas: [{ id: "f1", numero: "FA 0015-00000090", cliente: "Juan", fecha: "2026-10-10", saldo: 1223987.45 }],
  avisos: [],
  terceros: [],
};
const t = textoContextoQueEs(c);
assert.ok(t.includes("1223987.45") && t.includes("m1 |") && t.includes("f1 | FA 0015-00000090") && t.includes("(ninguno)"));

// Solo ids de las listas; tipo y confianza válidos.
const r = validarQueEs({ explicacion: "Dos cobros de Juan", tipo: "cobro", movimientos: ["m1", "m2", "inventado", "m1"], facturas: ["f1", "f9"], confianza: "alta" }, c);
assert.deepEqual(r, { explicacion: "Dos cobros de Juan", tipo: "cobro", movimientos: ["m1", "m2"], facturas: ["f1"], confianza: "alta" });
const malo = validarQueEs({ tipo: "cualquiera", confianza: "segurisimo", movimientos: "m1" }, c);
assert.equal(malo.tipo, "otro");
assert.equal(malo.confianza, "baja");
assert.deepEqual(malo.movimientos, []);
// Si salió plata, no se proponen facturas de venta.
assert.deepEqual(validarQueEs({ facturas: ["f1"] }, { ...c, linea: { ...c.linea, importe: -5 } }).facturas, []);

assert.deepEqual(jsonDeTexto("```json\n{\"a\":1}\n```"), { a: 1 });
assert.deepEqual(jsonDeTexto("Acá va: {\"a\":2} listo"), { a: 2 });

console.log("test-banco-que-es OK");
