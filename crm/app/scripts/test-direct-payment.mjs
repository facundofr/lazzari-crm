import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20260925223000_pagos_proveedores_atomicos.sql", import.meta.url), "utf8");
const start = source.indexOf("async function handleRegistrarPagoParcialDirecto()");
const end = source.indexOf("async function handleToggleSobreVerde", start);
const handler = source.slice(start, end);

assert.match(handler, /rpc\("registrar_pago_proveedor_seguro"/);
assert.match(handler, /p_modo:\s*"directo"/);
assert.match(handler, /p_request_key:\s*opRequestKeyRef\.current/);
assert.match(handler, /p_facturas:\s*\[\{ id: fc\.id, monto: roundPaymentMoney\(bruto\) \}\]/);
assert.match(handler, /p_retencion_monto:\s*roundPaymentMoney\(retencion\)/);
assert.match(handler, /p_base_retencion:\s*roundPaymentMoney\(opBaseSinIVA\)/);
assert.doesNotMatch(handler, /from\("movimientos"\)\.insert/);
assert.doesNotMatch(handler, /from\("facturas_compra"\)/);

assert.match(sql, /p_modo = 'directo' and jsonb_array_length\(p_facturas\) <> 1/);
assert.match(sql, /for update of f/);
assert.match(sql, /sum\(m\.monto \+ coalesce\(m\.retencion_ganancias_monto, 0\)\)/);
assert.match(sql, /join public\.ordenes_pago op on op\.id = a\.orden_pago_id/);
assert.match(sql, /op\.estado <> 'anulada'/);
assert.match(sql, /El pago directo debe ser parcial/);
assert.match(sql, /insert into public\.movimientos[\s\S]*?'pago'/);
assert.match(sql, /'retencion_ganancias'/);
assert.match(sql, /unique \(sociedad_id, request_key\)/);
assert.match(sql, /v_existing\.payload <> v_payload/);
assert.match(sql, /us\.sociedad_id = p_sociedad_id/);
assert.doesNotMatch(sql, /p_medios::text/);
assert.match(sql, /p_medios->0->>'tipo',\s*p_medios,/);

console.log("OK pago directo: RPC unica, saldo bajo lock, pago+retencion atomicos, sociedad e idempotencia.");
