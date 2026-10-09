#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const pdf = read("src/lib/pdf-templates.ts");
assert.match(pdf, /\.pr-items \.pr-nowrap \{ white-space: nowrap/);
assert.match(pdf, /class="mono pr-code pr-nowrap"/);
assert.match(pdf, /style="width:96px">Código/);
assert.match(pdf, /textoSeguro\(it\.descripcion\)/);
assert.match(pdf, /textoSeguro\(pr\.observaciones\)\.replace/);

const pr = read("src/app/(crm)/presupuestos/page.tsx");
assert.match(pr, /min-w-\[1240px\].*table-fixed/);
assert.match(pr, /font-mono.*text-sm/);

const purchaseInvoice = read("src/components/cargar-factura-oc.tsx");
assert.match(purchaseInvoice, /Adaptar OC y costos a \{moneda\}/);
assert.match(purchaseInvoice, /liveCurrencyMismatch && !\(overrideOC && currencies\.size === 1\)/);
assert.match(purchaseInvoice, /\.update\(\{ moneda, subtotal: orderNet/);
assert.match(purchaseInvoice, /linkedInvoiceCurrencyMismatch/);

const dashboard = read("src/app/(crm)/dashboard/page.tsx");
assert.match(dashboard, /select\("fecha, total, moneda, tipo"\)/);
assert.match(dashboard, /new Set\(\["NCA", "NCB", "NCEA", "NCEB"\]\)/);
assert.match(dashboard, /facturadoMonedas\.ARS.*facturadoMonedas\.USD/s);
assert.match(dashboard, /const DASHBOARD_ALERT_LIMIT = 5/);
assert.match(dashboard, /alerts\.slice\(0, DASHBOARD_ALERT_LIMIT\)/);
assert.match(dashboard, /max-h-\[30rem\].*overflow-y-auto/);
assert.match(dashboard, /Ver \$\{hiddenAlertsCount\} alertas más/);
assert.equal((dashboard.match(/<ResponsiveContainer width="100%" height="100%" minWidth=\{0\}>/g) || []).length, 2);

const collection = read("src/components/cobro-masivo-liquidacion.tsx");
assert.match(collection, /Adjuntar OP y leer con IA/);
assert.match(collection, /fetch\("\/api\/parse-cobro"/);
assert.match(collection, /parsedRetenciones/);
assert.match(collection, /!parsingOP/);

const parser = read("src/app/api/parse-cobro/route.ts");
assert.match(parser, /"orden_pago_cliente"/);
assert.match(parser, /"certificado"/);
assert.match(parser, /contexto === "orden_pago_proveedor"/);
assert.match(parser, /direccion: "emitido"/);

const paymentParser = read("src/lib/payment-document-parser.ts");
assert.match(paymentParser, /options: \{ context\?: "default" \| "orden_pago_proveedor" \}/);
assert.match(paymentParser, /cheque_id_digital/);

const finance = read("src/app\/(crm)\/finanzas\/page.tsx");
assert.match(finance, /formData\.append\("contexto", "orden_pago_proveedor"\)/);
assert.match(finance, /Envío de OP: todas/);
assert.match(finance, /opEnvioFilter === "enviada"/);

const trash = read("src/app/(crm)/papelera/page.tsx");
assert.match(trash, /Buscar por número, cliente, proveedor o PR\/OC relacionada/);
assert.match(trash, /kindFilter && row\.kind !== kindFilter/);
assert.match(trash, /row\.number, row\.entity, row\.related, row\.kind, row\.state/);
assert.match(trash, /Relacionado: \{row\.related\}/);
assert.match(trash, /fallbackSelect/);
assert.match(trash, /row\.date \? formatDate\(row\.date\)/);
assert.doesNotMatch(trash, /new Date\(row\.date\)\.toLocaleDateString/);

const usersApi = read("src/app/api/users/route.ts");
assert.match(usersApi, /export async function PATCH/);
assert.match(usersApi, /export async function DELETE/);
assert.match(usersApi, /ban_duration: "876000h"/);
assert.match(usersApi, /target\.role === "super_admin"/);
assert.match(usersApi, /active: false, role: "viewer"/);

const configuration = read("src/app/(crm)/configuracion/page.tsx");
assert.match(configuration, /const canManageUsers = profile\?\.role === "super_admin" \|\| profile\?\.role === "admin"/);
assert.match(configuration, /row\.role !== "super_admin" \|\| profile\?\.role === "super_admin"/);
assert.match(configuration, /showInviteModal && canManageUsers/);

const middleware = read("src/lib/supabase/middleware.ts");
assert.match(middleware, /profile\?\.active === false/);
assert.match(middleware, /Usuario inactivo/);

const presupuestoSql = read("supabase/migrations/20260925231500_presupuestos_guardado_atomico.sql");
assert.match(presupuestoSql, /Sesion requerida para crear el presupuesto/);
assert.match(presupuestoSql, /auth\.uid\(\), p_sociedad_id/);
assert.doesNotMatch(presupuestoSql, /v_new\.created_by, p_sociedad_id/);

const paymentSql = read("supabase/migrations/20260925223000_pagos_proveedores_atomicos.sql");
assert.match(paymentSql, /not exists \([\s\S]*?where us\.user_id = auth\.uid\(\)[\s\S]*?\)\s*or exists/);

const fxSql = read("supabase/migrations/20260912180000_fx_settlements.sql");
assert.match(fxSql, /not exists\(select 1 from public\.user_sociedades us where us\.user_id=auth\.uid\(\)\)\s*or exists/);

console.log("OK: PR legible, conversión de OC, KPIs, alertas acotadas, lectura IA de OP, papelera buscable y administración de usuarios.");
