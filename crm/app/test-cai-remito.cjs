const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: require("path").resolve(__dirname, "../crm/app/.env.local") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function test() {
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: "manu@lfrp.com.ar",
    password: "Lazzari2026!"
  });
  if (authErr) { console.log("Auth error:", authErr.message); return; }
  console.log("Logged in as:", auth.user.email);

  const socId = "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021";

  // 1. Get next CAI number
  const { data: caiRows, error: caiErr } = await supabase.rpc("next_cai_number", {
    p_sociedad_id: socId,
    p_tipo: "remito_r",
  });
  console.log("CAI result:", JSON.stringify(caiRows), caiErr ? caiErr.message : "OK");

  if (caiRows === null || caiRows.length === 0) {
    console.log("No CAI available");
    return;
  }
  const cai = caiRows[0];
  console.log("CAI:", cai.cai_numero, "PV:", cai.punto_venta, "Nro:", cai.nro_comprobante);

  // 2. Get a client
  const { data: clientes } = await supabase.from("clientes").select("id, razon_social").eq("sociedad_id", socId).limit(1);
  if (clientes === null || clientes.length === 0) { console.log("No clients"); return; }
  console.log("Cliente:", clientes[0].razon_social);

  // 3. Create remito
  const { data: remito, error: rErr } = await supabase.from("remitos").insert({
    numero: null,
    cliente_id: clientes[0].id,
    fecha: new Date().toISOString().split("T")[0],
    observaciones: "Test remito con CAI — se puede borrar",
    tipo_remito: "interno",
    presupuesto_id: null,
    estado: "pendiente",
    sociedad_id: socId,
    valor_declarado: 50000,
    cai_numero: cai.cai_numero,
    punto_venta_cai: cai.punto_venta,
    nro_comprobante_cai: cai.nro_comprobante,
  }).select("id, numero, cai_numero, punto_venta_cai, nro_comprobante_cai").single();

  if (rErr) { console.log("Remito error:", rErr.message); return; }
  console.log("Remito creado:", JSON.stringify(remito, null, 2));

  // 4. Add items
  const { error: itemsErr } = await supabase.from("remito_items").insert([
    { remito_id: remito.id, descripcion: "Valvula esferica 1/2 AISI 316", cantidad: 10, unidad: "UN", orden: 0 },
    { remito_id: remito.id, descripcion: "Brida slip-on 2 150# ANSI", cantidad: 5, unidad: "UN", orden: 1 },
    { remito_id: remito.id, descripcion: "Junta espirometalica 4 300#", cantidad: 20, unidad: "UN", orden: 2 },
  ]);
  console.log("Items:", itemsErr ? itemsErr.message : "OK (3 items)");

  // 5. Check config
  const { data: config } = await supabase.from("cai_config").select("ultimo_usado, numero_hasta").eq("sociedad_id", socId).single();
  console.log("CAI usado:", config.ultimo_usado, "/", config.numero_hasta);

  const pvStr = String(cai.punto_venta).padStart(4, "0");
  const nroStr = String(cai.nro_comprobante).padStart(8, "0");
  console.log("\n=== RESULTADO ===");
  console.log("Numero interno:", remito.numero);
  console.log("Numero fiscal:  R " + pvStr + "-" + nroStr);
  console.log("CAI:           ", cai.cai_numero);
  console.log("=================");
}

test().catch(e => console.error(e));
