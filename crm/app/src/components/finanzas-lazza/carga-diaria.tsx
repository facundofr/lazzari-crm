"use client";

// Bancos y Finanzas (inicio) > "¿Está todo al día?" (25/10/2026, Augusto): la última carga de cada fuente del banco contra lo que corresponde.
// Todos los días hábiles: CC EPP y reportes de cheques (emitidos y recibidos). Hasta 7 días: CC INDU, cajas de ahorro y FCI (si nunca se cargaron, no se muestran).
// Es un aviso: no bloquea nada. Con `soloSiFalta` (inicio de Finanzas) aparece únicamente cuando falta cargar algo. Lógica en lib/carga-diaria (prueba: scripts/test-carga-diaria.ts).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { digitosCuenta } from "@/lib/extracto-bbva";
import { estadoCarga, estadoCargaSemanal, type EstadoCarga } from "@/lib/carga-diaria";
import { formatDate } from "@/lib/utils";

interface CuentaMin { nombre: string; tipo: string; numero: string | null; saldo_banco_fecha: string | null }
interface Fuente { clave: string; nombre: string; ultima: string | null; detalle: string; diaria: boolean }

const TIPOS_CON_EXTRACTO = new Set(["cuenta_corriente", "caja_ahorro", "fci"]);
const CC_EPP = digitosCuenta("091-312483/1");

export function CargaDiaria({ sociedadId, hoy, soloSiFalta = false, onIr }: { sociedadId: string; hoy: string; soloSiFalta?: boolean; onIr?: () => void }) {
  const [datos, setDatos] = useState<{ cuentas: CuentaMin[]; emitido: string | null; recibido: string | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const db = supabase as any;
      const ultima = async (direccion: string) => {
        const { data } = await db.from("echeqs").select("estado_banco_at").eq("sociedad_id", sociedadId).eq("direccion", direccion).not("estado_banco_at", "is", null).order("estado_banco_at", { ascending: false }).limit(1);
        return (data?.[0]?.estado_banco_at as string | undefined) || null;
      };
      const [cs, emitido, recibido] = await Promise.all([
        db.from("cuentas_financieras").select("nombre, tipo, numero, saldo_banco_fecha, orden").eq("sociedad_id", sociedadId).eq("activa", true).order("orden"),
        ultima("emitido"), ultima("recibido"),
      ]);
      if (vivo) setDatos({ cuentas: (cs.data || []) as CuentaMin[], emitido, recibido });
    })().catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [sociedadId]);

  const evaluadas = useMemo(() => {
    if (!datos) return [];
    const fuentes: Fuente[] = [
      ...datos.cuentas.filter((c) => TIPOS_CON_EXTRACTO.has(c.tipo) && c.numero).map((c) => ({
        clave: `c-${c.nombre}`, nombre: c.nombre, ultima: c.saldo_banco_fecha, detalle: "movimientos hasta", diaria: digitosCuenta(c.numero) === CC_EPP,
      })),
      { clave: "ch-e", nombre: "Cheques emitidos", ultima: datos.emitido, detalle: "reporte de eCheq del", diaria: true },
      { clave: "ch-r", nombre: "Cheques recibidos", ultima: datos.recibido, detalle: "reporte de eCheq del", diaria: true },
    ];
    return fuentes
      .map((f) => ({ f, e: f.diaria ? estadoCarga(f.ultima, hoy) : estadoCargaSemanal(f.ultima, hoy) }))
      // Lo que no se carga a diario y nunca se cargó no se muestra (ej. la caja de ahorro en dólares).
      .filter((x) => x.f.diaria || x.e.estado !== "sin_datos");
  }, [datos, hoy]);

  if (!datos) return null;
  const faltan = evaluadas.filter((x) => x.e.estado !== "al_dia");
  if (soloSiFalta && faltan.length === 0) return null;
  const color: Record<EstadoCarga, string> = {
    al_dia: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
    atrasada: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
    sin_datos: "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400",
  };

  return (
    <div className={`rounded-xl border p-3 text-sm ${faltan.length ? "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-white">
          {faltan.length === 0
            ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Todo al día</>
            : <><AlertTriangle className="h-4 w-4 text-amber-600" /> Falta cargar: {faltan.map((x) => x.f.nombre).join(", ")}</>}
        </p>
        {onIr && <button type="button" onClick={onIr} className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600">Ir a Bancos</button>}
      </div>
      {!soloSiFalta && (
        <div className="mt-2 flex flex-wrap gap-2">
          {evaluadas.map(({ f, e }) => (
            <span key={f.clave} className={`rounded-lg border px-2.5 py-1 text-xs ${color[e.estado]}`}
              title={f.diaria ? "Se carga todos los días hábiles" : "Se carga una vez por semana (o cuando haya movimiento)"}>
              <b>{f.nombre}</b>{" · "}
              {e.estado === "sin_datos" ? "sin cargar" : <>{f.detalle} {formatDate(String(f.ultima).slice(0, 10))}{e.estado === "atrasada" && e.dias !== null ? ` (hace ${e.dias} d)` : ""}</>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
