/** Datos del emisor de cada sociedad (punto de venta, CUIT). Movido tal cual desde facturacion-content.tsx (con las opciones de punto de venta). */
export function emisorFacturacion(sociedadActiva: { nombre?: string | null } | null | undefined) {
    if (sociedadActiva?.nombre === "Grupo LA") {
      return {
        razonSocial: "Grupo LA Servicios Integrales SAS",
        cuit: "30-71939604-2",
        cuitNumero: 30719396042,
        condicionIva: "Responsable Inscripto",
        domicilio: "",
        ptoVta: 10,
        ptoVtaOpciones: [10],
      };
    }
    return {
      razonSocial: "Lazzari Soluciones Industriales",
      cuit: "20-37930912-8",
      cuitNumero: 20379309128,
      condicionIva: "Responsable Inscripto",
      domicilio: "",
      ptoVta: 15,
      ptoVtaOpciones: [15, 16],
    };
}
