// Prueba rápida de src/lib/agente-mail.ts — correr: npx tsx scripts/test-agente-mail.ts
import assert from "node:assert/strict";
import { armarReclamoCobranza, mismoCliente, costoModeloUSD, cruzarPago, extraerJSON, inicioDiaAR, normalizarCategoria, parseNumeroFactura, superaTopeDiario, type FacturaAbierta } from "../src/lib/agente-mail";

assert.deepEqual(parseNumeroFactura("FA 00016-00000018"), { pv: 16, num: 18 });
assert.deepEqual(parseNumeroFactura("16-18"), { pv: 16, num: 18 });
assert.equal(parseNumeroFactura("sin numero"), null);

assert.deepEqual(extraerJSON('```json\n{"a":1}\n```'), { a: 1 });
assert.equal(extraerJSON("nada"), null);
assert.equal(normalizarCategoria("pago_retencion"), "pago_retencion");
assert.equal(normalizarCategoria("cualquier cosa"), "otro");

assert.ok(Math.abs(costoModeloUSD("claude-haiku-4-5-20251001", 1_000_000, 1_000_000) - 6) < 1e-9);
assert.equal(superaTopeDiario(1.5), true);
assert.equal(superaTopeDiario(0.2), false);
assert.equal(inicioDiaAR(new Date("2026-10-15T02:00:00Z")), "2026-10-14T03:00:00.000Z"); // 23:00 del 14 en Argentina

const f = (id: string, pv: number, n: number, saldo: number, cuit = "30111111111"): FacturaAbierta =>
  ({ id, tipo: "FA", punto_venta: pv, numero: n, cliente_id: "c1", cliente_nombre: "Cliente SA", cliente_cuit: cuit, total: saldo, saldo, moneda: "ARS" });
const abiertas = [f("a", 16, 18, 1370733.34), f("b", 16, 3, 619580.5), f("c", 16, 4, 100)];
const banco = [{ id: "m1", fecha: "2026-10-05", monto: 1348076.59, descripcion: "OP" }];

// por número de factura + entrada del banco neta de retención
let r = cruzarPago({ facturas: [{ numero: "FA 16-18" }], monto_total: 1370733.34, retenciones_total: 22656.75, fecha_pago: "2026-10-05" }, abiertas, banco);
assert.equal(r.facturas.length, 1); assert.equal(r.facturas[0].id, "a"); assert.equal(r.entrada_banco?.id, "m1"); assert.equal(r.confianza, "alta");

// sin número: por CUIT y suma exacta
r = cruzarPago({ cliente_cuit: "30-11111111-1", monto_total: 619680.5 }, abiertas, []);
assert.deepEqual(r.facturas.map((x) => x.id).sort(), ["b", "c"]); assert.equal(r.confianza, "media");

// factura nombrada que no está abierta → nota, nada inventado
r = cruzarPago({ facturas: [{ numero: "16-99" }] }, abiertas, []);
assert.equal(r.facturas.length, 0); assert.equal(r.confianza, "baja"); assert.ok(r.notas[0].includes("16-99"));

const rec = armarReclamoCobranza("Cliente SA", [{ etiqueta: "FA 00016-00000018", fecha: "2026-08-01", vencimiento: "2026-09-01", saldo: 1000, moneda: "ARS" }], "Lazzari", new Date(2026, 9, 15));
assert.ok(rec.texto.includes("44 días")); assert.ok(rec.texto.includes("01/09/2026"));

// número pegado (5+8 dígitos), nombres de cliente y factura ya cobrada
assert.deepEqual(parseNumeroFactura("0001500000017"), { pv: 15, num: 17 });
assert.equal(mismoCliente("CORTEVA SEEDS ARGENTINA S. R. L.", "Corteva Seeds Argentina SRL"), true);
assert.equal(mismoCliente("CARGILL SOCIEDAD ANONIMA", "Corteva Agriscience"), false);
const cobrada = { ...f("z", 15, 17, 0), total: 966929.4, estado: "pagada" };
r = cruzarPago({ facturas: [{ numero: "0001500000017" }], monto_total: 966929.4 }, [cobrada, ...abiertas], []);
assert.equal(r.facturas.length, 1); assert.equal(r.facturas[0].cobrada, true); assert.ok(r.notas.some((n) => n.includes("ya figura cobrada")));
// sin CUIT: por nombre del cliente y suma exacta
r = cruzarPago({ cliente_nombre: "Cliente S.A.", monto_total: 100 }, abiertas.map((x) => ({ ...x, cliente_nombre: "CLIENTE SA" })), []);
assert.deepEqual(r.facturas.map((x) => x.id), ["c"]);
// entrada del banco ya cruzada
r = cruzarPago({ facturas: [{ numero: "16-18" }], monto_neto: 1348076.59, fecha_pago: "2026-10-05" }, abiertas, [{ ...banco[0], estado: "matcheado" }]);
assert.equal(r.entrada_banco?.ya_cruzada, true); assert.equal(r.confianza, "media");
console.log("OK agente-mail");
