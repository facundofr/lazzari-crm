// Estado del cheque según el banco (reportes eCheq, columna echeqs.estado_banco) frente al estado del CRM (24/10/2026, Augusto).
// El banco NO corrige al CRM: solo se marca cuando el banco dice algo definitivo (pagado, rechazado, anulado) y el CRM no lo tiene así,
// para que una persona lo mire. Los estados intermedios del banco (ACTIVO, PRESENTADO, CUSTODIA…) se muestran pero no se comparan.
// Prueba: scripts/test-cheques-estado-banco.ts
export function diferenciaConBanco(direccion: "emitido" | "recibido", estadoCrm: string, estadoBanco: string | null | undefined): string | null {
  const b = String(estadoBanco || "").trim().toUpperCase();
  if (!b) return null;
  const crm = String(estadoCrm || "").trim().toLowerCase();
  if (b === "RECHAZADO" && crm !== "rechazado") return "El banco lo tiene rechazado y el CRM no.";
  if (b === "ANULADO" && crm !== "anulado") return "El banco lo tiene anulado y el CRM no.";
  if (b === "PAGADO") {
    if (direccion === "emitido" && (crm === "pendiente" || crm === "entregado")) return "El banco ya lo pagó y el CRM lo tiene sin cobrar.";
    if (direccion === "recibido" && crm === "en_cartera") return "El banco lo tiene pagado y el CRM lo tiene en cartera.";
  }
  return null;
}
