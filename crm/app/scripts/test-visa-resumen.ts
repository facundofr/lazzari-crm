// Prueba rápida: npx tsx scripts/test-visa-resumen.ts
// Renglones tomados del resumen de la Visa BBVA de octubre 2026 (cierre 29/10), tal como los arma renglonesDePdf.
import assert from "node:assert/strict";
import { claseSugerida, comercioDe, fechaResumen, leerResumenTarjeta, renglonesDePdf } from "../src/lib/visa-resumen";
import { cruzarConsumos, resumenCruce, sugerirOc, type ConsumoCruce, type MovimientoCruce } from "../src/lib/visa-cruce";

const TEXTO = `Tarjetas de Crédito
CIERRE ACTUAL | VENCIMIENTO ACTUAL | SALDO ACTUAL $ | SALDO ACTUAL U$S | PAGO MÍNIMO $
29-Oct-26 | 11-Nov-26 | 7.827.968,12 | 374,18 | 795.900,00
SALDO ANTERIOR | 9.780.220,05 | 147,20
TOTAL CONSUMOS DE AUGUSTO LAZZARI | 7.504.544,68 | 374,18
DETALLE
Sus pagos y ajustes realizados
09-Oct-26 | SU PAGO EN PESOS | -4.694.598,40
Consumos Augusto Lazzari
FECHA | DESCRIPCIÓN | NRO. CUPÓN | PESOS | DÓLARES
18-Sep-26 | MERPAGO*MERCADOLIBRE | C.02/03 | 322529 | 52.820,00
29-Sep-26 | MERPAGO*MERCADOLIBRE | C.02/03 | 136605 | 28.077,66
01-Oct-26 | Google Workspace A27320402USD | 100,80 | 113306 | 100,80
02-Oct-26 | CLARO DEB AUT | 000021795650363 | 000001 | 20.394,01
08-Oct-26 | MERPAGO*MERCADOLIBRE | 577808 | 21.597,00
08-Oct-26 | MERPAGO*MERCADOLIBRE | 577810 | 125.000,00
09-Oct-26 | SUPABASE | USD | 25,00 | 005154 | 25,00
09-Oct-26 | ANTHROPIC* CLAUD in1UOSc9BUSD | 75,00 | 044400 | 75,00
15-Oct-26 | MERPAGO*BOSSH | 440946 | 18.900,00
Banco BBVA Argentina S.A. - IVA Responsable Inscripto CUIT Nro. 30-50000319-3
FECHA | DESCRIPCIÓN | NRO. CUPÓN | PESOS | DÓLARES
16-Oct-26 | SMG CIA ARG DE SE000983334 | -0 | 000001 | 18.888,67
21-Oct-26 | MERPAGO*MERCADOLIBRE | 806467 | 41.804,40
22-Oct-26 | MERPAGO*BOSSH | 213873 | 18.900,00
27-Oct-26 | MERPAGO*MERCADOLIBRE | 032713 | -41.804,40
TOTAL CONSUMOS DE AUGUSTO LAZZARI | 304.577,34 | 200,80
Impuestos, cargos e intereses
FECHA | DESCRIPCIÓN | PESOS | DÓLARES
29-Oct-26 | IMPUESTO DE SELLOS | $ | 92.926,93
29-Oct-26 | DB IVA $ 21% | 113.913,16 | 23.921,76
29-Oct-26 | IIBB PERCEP-BSAS 2,00%( | 15836,34) | 316,72
SALDO ACTUAL | 7.827.968,12 | 374,18`;

// 1. Cabecera, consumos, cuotas, dólares, devoluciones y cargos; el total del resumen cierra.
assert.equal(fechaResumen("29-Oct-26"), "2026-10-29");
assert.equal(fechaResumen("05-Ago-26"), "2026-08-05");
const r = leerResumenTarjeta(TEXTO);
assert.equal(r.cierre, "2026-10-29");
assert.equal(r.vencimiento, "2026-11-11");
assert.equal(r.saldoArs, 7827968.12);
assert.equal(r.saldoUsd, 374.18);
assert.equal(r.minimoArs, 795900);
const consumos = r.consumos.filter((c) => c.tipo === "consumo");
const cargos = r.consumos.filter((c) => c.tipo === "cargo");
assert.equal(consumos.length, 13, "los pagos (SU PAGO) no son consumos");
assert.deepEqual(cargos.map((c) => c.importe), [92926.93, 23921.76, 316.72], "el cargo es el último número (el primero es la base)");
assert.deepEqual(r.sumaConsumos, { ars: 304577.34, usd: 200.8 });
assert.equal(r.cierra, true, "la suma da el TOTAL CONSUMOS del resumen");
const sep = consumos[0];
assert.deepEqual([sep.fecha, sep.cuotaN, sep.cuotaDe, sep.cupon, sep.importe, sep.moneda], ["2026-09-18", 2, 3, "322529", 52820, "ARS"]);
const google = consumos.find((c) => c.descripcion.startsWith("Google"))!;
assert.deepEqual([google.moneda, google.importe, google.cupon], ["USD", 100.8, "113306"]);
assert.equal(consumos.find((c) => c.descripcion === "SUPABASE")!.moneda, "USD");
assert.equal(consumos.find((c) => c.importe < 0)!.importe, -41804.4, "la devolución queda en negativo");
assert.equal(new Set(r.consumos.map((c) => c.clave)).size, r.consumos.length, "cada renglón tiene su clave");
// Si falta un renglón, no cierra.
assert.equal(leerResumenTarjeta(TEXTO.replace("15-Oct-26 | MERPAGO*BOSSH | 440946 | 18.900,00\n", "")).cierra, false);
// Dos renglones iguales (mismo día, comercio, cupón e importe) no se pisan.
const dos = leerResumenTarjeta("Consumos X\n15-Oct-26 | MERPAGO*ANDREANI | 301365 | 13.663,07\n15-Oct-26 | MERPAGO*ANDREANI | 301365 | 13.663,07\nTOTAL CONSUMOS DE X | 27.326,14");
assert.equal(dos.cierra, true);
assert.notEqual(dos.consumos[0].clave, dos.consumos[1].clave);

// 2. Comercio (para clasificar una vez) y la clase sugerida.
assert.equal(comercioDe("WWW.NESPRESSO.COM"), "NESPRESSO");
assert.equal(comercioDe("WWW.FRAVEGA.COM-PROM"), "FRAVEGA");
assert.equal(comercioDe("ANTHROPIC* CLAUD in1UOSc9BUSD"), "ANTHROPIC");
assert.equal(comercioDe("AUTOPISTAS DEL S 960003793091201"), "AUTOPISTAS DEL S");
assert.equal(comercioDe("Google Workspace A27320402USD"), "GOOGLE WORKSPACE");
assert.equal(comercioDe("MERPAGO*BOSSH"), "MERPAGO*BOSSH");
assert.equal(claseSugerida("MERPAGO*MERCADOLIBRE"), "compra");
assert.equal(claseSugerida("MERPAGO*TIENDANUBE"), "servicio");
assert.equal(claseSugerida("CLARO DEB AUT"), "servicio");
assert.equal(claseSugerida("NESPRESSO"), null, "lo que no se sabe lo decide Augusto");

// 3. Renglones de pdfjs: misma altura = mismo renglón; columnas separadas con " | ".
assert.equal(renglonesDePdf([[{ str: "08-Oct-26", x: 30, y: 500 }, { str: "MERPAGO*BOSSH", x: 90, y: 501 }, { str: "18.900,00", x: 400, y: 500 }, { str: "otro", x: 30, y: 480 }]]),
  "08-Oct-26 | MERPAGO*BOSSH | 18.900,00\notro");

// 4. Cruce con lo pagado con la Visa en el CRM.
let n = 0;
const C = (x: Partial<ConsumoCruce>): ConsumoCruce => ({ id: String(++n), fecha: "2026-10-08", descripcion: "MERPAGO*MERCADOLIBRE", comercio: "MERPAGO*MERCADOLIBRE",
  cuotaN: null, cuotaDe: null, importe: 0, moneda: "ARS", tipo: "consumo", clase: "compra", facturaCompraId: null, sinFactura: null, ...x });
const M = (x: Partial<MovimientoCruce>): MovimientoCruce => ({ id: `m${++n}`, fecha: "2026-10-08", monto: 0, moneda: "ARS", facturaCompraId: null, proveedor: "", descripcion: "", factura: null, ...x });
const exacto = C({ importe: 21597 });
const cuotas = C({ fecha: "2026-10-14", importe: 59163.34, cuotaN: 1, cuotaDe: 3 });
const centavos = C({ descripcion: "MERPAGO*BULCORSRL", comercio: "MERPAGO*BULCORSRL", fecha: "2026-10-05", importe: 78000 });
const otroImporte = C({ descripcion: "CLARO DEB AUT", comercio: "CLARO DEB AUT", fecha: "2026-10-02", importe: 20394.01, clase: "servicio" });
const anterior = C({ fecha: "2026-09-18", importe: 52820, cuotaN: 2, cuotaDe: 3 });
const falta = C({ importe: 125000 });
const ida = C({ fecha: "2026-10-21", importe: 41804.4 });
const vuelta = C({ fecha: "2026-10-27", importe: -41804.4 });
const aMano = C({ importe: 760440, facturaCompraId: "fc9" });
const noTiene = C({ importe: 18900, sinFactura: "Pagó Seba" });
const cargo = C({ tipo: "cargo", descripcion: "IMPUESTO DE SELLOS", importe: 92926.93, clase: null });
const lejos = C({ fecha: "2026-10-01", importe: 5000 });
const movs = [
  M({ fecha: "2026-10-22", monto: 21597, facturaCompraId: "fc1", proveedor: "Fabedam S.R.L." }),
  M({ fecha: "2026-10-14", monto: 177490, facturaCompraId: "fc2", proveedor: "Mundo Autopartes S.R.L." }),
  M({ fecha: "2026-10-05", monto: 77999.4, facturaCompraId: "fc3", proveedor: "Bulcor SRL" }),
  M({ fecha: "2026-10-27", monto: 19822.49, descripcion: "Gasto — Operativos — Claro — teléfonos" }),
  M({ fecha: "2026-10-24", monto: 760000, facturaCompraId: "fc9", proveedor: "Vendedor real" }),
  M({ fecha: "2026-11-20", monto: 5000, facturaCompraId: "fc4" }),
];
const todos = [exacto, cuotas, centavos, otroImporte, anterior, falta, ida, vuelta, aMano, noTiene, cargo, lejos];
const cr = cruzarConsumos(todos, movs);
const e = (c: ConsumoCruce) => cr.get(c.id)!.estado;
assert.equal(e(exacto), "cruzado", "mismo importe, 14 días después");
assert.equal(e(cuotas), "cuotas", "59.163,34 × 3 = 177.490 (cargada entera)");
assert.equal(e(centavos), "centavos", "mismo comercio, 60 centavos (hasta 5 centavos es igual)");
assert.equal(e(otroImporte), "otro_importe");
assert.equal(cr.get(otroImporte.id)!.diferencia, 571.52);
assert.equal(e(anterior), "cuota_anterior");
assert.equal(e(falta), "falta");
assert.equal(e(ida), "devuelto");
assert.equal(e(vuelta), "devuelto");
assert.equal(e(aMano), "unido", "lo que unió una persona manda");
assert.equal(cr.get(aMano.id)!.mov?.facturaCompraId, "fc9");
assert.equal(cr.get(aMano.id)!.diferencia, 440);
assert.equal(e(noTiene), "sin_factura");
assert.equal(e(cargo), "cargo");
assert.equal(e(lejos), "falta", "más de 25 días no cruza");
// Un movimiento sirve para un solo consumo.
const dosIguales = cruzarConsumos([C({ importe: 21597 }), C({ importe: 21597 })], [M({ monto: 21597 })]);
assert.deepEqual([...dosIguales.values()].map((x) => x.estado).sort(), ["cruzado", "falta"]);
// Lo de la persona se aparta primero: el movimiento fc9 no se usa para otro consumo.
const libre = C({ importe: 760000 }), unida = C({ importe: 760440, facturaCompraId: "fc9" });
const r2 = cruzarConsumos([libre, unida], [M({ monto: 760000, facturaCompraId: "fc9" })]);
assert.deepEqual([r2.get(libre.id)!.estado, r2.get(unida.id)!.estado], ["falta", "unido"]);

const res = resumenCruce(todos, cr);
assert.equal(res.consumos, 11, "los cargos del banco no cuentan");
assert.equal(res.falta, 3, "falta, otro importe y la de 25 días");
assert.equal(res.faltaArs, 150394.01);

// 5. OC de Mercado Libre con el mismo importe con IVA (suma de sus artículos), fecha cercana; primero las que no tienen factura.
const arts = [
  { ocId: "o1", ocNumero: "OC-1", fecha: "2026-10-07", importe: 100000, moneda: "ARS" as const, conFactura: false },
  { ocId: "o1", ocNumero: "OC-1", fecha: "2026-10-07", importe: 25000, moneda: "ARS" as const, conFactura: false },
  { ocId: "o2", ocNumero: "OC-2", fecha: "2026-10-08", importe: 125000, moneda: "ARS" as const, conFactura: true },
  { ocId: "o3", ocNumero: "OC-3", fecha: "2026-08-01", importe: 125000, moneda: "ARS" as const, conFactura: false },
];
assert.equal(sugerirOc(falta, arts)?.ocNumero, "OC-1", "100.000 + 25.000; OC-2 ya tiene factura; OC-3 es de agosto");
assert.equal(sugerirOc({ ...cuotas, importe: 41666.67 }, [{ ...arts[2], ocId: "o9", importe: 125000.01, conFactura: false }])?.ocId, "o9", "en cuotas: la cuota × cantidad");
assert.equal(sugerirOc(C({ importe: 99999 }), arts), null);

console.log("test-visa-resumen: OK");
