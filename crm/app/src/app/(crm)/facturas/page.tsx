"use client";

// Facturas del menú (Augusto 20/10/2026): la misma pantalla que Finanzas Lazza → Facturas, para que la vean los vendedores.
// Ventas y Compras de todos; ver, descargar y enviar (factura, OP con sus adjuntos y recibos). Sin facturar, cobrar, pagar
// ni cambiar vencimientos: eso solo super_admin. La consulta vieja (/consulta-facturas) sigue por link.
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import { FinanzasLazzaFacturas } from "@/components/finanzas-lazza/facturas";

export default function FacturasPage() {
  const { role, sociedadActiva, loading } = useUser();
  if (loading) return <Header title="Facturas" />;
  return (
    <div>
      <Header title="Facturas" subtitle={sociedadActiva?.nombre || undefined} />
      <div className="space-y-3 px-3 py-3 sm:px-4">
        {sociedadActiva?.id
          ? <FinanzasLazzaFacturas key={sociedadActiva.id} sociedadId={sociedadActiva.id} ladoInicial="venta" soloLectura={role !== "super_admin"} />
          : <p className="py-6 text-sm text-zinc-500">Elegí una sociedad.</p>}
      </div>
    </div>
  );
}
