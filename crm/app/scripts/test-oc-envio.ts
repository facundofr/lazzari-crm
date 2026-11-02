// Prueba: reclamo de lo que falta de una OC (Compras Lazza, Tanda 6): solo lo pendiente, sin precios.
import { reclamoDeOC } from "../src/lib/oc-envio";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
const oc = { numero: "OC-2026-0500", fecha: "2026-10-20" };
ok(reclamoDeOC(oc, [{ descripcion: "Guante", cantidad: 10, cantidad_recibida: 10 }]) === null, "llegó todo: no hay reclamo");
let t = reclamoDeOC(oc, [{ codigo: "G1", descripcion: "Guante", cantidad: 10, cantidad_recibida: 4, unidad: "par" }, { descripcion: "Casco", cantidad: 2, cantidad_recibida: 2 }])!;
ok(t.includes("Ya recibimos una parte") && t.includes("1. G1 - Guante\n   Falta: 6 par") && !t.includes("Casco"), "parcial: solo lo que falta");
ok(!/\$|precio/i.test(t) && t.includes("OC-2026-0500"), "sin precios y con el N° de OC");
t = reclamoDeOC(oc, [{ descripcion: "Botín", cantidad: "3", cantidad_recibida: null }])!;
ok(t.includes("Todavía no recibimos el pedido") && t.includes("Falta: 3"), "nada llegó");
ok(reclamoDeOC(oc, [{ descripcion: "Faja", cantidad: 1.5, cantidad_recibida: 1.2 }])!.includes("Falta: 0.3"), "decimales redondeados");
console.log("OK oc-envio");
