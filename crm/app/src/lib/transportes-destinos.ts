// Catálogo de transportistas: buscador por nombre o por destino ("córdoba" → los que van a Córdoba).
// Sin distinguir mayúsculas ni tildes; si se escriben varias palabras, tienen que estar todas.

export const sinTildes = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function filtrarPorNombreODestino<T extends { nombre: string; razon_social?: string | null; destinos?: string | null }>(
  lista: T[],
  texto: string,
): T[] {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return lista;
  return lista.filter((t) => {
    const campo = sinTildes(`${t.nombre} ${t.razon_social || ""} ${t.destinos || ""}`);
    return palabras.every((p) => campo.includes(p));
  });
}
