// Condición de pago leída de la factura (casos reales 16/10). Uso: npx tsx scripts/test-condicion-desde-factura.ts
import assert from "node:assert/strict";
import { condicionDesdeFactura } from "../src/lib/condicion-pago";
assert.deepEqual(condicionDesdeFactura("Cond. Vta.: 10 DIAS FECHA FACTURA CONTRA ENTREGA - Cuenta Corriente", "2026-10-16", "2026-10-26"), { condicion_pago: "cuenta_corriente", dias_pago: 10 });
assert.deepEqual(condicionDesdeFactura("Condiciones de venta: Cuenta Corriente. Fec. de Venc. Pago: 15/10/2026", "2026-10-15", "2026-10-15"), { condicion_pago: "contra_entrega", dias_pago: 0 });
assert.deepEqual(condicionDesdeFactura("Cuenta corriente", "2026-10-01", "2026-10-31"), { condicion_pago: "cuenta_corriente", dias_pago: 30 });
assert.deepEqual(condicionDesdeFactura("CONTADO"), { condicion_pago: "contra_entrega", dias_pago: 0 });
assert.equal(condicionDesdeFactura("Remito 0001-35113"), null);
assert.equal(condicionDesdeFactura(""), null);
console.log("OK: condición de pago desde la factura");
