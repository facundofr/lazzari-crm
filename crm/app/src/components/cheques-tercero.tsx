"use client";

// Finanzas > Cheques Martín F.: cheques propios que cubre otra persona al vencimiento (echeqs.cubre_tercero).
// Cuentan en lo comprometido de la cuenta corriente; esta lista es para ir avisándole antes de cada débito.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Copy, Loader2, Plus, X } from "lucide-react";

interface ChequeTercero {
  id: string;
  numero: string;
  monto: number;
  fecha_emision: string | null;
  fecha_pago: string;
  estado: string;
  destino_nombre: string | null;
  cubre_tercero: string;
  cubierto_at: string | null;
}

const PENDIENTE = ["pendiente", "entregado"];
const TERCERO_POR_DEFECTO = "Martín Fernández";

function diasHasta(hoy: string, fecha: string) {
  return Math.round((Date.parse(`${fecha.slice(0, 10)}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / 86400000);
}

export default function ChequesTercero() {
  const { sociedadActiva } = useUser();
  const sociedadId = sociedadActiva?.id;
  const [cheques, setCheques] = useState<ChequeTercero[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const [nuevoNumero, setNuevoNumero] = useState("");
  const [guardando, setGuardando] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const hoy = todayAR();

  const cargar = useCallback(async () => {
    if (!sociedadId) return;
    setLoading(true);
    setError(null);
    try {
      const lista = await traerTodo<ChequeTercero>(() => (supabase as any).from("echeqs")
        .select("id, numero, monto, fecha_emision, fecha_pago, estado, destino_nombre, cubre_tercero, cubierto_at")
        .eq("sociedad_id", sociedadId).not("cubre_tercero", "is", null).order("fecha_pago").order("id"));
      setCheques(lista);
      setFaltaMigracion(false);
    } catch (e: any) {
      if (/cubre_tercero/.test(String(e?.message || ""))) setFaltaMigracion(true);
      else setError(e?.message || "No se pudieron leer los cheques.");
    } finally {
      setLoading(false);
    }
  }, [sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const pendientes = useMemo(() => cheques.filter((c) => PENDIENTE.includes(c.estado)), [cheques]);
  const visibles = verTodos ? cheques : pendientes;
  const totalPendiente = pendientes.reduce((a, c) => a + Number(c.monto || 0), 0);
  const proximo = pendientes.find((c) => c.fecha_pago >= hoy);
  const sinCubrirDebitados = cheques.filter((c) => c.estado === "cobrado" && !c.cubierto_at);

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    setGuardando(id);
    const { error: e } = await (supabase as any).from("echeqs").update(cambios).eq("id", id).eq("sociedad_id", sociedadId);
    setGuardando(null);
    if (e) { alert(`No se pudo guardar: ${e.message}`); return; }
    await cargar();
  }

  async function agregar() {
    const n = nuevoNumero.trim().replace(/^0+/, "");
    if (!n || !sociedadId) return;
    setGuardando("nuevo");
    const { data, error: e } = await (supabase as any).from("echeqs").select("id, numero, cubre_tercero")
      .eq("sociedad_id", sociedadId).eq("direccion", "emitido").ilike("numero", `%${n}`);
    const ch = (data || []).find((x: { numero: string }) => String(x.numero).replace(/^0+/, "") === n);
    setGuardando(null);
    if (e) { alert(`No se pudo buscar el cheque: ${e.message}`); return; }
    if (!ch) { alert(`No encontré el cheque emitido N° ${nuevoNumero.trim()}. Si no está cargado, subí la planilla en Extractos > "Completar cheques emitidos".`); return; }
    setNuevoNumero("");
    await actualizar(ch.id, { cubre_tercero: TERCERO_POR_DEFECTO });
  }

  async function copiarAviso(c: ChequeTercero) {
    const texto = `Hola Martín, te aviso que el ${formatDate(c.fecha_pago)} se debita el cheque ${c.numero} por ${formatCurrency(Number(c.monto))}.`;
    try { await navigator.clipboard.writeText(texto); setCopiado(c.id); setTimeout(() => setCopiado(null), 2000); }
    catch { alert(texto); }
  }

  if (!sociedadId) return null;
  if (faltaMigracion) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div><b>Falta correr la migración del extracto BBVA</b> (20261011180000_extractos_bbva.sql) para marcar los cheques de Martín.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500">Pendientes de debitar</p>
          <p className="text-2xl font-bold text-orange-500">{formatCurrency(totalPendiente)}</p>
          <p className="text-xs text-zinc-500">{pendientes.length} cheques. Los cubre {TERCERO_POR_DEFECTO}; salen de la cuenta corriente.</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500">Próximo débito</p>
          <p className="text-2xl font-bold text-zinc-900 dark:text-white">{proximo ? formatDate(proximo.fecha_pago) : "—"}</p>
          <p className="text-xs text-zinc-500">{proximo ? `Cheque ${proximo.numero} · ${formatCurrency(Number(proximo.monto))} · en ${diasHasta(hoy, proximo.fecha_pago)} días` : "No hay cheques pendientes."}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500">Debitados sin marcar "Ya cubrió"</p>
          <p className={`text-2xl font-bold ${sinCubrirDebitados.length ? "text-red-600" : "text-emerald-600"}`}>{sinCubrirDebitados.length}</p>
          <p className="text-xs text-zinc-500">{sinCubrirDebitados.length ? formatCurrency(sinCubrirDebitados.reduce((a, c) => a + Number(c.monto || 0), 0)) : "Todo cubierto."}</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-zinc-900 dark:text-white">Cheques a cubrir por {TERCERO_POR_DEFECTO}</p>
            <button onClick={() => setVerTodos((v) => !v)} className="text-xs font-medium text-orange-600 hover:underline">{verTodos ? "Solo pendientes" : `Ver todos (${cheques.length})`}</button>
          </div>
          <div className="flex items-center gap-1">
            <input value={nuevoNumero} onChange={(e) => setNuevoNumero(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void agregar(); }}
              placeholder="N° de cheque" className="w-32 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            <button onClick={() => void agregar()} disabled={!nuevoNumero.trim() || guardando !== null} className="flex items-center gap-1 rounded-lg bg-orange-500 px-2 py-1 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
              {guardando === "nuevo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Agregar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : visibles.length === 0 ? (
          <p className="text-sm text-zinc-500">No hay cheques {verTodos ? "" : "pendientes "}marcados. Se marcan solos al subir la planilla (columna "Es Martín Fernández") o con el N° acá arriba.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-3">N° cheque</th>
                  <th className="py-1 pr-3">Emisión</th>
                  <th className="py-1 pr-3">Se debita</th>
                  <th className="py-1 pr-3 text-right">Monto</th>
                  <th className="py-1 pr-3">Estado</th>
                  <th className="py-1 pr-3">Aviso</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => {
                  const pend = PENDIENTE.includes(c.estado);
                  const d = diasHasta(hoy, c.fecha_pago);
                  return (
                    <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1.5 pr-3 font-mono">{c.numero}</td>
                      <td className="py-1.5 pr-3">{c.fecha_emision ? formatDate(c.fecha_emision) : "—"}</td>
                      <td className="py-1.5 pr-3 font-medium">{formatDate(c.fecha_pago)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{formatCurrency(Number(c.monto))}</td>
                      <td className="py-1.5 pr-3">
                        {pend ? <Badge variant="warning">Pendiente</Badge>
                          : c.estado === "cobrado" ? (c.cubierto_at ? <Badge variant="success">Debitado · cubrió</Badge> : <Badge variant="danger">Debitado · falta que cubra</Badge>)
                          : <Badge variant="outline">{c.estado}</Badge>}
                      </td>
                      <td className="py-1.5 pr-3 text-xs">
                        {pend && (d < 0 ? <span className="font-semibold text-red-600">Venció hace {-d} días (¿ya se debitó?)</span>
                          : d <= 3 ? <span className="font-semibold text-orange-600">Avisale ya: {d === 0 ? "hoy" : `en ${d} días`}</span>
                          : <span className="text-zinc-500">en {d} días</span>)}
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          {pend && (
                            <button onClick={() => void copiarAviso(c)} title="Copiar mensaje para mandarle" className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                              {copiado === c.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                            </button>
                          )}
                          {(c.estado === "cobrado" || pend) && (
                            <button onClick={() => void actualizar(c.id, { cubierto_at: c.cubierto_at ? null : new Date().toISOString() })} disabled={guardando !== null}
                              className={`rounded-md px-2 py-0.5 text-xs font-medium ${c.cubierto_at ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700 dark:hover:bg-zinc-800"}`}>
                              {c.cubierto_at ? "Cubrió ✓" : "Ya cubrió"}
                            </button>
                          )}
                          <button onClick={() => { if (confirm(`¿Sacar el cheque ${c.numero} de la lista de ${c.cubre_tercero}? (el cheque no se toca)`)) void actualizar(c.id, { cubre_tercero: null, cubierto_at: null }); }}
                            title="Sacar de la lista" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">La campana avisa 3 días antes de cada débito. Cuando el débito aparece en el extracto, el cheque pasa a "Debitado".</p>
      </div>
    </div>
  );
}
