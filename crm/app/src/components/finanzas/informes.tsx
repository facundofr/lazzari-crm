"use client";

/**
 * Finanzas > Informes: riesgo BCRA de clientes y de proveedores, y (próximamente) CUIT con facturas apócrifas.
 * Todo es información para decidir: nunca frena una venta, una compra ni un pago.
 */
import { useState } from "react";
import { RiesgoBcra } from "@/components/finanzas/riesgo-bcra";
import { ShieldAlert } from "lucide-react";

type Informe = "bcra_clientes" | "bcra_proveedores" | "apocrifos";

const INFORMES: { id: Informe; label: string }[] = [
  { id: "bcra_clientes", label: "BCRA clientes" },
  { id: "bcra_proveedores", label: "BCRA proveedores" },
  { id: "apocrifos", label: "Facturas apócrifas" },
];

export function InformesFinanzas() {
  const [informe, setInforme] = useState<Informe>("bcra_clientes");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {INFORMES.map(i => (
          <button key={i.id} onClick={() => setInforme(i.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${informe === i.id ? "bg-orange-500 text-white" : "bg-white text-zinc-600 hover:text-orange-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {i.label}
          </button>
        ))}
      </div>
      {informe === "bcra_clientes" && <RiesgoBcra key="cliente" tipo="cliente" />}
      {informe === "bcra_proveedores" && <RiesgoBcra key="proveedor" tipo="proveedor" />}
      {informe === "apocrifos" && (
        <div className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold">Todavía no está armado.</p>
            <p className="mt-1 text-xs text-zinc-500">Va a cruzar los CUIT de tus clientes y proveedores contra la base de facturas apócrifas de ARCA y avisar si alguno aparece. Solo avisa, nunca frena. Falta confirmar de dónde se toman los datos.</p>
          </div>
        </div>
      )}
    </div>
  );
}
