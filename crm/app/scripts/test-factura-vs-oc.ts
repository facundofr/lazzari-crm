import { controlIva, emparejarPorPrecio, elegirOC, mismoPrecio, parecidoNombre } from "../src/lib/factura-vs-oc";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

// Caso Nexo FC A 0003-00005284: la IA puso IVA 0 % en mesa y caja y 10,5 % en el envío.
const mal = [
  { key: "mesa", cantidad: 1, precio: 378800, iva: 0 },
  { key: "caja", cantidad: 2, precio: 49000, iva: 0 },
  { key: "envio", cantidad: 1, precio: 90000, iva: 10.5 },
];
const c1 = controlIva({ renglones: mal, neto: 566800, percepciones: 0, totalLeido: 685828 });
ok(c1.controlado && !c1.cuadra, "Nexo leído mal: no cuadra");
ok(c1.calculado === 576250, "suma lo leído: 576.250");
ok(c1.diferencia === 109578, "diferencia 109.578");
ok(c1.propone21, "propone 21 %");
const bien = mal.map((r) => ({ ...r, iva: 21 }));
const c2 = controlIva({ renglones: bien, neto: 566800, percepciones: 0, totalLeido: 685828 });
ok(c2.cuadra && !c2.propone21, "con 21 % cuadra");
ok(!controlIva({ renglones: bien, neto: 566800, percepciones: 0, totalLeido: 0 }).controlado, "sin total leído no controla");
ok(controlIva({ renglones: bien, neto: 566800, percepciones: 0, totalLeido: 685828.6 }).cuadra, "tolerancia de $1");
const c3 = controlIva({ renglones: mal, neto: 566800, percepciones: 0, totalLeido: 700000 });
ok(!c3.cuadra && !c3.propone21, "si con 21 % tampoco da, avisa sin proponer");
// Mismo caso, con mesa y caja bien y el envío en 0 %: diferencia $18.900 → señala solo el envío.
const envio0 = bien.map((r) => (r.key === "envio" ? { ...r, iva: 0 } : r));
const c4 = controlIva({ renglones: envio0, neto: 566800, percepciones: 0, totalLeido: 685828 });
ok(c4.diferencia === 18900 && c4.renglones21.length === 1 && c4.renglones21[0] === "envio", "diferencia 18.900: señala el envío");
ok(c2.renglones21.length === 0 && c3.renglones21.length === 0, "si cuadra o no da con ningún renglón, no señala");

// Emparejar por precio: la OC llama distinto a la mesa y la caja; el envío no está.
const oc = [{ id: "m", cantidad: 1, precio: 378800 }, { id: "c", cantidad: 1, precio: 49000 }];
const e1 = emparejarPorPrecio(bien.map((r) => ({ ...r })), oc);
ok(e1.mesa === "m" && e1.caja === "c" && !e1.envio, "mesa y caja por precio; envío queda afuera");
// Dos renglones con el mismo precio: desempata la cantidad; si no, no empareja.
const e2 = emparejarPorPrecio([{ key: "a", cantidad: 3, precio: 100, iva: 21 }], [{ id: "x", cantidad: 1, precio: 100 }, { id: "y", cantidad: 3, precio: 100 }]);
ok(e2.a === "y", "mismo precio: desempata por cantidad");
const e3 = emparejarPorPrecio([{ key: "a", cantidad: 2, precio: 100, iva: 21 }], [{ id: "x", cantidad: 1, precio: 100 }, { id: "y", cantidad: 3, precio: 100 }]);
ok(!e3.a, "mismo precio sin desempate: no adivina");
// Uno contra uno con precio parecido (aumento del 10 %).
ok(emparejarPorPrecio([{ key: "a", cantidad: 1, precio: 110, iva: 21 }], [{ id: "x", cantidad: 1, precio: 100 }]).a === "x", "uno y uno, +10 %");
ok(!emparejarPorPrecio([{ key: "a", cantidad: 1, precio: 150, iva: 21 }], [{ id: "x", cantidad: 1, precio: 100 }]).a, "uno y uno, +50 %: no");
ok(mismoPrecio(49000.4, 49000) && !mismoPrecio(49500, 49000), "mismoPrecio");

// Elegir la OC.
const ocs = [
  { id: "1229", numero: "OC-2026-1229", total: 517638, precios: [378800, 49000] },
  { id: "1100", numero: "OC-2026-1100", total: 600000, precios: [1000, 2000] },
];
ok(elegirOC(ocs, { precios: [378800, 49000, 90000], total: 566800 }) === "1229", "elige la OC por precios");
ok(elegirOC(ocs, { precios: [5], total: 600000, referencias: ["1229"] }) === "1229", "la referencia impresa manda");
ok(elegirOC(ocs, { precios: [5], total: 601000 }) === "1100", "sin precios iguales: total a menos de 2 %");
ok(elegirOC(ocs, { precios: [5], total: 10 }) !== null, "siempre elige una si hay OC pendientes");
// Los nombres mandan antes que los precios (el proveedor cambió los precios).
const conNombres = [
  { id: "1229", numero: "OC-2026-1229", total: 517638, precios: [1, 2], nombres: ["MESA DE REUNIONES 1,60 X 0,90 BASE METÁLICA", "OPCIONAL CAJA PORTA TOMA DE 2 BOCAS"], cantidades: [1, 1] },
  { id: "1100", numero: "OC-2026-1100", total: 600000, precios: [378800], nombres: ["SILLA OPERATIVA"], cantidades: [1] },
];
ok(elegirOC(conNombres, { precios: [378800, 49000], total: 600000, nombres: ["Mesa de reuniones línea Portico", "Cajas porta toma de 2 bocas", "Costo de envio"], cantidades: [1, 2, 1] }) === "1229", "elige por nombres parecidos");
ok(parecidoNombre("Cajas porta toma de 2 bocas", "OPCIONAL CAJA PORTA TOMA DE 2 BOCAS") === 1, "caja porta toma: mismo artículo");
ok(parecidoNombre("Costo de envio", "SILLA OPERATIVA") === 0, "nombres distintos");
ok(elegirOC([], { precios: [1], total: 1 }) === null, "sin OC");
console.log("TODO OK");
