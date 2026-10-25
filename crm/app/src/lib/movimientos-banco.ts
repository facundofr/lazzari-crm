// Bancos > Movimientos > "Ver por tipo" (24/10/2026, Augusto): todas las líneas del banco agrupadas en pocos tipos, con entradas y salidas por separado.
// El tipo sale del código del banco (tabla de Augusto, lib/bbva-codigos) cuando la línea lo trae; las líneas cargadas antes de leer el código
// se agrupan por lo que ya tienen guardado (clasificación y subtipo) o por su texto. Una entrada dentro de impuestos y comisiones es una devolución.
// Nada se pierde: lo que no entra en ningún tipo queda en "Sin clasificar". Prueba: scripts/test-movimientos-banco.ts
import { codigoDeConcepto, familiaDeCodigo, sinCodigoBanco } from "./bbva-codigos";

export type TipoMov =
  | "impuestos_comisiones" | "cheques" | "transferencias" | "debitos_automaticos" | "tarjeta" | "propios" | "efectivo" | "otros" | "sin_clasificar";

export const TIPOS_MOV: Array<{ id: TipoMov; nombre: string; ayuda: string }> = [
  { id: "sin_clasificar", nombre: "Sin clasificar", ayuda: "Líneas que todavía no tienen tipo: se resuelven en Para confirmar." },
  { id: "impuestos_comisiones", nombre: "Impuestos y comisiones", ayuda: "Comisiones, IVA, SIRCREB, impuesto crédito Ganancias (Ley 25.413) y pagos de ARCA (VEP)." },
  { id: "cheques", nombre: "Cheques", ayuda: "Depósitos, débitos y rechazos de cheques." },
  { id: "transferencias", nombre: "Transferencias", ayuda: "Cobros y pagos por transferencia." },
  { id: "debitos_automaticos", nombre: "Débitos automáticos", ayuda: "Luz, internet, seguros, ARBA, etc." },
  { id: "tarjeta", nombre: "Tarjeta", ayuda: "Pagos de resumen de tarjeta: mueven plata, no son un gasto nuevo." },
  { id: "propios", nombre: "Movimientos propios", ayuda: "Entre cuentas propias e inversión en FCI: la plata cambia de lugar." },
  { id: "efectivo", nombre: "Efectivo", ayuda: "Extracciones de efectivo." },
  { id: "otros", nombre: "Otros", ayuda: "Intereses, gastos personales y lo marcado como otro." },
];

export interface LineaMov {
  id: string; fecha: string; descripcion: string; monto: number; tipo: "credito" | "debito";
  clasificacion: string | null; subtipo: string | null;
}
export interface MovClasificado { tipo: TipoMov; categoria: string; devolucion: boolean }

const CAT_COMISIONES = "Comisiones", CAT_IVA = "IVA", CAT_SIRCREB = "SIRCREB (Ingresos Brutos)", CAT_LEY = "Impuesto crédito Ganancias (Ley 25.413)", CAT_ARCA = "Pagos ARCA (VEP)", CAT_OTROS_IMP = "Otros impuestos";

export function clasificarMovimiento(l: LineaMov): MovClasificado {
  const dev = l.tipo === "credito";
  const imp = (categoria: string): MovClasificado => ({ tipo: "impuestos_comisiones", categoria, devolucion: dev });
  const aparte = (tipo: TipoMov): MovClasificado => ({ tipo, categoria: "", devolucion: false });

  const fam = familiaDeCodigo(codigoDeConcepto(l.descripcion));
  if (fam) {
    switch (fam) {
      case "comision": return imp(CAT_COMISIONES);
      case "iva": return imp(CAT_IVA);
      case "sircreb": return imp(CAT_SIRCREB);
      case "ley_25413": return imp(CAT_LEY);
      case "arca": return imp(CAT_ARCA);
      case "cheque_debito": case "cheque_rechazo": case "cheque_deposito": return aparte("cheques");
      // Una transferencia que ya se confirmó como pase entre cuentas propias, FCI o pago de tarjeta sigue en ese tipo (el código 262/265/266 no distingue cuentas propias).
      case "transferencia":
        if (l.clasificacion === "entre_cuentas" || l.clasificacion === "fci") return aparte("propios");
        if (l.clasificacion === "tarjeta") return aparte("tarjeta");
        return aparte("transferencias");
      case "debito_automatico": return aparte("debitos_automaticos");
      case "tarjeta": return aparte("tarjeta");
      case "entre_propias": case "fci": return aparte("propios");
      case "efectivo": return aparte("efectivo");
    }
  }

  const texto = sinCodigoBanco(l.descripcion).toUpperCase();
  if (/^DEBITO DIRECTO|^DEBITO AUTOMATICO/.test(texto)) return aparte("debitos_automaticos");
  if (/EXTRACCION EFECTIVO/.test(texto)) return aparte("efectivo");

  switch (l.clasificacion) {
    case "impuesto": {
      const s = String(l.subtipo || "").replace(/^devolucion_/, "");
      if (s === "iva") return imp(CAT_IVA);
      if (s === "ley_25413") return imp(CAT_LEY);
      if (s === "sircreb") return imp(CAT_SIRCREB);
      if (!s || s === "afip") return imp(CAT_ARCA);
      return imp(CAT_OTROS_IMP);
    }
    case "gasto_bancario": return imp(CAT_COMISIONES);
    case "cheque_emitido": case "cheque_acreditado": case "cheque_devuelto": return aparte("cheques");
    case "cobro": case "pago": return aparte("transferencias");
    case "tarjeta": return aparte("tarjeta");
    case "fci": case "entre_cuentas": return aparte("propios");
    case "intereses": case "personal": case "otro": return aparte("otros");
    default: return aparte("sin_clasificar");
  }
}

export interface ResumenTipo { tipo: TipoMov; entradas: number; salidas: number; cantEntradas: number; cantSalidas: number }
export interface ResumenCategoria { categoria: string; salidas: number; cantSalidas: number; devoluciones: number; cantDevoluciones: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Totales por tipo (entradas y salidas separadas). La suma de todos los tipos es siempre el total de las líneas. */
export function resumenPorTipo(lineas: LineaMov[]): ResumenTipo[] {
  const m = new Map<TipoMov, ResumenTipo>(TIPOS_MOV.map((t) => [t.id, { tipo: t.id, entradas: 0, salidas: 0, cantEntradas: 0, cantSalidas: 0 }]));
  for (const l of lineas) {
    const r = m.get(clasificarMovimiento(l).tipo)!;
    if (l.tipo === "credito") { r.entradas += l.monto; r.cantEntradas++; } else { r.salidas += l.monto; r.cantSalidas++; }
  }
  return TIPOS_MOV.map((t) => { const r = m.get(t.id)!; return { ...r, entradas: r2(r.entradas), salidas: r2(r.salidas) }; });
}

/** Impuestos y comisiones por categoría: el costo (salidas) y las devoluciones (entradas) van separados; no se restan. */
export function resumenImpuestos(lineas: LineaMov[]): ResumenCategoria[] {
  const m = new Map<string, ResumenCategoria>();
  for (const l of lineas) {
    const c = clasificarMovimiento(l);
    if (c.tipo !== "impuestos_comisiones") continue;
    const r = m.get(c.categoria) || { categoria: c.categoria, salidas: 0, cantSalidas: 0, devoluciones: 0, cantDevoluciones: 0 };
    if (c.devolucion) { r.devoluciones += l.monto; r.cantDevoluciones++; } else { r.salidas += l.monto; r.cantSalidas++; }
    m.set(c.categoria, r);
  }
  return [...m.values()].map((r) => ({ ...r, salidas: r2(r.salidas), devoluciones: r2(r.devoluciones) })).sort((a, b) => b.salidas - a.salidas);
}

/** Detalle corto de un débito automático a partir de la nota guardada al confirmarlo ("Débito automático: Luz — Cooperativa… — octubre 2026: $ 9.689,44. …"). */
export function detalleDebitoAutomatico(nota: string | null | undefined): string {
  return String(nota || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/^\s*D[ée]bito autom[áa]tico:\s*/i, "")
    .replace(/:\s*\$.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
