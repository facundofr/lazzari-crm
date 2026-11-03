import { convertirCostoPR, tcParaCosto, elegirDolares, dolarAtrasado, fechaDolarPresupuesto, etiquetaDolar, soloConfiables } from "../src/lib/dolar-presupuesto";
import { armarTcDelDia } from "../src/lib/finanzas-lazza";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };

// PR en pesos: US$ billete × billete, US$ divisa × divisa.
ok(convertirCostoPR(0.78, "USD", "ARS", 1535, 1517) === 0.78 * 1535, "US$ 0,78 billete × 1535");
ok(convertirCostoPR(2, "USD Divisa", "ARS", 1535, 1517) === 3034, "US$ 2 divisa × 1517");
ok(convertirCostoPR(2, "USD divisa", "ARS", 1535, 1517) === 3034, "'USD divisa' de la lista también es divisa");
ok(convertirCostoPR(2, "USD Divisa", "ARS", 1535, 0) === 3070, "sin divisa usa billete");
ok(convertirCostoPR(2, "USD", "ARS", 0, 1517) === 3034, "sin billete usa divisa");
ok(convertirCostoPR(1.09, "USD", "ARS", 0, 0) === 1.09, "sin dólar no convierte");
// PR en dólares: los dólares quedan igual, los pesos se dividen.
ok(convertirCostoPR(5, "USD Divisa", "USD", 1535, 0) === 5, "US$ en PR US$ queda igual");
ok(convertirCostoPR(3070, "ARS", "USD", 1535, 0) === 2, "pesos / billete en PR US$");
ok(convertirCostoPR(3034, "ARS", "USD", 0, 1517) === 2, "pesos / divisa en PR US$");
ok(convertirCostoPR(100, "ARS", "ARS", 1535, 1517) === 100, "pesos en PR pesos");
ok(tcParaCosto("USD", 1535, 1517) === 1535 && tcParaCosto("USD Divisa", 1535, 1517) === 1517, "tcParaCosto");

// Días hábiles: el 13/10/2026 (martes) usa el viernes 09/10 (12/10 feriado).
ok(fechaDolarPresupuesto("2026-10-13") === "2026-10-09", "13/10 → cierre 09/10 (12/10 feriado)");
ok(fechaDolarPresupuesto("2026-10-14") === "2026-10-13", "14/10 → 13/10");

// Elegir lo guardado: ignora DolarAPI (no distingue divisa/billete) y fechas posteriores.
const filas = [
  { fecha: "2026-10-12", tipo: "oficial_divisas", valor_venta: "1535", fuente: "dolarapi_cron", es_manual: false },
  { fecha: "2026-10-12", tipo: "oficial_billetes", valor_venta: "1535", fuente: "dolarapi_cron", es_manual: false },
  { fecha: "2026-10-09", tipo: "oficial_billetes", valor_venta: "1535", fuente: "BNA histórico v2", es_manual: false },
  { fecha: "2026-10-09", tipo: "oficial_divisas", valor_venta: "1517", fuente: "BNA histórico v2", es_manual: false },
  { fecha: "2026-10-08", tipo: "oficial_divisas", valor_venta: "1515.5", fuente: "BNA histórico v2", es_manual: false },
];
const d = elegirDolares(filas, "2026-10-09");
ok(d.billete?.valor === 1535 && d.divisa?.valor === 1517 && d.divisa?.fecha === "2026-10-09", "toma el BNA del 09/10");
ok(!dolarAtrasado(d.divisa, "2026-10-09") && dolarAtrasado(d.divisa, "2026-10-13"), "atrasado si es más viejo");
ok(elegirDolares(filas, "2026-10-08").billete === null, "sin billete verificado → null (cartel)");
ok(etiquetaDolar("billete", d.billete) === "billete $ 1.535 · cierre 09/10", etiquetaDolar("billete", d.billete));
// P23: el dólar del día de Finanzas e Inicio (el último hasta hoy) descarta la fila del 12/10 (divisa = billete, DolarAPI).
ok(elegirDolares(filas, "2026-10-12").divisa?.valor === 1517 && elegirDolares(filas, "2026-10-12").divisa?.fecha === "2026-10-09", "12/10: toma el BNA del 09/10, no la de DolarAPI");
// Reportes e IVA (dólar del día de cada comprobante): solo con las confiables.
const divisas = filas.filter((f) => f.tipo === "oficial_divisas");
ok(soloConfiables(divisas).length === 2, "soloConfiables saca la del 12/10");
ok(armarTcDelDia(soloConfiables(divisas))("2026-10-13") === 1517, "comprobante del 13/10 → 1517 (no 1535)");
ok(soloConfiables([{ fuente: "dolarapi_cron", es_manual: true }]).length === 1, "una cargada a mano vale");
console.log("TODO OK");
