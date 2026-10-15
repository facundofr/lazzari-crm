// Correo de administración conectado con Finanzas (16/10/2026, pedido de Augusto: "Mail y cobros tendría que estar
// relacionado con finanzas, que quede todo coordinado"). Lógica pura: para cada mail que leyó el agente dice en qué
// quedó en el sistema y qué hacer, mirando las facturas, el extracto del banco y las facturas de compra de HOY
// (no lo que había cuando se leyó el mail). Nunca registra nada: solo dice el estado y a qué pantalla ir.
// Prueba: scripts/test-correo-finanzas.ts (npx tsx scripts/test-correo-finanzas.ts)
import { cruzarPago, mismoCliente, type FacturaAbierta, type PagoExtraido } from "./agente-mail";

export type EstadoCorreo =
  | "cobrado"          // las facturas ya figuran cobradas
  | "conciliado"       // la plata llegó al banco y la línea ya está cruzada
  | "para_confirmar"   // la plata llegó al banco: el cobro está para confirmar
  | "falta_extracto"   // el extracto cargado es anterior al pago: subir el del banco
  | "no_llego"         // el extracto ya pasó la fecha y la plata no está
  | "factura_cargada"  // factura de proveedor ya cargada en Facturas de compra
  | "factura_falta"    // factura de proveedor sin cargar
  | "pago_nuestro"     // aviso de un pago que hicimos nosotros
  | "mirar";           // reclamo, consulta u otro: lo lee una persona

export interface MailCorreo {
  id: string;
  fecha_mail: string | null;
  categoria: string;
  datos: { pago?: PagoExtraido | null; factura?: { cuit?: string | null; emisor?: string | null; numero?: string | null; importe?: number | null; vencimiento?: string | null; es_nota_credito?: boolean | null } | null } | null;
}
export interface LineaBancoCorreo { id: string; fecha: string; importe: number; estado: string }
export interface FacturaCompraCorreo { numero_factura: string | null; proveedor_cuit: string | null }

export interface ResultadoCorreo {
  estado: EstadoCorreo;
  /** Una línea para la persona: "Llegó al banco el 14/10: confirmalo en Para confirmar". */
  texto: string;
  /** Pestaña de Finanzas a la que lleva el botón. */
  ir?: { tab: string; texto: string };
  /** Pagos de clientes: a quién y cuánto (para el reclamo de cobranza). */
  cliente?: { nombre: string | null; cuit: string | null };
  neto?: number | null;
}

const cent = (n: number) => Math.round(n * 100);
/** Lazzari y Grupo LA. */
const CUITS_PROPIOS = ["20379309128", "30719396042"];
const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b.slice(0, 10)}T12:00:00Z`) - Date.parse(`${a.slice(0, 10)}T12:00:00Z`)) / 86400000);

/** Número de comprobante comparable: "A-00042-00103132", "0042-103132" → "42-103132". */
export function numeroComparable(n: string | null | undefined): string {
  const g = String(n || "").match(/\d+/g) || [];
  if (g.length >= 2) return `${Number(g[g.length - 2])}-${Number(g[g.length - 1])}`;
  if (g.length === 1 && g[0].length >= 9) return `${Number(g[0].slice(0, -8))}-${Number(g[0].slice(-8))}`;
  return "";
}

export function estadoMail(
  m: MailCorreo,
  ctx: { facturas: FacturaAbierta[]; lineas: LineaBancoCorreo[]; extractoHasta: string | null; facturasCompra: FacturaCompraCorreo[] },
): ResultadoCorreo {
  const pago = m.datos?.pago || null;
  const fac = m.datos?.factura || null;

  if (pago && pago.direccion === "emitido") {
    return { estado: "pago_nuestro", texto: "Aviso de un pago nuestro a un proveedor: solo archivar." };
  }

  if (pago && (pago.monto_neto || pago.monto_total)) {
    const cliente = { nombre: pago.cliente_nombre || null, cuit: pago.cliente_cuit || null };
    const neto = pago.monto_neto ?? (pago.monto_total != null && pago.retenciones_total != null ? pago.monto_total - pago.retenciones_total : null);
    const cruce = cruzarPago(pago, ctx.facturas, []);
    const facturasPago = cruce.facturas;
    if (facturasPago.length && facturasPago.every((f) => f.cobrada)) {
      return { estado: "cobrado", texto: `Ya está cobrado en el sistema (${facturasPago.map((f) => f.etiqueta).join(", ")}).`, cliente, neto };
    }
    // Si el agente leyó mal la fecha (ej. 08/01 en vez de 08/10), vale la del mail.
    const fechaMail = String(m.fecha_mail || "").slice(0, 10);
    let fechaPago = String(pago.fecha_pago || fechaMail).slice(0, 10);
    if (fechaMail && fechaPago && Math.abs(diasEntre(fechaPago, fechaMail)) > 30) fechaPago = fechaMail;
    const linea = neto ? ctx.lineas.find((l) => l.importe > 0 && cent(l.importe) === cent(neto)
      && (!fechaPago || Math.abs(diasEntre(fechaPago, l.fecha)) <= 10)) : undefined;
    if (linea && linea.estado === "matcheado") {
      return { estado: "conciliado", texto: `Llegó al banco el ${ddmm(linea.fecha)} y ya está cruzado.`, cliente, neto };
    }
    if (linea) {
      return { estado: "para_confirmar", texto: `Llegó al banco el ${ddmm(linea.fecha)}: el cobro está armado para confirmar.`, ir: { tab: "para_confirmar", texto: "Confirmar el cobro" }, cliente, neto };
    }
    if (!ctx.extractoHasta || (fechaPago && ctx.extractoHasta < fechaPago)) {
      return { estado: "falta_extracto", texto: `El extracto cargado llega al ${ctx.extractoHasta ? ddmm(ctx.extractoHasta) : "—"}: subí el del banco para ver si entró.`, ir: { tab: "para_confirmar", texto: "Subir extracto" }, cliente, neto };
    }
    return { estado: "no_llego", texto: `El extracto ya pasó el ${fechaPago ? ddmm(fechaPago) : "día del aviso"} y la plata no está en el banco: preguntale al cliente.`, cliente, neto };
  }

  if (fac && (fac.numero || fac.importe)) {
    // Una factura NUESTRA (de venta) que reenvía un cliente: no se carga en compras.
    if (CUITS_PROPIOS.includes(soloDigitos(fac.cuit)) || /lazzari|grupo la/i.test(String(fac.emisor || ""))) {
      return { estado: "mirar", texto: `Es una factura nuestra (${fac.numero || "de venta"}) que nombra el cliente: no se carga en compras.` };
    }
    const num = numeroComparable(fac.numero);
    const cuit = soloDigitos(fac.cuit);
    const cargada = num && ctx.facturasCompra.some((f) => numeroComparable(f.numero_factura) === num && (!cuit || !f.proveedor_cuit || soloDigitos(f.proveedor_cuit) === cuit));
    if (cargada) return { estado: "factura_cargada", texto: `La factura ${fac.numero} de ${fac.emisor || "el proveedor"} ya está cargada.` };
    return {
      estado: "factura_falta",
      texto: `Falta cargar la ${fac.es_nota_credito ? "nota de crédito" : "factura"} ${fac.numero || ""} de ${fac.emisor || "el proveedor"}${fac.vencimiento ? ` (vence ${ddmm(String(fac.vencimiento))})` : ""}.`,
      ir: { tab: "facturas_compra", texto: "Cargar factura" },
    };
  }

  return { estado: "mirar", texto: "" };
}

/**
 * ¿El cliente avisó un pago que todavía no se cobró? Sirve para no reclamarle a quien ya pagó.
 * Devuelve la fecha del aviso más nuevo de los últimos `dias` días.
 */
export function avisoDePagoReciente(
  cliente: { nombre: string | null; cuit: string | null },
  pagos: { fecha: string; estado: EstadoCorreo; cliente?: { nombre: string | null; cuit: string | null } }[],
  hoy: string, dias = 15,
): string | null {
  const cuit = soloDigitos(cliente.cuit);
  const suyos = pagos.filter((p) => p.estado !== "cobrado" && p.estado !== "conciliado" && diasEntre(p.fecha, hoy) <= dias
    && ((cuit && soloDigitos(p.cliente?.cuit) === cuit) || (!cuit || !soloDigitos(p.cliente?.cuit)) && mismoCliente(cliente.nombre, p.cliente?.nombre)));
  return suyos.map((p) => p.fecha).sort().pop() || null;
}

/** Orden de las secciones del Correo: primero lo que mueve plata. */
export const SECCIONES_CORREO: { id: string; titulo: string; categorias: string[] }[] = [
  { id: "pagos", titulo: "Pagos de clientes", categorias: ["pago_retencion"] },
  { id: "proveedores", titulo: "Facturas y reclamos de proveedores", categorias: ["factura_proveedor"] },
  { id: "consultas", titulo: "Reclamos y consultas", categorias: ["reclamo_consulta"] },
  { id: "otros", titulo: "Pedidos, avisos y otros", categorias: ["oc_cliente", "vencimiento_aviso", "otro"] },
];
