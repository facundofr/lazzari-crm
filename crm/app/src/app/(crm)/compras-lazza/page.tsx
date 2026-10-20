"use client";

/**
 * Compras Lazza (Augusto 16/10): versión MUY simple de Compras, para probarla ellos. Lo de Compras nueva no se toca.
 * - Lista de OC con los mismos filtros (components/compras-lista-oc) + 📋 Copiar para WhatsApp.
 * - Las OC se arman solas al aprobar el PR (como siempre).
 * - El número de la OC la abre para editarla (components/compras-lazza-oc), con cambio de proveedor.
 * - "Llegó": Completo o Parcial por artículo (components/compras-lazza-llego).
 * - "Cargar factura": simple y permisiva (components/compras-lazza-factura). Desde el 19/10 la factura ya no se ata a ninguna OC:
 *   va directo a la cuenta corriente del proveedor (lo ya vinculado queda como está). La OC solo controla que llegue todo.
 * La marca 👁 Observar se sacó (Augusto 19/10); las columnas quedan en la base.
 * - "Nueva OC" a mano, sin PR (components/compras-lazza-nueva-oc). Abriendo la OC: operador, Anular / Reactivar (Augusto 19/10).
 * Solo la ven en el menú los que tienen la casilla "Compras Lazza" (columna prueba_compras_nueva). La pantalla vieja "Compras" quedó fuera del menú.
 */
import { useState } from "react";
import { Header } from "@/components/layout/header";
import { useUser } from "@/lib/auth-context";
import ComprasListaOC, { type OcLazza } from "@/components/compras-lista-oc";
import ComprasLazzaLlego from "@/components/compras-lazza-llego";
import ComprasLazzaFactura from "@/components/compras-lazza-factura";
import ComprasLazzaOc from "@/components/compras-lazza-oc";
import ComprasLazzaNuevaOc from "@/components/compras-lazza-nueva-oc";
import { FileUp, Plus } from "lucide-react";

export default function ComprasLazzaPage() {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [factura, setFactura] = useState(false);
  const [nueva, setNueva] = useState(false);
  const [llego, setLlego] = useState<OcLazza | null>(null);
  // El número de la OC abre la OC para editarla (proveedor, artículos, cantidades, precios).
  const [abrir, setAbrir] = useState<OcLazza | null>(null);

  return (
    <div>
      <Header title="Compras Lazza" subtitle="Las OC se arman solas al aprobar un PR. Marcás lo que llegó. Las facturas se cargan aparte." />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex justify-end gap-2">
          <button onClick={() => setNueva(true)} disabled={!sociedadId}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600 dark:hover:bg-zinc-800"
            title="OC a mano, sin PR (stock, insumos, complementaria)">
            <Plus className="h-4 w-4" /> Nueva OC
          </button>
          <button onClick={() => setFactura(true)} disabled={!sociedadId}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            title="Subí la factura o nota de crédito del proveedor: va a su cuenta corriente">
            <FileUp className="h-4 w-4" /> Cargar factura
          </button>
        </div>
        <ComprasListaOC sociedadId={sociedadId} lazza={{ onLlego: setLlego, onAbrir: setAbrir }} />
      </div>

      {nueva && sociedadId && <ComprasLazzaNuevaOc sociedadId={sociedadId} onClose={() => setNueva(false)} />}
      {factura && sociedadId && <ComprasLazzaFactura sociedadId={sociedadId} onClose={() => setFactura(false)} />}
      {abrir && sociedadId && <ComprasLazzaOc sociedadId={sociedadId} oc={abrir} onClose={() => setAbrir(null)} />}
      {llego && sociedadId && <ComprasLazzaLlego sociedadId={sociedadId} oc={llego} onClose={() => setLlego(null)} />}
    </div>
  );
}
