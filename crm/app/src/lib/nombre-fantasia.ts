// Nombre de fantasía que aparece en las facturas de compra (logo / encabezado del emisor).
// Al guardar una factura de un proveedor que ya existe, se aprende si el proveedor no tenía uno;
// si tenía otro distinto, solo se avisa (nunca se pisa).

/** Normaliza para comparar: sin acentos, minúsculas y solo letras y números. */
export function normalizarNombre(t: string | null | undefined): string {
  return String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export type DecisionNombreFantasia =
  | { accion: "guardar"; valor: string }
  | { accion: "distinto"; valor: string }
  | { accion: "nada"; valor?: undefined };

/**
 * @param actual       nombre_fantasia que tiene hoy el proveedor (puede estar vacío)
 * @param deFactura    nombre_fantasia que leyó la IA en la factura
 * @param razonSocial  razón social del proveedor (o varias: la del CRM y la de la factura)
 */
export function decidirNombreFantasia(
  actual: string | null | undefined,
  deFactura: string | null | undefined,
  razonSocial: string | null | undefined | Array<string | null | undefined>,
): DecisionNombreFantasia {
  const valor = String(deFactura || "").trim().replace(/\s+/g, " ");
  const nFactura = normalizarNombre(valor);
  if (!nFactura) return { accion: "nada" };
  const razones = (Array.isArray(razonSocial) ? razonSocial : [razonSocial]).map(normalizarNombre).filter(Boolean);
  if (razones.includes(nFactura)) return { accion: "nada" };
  const nActual = normalizarNombre(actual);
  if (!nActual) return { accion: "guardar", valor };
  if (nActual === nFactura) return { accion: "nada" };
  return { accion: "distinto", valor };
}

/** Solo se aprende si los dos CUIT se conocen y coinciden (comparando solo los dígitos). */
export function cuitsCoinciden(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = String(a || "").replace(/\D/g, "");
  const dbb = String(b || "").replace(/\D/g, "");
  return !!da && !!dbb && da === dbb;
}

type Avisos = { info: (m: string) => void; warning: (m: string) => void };

/**
 * Lee el proveedor, decide y, si corresponde, guarda solo nombre_fantasia. Nunca tira error:
 * aprender el nombre es opcional y no puede frenar la carga de la factura.
 */
export async function aprenderNombreFantasiaDeFactura(
  db: any,
  { proveedorId, sociedadId, deFactura, razonSocialFactura, cuitFactura }: { proveedorId: string; sociedadId?: string | null; deFactura: string | null | undefined; razonSocialFactura?: string | null; /** CUIT del emisor leído en la factura: sin él (o si no coincide con el del proveedor) no se aprende. */ cuitFactura: string | null | undefined },
  avisos: Avisos,
): Promise<void> {
  try {
    if (!proveedorId || !normalizarNombre(deFactura)) return;
    let q = db.from("proveedores").select("id, razon_social, nombre_fantasia, cuit").eq("id", proveedorId);
    if (sociedadId) q = q.eq("sociedad_id", sociedadId);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return;
    if (!cuitsCoinciden(cuitFactura, data.cuit)) return;
    const decision = decidirNombreFantasia(data.nombre_fantasia, deFactura, [data.razon_social, razonSocialFactura]);
    if (decision.accion === "guardar") {
      // Solo escribe si sigue vacío (por si otra carga lo guardó mientras tanto).
      let u = db.from("proveedores").update({ nombre_fantasia: decision.valor }).eq("id", proveedorId);
      if (sociedadId) u = u.eq("sociedad_id", sociedadId);
      const { data: filas, error: upErr } = await u.or("nombre_fantasia.is.null,nombre_fantasia.eq.").select("id");
      if (upErr) avisos.warning(`No pude guardar el nombre de fantasía ${decision.valor} para ${data.razon_social}: ${upErr.message || "error"}`);
      else if (Array.isArray(filas) && filas.length > 0) avisos.info(`Guardé el nombre de fantasía ${decision.valor} para el proveedor ${data.razon_social}`);
    } else if (decision.accion === "distinto") {
      avisos.warning(`La factura dice nombre de fantasía ${decision.valor}, pero el proveedor tiene ${data.nombre_fantasia}. No lo cambié.`);
    }
  } catch {
    /* opcional: nunca frena */
  }
}
