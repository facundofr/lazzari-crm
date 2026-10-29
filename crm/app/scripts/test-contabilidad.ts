// Prueba de lib/contabilidad.ts (Estado de resultados por lo devengado) — npx tsx scripts/test-contabilidad.ts
import assert from "node:assert/strict";
import { IIBB_PCT_NATI, TASA_GANANCIAS, clasificarGasto, clasificarLineaBanco, estadoDeResultados, mesDevengado, mesesDelAnio, planillaER, type GastoCont, type LineaBancoCont } from "../src/lib/contabilidad";

// ── Mes devengado ──
assert.equal(mesDevengado("Premio agosto — Mariana Santinelli", "2026-10-07"), "2026-08");
assert.equal(mesDevengado("Comisión septiembre 2026 — José Alvarez", "2026-10-06"), "2026-09");
assert.equal(mesDevengado("Alquiler — octubre 2026", "2026-10-05"), "2026-10");
assert.equal(mesDevengado("Premio diciembre — Jerónimo Casadidio", "2027-01-07"), "2026-12");
assert.equal(mesDevengado("Banco Nación — liquidación mensual Setiembre", "2026-10-02"), "2026-09");
assert.equal(mesDevengado("Honorarios contador — noviembre", "2026-10-28"), "2026-11", "pago adelantado de un mes");
assert.equal(mesDevengado("Seguro del local — SMG", "2026-09-15"), "2026-09", "sin mes en el texto: su fecha");
assert.equal(mesDevengado(null, "2026-09-15"), "2026-09");
assert.equal(mesDevengado("Autónomos Augusto — ARCA período 09/2026, categoría 302", "2026-10-23"), "2026-09");
assert.equal(mesDevengado("ARCA VEP — IVA período 6/2026", "2026-07-20"), "2026-06");

// ── Clasificación de gastos ──
const g = (grupo: string, categoria: string, descripcion: string) => clasificarGasto({ grupo, categoria, descripcion });
assert.equal(g("Personal", "Sueldos", "Sueldo Sebastián Pereyra — octubre 2026"), "colaboradores_lsj");
assert.equal(g("Personal", "Sueldos", "Autónomos Augusto — ARCA período 09/2026"), "colaboradores_lsj");
assert.equal(g("Personal", "Sueldos", "Mutual — Mariana Santinelli"), "colaborador_m");
assert.equal(g("Premios", "Premios", "Premio agosto — Mariana Santinelli"), "colaborador_m");
assert.equal(g("Premios", "Premios", "Premio agosto — Jerónimo Casadidio"), "colaboradores_lsj");
assert.equal(g("Personal", "Comisiones", "Comisión septiembre 2026 — José Alvarez"), "comisiones");
assert.equal(g("Operativos", "Transportes", "Viajes septiembre 2026 — José Alvarez"), "transportes");
assert.equal(g("Operativos", "Compras sin factura", "Reintegro a Sebastián Pereyra por compras para un cliente"), "compras_sin_factura");
assert.equal(g("Operativos", "Mantenimiento", "Polarizado en el local"), "administrativos");
assert.equal(g("Impuestos", "Impuestos", "Compra crédito fiscal IVA — FC 00005-00019878"), "credito_fiscal_iva");
assert.equal(g("Impuestos", "Impuestos", "ARCA VEP — impuestos de la importación (despacho)"), "administrativos");
assert.equal(g("Impuestos", "Impuestos", "IIBB Convenio Multilateral agosto 2026"), "impuestos_pago");
assert.equal(g("Impuestos", "Impuestos", "ARCA VEP — Anticipo de Ganancias 1"), "impuestos_pago");
assert.equal(g("Impuestos", "Impuestos", "ARBA plan de pagos web AA544RB 720201 — septiembre"), "retiros", "el plan de ARBA es de Augusto");
assert.equal(g("Personales", "Impuestos", "ARBA plan de pagos web AA544RB 720201 — octubre"), "retiros");
assert.equal(g("Personales", "Personales", "Alquiler personal Augusto (Perincioli) — octubre"), "retiros");
assert.equal(g("Bancos y financieros", "Bancarios", "Comisión gestión de cheques BBVA"), "bancarios");
assert.equal(g("Bancos y financieros", "Financieros", "Interés préstamo José Alvarez — octubre 2026"), "intereses");
assert.equal(g("Profesionales", "Profesionales", "Natalia Inga (consultora) — octubre 2026"), "consultoria");
assert.equal(g("Profesionales", "Profesionales", "Honorarios contador (Agustín Musso) — octubre"), "administrativos");
assert.equal(g("Local y servicios", "Alquiler", "Alquiler — octubre 2026"), "administrativos");
assert.equal(clasificarGasto({ grupo: null, categoria: "premios", descripcion: "Premio julio — Sebastián Pereyra" }), "colaboradores_lsj", "sin grupo: por categoría");

// ── Líneas del banco ──
const b = (clasificacion: string, subtipo: string | null, extra: Partial<LineaBancoCont> = {}): LineaBancoCont =>
  ({ id: "x", fecha: "2026-09-10", descripcion: "", monto: 100, tipo: "debito", clasificacion, subtipo, ...extra });
assert.equal(clasificarLineaBanco(b("gasto_bancario", "comision")), "bancarios");
assert.equal(clasificarLineaBanco(b("gasto_bancario", "comision", { match_movimiento_id: "m1" })), null, "ya está cargada como gasto");
assert.equal(clasificarLineaBanco(b("impuesto", "ley_25413")), "ley_25413");
assert.equal(clasificarLineaBanco(b("impuesto", "sircreb")), "sircreb");
assert.equal(clasificarLineaBanco(b("impuesto", "iva")), "iva_banco");
assert.equal(clasificarLineaBanco(b("intereses", "intereses", { tipo: "credito" })), "intereses");
assert.equal(clasificarLineaBanco(b("intereses", null, { tipo: "credito" })), null, "reintegro de tarjeta: no es interés");
assert.equal(clasificarLineaBanco(b("cobro", null)), null);

// ── Estado de resultados ──
const tcDia = (f: string) => (f.startsWith("2026-10") ? 1500 : null);
const gastos: GastoCont[] = [
  { id: "1", fecha: "2026-10-07", descripcion: "Premio septiembre — Jerónimo Casadidio", categoria: "Premios", grupo: "Premios", monto: 200_000, moneda: "ARS" },
  { id: "2", fecha: "2026-10-05", descripcion: "Sueldo Mariana Santinelli — octubre 2026", categoria: "Sueldos", grupo: "Personal", monto: 1_500_000, moneda: "ARS" },
  { id: "3", fecha: "2026-10-10", descripcion: "Anthropic (Claude) — suscripción — octubre 2026", categoria: "Operativos", grupo: "Operativos", monto: 20, moneda: "USD" },
  { id: "4", fecha: "2026-09-20", descripcion: "Google — suscripción", categoria: "Operativos", grupo: "Operativos", monto: 10, moneda: "USD" },
  { id: "5", fecha: "2026-10-12", descripcion: "Alquiler personal Augusto — octubre", categoria: "Personales", grupo: "Personales", monto: 1_000_000, moneda: "ARS" },
  { id: "6", fecha: "2026-10-16", descripcion: "Interés préstamo José Alvarez — octubre 2026", categoria: "Financieros", grupo: "Bancos y financieros", monto: 150_000, moneda: "ARS" },
  { id: "7", fecha: "2026-11-07", descripcion: "Premio octubre — Sebastián Pereyra", categoria: "Premios", grupo: "Premios", monto: 400_000, moneda: "ARS" },
  { id: "8", fecha: "2026-08-07", descripcion: "Premio julio — Sebastián Pereyra", categoria: "Premios", grupo: "Premios", monto: 999, moneda: "ARS" },
];
const lineasBanco: LineaBancoCont[] = [
  b("gasto_bancario", "mantenimiento", { fecha: "2026-09-30", monto: 28_000 }),
  b("gasto_bancario", "comision", { fecha: "2026-10-30", monto: 5_000, match_movimiento_id: "m" }),
  b("impuesto", "ley_25413", { fecha: "2026-10-03", monto: 60_000 }),
  b("intereses", "intereses", { fecha: "2026-10-01", monto: 35, tipo: "credito" }),
];
const er = estadoDeResultados({
  periodos: ["2026-09", "2026-10"],
  base: {
    "2026-09": { ventas: 10_000_000, costo: 7_000_000, transportes: 100_000, avisosCosto: 0 },
    "2026-10": { ventas: 20_000_000, costo: 19_000_000, transportes: 0, avisosCosto: 2 },
  },
  gastos, lineasBanco, tcDia, iibbPct: 3,
  estimados: {
    "2026-09": { premios: [{ persona: "Jerónimo Casadidio", monto: 1 }], comisionJose: 5 }, // antes de DESDE_ESTIMADOS: no cuenta
    "2026-10": { premios: [{ persona: "Mariana Santinelli", monto: 400_000 }], comisionJose: 300_000 },
  },
});
const L = (id: string) => er.lineas.find((l) => l.id === id)!;
const F = (id: string) => er.fuera.find((l) => l.id === id)!;
assert.deepEqual(L("ventas").valores, { "2026-09": 10_000_000, "2026-10": 20_000_000 });
assert.equal(L("ventas").total, 30_000_000);
assert.deepEqual(L("costo_mercaderia").valores, { "2026-09": -7_000_000, "2026-10": -19_000_000 });
assert.equal(L("transportes").valores["2026-09"], -100_000);
// Premio de septiembre pagado en octubre → septiembre; el de octubre pagado en noviembre → octubre; el de julio, fuera de rango.
assert.equal(L("colaboradores_lsj").valores["2026-09"], -200_000);
assert.equal(L("colaboradores_lsj").valores["2026-10"], -400_000);
// Mariana: sueldo + premio estimado de octubre.
assert.equal(L("colaborador_m").valores["2026-10"], -1_900_000);
assert.ok(L("colaborador_m").detalle["2026-10"].some((d) => d.origen === "estimado"));
assert.equal(L("comisiones").valores["2026-10"], -300_000);
assert.equal(L("comisiones").valores["2026-09"], 0, "antes de octubre no se estima");
// US$ al TC del día; sin TC no suma y avisa.
assert.equal(L("administrativos").valores["2026-10"], -30_000);
assert.equal(L("administrativos").valores["2026-09"], 0);
assert.ok(er.avisos.some((a) => a.includes("sin cotización")));
assert.ok(er.avisos.some((a) => a.includes("octubre 2026: 2 factura")));
// Banco: mantenimiento suma; la comisión vinculada no (ya es un gasto).
assert.equal(L("bancarios").valores["2026-09"], -28_000);
assert.equal(L("bancarios").valores["2026-10"], 0);
// Intereses: el gasto resta, el ganado suma.
assert.equal(L("intereses").valores["2026-10"], -149_965);
// IIBB 3% de las ventas.
assert.deepEqual(L("iibb").valores, { "2026-09": -300_000, "2026-10": -600_000 });
assert.equal(er.faltaPctIibb, false);
// Subtotales septiembre: 10M − 7M − 0,1M − 0,2M − 0,3M = 2,4M bruto; − 0,028M = 2,372M operativo; Ganancias 25%.
assert.equal(er.subtotales.bruto.valores["2026-09"], 2_400_000);
assert.equal(er.subtotales.operativo.valores["2026-09"], 2_372_000);
assert.equal(er.subtotales.antes_ganancias.valores["2026-09"], 2_372_000);
assert.equal(L("ganancias").valores["2026-09"], -593_000);
assert.equal(er.subtotales.neto.valores["2026-09"], 1_779_000);
assert.equal(er.margenBruto["2026-09"], 24);
// Octubre da pérdida: Ganancias en + (descuenta del acumulado).
const antesOct = er.subtotales.antes_ganancias.valores["2026-10"];
assert.ok(antesOct < 0);
assert.equal(L("ganancias").valores["2026-10"], Math.round(-antesOct * 0.25 * 100) / 100);
assert.equal(er.subtotales.neto.total, Math.round((er.subtotales.neto.valores["2026-09"] + er.subtotales.neto.valores["2026-10"]) * 100) / 100);
// Fuera del resultado.
assert.equal(F("retiros").valores["2026-10"], -1_000_000);
assert.equal(F("ley_25413").valores["2026-10"], -60_000);

// Sin % de IIBB: línea en 0 y avisa.
const sinPct = estadoDeResultados({ periodos: ["2026-09"], base: { "2026-09": { ventas: 1000, costo: 0, transportes: 0, avisosCosto: 0 } }, gastos: [], lineasBanco: [], tcDia, iibbPct: null });
assert.equal(sinPct.faltaPctIibb, true);
assert.equal(sinPct.lineas.find((l) => l.id === "iibb")!.total, 0);

// Meses del año y planilla.
assert.deepEqual(mesesDelAnio("2026-03"), ["2026-01", "2026-02", "2026-03"]);
const planilla = planillaER(er, (p) => p);
assert.deepEqual(planilla[0], ["Línea", "2026-09", "2026-10", "Acumulado", "% s/ventas"]);
assert.deepEqual(planilla[1], ["Ventas", 10_000_000, 20_000_000, 30_000_000, 100]);
assert.ok(planilla.some((f) => f[0] === "Resultado neto"));

assert.equal(IIBB_PCT_NATI, 6, "IIBB y Seguridad e Higiene: 6% de las ventas (Nati 29/10)");
assert.equal(TASA_GANANCIAS, 0.25);

console.log("test-contabilidad OK");

