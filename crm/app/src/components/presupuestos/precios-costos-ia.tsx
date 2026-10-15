"use client";

/**
 * Editor de presupuesto > "Precios y costos (IA)".
 *  1) Mantener precios anteriores: los artículos que ya se le vendieron a este cliente vuelven al último precio (neto) que pagó.
 *  2) Mejores costos: la IA (Opus 5.5) busca en la lista de costos el MISMO artículo más barato y muestra el ahorro.
 * Solo propone: se marca lo que se quiere y se aplica. El precio de venta nunca cambia por buscar mejores costos (sube el margen).
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { buscarCandidatos, type CatalogoCandidato as Cand } from "@/lib/catalogo-busqueda";
import { convertirAMonedaPR } from "@/components/presupuestos/catalogo-picker";

export interface FilaPrecioAnterior { idx: number; descripcion: string; actual: number; anterior: number; numero: string; fecha: string }
export interface LineaCosto { idx: number; codigo: string; descripcion: string; cantidad: number; costoPR: number; proveedor: string }
export interface MejorCosto { idx: number; cand: Cand; costoNuevoPR: number }

interface Props {
  open: boolean;
  onClose: () => void;
  moneda: string;
  tc: number;
  tcDivisas: number;
  precios: FilaPrecioAnterior[];
  lineas: LineaCosto[];
  onAplicarPrecios: (cambios: Array<{ idx: number; precio: number }>) => void;
  onAplicarCostos: (cambios: MejorCosto[]) => void | Promise<void>;
}

type Sugerencia = { l: LineaCosto; cand: Cand; costoNuevoPR: number; ahorroPct: number; ahorroTotal: number; nota: string };

const fmt = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PreciosCostosIA({ open, onClose, moneda, tc, tcDivisas, precios, lineas, onAplicarPrecios, onAplicarCostos }: Props) {
  const [tab, setTab] = useState<"precios" | "costos">("precios");
  const [marcaP, setMarcaP] = useState<Set<number>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [sug, setSug] = useState<Sugerencia[] | null>(null);
  const [yaMejores, setYaMejores] = useState(0);
  const [marcaC, setMarcaC] = useState<Set<number>>(new Set());
  const [aplicando, setAplicando] = useState(false);

  // por defecto todo marcado; al tocar una casilla se pasa a la selección propia
  const [tocadoP, setTocadoP] = useState(false);
  const selP = useMemo(() => (tocadoP ? marcaP : new Set(precios.map(p => p.idx))), [tocadoP, marcaP, precios]);

  async function buscarMejores() {
    setError(""); setBuscando(true); setSug(null); setYaMejores(0);
    try {
      const util = lineas.filter(l => l.costoPR > 0 && l.descripcion.trim());
      if (!util.length) throw new Error("No hay renglones con costo cargado para comparar.");
      const pedidos: Array<{ id: string; descripcion: string; codigo: string; candidatos: Cand[]; proveedor_actual: string }> = [];
      for (let i = 0; i < util.length; i += 6) {
        setProgreso(`Buscando en la lista de costos… ${Math.min(i + 6, util.length)} de ${util.length}`);
        await Promise.all(util.slice(i, i + 6).map(async l => {
          const cands = await buscarCandidatos(l.descripcion, l.codigo, 15);
          pedidos.push({ id: String(l.idx), descripcion: l.descripcion, codigo: l.codigo, candidatos: cands, proveedor_actual: l.proveedor });
        }));
      }
      setProgreso("La IA está buscando el mismo artículo al mejor costo…");
      const res = await fetch("/api/cotizacion-express", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: "elegir", moneda_comparable: moneda === "ARS" ? "ARS" : "USD",
          pedidos: pedidos.map(p => ({
            id: p.id, descripcion: p.descripcion, codigo: p.codigo, proveedor_preferido: "",
            candidatos: p.candidatos.map(c => { const cp = convertirAMonedaPR(c.costo, c.moneda, moneda, tc, tcDivisas); return { proveedor: c.proveedor, codigo: c.codigo_interno || c.codigo, descripcion: c.descripcion, marca: c.marca, moneda: c.moneda, costo: c.costo, costo_comparable: cp === null ? null : Math.round(cp * 100) / 100 }; }),
          })),
          preferencias: { indicaciones: "BUSCAR EL MEJOR COSTO: elegí el candidato MÁS BARATO (menor costo comparable) entre los que sean EXACTAMENTE el mismo artículo (misma marca, modelo, material y características; el talle no cambia el artículo). Si el artículo que ya se usa es el más barato, elegí ese. Nunca elijas uno distinto solo por ser más barato." },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "La IA no pudo comparar los costos");
      const porId = new Map<string, any>((d.elecciones || []).map((e: any) => [String(e.id), e]));
      const out: Sugerencia[] = []; let ya = 0;
      for (const p of pedidos) {
        const l = util.find(x => String(x.idx) === p.id)!;
        const e = porId.get(p.id);
        const idx = e && e.indice !== null && e.indice !== undefined && p.candidatos[Number(e.indice)] ? Number(e.indice) : null;
        if (idx === null || !["alta", "media"].includes(e.confianza)) continue;
        const cand = p.candidatos[idx];
        const nuevo = convertirAMonedaPR(cand.costo, cand.moneda, moneda, tc, tcDivisas);
        if (nuevo === null) continue;
        if (nuevo < l.costoPR * 0.99) out.push({ l, cand, costoNuevoPR: nuevo, ahorroPct: (1 - nuevo / l.costoPR) * 100, ahorroTotal: (l.costoPR - nuevo) * l.cantidad, nota: e.nota || "" });
        else ya++;
      }
      out.sort((a, b) => b.ahorroTotal - a.ahorroTotal);
      setSug(out); setYaMejores(ya); setMarcaC(new Set(out.map(s => s.l.idx)));
    } catch (e) { setError(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setBuscando(false); setProgreso(""); }
  }

  if (!open || typeof document === "undefined") return null;
  const ahorroSel = (sug || []).filter(s => marcaC.has(s.l.idx)).reduce((t, s) => t + s.ahorroTotal, 0);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" onMouseDown={e => { if (e.target === e.currentTarget && !buscando) onClose(); }}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Sparkles className="h-5 w-5 text-orange-500" /> Precios y costos (IA)</h2>
            <p className="text-xs text-zinc-500">Marcá lo que querés y aplicá. Solo propone: nada cambia hasta que apretás Aplicar.</p>
          </div>
          <button onClick={onClose} disabled={buscando}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>
        <div className="flex gap-1 border-b border-zinc-200 px-4 dark:border-zinc-700">
          {([["precios", `Mantener precios anteriores (${precios.length})`], ["costos", "Mejores costos"]] as const).map(([k, t]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-orange-500 text-orange-600" : "border-transparent text-zinc-500"}`}>{t}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "precios" && (
            precios.length === 0
              ? <p className="py-8 text-center text-sm text-zinc-500">Ningún artículo de este presupuesto tiene un precio anterior distinto al actual (de PR aprobados o facturados de este cliente, en la misma moneda).</p>
              : <table className="w-full text-xs">
                <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><tr>
                  <th className="px-2 py-2"><input type="checkbox" checked={selP.size === precios.length} onChange={e => { setTocadoP(true); setMarcaP(new Set(e.target.checked ? precios.map(p => p.idx) : [])); }} /></th>
                  <th className="px-2">Artículo</th><th className="px-2 text-right">Precio actual</th><th className="px-2 text-right">Último precio al cliente</th><th className="px-2 text-right">Diferencia</th><th className="px-2">PR anterior</th>
                </tr></thead>
                <tbody>{precios.map(p => {
                  const dif = (p.anterior / p.actual - 1) * 100;
                  return <tr key={p.idx} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                    <td className="px-2 py-1.5"><input type="checkbox" checked={selP.has(p.idx)} onChange={e => { setTocadoP(true); const n = new Set(selP); if (e.target.checked) n.add(p.idx); else n.delete(p.idx); setMarcaP(n); }} /></td>
                    <td className="px-2">{p.descripcion}</td>
                    <td className="px-2 text-right">{fmt(p.actual, moneda)}</td>
                    <td className="px-2 text-right font-semibold">{fmt(p.anterior, moneda)}</td>
                    <td className={`px-2 text-right ${dif < 0 ? "text-amber-600" : "text-emerald-600"}`}>{dif > 0 ? "+" : ""}{dif.toFixed(1)}%</td>
                    <td className="px-2 text-zinc-500">{p.numero} · {p.fecha.slice(8, 10)}/{p.fecha.slice(5, 7)}/{p.fecha.slice(2, 4)}</td>
                  </tr>;
                })}</tbody></table>
          )}

          {tab === "costos" && (
            <div className="space-y-3">
              {!sug && !buscando && <div className="py-6 text-center">
                <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">La IA busca, para cada renglón, el <b>mismo artículo</b> (misma marca y modelo) más barato en la lista de costos. El precio de venta no se toca: sube el margen.</p>
                <button onClick={() => void buscarMejores()} className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white"><Sparkles className="h-4 w-4" /> Buscar mejores costos</button>
              </div>}
              {buscando && <p className="flex items-center justify-center gap-2 py-8 text-sm text-orange-600"><Loader2 className="h-4 w-4 animate-spin" /> {progreso}</p>}
              {error && <p className="text-sm text-red-600">⚠️ {error}</p>}
              {sug && !buscando && (sug.length === 0
                ? <p className="py-8 text-center text-sm text-emerald-700">✓ No encontré el mismo artículo más barato: {yaMejores > 0 ? `${yaMejores} renglón(es) ya están al mejor costo.` : "los costos actuales son los mejores de la lista."}</p>
                : <>
                  <p className="text-xs text-zinc-500">{sug.length} renglón(es) con mejor costo{yaMejores ? ` · ${yaMejores} ya están al mejor costo` : ""}. Ahorro marcado: <b className="text-emerald-700">{fmt(ahorroSel, moneda)}</b></p>
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"><tr>
                      <th className="px-2 py-2"><input type="checkbox" checked={marcaC.size === sug.length} onChange={e => setMarcaC(new Set(e.target.checked ? sug.map(s => s.l.idx) : []))} /></th>
                      <th className="px-2">Renglón</th><th className="px-2">Hoy</th><th className="px-2">Sugerido</th><th className="px-2 text-right">Ahorro</th>
                    </tr></thead>
                    <tbody>{sug.map(s => (
                      <tr key={s.l.idx} className="border-t border-zinc-100 align-top dark:border-zinc-800 dark:text-zinc-200">
                        <td className="px-2 py-1.5"><input type="checkbox" checked={marcaC.has(s.l.idx)} onChange={e => { const n = new Set(marcaC); if (e.target.checked) n.add(s.l.idx); else n.delete(s.l.idx); setMarcaC(n); }} /></td>
                        <td className="max-w-[260px] px-2">{s.l.descripcion}<span className="block text-[10px] text-zinc-400">× {s.l.cantidad}</span></td>
                        <td className="px-2 whitespace-nowrap">{s.l.proveedor || "sin proveedor"}<span className="block text-zinc-500">{fmt(s.l.costoPR, moneda)}</span></td>
                        <td className="px-2"><b>{s.cand.proveedor}</b> · {s.cand.codigo_interno || s.cand.codigo}<span className="block text-zinc-500">{s.cand.descripcion} · {fmt(s.costoNuevoPR, moneda)}</span>{s.nota && <span className="block text-[10px] text-amber-700">{s.nota}</span>}</td>
                        <td className="px-2 text-right font-semibold text-emerald-700">{s.ahorroPct.toFixed(1)}%<span className="block font-normal">{fmt(s.ahorroTotal, moneda)}</span></td>
                      </tr>
                    ))}</tbody></table>
                </>)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <button onClick={onClose} disabled={buscando || aplicando} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cerrar</button>
          {tab === "precios" && <button disabled={!selP.size} onClick={() => { onAplicarPrecios(precios.filter(p => selP.has(p.idx)).map(p => ({ idx: p.idx, precio: p.anterior }))); onClose(); }}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Usar el precio anterior en {selP.size}</button>}
          {tab === "costos" && sug && sug.length > 0 && <button disabled={!marcaC.size || aplicando} onClick={async () => { setAplicando(true); await onAplicarCostos(sug.filter(s => marcaC.has(s.l.idx)).map(s => ({ idx: s.l.idx, cand: s.cand, costoNuevoPR: s.costoNuevoPR }))); setAplicando(false); onClose(); }}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aplicar {marcaC.size} costo(s)</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
