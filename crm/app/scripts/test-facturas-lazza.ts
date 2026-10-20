// npx tsx scripts/test-facturas-lazza.ts
import assert from "node:assert/strict";
import { armarFilasFacturas, chequesSinAcreditarPorFactura, estadoFactura, etiquetaEstado, facturadoDelMes, iniciales, resumenVencimientos, filtrarFacturas, prepararSeleccion, recibosPorFactura, totalesFacturas, type FacturaBase } from "../src/lib/facturas-lazza";

const hoy = "2026-10-19";
const base = (x: Partial<FacturaBase> & { id: string }): FacturaBase => ({
  entidadId: "p1", nombre: "De Pascale", fecha: "2026-10-01", fecha_vencimiento: "2026-10-31", comprobante: `FC ${x.id}`,
  moneda: "ARS", total: 1000, estado: "pendiente", nc: false, saldo: 1000, ...x,
});

// Estados
assert.deepEqual(estadoFactura({ anulada: true, nc: false, total: 100, saldo: 100, dias: -5 }), { estado: "anulada", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: true, total: 100, saldo: 0, dias: 5 }), { estado: "nc", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 0, dias: -5 }), { estado: "pagada", parcial: false });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 40, dias: -1 }), { estado: "vencida", parcial: true });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 40, dias: 3 }), { estado: "parcial", parcial: true });
assert.deepEqual(estadoFactura({ anulada: false, nc: false, total: 100, saldo: 100, dias: 0 }), { estado: "pendiente", parcial: false });

const filas = armarFilasFacturas({
  lado: "compra", hoy,
  facturas: [
    base({ id: "a", fecha_vencimiento: "2026-10-30" }),
    base({ id: "b", fecha_vencimiento: "2026-09-17", saldo: 400 }), // vencida parcial
    base({ id: "c", saldo: 0, fecha: "2026-09-01" }), // pagada
    base({ id: "d", estado: "anulada", saldo: 1000, fecha: "2026-10-05" }), // anulada: saldo 0
    base({ id: "e", entidadId: "p2", nombre: "Segufer", moneda: "USD", total: 50, saldo: 50, fecha_vencimiento: null, fecha: "2026-10-10" }),
    base({ id: "f", entidadId: "p2", nombre: "Segufer", fecha_vencimiento: "2026-10-20" }),
  ],
  docs: new Map([["b", [{ tipo: "op", id: "op72", numero: "OP-000072" }]]]),
});

// Orden: con saldo por vencimiento, después el resto de la más nueva a la más vieja.
assert.deepEqual(filas.map((f) => f.id), ["b", "e", "f", "a", "d", "c"]);
const b = filas.find((f) => f.id === "b")!;
assert.equal(b.estado, "vencida"); assert.equal(b.parcial, true); assert.equal(b.dias, -32); assert.equal(b.docs[0].numero, "OP-000072");
const e = filas.find((f) => f.id === "e")!;
assert.equal(e.sinVencimiento, true); assert.equal(e.vence, "2026-10-10"); assert.equal(e.moneda, "USD");
assert.equal(filas.find((f) => f.id === "d")!.saldo, 0);

// Filtros
assert.deepEqual(filtrarFacturas(filas, { filtro: "pendientes" }).map((f) => f.id), ["b", "e", "f", "a"]);
assert.deepEqual(filtrarFacturas(filas, { filtro: "vencidas" }).map((f) => f.id), ["b", "e"]);
assert.equal(filtrarFacturas(filas, { filtro: "todas" }).length, 6);
assert.deepEqual(filtrarFacturas(filas, { filtro: "todas", texto: "op-000072" }).map((f) => f.id), ["b"]);
assert.deepEqual(filtrarFacturas(filas, { filtro: "pendientes", texto: "segufer" }).map((f) => f.id), ["e", "f"]);

// Totales: solo lo que tiene saldo
const t = totalesFacturas(filas);
assert.deepEqual(t.saldo, { ARS: 2400, USD: 50 });
assert.deepEqual(t.vencido, { ARS: 400, USD: 50 });

// Selección: un proveedor y una moneda, se sigue con el primero tildado y se avisa
const por = (id: string) => filas.find((f) => f.id === id)!;
const s1 = prepararSeleccion([por("a"), por("b")], "compra")!;
assert.deepEqual(s1.ids, ["a", "b"]); assert.equal(s1.saldo, 1400); assert.equal(s1.avisos.length, 0);
const s2 = prepararSeleccion([por("a"), por("f")], "compra")!;
assert.deepEqual(s2.ids, ["a"]); assert.match(s2.avisos[0], /Una OP es de un solo proveedor/);
const s3 = prepararSeleccion([por("f"), por("e")], "venta")!;
assert.deepEqual(s3.ids, ["f"]); assert.match(s3.avisos[0], /\$ y en US\$/);
assert.equal(prepararSeleccion([por("c"), por("d")], "compra"), null); // sin saldo: nada para pagar

// Recibos por factura (sin anulados)
const m = recibosPorFactura([
  { id: "r1", numero: 1000, anulado: false, facturaIds: ["x", "y"] },
  { id: "r2", numero: 1005, anulado: false, facturaIds: ["x"] },
  { id: "r3", numero: 1006, anulado: true, facturaIds: ["x"] },
]);
assert.deepEqual(m.get("x")!.map((d) => d.numero), ["Recibo 1005", "Recibo 1000"]);
assert.deepEqual(m.get("y")!.map((d) => d.id), ["r1"]);

// Cheque sin acreditar (Augusto 20/10): la factura cobrada con cheque no dice "Cobrada" hasta que el cheque se cobre.
{
  const cheques = [
    { movimiento_id: "m131", estado: "depositado", numero: "00000131", fecha_deposito: "2026-10-16" },
    { movimiento_id: "mC", estado: "en_cartera", numero: "500" },
    { movimiento_id: "mD", estado: "depositado", numero: "501", fecha_deposito: "2026-10-18" },
    { movimiento_id: "mOk", estado: "cobrado", numero: "502" },
    { movimiento_id: "mAnu", estado: "en_cartera", numero: "503" },
  ];
  const movs = [{ id: "m131", factura_id: "f19" }, { id: "mOk", factura_id: "fok" }, { id: "mAnu", factura_id: "fanu", anulado: true }];
  const aps = [{ movimiento_id: "mC", factura_id: "fx" }, { movimiento_id: "mD", factura_id: "fx" }];
  const ch = chequesSinAcreditarPorFactura(cheques, movs, aps);
  assert.deepEqual(ch.get("f19"), { estado: "depositado", fecha: "2026-10-16", numero: "131" });
  assert.equal(ch.get("fx")!.estado, "cartera", "con dos cheques, el más atrasado");
  assert.equal(ch.has("fok"), false, "cheque cobrado = Cobrada");
  assert.equal(ch.has("fanu"), false, "cobro anulado no cuenta");
  const filas = armarFilasFacturas({ lado: "venta", hoy, cheques: ch, facturas: [base({ id: "f19", saldo: 0 }), base({ id: "fok", saldo: 0 }), base({ id: "fx", saldo: 400 })] });
  const e = (id: string) => filas.find((f) => f.id === id)!.estado;
  assert.equal(e("f19"), "cheque_depositado");
  assert.equal(etiquetaEstado(e("f19"), "venta"), "Cheque depositado");
  assert.equal(e("fok"), "pagada");
  assert.equal(e("fx"), "parcial", "con saldo sigue como siempre aunque tenga un cheque");
  assert.equal(filtrarFacturas(filas, { filtro: "pendientes" }).some((f) => f.id === "f19"), false, "el saldo no cambia");
}

// Facturado del mes en $ (Augusto 20/10): facturas con CAE − NC; US$ × cotización; X aparte; sin cotización se avisa.
{
  const m = facturadoDelMes([
    { tipo: "FA", subtotal: 1000, iva: 210, total: 1210, moneda: "ARS", cae: "1" },
    { tipo: "FA", subtotal: 10, iva: 2.1, total: 12.1, moneda: "USD", tipo_cambio: 1500, cae: "2" },
    { tipo: "NCA", subtotal: 100, iva: 21, total: 121, moneda: "ARS", cae: "3" },
    { tipo: "X", subtotal: 500, iva: 0, total: 500, moneda: "ARS", cae: null },
    { tipo: "FA", subtotal: 5, iva: 1.05, total: 6.05, moneda: "USD", tipo_cambio: null, cae: "4" },
  ]);
  assert.deepEqual(m, { neto: 15900, iva: 3339, total: 19239, facturas: 2, nc: 1, sinTC: 1, x: { cantidad: 1, total: 500 } });
}
// Vencidas y por vencer (7 días), con saldo.
{
  const filas = armarFilasFacturas({ lado: "venta", hoy, facturas: [
    base({ id: "v1", fecha_vencimiento: "2026-10-10", saldo: 100 }),
    base({ id: "v2", fecha_vencimiento: "2026-10-18", saldo: 50, moneda: "USD" }),
    base({ id: "p1", fecha_vencimiento: "2026-10-19", saldo: 30 }),
    base({ id: "p2", fecha_vencimiento: "2026-10-26", saldo: 20 }),
    base({ id: "lejos", fecha_vencimiento: "2026-10-27", saldo: 10 }),
    base({ id: "cob", fecha_vencimiento: "2026-10-10", saldo: 0 }),
  ] });
  const r = resumenVencimientos(filas);
  assert.deepEqual(r.vencidas, { cantidad: 2, monto: { ARS: 100, USD: 50 } });
  assert.deepEqual(r.porVencer, { cantidad: 2, monto: { ARS: 50, USD: 0 } });
  assert.deepEqual(filtrarFacturas(filas, { filtro: "por_vencer" }).map((f) => f.id).sort(), ["p1", "p2"]);
  assert.equal(filas.find((f) => f.id === "v1")!.neto, 1000, "sin neto cargado: el total");
}
assert.equal(iniciales("Augusto Lazzari"), "AL");
assert.equal(iniciales("jeronimo"), "J");
assert.equal(iniciales(""), "");

console.log("test-facturas-lazza OK");
