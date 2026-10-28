// @ts-nocheck -- script de lectura suelto (pg sin tipos), no es parte de la app
// SOLO LECTURA (auditoría 28/10/2026, Parte D): para cada link de archivo guardado, se fija que rutaDeLinkArchivo
// (lo que usa /api/archivo) encuentre un archivo que exista de verdad en Storage. Sirve antes y después de la migración.
// Correr desde crm/app: npx tsx scripts/db/pruebas/verificar-links-archivos.ts
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { rutaDeLinkArchivo } from "../../../src/lib/archivo-link";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin transaction read only");
    const links = (await db.query(`
      select 'facturas_compra' t, archivo_url u from facturas_compra where archivo_url is not null
      union all select 'presupuestos', archivo_url from presupuestos where archivo_url is not null
      union all select 'certificados_retencion', archivo_url from certificados_retencion where archivo_url is not null
      union all select 'remitos', foto_url from remitos where foto_url is not null
      union all select 'oc_remitos', foto_url from oc_remitos where foto_url is not null
      union all select 'ordenes_pago', x->>'url' from ordenes_pago, jsonb_array_elements(case jsonb_typeof(archivos) when 'string' then (archivos#>>'{}')::jsonb else archivos end) x where archivos is not null`)).rows;
    const objetos = new Set((await db.query(`select bucket_id || '/' || name k from storage.objects where bucket_id in ('facturas-compra','comprobantes','certificados','presupuestos')`)).rows.map((r) => r.k));
    const res: Record<string, { links: number; ok: number; sinArchivo: number; noReconocido: number }> = {};
    const malos: string[] = [];
    for (const { t, u } of links) {
      const r = (res[t] ||= { links: 0, ok: 0, sinArchivo: 0, noReconocido: 0 });
      r.links++;
      const a = rutaDeLinkArchivo(u);
      if (!a) { r.noReconocido++; malos.push(`${t}: no reconocido ${String(u).slice(0, 90)}`); continue; }
      if (objetos.has(`${a.bucket}/${a.ruta}`)) r.ok++;
      else { r.sinArchivo++; malos.push(`${t}: no existe ${a.bucket}/${a.ruta}`); }
    }
    console.table(res);
    if (malos.length) console.log(malos.slice(0, 20).join("\n"));
  } finally { await db.query("rollback").catch(() => {}); await db.end(); }
})();
