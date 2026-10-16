// Preguntas cortas de la conciliación con los casos reales del 16/10 (Mariana por talle, Fujiwara, renglón sin OC).
// Uso (desde crm/app): npx tsx scripts/test-conciliacion-preguntas.ts
import assert from "node:assert/strict";
import { matchPurchaseLines, heuristicEquivalences } from "../src/lib/purchase-matching";
import { armarPreguntas } from "../src/lib/conciliacion-preguntas";

const plata = (n: number) => `$${n.toLocaleString("es-AR")}`;
const preguntas = (inv: any[], ocs: any[], extra: Partial<Parameters<typeof armarPreguntas>[0]> = {}) => {
  const resultado = matchPurchaseLines(inv, ocs, heuristicEquivalences(inv, ocs));
  return armarPreguntas({ lineas: inv, resultado, ocLineas: ocs, manual: {}, confianza: {}, revisadas: new Set(), plata, ...extra });
};

// Mariana: 6 talles → UNA sola pregunta, con el precio y "vienen 31 de 35"; y otra: ¿los 4 que faltan llegan después?
const talles = [39, 40, 41, 42, 43, 44], cant = [3, 8, 6, 10, 1, 3];
const mariana = talles.map((t, i) => ({ key: `m${t}`, codigo: `111040${t}`, descripcion: `BOT.PR.BOX.NGRO PCV NVA CP PRUSIANO NRO ${t}`, cantidad: cant[i], precio: 27287 }));
const oc1247 = [{ id: "oc1", ocId: "A", ocNumero: "OC-2026-1247", ocFecha: "2026-10-15", codigo: null, descripcion: "PRUSIANO · PVC · Negro", cantidad: 35, precio: 25922.84 }];
let p = preguntas(mariana, oc1247);
assert.equal(p.length, 2, "una pregunta para los 6 talles y otra por lo que falta");
assert.equal(p[0].keys.length, 6);
assert.match(p[0].texto, /vienen 31 de 35/);
assert.match(p[0].texto, /\+5,26 %/);
assert.deepEqual(p[0].opciones.map(o => o.accion.tipo), ["aceptar_costo", "reclamar", "fuera"]);
assert.match(p[1].texto, /de la OC-2026-1247: vienen 31 de 35 \(faltan 4\)/);
assert.deepEqual(p[1].opciones.map(o => o.label), ["Llegan después", "Cerrar la OC en 31"]);
assert.deepEqual(p[1].opciones[1].accion, { tipo: "cerrar_oc", ocId: "A", ocNumero: "OC-2026-1247", motivo: "Vinieron 31 de 35; el resto no llega" });
// Ya respondidas: no pregunta más.
p = preguntas(mariana, oc1247, { revisadas: new Set(mariana.map(l => l.key)), ocsRespondidas: new Set(["A"]) });
assert.equal(p.length, 0);
// OC con varios renglones pendientes: una sola pregunta por OC.
const ocVarios = [
  { id: "v1", ocId: "C", ocNumero: "OC-2026-1400", ocFecha: "2026-10-15", codigo: "G1", descripcion: "GUANTE NITRILO", cantidad: 10, precio: 100 },
  { id: "v2", ocId: "C", ocNumero: "OC-2026-1400", ocFecha: "2026-10-15", codigo: "A1", descripcion: "ANTEOJO CLARO", cantidad: 5, precio: 200 },
];
p = preguntas([{ key: "g", codigo: "G1", descripcion: "GUANTE NITRILO", cantidad: 8, precio: 100 }], ocVarios);
assert.equal(p.length, 1);
assert.match(p[0].texto, /OC-2026-1400: vienen 8 de 15 \(faltan 7 en 2 renglones/);

// Fujiwara: cierra solo, sin preguntas.
const fuji = [
  { key: "f1", codigo: "4047BNFS24", descripcion: "Botín Bidensidad Cuero Descarne Graneado con punte", cantidad: 12, precio: 31030 },
  { key: "f2", codigo: "4047BNFS24", descripcion: "Botín Bidensidad Cuero Descarne Graneado con punte", cantidad: 4, precio: 31030 },
  { key: "f3", codigo: "4047bnfs24", descripcion: "4047bnfs24", cantidad: 4, precio: 31030 },
];
const oc1252 = [{ id: "oc2", ocId: "B", ocNumero: "OC-2026-1252", ocFecha: "2026-10-15", codigo: null, descripcion: "BOTIN DE SEGURIDAD FUJIWARA 4047BNFS2400", cantidad: 20, precio: 31030 }];
assert.equal(preguntas(fuji, oc1252).length, 0, "Fujiwara cierra sin preguntas");

// Renglón que no está en ninguna OC: pregunta con la OC sugerida si la hay.
const casco = [{ key: "c1", codigo: null, descripcion: "CASCO LIBUS BLANCO", cantidad: 2, precio: 9000 }];
p = preguntas(casco, oc1252);
assert.equal(p.length, 1);
assert.deepEqual(p[0].opciones.map(o => o.accion.tipo), ["fuera"]);
p = preguntas(casco, oc1252, { sugerenciaSinOc: new Map([["c1", { ocLineId: "oc9", ocNumero: "OC-2026-1300", descripcion: "CASCO LIBUS", libre: 5 }]]) });
assert.deepEqual(p[0].opciones[0].accion, { tipo: "asignar", ocLineId: "oc9", cantidad: 2 });

// Flete: pregunta si se suma a la OC de esa factura o va aparte (Augusto 16/10).
const conFlete = [...fuji.map(l => ({ ...l, facturaRef: "0001-9" })), { key: "fl", facturaRef: "0001-9", codigo: null, descripcion: "FLETE", cantidad: 1, precio: 15000 }];
p = preguntas(conFlete, oc1252);
assert.equal(p.length, 1, "solo la pregunta del flete");
assert.match(p[0].texto, /¿Lo sumo a la OC-2026-1252\?/);
assert.deepEqual(p[0].opciones.map(o => o.accion), [{ tipo: "flete_oc", ocId: "B", ocNumero: "OC-2026-1252" }, { tipo: "fuera" }]);
// Flete solo, sin artículos que crucen: no hay OC para ofrecer, va aparte.
p = preguntas([{ key: "fl", facturaRef: "0001-8", codigo: null, descripcion: "Envío", cantidad: 1, precio: 9000 }], oc1252);
assert.deepEqual(p[0].opciones.map(o => o.accion.tipo), ["fuera"]);

console.log("OK: preguntas (Mariana 1 pregunta con precio y talles + faltantes llegan después/cerrar OC, Fujiwara ninguna, sin OC con sugerencia, flete: sumar a la OC o aparte).");
