// npx tsx scripts/test-gastos-lazza.ts
import assert from "node:assert/strict";
import { filasDeTransportes, GRUPOS_EDITABLES, esGastoFijo, fijosCubiertos, gastoParecido, numeroVep, nombreGrupo, armarFilasGastos, filtrarGastos, fijosSinCargar, grupoDe, grupoDeCategoria, mesDelDetalleFijo, totalesPorGrupo, venceEnMes, yaEstaEnBancoOVisa, type FijoRow, type GastoRow } from "../src/lib/gastos-lazza";

assert.equal(grupoDeCategoria("Sueldos"), "Personal");
assert.equal(grupoDeCategoria("Premios"), "Premios"); // 28/10: grupo nuevo, seguido a Sueldos
assert.equal(grupoDe({ grupo: "Premios", categoria: "Premios" }), "Premios");
assert.equal(grupoDeCategoria("Débitos automáticos"), "Local y servicios");
assert.equal(grupoDeCategoria("debitos automaticos"), "Local y servicios");
assert.equal(grupoDeCategoria("Bancarios"), "Bancos y financieros");
assert.equal(grupoDeCategoria("Importaciones"), "Operativos");
assert.equal(grupoDeCategoria("algo nuevo"), "Operativos");
assert.equal(grupoDe({ grupo: "Impuestos", categoria: "Sueldos" }), "Impuestos"); // el grupo elegido gana
assert.equal(grupoDe({ grupo: "cualquiera", categoria: "Sueldos" }), "Personal");

const fijos: FijoRow[] = [
  { id: "luz", descripcion: "Luz", categoria: "Débitos automáticos", monto: 100, moneda: "ARS", activo: true, dia_vencimiento: 7, medio_pago: "debito_automatico" },
  { id: "sueldo", descripcion: "Sueldo", categoria: "Sueldos", monto: 1000, moneda: "ARS", activo: true, dia_vencimiento: 31 },
  { id: "alq", descripcion: "Alquiler", categoria: "Alquiler", grupo: "Local y servicios", monto: 800, moneda: "USD", activo: true, dia_vencimiento: null },
  { id: "viejo", descripcion: "Baja", categoria: "Servicios", monto: 5, moneda: "ARS", activo: false, dia_vencimiento: 1 },
];
const gastos: GastoRow[] = [
  { id: "g1", fecha: "2026-10-07", descripcion: "Luz oct", categoria: "Débitos automáticos", monto: "263928.17", moneda: "ARS", medio_pago: "transferencia", tipo_recurrencia: "mensual", gasto_fijo_id: "luz", notas: "[débito automático cargado solo]" },
  { id: "g2", fecha: "2026-10-16", descripcion: "VEP", categoria: "Impuestos", monto: 2520000, moneda: "ARS", medio_pago: "debito", tipo_recurrencia: "eventual", gasto_fijo_id: null },
  { id: "g3", fecha: "2026-10-01", descripcion: "Alquiler oct", categoria: "Alquiler", grupo: "Personales", monto: 800, moneda: "USD", medio_pago: "transferencia", tipo_recurrencia: "fijo", gasto_fijo_id: "alq" },
];
const filas = armarFilasGastos(gastos, fijos);
assert.deepEqual(filas.map((f) => f.id), ["g2", "g1", "g3"]);
const luz = filas.find((f) => f.id === "g1")!;
assert.equal(luz.medio, "debito_automatico"); assert.equal(luz.fijo, true); assert.equal(luz.cargadoSolo, true); assert.equal(luz.grupo, "Local y servicios");
assert.equal(filas.find((f) => f.id === "g2")!.fijo, false);
assert.equal(filas.find((f) => f.id === "g3")!.grupo, "Personales"); // se cambió de grupo a mano

assert.deepEqual(filtrarGastos(filas, { soloDebito: true }).map((f) => f.id), ["g1"]);
assert.deepEqual(filtrarGastos(filas, { tipo: "eventual" }).map((f) => f.id), ["g2"]);
assert.deepEqual(filtrarGastos(filas, { grupo: "Impuestos" }).map((f) => f.id), ["g2"]);
assert.deepEqual(filtrarGastos(filas, { texto: "debito automatico" }).map((f) => f.id), ["g1"]);

const t = totalesPorGrupo(filas);
assert.equal(t.length, 9); // 7 grupos + Premios (28/10) + Transportes (29/10)
assert.deepEqual(t.find((x) => x.grupo === "Impuestos"), { grupo: "Impuestos", n: 1, ARS: 2520000, USD: 0 });
assert.deepEqual(t.find((x) => x.grupo === "Personales"), { grupo: "Personales", n: 1, ARS: 0, USD: 800 });

assert.equal(venceEnMes(31, "2026-11"), "2026-11-30");
assert.equal(venceEnMes(7, "2026-10"), "2026-10-07");
assert.equal(venceEnMes(null, "2026-10"), null);

// Octubre: la luz y el alquiler ya están; falta el sueldo; el inactivo no aparece.
assert.deepEqual(fijosSinCargar(fijos, gastos, "2026-10").map((f) => [f.id, f.vence, f.grupoFinal]), [["sueldo", "2026-10-31", "Personal"]]);
// Noviembre: faltan los 3 activos (el alquiler sin día, al final).
assert.deepEqual(fijosSinCargar(fijos, gastos, "2026-11").map((f) => f.id), ["luz", "sueldo", "alq"]);

// Nombres que se ven en pantalla (Augusto 23/10): el valor guardado no cambia.
assert.equal(nombreGrupo("Personal"), "Sueldos");
assert.equal(nombreGrupo("Personales"), "Augusto");
assert.equal(nombreGrupo("Impuestos"), "Impuestos");

// Un solo criterio de «Fijo» para Gastos y Reportes (arreglo 10, 27/10/2026): la pantalla Gastos guarda «Fijo» como mensual
assert.equal(esGastoFijo({ tipo_recurrencia: "mensual" }), true);
assert.equal(esGastoFijo({ tipo_recurrencia: "fijo" }), true);
assert.equal(esGastoFijo({ tipo_recurrencia: "eventual", gasto_fijo_id: "gf" }), true, "atado a un fijo");
assert.equal(esGastoFijo({ tipo_recurrencia: "eventual" }), false);
assert.equal(esGastoFijo({}), false);

// Transportes (29/10/2026): las facturas de transporte se muestran como filas del grupo Transportes, solo lectura
{
  const tr = filasDeTransportes([
    { id: "f1", fecha: "2026-10-20T03:00:00Z", numero_factura: "0000-00000016", total: "72000", moneda: "ARS", proveedor: "JOSE ALVAREZ" },
    { id: "f2", fecha: "2026-10-05", numero_factura: null, total: 1000, moneda: "usd", archivo_url: "x.pdf", proveedor: null },
  ]);
  assert.equal(tr[0].grupo, "Transportes");
  assert.equal(tr[0].id, "fc:f1");
  assert.equal(tr[0].facturaCompraId, "f1");
  assert.equal(tr[0].fecha, "2026-10-20");
  assert.equal(tr[0].detalle, "JOSE ALVAREZ — factura 0000-00000016");
  assert.equal(tr[0].monto, 72000);
  assert.equal(tr[1].moneda, "USD");
  assert.equal(tr[1].detalle, "Transportista");
  const tot = totalesPorGrupo([...filas, ...tr]);
  assert.deepEqual(tot.find((x) => x.grupo === "Transportes"), { grupo: "Transportes", n: 2, ARS: 72000, USD: 1000 });
  assert.ok(!GRUPOS_EDITABLES.includes("Transportes" as never), "Transportes no se elige al cargar un gasto");
}

// Sueldo (29/10/2026): lo que se paga a principio de mes es el sueldo del mes anterior; lo demás, del mismo mes.
assert.equal(mesDelDetalleFijo({ descripcion: "Sueldo Sebastián Pereyra" }, "2026-10"), "2026-09");
assert.equal(mesDelDetalleFijo({ descripcion: "sueldo Augusto" }, "2027-01"), "2026-12");
assert.equal(mesDelDetalleFijo({ descripcion: "Mutual — Sebastián Pereyra" }, "2026-10"), "2026-10");
assert.equal(mesDelDetalleFijo({ descripcion: "Alquiler" }, "2026-10"), "2026-10");

// Repetidos (auditoría de la plata, 29/10/2026): mismo VEP, o mismo grupo, moneda e importe en el mes; fijo cubierto por su factura.
assert.equal(numeroVep("ARCA VEP — Anticipo de Ganancias 2 (VEP 1696573116) — pago 21/10"), "1696573116");
assert.equal(numeroVep("Nro. VEP: 1682735631"), "1682735631");
assert.equal(numeroVep("Luz octubre"), null);
{
  const cargados: GastoRow[] = [
    { id: "a", fecha: "2026-10-21", descripcion: "ARCA VEP — SICORE septiembre 2026 (VEP 1696995778)", categoria: "Impuestos", grupo: "Impuestos", monto: 3033210.96, moneda: "ARS", medio_pago: "debito", tipo_recurrencia: "eventual", gasto_fijo_id: null },
    { id: "b", fecha: "2026-10-20", descripcion: "Honorarios contador — octubre 2026", categoria: "Profesionales", grupo: "Profesionales", monto: "178200", moneda: "ARS", medio_pago: "transferencia", tipo_recurrencia: "mensual", gasto_fijo_id: "musso" },
  ];
  const base = { fecha: "2026-10-25", grupo: "Profesionales", monto: 178200.5, moneda: "ARS", textos: "Musso octubre" };
  assert.equal(gastoParecido(base, cargados)?.id, "b", "mismo grupo e importe (±1) en el mes");
  assert.equal(gastoParecido({ ...base, monto: 178202 }, cargados), null, "más de $ 1 de diferencia");
  assert.equal(gastoParecido({ ...base, fecha: "2026-11-02" }, cargados), null, "otro mes");
  assert.equal(gastoParecido({ ...base, grupo: "Operativos" }, cargados), null, "otro grupo");
  assert.equal(gastoParecido({ ...base, moneda: "USD" }, cargados), null, "otra moneda");
  assert.equal(gastoParecido({ fecha: "2026-11-05", grupo: "Impuestos", monto: 1, moneda: "ARS", textos: "SICORE (VEP 1696995778)" }, cargados)?.id, "a", "el mismo VEP, aunque sea otro mes e importe");
  const fijosProv: FijoRow[] = [
    { id: "musso", descripcion: "Honorarios contador (Agustín Musso)", categoria: "Profesionales", monto: 178200, moneda: "ARS", activo: true, dia_vencimiento: null, proveedor_id: "p-musso" },
    { id: "alq", descripcion: "Alquiler", categoria: "Alquiler", monto: 800, moneda: "USD", activo: true, dia_vencimiento: null, proveedor_id: null },
  ];
  const cub = fijosCubiertos(fijosProv, [{ proveedor_id: "p-musso", numero_factura: "00001-00000556" }, { proveedor_id: "otro", numero_factura: "9" }]);
  assert.equal(cub.get("musso")?.numero_factura, "00001-00000556");
  assert.equal(cub.has("alq"), false, "sin proveedor no se cubre");
}

// Aviso "ya está en el banco o en la Visa" (02/11/2026): solo avisa.
{
  const lineas = [{ fecha: "2026-10-14", descripcion: "COMISION MANT CTA", monto: 12500 }];
  const consumos = [{ fecha: "2026-10-05", comercio: "MERCADOLIBRE", importe: 155850, moneda: "ARS" }, { fecha: "2026-10-07", comercio: "ANTHROPIC", importe: 146.98, moneda: "USD" }];
  const g = (x: Partial<{ fecha: string; monto: number; moneda: string; medio: string | null }>) => ({ fecha: "2026-10-15", monto: 1, moneda: "ARS", medio: "transferencia", ...x });
  assert.match(yaEstaEnBancoOVisa(g({ monto: 12500.6 }), lineas, consumos) || "", /^Ya está en el banco: 14\/10 · COMISION MANT CTA/);
  assert.equal(yaEstaEnBancoOVisa(g({ monto: 12500, fecha: "2026-10-30" }), lineas, consumos), null, "más de 7 días: no es esa");
  assert.match(yaEstaEnBancoOVisa(g({ monto: 155850 }), lineas, consumos) || "", /^Está en el resumen de la Visa: 05\/10 · MERCADOLIBRE/);
  assert.equal(yaEstaEnBancoOVisa(g({ monto: 155850, medio: "tarjeta_visa_1582" }), lineas, consumos), null, "cargado con la Visa: está bien");
  assert.match(yaEstaEnBancoOVisa(g({ monto: 146.98, moneda: "USD" }), lineas, consumos) || "", /ANTHROPIC · US\$ 146,98/);
  assert.equal(yaEstaEnBancoOVisa(g({ monto: 146.98 }), lineas, consumos), null, "otra moneda: no es ese");
  assert.equal(yaEstaEnBancoOVisa(g({ monto: 999 }), lineas, consumos), null);
}

console.log("test-gastos-lazza OK");
