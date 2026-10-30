// SOLO LECTURA: arma la lista de lo que cambiaría con nombrePropio / telefonoAR (Augusto 30/10/2026).
// Uso (desde crm/app): npx tsx scripts/lectura/formato-nombres-telefonos.ts salida.csv
// Escribe un CSV (;) con tabla, campo, id, antes, después y si el teléfono queda para revisar. No cambia nada.
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error pg no tiene tipos instalados (solo se usa en estos scripts de lectura)
import { Client } from "pg";
import { nombrePropio, telefonoAR, telefonoARevisar } from "../../src/lib/nombres-telefonos";

/** Qué se revisa: tabla, campos de nombre y campos de teléfono. */
export const CAMPOS: { tabla: string; nombres: string[]; telefonos: string[]; titulo: string }[] = [
  { tabla: "clientes", nombres: ["razon_social"], telefonos: ["telefono"], titulo: "razon_social" },
  { tabla: "proveedores", nombres: ["razon_social", "nombre_fantasia"], telefonos: ["telefono"], titulo: "razon_social" },
  { tabla: "contactos", nombres: ["nombre"], telefonos: ["telefono", "whatsapp"], titulo: "nombre" },
  { tabla: "cliente_sucursales", nombres: ["nombre"], telefonos: ["telefono"], titulo: "nombre" },
  { tabla: "transportistas", nombres: ["nombre", "razon_social"], telefonos: ["telefono"], titulo: "nombre" },
];

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split(/\r?\n/)
  .map((l) => l.replace(/^﻿/, "").trim()).filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }));

(async () => {
  const salida = process.argv[2] || "formato-nombres-telefonos.csv";
  const db = new Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const filas: string[][] = [["Tabla", "Campo", "Id", "Ficha", "Antes", "Después", "Revisar"]];
  const cuenta: Record<string, number> = {};
  try {
    await db.query("begin transaction read only");
    for (const c of CAMPOS) {
      const cols = [...new Set(["id", c.titulo, ...c.nombres, ...c.telefonos])];
      const { rows } = await db.query(`select ${cols.join(", ")} from public.${c.tabla} order by ${c.titulo}`);
      for (const r of rows) {
        for (const campo of [...c.nombres, ...c.telefonos]) {
          const antes = r[campo];
          if (antes == null || String(antes).trim() === "") continue;
          const esTel = c.telefonos.includes(campo);
          const despues = esTel ? telefonoAR(antes) : nombrePropio(antes);
          const revisar = esTel && telefonoARevisar(antes);
          if (despues === antes && !revisar) continue;
          filas.push([c.tabla, campo, r.id, String(r[c.titulo] ?? ""), String(antes), despues === antes ? "" : despues, revisar ? "teléfono a revisar" : ""]);
          const k = `${c.tabla}.${campo}${revisar ? " (a revisar)" : ""}`;
          cuenta[k] = (cuenta[k] || 0) + 1;
        }
      }
    }
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
  const csv = filas.map((f) => f.map((x) => `"${x.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  fs.writeFileSync(salida, "﻿" + csv, "utf8");
  console.table(cuenta);
  console.log(`${filas.length - 1} filas en ${salida}`);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
