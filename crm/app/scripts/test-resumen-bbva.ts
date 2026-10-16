// Prueba de lib/resumen-bbva.ts y lib/arca-recibidos.ts: npx tsx scripts/test-resumen-bbva.ts
// El texto es como lo devuelve pdfjs del resumen BBVA de septiembre 2026 (renglones reales).
import { leerResumenBbva, cruzarResumen, textoContraparte } from "../src/lib/resumen-bbva";
import { leerArcaRecibidos, facturaDelPago, numeroFactura } from "../src/lib/arca-recibidos";

let fallas = 0;
function ok(cond: boolean, msg: string) { if (!cond) { fallas++; console.error("✗", msg); } else console.log("✓", msg); }

const texto = `
RECIBIDAS   (información al: 30/09/2026)
FECHA   BANCO   EMPRESA(Orig)   SERVICIO   REFERENCIA   COTIZ.   MON   IMPORTE   CUENTA ORIGEN
10/09   0014   30999034515. Pergamino   MIN002   VARIOS 000000000021035   $   220.260,00   CC $ 091-312483/1
01/09   0017   0020119172560CASADEIROBERTO   TR. E/CTAS.BBVA-BF   VARIOS   $   780.208,00   CC $ 091-312483/1
02/09   BMBS   620146237283 ARGUILEZ/WALTER   TR. E/ CTAS. BBVA-BF   VARIOS botas de gom   $   177.870,00   CC $ 091-312483/1
29/09   016   30636021578CORTEVA AGRISCIEN   P.PROV.E/C OTROS B   VARIOS 2626514 2626514   $   15.994.806,07   CC $ 091-312483/1
ENVIADAS ACEPTADAS   (información al: 30/09/2026)
FECHA   DOCUMENTO / APELLIDO   NRO TRANSF   REFERENCIA   COTIZ.   MON   IMPORTE   CUENTA ORIGEN
30/09   20319639013 DONADIO   0000000000   VARIOS TR. E/CTAS.BBVA-   $   7.500.000,00   CC $ 091-312483/1
24/09   30718092511   0000000000   FACTURA   $   345.468,43   CC $ 091-312483/1
Sobre (274146) 1 de 1 / Página   10 de   16 Banco BBVA Argentina S.A. - IVA Responsable Inscripto CUIT Nro. 30-50000319-3
Débitos automáticos
REALIZADOS   (información al: 30/09/2026)
FECHA   EMPRESA   SERVICIO   REFERENCIA   FACTURA   COTIZ.   MON   IMPORTE   CUENTA
07/09   COOP E PER   ELECTRICO   113354000002   03A002300320444   $   212.762,65   CC $ 091-312483/1
10/09   DPR   PLANPORWEB   AA544RB   780101   AUT07801 P 0123   $   1.866,20   CC $ 091-312483/1
NOVEDADES   (información al: 30/09/2026)
11/09   FEDERACION   SEGUROS   0436118496000000140926   ADH. REALIZADA A CONFIRMAR POR EL ENTE   CC $ 091-312483/1
`;
const r = leerResumenBbva(texto);
ok(r.hasta === "2026-09-30" && r.items.length === 8, `lee 8 renglones (leyó ${r.items.length})`);
const muni = r.items.find((i) => i.importe === 220260)!;
ok(muni.seccion === "recibida" && muni.cuit === "30999034515" && muni.nombre === "Pergamino" && muni.fecha === "2026-09-10", "recibida con CUIT y nombre");
ok(r.items.find((i) => i.importe === 780208)!.cuit === "20119172560", "CUIT dentro de 0020119172560CASADEI");
ok(r.items.find((i) => i.importe === 177870)!.cuit === "20146237283", "CUIT dentro de 620146237283");
const don = r.items.find((i) => i.importe === 7500000)!;
ok(don.seccion === "enviada" && don.cuit === "20319639013" && don.nombre === "DONADIO" && don.fecha === "2026-09-30", "enviada con CUIT y apellido");
ok(r.items.find((i) => i.importe === 345468.43)!.cuit === "30718092511", "enviada solo con CUIT");
const luz = r.items.find((i) => i.importe === 212762.65)!;
ok(luz.seccion === "debito_automatico" && luz.nombre === "COOP E PER ELECTRICO" && luz.detalle.includes("03A002300320444"), "débito automático con empresa y factura");
ok(!r.items.some((i) => /FEDERACION/.test(i.nombre)), "NOVEDADES no se lee como débito");

const cruces = cruzarResumen(r.items, [
  { id: "a", fecha: "2026-10-01", importe: -7500000, cuentaDigitos: "0913124831" },
  { id: "b", fecha: "2026-09-30", importe: -7500000, cuentaDigitos: "0913124831" },
  { id: "c", fecha: "2026-09-10", importe: 220260, cuentaDigitos: "0913124831" },
  { id: "d", fecha: "2026-09-10", importe: -220260, cuentaDigitos: "0913124831" },
  { id: "e", fecha: "2026-09-07", importe: -212762.65, cuentaDigitos: "0913395493" },
]);
ok(cruces.find((c) => c.contraparte.cuit === "20319639013")?.linea_id === "b", "elige la línea de fecha más cercana");
ok(cruces.find((c) => c.linea_id === "c")?.contraparte.seccion === "recibida" && !cruces.some((c) => c.linea_id === "d"), "respeta entrada/salida");
ok(!cruces.some((c) => c.linea_id === "e"), "respeta la cuenta");
ok(textoContraparte(cruces.find((c) => c.linea_id === "b")!.contraparte).includes("DONADIO 20319639013"), "texto para el concepto");

const csv = `"Fecha de Emisión";"Tipo de Comprobante";"Punto de Venta";"Número Desde";"Número Hasta";"Cód. Autorización";"Tipo Doc. Emisor";"Nro. Doc. Emisor";"Denominación Emisor";"Tipo Doc. Receptor";"Nro. Doc. Receptor";"Tipo Cambio";"Moneda";"Imp. Neto Gravado IVA 0%";"IVA 2,5%";"Imp. Neto Gravado IVA 2,5%";"IVA 5%";"Imp. Neto Gravado IVA 5%";"IVA 10,5%";"Imp. Neto Gravado IVA 10,5%";"IVA 21%";"Imp. Neto Gravado IVA 21%";"IVA 27%";"Imp. Neto Gravado IVA 27%";"Imp. Neto Gravado Total";"Imp. Neto No Gravado";"Imp. Op. Exentas";"Otros Tributos";"Total IVA";"Imp. Total"
2026-08-06;11;1;526;526;1;80;20346149249;MUSSO AGUSTIN;80;20379309128;1,00;$;;;;;;;;;;;;0,00;0,00;0,00;0,00;0,00;165000,00
2026-09-03;11;1;540;540;1;80;20346149249;MUSSO AGUSTIN;80;20379309128;1,00;$;;;;;;;;;;;;0,00;0,00;0,00;0,00;0,00;165000,00
2026-09-24;1;7;24296;24296;1;80;30718092511;SANITARIOS SAN MARTIN S.A.;80;20379309128;1,00;$;;;;;;;;59957,00;285510,27;;;285510,27;0,00;0,00;0,00;59957,16;345468,43
2026-09-25;3;7;100;100;1;80;30718092511;SANITARIOS SAN MARTIN S.A.;80;20379309128;1,00;$;;;;;;;;;;;;0,00;0,00;0,00;0,00;0,00;1000,00`;
const fa = leerArcaRecibidos(csv);
ok(fa.length === 4 && fa[2].tipo === "FA" && fa[2].total === 345468.43 && fa[2].neto === 285510.27 && fa[3].esNC, "lee el CSV de ARCA");
const p1 = facturaDelPago("30718092511", 345468.43, "2026-09-24", fa);
ok(p1?.unica === true && numeroFactura(p1.factura) === "FA 00007-00024296", "factura única exacta");
const usadas = new Set<string>();
const m1 = facturaDelPago("20346149249", 165000, "2026-09-07", fa, usadas);
ok(m1?.factura.numero === 540 && m1.unica === false, "abono mensual: la más reciente antes del pago");
const m2 = facturaDelPago("20346149249", 165000, "2026-10-07", fa, usadas);
ok(m2?.factura.numero === 526, "no repite una factura ya usada");
ok(facturaDelPago("20346149249", 1, "2026-10-07", fa) === null, "sin coincidencia → null");

console.log(fallas ? `\n${fallas} fallas` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
