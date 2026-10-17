// Asistente que hace cosas, Etapa 1 (Augusto 17/10/2026): qué puede cambiar la IA y cómo se arma el antes/después.
// La IA propone; el usuario ve ANTES → DESPUÉS y aprieta "Hacer"; queda en ia_acciones con Deshacer.
// Solo cosas de bajo riesgo: nada de ARCA, listas de precios, plata ni borrar.

export type Tabla = "clientes" | "proveedores" | "contactos" | "facturas" | "ordenes_compra" | "orden_compra_items";

/** Campos que la IA puede cambiar, por tabla, con el nombre que ve el usuario. */
export const CAMPOS_EDITABLES: Record<Tabla, Record<string, string>> = {
  clientes: {
    email: "Mail", telefono: "Teléfono", email_facturacion: "Mail de facturación", email_comprobante: "Mail para comprobantes",
    direccion: "Dirección", localidad: "Localidad", provincia: "Provincia", cp: "Código postal", notas: "Notas", alias_cbu: "Alias / CBU",
  },
  proveedores: {
    email: "Mail", telefono: "Teléfono", direccion: "Dirección", localidad: "Localidad", provincia: "Provincia", notas: "Notas",
    cbu: "CBU", alias_bancario: "Alias", banco: "Banco", titular_cuenta: "Titular de la cuenta", cuit_titular_cuenta: "CUIT del titular",
    nombre_fantasia: "Nombre de fantasía", rubro: "Rubro", marcas: "Marcas", administracion_nombre: "Contacto de administración",
  },
  contactos: { nombre: "Nombre", cargo: "Cargo", email: "Mail", telefono: "Teléfono", whatsapp: "WhatsApp", notas: "Notas" },
  facturas: { email_enviado_a: "Enviada a", nota_interna: "Nota interna" },
  ordenes_compra: { observaciones: "Observaciones" },
  orden_compra_items: { cantidad_recibida: "Llegó (cantidad)" },
};

/** Cómo se describe cada tabla en la vista previa. */
export const NOMBRE_TABLA: Record<Tabla, string> = {
  clientes: "Cliente", proveedores: "Proveedor", contactos: "Contacto", facturas: "Factura de venta",
  ordenes_compra: "OC", orden_compra_items: "Renglón de OC",
};

/** Columnas que se leen para mostrar de qué registro se trata. */
export const COLUMNAS_TITULO: Record<Tabla, string> = {
  clientes: "razon_social", proveedores: "razon_social", contactos: "nombre", facturas: "punto_venta, numero, tipo",
  ordenes_compra: "numero", orden_compra_items: "descripcion, cantidad, orden_id",
};

const NUMERICOS = new Set(["cantidad_recibida"]);
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function esTabla(t: unknown): t is Tabla {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(CAMPOS_EDITABLES, t);
}

export type Valor = string | number | null;

export interface CambioCampo {
  campo: string; etiqueta: string; antes: Valor; despues: Valor;
}

export interface Limpieza {
  cambios: Record<string, Valor>;
  /** Campos pedidos que la IA no puede tocar (se ignoran). */
  ignorados: string[];
  /** Avisos que no frenan (mail raro, CBU que no tiene 22 números…). */
  avisos: string[];
  /** Errores que hacen imposible guardar (número inválido, id inválido). */
  errores: string[];
}

/** Normaliza lo que propone la IA: solo campos permitidos, textos sin espacios de más, "" = vacío. */
export function limpiarCambios(tabla: Tabla, pedidos: Record<string, unknown>): Limpieza {
  const permitidos = CAMPOS_EDITABLES[tabla];
  const out: Limpieza = { cambios: {}, ignorados: [], avisos: [], errores: [] };
  for (const [campo, crudo] of Object.entries(pedidos || {})) {
    if (!Object.prototype.hasOwnProperty.call(permitidos, campo)) { out.ignorados.push(campo); continue; }
    const etiqueta = permitidos[campo];
    if (crudo === null || crudo === undefined || (typeof crudo === "string" && !crudo.trim())) { out.cambios[campo] = null; continue; }
    if (NUMERICOS.has(campo)) {
      const n = Number(String(crudo).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) { out.errores.push(`${etiqueta}: "${crudo}" no es una cantidad válida`); continue; }
      out.cambios[campo] = Math.round(n * 100) / 100;
      continue;
    }
    const texto = String(crudo).trim().replace(/\s+/g, " ");
    if (/email/.test(campo)) {
      const mails = texto.split(/[,;]\s*/).map((m) => m.trim()).filter(Boolean);
      const raros = mails.filter((m) => !EMAIL_RE.test(m));
      if (raros.length) out.avisos.push(`${etiqueta}: "${raros.join(", ")}" no parece un mail`);
      out.cambios[campo] = mails.join(", ");
      continue;
    }
    if (campo === "cbu") {
      const solo = texto.replace(/\D/g, "");
      if (solo.length !== 22) out.avisos.push(`CBU: tiene ${solo.length} números (un CBU tiene 22)`);
      out.cambios[campo] = solo.length === 22 ? solo : texto;
      continue;
    }
    if (campo === "cuit_titular_cuenta") {
      const solo = texto.replace(/\D/g, "");
      if (solo.length !== 11) out.avisos.push(`CUIT del titular: tiene ${solo.length} números (un CUIT tiene 11)`);
      out.cambios[campo] = solo.length === 11 ? solo : texto;
      continue;
    }
    out.cambios[campo] = texto;
  }
  return out;
}

function igual(a: unknown, b: unknown): boolean {
  const na = a === undefined || a === "" ? null : a;
  const nb = b === undefined || b === "" ? null : b;
  if (typeof na === "number" || typeof nb === "number") return na !== null && nb !== null && Math.abs(Number(na) - Number(nb)) < 0.0001;
  return String(na ?? "") === String(nb ?? "") && (na === null) === (nb === null);
}

/** Lista campo por campo (solo lo que cambia de verdad). */
export function diferencias(tabla: Tabla, actual: Record<string, unknown>, cambios: Record<string, Valor>): CambioCampo[] {
  const etiquetas = CAMPOS_EDITABLES[tabla];
  return Object.entries(cambios)
    .filter(([campo, v]) => !igual(actual[campo], v))
    .map(([campo, v]) => ({ campo, etiqueta: etiquetas[campo] || campo, antes: (actual[campo] ?? null) as Valor, despues: v }));
}

/**
 * Deshacer: vuelve al "antes" solo los campos que siguen como los dejó la IA.
 * Si alguien los cambió después, no los pisa y los informa.
 */
export function planDeshacer(actual: Record<string, unknown>, antes: Record<string, unknown>, despues: Record<string, unknown>): { revertir: Record<string, Valor>; tocadosDespues: string[] } {
  const revertir: Record<string, Valor> = {};
  const tocadosDespues: string[] = [];
  for (const campo of Object.keys(despues)) {
    if (igual(actual[campo], despues[campo])) revertir[campo] = (antes[campo] ?? null) as Valor;
    else tocadosDespues.push(campo);
  }
  return { revertir, tocadosDespues };
}

/** Texto corto para el historial: "Proveedor Nexo · Mail: compras@nexo.com". */
export function resumenCambio(tabla: Tabla, titulo: string, lista: CambioCampo[]): string {
  const partes = lista.map((c) => `${c.etiqueta}: ${c.despues === null ? "(vacío)" : String(c.despues)}`);
  return `${NOMBRE_TABLA[tabla]} ${titulo} · ${partes.join(" · ")}`.slice(0, 300);
}

/** Nombre legible del registro para la vista previa. */
export function tituloRegistro(tabla: Tabla, fila: Record<string, unknown>): string {
  if (tabla === "facturas") {
    const pv = String(fila.punto_venta ?? "").padStart(2, "0");
    return `${String(fila.tipo || "").replace(/_/g, " ").toUpperCase()} ${pv}-${fila.numero ?? ""}`.trim();
  }
  if (tabla === "orden_compra_items") return `«${String(fila.descripcion || "").slice(0, 60)}» (${fila.cantidad ?? "?"} u.)`;
  return String(fila.razon_social || fila.nombre || fila.numero || "");
}

export interface Propuesta {
  /** Id temporal para la vista previa (no es el de la base). */
  key: string;
  tipo: "editar" | "crear";
  tabla: Tabla;
  /** En "editar": el registro. En "crear": vacío hasta guardar. */
  registro_id: string | null;
  titulo: string;
  cambios: CambioCampo[];
  avisos: string[];
  /** Solo "crear contacto": a quién se le agrega. */
  entidad?: { tipo: "cliente" | "proveedor"; id: string; nombre: string };
  /** Lo que el usuario pidió (va al historial). */
  pedido?: string;
}
