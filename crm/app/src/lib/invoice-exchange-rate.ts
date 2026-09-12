import { parseBnaHistorical } from "./bna-historical";

export function previousInvoiceDay(fecha: string) {
  const date = new Date(`${fecha}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== fecha) throw new Error("Fecha de factura inválida.");
  date.setUTCDate(date.getUTCDate()-1);
  return date.toISOString().slice(0,10);
}

/** No manual cache or alternate provider: BNA divisa venta, prior trading day. */
export async function getInvoiceExchangeRate(fechaFactura: string) {
  const target=previousInvoiceDay(fechaFactura);
  const [y,m,d]=target.split('-');
  const url=`https://www.bna.com.ar/Cotizador/HistoricoPrincipales?id=divisas&fecha=${encodeURIComponent(`${d}/${m}/${y}`)}&idMoneda=55`;
  const res=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0","X-Requested-With":"XMLHttpRequest"},cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error("No se pudo verificar el tipo de cambio del BNA. No se emitió la factura.");
  const quote=parseBnaHistorical(await res.text(),target);
  // BNA provides nearest trading dates; retain its actual date (weekends/holidays).
  if(!quote || Date.parse(target)-Date.parse(quote.fecha)>7*86400000) throw new Error("BNA no devolvió una cotización reciente anterior a la factura. No se emitió.");
  return {fecha:quote.fecha,valor_venta:quote.venta,valor_compra:quote.compra,modalidad:"divisas" as const,fuente:"BNA",automatica:true};
}
