// Remitos nueva: lógica pura (sin base de datos) para armar los remitos solos.
// - Cuánto falta entregar de cada renglón del PR (lo pedido menos lo ya remitido).
// - Cuánto llegó de cada renglón (OC atadas al renglón del PR), para saber si está "listo".
// - Días de un remito en camino (semáforo), PR sugerido para un remito sin PR y cruce de la foto con el remito.
// Todo es sugerencia: nada frena.
import { diasDesde, normalizarTexto, parecido } from "./compras-armado";

export const DIAS_AMARILLO_EN_CAMINO = 3;
export const DIAS_ROJO_EN_CAMINO = 10;
export const DIAS_REMITO_VIEJO = 30;
export const DIAS_VOLVER_A_PREGUNTAR = 15;

export interface RenglonPR { id: string; descripcion: string; cantidad: number | string; unidad?: string | null; orden?: number | null }
export interface RenglonRemitido { presupuesto_item_id: string | null; descripcion?: string | null; orden?: number | null; cantidad: number | string }
export interface RenglonOC { presupuesto_item_id: string | null; cantidad: number | string; cantidad_recibida?: number | string | null; estado_oc?: string | null }

export interface RenglonEntrega {
  presupuesto_item_id: string;
  descripcion: string;
  unidad: string;
  orden: number;
  pedido: number;
  remitido: number;
  pendiente: number;
  /** Lo que se puede entregar hoy (llegó y todavía no se remitió). null = no hay OC atada: no se sabe. */
  disponible: number | null;
}

export type EstadoEntrega = "listo" | "parcial" | "esperando" | "sin_compra" | "completo";

const n = (v: unknown) => Number(v) || 0;
const redondo = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Renglones del PR con lo que falta entregar y lo que ya llegó.
 * El remitido se cuenta por renglón del PR; los remitos viejos sin renglón atado se cruzan por descripción + orden
 * (igual que la pantalla de Remitos y el "Remitar" de Presupuestos).
 */
export function renglonesParaEntregar(prItems: RenglonPR[], remitidos: RenglonRemitido[], ocItems: RenglonOC[], ocsDelPR: { estado: string }[] = []): RenglonEntrega[] {
  const porId: Record<string, number> = {};
  const ordenDe = (it: RenglonPR, idx: number) => it.orden ?? idx;
  for (const r of remitidos) {
    let id = r.presupuesto_item_id;
    // Remitos viejos sin renglón atado: misma descripción y orden; si no, misma descripción (o muy parecida) en un solo renglón del PR.
    if (!id) {
      const mismo = prItems.find((it, idx) => it.descripcion === r.descripcion && ordenDe(it, idx) === r.orden);
      const iguales = prItems.filter((it) => normalizarTexto(it.descripcion) === normalizarTexto(r.descripcion));
      const parecidos = iguales.length ? iguales : prItems.filter((it) => parecido(r.descripcion, it.descripcion) >= 0.8 && parecido(it.descripcion, r.descripcion) >= 0.8);
      id = mismo?.id || (parecidos.length === 1 ? parecidos[0].id : null);
    }
    if (id) porId[id] = (porId[id] || 0) + n(r.cantidad);
  }
  const llego: Record<string, number> = {};
  const atado = new Set<string>();
  for (const o of ocItems) {
    if (!o.presupuesto_item_id || o.estado_oc === "cancelada") continue;
    atado.add(o.presupuesto_item_id);
    llego[o.presupuesto_item_id] = (llego[o.presupuesto_item_id] || 0) + n(o.cantidad_recibida);
  }
  // Sin renglones atados: si todas las OC vivas del PR están recibidas, se toma como que llegó todo.
  const vivas = ocsDelPR.filter((o) => o.estado !== "cancelada");
  const todoRecibido = vivas.length > 0 && vivas.every((o) => o.estado === "recibida");
  return prItems.map((it, idx) => {
    const orden = ordenDe(it, idx);
    const pedido = n(it.cantidad);
    const remitido = porId[it.id] || 0;
    const pendiente = redondo(Math.max(0, pedido - remitido));
    let disponible: number | null = null;
    if (atado.has(it.id)) disponible = redondo(Math.min(pendiente, Math.max(0, (llego[it.id] || 0) - remitido)));
    else if (todoRecibido) disponible = pendiente;
    return { presupuesto_item_id: it.id, descripcion: it.descripcion || "", unidad: it.unidad || "UN", orden, pedido, remitido, pendiente, disponible };
  });
}

/** Estado del PR para entregar: listo (llegó todo lo que falta), parcial, esperando, sin_compra (no hay OC: no se sabe) o completo. */
export function estadoEntrega(renglones: RenglonEntrega[]): EstadoEntrega {
  const falta = renglones.filter((r) => r.pendiente > 0);
  if (!falta.length) return "completo";
  if (falta.every((r) => r.disponible === null)) return "sin_compra";
  const conocidos = falta.filter((r) => r.disponible !== null);
  const listos = conocidos.filter((r) => (r.disponible as number) >= r.pendiente);
  const algo = conocidos.some((r) => (r.disponible as number) > 0);
  if (listos.length === falta.length) return "listo";
  return algo ? "parcial" : "esperando";
}

/**
 * Cantidades del remito a armar.
 * "todo": todo lo que falta (aunque no figure recibido: el que entrega sabe). "llego": solo lo que llegó
 * (los renglones sin OC atada se incluyen enteros, porque no se sabe).
 */
export function cantidadesRemito(renglones: RenglonEntrega[], modo: "todo" | "llego"): { presupuesto_item_id: string; descripcion: string; unidad: string; orden: number; cantidad: number }[] {
  return renglones
    .map((r) => ({ ...r, cantidad: modo === "todo" || r.disponible === null ? r.pendiente : Math.min(r.pendiente, r.disponible) }))
    .filter((r) => r.cantidad > 0)
    .map((r) => ({ presupuesto_item_id: r.presupuesto_item_id, descripcion: r.descripcion, unidad: r.unidad, orden: r.orden, cantidad: r.cantidad }));
}

/** Semáforo de un remito en camino: verde hasta 2 días, amarillo desde 3, rojo desde 10. */
export function semaforoEnCamino(fecha: string | null | undefined, ahora: number = Date.now()): { dias: number; color: "verde" | "amarillo" | "rojo" } {
  const dias = diasDesde(fecha, ahora) ?? 0;
  return { dias, color: dias >= DIAS_ROJO_EN_CAMINO ? "rojo" : dias >= DIAS_AMARILLO_EN_CAMINO ? "amarillo" : "verde" };
}

export interface PRCandidato { id: string; numero: string; cliente_id: string | null; fecha?: string | null; items: { id: string; descripcion: string; cantidad?: number | string; orden?: number | null }[] }
export interface PRSugerido { pr_id: string; numero: string; puntos: number; motivo: string }

/**
 * PR sugeridos para un remito que no tiene PR: mismo cliente y renglones parecidos.
 * Puntos: % de renglones del remito que tienen un renglón parecido en el PR (+ desempate por fecha cercana).
 */
export function sugerirPRParaRemito(remito: { cliente_id: string | null; fecha?: string | null; items: { descripcion: string }[] }, prs: PRCandidato[], max = 3): PRSugerido[] {
  if (!remito.cliente_id) return [];
  const out: PRSugerido[] = [];
  for (const pr of prs) {
    if (pr.cliente_id !== remito.cliente_id) continue;
    const its = remito.items.filter((i) => normalizarTexto(i.descripcion));
    if (!its.length) continue;
    let coinciden = 0;
    for (const ri of its) if (pr.items.some((pi) => parecido(ri.descripcion, pi.descripcion) >= 0.6)) coinciden++;
    if (!coinciden) continue;
    const pct = Math.round((coinciden / its.length) * 100);
    const dias = remito.fecha && pr.fecha ? Math.abs(Date.parse(remito.fecha) - Date.parse(pr.fecha)) / 86400000 : 999;
    const puntos = pct + (dias <= 30 ? 5 : 0);
    out.push({ pr_id: pr.id, numero: pr.numero, puntos, motivo: `${coinciden} de ${its.length} renglones iguales` });
  }
  return out.sort((a, b) => b.puntos - a.puntos).slice(0, max);
}

/** Ata los renglones de un remito a los del PR por descripción (solo si hay un único parecido). */
export function atarRenglones(remitoItems: { id: string; descripcion: string }[], prItems: { id: string; descripcion: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ri of remitoItems) {
    const exactos = prItems.filter((pi) => normalizarTexto(pi.descripcion) === normalizarTexto(ri.descripcion));
    const cands = exactos.length ? exactos : prItems.filter((pi) => parecido(ri.descripcion, pi.descripcion) >= 0.8);
    if (cands.length === 1) out[ri.id] = cands[0].id;
  }
  return out;
}

/** Solo los dígitos que importan de un número de remito ("R-0001-00001234" → "1234"). */
export function numeroCorto(t: string | number | null | undefined): string {
  const partes = String(t ?? "").split(/[^0-9]+/).filter(Boolean);
  const ultimo = partes.length ? partes[partes.length - 1] : "";
  return ultimo.replace(/^0+/, "");
}

/**
 * ¿A qué remito corresponde la foto? Por número leído (interno o de CAI) y, si no, por cliente.
 * Devuelve el id o null si hay duda (la pantalla pregunta).
 */
export function remitoDeLaFoto(
  leido: { numero?: string | null; cliente?: string | null },
  remitos: { id: string; numero: string | null; nro_comprobante_cai?: number | null; cliente?: string | null }[],
): string | null {
  const num = numeroCorto(leido.numero);
  if (num) {
    const porNumero = remitos.filter((r) => numeroCorto(r.numero) === num || (r.nro_comprobante_cai != null && String(r.nro_comprobante_cai) === num));
    if (porNumero.length === 1) return porNumero[0].id;
  }
  if (leido.cliente) {
    const porCliente = remitos.filter((r) => parecido(r.cliente, leido.cliente) >= 0.6);
    if (porCliente.length === 1) return porCliente[0].id;
  }
  return null;
}
