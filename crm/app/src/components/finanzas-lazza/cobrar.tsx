"use client";

// Finanzas Lazza → Cobrar (19/10/2026). NO es una pantalla nueva de cobro: reusa las MISMAS ventanas que Finanzas
// (CobroMasivoLiquidacion para $: medios, retenciones, cheques, diferencia a CC, leer la OP del cliente con IA;
// FxSettlementDialog para US$). Acá solo se elige el cliente y las facturas.
// Se abre desde Cuentas corrientes (ficha del cliente), Vencimientos (facturas de venta) y Recibos ("Nuevo cobro").
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useUser } from "@/lib/auth-context";
import { Autocompletar } from "@/components/ui/autocompletar";
import CobroMasivoLiquidacion from "@/components/cobro-masivo-liquidacion";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";
import { cobradoPorFactura } from "@/lib/saldo-clientes";
import { facturasACobrar, monedaDelCobro, type FacturaACobrar } from "@/lib/finanzas-lazza";

const db = supabase as any;

async function traerFacturasCliente(sociedadId: string, clienteId: string): Promise<FacturaACobrar[]> {
  const { data, error } = await db.from("facturas")
    .select("id, tipo, punto_venta, numero, fecha, estado, moneda, subtotal, iva, total, total_acreditado, tipo_cambio")
    .eq("sociedad_id", sociedadId).eq("cliente_id", clienteId).neq("estado", "anulada").order("fecha", { ascending: true });
  if (error) throw error;
  const facturas = data || [];
  if (!facturas.length) return [];
  const ids = facturas.map((f: any) => f.id);
  const [movs, aplic] = await Promise.all([
    db.from("movimientos").select("id, factura_id, monto, moneda, anulado").eq("sociedad_id", sociedadId).in("factura_id", ids),
    db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos!inner(anulado, sociedad_id)").eq("movimientos.sociedad_id", sociedadId).in("factura_id", ids),
  ]);
  if (movs.error) throw movs.error;
  if (aplic.error) throw aplic.error;
  return facturasACobrar(facturas, cobradoPorFactura(facturas, movs.data || [], aplic.data || []));
}

export function CobrarCliente({ sociedadId, clienteId, clienteNombre, preseleccion = [], directo = false, onClose, onCobrado }: {
  sociedadId: string;
  /** Sin cliente: primero se elige (Recibos → "Nuevo cobro"). */
  clienteId?: string | null;
  clienteNombre?: string;
  /** Facturas que vienen tildadas. */
  preseleccion?: string[];
  /** Con facturas tildadas de una sola moneda, va directo a la liquidación (ficha de Cuentas corrientes). */
  directo?: boolean;
  onClose: () => void;
  /** Después de guardar el cobro (para recargar la lista de atrás). */
  onCobrado: () => void;
}) {
  const { profile } = useUser();
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(clienteId ? { id: clienteId, nombre: clienteNombre || "" } : null);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string; cuit: string | null }[] | null>(null);
  const [facturas, setFacturas] = useState<FacturaACobrar[] | null>(null);
  const [error, setError] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(preseleccion));
  const [liquidando, setLiquidando] = useState(false);
  const [saltoDirecto, setSaltoDirecto] = useState(directo);

  // Lista de clientes solo si hay que elegir uno.
  useEffect(() => {
    if (cliente || clientes) return;
    traerTodo<any>(() => db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id"))
      .then((c) => setClientes(c.sort((a, b) => String(a.razon_social).localeCompare(String(b.razon_social)))))
      .catch(() => setError("No se pudieron cargar los clientes."));
  }, [cliente, clientes, sociedadId]);

  useEffect(() => {
    if (!cliente) return;
    let vivo = true;
    setFacturas(null); setError("");
    traerFacturasCliente(sociedadId, cliente.id)
      .then((f) => {
        if (!vivo) return;
        setFacturas(f);
        // Lo que venía tildado y ya no tiene saldo se destilda.
        setElegidas((prev) => new Set([...prev].filter((id) => f.some((x) => x.id === id))));
      })
      .catch((e) => { console.error("Finanzas Lazza · Cobrar:", e); if (vivo) setError("No se pudieron verificar los saldos. Probá de nuevo."); });
    return () => { vivo = false; };
  }, [cliente, sociedadId]);

  const seleccion = useMemo(() => (facturas || []).filter((f) => elegidas.has(f.id)), [facturas, elegidas]);
  const moneda = monedaDelCobro(seleccion);
  const mezcla = seleccion.length > 0 && !moneda;
  const totalSel = useMemo(() => ({
    ARS: seleccion.filter((f) => f.moneda === "ARS").reduce((s, f) => s + f.saldo, 0),
    USD: seleccion.filter((f) => f.moneda === "USD").reduce((s, f) => s + f.saldo, 0),
  }), [seleccion]);

  // Desde la ficha: con lo tildado listo, directo a la liquidación (un clic menos).
  useEffect(() => {
    if (!saltoDirecto || !facturas) return;
    setSaltoDirecto(false);
    if (seleccion.length && moneda) setLiquidando(true);
  }, [saltoDirecto, facturas, seleccion.length, moneda]);

  const tildar = (id: string, si: boolean) => setElegidas((prev) => { const n = new Set(prev); if (si) n.add(id); else n.delete(id); return n; });
  const cerrarLiquidacion = () => { setLiquidando(false); if (directo) onClose(); };
  const listo = async () => { setLiquidando(false); onCobrado(); onClose(); };

  if (liquidando && cliente && moneda) {
    if (moneda === "USD") {
      return (
        <FxSettlementDialog kind="cobro" sociedadId={sociedadId} counterpartyId={cliente.id}
          documents={seleccion.map((f) => ({ id: f.id, numero: f.numero, saldo: f.saldo, total: f.total, subtotal: f.subtotal, cotizacion: f.tipo_cambio }))}
          onClose={cerrarLiquidacion} onSuccess={listo} />
      );
    }
    return (
      <CobroMasivoLiquidacion facturas={seleccion} clienteId={cliente.id} clienteNombre={cliente.nombre} sociedadId={sociedadId}
        profileId={profile?.id || null} moneda="ARS" onClose={cerrarLiquidacion} onSuccess={listo} />
    );
  }

  const opcionesClientes = (clientes || []).map((c) => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit ? `CUIT ${c.cuit}` : undefined }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Cobrar{cliente ? ` · ${cliente.nombre}` : ""}</h2>
            <p className="text-sm text-zinc-500">{cliente ? "Tildá las facturas que paga y seguí a la liquidación (la misma de Finanzas)." : "Elegí el cliente."}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>}

        {!cliente ? (
          clientes === null ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes…</p> : (
            <Autocompletar opciones={opcionesClientes} placeholder="Buscar cliente por nombre o CUIT"
              onElegir={(id) => { const c = clientes.find((x) => x.id === id); if (c) { setElegidas(new Set()); setCliente({ id: c.id, nombre: c.razon_social }); } }} />
          )
        ) : facturas === null ? (
          !error && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando facturas con saldo…</p>
        ) : (
          <>
            {!clienteId && <button type="button" onClick={() => { setCliente(null); setFacturas(null); }} className="text-xs text-orange-600 hover:underline">← Otro cliente</button>}
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-[11px] uppercase text-zinc-500 dark:bg-zinc-800">
                  <tr>
                    <th className="w-8 px-3 py-1.5"><input type="checkbox" aria-label="Tildar todas" className="h-4 w-4 accent-orange-500"
                      checked={facturas.length > 0 && facturas.every((f) => elegidas.has(f.id))}
                      onChange={(e) => setElegidas(e.target.checked ? new Set(facturas.map((f) => f.id)) : new Set())} /></th>
                    <th className="px-2 py-1.5">Comprobante</th><th className="px-2 py-1.5">Fecha</th>
                    <th className="px-2 py-1.5 text-right">Total</th><th className="px-3 py-1.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((f) => (
                    <tr key={f.id} onClick={() => tildar(f.id, !elegidas.has(f.id))} className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${elegidas.has(f.id) ? "bg-emerald-50 dark:bg-emerald-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                      <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Tildar ${f.numero}`} className="h-4 w-4 accent-orange-500" checked={elegidas.has(f.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => tildar(f.id, e.target.checked)} /></td>
                      <td className="px-2 py-1.5 font-mono text-xs">{f.numero}</td>
                      <td className="px-2 py-1.5">{formatDate(f.fecha)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-zinc-500">{formatCurrency(f.total, f.moneda)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">{formatCurrency(f.saldo, f.moneda)}</td>
                    </tr>
                  ))}
                  {facturas.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-400">No tiene facturas con saldo.</td></tr>}
                </tbody>
              </table>
            </div>
            {mezcla && (
              <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" /> Tildaste facturas en $ y en US$: se cobran por separado (primero unas, después las otras).
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
              <span className="text-sm text-zinc-500">
                {seleccion.length} factura{seleccion.length === 1 ? "" : "s"} · saldo{" "}
                <b className="font-mono text-emerald-700 dark:text-emerald-400">
                  {totalSel.ARS > 0 || !totalSel.USD ? formatCurrency(totalSel.ARS) : ""}{totalSel.ARS > 0 && totalSel.USD > 0 ? " + " : ""}{totalSel.USD > 0 ? formatCurrency(totalSel.USD, "USD") : ""}
                </b>
              </span>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
                <button type="button" disabled={!moneda} onClick={() => setLiquidando(true)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  Seguir a la liquidación{moneda === "USD" ? " (US$)" : ""}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
