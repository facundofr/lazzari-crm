// Solo lectura: resumen de cuenta corriente PARA MANDAR AL CLIENTE (sin notas internas), en Excel y HTML (el HTML se pasa a PDF con Edge).
// Mismo cálculo que la ficha (lib/resumen-cuenta). Deja afuera lo que no suma (cobros de comprobantes del sistema anterior);
// la factura anulada y su NC van como debe/haber (se netean); el saldo a favor queda dentro del cobro de la remesa que lo generó.
// Uso (desde crm/app): npx tsx scripts/db/pruebas/cc-cliente-para-cliente.ts "del sol" "../../Claude outputs/Del Sol - resumen de cuenta"
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx");
import { resumenCliente } from "../../../src/lib/resumen-cuenta";
import { calcularSaldosClientes, cobradoPorFactura, saldoFacturaVenta } from "../../../src/lib/saldo-clientes";
import { generateResumenCuentaPDF, getSociedadPDF } from "../../../src/lib/pdf-templates";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const [buscar, base] = process.argv.slice(2);
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const pesos = (v: number) => `$ ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const comp = (f: any) => `${f.tipo} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? 0).padStart(8, "0")}`;

/** Detalle corto para el cliente: N° de su OP/remesa, cheque y facturas; retención con certificado. */
function detalleCliente(clase: string, d: string): string {
  const doc = d.match(/(Remesa|OP)[:\s]+(\d{4}-\d{8})/i);
  const docTxt = doc ? `${/remesa/i.test(doc[1]) ? "Remesa" : "OP"} ${doc[2]}` : "";
  if (clase === "retencion") {
    const cert = d.match(/Cert[.:]*\s*(\d+)/i);
    return ["Retención de Ganancias", cert ? `Cert. N° ${cert[1]}` : "", docTxt].filter(Boolean).join(" — ");
  }
  const ch = d.match(/eCheq\s+(\d+)\s*(Banco\s+)?(Galicia)?/i) || d.match(/Ref:\s*(\d+)/i);
  const chTxt = ch ? `${/echeq/i.test(ch[0]) ? "eCheq" : "Cheque"} N° ${ch[1]}${/galicia/i.test(ch[0]) ? " Galicia" : ""}` : "";
  const fac = d.match(/Facturas?:\s*((?:F[A-Z]*\s\d{4}-\d{8}(?:,\s*)?)+)/);
  return ["Cobro", docTxt, chTxt, fac ? `Facturas: ${fac[1].replace(/,\s*$/, "")}` : ""].filter(Boolean).join(" — ");
}

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query("begin read only");
  const q = async (sql: string, p: unknown[] = []): Promise<any[]> => (await db.query(sql, p)).rows;
  const [c] = await q("select c.id, c.razon_social, c.cuit, c.sociedad_id from clientes c where c.razon_social ilike $1", [`%${buscar}%`]);
  const [s] = await q("select * from sociedades where id=$1", [c.sociedad_id]);
  const facturas = await q("select id, cliente_id, tipo::text, punto_venta, numero, fecha::text, fecha_vencimiento::text, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado::text from facturas where sociedad_id=$1 and cliente_id=$2", [c.sociedad_id, c.id]);
  const movs = await q("select id, cliente_id, tipo::text, monto, monto_original, moneda, fecha::text, descripcion, anulado, created_at::text, factura_id, ajuste_sentido from movimientos where sociedad_id=$1 and cliente_id=$2", [c.sociedad_id, c.id]);
  const aps = await q("select a.movimiento_id, a.factura_id, a.monto, m.anulado from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where a.movimiento_id = any($1)", [movs.map((m) => m.id)]);
  await db.query("rollback"); await db.end();

  const r = resumenCliente(facturas, movs, aps.filter((a) => !a.anulado));
  const oficial = calcularSaldosClientes(facturas.filter((f) => f.estado !== "anulada"), movs.filter((m) => m.factura_id),
    aps.map((a) => ({ ...a, movimientos: { anulado: a.anulado } })), movs.filter((m) => !m.factura_id && m.ajuste_sentido))[c.id];
  const facPorComp = new Map(facturas.map((f) => [comp(f), f]));

  type Fila = { fecha: string; detalle: string; nota?: string; debe: number; haber: number };
  const filas: Fila[] = [];
  let aFavor = 0, aFavorNota = "";
  for (const x of r.renglones) {
    if (x.moneda !== "ARS") throw new Error("Este armado es solo para cuentas en pesos");
    if (x.clase === "factura" && x.anulado) {
      // Factura anulada por NC: se muestra con su NC (se netean).
      const nc = facturas.find((f) => String(f.tipo).startsWith("NC") && f.factura_origen_id === facPorComp.get(x.detalle)?.id);
      if (nc) filas.push({ fecha: x.fecha, detalle: x.detalle, nota: `Anulada por ${comp(nc)}`, debe: x.importe, haber: 0 });
      continue;
    }
    if (x.clase === "nc" && !x.suma && /anula la/i.test(x.nota || "")) { filas.push({ fecha: x.fecha, detalle: x.detalle, nota: x.nota!.replace(/^anula/, "Anula"), debe: 0, haber: x.importe }); continue; }
    if (!x.suma) continue; // cobros de comprobantes del sistema anterior: ya cancelados, no son de esta cuenta
    if (x.clase === "ajuste") { aFavor = r2(aFavor + x.haber - x.debe); aFavorNota = x.detalle; continue; }
    if (x.clase === "factura") { filas.push({ fecha: x.fecha, detalle: x.detalle, debe: x.debe, haber: 0 }); continue; }
    if (x.clase === "cobro" || x.clase === "retencion") {
      // Cobro con una parte sin aplicar (la que quedó a favor): se muestra entero.
      const haber = x.clase === "cobro" && /sin aplicar/.test(x.nota || "") ? x.importe : x.haber;
      filas.push({ fecha: x.fecha, detalle: detalleCliente(x.clase, x.detalle), nota: haber > x.haber ? `Incluye ${pesos(r2(haber - x.haber))} de la FA 0015-00000039, anulada: queda a su favor` : undefined, debe: 0, haber });
      continue;
    }
    throw new Error(`Renglón sin armar: ${x.clase} ${x.detalle}`);
  }
  // El saldo a favor ya está dentro del cobro de la remesa (no se cuenta dos veces).
  const sinAplicar = filas.reduce((t, f) => t + (f.nota?.startsWith("Incluye") ? 1 : 0), 0);
  if (aFavor && !sinAplicar) throw new Error(`Saldo a favor sin cobro que lo explique: ${aFavorNota}`);
  let saldo = 0;
  const conSaldo = filas.map((f) => { saldo = r2(saldo + f.debe - f.haber); return { ...f, saldo }; });
  if (Math.abs(saldo - r.saldo.ARS) > 0.01 || Math.abs(saldo - (oficial?.ARS?.saldo ?? 0)) > 0.01) throw new Error(`No cierra: ${saldo} vs resumen ${r.saldo.ARS} vs ficha ${oficial?.ARS?.saldo}`);

  const cobrado = cobradoPorFactura(facturas, movs.filter((m) => m.factura_id), aps.map((a) => ({ ...a, movimientos: { anulado: a.anulado } })));
  const pend = facturas.map((f) => ({ f, saldo: saldoFacturaVenta(f, cobrado[f.id] || 0) })).filter((x) => x.saldo > 0.005).sort((a, b) => a.f.fecha.localeCompare(b.f.fecha));
  const totalPend = r2(pend.reduce((t, x) => t + x.saldo, 0));
  const favor = r2(totalPend - saldo);
  const hoy = new Date().toISOString().slice(0, 10);
  const pie = [
    `Facturas pendientes: ${pend.map((x) => `${comp(x.f)} ${pesos(x.saldo)} (vence ${fecha((x.f.fecha_vencimiento || x.f.fecha).slice(0, 10))})`).join(" · ")}. Total ${pesos(totalPend)}.`,
    favor > 0.005 ? `Saldo a su favor: ${pesos(favor)} (pago de la FA 0015-00000039, anulada por la NCA 0015-00000005), a descontar del próximo pago.` : "",
    `Saldo de la cuenta: ${pesos(saldo)}. Los comprobantes del sistema anterior (FC 0009-…) ya cancelados no figuran en este resumen.`,
  ].filter(Boolean);

  // Excel
  const aoa: any[][] = [
    [`${s.razon_social || s.nombre} — Resumen de cuenta corriente`],
    [`Cliente: ${c.razon_social} — CUIT ${c.cuit}`],
    [`Al ${fecha(hoy)}`],
    [],
    ["Fecha", "Comprobante / detalle", "Debe", "Haber", "Saldo"],
    ...conSaldo.map((f) => [fecha(f.fecha), f.nota ? `${f.detalle} (${f.nota})` : f.detalle, f.debe || null, f.haber || null, f.saldo]),
    [],
    ["", "Saldo", null, null, saldo],
    [],
    ...pie.map((p) => ["", p]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 11 }, { wch: 90 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  for (let i = 5; i < 5 + conSaldo.length + 3; i++) for (const col of ["C", "D", "E"]) { const cell = ws[`${col}${i + 1}`]; if (cell && typeof cell.v === "number") cell.z = "#,##0.00"; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Resumen de cuenta");
  XLSX.writeFile(wb, `${base}.xlsx`);

  // HTML con la plantilla del CRM (mismo encabezado y logo); el pie interno se cambia por el del cliente.
  const soc = getSociedadPDF({ id: s.id, nombre: s.nombre, razonSocial: s.razon_social || s.nombre, cuit: s.cuit || "", condicionIva: s.condicion_iva || "", colorPrimario: s.color || "#FF4500" });
  let html = generateResumenCuentaPDF({
    nombre: c.razon_social, cuit: c.cuit, lado: "cliente", fecha: hoy, saldo: { ARS: saldo, USD: 0 },
    renglones: conSaldo.map((f) => ({ fecha: f.fecha, detalle: f.detalle, nota: f.nota, moneda: "ARS", importe: f.debe || f.haber, debe: f.debe, haber: f.haber, suma: true, anulado: false, saldo: f.saldo })),
  }, soc);
  const viejo = '<div style="font-size:8px;color:#888;margin-top:6px">En gris: anulados y movimientos que no suman al saldo (por ejemplo, cobros de facturas del sistema anterior).</div>';
  if (!html.includes(viejo)) throw new Error("No encontré el pie de la plantilla");
  html = html.replace(viejo, `<div style="font-size:9px;color:#444;margin-top:8px;line-height:1.5">${pie.map((p) => `<div>${p}</div>`).join("")}</div>`).replace("Positivo = nos debe", "Saldo pendiente de pago");
  fs.writeFileSync(`${base}.html`, html, "utf8");
  console.log(conSaldo.map((f) => `${fecha(f.fecha)} | ${f.detalle}${f.nota ? ` (${f.nota})` : ""} | ${f.debe || ""} | ${f.haber || ""} | ${f.saldo}`).join("\n"));
  console.log(pie.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
