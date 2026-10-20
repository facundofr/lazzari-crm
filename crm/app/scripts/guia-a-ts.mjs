// Genera src/lib/asistente-guia-datos.ts a partir de docs/GUIA-USO.md (la guía se edita SOLO en el .md).
// Uso (desde crm/app): node scripts/guia-a-ts.mjs          → escribe el archivo
//                      node scripts/guia-a-ts.mjs --check  → solo controla que esté al día (sale con error si no)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const MD = path.join(aqui, "../../../docs/GUIA-USO.md");
const TS = path.join(aqui, "../src/lib/asistente-guia-datos.ts");

// Ruta de la pantalla → módulo de permisos (ROLE_PERMISSIONS en lib/types.ts). null = la ven todos.
const MODULO_POR_RUTA = {
  "/dashboard": "dashboard", "/pendientes": "dashboard", "/calendario": "calendario",
  "/clientes": "clientes", "/oportunidades": "clientes", "/presupuestos": "presupuestos", "/ventas": "presupuestos",
  "/muestras": "muestras", "/consulta-facturas": "consulta_facturas",
  "/proveedores": "proveedores", "/ordenes-compra": "ordenes_compra", "/compras-lazza": "ordenes_compra", "/personalizacion": "ordenes_compra",
  "/remitos": "remitos", "/transportes": "remitos", "/stock": "stock",
  "/finanzas": "finanzas", "/facturacion": "facturacion", "/reportes": "reportes", "/configuracion": "configuracion",
  "/papelera": null,
};

const md = fs.readFileSync(MD, "utf8").replace(/\r\n/g, "\n");
const lineas = md.split("\n");
const secciones = [];
let grupo = "General", rutaGrupo = null, actual = null, intro = [];

function cerrar() {
  if (actual) { actual.texto = actual.texto.join("\n").trim(); secciones.push(actual); actual = null; }
}
for (const l of lineas) {
  const h2 = l.match(/^## (.+)$/);
  const h3 = l.match(/^### (.+)$/);
  if (h2) {
    cerrar();
    grupo = h2[1].split(/ — /)[0].trim();
    const r = h2[1].match(/\((\/[a-z-]+)\)/);
    rutaGrupo = r ? r[1] : null;
    // Texto suelto debajo del ## (ej. Finanzas): se guarda como sección del grupo.
    actual = { id: "", grupo, titulo: grupo, ruta: rutaGrupo, texto: [] };
    continue;
  }
  if (h3) {
    cerrar();
    const titulo = h3[1].split(/ — /)[0].trim();
    const r = h3[1].match(/ — (\/[a-z-]+)/);
    actual = { id: "", grupo, titulo, ruta: r ? r[1] : rutaGrupo, texto: [] };
    continue;
  }
  if (/^---\s*$/.test(l)) continue;
  if (actual) actual.texto.push(l);
  else if (!/^# /.test(l) && !/^<!--/.test(l) && !/^Guía corta/.test(l)) intro.push(l);
}
cerrar();

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const finales = [
  { id: "antes-de-empezar", grupo: "General", titulo: "Antes de empezar", ruta: null, modulo: null, texto: intro.join("\n").trim() },
  ...secciones.filter((s) => s.texto).map((s) => ({
    id: slug(`${s.grupo}-${s.titulo}`),
    grupo: s.grupo,
    titulo: s.titulo,
    ruta: s.ruta,
    modulo: s.ruta && s.ruta in MODULO_POR_RUTA ? MODULO_POR_RUTA[s.ruta] : null,
    texto: s.texto,
  })),
];

const salida = `// ARCHIVO GENERADO por scripts/guia-a-ts.mjs desde docs/GUIA-USO.md — NO EDITAR A MANO.
// Para cambiar la guía: editar docs/GUIA-USO.md y correr \`node scripts/guia-a-ts.mjs\` (desde crm/app).

export interface SeccionGuia {
  id: string;
  grupo: string;
  titulo: string;
  /** Pantalla a la que corresponde (para "Ir" y para saber dónde está el usuario). */
  ruta: string | null;
  /** Módulo de permisos (ROLE_PERMISSIONS). null = la ven todos. */
  modulo: string | null;
  texto: string;
}

export const GUIA_SECCIONES: SeccionGuia[] = ${JSON.stringify(finales, null, 2)};
`;

if (process.argv.includes("--check")) {
  const hoy = fs.existsSync(TS) ? fs.readFileSync(TS, "utf8").replace(/\r\n/g, "\n") : "";
  if (hoy !== salida) { console.error("asistente-guia-datos.ts NO está al día con docs/GUIA-USO.md: correr node scripts/guia-a-ts.mjs"); process.exit(1); }
  console.log(`Guía al día (${finales.length} secciones).`);
} else {
  fs.writeFileSync(TS, salida, "utf8");
  console.log(`Escrito ${path.relative(process.cwd(), TS)}: ${finales.length} secciones.`);
}
