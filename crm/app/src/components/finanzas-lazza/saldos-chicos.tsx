"use client";

// Cobrar y Pagar (Augusto 02/11/2026): tildar «Sacar de pendientes» en un SALDO chico (factura ya pagada en parte con saldo menor a
// $ 20.000) y destildarlo para que vuelva. No cambia el saldo: sigue en Cuentas corrientes (lib/saldos-pendientes; tabla
// saldos_fuera_de_pendientes, funciones sacar_saldo_de_pendientes y volver_saldo_a_pendientes). Se usa en la lista de
// Facturas, que es la de Cobrar (ventas) y Pagar (compras).
// También el color de los vencimientos: vencida en rojo, por vencer (de hoy a 7 días) en naranja.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { textoVence, tonoVence } from "@/lib/saldos-pendientes";

const db = supabase as any;

/** Lo que hace falta de una factura con saldo (sirve la fila de Facturas y la de Vencimientos). */
export interface FilaSaldo { lado: "venta" | "compra"; id: string; saldo: number; moneda: "ARS" | "USD"; comprobante: string; nombre: string; vence: string }

async function cambiar(f: FilaSaldo, sacar: boolean): Promise<string | null> {
  const ids = f.lado === "venta" ? { p_factura_id: f.id, p_factura_compra_id: null } : { p_factura_id: null, p_factura_compra_id: f.id };
  const { error } = sacar
    ? await db.rpc("sacar_saldo_de_pendientes", { ...ids, p_saldo: f.saldo, p_moneda: f.moneda })
    : await db.rpc("volver_saldo_a_pendientes", ids);
  if (!error) return null;
  return /saldos_fuera_de_pendientes|sacar_saldo|volver_saldo|schema cache|does not exist/i.test(String(error.message || ""))
    ? "Falta una actualización de la base de datos (saldos fuera de pendientes)." : String(error.message || "No se pudo guardar");
}

/** El tilde de un saldo chico: tildado = fuera de pendientes; destildarlo lo vuelve. */
export function TildeSaldo({ f, sacado, onCambio }: { f: FilaSaldo; sacado: boolean; onCambio: () => void }) {
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState(false);
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 font-medium text-orange-700 dark:text-orange-400" onClick={(e) => e.stopPropagation()}>
      {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : (
        <input type="checkbox" checked={sacado} className="h-3.5 w-3.5 accent-orange-500"
          onChange={async () => {
            setOcupado(true);
            const err = await cambiar(f, !sacado);
            setOcupado(false);
            if (err) { toast.error(err); return; }
            toast.success(sacado ? `${f.comprobante}: el saldo volvió a pendientes.` : `${f.comprobante}: el saldo salió de pendientes (sigue en Cuentas corrientes).`);
            onCambio();
          }} />
      )}
      {sacado ? "Fuera de pendientes" : "Sacar de pendientes"}
    </label>
  );
}

/** Los saldos sacados de pendientes («Ver saldos sacados»): destildar los vuelve a pendientes. */
export function PanelSacados({ filas, onCambio }: { filas: FilaSaldo[]; onCambio: () => void }) {
  if (!filas.length) return null;
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Saldos sacados de pendientes <span className="font-normal text-zinc-400">· siguen en Cuentas corrientes</span></p>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {filas.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs">
            <span className="min-w-0 truncate text-zinc-700 dark:text-zinc-200">{f.nombre} <span className="text-zinc-400">· {f.comprobante} · vence {formatDate(f.vence)}</span></span>
            <span className="flex items-center gap-3">
              <span className="font-mono font-semibold">{formatCurrency(f.saldo, f.moneda)}</span>
              <TildeSaldo f={f} sacado onCambio={onCambio} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHIP = {
  vencida: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  por_vencer: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
};

/** Fecha de vencimiento con su cartelito de color: rojo vencida, naranja por vencer (de hoy a 7 días). */
export function VenceChip({ vence, dias, conSaldo = true, sinVencimiento = false, extra }: {
  vence: string; dias: number; conSaldo?: boolean; sinVencimiento?: boolean;
  /** Algo al lado de la fecha (ej. el lápiz para cambiarla). */
  extra?: React.ReactNode;
}) {
  const tono = tonoVence(dias, conSaldo);
  return (
    <span className={`whitespace-nowrap ${tono === "vencida" ? "font-semibold text-red-700 dark:text-red-400" : tono === "por_vencer" ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>
      {formatDate(vence)}{extra}
      {conSaldo && (
        <span className={`mt-0.5 block w-fit rounded px-1.5 py-px text-[10px] font-semibold ${tono ? CHIP[tono] : "font-normal text-zinc-400"}`}>
          {sinVencimiento ? "sin vto · fecha factura" : textoVence(dias)}
        </span>
      )}
    </span>
  );
}

/** Fondo suave del renglón: rojo vencida, naranja por vencer. Va en las celdas (`*:`): el diseño nuevo deja el renglón transparente. */
export function claseFilaVence(dias: number, conSaldo = true): string {
  const tono = tonoVence(dias, conSaldo);
  return tono === "vencida" ? "*:bg-red-50 dark:*:bg-red-950/40" : tono === "por_vencer" ? "*:bg-amber-50 dark:*:bg-amber-950/30" : "";
}
