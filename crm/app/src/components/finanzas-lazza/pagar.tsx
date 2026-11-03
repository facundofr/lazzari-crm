"use client";

// Finanzas Lazza → Pagar (19/10/2026). NO es una OP nueva: abre la MISMA ventana de Finanzas
// (components/orden-pago-nueva.tsx: retención RG 830, NC, US$ en pesos, comprobantes con IA, cheques de cartera,
// pago parcial y "Guardar y enviar", que abre el mail de la OP). Acá solo se elige el proveedor.
// Lugar central: tarjeta "Pagar" del inicio (FinanzasLazzaPagar: proveedores con facturas a pagar → Pagar). Atajos a la
// misma ventana: Cuentas corrientes (ficha del proveedor, con lo tildado), Vencimientos (facturas de compra, con esa
// factura tildada) y Órdenes de pago ("Nueva OP").
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Wallet } from "lucide-react";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { DataTable, type Column } from "@/components/ui/data-table";
import { OrdenPagoNueva } from "@/components/orden-pago-nueva";
import { EnviarOrdenPago } from "./orden-pago-doc";
import { proveedoresAPagar, type ProveedorAPagar } from "@/lib/finanzas-lazza";
import { traerDeudas } from "./datos";

/** La ventana de OP de Finanzas; con "Guardar y enviar" sigue con el mail de la OP. */
export function PagarProveedor({ sociedadId, proveedorId, facturaIds, pagoInicial, proveedorSugerido, onClose, onPagado }: {
  sociedadId: string;
  /** Sin proveedor: se elige en la misma ventana (Órdenes de pago → "Nueva OP"). */
  proveedorId?: string | null;
  /** Facturas que vienen tildadas. */
  facturaIds?: string[];
  /** Desde una línea del banco (02/11/2026): transferencia con el importe y la fecha de la línea. */
  pagoInicial?: { monto: number; fecha: string };
  /** Proveedor con el mismo CUIT que la línea del banco (se elige con un clic). */
  proveedorSugerido?: { id: string; nombre: string } | null;
  onClose: () => void;
  /** Después de registrar el pago (para recargar la lista de atrás). */
  onPagado: () => void;
}) {
  const [enviar, setEnviar] = useState<string | null>(null);
  // La lista de atrás se recarga al terminar (después del mail): si se recargara antes, podría cerrar esta ventana.
  const terminar = () => { onPagado(); onClose(); };
  if (enviar) return <EnviarOrdenPago opId={enviar} onClose={terminar} />;
  return (
    <OrdenPagoNueva sociedadId={sociedadId} proveedorId={proveedorId || undefined} facturaIds={facturaIds} pagoInicial={pagoInicial} proveedorSugerido={proveedorSugerido} onClose={onClose}
      onCreada={({ opId, enviar: mandar }) => { if (mandar && opId) setEnviar(opId); else terminar(); }} />
  );
}

// ── Pantalla Pagar (tarjeta del inicio) ─────────────────────────────

const montos = (m: { ARS: number; USD: number }, cero = "—") => {
  const partes = [m.ARS >= 0.01 ? formatCurrency(m.ARS) : null, m.USD >= 0.01 ? formatCurrency(m.USD, "USD") : null].filter(Boolean);
  return partes.length ? partes.join(" + ") : cero;
};
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function FinanzasLazzaPagar({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<ProveedorAPagar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [pagando, setPagando] = useState<{ id: string | null } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setFilas(null); setError(null);
    traerDeudas(sociedadId, hoy)
      .then((d) => { if (vivo) setFilas(proveedoresAPagar(d.vencimientos)); })
      .catch((e) => { console.error("Finanzas Lazza · Pagar:", e); if (vivo) setError("No se pudo cargar lo que hay para pagar. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);

  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (filas || [])
    .filter((f) => !q || sinAcentos(f.nombre).includes(q))
    .filter((f) => !soloVencidos || f.dias < 0)
    .map((f) => ({ ...f, id: f.proveedorId })), [filas, q, soloVencidos]);
  const total = useMemo(() => {
    const t = { saldo: { ARS: 0, USD: 0 }, vencido: { ARS: 0, USD: 0 } };
    for (const f of visibles) { t.saldo.ARS += f.saldo.ARS; t.saldo.USD += f.saldo.USD; t.vencido.ARS += f.vencido.ARS; t.vencido.USD += f.vencido.USD; }
    return t;
  }, [visibles]);

  // Orden por plata: US$ a un dólar de referencia solo para ordenar.
  const enPesos = (m: { ARS: number; USD: number }) => m.ARS + m.USD * 1500;
  const cols: Column<ProveedorAPagar & { id: string }>[] = [
    { key: "nombre", label: "Proveedor", sortable: true, sortValue: (f) => f.nombre, render: (f) => <span>{f.nombre}<span className="block text-[10px] text-zinc-400">{f.facturas} factura{f.facturas === 1 ? "" : "s"}</span></span> },
    { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => enPesos(f.saldo), className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono font-semibold">{montos(f.saldo)}</span> },
    { key: "vencido", label: "Vencido", sortable: true, sortValue: (f) => enPesos(f.vencido), className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono ${f.vencido.ARS || f.vencido.USD ? "text-red-600" : "text-zinc-400"}`}>{montos(f.vencido)}</span> },
    { key: "vence", label: "Más vieja vence", sortable: true, sortValue: (f) => f.primerVence, render: (f) => (
      <span className={`whitespace-nowrap ${f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : ""}`}>
        {formatDate(f.primerVence)}<span className="block text-[10px] font-normal text-zinc-400">{f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "hoy" : `en ${f.dias} d`}</span>
      </span>
    ) },
    { key: "accion", label: "", render: (f) => (
      <button type="button" onClick={(e) => { e.stopPropagation(); setPagando({ id: f.proveedorId }); }}
        className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600">
        <Wallet className="h-3.5 w-3.5" /> Pagar
      </button>
    ) },
  ];

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setPagando({ id: null })}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
          <Wallet className="h-4 w-4" /> Nueva OP
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 pl-8 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Solo con vencidas
        </label>
      </div>
      {!filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={cols} data={visibles} onRowClick={(f) => setPagando({ id: f.proveedorId })} emptyMessage="No hay proveedores con facturas para pagar" />
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} proveedores</span>
            <span>A pagar <b className="font-mono text-orange-700 dark:text-orange-400">{montos(total.saldo, "$ 0")}</b></span>
            <span>Vencido <b className="font-mono text-red-600">{montos(total.vencido, "$ 0")}</b></span>
          </div>
        </div>
      )}
      {pagando && (
        <PagarProveedor sociedadId={sociedadId} proveedorId={pagando.id}
          onClose={() => setPagando(null)} onPagado={() => setRecarga((n) => n + 1)} />
      )}
    </div>
  );
}
