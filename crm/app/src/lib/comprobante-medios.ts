// Comprobantes leídos con IA en la OP a proveedores y en el cobro (auditoría UX 26/10/2026, arreglo 3):
// subir otra vez el mismo comprobante sumaba sus medios y retenciones de nuevo y el total se duplicaba.
// Lo que ya está cargado no se vuelve a sumar; lo de otro pago (ej. transferencia + cheque) sí. Nunca traba: lo repetido se avisa.
// Prueba: npx tsx scripts/test-comprobante-medios.ts

/** Un medio de pago (leído o cargado a mano), en forma comparable. */
export interface PagoComparable { tipo: string; monto: number; numero?: string | null; fecha?: string | null }
/** Una retención (leída o cargada a mano), en forma comparable. */
export interface RetencionComparable { tipo: string; monto: number; certificado?: string | null }

const familia = (tipo: string) => {
  const t = String(tipo || "").toLowerCase();
  if (["cheque", "cheque_propio", "cheque_recibido", "echeq"].includes(t)) return "cheque";
  if (["transferencia", "deposito"].includes(t)) return "transferencia";
  return t;
};
const soloDigitos = (s: string | null | undefined) => String(s || "").replace(/\D/g, "").replace(/^0+/, "");
const cent = (n: number) => Math.round(Number(n || 0) * 100);

/**
 * Mismo pago: misma familia (cheque, transferencia…) y mismo importe; si los dos tienen número, el mismo número;
 * si no (ej. la OP del cliente sin número y el aviso del banco con número), la misma fecha.
 */
export function mismoPago(a: PagoComparable, b: PagoComparable): boolean {
  if (cent(a.monto) <= 0 || familia(a.tipo) !== familia(b.tipo) || cent(a.monto) !== cent(b.monto)) return false;
  const na = soloDigitos(a.numero), nb = soloDigitos(b.numero);
  if (na && nb) return na === nb;
  return String(a.fecha || "").slice(0, 10) === String(b.fecha || "").slice(0, 10);
}

/**
 * El pago que trae la línea del banco (Cargar cobro / Cargar pago desde Bancos) y el que se lee del comprobante son el mismo
 * aunque la fecha no coincida: el banco lo registra unos días después (04/11/2026, Mateo: comprobante del viernes 30/10,
 * débito del lunes 02/11; antes quedaban 2 transferencias). Misma familia e importe y hasta `dias` días de diferencia.
 */
export function mismoPagoQueLinea(linea: PagoComparable, leido: PagoComparable, dias = 7): boolean {
  if (cent(linea.monto) <= 0 || familia(linea.tipo) !== familia(leido.tipo) || cent(linea.monto) !== cent(leido.monto)) return false;
  const fa = Date.parse(String(linea.fecha || "").slice(0, 10)), fb = Date.parse(String(leido.fecha || "").slice(0, 10));
  if (Number.isNaN(fa) || Number.isNaN(fb)) return true;
  return Math.abs(fa - fb) <= dias * 86_400_000;
}

/** Misma retención: mismo tipo e importe; si las dos tienen certificado, el mismo. */
export function mismaRetencion(a: RetencionComparable, b: RetencionComparable): boolean {
  if (cent(a.monto) <= 0 || String(a.tipo) !== String(b.tipo) || cent(a.monto) !== cent(b.monto)) return false;
  const ca = soloDigitos(a.certificado), cb = soloDigitos(b.certificado);
  return !ca || !cb || ca === cb;
}

/**
 * De lo que llegó, qué se agrega y qué ya estaba cargado. Cada renglón cargado cuenta una sola vez:
 * si había una transferencia de $ 100 y llegan dos iguales, una es la repetida y la otra se agrega.
 */
export function sinRepetir<T>(cargados: T[], nuevos: T[], igual: (cargado: T, nuevo: T) => boolean): { agregar: T[]; repetidos: T[] } {
  const libres = [...cargados];
  const agregar: T[] = [], repetidos: T[] = [];
  for (const n of nuevos) {
    const i = libres.findIndex((c) => igual(c, n));
    if (i >= 0) { libres.splice(i, 1); repetidos.push(n); } else agregar.push(n);
  }
  return { agregar, repetidos };
}

/** Mismo archivo: mismo nombre y tamaño. */
export const claveArchivo = (f: { name: string; size: number }) => `${f.name}|${f.size}`;
