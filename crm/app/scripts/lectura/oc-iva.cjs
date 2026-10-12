// SOLO LECTURA: compara el IVA guardado en cada OC con el que le corresponde
// (IVA de cada renglon; 0 si viene de un PR manual). No escribe nada.
// Uso (desde crm/app): node scripts/lectura/oc-iva.cjs
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const r2 = (n) => Math.round(n * 100) / 100;

async function all(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

(async () => {
  const ocs = await all(() => db.from("ordenes_compra")
    .select("id, numero, sociedad_id, estado, moneda, subtotal, iva, total, created_at, presupuesto_origen:presupuesto_origen_id(modalidad_emision), orden_compra_items(cantidad, precio_unitario, iva_porcentaje), facturas_compra(id, estado), factura_compra_ocs(facturas_compra(estado))")
    .order("created_at"));
  const grupos = {};
  let ok = 0;
  const add = (k, o) => { (grupos[k] ||= []).push(o); };
  for (const oc of ocs) {
    const it = oc.orden_compra_items || [];
    const manual = oc.presupuesto_origen?.modalidad_emision === "manual";
    const sub = r2(it.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0));
    const ivaLineas = r2(it.reduce((s, i) => s + r2(i.cantidad * i.precio_unitario * Number(i.iva_porcentaje ?? 21) / 100), 0));
    const ivaFijo = r2(sub * 0.21);
    const esperado = manual ? 0 : ivaLineas;
    const conFact = [...(oc.facturas_compra || []), ...(oc.factura_compra_ocs || []).map((l) => l.facturas_compra).filter(Boolean)].some((f) => f.estado !== "anulada");
    const info = {
      numero: oc.numero, soc: oc.sociedad_id === "fee94607-747a-4e87-ba24-aff9032f7a56" ? "GLA" : "LAZ",
      estado: oc.estado, mon: oc.moneda, sub: Number(oc.subtotal), iva: Number(oc.iva), esperado, conFact,
      tasas: [...new Set(it.map((i) => Number(i.iva_porcentaje ?? 21)))].join("/"),
    };
    if (!it.length) { add("sin_renglones", info); continue; }
    if (Math.abs(Number(oc.iva) - esperado) <= 0.05 && Math.abs(Number(oc.subtotal) - sub) <= 0.05) { ok++; continue; }
    if (manual) add("pr_manual_con_iva", info);
    else if (Math.abs(Number(oc.iva) - ivaFijo) <= 0.05 && Math.abs(ivaFijo - ivaLineas) > 0.05) add("iva21_fijo_con_renglones_10_5_o_0", info);
    else if (Number(oc.iva) === 0) add("cabecera_sin_iva_no_manual", info);
    else add("otra_diferencia", info);
  }
  console.log("Total OC:", ocs.length, "| bien:", ok);
  for (const [k, v] of Object.entries(grupos)) {
    console.log(`\n== ${k}: ${v.length} (con factura: ${v.filter((x) => x.conFact).length})`);
    v.slice(-15).forEach((x) => console.log(JSON.stringify(x)));
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
