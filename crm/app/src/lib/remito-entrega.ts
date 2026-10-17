// "¿Quién lo lleva?" del remito: domicilio, localidad, transporte y costo del flete.
// - Se guarda en el remito (direccion_entrega_snapshot, localidad_entrega_snapshot, transportista_id)
//   y el viaje en `transportes` (transportista_id y remito_id siempre; costo null si no se sabe, nunca 0).
// - "Lo retira el cliente" = sin viaje; en el remito queda el domicilio "Retira el cliente" (así sale en el PDF).
// - "Lo llevamos nosotros" = viaje tipo "interno". "Todavía no sé" = sin viaje.
// - Todo se puede cambiar siempre: si ya había viaje se corrige; si se pasa a "retira"/"no sé", el viaje solicitado queda "cancelado" (no se borra).
// Funciones puras + guardarEntrega(db, …), que recibe la base por parámetro (se prueba sin Supabase).

export type ModoEntrega = "transporte" | "propio" | "retira" | "nose";

export interface Entrega {
  modo: ModoEntrega;
  /** Con modo "transporte": id del transportista, o FILA_ACTUAL para dejar el de un viaje viejo sin id. */
  transportista_id: string | null;
  domicilio: string;
  localidad: string;
  /** Texto del input; vacío = no se sabe (queda null). */
  costo: string;
}

export interface FilaTransporte {
  id: string;
  transportista: string | null;
  transportista_id: string | null;
  tipo: string | null;
  estado: string | null;
  destino: string | null;
  costo: number | null;
  created_at?: string | null;
}

export interface SucursalEntrega { direccion: string | null; localidad: string | null; transportista_id: string | null }

export const RETIRA_TEXTO = "Retira el cliente";
export const PROPIO_TEXTO = "Propio (lo llevamos nosotros)";
export const FILA_ACTUAL = "__fila";

const limpio = (t: string | null | undefined) => (t || "").trim();
const mismo = (a: string | null | undefined, b: string | null | undefined) => limpio(a).toLowerCase() === limpio(b).toLowerCase();

/** Costo del input → número o null (vacío o inválido = no se sabe). 0 escrito a propósito queda 0. */
export function costoNumero(t: string): number | null {
  const s = limpio(t).replace(/\$/g, "").replace(/\s/g, "");
  if (!s) return null;
  // "12.500,50" y "9.000" = miles con punto (como se escribe acá); "8000.5" = decimal con punto.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Destino del viaje: "domicilio, localidad" ("" si no hay: la columna destino no acepta null). */
export const destinoDe = (e: Pick<Entrega, "domicilio" | "localidad">) => [limpio(e.domicilio), limpio(e.localidad)].filter(Boolean).join(", ");

/** Viaje vigente del remito (el último que no está cancelado). */
export function filaVigente(filas: FilaTransporte[]): FilaTransporte | null {
  const vivas = filas.filter((f) => f.estado !== "cancelado");
  vivas.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return vivas[0] || null;
}

/** Entrega para un remito nuevo: domicilio de la sucursal (o del cliente) y su transportista; si no tiene, el último que usó el cliente. */
export function entregaInicial(suc: SucursalEntrega | null, cliente: { direccion: string | null; localidad: string | null } | null, ultimoTransportista: string | null): Entrega {
  const base = suc || { direccion: cliente?.direccion ?? null, localidad: cliente?.localidad ?? null, transportista_id: null };
  const tid = suc?.transportista_id || ultimoTransportista || null;
  return { modo: tid ? "transporte" : "nose", transportista_id: tid, domicilio: limpio(base.direccion), localidad: limpio(base.localidad), costo: "" };
}

/** Entrega de un remito ya hecho (lo guardado manda; si es un remito viejo sin nada, la de la sucursal). */
export function entregaGuardada(
  remito: { direccion_entrega_snapshot: string | null; localidad_entrega_snapshot: string | null; transportista_id: string | null },
  fila: FilaTransporte | null,
  porDefecto: Entrega,
): Entrega {
  const retira = mismo(remito.direccion_entrega_snapshot, RETIRA_TEXTO);
  const tieneDomicilio = !!limpio(remito.direccion_entrega_snapshot) && !retira;
  const domicilio = tieneDomicilio ? limpio(remito.direccion_entrega_snapshot) : porDefecto.domicilio;
  const localidad = tieneDomicilio || limpio(remito.localidad_entrega_snapshot) ? limpio(remito.localidad_entrega_snapshot) : porDefecto.localidad;
  const costo = fila?.costo != null ? String(fila.costo) : "";
  if (fila) {
    if (fila.tipo === "interno") return { modo: "propio", transportista_id: null, domicilio, localidad, costo };
    return { modo: "transporte", transportista_id: fila.transportista_id || FILA_ACTUAL, domicilio, localidad, costo };
  }
  if (retira) return { modo: "retira", transportista_id: null, domicilio, localidad, costo: "" };
  if (remito.transportista_id) return { modo: "transporte", transportista_id: remito.transportista_id, domicilio, localidad, costo: "" };
  return { modo: "nose", transportista_id: null, domicilio, localidad, costo: "" };
}

/** ¿Lo elegido es distinto de lo de siempre de la sucursal? (para preguntar si se guarda en la sucursal). */
export function difiereDeSucursal(e: Entrega, suc: SucursalEntrega | null): { domicilio: boolean; transportista: boolean } {
  if (!suc || e.modo === "retira") return { domicilio: false, transportista: false };
  const domicilio = !mismo(e.domicilio, suc.direccion) || !mismo(e.localidad, suc.localidad);
  const transportista = e.modo === "transporte" && !!e.transportista_id && e.transportista_id !== FILA_ACTUAL && e.transportista_id !== suc.transportista_id;
  return { domicilio, transportista };
}

/** Lo que va en la fila del remito. */
export function datosRemito(e: Entrega) {
  if (e.modo === "retira") return { direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null };
  return {
    direccion_entrega_snapshot: limpio(e.domicilio) || null,
    localidad_entrega_snapshot: limpio(e.localidad) || null,
    transportista_id: e.modo === "transporte" && e.transportista_id && e.transportista_id !== FILA_ACTUAL ? e.transportista_id : null,
  };
}

export type AccionViaje =
  | { accion: "nada" }
  | { accion: "crear"; datos: Record<string, unknown> }
  | { accion: "corregir"; id: string; datos: Record<string, unknown> }
  | { accion: "cancelar"; id: string };

/** Qué hacer con el viaje en `transportes`. nombreDe = nombre del transportista por id. */
export function planViaje(
  e: Entrega,
  vigente: FilaTransporte | null,
  ctx: { sociedad_id: string; cliente_id: string; remito_id: string; fecha: string; created_by: string | null },
  nombreDe: (id: string) => string | null,
): AccionViaje {
  const lleva = e.modo === "transporte" || e.modo === "propio";
  if (!lleva) {
    // Solo se cancela un viaje todavía solicitado; uno ya entregado o facturado no se toca.
    return vigente && (vigente.estado || "solicitado") === "solicitado" ? { accion: "cancelar", id: vigente.id } : { accion: "nada" };
  }
  let transportista: string | null;
  let transportista_id: string | null;
  if (e.modo === "propio") { transportista = PROPIO_TEXTO; transportista_id = null; }
  else if (e.transportista_id === FILA_ACTUAL) { transportista = vigente?.transportista || null; transportista_id = vigente?.transportista_id || null; }
  else { transportista_id = e.transportista_id; transportista = transportista_id ? nombreDe(transportista_id) : null; }
  if (e.modo === "transporte" && !transportista) return { accion: "nada" };
  const comunes = { transportista, transportista_id, tipo: e.modo === "propio" ? "interno" : "externo", destino: destinoDe(e), costo: costoNumero(e.costo) };
  if (vigente) return { accion: "corregir", id: vigente.id, datos: comunes };
  return {
    accion: "crear",
    datos: { ...comunes, sociedad_id: ctx.sociedad_id, cliente_id: ctx.cliente_id, remito_id: ctx.remito_id, fecha: ctx.fecha, moneda: "ARS", estado: "solicitado", created_by: ctx.created_by },
  };
}

/** Texto corto para la columna Transporte de la lista. */
export function textoTransporte(remito: { direccion_entrega_snapshot?: string | null }, filas: Pick<FilaTransporte, "transportista" | "estado" | "tipo">[]): string {
  const vivas = filas.filter((f) => f.estado !== "cancelado" && f.transportista);
  if (vivas.length) return vivas.map((f) => (f.tipo === "interno" && f.transportista === PROPIO_TEXTO ? "Propio" : f.transportista)).join(", ");
  if (mismo(remito.direccion_entrega_snapshot, RETIRA_TEXTO)) return RETIRA_TEXTO;
  return "";
}

/**
 * Guarda la entrega de un remito: la fila del remito y el viaje. Devuelve un aviso si algo no quedó (nunca tira error).
 * db = cliente de Supabase. Si guardarEnSucursal, el domicilio/transportista quedan como los de siempre de esa sucursal.
 */
export async function guardarEntrega(
  db: any,
  e: Entrega,
  ctx: { sociedad_id: string; cliente_id: string; remito_id: string; fecha: string; created_by: string | null; sucursal_id: string | null },
  nombreDe: (id: string) => string | null,
  guardarEnSucursal: { domicilio: boolean; transportista: boolean } | null,
): Promise<string | null> {
  const avisos: string[] = [];
  const { error: e1 } = await db.from("remitos").update(datosRemito(e)).eq("id", ctx.remito_id).eq("sociedad_id", ctx.sociedad_id);
  if (e1) avisos.push(`domicilio/transporte del remito (${e1.message})`);
  const { data: filas } = await db.from("transportes").select("id, transportista, transportista_id, tipo, estado, destino, costo, created_at").eq("remito_id", ctx.remito_id).eq("sociedad_id", ctx.sociedad_id);
  const plan = planViaje(e, filaVigente(filas || []), ctx, nombreDe);
  if (plan.accion === "crear") {
    const { error } = await db.from("transportes").insert(plan.datos);
    if (error) avisos.push(`viaje en Transportes (${error.message})`);
  } else if (plan.accion === "corregir") {
    const { error } = await db.from("transportes").update({ ...plan.datos, updated_at: new Date().toISOString() }).eq("id", plan.id).eq("sociedad_id", ctx.sociedad_id);
    if (error) avisos.push(`viaje en Transportes (${error.message})`);
  } else if (plan.accion === "cancelar") {
    const { error } = await db.from("transportes").update({ estado: "cancelado", updated_at: new Date().toISOString() }).eq("id", plan.id).eq("sociedad_id", ctx.sociedad_id);
    if (error) avisos.push(`cancelar el viaje (${error.message})`);
  }
  if (guardarEnSucursal && ctx.sucursal_id && (guardarEnSucursal.domicilio || guardarEnSucursal.transportista)) {
    const cambios: Record<string, unknown> = {};
    if (guardarEnSucursal.domicilio) { cambios.direccion = limpio(e.domicilio) || null; cambios.localidad = limpio(e.localidad) || null; }
    if (guardarEnSucursal.transportista && e.modo === "transporte" && e.transportista_id && e.transportista_id !== FILA_ACTUAL) cambios.transportista_id = e.transportista_id;
    if (Object.keys(cambios).length) {
      const { error } = await db.from("cliente_sucursales").update(cambios).eq("id", ctx.sucursal_id).eq("cliente_id", ctx.cliente_id);
      if (error) avisos.push(`la sucursal (${error.message})`);
    }
  }
  return avisos.length ? `El remito quedó, pero no se pudo guardar: ${avisos.join(" · ")}` : null;
}
