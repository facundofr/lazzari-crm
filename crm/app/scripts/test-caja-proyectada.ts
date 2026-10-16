// Prueba de lib/caja-proyectada.ts: npx tsx scripts/test-caja-proyectada.ts
import { proyectarCaja, gastosFijosEnVentana, clientesACobrar, pagosPorSemana, lunesDe } from "../src/lib/caja-proyectada";

let fallas = 0;
function ok(cond: boolean, msg: string) { if (!cond) { fallas++; console.error("✗", msg); } else console.log("✓", msg); }
const hoy = "2026-10-16"; // viernes

ok(lunesDe(hoy) === "2026-10-12" && lunesDe("2026-10-12") === "2026-10-12" && lunesDe("2026-10-18") === "2026-10-12", "lunes de la semana");

const c = proyectarCaja({
  hoy, saldoInicial: 1_000_000,
  entradas: [
    { fecha: "2026-10-20", monto: 500_000, tipo: "factura_venta", detalle: "FA 15-1" },
    { fecha: "2026-10-01", monto: 900_000, tipo: "factura_venta", detalle: "FA vencida" },
    { fecha: "2026-12-30", monto: 1, tipo: "factura_venta", detalle: "fuera de la ventana" },
  ],
  salidas: [
    { fecha: "2026-10-10", monto: 200_000, tipo: "factura_compra", detalle: "atrasada" },
    { fecha: "2026-10-19", monto: 1_500_000, tipo: "cheque_emitido", detalle: "cheque" },
    { fecha: "2026-10-22", monto: 100_000, tipo: "gasto_fijo", detalle: "sueldo" },
  ],
});
ok(c.dias.length === 28 && c.dias[0].fecha === hoy && c.dias[27].fecha === "2026-11-12", "28 días desde hoy");
ok(c.dias[0].sale === 200_000 && c.atrasado === 200_000 && c.dias[0].saldo === 800_000, "lo atrasado sale hoy");
ok(c.vencidoSinCobrar.total === 900_000 && c.dias.every((d) => !d.items.some((i) => i.detalle === "FA vencida")), "lo vencido sin cobrar no se cuenta");
ok(c.primerFaltante?.fecha === "2026-10-19" && c.primerFaltante.falta === 700_000, "primer día que no alcanza y cuánto falta");
ok(c.dias.find((d) => d.fecha === "2026-10-22")!.saldo === -300_000, "saldo acumulado");
ok(c.minimo.saldo === -700_000 && c.minimo.fecha === "2026-10-19", "mínimo");
ok(c.semanas[0].desde === "2026-10-12" && c.semanas[0].saldoFinal === 800_000 && c.semanas.length === 5, "semanas lunes a domingo");

const g = gastosFijosEnVentana({
  hoy, fijos: [
    { id: "s", descripcion: "Sueldo", monto: 1_500_000, moneda: "ARS", activo: true, diaVencimiento: 10 },
    { id: "a", descripcion: "Alquiler", monto: 800, moneda: "USD", activo: true, diaVencimiento: 15, dolarReferencia: 1400 },
    { id: "x", descripcion: "Inactivo", monto: 1, moneda: "ARS", activo: false },
    { id: "u", descripcion: "US$ sin dólar", monto: 10, moneda: "USD", activo: true },
  ],
  pagos: [{ gasto_fijo_id: "s", fecha: "2026-10-02" }],
});
ok(g.salidas.filter((s) => s.detalle === "Sueldo").map((s) => s.fecha).join() === "2026-11-10", "sueldo de octubre pagado: solo noviembre");
ok(g.salidas.filter((s) => s.detalle === "Alquiler").map((s) => `${s.fecha}:${s.monto}`).join() === "2026-10-15:1120000" && g.salidas[1].usd === 800, "alquiler US$ atrasado del mes (el 15/11 queda fuera de las 4 semanas), con dólar de referencia");
ok(g.sinDolar.join() === "US$ sin dólar" && !g.salidas.some((s) => s.detalle === "Inactivo"), "sin dólar avisa; inactivo no entra");

const cl = clientesACobrar([
  { entidad_id: "a", entidad_nombre: "A", documento: "FA 1", vencimiento: "2026-10-01", saldo: 100, moneda: "ARS" },
  { entidad_id: "a", entidad_nombre: "A", documento: "FA 2", vencimiento: "2026-10-30", saldo: 50, moneda: "ARS" },
  { entidad_id: "b", entidad_nombre: "B", documento: "FA 3", vencimiento: "2026-10-20", saldo: 1000, moneda: "ARS" },
  { entidad_id: "c", entidad_nombre: "C", documento: "FA 4", vencimiento: "2026-09-16", saldo: 10, moneda: "USD" },
], hoy, new Map([["a", { fecha: "2026-10-05", monto: 30 }]]), 1500);
ok(cl[0].cliente_id === "c" && cl[1].cliente_id === "a", "ordena por vencido en pesos (USD con TC)");
ok(cl[1].ARS.total === 150 && cl[1].ARS.vencido === 100 && cl[1].proximoVencimiento === "2026-10-30" && cl[1].diasMasVencida === 15 && cl[1].ultimoCobro?.monto === 30, "renglón por cliente");
ok(cl[0].diasMasVencida === 30 && cl[0].USD.vencido === 10, "días de la más vencida y USD aparte");

const p = pagosPorSemana([
  { fecha: "2026-10-10", monto: 5, tipo: "factura_compra", detalle: "atr" },
  { fecha: "2026-10-16", monto: 10, tipo: "cheque_emitido", detalle: "hoy" },
  { fecha: "2026-10-19", monto: 20, tipo: "cheque_emitido", detalle: "lun" },
  { fecha: "2026-11-30", monto: 99, tipo: "gasto_fijo", detalle: "lejos" },
], hoy);
ok(p.atrasado.total === 5 && p.semanas[0].total === 10 && p.semanas[1].total === 20 && p.despues === 99, "pagos por semana");

ok(gastosFijosEnVentana({ hoy, fijos: [{ id: "k", descripcion: "Contador", monto: 100, moneda: "ARS", activo: true, diaVencimiento: 20, proveedorId: "p1" }], pagos: [], facturasCompra: [{ proveedor_id: "p1", fecha: "2026-10-05" }] }).salidas.map((s) => s.fecha).join() === "2026-11-10".replace("2026-11-10", ""), "gasto fijo con factura del mes cargada: no se cuenta dos veces (y nov 20 queda fuera)");

console.log(fallas ? `\n${fallas} fallas` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
