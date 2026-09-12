// Real PostgreSQL engine in-memory via optional PGlite, never a live database.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node scripts/test-fiscal-emission-sql.cjs
const fs=require('node:fs'),assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const s1='11111111-1111-4111-8111-111111111111',s2='22222222-2222-4222-8222-222222222222';
const u1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',u2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',u3='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const k1='00000000-0000-4000-8000-000000000001',k2='00000000-0000-4000-8000-000000000002',k3='00000000-0000-4000-8000-000000000003';
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.sociedades(id uuid primary key);create table public.profiles(id uuid primary key,role text);
 create table public.user_sociedades(user_id uuid,sociedad_id uuid);
 insert into public.sociedades values('${s1}'),('${s2}');
 insert into public.profiles values('${u1}','admin'),('${u2}','administrativo'),('${u3}','viewer');
 insert into public.user_sociedades values('${u1}','${s1}'),('${u2}','${s1}'),('${u3}','${s1}');`);
 const migration=fs.readFileSync('supabase/migrations/20260912150000_fiscal_emission_attempts.sql','utf8');
 await db.exec(migration);await db.exec(migration); // additive repeatability
 const asUser=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const reserve=async(key=k1,soc=s1,pv=15,hash='a'.repeat(64),payload={tipo:'FA'})=>(await db.query('select public.reservar_emision_fiscal($1,$2,$3,$4,$5::jsonb) as r',[soc,key,hash,pv,JSON.stringify(payload)])).rows[0].r;
 const finish=async(state,status,response,key=k1,hash='a'.repeat(64))=>(await db.query('select public.finalizar_emision_fiscal($1,$2,$3,$4,$5,$6::jsonb) as r',[s1,key,hash,state,status,JSON.stringify(response)])).rows[0].r;
 await asUser(u1);let r=await reserve();assert.equal(r.acquired,true);assert.equal(r.state,'reserved');
 r=await reserve();assert.equal(r.acquired,false);assert.equal(r.state,'reserved');
 await assert.rejects(reserve(k2),/pendiente de conciliación/);
 await assert.rejects(reserve(k1,s1,15,'b'.repeat(64)),/otros datos/);
 await assert.rejects(reserve(k1,s1,15,'a'.repeat(64),{tipo:'FB'}),/otros datos/);
 await assert.rejects(db.query('select * from public.fiscal_emission_attempts'),/permission denied/);
 await assert.rejects(db.query('delete from public.fiscal_emission_attempts'),/permission denied/);
 await assert.rejects(reserve(k1,s2),/autorización/);
 await asUser(u2);await assert.rejects(reserve(),/otro usuario/);await assert.rejects(finish('completed',422,{error:'fake'}),/otro usuario/);
 await asUser(u3);await assert.rejects(reserve(k3,s1,16),/autorización/);
 await asUser(u1);r=await finish('authorized',200,{arca:{CAE:'offline-fixture'}});assert.equal(r.state,'authorized');
 await assert.rejects(reserve(k2),/pendiente de conciliación/);
 await assert.rejects(finish('reserved',200,{}),/inválido/);
 await assert.rejects(finish('authorized',200,{arca:{CAE:'changed'}}),/fijado/);
 r=await finish('completed',200,{success:true});assert.equal(r.state,'completed');
 r=await finish('completed',200,{success:true});assert.equal(r.state,'completed');
 await assert.rejects(finish('completed',500,{error:'overwrite'}),/fijado/);
 r=await reserve();assert.deepEqual(r,{acquired:false,state:'completed',status:200,response:{success:true}});
 r=await reserve(k2);assert.equal(r.acquired,true); // completed releases PV only, not key
 await finish('completed',422,{error:'ARCA rejected'},k2);
 r=await reserve(k3);assert.equal(r.acquired,true); // unresolved has no expiry
 await assert.rejects(finish('completed',200,{},k3,'b'.repeat(64)),/no coinciden/);
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(reserve(),/permission denied/);
 await db.exec('reset role');const stored=(await db.query('select request_payload from public.fiscal_emission_attempts where request_key=$1',[k1])).rows[0];assert.deepEqual(stored.request_payload,{tipo:'FA'});
 await db.close();
 console.log('OK PostgreSQL/PGlite migration: actual SQL compilation/reapply, atomic uniqueness, persistent PV lock, owner+role+society, no direct grants, hash/payload mismatch, irreversible states, immutable completed replay. In-memory fixtures only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
