/* Isolated headless browser only. No logged-in app, email, or fiscal endpoint. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const compile=name=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const utils={formatCurrency:n=>Number(n).toLocaleString('es-AR',{minimumFractionDigits:2}),formatDate:d=>d};
const ctx={exports:{},Buffer,btoa:s=>Buffer.from(s,'binary').toString('base64'),require:name=>name==='@/lib/utils'?utils:{readFceMetadata:()=>null}};
vm.runInNewContext(compile('pdf-templates.ts'),ctx);
const society=ctx.exports.getSociedadPDF({id:'eee2a3c8-fe6c-494d-bd2f-7a5d8067d021',nombre:'Lazzari',razonSocial:'Lazzari Soluciones Industriales',cuit:'20379309128',condicionIva:'Responsable Inscripto',colorPrimario:'#FF4500'});
const template=ctx.exports.generateFacturaPDF({tipo:'FA',punto_venta:15,numero:1,fecha:'2026-09-12',moneda:'ARS',subtotal:100,iva:21,total:121,cae:null,cliente:{razon_social:'CLIENTE DE PRUEBA',cuit:'20111111112'},items:[{descripcion:'Producto de prueba',cantidad:1,precio_unitario:100,iva_porcentaje:21,subtotal:100}]},{cuitNumero:20379309128},society);
const receiptTemplate=ctx.exports.generateReciboPDF({numero:'f6c4d205-82db-40b2-8b16-77f96637d8ea',fecha:'2026-10-01',cliente:'CLIENTE DE PRUEBA S.A.',descripcion:'Cobro de factura FA 0015-00000039',medio:'Transferencia',monto:1620686.46,moneda:'ARS',conciliado:true},society);
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1365,height:900}});
  await page.route('**/*',route=>route.abort());
  await page.route('https://pdf-fixture.invalid/',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('https://pdf-fixture.invalid/');
  await page.setContent('<!doctype html><html><head><style>body{margin:17px;font:16px Arial;background:#f5f5f5;overflow:auto} #host-modal{width:760px;padding:24px;border:1px solid black;margin:30px auto;background:white}table{width:100%;border-collapse:separate;font-size:16px}td{padding:12px;border:2px solid gray}h2{font-size:24px;margin:20px 0}label{display:block;font-size:14px}input{width:95%;height:35px}button{padding:12px;font:16px Arial}</style></head><body><section id="host-modal"><h2>Enviar factura por correo</h2><label>Destinatario<input value="prueba@example.invalid"></label><table><tr><td>Archivo adjunto</td><td>Factura.pdf</td></tr></table><button>Enviar</button></section></body></html>');
  await page.addScriptTag({path:path.join(__dirname,'../node_modules/html2pdf.js/dist/html2pdf.bundle.min.js')});
  await page.evaluate(({scopeCode,pdfCode})=>{
    const scopeModule={exports:{}};new Function('exports',scopeCode)(scopeModule.exports);
    window.pdfScope=scopeModule.exports.scopePdfStyles;
    const utils={formatCurrency:n=>String(n),formatDate:d=>d};
    const output={};new Function('exports','require',pdfCode)(output,name=>name==='html2pdf.js'?{default:window.html2pdf}:name==='@/lib/pdf-style-scope'?scopeModule.exports:name==='@/lib/fce-invoice'?{readFceMetadata:()=>null}:utils);
    window.renderPdf=output.htmlToPdfBase64;
  },{scopeCode:compile('pdf-style-scope.ts'),pdfCode:compile('pdf-templates.ts')});
  const result=await page.evaluate(async ({html,receiptHtml})=>{
    const metrics=()=>['body','#host-modal','#host-modal h2','#host-modal table','#host-modal td','#host-modal input','#host-modal button'].map(selector=>{
      const el=document.querySelector(selector),s=getComputedStyle(el),r=el.getBoundingClientRect();
      return {selector,rect:[r.x,r.y,r.width,r.height],font:s.fontSize,fontFamily:s.fontFamily,padding:s.padding,margin:s.margin,overflow:s.overflow,boxSizing:s.boxSizing,border:s.borderWidth};
    });
    const before=metrics();let differences=[],frames=0,cloneChecks=0,paintedCanvases=0;
    const originalDataUrl=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(...args){
      if(this.width>500&&this.height>200){
        const pixels=this.getContext('2d')?.getImageData(0,0,this.width,this.height).data;
        let colored=0;if(pixels)for(let i=0;i<pixels.length;i+=64)if(pixels[i+3]>0&&(pixels[i]<240||pixels[i+1]<240||pixels[i+2]<240))colored++;
        if(colored>100)paintedCanvases++;
      }
      return originalDataUrl.apply(this,args);
    };
    const timer=setInterval(()=>{frames++;if(JSON.stringify(metrics())!==JSON.stringify(before))differences.push(metrics());},10);
    // Different simultaneous scopes do not restyle one another or the host.
    const first=document.createElement('div'),second=document.createElement('div');
    first.setAttribute('data-pdf-render','scope-one');second.setAttribute('data-pdf-render','scope-two');
    first.innerHTML='<style>'+window.pdfScope('body {font-size:9px} table {font-size:8px} @media screen {td{padding:3px} @media print {body{font-size:99px}}} @page {margin:0}','[data-pdf-render="scope-one"]')+'</style><table><tr><td>one</td></tr></table>';
    second.innerHTML='<style>'+window.pdfScope('body {font-size:13px} table {font-size:12px}','[data-pdf-render="scope-two"]')+'</style><table><tr><td>two</td></tr></table>';
    for(const el of [first,second]){el.style.position='fixed';el.style.left='-3000px';document.body.append(el);}
    const scopeValues=[getComputedStyle(first).fontSize,getComputedStyle(first.querySelector('table')).fontSize,getComputedStyle(second).fontSize,getComputedStyle(second.querySelector('table')).fontSize];
    const clone=first.cloneNode(true);document.body.append(clone);const cloneValue=getComputedStyle(clone.querySelector('table')).fontSize;
    const printRemoved=!first.querySelector('style').textContent.includes('99px');
    first.remove();second.remove();clone.remove();
    const observer=new MutationObserver(()=>{
      for(const root of document.querySelectorAll('[data-pdf-render]')){
        if(root.dataset.testedClone)continue;root.dataset.testedClone='yes';
        const original=root.querySelector('table');if(!original)continue;
        const copy=root.cloneNode(true);copy.style.position='fixed';copy.style.left='-4000px';document.body.append(copy);
        if(getComputedStyle(copy.querySelector('table')).fontSize===getComputedStyle(original).fontSize)cloneChecks++;
        copy.remove();
      }
    });observer.observe(document.body,{childList:true,subtree:true});
    let pdfs;
    try { pdfs=await Promise.all([window.renderPdf(html),window.renderPdf(receiptHtml)]); }
    finally {clearInterval(timer);observer.disconnect();HTMLCanvasElement.prototype.toDataURL=originalDataUrl;}
    return {before,after:metrics(),differences,frames,scopeValues,cloneValue,printRemoved,cloneChecks,paintedCanvases,pdfs:pdfs.map(base64=>({bytes:atob(base64).length,header:atob(base64).slice(0,5)})),receiptBase64:pdfs[1],remainingRoots:document.querySelectorAll('[data-pdf-render]').length};
  },{html:template,receiptHtml:receiptTemplate});
  assert.deepEqual(result.after,result.before,'Host changed after render');assert.equal(result.differences.length,0,'Host shifted during render');
  assert.ok(result.frames>0);assert.deepEqual(result.scopeValues,['9px','8px','13px','12px']);assert.equal(result.cloneValue,'8px');assert.equal(result.printRemoved,true);assert.ok(result.cloneChecks>=2);assert.equal(result.remainingRoots,0);
  for(const pdf of result.pdfs){assert.equal(pdf.header,'%PDF-');assert.ok(pdf.bytes>10000,'PDF suspiciously empty');}
  assert.ok(result.paintedCanvases>=2,'PDF raster must contain non-white painted content');
  const qaDir=path.join(__dirname,'../tmp/pdfs');fs.mkdirSync(qaDir,{recursive:true});
  fs.writeFileSync(path.join(qaDir,'recibo-cliente-qa.pdf'),Buffer.from(result.receiptBase64,'base64'));
  console.log(JSON.stringify({ok:true,...result,before:undefined,after:undefined,differences:undefined,receiptBase64:undefined}));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
