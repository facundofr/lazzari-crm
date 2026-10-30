// Orden del menú que elige Augusto (29/10/2026: "el orden que elijo yo lo ven todos"). Botón "Ordenar menú" en el menú,
// solo super_admin. Se guarda en `configuracion` (clave `orden_menu`, sin sociedad) como lista de rutas; lo lee
// /api/orden-menu para todos los usuarios. Sin la fila, el menú queda en el orden de fábrica de sidebar.tsx.

export const CLAVE_ORDEN_MENU = "orden_menu";

/** Lista guardada válida: rutas que empiezan con "/", sin repetir. Cualquier otra cosa = sin orden guardado. */
export function ordenValido(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const rutas = v.filter((x): x is string => typeof x === "string" && x.startsWith("/") && x.length <= 100);
  return rutas.length ? [...new Set(rutas)].slice(0, 100) : null;
}

/**
 * Ordena las pantallas según la lista guardada. Una pantalla que no está en la lista (una nueva que se agregó
 * después de ordenar) queda debajo de la que tenía arriba en el orden de fábrica, así nunca desaparece del menú.
 */
export function aplicarOrdenMenu<T extends { href: string }>(items: T[], orden: readonly string[] | null | undefined): T[] {
  if (!orden?.length) return items;
  const porRuta = new Map(items.map((i) => [i.href, i]));
  const res: T[] = [];
  for (const ruta of orden) {
    const item = porRuta.get(ruta);
    if (item && !res.includes(item)) res.push(item);
  }
  items.forEach((item, idx) => {
    if (res.includes(item)) return;
    let pos = 0;
    for (let j = idx - 1; j >= 0; j--) {
      const k = res.indexOf(items[j]);
      if (k >= 0) { pos = k + 1; break; }
    }
    res.splice(pos, 0, item);
  });
  return res;
}

/** Sube (-1) o baja (+1) un elemento; en las puntas no hace nada. */
export function moverEnLista<T>(lista: readonly T[], indice: number, paso: -1 | 1): T[] {
  const destino = indice + paso;
  if (indice < 0 || indice >= lista.length || destino < 0 || destino >= lista.length) return [...lista];
  const copia = [...lista];
  [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
  return copia;
}
