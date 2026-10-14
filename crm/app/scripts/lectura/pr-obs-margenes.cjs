// SOLO LECTURA: cuenta los presupuestos cuyas "Observaciones" (que salen en el PDF del cliente)
// tienen renglones automaticos de ajuste de costo/margen. No escribe nada y no imprime textos, solo numeros de PR.
// Uso (desde crm/app): node scripts/lectura/pr-obs-margenes.cjs
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("presupuestos").select("numero, estado, enviado_at, sociedad_id, observaciones").not("observaciones", "is", null).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  const auto = /^\[\d{1,2}\/\d{1,2}\/\d{4}[ ,]/;
  let conMargen = 0, conAuto = 0, enviados = 0;
  const lista = [];
  for (const p of out) {
    const lines = String(p.observaciones).split(/\r?\n/);
    const a = lines.filter((l) => auto.test(l.trim()));
    const m = a.filter((l) => /margen \d/.test(l));
    if (a.length) conAuto++;
    if (m.length) { conMargen++; if (p.enviado_at) enviados++; lista.push(`${p.numero} (${p.estado}${p.enviado_at ? ", ENVIADO" : ""})`); }
  }
  console.log(`Presupuestos con observaciones: ${out.length}`);
  console.log(`Con renglones automaticos fechados: ${conAuto}`);
  console.log(`Con "(margen X% -> Y%)" a la vista del cliente: ${conMargen} (de esos, ya enviados al cliente: ${enviados})`);
  console.log(lista.join("\n"));
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
