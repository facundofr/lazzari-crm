"use client";

// Finanzas Lazza → Vencimientos: SOLO facturas de venta y de compra con saldo, por fecha (sin cheques, fijos ni cuotas).
// Saldos con la misma regla que Finanzas (lib/saldo-clientes y la de proveedores).
// Cobrar (19/10): en facturas de venta, botón "Cobrar" → la misma liquidación de Finanzas con esa factura tildada (cobrar.tsx).
// Augusto 19/10/2026: clic en "Vence" = cambiar la fecha de esa factura y los días de pago del cliente/proveedor
// (clientes.dias_cuenta_corriente; proveedores dias_cuenta_corriente + condicion_pago/dias_pago), con la opción de
// aplicar los días nuevos a sus facturas pendientes. En facturas de venta es solo el dato interno: no toca ARCA.
import { useEffect, useMemo, useState } from "react";
import { HandCoins, Loader2, Pencil, Search, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { conVencimiento, filtrarVencimientos, sumarDias, type FilaVencimiento } from "@/lib/finanzas-lazza";
import { supabase } from "@/lib/supabase/client";
import { traerDeudas } from "./datos";
import { CobrarCliente } from "./cobrar";

type Filtro = "todo" | "venta" | "compra";

type Fila = FilaVencimiento & { facturaId: string };

const db = supabase as any;

const columnas = (editar: (f: Fila) => void, cobrar: (f: Fila) => void): Column<Fila>[] => [
  { key: "fecha", label: "Fecha de factura", sortable: true, sortValue: (f) => f.fecha, render: (f) => <span className="whitespace-nowrap">{formatDate(f.fecha)}</span> },
  { key: "vence", label: "Vence", sortable: true, sortValue: (f) => f.vence, render: (f) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); editar(f); }} title="Cambiar el vencimiento o los días de pago"
      className={`group whitespace-nowrap rounded px-1 text-left hover:bg-orange-50 dark:hover:bg-zinc-800 ${f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : ""}`}>
      {formatDate(f.vence)} <Pencil className="inline h-3 w-3 text-zinc-300 group-hover:text-orange-500" />
      <span className="block text-[10px] font-normal text-zinc-400">{f.sinVencimiento ? "sin vto · fecha factura" : f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "hoy" : `en ${f.dias} d`}</span>
    </button>
  ) },
  { key: "lado", label: "Tipo", sortable: true, sortValue: (f) => f.lado, render: (f) => <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${f.lado === "venta" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"}`}>{f.lado === "venta" ? "Venta" : "Compra"}</span> },
  { key: "comprobante", label: "Comprobante", sortable: true, sortValue: (f) => f.comprobante, render: (f) => <span className="whitespace-nowrap font-mono text-xs">{f.comprobante}</span> },
  { key: "nombre", label: "Cliente / Proveedor", sortable: true, sortValue: (f) => f.nombre },
  { key: "moneda", label: "Moneda", sortable: true, sortValue: (f) => f.moneda, render: (f) => (f.moneda === "USD" ? "US$" : "$") },
  { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.total, f.moneda)}</span> },
  { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => f.saldo, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(f.saldo, f.moneda)}</span> },
  { key: "accion", label: "", render: (f) => (f.lado === "venta" && f.entidadId ? (
    <button type="button" onClick={(e) => { e.stopPropagation(); cobrar(f); }} title="Cobrar esta factura (podés sumar otras del cliente)"
      className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
      <HandCoins className="h-3.5 w-3.5" /> Cobrar
    </button>
  ) : null) },
];

const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function FinanzasLazzaVencimientos({ sociedadId }: { sociedadId: string }) {
  const [filas, setFilas] = useState<FilaVencimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todo");
  const [texto, setTexto] = useState("");
  const [moneda, setMoneda] = useState<"" | "ARS" | "USD">("");
  const [situacion, setSituacion] = useState<"" | "vencidas" | "por_vencer">("");
  const [campoFecha, setCampoFecha] = useState<"fecha" | "vence">("vence");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [editando, setEditando] = useState<Fila | null>(null);
  const [cobrando, setCobrando] = useState<Fila | null>(null);
  const [recarga, setRecarga] = useState(0);
  const hoy = todayAR();

  useEffect(() => {
    let vivo = true;
    setFilas(null); setError(null);
    traerDeudas(sociedadId, hoy)
      .then((d) => { if (vivo) setFilas(d.vencimientos); })
      .catch((e) => { console.error("Finanzas Lazza · Vencimientos:", e); if (vivo) setError("No se pudieron cargar los vencimientos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);

  const visibles = useMemo<Fila[]>(() => filtrarVencimientos(filas || [], { lado: filtro, texto, moneda, situacion, campoFecha, desde, hasta })
    .map((f) => ({ ...f, facturaId: f.id, id: `${f.lado}-${f.id}` })), [filas, filtro, texto, moneda, situacion, campoFecha, desde, hasta]);
  const totales = useMemo(() => {
    const t = { venta: { ARS: 0, USD: 0 }, compra: { ARS: 0, USD: 0 } };
    for (const f of visibles) t[f.lado][f.moneda] += f.saldo;
    return t;
  }, [visibles]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;

  const montos = (m: { ARS: number; USD: number }) => (
    <>{formatCurrency(m.ARS)}{m.USD > 0.005 && <span className="ml-1">+ {formatCurrency(m.USD, "USD")}</span>}</>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {([["todo", "Todo"], ["venta", "Ventas"], ["compra", "Compras"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${filtro === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {l}
          </button>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar comprobante, cliente o proveedor" className={`${control} w-full pl-8`} />
        </div>
        <select value={situacion} onChange={(e) => setSituacion(e.target.value as typeof situacion)} className={control}>
          <option value="">Vencidas y por vencer</option><option value="vencidas">Solo vencidas</option><option value="por_vencer">Solo por vencer</option>
        </select>
        <select value={moneda} onChange={(e) => setMoneda(e.target.value as typeof moneda)} className={control}>
          <option value="">$ y US$</option><option value="ARS">$</option><option value="USD">US$</option>
        </select>
        <select value={campoFecha} onChange={(e) => setCampoFecha(e.target.value as typeof campoFecha)} className={control} title="Sobre qué fecha se aplica el rango">
          <option value="vence">Vencimiento</option><option value="fecha">Fecha de factura</option>
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" className={control} />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" className={control} />
        {(texto || moneda || situacion || desde || hasta) && (
          <button type="button" onClick={() => { setTexto(""); setMoneda(""); setSituacion(""); setDesde(""); setHasta(""); }} className="text-xs text-orange-600 hover:underline">Limpiar</button>
        )}
      </div>

      {!filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={columnas(setEditando, setCobrando)} data={visibles} emptyMessage="No hay facturas con saldo con ese filtro" />
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} facturas con saldo</span>
            {filtro !== "compra" && <span className="text-zinc-500">A cobrar <b className="font-mono text-emerald-700 dark:text-emerald-400">{montos(totales.venta)}</b></span>}
            {filtro !== "venta" && <span className="text-zinc-500">A pagar <b className="font-mono text-orange-700 dark:text-orange-400">{montos(totales.compra)}</b></span>}
          </div>
        </div>
      )}
      {editando && (
        <EditarVencimiento fila={editando} sociedadId={sociedadId} pendientes={(filas || []).filter((f) => f.lado === editando.lado && f.entidadId && f.entidadId === editando.entidadId)}
          onClose={() => setEditando(null)}
          onCambio={(nuevas) => setFilas((prev) => (prev || []).map((f) => (nuevas[`${f.lado}-${f.id}`] ? conVencimiento(f, nuevas[`${f.lado}-${f.id}`], hoy) : f)))} />
      )}
      {cobrando?.entidadId && (
        <CobrarCliente sociedadId={sociedadId} clienteId={cobrando.entidadId} clienteNombre={cobrando.nombre} preseleccion={[cobrando.facturaId]}
          onClose={() => setCobrando(null)} onCobrado={() => setRecarga((n) => n + 1)} />
      )}
    </div>
  );
}

/** Ventana: fecha de vencimiento de la factura + días de pago del cliente/proveedor (con "¿aplicar a las pendientes?"). */
function EditarVencimiento({ fila, sociedadId, pendientes, onClose, onCambio }: {
  fila: Fila; sociedadId: string; pendientes: FilaVencimiento[]; onClose: () => void; onCambio: (nuevas: Record<string, string>) => void;
}) {
  const esVenta = fila.lado === "venta";
  const tablaFactura = esVenta ? "facturas" : "facturas_compra";
  const tablaEntidad = esVenta ? "clientes" : "proveedores";
  const [fecha, setFecha] = useState(fila.vence);
  const [dias, setDias] = useState("");
  const [entidad, setEntidad] = useState<any>(null);
  const [guardando, setGuardando] = useState(false);
  const [preguntar, setPreguntar] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!fila.entidadId) return;
    let vivo = true;
    db.from(tablaEntidad).select(esVenta ? "id, dias_cuenta_corriente" : "id, dias_cuenta_corriente, condicion_pago, dias_pago").eq("id", fila.entidadId).maybeSingle()
      .then(({ data }: any) => {
        if (!vivo || !data) return;
        setEntidad(data);
        const d = !esVenta && data.condicion_pago ? data.dias_pago : data.dias_cuenta_corriente;
        setDias(d === null || d === undefined ? "" : String(d));
      });
    return () => { vivo = false; };
  }, [fila.entidadId, tablaEntidad, esVenta]);

  const guardarFecha = async () => {
    if (!fecha) return;
    setGuardando(true);
    const { error } = await db.from(tablaFactura).update({ fecha_vencimiento: fecha }).eq("id", fila.facturaId).eq("sociedad_id", sociedadId);
    setGuardando(false);
    if (error) { alert(`No se pudo guardar la fecha: ${error.message}`); return; }
    onCambio({ [`${fila.lado}-${fila.facturaId}`]: fecha });
    setAviso(`Vencimiento de ${fila.comprobante} guardado: ${formatDate(fecha)}.`);
  };

  const guardarDias = async () => {
    const n = Math.round(Number(dias));
    if (!fila.entidadId || !Number.isFinite(n) || n < 0) return;
    setGuardando(true);
    const cambios: Record<string, unknown> = { dias_cuenta_corriente: n };
    // Proveedores con condición de pago: los días pactados están en dias_pago (anticipado / contra entrega pasan a cuenta corriente).
    if (!esVenta && entidad?.condicion_pago) {
      cambios.dias_pago = n;
      if (entidad.condicion_pago === "anticipado" || entidad.condicion_pago === "contra_entrega") cambios.condicion_pago = "cuenta_corriente";
    }
    const { error } = await db.from(tablaEntidad).update(cambios).eq("id", fila.entidadId).eq("sociedad_id", sociedadId);
    setGuardando(false);
    if (error) { alert(`No se pudieron guardar los días: ${error.message}`); return; }
    setAviso(`${fila.nombre}: ${n} días guardados para las próximas facturas.`);
    if (pendientes.length) setPreguntar(n);
  };

  const aplicarAPendientes = async () => {
    if (preguntar === null) return;
    setGuardando(true);
    const nuevas: Record<string, string> = {};
    const fallas: string[] = [];
    for (const p of pendientes) {
      const vence = sumarDias(p.fecha, preguntar);
      const { error } = await db.from(tablaFactura).update({ fecha_vencimiento: vence }).eq("id", p.id).eq("sociedad_id", sociedadId);
      if (error) fallas.push(`${p.comprobante}: ${error.message}`); else nuevas[`${p.lado}-${p.id}`] = vence;
    }
    setGuardando(false);
    onCambio(nuevas);
    setPreguntar(null);
    const propia = nuevas[`${fila.lado}-${fila.facturaId}`];
    if (propia) setFecha(propia);
    const n = Object.keys(nuevas).length;
    setAviso(`${n} factura${n === 1 ? "" : "s"} con el vencimiento nuevo.${fallas.length ? ` No se pudieron cambiar: ${fallas.join("; ")}` : ""}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Vencimiento · <span className="font-mono text-sm">{fila.comprobante}</span></h2>
            <p className="text-sm text-zinc-500">{fila.nombre} · factura del {formatDate(fila.fecha)} · saldo {formatCurrency(fila.saldo, fila.moneda)}</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Fecha de vencimiento de esta factura</p>
          <div className="flex items-center gap-2">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={control} />
            <button type="button" disabled={guardando || !fecha} onClick={guardarFecha}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">Guardar fecha</button>
          </div>
          {esVenta && <p className="mt-1 text-[11px] text-zinc-400">Es el dato interno del CRM: no cambia nada en ARCA.</p>}
        </div>

        {fila.entidadId && (
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Días de pago de {fila.nombre}</p>
            <div className="flex items-center gap-2">
              <input type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} className={`${control} w-24`} disabled={!entidad} />
              <span className="text-sm text-zinc-500">días</span>
              <button type="button" disabled={guardando || !entidad || dias === ""} onClick={guardarDias}
                className="rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-orange-950/30">Guardar días</button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">Queda guardado en la ficha para las próximas facturas.</p>
            {preguntar !== null && (
              <div className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                ¿Aplicar también a {pendientes.length === 1 ? "la factura pendiente" : `las ${pendientes.length} facturas pendientes`} de {fila.nombre}? (vencen {preguntar} días después de su fecha)
                <div className="mt-1.5 flex gap-2">
                  <button type="button" disabled={guardando} onClick={aplicarAPendientes} className="rounded-lg bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50">Sí, aplicar</button>
                  <button type="button" disabled={guardando} onClick={() => setPreguntar(null)} className="rounded-lg border border-zinc-300 px-3 py-1 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">No, solo las próximas</button>
                </div>
              </div>
            )}
          </div>
        )}
        {guardando && <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…</p>}
        {aviso && <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {aviso}</p>}
      </div>
    </div>
  );
}
