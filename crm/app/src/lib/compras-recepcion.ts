// Compras nueva > Esperando: "Foto del remito del proveedor". Lógica pura (sin base de datos).
// - A qué OC corresponde el remito (la IA dice; si duda, por número de OC leído o por proveedor con una sola OC esperando).
// - Cuánto se carga como recibido en cada renglón (nunca más de lo pedido; lo de más es aviso).
// - Estado nuevo de la OC y lo que falta llegar.
// - Si es seguro cargarlo solo (con Deshacer) o conviene que una persona mire.
// Todo es sugerencia: nada frena. No mueve stock.
import { parecido } from "./compras-armado";
import { numeroCorto } from "./remitos-armado";

export interface RenglonOCRecepcion { id: string; descripcion?: string | null; codigo?: string | null; cantidad: number | string; cantidad_recibida?: number | string | null }
export interface RenglonLeido { item_id: string | null; descripcion?: string | null; cantidad: number | string }
export interface Carga { item_id: string; cantidad: number; antes: number; despues: number }
export interface Recepcion {
  cargas: Carga[];
  /** Llegó más de lo que faltaba (se carga hasta lo pedido; el resto es aviso). */
  de_mas: { item_id: string; cantidad: number }[];
  /** Renglones del remito que no se pudieron atar a la OC. */
  sin_atar: { descripcion: string; cantidad: number }[];
  /** Lo que sigue faltando después de cargar. */
  faltan: { item_id: string; cantidad: number }[];
  estado: "recibida" | "recibida_parcial" | null;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Cruza lo leído con los renglones de la OC. Suma si el mismo renglón aparece dos veces. */
export function armarRecepcion(items: RenglonOCRecepcion[], leidos: RenglonLeido[]): Recepcion {
  const porId = new Map(items.map((i) => [i.id, i]));
  const llega = new Map<string, number>();
  const sin_atar: Recepcion["sin_atar"] = [];
  for (const l of leidos) {
    const c = num(l.cantidad);
    if (c <= 0) continue;
    if (l.item_id && porId.has(l.item_id)) llega.set(l.item_id, (llega.get(l.item_id) || 0) + c);
    else sin_atar.push({ descripcion: String(l.descripcion || "").trim(), cantidad: c });
  }
  const cargas: Carga[] = [];
  const de_mas: Recepcion["de_mas"] = [];
  for (const [id, c] of llega) {
    const it = porId.get(id)!;
    const antes = num(it.cantidad_recibida);
    const pedido = num(it.cantidad);
    const despues = Math.min(pedido, antes + c);
    if (despues > antes) cargas.push({ item_id: id, cantidad: despues - antes, antes, despues });
    if (antes + c > pedido) de_mas.push({ item_id: id, cantidad: antes + c - pedido });
  }
  const recibidaFinal = (it: RenglonOCRecepcion) => cargas.find((x) => x.item_id === it.id)?.despues ?? num(it.cantidad_recibida);
  const faltan = items.map((it) => ({ item_id: it.id, cantidad: num(it.cantidad) - recibidaFinal(it) })).filter((f) => f.cantidad > 0);
  const algo = items.some((it) => recibidaFinal(it) > 0);
  const estado = !items.length ? null : !faltan.length ? "recibida" : algo ? "recibida_parcial" : null;
  return { cargas, de_mas, sin_atar, faltan, estado };
}

/** Estado de la OC según lo recibido (para Deshacer: vuelve al que tenía). */
export function estadoPorRecibido(items: RenglonOCRecepcion[], estadoActual: string): string {
  if (!items.length) return estadoActual;
  if (items.every((i) => num(i.cantidad_recibida) >= num(i.cantidad))) return "recibida";
  if (items.some((i) => num(i.cantidad_recibida) > 0)) return "recibida_parcial";
  return estadoActual === "recibida" || estadoActual === "recibida_parcial" ? "enviada" : estadoActual;
}

/**
 * ¿A qué OC corresponde? La IA manda oc_id; si no, por el número de OC leído en el remito
 * (los proveedores suelen anotar "Su OC N°…"), y si no, si el proveedor tiene una sola OC esperando.
 */
export function ocDelRemito(
  leido: { oc_id?: string | null; oc_numero?: string | null; proveedor?: string | null; proveedor_cuit?: string | null },
  ocs: { id: string; numero: string; proveedor: string; proveedor_cuit?: string | null }[],
): string | null {
  if (leido.oc_id && ocs.some((o) => o.id === leido.oc_id)) return leido.oc_id;
  const n = numeroCorto(leido.oc_numero);
  if (n) {
    const porNumero = ocs.filter((o) => numeroCorto(o.numero) === n);
    if (porNumero.length === 1) return porNumero[0].id;
  }
  const cuit = String(leido.proveedor_cuit || "").replace(/\D/g, "");
  const delProv = ocs.filter((o) => (cuit.length === 11 && String(o.proveedor_cuit || "").replace(/\D/g, "") === cuit) || (!!leido.proveedor && parecido(o.proveedor, leido.proveedor) >= 0.6));
  return delProv.length === 1 ? delProv[0].id : null;
}

/** Se carga solo si la IA reconoció la OC y todo lo del remito quedó atado sin pasarse de lo pedido. */
export function seguroParaCargar(r: Recepcion, ocSegura: boolean): boolean {
  return ocSegura && r.cargas.length > 0 && !r.sin_atar.length && !r.de_mas.length;
}

/**
 * Aviso en la campana al vendedor del PR cuando Compras marca "Llegó" (auditoría Tanda 6, 02/11/2026; lo hacía Compras nueva).
 * A quién: el vendedor del PR (o quien lo cargó). null = no se avisa (OC sin PR, sin vendedor, o el que marca es el mismo vendedor).
 */
export function avisoLlegada(
  p: { ocNumero: string; proveedor?: string | null; faltan: number; quien?: string | null; pr: { numero: string; vendedor_id?: string | null; created_by?: string | null } | null },
  yo: string | null | undefined,
): { user_id: string; title: string; description: string } | null {
  const destino = p.pr?.vendedor_id || p.pr?.created_by || null;
  if (!p.pr || !destino || destino === yo) return null;
  const que = p.faltan > 0 ? `llegó una parte (faltan ${p.faltan} artículo${p.faltan === 1 ? "" : "s"})` : "llegó todo";
  return {
    user_id: destino,
    title: `Llegó mercadería: ${p.pr.numero}`,
    description: `${p.ocNumero}${p.proveedor ? ` de ${p.proveedor}` : ""}: ${que}${p.quien ? ` · lo marcó ${p.quien}` : ""}`,
  };
}
