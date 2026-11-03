// Movimientos del banco para revisar (Augusto 02/11/2026: "quiero que el sistema revise todos los movimientos y me los muestre,
// yo quiero tildarlos ... poder asociarla con la sugerencia o manual, pero si no la asocio que no pase nada, que no quede pendiente";
// los exactos: "que las sugiera").
// - Solo se aplica lo que no es una persona: lo del banco (impuestos, comisiones, pases, tarjeta) y los cheques por su número.
// - Un cobro, pago, OP, gasto o VEP que el motor encuentra exacto queda como SUGERENCIA: se asocia con un clic, nunca solo.
// - "Revisada" y "No pasa por el BBVA" se anotan en finanzas_registro (la última marca vale); no cambian importes ni cuentas.
// Prueba: scripts/test-banco-revision.ts
import type { DecisionBanco, MovMotor } from "./banco-motor";
import { clasificarMovimiento } from "./tipos-movimiento";

export interface RegistroBanco { linea_id: string | null; accion: string; propuesta: any; created_at: string }

/** Lo que el banco hace solo y lo que solo sugiere. Los avisos de cheques rechazados se mandan igual (van a la campana). */
export function separarDecisiones(ds: DecisionBanco[]): { aplicar: DecisionBanco[]; sugerencias: Map<string, DecisionBanco> } {
  const aplicar: DecisionBanco[] = [];
  const sugerencias = new Map<string, DecisionBanco>();
  for (const d of ds) {
    if (d.estado === "cruzada" && d.movimientos.length) sugerencias.set(d.linea_id, d);
    else if (d.estado === "del_banco" || d.estado === "cruzada" || d.aviso) aplicar.push(d);
  }
  return { aplicar, sugerencias };
}

/** Líneas tildadas "Revisada" y movimientos marcados "No pasa por el BBVA" (con su nota). Vale la última marca de cada uno. */
export function marcasRevision(reg: RegistroBanco[]): { revisadas: Set<string>; noPasa: Map<string, string> } {
  const revisadas = new Set<string>();
  const noPasa = new Map<string, string>();
  for (const r of [...reg].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (r.accion === "revisada" && r.linea_id) revisadas.add(r.linea_id);
    else if (r.accion === "no_revisada" && r.linea_id) revisadas.delete(r.linea_id);
    const mov = r.propuesta?.movimiento_id;
    if (!mov) continue;
    if (r.accion === "no_pasa_banco") noPasa.set(mov, String(r.propuesta?.nota || ""));
    else if (r.accion === "vuelve_banco") noPasa.delete(mov);
  }
  return { revisadas, noPasa };
}

const dias = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

/**
 * Para "Elegir…": cobros (si entró plata) o pagos, OP y gastos (si salió) en pesos, sin línea del banco, hasta 30 días de distancia.
 * Primero los de importe más parecido y después los más cercanos en fecha. No decide nada: la persona elige.
 */
export function candidatosManual(linea: { fecha: string; importe: number }, movs: MovMotor[], limite = 40): MovMotor[] {
  const entra = linea.importe > 0;
  const objetivo = Math.abs(linea.importe);
  return movs.filter((m) => {
    const tipo = String(m.tipo || "");
    if (String(m.moneda || "ARS") !== "ARS" || tipo.startsWith("retencion_") || ["cheque_recibido", "cheque_emitido", "echeq", "efectivo"].includes(tipo)) return false;
    const clase = clasificarMovimiento(m);
    return (entra ? clase === "ingreso" : clase === "egreso") && Math.abs(dias(linea.fecha, String(m.fecha))) <= 30;
  }).sort((a, b) => Math.abs(Number(a.monto) - objetivo) - Math.abs(Number(b.monto) - objetivo)
    || Math.abs(dias(linea.fecha, String(a.fecha))) - Math.abs(dias(linea.fecha, String(b.fecha))) || a.id.localeCompare(b.id))
    .slice(0, limite);
}
