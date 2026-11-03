// "¿Quién lo lleva?" del remito: domicilio, localidad y transporte.
// - Se guarda SOLO en el remito (direccion_entrega_snapshot, localidad_entrega_snapshot, transportista_id, entrega_propia).
//   Augusto 03/11/2026: "Si se pone o cambia algo en remito, queda solo en remito, no quiero que nada de remito vaya a transporte".
//   El remito ya no crea, corrige ni cancela viajes en Transportes (los viajes se cargan en Transportes).
// - "Lo retira el cliente" = en el remito queda el domicilio "Retira el cliente" (así sale en el PDF).
// - "Lo llevamos nosotros" = entrega_propia. "Todavía no sé" = sin transporte.
// - Todo se puede cambiar siempre.
// Funciones puras + guardarEntrega(db, …), que recibe la base por parámetro (se prueba sin Supabase).

export type ModoEntrega = "transporte" | "propio" | "retira" | "nose";

export interface Entrega {
  modo: ModoEntrega;
  /** Con modo "transporte": id del transportista del catálogo. */
  transportista_id: string | null;
  domicilio: string;
  localidad: string;
}

/** Lo que el remito guarda de su entrega. */
export interface RemitoEntrega {
  direccion_entrega_snapshot?: string | null;
  localidad_entrega_snapshot?: string | null;
  transportista_id?: string | null;
  entrega_propia?: boolean | null;
}

export interface SucursalEntrega { direccion: string | null; localidad: string | null; transportista_id: string | null }

export const RETIRA_TEXTO = "Retira el cliente";
export const PROPIO_TEXTO = "Propio (lo llevamos nosotros)";

const limpio = (t: string | null | undefined) => (t || "").trim();
const mismo = (a: string | null | undefined, b: string | null | undefined) => limpio(a).toLowerCase() === limpio(b).toLowerCase();

/** Destino: "domicilio, localidad" ("" si no hay). */
export const destinoDe = (e: { domicilio?: string | null; localidad?: string | null }) => [limpio(e.domicilio), limpio(e.localidad)].filter(Boolean).join(", ");

/** Cómo lo lleva un remito guardado. */
export function modoDeRemito(r: RemitoEntrega): ModoEntrega {
  if (mismo(r.direccion_entrega_snapshot, RETIRA_TEXTO)) return "retira";
  if (r.entrega_propia) return "propio";
  if (r.transportista_id) return "transporte";
  return "nose";
}

/** Entrega para un remito nuevo: domicilio de la sucursal (o del cliente). El transporte arranca SIEMPRE en "Todavía no sé":
 *  nunca se asigna solo, lo elige una persona. */
export function entregaInicial(suc: SucursalEntrega | null, cliente: { direccion: string | null; localidad: string | null } | null): Entrega {
  const base = suc || { direccion: cliente?.direccion ?? null, localidad: cliente?.localidad ?? null };
  return { modo: "nose", transportista_id: null, domicilio: limpio(base.direccion), localidad: limpio(base.localidad) };
}

/** Entrega de un remito ya hecho (lo guardado manda; si es un remito viejo sin domicilio, el de la sucursal). */
export function entregaGuardada(remito: RemitoEntrega, porDefecto: Entrega): Entrega {
  const modo = modoDeRemito(remito);
  const tieneDomicilio = !!limpio(remito.direccion_entrega_snapshot) && modo !== "retira";
  const domicilio = tieneDomicilio ? limpio(remito.direccion_entrega_snapshot) : porDefecto.domicilio;
  const localidad = tieneDomicilio || limpio(remito.localidad_entrega_snapshot) ? limpio(remito.localidad_entrega_snapshot) : porDefecto.localidad;
  return { modo, transportista_id: modo === "transporte" ? remito.transportista_id || null : null, domicilio, localidad };
}

/** ¿Lo elegido es distinto de lo de siempre de la sucursal? (para preguntar si se guarda en la sucursal). */
export function difiereDeSucursal(e: Entrega, suc: SucursalEntrega | null): { domicilio: boolean; transportista: boolean } {
  if (!suc || e.modo === "retira") return { domicilio: false, transportista: false };
  const domicilio = !mismo(e.domicilio, suc.direccion) || !mismo(e.localidad, suc.localidad);
  const transportista = e.modo === "transporte" && !!e.transportista_id && e.transportista_id !== suc.transportista_id;
  return { domicilio, transportista };
}

/** Lo que va en la fila del remito. */
export function datosRemito(e: Entrega) {
  if (e.modo === "retira") return { direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null, entrega_propia: false };
  return {
    direccion_entrega_snapshot: limpio(e.domicilio) || null,
    localidad_entrega_snapshot: limpio(e.localidad) || null,
    transportista_id: e.modo === "transporte" && e.transportista_id ? e.transportista_id : null,
    entrega_propia: e.modo === "propio",
  };
}

/**
 * Línea "Entrega" del PDF (el PDF la arma como "nombre — direccion").
 * Manda lo cargado en el remito ("¿Quién lo lleva?"); si no hay nada, el domicilio de la sucursal.
 * - Retira el cliente: "Retira el cliente" (+ la sucursal, si tiene).
 * - Domicilio cambiado: "Sucursal — domicilio, localidad", o solo "domicilio, localidad" si no hay sucursal.
 * - null en los dos = el PDF usa el domicilio del cliente.
 */
export function entregaPDF(
  remito: { direccion_entrega_snapshot?: string | null; localidad_entrega_snapshot?: string | null },
  suc: { nombre?: string | null; direccion?: string | null; localidad?: string | null; provincia?: string | null } | null,
): { nombre: string | null; direccion: string | null } {
  const nombreSuc = limpio(suc?.nombre) || null;
  if (mismo(remito.direccion_entrega_snapshot, RETIRA_TEXTO)) return { nombre: RETIRA_TEXTO, direccion: nombreSuc };
  const cargado = [limpio(remito.direccion_entrega_snapshot), limpio(remito.localidad_entrega_snapshot)].filter(Boolean).join(", ");
  if (cargado) return nombreSuc ? { nombre: nombreSuc, direccion: cargado } : { nombre: cargado, direccion: null };
  if (!suc) return { nombre: null, direccion: null };
  const dirSuc = [limpio(suc.direccion), limpio(suc.localidad), limpio(suc.provincia)].filter(Boolean).join(", ") || null;
  return nombreSuc ? { nombre: nombreSuc, direccion: dirSuc } : { nombre: dirSuc, direccion: null };
}

/** Texto corto de la columna Transporte (lista y ficha). nombreDe = nombre del transportista por id. */
export function textoTransporte(r: RemitoEntrega, nombreDe: (id: string) => string | null | undefined): string {
  const modo = modoDeRemito(r);
  if (modo === "retira") return RETIRA_TEXTO;
  if (modo === "propio") return "Propio";
  if (modo === "transporte") return nombreDe(r.transportista_id as string) || "(transportista dado de baja)";
  return "";
}

/** Valor del desplegable de la columna Transporte: "t:<id>", "propio", "retira" o "nose". */
export function valorTransporte(r: RemitoEntrega): string {
  const modo = modoDeRemito(r);
  return modo === "transporte" ? `t:${r.transportista_id}` : modo;
}

/** Renglones "Transportista / Destino" del PDF, con lo que dice el remito. */
export function transportesPDF(r: RemitoEntrega, nombreDe: (id: string) => string | null | undefined): { transportista: string; destino: string | null }[] {
  const modo = modoDeRemito(r);
  const destino = destinoDe({ domicilio: r.direccion_entrega_snapshot, localidad: r.localidad_entrega_snapshot }) || null;
  if (modo === "retira") return [{ transportista: RETIRA_TEXTO, destino: null }];
  if (modo === "propio") return [{ transportista: PROPIO_TEXTO, destino }];
  if (modo === "transporte") {
    const nombre = nombreDe(r.transportista_id as string);
    return nombre ? [{ transportista: nombre, destino }] : [];
  }
  return [];
}

/**
 * Guarda la entrega de un remito: solo la fila del remito (y, si se pidió, la sucursal). Nunca toca Transportes.
 * Devuelve un aviso si algo no quedó (nunca tira error). db = cliente de Supabase.
 * Si guardarEnSucursal, el domicilio/transportista quedan como los de siempre de esa sucursal.
 */
export async function guardarEntrega(
  db: any,
  e: Entrega,
  ctx: { sociedad_id: string; cliente_id: string; remito_id: string; sucursal_id: string | null },
  guardarEnSucursal: { domicilio: boolean; transportista: boolean } | null,
): Promise<string | null> {
  const avisos: string[] = [];
  const { error: e1 } = await db.from("remitos").update(datosRemito(e)).eq("id", ctx.remito_id).eq("sociedad_id", ctx.sociedad_id);
  if (e1) avisos.push(`domicilio/transporte del remito (${e1.message})`);
  if (guardarEnSucursal && ctx.sucursal_id && (guardarEnSucursal.domicilio || guardarEnSucursal.transportista)) {
    const cambios: Record<string, unknown> = {};
    if (guardarEnSucursal.domicilio) { cambios.direccion = limpio(e.domicilio) || null; cambios.localidad = limpio(e.localidad) || null; }
    if (guardarEnSucursal.transportista && e.modo === "transporte" && e.transportista_id) cambios.transportista_id = e.transportista_id;
    if (Object.keys(cambios).length) {
      const { error } = await db.from("cliente_sucursales").update(cambios).eq("id", ctx.sucursal_id).eq("cliente_id", ctx.cliente_id);
      if (error) avisos.push(`la sucursal (${error.message})`);
    }
  }
  return avisos.length ? `El remito quedó, pero no se pudo guardar: ${avisos.join(" · ")}` : null;
}
