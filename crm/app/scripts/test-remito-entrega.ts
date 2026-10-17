// Prueba rápida de lib/remito-entrega (sin base). Uso (desde crm/app): npx tsx scripts/test-remito-entrega.ts
import assert from "node:assert/strict";
import { costoNumero, entregaInicial, entregaGuardada, difiereDeSucursal, datosRemito, planViaje, filaVigente, textoTransporte, RETIRA_TEXTO, PROPIO_TEXTO, FILA_ACTUAL, type FilaTransporte } from "../src/lib/remito-entrega";

const ctx = { sociedad_id: "soc", cliente_id: "cli", remito_id: "rem", fecha: "2026-10-16", created_by: "yo" };
const nombre = (id: string) => ({ t1: "Cruz del Sur", t2: "Andreani" } as Record<string, string>)[id] || null;
const suc = { direccion: "Ruta 8 km 371", localidad: "Venado Tuerto", transportista_id: "t1" };

// Costo: vacío = null (no 0); acepta 12.500,50 y 12500.5
assert.equal(costoNumero(""), null);
assert.equal(costoNumero("  "), null);
assert.equal(costoNumero("0"), 0);
assert.equal(costoNumero("12.500,50"), 12500.5);
assert.equal(costoNumero("$ 12500.5"), 12500.5);
assert.equal(costoNumero("abc"), null);

// Remito nuevo: lo de la sucursal; sin transportista de sucursal, el último del cliente; sin nada, "no sé".
assert.deepEqual(entregaInicial(suc, null, "t2"), { modo: "transporte", transportista_id: "t1", domicilio: "Ruta 8 km 371", localidad: "Venado Tuerto", costo: "" });
assert.equal(entregaInicial({ ...suc, transportista_id: null }, null, "t2").transportista_id, "t2");
assert.deepEqual(entregaInicial(null, { direccion: "Av. Siempre Viva 1", localidad: "Rosario" }, null), { modo: "nose", transportista_id: null, domicilio: "Av. Siempre Viva 1", localidad: "Rosario", costo: "" });

// Remito guardado
const def = entregaInicial(suc, null, null);
const viaje: FilaTransporte = { id: "v1", transportista: "Cruz del Sur", transportista_id: "t1", tipo: "externo", estado: "solicitado", destino: null, costo: 8000, created_at: "2026-10-16T10:00" };
assert.deepEqual(entregaGuardada({ direccion_entrega_snapshot: "Otra 123", localidad_entrega_snapshot: "Rufino", transportista_id: "t1" }, viaje, def), { modo: "transporte", transportista_id: "t1", domicilio: "Otra 123", localidad: "Rufino", costo: "8000" });
assert.equal(entregaGuardada({ direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null }, null, def).modo, "retira");
assert.equal(entregaGuardada({ direccion_entrega_snapshot: null, localidad_entrega_snapshot: null, transportista_id: null }, null, def).domicilio, "Ruta 8 km 371", "remito viejo = lo de la sucursal");
assert.equal(entregaGuardada({ direccion_entrega_snapshot: null, localidad_entrega_snapshot: null, transportista_id: null }, { ...viaje, tipo: "interno", transportista_id: null }, def).modo, "propio");
assert.equal(entregaGuardada({ direccion_entrega_snapshot: null, localidad_entrega_snapshot: null, transportista_id: null }, { ...viaje, transportista_id: null }, def).transportista_id, FILA_ACTUAL);

// ¿Distinto de la sucursal?
assert.deepEqual(difiereDeSucursal(def, suc), { domicilio: false, transportista: false });
assert.deepEqual(difiereDeSucursal({ ...def, domicilio: "ruta 8 KM 371 " }, suc), { domicilio: false, transportista: false }, "mayúsculas/espacios no cuentan");
assert.deepEqual(difiereDeSucursal({ ...def, transportista_id: "t2" }, suc), { domicilio: false, transportista: true });
assert.deepEqual(difiereDeSucursal({ ...def, localidad: "Rufino" }, suc), { domicilio: true, transportista: false });
assert.deepEqual(difiereDeSucursal({ ...def, modo: "retira" }, suc), { domicilio: false, transportista: false });

// Fila del remito
assert.deepEqual(datosRemito({ ...def, modo: "retira" }), { direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null });
assert.deepEqual(datosRemito(def), { direccion_entrega_snapshot: "Ruta 8 km 371", localidad_entrega_snapshot: "Venado Tuerto", transportista_id: "t1" });
assert.equal(datosRemito({ ...def, modo: "propio", transportista_id: null }).transportista_id, null);

// Viaje: crear con transportista_id y remito_id, costo null si no se sabe
const p1 = planViaje(def, null, ctx, nombre);
assert.equal(p1.accion, "crear");
if (p1.accion === "crear") {
  assert.equal(p1.datos.transportista_id, "t1"); assert.equal(p1.datos.remito_id, "rem"); assert.equal(p1.datos.transportista, "Cruz del Sur");
  assert.equal(p1.datos.costo, null); assert.equal(p1.datos.estado, "solicitado"); assert.equal(p1.datos.tipo, "externo"); assert.equal(p1.datos.destino, "Ruta 8 km 371, Venado Tuerto");
}
// Corregir el que ya hay (cambia transportista y costo)
const p2 = planViaje({ ...def, transportista_id: "t2", costo: "9.000" }, viaje, ctx, nombre);
assert.deepEqual(p2, { accion: "corregir", id: "v1", datos: { transportista: "Andreani", transportista_id: "t2", tipo: "externo", destino: "Ruta 8 km 371, Venado Tuerto", costo: 9000 } });
// Lo llevamos nosotros = interno
const p3 = planViaje({ ...def, modo: "propio", transportista_id: null }, null, ctx, nombre);
assert.equal(p3.accion === "crear" && p3.datos.tipo, "interno");
assert.equal(p3.accion === "crear" && p3.datos.transportista, PROPIO_TEXTO);
// Retira / no sé: cancela solo si estaba solicitado; uno entregado no se toca; sin viaje, nada
assert.deepEqual(planViaje({ ...def, modo: "retira" }, viaje, ctx, nombre), { accion: "cancelar", id: "v1" });
assert.deepEqual(planViaje({ ...def, modo: "nose" }, { ...viaje, estado: "entregado" }, ctx, nombre), { accion: "nada" });
assert.deepEqual(planViaje({ ...def, modo: "nose" }, null, ctx, nombre), { accion: "nada" });
// Viaje viejo sin id: mantiene su nombre
const p4 = planViaje({ ...def, transportista_id: FILA_ACTUAL }, { ...viaje, transportista: "Fletes Juan", transportista_id: null }, ctx, nombre);
assert.equal(p4.accion === "corregir" && p4.datos.transportista, "Fletes Juan");

// Vigente y texto de la lista
assert.equal(filaVigente([{ ...viaje, id: "a", estado: "cancelado", created_at: "2026-10-17" }, viaje])?.id, "v1");
assert.equal(textoTransporte({}, [viaje]), "Cruz del Sur");
assert.equal(textoTransporte({ direccion_entrega_snapshot: RETIRA_TEXTO }, [{ ...viaje, estado: "cancelado" }]), RETIRA_TEXTO);
assert.equal(textoTransporte({}, [{ ...viaje, tipo: "interno", transportista: PROPIO_TEXTO }]), "Propio");
assert.equal(textoTransporte({}, []), "");

console.log("remito-entrega OK");
