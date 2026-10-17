// Asistente que hace cosas, Etapa 1: arma la vista previa, hace el cambio y lo deshace.
// Todo con la sesión del usuario (RLS): la IA no puede tocar nada que el usuario no pueda tocar.
// La lógica pura (qué campos, antes/después, deshacer) está en lib/ia-acciones.ts.

import type Anthropic from "@anthropic-ai/sdk";
import { estadoPorRecibido } from "@/lib/compras-recepcion";
import {
  CAMPOS_EDITABLES, COLUMNAS_TITULO, NOMBRE_TABLA, diferencias, esTabla, limpiarCambios, planDeshacer, resumenCambio, tituloRegistro,
  type CambioCampo, type Propuesta, type Tabla,
} from "@/lib/ia-acciones";

type Db = any;

const CON_SOCIEDAD = new Set<Tabla>(["clientes", "proveedores", "facturas", "ordenes_compra"]);
const ver = (v: unknown) => (v === null || v === undefined || v === "" ? "(vacío)" : String(v));

export const HERRAMIENTAS_HACER: Anthropic.Messages.Tool[] = [
  {
    name: "proponer_cambio",
    description: `Propone cambiar campos de UN registro. NO lo guarda: el usuario ve antes → después y aprieta "Hacer".
Antes de proponer, buscá el registro con query_database y usá su id real.
Tablas y campos que se pueden cambiar:
${Object.entries(CAMPOS_EDITABLES).map(([t, c]) => `- ${t}: ${Object.keys(c).join(", ")}`).join("\n")}
Notas: orden_compra_items.cantidad_recibida = TOTAL que llegó de ese renglón (no lo que se suma); el estado de la OC se recalcula solo.
facturas.email_enviado_a = mails separados por coma.
Para vaciar un campo mandá "".`,
    input_schema: {
      type: "object" as const,
      properties: {
        tabla: { type: "string", enum: Object.keys(CAMPOS_EDITABLES) },
        id: { type: "string", description: "id (uuid) del registro" },
        cambios: { type: "object", description: "campo → valor nuevo", additionalProperties: { type: "string" } },
      },
      required: ["tabla", "id", "cambios"],
    },
  },
  {
    name: "proponer_contacto",
    description: "Propone AGREGAR un contacto (persona) a un cliente o proveedor. NO lo guarda: el usuario aprieta \"Hacer\". Buscá antes el id del cliente/proveedor y fijate en contactos que no exista ya (si existe, proponé un cambio sobre ese contacto).",
    input_schema: {
      type: "object" as const,
      properties: {
        entidad: { type: "string", enum: ["cliente", "proveedor"] },
        entidad_id: { type: "string", description: "id del cliente o proveedor" },
        nombre: { type: "string" }, cargo: { type: "string" }, email: { type: "string" }, telefono: { type: "string" }, whatsapp: { type: "string" }, notas: { type: "string" },
      },
      required: ["entidad", "entidad_id", "nombre"],
    },
  },
];

export const PROMPT_HACER = `
# Modo "Hacer" (solo para este usuario)
Además de consultar, podés PROPONER cambios con las herramientas proponer_cambio y proponer_contacto.
- Nunca digas que algo quedó guardado: la propuesta aparece abajo con ANTES → DESPUÉS y un botón "Hacer"; el usuario decide.
- Primero buscá el registro correcto (por nombre, CUIT, número). Si hay más de uno parecido y no está claro cuál, preguntá cuál antes de proponer.
- Una propuesta por registro. Si piden varias cosas, hacé varias propuestas.
- Si piden algo que no está en la lista de campos (precios, facturar, notas de crédito, remitos, pagos, borrar), decí que eso todavía no lo podés hacer y explicá dónde se hace en el CRM.
- Después de proponer, respondé en una o dos líneas qué preparaste y que lo confirme con "Hacer".`;

async function filaConSociedad(db: Db, tabla: Tabla, id: string, columnas: string): Promise<{ fila: Record<string, unknown> | null; sociedadId: string | null; error?: string }> {
  const extra = CON_SOCIEDAD.has(tabla) ? ", sociedad_id" : tabla === "orden_compra_items" ? ", ordenes_compra(sociedad_id, numero)" : "";
  const cols = Array.from(new Set(["id", ...columnas.split(",").map((c) => c.trim()).filter(Boolean)])).join(", ");
  const { data, error } = await db.from(tabla).select(`${cols}${extra}`).eq("id", id).maybeSingle();
  if (error) return { fila: null, sociedadId: null, error: error.message };
  if (!data) return { fila: null, sociedadId: null };
  const soc = (data.sociedad_id as string | undefined) ?? (data.ordenes_compra?.sociedad_id as string | undefined) ?? null;
  return { fila: data, sociedadId: soc };
}

/** Arma la vista previa de un cambio (no guarda nada). Devuelve el texto para la IA y la propuesta para la pantalla. */
export async function armarPropuestaCambio(db: Db, input: Record<string, unknown>, sociedades: string[], pedido: string): Promise<{ resultado: string; propuesta?: Propuesta }> {
  const tabla = input.tabla;
  if (!esTabla(tabla)) return { resultado: JSON.stringify({ error: `No puedo cambiar ${String(tabla)}.` }) };
  const id = String(input.id || "");
  const limpio = limpiarCambios(tabla, (input.cambios as Record<string, unknown>) || {});
  if (limpio.errores.length) return { resultado: JSON.stringify({ error: limpio.errores.join("; ") }) };
  const campos = Object.keys(limpio.cambios);
  if (!campos.length) return { resultado: JSON.stringify({ error: `Ningún campo se puede cambiar. Ignorados: ${limpio.ignorados.join(", ")}` }) };

  const { fila, sociedadId, error } = await filaConSociedad(db, tabla, id, `${COLUMNAS_TITULO[tabla]}, ${campos.join(", ")}`);
  if (error) return { resultado: JSON.stringify({ error }) };
  if (!fila) return { resultado: JSON.stringify({ error: "No encontré ese registro (o no tenés permiso)." }) };
  if (sociedadId && sociedades.length && !sociedades.includes(sociedadId)) return { resultado: JSON.stringify({ error: "Ese registro es de otra sociedad." }) };

  const lista = diferencias(tabla, fila, limpio.cambios);
  if (!lista.length) return { resultado: JSON.stringify({ ok: true, nada: "Ya está así: no hay nada que cambiar." }) };

  const oc = (fila.ordenes_compra as { numero?: string } | undefined)?.numero;
  const titulo = tituloRegistro(tabla, fila) + (oc ? ` de la ${oc}` : "");
  const propuesta: Propuesta = { key: `${tabla}:${id}:${Date.now()}`, tipo: "editar", tabla, registro_id: id, titulo, cambios: lista, avisos: limpio.avisos, pedido };
  return {
    propuesta,
    resultado: JSON.stringify({ ok: true, propuesta_lista: `${NOMBRE_TABLA[tabla]} ${titulo}`, cambios: lista.map((c) => `${c.etiqueta}: ${ver(c.antes)} → ${ver(c.despues)}`), avisos: limpio.avisos, ignorados: limpio.ignorados, nota: "No está guardado: el usuario tiene que apretar Hacer." }),
  };
}

/** Vista previa de un contacto nuevo. */
export async function armarPropuestaContacto(db: Db, input: Record<string, unknown>, sociedades: string[], pedido: string): Promise<{ resultado: string; propuesta?: Propuesta }> {
  const tipo = input.entidad === "proveedor" ? "proveedor" : input.entidad === "cliente" ? "cliente" : null;
  if (!tipo) return { resultado: JSON.stringify({ error: "entidad tiene que ser cliente o proveedor" }) };
  const entidadId = String(input.entidad_id || "");
  const { data: ent } = await db.from(tipo === "cliente" ? "clientes" : "proveedores").select("id, razon_social, sociedad_id").eq("id", entidadId).maybeSingle();
  if (!ent) return { resultado: JSON.stringify({ error: `No encontré ese ${tipo}.` }) };
  if (ent.sociedad_id && sociedades.length && !sociedades.includes(ent.sociedad_id)) return { resultado: JSON.stringify({ error: `Ese ${tipo} es de otra sociedad.` }) };
  const { nombre, cargo, email, telefono, whatsapp, notas } = input;
  const limpio = limpiarCambios("contactos", { nombre, cargo, email, telefono, whatsapp, notas });
  if (!limpio.cambios.nombre) return { resultado: JSON.stringify({ error: "Falta el nombre del contacto." }) };
  const lista: CambioCampo[] = Object.entries(limpio.cambios).filter(([, v]) => v !== null)
    .map(([campo, v]) => ({ campo, etiqueta: CAMPOS_EDITABLES.contactos[campo], antes: null, despues: v }));
  const propuesta: Propuesta = {
    key: `contacto:${entidadId}:${Date.now()}`, tipo: "crear", tabla: "contactos", registro_id: null,
    titulo: `nuevo de ${ent.razon_social}`, cambios: lista, avisos: limpio.avisos, pedido,
    entidad: { tipo, id: entidadId, nombre: ent.razon_social },
  };
  return { propuesta, resultado: JSON.stringify({ ok: true, propuesta_lista: `Contacto nuevo para ${ent.razon_social}`, avisos: limpio.avisos, nota: "No está guardado: el usuario tiene que apretar Hacer." }) };
}

async function recalcularEstadoOC(db: Db, itemId: string): Promise<void> {
  const { data: it } = await db.from("orden_compra_items").select("orden_id").eq("id", itemId).maybeSingle();
  if (!it?.orden_id) return;
  const [{ data: items }, { data: oc }] = await Promise.all([
    db.from("orden_compra_items").select("id, cantidad, cantidad_recibida").eq("orden_id", it.orden_id),
    db.from("ordenes_compra").select("estado").eq("id", it.orden_id).maybeSingle(),
  ]);
  if (!oc) return;
  const estado = estadoPorRecibido(items || [], oc.estado || "enviada");
  if (estado !== oc.estado) await db.from("ordenes_compra").update({ estado }).eq("id", it.orden_id);
}

export interface Resultado { ok: boolean; mensaje: string; accionId?: string }

/** "Hacer": vuelve a validar contra lo que hay hoy en la base, guarda y anota en ia_acciones. */
export async function hacerPropuesta(db: Db, p: Propuesta, sociedades: string[], sociedadActiva: string | null): Promise<Resultado> {
  if (!esTabla(p?.tabla)) return { ok: false, mensaje: "Propuesta inválida." };
  const pedidos = Object.fromEntries((p.cambios || []).map((c) => [c.campo, c.despues]));

  if (p.tipo === "crear") {
    if (p.tabla !== "contactos" || !p.entidad?.id) return { ok: false, mensaje: "Propuesta inválida." };
    const prev = await armarPropuestaContacto(db, { entidad: p.entidad.tipo, entidad_id: p.entidad.id, ...pedidos }, sociedades, p.pedido || "");
    if (!prev.propuesta) return { ok: false, mensaje: JSON.parse(prev.resultado).error || "No se pudo." };
    const fila = Object.fromEntries(prev.propuesta.cambios.map((c) => [c.campo, c.despues]));
    const { data: nuevo, error } = await db.from("contactos").insert({ entity_type: p.entidad.tipo, entity_id: p.entidad.id, ...fila }).select("id").single();
    if (error) return { ok: false, mensaje: `No se pudo crear el contacto: ${error.message}` };
    const resumen = `Contacto nuevo de ${p.entidad.nombre}: ${fila.nombre}${fila.email ? ` (${fila.email})` : ""}`;
    const { data: acc, error: e2 } = await db.from("ia_acciones").insert({
      sociedad_id: sociedadActiva, pedido: p.pedido || null, tipo: "crear", tabla: "contactos", registro_id: nuevo.id, resumen, antes: {}, despues: fila,
    }).select("id").single();
    return { ok: true, accionId: acc?.id, mensaje: e2 ? `${resumen}. Hecho, pero no quedó en el historial (${e2.message}).` : `${resumen}. Hecho.` };
  }

  const prev = await armarPropuestaCambio(db, { tabla: p.tabla, id: p.registro_id, cambios: pedidos }, sociedades, p.pedido || "");
  if (!prev.propuesta) {
    const r = JSON.parse(prev.resultado);
    return r.nada ? { ok: true, mensaje: r.nada } : { ok: false, mensaje: r.error || "No se pudo." };
  }
  const lista = prev.propuesta.cambios;
  const despues = Object.fromEntries(lista.map((c) => [c.campo, c.despues]));
  const antes = Object.fromEntries(lista.map((c) => [c.campo, c.antes]));
  const { data: upd, error } = await db.from(p.tabla).update(despues).eq("id", p.registro_id).select("id");
  if (error) return { ok: false, mensaje: `No se pudo guardar: ${error.message}` };
  if (!upd?.length) return { ok: false, mensaje: "No se guardó: tu usuario no tiene permiso para cambiar eso." };
  if (p.tabla === "orden_compra_items" && "cantidad_recibida" in despues) await recalcularEstadoOC(db, p.registro_id!);
  const resumen = resumenCambio(p.tabla, prev.propuesta.titulo, lista);
  const { data: acc, error: e2 } = await db.from("ia_acciones").insert({
    sociedad_id: sociedadActiva, pedido: p.pedido || null, tipo: "editar", tabla: p.tabla, registro_id: p.registro_id, resumen, antes, despues,
  }).select("id").single();
  return { ok: true, accionId: acc?.id, mensaje: e2 ? `Hecho, pero no quedó en el historial (${e2.message}).` : "Hecho." };
}

/** Deshacer una acción del historial. Lo que alguien cambió después no se pisa. */
export async function deshacerAccion(db: Db, accionId: string, userId: string): Promise<Resultado> {
  const { data: a, error } = await db.from("ia_acciones").select("*").eq("id", accionId).maybeSingle();
  if (error || !a) return { ok: false, mensaje: "No encontré esa acción." };
  if (a.estado === "deshecha") return { ok: true, mensaje: "Ya estaba deshecha." };
  if (!esTabla(a.tabla)) return { ok: false, mensaje: "Acción inválida." };
  let nota = "";

  if (a.tipo === "crear") {
    // Solo se saca el contacto que creó la IA; si ya se usa en un presupuesto, la base no deja y se avisa.
    const { error: e } = await db.from(a.tabla).delete().eq("id", a.registro_id);
    if (e) return { ok: false, mensaje: `No se pudo deshacer (puede que ya se esté usando): ${e.message}` };
  } else {
    const campos = Object.keys(a.despues || {});
    const { data: fila } = await db.from(a.tabla).select(`id, ${campos.join(", ")}`).eq("id", a.registro_id).maybeSingle();
    if (!fila) return { ok: false, mensaje: "El registro ya no está." };
    const plan = planDeshacer(fila, a.antes || {}, a.despues || {});
    if (Object.keys(plan.revertir).length) {
      const { data: upd, error: e } = await db.from(a.tabla).update(plan.revertir).eq("id", a.registro_id).select("id");
      if (e) return { ok: false, mensaje: `No se pudo deshacer: ${e.message}` };
      if (!upd?.length) return { ok: false, mensaje: "No se pudo deshacer: sin permiso." };
      if (a.tabla === "orden_compra_items" && "cantidad_recibida" in plan.revertir) await recalcularEstadoOC(db, a.registro_id);
    }
    if (plan.tocadosDespues.length) {
      const et = CAMPOS_EDITABLES[a.tabla as Tabla];
      nota = `No se tocó ${plan.tocadosDespues.map((c) => et[c] || c).join(", ")}: alguien lo cambió después.`;
    }
  }
  await db.from("ia_acciones").update({ estado: "deshecha", deshecha_at: new Date().toISOString(), deshecha_por: userId, nota_deshacer: nota || null }).eq("id", accionId);
  return { ok: true, mensaje: nota ? `Deshecho. ${nota}` : "Deshecho: quedó como estaba." };
}
