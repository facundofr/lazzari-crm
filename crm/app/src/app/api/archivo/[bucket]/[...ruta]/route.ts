import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { rutaDeLinkArchivo } from "@/lib/archivo-link";

/**
 * GET /api/archivo/<bucket>/<ruta> — abre un archivo guardado (auditoría 28/10/2026, Parte D).
 * Solo con sesión (lo exige el middleware para todo /api) y con los permisos del usuario en Storage:
 * crea un link firmado que vence en 60 segundos y redirige ahí. El link guardado en la base no sirve fuera del CRM.
 */
export async function GET(req: NextRequest) {
  // Se lee la dirección tal cual llegó (codificada) para no depender de cómo Next decodifica los parámetros.
  const archivo = rutaDeLinkArchivo(req.nextUrl.pathname);
  if (!archivo) return NextResponse.json({ error: "Archivo no válido" }, { status: 400 });

  const supabase = await createSupabaseServer();
  const descargar = req.nextUrl.searchParams.get("download");
  const { data, error } = await supabase.storage.from(archivo.bucket)
    .createSignedUrl(archivo.ruta, 60, descargar !== null ? { download: descargar || true } : undefined);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "No se encontró el archivo o no tenés permiso para verlo" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
