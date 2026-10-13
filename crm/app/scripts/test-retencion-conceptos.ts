import { calcularRetencionGanancias, RETENCION_DEFAULT } from "../src/lib/plan-pagos";
import { reglaPorConcepto, retencionEscala } from "../src/lib/retencion-conceptos";
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
console.log("OK retencion-conceptos");
