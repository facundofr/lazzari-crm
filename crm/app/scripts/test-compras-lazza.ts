// Compras Lazza: comparación factura vs OC, neto estimado y cruces seguros de precio.
// Uso (desde crm/app): npx tsx scripts/test-compras-lazza.ts
import assert from "node:assert/strict";
import { comparar, netoFactura, netoPorOc, crucesSeguros, notaObservar, aFacturarPorRenglon } from "../src/lib/compras-lazza";
import { repartirEnvio } from "../src/lib/cargar-factura";

// Neto
assert.deepEqual(netoFactura({ subtotal: 1000, total: 1210, ivaPorcentaje: 21 }), { neto: 1000, estimado: false });
assert.deepEqual(netoFactura({ subtotal: 0, total: 1210, ivaPorcentaje: 21 }), { neto: 1000, estimado: true });

// Comparación: coincide, redondeo, diferencia chica y alta; el envío no cuenta.
assert.equal(comparar(1000, 0, 1000).coincide, true);
assert.equal(comparar(1005, 0, 1000).coincide, true);           // 0,5 % = redondeo
const c3 = comparar(1030, 0, 1000);
assert.equal(c3.coincide, false); assert.equal(c3.alta, false); assert.equal(c3.diferencia, 30); assert.equal(c3.pct, 3);
const c4 = comparar(1100, 0, 1000);
assert.equal(c4.alta, true);
assert.equal(comparar(1300, 300, 1000).coincide, true);         // 300 de envío
const c5 = comparar(900, 0, 1000);
assert.equal(c5.diferencia, -100); assert.equal(c5.alta, true);
assert.equal(comparar(50, 0, 0).coincide, false);               // OC sin plata

// Neto por OC con precio cambiado
const lineas = [
  { id: "l1", ocId: "A", codigo: "P1", descripcion: "BOTIN PRUSIANO PVC NEGRO T42", pendiente: 20, precio: 100, moneda: "ARS" },
  { id: "l2", ocId: "A", codigo: "", descripcion: "GUANTE NITRILO", pendiente: 5, precio: 50, moneda: "ARS" },
  { id: "l3", ocId: "B", codigo: "", descripcion: "CASCO LIBUS BLANCO", pendiente: 2, precio: 900, moneda: "ARS" },
  { id: "l4", ocId: "B", codigo: "", descripcion: "CASCO LIBUS ROJO", pendiente: 2, precio: 900, moneda: "USD" },
];
assert.deepEqual([...netoPorOc(lineas)], [["A", 2250], ["B", 3600]]);
assert.deepEqual([...netoPorOc(lineas, new Map([["l1", 110]]))], [["A", 2450], ["B", 3600]]);

// Cruces seguros
const items = [
  { key: "a", codigo: "p-1", descripcion: "Botin prusiano", cantidad: 20, precio: 110 },   // mismo código → cambia
  { key: "b", codigo: null, descripcion: "Guante nitrilo", cantidad: 5, precio: 50 },      // mismo nombre, mismo precio
  { key: "c", codigo: null, descripcion: "Casco Libus", cantidad: 2, precio: 950 },        // dos cascos posibles → no se toca
  { key: "d", codigo: null, descripcion: "ENVIO ANDREANI", cantidad: 1, precio: 3000 },
];
const cr = crucesSeguros(items, lineas, "ARS");
const por = Object.fromEntries(cr.map(c => [c.key, c]));
assert.equal(por.a?.lineaId, "l1"); assert.equal(por.a?.cambia, true); assert.equal(por.a?.precioNuevo, 110); assert.equal(por.a?.motivo, "codigo");
assert.equal(por.b?.lineaId, "l2"); assert.equal(por.b?.cambia, false); assert.equal(por.b?.motivo, "nombre");
assert.equal(por.c, undefined);
assert.equal(por.d, undefined);
// Otra moneda: se cruza pero no se cambia el precio.
const crUsd = crucesSeguros([{ key: "x", codigo: null, descripcion: "CASCO LIBUS ROJO", cantidad: 2, precio: 1000 }], lineas, "ARS");
assert.equal(crUsd[0]?.lineaId, "l4"); assert.equal(crUsd[0]?.cambia, false);
// Dos artículos al mismo renglón → ninguno.
assert.equal(crucesSeguros([{ key: "y", codigo: "P1", descripcion: "x", cantidad: 1, precio: 1 }, { key: "z", codigo: "P1", descripcion: "y", cantidad: 1, precio: 1 }], lineas, "ARS").length, 0);

// Envío repartido por plata entre dos OC
assert.deepEqual(repartirEnvio(300, [{ ocId: "A", ocNumero: "OC-1", importe: 2000 }, { ocId: "B", ocNumero: "OC-2", importe: 1000 }]).map(p => p.monto), [200, 100]);

// Nota
const n = notaObservar({ numeroFc: "0012-00012792", comp: c3, varias: true, nota: "  ver con Mariana ", moneda: "ARS", fecha: "16/10/2026", quien: "Augusto" });
assert.match(n, /FC 0012-00012792/); assert.match(n, /sin definir/); assert.match(n, /Nota: ver con Mariana$/);

// Factura parcial: llegaron 18 de 20 → se facturan 18 y quedan 2 abiertos.
const p1 = aFacturarPorRenglon([{ id: "a", cantidad: 20, recibida: 18, pendiente: 20 }, { id: "b", cantidad: 5, recibida: 0, pendiente: 5 }]);
assert.equal(p1.porLlegado, true); assert.equal(p1.cantidades.get("a"), 18); assert.equal(p1.cantidades.get("b"), 0);
// Segunda factura: ya se facturaron 18, llegaron los 2 que faltaban.
const p2 = aFacturarPorRenglon([{ id: "a", cantidad: 20, recibida: 20, pendiente: 2 }]);
assert.equal(p2.cantidades.get("a"), 2);
// Nadie marcó "Llegó": todo lo pendiente.
const p3 = aFacturarPorRenglon([{ id: "a", cantidad: 20, recibida: 0, pendiente: 20 }, { id: "b", cantidad: 5, recibida: 0, pendiente: 3 }]);
assert.equal(p3.porLlegado, false); assert.equal(p3.cantidades.get("a"), 20); assert.equal(p3.cantidades.get("b"), 3);
// Llegó todo y ya está facturado lo que llegó: vuelve a "todo lo pendiente".
const p4 = aFacturarPorRenglon([{ id: "a", cantidad: 20, recibida: 18, pendiente: 2 }]);
assert.equal(p4.porLlegado, false); assert.equal(p4.cantidades.get("a"), 2);

console.log("test-compras-lazza OK");
