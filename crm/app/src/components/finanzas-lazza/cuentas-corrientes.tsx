"use client";

// Finanzas Lazza → Cuentas corrientes: clientes y proveedores en UNA lista.
// Cobrar (19/10): en la ficha del cliente se tildan facturas → "Cobrar" (la misma liquidación de Finanzas, ver cobrar.tsx).
// Pagar (19/10): en la ficha del proveedor se tildan facturas → "Pagar" (la misma OP de Finanzas, ver pagar.tsx).
// Saldo a favor (19/10): si al proveedor se le pagó antes (OP sin factura), se aplica a las facturas tildadas.
// Opción "Moneda: la de cada cuenta" (Augusto 19/10): cada saldo pasado a su moneda al dólar BNA del día (lib unificarMoneda).
// Saldos con las mismas reglas que Finanzas (lib/saldo-clientes y lib/saldo-proveedores); semáforo BCRA del último informe.
import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins, Loader2, Search, Wallet, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { armarCuentasCorrientes, semaforoPorEntidad, tieneSaldo, unificarMoneda, type FilaCuentaCorriente, type FilaVencimiento, type Semaforo } from "@/lib/finanzas-lazza";
import { clasificarMovimiento } from "@/lib/tipos-movimiento";
import { elegirDolares } from "@/lib/dolar-presupuesto";
import { traerDeudas } from "./datos";
import { CobrarCliente } from "./cobrar";
import { PagarProveedor } from "./pagar";
import { SaldoFavorFicha } from "@/components/saldo-favor-proveedor";

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
  const antes = new Date(Date.parse(`${hoy}T12:00:00Z`) - 15 * 86_400_000).toISOString().slice(0, 10);
  const [deudas, clientes, proveedores, bcraClientes, bcraProveedores, cotiz] = await Promise.all([
    traerDeudas(sociedadId, hoy),
    traerTodo<any>(() => db.from("clientes").select("id, razon_social, cuit, moneda_predeterminada").eq("sociedad_id", sociedadId).order("id")),
    traerTodo<any>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
    traerSemaforos("cliente_bcra_informes", "cliente_id", sociedadId),
    traerSemaforos("proveedor_bcra_informes", "proveedor_id", sociedadId),
    db.from("cotizaciones_dolar").select("fecha, tipo, valor_venta, fuente, es_manual").in("tipo", ["oficial_billetes", "oficial_divisas"]).gte("fecha", antes).lte("fecha", hoy).order("fecha", { ascending: false }),
  ]);
  const dolares = elegirDolares(cotiz?.data || [], hoy);
  const monedaCliente: Record<string, string | null> = {};
  for (const c of clientes) monedaCliente[c.id] = c.moneda_predeterminada ?? null;
  return {
    dolares, monedaCliente,
    filas: armarCuentasCorrientes({ clientes, proveedores, saldosClientes: deudas.saldosClientes, saldosProveedores: deudas.saldosProveedores, vencimientos: deudas.vencimientos, bcraClientes, bcraProveedores }),
    vencimientos: deudas.vencimientos,
  };
}

// Orden por el valor total en pesos (las cuentas en US$ no se van al fondo).
const columnas = (enPesos: (m: { ARS: number; USD: number }) => number): Column<FilaCuentaCorriente>[] => [
  { key: "nombre", label: "Nombre", sortable: true, sortValue: (f) => f.nombre, render: (f) => (
    <span className="flex items-center gap-2">
      {f.bcra && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_BCRA[f.bcra]}`} title={`BCRA: ${f.bcra}`} />}
      <span>{f.nombre}<span className="block text-[10px] text-zinc-400">{f.cuit ? `CUIT ${f.cuit}` : ""}{f.facturas ? ` · ${f.facturas} fact.` : ""}</span></span>
    </span>
  ) },
  { key: "lado", label: "Tipo", sortable: true, sortValue: (f) => f.lado, render: (f) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.lado === "cliente" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"}`}>{f.lado === "cliente" ? "Cliente" : "Proveedor"}</span> },
  { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => enPesos(f.saldo), className: "text-right", render: (f) => (
    <span className={`whitespace-nowrap font-mono ${f.saldo.ARS < 0 || f.saldo.USD < 0 ? "text-emerald-600" : "font-semibold"}`}>
      {montos(f.saldo, "$ 0")}
      {(f.saldo.ARS < 0 || f.saldo.USD < 0) && <span className="block text-[10px] font-sans">a favor {f.lado === "cliente" ? "del cliente" : "nuestro"}</span>}
    </span>
  ) },
  { key: "vencido", label: "Vencido", sortable: true, sortValue: (f) => enPesos(f.vencido), className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono ${f.vencido.ARS > 0 || f.vencido.USD > 0 ? "text-red-600" : "text-zinc-400"}`}>{montos(f.vencido)}</span> },
  { key: "proximo", label: "Próx. vencimiento", sortable: true, sortValue: (f) => f.proximoVencimiento || "9999", render: (f) => (f.proximoVencimiento ? formatDate(f.proximoVencimiento) : "—") },
];

export function FinanzasLazzaCuentasCorrientes({ sociedadId }: { sociedadId: string }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerCuentas>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lado, setLado] = useState<"todos" | "cliente" | "proveedor">("todos");
  const [soloConSaldo, setSoloConSaldo] = useState(true);
  const [texto, setTexto] = useState("");
  const [enSuMoneda, setEnSuMoneda] = useState(false);
  const [abierta, setAbierta] = useState<FilaCuentaCorriente | null>(null);
  const [movs, setMovs] = useState<any[] | null>(null);
  const [tildadas, setTildadas] = useState<Set<string>>(new Set());
  const [cobrando, setCobrando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerCuentas(sociedadId, hoy)
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        // Después de cobrar, la ficha abierta se actualiza con el saldo nuevo.
        setAbierta((prev) => (prev ? d.filas.find((f) => f.entidadId === prev.entidadId && f.lado === prev.lado) ?? null : prev));
      })
      .catch((e) => { console.error("Finanzas Lazza · Cuentas corrientes:", e); if (vivo) setError("No se pudieron cargar las cuentas corrientes. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);

  useEffect(() => { setTildadas(new Set()); setCobrando(false); }, [abierta?.entidadId]);

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
  // "Moneda: la de cada cuenta": saldo y vencido pasados a la moneda del cliente (proveedores en $), solo para mostrar.
  const filas = useMemo(() => {
    if (!datos) return [];
    if (!enSuMoneda) return datos.filas;
    const tc = { billete: datos.dolares.billete?.valor ?? null, divisa: datos.dolares.divisa?.valor ?? null };
    return datos.filas.map((f) => {
      const ficha = f.lado === "cliente" ? datos.monedaCliente[f.entidadId] : null;
      return { ...f, saldo: unificarMoneda(f.saldo, ficha, tc), vencido: unificarMoneda(f.vencido, ficha, tc) };
    });
  }, [datos, enSuMoneda]);

  const tcOrden = datos?.dolares.divisa?.valor || datos?.dolares.billete?.valor || 0;
  const enPesos = useCallback((m: { ARS: number; USD: number }) => m.ARS + m.USD * tcOrden, [tcOrden]);
  const cols = useMemo(() => columnas(enPesos), [enPesos]);

  const visibles = useMemo(() => filas
    .filter((f) => lado === "todos" || f.lado === lado)
    .filter((f) => !soloConSaldo || tieneSaldo(f))
    .filter((f) => !q || `${f.nombre} ${f.cuit}`.toLowerCase().includes(q))
    .sort((a, b) => (enPesos(b.vencido) - enPesos(a.vencido)) || (enPesos(b.saldo) - enPesos(a.saldo))), [filas, lado, soloConSaldo, q, enPesos]);

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
        <select value={enSuMoneda ? "una" : "separadas"} onChange={(e) => setEnSuMoneda(e.target.value === "una")} className={control} title="Pasa cada saldo a la moneda de esa cuenta al dólar BNA del día (solo para ver)">
          <option value="separadas">Moneda: $ y US$ separados</option>
          <option value="una">Moneda: la de cada cuenta</option>
        </select>
      </div>

      {!datos ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {enSuMoneda && (
            <p className="border-b border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-700">
              Cada cuenta en su moneda (ficha del cliente: US$ divisa, US$ billete o $; proveedores en $), al dólar BNA
              {datos.dolares.divisa ? ` divisa ${formatCurrency(datos.dolares.divisa.valor)} (${formatDate(datos.dolares.divisa.fecha)})` : " divisa: sin dato"}
              {datos.dolares.billete ? ` · billete ${formatCurrency(datos.dolares.billete.valor)} (${formatDate(datos.dolares.billete.fecha)})` : " · billete: sin dato"}. Solo para ver: no cambia nada.
            </p>
          )}
          <DataTable columns={cols} data={visibles} onRowClick={setAbierta} emptyMessage="No hay cuentas con ese filtro" />
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
            {abierta.lado === "proveedor" && (
              <SaldoFavorFicha sociedadId={sociedadId} proveedorId={abierta.entidadId} recarga={recarga}
                facturas={facturasAbierta.filter((v) => tildadas.has(v.id)).map((v) => ({ id: v.id, comprobante: v.comprobante, saldo: v.saldo, moneda: v.moneda }))}
                onAplicado={() => { setTildadas(new Set()); setRecarga((n) => n + 1); }} />
            )}
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase text-zinc-500">Facturas con saldo</h3>
              {abierta.lado === "cliente" ? (
                <button type="button" onClick={() => setCobrando(true)} title={tildadas.size ? "Cobrar las facturas tildadas" : "Elegir facturas y cobrar"}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                  <HandCoins className="h-3.5 w-3.5" /> Cobrar{tildadas.size ? ` (${tildadas.size})` : ""}
                </button>
              ) : (
                <button type="button" onClick={() => setCobrando(true)} title={tildadas.size ? "Pagar las facturas tildadas" : "Elegir facturas y pagar"}
                  className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600">
                  <Wallet className="h-3.5 w-3.5" /> Pagar{tildadas.size ? ` (${tildadas.size})` : ""}
                </button>
              )}
            </div>
            {facturasAbierta.length === 0 ? <p className="mb-3 text-xs text-zinc-400">No tiene facturas con saldo.</p> : (
              <table className="mb-3 w-full text-xs">
                <thead><tr className="text-left text-[10px] uppercase text-zinc-400"><th className="w-6" /><th className="py-1">Fecha</th><th>Vence</th><th>Comprobante</th><th className="text-right">Total</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {facturasAbierta.map((v) => (
                    <tr key={v.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${tildadas.has(v.id) ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                      <td><input type="checkbox" aria-label={`Tildar ${v.comprobante}`} className="h-3.5 w-3.5 accent-orange-500" checked={tildadas.has(v.id)}
                        onChange={(e) => setTildadas((prev) => { const n = new Set(prev); if (e.target.checked) n.add(v.id); else n.delete(v.id); return n; })} /></td>
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
      {cobrando && abierta?.lado === "cliente" && (
        <CobrarCliente sociedadId={sociedadId} clienteId={abierta.entidadId} clienteNombre={abierta.nombre} preseleccion={[...tildadas]} directo={tildadas.size > 0}
          onClose={() => setCobrando(false)} onCobrado={() => { setTildadas(new Set()); setRecarga((n) => n + 1); }} />
      )}
      {cobrando && abierta?.lado === "proveedor" && (
        <PagarProveedor sociedadId={sociedadId} proveedorId={abierta.entidadId} facturaIds={[...tildadas]}
          onClose={() => setCobrando(false)} onPagado={() => { setTildadas(new Set()); setRecarga((n) => n + 1); }} />
      )}
    </div>
  );
}
