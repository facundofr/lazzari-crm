"use client";

// Bancos y Finanzas (inicio) > "¿Está todo al día?" (25/10/2026, Augusto): la última carga de cada fuente del banco contra lo que corresponde.
// Todos los días hábiles: CC EPP y reportes de cheques (emitidos y recibidos). Hasta 7 días: CC INDU, cajas de ahorro y FCI (si nunca se cargaron, no se muestran).
// Es un aviso: no bloquea nada. Con `soloSiFalta` (inicio de Finanzas) aparece únicamente cuando falta cargar algo. Lógica en lib/carga-diaria (prueba: scripts/test-carga-diaria.ts).
// La fecha de cada cuenta es la más reciente entre su último movimiento y la última vez que se subió su extracto (registro "extracto_cargado"):
// una cuenta sin movimientos (ej. la INDU) queda al día con solo subir el Excel y apretar Guardar.
// 26/10/2026 — Finanzas simple (Augusto): el Excel "Movimientos" de cada cuenta se sube UNA VEZ POR MES (al cierre) y los reportes de eCheq
// todos los días hábiles. La fecha de una cuenta es solo la de la última vez que se SUBIÓ (la hoja "del día" bajada el domingo trae fecha del lunes
// y hacía decir "al día" sin carga). Los cheques cuentan también la última carga anotada en el registro ("cheques_cargados"), aunque no cambie ningún estado.
// El FCI ya no se avisa (el saldo del banco no se muestra por ahora).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { estadoCarga, estadoCargaMensual, fechaArgentina, masReciente, direccionesDeCarga, type EstadoCarga } from "@/lib/carga-diaria";
import { formatDate } from "@/lib/utils";

interface CuentaMin { nombre: string; tipo: string; numero: string | null; saldo_banco_fecha: string | null }
interface Fuente { clave: string; nombre: string; ultima: string | null; texto: string; diaria: boolean }

const TIPOS_CON_EXTRACTO = new Set(["cuenta_corriente", "caja_ahorro"]);

export function CargaDiaria({ sociedadId, hoy, soloSiFalta = false, onIr }: { sociedadId: string; hoy: string; soloSiFalta?: boolean; onIr?: () => void }) {
  const [datos, setDatos] = useState<{ cuentas: CuentaMin[]; cargas: Record<string, string>; emitido: string | null; recibido: string | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const db = supabase as any;
      const ultima = async (direccion: string) => {
        const { data } = await db.from("echeqs").select("estado_banco_at").eq("sociedad_id", sociedadId).eq("direccion", direccion).not("estado_banco_at", "is", null).order("estado_banco_at", { ascending: false }).limit(1);
        const t = data?.[0]?.estado_banco_at as string | undefined;
        return t ? fechaArgentina(t) : null;
      };
      const [cs, regs, regsCheques, emitidoBanco, recibidoBanco] = await Promise.all([
        db.from("cuentas_financieras").select("nombre, tipo, numero, saldo_banco_fecha, orden").eq("sociedad_id", sociedadId).eq("activa", true).order("orden"),
        db.from("finanzas_registro").select("created_at, resultado").eq("sociedad_id", sociedadId).eq("accion", "extracto_cargado").order("created_at", { ascending: false }).limit(500),
        db.from("finanzas_registro").select("created_at, resultado").eq("sociedad_id", sociedadId).eq("accion", "cheques_cargados").order("created_at", { ascending: false }).limit(200),
        ultima("emitido"), ultima("recibido"),
      ]);
      // Última carga de reportes de cada lado, aunque no haya cambiado ningún estado (sin la migración opcional 20261025120000).
      let emitido: string | null = emitidoBanco, recibido: string | null = recibidoBanco;
      for (const r of (regsCheques.data || []) as Array<{ created_at: string; resultado: { direcciones?: unknown; reportes?: unknown } | null }>) {
        const dirs = direccionesDeCarga(r.resultado), f = fechaArgentina(r.created_at);
        if (dirs.has("emitido")) emitido = masReciente(emitido, f);
        if (dirs.has("recibido")) recibido = masReciente(recibido, f);
      }
      // Última vez que se subió el extracto de cada cuenta (por nombre de la cuenta, como lo anota Para confirmar).
      const cargas: Record<string, string> = {};
      for (const r of (regs.data || []) as Array<{ created_at: string; resultado: { cuenta?: string } | null }>) {
        const cuenta = r.resultado?.cuenta;
        if (cuenta && !cargas[cuenta]) cargas[cuenta] = fechaArgentina(r.created_at);
      }
      if (vivo) setDatos({ cuentas: (cs.data || []) as CuentaMin[], cargas, emitido, recibido });
    })().catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [sociedadId]);

  const evaluadas = useMemo(() => {
    if (!datos) return [];
    const fuentes: Fuente[] = [
      ...datos.cuentas.filter((c) => TIPOS_CON_EXTRACTO.has(c.tipo) && c.numero).map((c) => {
        const carga = datos.cargas[c.nombre] || null;
        return { clave: `c-${c.nombre}`, nombre: c.nombre, ultima: carga, texto: carga ? `subido el ${formatDate(carga)}` : "", diaria: false };
      }),
      { clave: "ch-e", nombre: "Cheques emitidos", ultima: datos.emitido, texto: datos.emitido ? `reporte de eCheq del ${formatDate(datos.emitido)}` : "", diaria: true },
      { clave: "ch-r", nombre: "Cheques recibidos", ultima: datos.recibido, texto: datos.recibido ? `reporte de eCheq del ${formatDate(datos.recibido)}` : "", diaria: true },
    ];
    return fuentes
      .map((f) => ({ f, e: f.diaria ? estadoCarga(f.ultima, hoy) : estadoCargaMensual(f.ultima, hoy) }))
      // Las cuentas que nunca se subieron no se muestran (ej. la caja de ahorro en dólares).
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
              title={f.diaria ? "Se carga todos los días hábiles" : "Se carga una vez por mes, al cierre (el banco da los últimos 60 días)"}>
              <b>{f.nombre}</b>{" · "}
              {e.estado === "sin_datos" ? "sin cargar" : <>{f.texto}{e.estado === "atrasada" && e.dias !== null ? ` · hace ${e.dias} d` : ""}</>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
