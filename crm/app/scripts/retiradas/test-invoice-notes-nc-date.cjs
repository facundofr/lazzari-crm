const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const facturacion = read("src/app/(crm)/facturacion/facturacion-content.tsx");
const facturaPdf = read("src/lib/factura-pdf.ts");
const pdf = read("src/lib/pdf-templates.ts");

assert.match(facturacion, /const \[ncFecha, setNcFecha\] = useState\(todayAR\(\)\)/);
assert.match(facturacion, /useFiscalDateLimits\(ncOpen && !ncManual && Boolean\(ncFactura\)/);
assert.match(facturacion, /value=\{ncFecha\}/);
assert.match(facturacion, /factura_origen_id: ncFactura\.id,\s*nota_credito_modo: ncMode,\s*fecha: ncFecha/);
assert.match(facturacion, /p_fecha: ncFecha,/); // NC manual: RPC atómica crear_nota_credito_manual_venta

assert.match(pdf, /observaciones\?: string \| null/);
assert.match(pdf, /f\.observaciones \? `<div class="obs-block">/);
assert.match(facturacion, /observaciones: f\.observaciones/);
assert.match(facturaPdf, /observaciones: factura\.observaciones/);

console.log("OK factura: la NC permite elegir fecha validada y las observaciones guardadas aparecen en el PDF.");
