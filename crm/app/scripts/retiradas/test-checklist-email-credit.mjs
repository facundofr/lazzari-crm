import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function read(relativePath) {
  return fs.readFileSync(path.join(scriptDir, "..", relativePath), "utf8");
}

function findFunction(source, filename, name) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `No se encontró ${name}`);
  return found;
}

function compile(functionSource) {
  return ts.transpileModule(functionSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

(async () => {
  const presupuestos = read("src/app/(crm)/presupuestos/page.tsx");
  const prContext = {
    sociedadActiva: { id: "soc", razonSocial: "Lazzari" },
    loadEmailTemplate: async () => ({ asunto: "PR", cuerpo: "Cuerpo" }),
    formatCurrency: () => "$ 1",
    formatDate: value => value,
    applyTemplateVars: value => value,
    setEmailModal: value => { prContext.modal = value; },
  };
  vm.createContext(prContext);
  vm.runInContext(compile(findFunction(presupuestos, "presupuestos.tsx", "openEmailModal")), prContext);
  await prContext.openEmailModal({
    id: "pr", numero: "PR-1", total: 1, moneda: "ARS", fecha: "2026-09-25", clienteNombre: "Cliente",
    contactoEmail: "solicitante@example.com", clienteEmailFacturacion: "facturacion@example.com", clienteEmail: "general@example.com",
  });
  assert.equal(prContext.modal.to, "solicitante@example.com", "el PR debe priorizar al solicitante");
  assert.ok(presupuestos.indexOf('label: (pr as any).contactoNombre || "Solicitante"') < presupuestos.indexOf('label: "Facturación"'), "el solicitante debe aparecer antes que Facturación en sugerencias");

  const finanzas = read("src/app/(crm)/finanzas/page.tsx");
  const financeContext = {
    sociedadActiva: { id: "soc", razonSocial: "Lazzari" },
    proveedoresOptions: [{ id: "prov", email: "general@example.com" }],
    loadEmailTemplate: async () => ({ asunto: "OP", cuerpo: "Cuerpo" }),
    formatCurrency: () => "$ 1",
    formatDate: value => value,
    applyTemplateVars: value => value,
    setEmailModal: value => { financeContext.modal = value; },
    supabase: {
      from(table) {
        if (table === "proveedores") return { select() { return this; }, eq() { return this; }, async single() { return { data: { email: "general@example.com" } }; } };
        if (table === "contactos") return { select() { return this; }, eq() { return this; }, async order() { return { data: [
          { nombre: "Principal", email: "principal@example.com", principal: true },
          { nombre: "Compras", email: "compras@example.com", principal: false },
        ] }; } };
        throw new Error(`Tabla inesperada: ${table}`);
      },
    },
  };
  vm.createContext(financeContext);
  vm.runInContext(compile(findFunction(finanzas, "finanzas.tsx", "openOrdenPagoEmail")), financeContext);
  await financeContext.openOrdenPagoEmail({
    id: "op", numero: "OP-1", neto: 1, moneda: "ARS", fecha: "2026-09-25", proveedor_id: "prov", proveedor_nombre: "Proveedor", archivos: [],
  });
  assert.equal(financeContext.modal.to, "principal@example.com", "la OP debe priorizar el contacto principal");
  assert.deepEqual(Array.from(financeContext.modal.suggestedEmails, item => item.email), ["principal@example.com", "compras@example.com", "general@example.com"]);
  assert.match(finanzas, /Medios financieros/, "Finanzas debe mostrar un resumen específico de medios financieros");
  assert.match(finanzas, /Tarjetas en OP del mes/, "las tarjetas deben reflejarse en órdenes de pago");
  assert.match(finanzas, /no se suman al saldo de caja/, "la UI debe aclarar que la tarjeta no integra caja bancaria");
  assert.match(finanzas, /detailFullscreen/, "los paneles de detalle de Finanzas deben poder ampliarse");

  const facturacion = read("src/app/(crm)/facturacion/facturacion-content.tsx");
  const creditContext = {};
  vm.createContext(creditContext);
  vm.runInContext(compile(findFunction(facturacion, "facturacion-content.tsx", "clienteAlcanzoLimite")), creditContext);
  assert.equal(creditContext.clienteAlcanzoLimite({ limite_credito: 100, saldo_cuenta_corriente: 100 }), true);
  assert.equal(creditContext.clienteAlcanzoLimite({ limite_credito: 100, saldo_cuenta_corriente: 99.99 }), false);
  assert.equal(creditContext.clienteAlcanzoLimite({ limite_credito: 0, saldo_cuenta_corriente: 100 }), false);
  assert.match(facturacion, /clientes\(razon_social,[^)]*limite_credito, saldo_cuenta_corriente\)/, "Facturación debe consultar límite y saldo reales");
  assert.match(facturacion, /Aviso informativo: la factura y sus acciones continúan habilitadas/, "el aviso no debe bloquear acciones");

  const proveedores = read("src/app/(crm)/proveedores/page.tsx");
  assert.match(proveedores, /panelFullscreen/, "el detalle de proveedores debe poder ampliarse");
  assert.match(proveedores, /modalFullscreen/, "el formulario de proveedores debe poder ampliarse");

  console.log("OK: emails, crédito, medios financieros y pantalla completa.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
