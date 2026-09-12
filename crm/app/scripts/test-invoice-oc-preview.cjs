const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {renderToStaticMarkup}=require('react-dom/server');
const source=fs.readFileSync('src/app/(crm)/ventas/page.tsx','utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const candidates=[];
function visit(node){if(ts.isJsxElement(node)){const text=node.getText(ast);if(text.includes('OC cliente:')&&text.includes('Fecha:')&&text.includes('Abrir OC adjunta'))candidates.push(text);}ts.forEachChild(node,visit);}
visit(ast);candidates.sort((a,b)=>a.length-b.length);assert.ok(candidates.length);
const code=`export function render(emitVenta:any){return (${candidates[0]});}`;
const ctx={exports:{},require,formatDate:date=>date.split('-').reverse().join('/')};
vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,ctx);
function render(oc){return renderToStaticMarkup(ctx.exports.render({presupuesto:oc}));}
const full=render({oc_cliente:'4500023989',oc_cliente_fecha:'2026-09-08',archivo_url:'https://example.test/oc.pdf'});
assert.ok(full.includes('4500023989'));assert.ok(full.includes('08/09/2026'));assert.ok(full.includes('href="https://example.test/oc.pdf"'));assert.ok(full.includes('target="_blank"'));
const dateOnly=render({oc_cliente_fecha:'2026-09-08'});assert.ok(dateOnly.includes('Sin número informado'));assert.ok(dateOnly.includes('08/09/2026'));assert.ok(!dateOnly.includes('href='));
const noDate=render({oc_cliente:'123'});assert.ok(noDate.includes('Sin informar'));assert.ok(!noDate.includes('href='));
assert.ok(source.includes('oc_cliente, oc_cliente_fecha, archivo_url'));
assert.equal((source.match(/oc_cliente_fecha: p\.oc_cliente_fecha \|\| null/g)||[]).length,2);
console.log('OK: bloque real de OC muestra número, fecha y archivo; admite fecha sola, indica datos faltantes y conserva fecha en emisión ARCA/manual. Sin red ni emisión.');
