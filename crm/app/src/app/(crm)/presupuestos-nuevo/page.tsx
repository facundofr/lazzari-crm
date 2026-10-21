import { redirect } from "next/navigation";

// "Presupuestos nuevo" pasó a ser /presupuestos (Augusto 20/10/2026). Links viejos y favoritos llegan acá.
export default function PresupuestosNuevoRedirect() {
  redirect("/presupuestos");
}
