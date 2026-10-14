"use client";

// Configuración → Fechas de cheque: los días del mes en que se centralizan los cheques que emitimos (ej. octubre 12 · 21 · 31).
// Con estas fechas la orden de pago y el plan de pagos proponen los cheques. Si un día cae feriado o fin de semana, avisa
// cuándo se debitaría (nunca frena).
import { useEffect, useState } from "react";
import { CalendarDays, Loader2, Save } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { diaHabilDesde, esDiaHabil } from "@/lib/dias-habiles";
import { todayAR } from "@/lib/utils";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function proximosMeses(desde: string, n: number): string[] {
  const [a, m] = desde.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const total = a * 12 + (m - 1) + i;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
  });
}

function fechaDelMes(mes: string, dia: number): string {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

export function FechasChequeConfig() {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const meses = proximosMeses(todayAR().slice(0, 7) + "-01", 6);
  const [dias, setDias] = useState<Record<string, string[]>>({});
  const [guardados, setGuardados] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    if (!sociedadActiva?.id) return;
    let cancelado = false;
    (async () => {
      setCargando(true);
      const { data, error } = await (supabase as any).from("cheque_fechas_mes").select("mes, dias")
        .eq("sociedad_id", sociedadActiva.id).gte("mes", meses[0]).lte("mes", meses[meses.length - 1]);
      if (cancelado) return;
      setCargando(false);
      if (error) { toast.error(`No se pudieron leer las fechas de cheque: ${error.message}`); return; }
      const d: Record<string, string[]> = {};
      const g: Record<string, string> = {};
      for (const r of (data || []) as { mes: string; dias: number[] }[]) {
        const k = r.mes.slice(0, 10);
        d[k] = [...r.dias.map(String), "", "", ""].slice(0, Math.max(3, r.dias.length));
        g[k] = r.dias.join(",");
      }
      setDias(d);
      setGuardados(g);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sociedadActiva?.id]);

  const valores = (mes: string) => dias[mes] || ["", "", ""];
  const numeros = (mes: string) => Array.from(new Set(valores(mes).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31))).sort((a, b) => a - b);

  async function guardar(mes: string) {
    if (!sociedadActiva?.id) return;
    const lista = numeros(mes);
    if (lista.length === 0) { toast.warning("Poné al menos un día (1 a 31)"); return; }
    setGuardando(mes);
    const { error } = await (supabase as any).from("cheque_fechas_mes")
      .upsert({ sociedad_id: sociedadActiva.id, mes, dias: lista, updated_at: new Date().toISOString() }, { onConflict: "sociedad_id,mes" });
    setGuardando(null);
    if (error) { toast.error(`No se pudo guardar: ${error.message}`); return; }
    setGuardados((g) => ({ ...g, [mes]: lista.join(",") }));
    toast.success(`Fechas de ${MESES[Number(mes.slice(5, 7)) - 1]} guardadas`);
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-orange-500" />
        <h3 className="text-sm font-semibold">Fechas de cheque por mes</h3>
        {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
      </div>
      <p className="mb-2 text-xs text-zinc-500">Los días en que se centralizan los cheques que emitimos. La orden de pago y el plan de pagos proponen los cheques en estas fechas (siempre que el proveedor lo permita). Es una sugerencia: se puede cambiar en cada pago.</p>
      <div className="space-y-1.5">
        {meses.map((mes) => {
          const lista = numeros(mes);
          const cambiado = lista.join(",") !== (guardados[mes] || "");
          return (
            <div key={mes} className="flex flex-wrap items-start gap-3 rounded-lg border border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
              <div className="w-32 pt-1 text-sm font-medium">{MESES[Number(mes.slice(5, 7)) - 1]} {mes.slice(0, 4)}</div>
              <div className="flex flex-wrap gap-3">
                {valores(mes).map((v, i) => {
                  const n = Number(v);
                  const fecha = Number.isInteger(n) && n >= 1 && n <= 31 ? fechaDelMes(mes, n) : "";
                  const dia = fecha ? new Date(`${fecha}T12:00:00Z`).getUTCDay() : -1;
                  return (
                    <div key={i} className="w-24">
                      <input value={v} inputMode="numeric" aria-label={`Día ${i + 1} de ${MESES[Number(mes.slice(5, 7)) - 1]}`} placeholder="Día"
                        onChange={(e) => setDias((d) => ({ ...d, [mes]: valores(mes).map((x, j) => (j === i ? e.target.value.replace(/\D/g, "").slice(0, 2) : x)) }))}
                        className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
                      {fecha && <p className={`mt-0.5 text-[10px] ${esDiaHabil(fecha) ? "text-zinc-400" : "text-amber-600"}`}>
                        {DIAS_SEMANA[dia]}{!esDiaHabil(fecha) && ` · se debita ${diaHabilDesde(fecha).slice(8, 10)}/${diaHabilDesde(fecha).slice(5, 7)}`}
                      </p>}
                    </div>
                  );
                })}
                {valores(mes).length < 6 && (
                  <button type="button" onClick={() => setDias((d) => ({ ...d, [mes]: [...valores(mes), ""] }))} className="h-8 px-1 text-xs text-orange-600 hover:underline">+ día</button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2 pt-0.5">
                {!guardados[mes] && !cambiado && <span className="text-[11px] text-amber-600">Sin fechas: se propone el vencimiento</span>}
                {cambiado && (
                  <button type="button" onClick={() => guardar(mes)} disabled={guardando === mes}
                    className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                    {guardando === mes ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Guardar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
