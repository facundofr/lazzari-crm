// Bandeja "Para confirmar" (Finanzas con IA, Etapa A — docs/FINANZAS-IA.md). Lógica pura, sin red ni base.
// Toma las líneas del banco sin cerrar y deja armado qué es cada una, para confirmar con un clic:
//  - lo que ya cruza solo (cruzarExtracto: impuestos, comisiones, cheques, FCI, entre cuentas, cobros/pagos ya cargados),
//  - cobros nuevos armados completos (mail de aviso de pago o suma exacta de facturas abiertas del cliente),
//  - pagos de gastos ya cargados sin pago (ej. sueldos de octubre),
//  - pagos a proveedores identificados por CUIT (quedan "a cargar" con el proveedor anotado),
//  - lo demás, con la sugerencia de la IA (si la hay) o "sin resolver".
// Nunca traba: todo es sugerencia; si algo no cierra, se avisa en el renglón.
// Prueba: scripts/test-finanzas-propuestas.ts (npx tsx scripts/test-finanzas-propuestas.ts)
import {
  cruzarExtracto, normalizarLinea, CLASIFICACION_LABEL, SUBTIPO_LABEL,
  type ClasificacionLinea, type LineaCruce, type MovCruce, type ChequeCruce, type CuentaCruce, type ReglaCruce, type Propuesta,
} from "./extracto-bbva";
import { cruzarPago, mismoCliente, etiquetaFactura, type FacturaAbierta, type PagoExtraido } from "./agente-mail";
import { familiaDeCodigo } from "./bbva-codigos";
import { esNotaCredito } from "./reportes-comprobantes";

export type Confianza = "alta" | "media" | "baja";
export type TipoItem = "cruce" | "cobro_nuevo" | "pago_gasto" | "pago_proveedor" | "a_cargar" | "sin_resolver";

export interface FacturaBandeja extends FacturaAbierta { fecha: string }
export interface Tercero { id: string; razon_social: string | null; cuit: string | null }
export interface PagoMail { id: string; fecha_mail: string | null; asunto: string | null; pago: PagoExtraido & { retenciones?: { tipo?: string | null; monto?: number | null }[] | null; referencia?: string | null } }
export interface GastoSinPago { id: string; fecha: string; descripcion: string; monto: number; moneda: string; proveedor_cuit: string | null }
export interface SugerenciaIA { clasificacion: ClasificacionLinea | null; subtipo?: string | null; nota?: string | null; confianza?: Confianza | null; explicacion?: string | null }

export interface CobroArmado {
  cliente_id: string;
  cliente_nombre: string;
  facturas: { id: string; numero: string; fecha: string; saldo: number; moneda: string }[];
  /** Tipos de movimiento de la base: retencion_iva, retencion_ganancias, retencion_iibb, retencion_suss, ajuste. */
  retenciones: { tipo: string; monto: number; descripcion: string }[];
  neto: number;
  /** Solo si las facturas son en dólares: pesos por dólar con que se cancelan. */
  tipo_cambio: number | null;
  referencia: string | null;
  mail_id: string | null;
}

export interface ItemBandeja {
  linea_id: string;
  fecha: string;
  concepto: string;
  importe: number;
  cuenta_id: string | null;
  tipo: TipoItem;
  confianza: Confianza;
  origen: "extracto" | "regla" | "mail" | "ia" | "facturas" | "gastos" | "cuit";
  /** Una línea legible: "Impuesto al cheque (Ley 25.413)", "Cobro de Corteva → 5 facturas". */
  titulo: string;
  detalle: string[];
  avisos: string[];
  /** Para aplicar_cruces_extracto (tipo cruce y a_cargar). */
  cruce?: { clasificacion: ClasificacionLinea; subtipo?: string | null; movimiento_id?: string | null; cheque_id?: string | null; contra_cuenta_id?: string | null; nota?: string | null };
  cobro?: CobroArmado;
  /** Cobro armado solo por una SUPOSICIÓN (la suma de unas facturas coincide) y sin evidencia del que pagó: nunca entra en las confirmaciones en bloque y pide una confirmación aparte. */
  debil?: boolean;
  gasto?: { id: string; descripcion: string };
  /** Débito automático de un gasto fijo (luz, Flow, ARBA…): al confirmar se carga el gasto del mes y se paga con la línea. */
  gastoFijo?: { id: string; descripcion: string; categoria: string };
  /** Pago a un proveedor de una factura de ARCA que no está cargada en Compras: al confirmar se carga el pago y se cruza. */
  pagoProveedor?: { proveedor_id: string | null; proveedor_nombre: string; factura: NonNullable<LineaCruce["factura_arca"]> };
  /** Clasificación que se puede recordar como regla al confirmar. */
  regla?: { texto: string; clasificacion: ClasificacionLinea; subtipo?: string | null; contra_cuenta_id?: string | null };
  /** Cheques posibles para una línea de cheque (depósito, débito o rechazo) que no se confirma sola: la persona elige uno. */
  opcionesCheque?: { id: string; texto: string }[];
  /** Pago a ARCA (137): VEP ya cargados en Gastos por el mismo importe y sin banco. La persona elige uno y la línea queda atada a su pago (arreglo 18). */
  opcionesGasto?: { id: string; movimiento_id: string; descripcion: string; texto: string }[];
  /**
   * Rechazo (019) de un cheque de papel recibido que el CRM no tiene rechazado: se rechaza desde la línea con el tilde «Entendido» (arreglo 21).
   * `conCobro`: tiene un cobro cargado en el CRM, que se anula (la factura vuelve a deber).
   */
  rechazarCheque?: { id: string; numero: string; monto: number; cliente: string | null; conCobro: boolean };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** CUIT de Augusto Lazzari y de Grupo LA. */
export const CUITS_PROPIOS = ["20379309128", "30719396042"];
const cent = (n: number) => Math.round(n * 100);
const soloDigitos = (s: string | null | undefined) => String(s || "").replace(/\D/g, "");
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86400000);
const fmt = (n: number) => `$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** CUIT de 11 dígitos (20/23/24/27/30/33/34) dentro del concepto. */
export function cuitEnTexto(texto: string): string | null {
  const m = String(texto || "").match(/\b((?:20|23|24|27|30|33|34)\d{9})\b/);
  return m ? m[1] : null;
}

/** El nombre del banco viene cortado ("SANITARIOS SAN MA"): ¿es el comienzo de esta razón social? Palabras completas y la última puede ser un prefijo. */
export function nombreEsComienzoDe(texto: string, razonSocial: string | null | undefined): boolean {
  const pal = (x: string) => String(x || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const A = pal(texto), B = pal(razonSocial || "");
  if (A.length < 2 || B.length < A.length) return false;
  for (let i = 0; i < A.length - 1; i++) if (A[i] !== B[i]) return false;
  return B[A.length - 1].startsWith(A[A.length - 1]);
}

/** Nombre que trae el detalle del Excel "Movimientos" ("TRANSFERENCIA · CTE 007875 285-… FUNDACION CARGI"). */
export function nombreEnTexto(texto: string): string {
  const det = String(texto || "").split("·").slice(1).join(" ");
  return det.replace(/[\d\-/.:]+/g, " ").replace(/\b(CTE|CTA|CBU|CUIT|NRO|TRANSF|TRANSFERENCIA|VAR|VARIOS)\b/gi, " ").replace(/\s+/g, " ").trim();
}

const GENERICOS = /^(TRANSFERENCIA|TRANSFERENCIA INMEDIATA|TRANSF\.? INM COE|DEBITO DIRECTO|PAGO A PROVEEDORES OP\.?|GESTION PAGO|TRANSF\.? CLIENTE CTA\.?.*|TRANSFERENCIA CAP|COBRO DE PROVEEDORES CR MIN|DEPOSITO .*|PAGO DE SERVICIOS TARJETA.*)$/i;

/**
 * Texto para la regla "Recordar". Si el concepto trae un CUIT, la regla es el CUIT (identifica a la persona o empresa).
 * Si es un concepto genérico ("TRANSFERENCIA", "DEBITO DIRECTO"), no se arma regla: agarraría cualquier cosa.
 */
export function textoParaRegla(concepto: string): string | null {
  const cuit = cuitEnTexto(concepto);
  if (cuit) return cuit;
  const t = String(concepto || "").split("·")[0].replace(/\d[\d/.:]*/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 6 || GENERICOS.test(t)) return null;
  return t;
}

const TIPO_RETENCION: Record<string, string> = { iva: "retencion_iva", ganancias: "retencion_ganancias", iibb: "retencion_iibb", suss: "retencion_suss" };
const LABEL_RETENCION: Record<string, string> = {
  retencion_iva: "Retención de IVA", retencion_ganancias: "Retención de Ganancias", retencion_iibb: "Retención de IIBB", retencion_suss: "Retención SUSS", ajuste: "Otra retención",
};

export function etiquetaClasificacion(c: ClasificacionLinea | null | undefined, subtipo?: string | null): string {
  if (!c) return "Sin clasificar";
  return (subtipo && SUBTIPO_LABEL[subtipo]) || CLASIFICACION_LABEL[c] || c;
}

/** Arma el cobro completo a partir del cruce del aviso (o de la suma exacta) contra las facturas abiertas. */
function armarCobro(
  facturasElegidas: FacturaBandeja[], neto: number, totalAviso: number | null, retencionesAviso: { tipo?: string | null; monto?: number | null }[],
  referencia: string | null, mailId: string | null,
): { cobro: CobroArmado; avisos: string[] } | null {
  if (!facturasElegidas.length) return null;
  const clienteIds = [...new Set(facturasElegidas.map((f) => f.cliente_id).filter(Boolean))] as string[];
  if (clienteIds.length !== 1) return null;
  const avisos: string[] = [];
  const monedas = [...new Set(facturasElegidas.map((f) => f.moneda || "ARS"))];
  if (monedas.length > 1) return null;
  const usd = monedas[0] === "USD";

  let retenciones = (retencionesAviso || [])
    .filter((r) => Number(r.monto) > 0)
    .map((r) => {
      const tipo = TIPO_RETENCION[String(r.tipo || "").toLowerCase()] || "ajuste";
      return { tipo, monto: r2(Number(r.monto)), descripcion: LABEL_RETENCION[tipo] };
    });
  const totalRet = r2(retenciones.reduce((s, r) => s + r.monto, 0));
  const total = r2(neto + totalRet);
  if (totalAviso && Math.abs(totalAviso - total) > 0.05) {
    const dif = r2(totalAviso - total);
    if (dif > 0) {
      retenciones = [...retenciones, { tipo: "ajuste", monto: dif, descripcion: "Retención sin detalle en el aviso" }];
      avisos.push(`${mailId ? "El aviso paga" : "Las facturas suman"} ${fmt(totalAviso)} y llegan ${fmt(neto)}: ${fmt(dif)} quedan como retención sin detalle (cargá el certificado).`);
    }
  }
  const totalFinal = r2(neto + retenciones.reduce((s, r) => s + r.monto, 0));
  let tipo_cambio: number | null = null;
  if (usd) {
    const saldoUsd = facturasElegidas.reduce((s, f) => s + f.saldo, 0);
    if (saldoUsd <= 0) return null;
    tipo_cambio = r2(totalFinal / saldoUsd);
    const ref = facturasElegidas[0].tipo_cambio;
    avisos.push(`Facturas en dólares: se cancelan a $ ${tipo_cambio.toLocaleString("es-AR")} por dólar${ref ? ` (la factura se hizo a ${ref.toLocaleString("es-AR")})` : ""}.`);
    if (tipo_cambio < 300 || tipo_cambio > 5000) return null;
  } else {
    const saldo = r2(facturasElegidas.reduce((s, f) => s + f.saldo, 0));
    if (cent(saldo) !== cent(totalFinal)) {
      avisos.push(totalFinal < saldo
        ? `Las facturas deben ${fmt(saldo)} y se cancelan ${fmt(totalFinal)}: queda saldo ${fmt(saldo - totalFinal)} en la más nueva.`
        : `Pagó ${fmt(totalFinal - saldo)} de más: queda a favor del cliente.`);
    }
  }
  const f0 = facturasElegidas[0];
  return {
    cobro: {
      cliente_id: clienteIds[0],
      cliente_nombre: f0.cliente_nombre || "Cliente",
      facturas: facturasElegidas.map((f) => ({ id: f.id, numero: etiquetaFactura(f), fecha: f.fecha, saldo: f.saldo, moneda: f.moneda || "ARS" })),
      retenciones, neto: r2(neto), tipo_cambio, referencia, mail_id: mailId,
    },
    avisos,
  };
}

/** Subconjunto de facturas (hasta 12) cuyo saldo suma exacto el objetivo. Si hay más de una forma, null (que decida una persona). */
function sumaExactaUnica(fs: FacturaBandeja[], objetivo: number): FacturaBandeja[] | null {
  const lista = fs.slice(0, 12);
  let encontrada: FacturaBandeja[] | null = null;
  for (let mask = 1; mask < 1 << lista.length; mask++) {
    let s = 0;
    for (let i = 0; i < lista.length; i++) if (mask & (1 << i)) s += cent(lista[i].saldo);
    if (s === cent(objetivo)) {
      if (encontrada) return null;
      encontrada = lista.filter((_, i) => mask & (1 << i));
    }
  }
  return encontrada;
}

/**
 * Cobro con retenciones sin aviso: facturas en pesos de un mismo cliente (hasta 8 por cliente) cuya suma S cumple
 * importe < S ≤ importe / 0,94 (retenciones de hasta 6 %). Si hay más de una opción en total, null (decide una persona).
 */
function combinacionConRetenciones(fs: FacturaBandeja[], importe: number): FacturaBandeja[] | null {
  const porCliente = new Map<string, FacturaBandeja[]>();
  for (const f of fs) if (f.cliente_id) porCliente.set(f.cliente_id, [...(porCliente.get(f.cliente_id) || []), f]);
  let unica: FacturaBandeja[] | null = null;
  const tope = cent(importe / 0.94);
  for (const lista of porCliente.values()) {
    const xs = lista.slice(0, 8);
    for (let mask = 1; mask < 1 << xs.length; mask++) {
      let s = 0;
      for (let i = 0; i < xs.length; i++) if (mask & (1 << i)) s += cent(xs[i].saldo);
      if (s > cent(importe) && s <= tope) {
        if (unica) return null;
        unica = xs.filter((_, i) => mask & (1 << i));
      }
    }
  }
  return unica;
}

export interface DatosBandeja {
  lineas: LineaCruce[];
  movimientos: MovCruce[];
  cheques: ChequeCruce[];
  cuentas: CuentaCruce[];
  reglas: ReglaCruce[];
  chequesUsados: Set<string>;
  facturas: FacturaBandeja[];
  clientes: Tercero[];
  proveedores: Tercero[];
  pagosMail: PagoMail[];
  gastos: GastoSinPago[];
  ia: Map<string, SugerenciaIA>;
  descartadas: Set<string>;
  /** Gastos fijos que se pagan por débito automático, con las referencias que aparecen en el banco (n° de cliente, factura, plan…). */
  gastosFijosDebito?: { id: string; descripcion: string; categoria: string; referencias: string[] }[];
  /** Facturas de compra cargadas (para no proponer pagar por ARCA una que ya está en Compras). */
  facturasCompra?: { proveedor_id: string | null; punto_venta: number; numero: number; estado: string }[];
  /**
   * Finanzas simple (Augusto 26/10/2026): "lo que quiero que tomes del extracto es todo menos los cobros a clientes y pagos a proveedores".
   * Las transferencias no aparecen (no se proponen ni se cruzan), sin IA, sin cobros armados ni pagos por monto. Lo demás sigue igual.
   */
  sinCruces?: boolean;
  /** Gastos del mes atados a un gasto fijo cuyo pago todavía no está cruzado con el banco (débito automático sin duplicar). */
  gastosDeFijos?: { id: string; gasto_fijo_id: string; fecha: string; descripcion: string; monto: number }[];
  /** Gastos de Impuestos (VEP) en pesos con su pago todavía sin cruzar con el banco: la línea 137 se ata a uno de estos (arreglo 18). */
  gastosVep?: { id: string; fecha: string; descripcion: string; monto: number; movimiento_id: string }[];
}

/** Transferencia (cobro o pago de terceros) según el código del banco; las líneas viejas sin código, por el texto. */
export function esTransferencia(l: { concepto: string; codigo?: string | null }): boolean {
  const fc = familiaDeCodigo(l.codigo || null);
  if (fc) return fc === "transferencia";
  return /TRANSF|PAGO A PROVEEDORES|COBRO DE PROVEEDORES/i.test(l.concepto);
}

const mesLargo = (fecha: string) => new Date(`${fecha.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Arreglo 18 (auditoría de Impuestos, 27/10/2026): VEP cargados en Gastos que pueden ser este pago a ARCA.
 * Mismo importe exacto y hasta 15 días antes o después; el más cercano primero. No se reservan: si dos líneas pueden ser el mismo VEP,
 * se ofrece en las dos y la base no deja atarlo dos veces.
 */
function vepsDeLinea(l: LineaCruce, veps: NonNullable<DatosBandeja["gastosVep"]>): NonNullable<ItemBandeja["opcionesGasto"]> {
  const dias = (g: { fecha: string }) => Math.abs(diasEntre(g.fecha, l.fecha));
  return veps.filter((g) => cent(g.monto) === cent(-l.importe) && dias(g) <= 15)
    .sort((a, b) => dias(a) - dias(b))
    .map((g) => ({ id: g.id, movimiento_id: g.movimiento_id, descripcion: g.descripcion, texto: `${g.descripcion} · ${g.fecha.slice(0, 10).split("-").reverse().join("/")}` }));
}

/**
 * Finanzas simple: qué hacer con una línea (null = es una transferencia y no se muestra).
 * Reglas fijas del banco seguras → alta (bloque). Sugerencias fijas (137, tarjeta o FCI sin identificar, entre cuentas) → media ("Sí, es eso");
 * el 137 con su VEP ya cargado en Gastos → «Es el VEP …». Cheques que no cierran solos → para vos, con los cheques posibles;
 * el rechazo de un cheque de papel → «Rechazar este cheque». Débitos automáticos → pagan el gasto del mes ya cargado, sin cargar otro.
 */
function itemSinCruces(
  l: LineaCruce & { codigo: string | null }, p: Propuesta | undefined, d: DatosBandeja, gastosUsados: Set<string>,
  nombreCuenta: (id: string | null | undefined) => string | null,
): ItemBandeja | null {
  const base = { linea_id: l.id, fecha: l.fecha, concepto: l.concepto, importe: l.importe, cuenta_id: l.cuenta_id, detalle: [] as string[], avisos: [] as string[] };
  const esCobroPago = p?.clasificacion === "cobro" || p?.clasificacion === "pago";
  const otra = nombreCuenta(p?.contra_cuenta_id);
  if (p?.auto && p.clasificacion && !esCobroPago) {
    return {
      ...base, tipo: "cruce", confianza: "alta", origen: p.motivo.startsWith("Regla") ? "regla" : "extracto",
      titulo: `${etiquetaClasificacion(p.clasificacion, p.subtipo)}${otra ? ` → ${otra}` : ""}`,
      detalle: [p.motivo], avisos: p.nota ? [p.nota] : [],
      cruce: { clasificacion: p.clasificacion, subtipo: p.subtipo, cheque_id: p.cheque_id, contra_cuenta_id: p.contra_cuenta_id, nota: p.nota },
    };
  }
  if (p?.clasificacion && ["cheque_emitido", "cheque_acreditado", "cheque_devuelto"].includes(p.clasificacion)) {
    const chPorId = new Map(d.cheques.map((c) => [c.id, c]));
    // Arreglo 21 (27/10/2026): el cheque de papel nunca viene en los reportes de eCheq. Su rechazo se hace desde la línea («Rechazar este cheque»),
    // en lugar de «Es el N° …», que ataba la línea sin rechazarlo. Lo informa el banco: respeta la regla de que los cheques los mueve el banco.
    const papel = p.clasificacion === "cheque_devuelto" && p.subtipo === "recibido" && p.cheque_id ? chPorId.get(p.cheque_id) : undefined;
    if (papel?.tipo_cheque === "fisico") {
      return {
        ...base, tipo: "sin_resolver", confianza: "baja", origen: "extracto", titulo: etiquetaClasificacion(p.clasificacion, p.subtipo),
        detalle: [p.motivo], avisos: p.nota ? [p.nota] : [],
        cruce: { clasificacion: p.clasificacion, subtipo: p.subtipo, cheque_id: papel.id },
        rechazarCheque: { id: papel.id, numero: papel.numero, monto: Number(papel.monto), cliente: papel.origen_nombre || null, conCobro: Boolean(papel.movimiento_id) },
      };
    }
    const ids = [...new Set([p.cheque_id, ...p.candidatos].filter(Boolean) as string[])];
    const opciones = ids.flatMap((id) => {
      const c = chPorId.get(id);
      if (!c) return [];
      const pago = c.fecha_pago ? ` · pago ${String(c.fecha_pago).slice(0, 10).split("-").reverse().join("/")}` : "";
      return [{ id: c.id, texto: `N° ${c.numero} · ${fmt(Number(c.monto))}${pago} · ${c.estado}` }];
    });
    return {
      ...base, tipo: "sin_resolver", confianza: "baja", origen: "extracto", titulo: etiquetaClasificacion(p.clasificacion, p.subtipo),
      detalle: [p.motivo], avisos: p.nota ? [p.nota] : [],
      ...(opciones.length ? { opcionesCheque: opciones, cruce: { clasificacion: p.clasificacion, subtipo: p.subtipo || null } } : {}),
    };
  }
  if (p?.clasificacion && !esCobroPago) {
    // Pago a ARCA (137): si el VEP ya está en Gastos, se cierra con «Es el VEP …» y queda atado a su pago (como el débito automático con su fijo).
    const veps = p.clasificacion === "impuesto" && p.subtipo === "afip" && l.importe < 0 ? vepsDeLinea(l, d.gastosVep || []) : null;
    return {
      ...base, tipo: "cruce", confianza: "media", origen: "extracto",
      titulo: `¿${etiquetaClasificacion(p.clasificacion, p.subtipo)}${otra ? ` → ${otra}` : ""}?`,
      detalle: [p.motivo, ...(!veps ? [] : veps.length
        ? ["En Gastos hay un VEP por el mismo importe sin banco: tocá «Es el VEP …» y el gasto queda «✓ banco»."]
        : ["Si es un VEP, cargalo en Gastos (Leer VEP) con este monto y vuelve a aparecer acá para atarlo."])],
      avisos: [],
      cruce: { clasificacion: p.clasificacion, subtipo: p.subtipo, contra_cuenta_id: p.contra_cuenta_id, nota: p.nota },
      ...(veps?.length ? { opcionesGasto: veps } : {}),
    };
  }
  if (esTransferencia(l)) return null;
  const credito = l.importe > 0;
  if (!credito) {
    const texto = String(l.concepto || "").toUpperCase();
    const fijo = (d.gastosFijosDebito || []).find((g) => g.referencias.some((r) => texto.includes(r)));
    if (fijo) {
      const g = (d.gastosDeFijos || []).find((x) => x.gasto_fijo_id === fijo.id && x.fecha.slice(0, 7) === l.fecha.slice(0, 7) && !gastosUsados.has(x.id));
      if (g) {
        gastosUsados.add(g.id);
        return {
          ...base, tipo: "pago_gasto", confianza: "media", origen: "gastos", titulo: `Débito automático: ${g.descripcion}`,
          detalle: [`Paga el gasto de ${mesLargo(l.fecha)} que ya está cargado (${fmt(g.monto)}); no se carga otro`],
          avisos: cent(g.monto) !== cent(-l.importe) ? [`El gasto dice ${fmt(g.monto)} y el banco debitó ${fmt(l.importe)}: corregí el monto en Gastos si hace falta.`] : [],
          gasto: { id: g.id, descripcion: g.descripcion },
        };
      }
      return {
        ...base, tipo: "sin_resolver", confianza: "baja", origen: "gastos", titulo: `Débito automático: ${fijo.descripcion}`,
        detalle: [`El gasto de ${mesLargo(l.fecha)} no está cargado (o ya está pagado). Cargalo en Finanzas > Gastos y vuelve a aparecer acá para confirmarlo.`], avisos: [],
      };
    }
  }
  return {
    ...base, tipo: "sin_resolver", confianza: "baja", origen: "extracto",
    titulo: credito ? "Entrada sin identificar" : "Salida sin identificar", detalle: [p?.motivo || "Ninguna regla la reconoce"], avisos: [],
  };
}

/** Referencias de un gasto fijo para reconocer su débito automático: tiras de 6+ caracteres con dígitos. */
export function referenciasGastoFijo(texto: string): string[] {
  return [...new Set((String(texto || "").toUpperCase().match(/[A-Z0-9]*\d[A-Z0-9]*/g) || []).filter((t) => t.length >= 6 && /\d{4}/.test(t)))];
}

/** Gastos fijos de débito automático con sus referencias propias (las que comparten dos gastos no sirven para distinguirlos). */
export function gastosFijosParaDebito(fijos: { id: string; descripcion: string; categoria: string; notas?: string | null }[]) {
  const conRefs = fijos.map((g) => ({ id: g.id, descripcion: g.descripcion, categoria: g.categoria, referencias: referenciasGastoFijo(`${g.descripcion} ${g.notas || ""}`) }));
  const cuenta = new Map<string, number>();
  for (const g of conRefs) for (const r of g.referencias) cuenta.set(r, (cuenta.get(r) || 0) + 1);
  return conRefs.map((g) => ({ ...g, referencias: g.referencias.filter((r) => cuenta.get(r) === 1) })).filter((g) => g.referencias.length);
}

export function armarBandeja(d: DatosBandeja): ItemBandeja[] {
  const lineas = d.lineas.filter((l) => !d.descartadas.has(l.id)).map(normalizarLinea);
  const propuestas = cruzarExtracto(lineas, d.movimientos, d.cheques, d.cuentas, d.reglas, d.chequesUsados);
  const porLinea = new Map(propuestas.map((p) => [p.linea_id, p]));
  const cuentaPorId = new Map(d.cuentas.map((c) => [c.id, c]));
  const movPorId = new Map(d.movimientos.map((m) => [m.id, m]));
  // Las notas de crédito son a favor del cliente: nunca se proponen como algo a cobrar (25/10: armaba el cobro de la NCA 15-7 de Corteva).
  const abiertas = d.facturas.filter((f) => f.saldo >= 1 && f.estado !== "pagada" && !esNotaCredito(f.tipo));
  // Los CUIT propios (Augusto y Grupo LA) nunca son proveedor ni cliente: son pases entre cuentas propias o plata personal.
  const propio = (c: string | null | undefined) => CUITS_PROPIOS.includes(soloDigitos(c));
  const cliPorCuit = new Map(d.clientes.filter((c) => soloDigitos(c.cuit).length === 11 && !propio(c.cuit)).map((c) => [soloDigitos(c.cuit), c]));
  const provPorCuit = new Map(d.proveedores.filter((p) => soloDigitos(p.cuit).length === 11 && !propio(p.cuit)).map((p) => [soloDigitos(p.cuit), p]));
  const mailsUsados = new Set<string>();
  const facturasUsadas = new Set<string>();
  const gastosUsados = new Set<string>();
  const out: ItemBandeja[] = [];

  // Para cada movimiento que es candidato único de varias líneas: la línea de fecha más cercana.
  const movsUsados = new Set<string>();
  const movCandidato = new Map<string, string>();
  for (const l of lineas) {
    const p = porLinea.get(l.id);
    if (!p || p.auto || p.candidatos.length !== 1) continue;
    const m = movPorId.get(p.candidatos[0]);
    if (!m) continue;
    const actual = movCandidato.get(m.id);
    const dist = (id: string) => Math.abs(diasEntre(String(m.fecha), lineas.find((x) => x.id === id)!.fecha));
    if (!actual || dist(l.id) < dist(actual)) movCandidato.set(m.id, l.id);
  }

  const base = (l: LineaCruce) => ({ linea_id: l.id, fecha: l.fecha, concepto: l.concepto, importe: l.importe, cuenta_id: l.cuenta_id, detalle: [] as string[], avisos: [] as string[] });

  if (d.sinCruces) {
    const nombreCuenta = (id: string | null | undefined) => (id ? cuentaPorId.get(id)?.nombre || null : null);
    for (const l of [...lineas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      const it = itemSinCruces(l, porLinea.get(l.id), d, gastosUsados, nombreCuenta);
      if (it) out.push(it);
    }
    const pesoS: Record<Confianza, number> = { alta: 0, media: 1, baja: 2 };
    return out.sort((a, b) => pesoS[a.confianza] - pesoS[b.confianza] || b.fecha.localeCompare(a.fecha) || Math.abs(b.importe) - Math.abs(a.importe));
  }

  // Las automáticas primero: así sus movimientos y cheques no se ofrecen a otras líneas.
  const orden = [...lineas].sort((a, b) => Number(Boolean(porLinea.get(b.id)?.auto)) - Number(Boolean(porLinea.get(a.id)?.auto)) || a.fecha.localeCompare(b.fecha));

  for (const l of orden) {
    const p: Propuesta | undefined = porLinea.get(l.id);
    const credito = l.importe > 0;
    // Ya confirmada como cobro/pago "a cargar": solo vuelve a la bandeja si ahora se puede cerrar (movimiento o cobro armado).
    const yaMarcada = l.clasificacion === "cobro" || l.clasificacion === "pago";

    // 1) Lo que ya cruza solo.
    if (p?.auto && p.clasificacion) {
      const mov = p.movimiento_id ? movPorId.get(p.movimiento_id) : undefined;
      const otra = p.contra_cuenta_id ? cuentaPorId.get(p.contra_cuenta_id)?.nombre : null;
      out.push({
        ...base(l), tipo: "cruce", confianza: "alta", origen: p.motivo.startsWith("Regla") ? "regla" : "extracto",
        titulo: `${etiquetaClasificacion(p.clasificacion, p.subtipo)}${otra ? ` → ${otra}` : ""}${mov ? ` → ${mov.descripcion || mov.tipo}` : ""}`,
        detalle: [p.motivo], avisos: p.nota ? [p.nota] : [],
        cruce: { clasificacion: p.clasificacion, subtipo: p.subtipo, movimiento_id: p.movimiento_id, cheque_id: p.cheque_id, contra_cuenta_id: p.contra_cuenta_id, nota: p.nota },
      });
      continue;
    }

    // 2) Cobro o pago ya cargado en el CRM con un solo candidato: cruce de confianza media.
    //    Cada movimiento se ofrece a una sola línea (la de fecha más cercana) y, si la línea trae CUIT, tiene que ser el mismo.
    if (p && (p.clasificacion === "cobro" || p.clasificacion === "pago") && p.candidatos.length === 1) {
      const mov = movPorId.get(p.candidatos[0]);
      const cuitLinea = cuitEnTexto(l.concepto);
      const cuitOk = !cuitLinea || !mov?.cuit || soloDigitos(mov.cuit) === cuitLinea;
      const masCerca = mov ? movCandidato.get(mov.id) === l.id : false;
      if (mov && cuitOk && masCerca && !movsUsados.has(mov.id)) {
        movsUsados.add(mov.id);
        out.push({
          ...base(l), tipo: "cruce", confianza: "media", origen: "extracto",
          titulo: `${credito ? "Cobro" : "Pago"} ya cargado → ${mov.descripcion || mov.tipo}`,
          detalle: [`Mismo importe, ${Math.abs(diasEntre(String(mov.fecha), l.fecha))} días de diferencia`],
          avisos: [], cruce: { clasificacion: p.clasificacion, movimiento_id: mov.id },
        });
        continue;
      }
    }

    // 3) Cheques (propios, depositados, devueltos) que no cruzan solos: los resuelve una persona con los candidatos.
    if (p && p.clasificacion && ["cheque_emitido", "cheque_acreditado", "cheque_devuelto"].includes(p.clasificacion)) {
      out.push({ ...base(l), tipo: "sin_resolver", confianza: "baja", origen: "extracto", titulo: etiquetaClasificacion(p.clasificacion), detalle: [p.motivo], avisos: [] });
      continue;
    }

    if (credito) {
      // 4) Cobro con aviso de pago por mail: neto exacto y fecha cercana.
      const mail = d.pagosMail.find((m) => !mailsUsados.has(m.id) && m.pago?.direccion !== "emitido"
        && m.pago?.monto_neto && cent(Number(m.pago.monto_neto)) === cent(l.importe)
        && Math.abs(diasEntre(String(m.pago.fecha_pago || m.fecha_mail || l.fecha), l.fecha)) <= 7);
      if (mail) {
        const cruce = cruzarPago(mail.pago, d.facturas, []);
        const elegidas = cruce.facturas.filter((f) => !f.cobrada && !facturasUsadas.has(f.id))
          .map((f) => d.facturas.find((x) => x.id === f.id)).filter(Boolean) as FacturaBandeja[];
        const armado = armarCobro(elegidas, l.importe, mail.pago.monto_total ?? null, mail.pago.retenciones || [], mail.pago.referencia || null, mail.id);
        if (armado) {
          mailsUsados.add(mail.id);
          armado.cobro.facturas.forEach((f) => facturasUsadas.add(f.id));
          const ret = armado.cobro.retenciones.reduce((s, r) => s + r.monto, 0);
          out.push({
            ...base(l), tipo: "cobro_nuevo", confianza: armado.avisos.some((a) => /saldo|de más|sin detalle/.test(a)) ? "media" : "alta", origen: "mail",
            titulo: `Cobro de ${armado.cobro.cliente_nombre} → ${armado.cobro.facturas.length} factura${armado.cobro.facturas.length > 1 ? "s" : ""}`,
            detalle: [
              armado.cobro.facturas.map((f) => f.numero).join(", "),
              ret > 0 ? `Retenciones ${fmt(ret)} (${armado.cobro.retenciones.map((r) => `${r.descripcion} ${fmt(r.monto)}`).join(", ")})` : "Sin retenciones",
              `Aviso por mail: ${mail.asunto || "pago"}`,
              ...cruce.notas.filter((n) => !/entrada|extracto/i.test(n)),
            ],
            avisos: armado.avisos, cobro: armado.cobro,
          });
          continue;
        }
      }

      // 5) Cobro sin mail: cliente por CUIT o nombre del concepto, o suma exacta única entre todas las facturas abiertas.
      const cuit = cuitEnTexto(l.concepto);
      const nombre = nombreEnTexto(l.concepto);
      const cliente = (cuit && cliPorCuit.get(cuit)) || (nombre ? d.clientes.find((c) => mismoCliente(c.razon_social, nombre)) : undefined);
      // Empresas que son cliente Y proveedor (ej. Prisina, Augusto 23/10): entre ellas no hay devoluciones, solo se pagan facturas o pagos a cuenta. Si es cliente, la entrada se trata primero como COBRO;
      // el aviso de "entrada de un proveedor" de abajo solo corre cuando NO es cliente.
      // Si el que figura es un PROVEEDOR (no un cliente), una entrada es una devolución o un reembolso: nunca se arma un cobro por suposición.
      const provNombre = !cliente && nombre ? d.proveedores.find((p) => !propio(p.cuit) && (mismoCliente(p.razon_social, nombre) || nombreEsComienzoDe(nombre, p.razon_social))) : undefined;
      const provEntrada = !cliente ? ((cuit && provPorCuit.get(cuit)) || provNombre) : undefined;
      if (provEntrada) {
        out.push({
          ...base(l), tipo: "sin_resolver", confianza: "baja", origen: "cuit", titulo: `Entrada de un proveedor: ${provEntrada.razon_social}`,
          detalle: [l.concepto, "El que figura es un PROVEEDOR tuyo: probablemente es una devolución o un reembolso, no un cobro. Elegí qué es con \"Otra cosa\"."], avisos: [],
        });
        continue;
      }
      // Sin aviso: solo facturas emitidas hasta el día del pago.
      const libres = abiertas.filter((f) => !facturasUsadas.has(f.id) && (f.moneda || "ARS") === "ARS" && f.fecha <= l.fecha);
      let elegidas: FacturaBandeja[] | null = null;
      let como = "";
      if (cliente) {
        const delCliente = libres.filter((f) => f.cliente_id === cliente.id).sort((a, b) => a.fecha.localeCompare(b.fecha));
        elegidas = sumaExactaUnica(delCliente, l.importe);
        como = `Cliente por ${cuit && cliPorCuit.get(cuit) ? "CUIT" : "nombre"}; saldo exacto de sus facturas`;
      } else {
        const exactas = libres.filter((f) => cent(f.saldo) === cent(l.importe));
        if (exactas.length === 1) { elegidas = exactas; como = "Única factura abierta con ese saldo exacto"; }
      }
      // Con retenciones: facturas de UN cliente que, descontando hasta un 6 %, dan el importe. Solo si hay una única opción.
      let retencionEstimada = 0;
      if (!elegidas?.length) {
        const conRet = combinacionConRetenciones(cliente ? libres.filter((f) => f.cliente_id === cliente.id) : libres, l.importe);
        if (conRet) {
          elegidas = conRet;
          retencionEstimada = r2(conRet.reduce((s, f) => s + f.saldo, 0) - l.importe);
          como = `${cliente ? "Cliente por CUIT o nombre" : "Única combinación de facturas de un cliente"}: las facturas suman ${fmt(l.importe + retencionEstimada)} y llegan ${fmt(l.importe)} → ${fmt(retencionEstimada)} serían retenciones`;
        }
      }
      if (elegidas?.length) {
        const armado = armarCobro(elegidas, l.importe, retencionEstimada ? r2(l.importe + retencionEstimada) : null, [], null, null);
        if (armado) {
          armado.cobro.facturas.forEach((f) => facturasUsadas.add(f.id));
          out.push({
            ...base(l), tipo: "cobro_nuevo", confianza: !cliente || retencionEstimada ? "baja" : "alta", debil: !cliente || Boolean(retencionEstimada), origen: "facturas",
            titulo: `Cobro de ${armado.cobro.cliente_nombre} → ${armado.cobro.facturas.length} factura${armado.cobro.facturas.length > 1 ? "s" : ""}`,
            detalle: [armado.cobro.facturas.map((f) => f.numero).join(", "), como],
            avisos: armado.avisos, cobro: armado.cobro,
          });
          continue;
        }
      }
      if (cliente && !yaMarcada) {
        const deuda = r2(libres.filter((f) => f.cliente_id === cliente.id).reduce((s, f) => s + f.saldo, 0));
        out.push({
          ...base(l), tipo: "a_cargar", confianza: "media", origen: "cuit",
          titulo: `Cobro de ${cliente.razon_social} (falta cargarlo)`,
          detalle: [deuda > 0 ? `Tiene ${fmt(deuda)} en facturas abiertas, pero ninguna combinación da justo ${fmt(l.importe)}: ¿retenciones?` : "No tiene facturas abiertas en pesos"],
          avisos: [], cruce: { clasificacion: "cobro", nota: `Cliente: ${cliente.razon_social}` },
        });
        continue;
      }
    } else {
      // 6) Pago de un gasto ya cargado sin pago (sueldos, consultores…): por CUIT del proveedor del gasto o por importe exacto.
      const cuit = cuitEnTexto(l.concepto);
      const libresG = d.gastos.filter((g) => !gastosUsados.has(g.id) && diasEntre(g.fecha, l.fecha) >= -20 && diasEntre(g.fecha, l.fecha) <= 25);
      const porCuit = cuit ? libresG.filter((g) => soloDigitos(g.proveedor_cuit) === cuit) : [];
      // Solo por importe: tiene que ser del mismo mes que el gasto (un sueldo de octubre no se paga en septiembre).
      const porImporte = libresG.filter((g) => g.moneda === "ARS" && cent(g.monto) === cent(-l.importe) && g.fecha.slice(0, 7) === l.fecha.slice(0, 7));
      const gasto = porCuit.length === 1 ? porCuit[0] : porImporte[0];
      if (gasto) {
        gastosUsados.add(gasto.id);
        const dudas = porCuit.length === 1 ? 0 : porImporte.length - 1;
        out.push({
          ...base(l), tipo: "pago_gasto", confianza: porCuit.length === 1 ? "alta" : "media", origen: "gastos",
          titulo: `Pago de ${gasto.descripcion}`,
          detalle: [porCuit.length === 1 ? "Mismo CUIT que el proveedor del gasto" : `Mismo importe (${gasto.moneda} ${gasto.monto.toLocaleString("es-AR")}) que un gasto cargado sin pago`],
          avisos: [
            ...(dudas > 0 ? [`Hay ${dudas + 1} gastos por el mismo importe: fijate que sea la persona correcta (si no, Corregir).`] : []),
            ...(gasto.moneda !== "ARS" ? [`El gasto es en ${gasto.moneda}: el pago queda en pesos por ${fmt(l.importe)}.`] : []),
          ],
          gasto: { id: gasto.id, descripcion: gasto.descripcion },
        });
        continue;
      }
      // 6b) Débito automático de un gasto fijo: el concepto (con lo que dice el resumen del banco) trae su referencia.
      const texto = String(l.concepto || "").toUpperCase();
      const fijo = (d.gastosFijosDebito || []).find((g) => g.referencias.some((r) => texto.includes(r)));
      if (fijo && !yaMarcada) {
        out.push({
          ...base(l), tipo: "pago_gasto", confianza: "alta", origen: "gastos",
          titulo: `Débito automático: ${fijo.descripcion}`,
          detalle: [`La referencia del banco coincide con el gasto fijo (${fijo.categoria}): se carga el gasto del mes y queda pagado`],
          avisos: [], gastoFijo: fijo,
        });
        continue;
      }
      // 7a) Factura de ARCA que paga esta transferencia (mismo CUIT e importe): si no está en Compras, se carga el pago y se cruza.
      const fa = l.factura_arca;
      if (fa && !yaMarcada) {
        const provA = provPorCuit.get(fa.cuit);
        const enCompras = (d.facturasCompra || []).find((f) => f.proveedor_id && f.proveedor_id === provA?.id && f.punto_venta === fa.punto_venta && f.numero === fa.numero);
        const nro = `${fa.tipo} ${String(fa.punto_venta).padStart(5, "0")}-${String(fa.numero).padStart(8, "0")}`;
        if (!enCompras) {
          out.push({
            ...base(l), tipo: "pago_proveedor", confianza: fa.unica ? "alta" : "media", origen: "facturas",
            titulo: `Pago a ${provA?.razon_social || fa.emisor} → ${nro}`,
            detalle: [`Factura de ARCA del ${fa.fecha.split("-").reverse().join("/")} por ${fmt(fa.total)}: mismo CUIT e importe exacto${provA ? "" : " (el proveedor no está en el CRM)"}`],
            avisos: fa.unica ? [] : ["Hay varias facturas del mismo importe (abono mensual): se toma la más reciente antes del pago."],
            pagoProveedor: { proveedor_id: provA?.id || null, proveedor_nombre: provA?.razon_social || fa.emisor, factura: fa },
          });
          continue;
        }
        if (enCompras.estado !== "pagada") {
          out.push({
            ...base(l), tipo: "a_cargar", confianza: "alta", origen: "facturas",
            titulo: `Pago a ${provA?.razon_social || fa.emisor} → ${nro} (falta la orden de pago)`,
            detalle: ["La factura ya está cargada en Compras: armá la orden de pago y se cruza sola"],
            avisos: [], cruce: { clasificacion: "pago", nota: `Proveedor: ${provA?.razon_social || fa.emisor} — ${nro}` },
          });
          continue;
        }
      }
      // 7) Transferencia a un proveedor por CUIT: queda "a cargar" con el proveedor anotado (la OP se arma en Órdenes de pago).
      const prov = cuit ? provPorCuit.get(cuit) : undefined;
      if (prov && !yaMarcada) {
        out.push({
          ...base(l), tipo: "a_cargar", confianza: "alta", origen: "cuit",
          titulo: `Pago a ${prov.razon_social} (falta la orden de pago)`,
          detalle: ["CUIT de la transferencia = proveedor del CRM"],
          avisos: [], cruce: { clasificacion: "pago", nota: `Proveedor: ${prov.razon_social}` },
        });
        continue;
      }
    }

    if (yaMarcada) continue;

    // 8) Sugerencia de la IA.
    const ia = d.ia.get(l.id);
    if (ia?.clasificacion) {
      const esCobroPago = ia.clasificacion === "cobro" || ia.clasificacion === "pago";
      const texto = textoParaRegla(l.concepto);
      out.push({
        ...base(l), tipo: esCobroPago ? "a_cargar" : "cruce", confianza: ia.confianza || "media", origen: "ia",
        titulo: `${etiquetaClasificacion(ia.clasificacion, ia.subtipo)}${esCobroPago ? " (falta cargarlo)" : ""}`,
        detalle: [ia.explicacion || "Sugerido por la IA"].filter(Boolean),
        avisos: [], cruce: { clasificacion: ia.clasificacion, subtipo: ia.subtipo || null, nota: ia.nota || null },
        regla: !esCobroPago && texto ? { texto, clasificacion: ia.clasificacion, subtipo: ia.subtipo || null } : undefined,
      });
      continue;
    }

    out.push({
      ...base(l), tipo: "sin_resolver", confianza: "baja", origen: "extracto",
      titulo: credito ? "Entrada sin identificar" : "Salida sin identificar",
      detalle: [p?.motivo || "Ninguna regla la reconoce"], avisos: [],
    });
  }

  const peso: Record<Confianza, number> = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => peso[a.confianza] - peso[b.confianza] || b.fecha.localeCompare(a.fecha) || Math.abs(b.importe) - Math.abs(a.importe));
}

/** Líneas que conviene mandarle a la IA: las que quedaron sin resolver y todavía no tienen sugerencia. */
export function lineasParaIA(items: ItemBandeja[], ia: Map<string, SugerenciaIA>): ItemBandeja[] {
  return items.filter((i) => i.tipo === "sin_resolver" && !ia.has(i.linea_id) && !/cheque/i.test(i.titulo));
}

/** Totales de lo que se va a confirmar, por tipo (para el resumen de arriba). */
export function resumenBandeja(items: ItemBandeja[]) {
  const por = (t: TipoItem) => items.filter((i) => i.tipo === t);
  const suma = (xs: ItemBandeja[]) => r2(xs.reduce((s, i) => s + i.importe, 0));
  const impuestos = items.filter((i) => i.cruce && ["impuesto", "gasto_bancario"].includes(i.cruce.clasificacion));
  return {
    total: items.length,
    alta: items.filter((i) => i.confianza === "alta" && i.tipo !== "sin_resolver").length,
    cobros: { n: por("cobro_nuevo").length, importe: suma(por("cobro_nuevo")) },
    gastos: { n: por("pago_gasto").length, importe: suma(por("pago_gasto")) },
    impuestos: { n: impuestos.length, importe: suma(impuestos) },
    sinResolver: por("sin_resolver").length,
  };
}
