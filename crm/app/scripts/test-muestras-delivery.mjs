import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/(crm)/muestras/page.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260925150000_muestras_delivery_fields.sql", import.meta.url), "utf8");

assert.match(page, /fecha_devolucion/, "la UI debe leer y guardar la fecha de devolución");
assert.match(page, /precio_unitario/, "la entrega debe admitir un precio opcional por muestra");
assert.match(page, /moneda: \"ARS\" as \"ARS\" \| \"USD\"/, "el precio opcional debe declarar su moneda");
assert.match(page, /label: \"Entregado\"/, "el estado visible inicial debe ser Entregado");
assert.match(page, /registrarDevolucion\(item, returnDraft\[item\.id\] \|\| 0, returnDateDraft/, "la devolución debe exigir y persistir una fecha");
assert.match(migration, /add column if not exists fecha_devolucion date/, "la migración debe agregar fecha_devolucion");
assert.match(migration, /add column if not exists precio_unitario numeric\(15,2\)/, "la migración debe agregar precio opcional");
assert.match(migration, /check \(moneda in \('ARS', 'USD'\)\)/, "la moneda debe quedar restringida");

console.log("OK: muestras admite entrega, precio opcional y devolución fechada.");
