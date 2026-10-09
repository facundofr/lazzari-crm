// Caso real TKW: facturas A 00002-00036697 y 00036698 contra OC 1187, 1188, 1192, 1199 y 1204.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/lib/purchase-matching.ts", "utf8");
const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = { exports: {} }; vm.runInNewContext(out, ctx);
const { parseVariant, matchPurchaseLines, heuristicEquivalences } = ctx.exports;

// ── Talles ──
const t = d => parseVariant(d).talle;
assert.equal(t("PANTALON CARGO ELASTIZAZDO BEIGE - PAMPERO - TALLE 40"), "40");
assert.equal(t("Pampero Pantalón Cargo Fit Ela Beige 40"), "40");
assert.equal(t("PANTALON CARGO RIPSTOP RECTO T38"), "38");
assert.equal(t("Pampero Remera M/C Gris Mel. XL/MG"), "XL");
assert.equal(t("Pampero Remera M/C Gris Mel. M/M"), "M");
assert.equal(t("Pampero Remera M/C Gris Mel. 3XL/2MG"), "3XL");
assert.equal(t("REMERA MANGA CORTA ALGODON PAMPERO TM"), "M");
assert.equal(t("REMERA MANGA CORTA ALGODON PAMPERO T4L"), "4XL");
assert.equal(t("CAMISA OXFORD CELESTE - PAMPERO (MUJER) - TALLE M (SIN BORDADO)"), "M");
assert.equal(t("Pampero Camisa Oxford H. m/l Celeste XL/MG"), "XL");
assert.equal(t("CAMISA CAIRO UV BEIGE - PAMPERO - TALLE S"), "S");
assert.equal(parseVariant("Pampero Camisa Oxford Dama Celeste L").genero, "F");
assert.equal(parseVariant("CAMISA OXFORD CELESTE - PAMPERO (HOMBRE) - TALLE XL").genero, "M");
assert.equal(parseVariant("Pampero Camisa Oxford H. m/l Celeste XL/MG").genero, "M");

const { ocs, invoice, f97, f98, eq } = require("./fixtures/tkw.cjs")(parseVariant);

function verificar(r, etiqueta) {
  const ocsCompletas = [...r.ocsCompletas].sort();
  assert.deepEqual(ocsCompletas, ["1187", "1188", "1192", "1204"], `${etiqueta}: OC completas`);
  assert.deepEqual([...r.ocsParciales], ["1199"], `${etiqueta}: OC parciales`);
  assert.equal(r.sinAsignar.length, 0, `${etiqueta}: líneas sin asignar ${JSON.stringify(r.sinAsignar)}`);
  assert.equal(r.pendientesOc.length, 1);
  assert.match(ocs.find(o => o.id === r.pendientesOc[0].ocLineId).descripcion, /T58/);
  assert.equal(r.pendientesOc[0].cantidad, 2);
  // Camisa Oxford H. XL × 4 repartida 2 a OC 1188 y 2 a OC 1192.
  const xl = invoice.find(l => l.codigo === "P15HCEXL").key;
  assert.equal(JSON.stringify(r.asignaciones.filter(a => a.invoiceKey === xl).map(a => `${a.ocNumero}:${a.cantidad}`).sort()), JSON.stringify(["1188:2", "1192:2"]));
  // Diferencias de precio (neto) por grupo.
  const dif = (filtro) => Math.round(r.asignaciones.filter(filtro).reduce((s, a) => s + a.diferencia, 0) * 100) / 100;
  const desc = a => invoice.find(l => l.key === a.invoiceKey).descripcion;
  assert.equal(dif(a => a.ocNumero === "1187" && /Mameluco/.test(desc(a))), -65470.44);
  assert.equal(dif(a => /Oxford Dama/.test(desc(a))), 40476);
  assert.equal(dif(a => a.ocNumero === "1204" && /Cairo/.test(desc(a))), 1080);
  assert.equal(dif(a => a.ocNumero === "1199" && /Mameluco/.test(desc(a))), 102886.52);
  assert.ok(Math.abs(dif(a => a.ocNumero === "1199" && !/Mameluco/.test(desc(a))) - 104401.6) < 0.2);
  // Líneas idénticas en verde, sin intervención.
  const verdes = r.asignaciones.filter(a => a.semaforo === "verde");
  assert.ok(verdes.every(a => Math.abs(a.precioFactura - a.precioOc) < 1));
  assert.ok(verdes.some(a => /Ripstop/.test(desc(a)) && a.ocNumero === "1187"));
  return r;
}

const r1 = verificar(matchPurchaseLines(invoice, ocs, eq), "facturas juntas");
// Cargando primero la 36698 y después la 36697 debe dar lo mismo.
verificar(matchPurchaseLines([...f98, ...f97], ocs, eq), "orden inverso");

// Sin IA: la similitud de palabras debe resolver la mayoría y nunca cruzar talles.
const h = heuristicEquivalences(invoice, ocs);
const rh = matchPurchaseLines(invoice, ocs, h);
for (const a of rh.asignaciones) {
  const l = invoice.find(x => x.key === a.invoiceKey), o = ocs.find(x => x.id === a.ocLineId);
  assert.equal(parseVariant(l.descripcion).talle, parseVariant(o.descripcion).talle, "nunca cruza talles");
}
const asignadas = rh.asignaciones.reduce((s, a) => s + a.cantidad, 0), total = invoice.reduce((s, l) => s + l.cantidad, 0);
console.log(`Sin IA (solo similitud): ${asignadas}/${total} unidades asignadas.`);

console.log(`OK: caso TKW conciliado — ${r1.asignaciones.length} asignaciones, OC 1187/1188/1192/1204 completas, OC 1199 parcial (mameluco T58 × 2).`);

// ── Agregados e ignífugo ──
{
  const { articleAttributes } = ctx.exports;
  assert.equal(JSON.stringify(articleAttributes("CAMISA OXFORD (MUJER) TALLE M (SIN BORDADO)").agregados), "[]");
  assert.equal(JSON.stringify(articleAttributes("Mameluco grafa c/ cinta reflectiva T50").agregados), '["reflectivo"]');
  assert.equal(articleAttributes("Camisa ignífuga Nomex T40").ignifugo, true);
  const oc = [
    { id: "a", ocId: "A", ocNumero: "OC-1", ocFecha: "2026-09-01", descripcion: "MAMELUCO GRAFA AZUL CON REFLECTIVO T50", cantidad: 2, precio: 100 },
    { id: "b", ocId: "A", ocNumero: "OC-1", ocFecha: "2026-09-01", descripcion: "CAMISA IGNIFUGA AZUL T40", cantidad: 1, precio: 100 },
  ];
  const inv = [
    { key: "1", descripcion: "Mameluco Grafa Azul 50", cantidad: 2, precio: 100 },
    { key: "2", descripcion: "Camisa Azul 40", cantidad: 1, precio: 100 },
  ];
  const r = matchPurchaseLines(inv, oc, { "mameluco grafa azul": ["mameluco grafa azul con reflectivo"], "camisa azul": ["camisa ignifuga azul"] });
  const m = r.asignaciones.find(a => a.invoiceKey === "1");
  assert.equal(m.semaforo, "amarillo", "agregado faltante → amarillo");
  assert.match(m.nota, /reflectivo/);
  assert.equal(r.asignaciones.some(a => a.invoiceKey === "2"), false, "ignífugo distinto nunca se empareja");
  console.log("OK: agregados en amarillo con nota, ignífugo distinto no se empareja.");
}
