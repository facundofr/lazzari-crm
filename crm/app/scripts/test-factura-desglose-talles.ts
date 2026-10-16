import { detectarDesgloseTalles, textoTalles } from "../src/lib/factura-desglose-talles";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

// Caso real OC-2026-1247 / factura Mariana 0012-00012783 (16/10/2026).
const fac = [39, 40, 41, 42, 43, 44].map((t, i) => ({ key: `f${t}`, descripcion: `BOT.PR.BOX.NGRO PCV NVA CP PRUSIANO NRO ${t}`, cantidad: [3, 8, 6, 10, 3, 5][i], precio: 27287 }));
const oc = [{ id: "oc1", descripcion: "PRUSIANO · PVC · Negro", cantidad: 35, precio: 25922.84 }];
let d = detectarDesgloseTalles(fac, oc);
ok(d.length === 1 && d[0].ocId === "oc1" && d[0].keys.length === 6, "los 6 talles van al renglón de la OC");
ok(d[0].coincide && d[0].total === 35, "la cantidad coincide (35)");
ok(textoTalles(d[0]) === "39×3, 40×8, 41×6, 42×10, 43×3, 44×5", "texto de talles ordenado");

// Vienen solo algunos talles: igual se agrupa (no coincide la cantidad).
d = detectarDesgloseTalles(fac.slice(0, 3), oc);
ok(d.length === 1 && !d[0].coincide && d[0].total === 17, "parcial: 17 de 35");

// Se pasa de la OC: no se agrupa.
ok(detectarDesgloseTalles(fac, [{ ...oc[0], cantidad: 20 }]).length === 0, "si se pasa de la OC no agrupa");

// Sin palabras en común: no se agrupa.
ok(detectarDesgloseTalles(fac, [{ id: "x", descripcion: "Guante nitrilo", cantidad: 35, precio: 1 }]).length === 0, "otro artículo no agrupa");

// La OC ya viene por talle: no aplica (lo resuelve la comparación normal).
ok(detectarDesgloseTalles(fac, [{ id: "t", descripcion: "PRUSIANO PVC NEGRO T40", cantidad: 35, precio: 1 }]).length === 0, "OC con talle no aplica");

// Dos renglones posibles en la OC: elige el que da justo.
d = detectarDesgloseTalles(fac, [{ id: "a", descripcion: "Bota PRUSIANO negra", cantidad: 50, precio: 1 }, { id: "b", descripcion: "PRUSIANO PVC negro", cantidad: 35, precio: 1 }]);
ok(d.length === 1 && d[0].ocId === "b", "con dos posibles elige el que da justo");

// Un solo talle no es desglose.
ok(detectarDesgloseTalles(fac.slice(0, 1), oc).length === 0, "un talle solo no agrupa");
console.log("TODO OK");
