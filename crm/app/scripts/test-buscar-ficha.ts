// Prueba rápida: npx tsx scripts/test-buscar-ficha.ts
import assert from "node:assert/strict";
import { CAMPOS_FICHA_PROVEEDOR, coincideFicha, datosDeFicha } from "../src/lib/buscar-texto";

const prov = {
  id: "8f3a-2510-uuid", razon_social: "Termo Córdoba S.A.U.", cuit: "30-71048063-6", email: "pagos@termo.com.ar", telefono: "+54 9 351 555-1234",
  cbu: "0170099220000041644211", alias_bancario: "TERMO.CBA.PAGOS", notas: "Entregar por la tarde", activo: true, limite_credito: 0,
};
const datos = datosDeFicha(prov, CAMPOS_FICHA_PROVEEDOR);
assert.ok(!datos.includes("8f3a-2510-uuid"), "el id no se busca");

assert.ok(coincideFicha("", datos));
assert.ok(coincideFicha("termo cordoba", datos), "sin tildes ni mayúsculas");
assert.ok(coincideFicha("30710480636", datos), "CUIT sin guiones");
assert.ok(coincideFicha("30-71048063-6", datos), "CUIT con guiones");
assert.ok(coincideFicha("3515551234", datos), "teléfono sin espacios ni guiones");
assert.ok(coincideFicha("555-1234", datos));
assert.ok(coincideFicha("41644211", datos), "parte del CBU");
assert.ok(coincideFicha("termo.cba", datos), "alias");
assert.ok(coincideFicha("pagos@termo", datos), "mail");
assert.ok(coincideFicha("tarde termo", datos), "varias palabras en datos distintos");
assert.ok(!coincideFicha("termo rosario", datos), "todas las palabras tienen que estar");
assert.ok(!coincideFicha("2510", datos), "los números del id no cuentan");
assert.ok(!coincideFicha("71048063 9999", datos));
// Un número no se arma pegando dos datos distintos.
assert.ok(!coincideFicha("12340170", datos));

console.log("test-buscar-ficha OK");
