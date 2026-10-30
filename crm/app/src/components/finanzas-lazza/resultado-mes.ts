// Resultado del mes (auditoría de la plata, 29/10/2026): Reportes y el inicio muestran el MISMO resultado que Contabilidad.
// Antes Reportes restaba todo lo cargado en Gastos (también IVA, SICORE, anticipos de Ganancias y gastos personales) y daba
// distinto. Ahora se arma con estadoDeResultados y los mismos datos que la Contabilidad: un solo número. Solo lee.
import { estadoDeResultados } from "@/lib/contabilidad";
import { periodoDeFecha } from "@/lib/reportes-comprobantes";
import { traerDatosContabilidad } from "./datos";

export interface ResultadoMes {
  ventas: number;
  costo: number;
  transportes: number;
  /** Lo que resta además del costo y los transportes: sueldos, comisiones, servicios, IIBB y tasas, banco, intereses. */
  gastosQueCuentan: number;
  /** De qué se forman los gastos que cuentan (suman gastosQueCuentan): cargados en Gastos, IIBB y tasas, líneas del banco y estimados. */
  partes: { deGastos: number; iibb: number; delBanco: number; estimados: number };
  antesGanancias: number;
  ganancias: number;
  neto: number;
  /** Lo que no es gasto (informativo): IVA, SICORE, anticipos, retiros e impuestos del banco a cuenta. */
  noSonGasto: number;
  /** Todo lo cargado en Gastos con fecha del mes (lo que muestra Gastos), US$ al dólar del día. */
  cargadosEnGastos: number;
  iibbPct: number | null;
}

const num = (v: unknown) => Number(v || 0) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** `esLazzari`: igual que en Contabilidad (premios y comisión de José estimados mientras no se cargan). */
export async function traerResultadoMes(sociedadId: string, periodo: string, esLazzari: boolean): Promise<ResultadoMes> {
  const datos = await traerDatosContabilidad(sociedadId, [periodo], esLazzari);
  const er = estadoDeResultados({ periodos: [periodo], ...datos });
  const linea = (id: string) => er.lineas.find((l) => l.id === id)?.valores[periodo] ?? 0;
  const ventas = linea("ventas"), costo = -linea("costo_mercaderia"), transportes = -linea("transportes");
  const antesGanancias = er.subtotales.antes_ganancias.valores[periodo] ?? 0;
  const partes = { deGastos: 0, iibb: 0, delBanco: 0, estimados: 0 };
  for (const l of er.lineas) {
    if (["ventas", "costo_mercaderia", "transportes", "ganancias"].includes(l.id)) continue;
    for (const it of l.detalle[periodo] || []) {
      if (it.origen === "gasto") partes.deGastos -= it.monto;
      else if (it.origen === "banco") partes.delBanco -= it.monto;
      else if (it.origen === "estimado") partes.estimados -= it.monto;
      else if (l.id === "iibb") partes.iibb -= it.monto;
    }
  }
  let cargadosEnGastos = 0;
  for (const g of datos.gastos) {
    if (periodoDeFecha(g.fecha) !== periodo) continue;
    const tc = String(g.moneda || "").toUpperCase() === "USD" ? datos.tcDia(g.fecha) : 1;
    if (tc) cargadosEnGastos += num(g.monto) * tc;
  }
  return {
    ventas, costo, transportes,
    gastosQueCuentan: r2(ventas - costo - transportes - antesGanancias),
    partes: { deGastos: r2(partes.deGastos), iibb: r2(partes.iibb), delBanco: r2(partes.delBanco), estimados: r2(partes.estimados) },
    antesGanancias,
    ganancias: -linea("ganancias"),
    neto: er.subtotales.neto.valores[periodo] ?? 0,
    noSonGasto: r2(-er.fuera.reduce((s, f) => s + (f.valores[periodo] ?? 0), 0)),
    cargadosEnGastos: r2(cargadosEnGastos),
    iibbPct: datos.iibbPct,
  };
}
