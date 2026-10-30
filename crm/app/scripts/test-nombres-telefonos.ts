import assert from "node:assert/strict";
import { nombrePropio, telefonoAR, telefonoARevisar } from "../src/lib/nombres-telefonos";

// Nombres
assert.equal(nombrePropio("CARLOS ANDRES CACERES"), "Carlos Andres Caceres");
assert.equal(nombrePropio("COOPERATIVA DE TRABAJO MILONGUITAS LIMITADA"), "Cooperativa de Trabajo Milonguitas Limitada");
assert.equal(nombrePropio("SPEED BUSINESS S. A."), "Speed Business S. A.");
assert.equal(nombrePropio("B.I.D. ARGENTINA S.A."), "B.I.D. Argentina S.A.");
assert.equal(nombrePropio("LUSTROL ARGENTINA S. R. L."), "Lustrol Argentina S. R. L.");
assert.equal(nombrePropio("FUNDACION JOSE A BALSEIRO"), "Fundacion Jose A Balseiro");
assert.equal(nombrePropio("CONTE HNOS Y CIA S A"), "Conte Hnos y Cia S A");
assert.equal(nombrePropio("DIGITAL STRATEGY S.A.S."), "Digital Strategy S.A.S.");
assert.equal(nombrePropio("CORTEVA SEEDS ARGENTINA SRL"), "Corteva Seeds Argentina SRL");
assert.equal(nombrePropio("DEL SOL SA"), "Del Sol SA");
assert.equal(nombrePropio("DANIELA CECILIA DEL FRADE"), "Daniela Cecilia del Frade");
assert.equal(nombrePropio("ALBERTO FRANCISCO ANDRES Y CIA. S.R.L."), "Alberto Francisco Andres y Cia. S.R.L.");
assert.equal(nombrePropio("ESTACION DE SERVICIO RUTA 7"), "Estacion de Servicio Ruta 7");
assert.equal(nombrePropio("JUAN PABLO II"), "Juan Pablo II");
assert.equal(nombrePropio("PEÑA MUÑOZ"), "Peña Muñoz");
assert.equal(nombrePropio("O'BRIEN"), "O'Brien");
assert.equal(nombrePropio("juan perez"), "Juan Perez");
assert.equal(nombrePropio("JULIO CERNUDA (INGRID MARTIN)"), "Julio Cernuda (Ingrid Martin)");
assert.equal(nombrePropio("Transporte de Cargas Mayo S.R.L."), "Transporte de Cargas Mayo S.R.L."); // ya escrito: no se toca
assert.equal(nombrePropio("SPEED BUSINESS (Credifin)"), "SPEED BUSINESS (Credifin)"); // mezcla: no se toca
assert.equal(nombrePropio("  ACME   SA "), "Acme SA");
assert.equal(nombrePropio(""), "");
assert.equal(nombrePropio(null), "");

// Teléfonos
assert.equal(telefonoAR("3518354530.0"), "351 8354530");
assert.equal(telefonoAR("01133968405"), "11 33968405");
assert.equal(telefonoAR("2474 490295"), "2474 490295");
assert.equal(telefonoAR("54 9 2477 59-5219"), "2477 595219");
assert.equal(telefonoAR("5492474409554"), "2474 409554");
assert.equal(telefonoAR("(54-11) 4125-8729"), "11 41258729");
assert.equal(telefonoAR("2215 553894"), "221 5553894");
assert.equal(telefonoAR("1164550163"), "11 64550163");
assert.equal(telefonoAR("+54 9 11 6455-0163"), "11 64550163");
assert.equal(telefonoAR("2477 60-7410"), "2477 607410");
assert.equal(telefonoAR("2477 607410"), "2477 607410"); // ya está bien
assert.equal(telefonoAR("2477 15 68-8498"), "2477 688498"); // con 15
assert.equal(telefonoAR("336 4319942.0"), "336 4319942"); // San Nicolás
assert.equal(telefonoAR("239240263.0"), "239240263.0"); // le falta un número: se deja
assert.equal(telefonoAR("2477 123456 / 2477 654321"), "2477 123456 / 2477 654321"); // dos teléfonos: se deja
assert.equal(telefonoAR(""), "");
assert.equal(telefonoARevisar("239240263.0"), true);
assert.equal(telefonoARevisar("3518354530.0"), false);
assert.equal(telefonoARevisar(""), false);

console.log("OK: nombres y teléfonos");
