// Corre UN archivo de migración (o de vuelta atrás) en la base, como el SQL Editor de Supabase.
// Solo se usa con OK de Augusto para ese archivo. Si algo falla, no se guarda nada (transacción).
// Uso (desde crm/app): node scripts/db/migrar.cjs supabase/migrations/AAAAMMDDHHMMSS_nombre.sql
// Probar sin guardar: node scripts/db/migrar.cjs supabase/migrations/X.sql --probar scripts/db/pruebas/X.sql
//   corre la migración y después el archivo de prueba, muestra los resultados y DESHACE TODO (rollback) siempre.
// Necesita SUPABASE_DB_URL en .env.local (la pega Augusto; nunca se muestra).
// Cada archivo corrido queda anotado en lz_migraciones_corridas (P11, 03/11/2026); para controlar: node scripts/db/verificar-migraciones.cjs
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const file = process.argv[2];
const probarIdx = process.argv.indexOf("--probar");
const prueba = probarIdx > 0 ? process.argv[probarIdx + 1] : null;
(async () => {
  if (!file || !/^supabase\/(migrations|rollback)\/\d{14}_[\w-]+\.sql$/.test(file.replace(/\\/g, "/"))) {
    throw new Error("Pasá un archivo de supabase/migrations o supabase/rollback");
  }
  if (probarIdx > 0 && (!prueba || !/^scripts\/db\/pruebas\/[\w-]+\.sql$/.test(prueba.replace(/\\/g, "/")))) {
    throw new Error("La prueba tiene que ser un archivo de scripts/db/pruebas");
  }
  if (!env.SUPABASE_DB_URL) throw new Error("Falta SUPABASE_DB_URL en .env.local");
  // Saca el begin/commit del archivo: la transacción la maneja este script.
  const limpiar = (f) => fs.readFileSync(f, "utf8").replace(/^\s*begin\s*;\s*$/gim, "").replace(/^\s*commit\s*;\s*$/gim, "");
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    await db.query(limpiar(file));
    if (prueba) {
      const res = await db.query(limpiar(prueba));
      for (const r of [].concat(res)) if (r.rows?.length) console.table(r.rows);
      await db.query("rollback");
      console.log("PRUEBA OK (no se guardó nada):", file);
      return;
    }
    // Queda anotada en lz_migraciones_corridas, en la misma transacción (si la tabla todavía no existe, no se anota).
    const archivo = file.replace(/\\/g, "/");
    const { rows: [t] } = await db.query("select to_regclass('public.lz_migraciones_corridas') is not null as hay");
    if (t.hay) {
      await db.query(
        "insert into public.lz_migraciones_corridas (archivo, tipo) values ($1, $2) on conflict (archivo) do update set corrida_at = now(), usuario = current_user",
        [archivo, archivo.includes("supabase/rollback/") ? "vuelta_atras" : "migracion"],
      );
    }
    await db.query("commit");
    console.log("OK: corrida", file, t.hay ? "(anotada en lz_migraciones_corridas)" : "(sin anotar: falta la tabla lz_migraciones_corridas)");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
})().catch((e) => { console.error("ERROR (no se guardó nada):", e.message); process.exit(1); });
