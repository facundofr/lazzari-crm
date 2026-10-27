import { armarLineaSicore, LONGITUD_REGISTRO_SICORE, montoSicore, fechaSicore } from "../src/lib/sicore-linea";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
ok(montoSicore(1234.5, 16) === "0000000001234,50", "monto 16");
ok(montoSicore(2000, 14) === "00000002000,00", "monto 14");
ok(fechaSicore("2026-10-05") === "05/10/2026", "fecha");
// Línea real del archivo que acepta el contador (cpsicore.txt, 13/10/2026): tiene que salir idéntica.
const real = "0601/09/2026   00000000282830000005680000,00 217 78100004694214,8801/09/202601 00000089404,30000,00          8020275394069         00000000000000                              00000000000000000000000";
ok(armarLineaSicore({ fecha: "2026-09-01", numeroComprobante: "28283", importeComprobante: 5680000, baseCalculo: 4694214.88, importeRetencion: 89404.30, cuit: "20275394069" }) === real, "igual a la línea del contador");
const l = armarLineaSicore({ fecha: "2026-10-05", numeroComprobante: "OP-0000123", importeComprobante: 1210000, conceptoRetencion: "transporte", baseCalculo: 100000, importeRetencion: 250, cuit: "30-71234567-8" });
ok(l.length === LONGITUD_REGISTRO_SICORE && l.length === 198, "largo 198, dio " + l.length);
const campo = (d: number, n: number) => l.slice(d - 1, d - 1 + n);
ok(campo(13, 16) === "   0000000000123", "nro comprobante");
ok(campo(45, 4) === " 217" && campo(49, 3) === " 95" && campo(52, 1) === "1", "impuesto, régimen transporte, operación");
ok(campo(79, 1) === " " && campo(100, 10) === "          ", "suspendidos y boletín vacíos");
ok(campo(112, 20) === "30712345678         ", "cuit");
// Mejora H: el régimen anotado en la OP manda sobre el concepto de hoy (OP-000049: se calculó como bienes)
const anotada = armarLineaSicore({ fecha: "2026-10-07", numeroComprobante: "OP-000049", importeComprobante: 323353.35, conceptoRetencion: "transporte", regimen: "078", baseCalculo: 267234.18, importeRetencion: 1835.9, cuit: "30-71234567-8" });
ok(anotada.slice(48, 51) === " 78" && anotada.length === 198, "régimen anotado");
ok(armarLineaSicore({ fecha: "2026-10-07", numeroComprobante: "1", importeComprobante: 1, conceptoRetencion: "transporte", regimen: null, baseCalculo: 1, importeRetencion: 1, cuit: "20123456789" }).slice(48, 51) === " 95", "sin anotar: el concepto");
// largo fijo aunque el nombre/número sean raros
ok(armarLineaSicore({ fecha: "2026-01-31", numeroComprobante: "", importeComprobante: 0, baseCalculo: 0, importeRetencion: 0.5, cuit: "20123456789", conceptoRetencion: "inexistente" }).length === 198, "largo con datos vacíos");
console.log("OK sicore-linea");
