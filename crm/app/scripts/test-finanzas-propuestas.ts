// Prueba rápida: npx tsx scripts/test-finanzas-propuestas.ts
import assert from "node:assert/strict";
import { armarBandeja, nombreEsComienzoDe, textoParaRegla, cuitEnTexto, lineasParaIA, resumenBandeja, gastosFijosParaDebito, type DatosBandeja, type FacturaBandeja } from "../src/lib/finanzas-propuestas";

const CTA = "cta-cc";
const fac = (id: string, pv: number, numero: number, saldo: number, cliente: string, extra: Partial<FacturaBandeja> = {}): FacturaBandeja => ({
  id, tipo: "FA", punto_venta: pv, numero, cliente_id: cliente, cliente_nombre: cliente === "corteva" ? "Corteva Seeds Argentina SRL" : cliente === "termo" ? "TERMO CORDOBA SAU" : "Fundacion Cargill",
  cliente_cuit: cliente === "corteva" ? "30708811994" : cliente === "termo" ? "30715378023" : "30707784292",
  total: saldo, saldo, moneda: "ARS", tipo_cambio: null, estado: "emitida", fecha: `2026-09-${String(numero).padStart(2, "0")}`, ...extra,
});

const base: DatosBandeja = {
  lineas: [
    { id: "imp", fecha: "2026-10-14", concepto: "IMP. LEY 25413 DEB", importe: -100607.02, cuenta_id: CTA },
    { id: "corteva", fecha: "2026-10-14", concepto: "PAGO A PROVEEDORES OP.2600904", importe: 15830875.48, cuenta_id: CTA },
    { id: "termo", fecha: "2026-10-14", concepto: "TRANSFERENCIA", importe: 936962.44, cuenta_id: CTA },
    { id: "cargill", fecha: "2026-10-13", concepto: "TRANSFERENCIA 30707784292", importe: 300000, cuenta_id: CTA },
    { id: "sueldo", fecha: "2026-10-02", concepto: "TRANSFERENCIA 20372644606", importe: -1500000, cuenta_id: CTA },
    { id: "porcel", fecha: "2026-10-05", concepto: "TRANSFERENCIA 20253118807", importe: -500000, cuenta_id: CTA },
    { id: "prov", fecha: "2026-10-06", concepto: "TRANSFERENCIA 30716356988", importe: -449935, cuenta_id: CTA },
    { id: "raro", fecha: "2026-10-07", concepto: "DEBITO DIRECTO", importe: -9689.44, cuenta_id: CTA },
    { id: "luz", fecha: "2026-10-07", concepto: "DEBITO DIRECTO", importe: -263928.17, cuenta_id: CTA },
    { id: "desc", fecha: "2026-10-07", concepto: "TRANSFERENCIA", importe: -700000, cuenta_id: CTA },
    { id: "marcada", fecha: "2026-10-01", concepto: "TRANSFERENCIA", importe: 1175000, cuenta_id: CTA, clasificacion: "cobro" },
  ],
  movimientos: [],
  cheques: [],
  cuentas: [{ id: CTA, tipo: "banco", nombre: "BBVA CC", numero: "091-312483/1", moneda: "ARS" }],
  reglas: [],
  chequesUsados: new Set(),
  facturas: [
    fac("c2", 15, 2, 7110035.63, "corteva"), fac("c13", 15, 13, 944662.13, "corteva"), fac("c7", 16, 7, 261723, "corteva"),
    fac("c6", 16, 6, 607299, "corteva"), fac("c3", 15, 3, 7413473.38, "corteva"),
    fac("t17", 15, 17, 631.98, "termo", { moneda: "USD", total: 631.98, tipo_cambio: 1500 }),
    fac("g1", 15, 21, 100000, "cargill"), fac("g2", 15, 22, 200000, "cargill"), fac("g3", 15, 23, 999999, "cargill"),
  ],
  clientes: [
    { id: "corteva", razon_social: "Corteva Seeds Argentina SRL", cuit: "30-70881199-4" },
    { id: "termo", razon_social: "TERMO CORDOBA SAU", cuit: "30-71537802-3" },
    { id: "cargill", razon_social: "Fundacion Cargill", cuit: "30707784292" },
  ],
  proveedores: [{ id: "p1", razon_social: "Droguería EYG", cuit: "30716356988" }],
  pagosMail: [
    { id: "m1", fecha_mail: "2026-10-14", asunto: "Pago interno 160014290", pago: {
      direccion: "recibido", cliente_cuit: "30-70881199-4", cliente_nombre: "Corteva Seeds Argentina S.R.L", monto_neto: 15830875.48, monto_total: 16337193.14,
      retenciones_total: 506317.66, retenciones: [{ tipo: "otra", monto: 506317.66 }], fecha_pago: "2026-10-14", referencia: "160014290",
      facturas: [{ numero: "0015A00000002", importe: 7110035.63 }, { numero: "0015A00000013", importe: 944662.13 }, { numero: "0016A00000007", importe: 261723 }, { numero: "0016A00000006", importe: 607299 }, { numero: "0015A00000003", importe: 7413473.38 }],
    } },
    { id: "m2", fecha_mail: "2026-10-13", asunto: "Transferencia Termo", pago: {
      direccion: "recibido", cliente_cuit: "30-71537802-3", cliente_nombre: "TERMO CORDOBA SAU", monto_neto: 936962.44, monto_total: 966929.4, retenciones_total: 29966.96,
      retenciones: [{ tipo: "ganancias", monto: 15982.38 }, { tipo: "iibb", monto: 13984.58 }], fecha_pago: "2026-10-13", referencia: "LRADGc0932",
      facturas: [{ numero: "00015-00000017", importe: 966929.4 }],
    } },
  ],
  gastos: [
    { id: "gs1", fecha: "2026-10-10", descripcion: "Sueldo Mariana Santinelli — octubre 2026", monto: 1500000, moneda: "ARS", proveedor_cuit: null },
    { id: "gp", fecha: "2026-10-10", descripcion: "Leandro Porcel — octubre 2026", monto: 500000, moneda: "ARS", proveedor_cuit: "20253118807" },
  ],
  ia: new Map([["luz", { clasificacion: "otro", subtipo: "servicio", confianza: "media", explicacion: "Débito automático de un servicio" }]]),
  descartadas: new Set(["desc"]),
};

const items = armarBandeja(base);
const de = (id: string) => items.find((i) => i.linea_id === id);

// Impuesto al cheque: seguro, por regla fija.
assert.equal(de("imp")?.tipo, "cruce");
assert.equal(de("imp")?.confianza, "alta");
assert.equal(de("imp")?.cruce?.subtipo, "ley_25413");

// Corteva: cobro completo por el mail (5 facturas, retención sin tipo → "ajuste"), confianza alta.
const cv = de("corteva")!;
assert.equal(cv.tipo, "cobro_nuevo");
assert.equal(cv.origen, "mail");
assert.equal(cv.cobro?.facturas.length, 5);
assert.equal(cv.cobro?.neto, 15830875.48);
assert.deepEqual(cv.cobro?.retenciones.map((r) => [r.tipo, r.monto]), [["ajuste", 506317.66]]);
assert.equal(cv.confianza, "alta");

// Termo: factura en dólares, cancela a 966.929,40 / 631,98 = 1.530 por dólar; retenciones con tipo.
const tm = de("termo")!;
assert.equal(tm.tipo, "cobro_nuevo");
assert.equal(tm.cobro?.tipo_cambio, 1530);
assert.deepEqual(tm.cobro?.retenciones.map((r) => r.tipo), ["retencion_ganancias", "retencion_iibb"]);

// Cargill sin mail: CUIT en el concepto → cliente; 100.000 + 200.000 = 300.000 exacto.
const cg = de("cargill")!;
assert.equal(cg.tipo, "cobro_nuevo");
assert.equal(cg.origen, "facturas");
assert.deepEqual(cg.cobro?.facturas.map((f) => f.id).sort(), ["g1", "g2"]);

// Sueldo por importe (media: no hay CUIT en el gasto); Porcel por CUIT (alta).
assert.equal(de("sueldo")?.tipo, "pago_gasto");
assert.equal(de("sueldo")?.gasto?.id, "gs1");
assert.equal(de("sueldo")?.confianza, "media");
assert.equal(de("porcel")?.gasto?.id, "gp");
assert.equal(de("porcel")?.confianza, "alta");

// Proveedor por CUIT: queda "a cargar" con el nombre.
assert.equal(de("prov")?.tipo, "a_cargar");
assert.match(String(de("prov")?.cruce?.nota), /EYG/);

// IA: sugerencia de servicio; "DEBITO DIRECTO" es genérico → no arma regla.
assert.equal(de("luz")?.origen, "ia");
assert.equal(de("luz")?.cruce?.subtipo, "servicio");
assert.equal(de("luz")?.regla, undefined);

// Sin pistas → sin resolver y va a la IA. Descartada → no aparece. Ya marcada "a cobrar" sin nada nuevo → no aparece.
assert.equal(de("raro")?.tipo, "sin_resolver");
assert.deepEqual(lineasParaIA(items, base.ia).map((i) => i.linea_id), ["raro"]);
assert.equal(de("desc"), undefined);
assert.equal(de("marcada"), undefined);

// Orden: primero los seguros.
assert.equal(items[0].confianza, "alta");
const r = resumenBandeja(items);
assert.equal(r.cobros.n, 3);
assert.equal(r.gastos.n, 2);

// Un movimiento ya cargado se ofrece a UNA sola línea (la más cercana) y nunca a una con el CUIT de otro.
{
  const dos = armarBandeja({
    ...base, pagosMail: [], gastos: [], ia: new Map(), descartadas: new Set(),
    lineas: [
      { id: "a", fecha: "2026-09-23", concepto: "TRANSFERENCIA", importe: -500000, cuenta_id: CTA },
      { id: "b", fecha: "2026-09-28", concepto: "Transferencia inmediata", importe: -500000, cuenta_id: CTA },
      { id: "c", fecha: "2026-09-28", concepto: "TRANSFERENCIA 30707784292", importe: -500000, cuenta_id: CTA },
    ],
    movimientos: [{ id: "op25", fecha: "2026-09-23", monto: 500000, moneda: "ARS", tipo: "pago", proveedor_id: "vet", cuit: "30711111119", descripcion: "OP-000025 — Veterinaria" } as any],
  });
  const conMov = dos.filter((i) => i.cruce?.movimiento_id === "op25").map((i) => i.linea_id);
  assert.deepEqual(conMov, ["a"]);
}

// Reglas: CUIT gana; genéricos no.
assert.equal(textoParaRegla("TRANSFERENCIA 20372644606"), "20372644606");
assert.equal(textoParaRegla("TRANSFERENCIA"), null);
assert.equal(textoParaRegla("PAGO A PROVEEDORES OP.2600904"), null);
assert.equal(textoParaRegla("SEGURO INTEGRAL COMERCIO 123"), "SEGURO INTEGRAL COMERCIO");
assert.equal(cuitEnTexto("CTE 007875 285 30707784292 X"), "30707784292");


// 16/10/2026: débitos automáticos de gastos fijos y pagos a proveedores con factura de ARCA.
{

  const fijos = gastosFijosParaDebito([
    { id: "a1", descripcion: "ARBA plan de pagos web AA544RB 780101", categoria: "Débitos automáticos", notas: "DPR PLANPORWEB AUT07801" },
    { id: "a3", descripcion: "ARBA plan de pagos web AA544RB 780301", categoria: "Débitos automáticos", notas: "DPR PLANPORWEB AUT07801" },
    { id: "luz", descripcion: "Luz — Cooperativa Eléctrica (suministro 03A002300320444)", categoria: "Débitos automáticos", notas: "cuenta 113354000002" },
  ]);
  assert.deepEqual(fijos.find((g) => g.id === "a1")?.referencias, ["780101"], "la referencia compartida (AUT07801) no sirve");
  const items = armarBandeja({ ...base, gastosFijosDebito: fijos, facturasCompra: [], lineas: [
    { id: "deb", fecha: "2026-10-13", concepto: "DEBITO DIRECTO · DPR PLANPORWEB AA544RB 780301 AUT07801 P 0303", importe: -12864.7, cuenta_id: CTA },
    { id: "san", fecha: "2026-09-24", concepto: "TRANSFERENCIA · 30718092511 FACTURA", importe: -345468.43, cuenta_id: CTA,
      factura_arca: { tipo: "FA", punto_venta: 7, numero: 24296, fecha: "2026-09-24", total: 345468.43, emisor: "SANITARIOS SAN MARTIN S.A.", cuit: "30718092511", unica: true } },
  ] });
  const deb = items.find((i) => i.linea_id === "deb")!;
  assert.equal(deb.gastoFijo?.id, "a3", "débito automático → su gasto fijo");
  const san = items.find((i) => i.linea_id === "san")!;
  assert.equal(san.tipo, "pago_proveedor");
  assert.equal(san.pagoProveedor?.factura.numero, 24296);
  assert.equal(san.confianza, "alta");
}
{
  const items = armarBandeja({ ...base, proveedores: [...base.proveedores, { id: "yo", razon_social: "AUGUSTO LAZZARI", cuit: "20379309128" }], lineas: [
    { id: "fondeo", fecha: "2026-10-09", concepto: "TRANSFERENCIA · 20379309128 VARIOS FONDEO", importe: -500000, cuenta_id: CTA },
  ] });
  assert.ok(!/AUGUSTO LAZZARI/.test(items.find((i) => i.linea_id === "fondeo")!.titulo), "el CUIT propio no es proveedor");
}

// ── Guardas del 23/10/2026: una entrada NO es cobro sin evidencia ─────────────────────────────────────────────
// Caso real: "DNET CREDITO … SANITARIOS SAN MA" por $ 216.913,48 era una DEVOLUCIÓN de un proveedor; el sistema proponía el cobro de una factura abierta
// de la Municipalidad porque casi coincidía la suma. Ahora: si el que figura es un proveedor, no se arma ningún cobro.
{
  assert.ok(nombreEsComienzoDe("SANITARIOS SAN MA", "SANITARIOS SAN MARTIN S.A."));
  assert.ok(!nombreEsComienzoDe("SANITARIOS", "SANITARIOS SAN MARTIN S.A."), "una sola palabra no alcanza");
  assert.ok(!nombreEsComienzoDe("SANITARIOS LA PLATA", "SANITARIOS SAN MARTIN S.A."));
  const items = armarBandeja({
    ...base,
    proveedores: [...base.proveedores, { id: "san", razon_social: "SANITARIOS SAN MARTIN S.A.", cuit: "30718092511" }],
    clientes: [...base.clientes, { id: "muni", razon_social: "MUNICIPALIDAD DE PERGAMINO", cuit: "30999034515" }],
    facturas: [...base.facturas, fac("fb2", 16, 2, 217273.9, "muni", { cliente_nombre: "MUNICIPALIDAD DE PERGAMINO", cliente_cuit: "30999034515", tipo: "FB" })],
    lineas: [{ id: "devo", fecha: "2026-10-22", concepto: "DNET CREDITO NE3326720 · CTE 326720 007-002389330101 SANITARIOS SAN MA", importe: 216913.48, cuenta_id: CTA }],
    pagosMail: [],
  });
  const it = items.find((i) => i.linea_id === "devo")!;
  assert.notEqual(it.tipo, "cobro_nuevo", "una entrada de un proveedor no es un cobro");
  assert.equal(it.confianza, "baja");
  assert.ok(!it.cobro);
}
// Sin cliente identificado ni aviso: la suma de unas facturas es solo una suposición (débil) y no entra en las confirmaciones en bloque.
{
  const items = armarBandeja({
    ...base,
    clientes: [...base.clientes, { id: "muni", razon_social: "MUNICIPALIDAD DE PERGAMINO", cuit: "30999034515" }],
    facturas: [...base.facturas, fac("fb2", 16, 2, 217273.9, "muni", { cliente_nombre: "MUNICIPALIDAD DE PERGAMINO", cliente_cuit: "30999034515", tipo: "FB" })],
    lineas: [{ id: "adivina", fecha: "2026-10-22", concepto: "DNET CREDITO NE9999999", importe: 216913.48, cuenta_id: CTA }],
    pagosMail: [],
  });
  const it = items.find((i) => i.linea_id === "adivina")!;
  if (it.tipo === "cobro_nuevo") { assert.equal(it.debil, true); assert.equal(it.confianza, "baja"); }
}

// Prisina es cliente Y proveedor y entre ellos no hay devoluciones (Augusto 23/10): una entrada de Prisina se busca primero como COBRO; si no se encuentra, queda como duda (nunca como devolución).
{
  const datos = (conFactura: boolean) => ({
    ...base,
    clientes: [...base.clientes, { id: "pri", razon_social: "PRISINA S.A.", cuit: "30709905402" }],
    proveedores: [...base.proveedores, { id: "pri-p", razon_social: "PRISINA S.A.", cuit: "30709905402" }],
    facturas: conFactura ? [...base.facturas, fac("fp1", 15, 31, 500000, "pri", { cliente_nombre: "PRISINA S.A.", cliente_cuit: "30709905402" })] : base.facturas,
    lineas: [{ id: "pagapri", fecha: "2026-10-22", concepto: "TRANSFERENCIA 30709905402", importe: 500000, cuenta_id: CTA }],
    pagosMail: [],
  });
  const a = armarBandeja(datos(true)).find((i) => i.linea_id === "pagapri")!;
  assert.equal(a.tipo, "cobro_nuevo", "cliente y proveedor con una factura abierta exacta: es un cobro");
  assert.equal(a.confianza, "alta");
  const b = armarBandeja(datos(false)).find((i) => i.linea_id === "pagapri")!;
  assert.notEqual(b.tipo, "cobro_nuevo", "sin factura que coincida no se inventa un cobro");
  assert.ok(!/Entrada de un proveedor/.test(b.titulo), "no se toma como devolución de un proveedor");
}

console.log("finanzas-propuestas: OK", items.length, "renglones");
