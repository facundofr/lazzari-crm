// Contador de viajes de Transportes (control interno, no tiene que coincidir con nada). Versión simple 19/10/2026 (pedido de Augusto).
// - Cada fila de `transportes` es un viaje. Solo cuentan los anotados acá: los "de remito" (tienen remito_id, los crea
//   "¿Quién lo lleva?") quedan solo en Remitos, y "Propio (lo llevamos nosotros)" no se le paga a nadie.
// - Los cancelados no cuentan (no se borran).
// - Monto: el del viaje y nada más (nada se completa solo). Solo el + de un transportista con precio fijo (Álvarez) arranca con ese monto.
// Funciones puras (prueba: scripts/test-transportes-anotador.ts).

export interface ViajeAnotador {
  id: string;
  fecha: string;
  tipo: string | null;
  transportista: string | null;
  transportista_id: string | null;
  remito_id: string | null;
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

/** El viaje va al contador: anotado acá (no de remito) y no "Propio". */
export const cuentaEnTransportes = (v: Pick<ViajeAnotador, "remito_id" | "tipo" | "transportista">) => !esDeRemito(v) && !esPropio(v);

/** Clave del transportista del viaje: su id; si no tiene id, el del catálogo con el mismo nombre; si no, "n:<nombre>". */
export function claveViaje(v: Pick<ViajeAnotador, "transportista" | "transportista_id">, catalogo: TransportistaAnotador[]): string {
  if (v.transportista_id) return v.transportista_id;
  const n = norm(v.transportista);
  const t = catalogo.find((c) => norm(c.nombre) === n);
  return t ? t.id : `n:${n}`;
}

/** Monto del viaje (null = sin monto). */
export const montoViaje = (v: Pick<ViajeAnotador, "costo">): number | null => (v.costo != null ? Number(v.costo) : null);

/** Monto con el que arranca un viaje nuevo del +: el precio fijo del transportista (solo Álvarez lo tiene), si no, sin monto. */
export const montoInicial = (t: Pick<TransportistaAnotador, "precio_viaje_fijo"> | null | undefined): number | null =>
  t?.precio_viaje_fijo != null && Number(t.precio_viaje_fijo) > 0 ? Number(t.precio_viaje_fijo) : null;

const orden = (a: ViajeAnotador, b: ViajeAnotador) => (a.fecha + (a.created_at || "")).localeCompare(b.fecha + (b.created_at || ""));

/** Viajes del mes (AAAA-MM) de un transportista, por fecha. Con verCancelados incluye los cancelados. */
export function viajesDelMes(viajes: ViajeAnotador[], mes: string, clave: string, catalogo: TransportistaAnotador[], verCancelados = false): ViajeAnotador[] {
  return viajes
    .filter((v) => v.fecha.startsWith(mes) && cuentaEnTransportes(v) && (verCancelados || vigente(v)) && claveViaje(v, catalogo) === clave)
    .sort(orden);
}

/** Los que se pueden tocar: vigentes y sin liquidar. */
export const sinLiquidar = (lista: ViajeAnotador[]) => lista.filter((v) => vigente(v) && !v.factura_compra_id);

/** Viaje que saca el "−": el último del mes sin liquidar. */
export function viajeParaQuitar(viajes: ViajeAnotador[], mes: string, clave: string, catalogo: TransportistaAnotador[]): ViajeAnotador | null {
  const libres = sinLiquidar(viajesDelMes(viajes, mes, clave, catalogo));
  return libres.length ? libres[libres.length - 1] : null;
}

/** Fecha del viaje que suma el "+": hoy si se mira el mes actual; si no, el último día de ese mes (después se edita). */
export function fechaParaSumar(mes: string, hoy: string): string {
  if (hoy.startsWith(mes)) return hoy;
  return `${mes}-${String(diasDelMes(mes)).padStart(2, "0")}`;
}

export interface ResumenTransportista {
  clave: string;
  nombre: string;
  viajes: number;
  sinMonto: number;
  total: number;
  liquidados: number;
  /** Viajes sin liquidar. */
  pendientes: ViajeAnotador[];
  totalPendiente: number;
}

/** Resumen del mes (AAAA-MM) por transportista, solo de la moneda pedida. */
export function resumenMes(viajes: ViajeAnotador[], mes: string, catalogo: TransportistaAnotador[], moneda = "ARS"): ResumenTransportista[] {
  const m = new Map<string, ResumenTransportista>();
  for (const v of viajes) {
    if (!v.fecha.startsWith(mes) || !vigente(v) || !cuentaEnTransportes(v) || (v.moneda || "ARS") !== moneda) continue;
    const k = claveViaje(v, catalogo);
    const t = catalogo.find((c) => c.id === k);
    const r = m.get(k) || { clave: k, nombre: t?.nombre || (v.transportista || "Sin nombre"), viajes: 0, sinMonto: 0, total: 0, liquidados: 0, pendientes: [], totalPendiente: 0 };
    const p = montoViaje(v);
    r.viajes++;
    if (p == null) r.sinMonto++;
    r.total += p || 0;
    if (v.factura_compra_id) r.liquidados++;
    else { r.pendientes.push(v); r.totalPendiente += p || 0; }
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.viajes - a.viajes || a.nombre.localeCompare(b.nombre));
}

/** Suma de montos (los sin monto valen 0). */
export const totalMontos = (lista: ViajeAnotador[]) => lista.reduce((s, v) => s + (montoViaje(v) || 0), 0);

export const diasDelMes = (mes: string) => new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();

/** Suma n meses a AAAA-MM. */
export function sumarMeses(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 7);
}

/** Lee un monto escrito a mano ("3.000", "3000,50", ""). undefined = inválido, null = vacío. */
export function leerMonto(texto: string): number | null | undefined {
  const t = texto.trim().replace(/\$/g, "").trim();
  if (t === "") return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
