// Prueba rápida: npx tsx scripts/test-cheques-plazo.ts
import assert from "node:assert/strict";
import { domingoDe, plazoCheque, rangoPlazo, resumenPlazos } from "../src/lib/cheques-plazo";

const hoy = "2026-10-16"; // viernes
assert.equal(domingoDe(hoy), "2026-10-18");
assert.equal(domingoDe("2026-10-18"), "2026-10-18");

const e = (fecha_pago: string, estado = "entregado", monto = 100, moneda = "ARS") => ({ direccion: "emitido", estado, fecha_pago, monto, moneda });
assert.equal(plazoCheque(e("2026-10-12"), hoy), "en_fecha");
assert.equal(plazoCheque(e("2026-10-16"), hoy), "en_fecha");
assert.equal(plazoCheque(e("2026-10-18"), hoy), "esta_semana");
assert.equal(plazoCheque(e("2026-10-19"), hoy), "mas_adelante");
assert.equal(plazoCheque(e("2026-10-12", "cobrado"), hoy), null);
assert.equal(plazoCheque(e("2026-10-12", "anulado"), hoy), null);
assert.equal(plazoCheque({ direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-16", monto: 1 }, hoy), "en_fecha");
assert.equal(plazoCheque({ direccion: "recibido", estado: "depositado", fecha_pago: "2026-10-16", monto: 1 }, hoy), null);

const r = resumenPlazos([e("2026-10-12", "entregado", 3144953.35), e("2026-10-10", "pendiente", 296250), e("2026-10-17"), e("2026-11-11", "entregado", 50, "USD"),
  { direccion: "recibido", estado: "en_cartera", fecha_pago: "2026-10-16", monto: 999 }], "emitido", hoy);
assert.deepEqual(r.en_fecha, { cantidad: 2, ARS: 3441203.35, USD: 0 });
assert.deepEqual(r.esta_semana, { cantidad: 1, ARS: 100, USD: 0 });
assert.deepEqual(r.mas_adelante, { cantidad: 1, ARS: 0, USD: 50 });

assert.deepEqual(rangoPlazo("en_fecha", hoy), { desde: "", hasta: "2026-10-16" });
assert.deepEqual(rangoPlazo("esta_semana", hoy), { desde: "2026-10-17", hasta: "2026-10-18" });
assert.deepEqual(rangoPlazo("mas_adelante", hoy), { desde: "2026-10-19", hasta: "" });

console.log("cheques-plazo: OK");
