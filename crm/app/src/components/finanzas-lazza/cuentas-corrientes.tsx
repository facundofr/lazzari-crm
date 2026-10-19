"use client";

// Finanzas Lazza → Cuentas corrientes: clientes y proveedores en UNA lista (solo lectura).
// Saldos con las mismas reglas que Finanzas (lib/saldo-clientes y lib/saldo-proveedores); semáforo BCRA del último informe.
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { armarCuentasCorrientes, semaforoPorEntidad, tieneSaldo, type FilaCuentaCorriente, type FilaVencimiento, type Semaforo } from "@/lib/finanzas-lazza";
import { clasificarMovimiento } from "@/lib/tipos-movimiento";
import { traerDeudas } from "./datos";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

const COLOR_BCRA: Record<Semaforo, string> = { verde: "bg-emerald-500", amarillo: "bg-amber-400", rojo: "bg-red-500", gris: "bg-zinc-300" };

const montos = (m: { ARS: number; USD: number }, cero = "—") => {
  const partes = [Math.abs(m.ARS) >= 0.01 ? formatCurrency(m.ARS) : null, Math.abs(m.USD) >= 0.01 ? formatCurrency(m.USD, "USD") : null].filter(Boolean);
  return partes.length ? partes.join(" + ") : cero;
};

async function traerSemaforos(tabla: string, campo: string, sociedadId: string): Promise<Record<string, Semaforo>> {
  try {
    const desde = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db.from(tabla).select(`${campo}, mes, semaforo`).eq("sociedad_id", sociedadId).gte("mes", desde).order("mes", { ascending: false }).limit(5000);
    if (error) return {};
    return semaforoPorEntidad((data || []).map((r: any) => ({ entidad_id: r[campo], semaforo: r.semaforo })));
  } catch { return {}; }
}

async function traerCuentas(sociedadId: string, hoy: string) {
  const [deudas, clientes, proveedores, bcraClientes, bcraProveedores] = await Promise.all([
    traerDeudas(sociedadId, hoy),
    traerTodo<any>(() => db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
    traerTodo<any>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
    traerSemaforos("cliente_bcra_informes", "cliente_id", sociedadId),
    traerSemaforos("proveedor_bcra_informes", "proveedor_id", sociedadId),
  ]);
  return {
    filas: armarCuentasCorrientes({ clientes, proveedores, saldosClientes: deudas.saldosClientes, saldosProveedores: deudas.saldosProveedores, vencimientos: deudas.vencimientos, bcraClientes, bcraProveedores }),
    vencimientos: deudas.vencimientos,
  };
}

const COLUMNAS: Column<FilaCuentaCorriente>[] = [
  { key: "nombre", label: "Nombre", sortable: true, sortValue: (f) => f.nombre, render: (f) => (
    <span className="flex items-center gap-2">
      {f.bcra && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_BCRA[f.bcra]}`} title={`BCRA: ${f.bcra}`} />}
      <span>{f.nombre}<span className="block text-[10px] text-zinc-400">{f.cuit ? `CUIT ${f.cuit}` : ""}{f.facturas ? ` · ${f.facturas} fact.` : ""}</span></span>
    </span>
  ) },
  { key: "lado", label: "Tipo", sortable: true, sortValue: (f) => f.lado, render: (f) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.lado === "cliente" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"}`}>{f.lado === "cliente" ? "Cliente" : "Proveedor"}</span> },
  { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => f.saldo.ARS, className: "text-right", render: (f) => (
    <span className={`whitespace-nowrap font-mono ${f.saldo.ARS < 0 || f.saldo.USD < 0 ? "text-emerald-600" : "font-semibold"}`}>
      {montos(f.saldo, "$ 0")}
      {(f.saldo.ARS < 0 || f.saldo.USD < 0) && <span className="block text-[10px] font-sans">a favor {f.lado === "cliente" ? "del cliente" : "nuestro"}</span>}
    </span>
  ) },
  { key: "vencido", label: "Vencido", sortable: true, sortValue: (f) => f.vencido.ARS, className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono ${f.vencido.ARS > 0 || f.vencido.USD > 0 ? "text-red-600" : "text-zinc-400"}`}>{montos(f.vencido)}</span> },
  { key: "proximo", label: "Próx. vencimiento", sortable: true, sortValue: (f) => f.proximoVencimiento || "9999", render: (f) => (f.proximoVencimiento ? formatDate(f.proximoVencimiento) : "—") },
];

export function FinanzasLazzaCuentasCorrientes({ sociedadId }: { sociedadId: string }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerCuentas>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lado, setLado] = useState<"todos" | "cliente" | "proveedor">("todos");
  const [soloConSaldo, setSoloConSaldo] = useState(true);
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState<FilaCuentaCorriente | null>(null);
  const [movs, setMovs] = useState<any[] | null>(null);
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerCuentas(sociedadId, hoy)
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza · Cuentas corrientes:", e); if (vivo) setError("No se pudieron cargar las cuentas corrientes. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy]);

  // Movimientos de la cuenta abierta (últimos 100).
  useEffect(() => {
    if (!abierta) return;
    let vivo = true;
    setMovs(null);
    db.from("movimientos").select("id, tipo, monto, monto_original, moneda, descripcion, fecha, anulado, cliente_id, proveedor_id, nota_credito_compra_id, ajuste_sentido")
      .eq("sociedad_id", sociedadId).eq(abierta.lado === "cliente" ? "cliente_id" : "proveedor_id", abierta.entidadId)
      .order("fecha", { ascending: false }).limit(100)
      .then(({ data }: any) => { if (vivo) setMovs(data || []); });
    return () => { vivo = false; };
  }, [abierta, sociedadId]);

  const q = texto.trim().toLowerCase();
  const visibles = useMemo(() => (datos?.filas || [])
    .filter((f) => lado === "todos" || f.lado === lado)
    .filter((f) => !soloConSaldo || tieneSaldo(f))
    .filter((f) => !q || `${f.nombre} ${f.cuit}`.toLowerCase().includes(q))
    .sort((a, b) => (b.vencido.ARS - a.vencido.ARS) || (b.saldo.ARS - a.saldo.ARS)), [datos, lado, soloConSaldo, q]);

  const totales = useMemo(() => {
    const t = { cliente: { ARS: 0, USD: 0 }, proveedor: { ARS: 0, USD: 0 } };
    for (const f of visibles) { t[f.lado].ARS += f.saldo.ARS; t[f.lado].USD += f.saldo.USD; }
    return t;
  }, [visibles]);

  const facturasAbierta: FilaVencimiento[] = useMemo(() => !abierta || !datos ? [] : datos.vencimientos
    .filter((v) => v.entidadId === abierta.entidadId && (v.lado === "venta") === (abierta.lado === "cliente")), [abierta, datos]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {([["todos", "Todos"], ["cliente", "Clientes"], ["proveedor", "Proveedores"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setLado(k)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${lado === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {l}
          </button>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre o CUIT" className={`${control} w-full pl-8`} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={soloConSaldo} onChange={(e) => setSoloConSaldo(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Solo con saldo
        </label>
      </div>

      {!datos ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={COLUMNAS} data={visibles} onRowClick={setAbierta} emptyMessage="No hay cuentas con ese filtro" />
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} cuentas</span>
            {lado !== "proveedor" && <span className="text-zinc-500">Nos deben <b className="font-mono text-emerald-700 dark:text-emerald-400">{montos(totales.cliente, "$ 0")}</b></span>}
            {lado !== "cliente" && <span className="text-zinc-500">Les debemos <b className="font-mono text-orange-700 dark:text-orange-400">{montos(totales.proveedor, "$ 0")}</b></span>}
          </div>
        </div>
      )}

      {abierta && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAbierta(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">{abierta.nombre}</h2>
                <p className="text-sm text-zinc-500">{abierta.lado === "cliente" ? "Cliente" : "Proveedor"}{abierta.cuit ? ` · CUIT ${abierta.cuit}` : ""}</p>
              </div>
              <button type="button" aria-label="Cerrar" onClick={() => setAbierta(null)} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60"><p className="text-xs text-zinc-500">Saldo</p><p className="font-mono font-semibold">{montos(abierta.saldo, "$ 0")}</p></div>
              <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60"><p className="text-xs text-zinc-500">Vencido</p><p className="font-mono font-semibold text-red-600">{montos(abierta.vencido)}</p></div>
            </div>
            <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Facturas con saldo</h3>
            {facturasAbierta.length === 0 ? <p className="mb-3 text-xs text-zinc-400">No tiene facturas con saldo.</p> : (
              <table className="mb-3 w-full text-xs">
                <thead><tr className="text-left text-[10px] uppercase text-zinc-400"><th className="py-1">Fecha</th><th>Vence</th><th>Comprobante</th><th className="text-right">Total</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {facturasAbierta.map((v) => (
                    <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1">{formatDate(v.fecha)}</td>
                      <td className={v.dias < 0 ? "font-semibold text-red-600" : ""}>{formatDate(v.vence)}</td>
                      <td className="font-mono">{v.comprobante}</td>
                      <td className="text-right font-mono text-zinc-500">{formatCurrency(v.total, v.moneda)}</td>
                      <td className="text-right font-mono font-semibold">{formatCurrency(v.saldo, v.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Movimientos (últimos 100)</h3>
            {movs === null ? <p className="text-xs text-zinc-400">Cargando…</p> : movs.length === 0 ? <p className="text-xs text-zinc-400">Sin movimientos.</p> : (
              <table className="w-full text-xs">
                <tbody>
                  {movs.map((m) => {
                    const clase = clasificarMovimiento({ ...m, anulado: false });
                    const monto = m.anulado ? Number(m.monto_original ?? m.monto) : Number(m.monto);
                    return (
                      <tr key={m.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${m.anulado ? "text-zinc-400 line-through" : ""}`}>
                        <td className="py-1 pr-2 whitespace-nowrap">{formatDate(m.fecha)}</td>
                        <td className="pr-2">{m.descripcion || m.tipo}</td>
                        <td className={`text-right font-mono whitespace-nowrap ${m.anulado ? "" : clase === "ingreso" || clase === "retencion_sufrida" ? "text-emerald-600" : clase === "egreso" ? "text-red-600" : ""}`}>
                          {formatCurrency(monto, m.moneda === "USD" ? "USD" : "ARS")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
