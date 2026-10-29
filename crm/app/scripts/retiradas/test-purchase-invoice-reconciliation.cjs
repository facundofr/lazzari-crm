const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/purchase-invoice-reconciliation.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const context = { exports: {} }; vm.runInNewContext(js, context);
const reconcile = context.exports.reconcilePurchaseLines;
const { assertCompleteInvoiceOrderSelection, canMarkPurchaseOrdersPaid, markupForFixedSalePrice } = context.exports;
const componentSource = fs.readFileSync(path.join(__dirname, '../src/components/cargar-factura-oc.tsx'), 'utf8');
const atomicMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260925203000_factura_compra_oc_extra_atomica.sql'), 'utf8');
test('Duplicados normalizan ceros, espacios y separador de punto de venta', () => {
  assert.equal(context.exports.canonicalPurchaseInvoiceNumber(' 1 / 123 '), context.exports.canonicalPurchaseInvoiceNumber('00001-00000123'));
});
const a = { id: 'a', orden_id: 'oc', codigo: 'A', descripcion: 'Válvula A', cantidad: 10, precio_unitario: 100, iva_porcentaje: 21 };
const b = { id: 'b', orden_id: 'oc', codigo: 'B', descripcion: 'Válvula B', cantidad: 2, precio_unitario: 200, iva_porcentaje: 21 };
test('Líneas reordenadas conservan la identidad de artículo', () => {
  const r = reconcile([a,b], [{...b,cantidad:1,precio_unitario:250}, {...a,cantidad:4,precio_unitario:120}]);
  assert.equal(r.extras.length, 0); assert.equal(r.costs.find(x=>x.line.id==='a').cost,120); assert.equal(r.costs.find(x=>x.line.id==='b').cost,250);
});
test('Solo la cantidad adicional genera OC extra, a costo neto real', () => {
  const r = reconcile([a], [{...a,cantidad:12,precio_unitario:150}]);
  assert.equal(r.extras.length,1); assert.equal(r.extras[0].cantidad,2); assert.equal(r.extras[0].precio_unitario,150);
});
test('Facturas anteriores consumen cantidad pendiente', () => {
  const r = reconcile([a], [{...a,cantidad:4}], [{...a,cantidad:8}]); assert.equal(r.extras[0].cantidad,2);
});
test('Una diferencia de precio no crea artículos adicionales', () => {
  assert.equal(reconcile([a], [{...a,cantidad:2,precio_unitario:1000}]).extras.length,0);
});
test('Descuentos se reflejan en costo neto', () => {
  assert.equal(reconcile([a], [{...a,cantidad:2,descuento_porcentaje:10}]).costs[0].cost,90);
});
test('Descripción ambigua entre códigos diferentes queda sin asignar, sin bloquear', () => {
  const r = reconcile([a,{...a,id:'z',codigo:'Z'}],[{...a,codigo:null}]);
  assert.equal(r.extras.length,1);
});
test('Cantidades inválidas se rechazan', () => { assert.throws(()=>reconcile([a],[{...a,cantidad:-1}]),/inválido/); });
test('Dos códigos distintos nunca se sustituyen por descripción igual', () => {
  const r=reconcile([a],[{...a,codigo:'Z',cantidad:1}]); assert.equal(r.costs.length,0); assert.equal(r.extras.length,1);
});
test('Un código repetido se concilia por la descripción completa de la variante', () => {
  const negro40 = {...a,id:'n40',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - REF 0340 - TALLE 40',cantidad:6};
  const negro42 = {...a,id:'n42',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - REF 0342 - TALLE 42',cantidad:14};
  const r = reconcile([negro40, negro42], [{...negro42,cantidad:14,precio_unitario:25000}]);
  assert.equal(r.extras.length,0); assert.equal(r.costs.length,1); assert.equal(r.costs[0].line.id,'n42');
});
test('Un código repetido sin color o talle queda para asignación manual', () => {
  const negro40 = {...a,id:'n40',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - TALLE 40'};
  const negro42 = {...a,id:'n42',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - TALLE 42'};
  const r = reconcile([negro40,negro42],[{...a,codigo:'222020',descripcion:'PANTALON OMBU CARGO'}]);
  assert.equal(r.extras.length,1);
});
test('Una coincidencia ambigua se puede resolver manualmente sin bloquear la factura', () => {
  const negro40 = {...a,id:'n40',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - TALLE 40'};
  const negro42 = {...a,id:'n42',codigo:'222020',descripcion:'PANTALON OMBU CARGO - NEGRO - TALLE 42'};
  const factura = {...a,tempId:'fact-1',codigo:'222020',descripcion:'PANTALON OMBU CARGO',cantidad:1,precio_unitario:25000};
  const r = reconcile([negro40,negro42],[factura],[],{'fact-1':'n42'});
  assert.equal(r.extras.length,0);
  assert.equal(r.costs[0].line.id,'n42');
});
test('Un artículo marcado manualmente como fuera de OC queda como extra sin bloquear', () => {
  const factura = {...a,tempId:'fact-extra',codigo:'Z',descripcion:'ARTICULO EXTRA',cantidad:2};
  const r = reconcile([a],[factura],[],{'fact-extra':'__extra__'});
  assert.equal(r.extras.length,1);
  assert.equal(r.extras[0].descripcion,'ARTICULO EXTRA');
});
test('Costo inconsistente del mismo artículo se rechaza', () => {
  assert.throws(()=>reconcile([a],[{...a,cantidad:1,precio_unitario:100},{...a,cantidad:1,precio_unitario:200}]),/dos costos/);
});
test('Factura anterior compartida A+B no puede consumir toda su cantidad solamente en B', () => {
  assert.throws(() => assertCompleteInvoiceOrderSelection(['B'], [{ orden_compra_id: 'A', numero: 'OC-A' }, { orden_compra_id: 'B', numero: 'OC-B' }]), /Agregá también OC-A/);
});
test('La selección completa A+B permite conciliar cantidades acumuladas', () => {
  assertCompleteInvoiceOrderSelection(['A','B'], [{ orden_compra_id: 'A' }, { orden_compra_id: 'B' }]);
  const r = reconcile([{...a,id:'a',orden_id:'A',cantidad:10},{...a,id:'b',orden_id:'B',cantidad:10}], [{...a,cantidad:5}], [{...a,cantidad:15}]);
  assert.equal(r.extras.length,0);
});
test('Factura anterior pendiente 80 + nueva pagada 20 no marca OC pagada', () => {
  assert.equal(canMarkPurchaseOrdersPaid([{estado:'pendiente_aprobacion'}],20,20),false);
  assert.equal(canMarkPurchaseOrdersPaid([{estado:'pagada'}],20,20),true);
  assert.equal(canMarkPurchaseOrdersPaid([{estado:'pagada'}],40,20),false);
});
test('Costo real en ARS recalcula markup del PR en USD sin tocar la venta', () => {
  assert.equal(markupForFixedSalePrice(1.20, 600, 'ARS', 'USD', 1000), 100);
  assert.equal(markupForFixedSalePrice(1.20, 0.60, 'USD', 'USD', 1000), 100);
});
test('Cambio de moneda sin cotización falla cerrado en vez de guardar un markup falso', () => {
  assert.equal(markupForFixedSalePrice(1.20, 600, 'ARS', 'USD', 0), null);
});
test('Factura con extras delega todo el alta contable a una sola RPC', () => {
  assert.match(componentSource, /rpc\(\s*["']registrar_factura_compra_con_oc_extra["']/);
  assert.match(componentSource, /if \(atomicError\) throw new Error/);
  assert.doesNotMatch(componentSource, /Error al crear OC extras/);
  assert.doesNotMatch(componentSource, /if \(extraOCErr\) console\.error/);
});
test('RPC de extras valida sociedad, proveedor, moneda y bloquea las OC antes de insertar', () => {
  assert.match(atomicMigration, /public\.user_sociedades/);
  assert.match(atomicMigration, /sociedad_id = p_sociedad_id/);
  assert.match(atomicMigration, /proveedor_id = v_proveedor_id/);
  assert.match(atomicMigration, /moneda::text = v_moneda::text/);
  assert.match(atomicMigration, /order by id\s+for update/);
  assert.match(atomicMigration, /security definer\s+set search_path = pg_catalog/);
});
test('RPC inserta factura, OC extra, sus ítems y ambos vínculos dentro de la misma función', () => {
  assert.match(atomicMigration, /insert into public\.facturas_compra \(/);
  assert.match(atomicMigration, /insert into public\.facturas_compra_items \(/);
  assert.match(atomicMigration, /insert into public\.ordenes_compra \(/);
  assert.match(atomicMigration, /insert into public\.orden_compra_items \(/);
  assert.equal((atomicMigration.match(/insert into public\.factura_compra_ocs/g) || []).length, 2);
  assert.doesNotMatch(atomicMigration, /when others/);
});
