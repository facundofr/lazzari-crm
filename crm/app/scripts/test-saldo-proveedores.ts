// npx tsx scripts/test-saldo-proveedores.ts
import assert from "node:assert/strict";
import { calcularSaldosProveedores, ultimaCompraPorProveedor, linkWhatsApp, textoLocalidad } from "../src/lib/saldo-proveedores";

const facturas = [
  { id: "f1", proveedor_id: "A", total: 1000, moneda: "ARS", estado: "pendiente", tipo_comprobante: "FC A", fecha: "2026-01-10",
    op_facturas_compra: [{ monto: 300, ordenes_pago: { estado: "pagada" } }, { monto: 500, ordenes_pago: { estado: "anulada" } }] },
  { id: "f2", proveedor_id: "A", total: 200, moneda: "USD", estado: "pendiente", tipo_comprobante: "FC A", fecha: "2026-02-01" },
  { id: "f3", proveedor_id: "A", total: 999, moneda: "ARS", estado: "anulada", tipo_comprobante: "FC A", fecha: "2026-09-01" },
  { id: "nc1", proveedor_id: "A", total: 150, moneda: "ARS", estado: "recibida", tipo_comprobante: "NC A", fecha: "2026-03-01" },
  { id: "f4", proveedor_id: "B", total: 500, total_acreditado: 100, moneda: "ARS", estado: "pagada", tipo_comprobante: "FC A", fecha: "2025-12-01" },
];
const pagos = [
  { factura_compra_id: "f1", monto: 90, retencion_ganancias_monto: 10 },
  { factura_compra_id: "f1", monto: 1000, anulado: true },
  { factura_compra_id: "f4", monto: 100, nota_credito_compra_id: "ncX" },
  { factura_compra_id: "f4", monto: 400 },
];
const movNC = [{ nota_credito_compra_id: "nc1", monto: 50 }];
const s = calcularSaldosProveedores(facturas, pagos, movNC);
// A ARS: 1000 - 300 (OP) - 100 (pago+ret) = 600; NC disponible 100 → 500
assert.equal(s.A.ARS, 500);
assert.equal(s.A.USD, 200);
// B: 500 - max(100,100) - 400 = 0
assert.equal(s.B.ARS, 0);

const u = ultimaCompraPorProveedor(facturas, [{ proveedor_id: "B", fecha: "2026-05-05T10:00:00", estado: "enviada" }, { proveedor_id: "A", fecha: "2026-12-01", estado: "anulada" }]);
assert.equal(u.A, "2026-02-01");
assert.equal(u.B, "2026-05-05");

assert.equal(linkWhatsApp("011 15-5555-1234"), "https://wa.me/5491155551234");
assert.equal(linkWhatsApp("+54 9 11 5555-1234"), "https://wa.me/5491155551234");
assert.equal(linkWhatsApp("123"), null);
assert.equal(textoLocalidad("CIUDADELA,", ""), "CIUDADELA");
assert.equal(textoLocalidad("", ""), "");
assert.equal(textoLocalidad("Morón", "Buenos Aires"), "Morón, Buenos Aires");
console.log("OK saldo-proveedores");
