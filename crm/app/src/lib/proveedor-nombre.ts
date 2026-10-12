// Nombre de un proveedor para mostrar: razón social + nombre de fantasía (ej. "STAR-TEX SA · Startex").
// La fantasía es como figura en la lista de costos; si es igual a la razón social no se repite.

type ConNombre = { razon_social?: string | null; nombre_fantasia?: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function fantasiaDistinta(p: ConNombre | null | undefined): string {
  const rs = String(p?.razon_social || "").trim();
  const nf = String(p?.nombre_fantasia || "").trim();
  if (!nf || norm(rs).includes(norm(nf))) return "";
  return nf;
}

export function nombreProveedor(p: ConNombre | null | undefined): string {
  const rs = String(p?.razon_social || "").trim();
  const nf = fantasiaDistinta(p);
  return nf ? `${rs} · ${nf}` : rs;
}

/** Para buscadores: encuentra al proveedor por razón social o por fantasía, sin acentos ni mayúsculas. */
export function proveedorCoincide(p: ConNombre | null | undefined, texto: string): boolean {
  const q = norm(texto);
  if (!q) return true;
  return norm(`${p?.razon_social || ""} ${p?.nombre_fantasia || ""}`).includes(q);
}
