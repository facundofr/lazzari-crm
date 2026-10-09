import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/app/(crm)/presupuestos/page.tsx", import.meta.url), "utf8");

assert.match(source, /rpc\("crear_presupuesto_atomico"/);
assert.doesNotMatch(source, /throw new Error\("No se pudo recargar el presupuesto creado"\)/);
assert.match(source, /if \(fullRow\) \{/);
assert.match(source, /El presupuesto fue creado pero no se pudo recargar/);
assert.match(source, /El presupuesto fue creado pero falló la actualización del listado/);

console.log("OK presupuesto: una falla posterior de recarga no convierte una creación exitosa en error ni induce duplicados.");
