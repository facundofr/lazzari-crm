// FCI: movimientos de la cuenta custodia del BBVA ("BBVA_Comprobante_*.xls", hoja Mov_Cuenta_Custodia).
// Cada suscripción o rescate trae cuotapartes y precio de ese día. Con eso:
// - cuotapartesAl: cuántas cuotapartes había al cierre de un día.
// - valuaciones: el valor del fondo los días con operación (cuotapartes × precio del día). Son datos reales, no estimados.
// - rendimiento: lo que ganó el fondo entre dos valuaciones = valor final − valor inicial − suscripciones + rescates.

export interface OperacionFci {
  especie: string;
  fecha: string; // YYYY-MM-DD
  tipo: "suscripcion" | "rescate";
  cuotapartes: number;
  precio: number;
  monto: number;
}

export interface ValuacionFci { fecha: string; valor: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

/** "139.374,682" → 139374.682 */
function numeroAr(v: unknown): number | null {
  const s = String(v ?? "").replace(/\$/g, "").trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "01/10/2026" → "2026-10-01" */
function fechaAr(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Lee las filas del Excel de la custodia (como arrays). Solo operaciones "Realizada". */
export function leerCustodiaBbva(filas: unknown[][]): OperacionFci[] {
  const iCab = filas.findIndex((f) => f.some((c) => String(c).trim() === "Especie") && f.some((c) => String(c).trim() === "Cantidad (VN)"));
  if (iCab < 0) return [];
  const cab = filas[iCab].map((c) => String(c ?? "").trim());
  const col = (n: string) => cab.indexOf(n);
  const [cEsp, cFecha, cTipo, cCant, cPrecio, cMonto, cEstado] =
    ["Especie", "Fecha", "Tipo", "Cantidad (VN)", "Precio", "Monto Neto", "Estado"].map(col);
  const out: OperacionFci[] = [];
  for (const f of filas.slice(iCab + 1)) {
    const fecha = fechaAr(f[cFecha]);
    const tipoTxt = String(f[cTipo] ?? "").trim().toLowerCase();
    const cuotapartes = numeroAr(f[cCant]);
    const precio = numeroAr(f[cPrecio]);
    const monto = numeroAr(f[cMonto]);
    if (!fecha || cuotapartes === null || precio === null || monto === null) continue;
    if (cEstado >= 0 && String(f[cEstado] ?? "").trim() !== "Realizada") continue;
    const tipo = tipoTxt.startsWith("susc") ? "suscripcion" : tipoTxt.startsWith("resc") ? "rescate" : null;
    if (!tipo) continue;
    out.push({ especie: String(f[cEsp] ?? "").trim(), fecha, tipo, cuotapartes, precio, monto });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Cuotapartes al cierre del día (suma toda la historia del listado: tiene que empezar en la primera suscripción). */
export function cuotapartesAl(ops: OperacionFci[], especie: string, fecha: string): number {
  let cp = 0;
  for (const o of ops) {
    if (o.especie !== especie || o.fecha > fecha) continue;
    cp += o.tipo === "suscripcion" ? o.cuotapartes : -o.cuotapartes;
  }
  return Math.round(cp * 1000) / 1000;
}

/** Valor del fondo los días con operación (precio real de ese día), después de las operaciones del día. */
export function valuaciones(ops: OperacionFci[], especie: string): ValuacionFci[] {
  const dias = [...new Set(ops.filter((o) => o.especie === especie).map((o) => o.fecha))];
  return dias.map((fecha) => {
    const precio = ops.filter((o) => o.especie === especie && o.fecha === fecha)[0].precio;
    return { fecha, valor: r2(cuotapartesAl(ops, especie, fecha) * precio) };
  });
}

/** Lo que generó el fondo entre dos valuaciones (desde exclusive, hasta inclusive). */
export function rendimiento(ops: OperacionFci[], especie: string, desde: ValuacionFci, hasta: ValuacionFci) {
  let suscripciones = 0;
  let rescates = 0;
  for (const o of ops) {
    if (o.especie !== especie || o.fecha <= desde.fecha || o.fecha > hasta.fecha) continue;
    if (o.tipo === "suscripcion") suscripciones += o.monto; else rescates += o.monto;
  }
  return {
    desde: desde.fecha,
    hasta: hasta.fecha,
    suscripciones: r2(suscripciones),
    rescates: r2(rescates),
    ganancia: r2(hasta.valor - desde.valor - suscripciones + rescates),
  };
}

/**
 * Rendimiento por mes: de la última valuación real de un mes a la última del mes siguiente.
 * `extra` suma valuaciones que no salen del listado (ej. el total del home banking de hoy).
 */
export function rendimientoPorMes(ops: OperacionFci[], especie: string, extra: ValuacionFci[] = []) {
  const todas = [...valuaciones(ops, especie), ...extra].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimaDelMes = new Map<string, ValuacionFci>();
  for (const v of todas) ultimaDelMes.set(v.fecha.slice(0, 7), v);
  const puntos = [...ultimaDelMes.values()];
  return puntos.slice(1).map((hasta, i) => ({ mes: hasta.fecha.slice(0, 7), ...rendimiento(ops, especie, puntos[i], hasta) }));
}
