"use client";

// Finanzas Lazza → Vencimientos: SOLO facturas de venta y de compra con saldo, por fecha (sin cheques, fijos ni cuotas).
// Saldos con la misma regla que Finanzas (lib/saldo-clientes y la de proveedores). Solo lectura.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { filtrarVencimientos, type FilaVencimiento } from "@/lib/finanzas-lazza";
import { traerDeudas } from "./datos";

type Filtro = "todo" | "venta" | "compra";

type Fila = FilaVencimiento & { facturaId: string };

const COLUMNAS: Column<Fila>[] = [
  { key: "fecha", label: "Fecha de factura", sortable: true, sortValue: (f) => f.fecha, render: (f) => <span className="whitespace-nowrap">{formatDate(f.fecha)}</span> },
  { key: "vence", label: "Vence", sortable: true, sortValue: (f) => f.vence, render: (f) => (
    <span className={`whitespace-nowrap ${f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : ""}`}>
      {formatDate(f.vence)}
      <span className="block text-[10px] font-normal text-zinc-400">{f.sinVencimiento ? "sin vto · fecha factura" : f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "hoy" : `en ${f.dias} d`}</span>
    </span>
  ) },
  { key: "lado", label: "Tipo", sortable: true, sortValue: (f) => f.lado, render: (f) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.lado === "venta" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"}`}>{f.lado === "venta" ? "Venta" : "Compra"}</span> },
  { key: "comprobante", label: "Comprobante", sortable: true, sortValue: (f) => f.comprobante, render: (f) => <span className="whitespace-nowrap font-mono text-xs">{f.comprobante}</span> },
  { key: "nombre", label: "Cliente / Proveedor", sortable: true, sortValue: (f) => f.nombre },
  { key: "moneda", label: "Moneda", sortable: true, sortValue: (f) => f.moneda, render: (f) => (f.moneda === "USD" ? "US$" : "$") },
  { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.total, f.moneda)}</span> },
  { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => f.saldo, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(f.saldo, f.moneda)}</span> },
];

const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function FinanzasLazzaVencimientos({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<FilaVencimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [texto, setTexto] = useState("");
  const [moneda, setMoneda] = useState<"" | "ARS" | "USD">("");
  const [situacion, setSituacion] = useState<"" | "vencidas" | "por_vencer">("");
  const [campoFecha, setCampoFecha] = useState<"fecha" | "vence">("vence");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setFilas(null); setError(null);
    traerDeudas(sociedadId, hoy)
      .then((d) => { if (vivo) setFilas(d.vencimientos); })
      .catch((e) => { console.error("Finanzas Lazza · Vencimientos:", e); if (vivo) setError("No se pudieron cargar los vencimientos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy]);

  const visibles = useMemo<Fila[]>(() => filtrarVencimientos(filas || [], { lado: filtro, texto, moneda, situacion, campoFecha, desde, hasta })
    .map((f) => ({ ...f, facturaId: f.id, id: `${f.lado}-${f.id}` })), [filas, filtro, texto, moneda, situacion, campoFecha, desde, hasta]);
  const totales = useMemo(() => {
    const t = { venta: { ARS: 0, USD: 0 }, compra: { ARS: 0, USD: 0 } };
    for (const f of visibles) t[f.lado][f.moneda] += f.saldo;
    return t;
  }, [visibles]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  const montos = (m: { ARS: number; USD: number }) => (
    <>{formatCurrency(m.ARS)}{m.USD > 0.005 && <span className="ml-1">+ {formatCurrency(m.USD, "USD")}</span>}</>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {([["todo", "Todo"], ["venta", "Ventas"], ["compra", "Compras"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${filtro === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {l}
          </button>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar comprobante, cliente o proveedor" className={`${control} w-full pl-8`} />
        </div>
        <select value={situacion} onChange={(e) => setSituacion(e.target.value as typeof situacion)} className={control}>
          <option value="">Vencidas y por vencer</option><option value="vencidas">Solo vencidas</option><option value="por_vencer">Solo por vencer</option>
        </select>
        <select value={moneda} onChange={(e) => setMoneda(e.target.value as typeof moneda)} className={control}>
          <option value="">$ y US$</option><option value="ARS">$</option><option value="USD">US$</option>
        </select>
        <select value={campoFecha} onChange={(e) => setCampoFecha(e.target.value as typeof campoFecha)} className={control} title="Sobre qué fecha se aplica el rango">
          <option value="vence">Vencimiento</option><option value="fecha">Fecha de factura</option>
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" className={control} />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" className={control} />
        {(texto || moneda || situacion || desde || hasta) && (
          <button type="button" onClick={() => { setTexto(""); setMoneda(""); setSituacion(""); setDesde(""); setHasta(""); }} className="text-xs text-orange-600 hover:underline">Limpiar</button>
        )}
      </div>

      {!filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={COLUMNAS} data={visibles} emptyMessage="No hay facturas con saldo con ese filtro" />
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} facturas con saldo</span>
            {filtro !== "compra" && <span className="text-zinc-500">A cobrar <b className="font-mono text-emerald-700 dark:text-emerald-400">{montos(totales.venta)}</b></span>}
            {filtro !== "venta" && <span className="text-zinc-500">A pagar <b className="font-mono text-orange-700 dark:text-orange-400">{montos(totales.compra)}</b></span>}
          </div>
        </div>
      )}
    </div>
  );
}
