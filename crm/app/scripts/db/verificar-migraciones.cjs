// Control de migraciones, SOLO LECTURA (auditoría 02/11/2026, P11). No cambia nada en la base.
// Uso (desde crm/app): node scripts/db/verificar-migraciones.cjs
// 1) Archivos de supabase/migrations que no figuran como corridos: ni en supabase_migrations.schema_migrations (hasta el 08/10)
//    ni en lz_migraciones_corridas (lo que anota migrar.cjs desde el 03/11). Los del medio (08/10 al 03/11) se corrieron sin
//    anotar: salen como "sin registro" y para esos manda el punto 2.
// 2) Funciones: para cada función public.X que crea algún archivo, compara la definición viva (pg_get_functiondef) con la del
//    ÚLTIMO archivo del repo que la define. Distinta = la base tiene otra versión (un archivo que no llegó al repo, o uno sin correr).
// Necesita SUPABASE_DB_URL en .env.local (nunca se muestra).
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

const DIR = path.join(__dirname, "../../supabase/migrations");

/** Cuerpo de cada "create or replace function public.x(...) ... as $tag$ cuerpo $tag$" de un archivo. */
function funcionesDe(sql) {
  const out = new Map();
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\)[\s\S]*?\bas\s+(\$[a-z_]*\$)([\s\S]*?)\3/gi;
  let m;
  while ((m = re.exec(sql))) out.set(m[1].toLowerCase(), m[4]);
  return out;
}

/** Para comparar sin que importen espacios, saltos de línea, mayúsculas ni comentarios de línea. */
const normal = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

(async () => {
  if (!env.SUPABASE_DB_URL) throw new Error("Falta SUPABASE_DB_URL en .env.local");
  const archivos = fs.readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin read only");
    const viejas = new Set((await db.query("select version from supabase_migrations.schema_migrations").catch(() => ({ rows: [] }))).rows.map((r) => String(r.version)));
    const hayTabla = (await db.query("select to_regclass('public.lz_migraciones_corridas') is not null as hay")).rows[0].hay;
    const anotadas = new Set(hayTabla ? (await db.query("select archivo from public.lz_migraciones_corridas")).rows.map((r) => path.basename(r.archivo)) : []);

    const sinRegistro = archivos.filter((f) => !viejas.has(f.slice(0, 14)) && !anotadas.has(f));
    console.log(`\n1) Archivos: ${archivos.length} en el repo · ${archivos.length - sinRegistro.length} anotados como corridos · ${sinRegistro.length} sin registro`);
    if (!hayTabla) console.log("   (todavía no existe lz_migraciones_corridas: falta correr 20261103090000_lz_migraciones_corridas.sql)");
    for (const f of sinRegistro) console.log("   - " + f);

    // Última definición de cada función según el repo.
    const ultima = new Map();
    for (const f of archivos) for (const [nombre, cuerpo] of funcionesDe(fs.readFileSync(path.join(DIR, f), "utf8"))) ultima.set(nombre, { archivo: f, cuerpo });
    const { rows } = await db.query(
      "select p.proname as nombre, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)",
      [[...ultima.keys()]],
    );
    const vivas = new Map();
    for (const r of rows) { const c = funcionesDe(r.def).get(r.nombre); if (c !== undefined) (vivas.get(r.nombre) || vivas.set(r.nombre, []).get(r.nombre)).push(c); }
    const distintas = [], faltan = [];
    for (const [nombre, { archivo, cuerpo }] of ultima) {
      const v = vivas.get(nombre);
      if (!v) faltan.push(`${nombre} (último archivo: ${archivo})`);
      else if (!v.some((c) => normal(c) === normal(cuerpo))) distintas.push(`${nombre} (último archivo: ${archivo})`);
    }
    console.log(`\n2) Funciones: ${ultima.size} definidas en el repo · ${distintas.length} distintas en la base · ${faltan.length} que no están en la base`);
    for (const x of distintas) console.log("   ≠ " + x);
    for (const x of faltan) console.log("   ✗ " + x);
    console.log("\nSolo lectura: no se cambió nada.");
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
