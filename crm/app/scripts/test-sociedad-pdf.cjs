const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/pdf-templates.ts'), 'utf8');
const libCache={};
function cargarLib(name){
  const base=name.replace('@/lib/','').replace('./','');
  if(!/^[a-z0-9-]+$/.test(base)) assert.fail('dependencia inesperada: '+name);
  if(libCache[base]) return libCache[base].exports;
  const ctx={exports:{}}; libCache[base]=ctx;
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/'+base+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports:ctx.exports,require:(n)=>n==='@/lib/utils'?{formatCurrency:(x)=>String(x),formatDate:(d)=>d}:cargarLib(n)});
  return ctx.exports;
}
const fceContext={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/fce-invoice.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,fceContext);
const context = {exports:{}, require(name) {
  if(name==='@/lib/fce-invoice') return fceContext.exports;
  if(name==='@/lib/pdf-style-scope') return {scopePdfStyles:()=>{throw new Error('Rendering is not exercised by this template-only test');}};
  if(name==='@/lib/utils') return {formatCurrency: (n) => String(n), formatDate: (d) => d};
  // El resto de las dependencias de pdf-templates (observaciones, mayúsculas, certificado de retención…) se cargan de verdad.
  return cargarLib(name);
}, Buffer, btoa:(s)=>Buffer.from(s,'binary').toString('base64')};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const grupo = context.exports.getSociedadPDF({id:'fee94607-747a-4e87-ba24-aff9032f7a56',nombre:'Grupo LA',razonSocial:'Grupo La Servicios Integrales SAS',cuit:'30719396042',condicionIva:'Responsable Inscripto',colorPrimario:'#2563EB'});
assert.equal(grupo.domicilio,'Charcas 5151 Piso:1 Dpto:106');
assert.equal(grupo.inicioActividades,'13-05-2026');
assert.equal(grupo.email,'administracion@lazzari.com.ar');
const lazzari = context.exports.getSociedadPDF({id:'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021'});
assert.equal(lazzari.domicilio,'Pueyrredón 653, Pergamino, Buenos Aires');
assert.equal(lazzari.inicioActividades,'01-09-2017');
const factura={tipo:'FA',punto_venta:10,numero:1,fecha:'2026-09-09',moneda:'USD',tipo_cambio:1511.50,subtotal:243,iva:51.03,total:294.03,cae:'86372728764166',cae_vencimiento:'2026-09-19',cliente:null,items:[]};
const before=JSON.stringify(factura);
const html=context.exports.generateFacturaPDF(factura,{cuitNumero:30719396042},grupo);
for(const text of [grupo.domicilio,grupo.inicioActividades,grupo.email,'0010-00000001','86372728764166']) assert.ok(html.includes(text),text);
assert.ok(!html.includes('administracion@grupola.com.ar'));
assert.equal(JSON.stringify(factura),before);
assert.ok(!html.includes('CBU de cobro'));
const cbu='2850590940090418135201';
assert.ok(fceContext.exports.validCbu(cbu));
const fce={...factura,tipo:'FCEA',nota_interna:fceContext.exports.withFceMetadata('',{cbu,transmision:'SCA',vencimiento:'2026-10-12',cuitReceptor:'30641405554',fecha:'2026-09-12',montoDesde:5549862,totalArs:6000000})};
const fceHtml=context.exports.generateFacturaPDF(fce,{cuitNumero:30719396042},grupo);
for(const text of ['Factura de crédito electrónica MiPyME','CBU de cobro',cbu,'SCA','2026-10-12']) assert.ok(fceHtml.includes(text),text);
assert.ok(!fceHtml.includes('[ARCA_FCE_V1]'));
const legacyFce=context.exports.generateFacturaPDF({...factura,tipo:'FCEA'},{cuitNumero:30719396042},grupo);
assert.ok(!legacyFce.includes('CBU de cobro'));
console.log('OK: datos de Grupo LA corregidos en plantilla, Lazzari sin cambios y factura/CAE preservados; sin red ni emisión.');
