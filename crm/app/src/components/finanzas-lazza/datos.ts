// Finanzas Lazza: lecturas de la base (solo SELECT, nada se guarda). Las cuentas están en lib/finanzas-lazza.
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { armarRetenciones, armarTcDelDia, armarVencimientos, comprobanteVenta, faltanCertificadosPorCliente, type FaltanCertificadosCliente, reporteBasico, saldoFacturaCompra, type FacturaCompraFL, type FacturaVentaFL, type FilaVencimiento, type GastoFL, type GastoVepFL, type ItemCostoFL, type ItemFacturaFL, type TransporteFL, type PagoDirectoFC, type RetencionIvaFL, type TcDelDia } from "@/lib/finanzas-lazza";
import type { LineaMov } from "@/lib/movimientos-banco";
import { leerDolarDelDia, soloConfiables } from "@/lib/dolar-presupuesto";
import { calcularSaldosClientes, cobradoPorFactura, saldoFacturaVenta, traerDatosSaldoClientes, type SaldoCliente } from "@/lib/saldo-clientes";
import { calcularSaldosProveedores, traerCreditosProveedores, type SaldoProveedor } from "@/lib/saldo-proveedores";
import { sentidoAjuste } from "@/lib/tipos-movimiento";
import { esNotaCredito, sumarMeses } from "@/lib/reportes-comprobantes";
import { opsPorFactura, type OPResumen } from "@/lib/orden-pago-pdf";
import { armarFilasFacturas, chequesSinAcreditarPorFactura, recibosPorFactura, type ComprobanteMes, type DocPago, type FilaFactura, type LadoFactura } from "@/lib/facturas-lazza";
import { traerRecibos } from "./recibo-doc";
import { DESDE_ESTIMADOS, IIBB_PCT_NATI, clasificarLineaBanco, sueldosPorCargar, type AplicacionCierre, type CobroCierre, type CompraCierre, type ConsumoVisaCont, type RetencionCont, type VentaCierre, type SueldoFijo, type BaseMes, type EstimadoMes, type GastoCont, type LineaBancoCont } from "@/lib/contabilidad";
import { premiosPorCargar } from "@/lib/premios-lazza";
import { armarGrupos, conLineaDeGrupo, type GrupoGasto } from "@/lib/gastos-grupos";
import { DESDE_IIBB_NETO, TARJETAS_PERSONALES, claveFoto, type ChequeCF, type DisponibilidadCF, type FijoCF, type FotoCF, type IibbCF, type LineaBancoCF, type PremioCF, type VencimientoCF } from "@/lib/cashflow";
import { numerosDebitados } from "@/lib/cobertura-cheques";
import { JOSE_ALVAREZ, comisionDelMes, detalleComision } from "@/lib/jose-alvarez";
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
  const { data } = await db.from("cotizaciones_dolar").select("fecha, valor_venta, fuente, es_manual")
    .eq("tipo", "oficial_divisas").gte("fecha", antes).lt("fecha", hasta).order("fecha");
  return armarTcDelDia(soloConfiables((data || []) as { fecha: string; valor_venta: number | string | null; fuente?: string | null; es_manual?: boolean | null }[]));
}

export async function traerVentasDelMes(sociedadId: string, periodo: string): Promise<FacturaVentaFL[]> {
  const { desde, hasta } = rangoMes(periodo);
  const rows = await traerTodo<any>(() => db.from("facturas").select(CAMPOS_VENTA)
    .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id"));
  return rows.map(aFacturaVenta);
}

export async function traerDatosReporte(sociedadId: string, periodo: string) {
  const { desde, hasta } = rangoMes(periodo);
  const [facturas, gastosRaw, transportesRaw] = await Promise.all([
    traerVentasDelMes(sociedadId, periodo),
    traerTodo<any>(() => db.from("gastos_manuales").select("id, fecha, monto, moneda, tipo_recurrencia, gasto_fijo_id")
      .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
    // Transportes (29/10/2026): las facturas de transporte del mes (las mismas que muestra Gastos en el grupo Transportes).
    traerTodo<any>(() => db.from("facturas_compra").select("id, fecha, subtotal, iva, total, moneda")
      .eq("sociedad_id", sociedadId).eq("tipo", "transporte").neq("estado", "anulada").gte("fecha", desde).lt("fecha", hasta).order("id")),
  ]);
  const transportes: TransporteFL[] = transportesRaw.map((x: any) => ({ ...x, fecha: String(x.fecha).slice(0, 10) }));
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
      db.from("presupuesto_items").select("presupuesto_id, descripcion, cantidad, precio_costo, costo_moneda, iva_porcentaje").in("presupuesto_id", ids),
      db.from("presupuestos").select("id, numero").in("id", ids),
    ]);
    if (it.error) throw it.error;
    items.push(...(it.data || []));
    for (const p of pr.data || []) prNumero[p.id] = String(p.numero ?? "");
  }
  // Renglones de las facturas (y de las de origen de las NC): el costo es el de lo realmente facturado. Si no se pueden leer, costo del PR entero.
  const itemsFactura: ItemFacturaFL[] = [];
  for (const ids of trozos([...new Set([...facturas, ...origenes].map((f) => f.id))])) {
    const { data, error } = await db.from("factura_items").select("factura_id, descripcion, cantidad").in("factura_id", ids);
    if (error) { console.error("Reportes · renglones de facturas:", error); itemsFactura.length = 0; break; }
    itemsFactura.push(...(data || []));
  }
  const idsAnulados = [...facturas, ...origenes].filter((f) => f.estado === "anulada").map((f) => f.id);
  const gastos: GastoFL[] = gastosRaw.map((g) => ({ ...g, fecha: String(g.fecha).slice(0, 10) }));
  return { facturas, origenes, idsAnulados, items, itemsFactura, prNumero, gastos, transportes, tcDia };
}

export async function traerComprasDelMes(sociedadId: string, periodo: string): Promise<FacturaCompraFL[]> {
  const { desde, hasta } = rangoMes(periodo);
  const armar = (campos: string) => () => db.from("facturas_compra").select(campos)
    .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id");
  const base = "id, fecha, tipo_comprobante, estado, moneda, subtotal, iva, percepciones, total, numero_factura, proveedores(razon_social)";
  // solo_iva y tipo_cambio (06/11/2026) pueden no existir todavía: sin la columna, se trae igual (el IVA usa el dólar del día).
  const rows = await traerTodo<any>(armar(`${base}, solo_iva, tipo_cambio`))
    .catch(() => traerTodo<any>(armar(`${base}, solo_iva`)))
    .catch(() => traerTodo<any>(armar(base)));
  return rows.map((r) => ({ ...r, fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social ?? "" }));
}

export type CertificadosCargados = Record<string, { id: string; numero: string; url: string | null }>;

/**
 * Certificados de retenciones sufridas cargados con «Cargar certificado» (tabla certificados_retencion, vigentes), por
 * movimiento. Si no se pueden leer, ninguno: queda el N° escrito en el texto de cada retención.
 */
export async function traerCertificadosCargados(sociedadId: string): Promise<CertificadosCargados> {
  const filas = await traerTodo<any>(() => db.from("certificados_retencion").select("id, movimiento_id, numero, archivo_url")
    .eq("sociedad_id", sociedadId).eq("anulado", false).order("id"))
    .catch((e) => { console.warn("Certificados de retención:", e); return [] as any[]; });
  return Object.fromEntries(filas.map((c) => [c.movimiento_id, { id: c.id, numero: c.numero, url: c.archivo_url ?? null }]));
}

/**
 * Retenciones sufridas sin N° de certificado, por cliente (Cobranzas, Augusto 03/11/2026): el cliente no debe plata, debe el
 * certificado. Misma regla que Retenciones › Sufridas › Falta certificado (`armarRetenciones` + `faltanCertificadosPorCliente`).
 */
export async function traerFaltanCertificados(sociedadId: string): Promise<FaltanCertificadosCliente[]> {
  const [movimientos, certificados] = await Promise.all([
    traerTodo<any>(() => db.from("movimientos").select("id, tipo, fecha, monto, moneda, anulado, descripcion, cliente_id, clientes(razon_social, cuit)")
      .eq("sociedad_id", sociedadId).in("tipo", ["retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"]).not("cliente_id", "is", null).order("id")),
    traerCertificadosCargados(sociedadId),
  ]);
  return faltanCertificadosPorCliente(armarRetenciones({ ops: [], movimientos, certificados }));
}

/**
 * Lo que el IVA del mes tiene a cuenta (arreglo 16, 27/10/2026): las retenciones de IVA que nos hicieron los clientes
 * (con el N° de certificado cargado, si lo tienen), las líneas del banco del mes (ivaDelMes se queda con las de IVA)
 * y los gastos del mes y de los 2 siguientes, donde están los VEP que pagan el IVA del mes.
 */
export async function traerIvaACuenta(sociedadId: string, periodo: string): Promise<{ retenciones: RetencionIvaFL[]; lineasBanco: LineaMov[]; gastos: GastoVepFL[] }> {
  const { desde, hasta } = rangoMes(periodo);
  const [retenciones, cuentas, gastos, certificados] = await Promise.all([
    traerTodo<any>(() => db.from("movimientos").select("id, fecha, monto, moneda, anulado, descripcion, clientes(razon_social)")
      .eq("sociedad_id", sociedadId).eq("tipo", "retencion_iva").not("cliente_id", "is", null).gte("fecha", desde).lt("fecha", hasta).order("id")),
    db.from("cuentas_financieras").select("id").eq("sociedad_id", sociedadId),
    traerTodo<any>(() => db.from("gastos_manuales").select("id, fecha, monto, moneda, descripcion")
      .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", `${sumarMeses(periodo, 3)}-01`).order("id")),
    traerCertificadosCargados(sociedadId),
  ]);
  if (cuentas.error) throw cuentas.error;
  const ids: string[] = (cuentas.data || []).map((c: { id: string }) => c.id);
  const lineas = ids.length
    ? await traerTodo<any>(() => db.from("extracto_movimientos").select("id, fecha, descripcion, monto, tipo, clasificacion, subtipo")
        .in("cuenta_id", ids).gte("fecha", desde).lt("fecha", hasta).order("id"))
    : [];
  const dia = (f: unknown) => String(f).slice(0, 10);
  return {
    retenciones: retenciones.map((m) => ({ ...m, fecha: dia(m.fecha), cliente: m.clientes?.razon_social ?? "", certificado: certificados[m.id]?.numero ?? null })),
    lineasBanco: lineas.map((l) => ({ ...l, fecha: dia(l.fecha), monto: Number(l.monto) })),
    gastos: gastos.map((g) => ({ ...g, fecha: dia(g.fecha) })),
  };
}

export interface Deudas {
  vencimientos: FilaVencimiento[];
  saldosClientes: Record<string, SaldoCliente>;
  saldosProveedores: Record<string, SaldoProveedor>;
  /** Saldos chicos sacados de pendientes ("venta:<id>" / "compra:<id>", lib/saldos-pendientes). `vencimientos` los trae igual:
   *  cada pantalla de pendientes los separa; Cuentas corrientes y el Cashflow no cambian. */
  sacados: Set<string>;
  /** Dólar divisa BNA del día (el último cargado), para saber si un saldo en dólares es chico. */
  dolar: number | null;
}

/** Saldos chicos sacados de pendientes (02/11/2026, tabla saldos_fuera_de_pendientes). Sin la tabla todavía, ninguno. */
export async function traerSaldosSacados(sociedadId: string): Promise<Set<string>> {
  const { data, error } = await db.from("saldos_fuera_de_pendientes").select("factura_id, factura_compra_id")
    .eq("sociedad_id", sociedadId).eq("anulado", false);
  if (error) return new Set();
  return new Set(((data || []) as any[]).map((r) => (r.factura_id ? `venta:${r.factura_id}` : `compra:${r.factura_compra_id}`)));
}

/** Dólar divisa BNA del día: el último confiable hasta hoy (lib/dolar-presupuesto → leerDolarDelDia, el mismo en todas las pantallas). */
export async function traerDolarDelDia(hoy: string): Promise<number | null> {
  return leerDolarDelDia(db, hoy).then((d) => d?.valor ?? null, () => null);
}

/**
 * Lo que se debe y nos deben, con las MISMAS reglas que Finanzas (CC de clientes y de proveedores).
 * Vencimientos = facturas con saldo; saldos por cliente/proveedor incluyen NC, a favor, anticipos y ajustes.
 */
export async function traerDeudas(sociedadId: string, hoy: string): Promise<Deudas> {
  const [cc, compras, pagosDirectos, ncMovs, creditos, sacados, dolar] = await Promise.all([
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
    traerSaldosSacados(sociedadId),
    traerDolarDelDia(hoy),
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
    sacados,
    dolar,
  };
}

// ── Facturas (Augusto 19/10): una fila por factura, Ventas o Compras, con saldo y con qué se cobró/pagó ──

const CAMPOS_FACTURAS_VENTA = "id, fecha, fecha_vencimiento, tipo, estado, moneda, subtotal, total, punto_venta, numero, cliente_id, oc_cliente, email_enviado_at, email_enviado_a, email_estado, clientes(razon_social)";
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
    const [recibos, cheques] = await Promise.all([
      traerRecibos(sociedadId).catch((): Recibo[] => []),
      // Cheques recibidos sin acreditar: la factura no dice "Cobrada" hasta que el cheque se cobre (si falla, como antes).
      traerTodo<any>(() => db.from("echeqs").select("id, movimiento_id, estado, numero, fecha_deposito, fecha_endoso").eq("sociedad_id", sociedadId)
        .eq("direccion", "recibido").in("estado", ["en_cartera", "depositado", "endosado"]).not("movimiento_id", "is", null).order("id")).catch(() => []),
    ]);
    const filas = armarFilasFacturas({
      lado, hoy, docs: recibosPorFactura(recibos), cheques: chequesSinAcreditarPorFactura(cheques, cc.movimientos as any, cc.aplicaciones as any),
      facturas: rows.map((r) => ({
        id: r.id, entidadId: r.cliente_id ?? null, nombre: r.clientes?.razon_social || "", fecha: r.fecha, fecha_vencimiento: r.fecha_vencimiento,
        comprobante: comprobanteVenta(r), moneda: r.moneda, total: r.total, estado: r.estado, nc: esNotaCredito(r.tipo),
        saldo: saldos.get(r.id) ?? 0, ocCliente: r.oc_cliente, vendedor: r.presupuestos?.vendedor_profile?.full_name || "",
        neto: r.subtotal, enviada: r.email_enviado_at, envioEstado: r.email_estado, porFuera: /por fuera/i.test(r.email_enviado_a || ""),
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
  for (const [fid, lista] of ops) docs.set(fid, lista.map((o) => ({ tipo: "op" as const, id: o.id, numero: o.numero, archivos: o.archivos })));
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

/** Comprobantes de venta de un mes (para "Facturado del mes" en Finanzas Lazza › Facturas). Solo lectura. */
export async function traerComprobantesMes(sociedadId: string, periodo: string): Promise<ComprobanteMes[]> {
  const { desde, hasta } = rangoMes(periodo);
  return traerTodo<ComprobanteMes>(() => db.from("facturas").select("id, tipo, subtotal, iva, total, moneda, tipo_cambio, cae")
    .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id"));
}

/** Fila de `configuracion` (por sociedad) con lo que se carga a mano en Contabilidad: el % de IIBB y tasas. */
export const CLAVE_CONTABILIDAD = "contabilidad";

/**
 * Pestañas de Gastos de la sociedad (tabla gastos_grupos, 03/11/2026). Sin la tabla o si falla, las 9 de siempre: nunca frena.
 */
export async function traerGruposGastos(sociedadId: string): Promise<GrupoGasto[]> {
  try {
    const { data, error } = await db.from("gastos_grupos").select("id, clave, nombre, orden, linea, oculto, base").eq("sociedad_id", sociedadId);
    return armarGrupos(error ? null : data);
  } catch {
    return armarGrupos(null);
  }
}

/**
 * Contabilidad → Estado de resultados (29/10/2026): lo que necesita estadoDeResultados para `periodos`.
 * Ventas, costo y transportes de cada mes salen de Reportes (la misma cuenta). Los gastos se traen desde un mes antes
 * hasta 3 después, porque cada uno cuenta en el mes que dice su detalle (el premio de octubre se paga en noviembre).
 * `conEstimados` (solo Lazzari): premios y comisión de José que corresponden al mes y todavía no se cargaron.
 */
export async function traerDatosContabilidad(sociedadId: string, periodos: string[], conEstimados: boolean) {
  const primero = periodos[0], ultimo = periodos[periodos.length - 1];
  const desdeGastos = `${sumarMeses(primero, -1)}-01`;
  const [reportes, gastosRaw, cuentas, tcDia, config, sueldosFijos, grupos] = await Promise.all([
    Promise.all(periodos.map(async (p) => ({ p, r: reporteBasico({ periodo: p, ...(await traerDatosReporte(sociedadId, p)) }) }))),
    traerTodo<any>(() => db.from("gastos_manuales").select("id, fecha, descripcion, categoria, grupo, monto, moneda, medio_pago")
      .eq("sociedad_id", sociedadId).gte("fecha", desdeGastos).lt("fecha", `${sumarMeses(ultimo, 4)}-01`).order("id")),
    db.from("cuentas_financieras").select("id").eq("sociedad_id", sociedadId),
    traerTcDelDia(sumarMeses(ultimo, 3), desdeGastos),
    db.from("configuracion").select("value").eq("sociedad_id", sociedadId).eq("key", CLAVE_CONTABILIDAD).maybeSingle(),
    // Sueldos fijos ("Sueldo Augusto", "Sueldo Jerónimo Casadidio"…): se estiman en el mes mientras no se cargan (Finanzas 30/10).
    conEstimados
      ? db.from("gastos_fijos").select("descripcion, monto, moneda").eq("sociedad_id", sociedadId).eq("activo", true).eq("grupo", "Personal").ilike("descripcion", "sueldo %")
      : Promise.resolve({ data: [] as { descripcion: string; monto: number; moneda: string }[], error: null }),
    traerGruposGastos(sociedadId),
  ]);
  if (cuentas.error) throw cuentas.error;
  if (sueldosFijos.error) throw sueldosFijos.error;
  const fijosSueldo: SueldoFijo[] = ((sueldosFijos.data || []) as { descripcion: string | null; monto: number | string | null; moneda: string | null }[])
    .filter((f) => f.moneda !== "USD").map((f) => ({ descripcion: String(f.descripcion || ""), monto: Number(f.monto) || 0 }));
  const ids: string[] = (cuentas.data || []).map((c: { id: string }) => c.id);
  const lineas = ids.length
    ? await traerTodo<any>(() => db.from("extracto_movimientos").select("id, fecha, descripcion, monto, tipo, clasificacion, subtipo, match_movimiento_id, estado, contra_cuenta_id")
        .in("cuenta_id", ids).gte("fecha", `${primero}-01`).lt("fecha", `${sumarMeses(ultimo, 1)}-01`).order("id"))
    : [];
  const dia = (f: unknown) => String(f).slice(0, 10);
  // Renglones del resumen de la Visa (paso 3 de Nati): cargos del banco al resultado; consumos personales e IVA al bloque informativo.
  // Si no se pueden leer (permisos o tabla), sin Visa: nunca frena.
  const visa: ConsumoVisaCont[] = await traerTodo<any>(() => db.from("tarjeta_consumos")
    .select("id, fecha, descripcion, importe, moneda, tipo, clase, tarjeta_resumenes(vencimiento)")
    .eq("sociedad_id", sociedadId).gte("fecha", desdeGastos).lt("fecha", `${sumarMeses(ultimo, 1)}-01`).order("id"))
    .then((rows) => rows.map((c) => ({ ...c, fecha: dia(c.fecha), vencimiento: c.tarjeta_resumenes?.vencimiento ? dia(c.tarjeta_resumenes.vencimiento) : null })), () => []);
  // Cada gasto con la línea de su pestaña, si se eligió una en Gastos › Editar pestañas.
  const gastos: GastoCont[] = conLineaDeGrupo(gastosRaw.map((g) => ({ ...g, fecha: dia(g.fecha) })), grupos);
  const lineasBanco: LineaBancoCont[] = lineas.filter((l) => l.estado !== "ignorado").map((l) => ({ ...l, fecha: dia(l.fecha) }));

  const base: Record<string, BaseMes> = {};
  for (const { p, r } of reportes) base[p] = {
    ventas: r.facturado.neto, costo: r.costo.neto, transportes: r.transportes.neto, avisosCosto: r.avisos.length,
    facturas: r.filas.map((f) => ({ fecha: String(f.fecha).slice(0, 10), comprobante: f.comprobante, cliente: f.cliente, prNumero: f.prNumero, venta: f.venta.neto, costo: f.costo.neto, aviso: f.aviso })),
  };

  const estimados: Record<string, EstimadoMes> = {};
  if (conEstimados) {
    const cargados = gastos.map((g) => String(g.descripcion || ""));
    const cargadosMin = new Set(cargados.map((d) => d.trim().toLowerCase()));
    for (const { p, r } of reportes) {
      if (p < DESDE_ESTIMADOS) continue;
      const premios = premiosPorCargar(p, r.objetivo.neto, cargados).map((x) => ({ persona: x.persona, monto: x.monto }));
      let comisionJose: number | null = null;
      if (!cargadosMin.has(detalleComision(p).toLowerCase())) {
        const prIds = [...new Set(r.filas.map((f) => f.presupuestoId).filter((x): x is string => !!x))];
        const suyos = new Set<string>();
        for (const lote of trozos(prIds, 150)) {
          const { data, error } = await db.from("presupuestos").select("id").eq("vendedor_id", JOSE_ALVAREZ.vendedorId).in("id", lote);
          if (error) throw error;
          for (const x of data || []) suyos.add(x.id);
        }
        comisionJose = comisionDelMes(r.filas, suyos).comision || null;
      }
      estimados[p] = { premios, comisionJose, sueldos: sueldosPorCargar(p, fijosSueldo, gastos) };
    }
  }
  const pct = Number(config.data?.value?.iibbPct);
  return { base, gastos, lineasBanco, tcDia, estimados, visa, iibbPct: config.data?.value?.iibbPct === undefined || !Number.isFinite(pct) ? IIBB_PCT_NATI : pct };
}

/**
 * Contabilidad → bloque informativo del Estado de resultados (paso 3 de Nati, 03/11/2026): retenciones que nos hicieron, y las
 * facturas de venta y de compra de los meses con sus cobros y pagos con fecha (para saber cuánto se debía al cierre). Solo lee.
 */
export async function traerDatosInformativo(sociedadId: string, periodos: string[]) {
  const desde = `${periodos[0]}-01`, hasta = `${sumarMeses(periodos[periodos.length - 1], 1)}-01`;
  const dia = (f: unknown) => String(f).slice(0, 10);
  const [ventasR, retR, comprasR] = await Promise.all([
    traerTodo<any>(() => db.from("facturas").select("id, fecha, tipo, estado, moneda, subtotal, total, tipo_cambio, total_acreditado, factura_origen_id, punto_venta, numero, cae, clientes(razon_social)")
      .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
    traerTodo<any>(() => db.from("movimientos").select("id, fecha, tipo, monto, moneda, anulado, cliente_id, factura_id, proveedor_id, clientes(razon_social)")
      .eq("sociedad_id", sociedadId).in("tipo", ["retencion_iva", "retencion_ganancias", "retencion_iibb", "retencion_suss"]).eq("anulado", false)
      .gte("fecha", desde).lt("fecha", hasta).order("id")),
    traerTodo<any>(() => db.from("facturas_compra")
      .select("id, fecha, tipo, tipo_comprobante, estado, solo_iva, numero_factura, subtotal, total, moneda, total_acreditado, proveedores(razon_social), op_facturas_compra(monto, ordenes_pago(estado, fecha))")
      .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
  ]);
  const ventas: VentaCierre[] = ventasR.map((f) => ({ ...f, fecha: dia(f.fecha), comprobante: comprobanteVenta(f), cliente: f.clientes?.razon_social ?? "" }));
  const idsVenta = ventas.map((f) => f.id);
  const cobros: CobroCierre[] = [], aplicaciones: AplicacionCierre[] = [];
  for (const lote of trozos(idsVenta)) {
    const [m, a] = await Promise.all([
      db.from("movimientos").select("id, factura_id, monto, moneda, anulado, fecha").in("factura_id", lote),
      db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos(anulado, fecha)").in("factura_id", lote),
    ]);
    if (m.error) throw m.error;
    if (a.error) throw a.error;
    cobros.push(...(m.data || []).map((x: any) => ({ ...x, fecha: dia(x.fecha) })));
    aplicaciones.push(...(a.data || []).map((x: any) => {
      const mov = Array.isArray(x.movimientos) ? x.movimientos[0] : x.movimientos;
      return { movimiento_id: x.movimiento_id, factura_id: x.factura_id, monto: x.monto, anulado: !!mov?.anulado, fecha: mov?.fecha ? dia(mov.fecha) : "9999-12-31" };
    }));
  }
  const idsCompra = comprasR.map((f) => f.id);
  const pagosDe = new Map<string, { fecha: string; monto: number }[]>();
  for (const lote of trozos(idsCompra)) {
    const { data, error } = await db.from("movimientos").select("factura_compra_id, monto, retencion_ganancias_monto, anulado, fecha").eq("tipo", "pago").in("factura_compra_id", lote);
    if (error) throw error;
    for (const x of data || []) {
      if (x.anulado) continue;
      pagosDe.set(x.factura_compra_id, [...(pagosDe.get(x.factura_compra_id) || []), { fecha: dia(x.fecha), monto: (Number(x.monto) || 0) + (Number(x.retencion_ganancias_monto) || 0) }]);
    }
  }
  const compras: CompraCierre[] = comprasR.map((f) => ({
    ...f, fecha: dia(f.fecha), comprobante: `${f.tipo_comprobante || "FC"} ${f.numero_factura || ""}`.trim(), proveedor: f.proveedores?.razon_social ?? "",
    pagos: [...(pagosDe.get(f.id) || []), ...((f.op_facturas_compra || []) as any[]).filter((l) => l?.ordenes_pago && l.ordenes_pago.estado !== "anulada")
      .map((l) => ({ fecha: dia(l.ordenes_pago.fecha), monto: Number(l.monto) || 0 }))],
  }));
  const retenciones: RetencionCont[] = retR.filter((r) => (r.cliente_id || r.factura_id) && !r.proveedor_id)
    .map((r) => ({ fecha: dia(r.fecha), tipo: r.tipo, monto: r.monto, moneda: r.moneda, quien: r.clientes?.razon_social ?? "" }));
  return { ventas, cobros, aplicaciones, compras, retenciones, tarjetasPersonales: TARJETAS_PERSONALES };
}

/**
 * Contabilidad → Cashflow semanal (29/10/2026): lo real (todas las líneas del extracto de las cuentas en $, con el gasto al que
 * está atada cada una) y lo que hace falta para proyectar (lib/cashflow: proyeccionCF y armarCashflow). Solo lee.
 * Las líneas "ignoradas" en Bancos también van: son plata que se movió (ya estaban cargadas en Gastos sin atar).
 */
export async function traerDatosCashflow(sociedadId: string, hoy: string, conPremios: boolean) {
  const mes = hoy.slice(0, 7);
  const [cuentasR, deudas, chequesR, fijosR, pagosFijos, comprasMes, dolarR, fotosR, grupos] = await Promise.all([
    db.from("cuentas_financieras").select("id, nombre, tipo, moneda, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId).eq("activa", true),
    traerDeudas(sociedadId, hoy),
    traerTodo<any>(() => db.from("echeqs").select("id, numero, direccion, estado, estado_banco, fecha_pago, monto, moneda, cubre_tercero, origen_nombre, destino_nombre")
      .eq("sociedad_id", sociedadId).in("estado", ["entregado", "pendiente", "en_cartera"]).order("id")),
    db.from("gastos_fijos").select("id, descripcion, grupo, categoria, monto, moneda, activo, dia_vencimiento, dolar_referencia, proveedor_id").eq("sociedad_id", sociedadId).eq("activo", true),
    traerTodo<{ gasto_fijo_id: string; fecha: string }>(() => db.from("gastos_manuales").select("id, gasto_fijo_id, fecha")
      .eq("sociedad_id", sociedadId).not("gasto_fijo_id", "is", null).gte("fecha", `${mes}-01`).order("id")),
    traerTodo<{ proveedor_id: string | null; fecha: string }>(() => db.from("facturas_compra").select("id, proveedor_id, fecha")
      .eq("sociedad_id", sociedadId).gte("fecha", `${mes}-01`).order("id")),
    leerDolarDelDia(db, hoy).catch(() => null),
    db.from("configuracion").select("key, value").eq("sociedad_id", sociedadId).like("key", "cashflow_foto_%"),
    traerGruposGastos(sociedadId),
  ]);
  if (cuentasR.error) throw cuentasR.error;
  if (fijosR.error) throw fijosR.error;
  // Solo las cuentas en $ con extracto (corrientes y cajas de ahorro): el FCI, la caución, la de US$ y el efectivo no tienen líneas.
  // Esas otras se muestran aparte con su último saldo cargado (Finanzas 30/10), sin sumar al saldo de las semanas.
  const cuentas: Record<string, string> = {};
  const otras: DisponibilidadCF[] = [];
  for (const c of cuentasR.data || []) {
    if (c.moneda !== "USD" && ["cuenta_corriente", "caja_ahorro"].includes(c.tipo)) { cuentas[c.id] = c.nombre; continue; }
    if (!["cuenta_corriente", "caja_ahorro", "fci", "efectivo"].includes(c.tipo) || c.saldo_banco === null) continue;
    otras.push({ nombre: c.nombre, moneda: c.moneda === "USD" ? "USD" : "ARS", saldo: Number(c.saldo_banco) || 0, fecha: c.saldo_banco_fecha ? String(c.saldo_banco_fecha).slice(0, 10) : null });
  }
  const ids = Object.keys(cuentas);
  const crudas = ids.length
    ? await traerTodo<any>(() => db.from("extracto_movimientos").select("id, cuenta_id, fecha, descripcion, monto, tipo, clasificacion, subtipo, saldo, match_movimiento_id, estado, nota, contra_cuenta_id")
        .in("cuenta_id", ids).order("id"))
    : [];
  // Línea → movimiento → gasto cargado (para ponerla en la misma fila que el Estado de resultados).
  const movIds = [...new Set(crudas.map((l) => l.match_movimiento_id).filter(Boolean))] as string[];
  const gastoDeMov = new Map<string, string>();
  for (const lote of trozos(movIds)) {
    const { data, error } = await db.from("movimientos").select("id, gasto_manual_id").in("id", lote).not("gasto_manual_id", "is", null);
    if (error) throw error;
    for (const m of data || []) gastoDeMov.set(m.id, m.gasto_manual_id);
  }
  const gastos = new Map<string, LineaBancoCF["gasto"]>();
  for (const lote of trozos([...new Set(gastoDeMov.values())])) {
    const { data, error } = await db.from("gastos_manuales").select("id, grupo, categoria, descripcion").in("id", lote);
    if (error) throw error;
    for (const g of conLineaDeGrupo((data || []) as { id: string; grupo: string | null; categoria: string | null; descripcion: string | null }[], grupos)) gastos.set(g.id, { grupo: g.grupo, categoria: g.categoria, descripcion: g.descripcion, linea_grupo: g.linea_grupo });
  }
  const dia = (f: unknown) => String(f).slice(0, 10);
  const lineas: LineaBancoCF[] = crudas.map((l) => {
    const gid = l.match_movimiento_id ? gastoDeMov.get(l.match_movimiento_id) : undefined;
    return { ...l, fecha: dia(l.fecha), gasto: gid ? gastos.get(gid) ?? null : null, ignorada: l.estado === "ignorado" };
  });
  const desde90 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const debitados = numerosDebitados(lineas.filter((l) => l.fecha >= desde90).map((l) => ({ descripcion: l.descripcion, tipo: l.tipo })));

  const vencimientos: VencimientoCF[] = deudas.vencimientos.map((v) => ({ lado: v.lado, vence: v.vence, saldo: v.saldo, moneda: v.moneda, comprobante: v.comprobante, nombre: v.nombre }));
  const cheques: ChequeCF[] = chequesR.map((c) => ({
    numero: String(c.numero ?? ""), direccion: c.direccion, estado: c.estado, estadoBanco: c.estado_banco, fecha_pago: c.fecha_pago ? dia(c.fecha_pago) : null,
    monto: c.monto, moneda: c.moneda, cubreTercero: c.cubre_tercero, quien: c.direccion === "emitido" ? c.destino_nombre : c.origen_nombre,
  }));
  const fijos: FijoCF[] = conLineaDeGrupo((fijosR.data || []) as any[], grupos).map((g: any) => ({
    id: g.id, descripcion: g.descripcion || "", grupo: g.grupo, categoria: g.categoria, linea_grupo: g.linea_grupo, monto: Number(g.monto) || 0, moneda: g.moneda === "USD" ? "USD" : "ARS",
    activo: !!g.activo, diaVencimiento: g.dia_vencimiento, dolarReferencia: g.dolar_referencia === null ? null : Number(g.dolar_referencia), proveedorId: g.proveedor_id,
  }));

  // IIBB y tasas (Augusto 29/10): % de las ventas del mes, el 22 del mes siguiente, menos SIRCREB, retenciones y saldo a favor
  // (Nati). Todos los meses desde DESDE_IIBB_NETO, para arrastrar el saldo a favor; se proyectan solo los que no vencieron.
  const anterior = sumarMeses(mes, -1);
  const mesesIibb: string[] = [];
  for (let p = DESDE_IIBB_NETO < anterior ? DESDE_IIBB_NETO : anterior; p <= mes; p = sumarMeses(p, 1)) mesesIibb.push(p);
  const [reportes, gastosDesde, configR, retencionesR] = await Promise.all([
    Promise.all(mesesIibb.map(async (p) => ({ p, r: reporteBasico({ periodo: p, ...(await traerDatosReporte(sociedadId, p)) }) }))),
    traerTodo<{ descripcion: string | null; fecha: string }>(() => db.from("gastos_manuales").select("id, descripcion, fecha")
      .eq("sociedad_id", sociedadId).gte("fecha", `${mesesIibb[0]}-01`).order("id")),
    db.from("configuracion").select("value").eq("sociedad_id", sociedadId).eq("key", CLAVE_CONTABILIDAD).maybeSingle(),
    // Retenciones de IIBB que nos hicieron los clientes (en $; las de cobros en US$ también se guardan en $).
    traerTodo<{ fecha: string; monto: number | string | null; moneda: string | null }>(() => db.from("movimientos").select("id, fecha, monto, moneda")
      .eq("sociedad_id", sociedadId).eq("tipo", "retencion_iibb").eq("anulado", false).gte("fecha", `${mesesIibb[0]}-01`).order("id")),
  ]);
  const aCuenta: Record<string, { sircreb: number; retenciones: number }> = Object.fromEntries(mesesIibb.map((p) => [p, { sircreb: 0, retenciones: 0 }]));
  // SIRCREB del banco neto de devoluciones, como la línea SIRCREB del Estado de resultados (sin las ignoradas en Bancos).
  for (const l of crudas) {
    const p = dia(l.fecha).slice(0, 7);
    if (!aCuenta[p] || l.estado === "ignorado" || clasificarLineaBanco({ ...l, fecha: dia(l.fecha) }) !== "sircreb") continue;
    aCuenta[p].sircreb += (l.tipo === "credito" ? -1 : 1) * Math.abs(Number(l.monto) || 0);
  }
  for (const r of retencionesR) {
    const p = dia(r.fecha).slice(0, 7);
    if (aCuenta[p] && r.moneda !== "USD") aCuenta[p].retenciones += Number(r.monto) || 0;
  }
  const pct = Number(configR.data?.value?.iibbPct);
  const iibb: IibbCF = {
    pct: configR.data?.value?.iibbPct === undefined || !Number.isFinite(pct) ? IIBB_PCT_NATI : pct,
    meses: reportes.map(({ p, r }) => ({ mes: p, ventas: r.facturado.neto, ...aCuenta[p] })),
    cargados: gastosDesde.map((g) => ({ descripcion: g.descripcion, fecha: dia(g.fecha) })),
  };

  // Premios del mes (Lazzari) que todavía no se cargaron: se pagan con el sueldo del mes siguiente (Augusto 29/10).
  let premios: PremioCF[] = [];
  if (conPremios) {
    const r = reportes.find((x) => x.p === mes)!.r;
    const cargados = gastosDesde.filter((g) => dia(g.fecha) >= `${mes}-01` && dia(g.fecha) < `${sumarMeses(mes, 2)}-01`);
    premios = premiosPorCargar(mes, r.objetivo.neto, cargados.map((g) => String(g.descripcion || ""))).map((x) => ({ persona: x.persona, monto: x.monto, mes }));
  }
  const fotos: Record<string, FotoCF> = {};
  for (const f of fotosR.data || []) fotos[String(f.key).replace("cashflow_foto_", "")] = f.value as FotoCF;

  return {
    cuentas, otras, lineas, debitados, vencimientos, cheques, fijos, premios, iibb, fotos,
    pagosFijos: pagosFijos.map((g) => ({ gasto_fijo_id: g.gasto_fijo_id, fecha: dia(g.fecha) })),
    facturasCompra: comprasMes.map((f) => ({ proveedor_id: f.proveedor_id, fecha: dia(f.fecha) })),
    dolar: dolarR?.valor ?? null,
  };
}

/** Guarda la foto del proyectado del mes (Contabilidad → Cashflow), una sola vez: si ya hay una, no la pisa. */
export async function guardarFotoCashflow(sociedadId: string, mes: string, foto: FotoCF): Promise<boolean> {
  const { error } = await db.from("configuracion").upsert({ key: claveFoto(mes), value: foto, sociedad_id: sociedadId }, { onConflict: "sociedad_id,key", ignoreDuplicates: true });
  if (error) { console.error("Contabilidad · foto del Cashflow:", error); return false; }
  return true;
}
