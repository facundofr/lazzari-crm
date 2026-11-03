// Prueba rápida de lib/remito-entrega (sin base). Uso (desde crm/app): npx tsx scripts/test-remito-entrega.ts
import assert from "node:assert/strict";
import { entregaInicial, entregaGuardada, difiereDeSucursal, datosRemito, modoDeRemito, textoTransporte, valorTransporte, transportesPDF, entregaPDF, guardarEntrega, RETIRA_TEXTO, PROPIO_TEXTO } from "../src/lib/remito-entrega";

const nombre = (id: string) => ({ t1: "Cruz del Sur", t2: "Andreani" } as Record<string, string>)[id] || null;
const suc = { direccion: "Ruta 8 km 371", localidad: "Venado Tuerto", transportista_id: "t1" };

// Remito nuevo: domicilio de la sucursal; el transporte arranca SIEMPRE en "no sé" (nunca se asigna solo).
assert.deepEqual(entregaInicial(suc, null), { modo: "nose", transportista_id: null, domicilio: "Ruta 8 km 371", localidad: "Venado Tuerto" });
assert.deepEqual(entregaInicial(null, { direccion: "Av. Siempre Viva 1", localidad: "Rosario" }), { modo: "nose", transportista_id: null, domicilio: "Av. Siempre Viva 1", localidad: "Rosario" });

// Cómo lo lleva un remito guardado (solo con lo del remito)
assert.equal(modoDeRemito({ direccion_entrega_snapshot: "retira el cliente " }), "retira");
assert.equal(modoDeRemito({ entrega_propia: true, transportista_id: "t1" }), "propio");
assert.equal(modoDeRemito({ transportista_id: "t1" }), "transporte");
assert.equal(modoDeRemito({}), "nose");

// Remito guardado
const def = { ...entregaInicial(suc, null), modo: "transporte" as const, transportista_id: "t1" }; // lo que elige una persona
assert.deepEqual(entregaGuardada({ direccion_entrega_snapshot: "Otra 123", localidad_entrega_snapshot: "Rufino", transportista_id: "t1" }, def), { modo: "transporte", transportista_id: "t1", domicilio: "Otra 123", localidad: "Rufino" });
assert.equal(entregaGuardada({ direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null }, def).modo, "retira");
assert.equal(entregaGuardada({ direccion_entrega_snapshot: null, localidad_entrega_snapshot: null, transportista_id: null }, def).domicilio, "Ruta 8 km 371", "remito viejo = lo de la sucursal");
assert.equal(entregaGuardada({ direccion_entrega_snapshot: null, localidad_entrega_snapshot: null, transportista_id: null }, def).modo, "nose", "sin nada = todavía no sé");
assert.deepEqual(entregaGuardada({ entrega_propia: true }, def), { modo: "propio", transportista_id: null, domicilio: "Ruta 8 km 371", localidad: "Venado Tuerto" });

// ¿Distinto de la sucursal?
assert.deepEqual(difiereDeSucursal(def, suc), { domicilio: false, transportista: false });
assert.deepEqual(difiereDeSucursal({ ...def, domicilio: "ruta 8 KM 371 " }, suc), { domicilio: false, transportista: false }, "mayúsculas/espacios no cuentan");
assert.deepEqual(difiereDeSucursal({ ...def, modo: "transporte", transportista_id: "t2" }, suc), { domicilio: false, transportista: true });
assert.deepEqual(difiereDeSucursal({ ...def, localidad: "Rufino" }, suc), { domicilio: true, transportista: false });
assert.deepEqual(difiereDeSucursal({ ...def, modo: "retira" }, suc), { domicilio: false, transportista: false });

// Fila del remito (lo único que se guarda)
assert.deepEqual(datosRemito({ ...def, modo: "retira" }), { direccion_entrega_snapshot: RETIRA_TEXTO, localidad_entrega_snapshot: null, transportista_id: null, entrega_propia: false });
assert.deepEqual(datosRemito(def), { direccion_entrega_snapshot: "Ruta 8 km 371", localidad_entrega_snapshot: "Venado Tuerto", transportista_id: "t1", entrega_propia: false });
assert.deepEqual(datosRemito({ ...def, modo: "propio", transportista_id: null }), { direccion_entrega_snapshot: "Ruta 8 km 371", localidad_entrega_snapshot: "Venado Tuerto", transportista_id: null, entrega_propia: true });
assert.equal(datosRemito({ ...def, modo: "nose", transportista_id: null }).transportista_id, null);
// Ida y vuelta: lo que se guarda se vuelve a leer igual
for (const e of [def, { ...def, modo: "propio" as const, transportista_id: null }, { ...def, modo: "nose" as const, transportista_id: null }]) {
  assert.deepEqual(entregaGuardada(datosRemito(e), def), e);
}

// Columna Transporte (texto y valor del desplegable)
assert.equal(textoTransporte({ transportista_id: "t1" }, nombre), "Cruz del Sur");
assert.equal(textoTransporte({ direccion_entrega_snapshot: RETIRA_TEXTO }, nombre), RETIRA_TEXTO);
assert.equal(textoTransporte({ entrega_propia: true }, nombre), "Propio");
assert.equal(textoTransporte({ transportista_id: "viejo" }, nombre), "(transportista dado de baja)");
assert.equal(textoTransporte({}, nombre), "");
assert.equal(valorTransporte({ transportista_id: "t2" }), "t:t2");
assert.equal(valorTransporte({ entrega_propia: true }), "propio");
assert.equal(valorTransporte({ direccion_entrega_snapshot: RETIRA_TEXTO }), "retira");
assert.equal(valorTransporte({}), "nose");

// PDF: Transportista / Destino con lo del remito
assert.deepEqual(transportesPDF({ transportista_id: "t1", direccion_entrega_snapshot: "Mitre 50", localidad_entrega_snapshot: "Rufino" }, nombre), [{ transportista: "Cruz del Sur", destino: "Mitre 50, Rufino" }]);
assert.deepEqual(transportesPDF({ entrega_propia: true, direccion_entrega_snapshot: "Mitre 50" }, nombre), [{ transportista: PROPIO_TEXTO, destino: "Mitre 50" }]);
assert.deepEqual(transportesPDF({ direccion_entrega_snapshot: RETIRA_TEXTO }, nombre), [{ transportista: RETIRA_TEXTO, destino: null }]);
assert.deepEqual(transportesPDF({}, nombre), [], "sin transporte: el PDF dice Sin transporte asignado");

// PDF: línea Entrega (nombre — direccion). Lo del remito manda; sin nada, la sucursal sin repetir el nombre.
const sucPDF = { nombre: "Planta Norte", direccion: "Ruta 8 km 371", localidad: "Venado Tuerto", provincia: "Santa Fe" };
assert.deepEqual(entregaPDF({}, sucPDF), { nombre: "Planta Norte", direccion: "Ruta 8 km 371, Venado Tuerto, Santa Fe" });
assert.deepEqual(entregaPDF({ direccion_entrega_snapshot: "Mitre 50", localidad_entrega_snapshot: "Rufino" }, sucPDF), { nombre: "Planta Norte", direccion: "Mitre 50, Rufino" });
assert.deepEqual(entregaPDF({ direccion_entrega_snapshot: "Mitre 50", localidad_entrega_snapshot: "Rufino" }, null), { nombre: "Mitre 50, Rufino", direccion: null });
assert.deepEqual(entregaPDF({ localidad_entrega_snapshot: "Rufino" }, null), { nombre: "Rufino", direccion: null });
assert.deepEqual(entregaPDF({ direccion_entrega_snapshot: "retira el cliente " }, sucPDF), { nombre: RETIRA_TEXTO, direccion: "Planta Norte" });
assert.deepEqual(entregaPDF({ direccion_entrega_snapshot: RETIRA_TEXTO }, null), { nombre: RETIRA_TEXTO, direccion: null });
assert.deepEqual(entregaPDF({}, null), { nombre: null, direccion: null }, "sin nada: el PDF usa el domicilio del cliente");

// Guardar: solo toca remitos (y la sucursal si se pidió); NUNCA transportes.
(async () => {
  const tablas: string[] = [];
  const db = { from: (t: string) => { tablas.push(t); const q: any = { update: () => q, eq: () => q, then: (ok: any) => ok({ error: null }) }; return q; } };
  const ctx = { sociedad_id: "soc", cliente_id: "cli", remito_id: "rem", sucursal_id: "suc" };
  assert.equal(await guardarEntrega(db, { ...def, modo: "propio", transportista_id: null }, ctx, null), null);
  assert.equal(await guardarEntrega(db, { ...def, transportista_id: "t2" }, ctx, { domicilio: false, transportista: true }), null);
  assert.deepEqual(tablas, ["remitos", "remitos", "cliente_sucursales"]);
  assert.ok(!tablas.includes("transportes"), "el remito no toca Transportes");
  console.log("remito-entrega OK");
})();
