// Compara las funciones SQL de la migración 20261030120000 con lib/nombres-telefonos.ts sobre todos los datos.
// Crea las funciones dentro de una transacción que SIEMPRE se deshace (rollback): no queda nada en la base.
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error pg no tiene tipos instalados (solo se usa en estos scripts de lectura)
import { Client } from "pg";
import { nombrePropio, telefonoAR } from "../../src/lib/nombres-telefonos";

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

(async () => {
  const mig = fs.readFileSync(path.join(__dirname, "../../supabase/migrations/20261030120000_formato_nombres_telefonos.sql"), "utf8");
  const funciones = mig.match(/create or replace function public\.(nombre_propio|telefono_ar)[\s\S]*?end \$\$;/g) || [];
  if (funciones.length !== 2) throw new Error("No encontré las dos funciones en la migración");
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let mal = 0, total = 0;
  try {
    await db.query("begin");
    for (const f of funciones) await db.query(f);
    const { rows } = await db.query(`
      select 'n' k, v, public.nombre_propio(v) s from (
        select razon_social v from clientes union all select razon_social from proveedores union all select nombre_fantasia from proveedores
        union all select nombre from contactos union all select nombre from cliente_sucursales union all select nombre from transportistas
        union all select razon_social from transportistas) x where v is not null
      union all
      select 't', v, public.telefono_ar(v) from (
        select telefono v from clientes union all select telefono from proveedores union all select telefono from contactos
        union all select whatsapp from contactos union all select telefono from cliente_sucursales union all select telefono from transportistas) y where v is not null`);
    const extra = ["CONTE HNOS Y CIA S A", "B.I.D. ARGENTINA S.A.", "JUAN PABLO II", "PEÑA MUÑOZ", "O'BRIEN", "juan perez", "JULIO CERNUDA (INGRID MARTIN)", "  ACME   SA "];
    const extraTel = ["2477 15 68-8498", "011 15-5555-1234", "+54 9 11 6455-0163", "336 4319942.0", "2477 123456 / 2477 654321", "239240263.0", "54 9 2477 59-5219"];
    const { rows: r2 } = await db.query("select 'n' k, v, public.nombre_propio(v) s from unnest($1::text[]) v union all select 't', v, public.telefono_ar(v) from unnest($2::text[]) v", [extra, extraTel]);
    for (const r of [...rows, ...r2]) {
      total++;
      const ts = r.k === "n" ? nombrePropio(r.v) : telefonoAR(r.v);
      if (ts !== r.s) { mal++; if (mal <= 20) console.log("DISTINTO:", JSON.stringify(r.v), "SQL", JSON.stringify(r.s), "TS", JSON.stringify(ts)); }
    }
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
  console.log(`${total} valores comparados, ${mal} distintos`);
  if (mal) process.exit(1);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
