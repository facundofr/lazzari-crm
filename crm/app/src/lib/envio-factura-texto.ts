// Línea chiquita "a quién y cuándo se envió" la factura (Augusto 16/10/2026: "en chiquito, de manera delicada").

/** Destinatarios cortos (solo lo de antes de la @) para mostrar; el texto completo va en el title. */
export function destinatariosCortos(enviadoA: string | null | undefined): string {
  const a = String(enviadoA || "").trim();
  if (!a) return "";
  if (/por fuera/i.test(a)) return "por fuera";
  return a.split(",").map((e) => e.trim()).filter(Boolean).map((e) => e.split("@")[0]).join(", ");
}

/** "16/10 · seedspayables.argentina, german.mansilla-1" (fecha dd/mm en hora de Argentina). */
export function textoEnvioCorto(enviadoAt: string | null | undefined, enviadoA: string | null | undefined): string {
  if (!enviadoAt) return "";
  const f = new Date(enviadoAt);
  const fecha = Number.isNaN(f.getTime()) ? "" : f.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  const quien = destinatariosCortos(enviadoA);
  return [fecha, quien].filter(Boolean).join(" · ");
}
