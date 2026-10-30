"use client";

// Transportes > Facturas: acceso directo de solo lectura a las facturas de compra de transportistas
// (tipo "transporte" o de un proveedor con el tilde Transporte). No guarda ni cambia nada.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { sinTildes } from "@/lib/transportes-destinos";

interface FacturaTransporte {
  id: string;
  numero_factura: string;
  tipo_comprobante: string | null;
  fecha: string;
  total: number;
  moneda: string | null;
  estado: string;
  archivo_url: string | null;
  proveedores: { razon_social: string } | null;
}

export function TransportesFacturas({ socId }: { socId: string }) {
  const [filas, setFilas] = useState<FacturaTransporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [mes, setMes] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const provs = await traerTodo<{ id: string }>(() => (supabase as any).from("proveedores").select("id").eq("sociedad_id", socId).eq("es_transportista", true).order("id"));
        const ids = provs.map((p) => p.id);
        const filtro = ids.length ? `tipo.eq.transporte,proveedor_id.in.(${ids.join(",")})` : "tipo.eq.transporte";
        const data = await traerTodo<FacturaTransporte>(() => (supabase as any).from("facturas_compra")
          .select("id, numero_factura, tipo_comprobante, fecha, total, moneda, estado, archivo_url, proveedores(razon_social)")
          .eq("sociedad_id", socId).or(filtro).order("fecha", { ascending: false }).order("id"));
        if (vivo) setFilas(data);
      } catch (e: any) {
        if (vivo) setError(e?.message || "No se pudieron cargar las facturas");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [socId]);

  const meses = useMemo(() => Array.from(new Set(filas.map((f) => f.fecha.slice(0, 7)))).sort().reverse(), [filas]);
  const visibles = useMemo(() => {
    const palabras = sinTildes(buscar).split(/\s+/).filter(Boolean);
    return filas.filter((f) => (!mes || f.fecha.startsWith(mes))
      && palabras.every((p) => sinTildes(`${f.proveedores?.razon_social || ""} ${f.numero_factura}`).includes(p)));
  }, [filas, buscar, mes]);
  const totales = useMemo(() => {
    const t: Record<string, number> = {};
    visibles.filter((f) => f.estado !== "anulada").forEach((f) => { const m = f.moneda === "USD" ? "USD" : "ARS"; t[m] = (t[m] || 0) + Number(f.total || 0); });
    return t;
  }, [visibles]);

  if (cargando) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-orange-500" size={32} /></div>;
  if (error) return <Card className="p-4 text-sm text-red-600">{error}</Card>;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por transportista o número"
          className="w-full max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white" />
        <div className="w-44">
          <Select value={mes} onChange={(e) => setMes(e.target.value)} options={[{ value: "", label: "Todos los meses" }, ...meses.map((m) => ({ value: m, label: m }))]} />
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          {visibles.length} {visibles.length === 1 ? "factura" : "facturas"}
          {Object.entries(totales).map(([m, v]) => ` · ${formatCurrency(v, m as "ARS" | "USD")}`).join("")}
        </span>
      </div>
      {visibles.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-zinc-400">No hay facturas de transporte para este filtro.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-1.5 text-left font-medium">Fecha</th>
              <th className="px-3 py-1.5 text-left font-medium">Transportista</th>
              <th className="px-3 py-1.5 text-left font-medium">Factura</th>
              <th className="px-3 py-1.5 text-right font-medium">Total</th>
              <th className="px-3 py-1.5 text-left font-medium">Estado</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(f.fecha)}</td>
                <td className="px-3 py-1.5">{f.proveedores?.razon_social || "—"}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{f.tipo_comprobante ? `${f.tipo_comprobante} ` : ""}{f.numero_factura}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(Number(f.total || 0), f.moneda === "USD" ? "USD" : "ARS")}</td>
                <td className="px-3 py-1.5">
                  <Badge variant={f.estado === "pagada" ? "success" : f.estado === "anulada" ? "default" : "info"}>
                    {f.estado === "pagada" ? "Pagada" : f.estado === "anulada" ? "Anulada" : "A pagar"}
                  </Badge>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {f.archivo_url && (
                    <button onClick={() => window.open(f.archivo_url!, "_blank", "noopener,noreferrer")} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title="Abrir el PDF">
                      <Paperclip size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
