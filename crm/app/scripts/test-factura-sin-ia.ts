// Prueba de lib/factura-qr-arca.ts y lib/factura-texto.ts con datos inventados. Uso (desde crm/app): npx tsx scripts/test-factura-sin-ia.ts
// Para probar con PDF reales: scripts/test-lectura-factura-pdf.ts
import assert from "node:assert/strict";
import { leerQrArca, qrArcaComoImportacion, numeroComprobante } from "../src/lib/factura-qr-arca";
import { leerTextoFactura, importeArgentino, cuitValido, textoComoImportacion } from "../src/lib/factura-texto";

// QR de ARCA (ejemplo del manual: factura A en dólares).
const json = { ver: 1, fecha: "2026-10-13", cuit: 30712345671, ptoVta: 12, tipoCmp: 1, nroCmp: 12760, importe: 1210.5, moneda: "DOL", ctz: 1450.25, tipoDocRec: 80, nroDocRec: 20379309128, tipoCodAut: "E", codAut: 86416816526717 };
const url = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(json)).toString("base64")}`;
const q = leerQrArca(url)!;
assert.ok(q, "lee el QR");
assert.equal(q.cuitEmisor, "30712345671");
assert.equal(q.moneda, "USD");
const imp = qrArcaComoImportacion(q);
assert.equal(imp.numero_factura, "00012-00012760");
assert.equal(imp.tipo_comprobante, "FACTURA A");
assert.equal(imp.proveedor.cuit, "30-71234567-1");
assert.equal(imp.total, 1210.5);
assert.equal(imp.tipo_cambio, 1450.25);
assert.equal(imp.cae, "86416816526717");
assert.equal(leerQrArca(url.replace("afip.gob.ar", "arca.gob.ar"))?.numero, 12760, "dominio nuevo de ARCA");
assert.equal(leerQrArca("https://otro.com/?p=abc"), null);
assert.equal(leerQrArca("https://www.afip.gob.ar/fe/qr/?p=no-es-base64"), null);
const nc = leerQrArca(`https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify({ ...json, tipoCmp: 8, moneda: "PES" })).toString("base64")}`)!;
assert.equal(qrArcaComoImportacion(nc).tipo_comprobante, "NOTA DE CREDITO B");
assert.equal(qrArcaComoImportacion(nc).moneda, "ARS");
assert.equal(numeroComprobante(3, 639), "00003-00000639");

// Importes y CUIT.
assert.equal(importeArgentino("1.234.567,89"), 1234567.89);
assert.equal(importeArgentino("1,234,567.89"), 1234567.89);
assert.equal(importeArgentino("$ 822.780,00"), 822780);
assert.ok(cuitValido("20379309128") && cuitValido("30719396042") && !cuitValido("20379309127"));

// Texto con etiquetas separadas de los valores y un pedido que NO es el número de factura.
const texto = `FACTURA
A
COD. 001
CUIT: 30-71059949-8
Fecha de Inicio de Actividades: 25/07/2008
Punto de Venta:   Comp. Nro:
0003
2/9/2026
CUIT 20-37930912-8 LAZZARI AUGUSTO
PED 0001-00038532 Orden de Compra:
1,00 254.978,37 21.00% 210.725,93
IVA 21%: $
Importe Neto Gravado : $
44.252,44
210.725,93
Importe Total: $
254.978,37
Fecha de Vto. para el pago   2/10/2026
CAE N°: 86351135101492`;
const d = leerTextoFactura(texto, ["20379309128", "30719396042"], { nombreArchivo: "01 0003-00019530 20379309128.pdf" });
assert.equal(d.cuitEmisor, "30710599498");
assert.equal(d.tipoComprobante, "FACTURA A");
assert.equal(d.numero, "00003-00019530", "no toma el PED, usa el nombre del archivo");
assert.equal(d.fecha, "2026-09-02", "salta la fecha de inicio de actividades");
assert.equal(d.fechaVencimiento, "2026-10-02");
assert.equal(d.total, 254978.37);
assert.equal(d.neto, 210725.93);
assert.equal(d.ivaPorcentaje, 21);
assert.equal(d.cae, "86351135101492");
assert.equal(d.encontrados, 4);
assert.equal(textoComoImportacion(d).iva_porcentaje, 21);

// Alícuotas mezcladas (10,5 + 21): total = neto + IVA 10,5 + IVA 21.
const mezcla = leerTextoFactura("FACTURA A\nCUIT 23-12747889-9\nFecha: 08/10/2026\n0009-00003538\nImporte Neto Gravado: $738.292,81\nIVA 10.5%: $70.554,30\nIVA 21%: $13.932,89\nImporte Total: $822.780,00");
assert.equal(mezcla.total, 822780);
assert.equal(mezcla.neto, 738292.81);
assert.equal(mezcla.ivaPorcentaje, null, "varias alícuotas: no inventa un %");
assert.equal(mezcla.numero, "00009-00003538");

// Nota de crédito.
assert.equal(leerTextoFactura("NOTA DE CREDITO\nB\nCUIT 30-71234567-1").tipoComprobante, "NOTA DE CREDITO B");

console.log("test-factura-sin-ia OK");
