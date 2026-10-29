import { redirect } from "next/navigation";

// La consulta de facturas vieja se borró (Augusto 29/10/2026): "Facturas" del menú (/facturas) es la de Finanzas. Links viejos llegan acá.
export default function ConsultaFacturasRedirect() {
  redirect("/facturas");
}
