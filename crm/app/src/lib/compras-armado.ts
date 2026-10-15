/**
 * Compras nueva (piloto automático, parte 1): cuentas puras para la pantalla.
 * - Proveedor sugerido para un renglón sin proveedor (lista de costos + a quién se le compró antes).
 * - Costo al día: costo de la OC contra la lista de costos de hoy y margen real del PR.
 * - Días esperando un pedido mandado.
 * Todo es sugerencia: nada de esto frena una compra.
 */
import { convertirCostoPR } from "@/lib/dolar-presupuesto";

export const MARGEN_MINIMO_COMPRAS = 15;
export const DIAS_AVISO_ESPERANDO = 7;

/** Minúsculas, sin acentos ni signos, espacios simples. */
export function normalizarTexto(t: string | null | undefined): string {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "con", "sin", "para", "por", "y", "en", "x", "un", "una", "talle", "color", "c", "s"]);

/** Palabras que importan de una descripción (3+ letras o con números, sin las de relleno). */
export function palabrasClave(t: string | null | undefined): string[] {
  return [...new Set(normalizarTexto(t).split(" ").filter((p) => p && !PALABRAS_VACIAS.has(p) && (p.length >= 3 || /\d/.test(p))))];
}

/** Parecido entre dos descripciones: palabras en común sobre las del renglón (0 a 1). */
export function parecido(a: string | null | undefined, b: string | null | undefined): number {
  const pa = palabrasClave(a);
  if (!pa.length) return 0;
  const pb = new Set(palabrasClave(b));
  return pa.filter((p) => pb.has(p)).length / pa.length;
}

export interface FilaCatalogo { codigo: string | null; codigo_interno: string | null; descripcion: string | null; proveedor: string | null }
export interface CompraAnterior { codigo: string | null; descripcion: string | null; proveedor_id: string | null; fecha?: string | null }
export interface ProveedorSugerido { proveedor_id: string; motivo: string; puntos: number }

/**
 * Proveedores posibles para un renglón, de más a menos seguro (máximo 3).
 * - Mismo código en la lista de costos → el proveedor de esa lista (100).
 * - Ya se le compró ese código → 80 + 2 por compra (tope 95).
 * - Descripción parecida en compras anteriores (≥ 60 % de palabras) → hasta 70.
 */
export function sugerirProveedores(
  renglon: { codigo: string | null; descripcion: string | null },
  catalogo: FilaCatalogo[],
  proveedorDeLista: Record<string, string>,
  historial: CompraAnterior[],
): ProveedorSugerido[] {
  const puntos = new Map<string, ProveedorSugerido>();
  const sumar = (id: string | null | undefined, p: number, motivo: string) => {
    if (!id) return;
    const prev = puntos.get(id);
    if (!prev || p > prev.puntos) puntos.set(id, { proveedor_id: id, motivo, puntos: p });
  };
  const cod = normalizarTexto(renglon.codigo);
  if (cod) {
    for (const f of catalogo) {
      if (normalizarTexto(f.codigo_interno) === cod || normalizarTexto(f.codigo) === cod) {
        const lista = String(f.proveedor || "").trim();
        sumar(proveedorDeLista[lista.toLowerCase()], 100, `Está en la lista de ${lista}`);
      }
    }
    const porProv = new Map<string, number>();
    for (const h of historial) if (h.proveedor_id && normalizarTexto(h.codigo) === cod) porProv.set(h.proveedor_id, (porProv.get(h.proveedor_id) || 0) + 1);
    for (const [id, n] of porProv) sumar(id, Math.min(95, 80 + 2 * n), `Se le compró este código ${n} ${n === 1 ? "vez" : "veces"}`);
  }
  if (palabrasClave(renglon.descripcion).length) {
    const mejor = new Map<string, number>();
    for (const h of historial) {
      if (!h.proveedor_id) continue;
      const s = parecido(renglon.descripcion, h.descripcion);
      if (s >= 0.6 && s > (mejor.get(h.proveedor_id) || 0)) mejor.set(h.proveedor_id, s);
    }
    for (const [id, s] of mejor) sumar(id, Math.round(40 + 30 * s), "Se le compró algo parecido");
  }
  return [...puntos.values()].sort((a, b) => b.puntos - a.puntos).slice(0, 3);
}

/** ¿El costo de la lista es comparable con el de la OC? (misma moneda: pesos con pesos, dólares con dólares). */
export function mismaMonedaCosto(a: string | null | undefined, b: string | null | undefined): boolean {
  const usd = (m: string | null | undefined) => String(m || "ARS").toUpperCase().startsWith("USD");
  return usd(a) === usd(b);
}

/** Margen real del renglón del PR (sobre costo, como en Presupuestos): (venta neta / costo − 1) × 100. */
export function margenReal(
  venta: { precio_venta: number; descuento_porcentaje?: number | null },
  descuentoGeneral: number,
  costo: number, costoMoneda: string, prMoneda: string, tc: number, tcDivisas: number,
): number | null {
  const dl = Math.min(100, Math.max(0, Number(venta.descuento_porcentaje) || 0));
  const dg = Math.min(100, Math.max(0, Number(descuentoGeneral) || 0));
  const neto = Number(venta.precio_venta) * (1 - dl / 100) * (1 - dg / 100);
  const costoConv = convertirCostoPR(Number(costo), costoMoneda || "ARS", prMoneda || "ARS", Number(tc) || 0, Number(tcDivisas) || 0);
  if (!(costoConv > 0) || !(neto > 0)) return null;
  return Math.round(((neto / costoConv) - 1) * 1000) / 10;
}

export interface CostoAlDia {
  costoOC: number;
  costoLista: number | null;
  /** % de diferencia de la lista contra la OC (positivo = la lista está más cara). */
  diferenciaPct: number | null;
  margenOC: number | null;
  margenLista: number | null;
  /** El margen con el costo de hoy queda debajo del mínimo. */
  bajoMinimo: boolean;
}

/** Compara el costo de la OC con el de la lista de hoy (si es comparable) y calcula los márgenes. */
export function costoAlDia(args: {
  costoOC: number; costoMoneda: string; costoLista: number | null; monedaLista: string | null;
  venta: { precio_venta: number; descuento_porcentaje?: number | null } | null;
  descuentoGeneral: number; prMoneda: string; tc: number; tcDivisas: number;
}): CostoAlDia {
  const comparable = args.costoLista != null && args.costoLista > 0 && mismaMonedaCosto(args.costoMoneda, args.monedaLista);
  const costoLista = comparable ? Number(args.costoLista) : null;
  const diferenciaPct = costoLista != null && args.costoOC > 0 ? Math.round(((costoLista / args.costoOC) - 1) * 1000) / 10 : null;
  const m = (c: number) => args.venta ? margenReal(args.venta, args.descuentoGeneral, c, args.costoMoneda, args.prMoneda, args.tc, args.tcDivisas) : null;
  const margenOC = m(args.costoOC);
  const margenLista = costoLista != null ? m(costoLista) : null;
  const margenHoy = margenLista ?? margenOC;
  return { costoOC: args.costoOC, costoLista, diferenciaPct, margenOC, margenLista, bajoMinimo: margenHoy != null && margenHoy < MARGEN_MINIMO_COMPRAS };
}

/** Días enteros desde que se mandó el pedido (hora Argentina no importa: se cuentan días corridos). */
export function diasDesde(fechaIso: string | null | undefined, ahora: number = Date.now()): number | null {
  if (!fechaIso) return null;
  const t = Date.parse(fechaIso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((ahora - t) / 86400000));
}

/** Debajo de esto, un pedido suelto a otro proveedor suele costar más en tiempo y flete que lo que se ahorra. */
export const PEDIDO_CHICO: Record<"ARS" | "USD", number> = { ARS: 300_000, USD: 250 };

export interface PedidoPendiente { oc_id: string; pr_id: string | null; pr_numero?: string | null; proveedor_id: string; proveedor_nombre: string; moneda: string; total: number }
export interface SugerenciaCentralizar {
  pr_id: string; pr_numero: string | null; moneda: "ARS" | "USD";
  destino_proveedor_id: string; destino_nombre: string;
  /** OC (sin mandar) que pasarían al proveedor destino. */
  oc_ids: string[]; proveedores_a_mover: string[]; monto_a_mover: number;
}

/**
 * Para cada PR con pedidos sin mandar repartidos en 2 o más proveedores (misma moneda) y alguno chico,
 * propone juntar todo en el proveedor que se lleva el monto mayor, solo si ese proveedor vende lo demás
 * (lo tiene en su lista o ya se lo vendió). Es solo una sugerencia: el usuario elige.
 */
export function sugerirCentralizar(
  pedidos: PedidoPendiente[],
  umbral: Record<"ARS" | "USD", number> = PEDIDO_CHICO,
  /** ¿El proveedor destino puede vender lo de esta OC? (lo tiene en su lista o ya se lo vendió). Sin esto, no se sugiere. */
  puedeVender: (ocId: string, proveedorId: string) => boolean = () => false,
): SugerenciaCentralizar[] {
  const grupos = new Map<string, PedidoPendiente[]>();
  for (const p of pedidos) {
    if (!p.pr_id || !p.proveedor_id) continue;
    const mon = String(p.moneda || "ARS").toUpperCase().startsWith("USD") ? "USD" : "ARS";
    const k = `${p.pr_id}|${mon}`;
    grupos.set(k, [...(grupos.get(k) || []), p]);
  }
  const out: SugerenciaCentralizar[] = [];
  for (const [k, ps] of grupos) {
    const mon = k.split("|")[1] as "ARS" | "USD";
    const porProv = new Map<string, { nombre: string; total: number; ocs: string[] }>();
    for (const p of ps) {
      const x = porProv.get(p.proveedor_id) || { nombre: p.proveedor_nombre, total: 0, ocs: [] };
      x.total += Number(p.total) || 0; x.ocs.push(p.oc_id);
      porProv.set(p.proveedor_id, x);
    }
    if (porProv.size < 2) continue;
    const orden = [...porProv.entries()].sort((a, b) => b[1].total - a[1].total);
    const [destId, dest] = orden[0];
    const resto = orden.slice(1);
    if (!resto.some(([, x]) => x.total < umbral[mon])) continue;
    if (!resto.every(([, x]) => x.ocs.every((oc) => puedeVender(oc, destId)))) continue;
    out.push({
      pr_id: ps[0].pr_id as string, pr_numero: ps[0].pr_numero ?? null, moneda: mon,
      destino_proveedor_id: destId, destino_nombre: dest.nombre,
      oc_ids: resto.flatMap(([, x]) => x.ocs), proveedores_a_mover: resto.map(([, x]) => x.nombre),
      monto_a_mover: Math.round(resto.reduce((s, [, x]) => s + x.total, 0) * 100) / 100,
    });
  }
  return out;
}

/** Proveedores que ya dijeron que no tienen stock, anotados en las observaciones ("Sin stock en X: ..."). */
export function proveedoresSinStock(observaciones: string | null | undefined): string[] {
  return [...String(observaciones || "").matchAll(/Sin stock en ([^:·\n]+):/gi)].map((m) => normalizarTexto(m[1]));
}
