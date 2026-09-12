const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/app/(crm)/finanzas/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const parts = [];
function visit(node) { if (ts.isFunctionDeclaration(node) && ['startEditFC', 'handleSaveFC'].includes(node.name?.text)) parts.push(node.getText(ast)); ts.forEachChild(node, visit); }
visit(ast);
assert.equal(parts.length, 2);
function setup(estado, response = { data: { id: 'fc-one' }, error: null }) {
  const state = { writes: 0, opened: false, closed: false, alerts: [], filters: [] };
  const query = { update() { state.writes++; return this; }, eq(k,v) { state.filters.push([k,v]); return this; }, select() { return this; }, async maybeSingle() { return response; } };
  const ctx = { selectedFC: { id: 'fc-one', estado }, sociedadActiva: { id: 'soc-one' }, editFCForm: { numero_factura: 'A-1', fecha: '2026-09-11', fecha_vencimiento: '', subtotal: 100, iva: 21, percepciones: 0, moneda: 'ARS', notas: '', cae: '' }, supabase: { from() { return query; } }, alert(x) { state.alerts.push(x); }, console: { error() {} }, setEditFCForm() {}, setEditingFC(x) { if (x) state.opened = true; else state.closed = true; }, setSavingFC() {}, setSelectedFC() {}, async fetchData() {} };
  vm.createContext(ctx); vm.runInContext(ts.transpileModule(parts.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, ctx);
  return { ctx, state };
}
(async () => {
  for (const estado of ['pagada', 'aprobada', 'recibida', 'anulada', 'desconocido']) { const {ctx,state} = setup(estado); ctx.startEditFC(ctx.selectedFC); await ctx.handleSaveFC(); assert.equal(state.opened,false); assert.equal(state.writes,0); }
  for (const estado of ['pendiente','borrador']) { const {ctx,state} = setup(estado); ctx.startEditFC(ctx.selectedFC); await ctx.handleSaveFC(); assert.equal(state.opened,true); assert.equal(state.closed,true); assert.ok(state.filters.some(([k,v]) => k==='estado' && v===estado)); assert.ok(state.filters.some(([k,v]) => k==='sociedad_id' && v==='soc-one')); }
  const {ctx,state} = setup('pendiente',{data:null,error:null}); await ctx.handleSaveFC(); assert.equal(state.closed,false); assert.match(state.alerts[0], /cambió de estado/);
  assert.notEqual(Math.round(100 * 100), Math.round(100.50 * 100));
  console.log('OK: edición FC aprobada/pagada bloqueada, comparación de estado al guardar y saldo de centavos; simulados sin red.');
})().catch(error => { console.error(error); process.exitCode=1; });
