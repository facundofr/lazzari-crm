// Ventana única de remitos (Remitar del PR, Nuevo remito y Editar): cuentas puras, sin base de datos.
// - Valor declarado sugerido = precio de venta SIN IVA de lo que se remite (solo sugerencia; por defecto el valor es 0).
// - Renglones que se pasan de lo pendiente: aviso, nunca bloquea.
// - Reparto por sucursal: un remito por cada sucursal elegida.
// - OC del cliente usada en el remito anterior, si era distinta de la del PR (para avisar).

export interface RenglonVentana {
  key: string;
  presupuesto_item_id: string | null;
  descripcion: string;
  unidad: string;
  orden: number;
  cantidad: number;
  /** Lo que falta entregar del renglón del PR (null = renglón libre, sin PR). */
  pendiente: number | null;
  /** Precio de venta unitario sin IVA (null = no se sabe). */
  precio: number | null;
  sucursal_id: string | null;
}

const n = (v: unknown) => Number(v) || 0;
const redondo = (v: number, dec = 2) => Math.round(v * 10 ** dec) / 10 ** dec;

/** Suma cantidad × precio sin IVA de lo que se remite. Los renglones sin precio no suman. */
export function valorSugerido(renglones: Pick<RenglonVentana, "cantidad" | "precio">[]): number {
  return redondo(renglones.reduce((s, r) => s + (r.precio != null && n(r.cantidad) > 0 ? n(r.cantidad) * n(r.precio) : 0), 0));
}

/** Renglones donde se remite más de lo que falta entregar (solo aviso). */
export function excesos(renglones: Pick<RenglonVentana, "key" | "descripcion" | "cantidad" | "pendiente">[]): { key: string; descripcion: string; cantidad: number; pendiente: number }[] {
  return renglones
    .filter((r) => r.pendiente != null && n(r.cantidad) > n(r.pendiente) + 1e-9)
    .map((r) => ({ key: r.key, descripcion: r.descripcion, cantidad: n(r.cantidad), pendiente: n(r.pendiente) }));
}

/**
 * Agrupa los renglones con cantidad > 0 en un remito por sucursal.
 * Sin "repartir": todos van a la sucursal única (o a ninguna). Con "repartir": cada renglón a la suya.
 * El orden de los grupos sigue el primer renglón de cada sucursal.
 */
export function agruparPorSucursal<T extends Pick<RenglonVentana, "cantidad" | "sucursal_id">>(renglones: T[], repartir: boolean, sucursalUnica: string | null): { sucursal_id: string | null; renglones: T[] }[] {
  const grupos = new Map<string, { sucursal_id: string | null; renglones: T[] }>();
  for (const r of renglones) {
    if (!(n(r.cantidad) > 0)) continue;
    const suc = repartir ? (r.sucursal_id || null) : (sucursalUnica || null);
    const k = suc || "__ninguna";
    if (!grupos.has(k)) grupos.set(k, { sucursal_id: suc, renglones: [] });
    grupos.get(k)!.renglones.push(r);
  }
  return [...grupos.values()];
}

/** OC del cliente del último remito del PR, si es distinta de la que tiene el PR (null si no hay nada que avisar). */
export function ocAnteriorDistinta(ocPR: string | null | undefined, remitosAnteriores: { fecha: string | null; created_at?: string | null; oc_cliente: string | null }[]): string | null {
  const limpia = (t: string | null | undefined) => (t || "").trim();
  const ultimo = [...remitosAnteriores]
    .sort((a, b) => `${b.fecha || ""}${b.created_at || ""}`.localeCompare(`${a.fecha || ""}${a.created_at || ""}`))
    .find((r) => limpia(r.oc_cliente));
  if (!ultimo) return null;
  return limpia(ultimo.oc_cliente).toLowerCase() === limpia(ocPR).toLowerCase() ? null : limpia(ultimo.oc_cliente);
}

/** Número del comprobante con CAI: "0015-00000077" (null si el remito no tiene CAI). */
export function numeroCAI(puntoVenta: number | null | undefined, nroComprobante: number | null | undefined): string | null {
  if (!puntoVenta || !nroComprobante) return null;
  return `${String(puntoVenta).padStart(4, "0")}-${String(nroComprobante).padStart(8, "0")}`;
}

/** Descripción corta para la lista: primer artículo y "+N más". */
export function descripcionCorta(items: { descripcion?: string | null; orden?: number | null }[]): { corta: string; todas: string } {
  const orden = [...items].sort((a, b) => n(a.orden) - n(b.orden)).map((i) => (i.descripcion || "").trim()).filter(Boolean);
  if (!orden.length) return { corta: "", todas: "" };
  return { corta: orden.length > 1 ? `${orden[0]} +${orden.length - 1} más` : orden[0], todas: orden.join("\n") };
}

/** Número que se ve del remito: el mismo que sale impreso en el PDF ("0018-00000082" si tiene CAI; si no, el interno R-2026-NNNN). */
export function numeroRemito(r: { numero?: string | null; punto_venta_cai?: number | null; nro_comprobante_cai?: number | null }): string {
  return numeroCAI(r.punto_venta_cai, r.nro_comprobante_cai) || r.numero || "";
}

/** Nombre del PDF: "Remito 0018-00000082 - SYNERTECH INDUSTRIAS S.A.pdf" (sin caracteres que Windows no acepta). */
export function nombrePDFRemito(numero: string, cliente?: string | null): string {
  const limpio = (t: string) => t.replace(/[\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const emp = limpio(cliente || "").slice(0, 60).replace(/\.+$/, "");
  return `Remito ${limpio(numero)}${emp ? ` - ${emp}` : ""}.pdf`;
}
