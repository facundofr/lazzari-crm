import { sugerirCentralizar, proveedoresSinStock, sugerirProveedores, parecido, costoAlDia, margenReal, diasDesde, mismaMonedaCosto } from "../src/lib/compras-armado";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

// Proveedor sugerido
const cat = [
  { codigo: "BOT-123", codigo_interno: "FUN-BOT-123", descripcion: "Botín Funcional puntera acero", proveedor: "Funcional" },
  { codigo: "GUA-9", codigo_interno: null, descripcion: "Guante nitrilo", proveedor: "Mediglove" },
];
const mapa = { funcional: "p-fun", mediglove: "p-med" };
const hist = [
  { codigo: "FUN-BOT-123", descripcion: "Botin funcional", proveedor_id: "p-otro" },
  { codigo: "X1", descripcion: "Camisa grafa 70 azul", proveedor_id: "p-graf" },
  { codigo: "X2", descripcion: "Camisa grafa 70 azul talle 44", proveedor_id: "p-graf" },
];
let s = sugerirProveedores({ codigo: "FUN-BOT-123", descripcion: "Botín" }, cat, mapa, hist);
ok(s[0].proveedor_id === "p-fun" && s[0].puntos === 100, "código en la lista = proveedor de la lista primero");
ok(s[1].proveedor_id === "p-otro" && s[1].puntos === 82, "compra anterior del código segundo");
s = sugerirProveedores({ codigo: "gua-9", descripcion: "" }, cat, mapa, hist);
ok(s.length === 1 && s[0].proveedor_id === "p-med", "código sin mayúsculas también");
s = sugerirProveedores({ codigo: "", descripcion: "Camisa Grafa 70 azul" }, cat, mapa, hist);
ok(s.length === 1 && s[0].proveedor_id === "p-graf" && s[0].puntos === 70, "descripción parecida");
s = sugerirProveedores({ codigo: "NADA", descripcion: "Casco blanco" }, cat, mapa, hist);
ok(s.length === 0, "sin datos no inventa");
ok(sugerirProveedores({ codigo: "BOT-123", descripcion: "" }, cat, {}, []).length === 0, "lista sin proveedor del CRM: nada");
ok(parecido("Camisa grafa", "") === 0 && parecido("", "x") === 0, "parecido con vacío = 0");

// Monedas
ok(mismaMonedaCosto("USD Divisa", "USD") && !mismaMonedaCosto("ARS", "USD divisa") && mismaMonedaCosto(null, "ARS"), "monedas comparables");

// Margen real (sobre costo)
ok(margenReal({ precio_venta: 130 }, 0, 100, "ARS", "ARS", 0, 0) === 30, "margen 30%");
ok(margenReal({ precio_venta: 200, descuento_porcentaje: 10 }, 0, 100, "ARS", "ARS", 0, 0) === 80, "con descuento del renglón");
ok(margenReal({ precio_venta: 150000 }, 0, 100, "USD", "ARS", 1000, 0) === 50, "costo en USD convertido");
ok(margenReal({ precio_venta: 100 }, 0, 0, "ARS", "ARS", 0, 0) === null, "costo 0 = sin margen");

// Costo al día
let c = costoAlDia({ costoOC: 100, costoMoneda: "ARS", costoLista: 110, monedaLista: "ARS", venta: { precio_venta: 125 }, descuentoGeneral: 0, prMoneda: "ARS", tc: 0, tcDivisas: 0 });
ok(c.diferenciaPct === 10 && c.margenOC === 25 && c.margenLista === 13.6 && c.bajoMinimo, "lista subió 10%: margen 13,6% avisa");
c = costoAlDia({ costoOC: 100, costoMoneda: "ARS", costoLista: 5, monedaLista: "USD", venta: { precio_venta: 125 }, descuentoGeneral: 0, prMoneda: "ARS", tc: 0, tcDivisas: 0 });
ok(c.costoLista === null && c.diferenciaPct === null && !c.bajoMinimo, "monedas distintas: no compara");
c = costoAlDia({ costoOC: 100, costoMoneda: "ARS", costoLista: null, monedaLista: null, venta: null, descuentoGeneral: 0, prMoneda: "ARS", tc: 0, tcDivisas: 0 });
ok(c.margenOC === null && !c.bajoMinimo, "sin PR: sin margen ni aviso");

// Días y totales
ok(diasDesde("2026-10-08T12:00:00Z", Date.parse("2026-10-15T13:00:00Z")) === 7, "7 días");
ok(diasDesde(null) === null && diasDesde("x") === null, "sin fecha");
// Centralizar
const ped = [
  { oc_id: "o1", pr_id: "pr1", pr_numero: "PR-1", proveedor_id: "A", proveedor_nombre: "Funcional", moneda: "ARS", total: 900000 },
  { oc_id: "o2", pr_id: "pr1", pr_numero: "PR-1", proveedor_id: "B", proveedor_nombre: "Mediglove", moneda: "ARS", total: 80000 },
  { oc_id: "o3", pr_id: "pr1", pr_numero: "PR-1", proveedor_id: "C", proveedor_nombre: "3M", moneda: "USD", total: 100 },
  { oc_id: "o4", pr_id: "pr2", proveedor_id: "A", proveedor_nombre: "Funcional", moneda: "ARS", total: 500000 },
  { oc_id: "o5", pr_id: "pr2", proveedor_id: "B", proveedor_nombre: "Mediglove", moneda: "ARS", total: 400000 },
];
const todoSi = () => true;
const cz = sugerirCentralizar(ped, undefined, todoSi);
ok(sugerirCentralizar(ped).length === 0, "sin saber si el destino lo vende: no sugiere");
ok(sugerirCentralizar(ped, undefined, (oc, prov) => !(oc === "o2" && prov === "A")).length === 0, "el destino no vende lo de la OC chica: no sugiere");
ok(cz.length === 1 && cz[0].pr_id === "pr1" && cz[0].destino_proveedor_id === "A" && cz[0].oc_ids.join() === "o2" && cz[0].monto_a_mover === 80000, "PR con pedido chico: juntar en el mayor");
ok(!cz.some((x) => x.pr_id === "pr2"), "pedidos grandes: no sugiere");
ok(!cz.some((x) => x.moneda === "USD"), "USD solo: no mezcla con pesos");
ok(sugerirCentralizar([{ ...ped[0], pr_id: null }, ped[1]], undefined, todoSi).length === 0, "sin PR: no sugiere");
ok(proveedoresSinStock("Asignar proveedor · Sin stock en Funcional SA: BOT-1 · Sin stock en 3M: X").join("|") === "funcional sa|3m", "lee los sin stock");
console.log("TODO OK");
