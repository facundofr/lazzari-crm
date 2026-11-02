// npx tsx scripts/test-factura-vs-pr.ts
import { excesoFacturaSobrePr, hayExcesoSobrePr, detalleExcesoPr } from "../src/lib/factura-vs-pr";

let fallas = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fallas++; console.error("FALLA:", msg); } else console.log("ok:", msg); };

// Caso real PR-2026-1125 Corteva Seeds (FCEA 15-4): 35 anteojos a US$ 111 cotizados, se facturaron 37 (US$ 222 neto de más).
const pr1125 = [{ descripcion: "ORGANICO FOTOCROMATICO", cantidad: 35, precio: 111 }];
const e1 = excesoFacturaSobrePr(pr1125, [{ descripcion: "ORGANICO FOTOCROMATICO", cantidad: 37, precio_unitario: 111, prIdx: 0 }]);
ok(hayExcesoSobrePr(e1), "PR-1125: avisa");
ok(e1.diferencia === 222, `PR-1125: US$ 222 neto de más (${e1.diferencia})`);
ok(e1.renglones.length === 1 && e1.renglones[0].motivo === "cantidad", "PR-1125: por cantidad");
ok(detalleExcesoPr(e1) === "cantidad 35 → 37 en ORGANICO FOTOCROMATICO", detalleExcesoPr(e1));

// Igual al PR: no avisa.
const igual = excesoFacturaSobrePr(pr1125, [{ descripcion: "X", cantidad: 35, precio_unitario: 111, prIdx: 0 }]);
ok(!hayExcesoSobrePr(igual), "igual al PR: sin aviso");

// Facturar menos (resto): no avisa.
ok(!hayExcesoSobrePr(excesoFacturaSobrePr(pr1125, [{ descripcion: "X", cantidad: 10, precio_unitario: 111, prIdx: 0 }])), "facturar menos: sin aviso");

// Precio más alto en un renglón.
const pr = [{ descripcion: "Botín", cantidad: 10, precio: 100 }, { descripcion: "Guante", cantidad: 5, precio: 20 }];
const e2 = excesoFacturaSobrePr(pr, [{ descripcion: "Botín", cantidad: 10, precio_unitario: 105, prIdx: 0 }, { descripcion: "Guante", cantidad: 5, precio_unitario: 20, prIdx: 1 }]);
ok(e2.renglones[0]?.motivo === "precio" && e2.diferencia === 50, "precio mayor: avisa y suma 50");

// Precio más alto pero con menos cantidad: el total no pasa, el renglón sí avisa.
const e3 = excesoFacturaSobrePr(pr, [{ descripcion: "Botín", cantidad: 5, precio_unitario: 110, prIdx: 0 }]);
ok(e3.diferencia === 0 && e3.renglones.length === 1, "precio mayor con menos cantidad: avisa el renglón, no el total");

// Renglón agregado a mano.
const e4 = excesoFacturaSobrePr(pr, [{ descripcion: "Botín", cantidad: 10, precio_unitario: 100, prIdx: 0 }, { descripcion: "Guante", cantidad: 5, precio_unitario: 20, prIdx: 1 }, { descripcion: "Flete", cantidad: 1, precio_unitario: 30 }]);
ok(e4.renglones[0]?.motivo === "agregado" && e4.diferencia === 30, "renglón agregado: avisa");

// Centavos de pasar entre A y B: no avisa.
const e5 = excesoFacturaSobrePr([{ descripcion: "A", cantidad: 3, precio: 82.6446 }], [{ descripcion: "A", cantidad: 3, precio_unitario: 82.65, prIdx: 0 }]);
ok(!hayExcesoSobrePr(e5), "redondeo: sin aviso");

// Mismo renglón partido en dos que juntos pasan la cantidad.
const e6 = excesoFacturaSobrePr(pr, [{ descripcion: "Botín", cantidad: 6, precio_unitario: 100, prIdx: 0 }, { descripcion: "Botín", cantidad: 6, precio_unitario: 100, prIdx: 0 }]);
ok(e6.renglones.some((r) => r.motivo === "cantidad" && r.factura === 12), "renglón partido: suma cantidades");

if (fallas) { console.error(`${fallas} fallas`); process.exit(1); }
console.log("Todo OK");
