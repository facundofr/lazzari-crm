// Prueba de lib/documento-cliente.ts. Correr desde crm/app: npx tsx scripts/test-documento-cliente.ts
import assert from "node:assert/strict";
import { digitosDocumento, esDni, esCuit, dniDentroDeCuit, textoDocumento, textoDocumentoConGuiones } from "../src/lib/documento-cliente";

assert.equal(digitosDocumento("20-37930912-8"), "20379309128");
assert.equal(digitosDocumento(null), "");

assert.equal(esDni("42293852"), true);
assert.equal(esDni("4.693.136"), true); // 7 números con puntos
assert.equal(esDni("20379309128"), false);
assert.equal(esDni("999"), false);
assert.equal(esDni(""), false);
assert.equal(esCuit("20-37930912-8"), true);
assert.equal(esCuit("42293852"), false);

assert.equal(dniDentroDeCuit("20-37930912-8"), "37930912");
assert.equal(dniDentroDeCuit("20-04693136-1"), "4693136"); // DNI de 7 sin el cero
assert.equal(dniDentroDeCuit("42293852"), null);

assert.equal(textoDocumento("42.293.852"), "DNI 42293852");
assert.equal(textoDocumento("20-37930912-8"), "20-37930912-8");
assert.equal(textoDocumento(null), "Sin CUIT/DNI");

assert.equal(textoDocumentoConGuiones("30718809718"), "CUIT 30-71880971-8");
assert.equal(textoDocumentoConGuiones("20-37930912-8"), "CUIT 20-37930912-8");
assert.equal(textoDocumentoConGuiones("42.293.852"), "DNI 42293852");
assert.equal(textoDocumentoConGuiones(""), "Sin CUIT/DNI");

console.log("test-documento-cliente OK");
