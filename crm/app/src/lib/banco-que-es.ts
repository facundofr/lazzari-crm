/**
 * Bancos › Movimientos › «¿Qué es?» (Augusto 03/11/2026): la IA mira una línea del banco que quedó sin asociar, lo cargado en el
 * CRM que no tiene línea, las facturas con saldo y los avisos de pago del correo, y dice qué parece: un cobro de tal factura,
 * un pago que se hizo en varias transferencias, un sueldo, un gasto personal… Solo sugiere: devuelve ids de las listas que se le
 * pasaron (cualquier otro se descarta) y una persona confirma con «Asociar» o «Cobrar». También resuelve pagos de varias
 * facturas con retenciones distintas, que las reglas fijas no juntan.
 * Prueba: npx tsx scripts/test-banco-que-es.ts
 */

export const TIPOS_QUE_ES = ["cobro", "pago", "impuesto", "gasto_bancario", "sueldo", "personal", "entre_cuentas", "otro"] as const;
export type TipoQueEs = (typeof TIPOS_QUE_ES)[number];

export interface ContextoQueEs {
  empresa: string;
  linea: { id: string; fecha: string; concepto: string; importe: number; cuenta: string };
  /** Cobros, pagos, OP y gastos cargados en el CRM sin línea del banco, cerca de esa fecha. */
  movimientos: { id: string; fecha: string; importe: number; texto: string }[];
  /** Facturas de venta con saldo (solo si entró plata). */
  facturas: { id: string; numero: string; cliente: string; fecha: string; saldo: number }[];
  /** Avisos de pago que leyó el agente de correo. */
  avisos: { cliente: string; fecha: string; transferencias: number[]; retenciones: number; facturas: string[] }[];
  /** CUIT o CBU del concepto que son de una ficha: "30-12345678-9 = Proveedor SA". */
  terceros: string[];
}
export interface RespuestaQueEs { explicacion: string; tipo: TipoQueEs; movimientos: string[]; facturas: string[]; confianza: "alta" | "media" | "baja" }

export const PROMPT_QUE_ES = `Sos el asistente contable de Lazzari, una pyme argentina de ropa de trabajo y EPP. Te paso UNA línea del extracto del banco que no se pudo asociar sola, y lo que hay cargado en el sistema.
Decí qué parece y, si corresponde, con qué se asocia:
- "movimientos": ids de la lista de movimientos cargados que son esta misma plata (pueden ser varios que juntos suman el importe, por ejemplo una OP pagada en dos transferencias o varios cobros de un mismo cliente).
- "facturas": si entró plata y no hay un cobro cargado, ids de las facturas con saldo que paga (pueden ser varias; si hay retenciones, lo que entró es menos que el saldo: usá los avisos de pago para saberlo).
- "tipo": cobro | pago | impuesto | gasto_bancario | sueldo | personal | entre_cuentas | otro.
- "explicacion": en castellano rioplatense, máximo 240 caracteres, qué parece y por qué (importe, fecha, nombre o CUIT del concepto, aviso de pago).
- "confianza": alta (el importe y el nombre coinciden), media o baja.
Reglas: usá SOLO ids que estén en las listas. No inventes: si no hay pistas suficientes, listas vacías, confianza "baja" y explicá qué falta. Los importes con signo: + entra, − sale.
Respondé SOLO JSON: {"explicacion":"","tipo":"","movimientos":[],"facturas":[],"confianza":""}`;

const pesos = (n: number) => n.toFixed(2);

/** El texto que se le pasa a la IA (sin datos de más: hasta 40 movimientos, 40 facturas y 20 avisos). */
export function textoContextoQueEs(c: ContextoQueEs): string {
  return [
    `Empresa: ${c.empresa}`,
    `LÍNEA DEL BANCO: ${c.linea.fecha} | ${c.linea.concepto.slice(0, 200)} | ${pesos(c.linea.importe)} | cuenta ${c.linea.cuenta}`,
    `Fichas con ese CUIT o CBU: ${c.terceros.join("; ") || "ninguna"}`,
    "",
    "MOVIMIENTOS CARGADOS SIN LÍNEA DEL BANCO (id | fecha | importe | qué es):",
    ...(c.movimientos.length ? c.movimientos.slice(0, 40).map((m) => `${m.id} | ${m.fecha.slice(0, 10)} | ${pesos(m.importe)} | ${m.texto.slice(0, 120)}`) : ["(ninguno)"]),
    "",
    "FACTURAS DE VENTA CON SALDO (id | número | cliente | fecha | saldo):",
    ...(c.facturas.length ? c.facturas.slice(0, 40).map((f) => `${f.id} | ${f.numero} | ${f.cliente.slice(0, 60)} | ${f.fecha} | ${pesos(f.saldo)}`) : ["(ninguna o salió plata)"]),
    "",
    "AVISOS DE PAGO DEL CORREO (cliente | fecha | puede haber entrado | retenciones | facturas que nombra):",
    ...(c.avisos.length ? c.avisos.slice(0, 20).map((a) => `${a.cliente.slice(0, 60)} | ${a.fecha} | ${a.transferencias.map(pesos).join(" o ")} | ${pesos(a.retenciones)} | ${a.facturas.join(", ") || "—"}`) : ["(ninguno)"]),
  ].join("\n");
}

/** Lo que devolvió la IA, limpio: solo ids de las listas, tipo y confianza válidos, explicación corta. */
export function validarQueEs(raw: any, c: ContextoQueEs): RespuestaQueEs {
  const movs = new Set(c.movimientos.map((m) => m.id));
  const facs = new Set(c.facturas.map((f) => f.id));
  const ids = (x: unknown, validos: Set<string>) => [...new Set((Array.isArray(x) ? x : []).map(String).filter((id) => validos.has(id)))];
  const tipo = (TIPOS_QUE_ES as readonly string[]).includes(String(raw?.tipo)) ? (String(raw.tipo) as TipoQueEs) : "otro";
  const confianza = ["alta", "media", "baja"].includes(String(raw?.confianza)) ? (String(raw.confianza) as RespuestaQueEs["confianza"]) : "baja";
  return {
    explicacion: String(raw?.explicacion || "La IA no pudo decir qué es.").trim().slice(0, 300),
    tipo,
    movimientos: ids(raw?.movimientos, movs),
    facturas: c.linea.importe > 0 ? ids(raw?.facturas, facs) : [],
    confianza,
  };
}

/** Del texto de la IA al JSON (con o sin ```). */
export function jsonDeTexto(texto: string): any {
  let s = String(texto || "").replace(/^```json?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a !== -1 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}
