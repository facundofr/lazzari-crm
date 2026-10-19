"use client";

// Finanzas Lazza → Facturas (Augusto 19/10/2026): reemplaza a Pagar, Cobrar y Vencimientos. Una fila por factura,
// Ventas y Compras separadas (nunca mezcladas), filtros Pendientes / Vencidas / Todas, buscador y orden por vencimiento.
// Se tildan varias y "Pagar (n)" / "Cobrar (n)" abre la MISMA ventana de siempre (OP de Finanzas / liquidación de cobro).
// Una OP es de un solo proveedor y un cobro de un solo cliente (y de una moneda): si se tilda de más, aviso y se sigue con el primero.
// Ventas suma OC del cliente y vendedor (Augusto: "oc nuestra no la sumes"). Cobrada/Pagada con: recibo u OP, con Ver / Descargar / Enviar.
// Clic en la fila = la ficha de la factura (Ver, Descargar, Enviar). Lápiz en "Vence" = cambiar vencimiento (la ventana de Vencimientos).
// "Todas" trae también cobradas/pagadas, anuladas y NC: se carga recién cuando se toca (es más pesado).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Eye, HandCoins, Loader2, Mail, Pencil, Search, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import {
  diasEntre, estadoFactura, etiquetaEstado, filtrarFacturas, prepararSeleccion, sePuedeTildar, totalesFacturas,
  type DocPago, type EstadoFactura, type FilaFactura, type FiltroFacturas, type LadoFactura,
} from "@/lib/facturas-lazza";
import type { Recibo } from "@/lib/recibos";
import { FichaFacturaCompra, FichaFacturaVenta } from "@/components/facturas-consulta";
import { traerFacturasFL } from "./datos";
import { CobrarCliente } from "./cobrar";
import { PagarProveedor } from "./pagar";
import { descargarOP, EnviarOrdenPago, verOP } from "./orden-pago-doc";
import { abrirRecibo, EnviarRecibo } from "./recibo-doc";
import { EditarVencimiento, type Fila as FilaVenc } from "./vencimientos";

const ESTILO_ESTADO: Record<EstadoFactura, string> = {
  pendiente: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  parcial: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  vencida: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  pagada: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  anulada: "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800",
  nc: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
};

const montos = (m: { ARS: number; USD: number }, cero = "$ 0") => {
  const partes = [m.ARS >= 0.01 ? formatCurrency(m.ARS) : null, m.USD >= 0.01 ? formatCurrency(m.USD, "USD") : null].filter(Boolean);
  return partes.length ? partes.join(" + ") : cero;
};
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const boton = (activo: boolean) => `rounded-md px-3 py-1 text-sm font-medium ${activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;

type Datos = { filas: FilaFactura[]; recibos: Recibo[]; todas: boolean };

export function FinanzasLazzaFacturas({ sociedadId, ladoInicial = "venta" }: { sociedadId: string; ladoInicial?: LadoFactura }) {
  const { sociedadActiva } = useUser();
  const [lado, setLado] = useState<LadoFactura>(ladoInicial);
  const [filtro, setFiltro] = useState<FiltroFacturas>("pendientes");
  const [texto, setTexto] = useState("");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [tildadas, setTildadas] = useState<string[]>([]);
  const [ficha, setFicha] = useState<FilaFactura | null>(null);
  const [editando, setEditando] = useState<FilaFactura | null>(null);
  const [pagando, setPagando] = useState<{ entidadId: string | null; nombre: string; ids: string[] } | null>(null);
  const [enviarOP, setEnviarOP] = useState<string | null>(null);
  const [enviarRecibo, setEnviarRecibo] = useState<Recibo | null>(null);
  const hoy = todayAR();
  const necesitaTodas = filtro === "todas";

  // Cambiar de lado limpia lo tildado y vuelve a cargar; "Todas" se trae solo cuando hace falta.
  useEffect(() => { setTildadas([]); setDatos(null); }, [lado, sociedadId]);
  useEffect(() => {
    if (datos && (datos.todas || !necesitaTodas)) return;
    let vivo = true;
    setError(null);
    traerFacturasFL(sociedadId, lado, hoy, necesitaTodas)
      .then((d) => { if (vivo) setDatos({ ...d, todas: necesitaTodas }); })
      .catch((e) => { console.error("Finanzas Lazza · Facturas:", e); if (vivo) setError("No se pudieron cargar las facturas. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, lado, hoy, necesitaTodas, recarga, datos]);

  const recargar = () => { setTildadas([]); setDatos(null); setRecarga((n) => n + 1); };

  const visibles = useMemo(() => filtrarFacturas(datos?.filas || [], { filtro, texto }), [datos, filtro, texto]);
  const totales = useMemo(() => totalesFacturas(visibles), [visibles]);
  const porId = useMemo(() => new Map((datos?.filas || []).map((f) => [f.id, f])), [datos]);
  const seleccion = useMemo(() => prepararSeleccion(tildadas.map((id) => porId.get(id)).filter(Boolean) as FilaFactura[], lado), [tildadas, porId, lado]);
  const recibosPorId = useMemo(() => new Map((datos?.recibos || []).map((r) => [r.id, r])), [datos]);

  const tildar = (id: string, si: boolean) => setTildadas((prev) => (si ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id)));
  const tildables = visibles.filter(sePuedeTildar);
  const todasTildadas = tildables.length > 0 && tildables.every((f) => tildadas.includes(f.id));

  // Documento (OP o recibo): Ver, Descargar, Enviar.
  const accionDoc = (d: DocPago, que: "ver" | "bajar" | "enviar") => {
    if (!sociedadActiva) return;
    if (d.tipo === "op") {
      if (que === "ver") void verOP(d.id, sociedadActiva);
      else if (que === "bajar") void descargarOP(d.id, sociedadActiva);
      else setEnviarOP(d.id);
      return;
    }
    const r = recibosPorId.get(d.id);
    if (!r) return;
    if (que === "enviar") setEnviarRecibo(r); else abrirRecibo(r, sociedadActiva, que === "ver");
  };

  const esVenta = lado === "venta";
  const cols: Column<FilaFactura>[] = [
    { key: "tilde", label: "", render: (f) => (sePuedeTildar(f) ? (
      <input type="checkbox" aria-label={`Tildar ${f.comprobante}`} className="h-4 w-4 accent-orange-500" checked={tildadas.includes(f.id)}
        onClick={(e) => e.stopPropagation()} onChange={(e) => tildar(f.id, e.target.checked)} />
    ) : null) },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => <span className="whitespace-nowrap">{formatDate(f.fecha)}</span> },
    { key: "vence", label: "Vence", sortable: true, sortValue: (f) => f.vence, render: (f) => {
      const conSaldo = f.saldo > 0.005;
      const color = !conSaldo ? "text-zinc-400" : f.dias < 0 ? "font-semibold text-red-600" : f.dias <= 7 ? "text-amber-600" : "";
      return (
        <button type="button" disabled={!conSaldo} onClick={(e) => { e.stopPropagation(); setEditando(f); }} title={conSaldo ? "Cambiar el vencimiento o los días de pago" : undefined}
          className={`group whitespace-nowrap rounded px-1 text-left enabled:hover:bg-orange-50 dark:enabled:hover:bg-zinc-800 ${color}`}>
          {formatDate(f.vence)} {conSaldo && <Pencil className="inline h-3 w-3 text-zinc-300 group-hover:text-orange-500" />}
          {conSaldo && <span className="block text-[10px] font-normal text-zinc-400">{f.sinVencimiento ? "sin vto · fecha factura" : f.dias < 0 ? `vencida hace ${-f.dias} d` : f.dias === 0 ? "vence hoy" : `vence en ${f.dias} d`}</span>}
        </button>
      );
    } },
    { key: "nombre", label: esVenta ? "Cliente" : "Proveedor", sortable: true, sortValue: (f) => f.nombre, render: (f) => <span className="block max-w-[200px] truncate" title={f.nombre}>{f.nombre || "—"}</span> },
    { key: "comprobante", label: "N° factura", sortable: true, sortValue: (f) => f.comprobante, render: (f) => <span className="whitespace-nowrap font-mono text-xs">{f.comprobante}</span> },
    ...(esVenta ? [
      { key: "oc", label: "OC cliente", sortable: true, sortValue: (f: FilaFactura) => f.ocCliente, render: (f: FilaFactura) => <span className="block max-w-[110px] truncate text-xs text-zinc-500" title={f.ocCliente}>{f.ocCliente || "—"}</span> },
      { key: "vendedor", label: "Vendedor", sortable: true, sortValue: (f: FilaFactura) => f.vendedor, render: (f: FilaFactura) => <span className="whitespace-nowrap text-xs text-zinc-500">{f.vendedor || "—"}</span> },
    ] : []),
    { key: "moneda", label: "Mon.", sortable: true, sortValue: (f) => f.moneda, render: (f) => (f.moneda === "USD" ? "US$" : "$") },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.total, f.moneda)}</span> },
    { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => f.saldo, className: "text-right", render: (f) => <span className={`whitespace-nowrap font-mono ${f.saldo > 0.005 ? "font-semibold" : "text-zinc-400"}`}>{formatCurrency(f.saldo, f.moneda)}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (f) => f.estado, render: (f) => (
      <span className="whitespace-nowrap">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTILO_ESTADO[f.estado]}`}>{etiquetaEstado(f.estado, lado)}</span>
        {f.estado === "vencida" && f.parcial && <span className="block text-[10px] text-zinc-400">parcial</span>}
      </span>
    ) },
    { key: "docs", label: esVenta ? "Cobrada con" : "Pagada con", sortable: true, sortValue: (f) => f.docs.map((d) => d.numero).join(" "), render: (f) => (
      f.docs.length ? <span className="flex flex-col items-start gap-0.5">{f.docs.map((d) => <MenuDoc key={d.id} doc={d} accion={accionDoc} />)}</span> : <span className="text-xs text-zinc-300">—</span>
    ) },
    { key: "ver", label: "", render: (f) => (
      <button type="button" title="Ver la factura (descargar y enviar)" onClick={(e) => { e.stopPropagation(); setFicha(f); }}
        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
    ) },
  ];

  // Cambio de vencimiento: se actualiza la fila sin recargar todo.
  const aVenc = (f: FilaFactura): FilaVenc => ({ lado: f.lado, id: f.id, facturaId: f.id, entidadId: f.entidadId, fecha: f.fecha, vence: f.vence, sinVencimiento: f.sinVencimiento, comprobante: f.comprobante, nombre: f.nombre, moneda: f.moneda, total: f.total, saldo: f.saldo, dias: f.dias });
  const cambiarVencimientos = (nuevas: Record<string, string>) => setDatos((d) => (d ? {
    ...d,
    filas: d.filas.map((f) => {
      const vence = nuevas[`${f.lado}-${f.id}`];
      if (!vence) return f;
      const dias = diasEntre(hoy, vence);
      return { ...f, vence, sinVencimiento: false, dias, ...estadoFactura({ anulada: f.estado === "anulada", nc: f.estado === "nc", total: f.total, saldo: f.saldo, dias }) };
    }),
  } : d));

  const abrirPago = () => { if (seleccion) setPagando({ entidadId: seleccion.entidadId, nombre: seleccion.nombre, ids: seleccion.ids }); };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button type="button" onClick={() => setLado("venta")} className={boton(esVenta)}>Ventas</button>
          <button type="button" onClick={() => setLado("compra")} className={boton(!esVenta)}>Compras</button>
        </div>
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {([["pendientes", "Pendientes"], ["vencidas", "Vencidas"], ["todas", "Todas"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFiltro(k)} className={boton(filtro === k)}>{l}</button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={esVenta ? "Buscar cliente, N° factura, OC, vendedor o recibo" : "Buscar proveedor, N° factura u OP"} className={`${control} w-full pl-8`} />
        </div>
        {esVenta ? (
          <button type="button" onClick={() => setPagando({ entidadId: null, nombre: "", ids: [] })} title="Cobro sin factura o eligiendo el cliente"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
            <HandCoins className="h-4 w-4" /> Nuevo cobro
          </button>
        ) : (
          <button type="button" onClick={() => setPagando({ entidadId: null, nombre: "", ids: [] })} title="OP sin factura (pago a cuenta) o eligiendo el proveedor"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-orange-300 px-3 text-sm font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/30">
            <Wallet className="h-4 w-4" /> Nueva OP
          </button>
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>
      ) : !datos || (necesitaTodas && !datos.todas) ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> {necesitaTodas ? "Trayendo todas las facturas…" : "Cargando…"}</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {tildables.length > 0 && (
            <label className="flex items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-xs text-zinc-500 dark:border-zinc-800">
              <input type="checkbox" className="h-4 w-4 accent-orange-500" checked={todasTildadas}
                onChange={(e) => setTildadas(e.target.checked ? [...new Set([...tildadas, ...tildables.map((f) => f.id)])] : tildadas.filter((id) => !tildables.some((f) => f.id === id)))} />
              Tildar todas las de la lista
            </label>
          )}
          <DataTable columns={cols} data={visibles} onRowClick={setFicha} pageSize={50}
            emptyMessage={filtro === "todas" ? "No hay facturas con esa búsqueda" : esVenta ? "No hay facturas para cobrar con ese filtro" : "No hay facturas para pagar con ese filtro"} />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span className="flex flex-wrap gap-x-4">
              <span className="text-zinc-400">{totales.cantidad} facturas</span>
              <span>{esVenta ? "A cobrar" : "A pagar"} <b className={`font-mono ${esVenta ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400"}`}>{montos(totales.saldo)}</b></span>
              <span>Vencido <b className="font-mono text-red-600">{montos(totales.vencido)}</b></span>
            </span>
            {tildadas.length > 0 && seleccion && (
              <span className="flex items-center gap-2">
                <span>Tildadas: {tildadas.length} · <b className="font-mono text-zinc-800 dark:text-zinc-100">{formatCurrency(seleccion.saldo, seleccion.moneda)}</b>{seleccion.ids.length < tildadas.length ? ` (${seleccion.ids.length} de ${seleccion.nombre})` : ""}</span>
                <button type="button" onClick={() => setTildadas([])} className="text-orange-600 hover:underline">Destildar</button>
                <button type="button" onClick={abrirPago}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-white ${esVenta ? "bg-emerald-600 hover:bg-emerald-700" : "bg-orange-500 hover:bg-orange-600"}`}>
                  {esVenta ? <HandCoins className="h-4 w-4" /> : <Wallet className="h-4 w-4" />} {esVenta ? "Cobrar" : "Pagar"} ({seleccion.ids.length})
                </button>
              </span>
            )}
          </div>
          {seleccion && seleccion.avisos.length > 0 && (
            <div className="space-y-1 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {seleccion.avisos.map((a) => <p key={a} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}</p>)}
            </div>
          )}
        </div>
      )}

      {ficha && (esVenta ? (
        <FichaFacturaVenta facturaId={ficha.id} onClose={() => setFicha(null)} cobrable={sePuedeTildar(ficha)}
          onCobrar={() => { const f = ficha; setFicha(null); setPagando({ entidadId: f.entidadId, nombre: f.nombre, ids: [f.id] }); }}
          extra={ficha.docs.length > 0 && (
            <>
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-zinc-500">Cobrada con</h3>
              <div className="space-y-1">
                {ficha.docs.map((d) => {
                  const r = recibosPorId.get(d.id);
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-2 rounded border border-zinc-100 px-2 py-1 text-sm dark:border-zinc-800">
                      <span className="text-zinc-800 dark:text-zinc-200">{d.numero}{r ? ` · ${formatDate(r.fecha)} · ${montos(r.total)}` : ""}</span>
                      <AccionesDoc doc={d} accion={accionDoc} />
                    </div>
                  );
                })}
              </div>
            </>
          )} />
      ) : (
        <FichaFacturaCompra facturaId={ficha.id} onClose={() => setFicha(null)} conAcciones />
      ))}

      {editando && (
        <EditarVencimiento fila={aVenc(editando)} sociedadId={sociedadId}
          pendientes={(datos?.filas || []).filter((f) => f.saldo > 0.005 && f.entidadId && f.entidadId === editando.entidadId).map(aVenc)}
          onClose={() => setEditando(null)} onCambio={cambiarVencimientos} />
      )}

      {pagando && (esVenta ? (
        <CobrarCliente sociedadId={sociedadId} clienteId={pagando.entidadId} clienteNombre={pagando.nombre} preseleccion={pagando.ids} directo={pagando.ids.length > 0}
          onClose={() => setPagando(null)} onCobrado={recargar} />
      ) : (
        <PagarProveedor sociedadId={sociedadId} proveedorId={pagando.entidadId} facturaIds={pagando.ids}
          onClose={() => setPagando(null)} onPagado={recargar} />
      ))}

      {enviarOP && <EnviarOrdenPago opId={enviarOP} onClose={() => setEnviarOP(null)} />}
      <EnviarRecibo recibo={enviarRecibo} onClose={() => setEnviarRecibo(null)} />
    </div>
  );
}

/** Los 3 botones de un documento: Ver, Descargar, Enviar. */
function AccionesDoc({ doc, accion }: { doc: DocPago; accion: (d: DocPago, que: "ver" | "bajar" | "enviar") => void }) {
  const chico = "rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800";
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button type="button" title="Ver (se abre en otra pestaña)" onClick={(e) => { e.stopPropagation(); accion(doc, "ver"); }} className={chico}><Eye className="h-3.5 w-3.5" /></button>
      <button type="button" title="Descargar" onClick={(e) => { e.stopPropagation(); accion(doc, "bajar"); }} className={chico}><Download className="h-3.5 w-3.5" /></button>
      <button type="button" title="Enviar por mail" onClick={(e) => { e.stopPropagation(); accion(doc, "enviar"); }} className={chico}><Mail className="h-3.5 w-3.5" /></button>
    </span>
  );
}

/** N° de OP/recibo en la tabla: al tocarlo muestra Ver / Descargar / Enviar. */
function MenuDoc({ doc, accion }: { doc: DocPago; accion: (d: DocPago, que: "ver" | "bajar" | "enviar") => void }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <span className="relative" onMouseLeave={() => setAbierto(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setAbierto((a) => !a); }}
        className="whitespace-nowrap rounded px-1 font-mono text-xs text-orange-600 hover:bg-orange-50 dark:hover:bg-zinc-800">{doc.numero}</button>
      {abierto && (
        <span className="absolute left-0 top-full z-20 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <AccionesDoc doc={doc} accion={(d, q) => { setAbierto(false); accion(d, q); }} />
        </span>
      )}
    </span>
  );
}
