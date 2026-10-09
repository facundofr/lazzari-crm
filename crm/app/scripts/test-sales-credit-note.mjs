import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const helperSource = fs.readFileSync(path.join(root, "src/lib/sales-credit-note.ts"), "utf8");
const helperContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, helperContext);
const h = helperContext.exports;

assert.equal(h.creditNoteTypeForInvoice("FA"), "NCA");
assert.equal(h.creditNoteTypeForInvoice("FCEA"), "NCEA");
assert.equal(h.creditNoteTypeForInvoice("FCEB"), "NCEB");
assert.deepEqual(JSON.parse(JSON.stringify(h.creditNoteTotals([{descripcion:"Total",cantidad:1,precio_unitario:1000,iva_porcentaje:21}], true))), {neto:1000,iva:210,total:1210});
assert.equal(h.creditNoteTotals([h.freeAmountCreditItem(121, 21, true)], true).total, 121);
assert.deepEqual(JSON.parse(JSON.stringify(h.salesCreditAllocation({invoiceTotal:1210000,alreadyCredited:0,alreadyPaid:0,noteTotal:121000}))), {saldoAntes:1210000,aplicado:121000,saldoFavor:0,saldoDespues:1089000,exceedsBalance:false});
assert.deepEqual(JSON.parse(JSON.stringify(h.salesCreditAllocation({invoiceTotal:1210000,alreadyCredited:0,alreadyPaid:0,noteTotal:1210000}))), {saldoAntes:1210000,aplicado:1210000,saldoFavor:0,saldoDespues:0,exceedsBalance:false});
assert.deepEqual(JSON.parse(JSON.stringify(h.salesCreditAllocation({invoiceTotal:121,alreadyPaid:100,noteTotal:50}))), {saldoAntes:21,aplicado:21,saldoFavor:29,saldoDespues:0,exceedsBalance:true});

const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261008120000_notas_credito_venta_atomicas.sql"), "utf8");
for (const pattern of [
  /for update;[\s\S]*?nota_credito_request_key/,
  /from public\.fiscal_emission_attempts[\s\S]*?for update/,
  /insert into public\.facturas[\s\S]*?insert into public\.factura_items[\s\S]*?update public\.facturas/,
  /v_aplicado := least\(v_total, v_saldo_antes\)/,
  /v_saldo_favor := greatest/,
]) assert.match(migration, pattern);

const route = fs.readFileSync(path.join(root, "src/app/api/facturacion/route.ts"), "utf8");
assert.match(route, /registrar_nota_credito_venta_autorizada/);
assert.match(route, /attempt\.state === "authorized"/);
assert.match(route, /CbtesAsoc/);

const pdf = fs.readFileSync(path.join(root, "src/lib/pdf-templates.ts"), "utf8");
assert.match(pdf, /Comprobante asociado \/ observaciones/);

const envSource = fs.readFileSync(path.join(root, "src/lib/fiscal-environment.ts"), "utf8");
const envContext = { exports: {}, URL, process: { env: {} } };
vm.runInNewContext(ts.transpileModule(envSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, envContext);
assert.throws(() => envContext.exports.assertSafeFiscalEnvironment({VERCEL_ENV:"preview",NEXT_PUBLIC_SUPABASE_URL:"https://ycuzszzskqatlegtbgbq.supabase.co",ARCA_PRODUCTION:"false"}), /productiva/);
assert.throws(() => envContext.exports.assertSafeFiscalEnvironment({VERCEL_ENV:"preview",NEXT_PUBLIC_SUPABASE_URL:"https://testref.supabase.co",ARCA_PRODUCTION:"true"}), /ARCA_PRODUCTION/);
assert.doesNotThrow(() => envContext.exports.assertSafeFiscalEnvironment({VERCEL_ENV:"preview",NEXT_PUBLIC_SUPABASE_URL:"https://testref.supabase.co",TEST_SUPABASE_PROJECT_REF:"testref",ARCA_PRODUCTION:"false"}));

console.log("OK: NC venta total/parcial/importe, saldo, CAE reanudable, asociación PDF y guardas de homologación.");
