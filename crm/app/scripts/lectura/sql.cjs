// SOLO LECTURA: corre una consulta SQL dentro de una transacción READ ONLY (la base rechaza cualquier escritura).
// Uso (desde crm/app): node scripts/lectura/sql.cjs "select ..."   o   node scripts/lectura/sql.cjs archivo.sql
// Necesita SUPABASE_DB_URL en .env.local (la pega Augusto; nunca se muestra).
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const arg = process.argv[2] || "";
const sql = arg.endsWith(".sql") ? fs.readFileSync(arg, "utf8") : arg;
(async () => {
  if (!env.SUPABASE_DB_URL) throw new Error("Falta SUPABASE_DB_URL en .env.local");
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin transaction read only");
    const res = await db.query(sql);
    for (const r of [].concat(res)) if (r.rows?.length) console.table(r.rows);
    else console.log(r.command, r.rowCount ?? "");
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
