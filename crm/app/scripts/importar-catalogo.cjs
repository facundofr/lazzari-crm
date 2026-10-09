// Importa catalogo_crm.csv (la lista vigente del chat de listas) a la tabla catalogo_costos.
//
//   node scripts/importar-catalogo.cjs            → SOLO muestra el resumen (no cambia nada)
//   node scripts/importar-catalogo.cjs --aplicar  → aplica los cambios
//   (opcional) --archivo "ruta\al\catalogo_crm.csv"
//
// Reglas:
//  - Un artículo se identifica por proveedor + código + descripción (o por codigo_interno si el CSV lo trae).
//  - Lo que no está en el CSV se marca inactivo (no se borra).
//  - El precio de venta se usa tal cual (es el de la web); el CRM no lo recalcula.
//  - No toca presupuestos, OC ni facturas.
const fs = require("node:fs");
const path = require("node:path");

const ARCHIVO_DEFAULT = "G:\\Unidades compartidas\\02 - LAZZARI\\CRM - COSTO VENTA\\catalogo_crm.csv";
const MONEDAS = { ars: "ARS", usd: "USD", "usd divisa": "USD divisa" };

function parseCsv(texto, sep = ";") {
  const filas = []; let fila = []; let campo = ""; let comillas = false;
  texto = texto.replace(/^\uFEFF/, "");
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.some(x => x.trim() !== "")) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some(x => x.trim() !== "")) filas.push(fila);
  return filas;
}

function numero(x) {
  let s = String(x ?? "").trim().replace(/\s|\$/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const claveDe = a => a.codigo_interno ? `ci|${a.codigo_interno}` : `${a.proveedor}|${a.codigo}|${a.descripcion}`.toLowerCase();
const igual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

/** Lee el CSV y devuelve artículos válidos, repetidos exactos descartados y conflictos. */
function leerCatalogo(texto) {
  const filas = parseCsv(texto);
  const cab = filas.shift().map(h => h.trim().toLowerCase());
  const col = n => cab.indexOf(n);
  for (const n of ["proveedor", "codigo", "descripcion", "moneda", "costo", "precio_venta"]) {
    if (col(n) < 0) throw new Error(`Falta la columna «${n}» en el CSV`);
  }
  const errores = [];
  const porClave = new Map();
  filas.forEach((f, i) => {
    const a = {
      proveedor: (f[col("proveedor")] || "").trim(),
      codigo: (f[col("codigo")] || "").trim(),
      descripcion: (f[col("descripcion")] || "").trim(),
      codigo_interno: col("codigo_interno") >= 0 ? (f[col("codigo_interno")] || "").trim() || null : null,
      moneda: MONEDAS[(f[col("moneda")] || "").trim().toLowerCase()],
      costo: numero(f[col("costo")]),
      margen: col("margen") >= 0 ? numero(f[col("margen")]) : null,
      ...(col("marca") >= 0 ? { marca: (f[col("marca")] || "").trim() || null } : {}),
      ...(col("rubro") >= 0 ? { rubro: (f[col("rubro")] || "").trim() || null } : {}),
      precio_venta: numero(f[col("precio_venta")]),
    };
    const linea = i + 2;
    if (a.codigo === "—" || a.codigo === "-") a.codigo = "";
    // Sin código de proveedor se acepta si trae codigo_interno (ej.: MED-001).
    if (!a.proveedor || !a.descripcion || (!a.codigo && !a.codigo_interno)) return errores.push(`Línea ${linea}: falta proveedor, descripción o código`);
    if (!a.moneda) return errores.push(`Línea ${linea}: moneda desconocida «${f[col("moneda")]}»`);
    if (a.costo === null || a.precio_venta === null) return errores.push(`Línea ${linea}: costo o precio inválido`);
    const k = claveDe(a);
    (porClave.get(k) || porClave.set(k, []).get(k)).push({ ...a, linea });
  });
  const articulos = [], repetidos = [], conflictos = [];
  for (const lista of porClave.values()) {
    const a = lista[0];
    const distintos = lista.filter(b => b.moneda !== a.moneda || !igual(b.costo, a.costo) || !igual(b.precio_venta, a.precio_venta));
    if (distintos.length) { conflictos.push(lista); continue; }
    if (lista.length > 1) repetidos.push(lista);
    const { linea, ...limpio } = a; void linea;
    articulos.push(limpio);
  }
  return { articulos, repetidos, conflictos, errores };
}

/** Compara el CSV con lo que hay en la base. */
function compararCatalogo(articulos, existentes) {
  const base = new Map(existentes.map(e => [claveDe(e), e]));
  // Si el CSV trae codigo_interno y en la base todavía no estaba, se busca por proveedor+código+descripción.
  const basePorTexto = new Map(existentes.map(e => [`${e.proveedor}|${e.codigo}|${e.descripcion}`.toLowerCase(), e]));
  const nuevos = [], cambian = [], reactivan = [], iguales = [];
  const vistos = new Set();
  for (const a of articulos) {
    const e = base.get(claveDe(a)) || basePorTexto.get(`${a.proveedor}|${a.codigo}|${a.descripcion}`.toLowerCase());
    if (!e) { nuevos.push(a); continue; }
    vistos.add(e.id);
    const cambioPrecio = e.moneda !== a.moneda || !igual(e.costo, a.costo) || !igual(e.precio_venta, a.precio_venta);
    const cambioDatos = cambioPrecio || (a.margen !== null && !igual(e.margen ?? 0, a.margen)) || (a.codigo_interno && e.codigo_interno !== a.codigo_interno)
      || ("marca" in a && (e.marca || null) !== a.marca) || ("rubro" in a && (e.rubro || null) !== a.rubro);
    if (!e.activo) reactivan.push({ antes: e, ahora: a, cambioPrecio });
    else if (cambioDatos) cambian.push({ antes: e, ahora: a, cambioPrecio });
    else iguales.push(a);
  }
  const desactivan = existentes.filter(e => e.activo && !vistos.has(e.id));
  return { nuevos, cambian, reactivan, desactivan, iguales };
}

function leerEnv(archivo) {
  const env = {};
  for (const l of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const iArchivo = args.indexOf("--archivo");
  const archivo = iArchivo >= 0 ? args[iArchivo + 1] : ARCHIVO_DEFAULT;
  if (!fs.existsSync(archivo)) throw new Error(`No encuentro el archivo: ${archivo}`);

  const { articulos, repetidos, conflictos, errores } = leerCatalogo(fs.readFileSync(archivo, "utf8"));
  const env = leerEnv(path.join(__dirname, "..", ".env.local"));
  const { createClient } = require("@supabase/supabase-js");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const existentes = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from("catalogo_costos").select("*").range(desde, desde + 999);
    if (error) throw new Error(`No pude leer catalogo_costos (¿corriste la migración?): ${error.message}`);
    existentes.push(...data);
    if (data.length < 1000) break;
  }
  const r = compararCatalogo(articulos, existentes);
  const precioCambia = r.cambian.filter(c => c.cambioPrecio).length;

  console.log(`\nArchivo: ${archivo}`);
  console.log(`Filas válidas del CSV: ${articulos.length}   (en la base hoy: ${existentes.length}, activos ${existentes.filter(e => e.activo).length})\n`);
  console.log(`  Nuevos:                 ${r.nuevos.length}`);
  console.log(`  Cambian de precio:      ${precioCambia}`);
  console.log(`  Cambian otros datos:    ${r.cambian.length - precioCambia}`);
  console.log(`  Se reactivan:           ${r.reactivan.length}`);
  console.log(`  Se desactivan:          ${r.desactivan.length}`);
  console.log(`  Sin cambios:            ${r.iguales.length}`);
  if (repetidos.length) console.log(`\n  Filas repetidas idénticas (se cargan una vez): ${repetidos.length}`);
  if (conflictos.length) {
    console.log(`\n  NO SE CARGAN — mismo artículo con precios distintos (corregir en el chat de listas): ${conflictos.length}`);
    for (const l of conflictos) console.log(`    · ${l[0].proveedor} | ${l[0].codigo} | ${l[0].descripcion.slice(0, 70)} → ${l.map(x => `${x.costo}/${x.precio_venta}`).join(" vs ")}`);
  }
  if (errores.length) { console.log(`\n  Filas con error (no se cargan): ${errores.length}`); errores.slice(0, 15).forEach(e => console.log(`    · ${e}`)); }
  if (precioCambia) {
    console.log("\n  Ejemplos de cambios de precio:");
    r.cambian.filter(c => c.cambioPrecio).slice(0, 10).forEach(c => console.log(`    · ${c.ahora.proveedor} ${c.ahora.codigo}: costo ${c.antes.costo} → ${c.ahora.costo} ${c.ahora.moneda}, venta ${c.antes.precio_venta} → ${c.ahora.precio_venta}`));
  }
  if (r.desactivan.length) {
    console.log("\n  Ejemplos que se desactivan:");
    r.desactivan.slice(0, 10).forEach(e => console.log(`    · ${e.proveedor} ${e.codigo} ${e.descripcion.slice(0, 60)}`));
  }

  if (!aplicar) { console.log("\nNo se cambió nada. Para aplicar: node scripts/importar-catalogo.cjs --aplicar\n"); return; }

  const ahora = new Date().toISOString();
  const lotes = (arr, n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  for (const lote of lotes(r.nuevos)) {
    const { error } = await db.from("catalogo_costos").insert(lote.map(a => ({ ...a, activo: true, actualizado_at: ahora })));
    if (error) throw new Error(`Error cargando nuevos: ${error.message}`);
  }
  const hist = [];
  const actualizar = [...r.cambian, ...r.reactivan];
  for (const lote of lotes(actualizar)) {
    const { error } = await db.from("catalogo_costos").upsert(lote.map(c => ({ id: c.antes.id, ...c.ahora, activo: true, actualizado_at: ahora })), { onConflict: "id" });
    if (error) throw new Error(`Error actualizando: ${error.message}`);
    process.stdout.write(".");
  }
  for (const c of actualizar) {
    if (c.cambioPrecio || !c.antes.activo) hist.push({
      catalogo_id: c.antes.id, cambio: c.antes.activo ? "precio" : "reactivado",
      moneda_anterior: c.antes.moneda, costo_anterior: c.antes.costo, precio_venta_anterior: c.antes.precio_venta,
      moneda_nueva: c.ahora.moneda, costo_nuevo: c.ahora.costo, precio_venta_nuevo: c.ahora.precio_venta,
    });
  }
  for (const lote of lotes(r.desactivan.map(e => e.id), 200)) {
    const { error } = await db.from("catalogo_costos").update({ activo: false, actualizado_at: ahora }).in("id", lote);
    if (error) throw new Error(`Error desactivando: ${error.message}`);
  }
  r.desactivan.forEach(e => hist.push({ catalogo_id: e.id, cambio: "desactivado", moneda_anterior: e.moneda, costo_anterior: e.costo, precio_venta_anterior: e.precio_venta }));
  for (const lote of lotes(hist)) {
    const { error } = await db.from("catalogo_costos_historial").insert(lote);
    if (error) throw new Error(`Error guardando historial: ${error.message}`);
  }
  console.log(`\nListo: ${r.nuevos.length} nuevos, ${r.cambian.length} actualizados, ${r.reactivan.length} reactivados, ${r.desactivan.length} desactivados.\n`);
}

module.exports = { parseCsv, numero, leerCatalogo, compararCatalogo };
if (require.main === module) main().catch(e => { console.error(`\nERROR: ${e.message}\n`); process.exit(1); });
