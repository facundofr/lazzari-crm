// npx tsx scripts/test-saldo-proveedores.ts
import assert from "node:assert/strict";
import { calcularSaldosProveedores, creditosProveedor, pagosSobreFacturasAnuladas, traerCreditosProveedores, ultimaCompraPorProveedor, linkWhatsApp, textoLocalidad } from "../src/lib/saldo-proveedores";
import { sentidoAjuste } from "../src/lib/tipos-movimiento";

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

// Créditos a favor (B5): saldo a favor de OP, OP sin facturas (anticipo), ajustes y pagos sobre facturas anuladas
const creditos = creditosProveedor(
  [{ proveedor_id: "A", moneda: "ARS", saldo: 50, estado: "disponible" }, { proveedor_id: "A", moneda: "ARS", saldo: 999, estado: "aplicado" }],
  [
    { id: "op1", proveedor_id: "B", moneda: "ARS", monto_bruto: 500000, estado: "pagada", op_facturas_compra: [] },
    { id: "op2", proveedor_id: "B", moneda: "ARS", monto_bruto: 700, estado: "anulada", op_facturas_compra: [] },
    { id: "op3", proveedor_id: "B", moneda: "ARS", monto_bruto: 300, estado: "pagada", op_facturas_compra: [{}] },
  ],
  [
    { proveedor_id: "A", moneda: "USD", monto: 30, ajuste_sentido: "credito" }, // a favor del proveedor: le debemos más
    { proveedor_id: "A", moneda: "ARS", monto: 10, ajuste_sentido: "debito" },  // cargo al proveedor: le debemos menos
    { proveedor_id: "A", moneda: "ARS", monto: 10, ajuste_sentido: "debito", anulado: true },
  ],
);
assert.equal(creditos.length, 4);
const facturasConAnulada = [
  ...facturas,
  { id: "f5", proveedor_id: "C", total: 800, moneda: "ARS", estado: "anulada", tipo_comprobante: "FC A", fecha: "2026-04-01",
    op_facturas_compra: [{ monto: 800, ordenes_pago: { estado: "pagada" } }] },
];
const s2 = calcularSaldosProveedores(facturasConAnulada, pagos, movNC, creditos);
assert.equal(s2.A.ARS, 500 - 50 - 10);
assert.equal(s2.A.USD, 200 + 30);
assert.equal(s2.B.ARS, -500000); // anticipo de $500 k: queda a favor
assert.equal(s2.C.ARS, -800);    // pago sobre factura anulada: queda a favor
// Sin créditos el resultado es el de antes
assert.deepEqual(calcularSaldosProveedores(facturas, pagos, movNC), s);

// Detalle de pagos sobre facturas anuladas (mismo número que resta el saldo)
const anuladas = pagosSobreFacturasAnuladas(facturasConAnulada, pagos);
assert.equal(anuladas.length, 1);
assert.equal(anuladas[0].proveedor_id, "C");
assert.equal(anuladas[0].monto, 800);

// Carga desde la base (fake): ajuste viejo "[Ajuste manual]" tipo pago = débito (le debemos menos)
const tablas: Record<string, any[]> = {
  saldos_favor_proveedor: [{ proveedor_id: "A", moneda: "ARS", saldo: 50, estado: "disponible" }],
  ordenes_pago: [{ id: "op9", proveedor_id: "B", moneda: "ARS", monto_bruto: 100, estado: "pagada", op_facturas_compra: [] }],
  movimientos: [{ proveedor_id: "A", moneda: "ARS", monto: 7, tipo: "pago", descripcion: "[Ajuste manual] redondeo" }],
};
const fakeDb = { from: (t: string) => { const q: any = { select: () => q, eq: () => q, neq: () => q, not: () => q, or: () => q, order: () => q, range: async () => ({ data: tablas[t], error: null }) }; return q; } };
const traerFake = async <T,>(armar: () => any): Promise<T[]> => (await armar().range(0, 999)).data as T[];
traerCreditosProveedores(fakeDb, "soc", traerFake, sentidoAjuste).then((cargados) => {
  assert.deepEqual(cargados.map((c) => [c.proveedor_id, c.monto]), [["A", 50], ["B", 100], ["A", 7]]);
  console.log("OK carga de créditos de proveedores");
}).catch((e) => { console.error(e); process.exit(1); });

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
