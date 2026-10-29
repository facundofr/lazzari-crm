import { redirect } from "next/navigation";

// "Ventas" se borró (Augusto 28/10/2026): facturar está en Finanzas > Facturar. Links viejos llegan acá.
export default function VentasRedirect() {
  redirect("/finanzas?seccion=facturar");
}
