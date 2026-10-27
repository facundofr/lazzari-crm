import assert from "node:assert/strict";
import { textoCobro, textoOP, textoRecibo } from "../src/lib/cartel-guardado";

assert.equal(textoRecibo([1040]), "Recibo N° 1040 registrado");
assert.equal(textoRecibo([]), "Recibo registrado", "sin número: el cartel sale igual");
assert.equal(textoRecibo([1041, 1040]), "Recibos N° 1040 y 1041 registrados", "ordena y une");
assert.equal(textoRecibo([1042, 1040, 1041]), "Recibos N° 1040, 1041 y 1042 registrados");
assert.equal(textoRecibo([1040, 1040]), "Recibo N° 1040 registrado", "no repite");
assert.equal(textoRecibo([Number.NaN]), "Recibo registrado", "un número roto no se imprime");

assert.equal(textoCobro([1040], 1), "Recibo N° 1040 registrado · 1 factura");
assert.equal(textoCobro([1040], 3), "Recibo N° 1040 registrado · 3 facturas");
assert.equal(textoCobro([], 0), "Recibo registrado");

assert.equal(textoOP("OP-000091", false), "OP-000091 guardada");
assert.equal(textoOP("OP-000091", true), "OP-000091 guardada · ahora el mail al proveedor");
assert.equal(textoOP("", false), "OP guardada");

console.log("test-cartel-guardado OK");
