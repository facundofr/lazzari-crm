import assert from "node:assert/strict";
import { linkFinanzas, linkFactura, traducirLinkViejo, esSeccionLazza } from "../src/lib/finanzas-destino";

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
console.log("test-finanzas-destino OK");
