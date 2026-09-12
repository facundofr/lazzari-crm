const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/app/api/facturacion/route.ts'), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['authorizeFacturaRequest', 'todayArgentina', 'validateFacturaInput', 'getArcaConfigBySociedad', 'getSupabase']);
const selected = ast.statements.filter(n => (ts.isFunctionDeclaration(n) && names.has(n.name?.text)) || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['ARCA_CONFIGS', 'DEFAULT_ARCA_CONFIG'].includes(d.name.getText(ast)))));
const context = { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'must-not-use' } }, client: null, usedKey: null };
context.createClient = (_url, key) => { context.usedKey = key; return context.client; };
context.createSupabaseServer = async () => context.client;
vm.createContext(context);
vm.runInContext(ts.transpileModule(selected.map(n => n.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
function client({ role = 'administrativo', member = true, user = true, last = null, roleError = null, memberError = null } = {}) {
  const filters = [];
  return {
    filters,
    auth: { getUser: async () => ({ data: { user: user ? { id: 'user-one' } : null }, error: null }) },
    from(table) { return {
      select() { return this; }, eq(column, value) { filters.push([table, column, value]); return this; }, order() { return this; }, limit() { return this; },
      async single() { return { data: { role }, error: roleError }; },
      async maybeSingle() { return { data: table === 'user_sociedades' ? (member ? { sociedad_id: 'society-one' } : null) : last, error: table === 'user_sociedades' ? memberError : null }; },
    }; },
  };
}
(async () => {
  const bearerRequest = { headers: { get: () => 'Bearer synthetic-user-token' } };
  for (const role of ['administrativo', 'admin', 'super_admin']) {
    context.client = client({ role });
    await context.authorizeFacturaRequest(bearerRequest, 'society-one');
    assert.equal(context.usedKey, 'anon');
    assert.deepEqual(context.client.filters.filter(f => f[0] === 'user_sociedades'), [['user_sociedades', 'user_id', 'user-one'], ['user_sociedades', 'sociedad_id', 'society-one']]);
  }
  for (const role of ['viewer', 'vendedor', 'unknown']) {
    context.client = client({ role });
    await assert.rejects(context.authorizeFacturaRequest(bearerRequest, 'society-one'), /permiso/);
  }
  for (const options of [{ member: false }, { memberError: { message: 'denied' } }]) {
    context.client = client(options);
    await assert.rejects(context.authorizeFacturaRequest(bearerRequest, 'society-one'), /sociedad/);
  }
  context.client = client({ user: false });
  await assert.rejects(context.authorizeFacturaRequest(bearerRequest, 'society-one'), /Sesión/);
  context.client = client({ roleError: { message: 'denied' } });
  await assert.rejects(context.authorizeFacturaRequest(bearerRequest, 'society-one'), /permiso/);
  context.client = client();
  await context.authorizeFacturaRequest({ headers: { get: () => null } }, 'society-one');
  const params = { sociedadId: 'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021', tipo: 'FA', puntoVenta: 15, fecha: '2026-02-28' };
  for (const fecha of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-01', 'not-a-date']) await assert.rejects(context.validateFacturaInput(client(), { ...params, fecha }), /fecha/);
  await assert.rejects(context.validateFacturaInput(client(), { ...params, puntoVenta: 10 }), /venta/);
  await assert.rejects(context.validateFacturaInput(client({ last: { fecha: '2026-03-01', numero: 12 } }), params), /anterior/);
  await context.validateFacturaInput(client(), params);
  await context.validateFacturaInput(client(), { ...params, fecha: '2024-02-29' });
  console.log('OK: permisos, identidad RLS, sociedad, sesión por cookie, errores de acceso, fechas imposibles y correlatividad (simulados, sin emisión).');
})().catch(error => { console.error(error); process.exitCode = 1; });
