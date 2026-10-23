"use client";

import { FacturacionContent } from "./facturacion-content";

// Facturación (nota de crédito, cobro de una factura puntual: ?factura=<id>&accion=nc|cobro).
// Mudanza de Finanzas (23/10/2026): ya no redirige a Finanzas; es la pantalla de siempre, en su propia dirección.
export default function FacturacionPage() {
  return <FacturacionContent autoSelectId={typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("factura") || undefined : undefined} />;
}
