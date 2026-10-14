import { facturaDelMes } from "../src/lib/gasto-fijo-factura";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
const P = "musso";
const fc = (id: string, fecha: string, extra: Record<string, unknown> = {}) => ({ id, proveedor_id: P, fecha, total: 100, ...extra });
ok(facturaDelMes(P, [], "2026-10-13").falta === true, "sin facturas falta");
ok(facturaDelMes(P, [], "2026-10-13").mesNombre === "octubre", "nombre del mes");
ok(facturaDelMes(P, [fc("a", "2026-09-30")], "2026-10-13").falta === true, "la de septiembre no cuenta para octubre");
ok(facturaDelMes(P, [fc("a", "2026-10-02")], "2026-10-13").factura?.id === "a", "la de octubre la encuentra");
ok(facturaDelMes(P, [fc("a", "2026-10-02", { estado: "anulada" })], "2026-10-13").falta === true, "anulada no cuenta");
ok(facturaDelMes(P, [fc("a", "2026-10-02", { tipo_comprobante: "NC C" })], "2026-10-13").falta === true, "NC no cuenta");
ok(facturaDelMes(P, [fc("a", "2026-10-02", { proveedor_id: "otro" })], "2026-10-13").falta === true, "otro proveedor no cuenta");
ok(facturaDelMes(P, [fc("a", "2026-10-02"), fc("b", "2026-10-10")], "2026-10-13").factura?.id === "b", "la más reciente");
ok(facturaDelMes(null, [], "2026-10-13").falta === false, "sin proveedor no avisa");
import { pagoDelMes, sugerirGastoFijo, montoSicore } from "../src/lib/gasto-fijo-factura";
const pg = (id: string, fecha: string, monto: number, gf = "iva") => ({ id, gasto_fijo_id: gf, fecha, monto });
ok(pagoDelMes("iva", [], "2026-10-14", 20).falta === true, "IVA sin pago falta");
ok(pagoDelMes("iva", [], "2026-10-14", 20).diasAlVencimiento === 6, "vence en 6 días");
ok(pagoDelMes("iva", [], "2026-10-25", 20).diasAlVencimiento === -5, "vencido hace 5");
ok(pagoDelMes("iva", [], "2026-02-10", 31).diasAlVencimiento === 18, "día 31 en febrero = último día");
ok(pagoDelMes("iva", [pg("a", "2026-10-03", 100), pg("b", "2026-10-05", 50.5)], "2026-10-14").pagado === 150.5, "suma pagos del mes");
ok(pagoDelMes("iva", [pg("a", "2026-09-03", 100)], "2026-10-14").falta === true, "pago de septiembre no cuenta");
ok(pagoDelMes("iva", [pg("a", "2026-10-03", 100, "otro")], "2026-10-14").falta === true, "pago de otro gasto fijo no cuenta");
const GF = [
  { id: "iva", descripcion: "IVA" }, { id: "sicore", descripcion: "SICORE (retenciones Ganancias)" },
  { id: "aut", descripcion: "Autónomos Augusto" }, { id: "cm", descripcion: "Convenio Multilateral" },
  { id: "seh", descripcion: "Tasa Seguridad e Higiene Pergamino" }, { id: "alq", descripcion: "Alquiler" },
  { id: "mutj", descripcion: "Mutual Jerónimo" }, { id: "mutm", descripcion: "Mutual Mariana" },
];
ok(sugerirGastoFijo("VEP F.2002 IVA DDJJ período 09/2026", GF) === "iva", "VEP de IVA");
ok(sugerirGastoFijo("VEP SICORE impuesto 217 retenciones", GF) === "sicore", "VEP SICORE");
ok(sugerirGastoFijo("Aportes autónomos F.1003 cat. III", GF) === "aut", "autónomos");
ok(sugerirGastoFijo("SIFERE CM03 ingresos brutos", GF) === "cm", "convenio multilateral");
ok(sugerirGastoFijo("Municipalidad de Pergamino TISH", GF) === "seh", "seguridad e higiene");
ok(sugerirGastoFijo("Mutual Jerónimo octubre", GF) === "mutj", "mutual de Jero");
ok(sugerirGastoFijo("Mutual octubre", GF) === null, "mutual sin nombre: no adivina (empate)");
ok(sugerirGastoFijo("Compra de cinta", GF) === null, "nada que ver");
ok(sugerirGastoFijo("IVA", [{ id: "iva", descripcion: "IVA", activo: false }]) === null, "inactivo no se sugiere");
const ops = [
  { fecha: "2026-09-05", estado: "pagada", retencion: 1000.1 }, { fecha: "2026-09-20", estado: "anulada", retencion: 500 },
  { fecha: "2026-09-30", estado: "emitida", retencion: 200.2 }, { fecha: "2026-10-01", estado: "pagada", retencion: 999 },
];
ok(montoSicore(ops, "2026-10-14").monto === 1200.3 && montoSicore(ops, "2026-10-14").mes === "2026-09", "SICORE = retenciones de septiembre sin anuladas");
ok(montoSicore([{ fecha: "2025-12-10", retencion: 10 }], "2026-01-05").monto === 10, "enero toma diciembre");
