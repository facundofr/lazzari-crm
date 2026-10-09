/**
 * Supabase devuelve como máximo 1000 filas por consulta. Esto trae todas, de a páginas.
 * `armar` tiene que devolver una consulta NUEVA cada vez (con su .order para que el paginado sea estable).
 */
export async function traerTodo<T = any>(armar: () => any, paso = 1000, maximo = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; desde < maximo; desde += paso) {
    const { data, error } = await armar().range(desde, desde + paso - 1);
    if (error) throw error;
    out.push(...((data || []) as T[]));
    if (!data || data.length < paso) break;
  }
  return out;
}
