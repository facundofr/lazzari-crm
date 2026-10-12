// SOLO LECTURA: muestra las facturas de compra vinculadas a las OC indicadas.
// Uso (desde crm/app): node scripts/lectura/oc-facturas.cjs OC-2026-1059 OC-2026-1112 ...
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await db.from("ordenes_compra")
    .select("numero, subtotal, iva, total, factura_compra_ocs(facturas_compra(numero_factura, estado, subtotal, iva, total, created_at)), facturas_compra(numero_factura, estado, subtotal, iva, total)")
    .in("numero", process.argv.slice(2));
  if (error) throw error;
  for (const oc of data) {
    const fcs = [...(oc.facturas_compra || []), ...(oc.factura_compra_ocs || []).map((l) => l.facturas_compra).filter(Boolean)];
    console.log(oc.numero, "OC:", oc.subtotal, oc.iva, oc.total);
    fcs.forEach((f) => console.log("   FC", f.numero_factura, f.estado, f.subtotal, f.iva, f.total));
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
