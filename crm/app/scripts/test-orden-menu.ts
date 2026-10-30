// Prueba de lib/orden-menu.ts (Ordenar menú, 29/10/2026). Correr: npx tsx scripts/test-orden-menu.ts
import assert from "node:assert/strict";
import { aplicarOrdenMenu, moverEnLista, ordenValido } from "../src/lib/orden-menu";

const fabrica = ["/clientes", "/proveedores", "/presupuestos", "/finanzas", "/cobranzas"].map((href) => ({ href }));
const rutas = (l: { href: string }[]) => l.map((i) => i.href);

// Sin orden guardado: igual que de fábrica.
assert.deepEqual(rutas(aplicarOrdenMenu(fabrica, null)), rutas(fabrica));
assert.deepEqual(rutas(aplicarOrdenMenu(fabrica, [])), rutas(fabrica));

// Cobranzas debajo de Finanzas... y arriba de todo Presupuestos.
assert.deepEqual(
  rutas(aplicarOrdenMenu(fabrica, ["/presupuestos", "/clientes", "/proveedores", "/cobranzas", "/finanzas"])),
  ["/presupuestos", "/clientes", "/proveedores", "/cobranzas", "/finanzas"],
);

// Pantalla nueva que no estaba en la lista guardada: queda debajo de la que tenía arriba de fábrica.
assert.deepEqual(
  rutas(aplicarOrdenMenu(fabrica, ["/finanzas", "/clientes", "/presupuestos", "/cobranzas"])),
  ["/finanzas", "/clientes", "/proveedores", "/presupuestos", "/cobranzas"],
);
// La primera de fábrica, si falta, va arriba de todo.
assert.deepEqual(rutas(aplicarOrdenMenu(fabrica, ["/finanzas", "/proveedores"])), ["/clientes", "/finanzas", "/cobranzas", "/proveedores", "/presupuestos"]);

// Rutas viejas que ya no existen o repetidas: se ignoran.
assert.deepEqual(rutas(aplicarOrdenMenu(fabrica, ["/vieja", "/finanzas", "/finanzas"])).length, 5);

// ordenValido
assert.equal(ordenValido(null), null);
assert.equal(ordenValido("x"), null);
assert.equal(ordenValido([1, "sin-barra"]), null);
assert.deepEqual(ordenValido(["/a", "/b", "/a", 3]), ["/a", "/b"]);

// moverEnLista
assert.deepEqual(moverEnLista(["a", "b", "c"], 2, -1), ["a", "c", "b"]);
assert.deepEqual(moverEnLista(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
assert.deepEqual(moverEnLista(["a", "b", "c"], 2, 1), ["a", "b", "c"]);

console.log("test-orden-menu: OK");
