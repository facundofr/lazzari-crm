// A qué factura aplicar una nota de crédito de compra cuando se cargan juntas (carga masiva).
// Es una sugerencia: el usuario la puede cambiar o dejar la NC como crédito disponible.
import { canonicalPurchaseInvoiceNumber } from "@/lib/purchase-invoice-reconciliation";

/** "FC A 0001-00012345" o "Ref. 1-12345" → "00001-00012345". */
const numeroCanonico = (v: string) => {
  const m = String(v || "").match(/(\d{1,5})\s*[-/]\s*(\d{1,8})(?!.*\d{1,5}\s*[-/]\s*\d)/);
  return canonicalPurchaseInvoiceNumber(m ? `${m[1]}-${m[2]}` : String(v || ""));
};

export interface FacturaAcreditable { id: string; numero_factura: string; saldo_acreditable: number }

/**
 * Orden de preferencia:
 * 1. Las facturas que la NC cita como comprobante asociado.
 * 2. Las facturas del mismo proveedor cargadas en la misma tanda.
 * Dentro de cada grupo, la primera que tenga saldo para absorber toda la NC; si ninguna alcanza, la primera que exista.
 */
export function sugerirFacturaParaNC(
  facturas: FacturaAcreditable[],
  asociadas: string[] = [],
  deLaTanda: string[] = [],
  totalNC = 0,
): { id: string; motivo: "asociada" | "tanda" } | null {
  const porNumero = new Map(facturas.map((f) => [numeroCanonico(f.numero_factura), f]));
  const buscar = (numeros: string[]) => {
    const hallados = numeros
      .map((n) => porNumero.get(numeroCanonico(n)))
      .filter((f): f is FacturaAcreditable => !!f && f.saldo_acreditable > 0.005);
    return hallados.find((f) => f.saldo_acreditable + 0.005 >= totalNC) || hallados[0] || null;
  };
  const a = buscar(asociadas);
  if (a) return { id: a.id, motivo: "asociada" };
  const t = buscar(deLaTanda);
  if (t) return { id: t.id, motivo: "tanda" };
  return null;
}
