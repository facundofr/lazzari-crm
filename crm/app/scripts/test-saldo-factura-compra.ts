// npx tsx scripts/test-saldo-factura-compra.ts
// Saldo de factura de compra (NC contada una sola vez), duplicados por tipo de comprobante
// y chequeos de texto de la migración 20261011120000 y del cron de cotización. No toca la base.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canceladoFacturaCompra, saldoFacturaCompra, normalizarTipoComprobanteCompra, duplicadosComprobanteCompra,
} from "../src/lib/saldo-factura-compra";
import { canonicalPurchaseInvoiceNumber } from "../src/lib/purchase-invoice-reconciliation";

// ── A2: FC $100.000, NC $50.000 aplicada (deja total_acreditado y un movimiento) y OP $50.000 ──
const conOP = { total: 100000, total_acreditado: 50000, credito_nc_movimientos: 50000, pago_op: 50000 };
assert.equal(canceladoFacturaCompra(conOP), 100000, "la NC se cuenta una vez");
assert.equal(saldoFacturaCompra(conOP), 0);
// Al anular la OP la factura debe quedar debiendo $50.000 (antes daba 0 y quedaba "pagada").
const opAnulada = { ...conOP, pago_op: 0 };
assert.equal(saldoFacturaCompra(opAnulada), 50000);
// Si además se revierte la NC usada en esa OP, vuelve a deber el total.
assert.equal(saldoFacturaCompra({ total: 100000, total_acreditado: 0, credito_nc_movimientos: 0 }), 100000);

// ── A4: USD 1.000 con NC de USD 200 → saldo 800 (antes 600) ──
assert.equal(saldoFacturaCompra({ total: 1000, total_acreditado: 200, credito_nc_movimientos: 200 }), 800);
// NC vieja que solo dejó total_acreditado, o solo el movimiento: igual se descuenta una vez.
assert.equal(saldoFacturaCompra({ total: 1000, total_acreditado: 200 }), 800);
assert.equal(saldoFacturaCompra({ total: 1000, credito_nc_movimientos: 200 }), 800);
// Pago directo con retención + OP + NC; nunca saldo negativo; strings de la base.
assert.equal(saldoFacturaCompra({ total: "1000", total_acreditado: "100", credito_nc_movimientos: "100", pago_directo: "250.5", pago_op: "300" }), 349.5);
assert.equal(saldoFacturaCompra({ total: 100, pago_op: 150 }), 0);
assert.equal(canceladoFacturaCompra({ total: 0.3, pago_op: 0.1, pago_directo: 0.2 }), 0.3);

// ── C1: duplicados por número + tipo, sin anuladas ──
assert.equal(normalizarTipoComprobanteCompra("  nc   a "), "NC A");
assert.equal(normalizarTipoComprobanteCompra(null), "FC A");
const existentes = [
  { id: "1", numero_factura: "1-45", tipo_comprobante: "FC A", estado: "pendiente" },
  { id: "2", numero_factura: "0001-00000046", tipo_comprobante: "NC A", estado: "anulada" },
  { id: "3", numero_factura: "00001-00000047", tipo_comprobante: "FC B", estado: "pagada" },
];
const dup = (numero: string, tipo: string) =>
  duplicadosComprobanteCompra(existentes, { numero_factura: numero, tipo_comprobante: tipo }, canonicalPurchaseInvoiceNumber).map(d => d.id);
assert.deepEqual(dup("0001-00000045", "NC A"), [], "una NC no repite a la FC con el mismo número");
assert.deepEqual(dup("0001-00000045", "fc a"), ["1"], "misma FC A con otro formato de número");
assert.deepEqual(dup("1-46", "NC A"), [], "las anuladas no cuentan");
assert.deepEqual(dup("1-47", "FC A"), [], "FC A y FC B son series distintas");
assert.deepEqual(dup("1-47", "FC B"), ["3"]);

// ── Migración: textos clave ──
const sql = readFileSync(new URL("../supabase/migrations/20261011120000_compras_correcciones.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const rb = readFileSync(new URL("../supabase/rollback/20261011120000_compras_correcciones.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cuerpo = sql.slice(0, sql.indexOf("CONSULTAS DE CONTROL"));
assert.match(cuerpo, /create or replace function public\.fc_compra_pagado\(p_factura_id uuid, p_sociedad_id uuid\)/);
assert.match(cuerpo, /\+ greatest\(/, "la NC se toma como el mayor de sus dos rastros");
assert.match(cuerpo, /m\.nota_credito_compra_id is null/, "pagos directos sin los movimientos de NC");
assert.doesNotMatch(cuerpo, /raise exception 'El pago directo debe ser parcial/, "C3: pago directo total permitido");
assert.match(cuerpo, /select f\.total, public\.fc_compra_pagado\(f\.id, p_sociedad_id\)/, "A2: recalculo con la regla única");
assert.doesNotMatch(cuerpo.slice(cuerpo.indexOf("function public.anular_orden_pago_segura"), cuerpo.indexOf("function public.fx_documento_pagado")),
  /\+ coalesce\(f\.total_acreditado, 0\)/, "A2: ya no suma total_acreditado a los movimientos");
assert.match(cuerpo, /from public\.op_notas_credito_compra o/, "A2: revierte las NC de la OP");
assert.match(cuerpo, /update public\.pagos_lote_items\s+set estado = 'pendiente'/, "A2: reabre el renglón del plan");
assert.match(cuerpo, /request_key = gen_random_uuid\(\)/);
assert.match(cuerpo, /case when p_kind='cobro' then coalesce\(\(f->>'total_acreditado'\)::numeric,0\) else 0 end-fx_documento_pagado/, "A4");
assert.match(cuerpo, /v_paid:=public\.fc_compra_pagado\(p_id,p_soc\);/);
assert.match(cuerpo, /p_confirmar boolean default false/, "C2");
assert.match(cuerpo, /'requiere_confirmacion', true/);
assert.doesNotMatch(cuerpo, /quedaría con % facturadas de % pedidas/, "C2: ya no es excepción");
assert.match(cuerpo, /drop function if exists public\.guardar_conciliacion_compra\(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb\);/);
assert.match(cuerpo, /grant execute on function public\.guardar_conciliacion_compra\(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb, boolean\) to authenticated;/);
assert.match(cuerpo, /= v_tipo\n\s+and fc\.id is distinct from p_factura_id/, "C1: duplicado por tipo en la conciliación");
for (const fn of ["anular_orden_pago_segura(uuid, uuid)", "liquidar_documentos_fx(uuid,uuid,text,uuid,date,numeric,date,text,jsonb,jsonb,jsonb)"]) {
  assert.ok(cuerpo.includes(`grant execute on function public.${fn} to authenticated;`), fn);
}
assert.ok(cuerpo.trimEnd().length > 0 && /\ncommit;\n/.test(cuerpo));
const control = sql.slice(sql.lastIndexOf("\n", sql.indexOf("CONSULTAS DE CONTROL")) + 1);
assert.ok(control.split("\n").filter(l => l.trim()).every(l => l.startsWith("--")), "las consultas de control van comentadas");
assert.match(cuerpo, /oc\.sociedad_id = p_sociedad_id and oc\.proveedor_id = v_proveedor_id/, "C2: el aviso solo mira OC de la sociedad y el proveedor");
assert.match(cuerpo, /notify pgrst, 'reload schema';/);
// Rollback: vuelve a las versiones anteriores, textuales.
for (const [file, marker] of [
  ["20261007143000_anular_orden_pago_atomica.sql", "+ coalesce(f.total_acreditado, 0)"],
  ["20260925223000_pagos_proveedores_atomicos.sql", "El pago directo debe ser parcial"],
  ["20261009200000_descuentos_presupuesto.sql", "quedaría con % facturadas de % pedidas"],
  ["20260912180000_fx_settlements.sql", "v_saldo:=(f->>'total')::numeric-coalesce((f->>'total_acreditado')::numeric,0)-fx_documento_pagado"],
] as const) {
  const original = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(original.includes(marker) && rb.includes(marker), `rollback restaura ${file}`);
}
assert.match(rb, /drop function if exists public\.guardar_conciliacion_compra\(uuid, uuid, jsonb, jsonb, jsonb, boolean, boolean, jsonb, boolean\);/);
assert.match(rb, /drop function if exists public\.fc_compra_pagado\(uuid, uuid\);/);

// ── D1: cron de cotización ──
const cron = readFileSync(new URL("../src/app/api/cron/cotizacion/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
assert.match(cron, /if \(!cronSecret \|\|/, "exige CRON_SECRET");
assert.match(cron, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(cron, /fuente: BNA_VERIFIED_SOURCE/);
assert.match(cron, /existente\?\.es_manual/, "no pisa las manuales");
assert.doesNotMatch(cron, /createSupabaseServer/);

console.log("test-saldo-factura-compra: OK");
