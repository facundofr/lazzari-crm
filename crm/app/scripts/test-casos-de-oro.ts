// npx tsx scripts/test-casos-de-oro.ts
// P24 (auditoría 02/11/2026): "casos de oro". Las cuentas de plata que existen en más de un lugar tienen que dar lo mismo con el
// mismo caso. Si alguien cambia una copia y no la otra, el build se frena acá (está en scripts/test-lib.mjs).
//  - Lo cobrado de una factura de venta: cobradoPorFactura (lo que se MUESTRA: Finanzas, Cuentas corrientes, asistente) y
//    cobradoParaCobrar (lo que se VALIDA al cobrar en Facturación y en la NC: fetchCobradoMap).
//  - Saldo de factura de compra: finanzas-lazza (Finanzas, Vencimientos, asistente), saldo-proveedores (Cuentas corrientes de
//    proveedores) y saldo-factura-compra (la regla escrita igual que la base, fc_compra_pagado).
//  - Vencimiento de una factura de venta: Finanzas / Inicio (armarVencimientos) y Cobranzas (venceFactura).
//  - Redondeo de importes x,xx5.
import assert from "node:assert/strict";
import { calcularSaldosClientes, cobradoParaCobrar, cobradoPorFactura, saldoFacturaVenta, type FacturaCC } from "../src/lib/saldo-clientes";
import { armarVencimientos, saldoFacturaCompra as saldoCompraFinanzas, type FacturaCompraFL, type PagoDirectoFC } from "../src/lib/finanzas-lazza";
import { calcularSaldosProveedores } from "../src/lib/saldo-proveedores";
import { saldoFacturaCompra as saldoCompraRegla } from "../src/lib/saldo-factura-compra";
import { venceFactura } from "../src/lib/avisos-cobranza";

const cerca = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} ≠ ${b}`);

// ── 1. Lo cobrado de una factura de venta ──
const factura = (x: Partial<FacturaCC>): FacturaCC => ({ id: "F1", cliente_id: "C1", tipo: "FA", total: 1000, total_acreditado: 0, moneda: "ARS", estado: "emitida", ...x });
const apl = (movimiento_id: string, factura_id: string, monto: number, anulado = false) => ({ movimiento_id, factura_id, monto, movimientos: { anulado } });

{ // Cobro parcial + uno anulado + uno por aplicación (que también trae factura_id: no se cuenta dos veces).
  const f = factura({});
  const directos = [
    { id: "m1", factura_id: "F1", monto: 300, moneda: "ARS", anulado: false },
    { id: "m2", factura_id: "F1", monto: 200, moneda: "ARS", anulado: true },
    { id: "m3", factura_id: "F1", monto: 100, moneda: "ARS", anulado: false },
  ];
  const apls = [apl("m3", "F1", 100), apl("m4", "F1", 50, true)];
  const muestra = cobradoPorFactura([f], directos, apls).F1;
  const valida = cobradoParaCobrar([{ id: "F1", moneda: "ARS" }], directos, apls).F1;
  assert.equal(muestra, 400);
  cerca(valida, muestra, "cobro parcial y anulado: las dos copias de lo cobrado");
  assert.equal(saldoFacturaVenta(f, muestra), 600);
}

{ // Decimales que suman feo (0,1 + 0,2): muestra redondeado; la que valida no redondea, pero da lo mismo al centavo.
  const directos = [{ id: "a", factura_id: "F1", monto: 0.1, moneda: "ARS" }, { id: "b", factura_id: "F1", monto: 0.2, moneda: "ARS" }];
  cerca(cobradoParaCobrar([{ id: "F1", moneda: "ARS" }], directos, []).F1, cobradoPorFactura([factura({})], directos, []).F1, "0,1 + 0,2");
}

{ // Cobro en otra moneda sin aplicación: lo que muestra lo ignora (no mezcla monedas); lo que valida frena el cobro.
  const f = factura({ moneda: "USD", total: 500 });
  const directos = [{ id: "m1", factura_id: "F1", monto: 1000, moneda: "ARS", anulado: false }];
  assert.equal(cobradoPorFactura([f], directos, []).F1 ?? 0, 0);
  assert.throws(() => cobradoParaCobrar([{ id: "F1", moneda: "USD" }], directos, []), /otra moneda/);
  // Con su aplicación (el cobro en US$ de verdad), las dos cuentan la aplicación en la moneda de la factura.
  const apls = [apl("m9", "F1", 200)];
  assert.equal(cobradoPorFactura([f], [], apls).F1, 200);
  assert.equal(cobradoParaCobrar([{ id: "F1", moneda: "USD" }], [], apls).F1, 200);
}

{ // NC con sobrante: la factura queda en 0 (nunca negativa) y lo que sobra es a favor del cliente.
  const f = factura({ total: 1000, total_acreditado: 1000 });
  const nc = factura({ id: "NC1", tipo: "NCA", total: 1200, factura_origen_id: "F1", saldo_a_favor_cliente: 200 });
  assert.equal(saldoFacturaVenta(f, 0), 0);
  assert.equal(saldoFacturaVenta(nc, 0), 0, "una NC no es deuda");
  const s = calcularSaldosClientes([f, nc], [], []).C1.ARS;
  assert.deepEqual(s, { deuda: 0, aFavor: 200, saldo: -200 });
}

// ── 2. Saldo de factura de compra: las tres copias ──
type CasoCompra = { nombre: string; total: number; acreditado: number; ops: { monto: number; anulada?: boolean }[]; pagos: PagoDirectoFC[]; esperado: number };
const casosCompra: CasoCompra[] = [
  { nombre: "pago parcial por OP", total: 1000, acreditado: 0, ops: [{ monto: 400 }], pagos: [], esperado: 600 },
  { nombre: "OP anulada no cuenta", total: 1000, acreditado: 0, ops: [{ monto: 400, anulada: true }], pagos: [], esperado: 1000 },
  { nombre: "pago directo con retención", total: 1000, acreditado: 0, ops: [], pagos: [{ factura_compra_id: "FC1", monto: 490, retencion_ganancias_monto: 10 }], esperado: 500 },
  { nombre: "pago directo anulado no cuenta", total: 1000, acreditado: 0, ops: [], pagos: [{ factura_compra_id: "FC1", monto: 500, anulado: true }], esperado: 1000 },
  { nombre: "NC con dos rastros: se toma el mayor, no la suma", total: 1000, acreditado: 300, ops: [], pagos: [{ factura_compra_id: "FC1", monto: 300, nota_credito_compra_id: "NC1" }], esperado: 700 },
  { nombre: "NC con sobrante: nunca negativo", total: 1000, acreditado: 1200, ops: [], pagos: [], esperado: 0 },
  { nombre: "pagada de más: nunca negativo", total: 804129.86, acreditado: 0, ops: [{ monto: 1023677.92 }], pagos: [], esperado: 0 },
  // Sin un caso de pago con 3 decimales (ej. 333,335): la base guarda los importes con 2 decimales, no puede existir. El x,xx5 va en la sección 4.
];
for (const c of casosCompra) {
  const fl: FacturaCompraFL = {
    id: "FC1", fecha: "2026-10-01", tipo_comprobante: "FC A", estado: "pendiente", moneda: "ARS", iva: 0, total: c.total, total_acreditado: c.acreditado, proveedor_id: "P1",
    op_facturas_compra: c.ops.map((o) => ({ monto: o.monto, ordenes_pago: { estado: o.anulada ? "anulada" : "pagada" } })),
  };
  const finanzas = saldoCompraFinanzas(fl, c.pagos);
  const proveedores = calcularSaldosProveedores([fl as any], c.pagos as any, []).P1.ARS;
  const vigentes = c.pagos.filter((p) => !p.anulado);
  const regla = saldoCompraRegla({
    total: c.total, total_acreditado: c.acreditado,
    pago_op: c.ops.filter((o) => !o.anulada).reduce((s, o) => s + o.monto, 0),
    pago_directo: vigentes.filter((p) => !p.nota_credito_compra_id).reduce((s, p) => s + Number(p.monto) + Number(p.retencion_ganancias_monto || 0), 0),
    credito_nc_movimientos: vigentes.filter((p) => p.nota_credito_compra_id).reduce((s, p) => s + Number(p.monto), 0),
  });
  assert.equal(finanzas, c.esperado, `Finanzas · ${c.nombre}`);
  cerca(proveedores, c.esperado, `Cuentas corrientes · ${c.nombre}`);
  assert.equal(regla, c.esperado, `regla de la base · ${c.nombre}`);
}

// ── 3. Vencimiento de una factura de venta ──
{
  const hoy = "2026-11-02";
  const fv = (fecha_vencimiento: string | null) => ({ id: "F1", fecha: "2026-10-01", fecha_vencimiento, tipo: "FA", punto_venta: 15, numero: 1, total: 1000, moneda: "ARS", estado: "emitida", cliente_id: "C1", cliente: "Corteva" } as any);
  const venceFinanzas = (f: any) => armarVencimientos({ hoy, ventas: [f], saldoVenta: () => 1000, compras: [], pagosDirectos: [] })[0].vence;
  // Con vencimiento: todas usan el de la factura.
  assert.equal(venceFinanzas(fv("2026-10-20")), "2026-10-20");
  assert.equal(venceFactura({ fecha: "2026-10-01", fechaVencimiento: "2026-10-20" }, 30), "2026-10-20");
  // Sin vencimiento y sin días de cuenta corriente: las dos dan la fecha de la factura.
  assert.equal(venceFinanzas(fv(null)), "2026-10-01");
  assert.equal(venceFactura({ fecha: "2026-10-01", fechaVencimiento: null }, 0), "2026-10-01");
  // Sin vencimiento CON días de cuenta corriente: hoy difieren a propósito (Cobranzas suma los días del cliente; Finanzas e
  // Inicio usan la fecha). Unificarlas es una decisión de Augusto (auditoría D12): si alguien cambia una, este caso lo marca.
  assert.equal(venceFactura({ fecha: "2026-10-01", fechaVencimiento: null }, 30), "2026-10-31");
  assert.equal(venceFinanzas(fv(null)), "2026-10-01");
}

// ── 4. Redondeo x,xx5: las cuentas de saldo redondean para arriba (con EPSILON) ──
{
  assert.equal(saldoFacturaVenta(factura({ total: 1.005 }), 0), 1.01, "venta");
  assert.equal(saldoFacturaVenta(factura({ total: 1000.005 }), 0), 1000.01, "venta");
  assert.equal(saldoCompraRegla({ total: 1.005 }), 1.01, "compra, regla de la base");
  assert.equal(saldoCompraFinanzas({ id: "X", fecha: "2026-10-01", tipo_comprobante: "FC A", estado: "pendiente", moneda: "ARS", iva: 0, total: 1.005 }, []), 1.01, "compra, Finanzas");
}

console.log("test-casos-de-oro OK");
