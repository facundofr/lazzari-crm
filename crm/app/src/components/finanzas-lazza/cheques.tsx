"use client";

// Finanzas Lazza → Cheques (diseño de Augusto 19/10/2026): todos los cheques con todos los estados, filtrables y por categoría;
// arriba lo que está EN FECHA de pago y de cobro, el resumen por estado y las próximas 4 semanas. Solo informativo:
// los estados cambian solos con cobros, OP y el Excel del banco (sin botones a mano). Pestaña aparte "Martín F."
// = la misma pantalla de Finanzas (components/cheques-tercero, echeqs.cubre_tercero). Cálculos en lib/cheques-lazza.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Upload, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import ChequesTercero from "@/components/cheques-tercero";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { enFecha, estadoCheque, proximasSemanas, resumenPorEstado, type ChequeFL, type Total } from "@/lib/cheques-lazza";
import { ChequesBanco } from "./cheques-banco";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Cheque extends ChequeFL {
  banco: string; cuit: string; tipo: string; emision: string | null; pago: string;
  origen: string; destino: string; fechaEndoso: string | null; fechaDeposito: string | null; observaciones: string;
}

const TONO: Record<string, string> = {
  naranja: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  azul: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  verde: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  rojo: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  violeta: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  gris: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const montos = (t: Total) => <>{formatCurrency(t.ARS)}{t.USD > 0 && <span className="ml-1 text-xs text-zinc-500">+ {formatCurrency(t.USD, "USD")}</span>}</>;

async function traerCheques(sociedadId: string): Promise<Cheque[]> {
  const rows = await traerTodo<any>(() => db.from("echeqs")
    .select("id, numero, banco_emisor, cuit_emisor, monto, moneda, fecha_emision, fecha_pago, estado, origen_nombre, destino_nombre, fecha_endoso, fecha_deposito, observaciones, tipo_cheque, direccion, cubre_tercero")
    .eq("sociedad_id", sociedadId).order("fecha_pago", { ascending: false }).order("id"));
  return rows.map((r) => ({
    id: r.id, numero: String(r.numero ?? ""), direccion: r.direccion === "emitido" ? "emitido" : "recibido", estado: r.estado || "",
    fecha_pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : null, monto: Number(r.monto || 0), moneda: r.moneda === "USD" ? "USD" : "ARS",
    cubre_tercero: r.cubre_tercero || null,
    banco: r.banco_emisor || "", cuit: r.cuit_emisor || "", tipo: r.tipo_cheque === "fisico" ? "Físico" : "eCheq",
    emision: r.fecha_emision ? String(r.fecha_emision).slice(0, 10) : null, pago: r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : "",
    origen: r.origen_nombre || "", destino: r.destino_nombre || "", fechaEndoso: r.fecha_endoso || null, fechaDeposito: r.fecha_deposito || null,
    observaciones: r.observaciones || "",
  }));
}

/** Con quién: en los recibidos, quién lo dio (y a quién se endosó); en los emitidos, a quién se le dio. */
const conQuien = (c: Cheque) => (c.direccion === "emitido" ? c.destino : [c.origen, c.destino ? `→ ${c.destino}` : ""].filter(Boolean).join(" "));

export function FinanzasLazzaCheques({ sociedadId }: { sociedadId: string }) {
  const [pestana, setPestana] = useState<"todos" | "martin">("todos");
  const [cheques, setCheques] = useState<Cheque[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<"" | "emitido" | "recibido">("");
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState("");
  const [soloEnFecha, setSoloEnFecha] = useState(false);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [abierto, setAbierto] = useState<Cheque | null>(null);
  const [subir, setSubir] = useState(false);
  const hoy = todayAR();

  const cargar = useCallback(() => {
    let vivo = true;
    setError(null);
    traerCheques(sociedadId)
      .then((c) => { if (vivo) setCheques(c); })
      .catch((e) => { console.error("Finanzas Lazza · Cheques:", e); if (vivo) setError("No se pudieron cargar los cheques. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId]);
  useEffect(() => { setCheques(null); return cargar(); }, [cargar]);

  const todos = cheques || [];
  const fecha = useMemo(() => enFecha(todos, hoy), [todos, hoy]);
  const porEstado = useMemo(() => resumenPorEstado(todos), [todos]);
  const semanas = useMemo(() => proximasSemanas(todos, hoy), [todos, hoy]);

  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => todos.filter((c) => {
    if (categoria && c.direccion !== categoria) return false;
    if (estado && estadoCheque(c).clave !== estado) return false;
    if (tipo && c.tipo !== tipo) return false;
    if (soloEnFecha && !(["entregado", "pendiente", "en_cartera"].includes(c.estado) && c.pago && c.pago <= hoy)) return false;
    if (desde && c.pago < desde) return false;
    if (hasta && c.pago > hasta) return false;
    if (q && !sinAcentos(`${c.numero} ${c.banco} ${c.cuit} ${c.origen} ${c.destino} ${c.cubre_tercero || ""} ${c.monto}`).includes(q)) return false;
    return true;
  }), [todos, categoria, estado, tipo, soloEnFecha, desde, hasta, q, hoy]);

  const limpiar = () => { setCategoria(""); setEstado(""); setTipo(""); setSoloEnFecha(false); setTexto(""); setDesde(""); setHasta(""); };
  const filtrar = (f: { categoria?: "" | "emitido" | "recibido"; estado?: string; enFecha?: boolean; desde?: string; hasta?: string }) => {
    limpiar();
    if (f.categoria !== undefined) setCategoria(f.categoria);
    if (f.estado) setEstado(f.estado);
    if (f.enFecha) setSoloEnFecha(true);
    if (f.desde) setDesde(f.desde);
    if (f.hasta) setHasta(f.hasta);
  };

  const cols: Column<Cheque>[] = [
    { key: "numero", label: "N°", sortable: true, sortValue: (c) => c.numero, render: (c) => <span className="font-mono text-xs">{c.numero}</span> },
    { key: "dir", label: "Categoría", sortable: true, sortValue: (c) => `${c.direccion}${c.tipo}`, render: (c) => (
      <span className="text-xs">{c.direccion === "emitido" ? "Emitido" : "Recibido"}<span className="block text-[10px] text-zinc-400">{c.tipo}</span></span>
    ) },
    { key: "quien", label: "De / Para", sortable: true, sortValue: (c) => conQuien(c), render: (c) => (
      <span className="text-sm">{conQuien(c) || "—"}{c.cubre_tercero && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Martín F.</span>}</span>
    ) },
    { key: "banco", label: "Banco", sortable: true, sortValue: (c) => c.banco, render: (c) => <span className="text-xs">{c.banco || "—"}</span> },
    { key: "emision", label: "Emisión", sortable: true, sortValue: (c) => c.emision || "", render: (c) => (c.emision ? formatDate(c.emision) : "—") },
    { key: "pago", label: "Pago", sortable: true, sortValue: (c) => c.pago, render: (c) => {
      const pend = ["entregado", "pendiente", "en_cartera"].includes(c.estado);
      return <span className={`whitespace-nowrap ${pend && c.pago && c.pago <= hoy ? "font-semibold text-red-600" : ""}`}>{c.pago ? formatDate(c.pago) : "—"}{pend && c.pago && c.pago <= hoy && <span className="block text-[10px]">en fecha</span>}</span>;
    } },
    { key: "monto", label: "Monto", sortable: true, sortValue: (c) => Number(c.monto), className: "text-right", render: (c) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(Number(c.monto), c.moneda === "USD" ? "USD" : "ARS")}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (c) => estadoCheque(c).label, render: (c) => { const e = estadoCheque(c); return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${TONO[e.tono]}`}>{e.label}</span>; } },
  ];

  const totalVisibles = useMemo(() => {
    const t = { ARS: 0, USD: 0 };
    for (const c of visibles) t[c.moneda === "USD" ? "USD" : "ARS"] += Number(c.monto) || 0;
    return t;
  }, [visibles]);

  const boton = (activo: boolean) => `rounded-lg border px-3 py-1 text-xs font-medium ${activo ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setPestana("todos")} className={boton(pestana === "todos")}>Todos los cheques</button>
          <button type="button" onClick={() => setPestana("martin")} className={boton(pestana === "martin")}>Martín F.</button>
        </div>
        {pestana === "todos" && (
          <button type="button" onClick={() => setSubir(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <Upload className="h-3.5 w-3.5" /> Subir Excel del banco
          </button>
        )}
      </div>

      {pestana === "martin" ? <ChequesTercero /> : error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>
      ) : !cheques ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <>
          {/* En fecha: lo que el banco puede debitar hoy y lo que ya se puede depositar */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => filtrar({ categoria: "emitido", enFecha: true })} title="Ver estos cheques en la lista"
              className={`rounded-xl border p-3 text-left hover:border-orange-300 ${fecha.pagar.cantidad ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">En fecha para pagar</p>
              <p className="font-mono text-lg font-bold text-zinc-900 dark:text-white">{montos(fecha.pagar)}</p>
              <p className="text-xs text-zinc-500">{fecha.pagar.cantidad} cheque{fecha.pagar.cantidad === 1 ? "" : "s"} propio{fecha.pagar.cantidad === 1 ? "" : "s"} que el banco puede debitar hoy</p>
            </button>
            <button type="button" onClick={() => filtrar({ categoria: "recibido", enFecha: true })} title="Ver estos cheques en la lista"
              className={`rounded-xl border p-3 text-left hover:border-orange-300 ${fecha.cobrar.cantidad ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">En fecha para cobrar</p>
              <p className="font-mono text-lg font-bold text-zinc-900 dark:text-white">{montos(fecha.cobrar)}</p>
              <p className="text-xs text-zinc-500">{fecha.cobrar.cantidad} cheque{fecha.cobrar.cantidad === 1 ? "" : "s"} en cartera que ya se puede{fecha.cobrar.cantidad === 1 ? "" : "n"} depositar</p>
            </button>
          </div>

          {/* Resumen por estado */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {porEstado.map((e) => (
              <button key={e.clave} type="button" onClick={() => filtrar({ categoria: e.direccion, estado: e.clave })} title="Ver estos cheques en la lista"
                className={`rounded-lg border px-3 py-2 text-left hover:border-orange-300 ${estado === e.clave ? "border-orange-400" : "border-zinc-200 dark:border-zinc-800"} bg-white dark:bg-zinc-900`}>
                <p className="flex items-center justify-between gap-1 text-[11px] text-zinc-500">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${TONO[e.tono]}`}>{e.label}</span>
                  <span>{e.direccion === "emitido" ? "Emitidos" : "Recibidos"}</span>
                </p>
                <p className="mt-1 font-mono text-sm font-bold text-zinc-900 dark:text-white">{montos(e.total)}</p>
                <p className="text-[11px] text-zinc-500">{e.total.cantidad} cheque{e.total.cantidad === 1 ? "" : "s"}</p>
              </button>
            ))}
          </div>

          {/* Próximas 4 semanas */}
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-zinc-400">
                  <th className="px-3 py-2">Próximas 4 semanas</th>
                  {semanas.map((s, i) => <th key={s.desde} className="px-3 py-2 text-right">{i === 0 ? "Esta semana" : `Semana ${i + 1}`}<span className="block font-normal normal-case">{formatDate(s.desde).slice(0, 5)} al {formatDate(s.hasta).slice(0, 5)}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {(["pagar", "cobrar"] as const).map((lado) => (
                  <tr key={lado} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className={`px-3 py-2 text-xs font-semibold ${lado === "pagar" ? "text-orange-600" : "text-emerald-600"}`}>{lado === "pagar" ? "A pagar (propios)" : "A cobrar (cartera)"}</td>
                    {semanas.map((s) => (
                      <td key={s.desde} className="px-3 py-2 text-right">
                        <button type="button" disabled={!s[lado].cantidad} onClick={() => filtrar({ categoria: lado === "pagar" ? "emitido" : "recibido", estado: lado === "pagar" ? "emitido:sin_debitar" : "recibido:en_cartera", desde: s.desde, hasta: s.hasta })}
                          className="font-mono hover:text-orange-600 disabled:cursor-default disabled:text-zinc-300">
                          {s[lado].cantidad ? montos(s[lado]) : "—"}
                          {s[lado].cantidad > 0 && <span className="block text-[10px] text-zinc-400">{s[lado].cantidad} ch.</span>}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Lista */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([["", "Todos"], ["emitido", "Emitidos"], ["recibido", "Recibidos"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setCategoria(k); setEstado(""); }} className={boton(categoria === k)}>{l}</button>
            ))}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar N°, banco, CUIT, cliente, proveedor o importe" className={`${control} w-full pl-8`} />
            </div>
            <select value={estado} onChange={(e) => setEstado(e.target.value)} className={control}>
              <option value="">Todos los estados</option>
              {porEstado.filter((e) => !categoria || e.direccion === categoria).map((e) => <option key={e.clave} value={e.clave}>{e.label} ({e.direccion === "emitido" ? "emitidos" : "recibidos"})</option>)}
            </select>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={control}>
              <option value="">eCheq y físicos</option><option value="eCheq">eCheq</option><option value="Físico">Físicos</option>
            </select>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Fecha de pago desde" className={control} />
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Fecha de pago hasta" className={control} />
            {soloEnFecha && <span className="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Solo en fecha</span>}
            {(categoria || estado || tipo || soloEnFecha || texto || desde || hasta) && <button type="button" onClick={limpiar} className="text-xs text-orange-600 hover:underline">Limpiar</button>}
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <DataTable columns={cols} data={visibles} onRowClick={setAbierto} emptyMessage="No hay cheques con ese filtro" />
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
              <span>{visibles.length} cheques</span>
              <span>Total <b className="font-mono">{formatCurrency(totalVisibles.ARS)}{totalVisibles.USD > 0 && ` + ${formatCurrency(totalVisibles.USD, "USD")}`}</b></span>
            </div>
          </div>
        </>
      )}

      {abierto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAbierto(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">Cheque <span className="font-mono">{abierto.numero}</span></h2>
                <p className="text-sm text-zinc-500">{abierto.direccion === "emitido" ? "Propio (emitido)" : "Recibido"} · {abierto.tipo}</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setAbierto(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <dl className="space-y-1.5 text-sm">
              {([
                ["Estado", <span key="e" className={`rounded px-1.5 py-0.5 text-xs font-semibold ${TONO[estadoCheque(abierto).tono]}`}>{estadoCheque(abierto).label}</span>],
                ["Monto", <b key="m" className="font-mono">{formatCurrency(Number(abierto.monto), abierto.moneda === "USD" ? "USD" : "ARS")}</b>],
                ["De dónde vino", abierto.direccion === "emitido" ? "Lo emitimos nosotros" : abierto.origen || "—"],
                ["A dónde fue", abierto.destino || (abierto.direccion === "recibido" && abierto.estado === "en_cartera" ? "Sigue en cartera" : "—")],
                ["Banco", abierto.banco || "—"],
                ["CUIT del emisor", abierto.cuit || "—"],
                ["Emisión", abierto.emision ? formatDate(abierto.emision) : "—"],
                ["Fecha de pago", abierto.pago ? formatDate(abierto.pago) : "—"],
                ...(abierto.fechaDeposito ? [["Depositado", formatDate(abierto.fechaDeposito)]] : []),
                ...(abierto.fechaEndoso ? [["Endosado", formatDate(abierto.fechaEndoso)]] : []),
                ...(abierto.cubre_tercero ? [["Lo cubre", abierto.cubre_tercero]] : []),
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-zinc-100 pb-1.5 dark:border-zinc-800"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
            {abierto.observaciones && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">{abierto.observaciones}</p>}
          </div>
        </div>
      )}

      {subir && <ChequesBanco sociedadId={sociedadId} cheques={todos.map((c) => ({ id: c.id, numero: c.numero, direccion: c.direccion, estado: c.estado, monto: Number(c.monto), cuit_emisor: c.cuit || null }))} onClose={() => setSubir(false)} onGuardado={() => { cargar(); }} />}
    </div>
  );
}
