// Lista de OC (Compras nueva › OC): estados, terminada, atrasada y texto de Copiar.
// Uso (desde crm/app): npx tsx scripts/test-oc-lista.ts
import assert from "node:assert/strict";
import { estadoOC, ejeFactura, ejePago, ocTerminada, ocAtrasada, descripcionCorta, textoCopiarOC, type OCParaLista } from "../src/lib/oc-lista";

const base = (x: Partial<OCParaLista> = {}): OCParaLista => ({
  numero: "OC-2026-1247", estado: "enviada", pedido: false, total: 1000,
  items: [{ descripcion: "Botín Prusiano PVC negro", cantidad: 20, cantidad_recibida: 0 }, { descripcion: "Guante nitrilo", cantidad: 5, cantidad_recibida: 0 }],
  facturas: [], ...x,
});

assert.equal(estadoOC(base()), "por_enviar");
assert.equal(estadoOC(base({ pedido: true })), "enviada");
assert.equal(estadoOC(base({ pedido: true, items: [{ descripcion: "A", cantidad: 20, cantidad_recibida: 18 }] })), "parcial");
assert.equal(estadoOC(base({ items: [{ descripcion: "A", cantidad: 20, cantidad_recibida: 20 }] })), "completo");
assert.equal(estadoOC(base({ saldo_cerrado: true, items: [{ descripcion: "A", cantidad: 20, cantidad_recibida: 18 }] })), "completo", "cerrada cuenta como Completo");

const completa = base({ items: [{ descripcion: "A", cantidad: 1, cantidad_recibida: 1 }] });
assert.equal(ocTerminada(completa), false, "sin factura no sale de la lista");
const conFc = { ...completa, facturas: [{ estado: "pendiente", total: 1000 }] };
assert.equal(ejeFactura(conFc), "ok");
assert.equal(ejePago(conFc), "falta");
assert.equal(ocTerminada(conFc), false, "facturada sin pagar no sale");
const pagada = { ...completa, facturas: [{ estado: "pagada", total: 1000 }] };
assert.equal(ocTerminada(pagada), true, "llegó + facturada + pagada = Terminada");
assert.equal(ejeFactura({ ...completa, facturas: [{ estado: "anulada", total: 1000 }] }), "falta", "la anulada no cuenta");

assert.equal(ocAtrasada({ ...base({ pedido: true }), fecha_entrega_estimada: "2026-10-10" }, "2026-10-16"), true);
assert.equal(ocAtrasada({ ...base({ pedido: true }), fecha_entrega_estimada: "2026-10-20" }, "2026-10-16"), false);
assert.equal(ocAtrasada({ ...base({ pedido: true }), pedido_at: "2026-10-01T10:00:00Z" }, "2026-10-16"), true);
assert.equal(ocAtrasada({ ...completa, fecha_entrega_estimada: "2026-10-01" }, "2026-10-16"), false, "completa nunca está atrasada");
assert.equal(ocAtrasada({ ...base({ pedido: true }), fecha: "2026-09-20" }, "2026-10-16"), true, "OC vieja sin fecha de pedido: cuenta desde la fecha de la OC");
assert.equal(ocAtrasada({ ...base({ pedido: true }), fecha: "2026-10-14" }, "2026-10-16"), false);

assert.equal(descripcionCorta(base().items), "Botín Prusiano PVC negro (20), Guante nitrilo (5)");
const texto = textoCopiarOC(base(), "Calzados Mariana");
assert.equal(texto, [
  "Proveedor: Calzados Mariana",
  "OC N° OC-2026-1247",
  "",
  "20 × Botín Prusiano PVC negro",
  "5 × Guante nitrilo",
  "",
  "Adjunto OC N° OC-2026-1247. Por favor, en el remito y en la factura (si es posible), indicar el número o los números de OC correspondientes a ese remito / factura.",
].join("\n"));
assert.ok(!/\$/.test(texto), "sin precios");

console.log("OK: lista de OC (4 estados, cerrada = Completo, Terminada = llegó + facturada + pagada, atrasada, Copiar sin precios).");
