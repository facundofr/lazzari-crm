// Finanzas Lazza → Cheques → "Subir Excel del banco" (Augusto 19/10/2026): lee los listados de eCheq del BBVA
// (aceptados, depósito, endosados, rechazados, emitidos y denegados) y los compara con el CRM.
// Reglas (revisadas con Augusto): solo cambia el estado cuando coinciden N° + CUIT del emisor + monto; NUNCA crea cheques
// (los que no están se muestran aparte); ignora lo anterior a que se usa el CRM (22/08/2026); solo avanza estados.
// Prueba: npx tsx scripts/test-cheques-banco.ts
import { digitosCuenta, numeroCheque } from "@/lib/extracto-bbva";

export type ListadoBanco = "aceptados" | "deposito" | "endosados" | "rechazados" | "emitidos" | "denegados";

export interface ChequeBanco {
  listado: ListadoBanco;
  numero: string;
  cuit: string;
  monto: number;
  emision: string | null;
  pago: string | null;
  deposito: string | null;
  estadoBanco: string;
  /** Recibidos: quién lo firmó; emitidos: a quién se le dio. */
  quien: string;
  destinatario: string;
  /** Recibidos: fecha del último endoso (el nuestro). */
  endoso: string | null;
  cuentaDeposito: string;
  /** Cuenta nuestra del banco (emitidos: de emisión; depósito: donde se depositó). Vacía en los demás. */
  cuentaPropia: string;
}

export interface ChequeCrm {
  id: string; numero: string; direccion: string; estado: string; monto: number | string; cuit_emisor?: string | null;
  fecha_pago?: string | null; origen_nombre?: string | null; destino_nombre?: string | null;
}

export const DESDE_CRM = "2026-08-22";
const LABEL: Record<ListadoBanco, string> = { aceptados: "En cartera", deposito: "Depositados", endosados: "Endosados", rechazados: "Rechazados", emitidos: "Emitidos", denegados: "Denegados" };
export const nombreListado = (l: ListadoBanco) => LABEL[l];

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const fecha = (v: unknown): string | null => { const m = String(v ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const importe = (v: unknown): number => { const t = String(v ?? "").replace(/[$\s]/g, ""); const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Qué listado es, por los títulos (y, si hace falta, por el nombre del archivo). null = no es un listado de eCheq. */
export function tipoListado(encabezado: unknown[], nombreArchivo = ""): ListadoBanco | null {
  const h = encabezado.map(norm);
  if (!h.includes("n° de cheque") || !h.includes("monto")) return null;
  const n = norm(nombreArchivo);
  if (h.includes("emitido a")) return /denegad|repudi/.test(n) ? "denegados" : "emitidos";
  if (h.includes("destinatario")) return "endosados";
  if (h.includes("fecha de deposito")) return "deposito";
  if (/rechaz/.test(n)) return "rechazados";
  if (/acept/.test(n)) return "aceptados";
  return h.includes("cesiones") ? "aceptados" : null;
}

/** Filas de una hoja (primera fila = títulos) → cheques del banco. Los emitidos "denegados" se reconocen por el estado REPUDIADO. */
export function leerListadoBanco(filas: unknown[][], nombreArchivo = ""): ChequeBanco[] {
  const enc = filas[0] || [];
  let listado = tipoListado(enc, nombreArchivo);
  if (!listado) return [];
  const h = enc.map(norm);
  const col = (...k: string[]) => { for (const x of k) { const i = h.indexOf(x); if (i >= 0) return i; } return -1; };
  const c = {
    num: col("n° de cheque"), monto: col("monto"), estado: col("estado"), emision: col("fecha de emision"), pago: col("fecha de pago"),
    deposito: col("fecha de deposito"), cuit: col("tipo de documento del emisor", "documento del emisor"),
    quien: col("emitido a", "emitido por"), dest: col("destinatario"), endosos: col("endosos"), cuenta: col("n° de cuenta desposito", "n° de cuenta deposito"),
    emisionCuenta: listado === "emitidos" || listado === "denegados" ? col("n° de cuenta de emision") : -1,
  };
  const out: ChequeBanco[] = [];
  for (const f of filas.slice(1)) {
    const numero = String(f?.[c.num] ?? "").trim();
    const monto = importe(f?.[c.monto]);
    if (!numero || !Number.isFinite(monto)) continue;
    const estadoBanco = String(f?.[c.estado] ?? "").trim().toUpperCase();
    // Propios: denegado = el que lo recibía lo repudió (por el estado, no por el nombre del archivo).
    const l: ListadoBanco = listado === "emitidos" || listado === "denegados" ? (estadoBanco === "REPUDIADO" ? "denegados" : "emitidos") : listado;
    out.push({
      listado: l, numero, monto, estadoBanco, cuit: digitos(f?.[c.cuit]),
      emision: fecha(f?.[c.emision]), pago: fecha(f?.[c.pago]), deposito: c.deposito >= 0 ? fecha(f?.[c.deposito]) : null,
      quien: String(f?.[c.quien] ?? "").trim(), destinatario: c.dest >= 0 ? String(f?.[c.dest] ?? "").trim() : "",
      endoso: c.endosos >= 0 ? fecha(String(f?.[c.endosos] ?? "").split("|")[0]) : null,
      cuentaDeposito: c.cuenta >= 0 ? String(f?.[c.cuenta] ?? "").trim() : "",
      cuentaPropia: String((c.emisionCuenta >= 0 ? f?.[c.emisionCuenta] : c.cuenta >= 0 ? f?.[c.cuenta] : "") ?? "").trim(),
    });
  }
  return out;
}

/**
 * ¿Los Excel son de otra sociedad? Compara las cuentas nuestras que traen (emitidos y depósitos) con las de la sociedad elegida.
 * Devuelve las cuentas que no son de esta sociedad (vacío = está bien o no se puede saber).
 */
export function cuentasDeOtraSociedad(banco: ChequeBanco[], numerosSociedad: (string | null | undefined)[]): string[] {
  const propias = new Set(numerosSociedad.map(digitosCuenta).filter(Boolean));
  const enExcel = [...new Set(banco.map((b) => b.cuentaPropia).filter(Boolean))];
  if (!enExcel.length || !propias.size) return [];
  const ajenas = enExcel.filter((c) => { const d = digitosCuenta(c); return ![...propias].some((p) => d.endsWith(p) || p.endsWith(d)); });
  return ajenas.length === enExcel.length ? ajenas : [];
}

export interface CambioCheque {
  chequeId: string; numero: string; quien: string; monto: number; listado: ListadoBanco;
  de: string; a: string;
  /** "rechazar" usa la función de Finanzas (anula el cobro, la factura vuelve a pendiente, aviso). */
  accion: "estado" | "rechazar";
  campos: Record<string, string | null>;
  detalle: string;
}
export interface AvisoCheque { numero: string; quien: string; monto: number; listado: ListadoBanco; texto: string }
export interface ComparacionBanco {
  cambios: CambioCheque[];
  avisos: AvisoCheque[];
  /** Del banco, desde que se usa el CRM, que no están cargados (no se crean solos). */
  faltan: ChequeBanco[];
  coinciden: number;
  viejos: number;
}

const PEND_EMITIDO = ["pendiente", "entregado"];
const direccionDe = (l: ListadoBanco) => (l === "emitidos" || l === "denegados" ? "emitido" : "recibido");
const fechaRef = (b: ChequeBanco) => b.endoso || b.deposito || b.pago || b.emision || "";

/** Compara lo del banco con los cheques del CRM (de una sociedad). Si el mismo cheque viene en dos listados, gana el más avanzado. */
export function compararConBanco(banco: ChequeBanco[], crm: ChequeCrm[], desde = DESDE_CRM): ComparacionBanco {
  const r: ComparacionBanco = { cambios: [], avisos: [], faltan: [], coinciden: 0, viejos: 0 };
  const orden: ListadoBanco[] = ["emitidos", "denegados", "aceptados", "endosados", "deposito", "rechazados"];
  const unicos = new Map<string, ChequeBanco>();
  for (const b of [...banco].sort((a, z) => orden.indexOf(a.listado) - orden.indexOf(z.listado))) unicos.set(`${direccionDe(b.listado)}|${numeroCheque(b.numero)}|${b.cuit}`, b);

  for (const b of unicos.values()) {
    const dir = direccionDe(b.listado);
    const aviso = (texto: string) => r.avisos.push({ numero: b.numero, quien: b.quien, monto: b.monto, listado: b.listado, texto });
    const candidatos = crm.filter((c) => c.direccion === dir && c.estado !== "anulado" && numeroCheque(c.numero) === numeroCheque(b.numero)
      && (dir === "emitido" || !c.cuit_emisor || !b.cuit || digitos(c.cuit_emisor) === b.cuit));
    if (candidatos.length === 0) {
      if (fechaRef(b) >= desde || (b.pago || "") >= desde) r.faltan.push(b); else r.viejos += 1;
      continue;
    }
    if (candidatos.length > 1) { aviso(`Hay ${candidatos.length} cheques con ese número en el CRM: revisalo a mano.`); continue; }
    const c = candidatos[0];
    if (Math.abs(Number(c.monto) - b.monto) > 0.009) { aviso(`Monto distinto: CRM ${Number(c.monto).toFixed(2)} y banco ${b.monto.toFixed(2)}. No se cambia.`); continue; }
    const base = { chequeId: c.id, numero: b.numero, quien: b.quien, monto: b.monto, listado: b.listado, de: c.estado };
    const cambio = (a: string, campos: Record<string, string | null>, detalle: string, accion: CambioCheque["accion"] = "estado") => r.cambios.push({ ...base, a, accion, campos, detalle });

    if (dir === "emitido") {
      if (b.listado === "denegados") { if (PEND_EMITIDO.includes(c.estado)) aviso("El que lo recibía lo rechazó (repudiado): revisá la OP con la que se pagó."); else r.coinciden += 1; continue; }
      if (b.estadoBanco === "PAGADO" && PEND_EMITIDO.includes(c.estado)) { cambio("cobrado", { estado: "cobrado" }, "El banco ya lo pagó: pasa a Debitado"); continue; }
      if (b.estadoBanco === "ANULADO" && PEND_EMITIDO.includes(c.estado)) { aviso("El banco lo da ANULADO y el CRM lo tiene sin debitar: revisá la OP."); continue; }
      r.coinciden += 1;
      continue;
    }

    // Recibidos
    if (b.listado === "rechazados") {
      if (c.estado === "rechazado") r.coinciden += 1;
      else cambio("rechazado", {}, "Rechazado: se anula el cobro y sus facturas vuelven a quedar pendientes (como en Finanzas)", "rechazar");
      continue;
    }
    if (b.listado === "deposito") {
      const a = b.estadoBanco === "PAGADO" ? "cobrado" : b.estadoBanco === "DEPOSITADO" ? "depositado" : null;
      if (!a) { aviso(`Estado del banco "${b.estadoBanco}" sin regla: no se cambia.`); continue; }
      if (c.estado === a || (a === "depositado" && c.estado === "cobrado")) { r.coinciden += 1; continue; }
      if (c.estado === "en_cartera" || (c.estado === "depositado" && a === "cobrado")) {
        cambio(a, { estado: a, fecha_deposito: b.deposito, destino_tipo: "banco", destino_nombre: b.cuentaDeposito ? `BBVA ${b.cuentaDeposito}` : c.destino_nombre || null },
          a === "cobrado" ? `Depositado el ${b.deposito ?? "?"} y acreditado` : `Depositado el ${b.deposito ?? "?"}`);
        continue;
      }
      aviso(`El banco lo da ${a === "cobrado" ? "depositado y cobrado" : "depositado"} y el CRM lo tiene "${c.estado}": no se cambia.`);
      continue;
    }
    if (b.listado === "endosados") {
      // Endosado a otro: si el CRM ya lo da cobrado o endosado, está bien (ej. BAVSA: se cobró ahí, Augusto 19/10).
      if (c.estado === "endosado" || c.estado === "cobrado") { r.coinciden += 1; continue; }
      if (c.estado === "en_cartera") { cambio("endosado", { estado: "endosado", fecha_endoso: b.endoso, destino_nombre: b.destinatario || null }, `Endosado a ${b.destinatario || "un tercero"} el ${b.endoso ?? "?"}`); continue; }
      aviso(`El banco lo da endosado a ${b.destinatario || "un tercero"} y el CRM lo tiene "${c.estado}": no se cambia.`);
      continue;
    }
    // Aceptados (en cartera en el banco)
    if (c.estado === "en_cartera") r.coinciden += 1;
    else aviso(`El banco lo da en cartera (activo) y el CRM lo tiene "${c.estado}": revisalo.`);
  }
  return r;
}
