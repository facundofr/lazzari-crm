"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// La Facturación vieja se borró (Augusto 29/10/2026): anular sin CAE, revertir y el Registro FCE pasaron a la ficha de la
// factura (Facturas y Finanzas > Facturas); facturación masiva, copiar resumen y "recibida por el cliente" no se llevaron.
// Links viejos (/facturacion?factura=<id>) abren esa factura en Facturas.
export default function FacturacionRedirect() {
  const router = useRouter();
  useEffect(() => {
    const factura = new URLSearchParams(window.location.search).get("factura");
    router.replace(factura ? `/facturas?factura=${encodeURIComponent(factura)}` : "/facturas");
  }, [router]);
  return null;
}
