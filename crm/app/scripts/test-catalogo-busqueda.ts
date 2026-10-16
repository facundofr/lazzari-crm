// Prueba de la búsqueda en memoria de la lista de costos (sin base). Uso: npx tsx scripts/test-catalogo-busqueda.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost"; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "x";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
(async () => {
  const { aFila, buscarEnFilas } = await import("../src/lib/catalogo-busqueda");
  const art = (id: string, proveedor: string, descripcion: string, costo: number, marca = "", codigo = "") => aFila({ id, proveedor, codigo, codigo_interno: null, descripcion, moneda: "ARS", costo: String(costo), precio_venta: String(costo * 1.5), marca });
  const filas = [
    art("1", "Libus", "Guante nitrilo verde", 900, "Libus"),
    art("2", "Startex", "Guante de nitrilo moteado", 700, "Startex"),
    art("3", "Startex", "Botín de seguridad puntera acero", 30000, "Funcional"),
    art("4", "3M", "Anteojo SecureFit claro", 5000, "3M", "SF101"),
    art("5", "Libus", "Casco blanco con arnés", 8000, "Libus"),
  ];
  const g = buscarEnFilas(filas, "gte nitrilo");
  ok(g.length === 2 && g.every(c => c.descripcion.includes("itrilo")), "abreviatura gte = guante, solo los de nitrilo");
  ok(typeof g[0].costo === "number", "costo numérico");
  ok(buscarEnFilas(filas, "ant. claro")[0]?.id === "4", "ant. = anteojo");
  ok(buscarEnFilas(filas, "", "SF101")[0]?.id === "4", "por código");
  ok(buscarEnFilas(filas, "botines seguridad acero")[0]?.id === "3", "plural y acentos");
  ok(buscarEnFilas(filas, "guante nitrilo", "", 15, { provs: ["Startex"], soloProvs: true, marcas: [], soloMarcas: false }).every(c => c.proveedor === "Startex"), "solo proveedor preferido");
  ok(buscarEnFilas(filas, "guante nitrilo", "", 15, { provs: [], soloProvs: false, marcas: ["Libus"], soloMarcas: true }).every(c => c.marca === "Libus"), "solo marca");
  ok(buscarEnFilas(filas, "zzz").length === 0, "sin coincidencias = vacío");
})();
