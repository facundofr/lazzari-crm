const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const source=ts.transpileModule(fs.readFileSync('src/lib/invoice-intent.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const storage=new Map(),locks=new Map();let count=0,requests=[];
const lockManager={request(name,options,callback){assert.equal(options.mode,'exclusive');const previous=locks.get(name)||Promise.resolve();const current=previous.catch(()=>{}).then(callback);locks.set(name,current);return current;}};
function load(blockStorage=false,noLocks=false){const ctx={exports:{},Map,Headers,navigator:noLocks?{}:{locks:lockManager},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++count).padStart(12,'0')}`},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(blockStorage)throw new Error('blocked');storage.set(key,value);}},fetch:(url,init)=>new Promise((resolve,reject)=>requests.push({url,init,resolve,reject}))};vm.runInNewContext(source,ctx);return ctx.exports;}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const keyAt=i=>requests[i].init.headers.get('Idempotency-Key');
(async()=>{
 let api=load();api.beginInvoiceIntent('soc:form');
 const first=api.postInvoiceIntent('soc:form',{body:'one'}),double=api.postInvoiceIntent('soc:form',{body:'one'});await flush();
 assert.equal(requests.length,1);const key=requests[0].init.headers.get('Idempotency-Key');assert.ok(key);
 requests[0].reject(new Error('network uncertain'));await Promise.allSettled([first,double]);
 api=load();api.beginInvoiceIntent('soc:form');const retry=api.postInvoiceIntent('soc:form',{body:'one'});await flush();
 assert.equal(requests[1].init.headers.get('Idempotency-Key'),key);requests[1].resolve(response({error:'pending'},409));await retry;
 const again=api.postInvoiceIntent('soc:form',{body:'edited'});await flush();assert.equal(requests[2].init.headers.get('Idempotency-Key'),key);
 requests[2].resolve(response({success:true,factura:{id:'f1'}}));await again;
 const replay=api.postInvoiceIntent('soc:form',{body:'edited'});await flush();assert.equal(requests[3].init.headers.get('Idempotency-Key'),key);requests[3].resolve(response({success:true}));await replay;
 api.beginInvoiceIntent('soc:form');const next=api.postInvoiceIntent('soc:form',{body:'new'});await flush();assert.notEqual(requests[4].init.headers.get('Idempotency-Key'),key);requests[4].resolve(response({success:true}));await next;
 const blocked=load(true);await assert.rejects(blocked.postInvoiceIntent('newscope',{body:'x'}),/almacenamiento/);assert.equal(requests.length,5);
 await assert.rejects(load(false,true).postInvoiceIntent('no-lock',{body:'x'}),/pestañas/);assert.equal(requests.length,5);
 const tabA=load(),tabB=load();tabA.beginInvoiceIntent('cross');tabB.beginInvoiceIntent('cross');
 const a=tabA.postInvoiceIntent('cross',{body:'same'}),b=tabB.postInvoiceIntent('cross',{body:'same'});await flush();assert.equal(requests.length,6);
 requests[5].resolve(response({success:true}));await a;await flush();assert.equal(requests.length,7);assert.equal(keyAt(5),keyAt(6));requests[6].resolve(response({success:true}));await b;
 tabA.beginInvoiceIntent('cross');tabB.beginInvoiceIntent('cross');
 const a2=tabA.postInvoiceIntent('cross',{body:'new'}),b2=tabB.postInvoiceIntent('cross',{body:'new'});await flush();assert.notEqual(keyAt(7),keyAt(5));requests[7].resolve(response({success:true}));await a2;await flush();assert.equal(keyAt(7),keyAt(8));requests[8].resolve(response({success:true}));await b2;
 const rejected=tabA.postInvoiceIntent('rejected',{body:'invalid'});await flush();requests[9].resolve(response({error:'ARCA rejected',emission_completed:true},422));await rejected;
 tabA.beginInvoiceIntent('rejected');const corrected=tabA.postInvoiceIntent('rejected',{body:'corrected'});await flush();assert.notEqual(keyAt(9),keyAt(10));requests[10].resolve(response({success:true}));await corrected;
 const uncertain=tabA.postInvoiceIntent('reconcile',{body:'x'});await flush();requests[11].resolve(response({success:true,reconciliation_required:true}));await uncertain;tabA.beginInvoiceIntent('reconcile');const uncertainRetry=tabA.postInvoiceIntent('reconcile',{body:'x'});await flush();assert.equal(keyAt(11),keyAt(12));requests[12].resolve(response({success:true}));await uncertainRetry;
 for(const name of ['ventas/page.tsx','facturacion/facturacion-content.tsx']){const ui=fs.readFileSync('src/app/(crm)/'+name,'utf8');assert.ok(!ui.includes('fetch("/api/facturacion", {'));assert.ok(ui.includes('postInvoiceIntent'));}
 console.log('OK: cross-tab exclusive lock and single rotation, retry/reload UUID stable, definitive rejection reset only on reopen, reconciliation remains pending, absent locks/storage fail closed. No network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
