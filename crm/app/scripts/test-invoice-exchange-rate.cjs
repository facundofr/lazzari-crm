const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
function load(file,extra={}) {const context={exports:{},...extra};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const parser=load('src/lib/bna-historical.ts');
let html='',ok=true,requested='';
const rate=load('src/lib/invoice-exchange-rate.ts',{require:()=>parser,AbortSignal,fetch:async(url,opts)=>{requested=url;assert.equal(opts.cache,'no-store');return {ok,text:async()=>html};}});
const row=(date,value)=>`<td>Dolar U.S.A</td><td>1500</td><td>${value}</td><td>${date}</td>`;
(async()=>{
 assert.equal(rate.previousInvoiceDay('2026-09-09'),'2026-09-08');
 assert.equal(rate.previousInvoiceDay('2026-01-01'),'2025-12-31');
 assert.equal(rate.previousInvoiceDay('2024-03-01'),'2024-02-29');
 assert.throws(()=>rate.previousInvoiceDay('2026-02-30'));
 html=row('7/9/2026',1511.5)+row('8/9/2026',1512)+row('9/9/2026',1513.5);
 let result=await rate.getInvoiceExchangeRate('2026-09-09');
 assert.equal(result.valor_venta,1512); assert.equal(result.fecha,'2026-09-08');assert.equal(result.modalidad,'divisas');
 assert.ok(requested.includes('fecha=08%2F09%2F2026'));
 html=row('11/9/2026',1520)+row('14/9/2026',1530);
 result=await rate.getInvoiceExchangeRate('2026-09-14');assert.equal(result.fecha,'2026-09-11');
 html=row('9/9/2026',1513);await assert.rejects(rate.getInvoiceExchangeRate('2026-09-09'));
 html=row('1/8/2026',1513);await assert.rejects(rate.getInvoiceExchangeRate('2026-09-09'));
 html='error';await assert.rejects(rate.getInvoiceExchangeRate('2026-09-09'));
 ok=false;await assert.rejects(rate.getInvoiceExchangeRate('2026-09-09'));
 const api=fs.readFileSync('src/app/api/facturacion/route.ts','utf8');
 assert.ok(api.indexOf('if (manual === true)')<api.indexOf('getInvoiceExchangeRate(fechaFacturaInput, inheritedRateModality)'));
 assert.ok(api.includes('Math.abs(tc - quote.valor_venta)'));
 for(const file of ['src/components/facturacion/emitir-factura-modal.tsx']){
   const ui=fs.readFileSync(file,'utf8');assert.ok(ui.includes('readOnly='));assert.ok(ui.includes('fecha_factura'));assert.ok(ui.includes('canOverrideInvoiceRate(profile?.email)'));assert.ok(ui.includes('cotizacion_override: canOverrideRate && rateOverride'));
 }
 const permission=load('src/lib/invoice-rate-permission.ts').canOverrideInvoiceRate;
 assert.equal(permission('augusto@lazzari.com.ar'),true);
 assert.equal(permission(' AUGUSTO@LAZZARI.COM.AR '),true);
 for(const email of [null,undefined,'admin@lazzari.com.ar','augusto@other.com','augusto@lazzari.com.ar.evil']) assert.equal(permission(email),false);
 assert.ok(api.includes('canOverrideInvoiceRate(user?.email)'));
 assert.ok(api.includes('Cotización modificada por augusto@lazzari.com.ar'));
 assert.ok(api.includes('&& !requestedRateOverride'));
 ok=true;html=row('8/9/2026',1530);
 const billetes=await rate.getInvoiceExchangeRate('2026-09-09','billetes');
 assert.equal(billetes.modalidad,'billetes');assert.equal(billetes.valor_venta,1530);assert.ok(requested.includes('id=billetes'));assert.ok(requested.includes('idMoneda=22'));
 await rate.getInvoiceExchangeRate('2026-09-09','divisas');assert.ok(requested.includes('id=divisas'));assert.ok(requested.includes('idMoneda=55'));
 await assert.rejects(rate.getInvoiceExchangeRate('2026-09-09','blue'));
 assert.ok(api.includes('inheritedRateModality = pr.cotizacion_modalidad'));
 assert.ok(api.includes('automaticInvoiceRate ? inheritedRateModality'));
 console.log('OK: fecha automática, fin de semana, cambio de año/bisiesto, BNA ausente/futuro/antiguo bloqueados, sin caché, protección servidor y controles manuales separados. Sin emisión real.');
 if(process.argv.includes('--live')) {
   const live=load('src/lib/invoice-exchange-rate.ts',{require:()=>parser,AbortSignal,fetch});
   const quote=await live.getInvoiceExchangeRate('2026-09-09');
   assert.equal(quote.fecha,'2026-09-08');assert.equal(quote.valor_venta,1512);console.log('BNA real:',quote);
   const bills=await live.getInvoiceExchangeRate('2026-09-09','billetes');
   assert.equal(bills.fecha,'2026-09-08');assert.equal(bills.modalidad,'billetes');assert.ok(bills.valor_venta>0);console.log('BNA billetes real:',bills);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
