"use client";

// Bancos > Cheques: "¿Alcanza la plata de la cuenta para los cheques?" (25/10/2026, Augusto).
// Compara el saldo del último extracto cargado de la CC EPP con los cheques propios que el banco puede debitar hoy y en los próximos 7 días.
// Es un aviso: no bloquea ni mueve nada. El FCI se muestra como dato, sin sumarlo. Cálculo en lib/cobertura-cheques (prueba: scripts/test-cobertura-cheques.ts).
// 25/10: un cheque que el banco ya debitó (línea de débito en el extracto, o PAGADO según el banco) no se resta otra vez: ya está fuera del saldo.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { digitosCuenta } from "@/lib/extracto-bbva";
import { coberturaCheques, diasDesde, numerosDebitados, sobraOFalta, type ChequeCobertura } from "@/lib/cobertura-cheques";
import { formatCurrency, formatDate } from "@/lib/utils";

interface CuentaSaldo { id: string; nombre: string; numero: string | null; tipo: string; moneda: string; saldo_banco: number | null; saldo_banco_fecha: string | null }

const CC_EPP = digitosCuenta("091-312483/1");
const CC_INDU = digitosCuenta("091-318933/7");
const DIAS_VIEJO = 2;

function Veredicto({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-xs text-zinc-400">sin saldo cargado</span>;
  return valor >= 0
    ? <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Cubierto, sobran {formatCurrency(valor)}</span>
    : <span className="flex items-center gap-1 rounded bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> Faltan {formatCurrency(Math.abs(valor))}</span>;
}

export function CoberturaCheques({ sociedadId, cheques, hoy }: { sociedadId: string; cheques: ChequeCobertura[]; hoy: string }) {
  const [cuentas, setCuentas] = useState<CuentaSaldo[] | null>(null);
  const [debitados, setDebitados] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    (async () => {
      const db = supabase as any;
      const { data } = await db.from("cuentas_financieras").select("id, nombre, numero, tipo, moneda, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId).eq("activa", true);
      const cs = ((data || []) as CuentaSaldo[]).map((c) => ({ ...c, saldo_banco: c.saldo_banco === null ? null : Number(c.saldo_banco) }));
      // Débitos de cheques de las cuentas corrientes de los últimos 90 días: esos cheques ya salieron del saldo.
      const ids = cs.filter((c) => [CC_EPP, CC_INDU].includes(digitosCuenta(c.numero))).map((c) => c.id);
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const { data: ls } = ids.length
        ? await db.from("extracto_movimientos").select("descripcion, tipo").in("cuenta_id", ids).eq("tipo", "debito").gte("fecha", desde).limit(5000)
        : { data: [] };
      if (vivo) { setCuentas(cs); setDebitados(numerosDebitados((ls || []) as Array<{ descripcion: string; tipo: string }>)); }
    })().catch(() => { if (vivo) setCuentas([]); });
    return () => { vivo = false; };
  }, [sociedadId]);

  const cob = useMemo(() => coberturaCheques(cheques, hoy, debitados), [cheques, hoy, debitados]);
  if (!cuentas) return null;
  const epp = cuentas.find((c) => digitosCuenta(c.numero) === CC_EPP);
  const indu = cuentas.find((c) => digitosCuenta(c.numero) === CC_INDU);
  const fci = cuentas.find((c) => c.tipo === "fci" && c.moneda === "ARS" && c.saldo_banco);
  if (!epp) return null;
  const dias = diasDesde(epp.saldo_banco_fecha, hoy);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">¿Alcanza la plata de la cuenta para los cheques?</p>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <div className="space-y-1.5">
          <p>
            <b>{epp.nombre}</b>: saldo <b className="font-mono">{epp.saldo_banco === null ? "—" : formatCurrency(epp.saldo_banco)}</b>
            {epp.saldo_banco_fecha && <span className="text-xs text-zinc-500"> al {formatDate(epp.saldo_banco_fecha)}</span>}
            {dias !== null && dias > DIAS_VIEJO && <span className="ml-1 text-xs font-medium text-amber-600">⚠️ es del extracto de hace {dias} días: subí el de hoy</span>}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Hoy (vencidos y de hoy): <b className="font-mono">{formatCurrency(cob.hoy.total)}</b> <span className="text-xs text-zinc-500">({cob.hoy.cantidad} cheques)</span></span>
            <Veredicto valor={sobraOFalta(epp.saldo_banco, cob.hoy.total)} />
          </div>
          {cob.hoy.cantidad > 0 && (
            <p className="text-xs text-zinc-500">
              {cob.hoy.enTramite.cantidad > 0 && <>En trámite del banco (presentados o depositados): <b>{formatCurrency(cob.hoy.enTramite.total)}</b> ({cob.hoy.enTramite.cantidad}). </>}
              {cob.hoy.sinPresentar.cantidad > 0 && <>Todavía sin presentar: <b>{formatCurrency(cob.hoy.sinPresentar.total)}</b> ({cob.hoy.sinPresentar.cantidad}).</>}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Próximos 7 días: <b className="font-mono">{formatCurrency(cob.proximos7.total)}</b> <span className="text-xs text-zinc-500">({cob.proximos7.cantidad} cheques)</span></span>
            <Veredicto valor={sobraOFalta(epp.saldo_banco, cob.proximos7.total)} />
          </div>
          {cob.yaDebitados.cantidad > 0 && (
            <p className="text-xs text-zinc-500">
              {cob.yaDebitados.cantidad} cheque{cob.yaDebitados.cantidad > 1 ? "s" : ""} por <b>{formatCurrency(cob.yaDebitados.total)}</b> ya {cob.yaDebitados.cantidad > 1 ? "los debitó" : "lo debitó"} el banco: no se {cob.yaDebitados.cantidad > 1 ? "cuentan" : "cuenta"} (ya {cob.yaDebitados.cantidad > 1 ? "están restados" : "está restado"} del saldo). En el CRM se {cob.yaDebitados.cantidad > 1 ? "pasan" : "pasa"} a debitado al confirmar Movimientos.
            </p>
          )}
          <p className="text-xs text-zinc-400">No cuenta cobros que entren ni el FCI.{fci?.saldo_banco ? ` ${fci.nombre}: ${formatCurrency(fci.saldo_banco)}${fci.saldo_banco_fecha ? ` al ${formatDate(fci.saldo_banco_fecha)}` : ""} (solo informativo).` : ""}</p>
        </div>

        {cob.indu.cheques.length > 0 && (
          <div className="space-y-1.5 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
            <p>
              <b>{indu?.nombre || "CC INDU (091-318933/7)"}</b>: saldo <b className="font-mono">{indu?.saldo_banco === null || indu?.saldo_banco === undefined ? "—" : formatCurrency(indu.saldo_banco)}</b>
              {indu?.saldo_banco_fecha && <span className="text-xs text-zinc-500"> al {formatDate(indu.saldo_banco_fecha)}</span>}
            </p>
            <ul className="text-xs text-zinc-600 dark:text-zinc-300">
              {cob.indu.cheques.map((c) => <li key={c.numero}>Cheque N° {c.numero} · {formatCurrency(c.monto)} · paga el {formatDate(c.fecha_pago)}</li>)}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Cheques que salen de esta cuenta: <b className="font-mono">{formatCurrency(cob.indu.total)}</b></span>
              <Veredicto valor={sobraOFalta(indu?.saldo_banco, cob.indu.total)} />
            </div>
            <p className="text-xs text-zinc-400">Ya no se emiten cheques de esta cuenta. El saldo se actualiza cuando se sube su extracto.</p>
          </div>
        )}
      </div>
    </div>
  );
}
