// Datos del emisor que van en el PDF de la factura de venta, según la sociedad.
// Mismos datos que usa Facturación (facturacion-content.tsx, emisorData). Si cambian, cambiar en los dos lados.
export interface EmisorFactura {
  razonSocial: string;
  cuit: string;
  cuitNumero: number;
  condicionIva: string;
  domicilio: string;
  ptoVta: number;
}

export function emisorDeSociedad(nombreSociedad: string | null | undefined): EmisorFactura {
  if (nombreSociedad === "Grupo LA") {
    return { razonSocial: "Grupo LA Servicios Integrales SAS", cuit: "30-71939604-2", cuitNumero: 30719396042, condicionIva: "Responsable Inscripto", domicilio: "", ptoVta: 10 };
  }
  return { razonSocial: "Lazzari Soluciones Industriales", cuit: "20-37930912-8", cuitNumero: 20379309128, condicionIva: "Responsable Inscripto", domicilio: "", ptoVta: 15 };
}
