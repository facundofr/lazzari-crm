// Mayúsculas solo cuando hace falta (Augusto 17/10/2026), en TODO el sistema y sin tocar los datos viejos:
// - Al LEER de la base: nombres de clientes, proveedores y contactos y descripciones de artículos se muestran prolijos.
// - Al GUARDAR en esas tablas (alta o cambio directo): se guardan ya prolijos, así lo nuevo queda bien.
// Las RPC (plata, conciliación, presupuestos atómicos) no se tocan al guardar. Reglas en lib/mayusculas.ts.

import { arreglarMayusculas } from "@/lib/mayusculas";

const SE_TOCA = /razon_social|nombre_fantasia|descripcion|localidad|provincia|direccion|"nombre"/;

/** Tablas donde lo que se guarda pasa ya prolijo. Lista de costos y productos NO (vienen del catálogo). */
const TABLAS_GUARDAR = new Set([
  "clientes", "proveedores", "contactos", "presupuesto_items", "orden_compra_items", "remito_items", "muestra_envio_items",
]);

function tablaDeUrl(url: string): { tabla: string; rpc: boolean } | null {
  const m = url.match(/\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/);
  return m ? { tabla: m[2], rpc: !!m[1] } : null;
}

/** fetch para el cliente de Supabase: arregla las mayúsculas de lo que entra y de lo que se guarda. */
export function fetchConMayusculas(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const destino = tablaDeUrl(url);
    if (!destino) return base(input, init);
    const metodo = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();

    // Guardar (alta o cambio directo en la tabla).
    if (!destino.rpc && (metodo === "POST" || metodo === "PATCH") && TABLAS_GUARDAR.has(destino.tabla) && typeof init?.body === "string" && SE_TOCA.test(init.body)) {
      try {
        init = { ...init, body: JSON.stringify(arreglarMayusculas(JSON.parse(init.body), destino.tabla)) };
      } catch { /* si no es JSON, va como estaba */ }
    }

    const res = await base(input, init);
    if (!res.ok || metodo === "HEAD" || res.status === 204) return res;
    if (!(res.headers.get("content-type") || "").includes("json")) return res;
    const texto = await res.text();
    let cuerpo = texto;
    if (texto && SE_TOCA.test(texto)) {
      try { cuerpo = JSON.stringify(arreglarMayusculas(JSON.parse(texto), destino.tabla)); } catch { cuerpo = texto; }
    }
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(cuerpo, { status: res.status, statusText: res.statusText, headers });
  };
}
