// Solo lectura: cuenta corriente completa de un cliente (el mismo "Resumen de cuenta" de la ficha de Finanzas Lazza,
// lib/resumen-cuenta) a un Excel, con las facturas pendientes en otra hoja.
// Uso (desde crm/app): npx tsx scripts/db/pruebas/cc-cliente-excel.ts "del sol" "../../Claude outputs/archivo.xlsx"
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx");
import { resumenCliente } from "../../../src/lib/resumen-cuenta";
import { calcularSaldosClientes, cobradoPorFactura, saldoFacturaVenta } from "../../../src/lib/saldo-clientes";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const [buscar, salida] = process.argv.slice(2);
const comp = (f: any) => `${f.tipo} ${String(f.punto_venta ?? 0).padStart(4, "0")}-${String(f.numero ?? 0).padStart(8, "0")}`;
const fecha = (d: string) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "";

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query("begin read only");
  const q = async (sql: string, p: unknown[] = []): Promise<any[]> => (await db.query(sql, p)).rows;
  const clientes = await q("select c.id, c.razon_social, c.cuit, c.sociedad_id, s.nombre soc from clientes c join sociedades s on s.id=c.sociedad_id where c.razon_social ilike $1", [`%${buscar}%`]);
  console.log("Clientes encontrados:", clientes.map((c) => `${c.razon_social} (${c.soc})`).join(" | "));
  const wb = XLSX.utils.book_new();
  for (const c of clientes) {
    const facturas = await q("select id, cliente_id, tipo::text, punto_venta, numero, fecha::text, fecha_vencimiento::text, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado::text, oc_cliente from facturas where sociedad_id=$1 and cliente_id=$2", [c.sociedad_id, c.id]);
    const movs = await q("select id, cliente_id, tipo::text, monto, monto_original, moneda, fecha::text, descripcion, anulado, created_at::text, factura_id, ajuste_sentido from movimientos where sociedad_id=$1 and cliente_id=$2", [c.sociedad_id, c.id]);
    const ids = movs.map((m) => m.id);
    const aps = ids.length ? await q("select a.movimiento_id, a.factura_id, a.monto, m.anulado from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where a.movimiento_id = any($1)", [ids]) : [];
    const r = resumenCliente(facturas, movs, aps.filter((a) => !a.anulado));
    const oficial = calcularSaldosClientes(facturas.filter((f) => f.estado !== "anulada"), movs.filter((m) => m.factura_id),
      aps.map((a) => ({ ...a, movimientos: { anulado: a.anulado } })), movs.filter((m) => !m.factura_id && m.ajuste_sentido))[c.id];
    const filas: any[][] = [
      [`Cuenta corriente — ${c.razon_social} (CUIT ${c.cuit || "—"}) — ${c.soc}`],
      [`Al ${fecha(new Date().toISOString().slice(0, 10))}. Positivo = nos debe. Lo que dice "No suma" se muestra para que se vea todo, pero no cambia el saldo.`],
      [],
      ["Fecha", "Detalle", "Nota", "Moneda", "Importe", "Debe", "Haber", "Saldo", "Suma"],
      ...r.renglones.map((x) => [fecha(x.fecha), x.detalle, [x.anulado ? "ANULADO" : "", x.nota || ""].filter(Boolean).join(" · "), x.moneda === "USD" ? "US$" : "$", x.importe, x.debe || null, x.haber || null, x.saldo, x.suma ? "Sí" : "No suma"]),
      [],
      ["Saldo final $", r.saldo.ARS], ["Saldo final US$", r.saldo.USD],
      ["Saldo de la ficha $", oficial?.ARS?.saldo ?? 0], ["Saldo de la ficha US$", oficial?.USD?.saldo ?? 0],
    ];
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws["!cols"] = [{ wch: 11 }, { wch: 46 }, { wch: 40 }, { wch: 7 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 9 }];
    XLSX.utils.book_append_sheet(wb, ws, `CC ${c.soc}`.slice(0, 31));
    // Facturas con saldo
    const cobrado = cobradoPorFactura(facturas, movs.filter((m) => m.factura_id), aps.map((a) => ({ ...a, movimientos: { anulado: a.anulado } })));
    const pend = facturas.map((f) => ({ f, saldo: saldoFacturaVenta(f, cobrado[f.id] || 0) })).filter((x) => x.saldo > 0.005).sort((a, b) => a.f.fecha.localeCompare(b.f.fecha));
    const hoy = new Date().toISOString().slice(0, 10);
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["Facturas pendientes", c.razon_social],
      [],
      ["Fecha", "Vence", "Días", "Comprobante", "OC cliente", "Moneda", "Total", "Saldo"],
      ...pend.map(({ f, saldo }) => {
        const v = (f.fecha_vencimiento || f.fecha).slice(0, 10);
        const d = Math.round((Date.parse(`${v}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);
        return [fecha(f.fecha), fecha(v), d < 0 ? `vencida hace ${-d} d` : `vence en ${d} d`, comp(f), f.oc_cliente || "", f.moneda === "USD" ? "US$" : "$", Number(f.total), saldo];
      }),
    ]);
    ws2["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 7 }, { wch: 15 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws2, `Pendientes ${c.soc}`.slice(0, 31));
    console.log(`${c.razon_social} (${c.soc}): ${r.renglones.length} renglones · saldo $ ${r.saldo.ARS} US$ ${r.saldo.USD} · ficha $ ${oficial?.ARS?.saldo ?? 0} US$ ${oficial?.USD?.saldo ?? 0} · ${pend.length} facturas pendientes`);
  }
  await db.query("rollback");
  await db.end();
  if (clientes.length) { XLSX.writeFile(wb, salida); console.log("Guardado:", salida); }
})().catch((e) => { console.error(e); process.exit(1); });
