import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/app/(crm)/presupuestos/page.tsx", import.meta.url), "utf8");
const salesSource = fs.readFileSync(new URL("../src/app/(crm)/ventas/page.tsx", import.meta.url), "utf8");

// Regresión real de PR-2026-1151: $133.940 era el precio confirmado. Volver a
// calcularlo desde costo + markup redondeado produce $133.941,03.
const confirmedPrice = 133_940;
const cost = 92_100;
const roundedMarkup = 45.43;
const reconstructedPrice = Number((cost * (1 + roundedMarkup / 100)).toFixed(2));
assert.equal(reconstructedPrice, 133_941.03);
assert.notEqual(reconstructedPrice, confirmedPrice);

assert.match(source, /options: \{ preserveItemPrices\?: boolean \} = \{\}/);
assert.match(source, /options\.preserveItemPrices \? p\.items : p\.items\.map/);
assert.match(source, /fetchCotizBna\("divisas", undefined, \{ preserveItemPrices: true \}\)/);
assert.match(source, /const pv = Number\(it\.precio_venta\) \|\| 0/);
assert.match(source, /precio_venta: pv/);
assert.match(salesSource, /precioNeto = it\.precio_venta/);

console.log("OK presupuesto: editar o facturar conserva el precio de venta exacto confirmado.");
