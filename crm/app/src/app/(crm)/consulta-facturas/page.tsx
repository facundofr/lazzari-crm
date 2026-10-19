"use client";

// Consulta de facturas (SOLO LECTURA), para todos los roles. La pantalla está en components/facturas-consulta
// (la usa también Finanzas Lazza, con la vista "Todas" y más filtros).
import { Header } from "@/components/layout/header";
import { FacturasConsulta } from "@/components/facturas-consulta";

export default function ConsultaFacturasPage() {
  return (
    <>
      <Header title="Facturas" subtitle="Consulta de facturas de venta y de compra (solo lectura)" />
      <FacturasConsulta />
    </>
  );
}
