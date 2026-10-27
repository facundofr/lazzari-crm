import { claveNumero, corregirPartes, normalizarCertificados, proponerRetenciones, type CertificadoLeido, type RetencionSufrida } from "../src/lib/certificado-sufrido";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } };

// Lo que devuelve la IA: textos con formato argentino, repetidos y basura
const leidos = normalizarCertificados({ certificados: [
  { impuesto: "Impuesto al Valor Agregado", numero: " 0000-00074762 ", fecha: "20/10/2026", monto: "1.481.021,27", agente_razon_social: "CORTEVA AGRISCIENCE ARGENTINA S.R.L.", agente_cuit: "30-63602157-8", retenido_cuit: "20-37930912-8", comprobantes: ["0015-00000001", null] },
  { impuesto: "Ganancias", numero: "0000-00072330", fecha: "2026-10-20", monto: 282099.28, agente_cuit: "30636021578", retenido_cuit: "20379309128" },
  { impuesto: "Ingresos Brutos Bs. As.", numero: "0000-00049275", fecha: "2026-10-20", monto: "98,734.74", agente_cuit: "30636021578", retenido_cuit: "20379309128", jurisdiccion: "Buenos Aires" },
  { impuesto: "IVA", numero: "0000-00074762", fecha: "2026-10-20", monto: 1481021.27 }, // el mismo, en el resumen
  { impuesto: "IVA", numero: null, monto: null }, // nada útil
  "basura",
] });
ok(leidos.length === 3, "normalizar: 3 certificados sin repetidos " + leidos.length);
ok(leidos[0].impuesto === "IVA" && leidos[0].numero === "0000-00074762" && leidos[0].fecha === "2026-10-20" && leidos[0].monto === 1481021.27, "IVA leído " + JSON.stringify(leidos[0]));
ok(leidos[0].agenteCuit === "30636021578" && leidos[0].retenidoCuit === "20379309128" && leidos[0].comprobantes.length === 1, "CUIT sin guiones y comprobantes");
ok(leidos[2].impuesto === "IIBB" && leidos[2].monto === 98734.74, "IIBB con importe en inglés " + leidos[2].monto);
ok(normalizarCertificados([{ impuesto: "SUSS", numero: "1", monto: "143060,69" }])[0].monto === 143060.69, "decimal con coma");
ok(normalizarCertificados(null).length === 0 && normalizarCertificados({ certificados: [] }).length === 0, "vacío");
ok(claveNumero("0000-00074762") === claveNumero("74762") && claveNumero("0001-00074762") !== claveNumero("0000-00074762") && claveNumero("RB 25897") === "25897", "clave del N°");

// Retenciones de Lazzari de octubre (como están en el CRM al 27/10/2026)
const CORTEVA = "30636021578", SEEDS = "30708811994", TERMO = "30715378023", DELSOL = "30625547632";
const ret = (movimientoId: string, fecha: string, impuesto: string, monto: number, cuit: string, certificado: string | null = null): RetencionSufrida =>
  ({ movimientoId, fecha, impuesto, monto, moneda: "ARS", nombre: cuit, cuit, certificado });
const crm: RetencionSufrida[] = [
  ret("cv13-iva", "2026-10-13", "IVA", 143060.69, CORTEVA), ret("cv13-gan", "2026-10-13", "Ganancias", 22770.17, CORTEVA), ret("cv13-iibb", "2026-10-13", "IIBB", 9537.56, CORTEVA),
  ret("cv20-iva", "2026-10-20", "IVA", 1481021.26, CORTEVA), ret("cv20-iibb", "2026-10-20", "IIBB", 98734.75, CORTEVA), ret("cv20-gan", "2026-10-20", "Ganancias", 282099.28, CORTEVA),
  ret("seeds-gan", "2026-10-14", "Ganancias", 255672.10, SEEDS), ret("seeds-gan2", "2026-10-14", "Ganancias", 14363.99, SEEDS),
  ret("termo-iibb-a", "2026-10-15", "IIBB", 49256.61, TERMO), ret("termo-iibb-b", "2026-10-15", "IIBB", 42650.68, TERMO),
  ret("termo-gan-a", "2026-10-15", "Ganancias", 56293.27, TERMO), ret("termo-gan-b", "2026-10-15", "Ganancias", 48743.64, TERMO),
  ret("termo-1115", "2026-10-04", "IIBB", 18471.80, TERMO, "000000001115"),
  ret("delsol-gan", "2026-10-09", "Ganancias", 99826.69, DELSOL, "11672"),
];
const LAZZARI = { cuit: "20379309128", otras: [{ nombre: "Grupo LA", cuit: "30719396042" }] };
const cert = (impuesto: CertificadoLeido["impuesto"], numero: string | null, fecha: string, monto: number | null, agenteCuit: string | null, extra: Partial<CertificadoLeido> = {}): CertificadoLeido =>
  ({ impuesto, numero, fecha, monto, agenteNombre: null, agenteCuit, retenidoNombre: null, retenidoCuit: "20379309128", jurisdiccion: null, comprobantes: [], referencia: null, ...extra });

// Corteva: los 3 del 20/10 (cobro en US$, con centavos cruzados) y los 3 del 13/10
const corteva = proponerRetenciones([...leidos,
  cert("IVA", "0000-00074701", "2026-10-13", 143060.69, CORTEVA), cert("Ganancias", "0000-00072263", "2026-10-13", 22770.17, CORTEVA), cert("IIBB", "0000-00049253", "2026-10-13", 9537.56, CORTEVA)], crm, LAZZARI);
ok(corteva.map((p) => p.movimientoId).join() === "cv20-iva,cv20-gan,cv20-iibb,cv13-iva,cv13-gan,cv13-iibb", "Corteva: cada uno a su retención " + corteva.map((p) => p.movimientoId).join());
ok(corteva.every((p) => p.estado === "coincide" && !p.otroCliente && !p.yaCargado), "Corteva: todos coinciden");
ok(corteva[0].diferencia === 0.01 && corteva[2].diferencia === -0.01 && corteva[1].diferencia === 0, "Corteva: centavos cruzados " + corteva.map((p) => p.diferencia).join());

// Termo: dos IIBB del mismo día, cada uno a la suya (sin repetir); uno con importe distinto
const termo = proponerRetenciones([cert("IIBB", "1", "2026-10-15", 42650.68, TERMO), cert("IIBB", "2", "2026-10-15", 49256.61, TERMO), cert("Ganancias", "3", "2026-10-15", 50000, TERMO)], crm, LAZZARI);
ok(termo[0].movimientoId === "termo-iibb-b" && termo[1].movimientoId === "termo-iibb-a", "Termo: cada IIBB a la suya");
ok(termo[2].estado === "difiere" && termo[2].movimientoId === "termo-gan-b" && termo[2].diferencia === 1256.36, "Termo: importe distinto, la más parecida " + JSON.stringify(termo[2]));
ok(termo[2].opciones[0] === "termo-gan-b" && termo[2].opciones.includes("termo-gan-a"), "Termo: opciones del cliente");

// Dos certificados iguales de un cliente con dos retenciones iguales: no se repite la retención
const iguales = proponerRetenciones([cert("IIBB", "10", "2026-10-15", 500, TERMO), cert("IIBB", "11", "2026-10-15", 500, TERMO)],
  [ret("x1", "2026-10-15", "IIBB", 500, TERMO), ret("x2", "2026-10-16", "IIBB", 500, TERMO)], LAZZARI);
ok(iguales[0].movimientoId === "x1" && iguales[1].movimientoId === "x2", "iguales: una cada uno");
const unaSola = proponerRetenciones([cert("IIBB", "10", "2026-10-15", 500, TERMO), cert("IIBB", "11", "2026-10-15", 500, TERMO)], [ret("x1", "2026-10-15", "IIBB", 500, TERMO)], LAZZARI);
ok(unaSola[0].estado === "coincide" && unaSola[1].estado === "sin_retencion" && unaSola[1].movimientoId === null, "una sola retención: el segundo queda sin");

// Otra sociedad, sin N°, AI que da vuelta agente y retenido
const otra = proponerRetenciones([cert("IVA", "5", "2026-10-13", 143060.69, CORTEVA, { retenidoCuit: "30719396042" })], crm, LAZZARI)[0];
ok(otra.estado === "otra_sociedad" && otra.otraSociedad === "Grupo LA" && otra.movimientoId === null && !otra.opciones.length, "otra sociedad");
ok(proponerRetenciones([cert("IVA", "5", "2026-10-13", 1, CORTEVA, { retenidoCuit: "30500000000", retenidoNombre: "OTRA SA" })], crm, LAZZARI)[0].otraSociedad === "OTRA SA", "otra sociedad desconocida: su nombre");
ok(proponerRetenciones([cert("IVA", null, "2026-10-13", 143060.69, CORTEVA)], crm, LAZZARI)[0].estado === "sin_numero", "sin N°");
const vuelta = proponerRetenciones([cert("IVA", "0000-00074701", "2026-10-13", 143060.69, "20379309128", { retenidoCuit: CORTEVA })], crm, LAZZARI)[0];
ok(vuelta.estado === "coincide" && vuelta.movimientoId === "cv13-iva" && !vuelta.otroCliente, "agente y retenido al revés");
const derecho = corregirPartes(cert("IVA", "1", "2026-10-13", 1, "20-37930912-8".replace(/\D/g, ""), { retenidoCuit: CORTEVA, retenidoNombre: "CORTEVA" }), "20-37930912-8");
ok(derecho.agenteCuit === CORTEVA && derecho.agenteNombre === "CORTEVA" && derecho.retenidoCuit === "20379309128", "corregirPartes los da vuelta");
ok(corregirPartes(leidos[0], "20379309128") === leidos[0], "corregirPartes no toca los que están bien");

// Ya cargado: el N° 1115 de Termo ya está; con importe distinto no se propone, con el mismo importe en otra libre sí (avisando)
const ya = proponerRetenciones([cert("IIBB", "000000001115", "2026-10-04", 2695, TERMO)], crm, LAZZARI)[0];
ok(ya.estado === "sin_retencion" && ya.yaCargado?.movimientoId === "termo-1115" && ya.opciones.length > 0, "ya cargado, importe distinto: no se propone " + JSON.stringify(ya));
const yaIgual = proponerRetenciones([cert("IIBB", "1115", "2026-10-15", 42650.68, TERMO)], crm, LAZZARI)[0];
ok(yaIgual.estado === "coincide" && yaIgual.movimientoId === "termo-iibb-b" && yaIgual.yaCargado?.movimientoId === "termo-1115", "ya cargado pero coincide otra: se propone con aviso");

// No está en el CRM (Soychu: falta registrar el cobro) y otro cliente con el mismo importe
const soychu = proponerRetenciones([cert("IVA", "0176-00035368", "2026-10-26", 23625, "30505000869")], crm, LAZZARI)[0];
ok(soychu.estado === "sin_retencion" && soychu.opciones.length === 0, "Soychu: no está en el CRM y no se ofrecen las de otros clientes");
ok(proponerRetenciones([cert("IIBB", "1", "2026-10-26", 3937.5, null)], crm, LAZZARI)[0].opciones.length === 4, "sin CUIT: las IIBB sin N° de fecha cercana");
const otroCliente = proponerRetenciones([cert("Ganancias", "9", "2026-10-14", 255672.10, CORTEVA)], crm, LAZZARI)[0];
ok(otroCliente.estado === "coincide" && otroCliente.movimientoId === "seeds-gan" && otroCliente.otroCliente, "mismo importe en otro cliente: coincide avisando " + JSON.stringify(otroCliente));
const sinCuit = proponerRetenciones([cert("Ganancias", "9", "2026-10-14", 255672.10, null)], crm, LAZZARI)[0];
ok(sinCuit.movimientoId === "seeds-gan" && !sinCuit.otroCliente, "sin CUIT del cliente: por importe");
const lejos = proponerRetenciones([cert("Ganancias", "9", "2027-03-01", 255672.10, null)], crm, LAZZARI)[0];
ok(lejos.estado === "sin_retencion", "otro cliente con el mismo importe pero lejos en fecha: no");
const sinImporte = proponerRetenciones([cert("Ganancias", "9", "2026-10-15", null, TERMO)], crm, LAZZARI)[0];
ok(sinImporte.estado === "difiere" && sinImporte.diferencia === null && !!sinImporte.movimientoId?.startsWith("termo-gan"), "sin importe: la del cliente de fecha más cercana");

// Retención en US$: no se compara el importe
const usd = proponerRetenciones([cert("IVA", "7", "2026-10-20", 100, CORTEVA)], [{ ...ret("usd", "2026-10-20", "IVA", 100, CORTEVA), moneda: "USD" }], LAZZARI)[0];
ok(usd.estado === "difiere" && usd.diferencia === null, "US$: difiere sin diferencia");
console.log("OK certificado-sufrido");
