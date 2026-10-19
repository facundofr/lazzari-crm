// Finanzas Lazza: lecturas de la base (solo SELECT, nada se guarda). Las cuentas están en lib/finanzas-lazza.
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { sumarMeses } from "@/lib/reportes-comprobantes";
import { armarTcDelDia, type FacturaCompraFL, type FacturaVentaFL, type GastoFL, type ItemCostoFL, type TcDelDia } from "@/lib/finanzas-lazza";

const db = supabase as any;

export const CAMPOS_VENTA = "id, fecha, tipo, estado, moneda, subtotal, iva, total, tipo_cambio, factura_origen_id, presupuesto_id, punto_venta, numero, cae, fecha_vencimiento, total_acreditado, clientes(razon_social)";

export function rangoMes(periodo: string): { desde: string; hasta: string } {
  return { desde: `${periodo}-01`, hasta: `${sumarMeses(periodo, 1)}-01` };
}

export function aFacturaVenta(r: any): FacturaVentaFL & { fecha_vencimiento?: string | null } {
  return { ...r, fecha: String(r.fecha).slice(0, 10), cliente: r.clientes?.razon_social ?? "" };
}

function trozos<T>(lista: T[], n = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** Dólar BNA divisa guardado en la base (cotizaciones_dolar), del mes y unos días antes. Solo lectura. */
export async function traerTcDelDia(periodo: string, desdeFecha?: string): Promise<TcDelDia> {
  const { desde: inicioMes, hasta } = rangoMes(periodo);
  const desde = desdeFecha && desdeFecha < inicioMes ? desdeFecha : inicioMes;
  const antes = new Date(Date.parse(`${desde}T12:00:00Z`) - 12 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db.from("cotizaciones_dolar").select("fecha, valor_venta")
    .eq("tipo", "oficial_divisas").gte("fecha", antes).lt("fecha", hasta).order("fecha");
  return armarTcDelDia(data || []);
}

export async function traerVentasDelMes(sociedadId: string, periodo: string): Promise<FacturaVentaFL[]> {
  const { desde, hasta } = rangoMes(periodo);
  const rows = await traerTodo<any>(() => db.from("facturas").select(CAMPOS_VENTA)
    .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id"));
  return rows.map(aFacturaVenta);
}

export async function traerDatosReporte(sociedadId: string, periodo: string) {
  const { desde, hasta } = rangoMes(periodo);
  const [facturas, gastosRaw] = await Promise.all([
    traerVentasDelMes(sociedadId, periodo),
    traerTodo<any>(() => db.from("gastos_manuales").select("id, fecha, monto, moneda, tipo_recurrencia, gasto_fijo_id")
      .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
  ]);
  // Facturas de origen de las NC que son de otro mes.
  const enMes = new Set(facturas.map((f) => f.id));
  const idsOrigen = [...new Set(facturas.map((f) => f.factura_origen_id).filter((x): x is string => !!x && !enMes.has(x)))];
  const origenes: FacturaVentaFL[] = [];
  for (const ids of trozos(idsOrigen)) {
    const { data, error } = await db.from("facturas").select(CAMPOS_VENTA).in("id", ids);
    if (error) throw error;
    origenes.push(...(data || []).map(aFacturaVenta));
  }
  // Dólar del día también para las facturas de origen de otro mes (costo en US$ de una NC).
  const tcDia = await traerTcDelDia(periodo, origenes.map((f) => f.fecha).sort()[0]);
  const prIds = [...new Set([...facturas, ...origenes].map((f) => f.presupuesto_id).filter((x): x is string => !!x))];
  const items: ItemCostoFL[] = [];
  const prNumero: Record<string, string> = {};
  for (const ids of trozos(prIds)) {
    const [it, pr] = await Promise.all([
      db.from("presupuesto_items").select("presupuesto_id, cantidad, precio_costo, costo_moneda, iva_porcentaje").in("presupuesto_id", ids),
      db.from("presupuestos").select("id, numero").in("id", ids),
    ]);
    if (it.error) throw it.error;
    items.push(...(it.data || []));
    for (const p of pr.data || []) prNumero[p.id] = String(p.numero ?? "");
  }
  const idsAnulados = [...facturas, ...origenes].filter((f) => f.estado === "anulada").map((f) => f.id);
  const gastos: GastoFL[] = gastosRaw.map((g) => ({ ...g, fecha: String(g.fecha).slice(0, 10) }));
  return { facturas, origenes, idsAnulados, items, prNumero, gastos, tcDia };
}

export async function traerComprasDelMes(sociedadId: string, periodo: string): Promise<FacturaCompraFL[]> {
  const { desde, hasta } = rangoMes(periodo);
  const armar = (campos: string) => () => db.from("facturas_compra").select(campos)
    .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id");
  const base = "id, fecha, tipo_comprobante, estado, moneda, subtotal, iva, total, numero_factura, proveedores(razon_social)";
  // solo_iva puede no existir en alguna base vieja: sin la columna, se trae igual.
  const rows = await traerTodo<any>(armar(`${base}, solo_iva`)).catch(() => traerTodo<any>(armar(base)));
  return rows.map((r) => ({ ...r, fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social ?? "" }));
}
