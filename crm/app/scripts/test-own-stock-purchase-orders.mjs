#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.cwd(), "package.json"));
const ts = require("typescript");
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = path.join(appRoot, "src/lib/own-stock-purchase-orders.ts");
const js = ts.transpileModule(fs.readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helperModule = { exports: {} };
new Function("exports", "require", "module", js)(helperModule.exports, require, helperModule);
const { groupOwnStockItemsByCurrency, calculateOwnStockPurchaseOrder } = helperModule.exports;

const invoiceLinksPath = path.join(appRoot, "src/lib/purchase-order-invoice-links.ts");
const invoiceLinksJs = ts.transpileModule(fs.readFileSync(invoiceLinksPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const invoiceLinksModule = { exports: {} };
new Function("exports", "require", "module", invoiceLinksJs)(invoiceLinksModule.exports, require, invoiceLinksModule);
const { attachPurchaseOrderInvoices } = invoiceLinksModule.exports;

const items = [
  { codigo: "A", costo_moneda: "ARS", cantidad: 2, precio_costo: 100, iva_porcentaje: 21 },
  { codigo: "B", costo_moneda: "USD", cantidad: 1, precio_costo: 10, iva_porcentaje: 0 },
  { codigo: "C", costo_moneda: "USD billete", cantidad: 3, precio_costo: 2, iva_porcentaje: 10.5 },
];
const groups = groupOwnStockItemsByCurrency(items);
assert.deepEqual(groups.map(({ moneda, items: rows }) => [moneda, rows.map((item) => item.codigo)]), [
  ["ARS", ["A"]],
  ["USD", ["B", "C"]],
]);
assert.deepEqual(calculateOwnStockPurchaseOrder(groups[0].items, false), { subtotal: 200, iva: 42, total: 242 });
assert.deepEqual(calculateOwnStockPurchaseOrder(groups[1].items, false), { subtotal: 16, iva: 0.63, total: 16.63 });
assert.deepEqual(calculateOwnStockPurchaseOrder(groups[0].items, true), { subtotal: 200, iva: 0, total: 200 });
assert.equal(calculateOwnStockPurchaseOrder([{ cantidad: 3, precio_costo: 0 }], false).subtotal, 0,
  "un grupo sin costo debe poder detectarse antes de crear su OC");

const ocPage = fs.readFileSync(path.join(appRoot, "src/app/(crm)/ordenes-compra/page.tsx"), "utf8");
assert.match(ocPage, /facturas_vinculadas_estado\?\.\.\.|facturas_vinculadas_estado\s*===\s*"desconocido"/,
  "estado desconocido de los vínculos debe bloquear edición/eliminación");
assert.match(ocPage, /from\("facturas_compra"\)[\s\S]*?orden_compra_id/, "debe consultar el vínculo histórico directo FC→OC");
assert.match(ocPage, /setOrdenes\(result\.orders as OCRow\[\]\)/, "el resultado del helper debe conservar las OCs reales cargadas");
const invoiceLinksSource = fs.readFileSync(invoiceLinksPath, "utf8");
assert.match(invoiceLinksSource, /facturas_vinculadas_estado:\s*errorParts\.length\s*\?\s*"desconocido"/, "debe marcar explícitamente vínculos no verificados");
assert.match(ocPage, /error:\s*junctionError/, "la falla de consulta en la tabla de vínculos debe detectarse");
assert.match(ocPage, /role="alert"[\s\S]*?facturaLinksError/, "la falla de vínculos debe mostrarse en pantalla y permitir reintentar");
assert.match(ocPage, /No se muestran datos de ejemplo/, "un fallo de la consulta principal no debe inventar OCs mock");
assert.match(ocPage, /No se pudo verificar si la OC tiene facturas vinculadas; no se eliminó/, "el borrado debe fallar cerrado ante errores de verificación");
assert.match(ocPage, /No se puede editar esta OC hasta verificar sus facturas vinculadas/, "el usuario debe recibir una causa clara al intentar editar");

const realOrders = [{ id: "oc-real-1", numero: "OC-001" }];
const junctionFailed = attachPurchaseOrderInvoices(realOrders, [], [], { junction: "permission denied" });
assert.equal(junctionFailed.orders.length, 1, "fallar junction no debe borrar la OC real cargada");
assert.equal(junctionFailed.orders[0].numero, "OC-001");
assert.equal(junctionFailed.orders[0].facturas_vinculadas_estado, "desconocido", "una consulta junction fallida no equivale a 'sin factura'");
assert.match(junctionFailed.error, /no se pudo verificar/);
const legacyFailed = attachPurchaseOrderInvoices(realOrders, [], [], { legacy: "column unavailable" });
assert.equal(legacyFailed.orders[0].facturas_vinculadas_estado, "desconocido", "fallar la consulta histórica también bloquea la confianza en el vínculo");
const linkedKnown = attachPurchaseOrderInvoices(realOrders, [{ orden_compra_id: "oc-real-1", facturas_compra: { id: "fc-1", estado: "pendiente" } }], [], {});
assert.equal(linkedKnown.orders[0].facturas_vinculadas_estado, "conocido");
assert.equal(linkedKnown.orders[0].facturas_vinculadas.length, 1);

const budgetPage = fs.readFileSync(path.join(appRoot, "src/app/(crm)/presupuestos/page.tsx"), "utf8");
assert.match(budgetPage, /groupOwnStockItemsByCurrency\(stockItems\)/, "el stock propio debe generar grupos separados por moneda");
assert.match(budgetPage, /if \(totals\.subtotal <= 0\)/, "un grupo de stock propio con costo total cero no debe crear una OC");
assert.match(budgetPage, /moneda,\s*estado: "enviada",[\s\S]{0,240}?observaciones: `Stock propio — OC interna generada/, "la OC interna debe quedar enviada y claramente identificada");
assert.match(budgetPage, /Stock propio — genera OC interna/, "el selector debe explicar que stock propio genera una OC interna");
assert.doesNotMatch(budgetPage, /Stock propio \(sin OC\)|stock propio — sin OC generada/, "la interfaz no debe contradecir la creación de la OC interna");
assert.match(budgetPage, /stockItemsWithOC \+= currencyItems\.length/, "el mensaje final debe contar solo items cuya OC se creó");
assert.match(budgetPage, /normalizePurchaseCurrency\(it\.costo_moneda\) === normalizePurchaseCurrency\(oc\.moneda\)/, "la sincronización debe limitar cada OC interna a su moneda");
assert.match(budgetPage, /Generación parcial:/, "un resultado incompleto no puede anunciar éxito total");
assert.match(budgetPage, /falló la carga de sus items y se limpió el encabezado/, "si fallan los items, debe informar la limpieza de la OC recién insertada");
assert.match(budgetPage, /select\("id"\)\.maybeSingle\(\)/, "la limpieza debe confirmar que efectivamente borró el encabezado");
assert.match(budgetPage, /ocCreationFailed = true/, "fallos al crear encabezados/items no deben permitir un mensaje de éxito completo");
assert.match(budgetPage, /onPaste={handleAIPaste}/, "el panel IA debe aceptar imagen pegada desde portapapeles");
assert.match(budgetPage, /function handleAIImageFile/, "pegar y adjuntar deben reutilizar el mismo lector de imagen");

console.log("OK: OCs internas por moneda, sumas/impuestos, vínculos FC actuales e históricos y guards fail-closed.");
