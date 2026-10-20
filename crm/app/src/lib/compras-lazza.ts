/**
 * Compras Lazza (Augusto 16/10): carga de factura MUY simple.
 * - La factura se pega a una o más OC. No se compara renglón por renglón: se compara el NETO de la factura
 *   (sin envío) contra lo pendiente de facturar de las OC elegidas.
 * - Envío / logística: siempre se suma a la OC (con varias, repartido por plata; ver repartirEnvio en lib/cargar-factura).
 * - No coincide: con una OC → [Sumar la diferencia a la OC] o [Pasar igual]; con varias → "diferencia sin definir".
 *   En los dos casos de "pasar igual" la factura y las OC quedan en "Observar". Más del 5 %: aviso y nota opcional.
 * - Precio de un artículo: se actualiza SOLO si es seguro (mismo código, mismo nombre, o parecido ≥ 90 puntos) y único.
 * Prueba: scripts/test-compras-lazza.ts
 */
import { parseVariant, puntajeParecido, samePrice } from "@/lib/purchase-matching";

const round2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const normCodigo = (s: string | null | undefined) => norm(s).replace(/\s+/g, "");

/** Diferencia que no cuenta: redondeos (1 % o menos de un peso). */
export const TOLERANCIA_PCT = 1;
/** Diferencia "alta": se avisa al que carga y puede dejar algo anotado. */
export const AVISO_PCT = 5;
/** Puntaje mínimo (de 100) para tomar como seguro un artículo con nombre distinto. */
export const PUNTAJE_SEGURO = 90;

export interface ItemFc { key: string; codigo: string | null; descripcion: string; cantidad: number; precio: number }
export interface LineaOc { id: string; ocId: string; codigo: string | null; descripcion: string; pendiente: number; precio: number; moneda: string }
export interface Cruce { lineaId: string; key: string; precioNuevo: number; precioViejo: number; cambia: boolean; motivo: "codigo" | "nombre" | "parecido" }

/**
 * Cuánto de cada renglón entra en esta factura (Augusto 16/10: factura parcial, "vienen 18 de 20").
 * Si en la OC ya llegó algo sin facturar, se factura SOLO eso (lo que llegó − lo ya facturado) y el resto queda
 * abierto para la próxima factura. Si no llegó nada (nadie marcó "Llegó"), se toma todo lo pendiente de facturar.
 */
export function aFacturarPorRenglon(lineas: Array<{ id: string; cantidad: number; recibida: number; pendiente: number }>): { cantidades: Map<string, number>; porLlegado: boolean } {
  const llegadoSinFacturar = (l: { cantidad: number; recibida: number; pendiente: number }) =>
    Math.max(0, round2(Math.min(l.recibida, l.cantidad) - (l.cantidad - l.pendiente)));
  const porLlegado = lineas.some(l => llegadoSinFacturar(l) > 0);
  return {
    porLlegado,
    cantidades: new Map(lineas.map(l => [l.id, porLlegado ? Math.min(llegadoSinFacturar(l), Math.max(0, l.pendiente)) : Math.max(0, l.pendiente)])),
  };
}

/** Neto de la factura; si no se leyó (QR solo trae el total), se estima con el IVA. */
export function netoFactura(f: { subtotal: number; total: number; ivaPorcentaje: number; percepciones?: number }): { neto: number; estimado: boolean } {
  if (f.subtotal > 0) return { neto: round2(f.subtotal), estimado: false };
  const base = Math.max(0, (Number(f.total) || 0) - (Number(f.percepciones) || 0));
  return { neto: round2(base / (1 + (Number(f.ivaPorcentaje) || 0) / 100)), estimado: true };
}

/** Plata pendiente de facturar de cada OC (pendiente × precio). */
export function netoPorOc(lineas: LineaOc[], precios: Map<string, number> = new Map()): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lineas) m.set(l.ocId, round2((m.get(l.ocId) || 0) + Math.max(0, l.pendiente) * (precios.get(l.id) ?? l.precio)));
  return m;
}

export interface Comparacion { factura: number; oc: number; diferencia: number; pct: number; coincide: boolean; alta: boolean }

/** Neto de la factura (sin envío) contra lo de las OC. */
export function comparar(netoFc: number, envio: number, netoOc: number): Comparacion {
  const factura = round2(netoFc - Math.max(0, envio));
  const diferencia = round2(factura - netoOc);
  const pct = netoOc > 0 ? round2((diferencia / netoOc) * 100) : (Math.abs(diferencia) > 0.009 ? 100 : 0);
  const coincide = Math.abs(diferencia) < 1 || Math.abs(pct) <= TOLERANCIA_PCT;
  return { factura, oc: round2(netoOc), diferencia, pct, coincide, alta: !coincide && Math.abs(pct) > AVISO_PCT };
}

/**
 * Qué artículo de la factura es qué renglón de OC, SOLO cuando es seguro:
 * mismo código, mismo nombre (y talle), o parecido ≥ 90 puntos. Si un artículo calza con más de un renglón
 * (o un renglón con más de un artículo), no se toma: "no quiero inventar".
 */
export function crucesSeguros(items: ItemFc[], lineas: LineaOc[], monedaFactura: string, opciones: { tallesEspeciales?: string[] } = {}): Cruce[] {
  const candidatos: Array<{ key: string; lineaId: string; motivo: Cruce["motivo"] }> = [];
  for (const it of items) {
    if (!(it.cantidad > 0)) continue;
    const cod = normCodigo(it.codigo);
    const vf = parseVariant(it.descripcion);
    const porCodigo = cod ? lineas.filter(l => normCodigo(l.codigo) === cod) : [];
    let elegidas: Array<{ l: LineaOc; motivo: Cruce["motivo"] }> = porCodigo.map(l => ({ l, motivo: "codigo" as const }));
    if (!elegidas.length) {
      elegidas = lineas.filter(l => { const vo = parseVariant(l.descripcion); return norm(vo.producto) === norm(vf.producto) && norm(vo.talle) === norm(vf.talle) && !!norm(vf.producto); })
        .map(l => ({ l, motivo: "nombre" as const }));
    }
    if (!elegidas.length) {
      elegidas = lineas.filter(l => (puntajeParecido({ descripcion: it.descripcion, cantidad: it.cantidad, precio: it.precio }, { descripcion: l.descripcion, precio: l.precio }, l.pendiente, opciones)?.puntaje ?? 0) >= PUNTAJE_SEGURO)
        .map(l => ({ l, motivo: "parecido" as const }));
    }
    if (elegidas.length === 1) candidatos.push({ key: it.key, lineaId: elegidas[0].l.id, motivo: elegidas[0].motivo });
  }
  const porLinea = new Map<string, number>();
  for (const c of candidatos) porLinea.set(c.lineaId, (porLinea.get(c.lineaId) || 0) + 1);
  return candidatos.filter(c => porLinea.get(c.lineaId) === 1).map(c => {
    const it = items.find(i => i.key === c.key)!;
    const l = lineas.find(x => x.id === c.lineaId)!;
    const mismaMoneda = String(l.moneda || "ARS").replace(/\s*divisa/i, "").toUpperCase() === String(monedaFactura || "ARS").toUpperCase();
    const cambia = mismaMoneda && it.precio > 0 && !samePrice(it.precio, l.precio);
    return { lineaId: l.id, key: c.key, precioNuevo: cambia ? round2(it.precio) : l.precio, precioViejo: l.precio, cambia, motivo: c.motivo };
  });
}

/** Vencimiento para Pagos: fecha de la factura + los días elegidos ("a 60 días"). Sin días o sin fecha válida → el que trae la factura. */
export function vencimientoPorDias(fecha: string | null | undefined, dias: string | number | null | undefined, vencFactura: string | null | undefined): string | null {
  const d = typeof dias === "number" ? dias : String(dias ?? "").trim() === "" ? NaN : Number(dias);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha || "");
  if (!Number.isFinite(d) || d < 0 || !m) return vencFactura || null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Math.round(d)));
  return t.toISOString().slice(0, 10);
}

/** Texto que queda en la factura y en las OC marcadas "Observar". */
export function notaObservar(args: { numeroFc: string; comp: Comparacion; varias: boolean; nota: string; moneda: string; fecha: string; quien: string }): string {
  const m = (n: number) => `${args.moneda === "USD" ? "US$" : "$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const partes = [
    `[${args.fecha}${args.quien ? ` · ${args.quien}` : ""}] FC ${args.numeroFc}: factura ${m(args.comp.factura)} vs OC ${m(args.comp.oc)}`,
    `diferencia ${m(args.comp.diferencia)} (${String(args.comp.pct).replace(".", ",")} %)${args.varias ? ", sin definir entre las OC" : ""}`,
  ];
  const txt = partes.join(", ");
  return args.nota.trim() ? `${txt}. Nota: ${args.nota.trim()}` : txt;
}

/**
 * "Sacar" una factura (Compras Lazza): el costo del artículo del PR vuelve al de antes de la factura.
 * Misma cuenta que guardar_conciliacion_compra: el costo queda en la moneda de la factura, el precio de venta no cambia
 * y el margen se recalcula sobre el precio de lista. Solo si el PR todavía tiene el costo que puso esa factura
 * (si alguien lo cambió después, no se pisa) → null.
 */
export function costoPrAnterior(a: {
  costoActual: number; costoMoneda: string | null; precioFactura: number; precioAnterior: number;
  prMoneda: string | null; tc: number | null; tcDivisas: number | null; precioVenta: number | null; precioLista: number | null; markupActual: number | null;
}): { precio_costo: number; markup_porcentaje: number } | null {
  if (Math.abs(Number(a.costoActual) - Number(a.precioFactura)) >= 0.005) return null;
  const base = (m: string | null) => String(m || "ARS").replace(/\s*divisa/i, "").toUpperCase();
  const moneda = base(a.costoMoneda), pr = base(a.prMoneda);
  const rate = Number(a.tc) > 0 ? Number(a.tc) : Number(a.tcDivisas) || 0;
  const conv = pr === moneda ? a.precioAnterior
    : rate > 0 && moneda.startsWith("USD") && pr === "ARS" ? a.precioAnterior * rate
    : rate > 0 && moneda === "ARS" && pr.startsWith("USD") ? a.precioAnterior / rate : null;
  const venta = a.precioVenta ?? null;
  if (!conv || conv <= 0 || venta == null) return null;
  return { precio_costo: a.precioAnterior, markup_porcentaje: round2((((a.precioLista ?? venta) / conv) - 1) * 100) };
}

/**
 * Nota de crédito de proveedor (Augusto 18/10: "una NC sin OC… va directo a la cc del proveedor"):
 * el tipo leído ("NOTA DE CREDITO A", "NOTA DE CREDITO FCE MIPYME A", "NC B"…) → el que guarda registrar_nota_credito_compra_v2.
 * null si no es una nota de crédito.
 */
export function tipoNotaCredito(raw: string | null | undefined): string | null {
  const t = String(raw || "").toUpperCase().replace(/[ÉÈ]/g, "E").trim();
  if (!/CREDITO|^N\.?\s?\/?\s?C\b/.test(t)) return null;
  const letra = (t.match(/\b([ABC])\s*$/) || [])[1] || "";
  if (/FCE|MIPYME/.test(t) && (letra === "A" || letra === "B")) return `NC FCE ${letra}`;
  return letra ? `NC ${letra}` : "NC";
}

/**
 * IVA y percepciones de la factura. El QR de ARCA solo trae el total; si no se leyó el IVA, antes se tomaba
 * "IVA = total − neto" y la percepción de IIBB quedaba adentro del IVA (FC Segutécnica 0014-73759, 18/10).
 * Ahora: IVA = neto × alícuota y lo que sobra del total son percepciones. Si sobra de menos (ej. parte al 10,5 %),
 * queda como antes: IVA = total − percepciones − neto.
 */
export function ivaYPercepciones(f: { total: number; neto: number; iva: number; percepciones: number; ivaPorcentaje?: number | null }): { iva: number; percepciones: number; percepcionEstimada: boolean } {
  const total = Number(f.total) || 0, neto = Number(f.neto) || 0, perc = Math.max(0, Number(f.percepciones) || 0);
  if ((Number(f.iva) || 0) > 0) return { iva: round2(Number(f.iva)), percepciones: round2(perc), percepcionEstimada: false };
  const porDiferencia = { iva: Math.max(0, round2(total - perc - neto)), percepciones: round2(perc), percepcionEstimada: false };
  if (!(neto > 0) || !(total > 0)) return porDiferencia;
  const iva = round2(neto * (Number(f.ivaPorcentaje ?? 21) || 21) / 100);
  const resto = round2(total - neto - iva - perc);
  if (resto < 1) return porDiferencia; // redondeo, o IVA más bajo (10,5 %)
  return { iva, percepciones: round2(perc + resto), percepcionEstimada: true };
}

/** Editar OC (Compras Lazza): subtotal, IVA (por renglón) y total. OC de PR manual = sin IVA. */
export function totalesOc(items: Array<{ cantidad: number; precio: number; iva?: number | null }>, sinIva: boolean): { subtotal: number; iva: number; total: number } {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = r2(items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0));
  const iva = sinIva ? 0 : r2(items.reduce((s, i) => s + r2((Number(i.cantidad) || 0) * (Number(i.precio) || 0) * (i.iva != null ? Number(i.iva) : 21) / 100), 0));
  return { subtotal, iva, total: r2(subtotal + iva) };
}

/**
 * Editar OC: qué renglón del PR de origen corresponde a cada renglón de la OC (para pasarle el proveedor nuevo y el costo).
 * Se busca con el código y la descripción de ANTES de editar: mismo código, o si no hay código, misma descripción.
 * Solo renglones del PR del proveedor viejo (o sin proveedor) y solo si hay UNO solo: lo dudoso no se toca.
 */
export function renglonesPrDeOc(
  ocItems: Array<{ id: string; codigo: string | null; descripcion: string }>,
  prItems: Array<{ id: string; codigo: string | null; descripcion: string | null; proveedor_id: string | null }>,
  proveedorViejo: string | null,
): Map<string, string> {
  const norm = (t: string | null | undefined) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const candidatos = prItems.filter(p => !p.proveedor_id || p.proveedor_id === proveedorViejo);
  const usados = new Set<string>();
  const out = new Map<string, string>();
  for (const oc of ocItems) {
    const cod = norm(oc.codigo);
    let hits = cod ? candidatos.filter(p => norm(p.codigo) === cod) : [];
    if (hits.length !== 1) hits = candidatos.filter(p => norm(p.descripcion) === norm(oc.descripcion) && (!cod || !norm(p.codigo) || norm(p.codigo) === cod));
    if (hits.length === 1 && !usados.has(hits[0]!.id)) { out.set(oc.id, hits[0]!.id); usados.add(hits[0]!.id); }
  }
  return out;
}

/**
 * Augusto 19/10: "En la OC cada artículo tiene su costo en su moneda".
 * Moneda del renglón: la guardada en el renglón; si no tiene, la del costo del renglón del PR; si no, la de la OC.
 */
export function monedaRenglonOc(renglon: string | null | undefined, costoPr: string | null | undefined, oc: string | null | undefined): "ARS" | "USD" {
  for (const m of [renglon, costoPr, oc]) if (m === "ARS" || m === "USD") return m;
  return "ARS";
}

/**
 * Renglón del PR de cada renglón de la OC: primero el que quedó atado al aprobar (presupuesto_item_id);
 * para las OC viejas sin ese dato, el cruce por código / descripción (renglonesPrDeOc).
 */
export function prDeRenglones(
  ocItems: Array<{ id: string; codigo: string | null; descripcion: string; presupuesto_item_id?: string | null }>,
  prItems: Array<{ id: string; codigo: string | null; descripcion: string | null; proveedor_id: string | null }>,
  proveedorViejo: string | null,
): Map<string, string> {
  const enPr = new Set(prItems.map(p => p.id));
  const out = new Map<string, string>();
  for (const i of ocItems) if (i.presupuesto_item_id && enPr.has(i.presupuesto_item_id)) out.set(i.id, i.presupuesto_item_id);
  const usados = new Set(out.values());
  const resto = renglonesPrDeOc(ocItems.filter(i => !out.has(i.id)), prItems.filter(p => !usados.has(p.id)), proveedorViejo);
  for (const [k, v] of resto) out.set(k, v);
  return out;
}

/**
 * Nueva OC a mano (Compras Lazza, Augusto 19/10): cada artículo lleva su moneda; la OC queda en la que más se repite
 * (empate o vacía = pesos). La de la OC solo se usa cuando un artículo no tiene moneda propia.
 */
export function monedaNuevaOc(monedas: Array<string | null | undefined>): "ARS" | "USD" {
  const usd = monedas.filter(m => m === "USD").length;
  const ars = monedas.filter(m => m !== "USD").length;
  return usd > ars ? "USD" : "ARS";
}
