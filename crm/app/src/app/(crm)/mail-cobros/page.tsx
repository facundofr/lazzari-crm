import { redirect } from "next/navigation";

// "Mail y cobros" pasó a Finanzas > Hoy > Correo (16/10/2026): ahí cada mail dice en qué quedó en el sistema.
// Esta dirección queda para los links viejos. 26/10/2026: Finanzas vieja se cerró y el agente de correo se apagó → va a Finanzas.
export default function MailCobrosPage() {
  redirect("/finanzas");
}
