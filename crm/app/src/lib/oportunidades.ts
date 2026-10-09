/**
 * Oportunidades de venta a partir del historial (presupuestos, renglones y facturas).
 * Todo es sugerencia: ordena el trabajo del vendedor, nunca bloquea nada.
 *
 *  · recompra       → artículo que el cliente compra seguido y ya le toca reponer
 *  · temporada      → lo que compró en esta época otros años y este año todavía no
 *  · reactivar      → presupuesto perdido (rechazado / vencido / postergado) del último año para volver a cotizar
 *  · complementario → compra una familia de productos pero no la que suele ir con ella
 *  · dormido        → cliente que compraba y hace mucho que no compra
 */

export type TipoOportunidad = "recompra" | "temporada" | "reactivar" | "complementario" | "dormido";

export const TIPO_LABEL: Record<TipoOportunidad, string> = {
  recompra: "Le toca reponer",
  temporada: "Temporada",
  reactivar: "Volver a cotizar",
  complementario: "Complementario",
  dormido: "Cliente dormido",
};

export const ESTADOS_GANADOS = ["aprobado", "facturar", "facturado", "remitido", "entregado"];
export const ESTADOS_PERDIDOS = ["rechazado", "vencido", "postergado", "cancelada", "cancelado"];

export interface PRHist { id: string; cliente_id: string; numero: string | null; fecha: string; estado: string; total: number; moneda: string; motivo_rechazo?: string | null }
export interface ItemHist { presupuesto_id: string; codigo: string | null; descripcion: string; cantidad: number; precio_venta: number | null }
export interface FacturaHist { cliente_id: string; fecha: string; total: number; moneda: string; tipo: string; estado: string }

export interface Oportunidad {
  tipo: TipoOportunidad;
  cliente_id: string;
  titulo: string;
  detalle: string;
  prioridad: number;          // para ordenar (mayor = primero)
  monto?: number;             // estimado
  moneda?: string;
  presupuesto_id?: string;
  articulo?: string;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = 86400_000;
const t = (fecha: string) => new Date(`${String(fecha).slice(0, 10)}T12:00:00`).getTime();
const dias = (desde: string, hasta: number) => Math.floor((hasta - t(desde)) / DIA);

export function claveArticulo(i: Pick<ItemHist, "codigo" | "descripcion">): string {
  const cod = String(i.codigo || "").trim().toUpperCase();
  if (cod && cod !== "-" && cod.length >= 3) return `C:${cod}`;
  return `D:${String(i.descripcion || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(t(alle)?\.?\s*)?(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|\d{2})\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim()}`;
}

export const FAMILIAS: Array<{ clave: string; label: string; re: RegExp }> = [
  { clave: "ropa", label: "ropa de trabajo", re: /pantal|camisa|campera|chaleco|mameluco|buzo|remera|chomba|ambo|grafa|bermuda|parka|camperon/ },
  { clave: "calzado", label: "calzado de seguridad", re: /botin|zapat|\bbotas?\b|calzado/ },
  { clave: "guantes", label: "guantes", re: /guante/ },
  { clave: "ojos", label: "protección ocular", re: /anteojo|antiparra|\blentes?\b|gafa/ },
  { clave: "cabeza", label: "cascos", re: /casco/ },
  { clave: "auditiva", label: "protección auditiva", re: /auditiv|endoaural|endoural|tapon|\bcopa/ },
  { clave: "respiratoria", label: "protección respiratoria", re: /barbijo|respirador|semimascara|mascara|filtro|cartucho/ },
  { clave: "lluvia", label: "equipos de lluvia", re: /lluvia|piloto|impermeable/ },
  { clave: "altura", label: "trabajo en altura", re: /arnes|cabo de vida|amarre|linea de vida/ },
];

/** Qué familia suele ir con cuál (si compra la primera y nunca la segunda). */
const COMPLEMENTOS: Record<string, string[]> = {
  ropa: ["calzado", "guantes"],
  calzado: ["ropa"],
  cabeza: ["ojos", "auditiva"],
  ojos: ["guantes"],
  respiratoria: ["ojos"],
  altura: ["cabeza"],
  guantes: ["ojos"],
};

export function familiaDe(descripcion: string): string | null {
  const d = String(descripcion || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return FAMILIAS.find(f => f.re.test(d))?.clave || null;
}

export function calcularOportunidades(
  prs: PRHist[],
  items: ItemHist[],
  facturas: FacturaHist[],
  hoy = new Date(),
): Oportunidad[] {
  const ahora = hoy.getTime();
  const out: Oportunidad[] = [];
  const prPorId = new Map(prs.map(p => [p.id, p]));
  const itemsPorPr = new Map<string, ItemHist[]>();
  for (const i of items) { const l = itemsPorPr.get(i.presupuesto_id) || []; l.push(i); itemsPorPr.set(i.presupuesto_id, l); }

  const clientes = new Set<string>([...prs.map(p => p.cliente_id), ...facturas.map(f => f.cliente_id)]);
  for (const clienteId of clientes) {
    const prsCli = prs.filter(p => p.cliente_id === clienteId);
    const ganados = prsCli.filter(p => ESTADOS_GANADOS.includes(p.estado)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const factCli = facturas.filter(f => f.cliente_id === clienteId && f.estado !== "anulada" && !/^NC/i.test(f.tipo));

    // ── Artículos comprados: fechas, cantidades y último precio ──
    const compras = new Map<string, { desc: string; fechas: string[]; cant: number; ultCant: number; ultPrecio: number; moneda: string }>();
    for (const p of ganados) {
      for (const it of itemsPorPr.get(p.id) || []) {
        const k = claveArticulo(it);
        const c = compras.get(k) || { desc: it.descripcion, fechas: [], cant: 0, ultCant: 0, ultPrecio: 0, moneda: p.moneda };
        if (!c.fechas.includes(p.fecha)) c.fechas.push(p.fecha);
        c.cant += Number(it.cantidad) || 0;
        c.ultCant = Number(it.cantidad) || 0;
        c.ultPrecio = Number(it.precio_venta) || c.ultPrecio;
        c.moneda = p.moneda;
        c.desc = it.descripcion || c.desc;
        compras.set(k, c);
      }
    }

    // Recompra
    const marcados = new Set<string>();
    const recompras: Oportunidad[] = [];
    for (const [k, c] of compras) {
      const fs = [...c.fechas].sort();
      if (fs.length < 2) continue;
      const intervalo = (t(fs[fs.length - 1]) - t(fs[0])) / DIA / (fs.length - 1);
      if (intervalo < 20 || intervalo > 400) continue;
      const desde = dias(fs[fs.length - 1], ahora);
      if (desde < intervalo * 0.85 || desde > intervalo * 3) continue;
      marcados.add(k);
      const monto = c.ultCant * c.ultPrecio;
      recompras.push({
        tipo: "recompra", cliente_id: clienteId, articulo: c.desc,
        titulo: c.desc,
        detalle: `Lo compra cada ~${Math.round(intervalo)} días (${fs.length} veces); la última fue hace ${desde} días. Última vez: ${c.ultCant} u.`,
        prioridad: 80 + Math.min(15, desde / intervalo * 5), monto, moneda: c.moneda,
      });
    }
    out.push(...recompras.sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 5));

    // Temporada: compró en este mes o el próximo en años anteriores, y en los últimos 300 días no.
    const mes = hoy.getMonth();
    const temporada: Oportunidad[] = [];
    for (const [k, c] of compras) {
      if (marcados.has(k)) continue;
      const fs = [...c.fechas].sort();
      const ultima = fs[fs.length - 1];
      if (dias(ultima, ahora) < 300) continue;
      const enEpoca = fs.filter(f => {
        const d = new Date(t(f));
        const m = d.getMonth();
        return d.getFullYear() < hoy.getFullYear() && (m === mes || m === (mes + 1) % 12) && dias(f, ahora) < 3 * 366;
      });
      if (!enEpoca.length) continue;
      const ref = new Date(t(enEpoca[enEpoca.length - 1]));
      temporada.push({
        tipo: "temporada", cliente_id: clienteId, articulo: c.desc, titulo: c.desc,
        detalle: `En ${MESES[ref.getMonth()]} de ${ref.getFullYear()} lo compró; este año todavía no.`,
        prioridad: 60, monto: c.ultCant * c.ultPrecio, moneda: c.moneda,
      });
    }
    out.push(...temporada.sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 3));

    // Reactivar: perdidos del último año sin un ganado posterior.
    const ultimoGanado = ganados.length ? ganados[ganados.length - 1].fecha : "";
    const perdidos = prsCli
      .filter(p => ESTADOS_PERDIDOS.includes(p.estado) && dias(p.fecha, ahora) <= 365 && Number(p.total) > 0 && p.fecha > ultimoGanado)
      .sort((a, b) => Number(b.total) - Number(a.total))
      .slice(0, 3);
    for (const p of perdidos) {
      const its = itemsPorPr.get(p.id) || [];
      out.push({
        tipo: "reactivar", cliente_id: clienteId, presupuesto_id: p.id,
        titulo: `${p.numero || "Presupuesto"} (${p.estado})`,
        detalle: `${its.length} renglón(es)${its[0] ? `: ${its.slice(0, 2).map(i => i.descripcion).join(", ")}${its.length > 2 ? "…" : ""}` : ""}${p.motivo_rechazo ? ` · Motivo: ${p.motivo_rechazo}` : ""}. Hace ${dias(p.fecha, ahora)} días.`,
        prioridad: 50 + (p.estado === "postergado" ? 10 : 0), monto: Number(p.total), moneda: p.moneda,
      });
    }

    // Complementarios (solo clientes con al menos 2 compras en los últimos 2 años)
    const recientes = ganados.filter(p => dias(p.fecha, ahora) <= 730);
    if (recientes.length >= 2) {
      const fams = new Set<string>();
      for (const p of recientes) for (const it of itemsPorPr.get(p.id) || []) { const f = familiaDe(it.descripcion); if (f) fams.add(f); }
      const faltan = new Set<string>();
      for (const f of fams) for (const g of COMPLEMENTOS[f] || []) if (!fams.has(g)) faltan.add(g);
      if (faltan.size) {
        const labels = [...faltan].slice(0, 3).map(g => FAMILIAS.find(f => f.clave === g)?.label || g);
        const compra = [...fams].map(g => FAMILIAS.find(f => f.clave === g)?.label || g);
        out.push({
          tipo: "complementario", cliente_id: clienteId,
          titulo: `Ofrecer ${labels.join(", ")}`,
          detalle: `Nos compra ${compra.join(", ")} pero nunca ${labels.join(" ni ")}.`,
          prioridad: 40,
        });
      }
    }

    // Dormido
    const actividad = [...ganados.map(p => p.fecha), ...factCli.map(f => f.fecha)].sort();
    if (actividad.length >= 2) {
      const ultima = actividad[actividad.length - 1];
      const unicas = [...new Set(actividad)];
      const freq = unicas.length >= 2 ? (t(unicas[unicas.length - 1]) - t(unicas[0])) / DIA / (unicas.length - 1) : 180;
      const desde = dias(ultima, ahora);
      if (desde > Math.max(120, freq * 2) && desde < 3 * 365) {
        const fact12 = factCli.filter(f => dias(f.fecha, t(ultima)) <= 365);
        const monedas = new Set(fact12.map(f => f.moneda));
        const moneda = monedas.size === 1 ? [...monedas][0] : "ARS";
        const total = fact12.filter(f => f.moneda === moneda).reduce((s, f) => s + Number(f.total || 0), 0);
        out.push({
          tipo: "dormido", cliente_id: clienteId,
          titulo: `No compra hace ${desde} días`,
          detalle: `Antes compraba cada ~${Math.round(freq)} días. Última compra: ${ultima.split("-").reverse().join("/")}.`,
          prioridad: 70 + Math.min(20, total > 0 ? Math.log10(total) : 0), monto: total || undefined, moneda,
        });
      }
    }
  }
  return out.sort((a, b) => b.prioridad - a.prioridad || (b.monto || 0) - (a.monto || 0));
}
