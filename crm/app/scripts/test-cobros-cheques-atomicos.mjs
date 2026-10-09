import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const simplePath = "src/app/(crm)/facturacion/facturacion-content.tsx";
const massivePath = "src/components/cobro-masivo-liquidacion.tsx";
const migrationPath = "supabase/migrations/20260925220000_cobros_cheques_atomicos.sql";

const simple = readFileSync(simplePath, "utf8");
const massive = readFileSync(massivePath, "utf8");
const sql = readFileSync(migrationPath, "utf8");

const simpleHandler = simple.slice(
  simple.indexOf("async function handleRegistrarCobro()"),
  simple.indexOf("// ── Cobro masivo modal", simple.indexOf("async function handleRegistrarCobro()")),
);
const massiveHandler = massive.slice(
  massive.indexOf("async function handleConfirmar()"),
  massive.indexOf("const fc = formatCurrency", massive.indexOf("async function handleConfirmar()")),
);

assert.match(simpleHandler, /rpc\("registrar_cobro_seguro"/);
assert.match(simpleHandler, /p_request_key:\s*cobroRequestKeyRef\.current/);
assert.match(simpleHandler, /tipo_cheque:/);
assert.match(simpleHandler, /cheque_numero:/);
assert.match(simpleHandler, /cheque_fecha_pago:/);
assert.doesNotMatch(simpleHandler, /from\("echeqs"\)/);
assert.doesNotMatch(simpleHandler, /p_created_by/);

assert.match(massiveHandler, /rpc\("registrar_cobro_masivo_seguro"/);
assert.match(massiveHandler, /p_request_key:\s*requestKeyRef\.current/);
assert.match(massiveHandler, /tipo_cheque:/);
assert.match(massiveHandler, /cheque_numero:/);
assert.match(massiveHandler, /cheque_fecha_pago:/);
assert.doesNotMatch(massiveHandler, /from\("echeqs"\)/);
assert.doesNotMatch(massiveHandler, /p_created_by/);
assert.match(massive, /\{ value: "echeq", label: "Cheque \/ E-Cheq" \}/);
assert.doesNotMatch(massive, /\{ value: "cheque_recibido", label: "Cheque" \}/);
assert.match(massive, /tipo === "cheque" \|\| tipo === "echeq"[\s\S]{0,80}\? "echeq"/);
assert.match(massive, /checked=\{medio\.tipo === "cheque_recibido"\}/);
assert.match(massive, /e\.target\.checked \? "cheque_recibido" : "echeq"/);
assert.match(simple, /if \(t === "cheque" \|\| t === "echeq"\) return "echeq"/);
assert.doesNotMatch(simple, /<option value="cheque_recibido">Cheque<\/option>/);
assert.match(simple, /<option value="echeq">Cheque \/ E-Cheq<\/option>/);
assert.match(simple, /checked=\{linea\.tipo === "cheque_recibido"\}/);

assert.match(sql, /begin;[\s\S]*commit;/);
assert.match(sql, /unique \(sociedad_id, request_key\)/);
assert.match(sql, /pg_advisory_xact_lock/g);
assert.equal((sql.match(/for update(?: of f)?;/g) || []).length, 2);
assert.match(sql, /create or replace function public\.registrar_cobro_seguro/);
assert.match(sql, /create or replace function public\.registrar_cobro_masivo_seguro/);
assert.match(sql, /v_result := public\.registrar_cobro\(/);
assert.match(sql, /v_result := public\.registrar_cobro_masivo\(/);
assert.match(sql, /insert into public\.echeqs/g);
assert.match(sql, /'cliente',\s*\n\s*v_cliente_id,/);
assert.match(sql, /'cliente',\s*\n\s*p_cliente_id,/);
assert.match(sql, /c\.sociedad_id = f\.sociedad_id/);
assert.match(sql, /f\.sociedad_id = p_sociedad_id/);
assert.match(sql, /us\.sociedad_id = p_sociedad_id/g);
assert.match(sql, /v_existing\.payload <> v_payload/g);
assert.match(sql, /jsonb_build_object\('replayed', true\)/g);
assert.match(sql, /p\.proname in \('registrar_cobro', 'registrar_cobro_masivo'\)/);
assert.doesNotMatch(sql, /exception\s+when[\s\S]{0,80}(null|continue)/i);

console.log(
  "OK cobros/cheques: simple y masivo usan RPC atomica; cartera queda en la transaccion, " +
  "con origen_id, sociedad, permisos e idempotencia sin inserts silenciosos desde la UI.",
);
