import { redirect } from "next/navigation";

// "Compras nueva" se borró (Augusto 29/10/2026): todo lo de compras está en Compras Lazza. Links viejos llegan acá.
export default function ComprasNuevaRedirect() {
  redirect("/compras-lazza");
}
