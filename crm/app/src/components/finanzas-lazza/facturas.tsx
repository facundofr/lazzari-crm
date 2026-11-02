"use client";

// Finanzas Lazza → Facturas (Augusto 19/10/2026): reemplaza a Pagar, Cobrar y Vencimientos. Una fila por factura,
// Ventas y Compras separadas (nunca mezcladas), filtros Pendientes / Vencidas / Todas, buscador y orden por vencimiento.
// Se tildan varias y "Pagar (n)" / "Cobrar (n)" abre la MISMA ventana de siempre (OP de Finanzas / liquidación de cobro).
// Una OP es de un solo proveedor y un cobro de un solo cliente (y de una moneda): si se tilda de más, aviso y se sigue con el primero.
// Ventas suma OC del cliente y vendedor (Augusto: "oc nuestra no la sumes"). Cobrada/Pagada con: recibo u OP, con Ver / Descargar / Enviar.
// Clic en la fila = la ficha de la factura (Ver, Descargar, Enviar). "Enviar" en la columna Enviada = directo la ventana de mail. Lápiz en "Vence" = cambiar vencimiento (la ventana de Vencimientos).
// "Todas" trae también cobradas/pagadas, anuladas y NC: se carga recién cuando se toca (es más pesado).
// Ventas (Augusto 20/10): arriba "Facturado del mes" en $ (Neto + IVA, ◀ mes ▶), vencidas y por vencer (clic = filtra);
// columnas Fecha · Vence · Cliente · N° · OC · Vend. (iniciales) · Mon. · Neto · Total · Saldo · Estado · Enviada · Ver/Descargar.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Eye, HandCoins, Loader2, Mail, Paperclip, Pencil, Receipt, Search, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import {
  diasEntre, estadoFactura, etiquetaEstado, facturadoDelMes, filtrarFacturas, iniciales, prepararSeleccion, resumenVencimientos, sePuedeTildar, totalesFacturas,
  type DocPago, type EstadoFactura, type FilaFactura, type FiltroFacturas, type LadoFactura,
} from "@/lib/facturas-lazza";
import type { Recibo } from "@/lib/recibos";
import { abrirFacturaVenta, FichaFacturaCompra, FichaFacturaVenta } from "@/components/facturas-consulta";
import { EmitirFacturaModal } from "@/components/facturacion/emitir-factura-modal";
import { useArcaStatus } from "@/lib/use-arca-status";
import { saldoClienteEn } from "@/lib/saldo-clientes";
import { useSaldosClientes } from "./use-saldos-clientes";
import { sumarMeses } from "@/lib/reportes-comprobantes";
import { traerComprobantesMes, traerDolarDelDia, traerFacturasFL, traerSaldosSacados } from "./datos";
import { PanelSacados, TildeSaldo, VenceChip, claseFilaVence } from "./saldos-chicos";
import { claveSaldo, esSaldoChico, separarSacados } from "@/lib/saldos-pendientes";
import { CobrarCliente } from "./cobrar";
import { FinanzasLazzaFacturar } from "./facturar";
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
  cheque_cartera: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  cheque_depositado: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  cheque_endosado: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

const montos = (m: { ARS: number; USD: number }, cero = "$ 0") => {
  const partes = [m.ARS >= 0.01 ? formatCurrency(m.ARS) : null, m.USD >= 0.01 ? formatCurrency(m.USD, "USD") : null].filter(Boolean);
  return partes.length ? partes.join(" + ") : cero;
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (periodo: string) => `${MESES[Number(periodo.slice(5, 7)) - 1] || ""} ${periodo.slice(0, 4)}`;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const boton = (activo: boolean) => `rounded-md px-3 py-1 text-sm font-medium ${activo ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;

type Datos = { filas: FilaFactura[]; recibos: Recibo[]; todas: boolean };

export function FinanzasLazzaFacturas({ sociedadId, ladoInicial = "venta", soloLectura = false, facturaInicial }: {
  sociedadId: string; ladoInicial?: LadoFactura | "facturar";
  /** Vendedores (Facturas del menú, Augusto 20/10): ven Ventas y Compras, descargan y envían; no facturan, no cobran/pagan ni cambian vencimientos. */
  soloLectura?: boolean;
  /** Factura de venta a abrir al entrar (links `/facturas?factura=<id>` de Remitos, el buscador y la campana; 29/10/2026). */
  facturaInicial?: string | null;
}) {
  const { sociedadActiva } = useUser();
  // "Facturar" (Augusto 20/10): primera pestaña, los PR que faltan facturar (facturar.tsx).
  const [verFacturar, setVerFacturar] = useState(!soloLectura && ladoInicial === "facturar");
  const [lado, setLado] = useState<LadoFactura>(ladoInicial === "facturar" ? "venta" : ladoInicial);
  const [filtro, setFiltro] = useState<FiltroFacturas>("pendientes");
  const [texto, setTexto] = useState("");
  const [envio, setEnvio] = useState<"" | "si" | "no">("");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [tildadas, setTildadas] = useState<string[]>([]);
  const [ficha, setFicha] = useState<FilaFactura | null>(null);
  // Factura pedida por link: si está en la lista se abre su ficha completa; si no (cobrada, anulada), la ficha sola.
  const [fichaLink, setFichaLink] = useState<string | null>(facturaInicial || null);
  // "Enviar" en la columna Enviada: abre directo la ventana de mail (sin la ficha).
  const [enviarDe, setEnviarDe] = useState<FilaFactura | null>(null);
  const [editando, setEditando] = useState<FilaFactura | null>(null);
  const [pagando, setPagando] = useState<{ entidadId: string | null; nombre: string; ids: string[] } | null>(null);
  const [enviarOP, setEnviarOP] = useState<string | null>(null);
  const [enviarRecibo, setEnviarRecibo] = useState<Recibo | null>(null);
  // "Nueva factura" (Augusto 20/10): la misma ventana de emitir, sin PR (se elige el cliente).
  const [nuevaFactura, setNuevaFactura] = useState(false);
  const arcaStatus = useArcaStatus(sociedadId);
  // «Límite de crédito alcanzado» al facturar (arreglo 12): el saldo del cliente se trae al abrir «Nueva factura».
  const saldosClientes = useSaldosClientes(sociedadId, nuevaFactura);
  const hoy = todayAR();
  const necesitaTodas = filtro === "todas";
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [delMes, setDelMes] = useState<ReturnType<typeof facturadoDelMes> | null>(null);

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

  // Saldos chicos sacados de pendientes (Augusto 02/11/2026): no cuentan en Pendientes, Por vencer ni Vencidas (siguen en Cuentas
  // corrientes y en «Todas»). «Ver saldos sacados» los muestra abajo para volverlos.
  const [saldos, setSaldos] = useState<{ sacados: Set<string>; dolar: number | null }>({ sacados: new Set(), dolar: null });
  const [verSacados, setVerSacados] = useState(false);
  useEffect(() => {
    let vivo = true;
    Promise.all([traerSaldosSacados(sociedadId), traerDolarDelDia(hoy)])
      .then(([sacados, dolar]) => { if (vivo) setSaldos({ sacados, dolar }); })
      .catch((e) => console.error("Finanzas Lazza · Saldos sacados:", e));
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);
  const { pendientes, sacadas } = useMemo(() => {
    const r = separarSacados(datos?.filas || [], saldos.sacados);
    return { pendientes: r.pendientes, sacadas: r.sacados.filter((f) => f.saldo > 0.005) };
  }, [datos, saldos]);

  // Facturado del mes (solo ventas): aparte de la lista, no depende del filtro.
  useEffect(() => {
    if (lado !== "venta") return;
    let vivo = true;
    setDelMes(null);
    traerComprobantesMes(sociedadId, mes)
      .then((c) => { if (vivo) setDelMes(facturadoDelMes(c)); })
      .catch((e) => console.error("Finanzas Lazza · Facturado del mes:", e));
    return () => { vivo = false; };
  }, [sociedadId, lado, mes, recarga]);

  const visibles = useMemo(() => filtrarFacturas(filtro === "todas" ? datos?.filas || [] : pendientes, { filtro, texto, envio: lado === "venta" ? envio : "" }),
    [datos, pendientes, filtro, texto, envio, lado]);
  const totales = useMemo(() => totalesFacturas(visibles), [visibles]);
  const venc = useMemo(() => resumenVencimientos(pendientes), [pendientes]);
  const porId = useMemo(() => new Map((datos?.filas || []).map((f) => [f.id, f])), [datos]);
  const seleccion = useMemo(() => prepararSeleccion(tildadas.map((id) => porId.get(id)).filter(Boolean) as FilaFactura[], lado), [tildadas, porId, lado]);
  const recibosPorId = useMemo(() => new Map((datos?.recibos || []).map((r) => [r.id, r])), [datos]);
  useEffect(() => {
    if (!fichaLink || !datos) return;
    const fila = porId.get(fichaLink);
    if (fila) { setFicha(fila); setFichaLink(null); }
  }, [fichaLink, datos, porId]);

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
    { key: "tilde", label: "", render: (f) => (!soloLectura && sePuedeTildar(f) ? (
      <input type="checkbox" aria-label={`Tildar ${f.comprobante}`} className="h-4 w-4 accent-orange-500" checked={tildadas.includes(f.id)}
        onClick={(e) => e.stopPropagation()} onChange={(e) => tildar(f.id, e.target.checked)} />
    ) : null) },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (f) => f.fecha, render: (f) => <span className="whitespace-nowrap">{formatDate(f.fecha)}</span> },
    { key: "vence", label: "Vence", sortable: true, sortValue: (f) => f.vence, render: (f) => {
      const conSaldo = f.saldo > 0.005;
      const editable = conSaldo && !soloLectura;
      // 02/11/2026 (Augusto): más color a vencidas (rojo) y por vencer (naranja, de hoy a 7 días); sin saldo, gris.
      return (
        <button type="button" disabled={!editable} onClick={(e) => { e.stopPropagation(); setEditando(f); }} title={editable ? "Cambiar el vencimiento o los días de pago" : undefined}
          className={`group rounded px-1 text-left enabled:hover:bg-orange-50 dark:enabled:hover:bg-zinc-800 ${conSaldo ? "" : "text-zinc-400"}`}>
          <VenceChip vence={f.vence} dias={f.dias} conSaldo={conSaldo} sinVencimiento={f.sinVencimiento}
            extra={editable ? <> <Pencil className="inline h-3 w-3 text-zinc-300 group-hover:text-orange-500" /></> : null} />
        </button>
      );
    } },
    { key: "nombre", label: esVenta ? "Cliente" : "Proveedor", sortable: true, sortValue: (f) => f.nombre, render: (f) => <span className="block max-w-[200px] truncate" title={f.nombre}>{f.nombre || "—"}</span> },
    { key: "comprobante", label: "N° factura", sortable: true, sortValue: (f) => f.comprobante, render: (f) => <span className="whitespace-nowrap font-mono text-xs">{f.comprobante}</span> },
    ...(esVenta ? [
      { key: "oc", label: "OC cliente", sortable: true, sortValue: (f: FilaFactura) => f.ocCliente, render: (f: FilaFactura) => <span className="block max-w-[110px] truncate text-xs text-zinc-500" title={f.ocCliente}>{f.ocCliente || "—"}</span> },
      { key: "vendedor", label: "Vend.", sortable: true, sortValue: (f: FilaFactura) => f.vendedor, render: (f: FilaFactura) => <span className="whitespace-nowrap text-xs text-zinc-500" title={f.vendedor}>{iniciales(f.vendedor) || "—"}</span> },
    ] : []),
    { key: "moneda", label: "Mon.", sortable: true, sortValue: (f) => f.moneda, render: (f) => (f.moneda === "USD" ? "US$" : "$") },
    ...(esVenta ? [
      { key: "neto", label: "Neto", sortable: true, sortValue: (f: FilaFactura) => f.neto, className: "text-right", render: (f: FilaFactura) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.neto, f.moneda)}</span> },
    ] : []),
    { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.total, f.moneda)}</span> },
    { key: "saldo", label: "Saldo", sortable: true, sortValue: (f) => f.saldo, className: "text-right", render: (f) => {
      // Saldo chico (factura ya pagada en parte, menos de $ 20.000): el tilde para sacarlo de pendientes o volverlo.
      const sacado = saldos.sacados.has(claveSaldo(f));
      const tilde = !soloLectura && f.saldo > 0.005 && (sacado || esSaldoChico(f, saldos.dolar));
      return (
        <span className={`whitespace-nowrap font-mono ${f.saldo > 0.005 ? "font-semibold" : "text-zinc-400"}`}>
          {formatCurrency(f.saldo, f.moneda)}
          {tilde && <span className="mt-0.5 block font-sans text-[11px] font-normal"><TildeSaldo f={f} sacado={sacado} onCambio={recargar} /></span>}
        </span>
      );
    } },
    { key: "estado", label: "Estado", sortable: true, sortValue: (f) => f.estado, render: (f) => (
      <span className="whitespace-nowrap">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ESTILO_ESTADO[f.estado]}`}>{etiquetaEstado(f.estado, lado)}</span>
        {f.estado === "vencida" && f.parcial && <span className="block text-[10px] text-zinc-400">parcial</span>}
        {f.cheque && f.estado.startsWith("cheque_") && (
          <span className="block text-[10px] text-zinc-400">
            N° {f.cheque.numero}{f.cheque.estado === "cartera" ? " · sin depositar" : f.cheque.fecha ? ` · ${f.cheque.estado === "endosado" ? "endosado" : "depositado"} ${formatDate(f.cheque.fecha)}` : ""}
          </span>
        )}
      </span>
    ) },
    // Ventas: sin "Cobrada con" (Augusto 20/10: "si está cobrada está bien"); el recibo sigue en la ficha.
    ...(esVenta ? [
      { key: "enviada", label: "Enviada", sortable: true, sortValue: (f: FilaFactura) => f.enviada || "", render: (f: FilaFactura) => (
        f.enviada && f.envioEstado !== "bounced" ? <span className="whitespace-nowrap text-xs text-emerald-600">✓ {formatDate(f.enviada)}{f.porFuera ? " · por fuera" : ""}</span> : (
          <span className="flex items-center gap-1 whitespace-nowrap text-xs">
            <span className="font-medium text-red-600">{f.envioEstado === "bounced" ? "Rebotó" : "No enviada"}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); setEnviarDe(f); }} title="Mandar la factura por mail al cliente"
              className="inline-flex items-center gap-0.5 rounded border border-red-200 px-1.5 py-0.5 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"><Mail className="h-3 w-3" /> Enviar</button>
          </span>
        )
      ) },
    ] : [
      { key: "docs", label: "Pagada con", sortable: true, sortValue: (f: FilaFactura) => f.docs.map((d) => d.numero).join(" "), render: (f: FilaFactura) => (
        f.docs.length ? <span className="flex flex-col items-start gap-0.5">{f.docs.map((d) => <MenuDoc key={d.id} doc={d} accion={accionDoc} />)}</span> : <span className="text-xs text-zinc-300">—</span>
      ) },
    ]),
    { key: "ver", label: "", render: (f) => (
      <span className="flex items-center gap-0.5">
        <button type="button" title="Ver la factura (descargar y enviar)" onClick={(e) => { e.stopPropagation(); setFicha(f); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
        {esVenta && (
          <button type="button" title="Descargar el PDF" onClick={(e) => { e.stopPropagation(); if (sociedadActiva) void abrirFacturaVenta(f.id, sociedadActiva, false); }}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /></button>
        )}
      </span>
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
      return { ...f, vence, sinVencimiento: false, dias, ...estadoFactura({ anulada: f.estado === "anulada", nc: f.estado === "nc", total: f.total, saldo: f.saldo, dias, cheque: f.cheque }) };
    }),
  } : d));

  const abrirPago = () => { if (seleccion) setPagando({ entidadId: seleccion.entidadId, nombre: seleccion.nombre, ids: seleccion.ids }); };

  const pestanas = (
    <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
      {!soloLectura && <button type="button" onClick={() => setVerFacturar(true)} className={boton(verFacturar)}>Facturar</button>}
      <button type="button" onClick={() => { setVerFacturar(false); setLado("venta"); }} className={boton(!verFacturar && esVenta)}>Ventas</button>
      <button type="button" onClick={() => { setVerFacturar(false); setLado("compra"); }} className={boton(!verFacturar && !esVenta)}>Compras</button>
    </div>
  );

  if (verFacturar) return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">{pestanas}</div>
      <FinanzasLazzaFacturar sociedadId={sociedadId} />
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {pestanas}
        <div className="flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-700">
          {([["pendientes", "Pendientes"], ["por_vencer", "Por vencer"], ["vencidas", "Vencidas"], ["todas", "Todas"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setFiltro(k)} className={boton(filtro === k)}>{l}</button>
          ))}
        </div>
        {sacadas.length > 0 && filtro !== "todas" && !soloLectura && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={verSacados} onChange={(e) => setVerSacados(e.target.checked)} className="h-4 w-4 accent-orange-500" /> Ver saldos sacados ({sacadas.length})
          </label>
        )}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={esVenta ? "Buscar cliente, N° factura, OC, vendedor o recibo" : "Buscar proveedor, N° factura u OP"} className={`${control} w-full pl-8`} />
        </div>
        {esVenta && (
          <select value={envio} onChange={(e) => setEnvio(e.target.value as "" | "si" | "no")} title="Filtrar por envío por mail" className={control}>
            <option value="">Enviadas y no</option><option value="si">Enviadas</option><option value="no">No enviadas</option>
          </select>
        )}
        {esVenta && !soloLectura && (
          <button type="button" onClick={() => setNuevaFactura(true)} title="Emitir una factura sin PR, eligiendo el cliente"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-orange-300 px-3 text-sm font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/30">
            <Receipt className="h-4 w-4" /> Nueva factura
          </button>
        )}
        {!soloLectura && (esVenta ? (
          <button type="button" onClick={() => setPagando({ entidadId: null, nombre: "", ids: [] })} title="Cobro sin factura o eligiendo el cliente"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
            <HandCoins className="h-4 w-4" /> Nuevo cobro
          </button>
        ) : (
          <button type="button" onClick={() => setPagando({ entidadId: null, nombre: "", ids: [] })} title="OP sin factura (pago a cuenta) o eligiendo el proveedor"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-orange-300 px-3 text-sm font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-950/30">
            <Wallet className="h-4 w-4" /> Nueva OP
          </button>
        ))}
      </div>

      {esVenta && (
        <div className="flex flex-wrap items-stretch gap-2">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="flex items-center gap-0.5">
              <button type="button" onClick={() => setMes((m) => sumarMeses(m, -1))} title="Mes anterior" className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[110px] text-center text-xs font-semibold uppercase text-zinc-500">Facturado {nombreMes(mes)}</span>
              <button type="button" disabled={mes >= hoy.slice(0, 7)} onClick={() => setMes((m) => sumarMeses(m, 1))} title="Mes siguiente" className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"><ChevronRight className="h-4 w-4" /></button>
            </span>
            {!delMes ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400" /> : (
              <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-zinc-500">
                <span>Neto <b className="font-mono text-zinc-800 dark:text-zinc-100">{formatCurrency(delMes.neto)}</b></span>
                <span>+ IVA <b className="font-mono text-zinc-800 dark:text-zinc-100">{formatCurrency(delMes.iva)}</b></span>
                <span>= <b className="font-mono text-base text-zinc-900 dark:text-white">{formatCurrency(delMes.total)}</b></span>
                <span className="text-zinc-400">{delMes.facturas} fact.{delMes.nc ? ` · ${delMes.nc} NC (restan)` : ""}{delMes.x.cantidad ? ` · ${delMes.x.cantidad} X por ${formatCurrency(delMes.x.total)} no suman` : ""}{delMes.sinTC ? ` · ⚠️ ${delMes.sinTC} en US$ sin cotización` : ""}</span>
              </span>
            )}
          </div>
          <button type="button" onClick={() => setFiltro("vencidas")} title="Ver solo las vencidas"
            className={`rounded-xl border px-3 py-2 text-left text-xs ${filtro === "vencidas" ? "border-red-400 bg-red-50 dark:bg-red-950/30" : "border-zinc-200 bg-white hover:border-red-300 dark:border-zinc-800 dark:bg-zinc-900"}`}>
            <span className="block font-semibold uppercase text-red-600">{venc.vencidas.cantidad} vencidas</span>
            <b className="font-mono text-red-700 dark:text-red-400">{montos(venc.vencidas.monto)}</b>
          </button>
          <button type="button" onClick={() => setFiltro("por_vencer")} title="Ver las que vencen hoy o en los próximos 7 días"
            className={`rounded-xl border px-3 py-2 text-left text-xs ${filtro === "por_vencer" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-zinc-200 bg-white hover:border-amber-300 dark:border-zinc-800 dark:bg-zinc-900"}`}>
            <span className="block font-semibold uppercase text-amber-600">{venc.porVencer.cantidad} vencen en 7 días</span>
            <b className="font-mono text-amber-700 dark:text-amber-400">{montos(venc.porVencer.monto)}</b>
          </button>
        </div>
      )}

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
          <DataTable columns={cols} data={visibles} onRowClick={setFicha} pageSize={50} rowClassName={(f) => claseFilaVence(f.dias, f.saldo > 0.005)}
            emptyMessage={filtro === "todas" ? "No hay facturas con esa búsqueda" : esVenta ? "No hay facturas para cobrar con ese filtro" : "No hay facturas para pagar con ese filtro"} />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span className="flex flex-wrap gap-x-4">
              <span className="text-zinc-400">{totales.cantidad} facturas</span>
              <span>{esVenta ? "A cobrar" : "A pagar"} <b className={`font-mono ${esVenta ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400"}`}>{montos(totales.saldo)}</b></span>
              <span>Vencido <b className="font-mono text-red-600">{montos(totales.vencido)}</b></span>
            </span>
          </div>
          {seleccion && seleccion.avisos.length > 0 && (
            <div className="space-y-1 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {seleccion.avisos.map((a) => <p key={a} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}</p>)}
            </div>
          )}
        </div>
      )}
      {verSacados && filtro !== "todas" && !soloLectura && <PanelSacados filas={sacadas} onCambio={recargar} />}

      {/* Barra fija (auditoría UX 27/10, arreglo 1): lo tildado y su suma siempre a la vista, sin bajar hasta el final de la tabla. */}
      {datos && tildadas.length > 0 && seleccion && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 shadow-lg dark:border-zinc-600 dark:bg-zinc-900">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            <b>{tildadas.length}</b> {tildadas.length === 1 ? "factura" : "facturas"} · <b className="font-mono text-zinc-900 dark:text-white">{formatCurrency(seleccion.saldo, seleccion.moneda)}</b>
            {seleccion.ids.length < tildadas.length ? <span className="text-xs text-zinc-400"> ({seleccion.ids.length} de {seleccion.nombre})</span> : null}
          </span>
          <span className="flex items-center gap-3">
            <button type="button" onClick={() => setTildadas([])} className="text-xs text-orange-600 hover:underline">Destildar</button>
            <button type="button" onClick={abrirPago}
              className={`inline-flex items-center gap-1 rounded-lg px-4 py-1.5 text-sm font-medium text-white ${esVenta ? "bg-emerald-600 hover:bg-emerald-700" : "bg-orange-500 hover:bg-orange-600"}`}>
              {esVenta ? <HandCoins className="h-4 w-4" /> : <Wallet className="h-4 w-4" />} {esVenta ? "Cobrar" : "Pagar"} ({seleccion.ids.length})
            </button>
          </span>
        </div>
      )}

      {enviarDe && <FichaFacturaVenta facturaId={enviarDe.id} soloMail onClose={() => setEnviarDe(null)} onEnviada={recargar} />}
      {fichaLink && datos && !porId.has(fichaLink) && (
        <FichaFacturaVenta facturaId={fichaLink} onClose={() => setFichaLink(null)} soloLectura={soloLectura} onEnviada={recargar} />
      )}
      {ficha && (esVenta ? (
        <FichaFacturaVenta facturaId={ficha.id} onClose={() => setFicha(null)} cobrable={!soloLectura && sePuedeTildar(ficha)} soloLectura={soloLectura} onEnviada={recargar}
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
        <FichaFacturaCompra facturaId={ficha.id} onClose={() => setFicha(null)} conAcciones soloLectura={soloLectura} onCambio={recargar} pagable={!soloLectura && sePuedeTildar(ficha)}
          onPagar={() => { const f = ficha; setFicha(null); setPagando({ entidadId: f.entidadId, nombre: f.nombre, ids: [f.id] }); }} />
      ))}

      {editando && (
        <EditarVencimiento fila={aVenc(editando)} sociedadId={sociedadId}
          pendientes={(datos?.filas || []).filter((f) => f.saldo > 0.005 && f.entidadId && f.entidadId === editando.entidadId).map(aVenc)}
          onClose={() => setEditando(null)} onCambio={cambiarVencimientos} />
      )}

      {nuevaFactura && (
        <EmitirFacturaModal
          arcaCertOk={arcaStatus?.certOk}
          saldoClienteArs={(id) => (saldosClientes ? saldoClienteEn(saldosClientes, id, "ARS") : null)}
          onClose={() => setNuevaFactura(false)}
          onEmitted={recargar}
        />
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

/** N° de OP/recibo en la tabla: al tocarlo muestra Ver / Descargar / Enviar. Clip = adjuntos de la OP (Augusto 20/10: "para que los vendedores lo puedan utilizar"). */
function MenuDoc({ doc, accion }: { doc: DocPago; accion: (d: DocPago, que: "ver" | "bajar" | "enviar") => void }) {
  const [abierto, setAbierto] = useState<"" | "doc" | "adjuntos">("");
  const adjuntos = doc.archivos || [];
  return (
    <span className="relative flex items-center" onMouseLeave={() => setAbierto("")}>
      <button type="button" onClick={(e) => { e.stopPropagation(); setAbierto((a) => (a === "doc" ? "" : "doc")); }}
        className="whitespace-nowrap rounded px-1 font-mono text-xs text-orange-600 hover:bg-orange-50 dark:hover:bg-zinc-800">{doc.numero}</button>
      {adjuntos.length > 0 && (
        <button type="button" title={`Adjuntos de la OP (${adjuntos.length})`} onClick={(e) => { e.stopPropagation(); setAbierto((a) => (a === "adjuntos" ? "" : "adjuntos")); }}
          className="rounded p-0.5 text-zinc-400 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-zinc-800"><Paperclip className="h-3.5 w-3.5" /></button>
      )}
      {abierto === "doc" && (
        <span className="absolute left-0 top-full z-20 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <AccionesDoc doc={doc} accion={(d, q) => { setAbierto(""); accion(d, q); }} />
        </span>
      )}
      {abierto === "adjuntos" && (
        <span className="absolute left-0 top-full z-20 flex min-w-[180px] flex-col rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {adjuntos.map((a, i) => (
            <a key={`${a.url}-${i}`} href={a.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Ver / descargar (se abre en otra pestaña)"
              className="flex items-center gap-1 truncate rounded px-1.5 py-1 text-xs text-zinc-700 hover:bg-orange-50 hover:text-orange-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{a.nombre}</span>
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
