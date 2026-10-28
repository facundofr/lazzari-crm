// Prueba de src/lib/cuenta-corriente-cliente.ts (auditoría 28/10/2026, H08). Correr: npx tsx scripts/test-cuenta-corriente-cliente.ts
import { totalesCuentaCorriente } from "../src/lib/cuenta-corriente-cliente";
import { cobradoPorFactura, saldoFacturaVenta, calcularSaldosClientes, saldoClienteEn } from "../src/lib/saldo-clientes";

let fallas = 0;
const ver = (que: string, ok: boolean, dato?: unknown) => { console.log(ok ? "OK  " : "MAL ", que, ok ? "" : JSON.stringify(dato)); if (!ok) fallas++; };

// Cliente con: FA 1000 cobrada 400 (parcial), FA 500 con NC aplicada 200, NC suelta de 150, y una FA en US$ 100.
const facturas = [
  { id: "a", cliente_id: "c", tipo: "FA", total: 1000, total_acreditado: 0, moneda: "ARS", estado: "parcial" },
  { id: "b", cliente_id: "c", tipo: "FA", total: 500, total_acreditado: 200, moneda: "ARS", estado: "emitida" },
  { id: "n", cliente_id: "c", tipo: "NCA", total: 150, factura_origen_id: null, moneda: "ARS", estado: "emitida" },
  { id: "u", cliente_id: "c", tipo: "FA", total: 100, total_acreditado: 0, moneda: "USD", estado: "emitida" },
];
const movs = [{ id: "m1", factura_id: "a", monto: 400, moneda: "ARS", anulado: false }, { id: "m2", factura_id: "b", monto: 50, moneda: "ARS", anulado: true }];
const cobrado = cobradoPorFactura(facturas, movs, []);
const pendientes = facturas.filter((f) => !f.tipo.startsWith("NC")).map((f) => ({ saldo: saldoFacturaVenta(f, cobrado[f.id] || 0), moneda: f.moneda }));
ver("saldo de la FA parcial = 600", pendientes[0].saldo === 600, pendientes[0]);
ver("saldo de la FA con NC aplicada = 300 (el cobro anulado no cuenta)", pendientes[1].saldo === 300, pendientes[1]);

const saldos = calcularSaldosClientes(facturas, movs, []);
const neto = { ARS: saldoClienteEn(saldos, "c", "ARS"), USD: saldoClienteEn(saldos, "c", "USD") };
const t = totalesCuentaCorriente(pendientes, neto);
const ars = t.find((x) => x.moneda === "ARS")!;
ver("pesos: facturas 900, a favor 150 (NC suelta), saldo 750 = Finanzas", ars.facturas === 900 && ars.aFavor === 150 && ars.saldoCuenta === 750, ars);
const usd = t.find((x) => x.moneda === "USD")!;
ver("dólares por separado: 100", usd.saldoCuenta === 100 && usd.aFavor === 0, usd);

const sinNeto = totalesCuentaCorriente(pendientes, null);
ver("si falló el saldo de Finanzas, muestra solo las facturas", sinNeto[0].saldoCuenta === 900 && sinNeto[0].aFavor === 0, sinNeto);

const conAjuste = totalesCuentaCorriente([{ saldo: 100, moneda: "ARS" }], { ARS: 130 });
ver("ajuste en contra del cliente: otros cargos 30", conAjuste[0].otrosCargos === 30 && conAjuste[0].saldoCuenta === 130, conAjuste);

const soloAFavor = totalesCuentaCorriente([], { ARS: -80 });
ver("sin facturas pero con saldo a favor: lo muestra", soloAFavor.length === 1 && soloAFavor[0].aFavor === 80 && soloAFavor[0].saldoCuenta === -80, soloAFavor);
if (fallas) process.exit(1);
