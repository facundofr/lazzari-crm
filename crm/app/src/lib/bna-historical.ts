/** BNA returns neighbouring dates, not necessarily the requested date first. */
export function parseBnaHistorical(html: string, target: string) {
  const rows = [...html.matchAll(/Dolar\s+U\.S\.A\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*<\/td>/gi)];
  const number = (s: string) => Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  const valid = rows.map(r => ({compra:number(r[1]),venta:number(r[2]),fecha:`${r[5]}-${r[4].padStart(2,'0')}-${r[3].padStart(2,'0')}`}))
    .filter(r => Number.isFinite(r.compra) && Number.isFinite(r.venta) && r.compra > 0 && r.venta > 0 && r.fecha <= target
      && Number.isFinite(Date.parse(`${r.fecha}T12:00:00Z`)) && new Date(`${r.fecha}T12:00:00Z`).toISOString().slice(0,10) === r.fecha)
    .sort((a,b) => b.fecha.localeCompare(a.fecha));
  return valid[0] || null;
}

// Old automatic cache entries may have been labelled with a neighbouring date.
export const BNA_VERIFIED_SOURCE = 'BNA histórico v2';
export function isTrustedBnaCache(row: {es_manual?: boolean; fuente?: string} | null) {
  return !!row && (row.es_manual === true || row.fuente === BNA_VERIFIED_SOURCE);
}
