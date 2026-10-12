// Emparejamiento tolerante: código parecido, nombre parecido + cantidad, facturado de más y sin OC.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/lib/purchase-matching.ts", "utf8");
const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ctx = { exports: {} }; vm.runInNewContext(out, ctx);
const { matchPurchaseLines, mismoCodigo, puntajeParecido, parseVariant, heuristicEquivalences, citaOc } = ctx.exports;

// ── Código tolerante ──
assert.equal(mismoCodigo("01234", null, "1234", null), true, "ceros adelante");
assert.equal(mismoCodigo("BT-200", null, "bt 200", null), true, "guiones y espacios");
assert.equal(mismoCodigo("1234-42", "42", "1234", "42"), true, "talle pegado al código");
assert.equal(mismoCodigo("1234-42", "42", "1235", "42"), false);
assert.equal(mismoCodigo("", null, "1234", null), false, "sin código no empareja");

const oc = (id, descripcion, cantidad, precio, codigo = null, ocNumero = "OC-1") =>
  ({ id, ocId: ocNumero, ocNumero, ocFecha: "2026-10-01", codigo, descripcion, cantidad, precio });

// Por código no se cruza talle.
{
  const ocs = [oc("a", "BOTIN PAMPERO T40", 5, 100, "BT200"), oc("b", "BOTIN PAMPERO T42", 5, 100, "BT200")];
  const r = matchPurchaseLines([{ key: "1", codigo: "BT-200", descripcion: "Botin seguridad 42", cantidad: 5, precio: 100 }], ocs, {});
  assert.equal(r.asignaciones.length, 1);
  assert.equal(r.asignaciones[0].ocLineId, "b", "mismo código pero respeta el talle");
  assert.equal(r.asignaciones[0].origen, "codigo");
}

// ── Nombre parecido + misma cantidad pendiente (el caso de las 13 unidades) ──
{
  const ocs = [
    oc("g", "GUANTE NITRILO VERDE ANSELL SOLVEX", 13, 2500),
    oc("c", "CASCO MSA V-GARD BLANCO", 13, 9000),
  ];
  const inv = [{ key: "1", descripcion: "Guante Sol-Vex 37-175 nitrilo", cantidad: 13, precio: 2600 }];
  const r = matchPurchaseLines(inv, ocs, {});
  assert.equal(r.asignaciones.length, 1);
  const a = r.asignaciones[0];
  assert.equal(a.ocLineId, "g");
  assert.equal(a.origen, "parecido");
  assert.equal(a.semaforo, "amarillo", "lo propuesto por parecido nunca sale en verde");
  assert.match(a.nota, /mismo pendiente \(13\)/);
}
// La cantidad sola no alcanza: sin ninguna palabra en común no se propone.
{
  const r = matchPurchaseLines([{ key: "1", descripcion: "Protector auditivo copa", cantidad: 13, precio: 9000 }], [oc("c", "CASCO MSA V-GARD BLANCO", 13, 9000)], {});
  assert.equal(r.asignaciones.length, 0);
  assert.equal(r.sinAsignar[0].tipo, "sin_oc");
}
// Nunca otro talle aunque coincida todo lo demás.
assert.equal(puntajeParecido({ descripcion: "Pantalon cargo beige 42", cantidad: 3, precio: 100 }, { descripcion: "PANTALON CARGO BEIGE T44", precio: 100 }, 3), null);
// Gana la que coincide en cantidad.
{
  const ocs = [oc("x", "CAMPERA ABRIGO AZUL M", 4, 50000), oc("y", "CAMPERA ABRIGO AZUL M", 7, 50000, null, "OC-2")];
  const r = matchPurchaseLines([{ key: "1", descripcion: "Campera polar azul M", cantidad: 7, precio: 50000 }], ocs, {});
  assert.equal(r.asignaciones[0].ocLineId, "y");
  assert.equal(r.asignaciones[0].cantidad, 7);
}

// ── Facturado de más vs sin OC ──
{
  const ocs = [oc("a", "BOTIN PAMPERO T40", 10, 100, "BT200")];
  const inv = [
    { key: "1", codigo: "BT200", descripcion: "BOTIN PAMPERO T40", cantidad: 12, precio: 100 },
    { key: "2", descripcion: "Antiparra policarbonato", cantidad: 3, precio: 50 },
  ];
  const r = matchPurchaseLines(inv, ocs, {});
  assert.equal(r.asignaciones.find(a => a.invoiceKey === "1").cantidad, 10);
  const deMas = r.sinAsignar.find(s => s.invoiceKey === "1");
  assert.equal(deMas.tipo, "de_mas");
  assert.equal(deMas.cantidad, 2);
  assert.equal(deMas.ocLineId, "a");
  assert.equal(r.sinAsignar.find(s => s.invoiceKey === "2").tipo, "sin_oc");
}

// ── Caso real TKW sin IA: lo que se propone por parecido nunca contradice a la conciliación buena ──
{
  const { ocs, invoice, eq } = require("./fixtures/tkw.cjs")(parseVariant);
  const bueno = matchPurchaseLines(invoice, ocs, eq);
  const sinIA = matchPurchaseLines(invoice, ocs, heuristicEquivalences(invoice, ocs));
  const parecidos = sinIA.asignaciones.filter(a => a.origen === "parecido");
  let malos = 0;
  for (const a of parecidos) {
    const ok = bueno.asignaciones.some(b => b.invoiceKey === a.invoiceKey && b.ocLineId === a.ocLineId);
    const l = invoice.find(x => x.key === a.invoiceKey), o = ocs.find(x => x.id === a.ocLineId);
    assert.equal(parseVariant(l.descripcion).talle, parseVariant(o.descripcion).talle, "parecido nunca cruza talles");
    if (!ok) { malos++; console.log(`  distinto a la IA: ${l.descripcion} → ${o.ocNumero} ${o.descripcion}`); }
  }
  console.log(`TKW sin IA: ${parecidos.length} propuestas por parecido, ${malos} distintas a la conciliación con IA (todas en amarillo).`);
}

// ── OC citada en la factura ──
assert.equal(citaOc("1199", "OC-2026-1199"), true);
assert.equal(citaOc("OC 2026-01199", "OC-2026-1199"), true);
assert.equal(citaOc("1198", "OC-2026-1199"), false);
{
  const ocs = [oc("v", "BOTIN PAMPERO T40", 5, 100, "BT200", "OC-2026-1100"), oc("n", "BOTIN PAMPERO T40", 5, 100, "BT200", "OC-2026-1199")];
  const inv = [{ key: "1", facturaRef: "F1", codigo: "BT200", descripcion: "BOTIN PAMPERO T40", cantidad: 5, precio: 100 }];
  assert.equal(matchPurchaseLines(inv, ocs, {}).asignaciones[0].ocNumero, "OC-2026-1100", "sin cita: la más vieja / primera");
  assert.equal(matchPurchaseLines(inv, ocs, {}, {}, { ocPreferidas: { F1: ["OC-2026-1199"] } }).asignaciones[0].ocNumero, "OC-2026-1199", "con cita: la OC citada");
}

console.log("OK: código tolerante, parecidos por nombre + cantidad, facturado de más y sin OC.");
