import { semaforoVigencia, fechaDeTexto, redondearVenta, chipOpcional, textoOpcional, textoDescuentosLista, pideVerificar, margenSobreCosto } from "../src/lib/lista-costos";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
const HOY = Date.UTC(2026, 9, 14); // 14/10/2026
const s = (vigencia_texto: string | null, vigencia_hasta: string | null = null) => semaforoVigencia({ vigencia_texto, vigencia_hasta }, HOY);

// Fechas del texto
ok(fechaDeTexto("06/10/2026", HOY) === Date.UTC(2026, 9, 6), "dd/mm/aaaa");
ok(fechaDeTexto("Octubre 2026", HOY) === Date.UTC(2026, 9, 1), "mes y año = 1° del mes");
ok(fechaDeTexto("1 de septiembre", HOY) === Date.UTC(2026, 8, 1), "día de mes sin año");
ok(fechaDeTexto("Dist. 20/05 · Fabr. 18/05/2026", HOY) === Date.UTC(2026, 4, 20), "toma la primera fecha");
ok(fechaDeTexto("20/12", HOY) === Date.UTC(2025, 11, 20), "sin año y en el futuro = año anterior");
ok(fechaDeTexto("Marzo 2026 (Air: sept. 2026)", HOY) === Date.UTC(2026, 2, 1), "dos fechas: la primera");
ok(fechaDeTexto("Lista 61 · agosto 2026", HOY) === Date.UTC(2026, 7, 1), "lista N · mes año");
ok(fechaDeTexto("Sin fecha (pedir)", HOY) === null, "sin fecha");

// Semáforo 30 / 60 con los datos reales del 14/10
ok(s("Octubre 2026").color === "verde", "Aire Libre octubre verde");
ok(s("1 de septiembre").color === "amarillo", "SPI 1/9 = 43 días amarillo");
ok(s("Agosto 2026").color === "rojo", "Conoflex agosto = 74 días rojo");
ok(s("Agosto 2026").pedirActualizacion, "rojo pide actualización");
ok(s("Lista 9 · mayo 2026").color === "rojo", "FADI mayo rojo");
ok(s("Sin fecha (pedir)").color === "rojo" && s("Sin fecha (pedir)").texto === "Sin fecha", "Mediglove sin fecha rojo");
ok(s("Histórico con fecha").color === "rojo", "Prisina histórico rojo");
ok(s("Desde 05/10/2026 · Sin fecha").color === "verde", "TKW con fecha verde");
ok(s("Lista 126 · 01/10/2026").color === "verde", "Pegaso verde");
ok(s("15/09/2026").color === "verde" && s("14/09/2026").color === "verde" && s("13/09/2026").color === "amarillo", "límite 30 días");
ok(s("15/08/2026").color === "amarillo" && s("14/08/2026").color === "rojo", "límite 60 días");
ok(s("Hasta 31/10/2026", "2026-10-31T03:00:00.000Z").color === "verde", "Segufer vence 31/10: verde");
ok(semaforoVigencia({ vigencia_texto: "", vigencia_hasta: "2026-10-20" }, HOY).color === "amarillo", "vence en 6 días: amarillo");
ok(semaforoVigencia({ vigencia_texto: "", vigencia_hasta: "2026-10-10" }, HOY).color === "rojo", "vencida: rojo");
ok(semaforoVigencia(null, HOY).color === "rojo", "sin regla: rojo");

// Opcionales y descuentos
ok(chipOpcional({ tipo: "pago_anticipado", porcentaje: 5 }) === "+5 % pago anticipado", "chip anticipado");
ok(textoOpcional({ proveedor_lista: "Conoflex", tipo: "excepcional", porcentaje: 40, monto_minimo: null, condicion: "en lugar del 35 %", requiere_autorizacion: true, activo: true }) === "40 % excepcional — en lugar del 35 % · con autorización", "texto opcional");
ok(textoDescuentosLista({ desc1: 6, desc2: 20, en_cascada: true }) === "Lista − 6 % − 20 % (en cascada)", "descuentos en cascada");
ok(textoDescuentosLista({ desc1: null, desc2: null, en_cascada: true }) === "", "sin descuentos");
ok(pideVerificar({ como_se_calcula: "Lista", condiciones: "Eslinga: verificar." }), "pide verificar");
ok(!pideVerificar({ como_se_calcula: "Lista − 20%", condiciones: "Sin compra mínima." }), "no pide verificar");

// Redondeo (igual que la web)
const R = { ARS: { multiplo: 100, multiplo_menor: 10, umbral_menor: 1000, hacia: "arriba" as const }, USD: { decimales: 2, hacia: "arriba" as const } };
ok(redondearVenta(12345, "ARS", R) === 12400, "pesos a $100 hacia arriba");
ok(redondearVenta(12400, "ARS", R) === 12400, "ya redondo queda igual");
ok(redondearVenta(987, "ARS", R) === 990, "menos de $1.000 a $10");
ok(redondearVenta(10.001, "USD", R) === 10.01, "dólares al centavo hacia arriba");
ok(margenSobreCosto(100, 140) === 40, "margen sobre costo");
ok(margenSobreCosto(0, 140) === null, "sin costo no hay margen");
console.log("TODO OK");
