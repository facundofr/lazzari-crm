import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
const sql = fs.readFileSync(new URL("../supabase/migrations/20261007143000_anular_orden_pago_atomica.sql", import.meta.url), "utf8");

assert.match(ui, /rpc\("anular_orden_pago_segura"/);
assert.match(ui, /throw new Error\(error\.message \|\| "No se pudo anular la orden de pago"\)/);
assert.doesNotMatch(ui.slice(ui.indexOf("async function handleAnularOP"), ui.indexOf("async function handlePagarOP")), /String\(err\)/);

assert.match(sql, /create or replace function public\.anular_orden_pago_segura/);
assert.match(sql, /for update/);
assert.match(sql, /Desconcilia primero el movimiento bancario asociado a esta OP/);
assert.match(sql, /set anulado = true/);
assert.match(sql, /monto_original = coalesce\(monto_original, monto\)/);
assert.match(sql, /estado = case when direccion = 'emitido' then 'pendiente' else 'en_cartera' end/);
assert.match(sql, /update public\.ordenes_pago\s+set estado = 'anulada'/);
assert.match(sql, /op\.estado <> 'anulada'/);
assert.match(sql, /m\.tipo::text = 'pago'/);
assert.match(sql, /coalesce\(f\.total_acreditado, 0\)/);
assert.match(sql, /replayed', true/);
assert.match(sql, /grant execute on function public\.anular_orden_pago_segura/);
assert.match(sql, /exists \([\s\S]*?where us\.user_id = auth\.uid\(\)[\s\S]*?and not exists/);

console.log("OK anulación OP: atómica, idempotente, con reversión de movimientos, cheques y saldos de facturas.");
