// Reparto del envío que cobra un proveedor en su factura entre las OC (y sus PR) que esa factura cubre.
// Proporcional al monto de cada OC; los centavos que sobran van a la OC de mayor peso, así la suma da EXACTO el envío (no se pierde nada).
// Solo para el flete que cobra el proveedor; el transporte que trabaja para Lazzari corre por Transportes.

export interface PesoReparto { id: string; peso: number }

export function repartirEnvio(total: number, pesos: PesoReparto[]): Record<string, number> {
  const out: Record<string, number> = {};
  const totalCent = Math.round((Number(total) || 0) * 100);
  if (!pesos.length || totalCent <= 0) { for (const p of pesos) out[p.id] = 0; return out; }
  const sumaPesos = pesos.reduce((s, p) => s + Math.max(0, Number(p.peso) || 0), 0);
  let asignado = 0;
  for (const p of pesos) {
    const w = sumaPesos > 0 ? Math.max(0, Number(p.peso) || 0) / sumaPesos : 1 / pesos.length;
    const c = Math.floor(totalCent * w);
    out[p.id] = c;
    asignado += c;
  }
  const mayor = pesos.reduce((m, p) => ((Number(p.peso) || 0) > (Number(m.peso) || 0) ? p : m), pesos[0]);
  out[mayor.id] += totalCent - asignado;
  for (const k of Object.keys(out)) out[k] = out[k] / 100;
  return out;
}

/** Junta lo repartido por OC en lo que le toca a cada PR (varias OC pueden venir del mismo PR). Las OC sin PR no suman a ninguno. */
export function repartoPorPR(porOC: Record<string, number>, prDeOC: Record<string, string | null>): { porPR: Record<string, number>; sinPR: number } {
  const porPR: Record<string, number> = {};
  let sinPRCent = 0;
  for (const [oc, monto] of Object.entries(porOC)) {
    const pr = prDeOC[oc];
    if (pr) porPR[pr] = Math.round(((porPR[pr] || 0) + monto) * 100) / 100;
    else sinPRCent += Math.round(monto * 100);
  }
  return { porPR, sinPR: sinPRCent / 100 };
}
