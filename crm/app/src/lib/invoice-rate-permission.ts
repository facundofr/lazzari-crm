// Server callers must supply the email returned by auth.getUser(), never request data.
export function canOverrideInvoiceRate(email?: string | null) {
  return email?.trim().toLowerCase() === "augusto@lazzari.com.ar";
}
