/** FCE data is preserved with the authorized invoice in the existing internal note.
 * This avoids requiring a schema change before releasing the safe checks. */
export const FCE_MARKER = "[ARCA_FCE_V1]";
export interface FceInvoiceData { cbu: string; transmision: "SCA" | "ADC"; vencimiento: string; cuitReceptor: string; fecha: string; montoDesde: number; totalArs: number; remitos?: string[]; plazoAceptacion?: number }
export function validCbu(cbu: string) {
  if (!/^\d{22}$/.test(cbu) || /^0+$/.test(cbu)) return false;
  const check = (s: string, weights: number[], digit: string) => (10 - weights.reduce((sum,w,i)=>sum+w*Number(s[i]),0)%10)%10 === Number(digit);
  return check(cbu.slice(0,7),[7,1,3,9,7,1,3],cbu[7]) && check(cbu.slice(8,21),[3,9,7,1,3,9,7,1,3,9,7,1,3],cbu[21]);
}
export function validateFceFields(cbu: unknown, transmision: unknown, vencimiento: unknown, fecha: string, today: string) {
  const account = String(cbu || "").replace(/\s/g, "");
  if (!validCbu(account)) throw new Error("Ingresá una CBU válida de 22 dígitos de la sociedad emisora para la FCE.");
  if (transmision !== "SCA" && transmision !== "ADC") throw new Error("Elegí SCA o ADC para la transmisión de la FCE.");
  const due = String(vencimiento || "");
  const parsed = new Date(`${due}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==due || due < fecha || due < today) throw new Error("La FCE requiere un vencimiento válido, no anterior a hoy ni a la fecha de emisión.");
  return {cbu:account,transmision:transmision as "SCA" | "ADC",vencimiento:due};
}
export function fceRequired(check: {obligado:boolean;montoDesde:number|null}, totalArs: number) {
  if (!Number.isFinite(totalArs) || totalArs <= 0) throw new Error("El total en pesos no es válido para verificar FCE.");
  if (check.obligado && (!Number.isFinite(check.montoDesde) || Number(check.montoDesde)<=0)) throw new Error("ARCA no informó el monto mínimo de FCE. No se emitió.");
  return check.obligado && Math.round(totalArs*100)>=Math.round(Number(check.montoDesde)*100);
}
export function withFceMetadata(note: unknown, data: FceInvoiceData) {
  const clean=String(note || "").split(FCE_MARKER)[0].trim();
  return `${clean}\n${FCE_MARKER}${JSON.stringify(data)}`.trim();
}
export function readFceMetadata(note?: string | null): FceInvoiceData | null {
  try {
    const raw=note?.split(FCE_MARKER)[1]?.split("\n")[0];
    if (!raw) return null;
    const v=JSON.parse(raw);
    return validCbu(v.cbu) && ["SCA","ADC"].includes(v.transmision) && /^\d{4}-\d{2}-\d{2}$/.test(v.vencimiento)
      && (v.plazoAceptacion === undefined || v.plazoAceptacion === 21)
      && (v.remitos === undefined || (Array.isArray(v.remitos) && v.remitos.every((n:unknown)=>typeof n === "string"))) ? v : null;
  } catch {return null;}
}

/** Spanish amount for the FCE legal representation, supports amounts below 1e12. */
export function importeEnLetras(value: number, moneda: "ARS"|"USD") {
  const cents=Math.round(value*100);
  if (!Number.isSafeInteger(cents) || cents<0 || cents>=1e14) throw new Error("Importe fuera de rango para la representación de FCE");
  const small=["cero","un","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve","veinte","veintiún","veintidós","veintitrés","veinticuatro","veinticinco","veintiséis","veintisiete","veintiocho","veintinueve"];
  function words(n:number):string {
    if(n<30)return small[n];
    if(n<100)return ["","","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"][Math.floor(n/10)]+(n%10?` y ${words(n%10)}`:"");
    if(n===100)return "cien";
    if(n<1000)return ["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"][Math.floor(n/100)]+(n%100?` ${words(n%100)}`:"");
    if(n<1e6)return (Math.floor(n/1000)===1?"mil":`${words(Math.floor(n/1000))} mil`)+(n%1000?` ${words(n%1000)}`:"");
    return (Math.floor(n/1e6)===1?"un millón":`${words(Math.floor(n/1e6))} millones`)+(n%1e6?` ${words(n%1e6)}`:"");
  }
  const integer=Math.floor(cents/100);
  return `${words(integer)}${integer && integer%1e6===0?" de":""} ${moneda==="USD"?"dólares estadounidenses":"pesos"} con ${String(cents%100).padStart(2,"0")}/100`;
}
