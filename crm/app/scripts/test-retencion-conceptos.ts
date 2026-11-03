import { calcularRetencionGanancias, RETENCION_DEFAULT } from "../src/lib/plan-pagos";
import { importeRetencionOP, minimoDelConcepto, propuestaRetencionOP, reglaPorConcepto, retencionEscala } from "../src/lib/retencion-conceptos";
import { todayAR } from "../src/lib/utils";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
const cfg = RETENCION_DEFAULT; // aplica, mínimo bienes 224.000, 2 %, retención mínima 240
const f = "2026-10-15";
const calc = (concepto: string | null, condicion: string, base: number, previa = 0, retenido = 0, alic: number | null = null) =>
  calcularRetencionGanancias({ proveedor: { condicion_iva: condicion, concepto_retencion_ganancias: concepto, alicuota_ganancias: alic }, config: cfg, fecha: f, baseEstePago: base, baseMesPrevia: previa, retenidoMes: retenido });

// Bienes (y sin concepto = bienes): mínimo 224.000, 2 %
ok(calc(null, "RI", 200000).retencion === 0, "bienes bajo el mínimo");
ok(calc("compraventa_bienes", "RI", 324000).retencion === 2000, "bienes: (324.000-224.000)*2% = 2.000");
ok(calc(null, "RI", 324000).retencion === 2000, "sin concepto = bienes");
// Acumulado del mes menos lo ya retenido
ok(calc("compraventa_bienes", "RI", 100000, 324000, 2000).retencion === 2000, "bienes segundo pago: (424.000-224.000)*2% - 2.000 = 2.000");
// Servicios: mínimo 67.170, 2 %
ok(calc("servicios", "RI", 67170).retencion === 0, "servicios justo en el mínimo");
ok(calc("servicios", "RI", 167170).retencion === 2000, "servicios: 100.000*2% = 2.000");
// Transporte / fletes: mínimo 67.170, 0,25 % → 100.000*0,25% = 250 (≥ 240)
ok(calc("transporte", "RI", 167170).retencion === 250, "transporte 0,25 %");
ok(calc("fletes", "RI", 167170).retencion === 250, "fletes 0,25 %");
ok(calc("transporte", "RI", 100000).retencion === 0 && calc("transporte", "RI", 100000).motivo.includes("importe mínimo"), "transporte: 32.830*0,25% = 82 < 240, no retiene");
// Honorarios: escala sobre el excedente de 67.170
ok(retencionEscala(8000) === 400, "escala 8.000 = 400");
ok(retencionEscala(10000) === 400 + 2000 * 0.09, "escala 10.000");
ok(Math.abs(retencionEscala(100000) - (18640 + 4000 * 0.31)) < 1e-9, "escala 100.000");
ok(calc("honorarios", "RI", 67170 + 10000).retencion === 580, "honorarios 10.000 sobre el mínimo = 580");
// No inscriptos (monotributo, consumidor final): nunca se retiene
ok(calc("compraventa_bienes", "Monotributo", 5000000).retencion === 0 && !calc("compraventa_bienes", "Monotributo", 5000000).aplica, "monotributo no retiene");
ok(!calc("servicios", "CF", 5000000).aplica, "consumidor final no retiene");
// Concepto sin regla propia (alquiler): sigue con el mínimo de la sociedad y la alícuota del proveedor
ok(reglaPorConcepto("alquileres_inmuebles", 224000) === null, "alquiler sin regla propia");
ok(calc("alquileres_inmuebles", "RI", 324000, 0, 0, 10).retencion === 10000, "alquiler: mínimo de la sociedad y alícuota 10 % del proveedor");
// La sociedad que no retiene (Grupo LA)
ok(!calcularRetencionGanancias({ proveedor: { condicion_iva: "RI" }, config: { ...cfg, aplica_ganancias: false }, fecha: f, baseEstePago: 5000000, baseMesPrevia: 0, retenidoMes: 0 }).aplica, "Grupo LA no retiene");

// ── La cuenta que usa la Orden de pago (P08) ──
const prop = (o: Partial<Parameters<typeof propuestaRetencionOP>[0]>) => propuestaRetencionOP({ proveedor: { condicion_iva: "RI" }, condicionIva: "RI", aplicaSociedad: true,
  minimoBienes: 224000, tasaGlobal: 2, fecha: "2026-10-15", basePrevia: 0, baseEstaOP: 0, ...o });
const imp = (o: Partial<Parameters<typeof importeRetencionOP>[0]>) => importeRetencionOP({ aplica: true, pct: 2, minimo: 224000, basePrevia: 0, baseEstaOP: 0, retenidoMes: 0, minimoRetencion: 240, ...o });
// Bienes: primera OP que cruza el mínimo (base sujeta = excedente) y segunda del mes (toda su base, menos lo retenido).
ok(prop({ baseEstaOP: 324000 }).aplica && prop({ baseEstaOP: 324000 }).pct === 2, "OP bienes: retiene 2 %");
ok(!prop({ baseEstaOP: 200000 }).aplica, "OP bienes bajo el mínimo");
{ const r = imp({ baseEstaOP: 324000 }); ok(r.baseGanancias === 100000 && r.retencion === 2000, "OP: cruza el mínimo"); }
{ const r = imp({ basePrevia: 324000, baseEstaOP: 100000, retenidoMes: 2000 }); ok(r.baseGanancias === 100000 && r.retencion === 2000, "OP: segunda del mes"); }
ok(imp({ baseEstaOP: 230000 }).retencion === 0 && imp({ baseEstaOP: 230000 }).bruta === 120, "art. 29: 120 < 240 no se retiene");
ok(imp({ baseEstaOP: 230000, manual: 99.999 }).retencion === 100, "importe a mano manda (redondeado al centavo)");
ok(imp({ aplica: false, baseEstaOP: 5000000 }).retencion === 0, "sin aplicar no retiene");
// Honorarios en escala: 67.170 + 10.000 → alícuota de la escala 5,8 % → 580, igual que la escala.
{ const p = prop({ proveedor: { condicion_iva: "RI", concepto_retencion_ganancias: "honorarios" }, baseEstaOP: 77170 });
  ok(p.aplica && p.pct === 5.8, "honorarios: alícuota de la escala");
  ok(imp({ pct: p.pct, minimo: minimoDelConcepto("honorarios", 224000), baseEstaOP: 77170 }).retencion === 580, "honorarios: 580"); }
// Exclusión que vence entre la fecha de la OP y hoy: vale la de la OP.
{ const proveedor = { condicion_iva: "RI", exclusion_retencion: true, exclusion_retencion_hasta: "2026-10-20" };
  ok(prop({ proveedor, fecha: "2026-10-15", baseEstaOP: 5000000 }).excluido, "OP del 15/10 con exclusión hasta el 20/10: excluido");
  ok(!prop({ proveedor, fecha: "2026-10-25", baseEstaOP: 5000000 }).excluido && prop({ proveedor, fecha: "2026-10-25", baseEstaOP: 5000000 }).aplica, "OP del 25/10: ya no"); }
// No inscripto o sociedad que no retiene
ok(!prop({ condicionIva: "Monotributo", baseEstaOP: 5000000 }).aplica, "monotributo");
ok(!prop({ aplicaSociedad: false, baseEstaOP: 5000000 }).aplica, "Grupo LA");
// OP a las 22:00 del último día del mes: en UTC ya es el 1°; la fecha (y el mes del acumulado) es la de Argentina.
ok(todayAR(new Date("2026-11-01T01:00:00Z")) === "2026-10-31", "22:00 del 31/10 en Argentina sigue siendo 31/10");
ok(todayAR(new Date("2026-11-01T01:00:00Z")).slice(0, 7) === "2026-10", "el acumulado es de octubre");

console.log("OK retencion-conceptos");
