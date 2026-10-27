import { claseRenglon, desdeSinConcepto, sugerirConcepto } from "../src/lib/sugerir-concepto";
import { ALICUOTA_POR_CONCEPTO } from "../src/lib/retencion-conceptos";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };

// Casos reales de Lazzari (27/10/2026), con lo que dicen sus facturas de compra
const deposito = sugerirConcepto({ renglones: ["ALMACENAJE DE MERCADERIA DE IMPORTACION", "ENTREGA DE MERCADERIA DE IMPORTACION (A)", "HABILITACION DE DEPOSITO FISCAL (IMPO)", "VERIFICACION DE IMPORTACION (A)"] });
ok(deposito.concepto === "servicios" && deposito.motivo.startsWith("3 de 4 renglones"), "Depósito Fiscal: servicios " + JSON.stringify(deposito));
ok(sugerirConcepto({ renglones: ["Bolson De 1m3 De Binder", "Flete Zona 3", "Ripio con arena 5 m3 km.8/16", "Bolson De 1m3 De Binder"] }).concepto === "compraventa_bienes", "Matcom: bienes con un flete");
ok(sugerirConcepto({ esTransportista: true, renglones: ["FLETES GENERALES", "SEGURO POR VALOR DECLARADO"] }).concepto === "transporte", "Sinpostre: transportista");
const rapido = sugerirConcepto({ esTransportista: true, renglones: [] });
ok(rapido.concepto === "transporte" && rapido.motivo === "Marcado como transportista", "Rápido Plus Ultra: transportista sin renglones");
const milonguitas = sugerirConcepto({ renglones: ["Factura (sin detalle de artículos)"] });
ok(milonguitas.concepto === null && milonguitas.motivo === "Facturas sin detalle", "Milonguitas: sin detalle");
ok(sugerirConcepto({ renglones: [] }).motivo === "Sin facturas cargadas", "Manuel Gubia: sin facturas");
const rafada = sugerirConcepto({ renglones: ["Factura (sin detalle de artículos)", "LUBRICANTE W40 X 311 GRS"] });
ok(rafada.concepto === "compraventa_bienes" && rafada.motivo.startsWith("1 de 1 renglón:"), "Rafada: el renglón con detalle " + rafada.motivo);
ok(sugerirConcepto({ renglones: ["Honorarios profesionales - Septiembre 2026"] }).concepto === "honorarios", "honorarios");
ok(sugerirConcepto({ renglones: ["Por viajes realizados desde Aeropuerto", "Factura de transporte"] }).concepto === "transporte", "viajes y factura de transporte");
ok(sugerirConcepto({ renglones: ["Guantes de nitrilo", "Servicio de bordado"] }).concepto === "compraventa_bienes", "empate: bienes");

// Lo propio del rubro no es servicio
ok(claseRenglon("ANTEOJOS DE SEGURIDAD CON CRISTAL FOTOCROMATICO") === "compraventa_bienes", "anteojos de seguridad: bienes");
ok(claseRenglon("Nota de crédito (sin detalle de artículos)") === null && claseRenglon("  ") === null && claseRenglon(null) === null, "sin detalle");
ok(claseRenglon("MANTENIMIENTO DE AUTOELEVADOR") === "servicios" && claseRenglon("ALMACENAJE") === "servicios", "servicios");

ok(desdeSinConcepto("2026-10-27") === "2026-09-01" && desdeSinConcepto("2027-01-15") === "2026-12-01", "desde: 1° del mes anterior");
ok(ALICUOTA_POR_CONCEPTO.compraventa_bienes === 2 && ALICUOTA_POR_CONCEPTO.transporte === 0.25 && ALICUOTA_POR_CONCEPTO.servicios === 2, "alícuota como la ficha");
console.log("OK sugerir-concepto");
