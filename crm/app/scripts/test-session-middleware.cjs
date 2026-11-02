const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
let user=null,error={name:'AuthSessionMissingError',status:400},active=true,role='vendedor',signedOut=false;
const context={exports:{},process:{env:{}},require(name){
 if(name==='@supabase/ssr')return {createServerClient:()=>({auth:{getUser:async()=>({data:{user},error}),signOut:async()=>{signedOut=true;}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{active,role},error:null})})})})})};
 if(name==='next/server')return {NextResponse:{next:()=>({status:200,cookies:{getAll:()=>[],set:()=>{}}}),json:(body,opts)=>({body,status:opts.status}),redirect:url=>({status:307,location:url.pathname,cookies:{set:()=>{}}})}};
 throw Error(name);
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/supabase/middleware.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const request=pathname=>({cookies:{getAll:()=>[]},nextUrl:{pathname,clone:()=>({pathname})}});
(async()=>{
 assert.equal((await context.exports.updateSession(request('/api/facturacion'))).status,401);
 assert.equal((await context.exports.updateSession(request('/finanzas'))).location,'/login');
 assert.equal((await context.exports.updateSession(request('/login'))).status,200);
 error={name:'AuthRetryableFetchError',status:503};assert.equal((await context.exports.updateSession(request('/api/facturacion'))).status,503);
 user={id:'test'};error=null;assert.equal((await context.exports.updateSession(request('/finanzas'))).status,200);
 // 02/11/2026: con sesión, la raíz y el login llevan a la pantalla de entrada: Augusto (super_admin) a Inicio, el resto a Presupuestos.
 assert.equal((await context.exports.updateSession(request('/'))).location,'/presupuestos');assert.equal((await context.exports.updateSession(request('/login'))).location,'/presupuestos');
 role='super_admin';assert.equal((await context.exports.updateSession(request('/'))).location,'/inicio');assert.equal((await context.exports.updateSession(request('/login'))).location,'/inicio');assert.equal((await context.exports.updateSession(request('/presupuestos'))).status,200);
 active=false;assert.equal((await context.exports.updateSession(request('/finanzas'))).location,'/login');assert.equal(signedOut,true);
 console.log('PASS missing session 401/login redirect; actual outage 503; authenticated/inactive access handled; home by role. Offline.');
})().catch(e=>{console.error(e);process.exitCode=1;});
