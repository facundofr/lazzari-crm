// Pendientes centralizados (pantalla /pendientes): agrupar por área y armar el texto de "Copiar respuestas".

export type PendienteTipo = "hacer" | "responder";

export interface PendienteItem {
  id: string;
  texto: string;
  area: string | null;
  tipo: PendienteTipo | null;
  link: string | null;
  respuesta: string | null;
  completado: boolean;
  fecha_vencimiento: string | null;
  created_at: string;
}

/** Orden fijo de las áreas; las que no están acá van al final, por nombre. */
export const AREAS_PENDIENTES = [
  "Pagos",
  "Cobros",
  "Compras y proveedores",
  "Gastos fijos",
  "Bancos y créditos",
  "Sistema",
  "Decisiones",
] as const;

export const AREA_SIN_ASIGNAR = "Otros";

export function areaDe(p: Pick<PendienteItem, "area">): string {
  return (p.area || "").trim() || AREA_SIN_ASIGNAR;
}

function ordenArea(area: string): number {
  const i = (AREAS_PENDIENTES as readonly string[]).indexOf(area);
  return i === -1 ? AREAS_PENDIENTES.length : i;
}

/** Agrupa por área en el orden fijo. Dentro de cada área: primero los vencidos/con fecha, después por fecha de carga. */
export function agruparPendientes<T extends PendienteItem>(items: T[]): { area: string; items: T[] }[] {
  const grupos = new Map<string, T[]>();
  for (const p of items) {
    const a = areaDe(p);
    if (!grupos.has(a)) grupos.set(a, []);
    grupos.get(a)!.push(p);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => ordenArea(a) - ordenArea(b) || a.localeCompare(b))
    .map(([area, lista]) => ({
      area,
      items: [...lista].sort((x, y) =>
        (x.fecha_vencimiento ? 0 : 1) - (y.fecha_vencimiento ? 0 : 1)
        || (x.fecha_vencimiento || "").localeCompare(y.fecha_vencimiento || "")
        || x.created_at.localeCompare(y.created_at)),
    }));
}

/**
 * Texto para pegarle a Claude: los pendientes sin terminar, agrupados por área y numerados,
 * con su respuesta o "(sin responder)". Con `soloRespondidos` deja afuera los que no tienen respuesta.
 */
export function textoRespuestas(items: PendienteItem[], opts: { sociedad?: string; soloRespondidos?: boolean } = {}): string {
  const abiertos = items.filter((p) => !p.completado && (!opts.soloRespondidos || (p.respuesta || "").trim()));
  const lineas: string[] = [`Respuestas de Pendientes${opts.sociedad ? ` (${opts.sociedad})` : ""}:`];
  let n = 0;
  for (const g of agruparPendientes(abiertos)) {
    lineas.push("", `## ${g.area}`);
    for (const p of g.items) {
      n += 1;
      const r = (p.respuesta || "").trim();
      lineas.push(`${n}. ${p.texto.trim()}`);
      lineas.push(r ? `   → ${r.replace(/\s*\n\s*/g, " / ")}` : "   → (sin responder)");
    }
  }
  if (n === 0) lineas.push("", "(no hay pendientes abiertos)");
  return lineas.join("\n");
}

/** Solo links internos del CRM (empiezan con "/"); cualquier otra cosa no se usa como link. */
export function linkInterno(link: string | null | undefined): string | null {
  const l = (link || "").trim();
  return l.startsWith("/") && !l.startsWith("//") ? l : null;
}
