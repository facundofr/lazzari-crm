// Finanzas Lazza: lecturas de la base (solo SELECT, nada se guarda). Las cuentas están en lib/finanzas-lazza.
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { armarTcDelDia, armarVencimientos, comprobanteVenta, saldoFacturaCompra, type FacturaCompraFL, type FacturaVentaFL, type FilaVencimiento, type GastoFL, type ItemCostoFL, type PagoDirectoFC, type TcDelDia } from "@/lib/finanzas-lazza";
import { calcularSaldosClientes, cobradoPorFactura, saldoFacturaVenta, traerDatosSaldoClientes, type SaldoCliente } from "@/lib/saldo-clientes";
import { calcularSaldosProveedores, traerCreditosProveedores, type SaldoProveedor } from "@/lib/saldo-proveedores";
import { sentidoAjuste } from "@/lib/tipos-movimiento";
import { esNotaCredito, sumarMeses } from "@/lib/reportes-comprobantes";
import { opsPorFactura, type OPResumen } from "@/lib/orden-pago-pdf";
import { armarFilasFacturas, recibosPorFactura, type DocPago, type FilaFactura, type LadoFactura } from "@/lib/facturas-lazza";
import { traerRecibos } from "./recibo-doc";
import type { Recibo } from "@/lib/recibos";

const db = supabase as any;

export const CAMPOS_VENTA = "id, fecha, tipo, estado, moneda, subtotal, iva, total, tipo_cambio, factura_origen_id, presupuesto_id, punto_venta, numero, cae, fecha_vencimiento, total_acreditado, cliente_id, clientes(razon_social)";

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

export interface Deudas {
  vencimientos: FilaVencimiento[];
  saldosClientes: Record<string, SaldoCliente>;
  saldosProveedores: Record<string, SaldoProveedor>;
}

/**
 * Lo que se debe y nos deben, con las MISMAS reglas que Finanzas (CC de clientes y de proveedores).
 * Vencimientos = facturas con saldo; saldos por cliente/proveedor incluyen NC, a favor, anticipos y ajustes.
 */
export async function traerDeudas(sociedadId: string, hoy: string): Promise<Deudas> {
  const [cc, compras, pagosDirectos, ncMovs, creditos] = await Promise.all([
    traerDatosSaldoClientes(db, sociedadId, traerTodo),
    traerTodo<any>(() => db.from("facturas_compra")
      .select("id, proveedor_id, fecha, fecha_vencimiento, tipo_comprobante, estado, moneda, iva, total, total_acreditado, numero_factura, proveedores(razon_social), op_facturas_compra(monto, ordenes_pago(estado))")
      .eq("sociedad_id", sociedadId).order("id")),
    traerTodo<PagoDirectoFC>(() => db.from("movimientos")
      .select("id, factura_compra_id, monto, retencion_ganancias_monto, anulado, nota_credito_compra_id")
      .eq("sociedad_id", sociedadId).eq("tipo", "pago").not("factura_compra_id", "is", null).order("id")),
    traerTodo<any>(() => db.from("movimientos")
      .select("id, nota_credito_compra_id, monto, anulado")
      .eq("sociedad_id", sociedadId).not("nota_credito_compra_id", "is", null).order("id")),
    traerCreditosProveedores(db, sociedadId, traerTodo, sentidoAjuste),
  ]);
  // Ventas: saldo por factura con la regla de CC de clientes; los datos para mostrar se traen solo de las que deben.
  const cobrado = cobradoPorFactura(cc.facturas, cc.movimientos, cc.aplicaciones);
  const saldos = new Map<string, number>();
  for (const f of cc.facturas) { const s = saldoFacturaVenta(f, cobrado[f.id] || 0); if (s > 0.005) saldos.set(f.id, s); }
  const ids = [...saldos.keys()];
  const ventas: ReturnType<typeof aFacturaVenta>[] = [];
  for (const trozo of trozos(ids)) {
    const { data, error } = await db.from("facturas").select(CAMPOS_VENTA).in("id", trozo);
    if (error) throw error;
    ventas.push(...(data || []).map(aFacturaVenta));
  }
  const comprasFL: FacturaCompraFL[] = compras
    .filter((r) => r.estado !== "anulada" && r.estado !== "pagada")
    .map((r) => ({ ...r, fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social ?? "" }));
  return {
    vencimientos: armarVencimientos({ hoy, ventas, saldoVenta: (f) => saldos.get(f.id) ?? 0, compras: comprasFL, pagosDirectos }),
    saldosClientes: calcularSaldosClientes(cc.facturas, cc.movimientos, cc.aplicaciones, cc.ajustes),
    saldosProveedores: calcularSaldosProveedores(compras, pagosDirectos, ncMovs, creditos),
  };
}

// ── Facturas (Augusto 19/10): una fila por factura, Ventas o Compras, con saldo y con qué se cobró/pagó ──

const CAMPOS_FACTURAS_VENTA = "id, fecha, fecha_vencimiento, tipo, estado, moneda, total, punto_venta, numero, cliente_id, oc_cliente, clientes(razon_social)";
const VENDEDOR_PR = ", presupuestos:presupuesto_id(vendedor_profile:vendedor_id(full_name))";

/**
 * Facturas de un lado con su saldo (mismas reglas que las cuentas corrientes). `todas` = también las cobradas/pagadas,
 * anuladas y NC; si no, solo las que tienen saldo. Ventas: OC del cliente, vendedor y recibos; compras: sus OP.
 */
export async function traerFacturasFL(sociedadId: string, lado: LadoFactura, hoy: string, todas: boolean): Promise<{ filas: FilaFactura[]; recibos: Recibo[] }> {
  if (lado === "venta") {
    const cc = await traerDatosSaldoClientes(db, sociedadId, traerTodo);
    const cobrado = cobradoPorFactura(cc.facturas, cc.movimientos, cc.aplicaciones);
    const saldos = new Map<string, number>();
    for (const f of cc.facturas) saldos.set(f.id, saldoFacturaVenta(f, cobrado[f.id] || 0));
    let rows: any[];
    const traer = (campos: string) => (todas
      ? traerTodo<any>(() => db.from("facturas").select(campos).eq("sociedad_id", sociedadId).order("id"))
      : (async () => {
        const ids = [...saldos].filter(([, s]) => s > 0.005).map(([id]) => id);
        const out: any[] = [];
        for (const trozo of trozos(ids)) {
          const { data, error } = await db.from("facturas").select(campos).in("id", trozo);
          if (error) throw error;
          out.push(...(data || []));
        }
        return out;
      })());
    // Si el vínculo con el vendedor del PR fallara, se trae igual sin vendedor.
    try { rows = await traer(CAMPOS_FACTURAS_VENTA + VENDEDOR_PR); } catch { rows = await traer(CAMPOS_FACTURAS_VENTA); }
    const recibos = await traerRecibos(sociedadId).catch((): Recibo[] => []);
    const filas = armarFilasFacturas({
      lado, hoy, docs: recibosPorFactura(recibos),
      facturas: rows.map((r) => ({
        id: r.id, entidadId: r.cliente_id ?? null, nombre: r.clientes?.razon_social || "", fecha: r.fecha, fecha_vencimiento: r.fecha_vencimiento,
        comprobante: comprobanteVenta(r), moneda: r.moneda, total: r.total, estado: r.estado, nc: esNotaCredito(r.tipo),
        saldo: saldos.get(r.id) ?? 0, ocCliente: r.oc_cliente, vendedor: r.presupuestos?.vendedor_profile?.full_name || "",
      })),
    });
    return { filas, recibos };
  }
  const [compras, pagosDirectos] = await Promise.all([
    traerTodo<any>(() => db.from("facturas_compra")
      .select("id, proveedor_id, fecha, fecha_vencimiento, tipo_comprobante, estado, moneda, iva, total, total_acreditado, numero_factura, proveedores(razon_social), op_facturas_compra(monto, ordenes_pago(estado))")
      .eq("sociedad_id", sociedadId).order("id")),
    traerTodo<PagoDirectoFC>(() => db.from("movimientos")
      .select("id, factura_compra_id, monto, retencion_ganancias_monto, anulado, nota_credito_compra_id")
      .eq("sociedad_id", sociedadId).eq("tipo", "pago").not("factura_compra_id", "is", null).order("id")),
  ]);
  const porFactura = new Map<string, PagoDirectoFC[]>();
  for (const p of pagosDirectos) if (p.factura_compra_id) porFactura.set(p.factura_compra_id, [...(porFactura.get(p.factura_compra_id) || []), p]);
  const conSaldo = compras.map((r) => ({ r, saldo: saldoFacturaCompra({ ...r, fecha: String(r.fecha).slice(0, 10) }, porFactura.get(r.id) || []) }))
    .filter((x) => todas || x.saldo > 0.005);
  const ops = await opsPorFactura(db, conSaldo.map((x) => x.r.id)).catch(() => new Map<string, OPResumen[]>());
  const docs = new Map<string, DocPago[]>();
  for (const [fid, lista] of ops) docs.set(fid, lista.map((o) => ({ tipo: "op" as const, id: o.id, numero: o.numero })));
  const filas = armarFilasFacturas({
    lado, hoy, docs,
    facturas: conSaldo.map(({ r, saldo }) => ({
      id: r.id, entidadId: r.proveedor_id ?? null, nombre: r.proveedores?.razon_social || "", fecha: r.fecha, fecha_vencimiento: r.fecha_vencimiento,
      comprobante: `${r.tipo_comprobante || "FC"} ${r.numero_factura || "S/N"}`, moneda: r.moneda, total: r.total, estado: r.estado,
      nc: esNotaCredito(r.tipo_comprobante), saldo,
    })),
  });
  return { filas, recibos: [] };
}
