const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
let calls=[],last=1,lastDate='20260909';
const context={exports:{},Buffer,URL,setTimeout,require(name){
  if(name==='node:tls')return {DEFAULT_CIPHERS:'DEFAULT:@SECLEVEL=0'};
  if(name==='fast-xml-parser')return {XMLParser:class {parse(s){return JSON.parse(s)}}};
  assert.equal(name,'node:https');
  return {request(options,cb){const request=new EventEmitter();request.end=(body)=>{
    const method=options.headers.SOAPAction.split('/').pop().replaceAll('"','');calls.push({method,body});
    const result=method==='FECompUltimoAutorizado'?{CbteNro:last}:method==='FECompConsultar'?{ResultGet:{CbteFch:lastDate}}:{ok:true};
    const res=new EventEmitter();res.statusCode=200;cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify({[method+'Result']:result})));res.emit('end');});
  };return request;}};
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/arca-wsfe-node.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const emit=(date,type=1,pv=10)=>context.exports.crearFacturaWsfeNode({auth:{Token:'test',Sign:'test',Cuit:30719396042},production:false,ptoVta:pv,cbteTipo:type,invoice:{CbteFch:date,ImpTotal:121,ImpNeto:100,ImpIVA:21,ImpTotConc:0,ImpOpEx:0,ImpTrib:0,MonCotiz:1,MonId:'PES'}});
(async()=>{
  for(const type of [1,2,3,6,7,8,201,206,203,208]){
    calls=[];await assert.rejects(emit('20260908',type),/No podés emitir.*09\/09\/2026/);
    assert.equal(calls.length,2);assert.ok(calls[1].body.includes(`<CbteTipo>${type}</CbteTipo>`));
    assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
  }
  for(const date of ['20260909','20260910']){calls=[];await emit(date,6,15);assert.equal(calls[2].method,'FECAESolicitar');assert.ok(calls[1].body.includes('<PtoVta>15</PtoVta>'));}
  last=0;calls=[];await emit('20260908');assert.deepEqual(calls.map(c=>c.method),['FECompUltimoAutorizado','FECAESolicitar']);
  last=1;lastDate='';calls=[];await assert.rejects(emit('20260908'),/no devolvió la fecha/);assert.equal(calls.length,2);
  last=undefined;calls=[];await assert.rejects(emit('20260908'),/último número/);assert.equal(calls.length,1);
  console.log('OK: 15 casos fiscales. Retroceso bloqueado antes de solicitar CAE, igualdad/posterior permitidas, secuencias por tipo/PV, primera emisión y consultas incompletas. SIN RED NI EMISIÓN REAL.');
})().catch(e=>{console.error(e);process.exitCode=1;});
