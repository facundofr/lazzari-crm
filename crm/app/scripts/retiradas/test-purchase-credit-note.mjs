import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260925204500_notas_credito_compra_origen.sql", "utf8");
const loader = fs.readFileSync("src/components/cargar-factura-oc.tsx", "utf8");
const finance = fs.readFileSync("src/app/(crm)/finanzas/page.tsx", "utf8");

const tests = [];
const check = (name, fn) => tests.push([name, fn]);

check("la NC conserva relación, monto aplicado e idempotency key", () => {
  assert.match(migration, /factura_origen_id uuid references public\.facturas_compra/);
  assert.match(migration, /credito_aplicado numeric\(15,2\)/);
  assert.match(migration, /credito_request_key uuid/);
  assert.match(migration, /facturas_compra_credit_request_key_uidx/);
  assert.match(migration, /credito_request_payload is distinct from jsonb_build_object/);
});

check("la RPC bloquea y valida sociedad, proveedor y moneda de la factura origen", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where id = p_factura_origen_id and sociedad_id = p_sociedad_id\s+for update/);
  assert.match(migration, /v_origen\.proveedor_id::text is distinct from p_factura->>'proveedor_id'/);
  assert.match(migration, /v_origen\.moneda::text is distinct from p_factura->>'moneda'/);
  assert.match(migration, /El crédito supera el saldo acreditable restante/);
});

check("crédito, movimiento e incremento acreditado se escriben en la misma RPC", () => {
  assert.match(migration, /insert into public\.facturas_compra \(/);
  assert.match(migration, /insert into public\.movimientos \(/);
  assert.match(migration, /nota_credito_compra_id/);
  assert.match(migration, /set total_acreditado = round/);
  assert.doesNotMatch(migration, /when others/);
});

check("pagos, OP y NC comparten una validación serializada de saldo", () => {
  assert.match(migration, /create trigger validar_saldo_op_factura_compra/);
  assert.match(migration, /create trigger validar_saldo_movimiento_factura_compra/);
  assert.match(migration, /from public\.facturas_compra\s+where id = v_factura_id\s+for update/);
  assert.match(migration, /v_aplicado \+ v_nuevo > v_total \+ 0\.005/);
});

check("la UI usa la RPC idempotente v2 y aplica el crédito a la factura elegida (sugerida, nunca obligatoria)", () => {
  assert.match(loader, /registrar_nota_credito_compra_v2/);
  assert.match(loader, /p_request_key: creditRequestKeyRef\.current/);
  assert.match(loader, /p_aplicaciones: facturaOrigenId && creditoAplicado > 0/);
  assert.match(loader, /monto: roundMoney\(creditoAplicado\)/);
});

check("la aplicación no se cuenta como caja ni retención y las NC no aparecen para OP", () => {
  assert.match(finance, /!m\.nota_credito_compra_id/);
  assert.match(finance, /\.is\("nota_credito_compra_id", null\)/);
  assert.match(finance, /\.not\("tipo_comprobante", "ilike", "NC%"\)/);
  assert.match(finance, /anular_nota_credito_compra/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (error) { failed += 1; console.error(`✗ ${name}`); console.error(error); }
}
if (failed) process.exit(1);
console.log(`\n${tests.length} pruebas de nota de crédito de proveedor OK`);
