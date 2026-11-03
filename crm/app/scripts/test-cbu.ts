// Prueba rápida: npx tsx scripts/test-cbu.ts
import assert from "node:assert/strict";
import { cambiosBancarios, cbuNuevoDelComprobante, cbuValido, datosBancariosDeMails, proponerCbu, remitenteDeFicha, type FichaBancaria } from "../src/lib/cbu";

// Dígitos verificadores (CBU real de la ficha de BMS Building Management System SRL).
assert.ok(cbuValido("0070037520000043301748"));
assert.ok(cbuValido("0070037-5 20000043301748"), "con guiones y espacios");
assert.ok(!cbuValido("0070037520000043301749"), "último dígito mal");
assert.ok(!cbuValido("0070037620000043301748"), "primer verificador mal");
assert.ok(!cbuValido("007003752000004330174"), "21 dígitos");
assert.ok(!cbuValido("0000000000000000000000"));

// Remitente de la ficha.
assert.ok(remitenteDeFicha("Pagos <pagos@bms.com.ar>", ["ventas@bms.com.ar"]), "mismo dominio");
assert.ok(!remitenteDeFicha("<juan@gmail.com>", ["pedro@gmail.com"]), "gmail: tiene que ser la misma dirección");
assert.ok(remitenteDeFicha("<juan@gmail.com>", ["Juan@Gmail.com"]));
assert.ok(!remitenteDeFicha("<pagos@otra.com>", ["ventas@bms.com.ar"]));

const filas = [
  { id: "m1", fecha_mail: "2026-11-01T10:00:00Z", remitente: "Facturación <fact@bms.com.ar>", asunto: "Factura A 0003-00001234",
    datos: { factura: { emisor: "BMS", cuit: "33-71446094-9", cbu: "0070037520000043301748", alias: "BMS.GALICIA.PESOS", banco: "Galicia", titular_cuenta: "BMS SRL", cuit_titular: "33714460949" } } },
  { id: "m2", fecha_mail: "2026-11-02T10:00:00Z", remitente: "<pagos@cliente.com>", asunto: "Aviso de pago",
    datos: { pago: { direccion: "recibido", cliente_cuit: "30-50000000-1", cuenta_origen: { cbu: "0070037520000043301748", titular: "Cliente SA", cuit_titular: "30500000001" } } } },
  { id: "m3", fecha_mail: "2026-11-02T10:00:00Z", remitente: "<x@y.com>", asunto: "Sin datos", datos: { factura: { emisor: "Z", cuit: "1" } } },
];
const datos = datosBancariosDeMails(filas);
assert.equal(datos.length, 2);
assert.deepEqual(datos.map((d) => d.tipo), ["proveedor", "cliente"]);

const ficha = (x: Partial<FichaBancaria>): FichaBancaria => ({ id: "p1", tipo: "proveedor", nombre: "BMS", cuit: "33-71446094-9", cbu: null, correos: ["ventas@bms.com.ar"], ...x });
{
  const r = proponerCbu(datos, [ficha({}), ficha({ id: "c1", tipo: "cliente", nombre: "Cliente SA", cuit: "30500000001", correos: ["compras@cliente.com"] })]);
  assert.deepEqual(r.propuestas.map((p) => [p.ficha.id, p.estado]), [["c1", "nuevo"], ["p1", "nuevo"]]);
}
// Ya lo tiene: no se propone. Otro CBU en la ficha: "distinto".
assert.equal(proponerCbu([datos[0]], [ficha({ cbu: "0070037520000043301748" })]).propuestas.length, 0);
assert.equal(proponerCbu([datos[0]], [ficha({ cbu: "2850590940090418135201" })]).propuestas[0].estado, "distinto");
// Descartes: titular con otro CUIT, sin CUIT del titular, remitente ajeno, CBU mal, CUIT que no es de ninguna ficha.
const motivo = (cambio: Partial<typeof datos[0]>, fichas = [ficha({})]) => proponerCbu([{ ...datos[0], ...cambio }], fichas).descartes[0]?.motivo;
assert.equal(motivo({ cuitTitular: "20111111112" }), "El titular de la cuenta tiene otro CUIT");
assert.equal(motivo({ cuitTitular: null }), "El mail no dice el CUIT del titular de la cuenta");
assert.equal(motivo({ remitente: "<estafa@otro.com>" }), "El mail no viene de una dirección de la ficha");
assert.equal(motivo({ cbu: "0070037520000043301749" }), "El CBU no pasa los dígitos verificadores");
assert.equal(motivo({ cbu: null }), "El mail trae alias pero no el CBU completo");
assert.equal(motivo({}, [ficha({ cuit: "30999999999" })]), "El CUIT del mail no es de ningún proveedor de esta sociedad");

// Datos bancarios cargados en la OP (03/11/2026).
{
  const prov = { cuit: "33-71446094-9", cbu: null, alias_bancario: "BMS.SEGURIDAD", banco: null, titular_cuenta: null, cuit_titular_cuenta: null };
  const r = cambiosBancarios(prov, { cbu: "0070 0375 2000 0043 3017 48", alias_bancario: "BMS.SEGURIDAD", banco: " Galicia ", cuit_titular_cuenta: "33714460949" });
  assert.deepEqual(r.cambios, { cbu: "0070037520000043301748", banco: "Galicia", cuit_titular_cuenta: "33714460949" }, "solo lo que cambia, limpio");
  assert.deepEqual(r.avisos, []);
  const mal = cambiosBancarios(prov, { cbu: "0070037520000043301749" });
  assert.match(mal.avisos[0], /dígitos verificadores/);
  const otro = cambiosBancarios({ ...prov, cbu: "2850590940090418135201" }, { cbu: "0070037520000043301748", cuit_titular_cuenta: "20111111112" });
  assert.equal(otro.avisos.length, 2, "ficha con otro CBU + titular con otro CUIT");
  assert.match(otro.avisos[0], /estafa/);
  assert.deepEqual(cambiosBancarios(prov, { alias_bancario: "" }).cambios, { alias_bancario: null }, "borrar un dato a mano");
  assert.equal(cbuNuevoDelComprobante([{ cbu_destino: "0070037520000043301748" }], "0070037520000043301748"), null, "ya lo tiene");
  assert.equal(cbuNuevoDelComprobante([{ cbu_destino: "0070037520000043301749" }], null), null, "CBU mal leído");
  assert.deepEqual(cbuNuevoDelComprobante([{ tipo: "transferencia" } as any, { cbu_destino: "0070-0375-20000043301748", destinatario: "BMS SRL", cuit_destinatario: "33-71446094-9" }], null),
    { cbu: "0070037520000043301748", alias: null, titular: "BMS SRL", cuitTitular: "33714460949", banco: null });
}

console.log("test-cbu OK");
