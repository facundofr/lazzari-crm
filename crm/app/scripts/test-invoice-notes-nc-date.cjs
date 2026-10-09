const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const facturacion = read("src/app/(crm)/facturacion/facturacion-content.tsx");
const ventas = read("src/app/(crm)/ventas/page.tsx");
const pdf = read("src/lib/pdf-templates.ts");

assert.match(facturacion, /const \[ncFecha, setNcFecha\] = useState\(todayAR\(\)\)/);
assert.match(facturacion, /useFiscalDateLimits\(ncOpen && !ncManual && Boolean\(ncFactura\)/);
assert.match(facturacion, /value=\{ncFecha\}/);
assert.match(facturacion, /factura_origen_id: ncFactura\.id,\s*fecha: ncFecha/);
assert.match(facturacion, /fecha: ncFecha,\s*cae: null/);

assert.match(pdf, /observaciones\?: string \| null/);
assert.match(pdf, /f\.observaciones \? `<div class="obs-block">/);
assert.match(facturacion, /observaciones: f\.observaciones/);
assert.match(ventas, /observaciones: factura\.observaciones/);

console.log("OK factura: la NC permite elegir fecha validada y las observaciones guardadas aparecen en el PDF.");
