const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
let payload='<obligado>S</obligado><montoDesde>5549862.00</montoDesde>',sent='',host='';
const context={exports:{},Buffer,URL,Date,require(name){
 if(name==='fast-xml-parser')return require(name);
 assert.equal(name,'node:https');
 return {request(options,cb){host=options.hostname;const method=options.headers.SOAPAction.split('/').pop().replaceAll('"','');const req=new EventEmitter();req.end=body=>{sent=body;const res=new EventEmitter();res.statusCode=200;cb(res);queueMicrotask(()=>{res.emit('data',Buffer.from(`<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><f:${method}Response xmlns:f="http://ar.gob.afip.wsfecred/FECredService/"><${method}Return>${payload}</${method}Return></f:${method}Response></S:Body></S:Envelope>`));res.emit('end');});};return req;}};
}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/arca-wsfecred-node.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const call=(overrides={})=>context.exports.consultarObligacionFce({auth:{Token:'a&b',Sign:'sign',Cuit:20379309128},production:true,cuitConsultada:30641405554,fechaEmision:'2026-09-12',...overrides});
(async()=>{
 let r=await call();assert.equal(r.obligado,true);assert.equal(r.montoDesde,5549862);assert.equal(host,'serviciosjava.afip.gob.ar');assert.match(sent,/<token>a&amp;b<\/token>/);assert.match(sent,/<cuitRepresentada>20379309128/);assert.match(sent,/<fce:consultarMontoObligadoRecepcionRequest>/);
 payload='<obligado>N</obligado>';r=await call({production:false});assert.equal(r.obligado,false);assert.equal(r.montoDesde,null);assert.equal(host,'fwshomo.afip.gov.ar');
 for(const bad of ['', '<obligado>S</obligado>','<obligado>true</obligado>','<obligado>S</obligado><montoDesde>NaN</montoDesde>','<obligado>S</obligado><montoDesde>0</montoDesde>','<obligado>N</obligado><arrayErrores><codigoDescripcion><codigo>99</codigo></codigoDescripcion></arrayErrores>']){payload=bad;await assert.rejects(call());}
 for(const fechaEmision of ['2026-02-30','20260912','garbage'])await assert.rejects(call({fechaEmision}));
 await assert.rejects(call({cuitConsultada:'1</cuitConsultada>'}));
 const history=()=>context.exports.consultarComprobanteFce({auth:{Token:'test',Sign:'test',Cuit:30719396042},production:true,cbteTipo:201,ptoVta:1,numero:2});
 const identity='<idComprobante><CUITEmisor>30719396042</CUITEmisor><codTipoCmp>201</codTipoCmp><ptoVta>1</ptoVta><nroCmp>2</nroCmp></idComprobante>';
 payload=identity+'<arrayHistorialEstados><estadoHistorico><estado>Aceptado</estado><fechaHoraEstado>2026-09-12T10:00:00-03:00</fechaHoraEstado></estadoHistorico><estadoHistorico><estado>Recepcionado</estado><fechaHoraEstado>2026-09-11T10:00:00-03:00</fechaHoraEstado></estadoHistorico></arrayHistorialEstados>';
 const h=await history();assert.equal(h.estado,'Aceptado');assert.equal(h.historial.length,2);assert.match(sent,/<CUITEmisor>30719396042/);
 payload=payload.replace('30719396042','20379309128');await assert.rejects(history(),/distinto/);
 console.log('OK WSFECRED: exact WSDL, issuer/environment isolation, escaping, positive/negative obligation, fail closed incomplete/errors/invalid inputs. No network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
