import { armarRecepcion, estadoPorRecibido, ocDelRemito, seguroParaCargar } from "../src/lib/compras-recepcion";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

const items = [
  { id: "a", descripcion: "Camisa grafa", cantidad: 10, cantidad_recibida: 0 },
  { id: "b", descripcion: "Pantalón grafa", cantidad: "5", cantidad_recibida: "2" },
];

// Llega todo
let r = armarRecepcion(items, [{ item_id: "a", cantidad: 10 }, { item_id: "b", cantidad: 3 }]);
ok(r.estado === "recibida" && r.cargas.length === 2 && !r.faltan.length, "llega todo = recibida");
ok(r.cargas.find((c) => c.item_id === "b")!.despues === 5 && r.cargas.find((c) => c.item_id === "b")!.antes === 2, "suma a lo que ya había llegado");
ok(seguroParaCargar(r, true) && !seguroParaCargar(r, false), "seguro solo si la OC es segura");

// Llega una parte
r = armarRecepcion(items, [{ item_id: "a", cantidad: 4 }]);
ok(r.estado === "recibida_parcial" && r.faltan.length === 2 && r.faltan.find((f) => f.item_id === "a")!.cantidad === 6, "parcial y lo que falta");

// Mismo renglón dos veces
r = armarRecepcion(items, [{ item_id: "a", cantidad: 4 }, { item_id: "a", cantidad: 3 }]);
ok(r.cargas[0].cantidad === 7, "mismo renglón dos veces se suma");

// De más y sin atar
r = armarRecepcion(items, [{ item_id: "b", cantidad: 6 }, { item_id: null, descripcion: "Casco", cantidad: 2 }, { item_id: "zz", cantidad: 1 }]);
ok(r.cargas[0].despues === 5 && r.de_mas[0].cantidad === 3, "nunca pasa de lo pedido, lo de más es aviso");
ok(r.sin_atar.length === 2 && !seguroParaCargar(r, true), "sin atar = no se carga solo");
ok(armarRecepcion(items, [{ item_id: "a", cantidad: 0 }]).cargas.length === 0, "cantidad 0 no carga");
ok(armarRecepcion([{ id: "x", cantidad: 3, cantidad_recibida: 3 }], [{ item_id: "x", cantidad: 1 }]).cargas.length === 0, "renglón ya completo no carga");

// Estado para Deshacer
ok(estadoPorRecibido([{ id: "a", cantidad: 2, cantidad_recibida: 0 }], "recibida_parcial") === "enviada", "nada recibido vuelve a enviada");
ok(estadoPorRecibido([{ id: "a", cantidad: 2, cantidad_recibida: 0 }], "aprobada") === "aprobada", "respeta el estado que no es de recepción");
ok(estadoPorRecibido([{ id: "a", cantidad: 2, cantidad_recibida: 1 }], "recibida") === "recibida_parcial", "algo recibido = parcial");

// A qué OC corresponde
const ocs = [
  { id: "o1", numero: "OC-2026-0123", proveedor: "Funcional SA", proveedor_cuit: "30-71111111-1" },
  { id: "o2", numero: "OC-2026-0124", proveedor: "Funcional SA", proveedor_cuit: "30-71111111-1" },
  { id: "o3", numero: "OC-2026-0200", proveedor: "Mediglove SRL", proveedor_cuit: "30-72222222-2" },
];
ok(ocDelRemito({ oc_id: "o2" }, ocs) === "o2", "la IA dice la OC");
ok(ocDelRemito({ oc_id: "nada", oc_numero: "Su OC 124" }, ocs) === "o2", "por número de OC leído");
ok(ocDelRemito({ proveedor: "Funcional" }, ocs) === null, "proveedor con dos OC = duda");
ok(ocDelRemito({ proveedor_cuit: "30722222222" }, ocs) === "o3", "por CUIT con una sola OC");
ok(ocDelRemito({}, ocs) === null, "sin datos no inventa");
console.log("TODO OK");
