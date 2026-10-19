"use client";

// Finanzas Lazza → Vencimientos: SOLO facturas de venta y de compra con saldo, por fecha (sin cheques, fijos ni cuotas).
// Saldos con la misma regla que Finanzas (lib/saldo-clientes y la de proveedores). Solo lectura.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { cobradoPorFactura, saldoFacturaVenta, traerDatosSaldoClientes } from "@/lib/saldo-clientes";
import { armarVencimientos, type FacturaCompraFL, type FilaVencimiento, type PagoDirectoFC } from "@/lib/finanzas-lazza";
import { aFacturaVenta, CAMPOS_VENTA } from "./datos";

const db = supabase as any;
type Filtro = "todo" | "venta" | "compra";

async function traerVencimientos(sociedadId: string, hoy: string): Promise<FilaVencimiento[]> {
  const [cc, compras, pagosDirectos] = await Promise.all([
    traerDatosSaldoClientes(db, sociedadId, traerTodo),
    traerTodo<any>(() => db.from("facturas_compra")
      .select("id, fecha, fecha_vencimiento, tipo_comprobante, estado, moneda, iva, total, total_acreditado, numero_factura, proveedores(razon_social), op_facturas_compra(monto, ordenes_pago(estado))")
      .eq("sociedad_id", sociedadId).not("estado", "in", "(anulada,pagada)").order("id")),
    traerTodo<PagoDirectoFC>(() => db.from("movimientos")
      .select("id, factura_compra_id, monto, retencion_ganancias_monto, anulado, nota_credito_compra_id")
      .eq("sociedad_id", sociedadId).eq("tipo", "pago").not("factura_compra_id", "is", null).order("id")),
  ]);
  // Ventas: saldo por factura con la regla de CC de clientes; después se traen los datos para mostrar solo de las que deben.
  const cobrado = cobradoPorFactura(cc.facturas, cc.movimientos, cc.aplicaciones);
  const saldos = new Map<string, number>();
  for (const f of cc.facturas) { const s = saldoFacturaVenta(f, cobrado[f.id] || 0); if (s > 0.005) saldos.set(f.id, s); }
  const ids = [...saldos.keys()];
  const ventas: ReturnType<typeof aFacturaVenta>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("facturas").select(CAMPOS_VENTA).in("id", ids.slice(i, i + 200));
    if (error) throw error;
    ventas.push(...(data || []).map(aFacturaVenta));
  }
  const comprasFL: FacturaCompraFL[] = compras.map((r) => ({ ...r, fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social ?? "" }));
  return armarVencimientos({ hoy, ventas, saldoVenta: (f) => saldos.get(f.id) ?? 0, compras: comprasFL, pagosDirectos });
}

export function FinanzasLazzaVencimientos({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<FilaVencimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setFilas(null); setError(null);
    traerVencimientos(sociedadId, hoy)
      .then((f) => { if (vivo) setFilas(f); })
      .catch((e) => { console.error("Finanzas Lazza · Vencimientos:", e); if (vivo) setError("No se pudieron cargar los vencimientos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy]);

  const visibles = useMemo(() => (filas || []).filter((f) => filtro === "todo" || f.lado === filtro), [filas, filtro]);
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
      <div className="flex flex-wrap items-center gap-1">
        {([["todo", "Todo"], ["venta", "Ventas"], ["compra", "Compras"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${filtro === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {l}
          </button>
        ))}
        {filas && <span className="ml-2 text-xs text-zinc-400">{visibles.length} facturas con saldo</span>}
      </div>

      {!filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-2">Vence</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Comprobante</th>
                <th className="px-2 py-2">Cliente / Proveedor</th><th className="px-2 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={`${f.lado}-${f.id}`} className="border-t border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                  <td className={`px-3 py-1.5 whitespace-nowrap ${f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : ""}`}>
                    {formatDate(f.vence)}
                    <span className="block text-[10px] font-normal text-zinc-400">{f.sinVencimiento ? "sin vto · fecha factura" : f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "hoy" : `en ${f.dias} d`}</span>
                  </td>
                  <td className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.lado === "venta" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"}`}>{f.lado === "venta" ? "Venta" : "Compra"}</span></td>
                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
                    <Link href={f.lado === "venta" ? `/finanzas?factura=${f.id}` : "/finanzas?tab=facturas_compra"} className="hover:text-orange-600 hover:underline">{f.comprobante}</Link>
                  </td>
                  <td className="px-2 py-1.5">{f.nombre}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-500 whitespace-nowrap">{formatCurrency(f.total, f.moneda)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap">{formatCurrency(f.saldo, f.moneda)}</td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-400">No hay facturas con saldo.</td></tr>}
            </tbody>
            <tfoot className="border-t border-zinc-200 text-xs dark:border-zinc-700">
              {filtro !== "compra" && <tr><td colSpan={5} className="px-3 py-1.5 text-right text-zinc-500">A cobrar</td><td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap text-emerald-700 dark:text-emerald-400">{montos(totales.venta)}</td></tr>}
              {filtro !== "venta" && <tr><td colSpan={5} className="px-3 py-1.5 text-right text-zinc-500">A pagar</td><td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap text-orange-700 dark:text-orange-400">{montos(totales.compra)}</td></tr>}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
