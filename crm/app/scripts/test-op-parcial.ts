import { calcularPagoParcial, repartirBruto } from "../src/lib/op-parcial";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
const ratio = 1 / 1.21;
// Retención 2 % sobre lo que pasa el mínimo de 224.000, sin acumulado previo; menos de 240 no se retiene.
const ret = (base: number) => { const r = Math.max(0, base - 224000) * 0.02; return r < 240 ? 0 : r; };

// Reparto: completa las más viejas primero.
const r0 = repartirBruto([{ id: "b", fecha: "2026-10-05", monto: 100, ratioNeto: 1 }, { id: "a", fecha: "2026-10-01", monto: 100, ratioNeto: 1 }], 150);
ok(r0.a === 100 && r0.b === 50, "más vieja completa, la nueva queda con 50");

// Caso tipo Sesenta Once: una factura de 5.860.725,75, los medios pagan 5.000.000.
const f1 = [{ id: "fc", fecha: "2026-09-30", monto: 5860725.75, ratioNeto: ratio }];
const p1 = calcularPagoParcial(f1, 5000000, ret);
ok(Math.abs(p1.neto - 5000000) < 0.01, `neto cierra con los medios (${p1.neto})`);
ok(p1.quedan.length === 1 && p1.quedan[0].resto > 700000, `queda saldo en la factura (${p1.quedan[0]?.resto})`);
ok(Math.abs(p1.retencion - ret(p1.montos.fc * ratio)) < 0.02, "retención recalculada sobre lo pagado");

// Tres facturas, faltan 120.000: quedan debiendo solo la más nueva.
const f2 = [
  { id: "v", fecha: "2026-09-01", monto: 300000, ratioNeto: ratio },
  { id: "m", fecha: "2026-09-15", monto: 400000, ratioNeto: ratio },
  { id: "n", fecha: "2026-10-01", monto: 500000, ratioNeto: ratio },
];
const total2 = calcularPagoParcial(f2, 1e9, ret);
const p2 = calcularPagoParcial(f2, roundCent(total2.neto - 120000), ret);
ok(p2.montos.v === 300000 && p2.montos.m === 400000, "las viejas se pagan completas");
ok(p2.quedan.length === 1 && p2.quedan[0].id === "n", "solo la más nueva queda con saldo");
ok(Math.abs(p2.neto - roundCent(total2.neto - 120000)) < 0.01, "neto cierra exacto");

// Con nota de crédito aplicada: el neto descuenta la NC.
const p3 = calcularPagoParcial(f2, 800000, ret, 100000, 100000 * ratio);
ok(Math.abs(p3.neto - 800000) < 0.01, `con NC cierra (${p3.neto})`);

function roundCent(n: number) { return Math.round(n * 100) / 100; }
