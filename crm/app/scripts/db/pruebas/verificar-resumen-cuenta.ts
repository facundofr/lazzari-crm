// Solo lectura: compara, para cada cliente y proveedor, el saldo del resumen de cuenta (lib/resumen-cuenta)
// con el saldo de la ficha (lib/saldo-clientes y lib/saldo-proveedores). Uso (desde crm/app):
//   npx tsx scripts/db/pruebas/verificar-resumen-cuenta.ts
import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg");
import { resumenCliente, resumenProveedor } from "../../../src/lib/resumen-cuenta";
import { calcularSaldosClientes } from "../../../src/lib/saldo-clientes";
import { calcularSaldosProveedores, creditosProveedor } from "../../../src/lib/saldo-proveedores";
import { sentidoAjuste } from "../../../src/lib/tipos-movimiento";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const r2 = (x: number) => Math.round(x * 100) / 100;

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  await db.query("begin read only");
  const q = async (sql: string, p: unknown[] = []): Promise<any[]> => (await db.query(sql, p)).rows;
  const socs = await q("select id, nombre from sociedades");
  let malos = 0, total = 0;
  for (const s of socs) {
    // Clientes
    const facturas = await q("select id, cliente_id, tipo::text, punto_venta, numero, fecha::text, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado::text from facturas where sociedad_id=$1", [s.id]);
    const movs = await q("select id, cliente_id, tipo::text, monto, monto_original, moneda, fecha::text, descripcion, anulado, created_at::text, factura_id, ajuste_sentido from movimientos where sociedad_id=$1 and cliente_id is not null", [s.id]);
    const aps = await q("select a.movimiento_id, a.factura_id, a.monto, m.anulado from cobro_aplicaciones a join movimientos m on m.id=a.movimiento_id where m.sociedad_id=$1", [s.id]);
    const ncAps = await q("select nota_credito_id, factura_id from nota_credito_venta_aplicaciones where sociedad_id=$1", [s.id]);
    const oficial = calcularSaldosClientes(
      facturas.filter((f) => f.estado !== "anulada"),
      movs.filter((m) => m.factura_id),
      aps.map((a) => ({ ...a, movimientos: { anulado: a.anulado } })),
      movs.filter((m) => !m.factura_id && m.ajuste_sentido),
    );
    const clientes = new Set([...facturas.map((f) => f.cliente_id), ...movs.map((m) => m.cliente_id)].filter(Boolean));
    for (const c of clientes) {
      const movsC = movs.filter((m) => m.cliente_id === c);
      const ids = new Set(movsC.map((m) => m.id));
      const r = resumenCliente(facturas.filter((f) => f.cliente_id === c), movsC, aps.filter((a) => ids.has(a.movimiento_id) && !a.anulado), new Map(), ncAps);
      const o = oficial[c as string] || { ARS: { saldo: 0 }, USD: { saldo: 0 } };
      total++;
      for (const m of ["ARS", "USD"] as const) {
        if (Math.abs(r.saldo[m] - o[m].saldo) > 0.01) { malos++; console.log(`${s.nombre} cliente ${c} ${m}: resumen ${r.saldo[m]} ficha ${o[m].saldo}`); }
      }
    }
    // Proveedores
    const fc = await q("select f.id, f.proveedor_id, f.numero_factura, f.tipo_comprobante, f.fecha::text, f.total, f.total_acreditado, f.moneda, f.estado, coalesce((select json_agg(json_build_object('monto', l.monto, 'ordenes_pago', json_build_object('estado', o.estado, 'numero', o.numero))) from op_facturas_compra l join ordenes_pago o on o.id=l.orden_pago_id where l.factura_compra_id=f.id), '[]') op_facturas_compra from facturas_compra f where f.sociedad_id=$1", [s.id]);
    const ops = await q("select o.id, o.proveedor_id, o.numero, o.fecha::text, o.monto_bruto, o.moneda, o.estado, o.created_at::text, coalesce((select json_agg(json_build_object('factura_compra_id', l.factura_compra_id, 'monto', l.monto)) from op_facturas_compra l where l.orden_pago_id=o.id), '[]') op_facturas_compra from ordenes_pago o where o.sociedad_id=$1", [s.id]);
    const movsP = await q("select id, proveedor_id, tipo::text, monto, monto_original, moneda, fecha::text, descripcion, anulado, created_at::text, factura_compra_id, orden_pago_id, nota_credito_compra_id, retencion_ganancias_monto, ajuste_sentido from movimientos where sociedad_id=$1 and proveedor_id is not null", [s.id]);
    const allMovs = await q("select id, tipo::text, factura_compra_id, monto, retencion_ganancias_monto, anulado, nota_credito_compra_id from movimientos where sociedad_id=$1 and (factura_compra_id is not null or nota_credito_compra_id is not null)", [s.id]);
    const sfTodos = await q("select proveedor_id, orden_pago_id, moneda, saldo, monto_original, estado, created_at::text from saldos_favor_proveedor where sociedad_id=$1", [s.id]);
    const sf = sfTodos.filter((x) => x.estado === "disponible");
    const ajustes = movsP.filter((m) => m.tipo === "ajuste" || /^\[Ajuste manual\]/i.test(m.descripcion || "")).map((m) => ({ ...m, ajuste_sentido: sentidoAjuste(m) }));
    const oficialP = calcularSaldosProveedores(fc, allMovs.filter((m) => m.tipo === "pago" && m.factura_compra_id), allMovs.filter((m) => m.nota_credito_compra_id),
      creditosProveedor(sf, ops.filter((o) => o.estado !== "anulada"), ajustes));
    const provs = new Set([...fc.map((f) => f.proveedor_id), ...ops.map((o) => o.proveedor_id), ...movsP.map((m) => m.proveedor_id)].filter(Boolean));
    for (const p of provs) {
      const r = resumenProveedor(fc.filter((f) => f.proveedor_id === p), ops.filter((o) => o.proveedor_id === p), movsP.filter((m) => m.proveedor_id === p), sentidoAjuste, sfTodos.filter((x) => x.proveedor_id === p));
      const o = oficialP[p as string] || { ARS: 0, USD: 0 };
      total++;
      for (const m of ["ARS", "USD"] as const) {
        if (Math.abs(r.saldo[m] - o[m]) > 0.01) { malos++; console.log(`${s.nombre} proveedor ${p} ${m}: resumen ${r.saldo[m]} ficha ${r2(o[m])}`); }
      }
    }
  }
  await db.query("rollback");
  await db.end();
  console.log(`${total} cuentas revisadas, ${malos} no cierran.`);
})();
