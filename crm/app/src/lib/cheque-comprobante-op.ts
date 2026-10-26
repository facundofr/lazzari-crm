// OP con el comprobante del banco (Augusto 26/10/2026): "si endoso un cheque lo hago desde el banco y cargo el comprobante
// del cheque endosado". Los cheques no se eligen desde el sistema: la IA lee el comprobante (eCheq Endosado / eCheq Emitido)
// y acá se decide qué cheque del CRM es, por número (sin ceros adelante) + monto + moneda:
//   - De un cliente en cartera → se usa ese (al guardar la OP pasa a endosado: el comprobante es del banco).
//   - Propio ya cargado (pendiente) → se usa ese, no se crea otro.
//   - Entregado / endosado a ESTE proveedor y sin OP vigente (ej. de una OP anulada) → se usa ese, no se duplica.
//   - Si no está → propio: se crea como hasta ahora; endosado: aviso (hay que tenerlo en cartera). Nunca se bloquea.
// Prueba: scripts/test-cheque-comprobante-op.ts
export interface ChequeCandidato {
  id: string;
  numero: string;
  monto: number | string;
  moneda: string | null;
  direccion: string | null;
  estado: string;
  tipo_cheque?: string | null;
  banco_emisor?: string | null;
  destino_id?: string | null;
  origen_nombre?: string | null;
  /** true si alguna OP no anulada ya lo usa (lo calcula la pantalla). */
  enOpVigente?: boolean;
}

export interface ChequeLeido { numero: string; monto: number; moneda: string; /** "recibido" = comprobante de endoso. */ direccion: string | null }

export type ResultadoCheque =
  | { tipo: "cartera"; cheque: ChequeCandidato; aviso: string | null }
  | { tipo: "propio_existente"; cheque: ChequeCandidato; aviso: string | null }
  | { tipo: "propio_nuevo"; aviso: string | null }
  | { tipo: "endoso_sin_cheque"; aviso: string };

export const numeroSinCeros = (n: string | null | undefined) => String(n ?? "").replace(/\D/g, "").replace(/^0+/, "");
const cent = (n: number | string) => Math.round(Number(n) * 100);

/** Libre para esta OP: sin usar, o ya dado a este mismo proveedor y sin otra OP vigente (por ejemplo, de una OP anulada). */
export function chequeLibreParaOp(c: ChequeCandidato, proveedorId: string): boolean {
  const dir = c.direccion || "recibido";
  if (dir === "emitido" && c.estado === "pendiente") return true;
  if (dir === "recibido" && c.estado === "en_cartera") return true;
  const dado = (dir === "emitido" && c.estado === "entregado") || (dir === "recibido" && c.estado === "endosado");
  return dado && !!proveedorId && c.destino_id === proveedorId && !c.enOpVigente;
}

const ESTADO_TEXTO: Record<string, string> = {
  en_cartera: "en cartera", pendiente: "pendiente", entregado: "entregado", endosado: "endosado", cobrado: "cobrado",
  depositado: "depositado", rechazado: "rechazado", anulado: "anulado",
};

export function chequeDelComprobante(leido: ChequeLeido, candidatos: ChequeCandidato[], proveedorId: string, yaUsados: string[] = []): ResultadoCheque {
  const num = numeroSinCeros(leido.numero);
  const mismos = num ? candidatos.filter((c) => numeroSinCeros(c.numero) === num && (c.moneda || "ARS") === leido.moneda && !yaUsados.includes(c.id)) : [];
  const conMonto = mismos.filter((c) => cent(c.monto) === cent(leido.monto));
  const libres = conMonto.filter((c) => chequeLibreParaOp(c, proveedorId));
  // De un cliente primero: el comprobante de endoso es de un cheque que está en cartera.
  const deCliente = libres.filter((c) => (c.direccion || "recibido") === "recibido");
  const propios = libres.filter((c) => c.direccion === "emitido");
  const elegir = leido.direccion === "recibido" ? [deCliente, propios] : [propios, deCliente];
  for (const lista of elegir) {
    if (lista.length === 1) {
      const c = lista[0];
      const deOpAnulada = c.estado === "entregado" || c.estado === "endosado";
      const aviso = deOpAnulada ? `El cheque ${c.numero} ya figura dado a este proveedor sin una OP vigente (por ejemplo, de una OP anulada): se usa el mismo, no se crea otro.` : null;
      return (c.direccion || "recibido") === "recibido" ? { tipo: "cartera", cheque: c, aviso } : { tipo: "propio_existente", cheque: c, aviso };
    }
    if (lista.length > 1) {
      return leido.direccion === "recibido"
        ? { tipo: "endoso_sin_cheque", aviso: `Hay ${lista.length} cheques ${leido.numero} por ${leido.monto} en el CRM: elegí cuál a mano.` }
        : { tipo: "propio_nuevo", aviso: `Hay ${lista.length} cheques ${leido.numero} por ${leido.monto} en el CRM: revisá cuál es antes de guardar (si no, se crea otro).` };
    }
  }
  // Mismo número pero no se puede usar: se avisa por qué.
  let aviso: string | null = null;
  if (mismos.length && !conMonto.length) aviso = `El cheque ${leido.numero} está en el CRM por otro monto (${mismos.map((c) => Number(c.monto).toLocaleString("es-AR", { minimumFractionDigits: 2 })).join(", ")}): revisá el comprobante.`;
  else if (conMonto.length) {
    const c = conMonto[0];
    const estado = ESTADO_TEXTO[c.estado] || c.estado;
    aviso = c.enOpVigente || ((c.estado === "entregado" || c.estado === "endosado") && c.destino_id !== proveedorId)
      ? `El cheque ${c.numero} ya está ${estado}${c.enOpVigente ? " en otra OP vigente" : " a otro proveedor"}: revisalo.`
      : `El cheque ${c.numero} figura ${estado} en el CRM: revisalo.`;
  }
  if (leido.direccion === "recibido") {
    return { tipo: "endoso_sin_cheque", aviso: aviso || `El cheque ${leido.numero} endosado no está en cartera: cargalo primero en el cobro del cliente (o elegilo a mano).` };
  }
  return { tipo: "propio_nuevo", aviso: aviso ? `${aviso} Si guardás así, se carga como cheque propio nuevo.` : null };
}
