// Extracto del BBVA (Excel "Detalle_mov_cuenta") y cruce automático contra el CRM.
// - leerExtractoBbva: lee las filas del Excel (cuenta, líneas, saldos, control de saltos).
// - leerListadoCheques: lee la planilla de cheques o el Excel de eCheq "emitidos".
// - cruzarExtracto: propone qué es cada línea (cobro, pago, cheque, impuesto, FCI…).
//   "auto" = se aplica solo; el resto se le pregunta a Augusto. Nunca frena nada.
import { clasificarMovimiento, type MovimientoClasificable } from "./tipos-movimiento";

export type ClasificacionLinea =
  | "cobro" | "pago" | "impuesto" | "gasto_bancario" | "intereses" | "fci" | "entre_cuentas" | "tarjeta"
  | "cheque_emitido" | "cheque_acreditado" | "cheque_devuelto" | "personal" | "otro";

export const CLASIFICACION_LABEL: Record<ClasificacionLinea, string> = {
  cobro: "Cobro",
  pago: "Pago",
  impuesto: "Impuesto",
  gasto_bancario: "Gasto bancario",
  intereses: "Intereses y reintegros",
  fci: "FCI",
  entre_cuentas: "Entre cuentas",
  tarjeta: "Pago de tarjeta",
  cheque_emitido: "Cheque propio debitado",
  cheque_acreditado: "Cheque acreditado",
  cheque_devuelto: "Cheque devuelto",
  personal: "Personal",
  otro: "Otro",
};

export const SUBTIPO_LABEL: Record<string, string> = {
  iva: "IVA sobre comisiones",
  ley_25413: "Impuesto al cheque (Ley 25.413)",
  sircreb: "SIRCREB (IIBB, pago a cuenta)",
  comision: "Comisiones",
  mantenimiento: "Mantenimiento de cuenta",
  intereses: "Intereses",
  reintegro: "Reintegros",
  extraccion_efectivo: "Extracción de efectivo",
  deposito_efectivo: "Depósito de efectivo",
  // Los que puede sugerir la IA (bandeja Para confirmar, 16/10/2026).
  percepcion_iva: "Percepción de IVA",
  percepcion_iibb: "Percepción de IIBB",
  iibb: "Ingresos Brutos (pago)",
  afip: "AFIP / ARCA (VEP, plan de pagos)",
  otro_impuesto: "Otro impuesto",
  // Una ENTRADA dentro de una familia de impuestos o comisiones es una devolución o una reversa del banco, nunca un costo (Augusto 23/10).
  devolucion_iva: "Devolución de IVA del banco",
  devolucion_ley_25413: "Devolución del impuesto al cheque (Ley 25.413)",
  devolucion_sircreb: "Devolución o reversa de SIRCREB",
  devolucion_mantenimiento: "Devolución de mantenimiento de cuenta",
  devolucion_comision: "Devolución de comisión del banco",
  seguro: "Seguro",
  servicio: "Servicio (luz, internet, teléfono…)",
  sueldo: "Sueldo",
  retiro_socio: "Retiro del dueño",
};

// ─── Lectura de números y fechas ─────────────────────────────────────────────

/** "1.234,56" · "-21,00" · "$90,750.00" · "$321517.45" → número. Vacío o inválido → null. */
export function leerImporte(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").replace(/[$\s]/g, "").trim();
  if (!s) return null;
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  if (coma >= 0 && punto >= 0) {
    s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (coma >= 0) {
    // "1,000" o "1,000,000" (miles) vs "21,00" (decimales)
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (punto >= 0 && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "09/10/2026" → "2026-10-09". También acepta ISO. Inválida → null. */
export function leerFecha(v: unknown): string | null {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const centavos = (v: number) => Math.round(v * 100);

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

/** "091-312483/1" y "CC$ 91-312483/1" → "913124831" (para comparar números de cuenta). */
export function digitosCuenta(numero: string | null | undefined): string {
  return String(numero || "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Número de cheque sin ceros adelante ("00003414" → "3414"). */
export const numeroCheque = (n: string | null | undefined) => String(n || "").trim().replace(/^0+/, "");

// ─── Extracto ────────────────────────────────────────────────────────────────

export interface LineaBanco {
  fecha: string;
  concepto: string;
  sucursal: string;
  /** Con signo: + entra, − sale. */
  importe: number;
  saldo: number | null;
  clave: string;
}

export interface ExtractoLeido {
  /** Tal como viene en el Excel ("CC$ 91-312483/1"). */
  cuentaTexto: string;
  cuentaDigitos: string;
  /** Ordenadas de la más vieja a la más nueva. */
  lineas: LineaBanco[];
  saldoFinal: number | null;
  saldoFecha: string | null;
  /** Renglones donde saldo anterior + importe ≠ saldo (faltan líneas en el Excel). */
  saltos: number;
}

export function claveLinea(l: Pick<LineaBanco, "fecha" | "importe" | "saldo" | "concepto">): string {
  return `${l.fecha}|${l.importe.toFixed(2)}|${l.saldo === null ? "" : l.saldo.toFixed(2)}|${l.concepto.trim().toUpperCase()}`;
}

/**
 * Huella de una línea sin el texto del concepto: fecha|importe|saldo. Los dos Excel del BBVA escriben distinto el
 * concepto de la misma línea ("CUENTA VISA NRO. …" vs "PAGO VISA-IN …"), pero fecha, importe y saldo coinciden.
 */
export function huellaLinea(clave: string): string {
  const [fecha, importe, saldo] = String(clave || "").split("|");
  return saldo ? `${fecha}|${importe}|${saldo}` : String(clave || "");
}

/** Líneas que todavía no están cargadas (ni con la misma clave ni con la misma fecha, importe y saldo). */
export function lineasNuevas<T extends { clave: string }>(lineas: T[], clavesCargadas: Iterable<string>): T[] {
  const ya = new Set<string>();
  for (const c of clavesCargadas) { ya.add(c); ya.add(huellaLinea(c)); }
  const vistas = new Set<string>();
  return lineas.filter((l) => {
    const h = huellaLinea(l.clave);
    if (ya.has(l.clave) || ya.has(h) || vistas.has(h)) return false;
    vistas.add(h);
    return true;
  });
}

/** Lee las filas (array de arrays de texto) del Excel "Detalle_mov_cuenta" del BBVA. */
export function leerExtractoBbva(filas: unknown[][]): ExtractoLeido {
  let cuentaTexto = "";
  let inicio = -1;
  filas.forEach((f, i) => {
    const a = String(f?.[0] ?? "");
    const t = a.match(/Detalle de Movimientos de Cuenta:\s*(.+)$/i);
    if (t && !cuentaTexto) cuentaTexto = t[1].trim();
    if (inicio < 0 && /^fecha$/i.test(a.trim()) && /concepto/i.test(String(f?.[1] ?? ""))) inicio = i + 1;
  });
  if (!cuentaTexto || inicio < 0) throw new Error("No parece un Excel de movimientos del BBVA (falta el encabezado \"Detalle de Movimientos de Cuenta\").");

  const lineas: LineaBanco[] = [];
  for (const f of filas.slice(inicio)) {
    const fecha = leerFecha(f?.[0]);
    const importe = leerImporte(f?.[3]);
    if (!fecha || importe === null) continue;
    const concepto = String(f?.[1] ?? "").replace(/\s+/g, " ").trim();
    const sucursal = String(f?.[2] ?? "").replace(/\s+/g, " ").trim();
    const saldo = leerImporte(f?.[4]);
    const l = { fecha, concepto, sucursal, importe: r2(importe), saldo: saldo === null ? null : r2(saldo) };
    lineas.push({ ...l, clave: claveLinea(l) });
  }
  // El banco las lista de la más nueva a la más vieja.
  lineas.reverse();

  let saltos = 0;
  for (let i = 1; i < lineas.length; i++) {
    const prev = lineas[i - 1].saldo, act = lineas[i].saldo;
    if (prev !== null && act !== null && centavos(prev) + centavos(lineas[i].importe) !== centavos(act)) saltos++;
  }
  const ultima = lineas[lineas.length - 1];
  return {
    cuentaTexto,
    cuentaDigitos: digitosCuenta(cuentaTexto.replace(/^[A-Z$ ]+/i, "")),
    lineas,
    saldoFinal: ultima?.saldo ?? null,
    saldoFecha: ultima?.fecha ?? null,
    saltos,
  };
}

/** "13-10-2026" o "13/10/2026" → "2026-10-13". */
function leerFechaGuiones(v: unknown): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Lee el Excel "Movimientos" del home banking del BBVA (hojas "Movimientos del Día" y "Movimientos Históricos").
 * No trae el saldo de cada línea: se calcula hacia atrás desde el "Saldo:" del encabezado.
 * Si se pasa `ancla` (último saldo que el CRM ya tiene de esa cuenta), se VERIFICA que el cálculo llegue a ese mismo saldo:
 * si no cierra (por ejemplo falta el último día cerrado), tira un error explicando la diferencia y no se guarda nada.
 */
export function leerMovimientosBbva(hojas: unknown[][][], ancla?: { fecha: string; saldo: number } | null): ExtractoLeido {
  type Crudo = LineaBanco & { orden: number };
  let cuentaTexto = "", saldoHeader = null as number | null;
  const dia: Crudo[] = [], hist: Crudo[] = [];
  for (const filas of hojas) {
    let iniEnc = -1, esDia = false;
    filas.forEach((f, i) => {
      const a = String(f?.[0] ?? "").trim();
      if (/^cuenta:?$/i.test(a) && !cuentaTexto) cuentaTexto = String(f?.[1] ?? "").trim();
      if (/^saldo:?$/i.test(a) && saldoHeader === null) saldoHeader = leerImporte(f?.[1]);
      if (iniEnc < 0 && /^fecha$/i.test(a) && /concepto/i.test(String(f?.[2] ?? ""))) {
        iniEnc = i;
        esDia = /nro de cheque|saldo parcial/i.test((f || []).join("|"));
      }
    });
    if (iniEnc < 0) continue;
    const enc = (filas[iniEnc] || []).map((c) => String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim());
    const cCred = enc.findIndex((c) => c.startsWith("credito")), cDeb = enc.findIndex((c) => c.startsWith("debito"));
    const cDet = enc.findIndex((c) => c === "detalle"), cOfi = enc.findIndex((c) => c === "oficina");
    // "Número Documento" (histórico) o "Nro de cheque" (del día): en los cheques es el N° del cheque.
    const cDoc = enc.findIndex((c) => c === "numero documento" || c === "nro de cheque");
    if (cCred < 0 || cDeb < 0) continue;
    filas.slice(iniEnc + 1).forEach((f, k) => {
      const fecha = leerFechaGuiones(f?.[0]);
      if (!fecha) return;
      const importe = (leerImporte(f?.[cCred]) || 0) + (leerImporte(f?.[cDeb]) || 0);
      if (!importe) return;
      let concepto = String(f?.[2] ?? "").replace(/\s+/g, " ").trim();
      const det = cDet >= 0 ? String(f?.[cDet] ?? "").replace(/\s+/g, " ").trim() : "";
      // El detalle suele nombrar al que pagó (ej. "CTE 007875 285-… FUNDACION CARGI"): se agrega para poder identificarlo.
      if (det && !/^[\d ]+$/.test(det) && !/saldo disponible/i.test(det)) concepto += ` · ${det}`;
      const sucursal = cOfi >= 0 ? String(f?.[cOfi] ?? "").replace(/\s+/g, " ").trim() : "";
      // El N° de cheque es la identificación del cheque (Augusto 23/10): se suma al concepto para cruzarlo por número.
      const doc = cDoc >= 0 ? String(f?.[cDoc] ?? "").replace(/\D/g, "") : "";
      if (/^\d{7,8}$/.test(doc) && /^(CH\/CLEAR|CJE\. INTERNO|PAGO CHEQUE|CHEQUE)/i.test(concepto) && !concepto.trim().endsWith(doc)) concepto += ` N ${doc}`;
      const l = { fecha, concepto, sucursal, importe: r2(importe), saldo: null as number | null };
      (esDia ? dia : hist).push({ ...l, clave: "", orden: k });
    });
  }
  if (!cuentaTexto || saldoHeader === null || (!dia.length && !hist.length)) {
    throw new Error("No reconozco este Excel del BBVA (ni \"Detalle de Movimientos de Cuenta\" ni \"Movimientos\" con saldo).");
  }
  // "Movimientos del Día" viene de la más nueva a la más vieja. El histórico trae cada día de la más vieja a la más nueva
  // y los días de más nuevo a más viejo: se da vuelta dentro de cada día para dejar todo "más nueva primero".
  const diaMin = dia.length ? dia.map((l) => l.fecha).sort()[0] : "9999-12-31";
  const porFecha = new Map<string, Crudo[]>();
  for (const l of hist.filter((x) => x.fecha < diaMin)) porFecha.set(l.fecha, [...(porFecha.get(l.fecha) || []), l]);
  const ordenado: Crudo[] = [...dia];
  for (const f of [...porFecha.keys()].sort().reverse()) ordenado.push(...(porFecha.get(f) || []).slice().reverse());
  // Saldos hacia atrás desde el saldo actual.
  let saldo = saldoHeader;
  const lineas: LineaBanco[] = [];
  for (const l of ordenado) {
    const base = { fecha: l.fecha, concepto: l.concepto, sucursal: l.sucursal, importe: l.importe, saldo: r2(saldo) };
    lineas.push({ ...base, clave: claveLinea(base) });
    saldo = r2(saldo - l.importe);
  }
  lineas.reverse();

  let saltos = 0;
  if (ancla) {
    let hasta = saldoAl(lineas, ancla.fecha);
    // Si el Excel arranca DESPUÉS del último saldo cargado (ej. solo trae el día de hoy), su saldo de apertura tiene que ser ese saldo.
    if (hasta === null && lineas.length && lineas[0].fecha > ancla.fecha && lineas[0].saldo !== null) hasta = r2(lineas[0].saldo - lineas[0].importe);
    if (hasta === null || centavos(hasta) !== centavos(ancla.saldo)) {
      const dif = hasta === null ? null : r2(hasta - ancla.saldo);
      throw new Error(`Los saldos no cierran contra lo que ya está cargado (al ${ancla.fecha.split("-").reverse().join("/")} el CRM tiene ${ancla.saldo.toLocaleString("es-AR")} y este Excel da ${hasta === null ? "—" : hasta.toLocaleString("es-AR")}${dif === null ? "" : `, diferencia ${dif.toLocaleString("es-AR")}`}). Suele pasar cuando el Excel no incluye el último día cerrado: volvé a bajarlo cuando el banco lo actualice, o usá el "Detalle_mov_cuenta".`);
    }
  }
  const ultima = lineas[lineas.length - 1];
  return {
    cuentaTexto,
    cuentaDigitos: digitosCuenta(cuentaTexto.replace(/\(.*$/, "")),
    lineas,
    saldoFinal: ultima?.saldo ?? saldoHeader,
    saldoFecha: ultima?.fecha ?? null,
    saltos,
  };
}

/** Saldo del extracto al cierre de un día (el de la última línea hasta esa fecha). */
export function saldoAl(lineas: LineaBanco[], fecha: string): number | null {
  let s: number | null = null;
  for (const l of lineas) if (l.fecha <= fecha) s = l.saldo;
  return s;
}

// ─── Listado de cheques emitidos (planilla o eCheq) ─────────────────────────

export interface ChequeListado {
  numero: string;
  monto: number;
  fecha_emision: string | null;
  fecha_pago: string;
  beneficiario: string | null;
  /** Como lo dice el banco: PAGADO, ACTIVO, ANULADO… */
  estado: string;
  fecha_debito: string | null;
  cubre_tercero: string | null;
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Lee una hoja con cheques emitidos. Sirve para la hoja "Emitidos" de la planilla de Augusto
 * y para el Excel "eCheqs-emitidos" del banco. Si la hoja no es de emitidos devuelve [].
 * terceroColumna: columnas "Es Martín Fernández" = "Sí" → cubre_tercero "Martín Fernández".
 */
export function leerListadoCheques(filas: unknown[][]): ChequeListado[] {
  const idxEnc = filas.findIndex((f) => (f || []).some((c) => /^n° (de )?cheque$/.test(norm(c))));
  if (idxEnc < 0) return [];
  const enc = (filas[idxEnc] || []).map(norm);
  const col = (...nombres: string[]) => enc.findIndex((c) => nombres.includes(c));
  const cNum = col("n° cheque", "n° de cheque");
  const cMonto = col("monto");
  const cEmision = col("fecha emision", "fecha de emision");
  const cPago = col("fecha de cobro", "fecha de pago");
  const cBenef = col("beneficiario", "emitido a");
  const cEstado = col("estado");
  const cDebito = col("fecha debito", "fecha de debito");
  const cTercero = enc.findIndex((c) => c.startsWith("es ") && c !== "estado");
  // Sin beneficiario no es un listado de emitidos (ej. hoja "Martín Fernández" o "Cartera recibidos").
  if (cNum < 0 || cMonto < 0 || cPago < 0 || cBenef < 0) return [];
  const tercero = cTercero >= 0 ? String(filas[idxEnc][cTercero]).replace(/^es\s+/i, "").trim() : null;

  const out: ChequeListado[] = [];
  for (const f of filas.slice(idxEnc + 1)) {
    const numero = String(f?.[cNum] ?? "").trim();
    const monto = leerImporte(f?.[cMonto]);
    const fecha_pago = leerFecha(f?.[cPago]);
    if (!numero || monto === null || !fecha_pago) continue;
    const benef = String(f?.[cBenef] ?? "").trim();
    const esTercero = cTercero >= 0 && /^s[ií]$/i.test(String(f?.[cTercero] ?? "").trim());
    out.push({
      numero,
      monto: r2(monto),
      fecha_emision: cEmision >= 0 ? leerFecha(f?.[cEmision]) : null,
      fecha_pago,
      beneficiario: benef && !/^\(sin nombre/i.test(benef) ? benef : null,
      estado: cEstado >= 0 ? String(f?.[cEstado] ?? "").trim().toUpperCase() : "",
      fecha_debito: cDebito >= 0 ? leerFecha(f?.[cDebito]) : null,
      cubre_tercero: esTercero ? tercero : null,
    });
  }
  return out;
}

/**
 * Junta varios listados (sin repetir número; si se repite, gana el que trae más datos)
 * y deja los que hacen falta: los que se pagan desde `desde` en adelante o siguen sin pagar,
 * más todos los que cubre un tercero.
 */
export function chequesParaCompletar(listados: ChequeListado[][], desde: string): ChequeListado[] {
  return unirListados(listados)
    .filter((c) => c.cubre_tercero || c.fecha_pago >= desde || !["PAGADO", "ANULADO"].includes(c.estado));
}

/** Junta varios listados sin repetir número (si se repite, gana el que trae más datos). Ordenados por fecha de pago. */
export function unirListados(listados: ChequeListado[][]): ChequeListado[] {
  const porNumero = new Map<string, ChequeListado>();
  for (const lista of listados) {
    for (const c of lista) {
      const k = numeroCheque(c.numero);
      const prev = porNumero.get(k);
      porNumero.set(k, prev ? {
        ...prev, ...c,
        beneficiario: c.beneficiario || prev.beneficiario,
        fecha_emision: c.fecha_emision || prev.fecha_emision,
        fecha_debito: c.fecha_debito || prev.fecha_debito,
        cubre_tercero: c.cubre_tercero || prev.cubre_tercero,
        estado: c.estado || prev.estado,
      } : c);
    }
  }
  return [...porNumero.values()]
    .sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.numero.localeCompare(b.numero));
}

// ─── Cruce ───────────────────────────────────────────────────────────────────

export interface LineaCruce {
  id: string;
  fecha: string;
  concepto: string;
  /** Con signo: + crédito, − débito. */
  importe: number;
  cuenta_id: string | null;
  /** Si ya la marcó como cobro/pago a cargar, se sigue buscando su movimiento. */
  clasificacion?: string | null;
  /** Factura de ARCA que paga esta salida (leída de "Mis comprobantes recibidos"; ver lib/arca-recibidos). */
  factura_arca?: { tipo: string; punto_venta: number; numero: number; fecha: string; total: number; emisor: string; cuit: string; unica: boolean } | null;
}

export interface MovCruce extends MovimientoClasificable {
  id: string;
  fecha: string;
  monto: number | string;
  moneda?: string | null;
  /** CUIT del cliente o proveedor (para las transferencias que lo traen en el concepto). */
  cuit?: string | null;
  /** Pagos de OP: la parte en transferencias (lo pagado con cheques se cruza por el cheque). */
  montoCuenta?: number | null;
}

export interface ChequeCruce {
  id: string;
  numero: string;
  monto: number | string;
  direccion: string | null;
  estado: string;
  fecha_pago: string | null;
  tipo_cheque?: string | null;
}

export interface CuentaCruce {
  id: string;
  tipo: string;
  nombre: string;
  numero: string | null;
  moneda: string;
  activa?: boolean | null;
}

export interface ReglaCruce {
  texto: string;
  sentido: "credito" | "debito" | null;
  clasificacion: ClasificacionLinea;
  subtipo?: string | null;
  contra_cuenta_id?: string | null;
  nota?: string | null;
}

export interface Propuesta {
  linea_id: string;
  clasificacion: ClasificacionLinea | null;
  subtipo?: string | null;
  movimiento_id?: string | null;
  cheque_id?: string | null;
  contra_cuenta_id?: string | null;
  nota?: string | null;
  /** true = seguro, se aplica solo. false = se le pregunta (con sugerencia y candidatos). */
  auto: boolean;
  /** Movimientos o cheques posibles cuando hay que elegir. */
  candidatos: string[];
  motivo: string;
}

interface Contexto {
  cuentas: CuentaCruce[];
  reglas: ReglaCruce[];
  /** Cheques ya enlazados a otra línea, por clasificación ("cheque_emitido:<id>"). */
  chequesUsados: Set<string>;
}

const esCredito = (l: LineaCruce) => l.importe > 0;

/** Clasificación fija por el texto del concepto (impuestos, comisiones, FCI, cuentas propias, tarjetas). */
function clasificarPorConcepto(l: LineaCruce, ctx: Contexto): Omit<Propuesta, "linea_id"> | null {
  const c = l.concepto.toUpperCase();
  const credito = esCredito(l);
  const base = { auto: true, candidatos: [] as string[] };
  /** Una entrada en estas familias es una devolución, no un costo: se guarda aparte para que los totales no se mezclen. */
  const fam = <T extends { clasificacion: ClasificacionLinea; subtipo: string; motivo: string }>(r: T): T => (credito ? { ...r, subtipo: `devolucion_${r.subtipo}`, motivo: `Devolución: ${r.motivo}` } : r);

  for (const r of ctx.reglas) {
    if (!r.texto.trim() || !c.includes(r.texto.trim().toUpperCase())) continue;
    if (r.sentido && r.sentido !== (credito ? "credito" : "debito")) continue;
    return { ...base, clasificacion: r.clasificacion, subtipo: r.subtipo || null, contra_cuenta_id: r.contra_cuenta_id || null, nota: r.nota || null, motivo: `Regla: "${r.texto}"` };
  }

  // El Excel "Movimientos" abrevia los textos: "IVA TASA GRA", "LEY NRO 25.4 …", "IMPUESTO LEY dd/mm/aa …", "REG REC SIRC …" (códigos del banco 236, 609, 589 y 550).
  if (/IVA TASA (GENERAL|GRA)/.test(c)) return fam({ ...base, clasificacion: "impuesto", subtipo: "iva", motivo: "IVA del banco" });
  if (/25\.?413|LEY NRO 25\.4|^IMPUESTO LEY \d/.test(c)) return fam({ ...base, clasificacion: "impuesto", subtipo: "ley_25413", motivo: "Impuesto al cheque" });
  if (/SIRCREB|REG REC SIRC/.test(c)) return fam({ ...base, clasificacion: "impuesto", subtipo: "sircreb", motivo: "SIRCREB (Ingresos Brutos)" });
  if (/MANT(\.|ENIMIENTO)? ?MENS|CO\.MANT/.test(c)) return fam({ ...base, clasificacion: "gasto_bancario", subtipo: "mantenimiento", motivo: "Mantenimiento de cuenta" });
  if (/^COMI(SION|\s)|COMISION/.test(c)) return fam({ ...base, clasificacion: "gasto_bancario", subtipo: "comision", motivo: "Comisión del banco" });
  if (/INTERESES GANADOS/.test(c) && credito) return { ...base, clasificacion: "intereses", subtipo: "intereses", motivo: "Intereses" };
  if (/REINTEGRO PROMO/.test(c) && credito) return { ...base, clasificacion: "intereses", subtipo: "reintegro", motivo: "Reintegro de promoción" };

  const activas = ctx.cuentas.filter((x) => x.activa !== false);
  if (/OPERACION FCI/.test(c)) {
    const fci = activas.find((x) => x.tipo === "fci" && x.moneda === "ARS");
    return { ...base, clasificacion: "fci", contra_cuenta_id: fci?.id || null, auto: Boolean(fci), motivo: credito ? "Rescate del FCI" : "Suscripción al FCI" };
  }

  // TRANSFERENCIA CCP091 312483 1 / CAP091 339549 3 → otra cuenta propia.
  const propia = c.match(/\bCA?[CP]P?\s?(\d{3})\s(\d{6})\s(\d)\b/);
  if (propia) {
    const dig = digitosCuenta(propia.slice(1).join(""));
    const otra = activas.find((x) => x.id !== l.cuenta_id && digitosCuenta(x.numero) === dig);
    if (otra) return { ...base, clasificacion: "entre_cuentas", contra_cuenta_id: otra.id, motivo: `Pase con ${otra.nombre}` };
  }

  // Regla de Augusto: lo que se extrae no se supone en la caja (el efectivo es solo lo que carga él).
  // La extracción sale del banco sin ir a la cuenta Efectivo; el depósito se pregunta (puede ser un cobro).
  if (/EXTRACCION DE EFECTIVO/.test(c) && !credito) {
    return { ...base, clasificacion: "otro", subtipo: "extraccion_efectivo", motivo: "Extracción de efectivo (no suma a la caja)" };
  }
  if (/DEPOSITO EFECTIVO/.test(c) && credito) {
    return { ...base, clasificacion: "otro", subtipo: "deposito_efectivo", auto: false, motivo: "Depósito de efectivo: ¿es un cobro?" };
  }

  const tarjeta = c.match(/^CUENTA (VISA|MASTERCARD) NRO\.?\s*(\d+)|^PAGO DE TARJETA (VISA|MASTERCARD)/);
  if (tarjeta && !credito) {
    const marca = (tarjeta[1] || tarjeta[3] || "").toUpperCase();
    const nro = tarjeta[2] || "";
    const tarjetas = activas.filter((x) => x.tipo === "tarjeta_credito");
    const t = tarjetas.find((x) => digitosCuenta(x.numero) && nro.includes(digitosCuenta(x.numero)))
      || tarjetas.find((x) => x.nombre.toUpperCase().includes(marca === "MASTERCARD" ? "MASTER" : marca));
    return { ...base, clasificacion: "tarjeta", contra_cuenta_id: t?.id || null, auto: Boolean(t), motivo: `Pago del resumen ${marca === "MASTERCARD" ? "Mastercard" : "Visa"}` };
  }
  return null;
}

/** CUIT de 11 dígitos dentro del concepto (TRANSFERENCIA 20372644606). */
const cuitEnConcepto = (concepto: string) => (concepto.match(/\b(\d{11})\b/) || [])[1] || null;

function esCandidatoCobroPago(l: LineaCruce, m: MovCruce): boolean {
  if (String(m.moneda || "ARS") !== "ARS") return false;
  const importe = centavos(Math.abs(l.importe));
  const parteCuenta = m.montoCuenta === null || m.montoCuenta === undefined ? null : centavos(Number(m.montoCuenta));
  if (centavos(Number(m.monto)) !== importe && parteCuenta !== importe) return false;
  const tipo = String(m.tipo || "");
  if (tipo.startsWith("retencion_") || ["cheque_recibido", "cheque_emitido", "echeq", "efectivo"].includes(tipo)) return false;
  const clase = clasificarMovimiento(m);
  const d = diasEntre(l.fecha, String(m.fecha).slice(0, 10));
  if (esCredito(l)) return clase === "ingreso" && d >= -10 && d <= 3;
  return clase === "egreso" && d >= -7 && d <= 5;
}

/**
 * Propone qué es cada línea pendiente.
 * - movimientos: los del CRM que todavía no están cruzados con ninguna línea (aunque digan "conciliado").
 * - cheques: todos los de la sociedad.
 */
export function cruzarExtracto(
  lineas: LineaCruce[],
  movimientos: MovCruce[],
  cheques: ChequeCruce[],
  cuentas: CuentaCruce[],
  reglas: ReglaCruce[] = [],
  chequesUsados: Set<string> = new Set(),
): Propuesta[] {
  const ctx: Contexto = { cuentas, reglas, chequesUsados: new Set(chequesUsados) };
  const out = new Map<string, Propuesta>();
  const ordenadas = [...lineas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));

  const emitidosPorNumero = new Map<string, ChequeCruce[]>();
  const recibidosPorNumero = new Map<string, ChequeCruce[]>();
  for (const ch of cheques) {
    if (ch.estado === "anulado") continue;
    const mapa = ch.direccion === "emitido" ? emitidosPorNumero : recibidosPorNumero;
    const k = numeroCheque(ch.numero);
    mapa.set(k, [...(mapa.get(k) || []), ch]);
  }
  const usar = (clas: string, id: string) => ctx.chequesUsados.add(`${clas}:${id}`);
  const usado = (clas: string, id: string) => ctx.chequesUsados.has(`${clas}:${id}`);

  const pendientesCobroPago: LineaCruce[] = [];

  for (const l of ordenadas) {
    const c = l.concepto.toUpperCase();
    // Ya marcada como cobro/pago a cargar: solo se busca su movimiento.
    if (l.clasificacion === "cobro" || l.clasificacion === "pago") { pendientesCobroPago.push(l); continue; }

    const fija = clasificarPorConcepto(l, ctx);
    if (fija) { out.set(l.id, { linea_id: l.id, ...fija }); continue; }

    // Cheque propio debitado: PAGO CHEQUE 48HS CAP.FED. N 90016949 / PAGO CHEQUE 24HS 00496366
    // (En el Excel "Movimientos" el N° viene en la columna "Número Documento" y el lector lo agrega al final: "CH/CLEAR.48 … N 90017341".)
    const pagoCheque = c.match(/^PAGO CHEQUE.*?(\d{8})\s*$/) || c.match(/^(?:CH\/CLEAR|CJE\. INTERNO).* N (\d{8})\s*$/);
    if (pagoCheque && !esCredito(l)) {
      const num = numeroCheque(pagoCheque[1]);
      const lista = (emitidosPorNumero.get(num) || []).filter((ch) => !usado("cheque_emitido", ch.id));
      const exacto = lista.find((ch) => centavos(Number(ch.monto)) === centavos(-l.importe));
      if (exacto) {
        usar("cheque_emitido", exacto.id);
        out.set(l.id, { linea_id: l.id, clasificacion: "cheque_emitido", cheque_id: exacto.id, auto: true, candidatos: [], motivo: `Cheque ${pagoCheque[1]}` });
        continue;
      }
      // Sin número en el CRM (cheque de papel o cargado sin número): por importe.
      const porImporte = cheques.filter((ch) => ch.direccion === "emitido" && ["pendiente", "entregado"].includes(ch.estado)
        && centavos(Number(ch.monto)) === centavos(-l.importe) && !usado("cheque_emitido", ch.id)
        && !emitidosPorNumero.get(num)?.includes(ch));
      out.set(l.id, {
        linea_id: l.id, clasificacion: "cheque_emitido", cheque_id: lista[0]?.id || (porImporte.length === 1 ? porImporte[0].id : null),
        auto: false, candidatos: [...lista, ...porImporte].map((ch) => ch.id),
        motivo: lista.length ? `El cheque ${pagoCheque[1]} está en el CRM con otro monto` : `El cheque ${pagoCheque[1]} no está cargado en el CRM`,
      });
      continue;
    }

    // Cheque recibido devuelto: CHEQUE 48HS. DEVUELTO CAP F 00000074
    const devuelto = c.match(/DEVUELTO.*?(\d{6,8})\s*$/);
    if (devuelto && !esCredito(l)) {
      const ch = (recibidosPorNumero.get(numeroCheque(devuelto[1])) || []).find((x) => !usado("cheque_devuelto", x.id));
      if (ch) usar("cheque_devuelto", ch.id);
      out.set(l.id, {
        linea_id: l.id, clasificacion: "cheque_devuelto", cheque_id: ch?.id || null, auto: Boolean(ch), candidatos: [],
        motivo: ch ? `Cheque ${devuelto[1]} devuelto${ch.estado === "rechazado" ? " (ya rechazado en el CRM)" : ": rechazalo desde Cheques"}` : `Cheque ${devuelto[1]} devuelto, no está en el CRM`,
        nota: ch && ch.estado !== "rechazado" ? "Falta rechazarlo desde Finanzas > Cheques" : null,
      });
      continue;
    }

    // Depósito de cheque acreditado: por importe contra los cheques recibidos.
    if (/^DEPOSITO CHEQUE/.test(c) && esCredito(l)) {
      const cand = cheques.filter((ch) => ch.direccion !== "emitido"
        && ["en_cartera", "depositado", "cobrado", "rechazado"].includes(ch.estado)
        && centavos(Number(ch.monto)) === centavos(l.importe)
        && (!ch.fecha_pago || ch.fecha_pago <= sumarDias(l.fecha, 3))
        && !usado("cheque_acreditado", ch.id));
      if (cand.length === 1) usar("cheque_acreditado", cand[0].id);
      out.set(l.id, {
        linea_id: l.id, clasificacion: "cheque_acreditado", cheque_id: cand.length === 1 ? cand[0].id : null,
        auto: cand.length === 1, candidatos: cand.length === 1 ? [] : cand.map((ch) => ch.id),
        motivo: cand.length === 1 ? `Cheque ${cand[0].numero}` : cand.length ? "Hay más de un cheque por ese importe" : "No hay un cheque recibido por ese importe",
      });
      continue;
    }

    pendientesCobroPago.push(l);
  }

  // Cobros y pagos: por importe exacto y fecha cercana. Solo se aplica solo si es único para los dos lados.
  const usados = new Set<string>();
  const candidatosDe = new Map<string, MovCruce[]>();
  for (const l of pendientesCobroPago) {
    let cand = movimientos.filter((m) => esCandidatoCobroPago(l, m));
    const cuit = cuitEnConcepto(l.concepto);
    if (cuit) {
      const mismoCuit = cand.filter((m) => String(m.cuit || "").replace(/\D/g, "") === cuit);
      if (mismoCuit.length) cand = mismoCuit;
    }
    candidatosDe.set(l.id, cand);
  }
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const l of pendientesCobroPago) {
      if (out.get(l.id)?.auto) continue;
      const libres = (candidatosDe.get(l.id) || []).filter((m) => !usados.has(m.id));
      if (libres.length !== 1) continue;
      const m = libres[0];
      const otras = pendientesCobroPago.filter((o) => o.id !== l.id && !out.get(o.id)?.auto && (candidatosDe.get(o.id) || []).some((x) => x.id === m.id));
      if (otras.length) continue;
      usados.add(m.id);
      out.set(l.id, { linea_id: l.id, clasificacion: esCredito(l) ? "cobro" : "pago", movimiento_id: m.id, auto: true, candidatos: [], motivo: m.descripcion ? String(m.descripcion) : "Mismo importe y fecha cercana" });
      cambio = true;
    }
  }
  for (const l of pendientesCobroPago) {
    if (out.get(l.id)?.auto) continue;
    const libres = (candidatosDe.get(l.id) || []).filter((m) => !usados.has(m.id));
    const yaMarcada = l.clasificacion === "cobro" || l.clasificacion === "pago";
    out.set(l.id, {
      linea_id: l.id,
      clasificacion: (yaMarcada ? l.clasificacion : esCredito(l) ? "cobro" : "pago") as ClasificacionLinea,
      movimiento_id: null,
      auto: false,
      candidatos: libres.map((m) => m.id),
      motivo: libres.length > 1 ? "Hay más de un movimiento posible" : libres.length === 1 ? "Puede ser este movimiento" : esCredito(l) ? "No encontré el cobro en el CRM" : "No encontré el pago en el CRM",
    });
  }

  return ordenadas.map((l) => out.get(l.id)!).filter(Boolean);
}

// ─── Totales de gastos e impuestos del banco (opción 1a) ────────────────────

export interface LineaClasificada {
  fecha: string;
  importe: number;
  clasificacion: string | null;
  subtipo: string | null;
}

/** Por mes (YYYY-MM) y subtipo: neto (negativo = gasto). Solo impuestos, gastos bancarios e intereses. */
export function totalesBancoPorMes(lineas: LineaClasificada[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const l of lineas) {
    if (!["impuesto", "gasto_bancario", "intereses"].includes(String(l.clasificacion))) continue;
    const mes = l.fecha.slice(0, 7);
    const k = l.subtipo || String(l.clasificacion);
    out[mes] = out[mes] || {};
    out[mes][k] = r2((out[mes][k] || 0) + l.importe);
  }
  return out;
}
