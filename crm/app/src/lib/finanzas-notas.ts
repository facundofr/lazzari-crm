/**
 * Nota literal de cada renglón del banco al confirmarlo (pedido de Augusto 15/10/2026: "que quede todo bien detallado,
 * retenciones, impuestos, IVA, de todo, todo bien literal", para tener a fin de mes un informe de cada cosa).
 * Funciones puras: no leen la base. La bandeja (finanzas-para-confirmar) les pasa lo que ya tiene cargado.
 * También arma el "Cobro de factura del sistema anterior" (facturas que no están en el CRM).
 *
 * Prueba: npx tsx scripts/test-finanzas-notas.ts
 */
import type { ClasificacionLinea } from "./extracto-bbva";

export const pesos = (n: number) => `$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ddmm = (fecha: string) => fecha.slice(0, 10).split("-").reverse().slice(0, 2).join("/");

export const RETENCION_LABEL: Record<string, string> = {
  retencion_ganancias: "Retención Ganancias",
  retencion_iibb: "Retención IIBB",
  retencion_iva: "Retención IVA",
  retencion_suss: "Retención SUSS",
  ajuste: "Diferencia",
};

export interface NotaInput {
  fecha: string;
  concepto: string;
  /** Con signo: positivo entra, negativo sale. */
  importe: number;
  clasificacion: ClasificacionLinea;
  subtipo?: string | null;
  /** Cuenta del otro lado (pases entre cuentas propias). */
  contraCuenta?: string | null;
  cheque?: { numero?: string | null; destino_nombre?: string | null; origen_nombre?: string | null } | null;
  /** Descripción del movimiento del CRM con el que se cruza (pagos y cobros ya cargados). */
  movimiento?: string | null;
  /** Nota que ya traía la propuesta (regla, IA, persona): se agrega al final si dice algo más. */
  nota?: string | null;
}

/** Texto literal de lo que es el renglón. Nunca vacío: si no hay regla, describe el concepto del banco. */
export function notaLiteral(x: NotaInput): string {
  const d = String(x.concepto || "");
  const m = Math.abs(Number(x.importe) || 0);
  const entra = x.importe > 0;
  let n = "";
  switch (x.clasificacion) {
    case "impuesto":
      if (x.subtipo === "ley_25413") n = `Impuesto a los débitos y créditos bancarios (Ley 25.413, impuesto al cheque) sobre ${/CREDIT/i.test(d) ? "créditos (acreditaciones)" : "débitos"}: ${pesos(m)}.`;
      else if (x.subtipo === "sircreb") {
        const f = (d.match(/SIRCREB (\d{2}\/\d{2})/i) || [])[1];
        n = `Retención de Ingresos Brutos SIRCREB sobre las acreditaciones del ${f || "día anterior"}: ${pesos(m)}. Es pago a cuenta de IIBB (se descuenta en la declaración jurada).`;
      } else if (x.subtipo === "iva") n = `IVA 21 % sobre la comisión bancaria del mismo día: ${pesos(m)} (crédito fiscal IVA).`;
      else if (/PERCEP/i.test(d)) n = `Percepción impositiva cobrada por el banco (${d.trim()}): ${pesos(m)}. Es pago a cuenta.`;
      else n = `Impuesto debitado por el banco (${d.trim()}): ${pesos(m)}.`;
      break;
    case "gasto_bancario":
      if (/ECHEQ/i.test(d)) n = `Comisión del banco por emisión de e-cheq: ${pesos(m)} (más IVA 21 % en renglón aparte).`;
      else if (/TRANSF/i.test(d)) n = `Comisión del banco por transferencia: ${pesos(m)} (más IVA 21 % en renglón aparte).`;
      else if (/MANT/i.test(d) || x.subtipo === "mantenimiento") n = `Mantenimiento mensual de la cuenta: ${pesos(m)} (más IVA 21 % en renglón aparte).`;
      else n = `Comisión o gasto del banco (${d.trim()}): ${pesos(m)}.`;
      break;
    case "intereses":
      n = /REINT/i.test(d) ? `Reintegro acreditado por el banco (${d.trim()}): ${pesos(m)}.` : `Intereses acreditados por el banco: ${pesos(m)}.`;
      break;
    case "fci":
      n = entra ? `Rescate del fondo común de inversión (FCI) acreditado en la cuenta: ${pesos(m)}.` : `Suscripción al fondo común de inversión (FCI): ${pesos(m)}.`;
      break;
    case "entre_cuentas":
      n = `Pase entre cuentas propias: ${entra ? "entra" : "sale"} ${pesos(m)}${x.contraCuenta ? ` ${entra ? "desde" : "a"} ${x.contraCuenta}` : ""}.`;
      break;
    case "tarjeta": {
      const nro = (d.match(/(?:NRO\.?|Nro:)\s*(\d{6,})/i) || [])[1];
      const marca = /VISA/i.test(d) ? "Visa" : /MASTER/i.test(d) ? "Mastercard" : /AMEX|AMERICAN/i.test(d) ? "American Express" : "";
      n = `Pago de tarjeta de crédito${marca ? ` ${marca}` : ""}${nro ? ` (cuenta ${nro})` : ""}: ${pesos(m)}.`;
      break;
    }
    case "cheque_emitido": {
      const nro = x.cheque?.numero || (d.match(/(\d{8})\s*$/) || [])[1] || "";
      n = `Cheque propio N° ${nro} debitado${x.cheque?.destino_nombre ? ` — entregado a ${x.cheque.destino_nombre}` : ""}: ${pesos(m)}.`;
      break;
    }
    case "cheque_acreditado":
      n = `Cheque de tercero acreditado${x.cheque?.numero ? ` N° ${x.cheque.numero}` : ""}${x.cheque?.origen_nombre ? ` — de ${x.cheque.origen_nombre}` : ""}: ${pesos(m)}.`;
      break;
    case "cheque_devuelto":
      n = `Cheque devuelto${x.cheque?.numero ? ` N° ${x.cheque.numero}` : ""}: ${pesos(m)}.`;
      break;
    case "pago":
      n = `Pago por transferencia: ${pesos(m)}${x.movimiento ? ` — ${String(x.movimiento).slice(0, 160)}` : ""}.`;
      break;
    case "cobro":
      n = `Cobro por transferencia: ${pesos(m)}${x.movimiento ? ` — ${String(x.movimiento).slice(0, 160)}` : ""}.`;
      break;
    case "personal":
      n = `Movimiento personal (no es de la empresa): ${entra ? "entra" : "sale"} ${pesos(m)} — ${d.trim()}.`;
      break;
    default:
      n = `${entra ? "Entra" : "Sale"} ${pesos(m)} — ${d.trim()}.`;
  }
  const extra = String(x.nota || "").trim();
  if (extra && !n.toLowerCase().includes(extra.toLowerCase())) n += ` ${extra}`;
  return n;
}

export interface RetencionNota { tipo: string; monto: number; certificado?: string | null; descripcion?: string | null }

/** Nota literal de un cobro completo: bruto − cada retención = neto acreditado. */
export function notaCobro(x: {
  cliente: string;
  facturas: string;
  neto: number;
  retenciones: RetencionNota[];
  referencia?: string | null;
  sistemaAnterior?: boolean;
  tipoCambio?: number | null;
}): string {
  const ret = x.retenciones.filter((r) => Number(r.monto) > 0);
  const bruto = r2(x.neto + ret.reduce((s, r) => s + Number(r.monto), 0));
  const partes = ret.map((r) => ` − ${RETENCION_LABEL[r.tipo] || r.tipo} ${pesos(r.monto)}${r.certificado ? ` (certificado ${r.certificado})` : ""}`).join("");
  return [
    `Cobro${x.sistemaAnterior ? " de factura del sistema anterior" : ""} — ${x.cliente} — ${x.facturas}`,
    ret.length ? `bruto ${pesos(bruto)}${partes} = neto acreditado ${pesos(x.neto)}` : `${pesos(x.neto)} sin retenciones`,
    x.tipoCambio ? `TC ${x.tipoCambio.toLocaleString("es-AR")}` : "",
    x.referencia || "",
  ].filter(Boolean).join(" — ");
}

export interface CobroAnteriorInput {
  linea: { fecha: string; importe: number };
  cliente: { id: string; nombre: string };
  /** Texto libre con las facturas del sistema anterior, ej. "FA A 0009-00000382 + FA A 0009-00000388". */
  facturas: string;
  bruto: number;
  retenciones: RetencionNota[];
  referencia?: string | null;
}

export interface CobroAnteriorArmado {
  /** Diferencia entre bruto − retenciones y lo que entró al banco (0 = exacto). */
  diferencia: number;
  neto: number;
  nota: string;
  /** Movimientos a insertar: primero la transferencia (la que se cruza con el banco), después una por retención. */
  movimientos: { tipo: string; monto: number; descripcion: string }[];
  errores: string[];
}

/** Cobro de facturas que no están en el CRM (sistema anterior): movimiento sin factura (no toca la cuenta corriente). */
export function armarCobroSistemaAnterior(x: CobroAnteriorInput): CobroAnteriorArmado {
  const errores: string[] = [];
  const ret = x.retenciones.filter((r) => Number(r.monto) > 0).map((r) => ({ ...r, monto: r2(Number(r.monto)) }));
  const neto = r2(Math.abs(x.linea.importe));
  const diferencia = r2(r2(x.bruto) - ret.reduce((s, r) => s + r.monto, 0) - neto);
  if (x.linea.importe <= 0) errores.push("El renglón no es una entrada de plata.");
  if (!x.cliente?.id) errores.push("Elegí el cliente.");
  if (!x.facturas.trim()) errores.push("Escribí qué facturas paga.");
  if (!(x.bruto > 0)) errores.push("Falta el importe bruto de las facturas.");
  for (const r of ret) if (!RETENCION_LABEL[r.tipo] || r.tipo === "ajuste") errores.push(`Tipo de retención inválido: ${r.tipo}`);
  const ref = [x.referencia?.trim(), `banco ${ddmm(x.linea.fecha)}`].filter(Boolean).join(" — ");
  const nota = notaCobro({ cliente: x.cliente?.nombre || "", facturas: x.facturas.trim(), neto, retenciones: ret, referencia: ref, sistemaAnterior: true })
    + (Math.abs(diferencia) >= 0.01 ? ` — ⚠️ no cierra por ${pesos(diferencia)}` : "");
  const sufijo = `${x.cliente?.nombre || ""} — ${x.facturas.trim()} (sistema anterior)${x.referencia?.trim() ? ` — ${x.referencia.trim()}` : ""}`;
  return {
    diferencia, neto, nota, errores,
    movimientos: [
      { tipo: "transferencia", monto: neto, descripcion: `Cobro — ${sufijo}` },
      ...ret.map((r) => ({ tipo: r.tipo, monto: r.monto, descripcion: `${RETENCION_LABEL[r.tipo]}${r.certificado ? ` — certificado ${r.certificado}` : ""} — ${sufijo}` })),
    ],
  };
}
