import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Anota una llamada a la IA para el contador del mes (Configuración > Uso de IA).
 * Nunca tira error ni frena nada: si no se puede anotar (o la tabla todavía no existe), se ignora.
 */
export async function registrarUsoIA(
  funcion: string,
  modelo: string | undefined,
  usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined,
): Promise<void> {
  try {
    if (!usage) return;
    const supabase = (await createSupabaseServer()) as any;
    await supabase.from("ia_uso").insert({
      funcion,
      modelo: modelo || null,
      tokens_entrada: Number(usage.input_tokens) || 0,
      tokens_salida: Number(usage.output_tokens) || 0,
    });
  } catch {
    /* el contador es solo informativo */
  }
}
