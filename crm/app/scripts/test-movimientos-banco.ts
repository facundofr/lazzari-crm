// Prueba rápida: npx tsx scripts/test-movimientos-banco.ts
import assert from "node:assert/strict";
import { clasificarMovimiento, resumenPorTipo, resumenImpuestos, detalleDebitoAutomatico, pestanaDeLinea, resumenPestanas, TIPOS_MOV, type LineaMov } from "../src/lib/movimientos-banco";

let n = 0;
const l = (descripcion: string, tipo: "credito" | "debito", monto: number, clasificacion: string | null = null, subtipo: string | null = null): LineaMov =>
  ({ id: String(++n), fecha: "2026-10-01", descripcion, monto, tipo, clasificacion, subtipo });

// Por código del banco
assert.deepEqual(clasificarMovimiento(l("COMISION MANT CTA #037", "debito", 10)), { tipo: "impuestos_comisiones", categoria: "Comisiones", devolucion: false });
assert.equal(clasificarMovimiento(l("IVA TASA GENERAL #236", "debito", 1)).categoria, "IVA");
assert.equal(clasificarMovimiento(l("REG REC SIRC 21/10/26 00015X #550", "debito", 1)).categoria, "SIRCREB (Ingresos Brutos)");
assert.equal(clasificarMovimiento(l("IMPUESTO CREDITO IGA #589", "debito", 1)).categoria, "Impuesto crédito Ganancias (Ley 25.413)");
assert.equal(clasificarMovimiento(l("PAGO SERVICI 17779347 OP8808 #137", "debito", 1)).categoria, "Pagos ARCA (VEP)");
assert.equal(clasificarMovimiento(l("DEPOS.CHQ.48 CFU. E09191840 #082", "credito", 1)).tipo, "cheques");
assert.equal(clasificarMovimiento(l("TRANSF.BANEL 603658 #136", "debito", 1)).tipo, "transferencias");
assert.equal(clasificarMovimiento(l("DEBITO DIRECTO #761", "debito", 1)).tipo, "debitos_automaticos");
assert.equal(clasificarMovimiento(l("PAGO TARJETA VISA #515", "debito", 1)).tipo, "tarjeta");
assert.equal(clasificarMovimiento(l("TRANSFERENCI 400913398713 #263", "credito", 1)).tipo, "propios");
assert.equal(clasificarMovimiento(l("INVERSION FCI #654", "debito", 1)).tipo, "propios");
assert.equal(clasificarMovimiento(l("EXTRACCION EFECTIVO #062", "debito", 1)).tipo, "efectivo");

// Transferencia ya confirmada como pase entre cuentas propias: sigue en "propios" aunque el código sea de transferencia
assert.equal(clasificarMovimiento(l("TRANSFERENCIA CCP091 318933 7 #262", "debito", 300000, "entre_cuentas")).tipo, "propios");
assert.equal(clasificarMovimiento(l("TRANSFERENCIA CCP091 318933 7 #262", "debito", 300000, "pago")).tipo, "transferencias");

// Una entrada dentro de impuestos/comisiones es una devolución
const dev = clasificarMovimiento(l("REG REC SIRC 1 #550", "credito", 5));
assert.equal(dev.tipo, "impuestos_comisiones"); assert.equal(dev.devolucion, true);

// Líneas cargadas antes del código: por lo guardado o por el texto
assert.equal(clasificarMovimiento(l("DEBITO DIRECTO", "debito", 1, "pago")).tipo, "debitos_automaticos");
assert.equal(clasificarMovimiento(l("DEBITO DIRECTO", "debito", 1, "personal")).tipo, "debitos_automaticos");
assert.equal(clasificarMovimiento(l("PAGO DE SERVICIOS TARJETA 17779347 OP1", "debito", 1, "impuesto", null)).categoria, "Pagos ARCA (VEP)");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "impuesto", "iva")).categoria, "IVA");
assert.equal(clasificarMovimiento(l("x", "credito", 1, "impuesto", "devolucion_sircreb")).devolucion, true);
assert.equal(clasificarMovimiento(l("x", "debito", 1, "gasto_bancario", "comision")).categoria, "Comisiones");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "cheque_emitido")).tipo, "cheques");
assert.equal(clasificarMovimiento(l("x", "credito", 1, "cobro")).tipo, "transferencias");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "pago")).tipo, "transferencias");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "tarjeta")).tipo, "tarjeta");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "fci")).tipo, "propios");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "entre_cuentas")).tipo, "propios");
assert.equal(clasificarMovimiento(l("x", "debito", 1, "personal")).tipo, "otros");
assert.equal(clasificarMovimiento(l("x", "debito", 1, null)).tipo, "sin_clasificar");

// Resumen: la suma de los tipos es el total
const lineas = [
  l("COMISION #037", "debito", 100), l("IVA #236", "debito", 21), l("SIRC #550", "credito", 40), l("SIRC #550", "debito", 300),
  l("DEPOS #082", "credito", 1000), l("TRANSF #136", "debito", 500), l("x", "debito", 7, null),
];
const r = resumenPorTipo(lineas);
assert.equal(r.length, TIPOS_MOV.length);
assert.equal(r.reduce((a, x) => a + x.entradas, 0), 1040);
assert.equal(r.reduce((a, x) => a + x.salidas, 0), 928);
assert.equal(r.reduce((a, x) => a + x.cantEntradas + x.cantSalidas, 0), lineas.length);
assert.equal(r.find((x) => x.tipo === "sin_clasificar")!.salidas, 7);

const ri = resumenImpuestos(lineas);
const sirc = ri.find((x) => x.categoria.startsWith("SIRCREB"))!;
assert.equal(sirc.salidas, 300); assert.equal(sirc.devoluciones, 40);
assert.equal(ri.find((x) => x.categoria === "Comisiones")!.salidas, 100);

// Detalle de los débitos automáticos
assert.equal(detalleDebitoAutomatico("Débito automático: Luz — Cooperativa Eléctrica de Pergamino (suministro 03A004300048885) — octubre 2026: $ 9.689,44. [conf-23/10]"), "Luz — Cooperativa Eléctrica de Pergamino (suministro 03A004300048885) — octubre 2026");
assert.equal(detalleDebitoAutomatico("Débito automático: ARBA plan de pagos web AA544RB 720201 — octubre 2026: $ 74.096,70. PERSONAL del auto"), "ARBA plan de pagos web AA544RB 720201 — octubre 2026");
assert.equal(detalleDebitoAutomatico("Débito automático: Seguro — Federación Patronal Seguros póliza 0436118496000000140926 — octubre"), "Seguro — Federación Patronal Seguros póliza 0436118496000000140926 — octubre");
assert.equal(detalleDebitoAutomatico(null), "");
assert.equal(detalleDebitoAutomatico(""), "");

// Pestañas: las transferencias se separan por sentido; lo que no tiene tipo va a "Otros"; la suma da el total.
assert.equal(pestanaDeLinea(l("TRANSF.BANEL 603658 #136", "debito", 1)), "salen");
assert.equal(pestanaDeLinea(l("TRANSFERENCIA RECIBIDA 30712345678 #262", "credito", 1)), "entran");
assert.equal(pestanaDeLinea(l("ALGO RARO", "credito", 1)), "otros");
assert.equal(pestanaDeLinea(l("COMISION MANT CTA #037", "debito", 1)), "impuestos_comisiones");
assert.equal(pestanaDeLinea(l("TRANSFERENCI 400913398713 #263", "credito", 1)), "propios");
{
  const ls = [l("TRANSF.BANEL 1 #136", "debito", 100), l("TRANSFERENCIA RECIBIDA #262", "credito", 250.5), l("COMISION #037", "debito", 10), l("IVA #236", "debito", 2.1), l("ALGO", "credito", 5)];
  const r = resumenPestanas(ls);
  const todas = r.find((x) => x.id === "todas")!;
  assert.deepEqual(todas, { id: "todas", cant: 5, entradas: 255.5, salidas: 112.1 });
  const resto = r.filter((x) => x.id !== "todas");
  assert.equal(resto.reduce((s, x) => s + x.cant, 0), 5);
  assert.deepEqual(r.find((x) => x.id === "impuestos_comisiones"), { id: "impuestos_comisiones", cant: 2, entradas: 0, salidas: 12.1 });
  assert.deepEqual(r.find((x) => x.id === "entran"), { id: "entran", cant: 1, entradas: 250.5, salidas: 0 });
}

console.log("test-movimientos-banco OK");
