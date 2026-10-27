import { columnasRetencionCongelada, detalleRetencion, diferenciasConHoy, pagosAnteriores, pctTexto, retencionCongelada, type PagoDelMes } from "../src/lib/certificado-retencion";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
const cfg = { minimoBienes: 224000, tasaSociedad: 2 };

// Pagos anteriores: mismo proveedor y mes, cargados antes (aunque tengan fecha posterior)
const p = (id: string, fecha: string, creado: string, base: number, retenido = 0, proveedor_id = "A"): PagoDelMes => ({ id, proveedor_id, fecha, creado, base, retenido });
const esta = p("op", "2026-10-07", "2026-10-07T15:00:00.123456+00:00", 267234.18);
const todos = [
  esta,
  p("antes", "2026-10-20", "2026-10-07T14:59:59.999999+00:00", 48560.86),       // fecha posterior, cargada antes: cuenta
  p("despues", "2026-10-02", "2026-10-07T15:00:01+00:00", 100000, 2000),         // cargada después: no
  p("otroMes", "2026-09-30", "2026-09-30T10:00:00+00:00", 500000, 5000),         // otro mes: no
  p("otroProv", "2026-10-01", "2026-10-01T10:00:00+00:00", 700000, 9000, "B"),  // otro proveedor: no
];
const ant = pagosAnteriores(esta, todos);
ok(ant.base === 48560.86 && ant.retenido === 0, "anteriores: solo lo cargado antes, mismo mes y proveedor " + JSON.stringify(ant));

// OP-000049 (Speed Business): se calculó como bienes (2 %, mínimo 224.000) y hoy el proveedor está en transporte
const op49 = detalleRetencion({ ...cfg, concepto: "transporte", alicuotaProveedor: null, bruto: 323353.35, base: 267234.18, pct: 2, retenido: 1835.9, anteriores: ant });
ok(op49.regimen === "095" && op49.regimenNombre.includes("transporte"), "régimen de hoy, el mismo del TXT");
ok(op49.acumulado === 315795.04, "acumulado del mes " + op49.acumulado);
ok(op49.minimo === 224000 && op49.sujeto === 91795.04 && op49.retencionAcumulada === 1835.9, "la cuenta que hizo la OP: (315.795,04 − 224.000) × 2 %");
ok(op49.minimoHoy === 67170 && op49.pctHoy === 0.25, "con el concepto de hoy: 0,25 % y mínimo 67.170");
const d49 = diferenciasConHoy(op49);
ok(d49.pct && d49.minimo, "avisa % y mínimo distintos");

// OP-000034 (Star-Tex, sin concepto): segundo pago del mes, resta lo retenido antes
const op34 = detalleRetencion({ ...cfg, concepto: "", bruto: 8990728.99, base: 7449461.16, pct: 2, retenido: 148989.22, anteriores: { base: 2207518.42, retenido: 39670.37 } });
ok(op34.regimen === "078" && op34.sinConcepto, "sin concepto = bienes 078");
ok(op34.minimo === 224000 && op34.sujeto === 9432979.58 && op34.retencionAcumulada === 188659.59, "sujeto y retención sobre el acumulado");
ok(op34.retenidoAntes === 39670.37 && op34.retenido === 148989.22, "retenido antes y en esta OP");
ok(!diferenciasConHoy(op34).pct && !diferenciasConHoy(op34).minimo, "sin diferencias");

// Bienes → hoy servicios: mismo 2 %, otro mínimo
const serv = detalleRetencion({ ...cfg, concepto: "servicios", bruto: 400000, base: 330000, pct: 2, retenido: 2120, anteriores: { base: 0, retenido: 0 } });
ok(serv.minimo === 224000 && serv.regimen === "094", "cierra con el mínimo de bienes");
ok(!diferenciasConHoy(serv).pct && diferenciasConHoy(serv).minimo, "avisa solo el mínimo");

// Honorarios: el % efectivo de la escala (10.000 sobre el mínimo = 580 → 5,8 %)
const hon = detalleRetencion({ ...cfg, concepto: "honorarios", bruto: 93375.7, base: 77170, pct: 5.8, retenido: 580, anteriores: { base: 0, retenido: 0 } });
ok(hon.escala && hon.minimo === 67170 && hon.regimen === "116", "honorarios por escala");
ok(!diferenciasConHoy(hon).pct && !diferenciasConHoy(hon).minimo, "honorarios sin diferencias");

// Alícuota propia del proveedor (Fravida: alquileres al 10 %): una OP al 2 % se avisa
const alq = detalleRetencion({ ...cfg, concepto: "alquileres_inmuebles", alicuotaProveedor: 10, bruto: 400000, base: 330000, pct: 2, retenido: 2120, anteriores: { base: 0, retenido: 0 } });
ok(alq.regimen === "031" && alq.pctHoy === 10 && diferenciasConHoy(alq).pct && !diferenciasConHoy(alq).minimo, "alícuota del proveedor");

// Importe escrito a mano: la cuenta no da con ningún mínimo → no hay cuenta para mostrar
const mano = detalleRetencion({ ...cfg, concepto: "compraventa_bienes", bruto: 400000, base: 330000, pct: 2, retenido: 1000, anteriores: { base: 0, retenido: 0 } });
ok(mano.minimo === null && mano.sujeto === null && mano.retencionAcumulada === null, "importe a mano: sin cuenta");
ok(!diferenciasConHoy(mano).minimo, "sin cuenta no se avisa el mínimo");
ok(!op34.congelada && op34.regimenHoy === op34.regimen && !diferenciasConHoy(op49).regimen, "sin anotar: va con el régimen de hoy");

// Mejora H: la OP anota cómo calculó la retención (columnas retencion_ganancias_*)
const cols = columnasRetencionCongelada({ concepto: " ", minimo: 224000, basePrevia: 48560.861, retenidoAntes: 0 });
ok(cols.retencion_ganancias_regimen === "078" && cols.retencion_ganancias_base_previa === 48560.86 && cols.retencion_ganancias_minimo === 224000 && cols.retencion_ganancias_retenido_antes === 0, "columnas: sin concepto = 078 y redondeo " + JSON.stringify(cols));
ok(columnasRetencionCongelada({ concepto: "transporte", minimo: 67170, basePrevia: 0, retenidoAntes: 0 }).retencion_ganancias_regimen === "095", "columnas: transporte = 095");
ok(retencionCongelada({ retencion_ganancias_regimen: null }) === null && retencionCongelada(null) === null, "sin anotar = null");
ok(retencionCongelada({ retencion_ganancias_regimen: "078", retencion_ganancias_minimo: "224000.00", retencion_ganancias_base_previa: null, retencion_ganancias_retenido_antes: "0" }) === null, "anotación incompleta = null");
const anot49 = retencionCongelada({ retencion_ganancias_regimen: "078", retencion_ganancias_minimo: "224000.00", retencion_ganancias_base_previa: "48560.86", retencion_ganancias_retenido_antes: "0.00" });
ok(!!anot49 && anot49.minimo === 224000 && anot49.basePrevia === 48560.86, "lee números que llegan como texto");

// OP-000049 anotada como se calculó (bienes): régimen 78 aunque hoy el proveedor esté en transporte, sin rearmar pagos
const c49 = detalleRetencion({ ...cfg, concepto: "transporte", alicuotaProveedor: null, bruto: 323353.35, base: 267234.18, pct: 2, retenido: 1835.9, congelada: anot49 });
ok(c49.congelada && c49.regimen === "078" && c49.regimenNombre.includes("bienes") && c49.regimenHoy === "095", "anotada: régimen con que se calculó");
ok(c49.basePrevia === 48560.86 && c49.acumulado === 315795.04 && c49.minimo === 224000 && c49.retencionAcumulada === 1835.9, "anotada: la misma cuenta");
const dc49 = diferenciasConHoy(c49);
ok(dc49.regimen && dc49.pct && dc49.minimo, "anotada con otro concepto hoy: avisa régimen, % y mínimo");
// Anotada y el proveedor sigue igual: sin avisos
const c34 = detalleRetencion({ ...cfg, concepto: null, bruto: 8990728.99, base: 7449461.16, pct: 2, retenido: 148989.22, congelada: { regimen: "078", minimo: 224000, basePrevia: 2207518.42, retenidoAntes: 39670.37 } });
ok(c34.minimo === 224000 && c34.retencionAcumulada === 188659.59 && !Object.values(diferenciasConHoy(c34)).some(Boolean), "anotada sin cambios: sin avisos");
// Anotada con importe a mano: el régimen queda, la cuenta no
const cMano = detalleRetencion({ ...cfg, concepto: "compraventa_bienes", bruto: 400000, base: 330000, pct: 2, retenido: 1000, congelada: { regimen: "078", minimo: 224000, basePrevia: 0, retenidoAntes: 0 } });
ok(cMano.regimen === "078" && cMano.minimo === null && cMano.retencionAcumulada === null, "anotada con importe a mano: sin cuenta");
// Honorarios anotados: el % de la escala
const cHon = detalleRetencion({ ...cfg, concepto: "compraventa_bienes", bruto: 93375.7, base: 77170, pct: 5.8, retenido: 580, congelada: { regimen: "116", minimo: 67170, basePrevia: 0, retenidoAntes: 0 } });
ok(cHon.escala && cHon.minimo === 67170 && cHon.regimen === "116", "honorarios anotados: escala aunque hoy sea bienes");

ok(pctTexto(0.25) === "0,25 %" && pctTexto(2) === "2 %", "texto del %");
console.log("OK certificado-retencion");
