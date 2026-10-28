import { claveArticulo, ultimosPrecios, buscarEnLista, filaPorCodigo, resumenPresupuesto, precioDesdeMarkup } from "../src/lib/presupuesto-ayudas";
import { normalizarTexto } from "../src/lib/buscar-texto";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

ok(claveArticulo(" P 24 ") === "c:p24", "código sin espacios ni mayúsculas");
ok(claveArticulo("", "Pantalón  Cargo") === "d:pantalon cargo", "sin código usa la descripción");
ok(claveArticulo("", "") === "", "vacío");

const up = ultimosPrecios([
  { numero: "PR-1", fecha: "2026-08-01", moneda: "ARS", items: [{ codigo: "P24", descripcion: "x", precioVenta: 100 }] },
  { numero: "PR-3", fecha: "2026-09-10", moneda: "ARS", items: [{ codigo: "p24", descripcion: "x", precioVenta: 130 }, { codigo: "Z", descripcion: "z", precioVenta: 0 }] },
  { numero: "PR-2", fecha: "2026-09-01", moneda: "USD", items: [{ codigo: "P24", descripcion: "x", precioVenta: 1 }] },
]);
ok(up.get("c:p24")?.precio === 130 && up.get("c:p24")?.numero === "PR-3", "toma el más nuevo");
ok(!up.has("c:z"), "precio 0 no cuenta");

const filas = [
  { codigo: "AB1", codigo_interno: null, descripcion: "Pantalón cargo beige" },
  { codigo: "P24", codigo_interno: "LZ-P24", descripcion: "Botín pampero" },
  { codigo: "X9", codigo_interno: null, descripcion: "Guante nitrilo" },
].map((f) => ({ ...f, _txt: normalizarTexto(`${f.codigo} ${f.codigo_interno || ""} ${f.descripcion}`) }));
ok(buscarEnLista(filas, "pantalon")[0]?.codigo === "AB1", "busca sin tildes");
ok(buscarEnLista(filas, "pa").length === 0, "menos de 3 letras no busca");
ok(buscarEnLista(filas, "lz-p")[0]?.codigo === "P24", "por código interno");
ok(filaPorCodigo(filas, "lz-p24")?.codigo === "P24", "código interno exacto");
ok(filaPorCodigo(filas, "x9")?.codigo === "X9", "código proveedor exacto");
ok(filaPorCodigo(filas, "nada") === null, "no encontrado");

const r = resumenPresupuesto([
  { cantidad: 2, neto: 100, costo: 80, iva: 21 },   // 25 %
  { cantidad: 1, neto: 110, costo: 100, iva: 10.5 }, // 10 % → bajo
  { cantidad: 1, neto: 50, costo: 0, iva: 21 },      // sin costo: no cuenta como bajo
]);
ok(r.subtotal === 360, "subtotal");
ok(Math.abs(r.iva - (200 * 0.21 + 110 * 0.105 + 50 * 0.21)) < 1e-9, "IVA por renglón");
ok(r.costo === 260 && r.ganancia === 100, "costo y ganancia");
ok(Math.abs((r.margen ?? 0) - (360 / 260 - 1) * 100) < 1e-9, "margen");
ok(r.bajoMargen === 1, "uno bajo el 15 %");
ok(resumenPresupuesto([]).margen === null, "sin renglones");

// Margen neto (H43): con 7 % de gastos un renglón con 20 % bruto queda bajo el 15 %.
const n = resumenPresupuesto([
  { cantidad: 1, neto: 120, costo: 100, iva: 21 },   // bruto 20 %, neto 111,6/100 → 11,6 % → bajo
  { cantidad: 1, neto: 150, costo: 100, iva: 21 },   // neto 139,5 → 39,5 %
  { cantidad: 1, neto: 500, costo: null, iva: 21 },  // costo en US$ sin dólar: fuera del margen, sí en el total
], 15, 7);
ok(n.subtotal === 770 && n.costo === 200, "sin dólar suma al total pero no al costo");
ok(n.bajoMargen === 1, "bajo margen con el neto");
ok(n.margenNeto === 25.6, "margen neto total (270 × 0,93 / 200 − 1 = 25,55 → 25,6)");
ok(Math.abs((n.gananciaNeta ?? 0) - 51.1) < 1e-9, "ganancia neta");
ok(n.sinDolar === 1, "cuenta los renglones sin dólar");
ok(Math.abs((n.margen ?? 0) - 35) < 1e-9, "el bruto también deja afuera los sin dólar");

// Precio escrito a mano: no se corre por el markup redondeado (PR-2026-1264: 18.000 quedaba 17.999,76).
ok(precioDesdeMarkup(8593, 109.47, 18000) === 18000, "respeta el precio escrito (mismo costo)");
ok(precioDesdeMarkup(9800, 61.84, 15860) === 15860, "respeta 15.860");
ok(precioDesdeMarkup(8593, 109.47) === 17999.76, "sin precio escrito calcula");
ok(precioDesdeMarkup(9000, 109.47, 18000) === 18852.3, "si cambia el costo, recalcula");
ok(precioDesdeMarkup(8593, 120, 18000) === 18904.6, "si cambia el markup, recalcula");
console.log("TODO OK");
