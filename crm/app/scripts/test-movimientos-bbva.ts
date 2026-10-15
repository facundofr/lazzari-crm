// Prueba del lector del Excel "Movimientos" del BBVA — correr: npx tsx scripts/test-movimientos-bbva.ts
import assert from "node:assert/strict";
import { leerMovimientosBbva } from "../src/lib/extracto-bbva";

const enc = ["Fecha", "Fecha Valor", "Concepto", "Codigo", "Número Documento", "Oficina", "Crédito", "Débito", "Detalle"];
const cab = (saldo: string) => [["Empresa: ", "X"], ["Cuenta: ", "091-312483/1(CC $)"], ["Sucursal: ", "91"], ["Saldo: ", saldo], ["Movimientos de: ", "x"], [], enc];
// Histórico: días de más nuevo a más viejo, dentro de cada día de más viejo a más nuevo.
const hist = [
  ...cab("1.000,00"),
  ["13-10-2026", "13-10-2026", "PAGO A PROVEEDORES OP.1", "", "", "91", "500.00", "", ""],
  ["13-10-2026", "13-10-2026", "COMISION", "", "", "91", "", "-100.00", ""],
  ["09-10-2026", "09-10-2026", "VIEJO", "", "", "91", "", "-50.00", ""],
];
// saldo final 1000 → tras COMISION (la más nueva del 13) 1000; antes de ella 1100; antes de PAGO 600; tras VIEJO 600.
let r = leerMovimientosBbva([hist], { fecha: "2026-10-09", saldo: 600 });
assert.equal(r.cuentaDigitos, "913124831");
assert.equal(r.lineas.length, 3);
assert.deepEqual(r.lineas.map((l) => l.saldo), [600, 1100, 1000]);
assert.equal(r.saldoFinal, 1000);
// Si el saldo cargado no coincide → error claro, no se guarda nada
assert.throws(() => leerMovimientosBbva([hist], { fecha: "2026-10-09", saldo: 700 }), /no cierran/);
console.log("OK movimientos-bbva");
