"use client";

// Pago mensual de José Alvarez (Augusto 29/10/2026), en Gastos y solo en Lazzari: comisión del mes anterior (90% del margen sin IVA de lo
// que facturó) + interés del préstamo del mes ($ 150.000 fijos). Los viajes NO van acá (se liquidan en Transportes).
// Solo sugiere: se carga con el botón, confirmando (crear_gasto_con_pago). Cuentas en lib/jose-alvarez.ts.
import { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { formatCurrency, todayAR } from "@/lib/utils";
import { reporteBasico } from "@/lib/finanzas-lazza";
import { mesAnterior } from "@/lib/premios-lazza";
import { JOSE_ALVAREZ, comisionDelMes, detalleComision, detalleInteres, mesTexto } from "@/lib/jose-alvarez";
import { rangoMes, traerDatosReporte } from "./datos";

const db = supabase as any;

type Estado = {
  mesComision: string;
  comision: ReturnType<typeof comisionDelMes>;
  comisionCargada: boolean;
  interesCargado: boolean;
};

export function PagoJose({ sociedadId, periodo, onCargado }: { sociedadId: string; periodo: string; onCargado: () => void }) {
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);
  // Solo Lazzari y desde octubre 2026 (los meses anteriores se cargaron a mano).
  const esLazzari = sociedadActiva?.nombre === "Lazzari" && periodo >= JOSE_ALVAREZ.desde;
  const mesComision = mesAnterior(periodo);

  const leer = useCallback(async () => {
    try {
      setError(false);
      const datos = await traerDatosReporte(sociedadId, mesComision);
      const r = reporteBasico({ periodo: mesComision, ...datos });
      const prIds = [...new Set(r.filas.map((f) => f.presupuestoId).filter((x): x is string => !!x))];
      const suyos = new Set<string>();
      for (let i = 0; i < prIds.length; i += 150) {
        const { data, error: e } = await db.from("presupuestos").select("id").eq("vendedor_id", JOSE_ALVAREZ.vendedorId).in("id", prIds.slice(i, i + 150));
        if (e) throw e;
        for (const p of data || []) suyos.add(p.id);
      }
      const comision = comisionDelMes(r.filas, suyos);
      const { desde, hasta } = rangoMes(periodo);
      // Comisión ya cargada (auditoría de la plata, 29/10/2026): con su texto, o una comisión de José en este mes aunque le hayan
      // cambiado el detalle (antes solo el texto exacto: si se editaba, se ofrecía cargarla otra vez).
      const [{ data: com, error: e1 }, { data: int, error: e2 }, { data: com2, error: e3 }] = await Promise.all([
        db.from("gastos_manuales").select("id").eq("sociedad_id", sociedadId).eq("descripcion", detalleComision(mesComision)).limit(1),
        db.from("gastos_manuales").select("id").eq("sociedad_id", sociedadId).eq("gasto_fijo_id", JOSE_ALVAREZ.fijoInteresId).gte("fecha", desde).lt("fecha", hasta).limit(1),
        db.from("gastos_manuales").select("id").eq("sociedad_id", sociedadId).eq("categoria", "Comisiones").ilike("descripcion", "%jos%").gte("fecha", desde).lt("fecha", hasta).limit(1),
      ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      setEstado({ mesComision, comision, comisionCargada: !!(com || []).length || !!(com2 || []).length, interesCargado: !!(int || []).length });
    } catch (e) {
      console.error("Pago de José Alvarez:", e);
      setError(true);
    }
  }, [sociedadId, mesComision, periodo]);

  useEffect(() => { setEstado(null); if (esLazzari) void leer(); }, [esLazzari, leer]);

  if (!esLazzari) return null;
  if (error) return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">No se pudo calcular el pago de José Alvarez. Recargá la página.</p>;
  if (!estado) return <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Calculando el pago de José…</p>;

  const faltaComision = !estado.comisionCargada && estado.comision.comision > 0;
  const faltaInteres = !estado.interesCargado;
  const total = (faltaComision ? estado.comision.comision : 0) + (faltaInteres ? JOSE_ALVAREZ.interes : 0);
  if (!faltaComision && !faltaInteres) {
    return <p className="text-xs text-zinc-500">Pago de José Alvarez ya cargado: comisión de {mesTexto(estado.mesComision)} e interés de {mesTexto(periodo)}.</p>;
  }

  async function cargar() {
    if (!estado) return;
    const lineas = [
      ...(faltaComision ? [`Comisión de ${mesTexto(estado.mesComision)}: ${formatCurrency(estado.comision.comision)} (90% de ${formatCurrency(estado.comision.margen)} de margen)`] : []),
      ...(faltaInteres ? [`Interés del préstamo de ${mesTexto(periodo)}: ${formatCurrency(JOSE_ALVAREZ.interes)}`] : []),
    ];
    if (!confirm(`¿Cargar el pago de José Alvarez?\n\n${lineas.join("\n")}\n\nTotal ${formatCurrency(total)}. Se crea un gasto por concepto, con su pago en Movimientos.`)) return;
    setCargando(true);
    const fecha = todayAR();
    const fallas: string[] = [];
    if (faltaComision) {
      const { error: e } = await db.rpc("crear_gasto_con_pago", {
        p_sociedad_id: sociedadId,
        p_gasto: { fecha, descripcion: detalleComision(estado.mesComision), categoria: "Comisiones", grupo: "Personal", monto: estado.comision.comision, moneda: "ARS",
          medio_pago: "transferencia", tipo_gasto: "general", tipo_recurrencia: "eventual",
          notas: `90% del margen sin IVA de ${estado.comision.facturas} factura(s) de ${mesTexto(estado.mesComision)}: venta ${formatCurrency(estado.comision.venta)} − costo ${formatCurrency(estado.comision.costo)} = ${formatCurrency(estado.comision.margen)}.` },
        p_descripcion_pago: `Gasto — Sueldos — ${detalleComision(estado.mesComision)}`,
      });
      if (e) fallas.push(`comisión: ${e.message}`);
    }
    if (faltaInteres) {
      const { error: e } = await db.rpc("crear_gasto_con_pago", {
        p_sociedad_id: sociedadId,
        p_gasto: { fecha, descripcion: detalleInteres(periodo), categoria: "Financieros", grupo: "Bancos y financieros", monto: JOSE_ALVAREZ.interes, moneda: "ARS",
          medio_pago: "transferencia", tipo_gasto: "general", tipo_recurrencia: "mensual", gasto_fijo_id: JOSE_ALVAREZ.fijoInteresId },
        p_descripcion_pago: `Gasto — Bancos y financieros — ${detalleInteres(periodo)}`,
      });
      if (e) fallas.push(`interés: ${e.message}`);
    }
    setCargando(false);
    if (fallas.length) toast.error(`No se pudo cargar todo el pago de José (${fallas.join("; ")}).`);
    else toast.success("Pago de José Alvarez cargado");
    onCargado();
    void leer();
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30">
      <HandCoins className="h-4 w-4 shrink-0 text-sky-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sky-900 dark:text-sky-200">Pago de José Alvarez: {formatCurrency(total)}</p>
        <p className="text-xs text-sky-800/80 dark:text-sky-300/80">
          {faltaComision && <>Comisión de {mesTexto(estado.mesComision)}: {formatCurrency(estado.comision.comision)} (90% de {formatCurrency(estado.comision.margen)} de margen sin IVA, {estado.comision.facturas} factura{estado.comision.facturas === 1 ? "" : "s"}). </>}
          {faltaInteres && <>Interés del préstamo de {mesTexto(periodo)}: {formatCurrency(JOSE_ALVAREZ.interes)}. </>}
          Los viajes se liquidan en Transportes.
        </p>
      </div>
      <button type="button" disabled={cargando} onClick={cargar}
        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60">
        {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <HandCoins className="h-3 w-3" />} Cargar pago
      </button>
    </div>
  );
}
