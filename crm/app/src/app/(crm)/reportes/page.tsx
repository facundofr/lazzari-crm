import { redirect } from "next/navigation";

// "Reportes" se borró (Augusto 28/10/2026): se usa Finanzas > Reportes. Links viejos llegan acá.
export default function ReportesRedirect() {
  redirect("/finanzas?seccion=reportes");
}
