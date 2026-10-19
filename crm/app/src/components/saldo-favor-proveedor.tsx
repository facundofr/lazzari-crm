"use client";

// Saldo a favor con un proveedor (anticipos / pagos a cuenta) → aplicarlo a sus facturas (Augusto 19/10).
// Lo usan Compras Lazza (al cargar la factura) y Finanzas Lazza (ficha del proveedor en Cuentas corrientes).
// La cuenta está en lib/saldo-favor-proveedor.ts (con prueba); guarda la RPC aplicar_saldo_favor_proveedor
// (migración 20261019200000). Nada se aplica solo: siempre lo confirma una persona.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { fuentesSaldoFavor, listaOPs, repartirSaldoFavor, totalSaldoFavor, type AplicacionOP, type FuenteSaldoFavor } from "@/lib/saldo-favor-proveedor";

const db = supabase as any;

/** OP del proveedor con algo a favor, de la más vieja a la más nueva. */
export async function traerSaldoFavor(sociedadId: string, proveedorId: string): Promise<FuenteSaldoFavor[]> {
  const [ops, sf] = await Promise.all([
    db.from("ordenes_pago").select("id, numero, fecha, moneda, moneda_documentos, monto_bruto, estado, op_facturas_compra(id)")
      .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId).neq("estado", "anulada").order("fecha"),
    db.from("saldos_favor_proveedor").select("orden_pago_id, saldo, estado, moneda")
      .eq("sociedad_id", sociedadId).eq("proveedor_id", proveedorId).eq("estado", "disponible"),
  ]);
  if (ops.error) throw new Error(ops.error.message);
  if (sf.error) throw new Error(sf.error.message);
  return fuentesSaldoFavor(ops.data || [], sf.data || []);
}

/** Aplica el saldo a favor a una factura. Devuelve un texto de error o null si salió bien. */
export async function aplicarSaldoFavor(sociedadId: string, facturaId: string, ops: AplicacionOP[]): Promise<string | null> {
  const { error } = await db.rpc("aplicar_saldo_favor_proveedor", { p_sociedad_id: sociedadId, p_factura_id: facturaId, p_aplicaciones: ops });
  if (!error) return null;
  if (/aplicar_saldo_favor_proveedor/.test(error.message) && /function|funci/i.test(error.message)) return "falta correr la migración 20261019200000";
  return error.message;
}

/**
 * Ficha del proveedor (Finanzas Lazza): "A favor: $ X (OP…)" y "Aplicar a las tildadas".
 * Muestra cómo se reparte y pide confirmar. Sin saldo a favor no muestra nada.
 */
export function SaldoFavorFicha({ sociedadId, proveedorId, facturas, recarga, onAplicado }: {
  sociedadId: string;
  proveedorId: string;
  /** Facturas tildadas, en el orden en que se aplican. */
  facturas: Array<{ id: string; comprobante: string; saldo: number; moneda: "ARS" | "USD" }>;
  recarga: number;
  onAplicado: () => void;
}) {
  const [fuentes, setFuentes] = useState<FuenteSaldoFavor[] | null>(null);
  const [error, setError] = useState("");
  const [viendo, setViendo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setFuentes(null); setError(""); setViendo(false);
    traerSaldoFavor(sociedadId, proveedorId)
      .then((f) => { if (vivo) setFuentes(f); })
      .catch(() => { if (vivo) setFuentes([]); });
    return () => { vivo = false; };
  }, [sociedadId, proveedorId, recarga]);

  if (!fuentes?.length) return null;
  const ars = totalSaldoFavor(fuentes, "ARS");
  const usd = totalSaldoFavor(fuentes, "USD");
  const reparto = repartirSaldoFavor(fuentes, facturas);
  const nombre = (id: string) => facturas.find((f) => f.id === id);

  async function aplicar() {
    setGuardando(true); setError("");
    const hechas: string[] = [];
    for (const r of reparto) {
      const e = await aplicarSaldoFavor(sociedadId, r.factura_id, r.ops);
      if (e) { setError(`${hechas.length ? `Aplicado en ${hechas.join(", ")}. ` : ""}No se pudo aplicar en ${nombre(r.factura_id)?.comprobante}: ${e}`); break; }
      hechas.push(nombre(r.factura_id)?.comprobante || "");
    }
    setGuardando(false);
    if (hechas.length) onAplicado();
  }

  return (
    <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
      <div className="flex flex-wrap items-center gap-2">
        <span>A favor nuestro: <b className="font-mono">{[ars > 0 ? formatCurrency(ars) : "", usd > 0 ? formatCurrency(usd, "USD") : ""].filter(Boolean).join(" + ")}</b> ({listaOPs(fuentes)})</span>
        <button type="button" disabled={!reparto.length || guardando} onClick={() => setViendo(true)}
          title={reparto.length ? "Ver cómo se aplica" : "Tildá las facturas a las que se aplica"}
          className="ml-auto rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
          {facturas.length ? `Aplicar a las tildadas (${facturas.length})` : "Tildá facturas para aplicar"}
        </button>
      </div>
      {viendo && reparto.length > 0 && (
        <div className="mt-2 border-t border-emerald-200 pt-2 dark:border-emerald-800">
          <ul className="space-y-0.5">
            {reparto.map((r) => {
              const f = nombre(r.factura_id)!;
              const queda = Math.round((f.saldo - r.aplicado) * 100) / 100;
              return (
                <li key={r.factura_id}>
                  <b className="font-mono">{f.comprobante}</b>: se aplican {formatCurrency(r.aplicado, f.moneda)} de {listaOPs(r.ops.map((o) => fuentes.find((x) => x.orden_pago_id === o.orden_pago_id)!))}
                  {queda > 0.005 ? <> · queda a pagar {formatCurrency(queda, f.moneda)}</> : <> · queda pagada</>}
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setViendo(false)} disabled={guardando} className="rounded-md border border-emerald-300 px-2 py-1 dark:border-emerald-700">Cancelar</button>
            <button type="button" onClick={() => void aplicar()} disabled={guardando} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-700">
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirmar
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}
