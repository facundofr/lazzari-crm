import { redirect } from "next/navigation";

// "Personalización" se borró (Augusto 29/10/2026): nunca se usó; sus tablas también (migración 20261029180000). Links viejos llegan acá.
export default function PersonalizacionRedirect() {
  redirect("/compras-lazza");
}
