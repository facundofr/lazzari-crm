// Prueba de lib/presupuesto-ia.ts. Correr desde crm/app: npx tsx scripts/test-presupuesto-ia.ts
import assert from "node:assert/strict";
import { proponerPrecio, semaforoLinea, buscarClientes, clienteSeguro, ultimoPrecioCliente, avisosPresupuesto, margenSobreCosto } from "../src/lib/presupuesto-ia";

// margen
assert.equal(margenSobreCosto(115, 100), 15);
assert.equal(margenSobreCosto(100, 0), null);

// precio: lista
let p = proponerPrecio({ costo: 100, ventaLista: 140 });
assert.equal(p.origen, "lista"); assert.equal(p.precio, 140); assert.equal(p.margenPct, 40); assert.equal(p.bajoMinimo, false);
// precio: último precio vigente (margen ok)
p = proponerPrecio({ costo: 100, ventaLista: 140, ultimo: { precio: 125, fecha: "2026-09-01", numero: "PR-2026-1100" } });
assert.equal(p.origen, "ultimo"); assert.equal(p.precio, 125); assert.match(p.nota, /última vez/); assert.match(p.nota, /lista hoy/);
// precio: último precio quedó bajo el mínimo con el costo de hoy → lista
p = proponerPrecio({ costo: 110, ventaLista: 150, ultimo: { precio: 120, fecha: "2026-06-01" } });
assert.equal(p.origen, "lista"); assert.equal(p.precio, 150); assert.match(p.nota, /se usa la lista/);
// lista con margen bajo: avisa pero no cambia el precio
p = proponerPrecio({ costo: 100, ventaLista: 108 });
assert.equal(p.precio, 108); assert.equal(p.bajoMinimo, true); assert.match(p.nota, /Margen 8%/);
// sin precio
p = proponerPrecio({ costo: 100, ventaLista: null });
assert.equal(p.origen, "sin_precio"); assert.equal(p.precio, 0);
// sin costo pero con último precio
p = proponerPrecio({ costo: null, ventaLista: 90, ultimo: { precio: 80, fecha: "2026-01-01" } });
assert.equal(p.origen, "ultimo"); assert.equal(p.margenPct, null);

// semáforo
const base = { confianza: "alta" as const, tieneArticulo: true, precio: 10, cantidad: 5, bajoMinimo: false };
assert.equal(semaforoLinea(base), "verde");
assert.equal(semaforoLinea({ ...base, bajoMinimo: true }), "amarillo");
assert.equal(semaforoLinea({ ...base, confianza: "media" }), "amarillo");
assert.equal(semaforoLinea({ ...base, cantidad: 2.5 }), "amarillo");
assert.equal(semaforoLinea({ ...base, precio: 0 }), "rojo");
assert.equal(semaforoLinea({ ...base, tieneArticulo: false }), "rojo");
assert.equal(semaforoLinea({ ...base, confianza: "ninguna" }), "rojo");

// clientes
const clientes = [
  { id: "1", razon_social: "CORTEVA AGRISCIENCE ARGENTINA S.R.L.", cuit: "30-12345678-9", email: "compras@corteva.com" },
  { id: "2", razon_social: "Corteva Seeds SA", cuit: "30-99999999-1", email: null },
  { id: "3", razon_social: "Limagrain Argentina S.A.", cuit: "30-70000000-5", email: "x@limagrain.com" },
];
let r = buscarClientes(clientes, { cuit: "30123456789" });
assert.equal(r[0].cliente.id, "1"); assert.ok(clienteSeguro(r));
r = buscarClientes(clientes, { empresa: "Limagrain" });
assert.equal(r[0].cliente.id, "3");
r = buscarClientes(clientes, { empresa: "Corteva" });
assert.equal(r.length, 2); assert.ok(!clienteSeguro(r));
r = buscarClientes(clientes, { email: "juan@limagrain.com" });
assert.equal(r[0].cliente.id, "3"); assert.match(r[0].motivo, /dominio/);
r = buscarClientes(clientes, { email: "juan@gmail.com" });
assert.equal(r.length, 0);

// último precio por cliente
const hist = [
  { codigo: "A1", descripcion: "Guante nitrilo", precio_venta: 10, moneda: "USD", fecha: "2026-05-01", numero: "PR-1" },
  { codigo: "A1", descripcion: "Guante nitrilo", precio_venta: 12, moneda: "USD", fecha: "2026-08-01", numero: "PR-2" },
  { codigo: "A1", descripcion: "Guante nitrilo", precio_venta: 9000, moneda: "ARS", fecha: "2026-09-01", numero: "PR-3" },
];
assert.equal(ultimoPrecioCliente(hist, ["A1"], "x", "USD")?.precio, 12);
assert.equal(ultimoPrecioCliente(hist, [], "GUANTE  nitrilo", "ARS")?.precio, 9000);
assert.equal(ultimoPrecioCliente(hist, ["ZZ"], "otra cosa", "USD"), null);

// avisos
const av = avisosPresupuesto({
  moneda: "USD", cotizacionModalidad: "billetes", clienteMonedaPredeterminada: "USD Divisa",
  lineas: [
    { incluir: true, precio: 0, costo: 10, cantidad: 1, margenPct: null, descripcion: "Casco" },
    { incluir: true, precio: 105, costo: 100, cantidad: 2.5, margenPct: 5, descripcion: "Botín" },
    { incluir: false, precio: 0, costo: 1, cantidad: 1, margenPct: null, descripcion: "No cuenta" },
  ],
});
assert.ok(av.some(a => /sin precio/.test(a)) && av.some(a => /menor a 15%/.test(a)) && av.some(a => /decimales/.test(a)) && av.some(a => /divisa/.test(a)));
assert.equal(avisosPresupuesto({ moneda: "ARS", lineas: [{ incluir: true, precio: 150, costo: 100, cantidad: 1, margenPct: 50, descripcion: "ok" }] }).length, 0);

console.log("test-presupuesto-ia OK");
