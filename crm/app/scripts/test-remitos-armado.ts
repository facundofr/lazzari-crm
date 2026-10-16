import { renglonesParaEntregar, estadoEntrega, cantidadesRemito, semaforoEnCamino, sugerirPRParaRemito, atarRenglones, numeroCorto, remitoDeLaFoto } from "../src/lib/remitos-armado";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

const pr = [
  { id: "a", descripcion: "Botín funcional", cantidad: 10, orden: 0 },
  { id: "b", descripcion: "Guante nitrilo", cantidad: 100, orden: 1 },
  { id: "c", descripcion: "Envío", cantidad: 1, orden: 2 },
];

// Nada remitido, OC atadas: a llegó todo, b llegó la mitad, c sin OC
let r = renglonesParaEntregar(pr, [], [
  { presupuesto_item_id: "a", cantidad: 10, cantidad_recibida: 10 },
  { presupuesto_item_id: "b", cantidad: 100, cantidad_recibida: 50 },
]);
ok(r[0].pendiente === 10 && r[0].disponible === 10, "a: llegó todo");
ok(r[1].disponible === 50, "b: llegó la mitad");
ok(r[2].disponible === null, "c: sin OC no se sabe");
ok(estadoEntrega(r) === "parcial", "parcial si falta llegar algo");
let c = cantidadesRemito(r, "llego");
ok(c.length === 3 && c[1].cantidad === 50 && c[2].cantidad === 1, "llegó: b 50 y c entero");
ok(cantidadesRemito(r, "todo")[1].cantidad === 100, "todo: b 100");

// Ya se remitió parte (uno atado, uno viejo por descripción + orden)
r = renglonesParaEntregar(pr, [
  { presupuesto_item_id: "a", cantidad: 4 },
  { presupuesto_item_id: null, descripcion: "Guante nitrilo", orden: 1, cantidad: 50 },
], [
  { presupuesto_item_id: "a", cantidad: 10, cantidad_recibida: 10 },
  { presupuesto_item_id: "b", cantidad: 100, cantidad_recibida: 50 },
]);
ok(r[0].remitido === 4 && r[0].pendiente === 6 && r[0].disponible === 6, "a: 6 pendientes y 6 disponibles");
ok(r[1].remitido === 50 && r[1].pendiente === 50 && r[1].disponible === 0, "b: lo que llegó ya se entregó");
ok(estadoEntrega(r) === "parcial", "sigue parcial");

// Remito viejo sin atar, con otro orden: se cruza por descripción (sin confundir talles)
const talles = [
  { id: "t43", descripcion: "BOTIN BORIS 3303 T43", cantidad: 2, orden: 1 },
  { id: "t44", descripcion: "BOTIN BORIS 3303 T44", cantidad: 2, orden: 2 },
  { id: "caf", descripcion: "CAFETERA DOLCE - GENIO S PLUS", cantidad: 1, orden: 3 },
];
r = renglonesParaEntregar(talles, [
  { presupuesto_item_id: null, descripcion: "BOTIN BORIS 3303 T43", orden: 2, cantidad: 2 },
  { presupuesto_item_id: null, descripcion: "CAFETERA DOLCE - GENIO S PLUS ", orden: 1, cantidad: 1 },
], []);
ok(r[0].remitido === 2 && r[1].remitido === 0 && r[2].remitido === 1, "cruce por descripción aunque cambie el orden, talle por talle");

// OC cancelada no cuenta
r = renglonesParaEntregar(pr.slice(0, 1), [], [{ presupuesto_item_id: "a", cantidad: 10, cantidad_recibida: 10, estado_oc: "cancelada" }]);
ok(r[0].disponible === null && estadoEntrega(r) === "sin_compra", "OC cancelada se ignora");

// Sin renglones atados pero todas las OC recibidas: listo
r = renglonesParaEntregar(pr, [], [], [{ estado: "recibida" }, { estado: "cancelada" }]);
ok(estadoEntrega(r) === "listo", "OC del PR recibidas = listo");
r = renglonesParaEntregar(pr, [], [], [{ estado: "recibida" }, { estado: "enviada" }]);
ok(estadoEntrega(r) === "sin_compra", "una OC sin recibir y sin renglones atados = no se sabe");

// Nada llegó
r = renglonesParaEntregar(pr.slice(0, 2), [], [{ presupuesto_item_id: "a", cantidad: 10, cantidad_recibida: 0 }, { presupuesto_item_id: "b", cantidad: 100 }]);
ok(estadoEntrega(r) === "esperando", "esperando");
ok(cantidadesRemito(r, "llego").length === 0, "llegó: nada");

// Todo entregado
r = renglonesParaEntregar(pr.slice(0, 1), [{ presupuesto_item_id: "a", cantidad: 10 }], []);
ok(estadoEntrega(r) === "completo", "completo");

// Semáforo
const hoy = Date.parse("2026-10-15T12:00:00Z");
ok(semaforoEnCamino("2026-10-14T12:00:00Z", hoy).color === "verde", "1 día verde");
ok(semaforoEnCamino("2026-10-12T12:00:00Z", hoy).color === "amarillo", "3 días amarillo");
ok(semaforoEnCamino("2026-10-05T12:00:00Z", hoy).color === "rojo", "10 días rojo");

// PR sugerido
const prs = [
  { id: "p1", numero: "PR-1", cliente_id: "cli", fecha: "2026-10-01", items: [{ id: "x", descripcion: "Botín funcional puntera acero" }, { id: "y", descripcion: "Guante nitrilo azul" }] },
  { id: "p2", numero: "PR-2", cliente_id: "cli", fecha: "2026-01-01", items: [{ id: "z", descripcion: "Casco blanco" }] },
  { id: "p3", numero: "PR-3", cliente_id: "otro", items: [{ id: "w", descripcion: "Botín funcional puntera acero" }] },
];
const s = sugerirPRParaRemito({ cliente_id: "cli", fecha: "2026-10-05", items: [{ descripcion: "Botin Funcional puntera acero" }, { descripcion: "Guante nitrilo azul" }] }, prs);
ok(s.length === 1 && s[0].pr_id === "p1" && s[0].motivo === "2 de 2 renglones iguales", "sugiere el PR del mismo cliente con renglones iguales");
ok(sugerirPRParaRemito({ cliente_id: null, items: [{ descripcion: "Casco" }] }, prs).length === 0, "sin cliente no sugiere");

// Atar renglones
const at = atarRenglones([{ id: "r1", descripcion: "Botín funcional puntera acero" }, { id: "r2", descripcion: "Algo raro" }], prs[0].items);
ok(at.r1 === "x" && !at.r2, "ata solo los parecidos");

// Foto
ok(numeroCorto("R-0001-00001234") === "1234" && numeroCorto("0015-00000077") === "77" && numeroCorto(null) === "", "número corto");
const rems = [
  { id: "1", numero: "R-0001-00001234", nro_comprobante_cai: 77, cliente: "Corteva Argentina" },
  { id: "2", numero: "R-0001-00001235", nro_comprobante_cai: 78, cliente: "Adecco" },
];
ok(remitoDeLaFoto({ numero: "1234" }, rems) === "1", "por número interno");
ok(remitoDeLaFoto({ numero: "0015-00000078" }, rems) === "2", "por número de CAI");
ok(remitoDeLaFoto({ numero: "9999", cliente: "CORTEVA ARGENTINA SRL" }, rems) === "1", "por cliente si el número no está");
ok(remitoDeLaFoto({ numero: "", cliente: "" }, rems) === null, "sin datos: pregunta");
console.log("TODO OK");
