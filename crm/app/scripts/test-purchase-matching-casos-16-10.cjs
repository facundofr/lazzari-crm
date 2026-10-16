// Casos reales 16/10/2026: factura Mariana abierta por talle y factura Fujiwara con el código dentro de la descripción de la OC.
// Uso (desde crm/app): node scripts/test-purchase-matching-casos-16-10.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/lib/purchase-matching.ts", "utf8");
const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = { exports: {} }; vm.runInNewContext(out, ctx);
const { matchPurchaseLines, heuristicEquivalences, codigoEnDescripcion } = ctx.exports;
const correr = (inv, ocs) => matchPurchaseLines(inv, ocs, heuristicEquivalences(inv, ocs));

// ── Mariana 0012-00012783 contra OC-2026-1247 (un renglón sin talle de 35) ──
const talles = [39, 40, 41, 42, 43, 44], cant = [3, 8, 6, 10, 1, 3];
const mariana = talles.map((t, i) => ({ key: `m${t}`, codigo: `111040${t}`, descripcion: `BOT.PR.BOX.NGRO PCV NVA CP PRUSIANO NRO ${t}`, cantidad: cant[i], precio: 27287 }));
const oc1247 = [{ id: "oc1", ocId: "A", ocNumero: "OC-2026-1247", ocFecha: "2026-10-15", codigo: null, descripcion: "PRUSIANO · PVC · Negro", cantidad: 35, precio: 25922.84 }];
let r = correr(mariana, oc1247);
assert.equal(r.sinAsignar.length, 0, "ningún talle queda sin OC");
assert.equal(r.asignaciones.length, 6);
assert.ok(r.asignaciones.every(a => a.ocLineId === "oc1" && a.semaforo === "amarillo"), "atados al renglón, en amarillo (precio distinto y faltan 4)");
assert.match(r.asignaciones[0].nota, /vienen 31 de 35/);
assert.deepEqual(r.pendientesOc.map(p => p.cantidad), [4]);
// Si vienen los 35 al mismo precio, es verde.
const completa = mariana.map(l => ({ ...l, precio: 25922.84, cantidad: l.key === "m44" ? 7 : l.cantidad }));
r = correr(completa, oc1247);
assert.ok(r.asignaciones.every(a => a.semaforo === "verde"), "35 de 35 al mismo precio: verde");
assert.match(r.asignaciones[0].nota, /la cantidad coincide \(35\)/);
// Un solo talle no es desglose: no se ata.
r = correr([mariana[0]], oc1247);
assert.equal(r.asignaciones.filter(a => a.origen === "equivalencia").length, 0);
// Otro artículo sin palabras en común: no se ata.
r = correr(mariana, [{ ...oc1247[0], descripcion: "GUANTE NITRILO AZUL" }]);
assert.equal(r.asignaciones.filter(a => a.origen === "equivalencia").length, 0);

// ── Fujiwara 0002-00002816 contra OC-2026-1252 (BOTIN ... 4047BNFS2400 x20) ──
assert.equal(codigoEnDescripcion("4047BNFS24", "BOTIN DE SEGURIDAD FUJIWARA 4047BNFS2400"), true);
assert.equal(codigoEnDescripcion("4047BNFS24", "BOTIN DE SEGURIDAD FUJIWARA 4047BNFS2"), false);
assert.equal(codigoEnDescripcion("12345", "GUANTE 12345"), false, "solo números: no alcanza");
assert.equal(codigoEnDescripcion("AB1", "AB1 CASCO"), false, "muy corto");
const fuji = [
  { key: "f1", codigo: "4047BNFS24", descripcion: "Botín Bidensidad Cuero Descarne Graneado con punte", cantidad: 12, precio: 31030 },
  { key: "f2", codigo: "4047BNFS24", descripcion: "Botín Bidensidad Cuero Descarne Graneado con punte", cantidad: 4, precio: 31030 },
  { key: "f3", codigo: "4047bnfs24", descripcion: "4047bnfs24", cantidad: 4, precio: 31030 },
];
const oc1252 = [{ id: "oc2", ocId: "B", ocNumero: "OC-2026-1252", ocFecha: "2026-10-15", codigo: null, descripcion: "BOTIN DE SEGURIDAD FUJIWARA 4047BNFS2400", cantidad: 20, precio: 31030 }];
r = correr(fuji, oc1252);
assert.equal(r.sinAsignar.length, 0);
assert.ok(r.asignaciones.every(a => a.origen === "codigo" && a.semaforo === "verde"));
assert.equal(r.pendientesOc.length, 0, "20 de 20");

// ── Segufer (factura de prueba): talle "T - XL" de la OC y diferencia de precio chica en USD ──
const { parseVariant, samePrice } = ctx.exports;
assert.equal(parseVariant("MAMELUCO TYVEK DUPONT 500 XPERT T - XL - BLANCO").talle, "XL");
assert.equal(parseVariant("MAMELUCO TYVEK DUPONT 500 XPERT T - XXXL - BLANCO").talle, "3XL");
assert.equal(parseVariant("REMERA T-SHIRT NEGRA").talle, null);
assert.equal(samePrice(5.95, 5.7), false, "USD 5,95 contra 5,70 no es el mismo precio");
assert.equal(samePrice(27287.4, 27287), true);
assert.equal(samePrice(300.5, 300), true, "en pesos se sigue tolerando menos de $1");

// ── Flete: nunca se cruza con un artículo de la OC, aunque la IA lo diga ──
const { esEnvio } = ctx.exports;
for (const d of ["FLETE", "Envío a domicilio", "COSTO DE ENVIO", "TRANSP. A OBRA", "Gastos de logística", "Despacho OCA"]) assert.ok(esEnvio(d), d);
for (const d of ["ANTEPARRA TRANSPARENTE", "LENTE CLARO TRANSPARENTE", "BOTIN BOCA DE LOBO", "GUANTE NITRILO"]) assert.ok(!esEnvio(d), d);
const ocBotin = [{ id: "b1", ocId: "B", ocNumero: "OC-2026-1257", ocFecha: "2026-10-15", codigo: null, descripcion: "BOTIN DE SEGURIDAD PUNTERA", cantidad: 1, precio: 15000 }];
const flete = [{ key: "fl", facturaRef: "0001-1", codigo: null, descripcion: "FLETE", cantidad: 1, precio: 15000 }];
r = matchPurchaseLines(flete, ocBotin, { [parseVariant("FLETE").producto]: [parseVariant(ocBotin[0].descripcion).producto] }, {}, { ocPreferidas: { "0001-1": ["B"] } });
assert.equal(r.asignaciones.length, 0, "el flete no se ata al botín");
assert.equal(r.sinAsignar[0].tipo, "sin_oc");

console.log("OK: Mariana por talle (31 de 35, amarillo) y Fujiwara por código en la descripción (20 de 20, verde).");
