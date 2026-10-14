// Carga al CRM las reglas comerciales, los descuentos opcionales, los márgenes de venta y las fotos de la lista de costos.
// NO modifica el Excel ni catalogo_crm.csv (solo los lee). NO cambia costos ni precios.
//
//   node scripts/importar-reglas-costos.cjs                  → SOLO muestra el resumen (no cambia nada)
//   node scripts/importar-reglas-costos.cjs --aplicar        → guarda reglas, opcionales, márgenes y vínculos (una transacción)
//   node scripts/importar-reglas-costos.cjs --aplicar --fotos → además sube las fotos al bucket "productos"
//   opcionales: --excel "ruta.xlsx"  --fotos-dir "carpeta con fotos/ y fotos_por_articulo.csv"
//
// Necesita en .env.local: SUPABASE_DB_URL (y para --fotos: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY). Nunca se muestran.
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");
const { Client } = require("pg");

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^\uFEFF/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const APLICAR = process.argv.includes("--aplicar");
const FOTOS = process.argv.includes("--fotos");
const EXCEL = arg("--excel") || "G:\\Unidades compartidas\\02 - LAZZARI\\CRM - COSTO VENTA\\Base_de_Costos_Lazzari_Oct2026.xlsx";
const FOTOS_DIR = arg("--fotos-dir");

// Nombre en el Excel → nombre en la lista de costos (catalogo_costos.proveedor).
const NOMBRE_LISTA = { "Segufer (3M)": "Segufer", "TKW Calzado": "TKW", "TKW Ropa": "TKW" };

// Decisiones de Augusto (13/10/2026). Todos los % son sobre el precio de lista, en cascada. No entran en el costo.
const OPCIONALES = [
  { lista: "DPS", tipo: "pago_anticipado", pct: 5 },
  { lista: "Startex", tipo: "pago_anticipado", pct: 5, minimo: 1750000, moneda: "ARS", condicion: "Solo en pedidos de más de $1.750.000 + IVA" },
  { lista: "Aire Libre", tipo: "pago_anticipado", pct: 3 },
  { lista: "SPI", tipo: "pago_anticipado", pct: 5 },
  { lista: "Fravida", tipo: "pago_anticipado", pct: 5 },
  { lista: "Pegaso", tipo: "cantidad", pct: 5, condicion: "Más de 6 botines por talle (negociable)" },
  { lista: "Fravida", tipo: "volumen_mensual", pct: null, minimo: 10000000, moneda: "ARS", condicion: "Si la compra del mes supera $10 M: 30 % en lugar del 20 % (no se suman)" },
  { lista: "Conoflex", tipo: "excepcional", pct: 40, requiereAut: true, condicion: "40 % en lugar del 35 %, solo en casos excepcionales con autorización de Augusto" },
];
// Ajustes a la regla del Excel pedidos por Augusto.
const AJUSTES_REGLA = {
  Pegaso: { desc2: null, como: "Lista − 20 % (fijo). El 5 % es opcional por cantidad (más de 6 botines por talle, negociable): no entra en el costo.",
    nota: "⚠️ La lista de costos todavía descuenta el 5 %: se corrige en el chat de listas." },
};
// Proveedores del CRM a vincular con un nombre de la lista (catalogo_proveedores), por razón social.
const VINCULOS = [{ razon: "MARIANA  SOCIEDAD ANONIMA", lista: "Pegaso" }];

const pct = (v) => (typeof v === "number" && v > 0 ? Math.round(v * 10000) / 100 : null); // 0.2 → 20
const fechaHasta = (t) => { const m = String(t || "").match(/hasta\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };

function leerReglas() {
  const wb = XLSX.readFile(EXCEL);
  const ws = wb.Sheets["Reglas"];
  if (!ws) throw new Error('El Excel no tiene la hoja "Reglas"');
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
  const iHead = filas.findIndex((r) => r && r[0] === "Proveedor" && r.includes("Moneda"));
  const head = filas[iHead];
  const col = (nombre) => head.findIndex((h) => String(h || "").startsWith(nombre));
  const C = { prov: 0, mon: col("Moneda"), vig: col("Vigencia"), d1: col("Desc. 1"), d2: col("Desc. 2"), opc: col("Opcional"), otro: col("Otro"), como: col("Cómo se calcula"), cond: col("Condiciones") };
  const reglas = new Map(); const otros = {};
  for (let i = iHead + 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r || !r[0] || /^\d+\.\s/.test(String(r[0]).trim())) break; // "2.  Criterio general"
    const nombreExcel = String(r[0]).trim();
    const lista = NOMBRE_LISTA[nombreExcel] || nombreExcel;
    const prefijo = NOMBRE_LISTA[nombreExcel] && lista !== nombreExcel ? `${nombreExcel}: ` : "";
    const nueva = { lista, moneda: r[C.mon], vigencia_texto: r[C.vig] ? String(r[C.vig]) : null, vigencia_hasta: fechaHasta(r[C.vig]),
      desc1: pct(r[C.d1]), desc2: pct(r[C.d2]), como: r[C.como] ? prefijo + r[C.como] : null, cond: r[C.cond] ? prefijo + r[C.cond] : null };
    if (pct(r[C.otro])) otros[lista] = pct(r[C.otro]);
    const prev = reglas.get(lista);
    if (prev) { // TKW Calzado + TKW Ropa → una sola regla con los dos textos
      prev.como = [prev.como, nueva.como].filter(Boolean).join(" · ");
      prev.cond = [prev.cond, nueva.cond].filter(Boolean).join(" · ");
      prev.vigencia_texto = [prev.vigencia_texto, nueva.vigencia_texto].filter(Boolean).join(" · ");
      prev.moneda = [...new Set([prev.moneda, nueva.moneda].filter(Boolean).join(" / ").split(" / "))].join(" / ");
    } else reglas.set(lista, nueva);
  }
  for (const [lista, a] of Object.entries(AJUSTES_REGLA)) {
    const r = reglas.get(lista); if (!r) continue;
    if ("desc2" in a) r.desc2 = a.desc2;
    if (a.como) r.como = a.como;
    if (a.nota) r.cond = [a.nota, r.cond].filter(Boolean).join(" ");
  }
  // Márgenes (tabla 4) y redondeo.
  const iMarg = filas.findIndex((r) => r && r[0] === "Rubro" && r.some((x) => String(x || "").startsWith("Margen")));
  const cM = iMarg >= 0 ? filas[iMarg].findIndex((x) => String(x || "").startsWith("Margen")) : -1;
  const cA = iMarg >= 0 ? filas[iMarg].findIndex((x) => String(x || "").startsWith("A qué")) : -1;
  const margenes = [];
  for (let i = iMarg + 1; iMarg >= 0 && i < filas.length; i++) {
    const r = filas[i];
    if (!r || typeof r[cM] !== "number") break;
    margenes.push({ orden: margenes.length + 1, rubro: String(r[0]).trim(), margen: r[cM], aplica_a: cA >= 0 && r[cA] ? String(r[cA]) : null });
  }
  const textoRedondeo = filas.map((r) => String((r || [])[0] || "")).find((t) => t.startsWith("Redondeo")) || null;
  return { reglas: [...reglas.values()], otros, margenes, textoRedondeo };
}

function leerFotos() {
  if (!FOTOS_DIR) return null;
  const csv = fs.readFileSync(path.join(FOTOS_DIR, "fotos_por_articulo.csv"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const head = csv[0].split(";");
  const iP = head.indexOf("proveedor"), iC = head.indexOf("codigo"), iF = head.indexOf("foto");
  return csv.slice(1).map((l) => l.split(";")).filter((c) => c[iF]).map((c) => ({ proveedor: c[iP].trim(), codigo: c[iC].trim(), foto: c[iF].trim() }));
}

const limpioCodigo = (c) => String(c || "").replace(/[\r\n•"]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const slug = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

(async () => {
  const { reglas, otros, margenes, textoRedondeo } = leerReglas();
  const opcionales = OPCIONALES.map((o) => (o.pct == null ? { ...o, pct: otros[o.lista] ?? null } : o));
  const fotos = leerFotos();

  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query(APLICAR ? "begin" : "begin transaction read only");
    const listas = new Set((await db.query("select distinct proveedor from catalogo_costos where activo")).rows.map((r) => r.proveedor));

    console.log(`\n== REGLAS (${reglas.length}) — de la hoja "Reglas" ==`);
    console.table(reglas.map((r) => ({ lista: r.lista, en_catalogo: listas.has(r.lista) ? "sí" : "NO", moneda: r.moneda, vigencia: r.vigencia_texto, "desc1 %": r.desc1, "desc2 %": r.desc2, como: (r.como || "").slice(0, 60) })));
    console.log(`\n== DESCUENTOS OPCIONALES (no entran en el costo) ==`);
    console.table(opcionales.map((o) => ({ lista: o.lista, tipo: o.tipo, "%": o.pct ?? "FALTA", minimo: o.minimo ?? "", condicion: o.condicion ?? "" })));
    console.log(`\n== MÁRGENES DE VENTA (${margenes.length}) ==`);
    console.table(margenes.map((m) => ({ rubro: m.rubro, "margen %": Math.round(m.margen * 1000) / 10 })));
    console.log("Redondeo:", textoRedondeo);

    const sinCatalogo = reglas.filter((r) => !listas.has(r.lista)).map((r) => r.lista);
    if (sinCatalogo.length) console.log("\nAVISO: reglas de proveedores que no están en la lista de costos:", sinCatalogo.join(", "));
    const faltaPct = opcionales.filter((o) => o.pct == null);
    if (faltaPct.length) console.log("AVISO: opcionales sin % (se saltean):", faltaPct.map((o) => `${o.lista}/${o.tipo}`).join(", "));

    // Vínculos nuevos
    for (const v of VINCULOS) {
      const p = (await db.query("select p.id, s.nombre as sociedad, p.sociedad_id from proveedores p join sociedades s on s.id = p.sociedad_id where p.razon_social = $1", [v.razon])).rows;
      console.log(`\nVínculo: ${v.razon} = "${v.lista}" en la lista → ${p.length ? p.map((x) => x.sociedad).join(", ") : "NO ENCONTRADO"}`);
      if (APLICAR) for (const x of p) {
        await db.query("insert into catalogo_proveedores (sociedad_id, proveedor_lista, proveedor_id) values ($1, $2, $3) on conflict (sociedad_id, proveedor_lista) do update set proveedor_id = excluded.proveedor_id", [x.sociedad_id, v.lista, x.id]);
        await db.query("update proveedores set nombre_fantasia = coalesce(nullif(nombre_fantasia, ''), $2) where id = $1", [x.id, v.lista]);
      }
    }

    // Fotos: cruce con la lista de costos
    let fotosPlan = [];
    if (fotos) {
      // También los inactivos (salieron de la lista): si vuelven, ya tienen su foto.
      const cat = (await db.query("select id, proveedor, codigo from catalogo_costos order by activo")).rows;
      const idx = new Map(cat.map((c) => [`${c.proveedor}|${limpioCodigo(c.codigo)}`, c.id]));
      fotosPlan = fotos.map((f) => ({ ...f, id: idx.get(`${f.proveedor}|${limpioCodigo(f.codigo)}`) }));
      const conId = fotosPlan.filter((f) => f.id);
      const sinArchivo = conId.filter((f) => !fs.existsSync(path.join(FOTOS_DIR, "fotos", f.foto)));
      console.log(`\n== FOTOS == en el índice: ${fotos.length} · coinciden con la lista: ${conId.length} · sin coincidencia: ${fotos.length - conId.length} · archivo faltante: ${sinArchivo.length}`);
      fotosPlan = conId.filter((f) => !sinArchivo.includes(f));
    }

    if (!APLICAR) { console.log("\nSOLO RESUMEN: no se guardó nada. Para guardar: --aplicar (y --fotos para subir las fotos)."); await db.query("rollback"); return; }

    for (const r of reglas) {
      await db.query(`insert into proveedor_reglas (proveedor_lista, moneda, vigencia_texto, vigencia_hasta, desc1, desc2, en_cascada, como_se_calcula, condiciones, actualizado_at)
        values ($1,$2,$3,$4,$5,$6,true,$7,$8,now())
        on conflict (proveedor_lista) do update set moneda=excluded.moneda, vigencia_texto=excluded.vigencia_texto, vigencia_hasta=excluded.vigencia_hasta,
          desc1=excluded.desc1, desc2=excluded.desc2, como_se_calcula=excluded.como_se_calcula, condiciones=excluded.condiciones, actualizado_at=now()`,
        [r.lista, r.moneda, r.vigencia_texto, r.vigencia_hasta, r.desc1, r.desc2, r.como, r.cond]);
    }
    // Pegaso: el 5 % que tenía Mariana S.A. como pago anticipado pasa a "por cantidad" (no se cuenta dos veces).
    await db.query("update proveedores set descuento_pronto_pago = null where razon_social = $1", ["MARIANA  SOCIEDAD ANONIMA"]);
    for (const o of opcionales.filter((x) => x.pct != null)) {
      await db.query(`insert into proveedor_descuentos_opcionales (proveedor_lista, tipo, porcentaje, monto_minimo, moneda_minimo, condicion, requiere_autorizacion, activo, actualizado_at)
        values ($1,$2,$3,$4,$5,$6,$7,true,now())
        on conflict (proveedor_lista, tipo) do update set porcentaje=excluded.porcentaje, monto_minimo=excluded.monto_minimo, moneda_minimo=excluded.moneda_minimo,
          condicion=excluded.condicion, requiere_autorizacion=excluded.requiere_autorizacion, activo=true, actualizado_at=now()`,
        [o.lista, o.tipo, o.pct, o.minimo ?? null, o.moneda ?? null, o.condicion ?? null, !!o.requiereAut]);
    }
    for (const m of margenes) {
      await db.query(`insert into margenes_venta (orden, rubro, margen, aplica_a, actualizado_at) values ($1,$2,$3,$4,now())
        on conflict (rubro) do update set orden=excluded.orden, margen=excluded.margen, aplica_a=excluded.aplica_a, actualizado_at=now()`, [m.orden, m.rubro, m.margen, m.aplica_a]);
    }
    await db.query(`insert into lista_costos_config (clave, valor, actualizado_at) values ('redondeo', $1, now())
      on conflict (clave) do update set valor = excluded.valor, actualizado_at = now()`,
      [JSON.stringify({ texto: textoRedondeo, ARS: { multiplo: 100, multiplo_menor: 10, umbral_menor: 1000, hacia: "arriba" }, USD: { decimales: 2, hacia: "arriba" } })]);
    await db.query("insert into catalogo_cargas (tipo, archivo, resumen) values ('reglas', $1, $2)",
      [path.basename(EXCEL), JSON.stringify({ reglas: reglas.length, opcionales: opcionales.filter((o) => o.pct != null).length, margenes: margenes.length, vinculos: VINCULOS.map((v) => v.lista) })]);

    if (FOTOS && fotosPlan.length) {
      if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Faltan claves para subir fotos");
      let ok = 0, err = 0;
      for (const f of fotosPlan) {
        const destino = `${slug(f.proveedor)}/${f.foto}`;
        const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/productos/${encodeURI(destino)}`, {
          method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
          body: fs.readFileSync(path.join(FOTOS_DIR, "fotos", f.foto)),
        });
        if (res.ok) { ok++; await db.query("update catalogo_costos set foto_path = $2 where id = $1", [f.id, destino]); }
        else { err++; if (err <= 5) console.log("Error subiendo", destino, res.status, await res.text()); }
      }
      await db.query("insert into catalogo_cargas (tipo, archivo, resumen) values ('fotos', 'fotos_costos.zip', $1)", [JSON.stringify({ subidas: ok, errores: err })]);
      console.log(`Fotos subidas: ${ok} · con error: ${err}`);
    }
    await db.query("commit");
    console.log("\nOK: guardado.");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
})().catch((e) => { console.error("ERROR (no se guardó nada):", e.message); process.exit(1); });
