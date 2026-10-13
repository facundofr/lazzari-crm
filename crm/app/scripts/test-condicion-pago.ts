import { avisosPlanPago, fechasPermitidas, proponerCheques, textoCondicionPago, vencimientoFactura } from "../src/lib/condicion-pago";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };
const cfg = [
  { mes: "2026-10-01", dias: [12, 21, 31] },
  { mes: "2026-11-01", dias: [11, 21, 30] },
  { mes: "2026-12-01", dias: [11, 20, 31] },
];
const prisina = { condicion_pago: "escalonado", dias_pago: 30, dias_pago_hasta: 75, medio_pago_preferido: "echeq" };
const segu = { condicion_pago: "cuenta_corriente", dias_pago: 60, medio_pago_preferido: "echeq" };
ok(textoCondicionPago(prisina) === "Escalonado 30 a 75 días · eCheq", "texto prisina");
ok(textoCondicionPago({ condicion_pago: "anticipado", descuento_pronto_pago: 5 }) === "Anticipado · 5 % pronto pago", "texto dps");
ok(vencimientoFactura("2026-10-01", segu) === "2026-11-30", "venc segu");
ok(vencimientoFactura("2026-10-01", prisina) === "2026-10-31", "venc prisina primer pago");
ok(vencimientoFactura("2026-10-01", null) === null, "sin plan");
ok(fechasPermitidas("2026-12-01", "2026-12-31", cfg).join() === "2026-12-11,2026-12-20,2026-12-31", "dic 31");
ok(fechasPermitidas("2026-11-01", "2026-11-30", [{ mes: "2026-11-01", dias: [31] }]).join() === "2026-11-30", "31 en noviembre");
// Escalonado 30-75 desde 1/10: 31/10 .. 15/12 → 31/10, 11/11, 21/11, 30/11, 11/12
const ch = proponerCheques("2026-10-01", 1000, prisina, cfg);
ok(ch.map((c) => c.fecha).join() === "2026-10-31,2026-11-11,2026-11-21,2026-11-30,2026-12-11", "escalonado fechas " + ch.map((c) => c.fecha));
ok(Math.abs(ch.reduce((s, c) => s + c.monto, 0) - 1000) < 0.001 && ch[0].monto === 200, "reparto");
ok(ch[0].debito === "2026-11-02", "31/10 sábado se debita lunes 2/11");
const tres = proponerCheques("2026-10-01", 100, prisina, cfg.slice(0, 1));
ok(tres.length === 1 && tres[0].fecha === "2026-10-31", "solo octubre cargado");
// CC 60 desde 1/10 vence 30/11 → cheque 30/11
ok(proponerCheques("2026-10-01", 500, segu, cfg)[0].fecha === "2026-11-30", "cc 60");
ok(proponerCheques("2026-10-05", 500, segu, cfg)[0].fecha === "2026-11-30", "cc 60 vence 4/12 → 30/11");
ok(proponerCheques("2026-10-05", 500, segu, [])[0].fecha === "2026-12-04", "cc sin config → vencimiento");
ok(proponerCheques("2026-10-05", 500, { condicion_pago: "anticipado" }, cfg)[0].fecha === "2026-10-05", "anticipado");
ok(proponerCheques("2026-10-05", 500, { condicion_pago: "anticipado", plazo_cheque_dias: 30 }, cfg)[0].fecha === "2026-11-04", "anticipado cheque 30");
ok(avisosPlanPago(null).length === 1 && avisosPlanPago(prisina).length === 0, "avisos");
ok(avisosPlanPago({ condicion_pago: "escalonado", dias_pago: 60, dias_pago_hasta: 30, medio_pago_preferido: "echeq" }).length === 1, "hasta<desde");
console.log("OK condicion-pago");
