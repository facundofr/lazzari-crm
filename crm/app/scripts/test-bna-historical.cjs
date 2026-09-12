const fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript'), assert=require('node:assert/strict');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/bna-historical.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {parseBnaHistorical:parse,isTrustedBnaCache:trusted,BNA_VERIFIED_SOURCE}=context.exports;
const row=(date,value)=>`<tr><td>Dolar U.S.A</td><td class="dest">1500.0000</td><td class="dest">${value}</td><td>${date}</td></tr>`;
const html=row('7/9/2026','1511.5000')+row('8/9/2026','1512.0000')+row('9/9/2026','1513.5000');
assert.equal(parse(html,'2026-09-08').venta,1512);
assert.equal(parse(html,'2026-09-08').fecha,'2026-09-08');
assert.equal(parse(row('9/9/2026','1513.5')+row('7/9/2026','1511.5'),'2026-09-08').fecha,'2026-09-07');
assert.equal(parse(row('09/09/2026','1513.5'),'2026-09-08'),null);
assert.equal(parse(row('08/09/2026','1.512,00'),'2026-09-08').venta,1512);
assert.equal(parse(row('31/2/2026','1512'),'2026-09-08'),null);
assert.equal(parse(row('8/9/2026','0'),'2026-09-08'),null);
assert.equal(parse('<html>error</html>','2026-09-08'),null);
assert.equal(trusted({fuente:'BNA',es_manual:false}),false);
assert.equal(trusted({fuente:'dolarapi',es_manual:false}),false);
assert.equal(trusted({fuente:BNA_VERIFIED_SOURCE,es_manual:false}),true);
assert.equal(trusted({fuente:'manual',es_manual:true}),true);
console.log('OK: 12 controles BNA: fecha exacta, fechas sin ceros, anterior real, futuro excluido, números y caché antigua.');
if(process.argv.includes('--live')) {
  const html=require('node:child_process').execFileSync('curl',['-fsSL','https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=divisas&fecha=08%2F09%2F2026&idMoneda=55'],{encoding:'utf8'});
  const result=parse(html,'2026-09-08');
  assert.equal(result.fecha,'2026-09-08'); assert.equal(result.venta,1512);
  console.log('BNA oficial, respuesta real:',result);
}
