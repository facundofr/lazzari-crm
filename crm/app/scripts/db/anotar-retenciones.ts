// Arma la migración que anota la retención «congelada» (mejora H, 27/10/2026) en las OP con retención que todavía no la
// tienen: las hechas en producción antes de publicar la ventana de OP que la anota sola. SOLO LEE la base (transacción
// READ ONLY) y escribe el archivo de migración y su vuelta atrás; la migración se corre después, con el OK de Augusto.
// La cuenta es la del certificado (lib/certificado-retencion.ts). Si una OP se calculó con otro concepto que bienes y que
// el de hoy, o la cuenta no da, frena: esa se decide a mano.
// Uso (desde crm/app): npx tsx scripts/db/anotar-retenciones.ts AAAAMMDDHHMMSS_op_retencion_congelada_datos_N
import path from "path";
import fs from "fs";
import { columnasRetencionCongelada, detalleRetencion, pagosAnteriores, type PagoDelMes } from "../../src/lib/certificado-retencion";
const { Client } = require("pg");

const app = path.join(__dirname, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(app, ".env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const nombre = process.argv[2] || "";

(async () => {
  if (!/^\d{14}_[\w-]+$/.test(nombre)) throw new Error("Pasá el nombre de la migración: AAAAMMDDHHMMSS_nombre (sin .sql)");
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin transaction read only");
    const ops = (await db.query(`select o.id, o.sociedad_id, o.numero, o.fecha::text fecha, o.created_at, o.estado, o.monto_bruto, o.base_retencion_ganancias,
        o.retencion_ganancias_pct, o.retencion_ganancias_monto, o.proveedor_id, p.razon_social, p.concepto_retencion_ganancias concepto, p.alicuota_ganancias
      from ordenes_pago o join proveedores p on p.id = o.proveedor_id
      where o.retencion_ganancias_monto > 0 and o.retencion_ganancias_regimen is null order by o.sociedad_id, o.fecha, o.created_at`)).rows;
    const directos = (await db.query(`select count(*)::int n from movimientos where tipo = 'pago' and retencion_ganancias_monto > 0 and retencion_ganancias_regimen is null`)).rows[0].n;
    if (directos > 0) console.warn(`Ojo: ${directos} pagos directos con retención sin anotar (este script solo anota OP).`);
    if (!ops.length) { console.log("Ninguna OP con retención sin anotar: no hace falta migración."); return; }
    const lineas: string[] = [];
    const ids: string[] = [];
    for (const soc of [...new Set(ops.map((o: any) => o.sociedad_id as string))]) {
      const cfg = (await db.query("select minimo_ganancias, tasa_ganancias_ri from retencion_config where sociedad_id = $1", [soc])).rows[0];
      const todos = (await db.query(`select id, proveedor_id, fecha::text fecha, created_at, base_retencion_ganancias, retencion_ganancias_monto from ordenes_pago where sociedad_id = $1 and estado <> 'anulada'
        union all select id, proveedor_id, fecha::text, created_at, base_retencion_ganancias, retencion_ganancias_monto from movimientos
        where sociedad_id = $1 and tipo = 'pago' and factura_compra_id is not null and nota_credito_compra_id is null and not coalesce(anulado, false)`, [soc])).rows;
      const pago = (x: any): PagoDelMes => ({ id: x.id, proveedor_id: x.proveedor_id, fecha: String(x.fecha).slice(0, 10), creado: new Date(x.created_at).toISOString(),
        base: Number(x.base_retencion_ganancias || 0), retenido: Number(x.retencion_ganancias_monto || 0) });
      const delMes = todos.map(pago);
      const minimoBienes = Number(cfg.minimo_ganancias);
      for (const op of ops.filter((o: any) => o.sociedad_id === soc)) {
        const d = detalleRetencion({ concepto: op.concepto, alicuotaProveedor: op.alicuota_ganancias == null ? null : Number(op.alicuota_ganancias), minimoBienes,
          tasaSociedad: Number(cfg.tasa_ganancias_ri), bruto: Number(op.monto_bruto), base: Number(op.base_retencion_ganancias), pct: Number(op.retencion_ganancias_pct),
          retenido: Number(op.retencion_ganancias_monto), anteriores: pagosAnteriores(pago(op), delMes) });
        if (d.minimo === null) throw new Error(`${op.numero}: la cuenta no da con ningún mínimo (¿importe escrito a mano?). Decidirla a mano.`);
        let concepto: string | null = op.concepto;
        let nota = "";
        if (Math.abs(d.minimo - d.minimoHoy) > 0.5 || Math.abs(d.pct - d.pctHoy) > 0.005) {
          if (Math.abs(d.minimo - minimoBienes) > 0.5 || Math.abs(d.pct - 2) >= 0.005) throw new Error(`${op.numero}: se calculó con otro concepto que no es bienes ni el de hoy. Decidirla a mano.`);
          concepto = "compraventa_bienes";
          nota = ` (se calculó como bienes; hoy ${op.concepto || "sin concepto"})`;
        }
        const c = columnasRetencionCongelada({ concepto, minimo: d.minimo, basePrevia: d.basePrevia, retenidoAntes: d.retenidoAntes });
        const f = (n: number) => n.toFixed(2);
        ids.push(op.id);
        lineas.push(`-- ${op.numero} · ${op.fecha} · ${String(op.razon_social).replace(/\s+/g, " ").trim()}${op.estado === "anulada" ? " · ANULADA" : ""}${nota}
update public.ordenes_pago set retencion_ganancias_regimen = '${c.retencion_ganancias_regimen}', retencion_ganancias_minimo = ${f(c.retencion_ganancias_minimo)}, retencion_ganancias_base_previa = ${f(c.retencion_ganancias_base_previa)}, retencion_ganancias_retenido_antes = ${f(c.retencion_ganancias_retenido_antes)}
 where id = '${op.id}' and sociedad_id = '${soc}' and retencion_ganancias_regimen is null and retencion_ganancias_monto = ${f(Number(op.retencion_ganancias_monto))};`);
      }
    }
    const lista = ids.map((id) => `'${id}'`).join(",\n  ");
    fs.writeFileSync(path.join(app, "supabase/migrations", `${nombre}.sql`), `-- Anota la retención «congelada» (mejora H) en ${ids.length} OP con retención hechas antes de publicar la ventana de OP que la anota sola.
-- Armada con scripts/db/anotar-retenciones.ts (la misma cuenta del certificado). SOLO COMPLETA las 4 columnas retencion_ganancias_*:
-- no cambia importes, % ni retenido. Si alguna OP cambió desde que se armó, no se guarda nada.
-- Vuelta atrás: supabase/rollback/${nombre}.sql

${lineas.join("\n\n")}

do $$
declare
  n integer;
begin
  select count(*) into n from public.ordenes_pago where retencion_ganancias_regimen is not null and id in (
  ${lista});
  if n <> ${ids.length} then
    raise exception 'Se anotaron % de ${ids.length} OP: alguna cambió desde que se armó la migración. No se guarda nada.', n;
  end if;
end $$;
`);
    fs.writeFileSync(path.join(app, "supabase/rollback", `${nombre}.sql`), `-- Vuelta atrás de ${nombre}.sql: vacía lo anotado en esas ${ids.length} OP (vuelven a usar el concepto de hoy del proveedor).
update public.ordenes_pago
   set retencion_ganancias_regimen = null, retencion_ganancias_minimo = null, retencion_ganancias_base_previa = null, retencion_ganancias_retenido_antes = null
 where id in (
  ${lista});
`);
    console.log(`Listo: supabase/migrations/${nombre}.sql y su vuelta atrás (${ids.length} OP: ${ops.map((o: any) => o.numero).join(", ")}).`);
  } finally { await db.query("rollback").catch(() => {}); await db.end(); }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
