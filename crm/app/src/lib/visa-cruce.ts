/**
 * Cruce de los consumos del resumen de la tarjeta con lo que el CRM tiene pagado con esa tarjeta (Augusto 02/11/2026).
 * Lo pagado con la tarjeta = movimientos de su cuenta (facturas «Ya pagada con Visa», OP y gastos).
 * El cruce se calcula cada vez (no se guarda): lo que una persona unió a mano (factura elegida o cargada desde el consumo,
 * o «No tiene factura») manda; después, mismo importe y fecha cercana. Lo que no es seguro queda como sugerencia.
 * Funciones puras. Prueba: npx tsx scripts/test-visa-resumen.ts
 */
import type { ClaseConsumo, Moneda } from "./visa-resumen";

export interface ConsumoCruce {
  id: string;
  fecha: string;
  descripcion: string;
  comercio: string;
  cuotaN: number | null;
  cuotaDe: number | null;
  importe: number;
  moneda: Moneda;
  tipo: "consumo" | "cargo";
  clase: ClaseConsumo | null;
  facturaCompraId: string | null;   // unida a mano
  sinFactura: string | null;        // «No tiene factura» con el motivo
}

export interface MovimientoCruce {
  id: string;
  fecha: string;
  monto: number;
  moneda: Moneda;
  facturaCompraId: string | null;
  proveedor: string;
  descripcion: string;
  factura: string | null;           // "FC A 0006-00011419"
}

export type EstadoCruce =
  | "unido"           // una persona eligió o cargó la factura desde el consumo
  | "cruzado"         // mismo importe, fecha cercana
  | "cuotas"          // la compra en cuotas está cargada entera (cuota × cantidad)
  | "centavos"        // mismo comercio, diferencia de centavos
  | "otro_importe"    // mismo comercio, otro importe: revisar
  | "cuota_anterior"  // cuota de una compra de meses anteriores (se carga una vez, con la primera)
  | "devuelto"        // consumo y su devolución se compensan
  | "devolucion"      // devolución sin su consumo en este resumen
  | "sin_factura"     // marcado «No tiene factura»
  | "falta"           // no está en el CRM
  | "cargo";          // sellos, intereses, IVA, percepciones del banco

export interface Cruce { estado: EstadoCruce; mov: MovimientoCruce | null; diferencia: number | null }

const DIAS = 25;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;
const sinTilde = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const RELLENO = new Set(["SRL", "S.A", "SAS", "ASOC", "DEL", "LOS", "LAS", "SUR", "POR", "CON", "PARA", "PLUS", "SAN", "THE", "AUT", "DEB"]);

/** Palabras del comercio para compararlo con el proveedor o la descripción del movimiento. */
export function palabrasComercio(descripcion: string): string[] {
  return sinTilde(descripcion).replace(/MERPAGO\*|WWW\.|\.COM|-PROM|\bUSD\b|\bDE\b|\bCIA\b|\bARG\b/g, " ").replace(/\S*\d\S*/g, " ")
    .split(/[^A-Z]+/).filter((w) => w.length >= 3 && !RELLENO.has(w));
}
export function mismoComercio(descripcion: string, m: Pick<MovimientoCruce, "proveedor" | "descripcion">): boolean {
  const t = sinTilde(`${m.proveedor} ${m.descripcion}`);
  return palabrasComercio(descripcion).some((w) => t.includes(w.slice(0, Math.min(w.length, 6))));
}

/** Cruza cada consumo con un movimiento de la tarjeta (cada movimiento sirve para un solo consumo). */
export function cruzarConsumos(consumos: ConsumoCruce[], movs: MovimientoCruce[]): Map<string, Cruce> {
  const out = new Map<string, Cruce>();
  const usados = new Set<string>();
  const cerca = (c: ConsumoCruce) => (a: MovimientoCruce, b: MovimientoCruce) => Math.abs(dias(c.fecha, a.fecha)) - Math.abs(dias(c.fecha, b.fecha));
  // 1) Lo que hizo una persona.
  for (const c of consumos) {
    if (c.tipo === "cargo") { out.set(c.id, { estado: "cargo", mov: null, diferencia: null }); continue; }
    if (c.facturaCompraId) {
      const mov = movs.filter((m) => !usados.has(m.id) && m.facturaCompraId === c.facturaCompraId).sort(cerca(c))[0] || null;
      if (mov) usados.add(mov.id);
      out.set(c.id, { estado: "unido", mov, diferencia: mov && mov.moneda === c.moneda ? r2(c.importe - mov.monto) : null });
    } else if (c.sinFactura) out.set(c.id, { estado: "sin_factura", mov: null, diferencia: null });
  }
  // 2) Importe exacto (o la cuota × la cantidad de cuotas) con fecha cercana; después mismo comercio con centavos.
  for (const c of consumos) {
    if (out.has(c.id)) continue;
    if (c.importe < 0) { out.set(c.id, { estado: "devolucion", mov: null, diferencia: null }); continue; }
    const cand = movs.filter((m) => !usados.has(m.id) && m.moneda === c.moneda && Math.abs(dias(c.fecha, m.fecha)) <= DIAS);
    const exacto = cand.filter((m) => Math.abs(m.monto - c.importe) <= 0.05).sort(cerca(c))[0];
    const porCuotas = !exacto && c.cuotaDe && c.cuotaDe > 1
      ? cand.filter((m) => Math.abs(m.monto - c.importe * c.cuotaDe!) <= c.cuotaDe! * 0.05).sort(cerca(c))[0] : undefined;
    const centavos = !exacto && !porCuotas
      ? cand.filter((m) => mismoComercio(c.descripcion, m) && Math.abs(m.monto - c.importe) <= Math.max(1, c.importe * 0.005)).sort(cerca(c))[0] : undefined;
    const mov = exacto || porCuotas || centavos;
    if (mov) {
      usados.add(mov.id);
      out.set(c.id, { estado: exacto ? "cruzado" : porCuotas ? "cuotas" : "centavos", mov, diferencia: exacto ? null : r2(c.importe - (porCuotas ? mov.monto / c.cuotaDe! : mov.monto)) });
      continue;
    }
    if (c.cuotaN && c.cuotaN > 1) { out.set(c.id, { estado: "cuota_anterior", mov: null, diferencia: null }); continue; }
    const otro = cand.filter((m) => mismoComercio(c.descripcion, m)).sort((a, b) => Math.abs(a.monto - c.importe) - Math.abs(b.monto - c.importe))[0];
    if (otro) { usados.add(otro.id); out.set(c.id, { estado: "otro_importe", mov: otro, diferencia: r2(c.importe - otro.monto) }); continue; }
    out.set(c.id, { estado: "falta", mov: null, diferencia: null });
  }
  // 3) La devolución se compensa con su consumo (mismo comercio e importe) que no esté cargado.
  for (const d of consumos.filter((x) => out.get(x.id)?.estado === "devolucion")) {
    const ida = consumos.find((x) => x.comercio === d.comercio && x.moneda === d.moneda && Math.abs(x.importe + d.importe) < 0.01 && out.get(x.id)?.estado === "falta");
    if (ida) { out.set(ida.id, { estado: "devuelto", mov: null, diferencia: null }); out.set(d.id, { estado: "devuelto", mov: null, diferencia: null }); }
  }
  return out;
}

/** Lo que falta resolver (para el contador «Falta la factura»). */
export const faltaResolver = (e: EstadoCruce) => e === "falta" || e === "otro_importe" || e === "devolucion";

export interface ResumenCruce { consumos: number; resueltos: number; falta: number; faltaArs: number; faltaUsd: number }
export function resumenCruce(consumos: ConsumoCruce[], cruces: Map<string, Cruce>): ResumenCruce {
  const r: ResumenCruce = { consumos: 0, resueltos: 0, falta: 0, faltaArs: 0, faltaUsd: 0 };
  for (const c of consumos) {
    if (c.tipo !== "consumo") continue;
    r.consumos++;
    const e = cruces.get(c.id)?.estado;
    if (e && faltaResolver(e)) { r.falta++; if (c.moneda === "USD") r.faltaUsd += c.importe; else r.faltaArs += c.importe; } else r.resueltos++;
  }
  return { ...r, faltaArs: r2(r.faltaArs), faltaUsd: r2(r.faltaUsd) };
}

export interface OcSugerible { ocId: string; ocNumero: string; fecha: string | null; importe: number; moneda: Moneda; conFactura: boolean }
/**
 * OC de Mercado Libre con el mismo importe con IVA (costo × 1,21) y fecha cercana: ayuda a saber de qué compra es el consumo.
 * Solo sugerencia (nada se une solo). Recibe una fila por artículo y suma por OC.
 */
export function sugerirOc(c: Pick<ConsumoCruce, "fecha" | "importe" | "moneda" | "cuotaDe">, articulos: OcSugerible[]): OcSugerible | null {
  const porOc = new Map<string, OcSugerible>();
  for (const a of articulos) {
    const x = porOc.get(a.ocId);
    if (x) { x.importe += a.importe; x.conFactura = x.conFactura && a.conFactura; } else porOc.set(a.ocId, { ...a });
  }
  const total = c.importe * (c.cuotaDe && c.cuotaDe > 1 ? c.cuotaDe : 1);
  const ok = [...porOc.values()].filter((o) => o.moneda === c.moneda && o.fecha && Math.abs(dias(o.fecha, c.fecha)) <= 20
    && Math.abs(o.importe - total) <= Math.max(2, total * 0.005));
  ok.sort((a, b) => Number(a.conFactura) - Number(b.conFactura) || Math.abs(dias(a.fecha!, c.fecha)) - Math.abs(dias(b.fecha!, c.fecha)));
  return ok[0] || null;
}
