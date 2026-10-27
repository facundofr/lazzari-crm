"use client";

// Finanzas Lazza → Cuentas corrientes: "Ajuste manual" en la ficha del cliente o proveedor (Augusto 19/10).
// Misma regla que Finanzas (handleManualMov): un movimiento tipo "ajuste" con su sentido (crédito = a favor de
// la cuenta; débito = cargo) y la descripción "[Ajuste manual] …". No es plata: no toca la caja ni el banco.
// Lo leen las mismas cuentas de saldo (lib/saldo-clientes y lib/saldo-proveedores).
// Anular (arreglo 23, 27/10/2026): AnularAjusteCC, desde el renglón del ajuste en el resumen de la ficha.
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import type { RenglonResumen } from "@/lib/resumen-cuenta";

const db = supabase as any;
/** "1.234,56", "1234,56" o "1234.56" → 1234.56 */
const num = (v: string) => { const t = String(v || "").replace(/[^\d.,-]/g, ""); return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0; };

export function AjusteManualCC({ sociedadId, lado, entidadId, nombre, onClose, onGuardado }: {
  sociedadId: string;
  lado: "cliente" | "proveedor";
  entidadId: string;
  nombre: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { profile } = useUser();
  const puede = profile?.role === "super_admin" || profile?.role === "admin" || profile?.role === "administrativo";
  const [sentido, setSentido] = useState<"credito" | "debito">("credito");
  const [montoTxt, setMontoTxt] = useState("");
  const [moneda, setMoneda] = useState<"ARS" | "USD">("ARS");
  const [fecha, setFecha] = useState(todayAR());
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const monto = Math.round(num(montoTxt) * 100) / 100;
  const quien = lado === "cliente" ? "cliente" : "proveedor";
  const listo = monto > 0 && !!descripcion.trim() && !!fecha;

  async function guardar() {
    if (!listo) { setError("Completá monto, fecha y descripción."); return; }
    if (!puede) { setError("Solo un administrador puede cargar ajustes manuales de cuenta corriente."); return; }
    setGuardando(true); setError("");
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id || null;
      const { error: e } = await db.from("movimientos").insert({
        tipo: "ajuste", ajuste_sentido: sentido, descripcion: `[Ajuste manual] ${descripcion.trim()}`,
        monto, moneda, fecha, conciliado: false, sociedad_id: sociedadId,
        [lado === "cliente" ? "cliente_id" : "proveedor_id"]: entidadId,
        ...(userId ? { created_by: userId } : {}),
      });
      if (e) throw new Error(e.message);
      onGuardado();
      onClose();
    } catch (e: any) {
      setError(`No se pudo guardar el ajuste: ${e?.message || "error"}`);
    } finally { setGuardando(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">Ajuste manual · <span className="font-normal">{nombre}</span></h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 rounded-lg bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800/60">Corrige el saldo de la cuenta corriente. No es plata: no suma ni resta en la caja ni en el banco.</p>
        <div className="space-y-2">
          <Select label="Tipo" value={sentido} onChange={(e) => setSentido(e.target.value as "credito" | "debito")} options={[
            { value: "credito", label: `A favor del ${quien} (crédito)` },
            { value: "debito", label: `Cargo al ${quien} (débito)` },
          ]} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Monto" value={montoTxt} onChange={(e) => setMontoTxt(e.target.value)} inputMode="decimal" placeholder="0,00" />
            <Select label="Moneda" value={moneda} onChange={(e) => setMoneda(e.target.value as "ARS" | "USD")} options={[{ value: "ARS", label: "$ (ARS)" }, { value: "USD", label: "US$" }]} />
          </div>
          <Input label="Fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <Input label="Descripción" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: diferencia de redondeo, saldo del sistema anterior…" />
        </div>
        {listo && (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            {sentido === "credito"
              ? lado === "cliente" ? `Le baja la deuda al cliente en ${formatCurrency(monto, moneda)}.` : `Sube lo que le debemos al proveedor en ${formatCurrency(monto, moneda)}.`
              : lado === "cliente" ? `Le suma ${formatCurrency(monto, moneda)} a la deuda del cliente.` : `Baja lo que le debemos al proveedor en ${formatCurrency(monto, moneda)}.`}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={guardando} className="rounded-lg border px-3 py-1.5 text-sm dark:border-zinc-600">Cancelar</button>
          <button type="button" onClick={() => void guardar()} disabled={!listo || guardando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-40">
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar ajuste
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Anular un ajuste manual desde la ficha (arreglo 23). Usa gestionar_cobro «anular», como Gastos y Facturas: no borra
 * el registro (queda tachado en el resumen, con quién y cuándo) y, si el ajuste estaba aplicado a una factura, la
 * recalcula. No tiene vuelta atrás: si fue un error, se carga un ajuste nuevo.
 */
export function AnularAjusteCC({ lado, nombre, ajuste, saldo, onClose, onAnulado }: {
  lado: "cliente" | "proveedor";
  nombre: string;
  /** Renglón del resumen de cuenta con `ajusteId`. */
  ajuste: RenglonResumen;
  /** Saldo de la cuenta en la moneda del ajuste (el del resumen). */
  saldo: number;
  onClose: () => void;
  onAnulado: () => void;
}) {
  const { profile } = useUser();
  const puede = profile?.role === "super_admin" || profile?.role === "admin" || profile?.role === "administrativo";
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState("");
  const m = ajuste.moneda;
  // Lo que el ajuste suma hoy al saldo (positivo = nos debe / le debemos): al anularlo se descuenta.
  const efecto = ajuste.suma ? Math.round((ajuste.debe - ajuste.haber) * 100) / 100 : 0;
  const despues = Math.round((saldo - efecto) * 100) / 100;
  const aplicado = ajuste.aplicadoA || [];
  // Negativo = a favor (como en la lista de cuentas corrientes).
  const conSentido = (v: number) => `${formatCurrency(v, m)}${v < -0.005 ? (lado === "cliente" ? " (a favor del cliente)" : " (a favor nuestro)") : ""}`;

  async function anular() {
    if (!ajuste.ajusteId) return;
    if (!puede) { setError("Solo un administrador puede anular ajustes manuales de cuenta corriente."); return; }
    setAnulando(true); setError("");
    try {
      const { error: e } = await db.rpc("gestionar_cobro", { p_movimiento_id: ajuste.ajusteId, p_accion: "anular" });
      // Si ya estaba anulado (otra pestaña u otra persona), queda como se quería: se recarga igual.
      if (e && !/ya está anulado/i.test(e.message || "")) throw new Error(e.message);
      onAnulado();
    } catch (e: any) {
      setError(`No se pudo anular el ajuste: ${e?.message || "error"}`);
    } finally { setAnulando(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => !anulando && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">Anular ajuste · <span className="font-normal">{nombre}</span></h2>
          <button type="button" aria-label="Cerrar" onClick={onClose} disabled={anulando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
          <p className="font-medium">{ajuste.detalle}</p>
          <p className="text-xs text-zinc-500">{formatDate(ajuste.fecha)} · <span className="font-mono">{formatCurrency(ajuste.importe, m)}</span></p>
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          {efecto > 0
            ? lado === "cliente" ? `Le baja ${formatCurrency(efecto, m)} a la deuda del cliente.` : `Baja lo que le debemos al proveedor en ${formatCurrency(efecto, m)}.`
            : efecto < 0
              ? lado === "cliente" ? `Le vuelve a sumar ${formatCurrency(-efecto, m)} a la deuda del cliente.` : `Sube lo que le debemos al proveedor en ${formatCurrency(-efecto, m)}.`
              : "No cambia el saldo."}
          {efecto !== 0 && <> Saldo: <b className="font-mono">{conSentido(saldo)}</b> → <b className="font-mono">{conSentido(despues)}</b></>}
        </p>
        {aplicado.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠️ Está aplicado a {aplicado.join(", ")}: {aplicado.length > 1 ? "esas facturas vuelven" : "esa factura vuelve"} a quedar con deuda.
          </p>
        )}
        <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-800/60">Queda en el resumen, tachado, con tu nombre, la fecha y la hora: no se borra. No tiene vuelta atrás: si fue un error, cargá un ajuste nuevo.</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={anulando} className="rounded-lg border px-3 py-1.5 text-sm dark:border-zinc-600">Cancelar</button>
          <button type="button" onClick={() => void anular()} disabled={anulando}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">
            {anulando && <Loader2 className="h-4 w-4 animate-spin" />} Anular ajuste
          </button>
        </div>
      </div>
    </div>
  );
}
