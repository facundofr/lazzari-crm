// Mail que manda el CRM (api/email/send): remitente y adjuntos permitidos. Funciones puras (auditoría H38).
// Prueba: npx tsx scripts/test-email-remitente.ts

const DOMINIO_PROPIO = "lazzari.com.ar";

/**
 * Remitente "Nombre <mail>" para PR, remitos y OC, armado con el usuario que entró (nunca con lo que manda el navegador).
 * Solo vale un mail @lazzari.com.ar (el único dominio desde el que se puede mandar); si no, null → sale de administracion@.
 */
export function remitenteDelUsuario(email: string | null | undefined, nombre: string | null | undefined): string | null {
  const mail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@<>"]+@[^\s@<>"]+$/.test(mail) || !mail.endsWith("@" + DOMINIO_PROPIO)) return null;
  const limpio = String(nombre || "").replace(/[<>"\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return `${limpio || "Lazzari"} <${mail}>`;
}

/** Adjunto por link: solo se baja si es de nuestro Storage (mismo host que NEXT_PUBLIC_SUPABASE_URL, por https). */
export function esLinkDeNuestroStorage(url: string | null | undefined, supabaseUrl: string | null | undefined): boolean {
  try {
    const u = new URL(String(url || ""));
    const nuestro = new URL(String(supabaseUrl || ""));
    return u.protocol === "https:" && u.host === nuestro.host && u.pathname.startsWith("/storage/v1/object/");
  } catch {
    return false;
  }
}
