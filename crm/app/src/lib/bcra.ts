/**
 * Central de Deudores del BCRA (API pública y gratuita, sin clave).
 *   GET https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/{cuit}
 *   GET https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/Historicas/{cuit}
 *   GET https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/ChequesRechazados/{cuit}
 * Los montos vienen en MILES de pesos. 404 = el BCRA no tiene datos (no debe nada en bancos).
 *
 * Situación: 1 normal · 2 con seguimiento especial / riesgo bajo · 3 con problemas / riesgo medio
 *            4 alto riesgo de insolvencia · 5 irrecuperable.
 *
 * Semáforo (es solo un aviso, nunca bloquea nada):
 *   rojo     → situación 3 o peor, cheques rechazados sin pagar, o proceso judicial
 *   amarillo → situación 2, o cheques rechazados (ya pagados) en los últimos 12 meses
 *   verde    → todo en situación 1 o sin deudas
 *   gris     → no se pudo consultar
 */

export type Semaforo = "verde" | "amarillo" | "rojo" | "gris";

export interface ResumenBCRA {
  cuit: string;
  periodo_bcra: string | null;
  denominacion: string | null;
  peor_situacion: number | null;
  deuda_total: number;
  entidades: number;
  cheques_rechazados: number;
  cheques_sin_pagar: number;
  monto_cheques_sin_pagar: number;
  proceso_judicial: boolean;
  semaforo: Semaforo;
  historial: Array<{ periodo: string; peor_situacion: number; deuda: number }>;
  data: {
    deudas: Array<{ entidad: string; situacion: number; monto: number; dias_atraso: number | null; proceso_judicial: boolean; en_revision: boolean }>;
    cheques: Array<{ causal: string; nro: string | number | null; fecha_rechazo: string | null; monto: number; fecha_pago: string | null }>;
  };
  error: string | null;
}

export const SITUACION_LABEL: Record<number, string> = {
  1: "Normal",
  2: "Seguimiento especial",
  3: "Con problemas",
  4: "Alto riesgo",
  5: "Irrecuperable",
};

export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  verde: "Sin problemas",
  amarillo: "Atención",
  rojo: "Riesgo",
  gris: "Sin dato",
};

export function cuitLimpio(cuit: string | null | undefined): string | null {
  const d = String(cuit || "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}

export function mesActual(fecha = new Date()): string {
  // Mes en hora argentina (UTC-3)
  const ar = new Date(fecha.getTime() - 3 * 3600_000);
  return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, "0")}`;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Arma el resumen a partir de las tres respuestas crudas (null = 404 / sin datos). */
export function resumirBCRA(cuit: string, deudas: any | null, historicas: any | null, cheques: any | null, hoy = new Date()): ResumenBCRA {
  const periodos: any[] = Array.isArray(deudas?.results?.periodos) ? deudas.results.periodos : [];
  const ultimo = [...periodos].sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)))[0] || null;
  const ents: any[] = Array.isArray(ultimo?.entidades) ? ultimo.entidades : [];

  const detalle = ents.map(e => ({
    entidad: String(e.entidad || ""),
    situacion: num(e.situacion) || 1,
    monto: r2(num(e.monto)),
    dias_atraso: e.diasAtrasoPago != null ? num(e.diasAtrasoPago) : null,
    proceso_judicial: Boolean(e.procesoJud || e.situacionJuridica),
    en_revision: Boolean(e.enRevision),
  }));
  const peor = detalle.length ? Math.max(...detalle.map(d => d.situacion)) : null;
  const deudaTotal = r2(detalle.reduce((s, d) => s + d.monto, 0));
  const procesoJudicial = detalle.some(d => d.proceso_judicial);

  // Historial: peor situación y deuda total por período (24 meses)
  const histPeriodos: any[] = Array.isArray(historicas?.results?.periodos) ? historicas.results.periodos : [];
  const historial = histPeriodos.map(p => {
    const es: any[] = Array.isArray(p.entidades) ? p.entidades : [];
    return {
      periodo: String(p.periodo || ""),
      peor_situacion: es.length ? Math.max(...es.map(e => num(e.situacion) || 1)) : 1,
      deuda: r2(es.reduce((s, e) => s + num(e.monto), 0)),
    };
  }).filter(h => h.periodo).sort((a, b) => a.periodo.localeCompare(b.periodo));

  // Cheques rechazados
  const listaCheques: ResumenBCRA["data"]["cheques"] = [];
  const causales: any[] = Array.isArray(cheques?.results?.causales) ? cheques.results.causales : [];
  for (const c of causales) {
    for (const ent of Array.isArray(c.entidades) ? c.entidades : []) {
      for (const d of Array.isArray(ent.detalle) ? ent.detalle : []) {
        listaCheques.push({
          causal: String(c.causal || ""),
          nro: d.nroCheque ?? null,
          fecha_rechazo: d.fechaRechazo || null,
          monto: r2(num(d.monto)),
          fecha_pago: d.fechaPago || null,
        });
      }
    }
  }
  const sinPagar = listaCheques.filter(c => !c.fecha_pago);
  const haceUnAnio = new Date(hoy.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const recientes = listaCheques.filter(c => (c.fecha_rechazo || "") >= haceUnAnio);

  let semaforo: Semaforo = "verde";
  if ((peor ?? 1) >= 3 || sinPagar.length > 0 || procesoJudicial) semaforo = "rojo";
  else if ((peor ?? 1) === 2 || recientes.length > 0) semaforo = "amarillo";

  return {
    cuit,
    periodo_bcra: ultimo?.periodo ? String(ultimo.periodo) : null,
    denominacion: deudas?.results?.denominacion || cheques?.results?.denominacion || historicas?.results?.denominacion || null,
    peor_situacion: peor,
    deuda_total: deudaTotal,
    entidades: detalle.length,
    cheques_rechazados: listaCheques.length,
    cheques_sin_pagar: sinPagar.length,
    monto_cheques_sin_pagar: r2(sinPagar.reduce((s, c) => s + c.monto, 0)),
    proceso_judicial: procesoJudicial,
    semaforo,
    historial: historial.slice(-24),
    data: { deudas: detalle.sort((a, b) => b.situacion - a.situacion || b.monto - a.monto), cheques: listaCheques },
    error: null,
  };
}

export function resumenConError(cuit: string, error: string): ResumenBCRA {
  return {
    cuit, periodo_bcra: null, denominacion: null, peor_situacion: null, deuda_total: 0, entidades: 0,
    cheques_rechazados: 0, cheques_sin_pagar: 0, monto_cheques_sin_pagar: 0, proceso_judicial: false,
    semaforo: "gris", historial: [], data: { deudas: [], cheques: [] }, error,
  };
}

const ORDEN: Record<Semaforo, number> = { gris: 0, verde: 1, amarillo: 2, rojo: 3 };

/** ¿Empeoró respecto del informe anterior? Devuelve el motivo o null. */
export function empeoro(anterior: Pick<ResumenBCRA, "semaforo" | "peor_situacion" | "cheques_sin_pagar"> | null, nuevo: ResumenBCRA): string | null {
  if (!anterior || nuevo.semaforo === "gris" || anterior.semaforo === "gris") return null;
  if (ORDEN[nuevo.semaforo] > ORDEN[anterior.semaforo]) return `pasó de ${SEMAFORO_LABEL[anterior.semaforo]} a ${SEMAFORO_LABEL[nuevo.semaforo]}`;
  if ((nuevo.peor_situacion ?? 1) > (anterior.peor_situacion ?? 1)) return `su peor situación bancaria pasó de ${anterior.peor_situacion ?? 1} a ${nuevo.peor_situacion}`;
  if (nuevo.cheques_sin_pagar > (anterior.cheques_sin_pagar || 0)) return `tiene ${nuevo.cheques_sin_pagar} cheque(s) rechazado(s) sin pagar`;
  return null;
}

/** Fila para guardar en cliente_bcra_informes. */
export function filaInforme(r: ResumenBCRA, sociedadId: string, clienteId: string, mes = mesActual()) {
  return {
    sociedad_id: sociedadId, cliente_id: clienteId, cuit: r.cuit, mes,
    periodo_bcra: r.periodo_bcra, denominacion: r.denominacion, peor_situacion: r.peor_situacion,
    deuda_total: r.deuda_total, entidades: r.entidades, cheques_rechazados: r.cheques_rechazados,
    cheques_sin_pagar: r.cheques_sin_pagar, monto_cheques_sin_pagar: r.monto_cheques_sin_pagar,
    proceso_judicial: r.proceso_judicial, semaforo: r.semaforo, historial: r.historial, data: r.data,
    error: r.error, consultado_at: new Date().toISOString(),
  };
}
