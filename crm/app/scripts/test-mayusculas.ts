// Prueba rápida de lib/mayusculas.ts (correr con: npx tsx scripts/test-mayusculas.ts)
import assert from "node:assert/strict";
import { arreglarMayusculas, estaEnMayusculas, nombrePropio, textoArticulo } from "../src/lib/mayusculas";

assert.equal(nombrePropio("AMOBLAMIENTOS NEXO DE GARBUGLIO SEBASTIAN LEOPOLDO Y DEBERNARDI DANIEL ALBERTO"), "Amoblamientos Nexo de Garbuglio Sebastian Leopoldo y Debernardi Daniel Alberto");
assert.equal(nombrePropio("CORTEVA ARGENTINA S.R.L."), "Corteva Argentina S.R.L.");
assert.equal(nombrePropio("DEL SOL SA"), "Del Sol SA");
assert.equal(nombrePropio("YPF SOCIEDAD ANONIMA"), "YPF Sociedad Anonima");
assert.equal(nombrePropio("Grupo LA"), "Grupo LA"); // ya escrito a mano: no se toca
assert.equal(nombrePropio("3M ARGENTINA SACIFIA"), "3M Argentina SACIFIA");
assert.equal(nombrePropio(null), "");
assert.equal(nombrePropio("ALONSO HNOS SIRENAS S A"), "Alonso Hnos Sirenas S A");
assert.equal(nombrePropio("ROSARIO SUD"), "Rosario Sud");
assert.equal(nombrePropio("OILFIELD &amp; PRODUCTION SERVICES SRL"), "Oilfield & Production Services SRL");
assert.equal(nombrePropio("AV. SAN MARTIN 1234"), "Av. San Martin 1234");

assert.equal(textoArticulo("MESA DE REUNIONES 1,60 X 0,90 X 0,75 MTS BASE METÁLICA"), "Mesa de reuniones 1,60 x 0,90 x 0,75 mts base metálica");
assert.equal(textoArticulo("OPCIONAL CAJA PORTA TOMA DE 2 BOCAS"), "Opcional caja porta toma de 2 bocas");
assert.equal(textoArticulo("BOTIN DE SEGURIDAD OMBU PUNTERA ACERO T 40"), "Botin de seguridad Ombú puntera acero T 40".replace("Ombú", "Ombu"));
assert.equal(textoArticulo("RESPIRADOR 3M 8210 N95"), "Respirador 3M 8210 N95");
assert.equal(textoArticulo("GUANTE NITRILO EN 388 TALLE XL"), "Guante nitrilo EN 388 talle XL");
assert.equal(textoArticulo("CAMISA GRAFA 70 AZUL - TALLE 44/46"), "Camisa Grafa 70 azul - talle 44/46");
assert.equal(textoArticulo("ROPA EN STOCK"), "Ropa en stock");
assert.equal(textoArticulo("EPP PARA ALTURA"), "EPP para altura");
assert.equal(textoArticulo("ADAPTADOR P/ FILTROS 3M"), "Adaptador p/ filtros 3M");
assert.equal(textoArticulo("Guante de nitrilo"), "Guante de nitrilo");

assert.equal(estaEnMayusculas("NBR"), true);
assert.equal(estaEnMayusculas("ab"), false);

const filas = arreglarMayusculas([
  { numero: "PR-1", clientes: { razon_social: "DEL SOL SA" }, presupuesto_items: [{ descripcion: "GUANTE DE NITRILO" }] },
  { descripcion: "TRANSFERENCIA RECIBIDA" },
]);
assert.equal(filas[0].clientes!.razon_social, "Del Sol SA");
assert.equal(filas[0].presupuesto_items![0].descripcion, "Guante de nitrilo");
assert.equal(filas[1].descripcion, "TRANSFERENCIA RECIBIDA"); // otra tabla: no se toca
assert.equal(arreglarMayusculas([{ nombre: "JUAN PEREZ" }], "contactos")[0].nombre, "Juan Perez");
assert.equal(arreglarMayusculas([{ nombre: "GRUPO LA" }], "sociedades")[0].nombre, "GRUPO LA");

console.log("test-mayusculas OK");
