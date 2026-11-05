import assert from "node:assert/strict";
import { avisosDePaso, baseDelCertificado, facturasDeOrdenPago, numerosDeOrdenPago, repartirSinImportes, type FilaFacturaOP } from "../src/lib/cobro-orden-pago";
import { buildOrdenPagoPlan } from "../src/lib/orden-pago-plan";

const fila = (x: Partial<FilaFacturaOP> & { id: string }): FilaFacturaOP => ({ tipo: "FA", punto_venta: 15, numero: 11, fecha: "2026-09-07", estado: "pendiente", moneda: "ARS", subtotal: 1000, iva: 210, total: 1210, total_acreditado: 0, ...x });
const op = (...f: Array<{ tipo?: string; punto_venta?: number; numero?: number; comprobante?: string }>) => ({ facturas_pagadas: f });

// Números a buscar: sin NC, sin repetir
assert.deepEqual(numerosDeOrdenPago(op({ tipo: "FA", punto_venta: 15, numero: 11 }, { tipo: "FA", punto_venta: 15, numero: 14 }, { tipo: "NCA", punto_venta: 15, numero: 3 }, { tipo: "FA", punto_venta: 15, numero: 11 })), [11, 14]);

// Pesos y dólares separados; la cobrada y la que no está se avisan
{
  const r = facturasDeOrdenPago(
    op({ tipo: "FA", punto_venta: 15, numero: 11 }, { tipo: "FA", punto_venta: 16, numero: 8 }, { tipo: "FA", punto_venta: 15, numero: 14 }, { tipo: "FA", punto_venta: 15, numero: 99 }),
    [
      fila({ id: "a", numero: 11 }),
      fila({ id: "b", punto_venta: 16, numero: 8, moneda: "USD", total: 500, subtotal: 413.22, tipo_cambio: 1500 }),
      fila({ id: "c", numero: 14 }), // ya cobrada
    ],
    { c: 1210 },
  );
  assert.equal(r.sinDetalle, false);
  assert.deepEqual(r.ars.map((f) => [f.id, f.numero, f.saldo]), [["a", "FA 0015-00000011", 1210]]);
  assert.deepEqual(r.usd.map((f) => [f.id, f.numero, f.saldo, f.cotizacion]), [["b", "FA 0016-00000008", 500, 1500]]);
  assert.equal(r.avisos.length, 2);
  assert.ok(r.avisos.some((a) => a.includes("FA 0015-00000014") && a.includes("ya figura cobrada")));
  assert.ok(r.avisos.some((a) => a.includes("15-99") && a.includes("no está en el sistema")));
}

// Cobro parcial anterior: el saldo es lo que falta
assert.equal(facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }), [fila({ id: "a" })], { a: 200 }).ars[0].saldo, 1010);

// Una NC con el mismo número no se toma; una anulada tampoco
{
  const r = facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }), [fila({ id: "nc", tipo: "NCA" }), fila({ id: "x", estado: "anulada" })], {});
  assert.equal(r.ars.length + r.usd.length, 0);
  assert.equal(r.avisos.length, 1);
}

// Dos facturas con el mismo número: elige la letra que dice la OP
{
  const r = facturasDeOrdenPago(op({ tipo: "FB", punto_venta: 15, numero: 11 }), [fila({ id: "fa", tipo: "FA" }), fila({ id: "fb", tipo: "FB" })], {});
  assert.deepEqual(r.ars.map((f) => f.id), ["fb"]);
}

// La OP nombra dos veces la misma factura: se cobra una sola
assert.equal(facturasDeOrdenPago(op({ punto_venta: 15, numero: 11 }, { punto_venta: 15, numero: 11 }), [fila({ id: "a" })], {}).ars.length, 1);

// OP sin detalle de facturas
assert.equal(facturasDeOrdenPago({ facturas_pagadas: [] }, [], {}).sinDetalle, true);
assert.equal(facturasDeOrdenPago({}, [], {}).sinDetalle, true);

// Avisos del paso a paso
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [{} as never], avisos: ["x"] }, "ars"), ["Paso 1 de 2: facturas en pesos. Al confirmar se abre el cobro de las facturas en dólares.", "x"]);
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [{} as never], avisos: [] }, "usd"), ["Paso 2 de 2: facturas en dólares."]);
assert.deepEqual(avisosDePaso({ ars: [{} as never], usd: [], avisos: ["y"] }, "ars"), ["y"], "con un solo paso no hay «paso»");

// Certificado de retenciones de Corteva (05/11/2026): 7 facturas en $ y US$ sin importe por factura.
// Antes cada paso cargaba las 2 retenciones enteras; ahora cada uno lleva su parte.
{
  const ars = [
    { id: "49", numero: "FA 0015-00000049", fecha: "2026-10-05", subtotal: 661185, iva: 138848.85, total: 800033.85, total_acreditado: 0, saldo: 800033.85, moneda: "ARS" as const },
    { id: "47", numero: "FA 0015-00000047", fecha: "2026-10-02", subtotal: 3628378.5, iva: 761959.49, total: 4390337.99, total_acreditado: 0, saldo: 4390337.99, moneda: "ARS" as const },
    { id: "48", numero: "FA 0015-00000048", fecha: "2026-10-02", subtotal: 97459.6, iva: 20466.52, total: 117926.12, total_acreditado: 0, saldo: 117926.12, moneda: "ARS" as const },
  ];
  const usd = [
    { id: "50", numero: "FA 0015-00000050", saldo: 365.15, total: 365.15, subtotal: 301.78, cotizacion: 1520 },
    { id: "4", numero: "FCEA 0015-00000004", saldo: 4969.47, total: 4969.47, subtotal: 4107, cotizacion: 1517 },
    { id: "41", numero: "FA 0015-00000041", saldo: 2778.16, total: 2778.16, subtotal: 2296, cotizacion: 1522 },
    { id: "12", numero: "FA 0016-00000012", saldo: 2616.33, total: 2616.33, subtotal: 2162.26, cotizacion: 1514 },
  ];
  const facturas_pagadas = ["0015-00000050", "0015-00000049", "0015-00000047", "0015-00000004", "0015-00000041", "0016-00000012", "0015-00000048"].map((c) => ({ comprobante: c, importe_pagado: null }));
  const conBase = {
    orden_pago_cliente: "160014886", facturas_pagadas,
    pagos: [
      { tipo: "retencion_ganancias", monto: 358316.04, certificado: "0000-00004932", notas: "Base acumulada 18.139.802,14" },
      { tipo: "retencion_iibb", monto: 317446.53, certificado: "0000-00006391", notas: "Base retención 18139802,14, alícuota 1,75%" },
    ],
  };
  const r = repartirSinImportes(conBase as never, { ars, usd });
  const suma = (p: { pagos?: Array<{ monto?: unknown }> | null }) => Math.round((p.pagos || []).reduce((s, x) => s + Number(x.monto), 0) * 100);
  assert.equal(suma(r.ars) + suma(r.usd), 35831604 + 31744653, "entre los 2 pasos suman el certificado, sin repetir");
  // Con la base del certificado la parte en pesos es exacta: neto en $ 4.387.023,10 / 18.139.802,14
  const gArs = Number(r.ars.pagos!.find((p) => p.tipo === "retencion_ganancias")!.monto);
  assert.ok(Math.abs(gArs - 358316.04 * 4387023.1 / 18139802.14) < 0.02, `Ganancias en $: ${gArs}`);
  assert.ok(r.aviso && r.aviso.includes("a las de pesos"));
  // Cada paso arma su plan con solo su parte y sin el aviso de "se cargó la orden completa"
  const planArs = buildOrdenPagoPlan(r.ars, ars.map((f) => ({ id: f.id, numero: f.numero })));
  assert.equal(Math.round(planArs.retenciones.reduce((s, x) => s + x.monto, 0) * 100), suma(r.ars));
  assert.ok(!planArs.avisos.some((a) => a.includes("se cargó la orden completa")));
  const planUsd = buildOrdenPagoPlan(r.usd, usd.map((d) => ({ id: d.id, numero: d.numero })));
  assert.equal(planUsd.incluidas.length, 0, "el paso en US$ no recibe importes en pesos: no deduce un TC");
  assert.equal(Math.round(planUsd.retenciones.reduce((s, x) => s + x.monto, 0) * 100), suma(r.usd));
  // Sin base: al cambio de cada factura (también suma justo)
  const sinBase = repartirSinImportes({ ...conBase, pagos: conBase.pagos.map((p) => ({ ...p, notas: null })) } as never, { ars, usd });
  assert.equal(suma(sinBase.ars) + suma(sinBase.usd), 35831604 + 31744653);
  // Con importes por factura, o con una sola moneda, no se toca
  assert.equal(repartirSinImportes({ ...conBase, facturas_pagadas: facturas_pagadas.map((f) => ({ ...f, importe_pagado: 100 })) } as never, { ars, usd }).aviso, null);
  assert.equal(repartirSinImportes(conBase as never, { ars, usd: [] }).aviso, null);
  assert.equal(baseDelCertificado("Base imponible 2315359.20, alícuota 2,00%"), 2315359.2);
  assert.equal(baseDelCertificado("sin datos"), 0);
}

console.log("test-cobro-orden-pago OK");
