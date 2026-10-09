const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const parserSource = fs.readFileSync(
  path.join(__dirname, "../src/app/api/parse-factura-compra/route.ts"),
  "utf8",
);
const formSource = fs.readFileSync(
  path.join(__dirname, "../src/components/cargar-factura-oc.tsx"),
  "utf8",
);

test("el lector conserva el código/SKU de cada renglón", () => {
  assert.match(parserSource, /"codigo": "código, SKU o referencia impresa del artículo/);
  assert.match(parserSource, /Extraé en "codigo" el código principal del producto/);
  assert.match(parserSource, /no descartes columnas de color, talle, medida, presentación ni referencias secundarias/);
});

test("la carga conserva el código extraído para conciliarlo con la OC", () => {
  assert.match(formSource, /codigo: it\.codigo \|\| ""/);
  assert.match(formSource, />Código<\/th>/);
  assert.match(formSource, /codigo: e\.target\.value/);
  assert.match(formSource, /comparison\.item\.codigo \? `\[\$\{comparison\.item\.codigo\}\] ` : ""/);
});
