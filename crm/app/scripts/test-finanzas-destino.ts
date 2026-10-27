import assert from "node:assert/strict";
import { linkFinanzas, linkFactura, linkDeAlertaFinanzas, traducirLinkViejo, esSeccionLazza } from "../src/lib/finanzas-destino";

assert.equal(linkFinanzas(), "/finanzas");
assert.equal(linkFinanzas("gastos_fijos"), "/finanzas?seccion=gastos");
assert.equal(linkFinanzas("facturas_compra"), "/finanzas?seccion=pagar");
assert.equal(linkFinanzas("cc_clientes"), "/finanzas?seccion=cuentas");
// Lo que Lazza no tiene sigue en la vieja
assert.equal(linkFinanzas("extractos"), "/finanzas-vieja?tab=extractos");
assert.equal(linkFinanzas("revisar"), "/finanzas-vieja?tab=revisar");
assert.equal(linkFinanzas("correo"), "/finanzas-vieja?tab=correo");
assert.equal(linkFactura("abc"), "/facturacion?factura=abc");
assert.equal(linkFactura("abc", "nc"), "/facturacion?factura=abc&accion=nc");

const p = (s: string) => new URLSearchParams(s);
assert.equal(traducirLinkViejo(p("tab=objetivos")), "/finanzas?seccion=objetivos");
assert.equal(traducirLinkViejo(p("tab=facturacion&grupo=cobrar&factura=F1&accion=cobro")), "/facturacion?factura=F1&accion=cobro");
assert.equal(traducirLinkViejo(p("factura=F2")), "/facturacion?factura=F2");
assert.equal(traducirLinkViejo(p("tab=extractos")), "/finanzas-vieja?tab=extractos");
assert.equal(traducirLinkViejo(p("")), null);
assert.equal(traducirLinkViejo(p("seccion=iva")), null);
assert.equal(esSeccionLazza("iva"), true);
assert.equal(esSeccionLazza("x"), false);
// Atajos nuevos (arreglo 8, 27/10/2026): Facturar, Movimientos del banco y Objetivos (sin tarjeta) siguen abriendo por link
assert.equal(esSeccionLazza("facturar"), true);
assert.equal(esSeccionLazza("movimientos_banco"), true);
assert.equal(esSeccionLazza("objetivos"), true);
// La campana abre el ítem
assert.equal(linkDeAlertaFinanzas("cliente", "abc-1"), "/finanzas?seccion=cuentas&cliente=abc-1");
assert.equal(linkDeAlertaFinanzas("cliente", null), "/finanzas?seccion=cuentas");
assert.equal(linkDeAlertaFinanzas("echeq_tercero", "x"), "/finanzas?seccion=cheques");
assert.equal(linkDeAlertaFinanzas("finanzas_revisar", "x"), "/finanzas-vieja?tab=revisar");
assert.equal(linkDeAlertaFinanzas("otra_cosa", "x"), "/finanzas", "un aviso que no conocemos va al inicio, como antes");
assert.equal(linkDeAlertaFinanzas(null, null), "/finanzas");
console.log("test-finanzas-destino OK");
