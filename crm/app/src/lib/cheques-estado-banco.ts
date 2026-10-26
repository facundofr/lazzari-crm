// Estado del cheque según el banco (reportes eCheq, columna echeqs.estado_banco) frente al estado del CRM (24/10/2026, Augusto).
// (Desde el 26/10/2026 los estados definitivos del banco SÍ actualizan el CRM: ver cambioSegunBanco más abajo.) Antes: el banco NO corregía al CRM: solo se marca cuando el banco dice algo definitivo (pagado, rechazado, anulado) y el CRM no lo tiene así,
// para que una persona lo mire. Los estados intermedios del banco (ACTIVO, PRESENTADO, CUSTODIA…) se muestran pero no se comparan.
// Prueba: scripts/test-cheques-estado-banco.ts
export function diferenciaConBanco(direccion: "emitido" | "recibido", estadoCrm: string, estadoBanco: string | null | undefined): string | null {
  const b = String(estadoBanco || "").trim().toUpperCase();
  if (!b) return null;
  const crm = String(estadoCrm || "").trim().toLowerCase();
  if (b === "RECHAZADO" && crm !== "rechazado") return "El banco lo tiene rechazado y el CRM no.";
  if (b === "ANULADO" && crm !== "anulado") return "El banco lo tiene anulado y el CRM no.";
  if (b === "PAGADO") {
    if (direccion === "emitido" && (crm === "pendiente" || crm === "entregado")) return "El banco ya lo pagó y el CRM lo tiene sin cobrar.";
    if (direccion === "recibido" && crm === "en_cartera") return "El banco lo tiene pagado y el CRM lo tiene en cartera.";
  }
  return null;
}

// ─── 26/10/2026 (Augusto): los reportes de eCheq actualizan el estado del CRM ─────────────────────────────────────────
// Misma regla que la función de base actualizar_cheques_segun_banco (migración 20261026130000): acá se usa para mostrar,
// ANTES de Guardar, qué cheques van a cambiar. Los endosados no se tocan; los estados intermedios del banco no cambian nada.
export interface CambioBanco { a: "cobrado" | "rechazado" | "anulado"; aviso: string | null }

export function cambioSegunBanco(direccion: "emitido" | "recibido", estadoCrm: string, estadoBanco: string | null | undefined): CambioBanco | null {
  const b = String(estadoBanco || "").trim().toUpperCase();
  const crm = String(estadoCrm || "").trim().toLowerCase();
  if (b === "PAGADO" && direccion === "emitido" && ["pendiente", "entregado"].includes(crm)) return { a: "cobrado", aviso: null };
  if (b === "PAGADO" && direccion === "recibido" && ["en_cartera", "depositado"].includes(crm)) return { a: "cobrado", aviso: null };
  if (b === "RECHAZADO" && direccion === "recibido" && !["rechazado", "anulado", "endosado"].includes(crm)) return { a: "rechazado", aviso: "Se anula el cobro de este cheque y la factura vuelve a deber." };
  if (b === "RECHAZADO" && direccion === "emitido" && !["rechazado", "anulado"].includes(crm)) return { a: "rechazado", aviso: "Cheque propio rechazado: revisá la orden de pago con la que se pagó y avisale al proveedor." };
  if (b === "ANULADO" && ["pendiente", "entregado", "en_cartera", "depositado"].includes(crm)) {
    return { a: "anulado", aviso: direccion === "emitido" ? "Revisá la orden de pago con la que se pagó." : "Revisá el cobro de este cheque." };
  }
  return null;
}

export interface ChequeCrmMin { id: string; cheq_id?: string | null; numero: string; monto: number | string; direccion: string | null; estado: string; contraparte?: string | null }
export interface ItemReporteMin { cheq_id: string; numero: string; monto: number; direccion: string; estado_banco: string }

/** Qué cheques del CRM cambian con esta carga de reportes (por CheqID; si el cheque no lo tiene, por número + monto + dirección, uno solo). */
export function cambiosDeLaCarga(items: ItemReporteMin[], cheques: ChequeCrmMin[]): Array<CambioBanco & { cheque: ChequeCrmMin; banco: string }> {
  const sinCero = (n: string) => String(n || "").trim().replace(/^0+/, "");
  const cent = (n: number | string) => Math.round(Number(n) * 100);
  const porCheqId = new Map(cheques.filter((c) => c.cheq_id).map((c) => [String(c.cheq_id), c]));
  const out: Array<CambioBanco & { cheque: ChequeCrmMin; banco: string }> = [];
  for (const it of items) {
    let ch = porCheqId.get(it.cheq_id);
    if (!ch) {
      const xs = cheques.filter((c) => !c.cheq_id && c.direccion === it.direccion && sinCero(c.numero) === sinCero(it.numero) && cent(c.monto) === cent(it.monto));
      if (xs.length === 1) ch = xs[0];
    }
    if (!ch || ch.direccion !== it.direccion || (it.direccion !== "emitido" && it.direccion !== "recibido")) continue;
    const c = cambioSegunBanco(it.direccion, ch.estado, it.estado_banco);
    if (c) out.push({ ...c, cheque: ch, banco: String(it.estado_banco).toUpperCase() });
  }
  return out;
}

// ─── 26/10/2026 (Finanzas simple, tanda 2): que no se pierda ningún cheque ─────────────────────────────────────────────
// Si en la carga viene el reporte de "emitidos", cada eCheq propio abierto del CRM (pendiente o entregado) tiene que estar
// en alguno de los reportes de cheques emitidos de esa carga. Los que no están se avisan (nunca se cambia nada):
// puede ser que el reporte esté cortado (el banco baja de a 100; con 300 faltaron 5 de Prisina) o que el cheque no exista en el banco.
// No se miran los cheques físicos (no van en los reportes de eCheq) ni los emitidos después de la fecha del reporte.
export interface ChequeAbiertoMin extends ChequeCrmMin { tipo_cheque?: string | null; fecha_emision?: string | null; fecha_pago?: string | null }
export interface ReporteEmitidosMin { archivo: string; tipo: string | null; direccion: string | null; filas: Array<{ cheqId: string; numero: string; monto: number }> }

/** "23-10-2026-eCheqs-emitidos.xls" → "2026-10-23" (null si el nombre no trae la fecha). */
export function fechaDelReporte(archivo: string): string | null {
  const m = String(archivo || "").match(/(\d{2})-(\d{2})-(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** null = en la carga no vino el reporte de emitidos (no hay contra qué controlar). */
export function abiertosFueraDelReporte(reportes: ReporteEmitidosMin[], cheques: ChequeAbiertoMin[]): ChequeAbiertoMin[] | null {
  const emitidos = reportes.filter((r) => r.direccion === "emitido");
  const base = emitidos.filter((r) => r.tipo === "emitidos");
  if (!base.length) return null;
  const sinCero = (n: string) => String(n || "").trim().replace(/^0+/, "");
  const cent = (n: number | string) => Math.round(Number(n) * 100);
  const ids = new Set<string>(), claves = new Set<string>();
  for (const r of emitidos) for (const f of r.filas) { ids.add(f.cheqId); claves.add(`${sinCero(f.numero)}|${cent(f.monto)}`); }
  // La fecha más vieja de los reportes de emitidos: lo emitido después puede no estar todavía.
  const fechas = base.map((r) => fechaDelReporte(r.archivo)).filter(Boolean) as string[];
  const hasta = fechas.length === base.length ? fechas.sort()[0] : null;
  return cheques
    .filter((c) => c.direccion === "emitido" && ["pendiente", "entregado"].includes(String(c.estado)) && String(c.tipo_cheque || "echeq") === "echeq")
    .filter((c) => !hasta || !c.fecha_emision || String(c.fecha_emision).slice(0, 10) <= hasta)
    .filter((c) => !(c.cheq_id && ids.has(String(c.cheq_id))) && !claves.has(`${sinCero(c.numero)}|${cent(c.monto)}`))
    .sort((a, b) => String(a.fecha_pago || "").localeCompare(String(b.fecha_pago || "")) || String(a.numero).localeCompare(String(b.numero)));
}
