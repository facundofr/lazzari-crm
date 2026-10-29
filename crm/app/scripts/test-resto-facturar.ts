// npx tsx scripts/test-resto-facturar.ts
import { restoSinFacturar, totalesResto, detalleResto, cartelResto } from "../src/lib/resto-facturar";

let fallas = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fallas++; console.error("FALLA:", msg); } else console.log("ok:", msg); };

// Caso real Synertech PR-2026-1218 / FA 0015-86: de 1000 N95 se facturaron 200 y se sacó la suspensión H700.
const pr = [
  { descripcion: "RESPIRADOR P/ PARTICULAS N95 (3M 8210)", cantidad: "1000.00", precio_venta: "1.92", iva_porcentaje: "21.00", total: "2323.20" },
  { descripcion: "ROLLO DE FIBRA VERDE 15 CM X 2 MM X 25 MTS", cantidad: "4.00", precio_venta: "41.16", iva_porcentaje: "21.00", total: "199.21" },
  { descripcion: "PROTECTOR OCULAR TRANSPARENTE ANTEOJO", cantidad: "24.00", precio_venta: "13.54", iva_porcentaje: "21.00", total: "393.20" },
  { descripcion: "SUSPENSION 3M P/ CASCO H700", cantidad: "12.00", precio_venta: "11.32", iva_porcentaje: "21.00", total: "164.37" },
  { descripcion: "PROTECTOR AUDITIVO 3M PELTOR H510 P/ CASCO", cantidad: "6.00", precio_venta: "36.24", iva_porcentaje: "21.00", total: "263.10" },
  { descripcion: "COFIAS BLANCAS X 100 UN", cantidad: "1.00", precio_venta: "5.00", iva_porcentaje: "21.00", total: "6.05" },
];
const fact = [{ prIdx: 0, cantidad: 200 }, { prIdx: 1, cantidad: 4 }, { prIdx: 2, cantidad: 24 }, { prIdx: 4, cantidad: 6 }, { prIdx: 5, cantidad: 1 }];
const resto = restoSinFacturar(pr, fact);
ok(resto.length === 2, "Synertech: quedan 2 renglones");
ok(resto[0].cantidad === 800 && resto[1].cantidad === 12, "800 N95 y 12 suspensiones");
const t = totalesResto(resto);
ok(t.subtotal === 1671.84, `neto 1671.84 (${t.subtotal})`);
ok(Math.abs(t.total - 2022.93) <= 0.02, `total ≈ 2022.93 (${t.total})`);
ok(detalleResto(resto).startsWith("800 RESPIRADOR"), "detalle");

ok(restoSinFacturar(pr, pr.map((it, i) => ({ prIdx: i, cantidad: Number(it.cantidad) }))).length === 0, "todo facturado: sin resto");
ok(restoSinFacturar(pr, [...pr.map((it, i) => ({ prIdx: i, cantidad: Number(it.cantidad) + 5 })), { cantidad: 3 }]).length === 0, "de más o renglón a mano: sin resto");
ok(restoSinFacturar([{ descripcion: "A", cantidad: 10, precio_venta: null, iva_porcentaje: 21, total: 121 }], [{ prIdx: 0, cantidad: 4 }])[0].precio_venta === 10, "sin precio_venta: sale del total");

// Cartel del resto dentro del PR (lista de Presupuestos).
const itemsResto = [{ descripcion: "Respirador N95", cantidad: 800, precio_venta: 1.5, iva_porcentaje: 21, total: 1452 }, { descripcion: "Suspensión H700", cantidad: 12, precio_venta: 2, iva_porcentaje: 21, total: 29.04 }];
const base = { id: "r", presupuesto_id: "p", moneda: "USD", total: 2022.93, items: itemsResto };
let c = cartelResto({ ...base, estado: "pendiente" });
ok(c.pendiente && c.titulo === "Resto a facturar: US$ 2.022,93", "cartel pendiente en US$");
ok(c.detalle === "800 Respirador N95 · 12 Suspensión H700", "cartel con el detalle");
c = cartelResto({ ...base, estado: "facturado", factura_resto: { tipo: "FA", punto_venta: 15, numero: 90 } });
ok(!c.pendiente && c.titulo === "Resto facturado en FA 0015-00000090: US$ 2.022,93", "cartel facturado con el número");
c = cartelResto({ ...base, moneda: "ARS", total: 1500, estado: "no_facturar" });
ok(!c.pendiente && c.titulo === "Resto marcado No facturar: $ 1.500,00", "cartel No facturar en pesos");

if (fallas) { console.error(`${fallas} falla(s)`); process.exit(1); }
console.log("Todo OK");
