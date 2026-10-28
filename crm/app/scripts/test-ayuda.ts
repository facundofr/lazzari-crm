// Prueba de la Ayuda sin IA (lib/ayuda-busqueda.ts). Uso (desde crm/app): npx tsx scripts/test-ayuda.ts
import assert from "node:assert/strict";
import { GUIA_SECCIONES } from "../src/lib/asistente-guia-datos";
import { buscarEnGuia, seccionesParaRol, seccionesDePantalla, palabrasClave, guiaComoTexto, rolPuedeVer } from "../src/lib/ayuda-busqueda";

const admin = seccionesParaRol("super_admin");
const vendedor = seccionesParaRol("vendedor");
assert.equal(admin.length, GUIA_SECCIONES.length, "super_admin ve todo");
assert.ok(vendedor.length < admin.length, "vendedor ve menos");
assert.ok(!vendedor.some((s) => s.ruta === "/finanzas"), "vendedor no ve Finanzas");
assert.ok(vendedor.some((s) => s.ruta === "/presupuestos"));
assert.ok(rolPuedeVer("vendedor", null));

const top = (q: string, secs = admin) => buscarEnGuia(q, secs)[0]?.seccion.titulo;
assert.equal(top("¿cómo hago una orden de pago?"), "Pagar → Órdenes de pago");
assert.equal(top("cómo cargo una NC"), "Cobrar → Facturas de venta (Facturación ARCA)");
assert.match(top("cargar nota de crédito del proveedor")!, /Compras Lazza: facturas del proveedor/);
assert.match(top("cargar factura de proveedor con QR")!, /Compras Lazza: facturas del proveedor/);
assert.equal(top("rechazar un cheque"), "Cheques y créditos → Cheques");
// La sección Muestras se sacó de la Ayuda (V1.1.560, pedido de Augusto): ya no tiene que aparecer.
assert.ok(!GUIA_SECCIONES.some((s) => s.titulo === "Muestras"), "Muestras no está en la Ayuda");
assert.match(top("envío interno del presupuesto")!, /Presupuestos/);
assert.ok(!buscarEnGuia("orden de pago retenciones", vendedor).some((r) => r.seccion.ruta === "/finanzas"), "al vendedor no le muestra Finanzas");
assert.deepEqual(buscarEnGuia("de la que", admin), [], "solo palabras vacías: nada");
assert.ok(palabrasClave("OP").includes("orden de pago"));

const pagos = seccionesDePantalla("/finanzas", admin, "Órdenes de pago");
assert.equal(pagos[0]?.titulo, "Pagar → Órdenes de pago");
assert.ok(seccionesDePantalla("/finanzas", admin, null).length > 5);
assert.equal(seccionesDePantalla("/presupuestos/123", admin)[0]?.titulo, "Presupuestos");

const texto = guiaComoTexto(vendedor);
assert.ok(texto.includes("### Presupuestos (/presupuestos)") && !texto.includes("Órdenes de pago\n"));

for (const q of ["como hago una orden de pago", "nota de credito", "cargar factura proveedor", "cheque rechazado", "presupuesto whatsapp", "gastos fijos"]) {
  console.log(q.padEnd(28), "→", buscarEnGuia(q, admin).slice(0, 3).map((r) => r.seccion.titulo).join(" | "));
}
console.log("test-ayuda OK");
