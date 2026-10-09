const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
let calls=[],fail=false;
class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-12T15:00:00Z']));}}
const context={exports:{},Buffer,URL,Date:FixedDate,Intl,setTimeout,require(name){
 if(name==='node:tls')return {DEFAULT_CIPHERS:'DEFAULT:@SECLEVEL=0'};
 if(name==='fast-xml-parser')return require(name);
 assert.equal(name,'node:https');return {request(options,cb){const req=new EventEmitter();req.end=body=>{
  const method=options.headers.SOAPAction.split('/').pop().replaceAll('"','');calls.push({method,body});
  if(method==='FECAESolicitar'&&fail){queueMicrotask(()=>req.emit('error',new Error('ETIMEDOUT')));return;}
  const res=new EventEmitter();res.statusCode=200;cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(`<s:Envelope><s:Body><${method}Result>${method==='FECompUltimoAutorizado'?'<CbteNro>0</CbteNro>':'<FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>12345678901234</CAE></FECAEDetResponse></FeDetResp>'}</${method}Result></s:Body></s:Envelope>`));res.emit('end');});
 };return req;}};
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/arca-wsfe-node.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const invoice={Concepto:1,DocTipo:80,DocNro:30641405554,CbteFch:'20260912',ImpTotal:121,ImpNeto:100,ImpIVA:21,ImpTotConc:0,ImpOpEx:0,ImpTrib:0,MonCotiz:1500,MonId:'DOL',CanMisMonExt:'N',CondicionIVAReceptorId:1,FchVtoPago:'20261012',Iva:[{Id:5,BaseImp:100,Importe:21}],Opcionales:[{Id:2101,Valor:'0720000720000001234567'},{Id:27,Valor:'SCA'}]};
const call=(overrides={},type=201)=>context.exports.crearFacturaWsfeNode({auth:{Token:'test',Sign:'test',Cuit:20379309128},production:false,ptoVta:15,cbteTipo:type,invoice:{...invoice,...overrides}});
(async()=>{
 for(const type of [201,206]){calls=[];await call({},type);const xml=calls.at(-1).body;let last=-1;for(const tag of ['ImpIVA','FchVtoPago','MonId','MonCotiz','CanMisMonExt','CondicionIVAReceptorId','Iva','Opcionales']){const at=xml.indexOf(`<${tag}>`);assert.ok(at>last,`WSDL sequence ${tag}`);last=at;}assert.match(xml,/<Id>2101<\/Id>/);assert.match(xml,/<Valor>SCA<\/Valor>/);assert.match(xml,/<CbteTipo>20[16]<\/CbteTipo>/);}
 calls=[];await call({FchVtoPago:undefined,Opcionales:undefined,CbtesAsoc:[{Tipo:201,PtoVta:15,Nro:1,Cuit:20379309128,CbteFch:'20260912'}]},203);const noteXml=calls.at(-1).body;assert.match(noteXml,/<CbteTipo>203<\/CbteTipo>/);assert.match(noteXml,/<CbtesAsoc><CbteAsoc><Tipo>201<\/Tipo><PtoVta>15<\/PtoVta><Nro>1<\/Nro><Cuit>20379309128<\/Cuit><CbteFch>20260912<\/CbteFch><\/CbteAsoc><\/CbtesAsoc>/);assert.doesNotMatch(noteXml,/<FchVtoPago>|<Opcionales>/);
 for(const overrides of [{FchVtoPago:undefined},{FchVtoPago:'20260230'},{FchVtoPago:'invalid'},{FchVtoPago:'20260911'},{Opcionales:[]},{Opcionales:[{Id:2101,Valor:'0'.repeat(22)},{Id:27,Valor:'SCA'}]},{Opcionales:[...invoice.Opcionales,{Id:27,Valor:'ADC'}]}]){calls=[];await assert.rejects(call(overrides),/FCE incompleta/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));}
 calls=[];await call({MonCotiz:1500.123456});assert.match(calls.at(-1).body,/<MonCotiz>1500.123456<\/MonCotiz>/);
 calls=[];await assert.rejects(call({MonCotiz:1500.1234567}),/seis decimales/);assert.ok(!calls.some(c=>c.method==='FECAESolicitar'));
 fail=true;calls=[];await assert.rejects(call(),/No reintentes sin consultar ARCA/);assert.equal(calls.filter(c=>c.method==='FECAESolicitar').length,1);
 console.log('OK actual FCE SOAP serializer: official WSDL order, A/B, required fields, malformed/duplicate guards, exactly one mutation on uncertain timeout. NO NETWORK OR REAL EMISSION.');
})().catch(e=>{console.error(e);process.exitCode=1;});
