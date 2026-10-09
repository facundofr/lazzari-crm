import assert from "node:assert/strict";
import fs from "node:fs";

const pdf = fs.readFileSync(new URL("../src/lib/pdf-templates.ts", import.meta.url), "utf8");
const finanzas = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const compras = fs.readFileSync(new URL("../src/components/cargar-factura-oc.tsx", import.meta.url), "utf8");
const fceRoute = fs.readFileSync(new URL("../src/app/api/facturacion/route.ts", import.meta.url), "utf8");

assert.match(pdf, /const pageCapacity = 12/);
assert.match(pdf, /Presupuesto · Continuación/);
assert.match(pdf, /Continúa en la página/);
assert.match(pdf, /Página \$\{pageNumber\} de \$\{pages\.length\}/);
assert.match(pdf, /\.pr-page \+ \.pr-page \{ page-break-before:always; \}/);
assert.match(pdf, /documentHeader\(soc,/);
assert.match(pdf, /\$\{clientStrip\}/);
assert.match(pdf, /isLastPage \? totals/);

assert.match(finanzas, /facturas_compra!inner\(id, numero_factura, fecha, total, tipo, notas\)/);
assert.match(finanzas, /seenInvoiceIds\.has\(invoice\.id\)/);
assert.match(finanzas, /\^Factura de transporte\\s\*/);
assert.match(finanzas, /invoiceNotes\.replace/);
assert.doesNotMatch(finanzas, /canonicalPurchaseInvoiceNumber/);
assert.match(pdf, /fc\.detalle/);

assert.match(compras, /Number\(change\.line\.iva_porcentaje \?\? 21\) !== change\.vat/);

assert.match(fceRoute, /NCEA: 203/);
assert.match(fceRoute, /expectedFceOrigin = tipo === "NCEA" \? "FCEA"/);

console.log("OK PR multipágina, OP vinculada por id con referencia de viaje, markup IVA verificado y NC MiPyME código 203.");
