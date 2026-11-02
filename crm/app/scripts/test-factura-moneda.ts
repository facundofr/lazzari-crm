import assert from "node:assert/strict";
import {
  puedeDestrabarFactura, modalidadFicha, modalidadFactura, modalidadContraFicha,
  fechaMinimaFactura, fechaAntesDeOc, sugerenciaFechaFactura, leyendaCotizacion, observacionesConCotizacion, avisoDolarBillete,
} from "../src/lib/factura-moneda";

// Roles que destraban (Augusto y Mariana, por rol)
assert.equal(puedeDestrabarFactura("super_admin"), true);
assert.equal(puedeDestrabarFactura("admin"), true);
assert.equal(puedeDestrabarFactura("administrativo"), true);
assert.equal(puedeDestrabarFactura("vendedor"), false);
assert.equal(puedeDestrabarFactura(null), false);

// Ficha del cliente
assert.equal(modalidadFicha("USD Divisa"), "divisas");
assert.equal(modalidadFicha("USD"), "billetes");
assert.equal(modalidadFicha("ARS"), null);
assert.equal(modalidadFicha(null), null);

// Manda la ficha sobre el presupuesto (Corteva: PR en billetes, ficha divisa → divisa)
assert.equal(modalidadFactura("USD Divisa", "billetes"), "divisas");
assert.equal(modalidadFactura("USD", "divisas"), "billetes");
assert.equal(modalidadFactura("ARS", "billetes"), "billetes");
assert.equal(modalidadFactura(null, null), "divisas");

assert.equal(modalidadContraFicha("USD Divisa", "billetes"), true);
assert.equal(modalidadContraFicha("USD Divisa", "divisas"), false);
assert.equal(modalidadContraFicha("ARS", "billetes"), false);

// Fecha mínima: ARCA 07/10, OC 09/10 → 09/10
assert.equal(fechaMinimaFactura("2026-10-07", "2026-10-09"), "2026-10-09");
assert.equal(fechaMinimaFactura("2026-10-07", "2026-10-01"), "2026-10-07");
assert.equal(fechaMinimaFactura("2026-10-07", null), "2026-10-07");
assert.equal(fechaAntesDeOc("2026-10-08", "2026-10-09"), true);
assert.equal(fechaAntesDeOc("2026-10-09", "2026-10-09"), false);
assert.equal(fechaAntesDeOc("2026-10-08", null), false);

// Sugerencia: hoy 12/10, OC 09/10, ARCA 07/10 → 09/10 (3 días antes)
assert.deepEqual(sugerenciaFechaFactura({ fecha: "2026-10-12", hoy: "2026-10-12", minFiscal: "2026-10-07", ocFecha: "2026-10-09" }), { fecha: "2026-10-09", dias: 3 });
assert.deepEqual(sugerenciaFechaFactura({ fecha: "2026-10-12", hoy: "2026-10-12", minFiscal: "2026-10-07" }), { fecha: "2026-10-07", dias: 5 });
assert.equal(sugerenciaFechaFactura({ fecha: "2026-10-09", hoy: "2026-10-12", minFiscal: "2026-10-07", ocFecha: "2026-10-09" }), null);
// OC con fecha futura: no se sugiere nada
assert.equal(sugerenciaFechaFactura({ fecha: "2026-10-12", hoy: "2026-10-12", minFiscal: "2026-10-07", ocFecha: "2026-10-20" }), null);

// Leyenda
assert.equal(leyendaCotizacion({ modalidad: "divisas", valor: 1535, fecha: "2026-10-09" }), "Cotización BNA dólar divisa venta del 09/10/2026: $ 1.535,00.");
assert.equal(
  leyendaCotizacion({ modalidad: "billetes", valor: 1500.5, fecha: "2026-10-09", conversion: { desde: "USD", hacia: "ARS" } }),
  "Cotización BNA dólar billete venta del 09/10/2026: $ 1.500,50 (precios convertidos de USD a ARS).",
);
assert.equal(observacionesConCotizacion("", "X."), "X.");
assert.equal(observacionesConCotizacion("Entrega en planta", "X."), "Entrega en planta\nX.");
assert.equal(observacionesConCotizacion("Entrega\nX.", "X."), "Entrega\nX.");
assert.equal(observacionesConCotizacion("Hola", null), "Hola");


// Aviso de dólar billete a un cliente divisa (auditoría 30/10): nunca frena, solo avisa.
assert.equal(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "USD", modalidad: "divisas", tc: 1511.5, tcDivisa: 1511.5 }), null);
assert.match(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "USD", modalidad: "billetes", tc: 1535 })!, /dólar billete/);
// FA 16-8 Corteva Seeds: divisa con TC 1.535 escrito a mano (billete).
assert.match(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "USD", modalidad: "divisas", tc: 1535, tcDivisa: 1511.5 })!, /más alto que el BNA divisa/);
assert.equal(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "USD", modalidad: "divisas", tc: 1513, tcDivisa: 1511.5 }), null);
assert.equal(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "ARS", modalidad: "billetes", tc: 0 }), null);
assert.equal(avisoDolarBillete({ fichaMoneda: "USD", moneda: "USD", modalidad: "billetes", tc: 1535, tcDivisa: 1511.5 }), null);
assert.equal(avisoDolarBillete({ fichaMoneda: "USD Divisa", moneda: "USD", modalidad: "divisas", tc: 1535, tcDivisa: null }), null);
console.log("test-factura-moneda OK");
