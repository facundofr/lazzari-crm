// @ts-nocheck -- script de lectura suelto (pg sin tipos), no es parte de la app
// SOLO LECTURA (auditoría 28/10/2026, H08): compara, para los clientes con NC "emitida", el total que mostraba la
// pestaña Cta. Cte. antes (suma de totales de facturas 'emitida', NC incluidas) con el de ahora (lib/saldo-clientes +
// lib/cuenta-corriente-cliente) y con el saldo de Finanzas. Correr desde crm/app: npx tsx scripts/db/pruebas/verificar-cc-cliente.ts
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { cobradoPorFactura, saldoFacturaVenta, calcularSaldosClientes, saldoClienteEn } from "../../../src/lib/saldo-clientes";
import { totalesCuentaCorriente } from "../../../src/lib/cuenta-corriente-cliente";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin transaction read only");
    const clientes = (await db.query(`select distinct f.cliente_id, f.sociedad_id, c.razon_social from facturas f join clientes c on c.id=f.cliente_id
      where f.estado='emitida' and f.tipo::text like 'NC%'`)).rows;
    const filas = [];
    for (const c of clientes) {
      const fs_ = (await db.query(`select id, cliente_id, tipo::text tipo, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda::text moneda, estado::text estado
        from facturas where cliente_id=$1 and sociedad_id=$2 and estado<>'anulada'`, [c.cliente_id, c.sociedad_id])).rows;
      const ids = fs_.map((f) => f.id);
      const movs = (await db.query(`select id, factura_id, monto, moneda::text moneda, anulado from movimientos where factura_id = any($1)`, [ids])).rows;
      const apls = (await db.query(`select a.movimiento_id, a.factura_id, a.monto, json_build_object('anulado', m.anulado) movimientos
        from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where a.factura_id = any($1)`, [ids])).rows;
      const ajustes = (await db.query(`select cliente_id, monto, moneda::text moneda, anulado, ajuste_sentido from movimientos
        where cliente_id=$1 and sociedad_id=$2 and factura_id is null and ajuste_sentido is not null`, [c.cliente_id, c.sociedad_id])).rows;
      const antes = fs_.filter((f) => f.estado === "emitida" && (f.moneda || "ARS") === "ARS").reduce((a, f) => a + Number(f.total), 0);
      const cobrado = cobradoPorFactura(fs_, movs, apls);
      const pend = fs_.filter((f) => ["emitida", "parcial"].includes(f.estado) && !f.tipo.toUpperCase().startsWith("NC"))
        .map((f) => ({ saldo: saldoFacturaVenta(f, cobrado[f.id] || 0), moneda: f.moneda })).filter((f) => f.saldo > 0.009);
      const saldos = calcularSaldosClientes(fs_, movs, apls, ajustes);
      const neto = { ARS: saldoClienteEn(saldos, c.cliente_id, "ARS"), USD: saldoClienteEn(saldos, c.cliente_id, "USD") };
      const ahora = totalesCuentaCorriente(pend, neto).find((t) => t.moneda === "ARS");
      filas.push({ cliente: String(c.razon_social).slice(0, 28), antes_ARS: Math.round(antes), ahora_ARS: Math.round(ahora?.saldoCuenta || 0), finanzas_ARS: Math.round(neto.ARS), iguales: Math.abs((ahora?.saldoCuenta || 0) - neto.ARS) < 0.01 });
    }
    console.table(filas);
  } finally { await db.query("rollback").catch(() => {}); await db.end(); }
})();
