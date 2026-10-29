import { redirect } from "next/navigation";

// "Importaciones" se borró (Augusto 29/10/2026): todo lo de compras está en Compras Lazza. Links viejos llegan acá.
export default function ImportacionesRedirect() {
  redirect("/compras-lazza");
}
