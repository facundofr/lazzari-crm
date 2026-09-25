import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20260925223000_pagos_proveedores_atomicos.sql", import.meta.url), "utf8");
const start = source.indexOf("async function handleCreateOP()");
const end = source.indexOf("async function handleAnularOP", start);
const handler = source.slice(start, end);

assert.match(handler, /rpc\("registrar_pago_proveedor_seguro"/);
assert.match(handler, /p_modo:\s*"op"/);
assert.match(handler, /p_request_key:\s*opRequestKeyRef\.current/);
assert.match(handler, /deben seleccionarse desde la cartera/);
assert.doesNotMatch(handler, /from\("ordenes_pago"\)\.insert/);
assert.doesNotMatch(handler, /from\("op_facturas_compra"\)\.insert/);
assert.doesNotMatch(handler, /from\("movimientos"\)\.insert/);
assert.doesNotMatch(handler, /from\("echeqs"\)\.update/);

assert.match(sql, /insert into public\.ordenes_pago/);
assert.match(sql, /insert into public\.op_facturas_compra/);
assert.match(sql, /insert into public\.saldos_favor_proveedor/);
assert.match(sql, /saldo_a_favor/);
assert.match(sql, /for update;/);
assert.match(sql, /El cheque recibido ya no esta en cartera/);
assert.match(sql, /El cheque propio ya no esta pendiente/);
assert.match(sql, /El cheque recibido debe seleccionarse desde la cartera/);
assert.match(sql, /orden_pago_anula_saldo_favor/);

console.log("OK OP/e-cheqs: toda la saga usa una RPC; cartera y saldo a favor quedan en la misma transaccion.");
