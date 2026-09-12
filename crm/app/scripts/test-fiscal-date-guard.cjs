const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
let calls=[],last=1,lastDate='20260909', rows=null;
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-12T15:00:00Z']));}}
const context={exports:{},Buffer,URL,Date:FixedDate,Intl,setTimeout,require(name){
  if(name==='node:tls')return {DEFAULT_CIPHERS:'DEFAULT:@SECLEVEL=0'};
  if(name==='fast-xml-parser')return {XMLParser:class {parse(s){return JSON.parse(s)}}};
  assert.equal(name,'node:https');
  return {request(options,cb){const request=new EventEmitter();request.end=(body)=>{
    const method=options.headers.SOAPAction.split('/').pop().replaceAll('"','');calls.push({method,body});
    const tag=n=>body.match(new RegExp(`<${n}>(.*?)</${n}>`))?.[1];
    const row=rows?.[`${tag('Cuit')}:${tag('PtoVta')}:${tag('CbteTipo')}`];
    const result=method==='FECompUltimoAutorizado'?{CbteNro:rows?(row?.number||0):last}:method==='FECompConsultar'?{ResultGet:{CbteFch:rows?row?.date:lastDate}}:{ok:true};
    const res=new EventEmitter();res.statusCode=200;cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify({[method+'Result']:result})));res.emit('end');});
  };return request;}};
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/arca-wsfe-node.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const emit=(date,type=1,pv=10)=>context.exports.crearFacturaWsfeNode({auth:{Token:'test',Sign:'test',Cuit:30719396042},production:false,ptoVta:pv,cbteTipo:type,invoice:{CbteFch:date,ImpTotal:121,ImpNeto:100,ImpIVA:21,ImpTotConc:0,ImpOpEx:0,ImpTrib:0,MonCotiz:1,MonId:'PES'}});
(async()=>{
  for(const type of [1,2,3,6,7,8,201,206,203,208]){
    calls=[];await assert.rejects(emit('20260908',type),/No podés emitir.*09\/09\/2026/);
    assert.ok(calls.some(c=>c.body.includes(`<CbteTipo>${type}</CbteTipo>`)));
    assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  }
  for(const date of ['20260909','20260910']){calls=[];await emit(date,6,15);assert.equal(calls.at(-1).method,'FECAESolicitar');assert.ok(calls.every(c=>c.body.includes('<PtoVta>15</PtoVta>')));}
  last=0;calls=[];await emit('20260908');assert.equal(calls.at(-1).method,'FECAESolicitar');
  last=1;lastDate='';calls=[];await assert.rejects(emit('20260908'),/no devolvió la fecha/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  last=undefined;calls=[];await assert.rejects(emit('20260908'),/último número/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  rows={'30719396042:15:1':{number:14,date:'20260912'},'30719396042:15:6':{number:3,date:'20260901'},'30719396042:16:1':{number:4,date:'20260907'},'20379309128:16:1':{number:99,date:'20260912'}};
  calls=[];await assert.rejects(emit('20260911',6,15),/12\/09\/2026/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  calls=[];await emit('20260912',6,15);assert.ok(calls.at(-1).body.includes('<CbteDesde>4</CbteDesde>'));
  calls=[];await emit('20260907',6,16);assert.equal(calls.at(-1).method,'FECAESolicitar');
  for(const date of ['20260906','20260913']) {calls=[];await assert.rejects(emit(date,6,16),/No podés emitir/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));}
  rows={'30719396042:15:8':{number:2,date:'20260912'}};calls=[];await assert.rejects(emit('20260911',1,15),/12\/09\/2026/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  console.log('OK: regla común por PV entre A/B y notas, numeración separada, aislamiento CUIT/PV, cinco días, igualdad, futuro, primera emisión y consultas incompletas. SIN RED NI EMISIÓN REAL.');
})().catch(e=>{console.error(e);process.exitCode=1;});
