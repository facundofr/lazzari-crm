// SOLO LECTURA: fichas de proveedor con el mismo nombre/CUIT y qué tiene colgado cada una.
// Uso (desde crm/app): node scripts/lectura/proveedor-duplicado.cjs fujiwara
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Tablas con una columna que apunta a proveedores (sacadas de las migraciones).
function tablasConProveedor() {
  const dir = path.join(__dirname, "../../supabase/migrations");
  const out = new Map();
  for (const f of fs.readdirSync(dir)) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi))
      for (const c of m[2].matchAll(/^\s*(\w*proveedor\w*_id)\s+uuid/gim)) out.set(`${m[1]}.${c[1]}`, [m[1], c[1]]);
    for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?(\w*proveedor\w*_id)\s+uuid/gi))
      out.set(`${m[1]}.${m[2]}`, [m[1], m[2]]);
  }
  return [...out.values()];
}

(async () => {
  const q = process.argv[2] || "fujiwara";
  const { data: provs, error } = await db.from("proveedores").select("*").ilike("razon_social", `%${q}%`);
  if (error) throw error;
  const cuits = [...new Set(provs.map((p) => p.cuit).filter(Boolean))];
  let todos = provs;
  if (cuits.length) {
    const { data: mismos } = await db.from("proveedores").select("*").in("cuit", cuits);
    todos = [...new Map([...provs, ...(mismos || [])].map((p) => [p.id, p])).values()];
  }
  for (const p of todos) {
    const lleno = Object.entries(p).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`);
    console.log(`\n== ${p.id} | ${p.razon_social} | CUIT ${p.cuit} | sociedad ${p.sociedad_id} | activo ${p.activo}`);
    console.log("   " + lleno.join(" · "));
  }
  console.log("\nLo que tiene colgado cada ficha:");
  for (const [t, c] of tablasConProveedor()) {
    const fila = [];
    for (const p of todos) {
      const { count, error: e } = await db.from(t).select("*", { count: "exact", head: true }).eq(c, p.id);
      fila.push(e ? "err" : count);
    }
    if (fila.some((x) => x && x !== "err")) console.log(`  ${t}.${c}: ${fila.join(" / ")}`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
