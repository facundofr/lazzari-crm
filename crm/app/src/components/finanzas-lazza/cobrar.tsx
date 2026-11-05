"use client";

// Finanzas Lazza → Cobrar (19/10/2026). NO es una pantalla nueva de cobro: reusa las MISMAS ventanas que Finanzas
// (CobroMasivoLiquidacion para $: medios, retenciones, cheques, diferencia a CC, leer la OP del cliente con IA;
// FxSettlementDialog para US$). Acá solo se elige el cliente y las facturas.
// Lugar central: tarjeta "Cobrar" del inicio (FinanzasLazzaCobrar: clientes que deben → Cobrar). Atajos a la misma ventana:
// Cuentas corrientes (ficha del cliente), Vencimientos y Facturas (facturas de venta) y Recibos ("Nuevo cobro").
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, HandCoins, Loader2, Search, Sparkles, Upload, X } from "lucide-react";
import { ZonaArchivos } from "@/components/ui/zona-archivos";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useUser } from "@/lib/auth-context";
import { Autocompletar } from "@/components/ui/autocompletar";
import CobroMasivoLiquidacion from "@/components/cobro-masivo-liquidacion";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";
import { cobradoPorFactura } from "@/lib/saldo-clientes";
import { useToast } from "@/components/ui/toast";
import type { OpParsed } from "@/lib/orden-pago-plan";
import { avisosDePaso, facturasDeOrdenPago, numerosDeOrdenPago, type FacturasDeOrdenPago } from "@/lib/cobro-orden-pago";
import { clientesACobrar, facturasACobrar, monedaDelCobro, type ClienteACobrar, type FacturaACobrar } from "@/lib/finanzas-lazza";
import { traerDeudas } from "./datos";

const db = supabase as any;

async function traerFacturasCliente(sociedadId: string, clienteId: string): Promise<FacturaACobrar[]> {
  const { data, error } = await db.from("facturas")
    .select("id, tipo, punto_venta, numero, fecha, estado, moneda, subtotal, iva, total, total_acreditado, tipo_cambio")
    .eq("sociedad_id", sociedadId).eq("cliente_id", clienteId).neq("estado", "anulada").order("fecha", { ascending: true });
  if (error) throw error;
  const facturas = data || [];
  if (!facturas.length) return [];
  return facturasACobrar(facturas, await cobradoDe(sociedadId, facturas));
}

/** Lo ya cobrado de cada factura (movimientos y aplicaciones de cobro). */
async function cobradoDe(sociedadId: string, facturas: any[]): Promise<Record<string, number>> {
  if (!facturas.length) return {};
  const ids = facturas.map((f: any) => f.id);
  const [movs, aplic] = await Promise.all([
    db.from("movimientos").select("id, factura_id, monto, moneda, anulado").eq("sociedad_id", sociedadId).in("factura_id", ids),
    db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto, movimientos!inner(anulado, sociedad_id)").eq("movimientos.sociedad_id", sociedadId).in("factura_id", ids),
  ]);
  if (movs.error) throw movs.error;
  if (aplic.error) throw aplic.error;
  return cobradoPorFactura(facturas, movs.data || [], aplic.data || []);
}

/** Busca en el sistema las facturas que figuran en la OP del cliente (ya leída por la IA) y arma el cobro en pesos y en dólares. */
async function traerFacturasDeOrdenPago(sociedadId: string, clienteId: string, parsed: OpParsed): Promise<FacturasDeOrdenPago> {
  const numeros = numerosDeOrdenPago(parsed);
  if (!numeros.length) return facturasDeOrdenPago(parsed, [], {});
  const { data, error } = await db.from("facturas")
    .select("id, numero, tipo, punto_venta, fecha, subtotal, iva, total, total_acreditado, moneda, tipo_cambio, estado")
    .eq("sociedad_id", sociedadId).eq("cliente_id", clienteId).in("numero", numeros);
  if (error) throw error;
  const filas = (data || []).filter((f: any) => f.estado !== "anulada");
  return facturasDeOrdenPago(parsed, filas, await cobradoDe(sociedadId, filas));
}

export function CobrarCliente({ sociedadId, clienteId, clienteNombre, preseleccion = [], directo = false, medioInicial, retencionesIniciales, ordenPagoInicial, sugerido, onClose, onCobrado }: {
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
  /** Desde una línea del banco (02/11/2026): la transferencia en pesos viene con el importe y la fecha de la línea. */
  medioInicial?: { monto: number; fecha: string };
  /** Desde una línea del banco (03/11/2026): retenciones estimadas como el último cobro del cliente (lib/banco-cobros). */
  retencionesIniciales?: { tipo: string; monto: number; observaciones?: string; certificado?: string | null }[];
  /** Comprobante del cliente ya leído por la IA (arrastrado sobre la línea del banco, 03/11/2026): con el cliente elegido, cobra las facturas que nombra. */
  ordenPagoInicial?: OpParsed;
  /** Cliente con el mismo CUIT que la línea del banco: se muestra para elegirlo con un clic (nunca se elige solo). */
  sugerido?: { id: string; nombre: string } | null;
}) {
  const { profile } = useUser();
  const { toast } = useToast();
  const [cliente, setCliente] = useState<{ id: string; nombre: string } | null>(clienteId ? { id: clienteId, nombre: clienteNombre || "" } : null);
  const [clientes, setClientes] = useState<{ id: string; razon_social: string; cuit: string | null }[] | null>(null);
  const [facturas, setFacturas] = useState<FacturaACobrar[] | null>(null);
  const [error, setError] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(preseleccion));
  const [liquidando, setLiquidando] = useState(false);
  const [saltoDirecto, setSaltoDirecto] = useState(directo);
  // «Cobrar todas las facturas de esta orden de pago» (arreglo 11, 27/10/2026): primero las de pesos y después las de dólares.
  // Sin `parsed`: facturas tildadas a mano en $ y en US$ (05/11/2026), mismo paso a paso sin la OP del cliente.
  const [secuencia, setSecuencia] = useState<(FacturasDeOrdenPago & { parsed?: OpParsed; paso: "ars" | "usd" }) | null>(null);
  // Certificado / OP del cliente arrastrado antes de tildar (05/11/2026): la IA lo lee y arma el cobro de las facturas que nombra.
  const [leyendo, setLeyendo] = useState(false);

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

  // Comprobante arrastrado sobre la línea del banco: apenas está el cliente y sus facturas, arma el cobro de las que nombra (una vez).
  const ordenAplicada = useRef(false);
  useEffect(() => {
    if (!ordenPagoInicial || ordenAplicada.current || !cliente || !facturas) return;
    ordenAplicada.current = true;
    void iniciarCobroOrdenPago(ordenPagoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenPagoInicial, cliente, facturas]);

  const tildar = (id: string, si: boolean) => setElegidas((prev) => { const n = new Set(prev); if (si) n.add(id); else n.delete(id); return n; });
  const cerrarLiquidacion = () => { setLiquidando(false); if (directo) onClose(); };
  const listo = async () => { setLiquidando(false); setSecuencia(null); onCobrado(); onClose(); };

  // Con la OP del cliente leída, ofrece cobrar todas sus facturas juntas. Nada se registra sin confirmar; lo que no se puede cobrar se avisa.
  async function iniciarCobroOrdenPago(parsed: OpParsed) {
    if (!cliente) return;
    try {
      const r = await traerFacturasDeOrdenPago(sociedadId, cliente.id, parsed);
      if (r.sinDetalle) { toast.warning("La IA no encontró el detalle de facturas en la orden de pago."); return; }
      if (!r.ars.length && !r.usd.length) { toast.warning(`No hay facturas pendientes para cobrar en esta orden de pago. ${r.avisos.join(" ")}`); return; }
      setSecuencia({ ...r, parsed, paso: r.ars.length ? "ars" : "usd" });
    } catch (e) {
      console.error("Finanzas Lazza · Cobrar toda la OP:", e);
      toast.error(e instanceof Error ? e.message : "No se pudieron buscar las facturas de la orden de pago.");
    }
  }

  // Tildadas en $ y en US$: el mismo paso a paso, primero las de pesos y después las de dólares.
  function cobrarMezcla() {
    const ars = seleccion.filter((f) => f.moneda !== "USD");
    const usd = seleccion.filter((f) => f.moneda === "USD")
      .map((f) => ({ id: f.id, numero: f.numero, saldo: f.saldo, total: f.total, subtotal: f.subtotal, cotizacion: Number(f.tipo_cambio) || undefined }));
    setSecuencia({ sinDetalle: false, ars, usd, avisos: [], paso: ars.length ? "ars" : "usd" });
    if (ars.length && usd.length) toast.info("Paso 1 de 2: facturas en pesos. Al confirmar se abre el cobro de las facturas en dólares.");
  }

  // El certificado u OP del cliente, sin tildar nada: la misma lectura con IA que la liquidación (/api/parse-cobro).
  async function leerCertificado(files: File[]) {
    if (!files.length || !cliente) return;
    setLeyendo(true);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("file", file));
      form.append("contexto", "orden_pago_cliente");
      const response = await fetch("/api/parse-cobro", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || "No se pudo leer el certificado");
      await iniciarCobroOrdenPago((json.data || {}) as OpParsed);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo leer el certificado");
    } finally {
      setLeyendo(false);
    }
  }

  if (secuencia && cliente) {
    if (secuencia.paso === "ars") {
      return (
        <CobroMasivoLiquidacion facturas={secuencia.ars} clienteId={cliente.id} clienteNombre={cliente.nombre} sociedadId={sociedadId}
          profileId={profile?.id || null} moneda="ARS" ordenPago={secuencia.parsed} ordenPagoAvisos={avisosDePaso(secuencia, "ars")}
          onClose={onClose}
          onSuccess={() => { if (secuencia.usd.length) { onCobrado(); setSecuencia({ ...secuencia, paso: "usd" }); } else void listo(); }} />
      );
    }
    return (
      <FxSettlementDialog kind="cobro" sociedadId={sociedadId} counterpartyId={cliente.id}
        documents={secuencia.usd} ordenPago={secuencia.parsed} ordenPagoAvisos={avisosDePaso(secuencia, "usd")}
        onClose={onClose} onSuccess={listo} />
    );
  }

  if (liquidando && cliente && moneda) {
    if (moneda === "USD") {
      return (
        <FxSettlementDialog kind="cobro" sociedadId={sociedadId} counterpartyId={cliente.id}
          documents={seleccion.map((f) => ({ id: f.id, numero: f.numero, saldo: f.saldo, total: f.total, subtotal: f.subtotal, cotizacion: f.tipo_cambio }))}
          onCobrarOrdenCompleta={(orden) => { void iniciarCobroOrdenPago(orden); }}
          onClose={cerrarLiquidacion} onSuccess={listo} />
      );
    }
    return (
      <CobroMasivoLiquidacion facturas={seleccion} clienteId={cliente.id} clienteNombre={cliente.nombre} sociedadId={sociedadId}
        profileId={profile?.id || null} moneda="ARS" onCobrarOrdenCompleta={(orden) => { void iniciarCobroOrdenPago(orden); }}
        medioInicial={medioInicial} retencionesIniciales={retencionesIniciales} onClose={cerrarLiquidacion} onSuccess={listo} />
    );
  }

  const opcionesClientes = (clientes || []).map((c) => ({ valor: c.id, texto: c.razon_social, detalle: c.cuit ? `CUIT ${c.cuit}` : undefined }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12" onClick={onClose}>
      <div className="w-full max-w-2xl space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Cobrar{cliente ? ` · ${cliente.nombre}` : ""}</h2>
            <p className="text-sm text-zinc-500">{cliente ? "Arrastrá el certificado de pago o tildá las facturas que paga." : "Elegí el cliente."}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>}

        {!cliente ? (
          clientes === null ? <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando clientes…</p> : (
            <>
            {sugerido && (
              <button type="button" onClick={() => { setElegidas(new Set()); setCliente({ id: sugerido.id, nombre: sugerido.nombre }); }}
                className="flex w-full items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                💡 Parece de <b>{sugerido.nombre}</b> (mismo CUIT que el banco). Tocá para elegirlo.
              </button>
            )}
            <Autocompletar opciones={opcionesClientes} placeholder="Buscar cliente por nombre o CUIT"
              onElegir={(id) => { const c = clientes.find((x) => x.id === id); if (c) { setElegidas(new Set()); setCliente({ id: c.id, nombre: c.razon_social }); } }} />
            </>
          )
        ) : facturas === null ? (
          !error && <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando facturas con saldo…</p>
        ) : (
          <>
            {!clienteId && <button type="button" onClick={() => { setCliente(null); setFacturas(null); }} className="text-xs text-orange-600 hover:underline">← Otro cliente</button>}
            <ZonaArchivos onArchivos={(files) => void leerCertificado(files)} disabled={leyendo} className="p-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300 ${leyendo ? "pointer-events-none opacity-60" : ""}`}>
                  {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4" /><Sparkles className="h-3.5 w-3.5" /></>}
                  {leyendo ? "Leyendo con IA…" : "Cargar certificado de pago"}
                  <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={leyendo}
                    onChange={(event) => { const files = Array.from(event.target.files || []); void leerCertificado(files); event.target.value = ""; }} />
                </label>
                <span className="text-xs text-zinc-500">o arrastralo acá: la IA busca las facturas que paga (en $ y en US$) y arma el cobro, sin tildar nada.</span>
              </div>
            </ZonaArchivos>
            {medioInicial && <p className="text-xs text-zinc-500">Entró al banco {formatCurrency(medioInicial.monto)} el {formatDate(medioInicial.fecha)}. 💡 = factura con ese saldo.</p>}
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
                      <td className="px-2 py-1.5 font-mono text-xs">{f.numero}{medioInicial && f.moneda === "ARS" && Math.abs(f.saldo - medioInicial.monto) <= 1 && <span className="ml-1" title="Saldo igual a lo que entró al banco">💡</span>}</td>
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
                <AlertTriangle className="h-4 w-4 shrink-0" /> Tildaste facturas en $ y en US$: se cobran en 2 pasos seguidos, primero las de pesos y después las de dólares.
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
                <button type="button" disabled={!moneda && !mezcla} onClick={() => { if (mezcla) cobrarMezcla(); else setLiquidando(true); }}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {mezcla ? "Seguir: primero $, después US$" : `Seguir a la liquidación${moneda === "USD" ? " (US$)" : ""}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pantalla Cobrar (tarjeta del inicio) ─────────────────────────────

const montos = (m: { ARS: number; USD: number }, cero = "—") => {
  const partes = [m.ARS >= 0.01 ? formatCurrency(m.ARS) : null, m.USD >= 0.01 ? formatCurrency(m.USD, "USD") : null].filter(Boolean);
  return partes.length ? partes.join(" + ") : cero;
};
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function FinanzasLazzaCobrar({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<ClienteACobrar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [cobrando, setCobrando] = useState<{ id: string | null; nombre: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setFilas(null); setError(null);
    traerDeudas(sociedadId, hoy)
      .then((d) => { if (vivo) setFilas(clientesACobrar(d.vencimientos)); })
      .catch((e) => { console.error("Finanzas Lazza · Cobrar:", e); if (vivo) setError("No se pudo cargar lo que hay para cobrar. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);

  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (filas || [])
    .filter((f) => !q || sinAcentos(f.nombre).includes(q))
    .filter((f) => !soloVencidos || f.dias < 0)
    .map((f) => ({ ...f, id: f.clienteId })), [filas, q, soloVencidos]);
  const total = useMemo(() => {
    const t = { saldo: { ARS: 0, USD: 0 }, vencido: { ARS: 0, USD: 0 } };
    for (const f of visibles) { t.saldo.ARS += f.saldo.ARS; t.saldo.USD += f.saldo.USD; t.vencido.ARS += f.vencido.ARS; t.vencido.USD += f.vencido.USD; }
    return t;
  }, [visibles]);

  // Orden por plata: US$ a un dólar de referencia solo para ordenar.
  const enPesos = (m: { ARS: number; USD: number }) => m.ARS + m.USD * 1500;
  const cols: Column<ClienteACobrar & { id: string }>[] = [
    { key: "nombre", label: "Cliente", sortable: true, sortValue: (f) => f.nombre, render: (f) => <span>{f.nombre}<span className="block text-[10px] text-zinc-400">{f.facturas} factura{f.facturas === 1 ? "" : "s"}</span></span> },
    { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => enPesos(f.saldo), className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono font-semibold">{montos(f.saldo)}</span> },
    { key: "vencido", label: "Vencido", sortable: true, sortValue: (f) => enPesos(f.vencido), className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono ${f.vencido.ARS || f.vencido.USD ? "text-red-600" : "text-zinc-400"}`}>{montos(f.vencido)}</span> },
    { key: "vence", label: "Más vieja vence", sortable: true, sortValue: (f) => f.primerVence, render: (f) => (
      <span className={`whitespace-nowrap ${f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : ""}`}>
        {formatDate(f.primerVence)}<span className="block text-[10px] font-normal text-zinc-400">{f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "hoy" : `en ${f.dias} d`}</span>
      </span>
    ) },
    { key: "accion", label: "", render: (f) => (
      <button type="button" onClick={(e) => { e.stopPropagation(); setCobrando({ id: f.clienteId, nombre: f.nombre }); }}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">
        <HandCoins className="h-3.5 w-3.5" /> Cobrar
      </button>
    ) },
  ];

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setCobrando({ id: null, nombre: "" })}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <HandCoins className="h-4 w-4" /> Nuevo cobro
        </button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar cliente"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 pl-8 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Solo con vencidas
        </label>
      </div>
      {!filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={cols} data={visibles} onRowClick={(f) => setCobrando({ id: f.clienteId, nombre: f.nombre })} emptyMessage="No hay clientes con facturas para cobrar" />
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} clientes</span>
            <span>A cobrar <b className="font-mono text-emerald-700 dark:text-emerald-400">{montos(total.saldo, "$ 0")}</b></span>
            <span>Vencido <b className="font-mono text-red-600">{montos(total.vencido, "$ 0")}</b></span>
          </div>
        </div>
      )}
      {cobrando && (
        <CobrarCliente sociedadId={sociedadId} clienteId={cobrando.id} clienteNombre={cobrando.nombre}
          onClose={() => setCobrando(null)} onCobrado={() => setRecarga((n) => n + 1)} />
      )}
    </div>
  );
}
