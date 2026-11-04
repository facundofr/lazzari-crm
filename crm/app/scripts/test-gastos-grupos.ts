// Pestañas de Gastos editables (03/11/2026): lib/gastos-grupos + grupoDe con pestañas nuevas + clasificarGasto con la línea elegida.
import assert from "node:assert/strict";
import { GRUPOS_BASE, armarGrupos, claveNueva, clavesExtra, conLineaDeGrupo, errorNombre, gruposElegibles, moverGrupo, nombreDeGrupo } from "../src/lib/gastos-grupos";
import { armarFilasGastos, grupoDe, totalesPorGrupo, type GastoRow } from "../src/lib/gastos-lazza";
import { clasificarGasto } from "../src/lib/contabilidad";

// Sin tabla: las 9 de siempre, con "Sueldos" y "Augusto", sin línea elegida (regla de siempre).
const base = armarGrupos(null);
assert.equal(base.length, 9);
assert.deepEqual(base.map((g) => g.nombre).slice(0, 3), ["Sueldos", "Premios", "Transportes"]);
assert.equal(nombreDeGrupo(base, "Personales"), "Augusto");
assert.ok(base.every((g) => g.linea === null && g.base));
assert.deepEqual(clavesExtra(base), []);

// Con la tabla: orden, renombre, oculta, pestaña nueva con línea; las de base que falten se agregan.
const filas = [
  ...GRUPOS_BASE.filter((g) => g.clave !== "Premios").map((g) => ({ ...g, id: g.clave })),
  { id: "x1", clave: "Sistemas", nombre: "Sistemas y software", orden: 0, linea: "administrativos", oculto: false, base: false },
  { id: "x2", clave: "Raro", nombre: "Raro", orden: 20, linea: "ventas", oculto: true, base: false },
];
filas.find((f) => f.clave === "Operativos")!.nombre = "Varios";
const g = armarGrupos(filas);
assert.equal(g[0].clave, "Sistemas", "orden de la tabla");
assert.equal(g.find((x) => x.clave === "Raro")!.linea, null, "una línea que no se puede elegir no vale");
assert.ok(g.some((x) => x.clave === "Premios"), "la de base que falta se agrega");
assert.equal(nombreDeGrupo(g, "Operativos"), "Varios");
assert.deepEqual(clavesExtra(g).sort(), ["Raro", "Sistemas"]);
assert.ok(!gruposElegibles(g).some((x) => x.clave === "Transportes" || x.clave === "Raro"), "sin Transportes ni ocultas");
assert.ok(gruposElegibles(g, "Raro").some((x) => x.clave === "Raro"), "la oculta sigue si el gasto ya está ahí");

// grupoDe: la clave nueva se respeta solo si se la pasan; si no, sale de la categoría (como antes).
assert.equal(grupoDe({ grupo: "Sistemas", categoria: "Sistemas" }), "Operativos");
assert.equal(grupoDe({ grupo: "Sistemas", categoria: "Sistemas" }, clavesExtra(g)), "Sistemas");
const gasto = (x: Partial<GastoRow>): GastoRow => ({ id: "1", fecha: "2026-10-05", descripcion: "Licencia", categoria: "Sistemas", grupo: "Sistemas", monto: 100, moneda: "ARS", medio_pago: "transferencia", tipo_recurrencia: "eventual", gasto_fijo_id: null, ...x });
const fs = armarFilasGastos([gasto({}), gasto({ id: "2", grupo: "Operativos", categoria: "Operativos", monto: 50 })], [], clavesExtra(g));
const tot = totalesPorGrupo(fs, g.map((x) => x.clave));
assert.equal(tot[0].grupo, "Sistemas");
assert.equal(tot[0].ARS, 100);
assert.equal(tot.find((t) => t.grupo === "Operativos")!.ARS, 50);

// Contabilidad: la línea elegida manda; sin línea, la regla de siempre (Mariana, Inga, ARBA siguen igual).
const conLinea = conLineaDeGrupo([gasto({}), gasto({ id: "3", grupo: "Profesionales", categoria: "profesionales", descripcion: "Natalia Inga octubre" })], g);
assert.equal(clasificarGasto(conLinea[0]), "administrativos");
assert.equal(clasificarGasto(conLinea[1]), "consultoria", "Profesionales sin línea elegida: regla de siempre");
const g2 = armarGrupos(filas.map((f) => (f.clave === "Sistemas" ? { ...f, linea: "retiros" } : f.clave === "Premios" ? f : f)));
assert.equal(clasificarGasto(conLineaDeGrupo([gasto({})], g2)[0]), "retiros");
assert.equal(clasificarGasto(conLineaDeGrupo([gasto({ descripcion: "ARBA plan de pagos cuota 3" })], armarGrupos(filas))[0]), "retiros", "ARBA plan de pagos: retiro igual");
// Las 9 de base sin línea elegida: ningún gasto cambia (octubre igual).
const ejemplos = [
  { grupo: "Personal", categoria: "sueldos", descripcion: "Sueldo Mariana Santinelli octubre" },
  { grupo: "Personal", categoria: "comisiones", descripcion: "Comisión José" },
  { grupo: "Premios", categoria: "premios", descripcion: "Premio Sebastián" },
  { grupo: "Impuestos", categoria: "impuestos", descripcion: "Compra de crédito fiscal" },
  { grupo: "Impuestos", categoria: "impuestos", descripcion: "Despacho importación" },
  { grupo: "Bancos y financieros", categoria: "bancarios", descripcion: "Mantenimiento" },
  { grupo: "Personales", categoria: "personales", descripcion: "Seguro auto" },
  { grupo: "Operativos", categoria: "compras sin factura", descripcion: "Reintegro" },
];
for (const e of ejemplos) assert.equal(clasificarGasto(conLineaDeGrupo([e], armarGrupos(null))[0]), clasificarGasto(e), e.descripcion);

// Nombres y claves.
assert.equal(errorNombre("  ", g), "Poné un nombre.");
assert.match(errorNombre("sistemas y SOFTWARE", g)!, /Ya hay/);
assert.match(errorNombre("Augusto", g)!, /Ya hay/, "choca con el nombre que se ve");
assert.equal(errorNombre("Varios", g, "Operativos"), null, "renombrar con su propio nombre");
assert.equal(claveNueva("Marketing", g), "Marketing");
assert.equal(claveNueva("operativos", g), "operativos 2", "no repite una clave existente");

// Mover: intercambia con la vecina y devuelve solo las que cambian.
const orden = [{ ...base[0], orden: 1 }, { ...base[1], orden: 2 }, { ...base[2], orden: 3 }];
assert.deepEqual(moverGrupo(orden, "Premios", -1), [{ clave: "Premios", orden: 1 }, { clave: "Personal", orden: 2 }]);
assert.deepEqual(moverGrupo(orden, "Personal", -1), [], "la primera no sube");

console.log("test-gastos-grupos OK");
