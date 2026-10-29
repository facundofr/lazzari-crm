"use client";

// Premios del mes (Augusto 28/10/2026). Solo Lazzari. Solo sugiere: el gasto lo carga Augusto con el botón, confirmando. Cuentas en lib/premios-lazza.ts.
//  - LineaPremio: en Reportes/Objetivos, "Premio del mes: $ 200.000 para cada uno, se paga con el sueldo de [mes siguiente]".
//  - PremiosCarga: en Gastos, "Premios de [mes anterior]" con los que faltan cargar y el botón Cargar premios (crea el gasto en el grupo Premios y su pago).
import { useCallback, useEffect, useState } from "react";
import { Award, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, todayAR } from "@/lib/utils";
import { reporteBasico } from "@/lib/finanzas-lazza";
import { mesAnterior, mesSiguiente, nombreMesPremio, premioDelMes, premiosPorCargar } from "@/lib/premios-lazza";
import { traerDatosReporte } from "./datos";

const db = supabase as any;

/** Línea bajo la barra de Objetivos: qué premio va ganando el mes. Solo en Lazzari. */
export function LineaPremio({ neto, periodo }: { neto: number; periodo: string }) {
  const { sociedadActiva } = useUser();
  if (sociedadActiva?.nombre !== "Lazzari") return null;
  const p = premioDelMes(neto);
  const pagaCon = nombreMesPremio(mesSiguiente(periodo));
  return (
    <p className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
      <Award className={`h-3.5 w-3.5 ${p.porPersona > 0 ? "text-emerald-600" : "text-zinc-400"}`} />
      {p.porPersona > 0
        ? <>Premio del mes: <b>{formatCurrency(p.porPersona)}</b> para cada uno ({p.personas.length} personas, <b>{formatCurrency(p.total)}</b> en total). Se paga con el sueldo de {pagaCon}.</>
        : <>Premio del mes: todavía no se llegó al Bueno (el premio es de $ 200.000 en Bueno y $ 400.000 en Muy bueno, para cada uno).</>}
    </p>
  );
}

/** Tarjeta de Gastos: los premios del mes anterior (los que se pagan con el sueldo de este mes). Solo en Lazzari. */
export function PremiosCarga({ sociedadId, periodo, onCargado }: { sociedadId: string; periodo: string; onCargado: () => void }) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [estado, setEstado] = useState<{ mes: string; neto: number; faltan: ReturnType<typeof premiosPorCargar>; hechos: number } | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);
  const esLazzari = sociedadActiva?.nombre === "Lazzari";
  const mes = mesAnterior(periodo);

  const leer = useCallback(async () => {
    try {
      setError(false);
      const datos = await traerDatosReporte(sociedadId, mes);
      const neto = reporteBasico({ periodo: mes, ...datos }).objetivo.neto;
      const prefijo = `Premio ${nombreMesPremio(mes)} — `;
      const { data, error: e } = await db.from("gastos_manuales").select("descripcion").eq("sociedad_id", sociedadId).eq("grupo", "Premios").ilike("descripcion", `${prefijo}%`);
      if (e) throw e;
      const yaCargados = ((data as { descripcion: string }[]) || []).map((g) => g.descripcion);
      const faltan = premiosPorCargar(mes, neto, yaCargados);
      setEstado({ mes, neto, faltan, hechos: premioDelMes(neto).personas.length - faltan.length });
    } catch (e) {
      console.error("Premios del mes:", e);
      setError(true);
    }
  }, [sociedadId, mes]);

  useEffect(() => { setEstado(null); if (esLazzari) void leer(); }, [esLazzari, leer]);

  if (!esLazzari) return null;
  if (error) return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">No se pudieron calcular los premios del mes anterior. Recargá la página.</p>;
  if (!estado) return <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Calculando premios…</p>;

  const nombre = nombreMesPremio(estado.mes);
  const p = premioDelMes(estado.neto);
  if (p.porPersona <= 0) return null; // el mes anterior no llegó al Bueno: no hay premio, no se muestra nada
  if (!estado.faltan.length) return <p className="text-xs text-zinc-500">Premios de {nombre} ya cargados ({estado.hechos} personas, {formatCurrency(p.porPersona)} cada uno).</p>;

  async function cargar() {
    if (!estado) return;
    const lista = estado.faltan.map((x) => `${x.persona}: ${formatCurrency(x.monto)}`).join("\n");
    if (!confirm(`¿Cargar los premios de ${nombre} (se pagan con el sueldo de este mes)?\n\n${lista}\n\nSe crea un gasto en Premios por persona, con su pago en Movimientos.`)) return;
    setCargando(true);
    let fallas = 0;
    for (const x of estado.faltan) {
      const fecha = todayAR();
      // Auditoría H21: gasto y pago juntos en la base (crear_gasto_con_pago).
      const { error: e } = await db.rpc("crear_gasto_con_pago", {
        p_sociedad_id: sociedadId,
        p_gasto: { fecha, descripcion: x.detalle, categoria: "Premios", grupo: "Premios", monto: x.monto, moneda: "ARS", medio_pago: "transferencia",
          tipo_gasto: "general", tipo_recurrencia: "eventual", notas: `Premio del mes de ${nombre}: nivel ${p.nivel === "muy_bueno" ? "Muy bueno" : "Bueno"} sobre el neto facturado.` },
        p_descripcion_pago: `Gasto — Premios — ${x.detalle}`,
      });
      if (e) { fallas++; toast.error(`No se pudo cargar el premio de ${x.persona}: ${e.message}`); continue; }
    }
    setCargando(false);
    if (!fallas) toast.success(`Premios de ${nombre} cargados`);
    onCargado();
    void leer();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <Award className="h-4 w-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-emerald-900 dark:text-emerald-200">Premios de {nombre}: mes {p.nivel === "muy_bueno" ? "muy bueno" : "bueno"} ({formatCurrency(estado.neto)} neto facturado)</p>
        <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
          {formatCurrency(p.porPersona)} para cada uno · faltan cargar: {estado.faltan.map((x) => x.persona).join(", ")}. Se pagan con el sueldo de este mes.
        </p>
      </div>
      <button type="button" disabled={cargando} onClick={cargar}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
        {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Award className="h-3 w-3" />} Cargar premios
      </button>
    </div>
  );
}
