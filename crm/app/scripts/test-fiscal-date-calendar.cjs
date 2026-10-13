const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let cursor=0,slots=[],effects=[],requests=[];
const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useEffect(fn,deps){const index=cursor++,old=slots[index];if(!old || deps.some((v,i)=>v!==old.deps[i])){effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:fn()};});}}};
const context={exports:{},URLSearchParams,AbortController,require:()=>react,fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/use-fiscal-date-limits.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
let props=[true,'soc-a',10,'FA'];
function render(){cursor=0;const result=context.exports.useFiscalDateLimits(...props);const pending=effects;effects=[];pending.forEach(fn=>fn());return result;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function respond(req,soc,pv,type,date,ok=true,warning=''){req.resolve({ok,json:async()=>({sociedad_id:soc,punto_venta:pv,tipo:type,minDate:date,error:'No disponible',warning})});}
(async()=>{
 assert.equal(render().ready,false);assert.equal(requests.length,1);
 respond(requests[0],'soc-a',10,'FA','2026-09-12');await flush();assert.equal(render().minDate,'2026-09-12');assert.equal(render().ready,true);
 props=[true,'soc-a',15,'FA'];assert.equal(render().ready,false);assert.equal(render().minDate,null);
 props=[true,'soc-b',10,'FB'];assert.equal(render().ready,false);assert.equal(requests[1].options.signal.aborted,true);
 respond(requests[1],'soc-a',15,'FA','2026-09-11');await flush();assert.equal(render().ready,false);
 respond(requests[2],'soc-b',10,'FB',null);await flush();assert.equal(render().ready,true);assert.equal(render().minDate,null);
 render().retry();assert.equal(render().ready,true);assert.equal(render().ready,false);
 respond(requests[3],'soc-b',10,'FB','2026-09-20',true,'ARCA no respondió');await flush();assert.equal(render().ready,true);assert.equal(render().warning,'ARCA no respondió');
 render().retry();assert.equal(render().ready,true);assert.equal(render().ready,false);
 respond(requests[4],'soc-b',10,'FB',null,false);await flush();assert.equal(render().ready,false);assert.equal(render().error,'No disponible');
 props=[false,'soc-b',10,'FB'];assert.equal(render().ready,true);
 props=[true,'soc-b',10,'FB'];assert.equal(render().ready,false);
 for(const file of ['src/components/facturacion/emitir-factura-modal.tsx']){const ui=fs.readFileSync(file,'utf8');assert.ok(ui.includes('min={emitManual ? minFecha : fiscalMinDate}'));assert.ok(ui.includes('disabled={!emitManual && !fiscalDates.ready}'));assert.ok(ui.includes('fiscalDateBlocked'));}
 console.log('OK: calendario valida por sociedad/PV/tipo, admite respaldo local advertido, descarta respuestas viejas, reintento y reapertura. Sin red ni emisión.');
})().catch(e=>{console.error(e);process.exitCode=1;});
