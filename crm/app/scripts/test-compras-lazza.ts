// Compras Lazza: comparación factura vs OC, neto estimado y cruces seguros de precio.
// Uso (desde crm/app): npx tsx scripts/test-compras-lazza.ts
import assert from "node:assert/strict";
import { comparar, netoFactura, netoPorOc, crucesSeguros, notaObservar, aFacturarPorRenglon, costoPrAnterior, vencimientoPorDias, tipoNotaCredito, ivaYPercepciones } from "../src/lib/compras-lazza";
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

// Sacar factura: el costo del PR vuelve al anterior (precio de venta igual, margen recalculado).
const base = { costoMoneda: "ARS", precioFactura: 110, precioAnterior: 100, prMoneda: "ARS", tc: null, tcDivisas: null, precioVenta: 150, precioLista: null, markupActual: 36.36 };
assert.deepEqual(costoPrAnterior({ ...base, costoActual: 110 }), { precio_costo: 100, markup_porcentaje: 50 });
assert.equal(costoPrAnterior({ ...base, costoActual: 120 }), null);                       // lo cambiaron después: no se pisa
assert.deepEqual(costoPrAnterior({ ...base, costoActual: 110, precioLista: 200 }), { precio_costo: 100, markup_porcentaje: 100 }); // con descuento: sobre lista
// PR en dólares, factura en pesos (tc 1000): costo anterior 100.000 $ = 100 US$; venta 150 US$ → 50 %.
assert.deepEqual(costoPrAnterior({ ...base, costoActual: 110000, precioFactura: 110000, precioAnterior: 100000, prMoneda: "USD", tc: 1000 }), { precio_costo: 100000, markup_porcentaje: 50 });

// Para Pagos "a N días": vencimiento = fecha de la factura + N (sin días, el de la factura).
assert.equal(vencimientoPorDias("2026-10-16", "60", "2026-11-15"), "2026-12-15");
assert.equal(vencimientoPorDias("2026-10-16", "0", "2026-11-15"), "2026-10-16");
assert.equal(vencimientoPorDias("2026-12-20", 30, null), "2027-01-19");
assert.equal(vencimientoPorDias("2026-10-16", "", "2026-11-15"), "2026-11-15");
assert.equal(vencimientoPorDias("", "60", "2026-11-15"), "2026-11-15");
assert.equal(vencimientoPorDias(null, null, null), null);

// Nota de crédito: tipo leído (QR / texto / IA) → el que guarda la base
assert.equal(tipoNotaCredito("NOTA DE CREDITO A"), "NC A");
assert.equal(tipoNotaCredito("NOTA DE CRÉDITO B"), "NC B");
assert.equal(tipoNotaCredito("NOTA DE CREDITO FCE MIPYME A"), "NC FCE A");
assert.equal(tipoNotaCredito("NOTA DE CREDITO C"), "NC C");
assert.equal(tipoNotaCredito("NC A"), "NC A");
assert.equal(tipoNotaCredito("FACTURA A"), null);
assert.equal(tipoNotaCredito("NOTA DE DEBITO A"), null);
assert.equal(tipoNotaCredito("FC A"), null);

// IVA y percepciones: el QR solo trae el total (FC Segutécnica 0014-73759: neto 490.365, IVA 21 %, IIBB 19.614,60)
assert.deepEqual(ivaYPercepciones({ total: 612956.25, neto: 490365, iva: 0, percepciones: 0, ivaPorcentaje: 21 }), { iva: 102976.65, percepciones: 19614.6, percepcionEstimada: true });
assert.deepEqual(ivaYPercepciones({ total: 1267750, neto: 1014200, iva: 0, percepciones: 0, ivaPorcentaje: 21 }), { iva: 212982, percepciones: 40568, percepcionEstimada: true });
assert.deepEqual(ivaYPercepciones({ total: 1210, neto: 1000, iva: 0, percepciones: 0, ivaPorcentaje: 21 }), { iva: 210, percepciones: 0, percepcionEstimada: false });
assert.deepEqual(ivaYPercepciones({ total: 1105, neto: 1000, iva: 0, percepciones: 0, ivaPorcentaje: 21 }), { iva: 105, percepciones: 0, percepcionEstimada: false }); // 10,5 %
assert.deepEqual(ivaYPercepciones({ total: 1250, neto: 1000, iva: 210, percepciones: 40, ivaPorcentaje: 21 }), { iva: 210, percepciones: 40, percepcionEstimada: false }); // leídos
assert.deepEqual(ivaYPercepciones({ total: 1250, neto: 1000, iva: 0, percepciones: 40, ivaPorcentaje: 21 }), { iva: 210, percepciones: 40, percepcionEstimada: false });

console.log("test-compras-lazza OK");
