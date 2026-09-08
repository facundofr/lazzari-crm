import { request as httpsRequest } from "node:https";
import * as tls from "node:tls";
import { XMLParser } from "fast-xml-parser";

// AFIP uses DH keys smaller than OpenSSL 3.x SECLEVEL=2 minimum (2048 bits).
// Lower security level globally so both our calls and the Arca SDK succeed.
if (!tls.DEFAULT_CIPHERS.includes("@SECLEVEL=0")) {
  (tls as any).DEFAULT_CIPHERS += ":@SECLEVEL=0";
}

const WSFE_PRODUCTION = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";
const WSFE_TESTING = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";
const WSFE_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

type WsfeAuth = { Token: string; Sign: string; Cuit: number };
type IvaItem = { Id: number; BaseImp: number; Importe: number };
type InvoiceDetail = {
  Concepto: number;
  DocTipo: number;
  DocNro: number;
  CbteFch: string;
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpTrib: number;
  ImpIVA: number;
  MonId: string;
  MonCotiz: number;
  CondicionIVAReceptorId: number;
  CanMisMonExt?: "S" | "N";
  Iva?: IvaItem[];
  CbtesAsoc?: { Tipo: number; PtoVta: number; Nro: number; Cuit: number; CbteFch: string }[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true,
  numberParseOptions: { hex: false, leadingZeros: false, skipLike: /^\d{8,}$/ },
});

function escapeXml(value: string | number) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function money(value: number) {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

function authXml(auth: WsfeAuth) {
  return `<Auth><Token>${escapeXml(auth.Token)}</Token><Sign>${escapeXml(auth.Sign)}</Sign><Cuit>${auth.Cuit}</Cuit></Auth>`;
}

function findByLocalName(value: unknown, localName: string): any {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === localName || key.endsWith(`:${localName}`)) return child;
    const nested = findByLocalName(child, localName);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postSoap(endpoint: string, method: string, body: string, attempts = 3): Promise<any> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method} xmlns="${WSFE_NAMESPACE}">${body}</${method}></soap:Body></soap:Envelope>`;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const responseText = await new Promise<string>((resolve, reject) => {
        const url = new URL(endpoint);
        const req = httpsRequest({
          hostname: url.hostname,
          port: 443,
          path: url.pathname,
          method: "POST",
          family: 4,
          ciphers: "DEFAULT:@SECLEVEL=0",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: `"${WSFE_NAMESPACE}${method}"`,
            "Content-Length": Buffer.byteLength(envelope),
            Connection: "close",
          },
          timeout: 30_000,
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`WSFE HTTP ${res.statusCode || "sin estado"}: ${text.slice(0, 500)}`));
              return;
            }
            resolve(text);
          });
        });
        req.on("timeout", () => req.destroy(new Error("WSFE agotó el tiempo de espera")));
        req.on("error", reject);
        req.end(envelope);
      });

      const parsed = parser.parse(responseText);
      const fault = findByLocalName(parsed, "Fault");
      if (fault) throw new Error(`WSFE SOAP Fault: ${fault.faultstring || fault.Reason || "sin detalle"}`);
      const result = findByLocalName(parsed, `${method}Result`);
      if (!result) throw new Error(`WSFE respondió sin ${method}Result`);
      const errors = result.Errors?.Err;
      if (errors) {
        const list = Array.isArray(errors) ? errors : [errors];
        throw new Error(`WSFE: ${list.map((e: any) => `[${e.Code}] ${e.Msg}`).join(", ")}`);
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < attempts) await wait(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error("No se pudo conectar con WSFE");
}

export async function crearFacturaWsfeNode(args: {
  auth: WsfeAuth;
  production: boolean;
  ptoVta: number;
  cbteTipo: number;
  invoice: InvoiceDetail;
}) {
  const endpoint = args.production ? WSFE_PRODUCTION : WSFE_TESTING;
  const last = await postSoap(endpoint, "FECompUltimoAutorizado", `${authXml(args.auth)}<PtoVta>${args.ptoVta}</PtoVta><CbteTipo>${args.cbteTipo}</CbteTipo>`);
  const nextNumber = Number(last.CbteNro || 0) + 1;
  const inv = args.invoice;
  const ivaXml = inv.Iva?.length
    ? `<Iva>${inv.Iva.map((iva) => `<AlicIva><Id>${iva.Id}</Id><BaseImp>${money(iva.BaseImp)}</BaseImp><Importe>${money(iva.Importe)}</Importe></AlicIva>`).join("")}</Iva>`
    : "";
  const foreignCurrency = inv.CanMisMonExt ? `<CanMisMonExt>${inv.CanMisMonExt}</CanMisMonExt>` : "";
  const cbtesAsocXml = inv.CbtesAsoc?.length
    ? `<CbtesAsoc>${inv.CbtesAsoc.map((a) => `<CbteAsoc><Tipo>${a.Tipo}</Tipo><PtoVta>${a.PtoVta}</PtoVta><Nro>${a.Nro}</Nro><Cuit>${a.Cuit}</Cuit><CbteFch>${a.CbteFch}</CbteFch></CbteAsoc>`).join("")}</CbtesAsoc>`
    : "";
  const detail = `<FECAEDetRequest><Concepto>${inv.Concepto}</Concepto><DocTipo>${inv.DocTipo}</DocTipo><DocNro>${inv.DocNro}</DocNro><CbteDesde>${nextNumber}</CbteDesde><CbteHasta>${nextNumber}</CbteHasta><CbteFch>${inv.CbteFch}</CbteFch><ImpTotal>${money(inv.ImpTotal)}</ImpTotal><ImpTotConc>${money(inv.ImpTotConc)}</ImpTotConc><ImpNeto>${money(inv.ImpNeto)}</ImpNeto><ImpOpEx>${money(inv.ImpOpEx)}</ImpOpEx><ImpTrib>${money(inv.ImpTrib)}</ImpTrib><ImpIVA>${money(inv.ImpIVA)}</ImpIVA><MonId>${escapeXml(inv.MonId)}</MonId><MonCotiz>${money(inv.MonCotiz)}</MonCotiz><CondicionIVAReceptorId>${inv.CondicionIVAReceptorId}</CondicionIVAReceptorId>${foreignCurrency}${cbtesAsocXml}${ivaXml}</FECAEDetRequest>`;
  const requestBody = `${authXml(args.auth)}<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${args.ptoVta}</PtoVta><CbteTipo>${args.cbteTipo}</CbteTipo></FeCabReq><FeDetReq>${detail}</FeDetReq></FeCAEReq>`;
  return postSoap(endpoint, "FECAESolicitar", requestBody);
}
