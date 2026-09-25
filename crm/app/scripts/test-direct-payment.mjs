import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/(crm)/finanzas/page.tsx", import.meta.url), "utf8");
assert.ok(source.includes('select("factura_compra_id, monto, retencion_ganancias_monto, anulado")'), "El lector de pagos directos debe traer la retención");
assert.ok(source.includes("+ Number(p.retencion_ganancias_monto || 0)"), "El total pagado debe sumar neto y retención");
assert.ok(source.includes("pago_op: (r.op_facturas_compra || [])"), "El CSV debe usar aplicaciones reales de OP");
assert.ok(source.includes("monto_bruto: Number(mov.monto || 0) + Number(mov.retencion_ganancias_monto || 0)"), "Retenciones debe reconstruir el bruto");
assert.ok(source.includes("proveedores(razon_social,cuit)"), "Retenciones debe cargar el CUIT del proveedor");
assert.ok(source.includes("if (mov?.factura_compra_id) { alert("), "Las acciones individuales deben bloquear pagos directos de proveedor");
const ast = ts.createSourceFile("finanzas.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === "handleRegistrarPagoParcialDirecto") handler = node; ts.forEachChild(node, visit); };
visit(ast);
assert(handler, "Pago parcial directo debe existir");
const js = ts.transpileModule(handler.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

async function run(name, { overrides = {}, history = [], links = [], queryError = null, expectedError, expectedWrite = false } = {}) {
  const writes = [];
  const context = {
    opFCPendientes: [{ id: "fc", selected: true, moneda: "ARS", monto_a_pagar: 400, saldo_pendiente: 1000 }],
    opMedios: [{ tipo: "transferencia", monto: 390, moneda: "ARS" }],
    sociedadActiva: { id: "soc" }, profile: { id: "user" }, opDatosError: "", opFCLoading: false,
    opCondicionLoading: false, opParsingCount: 0, opProvCondicion: "RI", opRetencionGanancias: 10, opBaseSinIVA: 320,
    opForm: { proveedor_id: "prov", moneda: "ARS", usar_monto_manual: false, aplica_ganancias: true, retencion_ganancias_pct: 2, fecha: "2026-09-11" },
    error: "", setOpError(error) { context.error = error; }, setOpSaving() {}, setOpModalOpen() {}, setPagoParcialDirecto() {}, setPagoParcialFCId() {}, async fetchData() {},
    ...overrides,
  };
  context.supabase = { from(table) {
    const query = {
      select() { return this; }, eq() { return this; },
      async single() { return { data: { id: "fc", proveedor_id: "prov", total: 1000, subtotal: 800, percepciones: 0, moneda: "ARS", numero_factura: "1", estado: "pendiente" }, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: table === "movimientos" ? history : links, error: queryError }).then(resolve, reject); },
      async insert(rows) { writes.push(JSON.parse(JSON.stringify(rows))); return { error: null }; },
    }; return query;
  } };
  vm.createContext(context); vm.runInContext(js, context);
  await context.handleRegistrarPagoParcialDirecto();
  assert.equal(writes.length, expectedWrite ? 1 : 0, `${name}: ${context.error}`);
  if (expectedError) assert.match(context.error, expectedError);
  if (expectedWrite) {
    assert.equal(writes[0].length, 2);
    assert.equal(writes[0][0].monto, 390);
    assert.equal(writes[0][0].retencion_ganancias_monto, 10);
    assert.equal(writes[0][0].base_retencion_ganancias, 320);
    assert.equal(writes[0][1].monto, 10);
  }
  console.log(`OK ${name}`);
}
await run("bruto seleccionado, neto y retención se guardan juntos", { expectedWrite: true });
await run("neto distinto no se reconstruye con dos pasadas", { overrides: { opMedios: [{ tipo: "transferencia", monto: 400, moneda: "ARS" }] }, expectedError: /neto/ });
await run("historial fallido impide escrituras", { queryError: { message: "network" }, expectedError: /pagos previos/ });
await run("pago directo anterior consume neto MÁS retención", { history: [{ monto: 590, retencion_ganancias_monto: 10 }], expectedError: /saldo actual/ });
await run("OP activa previa consume saldo", { links: [{ monto: 600, ordenes_pago: { id: "op", estado: "pagada", sociedad_id: "soc" } }], expectedError: /saldo actual/ });
await run("OP anulada no consume saldo", { links: [{ monto: 600, ordenes_pago: { id: "op", estado: "anulada", sociedad_id: "soc" } }], expectedWrite: true });
await run("condición fiscal cargando bloquea", { overrides: { opCondicionLoading: true }, expectedError: /verificarse/ });
await run("condición fiscal desconocida bloquea", { overrides: { opProvCondicion: "desconocido" }, expectedError: /no está reconocida/ });
await run("no mezcla monedas", { overrides: { opMedios: [{ monto: 390, moneda: "USD" }] }, expectedError: /moneda/ });
await run("cheque requiere reserva transaccional", { overrides: { opMedios: [{ tipo: "echeq", monto: 390, moneda: "ARS", echeq_id: "echeq" }] }, expectedError: /cartera.*transacción/ });
console.log("10 pruebas de pago parcial directo aprobadas; sin red ni escrituras reales.");
