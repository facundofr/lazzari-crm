"use client";

// Bancos > Movimientos > "Ver por tipo" (24/10/2026, Augusto): todas las líneas del banco en una sola pantalla.
// Arriba una tarjeta por tipo (cantidad, entradas y salidas); al tocarla, la tabla se filtra a ese tipo.
// Entradas y salidas se ven por separado, y la suma de los tipos tiene que dar el total del extracto.
// Solo lee: no guarda ni cambia nada. La clasificación está en lib/movimientos-banco.ts (prueba: scripts/test-movimientos-banco.ts).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { codigoDeConcepto, sinCodigoBanco } from "@/lib/bbva-codigos";
import { clasificarMovimiento, detalleDebitoAutomatico, resumenImpuestos, resumenPorTipo, TIPOS_MOV, type LineaMov, type TipoMov } from "@/lib/movimientos-banco";
import { CheckCircle2, Loader2 } from "lucide-react";

interface Fila extends LineaMov { cuenta_id: string; estado: string | null; nota: string | null }
interface CuentaMin { id: string; nombre: string }

const POR_PAGINA = 50;
const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (m: string) => `${NOMBRE_MES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MovimientosPorTipo({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [cuentas, setCuentas] = useState<CuentaMin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mes, setMes] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [tipoSel, setTipoSel] = useState<TipoMov | "">("");
  const [sentido, setSentido] = useState<"" | "credito" | "debito">("");
  const [texto, setTexto] = useState("");
  const [visibles, setVisibles] = useState(POR_PAGINA);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const db = supabase as any;
        const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("id, nombre").eq("sociedad_id", sociedadId).order("orden");
        if (e1) throw e1;
        const ids = (cs || []).map((c: CuentaMin) => c.id);
        const ls = ids.length
          ? await traerTodo<Fila>(() => db.from("extracto_movimientos")
              .select("id, cuenta_id, fecha, descripcion, monto, tipo, estado, clasificacion, subtipo, nota")
              .in("cuenta_id", ids).order("fecha", { ascending: false }).order("id"))
          : [];
        if (!vivo) return;
        const conLineas = new Set(ls.map((l) => l.cuenta_id));
        setCuentas((cs || []).filter((c: CuentaMin) => conLineas.has(c.id)));
        setFilas(ls.map((l) => ({ ...l, monto: Number(l.monto), fecha: String(l.fecha).slice(0, 10) })));
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
      }
    })();
    return () => { vivo = false; };
  }, [sociedadId]);

  const meses = useMemo(() => [...new Set((filas || []).map((f) => f.fecha.slice(0, 7)))].sort().reverse(), [filas]);
  const base = useMemo(() => (filas || []).filter((f) => (!mes || f.fecha.startsWith(mes)) && (!cuenta || f.cuenta_id === cuenta)), [filas, mes, cuenta]);
  const resumen = useMemo(() => resumenPorTipo(base), [base]);
  const impuestos = useMemo(() => resumenImpuestos(base), [base]);
  const total = useMemo(() => ({
    entradas: resumen.reduce((a, r) => a + r.entradas, 0), salidas: resumen.reduce((a, r) => a + r.salidas, 0),
    cant: resumen.reduce((a, r) => a + r.cantEntradas + r.cantSalidas, 0),
  }), [resumen]);

  const tabla = useMemo(() => {
    const q = sinAcentos(texto.trim());
    return base
      .map((f) => ({ f, c: clasificarMovimiento(f) }))
      .filter(({ f, c }) => (!tipoSel || c.tipo === tipoSel) && (!sentido || f.tipo === sentido)
        && (!q || sinAcentos(`${sinCodigoBanco(f.descripcion)} ${c.categoria} ${c.tipo === "debitos_automaticos" ? detalleDebitoAutomatico(f.nota) : ""}`).includes(q) || String(f.monto).includes(q.replace(",", "."))));
  }, [base, tipoSel, sentido, texto]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">No se pudieron leer los movimientos: {error}</p>;
  if (!filas) return <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo los movimientos…</p>;
  if (!filas.length) return <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-700">Todavía no hay movimientos cargados. Subí el Excel en "Para confirmar".</p>;

  const elegir = (t: TipoMov | "") => { setTipoSel(t); setVisibles(POR_PAGINA); };
  const tarjeta = "rounded-xl border p-2.5 text-left text-xs transition";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={mes} onChange={(e) => { setMes(e.target.value); setVisibles(POR_PAGINA); }} className="w-44 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
          <option value="">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
        </select>
        {cuentas.length > 1 && (
          <select value={cuenta} onChange={(e) => { setCuenta(e.target.value); setVisibles(POR_PAGINA); }} className="w-48 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
            <option value="">Todas las cuentas</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        )}
        <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Cuadra: {total.cant} líneas, todas en algún tipo · entradas {formatCurrency(total.entradas)} · salidas {formatCurrency(total.salidas)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <button type="button" onClick={() => elegir("")} className={`${tarjeta} ${!tipoSel ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"}`}>
          <p className="font-semibold text-zinc-900 dark:text-white">Todos</p>
          <p className="text-zinc-500">{total.cant} líneas</p>
        </button>
        {TIPOS_MOV.map((t) => {
          const r = resumen.find((x) => x.tipo === t.id)!;
          const cant = r.cantEntradas + r.cantSalidas;
          const rojo = t.id === "sin_clasificar" && cant > 0;
          return (
            <button key={t.id} type="button" title={t.ayuda} onClick={() => elegir(t.id)}
              className={`${tarjeta} ${tipoSel === t.id ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : rojo ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"} ${!cant ? "opacity-50" : ""}`}>
              <p className={`font-semibold ${rojo ? "text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-white"}`}>{t.nombre}</p>
              <p className="text-zinc-500">{cant} líneas</p>
              <p className="text-emerald-700 dark:text-emerald-400">Entradas {r.cantEntradas ? formatCurrency(r.entradas) : "—"}</p>
              <p className="text-red-700 dark:text-red-400">Salidas {r.cantSalidas ? formatCurrency(r.salidas) : "—"}</p>
            </button>
          );
        })}
      </div>

      {tipoSel === "impuestos_comisiones" && impuestos.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-1 text-xs text-zinc-500">Por categoría: el costo y las devoluciones van separados (no se restan).</p>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-zinc-500"><th className="py-1">Categoría</th><th className="py-1 text-right">Costo</th><th className="py-1 text-right">Devoluciones</th></tr></thead>
            <tbody>
              {impuestos.map((c) => (
                <tr key={c.categoria} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">{c.categoria}</td>
                  <td className="py-1 text-right">{formatCurrency(c.salidas)} <span className="text-zinc-400">({c.cantSalidas})</span></td>
                  <td className="py-1 text-right">{c.cantDevoluciones ? formatCurrency(c.devoluciones) : "—"} {c.cantDevoluciones ? <span className="text-zinc-400">({c.cantDevoluciones})</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {([["", "Todas"], ["credito", "Entradas"], ["debito", "Salidas"]] as const).map(([v, n]) => (
            <button key={v} type="button" onClick={() => { setSentido(v); setVisibles(POR_PAGINA); }}
              className={`rounded-md px-3 py-1 ${sentido === v ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>{n}</button>
          ))}
        </div>
        <input value={texto} onChange={(e) => { setTexto(e.target.value); setVisibles(POR_PAGINA); }} placeholder="Buscar por texto o importe"
          className="w-60 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900" />
        <span className="text-zinc-500">{tabla.length} líneas</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-700">
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2 text-right">Entrada</th><th className="px-3 py-2 text-right">Salida</th>
            </tr>
          </thead>
          <tbody>
            {tabla.slice(0, visibles).map(({ f, c }) => (
              <tr key={f.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="whitespace-nowrap px-3 py-1.5">{formatDate(f.fecha)}</td>
                <td className="px-3 py-1.5">
                  {sinCodigoBanco(f.descripcion)}
                  {codigoDeConcepto(f.descripcion) && <span className="ml-1 text-[10px] text-zinc-400">#{codigoDeConcepto(f.descripcion)}</span>}
                  {c.tipo === "debitos_automaticos" && detalleDebitoAutomatico(f.nota) && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{detalleDebitoAutomatico(f.nota)}</span>}
                  {/* Finanzas simple: las transferencias se registran y no se cruzan; no quedan "Pendiente" para siempre (auditoría UX 26/10/2026, arreglo 6). */}
                  {f.estado === "pendiente" && (c.tipo === "transferencias"
                    ? <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="Las transferencias se registran y no se cruzan con cobros y pagos">Registrada</span>
                    : <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Pendiente</span>)}
                </td>
                <td className="px-3 py-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  {TIPOS_MOV.find((t) => t.id === c.tipo)!.nombre}{c.categoria ? ` · ${c.categoria}` : ""}{c.devolucion ? " · devolución" : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-emerald-700 dark:text-emerald-400">{f.tipo === "credito" ? formatCurrency(f.monto) : ""}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right text-red-700 dark:text-red-400">{f.tipo === "debito" ? formatCurrency(f.monto) : ""}</td>
              </tr>
            ))}
            {!tabla.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-500">No hay líneas con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      {tabla.length > visibles && (
        <button type="button" onClick={() => setVisibles((v) => v + POR_PAGINA)} className="text-sm text-orange-600 hover:underline">Mostrar {Math.min(POR_PAGINA, tabla.length - visibles)} más</button>
      )}
    </div>
  );
}
