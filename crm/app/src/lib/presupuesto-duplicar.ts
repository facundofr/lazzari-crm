// Duplicar un PR (Presupuestos > Duplicar): arma lo que se manda a crear_presupuesto_atomico.
// Auditoría Tanda 7, H46: antes se copiaba la fila entera (fecha y vencimiento viejos, Papelera, IA, motivo de rechazo,
// "listo para facturar", quién lo creó) y los renglones iban en un segundo insert sin revisar el error.
// Ahora el duplicado sale como uno nuevo: fecha de hoy, vence en 30 días, en Pendiente, creado por quien duplica,
// sin envío, OC del cliente ni adjunto. Lógica pura. Prueba: scripts/test-presupuesto-duplicar.ts
import { sumarDias } from "./presupuesto-seguimiento";

export const DIAS_VENCIMIENTO_PR = 30;

type Fila = Record<string, unknown>;

// Lo que hoy se carga a mano en un PR y vale para el duplicado (lo demás arranca de cero).
const CAMPOS_PR = [
  "cliente_id", "vendedor_id", "sucursal_id", "contacto_id", "markup_general", "subtotal", "iva", "total", "moneda",
  "tipo_cambio", "tipo_cambio_divisas", "cotizacion_modalidad", "observaciones", "notas_internas", "tipo_comprobante",
  "modalidad_emision", "descuento_general_porcentaje",
] as const;

// Los que crear_presupuesto_atomico no guarda: se copian después con un update aparte.
export const CAMPOS_PR_APARTE = ["costo_envio_interno", "transportista_id", "direccion_entrega"] as const;

const CAMPOS_RENGLON = [
  "producto_id", "codigo", "descripcion", "categoria", "cantidad", "unidad", "precio_costo", "markup_porcentaje",
  "precio_venta", "iva_porcentaje", "orden", "proveedor_id", "stock_propio", "lista_item_id", "proveedor_nombre",
  "costo_moneda", "precio_lista", "descuento_porcentaje", "pedido_texto", "catalogo_id", "proveedor_sugerido_id",
] as const;

const elegir = (o: Fila, campos: readonly string[]): Fila =>
  Object.fromEntries(campos.filter((c) => o[c] !== undefined).map((c) => [c, o[c]]));

export function armarDuplicadoPR(original: Fila & { presupuesto_items?: Fila[] | null }, hoy: string, usuarioId: string | null) {
  const renglones = [...(original.presupuesto_items ?? [])]
    .sort((a, b) => Number(a.orden ?? 0) - Number(b.orden ?? 0))
    .map((r) => elegir(r, CAMPOS_RENGLON));
  return {
    presupuesto: {
      ...elegir(original, CAMPOS_PR),
      created_by: usuarioId,
      fecha: hoy,
      vencimiento: sumarDias(hoy, DIAS_VENCIMIENTO_PR),
      estado: "pendiente",
      enviado_at: null,
    },
    renglones,
    aparte: elegir(original, CAMPOS_PR_APARTE),
  };
}
