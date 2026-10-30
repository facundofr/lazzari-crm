import assert from "node:assert/strict";
import { filtrarPorNombreODestino } from "../src/lib/transportes-destinos";

const lista = [
  { nombre: "CARLOS CACERES", destinos: "Junín, Córdoba" },
  { nombre: "Transporte Hero S.R.L.", destinos: "Rosario, Santa Fe" },
  { nombre: "JOSE ALVAREZ", destinos: null },
];
assert.equal(filtrarPorNombreODestino(lista, "").length, 3);
assert.deepEqual(filtrarPorNombreODestino(lista, "cordoba").map((t) => t.nombre), ["CARLOS CACERES"]);
assert.deepEqual(filtrarPorNombreODestino(lista, "CÓRDOBA").map((t) => t.nombre), ["CARLOS CACERES"]);
assert.deepEqual(filtrarPorNombreODestino(lista, "hero rosario").map((t) => t.nombre), ["Transporte Hero S.R.L."]);
assert.equal(filtrarPorNombreODestino(lista, "mendoza").length, 0);
console.log("test-transportes-destinos OK");
