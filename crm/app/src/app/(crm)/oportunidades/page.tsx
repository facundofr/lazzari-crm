import { redirect } from "next/navigation";

// "Oportunidades" se borró (Augusto 28/10/2026): las de cada cliente siguen en su Ficha 360. Links viejos llegan acá.
export default function OportunidadesRedirect() {
  redirect("/clientes");
}
