// Execute the actual route with in-memory dependencies. NEVER contacts ARCA/DB.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const society='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
let allowed=true,obligado=true,wsCalls=0,emissions=[],origin='FCEA',fceState='PendienteRecepcion',saved=[],rpcCalls=[],failNcPersist=false,failFacturaPersist=false,timeout=false,failTable=null,preflight=false;
const attempts=new Map();
const client={id:'client',sociedad_id:society,cuit:'30641405554',condicion_iva:'RI',razon_social:'Test'};
const db={auth:{getUser:async()=>({data:{user:{id:'user',email:'augusto@lazzari.com.ar'}}})},from(table){let cols='',inserted=null,filters={};const q={
 select(c){cols=c;return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},neq(){return q;},insert(v){inserted=v;saved.push({table,v});return q;},update(){return q;},
 single(){return q.execute();},maybeSingle(){return q.execute();},then(resolve,reject){return q.execute().then(resolve,reject);},
 async execute(){if(inserted&&table===failTable)return {data:null,error:{message:'simulated DB failure'}};let data=null;if(table==='profiles')data={role:'admin'};if(table==='user_sociedades')data=allowed?{sociedad_id:society}:null;if(table==='clientes')data=client;if(table==='facturas')data=inserted?{id:'new',...inserted}:filters.id?{tipo:origin,punto_venta:15,numero:1,fecha:'2026-09-12'}:null;if(table==='remitos')data=[];return {data,error:null};}
 };return q;}};
db.rpc=async(name,p)=>{
 rpcCalls.push({name,p});
 if(name==='registrar_factura_venta_autorizada'){
  if(failFacturaPersist)return {data:null,error:{message:'simulated invoice persistence failure'}};
  saved.push({table:'facturas',v:p.p_factura});return {data:{factura_id:'fa-new',replayed:false},error:null};
 }
 if(name==='registrar_nota_credito_venta_autorizada'){
  if(failNcPersist)return {data:null,error:{message:'simulated NC persistence failure'}};
  return {data:{factura_id:'nc-new',factura_origen_id:p.p_factura_origen_id,credito_aplicado:p.p_factura.total,saldo_a_favor:0,saldo_restante:0},error:null};
 }
 const key=p.p_sociedad_id+':'+p.p_request_key;
 const old=attempts.get(key);
 if(name==='reservar_emision_fiscal'){
  if(old){if(old.hash!==p.p_payload_hash)return {error:{message:'hash mismatch'}};return {data:{...old,acquired:false}};}
  if([...attempts.values()].some(x=>x.pv===p.p_punto_venta&&x.state!=='completed'))return {error:{message:'PV reserved'}};
  const row={hash:p.p_payload_hash,pv:p.p_punto_venta,state:'reserved',status:null,response:null};attempts.set(key,row);return {data:{...row,acquired:true}};
 }
 if(!old||old.hash!==p.p_payload_hash)return {error:{message:'missing attempt'}};
 Object.assign(old,{state:p.p_state,status:p.p_status,response:p.p_response});return {data:old,error:null};
};
class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2026-09-12T15:00:00Z']));}}
const helper={exports:{},Date:FixedDate};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/fce-invoice.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,helper);
const context={exports:{},console:{error(){}},Buffer,URL,Date:FixedDate,Intl,process:{env:{ARCA_CERT_B64:'fakecert',ARCA_KEY_B64:'fakekey'},cwd:()=>process.cwd()},require(name){
 if(name==='next/server')return {NextResponse:{json:(data,opt={})=>({status:opt.status||200,data})}};
 if(name==='fs')return {existsSync:()=>false};if(name==='path')return path;
 if(name==='@supabase/supabase-js')return {createClient:()=>db};
 if(name==='@/lib/supabase/server')return {createSupabaseServer:async()=>db};
 if(name==='@ramiidv/arca-facturacion')return {Arca:class{async getAuth(){wsCalls++;return {Token:'test',Sign:'test',Cuit:20379309128};}}};
 if(name==='@/lib/arca-wsfe-node')return {crearFacturaWsfeNode:async a=>{if(preflight)throw Object.assign(new Error('invalid fiscal date'),{wsfeNotSubmitted:true});emissions.push(a);if(timeout)throw new Error('timeout');return {FeDetResp:{FECAEDetResponse:{Resultado:'A',CAE:'12345678901234',CAEFchVto:'20260922',CbteDesde:1}}};}};
 if(name==='@/lib/fiscal-emission-guard'){const m={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/fiscal-emission-guard.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m);return m.exports;}
 if(name==='@/lib/fiscal-environment')return {assertSafeFiscalEnvironment:()=>{}};
 if(name==='@/lib/arca-wsfecred-node')return {consultarObligacionFce:async()=>({obligado,montoDesde:obligado?5549862:null}),consultarComprobanteFce:async()=>({estado:fceState,fechaHora:'2026-09-12T10:00:00-03:00',historial:[]})};
 if(name==='@/lib/invoice-exchange-rate')return {getInvoiceExchangeRate:async()=>({valor_venta:1500,fecha:'2026-09-11'})};
 if(name==='@/lib/invoice-rate-permission')return {canOverrideInvoiceRate:()=>true};
 if(name==='@/lib/factura-moneda'){const m={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/factura-moneda.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m);return m.exports;}
 if(name==='@/lib/documento-cliente'){const m={exports:{},require};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/documento-cliente.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m);return m.exports;}
 if(name==='@/lib/fce-invoice')return helper.exports;
 throw new Error(`Unexpected dependency ${name}`);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/facturacion/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const base={tipo:'FA',sociedad_id:society,cliente_id:'client',punto_venta:15,moneda:'ARS',fecha:'2026-09-12',items:[{descripcion:'Test',cantidad:1,precio_unitario:6000000,iva_porcentaje:21}]};
const key='11111111-1111-4111-8111-111111111111';
const post=(body,k=key)=>context.exports.POST({headers:{get:n=>n==='Idempotency-Key'?k:null},json:async()=>({...base,...body})});
const get=()=>context.exports.GET({headers:{get:()=>null},nextUrl:new URL(`https://test/api/facturacion?action=fce-check&sociedad_id=${society}&cliente_id=client&fecha=2026-09-12`)});
const digit=(s,w)=>(10-w.reduce((sum,x,i)=>sum+x*Number(s[i]),0)%10)%10;
const cbu='0720000'+digit('0720000',[7,1,3,9,7,1,3])+'2000000123456'+digit('2000000123456',[3,9,7,1,3,9,7,1,3,9,7,1,3]);
(async()=>{
 let r=await post({});assert.equal(r.status,409,JSON.stringify(r));assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA',items:[{descripcion:'Test',cantidad:1,precio_unitario:100,iva_porcentaje:21}]});assert.equal(r.status,409);assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA'});assert.equal(r.status,503);assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA',fce_cbu:cbu,fce_transmision:'SCA',fecha_vencimiento:'2026-10-12'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(emissions.length,1);assert.equal(emissions[0].cbteTipo,201);assert.equal(emissions[0].invoice.FchVtoPago,'20261012');assert.ok(saved.find(x=>x.table==='facturas').v.nota_interna.includes('[ARCA_FCE_V1]'));
 emissions=[];r=await post({tipo:'NCA',factura_origen_id:'original'});assert.equal(r.status,400);assert.equal(emissions.length,0);
 origin='FB';r=await post({tipo:'NCA',factura_origen_id:'original'},'99999999-9999-4999-8999-999999999999');assert.equal(r.status,400);assert.match(r.data.error,/NCA.*FA/);assert.equal(emissions.length,0);
 origin='FA';attempts.clear();emissions=[];r=await post({tipo:'NCA',factura_origen_id:'original',nota_credito_modo:'total',items:[{descripcion:'Anulación total',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},'77777777-7777-4777-8777-777777777777');assert.equal(r.status,200,JSON.stringify(r));assert.equal(emissions.length,1);assert.equal(emissions[0].cbteTipo,3);assert.equal(r.data.aplicacion.factura_origen_id,'original');origin='FCEA';
 attempts.clear();emissions=[];rpcCalls=[];r=await post({tipo:'NCEA',factura_origen_id:'original',nota_credito_modo:'items',items:[{descripcion:'Ajuste FCE',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},'44444444-4444-4444-8444-444444444444');assert.equal(r.status,200,JSON.stringify(r));assert.equal(emissions.length,1);assert.equal(emissions[0].cbteTipo,203);assert.deepEqual(JSON.parse(JSON.stringify(emissions[0].invoice.CbtesAsoc)),[{Tipo:201,PtoVta:15,Nro:1,Cuit:20379309128,CbteFch:'20260912'}]);assert.equal(r.data.factura.id,'nc-new');assert.ok(rpcCalls.some(x=>x.name==='registrar_nota_credito_venta_autorizada'&&x.p.p_factura_origen_id==='original'));
 attempts.clear();emissions=[];failNcPersist=true;const recoverKey='88888888-8888-4888-8888-888888888888';r=await post({tipo:'NCEA',factura_origen_id:'original',items:[{descripcion:'Recuperable',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},recoverKey);assert.equal(r.status,200);assert.equal(r.data.reconciliation_required,true);assert.equal(emissions.length,1);failNcPersist=false;r=await post({tipo:'NCEA',factura_origen_id:'original',items:[{descripcion:'Recuperable',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},recoverKey);assert.equal(r.status,200);assert.equal(r.data.reconciliation_required,false);assert.equal(emissions.length,1,'recovery after CAE must not emit again');
 attempts.clear();emissions=[];fceState='Aceptado';r=await post({tipo:'NCEA',factura_origen_id:'original',items:[{descripcion:'Ajuste FCE',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},'55555555-5555-4555-8555-555555555555');assert.equal(r.status,409);assert.equal(r.data.fce_estado,'Aceptado');assert.equal(emissions.length,0);fceState='PendienteRecepcion';
 origin='FA';r=await post({tipo:'NCEA',factura_origen_id:'original',items:[{descripcion:'Ajuste FCE',cantidad:1,precio_unitario:100,iva_porcentaje:21}]},'66666666-6666-4666-8666-666666666666');assert.equal(r.status,400);assert.equal(emissions.length,0);origin='FCEA';
 r=await post({items:[{descripcion:'bad',cantidad:Infinity,precio_unitario:1}]});assert.equal(r.status,400);assert.equal(emissions.length,0);
 r=await get();assert.equal(r.status,200);assert.equal(r.data.obligado,true);
 allowed=false;const before=wsCalls;r=await post({});assert.equal(r.status,403);r=await get();assert.equal(r.status,403);assert.equal(wsCalls,before);assert.equal(emissions.length,0);
 allowed=true;obligado=false;attempts.clear();emissions=[];
 const small={items:[{descripcion:'Test',cantidad:1,precio_unitario:100,iva_porcentaje:21}]};
 const concurrent=await Promise.all([post(small),post(small)]);assert.equal(emissions.length,1);assert.ok(concurrent.some(x=>x.status===200));
 r=await post(small);assert.equal(r.status,200);assert.equal(emissions.length,1,'replay must not emit');
 r=await post({...small,observaciones:'changed'});assert.equal(r.status,500);assert.equal(emissions.length,1,'changed payload blocked');
 attempts.clear();emissions=[];timeout=true;r=await post(small);assert.equal(r.status,500);
 timeout=false;r=await post(small);assert.equal(r.status,409);assert.equal(emissions.length,1,'uncertain retry must not emit');
 r=await post(small,'22222222-2222-4222-8222-222222222222');assert.equal(r.status,500);assert.equal(emissions.length,1,'other intent blocked while PV unresolved');
 // H13: si falla el registro de la factura común después del CAE, queda "authorized" y al reintentar se registra SIN volver a emitir.
 attempts.clear();emissions=[];failFacturaPersist=true;r=await post(small);assert.equal(r.status,200);assert.equal(r.data.reconciliation_required,true);assert.equal([...attempts.values()][0].state,'authorized');
 failFacturaPersist=false;rpcCalls=[];r=await post(small);assert.equal(r.data.factura.cae,'12345678901234');assert.equal(r.data.reconciliation_required,false);assert.equal(r.data.factura.id,'fa-new');assert.equal(emissions.length,1,'recovery after CAE must not emit again');assert.equal([...attempts.values()][0].state,'completed');assert.ok(rpcCalls.some(x=>x.name==='registrar_factura_venta_autorizada'&&x.p.p_items.length===1&&x.p.p_factura.cae==='12345678901234'));
 attempts.clear();emissions=[];preflight=true;r=await post(small);assert.equal(r.status,422);assert.equal(r.data.emission_completed,true);assert.equal([...attempts.values()][0].state,'completed');assert.equal(emissions.length,0);
 preflight=false;r=await post(small,'33333333-3333-4333-8333-333333333333');assert.equal(r.status,200);assert.equal(emissions.length,1,'preflight failure releases PV safely');
 console.log('OK actual POST/GET route plus concurrent requests, completed replay, changed payload, uncertain retry, PV locking, CAE recovery after invoice/items DB failure and safe pre-send failure. MOCKS ONLY; no network/fiscal emission.');
})().catch(e=>{console.error(e);process.exitCode=1;});
