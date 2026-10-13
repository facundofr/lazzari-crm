import { normalizarTexto, palabrasBusqueda, coincideTodas } from "../src/lib/buscar-texto";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
ok(normalizarTexto("PANTALÓN Cargo Beige") === "pantalon cargo beige", "saca tildes y mayúsculas");
ok(coincideTodas(normalizarTexto("Pantalón cargo"), palabrasBusqueda("pantalon")), "pantalon encuentra Pantalón");
ok(coincideTodas(normalizarTexto("Pantalon cargo"), palabrasBusqueda("PANTALÓN")), "PANTALÓN encuentra Pantalon");
ok(coincideTodas(normalizarTexto("Zapato Ñandú"), palabrasBusqueda("nandu zap")), "ñ y varias palabras");
ok(!coincideTodas(normalizarTexto("Pantalón cargo"), palabrasBusqueda("pantalon azul")), "tienen que estar todas");
console.log("TODO OK");
