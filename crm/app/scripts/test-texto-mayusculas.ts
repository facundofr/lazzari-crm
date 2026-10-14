import assert from "node:assert/strict";
import { mayusculasNecesarias as m } from "../src/lib/texto-mayusculas";

// Todo en mayúscula: queda en mayúscula y minúscula; códigos, siglas, romanos y marcas se respetan.
assert.equal(m("PROTECTOR AUDITIVO OPTIME II H520P3E  CASCO"), "Protector auditivo Optime II H520P3E  casco");
assert.equal(m("PANTALON CHINO - TALLE 30 - NEGRO"), "Pantalon chino - Talle 30 - Negro");
assert.equal(m("WXEHA24A - ARNES IRAM 4 PUNTOS DE ANCLAJE"), "WXEHA24A - Arnes IRAM 4 puntos de anclaje");
assert.equal(m("DELTA PLUS - BOTA ALBATROS DE SEGURIDAD - CON PUNTERA"), "Delta Plus - Bota albatros de seguridad - Con puntera");
assert.equal(m("BOTA S/PUNTERA - OMBU"), "Bota s/puntera - Ombú");
assert.equal(m("G201NE - GUANTE TEJIDO PU"), "G201NE - Guante tejido PU");
assert.equal(m("Mameluco para quimicos TYCHEM 2000 DUPONT XL"), "Mameluco para quimicos TYCHEM 2000 DUPONT XL"); // ya tiene minúsculas
// Lo que ya viene bien escrito no se toca.
assert.equal(m("Mapa · Guantes · ULTRANE 548 Tejido poliamida | Poliuretano Negro"), "Mapa · Guantes · ULTRANE 548 Tejido poliamida | Poliuretano Negro");
assert.equal(m("3M · Seguridad Ocupacional · Carcasa H700 blanco con reflectiva"), "3M · Seguridad Ocupacional · Carcasa H700 blanco con reflectiva");
// Textos cortos o abreviados quedan como están.
assert.equal(m("ANT. FLEX O/I"), "ANT. FLEX O/I");
assert.equal(m("CUBRE NUCA"), "Cubre nuca");
assert.equal(m(""), "");
assert.equal(m(null), "");
console.log("texto-mayusculas OK");
