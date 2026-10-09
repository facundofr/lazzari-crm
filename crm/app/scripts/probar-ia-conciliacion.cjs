// Prueba REAL de la IA de conciliación con el caso TKW. Usa la clave de .env.local.
// Uso:  node scripts/probar-ia-conciliacion.cjs
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");

const env = fs.readFileSync(".env.local", "utf8");
const apiKey = (env.match(/^ANTHROPIC_API_KEY\s*=\s*"?([^"\r\n]+)"?/m) || [])[1];
if (!apiKey || apiKey.includes("SENSITIVE")) { console.error("Falta ANTHROPIC_API_KEY en .env.local"); process.exit(1); }

function load(file, extra = {}) {
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = { exports: {}, require: (m) => extra[m], ...extra }; vm.runInNewContext(out, ctx); return ctx.exports;
}
const pm = load("src/lib/purchase-matching.ts");
const ai = load("src/lib/purchase-matching-ai.ts");
const { ocs, invoice } = require("./fixtures/tkw.cjs")(pm.parseVariant);

(async () => {
  const grupos = pm.productGroups(invoice, ocs);
  const client = new Anthropic({ apiKey, timeout: 90_000 });
  const modelos = [process.env.CONCILIACION_MODEL || "claude-sonnet-4-5", "claude-haiku-4-5-20251001"];
  let res, modelo;
  for (const m of modelos) {
    try { res = await client.messages.create({ model: m, max_tokens: 4000, system: ai.SISTEMA_CONCILIACION, messages: [{ role: "user", content: ai.promptConciliacion("TKW S.A.", grupos.factura, grupos.oc) }] }); modelo = m; break; }
    catch (e) { console.log(`Modelo ${m} no disponible: ${e.message}`); }
  }
  if (!res) { console.error("Ningún modelo respondió."); process.exit(1); }
  const texto = res.content.map(b => b.type === "text" ? b.text : "").join("");
  const r = ai.leerRespuestaConciliacion(texto, grupos.factura, grupos.oc);
  console.log(`\nModelo: ${modelo}\n\nEQUIVALENCIAS PROPUESTAS POR LA IA:`);
  for (const g of grupos.factura) {
    const os = r.equivalencias[g.producto] || [];
    const ejemplos = os.map(p => grupos.oc.find(o => o.producto === p)?.ejemplo);
    console.log(`- ${g.ejemplo}\n    → ${ejemplos.join(" | ") || "(sin equivalencia)"}  [${r.confianza[g.producto] || "-"}] ${r.motivo[g.producto] || ""}`);
  }
  const m = pm.matchPurchaseLines(invoice, ocs, r.equivalencias);
  const asignadas = m.asignaciones.reduce((s, a) => s + a.cantidad, 0), total = invoice.reduce((s, l) => s + l.cantidad, 0);
  console.log(`\nRESULTADO: ${asignadas}/${total} unidades asignadas.`);
  console.log(`OC completas: ${[...m.ocsCompletas].sort().join(", ") || "-"} · OC parciales: ${[...m.ocsParciales].join(", ") || "-"}`);
  for (const p of m.pendientesOc) console.log(`  Pendiente en OC ${p.ocNumero}: ${ocs.find(o => o.id === p.ocLineId).descripcion} × ${p.cantidad}`);
  for (const s of m.sinAsignar) console.log(`  Sin asignar: ${invoice.find(l => l.key === s.invoiceKey).descripcion} × ${s.cantidad} (${s.motivo})`);
  const ok = [...m.ocsCompletas].sort().join(",") === "1187,1188,1192,1204" && [...m.ocsParciales].join(",") === "1199" && !m.sinAsignar.length;
  console.log(ok ? "\nOK: la IA llegó al resultado esperado del caso TKW." : "\nREVISAR: el resultado difiere del esperado (mandale esta salida a Claude).");
  process.exit(ok ? 0 : 2);
})();
