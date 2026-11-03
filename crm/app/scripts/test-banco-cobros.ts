// Prueba rápida: npx tsx scripts/test-banco-cobros.ts
import assert from "node:assert/strict";
import {
  baseRetencion, estimarRetenciones, eventosRetencion, facturaMenosRetenciones, facturasConSaldoExacto, modelosRetencion, reglasDeEvento,
  sugerirFacturas, textoAplicado, avisosDeMails, sugerirDesdeAvisos, type FacturaBanco,
} from "../src/lib/banco-cobros";
import { faltanCertificadosPorCliente, type FilaRetencion } from "../src/lib/finanzas-lazza";

const fac = (x: Partial<FacturaBanco>): FacturaBanco => ({
  id: "f", clienteId: "c", cliente: "Cliente", cuit: "30-11111111-1", tipo: "FA", numero: "FA 0015-00000001", fecha: "2026-10-01",
  moneda: "ARS", subtotal: 100, total: 121, saldo: 121, ...x,
});

// Aplicado o no.
assert.equal(textoAplicado([]), "sin factura del CRM");
assert.equal(textoAplicado(["FA 0015-00000052", "FA 0015-00000052"]), "aplicado a FA 0015-00000052");
assert.equal(textoAplicado(["FA 1", "FA 2"]), "aplicado a FA 1 y FA 2");
assert.equal(textoAplicado(["FA 1", "FA 2", "FA 3", "FA 4"]), "aplicado a FA 1, FA 2 y 2 más");

// Base: neto en las A, total en las B y X.
assert.equal(baseRetencion({ tipo: "FA", subtotal: 351670.96, total: 425521.86 }), 351670.96);
assert.equal(baseRetencion({ tipo: "FCEA", subtotal: 1000, total: 1210 }), 1000);
assert.equal(baseRetencion({ tipo: "FB", subtotal: 2735100, total: 3309471 }), 3309471);
assert.equal(baseRetencion({ tipo: "X", subtotal: 0, total: 500 }), 500);

// Saldo exacto: solo pesos, con saldo, y del CUIT de la línea si lo trae.
{
  const fs = [
    fac({ id: "a", saldo: 500, total: 500 }),
    fac({ id: "b", saldo: 500, total: 800, cuit: "30-22222222-2" }),
    fac({ id: "usd", saldo: 500, moneda: "USD" }),
    fac({ id: "otro", saldo: 500.01 }),
  ];
  assert.deepEqual(facturasConSaldoExacto({ importe: 500 }, fs).map((f) => f.id), ["a", "b"]);
  assert.deepEqual(facturasConSaldoExacto({ importe: 500, cuit: "30222222222" }, fs).map((f) => f.id), ["b"]);
  assert.deepEqual(facturasConSaldoExacto({ importe: -500 }, fs), []);
}

// Caso de oro: Cargill (03/11/2026). El cobro de la FA 0015-00000014 (29/10) dice cómo retiene; entraron $ 317.973,26 y es la FA 0015-00000011.
{
  const facturas = new Map([
    ["fa14", { tipo: "FA", subtotal: 351670.96, total: 425521.86, moneda: "ARS" }],
    ["fa11", { tipo: "FA", subtotal: 293670.5, total: 355341.31, moneda: "ARS" }],
    ["usd", { tipo: "FA", subtotal: 1000, total: 1210, moneda: "USD" }],
  ]);
  const eventos = eventosRetencion({
    retenciones: [
      { id: "r1", tipo: "retencion_iva", fecha: "2026-10-29T03:00:00Z", monto: "36925.45", cliente_id: "cargill" },
      { id: "r2", tipo: "retencion_ganancias", fecha: "2026-10-29", monto: 2553.42, cliente_id: "cargill" },
      { id: "r3", tipo: "retencion_iibb", fecha: "2026-10-29", monto: 6154.24, cliente_id: "cargill" },
      { id: "anulada", tipo: "retencion_iva", fecha: "2026-10-29", monto: 999, cliente_id: "cargill", anulado: true },
      { id: "fx", tipo: "retencion_iibb", fecha: "2026-10-04", monto: 100, cliente_id: "termo", factura_id: "usd" },
      { id: "suelta", tipo: "retencion_iibb", fecha: "2026-10-05", monto: 100, cliente_id: "sinfactura" },
    ],
    aplicaciones: [{ movimiento_id: "r1", factura_id: "fa14" }, { movimiento_id: "r2", factura_id: "fa14" }, { movimiento_id: "r3", factura_id: "fa14" }],
    facturas,
  });
  assert.equal(eventos.length, 1, "la de dólares y la sin factura no cuentan");
  assert.equal(eventos[0].base, 351670.96);
  const reglas = reglasDeEvento(eventos[0]);
  assert.deepEqual(reglas.map((r) => r.tipo), ["retencion_iva", "retencion_ganancias", "retencion_iibb"]);
  assert.deepEqual(reglas.find((r) => r.tipo === "retencion_ganancias"), { tipo: "retencion_ganancias", tasa: 0.02, minimo: 224000 });
  const modelos = modelosRetencion(eventos);
  const est = estimarRetenciones(modelos.get("cargill")!, 293670.5);
  assert.deepEqual(est, [{ tipo: "retencion_iva", monto: 30835.4 }, { tipo: "retencion_ganancias", monto: 1393.41 }, { tipo: "retencion_iibb", monto: 5139.23 }]);

  const fa11 = fac({ id: "fa11", clienteId: "cargill", cliente: "Cargill", cuit: null, numero: "FA 0015-00000011", subtotal: 293670.5, total: 355341.31, saldo: 355341.31 });
  const otras = [
    fac({ id: "parcial", clienteId: "cargill", subtotal: 293670.5, total: 355341.31, saldo: 355341.3 }), // ya tiene un cobro: no
    fac({ id: "sinModelo", clienteId: "nadie", subtotal: 293670.5, total: 355341.31, saldo: 355341.31 }),
  ];
  const s = facturaMenosRetenciones({ importe: 317973.26 }, [fa11, ...otras], modelos);
  assert.equal(s.length, 1);
  assert.equal(s[0].factura.id, "fa11");
  // 1 centavo de redondeo de Cargill: va a la retención más grande (IVA) y la factura queda justa.
  assert.equal(s[0].transferencia, 317973.26);
  assert.deepEqual(s[0].retenciones, [{ tipo: "retencion_iva", monto: 30835.41 }, { tipo: "retencion_ganancias", monto: 1393.41 }, { tipo: "retencion_iibb", monto: 5139.23 }]);
  assert.equal(Math.round((s[0].transferencia + s[0].retenciones.reduce((t, r) => t + r.monto, 0)) * 100) / 100, 355341.31);
  assert.equal(facturaMenosRetenciones({ importe: 317960 }, [fa11], modelos).length, 0, "más de $ 1 de diferencia: no");
  // sugerirFacturas: primero las exactas; si no hay, la de retenciones (una sola).
  assert.deepEqual(sugerirFacturas({ importe: 317973.26 }, [fa11], modelos).map((x) => x.factura.id), ["fa11"]);
  const exacta = fac({ id: "exacta", saldo: 317973.26, total: 317973.26 });
  assert.deepEqual(sugerirFacturas({ importe: 317973.26 }, [fa11, exacta], modelos).map((x) => [x.factura.id, x.retenciones.length]), [["exacta", 0]]);
  const fa11bis = { ...fa11, id: "fa11bis" };
  assert.deepEqual(sugerirFacturas({ importe: 317973.26 }, [fa11, fa11bis], modelos), [], "dos posibles con retenciones: no adivina");
}

// Ganancias que no da 2 % sobre un mínimo redondo: queda como porcentaje de la base.
{
  const r = reglasDeEvento({ clienteId: "c", fecha: "2026-10-01", base: 100000, retenciones: [{ tipo: "retencion_ganancias", monto: 600 }] });
  assert.deepEqual(r, [{ tipo: "retencion_ganancias", tasa: 0.006, minimo: 0 }]);
  // Fundación Cargill FB 7: 2 % s/ total − 224.000.
  const fb = reglasDeEvento({ clienteId: "c", fecha: "2026-10-13", base: 3309471, retenciones: [{ tipo: "retencion_ganancias", monto: 61709.42 }] });
  assert.deepEqual(fb, [{ tipo: "retencion_ganancias", tasa: 0.02, minimo: 224000 }]);
  // Por debajo del mínimo no hay retención de Ganancias.
  assert.deepEqual(estimarRetenciones(fb, 200000), []);
}

// Último cobro de cada cliente.
{
  const m = modelosRetencion([
    { clienteId: "c", fecha: "2026-09-01", base: 1000, retenciones: [{ tipo: "retencion_iibb", monto: 10 }] },
    { clienteId: "c", fecha: "2026-10-01", base: 1000, retenciones: [{ tipo: "retencion_iibb", monto: 20 }] },
  ]);
  assert.equal(m.get("c")![0].tasa, 0.02);
}

// Faltan certificados por cliente (Cobranzas): solo sufridas sin N°, agrupadas por CUIT.
{
  const fila = (x: Partial<FilaRetencion>): FilaRetencion => ({
    id: "x", fecha: "2026-11-03", lado: "sufrida", impuesto: "IVA", origen: "", nombre: "Cargill", cuit: "30-50000000-1", base: null, pct: null,
    monto: 0, moneda: "ARS", certificado: null, faltaCertificado: true, movimientoId: null, certificadoCargado: null, recibo: null, detalle: "", ...x,
  });
  const r = faltanCertificadosPorCliente([
    fila({ impuesto: "IIBB", monto: 5139.23 }),
    fila({ impuesto: "IVA", monto: 30835.4, fecha: "2026-11-02" }),
    fila({ impuesto: "Ganancias", monto: 1393.41 }),
    fila({ impuesto: "IVA", monto: 999, certificado: "0003-1", faltaCertificado: false }),
    fila({ lado: "practicada", monto: 50 }),
    fila({ nombre: "Synthon", cuit: "30-60000000-1", impuesto: "IIBB", monto: 100 }),
  ]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { nombre: "Cargill", cuit: "30-50000000-1", cantidad: 3, total: { ARS: 37368.04, USD: 0 }, impuestos: ["IVA", "Ganancias", "IIBB"], desde: "2026-11-02" });
  assert.equal(r[1].nombre, "Synthon");
}

// Avisos de pago del correo (03/11/2026): Soychú 26/10 (total 272.250, IIBB 3.937,50 + IVA 23.625, entró 244.687,50).
{
  const avisos = avisosDeMails([
    { id: "m1", fecha_mail: "2026-10-26T10:00:00Z", remitente: "<pagos@soychu.com.ar>", datos: { pago: { direccion: "recibido", cliente_cuit: "30-50500086-9", monto_total: 272250, monto_neto: null,
      retenciones_total: 27562.5, retenciones: [{ tipo: "iibb", monto: 3937.5, certificado: "0176-00011775" }, { tipo: "iva", monto: 23625 }, { tipo: "otra", monto: 5 }], fecha_pago: "2026-10-26",
      referencia: "3400022705", facturas: [{ numero: "0008-00000671", importe: 272250 }] } } },
    { id: "m2", datos: { pago: { direccion: "emitido", monto_total: 100 } } },
    { id: "m3", datos: { pago: { direccion: "recibido", monto_total: null, monto_neto: null } } },
  ]);
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0].transferencias, [244687.5, 272250]);
  assert.deepEqual(avisos[0].retenciones, [{ tipo: "retencion_iibb", monto: 3937.5, certificado: "0176-00011775" }, { tipo: "retencion_iva", monto: 23625, certificado: null }]);
  const clientes = [{ id: "soy", razon_social: "Frigorifico de Aves Soychu Saicfia", cuit: "30505000869" }];
  const fa = fac({ id: "fa671", clienteId: "soy", numero: "FA 0008-00000671", total: 272250, saldo: 272250 });
  const s = sugerirDesdeAvisos({ importe: 244687.5, fecha: "2026-10-27" }, avisos, [fa], clientes);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].facturas.map((f) => f.id), ["fa671"], "la factura por el número que nombra el aviso");
  assert.equal(s[0].transferencia, 244687.5);
  assert.equal(sugerirDesdeAvisos({ importe: 244690, fecha: "2026-10-27" }, avisos, [fa], clientes).length, 0, "importe distinto");
  assert.equal(sugerirDesdeAvisos({ importe: 244687.5, fecha: "2026-12-27" }, avisos, [fa], clientes).length, 0, "lejos en fecha");
  assert.equal(sugerirDesdeAvisos({ importe: 244687.5, fecha: "2026-10-27", cuit: "30111111112" }, avisos, [fa], clientes).length, 0, "la línea trae otro CUIT");
  assert.equal(sugerirDesdeAvisos({ importe: 244687.5, fecha: "2026-10-27" }, avisos, [fa], []).length, 0, "cliente que no está");
  // Sin número en el aviso: la única factura con saldo = entró + retenciones; con 1 centavo de diferencia, va a la retención más grande.
  const sinNum = [{ ...avisos[0], facturasNumeros: [] }];
  const fb = fac({ id: "otra", clienteId: "soy", numero: "FA 0008-00000700", total: 272250.01, saldo: 272250.01 });
  const s2 = sugerirDesdeAvisos({ importe: 244687.5, fecha: "2026-10-27" }, sinNum, [fb], clientes);
  assert.deepEqual(s2[0].facturas.map((f) => f.id), ["otra"]);
  assert.equal(s2[0].retenciones.find((r) => r.tipo === "retencion_iva")!.monto, 23625.01);
}

console.log("test-banco-cobros OK");
