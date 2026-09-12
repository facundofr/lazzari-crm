import { request } from "node:https";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Contract: official production FECredService?wsdl (checked 2026-09-12).
// Read-only by design. A WSAA ticket for wsfe is NOT valid here: use wsfecred.
export const WSFECRED_SERVICE = "wsfecred";
const NS = "http://ar.gob.afip.wsfecred/FECredService/";
type Auth = { Token: string; Sign: string; Cuit: number };
const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true });
const escapeXml = (v: string | number) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
function validCuit(v: string | number) {
  if (!/^\d{11}$/.test(String(v))) throw new Error("CUIT inválido para consultar FCE.");
}
function authXml(auth: Auth) {
  validCuit(auth.Cuit);
  if (!auth.Token || !auth.Sign) throw new Error("Falta autorización WSFECRED.");
  return `<authRequest><token>${escapeXml(auth.Token)}</token><sign>${escapeXml(auth.Sign)}</sign><cuitRepresentada>${auth.Cuit}</cuitRepresentada></authRequest>`;
}
async function readSoap(production: boolean, method: string, body: string): Promise<any> {
  const endpoint = new URL(production ? "https://serviciosjava.afip.gob.ar/wsfecred/FECredService" : "https://fwshomo.afip.gov.ar/wsfecred/FECredService");
  // Prefix the global request only: WSDL local elements are unqualified.
  const xml = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:fce="${NS}"><soap:Body><fce:${method}Request>${body}</fce:${method}Request></soap:Body></soap:Envelope>`;
  const { text, status } = await new Promise<{text: string;status: number}>((resolve,reject) => {
    const req = request({ hostname:endpoint.hostname, path:endpoint.pathname, method:"POST", family:4, ciphers:"DEFAULT:@SECLEVEL=0", timeout:30_000,
      headers:{"Content-Type":"text/xml; charset=utf-8",SOAPAction:`"${NS}${method}"`,"Content-Length":Buffer.byteLength(xml),Connection:"close"}},res=>{
      const chunks: Buffer[]=[]; let bytes=0;
      res.on("data",chunk=>{bytes+=chunk.length;if(bytes>2_000_000){req.destroy(new Error("Respuesta WSFECRED demasiado grande."));return;}chunks.push(Buffer.from(chunk));});
      res.on("error",reject);
      res.on("end",()=>resolve({text:Buffer.concat(chunks).toString("utf8"),status:res.statusCode||0}));
    });
    req.on("timeout",()=>req.destroy(new Error("ARCA WSFECRED agotó el tiempo de espera; no se pudo verificar FCE.")));
    req.on("error",reject); req.end(xml);
  });
  // Never surface raw SOAP (may contain credentials or echoed input).
  if (XMLValidator.validate(text)!==true) throw new Error(`Respuesta inválida de ARCA WSFECRED (HTTP ${status}).`);
  const soapBody = parser.parse(text)?.Envelope?.Body;
  if(soapBody?.Fault) throw new Error("ARCA WSFECRED rechazó la consulta. Revisá la autorización del servicio y reintentá.");
  if(status<200||status>=300) throw new Error(`ARCA WSFECRED HTTP ${status}; no se pudo verificar FCE.`);
  const result=soapBody?.[`${method}Response`]?.[`${method}Return`];
  if(!result||typeof result!=="object") throw new Error("ARCA WSFECRED respondió sin resultado verificable.");
  if(result.arrayErrores||result.arrayErroresFormato) {
    const codes=[result.arrayErrores?.codigoDescripcion,result.arrayErroresFormato?.codigoDescripcionString].flat().filter(Boolean).map(e=>String(e.codigo).replace(/[^\w.-]/g,""));
    throw new Error(`ARCA WSFECRED no pudo validar la consulta${codes.length?` (códigos ${codes.join(", ")})`:""}. No se determinó el tipo de factura.`);
  }
  return result;
}

export async function consultarObligacionFce(args: {
  auth: Auth; production: boolean; cuitConsultada: string | number; fechaEmision: string;
}): Promise<{obligado: boolean; montoDesde: number | null}> {
  validCuit(args.cuitConsultada);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(args.fechaEmision)||!Number.isFinite(Date.parse(`${args.fechaEmision}T00:00:00Z`))||new Date(`${args.fechaEmision}T00:00:00Z`).toISOString().slice(0,10)!==args.fechaEmision) throw new Error("Fecha inválida para consultar FCE.");
  const result=await readSoap(args.production,"consultarMontoObligadoRecepcion",`${authXml(args.auth)}<cuitConsultada>${args.cuitConsultada}</cuitConsultada><fechaEmision>${args.fechaEmision}</fechaEmision>`);
  if(result.obligado!=="S"&&result.obligado!=="N") throw new Error("ARCA no confirmó si el receptor está obligado a FCE.");
  const amount=result.montoDesde===undefined?null:Number(result.montoDesde);
  if((amount!==null&&(!Number.isFinite(amount)||amount<=0))||(result.obligado==="S"&&amount===null)) throw new Error("ARCA no devolvió un umbral FCE válido.");
  return {obligado:result.obligado==="S",montoDesde:amount};
}

/** Issuer-only read of historical states. Does not accept, reject or cancel FCE. */
export async function consultarComprobanteFce(args: {
  auth: Auth; production: boolean; cbteTipo: number; ptoVta: number; numero: number;
}): Promise<{historial: {estado: string; fechaHora: string}[]; estado: string; fechaHora: string}> {
  if (![201,202,203,206,207,208,211,212,213].includes(args.cbteTipo) || !Number.isInteger(args.ptoVta) || args.ptoVta<1 || args.ptoVta>99999 || !Number.isInteger(args.numero) || args.numero<1 || args.numero>99999999) throw new Error("Identificación de FCE inválida.");
  const result=await readSoap(args.production,"consultarHistorialEstadosComprobante",`${authXml(args.auth)}<idComprobante><CUITEmisor>${args.auth.Cuit}</CUITEmisor><codTipoCmp>${args.cbteTipo}</codTipoCmp><ptoVta>${args.ptoVta}</ptoVta><nroCmp>${args.numero}</nroCmp></idComprobante>`);
  const id=result.idComprobante;
  if(!id||String(id.CUITEmisor)!==String(args.auth.Cuit)||Number(id.codTipoCmp)!==args.cbteTipo||Number(id.ptoVta)!==args.ptoVta||Number(id.nroCmp)!==args.numero) throw new Error("ARCA devolvió un identificador FCE distinto al solicitado.");
  const entries=result.arrayHistorialEstados?.estadoHistorico;
  const raw=Array.isArray(entries)?entries:entries?[entries]:[];
  const states=["PendienteRecepcion","Recepcionado","Aceptado","Rechazado","InformadaAgDpto"];
  if(!raw.length||raw.some((r:any)=>!states.includes(r.estado)||!Number.isFinite(Date.parse(r.fechaHoraEstado)))) throw new Error("ARCA no devolvió un historial FCE verificable.");
  const historial=raw.map((r:any)=>({estado:String(r.estado),fechaHora:String(r.fechaHoraEstado)})).sort((a:any,b:any)=>Date.parse(a.fechaHora)-Date.parse(b.fechaHora));
  return {historial,...historial[historial.length-1]};
}
