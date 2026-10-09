import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/(crm)/muestras/page.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261010100000_compras_pagos_personalizacion_muestras_bcra.sql", import.meta.url), "utf8");

assert.match(page, /fecha_devolucion/, "la UI debe guardar la fecha de devolución / cierre");
assert.match(page, /precio_unitario/, "la entrega debe admitir un valor opcional por muestra");
assert.match(page, /moneda: "ARS" as "ARS" \| "USD"/, "el valor opcional debe declarar su moneda");
assert.match(page, /label: "En el cliente"/, "el estado inicial visible es En el cliente");
assert.match(page, /producto_id: null/, "los renglones nuevos no dependen del inventario de muestras");
assert.match(page, /cantidad_vendida/, "debe poder registrarse 'Se la quedó'");
assert.match(page, /cantidad_baja/, "debe poder registrarse baja / regalo");
assert.match(page, /DIAS_ALERTA = 30/, "aviso a los 30 días");
assert.match(migration, /alter column producto_id drop not null/i, "la migración permite renglones libres");
assert.match(migration, /'cerrado'/, "la migración agrega el estado Cerrado");

console.log("OK: muestras con renglones libres, valor opcional, Devolvió / Se la quedó / Baja y aviso de 30 días.");
