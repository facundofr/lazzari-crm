// Execute the actual route with in-memory dependencies. NEVER contacts ARCA/DB.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const society='eee2a3c8-fe6c-494d-bd2f-7a5d8067d021';
let allowed=true,obligado=true,wsCalls=0,emissions=[],origin='FCEA',saved=[];
const client={id:'client',sociedad_id:society,cuit:'30641405554',condicion_iva:'RI',razon_social:'Test'};
const db={auth:{getUser:async()=>({data:{user:{id:'user',email:'augusto@lazzari.com.ar'}}})},from(table){let cols='',inserted=null,filters={};const q={
 select(c){cols=c;return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},neq(){return q;},insert(v){inserted=v;saved.push({table,v});return q;},update(){return q;},
 single(){return q.execute();},maybeSingle(){return q.execute();},then(resolve,reject){return q.execute().then(resolve,reject);},
 async execute(){let data=null;if(table==='profiles')data={role:'admin'};if(table==='user_sociedades')data=allowed?{sociedad_id:society}:null;if(table==='clientes')data=client;if(table==='facturas')data=inserted?{id:'new',...inserted}:filters.id?{tipo:origin,punto_venta:15,numero:1,fecha:'2026-09-12'}:null;if(table==='remitos')data=[];return {data,error:null};}
 };return q;}};
class FixedDate extends Date{constructor(...a){super(...(a.length?a:['2026-09-12T15:00:00Z']));}}
const helper={exports:{},Date:FixedDate};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/fce-invoice.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,helper);
const context={exports:{},console:{error(){}},Buffer,URL,Date:FixedDate,Intl,process:{env:{ARCA_CERT_B64:'fakecert',ARCA_KEY_B64:'fakekey'},cwd:()=>process.cwd()},require(name){
 if(name==='next/server')return {NextResponse:{json:(data,opt={})=>({status:opt.status||200,data})}};
 if(name==='fs')return {existsSync:()=>false};if(name==='path')return path;
 if(name==='@supabase/supabase-js')return {createClient:()=>db};
 if(name==='@/lib/supabase/server')return {createSupabaseServer:async()=>db};
 if(name==='@ramiidv/arca-facturacion')return {Arca:class{async getAuth(){wsCalls++;return {Token:'test',Sign:'test',Cuit:20379309128};}}};
 if(name==='@/lib/arca-wsfe-node')return {crearFacturaWsfeNode:async a=>{emissions.push(a);return {FeDetResp:{FECAEDetResponse:{Resultado:'A',CAE:'12345678901234',CAEFchVto:'20260922',CbteDesde:1}}};}};
 if(name==='@/lib/arca-wsfecred-node')return {consultarObligacionFce:async()=>({obligado,montoDesde:obligado?5549862:null})};
 if(name==='@/lib/invoice-exchange-rate')return {getInvoiceExchangeRate:async()=>({valor_venta:1500,fecha:'2026-09-11'})};
 if(name==='@/lib/invoice-rate-permission')return {canOverrideInvoiceRate:()=>true};
 if(name==='@/lib/fce-invoice')return helper.exports;
 throw new Error(`Unexpected dependency ${name}`);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/api/facturacion/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const base={tipo:'FA',sociedad_id:society,cliente_id:'client',punto_venta:15,moneda:'ARS',fecha:'2026-09-12',items:[{descripcion:'Test',cantidad:1,precio_unitario:6000000,iva_porcentaje:21}]};
const post=body=>context.exports.POST({headers:{get:()=>null},json:async()=>({...base,...body})});
const get=()=>context.exports.GET({headers:{get:()=>null},nextUrl:new URL(`https://test/api/facturacion?action=fce-check&sociedad_id=${society}&cliente_id=client&fecha=2026-09-12`)});
const digit=(s,w)=>(10-w.reduce((sum,x,i)=>sum+x*Number(s[i]),0)%10)%10;
const cbu='0720000'+digit('0720000',[7,1,3,9,7,1,3])+'2000000123456'+digit('2000000123456',[3,9,7,1,3,9,7,1,3,9,7,1,3]);
(async()=>{
 let r=await post({});assert.equal(r.status,409,JSON.stringify(r));assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA',items:[{descripcion:'Test',cantidad:1,precio_unitario:100,iva_porcentaje:21}]});assert.equal(r.status,409);assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA'});assert.equal(r.status,503);assert.equal(emissions.length,0);
 r=await post({tipo:'FCEA',fce_cbu:cbu,fce_transmision:'SCA',fecha_vencimiento:'2026-10-12'});assert.equal(r.status,200,JSON.stringify(r));assert.equal(emissions.length,1);assert.equal(emissions[0].cbteTipo,201);assert.equal(emissions[0].invoice.FchVtoPago,'20261012');assert.ok(saved.find(x=>x.table==='facturas').v.nota_interna.includes('[ARCA_FCE_V1]'));
 emissions=[];r=await post({tipo:'NCA',factura_origen_id:'original'});assert.equal(r.status,409);assert.equal(emissions.length,0);
 r=await post({items:[{descripcion:'bad',cantidad:Infinity,precio_unitario:1}]});assert.equal(r.status,400);assert.equal(emissions.length,0);
 r=await get();assert.equal(r.status,200);assert.equal(r.data.obligado,true);
 allowed=false;const before=wsCalls;r=await post({});assert.equal(r.status,403);r=await get();assert.equal(r.status,403);assert.equal(wsCalls,before);assert.equal(emissions.length,0);
 console.log('OK actual POST/GET route: threshold mismatches, missing fields, valid mocked FCE, originalFCE note bypass blocked, invalid amount, auth isolation. NO NETWORK/FISCAL EMISSION.');
})().catch(e=>{console.error(e);process.exitCode=1;});
