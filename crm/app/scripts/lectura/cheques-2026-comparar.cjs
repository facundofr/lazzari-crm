// SOLO LECTURA: compara ideas/cheques_desde_2026.csv con la tabla echeqs. NO guarda nada (transacción READ ONLY).
// Uso (desde crm/app): node scripts/lectura/cheques-2026-comparar.cjs [sociedad: Lazzari]
// Muestra: cuáles ya están, cuáles faltan, diferencias de estado/fecha/monto y las fechas a corregir (año 2025 → 2026).
const path = require("path");
const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));
const SOCIEDAD = process.argv[2] || "Lazzari";
const CSV = path.join(__dirname, "../../../../ideas/cheques_desde_2026.csv");

const lineas = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
const cab = lineas[0].split(";");
const filas = lineas.slice(1).map((l) => { const c = l.split(";"); return Object.fromEntries(cab.map((k, i) => [k, (c[i] || "").trim()])); });

// Año "2025" en una fecha que debería ser 2026 (el resto de las fechas de la fila son 2026).
const arreglos = [];
function arreglarFecha(f, campo, fila) {
  if (f && /^2025-/.test(f)) { const n = "2026" + f.slice(4); arreglos.push(`${fila.numero} ${campo}: ${f} → ${n}`); return n; }
  return f;
}
for (const f of filas) for (const k of ["fecha_emision", "fecha_pago", "fecha_debito", "fecha_deposito"]) f[k] = arreglarFecha(f[k], k, f);

const sinCeros = (n) => String(n).replace(/^0+/, "");
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
// Estado del CSV → estado de la base (emitidos: cobrado/entregado; recibidos: tal cual).
const estadoBase = (f) => f.direccion === "emitido" ? (f.estado === "cobrado" ? "cobrado" : f.estado === "rechazado" ? "rechazado" : "entregado") : f.estado;

(async () => {
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin transaction read only");
    const soc = (await db.query("select id from sociedades where nombre=$1", [SOCIEDAD])).rows[0];
    if (!soc) throw new Error("No existe la sociedad " + SOCIEDAD);
    const base = (await db.query("select numero,direccion,estado,monto,fecha_pago,fecha_emision,cubre_tercero from echeqs where sociedad_id=$1", [soc.id])).rows;
    const idx = new Map(base.map((b) => [b.direccion + "|" + sinCeros(b.numero), b]));
    const ya = [], faltan = [], difEstado = [], difMonto = [], difFecha = [], difMartin = [];
    for (const f of filas) {
      const b = idx.get(f.direccion + "|" + sinCeros(f.numero));
      if (!b) { faltan.push(f); continue; }
      ya.push(f);
      if (estadoBase(f) !== b.estado) difEstado.push(`${f.direccion} ${f.numero}: CSV ${f.estado} / base ${b.estado}`);
      if (Math.abs(+f.monto - +b.monto) > 0.005) difMonto.push(`${f.numero}: CSV ${f.monto} / base ${b.monto}`);
      if (f.fecha_pago && f.fecha_pago !== ymd(b.fecha_pago)) difFecha.push(`${f.numero}: pago CSV ${f.fecha_pago} / base ${ymd(b.fecha_pago)}`);
      if (f.martin_fernandez === "si" && !b.cubre_tercero) difMartin.push(f.numero);
    }
    const csvKeys = new Set(filas.map((f) => f.direccion + "|" + sinCeros(f.numero)));
    const soloBase = base.filter((b) => !csvKeys.has(b.direccion + "|" + sinCeros(b.numero)) && ymd(b.fecha_pago) >= "2026-01-01");
    const suma = (a) => a.reduce((s, f) => s + +f.monto, 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
    console.log(`CSV: ${filas.length} cheques · base (${SOCIEDAD}): ${base.length}`);
    console.log(`Ya están: ${ya.length} · Faltan: ${faltan.length} ($${suma(faltan)})`);
    const porEstado = faltan.reduce((a, f) => { const k = f.direccion + "/" + f.estado + (f.martin_fernandez ? "/Martín" : ""); a[k] = (a[k] || 0) + 1; return a; }, {});
    console.log("Faltan por tipo:", porEstado);
    const rango = (a) => a.length ? `${a.map((f) => f.fecha_pago).sort()[0]} a ${a.map((f) => f.fecha_pago).sort().slice(-1)[0]}` : "-";
    console.log("Faltan, fechas de pago:", rango(faltan));
    console.log(`Fechas corregidas (2025→2026): ${arreglos.length}`); arreglos.slice(0, 15).forEach((a) => console.log("  ", a));
    for (const [t, a] of [["Estado distinto", difEstado], ["Monto distinto", difMonto], ["Fecha de pago distinta", difFecha], ["Martín sin marcar en la base", difMartin]]) {
      console.log(`${t}: ${a.length}`); a.slice(0, 15).forEach((x) => console.log("  ", x));
    }
    console.log(`En la base desde 2026 y NO en el CSV: ${soloBase.length}`); soloBase.slice(0, 15).forEach((b) => console.log("  ", b.direccion, b.numero, b.estado, b.monto, ymd(b.fecha_pago)));
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
