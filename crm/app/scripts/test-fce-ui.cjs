const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let cursor=0,slots=[],effects=[],requests=[];
const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}};
const context={exports:{},URLSearchParams,AbortController,require:name=>name==='react'?react:{supabase:{auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}}},fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/use-fce-check.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
let props=[true,'soc-a','client-a','2026-09-12'];
function render(){cursor=0;const result=context.exports.useFceCheck(...props);const todo=effects;effects=[];todo.forEach(f=>f());return result;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function respond(index,data,ok=true){requests[index].resolve({ok,json:async()=>data});}
(async()=>{
 assert.equal(context.exports.fceTotalArs([{cantidad:1,precio_unitario:0.03,iva_porcentaje:21},{cantidad:1,precio_unitario:0.03,iva_porcentaje:21}],true),0.08);
 assert.equal(context.exports.fceTotalArs([{cantidad:1,precio_unitario:4235,iva_porcentaje:21}],false,1499),6348265);
 assert.equal(render().ready,false);await flush();assert.match(requests[0].url,/cliente_id=client-a/);
 assert.equal(requests[0].options.headers.Authorization,'Bearer test-token');
 respond(0,{obligado:true,montoDesde:5549862});await flush();assert.equal(render().ready,true);
 props=[true,'soc-a','client-b','2026-09-12'];assert.equal(render().ready,false);await flush();
 props=[true,'soc-b','client-b','2026-09-11'];assert.equal(render().ready,false);await flush();assert.equal(requests[1].options.signal.aborted,true);
 respond(1,{obligado:false,montoDesde:null});await flush();assert.equal(render().ready,false);
 respond(2,{obligado:true,montoDesde:null});await flush();assert.equal(render().ready,false);assert.ok(render().error);
 render().retry();assert.equal(render().ready,false);await flush();respond(3,{obligado:false,montoDesde:null});await flush();assert.equal(render().ready,true);
 props=[false,'soc-b','client-b','2026-09-11'];render();props=[true,'soc-b','client-b','2026-09-11'];assert.equal(render().ready,false);
 for(const file of ['src/components/facturacion/emitir-factura-modal.tsx']){const ui=fs.readFileSync(file,'utf8');for(const token of ['fceBlocked','fce_cbu','fce_transmision','fceExpectedTipo','Reintentar verificación FCE'])assert.ok(ui.includes(token),`${file}: ${token}`);}
 const billing=fs.readFileSync('src/app/(crm)/facturacion/facturacion-content.tsx','utf8');
 // La nota de crédito vive en su propia ventana (la usan Facturación y Finanzas): se controla ahí.
 const nc=fs.readFileSync('src/components/facturacion/nota-credito-venta-modal.tsx','utf8');
 for(const token of ['ncEsFce','código ARCA','disabled={ncEsFce}','nota_credito_modo: ncMode','Importe libre','Por ítems']) assert.ok(nc.includes(token),`facturación NC: ${token}`);
 assert.ok(billing.includes('<NotaCreditoVentaModal'),'facturación usa la ventana de NC');
 assert.match(nc,/setNcManual\(!\["FCEA", "FCEB"\]\.includes\(factura\.tipo\)/);
 const ventas=fs.readFileSync('src/app/(crm)/ventas/page.tsx','utf8');assert.ok(ventas.includes('visibilitychange'));assert.ok(ventas.includes('ventas-presupuestos-'));assert.ok(ventas.includes('<EmitirFacturaModal'));assert.ok(billing.includes('<EmitirFacturaModal'));assert.ok(!ventas.includes('fce_cbu'));assert.ok(!billing.includes('fce_cbu'));
 console.log('OK: FCE UI race guards, society/client/date isolation, malformed threshold fails closed, retry, reopen, required fields and filter refresh wiring. No network or real invoices.');
})().catch(e=>{console.error(e);process.exitCode=1;});
