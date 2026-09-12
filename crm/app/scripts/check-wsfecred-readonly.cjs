// Only WSAA authentication + consultarMontoObligadoRecepcion. No fiscal emission.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),tls=require('node:tls');
if(!tls.DEFAULT_CIPHERS.includes('@SECLEVEL=0'))tls.DEFAULT_CIPHERS+=':@SECLEVEL=0';
const {Arca}=require('@ramiidv/arca-facturacion');
const context={exports:{},Buffer,URL,Date,require};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/arca-wsfecred-node.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
(async()=>{
 const fechaEmision=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 for(const [name,cuit,certFile,keyFile] of [['Lazzari',20379309128,'lazzari.crt','lazzari.key'],['Grupo LA',30719396042,'GrupoLa-crm.crt','grupoLA.key']]){
  try{const arca=new Arca({cuit,cert:fs.readFileSync(path.join('..','certs',certFile),'utf8'),key:fs.readFileSync(path.join('..','certs',keyFile),'utf8'),production:true,requestTimeoutMs:30000,retries:0});
   const auth=await arca.getAuth('wsfecred');
   const result=await context.exports.consultarObligacionFce({auth,production:true,cuitConsultada:30641405554,fechaEmision});
   console.log(JSON.stringify({sociedad:name,cuit,connected:true,fechaEmision,cuitConsultada:30641405554,...result}));
   if(process.argv.includes('--history')&&name==='Grupo LA'){
    const history=await context.exports.consultarComprobanteFce({auth,production:true,cbteTipo:201,ptoVta:1,numero:2});
    console.log(JSON.stringify({sociedad:name,comprobante:'201/1/2',...history}));
   }
  }catch(e){console.log(JSON.stringify({sociedad:name,cuit,connected:false,error:String(e.message).replace(/<[^>]*>/g,'').slice(0,350)}));process.exitCode=1;}
 }
})().catch(()=>{console.error('No se pudo completar el diagnóstico de solo lectura.');process.exitCode=1;});
