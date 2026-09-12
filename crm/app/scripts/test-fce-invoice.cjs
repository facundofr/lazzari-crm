const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const context={exports:{},Date};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/fce-invoice.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const {validCbu,validateFceFields,fceRequired,withFceMetadata,readFceMetadata,importeEnLetras}=context.exports;
// Synthetic checksum-valid CBU for offline tests only, not a payment destination.
const digit=(s,weights)=>(10-weights.reduce((sum,w,i)=>sum+w*Number(s[i]),0)%10)%10;
const bank='0720000',account='2000000123456';
const cbu=bank+digit(bank,[7,1,3,9,7,1,3])+account+digit(account,[3,9,7,1,3,9,7,1,3,9,7,1,3]);
assert.equal(validCbu(cbu),true);
for(const bad of ['', '0'.repeat(22),cbu.slice(0,21),cbu.slice(0,21)+(Number(cbu[21])+1)%10,cbu.slice(0,7)+(Number(cbu[7])+1)%10+cbu.slice(8)])assert.equal(validCbu(bad),false);
for(const mode of ['SCA','ADC'])assert.equal(validateFceFields(cbu,mode,'2026-09-12','2026-09-10','2026-09-12').transmision,mode);
for(const due of ['2026-02-30','2026-09-11','20260913','invalid'])assert.throws(()=>validateFceFields(cbu,'SCA',due,'2026-09-10','2026-09-12'));
assert.throws(()=>validateFceFields(cbu,'MANUAL','2026-09-13','2026-09-10','2026-09-12'));
const check={obligado:true,montoDesde:5549862};
assert.equal(fceRequired(check,5549861.99),false);assert.equal(fceRequired(check,5549862),true);assert.equal(fceRequired(check,5549862.01),true);
assert.equal(fceRequired({obligado:false,montoDesde:null},1e9),false);
assert.equal(fceRequired(check,4235*1499),true);assert.equal(fceRequired(check,294.03*1511.5),false);
for(const amount of [0,-1,NaN,Infinity])assert.throws(()=>fceRequired(check,amount));
for(const montoDesde of [null,0,-1,NaN])assert.throws(()=>fceRequired({obligado:true,montoDesde},1e7));
const data={cbu,transmision:'SCA',vencimiento:'2026-10-12',fecha:'2026-09-12',cuitReceptor:'30641405554',montoDesde:5549862,totalArs:6348265,remitos:['R-0001'],plazoAceptacion:21};
const note=withFceMetadata('Nota original',data);assert.equal(JSON.stringify(readFceMetadata(note)),JSON.stringify(data));assert.equal(note.split('[ARCA_FCE_V1]').length,2);assert.equal(withFceMetadata(note,data),note);assert.equal(readFceMetadata('sin datos'),null);assert.equal(readFceMetadata('[ARCA_FCE_V1]{broken'),null);
for(const [amount,currency,expected] of [[0,'ARS','cero pesos con 00/100'],[21.01,'ARS','veintiún pesos con 01/100'],[100,'ARS','cien pesos con 00/100'],[101,'ARS','ciento un pesos con 00/100'],[1000,'ARS','mil pesos con 00/100'],[1000000,'ARS','un millón de pesos con 00/100'],[2000001.99,'USD','dos millones un dólares estadounidenses con 99/100']]){
 assert.equal(importeEnLetras(amount,currency),expected);
}
for(const amount of [NaN,Infinity,-1,1e12])assert.throws(()=>importeEnLetras(amount,'ARS'));
console.log('OK FCE helpers: CBU both checksum digits, dates, transmission, inclusive gross ARS/USD threshold, metadata roundtrip, amount words/bounds. Offline only.');
