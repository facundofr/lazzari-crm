// npx tsx scripts/test-avisos-cobranza.ts
import { armarAvisos, avisoMandado, destinatariosAviso, finDeSemana, haceCuanto, mensajeAviso, separarMails, textoAHtml, totalTexto, venceFactura, type FacturaAviso } from "../src/lib/avisos-cobranza";

let fallas = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fallas++; console.error("FALLA:", msg); } else console.log("ok:", msg); };

// Semana de lunes a domingo
ok(finDeSemana("2026-10-29") === "2026-11-01", "jueves 29/10 → domingo 01/11");
ok(finDeSemana("2026-11-01") === "2026-11-01", "domingo → el mismo domingo");
ok(finDeSemana("2026-11-02") === "2026-11-08", "lunes → domingo siguiente");

// Vencimiento: el de la factura, o fecha + días de cuenta corriente
ok(venceFactura({ fecha: "2026-10-01", fechaVencimiento: "2026-10-20" }, 30) === "2026-10-20", "usa el vencimiento de la factura");
ok(venceFactura({ fecha: "2026-10-01", fechaVencimiento: null }, 30) === "2026-10-31", "sin vencimiento: fecha + 30 días");
ok(venceFactura({ fecha: "2026-10-01", fechaVencimiento: null }, 0) === "2026-10-01", "sin días de CC: la fecha");

const base = (x: Partial<FacturaAviso>): FacturaAviso => ({ id: "x", clienteId: "c1", cliente: "Corteva", cuit: null, comprobante: "FA 0015-00000001", fecha: "2026-10-01", fechaVencimiento: null, saldo: 1000, moneda: "ARS", ...x });
const facturas = [
  base({ id: "a", comprobante: "FA 0015-00000001", fechaVencimiento: "2026-10-20", saldo: 1000 }),       // vencida 9 días
  base({ id: "b", comprobante: "FA 0015-00000002", fechaVencimiento: "2026-10-31", saldo: 500 }),        // vence el sábado
  base({ id: "c", comprobante: "FA 0015-00000003", fechaVencimiento: "2026-10-29", saldo: 200, moneda: "USD" }), // vence hoy
  base({ id: "d", comprobante: "FA 0015-00000004", fechaVencimiento: "2026-11-02", saldo: 300 }),        // la semana que viene: afuera
  base({ id: "e", comprobante: "FA 0015-00000005", fechaVencimiento: "2026-10-10", saldo: 0.5 }),        // saldo de redondeo: afuera
  base({ id: "f", clienteId: "c2", cliente: "Synthon", fecha: "2026-09-01", fechaVencimiento: null, saldo: 5000 }), // CC 30 → venció 01/10
  base({ id: "g", clienteId: "", cliente: "Sin cliente", fechaVencimiento: "2026-10-01", saldo: 99 }),   // sin cliente: afuera
];
const av = armarAvisos(facturas, new Map([["c2", 30]]), "2026-10-29");
ok(av.vencidas.length === 2 && av.vencidas[0].cliente === "Synthon", "vencidas: 2 clientes, más plata arriba");
ok(av.vencidas[1].facturas.length === 1 && av.vencidas[1].facturas[0].dias === -9, "Corteva: 1 vencida hace 9 días (sin la de redondeo)");
ok(av.vencidas[0].facturas[0].vence === "2026-10-01", "Synthon: vence fecha + 30 días de CC");
ok(av.semana.length === 1 && av.semana[0].facturas.map((f) => f.id).join() === "c,b", "esta semana: hoy y sábado, ordenadas; la del lunes no");
ok(av.semana[0].total.ARS === 500 && av.semana[0].total.USD === 200, "totales separados por moneda");
ok(totalTexto(av.semana[0].total) === "$ 500,00 + US$ 200,00", "total en texto con las dos monedas");

const m1 = mensajeAviso(av.semana[0], "Lazzari");
ok(m1.asunto === "Lazzari - Facturas que vencen esta semana - Corteva", "asunto del recordatorio");
ok(m1.texto.includes("vence el 29/10/2026 (hoy)") && m1.texto.includes("Total: $ 500,00 + US$ 200,00"), "recordatorio con 'hoy' y total");
const m2 = mensajeAviso(av.vencidas[1], "Grupo LA");
ok(m2.asunto === "Grupo LA - Factura vencida - Corteva", "asunto del reclamo de una factura");
ok(m2.texto.includes("venció el 20/10/2026 (9 días)") && !m2.texto.includes("Total adeudado"), "reclamo de una factura sin total");

ok(textoAHtml("a <b>\nc") .includes("a &lt;b&gt;<br>c"), "html escapado con saltos");
ok(separarMails("A@x.com; b@y.com, a@x.com nada").join() === "a@x.com,b@y.com", "separa mails sin repetir");
ok(destinatariosAviso([{ cargo: "Cobranzas", nombre: "Cobranzas", email: "cobranzas@c.com" }, { cargo: "Compras", nombre: "Ana", email: "ana@c.com" }], "info@c.com").join() === "cobranzas@c.com", "Para: contacto de Cobranzas");
ok(destinatariosAviso([{ cargo: "Compras", nombre: "Ana", email: "ana@c.com" }], "info@c.com").join() === "info@c.com", "Para: sin Cobranzas, el mail del cliente");
ok(destinatariosAviso([], null).length === 0, "Para: vacío si no hay mails");
ok(destinatariosAviso([{ cargo: null, nombre: "Facturas a pagar", email: "Facturas_A_pagar@cargill.com" }, { cargo: "COMPRAS", nombre: "Pedro", email: "pedro@cargill.com" }], "").join() === "facturas_a_pagar@cargill.com", "Para: 'Facturas a pagar' (Cargill), no Compras");
ok(destinatariosAviso([{ cargo: null, nombre: "Proveedores Synthon", email: "proveedores.ar@synthon.com" }], "").join() === "proveedores.ar@synthon.com", "Para: 'Proveedores' (Synthon)");
ok(destinatariosAviso([{ cargo: "COMPRAS", nombre: "Ana", email: "ana@corteva.com" }], "seedspayables.argentina@corteva.com").join() === "seedspayables.argentina@corteva.com", "Para: Corteva Seeds va al mail de payables del cliente");
ok(haceCuanto("2026-10-26T15:00:00Z", "2026-10-29") === "hace 3 días" && haceCuanto("2026-10-29", "2026-10-29") === "hoy", "hace cuánto");

ok(haceCuanto("2026-10-30T01:09:38Z", "2026-10-30") === "ayer", "hace cuánto: 22 h de Argentina del día anterior es ayer");

// Mandado / sin mandar (Augusto 30/10: últimos 7 días; programado cuenta; rebotado no)
ok(!avisoMandado(undefined, "2026-10-30"), "sin aviso → sin mandar");
ok(avisoMandado({ fecha: "2026-10-30T01:09:38Z", estado: "entregado" }, "2026-10-30"), "mandado anoche 22 h (01 h UTC) → mandado");
ok(avisoMandado({ fecha: "2026-10-24T15:00:00Z", estado: "entregado" }, "2026-10-30"), "hace 6 días → mandado");
ok(!avisoMandado({ fecha: "2026-10-23T15:00:00Z", estado: "entregado" }, "2026-10-30"), "hace 7 días → vuelve a sin mandar");
ok(avisoMandado({ fecha: "2026-11-02T12:00:00Z", estado: "programado" }, "2026-10-30"), "programado → mandado");
ok(!avisoMandado({ fecha: "2026-10-29T15:00:00Z", estado: "rebotado" }, "2026-10-30"), "rebotado → sin mandar");

if (fallas) { console.error(`\n${fallas} FALLAS`); process.exit(1); }
console.log("\nTodo OK");
