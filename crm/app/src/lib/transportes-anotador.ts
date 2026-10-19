// Anotador de viajes de Transportes (control interno, no tiene que coincidir con nada).
// - Cada fila de `transportes` es un viaje. "De remito" = tiene remito_id (lo crea "¿Quién lo lleva?"); el resto, anotado por los chicos.
// - Los cancelados no cuentan. "Propio (lo llevamos nosotros)" no se le paga a nadie: va al historial pero no al anotador ni al resumen.
// - Precio: el del viaje; si no tiene y el transportista tiene precio fijo por viaje (Álvarez), vale el fijo.
// Funciones puras (prueba: scripts/test-transportes-anotador.ts).

export interface ViajeAnotador {
  id: string;
  fecha: string;
  tipo: string | null;
  transportista: string | null;
  transportista_id: string | null;
  remito_id: string | null;
  cliente_id: string | null;
  destino: string | null;
  notas: string | null;
  descripcion_carga: string | null;
  bultos: number | null;
  costo: number | null;
  moneda: string | null;
  estado: string | null;
  factura_compra_id: string | null;
  created_at?: string | null;
}

export interface TransportistaAnotador {
  id: string;
  nombre: string;
  activo: boolean;
  precio_viaje_fijo?: number | null;
}

export const PROPIO_PREFIJO = "propio";

const norm = (t: string | null | undefined) => (t || "").trim().toLowerCase();

export const esPropio = (v: Pick<ViajeAnotador, "tipo" | "transportista">) =>
  v.tipo === "interno" && norm(v.transportista).startsWith(PROPIO_PREFIJO);

export const esDeRemito = (v: Pick<ViajeAnotador, "remito_id">) => Boolean(v.remito_id);

export const vigente = (v: Pick<ViajeAnotador, "estado">) => v.estado !== "cancelado";

/** Clave del transportista del viaje: su id; si no tiene id, el del catálogo con el mismo nombre; si no, "n:<nombre>". */
export function claveViaje(v: Pick<ViajeAnotador, "transportista" | "transportista_id">, catalogo: TransportistaAnotador[]): string {
  if (v.transportista_id) return v.transportista_id;
  const n = norm(v.transportista);
  const t = catalogo.find((c) => norm(c.nombre) === n);
  return t ? t.id : `n:${n}`;
}

/** Precio que vale para el viaje: el suyo, o el fijo del transportista. null = sin precio. */
export function precioViaje(v: Pick<ViajeAnotador, "costo">, fijo: number | null | undefined): number | null {
  if (v.costo != null) return Number(v.costo);
  return fijo != null && fijo > 0 ? Number(fijo) : null;
}

/** Último precio cargado de ese transportista (para sugerir). */
export function ultimoPrecio(viajes: ViajeAnotador[], clave: string, catalogo: TransportistaAnotador[]): number | null {
  const conPrecio = viajes
    .filter((v) => vigente(v) && v.costo != null && claveViaje(v, catalogo) === clave)
    .sort((a, b) => (b.fecha + (b.created_at || "")).localeCompare(a.fecha + (a.created_at || "")));
  return conPrecio.length ? Number(conPrecio[0].costo) : null;
}

export interface ConteoDia { anotados: number; remito: number }

/** Viajes de un día por transportista (sin cancelados ni propios). */
export function conteoDelDia(viajes: ViajeAnotador[], fecha: string, catalogo: TransportistaAnotador[]): Map<string, ConteoDia> {
  const m = new Map<string, ConteoDia>();
  for (const v of viajes) {
    if (v.fecha !== fecha || !vigente(v) || esPropio(v)) continue;
    const k = claveViaje(v, catalogo);
    const c = m.get(k) || { anotados: 0, remito: 0 };
    if (esDeRemito(v)) c.remito++; else c.anotados++;
    m.set(k, c);
  }
  return m;
}

/** Viaje que quita el "−": el último anotado ese día, sin remito, sin factura y sin datos cargados. null si no hay ninguno así. */
export function viajeParaQuitar(viajes: ViajeAnotador[], fecha: string, clave: string, catalogo: TransportistaAnotador[]): { id: string | null; motivo: string | null } {
  const delDia = viajes.filter((v) => v.fecha === fecha && vigente(v) && !esPropio(v) && !esDeRemito(v) && claveViaje(v, catalogo) === clave);
  if (!delDia.length) return { id: null, motivo: "No hay viajes anotados ese día (los de remito se cambian desde el remito)." };
  const libres = delDia
    .filter((v) => !v.factura_compra_id && !v.cliente_id && !norm(v.notas) && !norm(v.descripcion_carga) && !v.bultos && !(norm(v.destino) && norm(v.destino) !== "interno"))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  if (libres.length) return { id: libres[0].id, motivo: null };
  return { id: null, motivo: delDia.some((v) => v.factura_compra_id) ? "Ese viaje ya se liquidó; no se puede quitar." : "Ese viaje tiene datos cargados; borralo desde el historial." };
}

export interface ResumenTransportista {
  clave: string;
  nombre: string;
  viajes: number;
  deRemito: number;
  sinPrecio: number;
  total: number;
  liquidados: number;
  /** Viajes sin liquidar (los que se mandan a Pagos con "Liquidar"). */
  pendientes: ViajeAnotador[];
  totalPendiente: number;
}

/** Resumen del mes (AAAA-MM) por transportista, solo ARS/USD de la moneda pedida. */
export function resumenMes(viajes: ViajeAnotador[], mes: string, catalogo: TransportistaAnotador[], moneda = "ARS"): ResumenTransportista[] {
  const m = new Map<string, ResumenTransportista>();
  for (const v of viajes) {
    if (!v.fecha.startsWith(mes) || !vigente(v) || esPropio(v) || (v.moneda || "ARS") !== moneda) continue;
    const k = claveViaje(v, catalogo);
    const t = catalogo.find((c) => c.id === k);
    const r = m.get(k) || { clave: k, nombre: t?.nombre || (v.transportista || "Sin nombre"), viajes: 0, deRemito: 0, sinPrecio: 0, total: 0, liquidados: 0, pendientes: [], totalPendiente: 0 };
    const p = precioViaje(v, t?.precio_viaje_fijo);
    r.viajes++;
    if (esDeRemito(v)) r.deRemito++;
    if (p == null) r.sinPrecio++;
    r.total += p || 0;
    if (v.factura_compra_id) r.liquidados++;
    else { r.pendientes.push(v); r.totalPendiente += p || 0; }
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.viajes - a.viajes || a.nombre.localeCompare(b.nombre));
}

/** Grilla del mes: clave → día (1..31) → cantidad (sin cancelados ni propios). */
export function grillaMes(viajes: ViajeAnotador[], mes: string, catalogo: TransportistaAnotador[]): Map<string, Map<number, number>> {
  const g = new Map<string, Map<number, number>>();
  for (const v of viajes) {
    if (!v.fecha.startsWith(mes) || !vigente(v) || esPropio(v)) continue;
    const k = claveViaje(v, catalogo);
    const dia = Number(v.fecha.slice(8, 10));
    const fila = g.get(k) || new Map<number, number>();
    fila.set(dia, (fila.get(dia) || 0) + 1);
    g.set(k, fila);
  }
  return g;
}

export const diasDelMes = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();

export interface FiltrosHistorial {
  clave?: string;          // "" = todos
  desde?: string;          // AAAA-MM-DD
  hasta?: string;
  origen?: "" | "remito" | "anotado";
  liquidado?: "" | "si" | "no";
  verCancelados?: boolean;
  texto?: string;          // busca en transportista, destino, notas y en los textos extra que se pasen
}

export function filtrarHistorial(viajes: ViajeAnotador[], f: FiltrosHistorial, catalogo: TransportistaAnotador[], textoExtra?: (v: ViajeAnotador) => string): ViajeAnotador[] {
  const q = norm(f.texto);
  return viajes.filter((v) => {
    if (!f.verCancelados && !vigente(v)) return false;
    if (f.clave && claveViaje(v, catalogo) !== f.clave) return false;
    if (f.desde && v.fecha < f.desde) return false;
    if (f.hasta && v.fecha > f.hasta) return false;
    if (f.origen === "remito" && !esDeRemito(v)) return false;
    if (f.origen === "anotado" && esDeRemito(v)) return false;
    if (f.liquidado === "si" && !v.factura_compra_id) return false;
    if (f.liquidado === "no" && v.factura_compra_id) return false;
    if (q) {
      const s = [v.transportista, v.destino, v.notas, v.descripcion_carga, textoExtra ? textoExtra(v) : ""].map(norm).join(" ");
      if (!s.includes(q)) return false;
    }
    return true;
  });
}

/** Suma n días a AAAA-MM-DD. */
export function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
