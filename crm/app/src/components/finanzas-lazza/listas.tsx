"use client";

// Finanzas Lazza → Órdenes de pago, Recibos, Retenciones y Movimientos.
// Recibos numerados (19/10, "recibos B"): 1 recibo = 1 cobro con su N° (lib/recibos.ts, migración 20261019210000),
// con Ver, Descargar y Enviar por mail (recibo-doc.tsx; el mismo PDF de recibo de Finanzas, con N°, medios, retenciones y facturas).
// Recibos (19/10): "Nuevo cobro" → elegir cliente y facturas → la misma liquidación de Finanzas (cobrar.tsx).
// Órdenes de pago (19/10): "Nueva OP" → la misma ventana de OP de Finanzas (pagar.tsx). 20/10: Anular (y "Anular y pagar de nuevo").
// Mismos datos y reglas que las pestañas de Finanzas; acá solo se miran, con filtros y orden por columna.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Ban, ChevronLeft, ChevronRight, Download, Eye, HandCoins, Loader2, Mail, MailCheck, Plus, Search, Wallet } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { clasificarMovimiento, esCobroDeCliente, type ClaseMovimiento } from "@/lib/tipos-movimiento";
import { armarRetenciones, comprobanteVenta, excelRetencionesSufridas, practicadasPorQuincena, rangoQuincena, totalesRetenciones, type FilaRetencion, type TramoQuincena } from "@/lib/finanzas-lazza";
import { periodoDeFecha, sumarMeses } from "@/lib/reportes-comprobantes";
import { textoTotalRecibo, type Recibo } from "@/lib/recibos";
import { abrirRecibo, EnviarRecibo, SIN_MIGRACION_RECIBOS, traerRecibo, traerRecibos } from "@/components/finanzas-lazza/recibo-doc";
import { useUser } from "@/lib/auth-context";
import { descargarOP, EnviarOrdenPago, verOP } from "@/components/finanzas-lazza/orden-pago-doc";
import { CobrarCliente } from "@/components/finanzas-lazza/cobrar";
import { PagarProveedor } from "@/components/finanzas-lazza/pagar";
import { NuevoMovimiento } from "@/components/finanzas-lazza/nuevo-movimiento";
import { Modal } from "@/components/ui/modal";
import { pctTexto, type AvisosSicore } from "@/lib/certificado-retencion";
import { Select } from "@/components/ui/input";
import { isResponsableInscripto } from "@/lib/fiscal-condition";
import { ALICUOTA_POR_CONCEPTO, CONCEPTOS_RG830 } from "@/lib/retencion-conceptos";
import { desdeSinConcepto, sugerirConcepto, type SugerenciaConcepto } from "@/lib/sugerir-concepto";
import { coincideNumeroCheque } from "@/lib/cheques-lazza";
import { CargarCertificado, CeldaCertificado } from "@/components/finanzas-lazza/cargar-certificado";
import { traerCertificadosCargados } from "@/components/finanzas-lazza/datos";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const mon = (m: unknown): "ARS" | "USD" => (String(m || "").toUpperCase() === "USD" ? "USD" : "ARS");
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const primeroDelMes = () => `${todayAR().slice(0, 7)}-01`;

const TIPO_LABEL: Record<string, string> = {
  cobro: "Cobro", pago: "Pago", cheque_emitido: "Cheque emitido", cheque_recibido: "Cheque recibido", transferencia: "Transferencia",
  efectivo: "Efectivo", deposito: "Depósito", ajuste: "Ajuste", tarjeta: "Tarjeta", link_pago: "Link de pago", echeq: "E-Cheq",
  retencion_iva: "Ret. IVA", retencion_ganancias: "Ret. Ganancias", retencion_iibb: "Ret. IIBB", retencion_suss: "Ret. SUSS",
};
const MEDIO_LABEL: Record<string, string> = { transferencia: "Transf.", cheque: "Cheque", cheque_propio: "Ch. propio", echeq: "E-Cheq", deposito: "Depósito", tarjeta: "Tarjeta", efectivo: "Efectivo" };

/**
 * Columna "Banco": conciliado (verde), registrado (gris) o pendiente (ámbar). Desde Finanzas simple las transferencias
 * no se cruzan con el banco: quedan "Registrado", no "Pendiente" para siempre (auditoría UX 26/10/2026, arreglo 6).
 */
function EstadoBanco({ anulado = false, banco }: { anulado?: boolean; banco: "conciliado" | "registrado" | "pendiente" }) {
  if (anulado) return <span className="text-xs text-red-600">Anulado</span>;
  if (banco === "conciliado") return <span className="text-xs text-emerald-600">Conciliado</span>;
  if (banco === "registrado") return <span className="text-xs text-zinc-500" title="Transferencia: se registra y no se cruza con el banco">Registrado</span>;
  return <span className="text-xs text-amber-600">Pendiente</span>;
}
const ORDEN_BANCO = { pendiente: 1, registrado: 2, conciliado: 3 } as const;

/** Carga con aviso de error y "Cargando…". */
function useCarga<T>(cargar: () => Promise<T>, deps: unknown[]): { datos: T | null; error: string | null } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    cargar().then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { datos, error };
}

function Marco({ error, cargando, filtros, children, pie }: { error: string | null; cargando: boolean; filtros: ReactNode; children: ReactNode; pie?: ReactNode }) {
  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">{filtros}</div>
      {cargando ? <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p> : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {children}
          {pie && <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">{pie}</div>}
        </div>
      )}
    </div>
  );
}

function Buscador({ valor, cambiar, placeholder }: { valor: string; cambiar: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[200px] flex-1">
      <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
      <input value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={placeholder} className={`${control} w-full pl-8`} />
    </div>
  );
}

/** `conTodas` (OP y Recibos, arreglo 25): un botón saca las fechas ("Todas las fechas") o vuelve al mes ("Este mes"). */
function Fechas({ desde, hasta, setDesde, setHasta, conTodas = false }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void; conTodas?: boolean }) {
  const conFechas = !!(desde || hasta);
  return (
    <>
      <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" className={control} />
      <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" className={control} />
      {conTodas && (
        <button type="button" onClick={() => { setDesde(conFechas ? "" : primeroDelMes()); setHasta(""); }}
          className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs text-zinc-600 hover:border-orange-300 hover:text-orange-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {conFechas ? "Todas las fechas" : "Este mes"}
        </button>
      )}
    </>
  );
}

/** Lo que se busca está fuera de las fechas elegidas (arreglo 20, 27/10/2026): se avisa y un clic saca las fechas. */
function FueraDeFechas({ cantidad, texto, ver }: { cantidad: number; texto: string; ver: () => void }) {
  if (cantidad <= 0) return null;
  return (
    <p className="border-b border-zinc-200 px-3 py-1.5 text-xs text-amber-700 dark:border-zinc-700 dark:text-amber-300">
      Hay {cantidad} más con «{texto.trim()}» fuera de las fechas.{" "}
      <button type="button" onClick={ver} className="font-medium underline hover:text-orange-600">Ver todas las fechas</button>
    </p>
  );
}

const enRango = (fecha: string, desde: string, hasta: string) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
/** "Ch. propio ×9 · Transf.": cada medio una vez, con cuántos son. */
const juntarRepetidos = (xs: string[]) => {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return [...c].map(([x, k]) => (k > 1 ? `${x} ×${k}` : x)).join(" · ");
};
const sumar = <T,>(filas: T[], monto: (f: T) => number, moneda: (f: T) => "ARS" | "USD") => {
  const t = { ARS: 0, USD: 0 };
  for (const f of filas) t[moneda(f)] += monto(f);
  return <>{formatCurrency(t.ARS)}{Math.abs(t.USD) >= 0.01 && <> + {formatCurrency(t.USD, "USD")}</>}</>;
};

// ── Órdenes de pago (Augusto 19/10: descargarlas y mandarlas desde acá) ──

/**
 * Anular una OP (20/10): la MISMA función de la base que Finanzas (anular_orden_pago_segura; si es una liquidación en US$,
 * anular_liquidacion_fx). No se borra nada: la OP queda tachada, sus movimientos (pago y retenciones) anulados, los cheques
 * no cambian (26/10: los mueve solo el banco), las NC usadas se liberan y las facturas vuelven a quedar a pagar. "Anular y pagar de nuevo"
 * abre la ventana de OP con el mismo proveedor y las mismas facturas tildadas, así no queda nada duplicado.
 */
function AnularOP({ op, sociedadId, onClose, onAnulada }: {
  op: OP; sociedadId: string; onClose: () => void; onAnulada: (otraVez: { proveedorId: string; facturaIds: string[] } | null) => void;
}) {
  const [facturas, setFacturas] = useState<{ id: string; numero: string }[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    db.from("op_facturas_compra").select("factura_compra_id, facturas_compra(numero_factura)").eq("orden_pago_id", op.id)
      .then(({ data }: any) => { if (vivo) setFacturas((data || []).map((x: any) => ({ id: x.factura_compra_id, numero: x.facturas_compra?.numero_factura || "" }))); });
    return () => { vivo = false; };
  }, [op.id]);

  const anular = async (otraVez: boolean) => {
    setTrabajando(true); setError("");
    try {
      const { data: fx } = await db.from("liquidaciones_fx").select("id").eq("orden_pago_id", op.id).eq("sociedad_id", sociedadId).maybeSingle();
      const { error: e } = fx?.id
        ? await db.rpc("anular_liquidacion_fx", { p_id: fx.id, p_sociedad_id: sociedadId })
        : await db.rpc("anular_orden_pago_segura", { p_orden_pago_id: op.id, p_sociedad_id: sociedadId });
      if (e) throw new Error(e.message);
      onAnulada(otraVez && op.proveedorId ? { proveedorId: op.proveedorId, facturaIds: (facturas || []).map((f) => f.id) } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTrabajando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-zinc-900 dark:text-white">Anular {op.numero}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{op.proveedor} · {formatDate(op.fecha)} · entregado <b className="font-mono">{formatCurrency(op.neto, op.moneda)}</b>{op.retGan > 0 ? <> · ret. {formatCurrency(op.retGan, op.moneda)}</> : null}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-600 dark:text-zinc-300">
          <li>No se borra: la OP queda anulada (tachada) y se sigue viendo.</li>
          <li>El pago y la retención quedan anulados. Los cheques no cambian: dónde está cada uno lo dice el banco.</li>
          <li>{facturas === null ? "Buscando facturas…" : facturas.length ? `Vuelve${facturas.length === 1 ? "" : "n"} a quedar a pagar: ${facturas.map((f) => f.numero).join(", ")}.` : "No paga facturas (era un pago a cuenta): el saldo a favor desaparece."}</li>
          {op.enviada && <li className="text-amber-700 dark:text-amber-300">⚠️ Esta OP se mandó por mail el {formatDate(op.enviada)}: avisale al proveedor.</li>}
        </ul>
        {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">No se pudo anular: {error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300">Cancelar</button>
          <button type="button" disabled={trabajando || facturas === null} onClick={() => anular(false)} className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800">Anular</button>
          {op.proveedorId && (
            <button type="button" disabled={trabajando || facturas === null} onClick={() => anular(true)} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {trabajando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Anular y pagar de nuevo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface OP { id: string; proveedorId: string | null; numero: string; fecha: string; proveedor: string; cuit: string; bruto: number; retGan: number; retPct: number | null; neto: number; moneda: "ARS" | "USD"; medios: string[]; cheques: string[]; chequesSinNumero: number; estado: string; enviada: string | null; sobreVerde: boolean }
const ES_CHEQUE = ["cheque", "cheque_propio", "echeq"];

export function FinanzasLazzaOrdenesPago({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [pagando, setPagando] = useState(false);
  const { datos, error } = useCarga<OP[]>(async () => {
    const rows = await traerTodo<any>(() => db.from("ordenes_pago").select("*, proveedores(razon_social, cuit)").eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id"));
    return rows.map((r) => {
      let medios: any[] = [];
      try { medios = Array.isArray(r.medios_pago) ? r.medios_pago : r.medios_pago ? JSON.parse(r.medios_pago) : []; } catch { medios = []; }
      return {
        id: r.id, proveedorId: r.proveedor_id || null, numero: String(r.numero ?? ""), fecha: String(r.fecha).slice(0, 10), proveedor: r.proveedores?.razon_social || "", cuit: r.proveedores?.cuit || "",
        bruto: Number(r.monto_bruto || 0), retGan: Number(r.retencion_ganancias_monto || 0), retPct: r.retencion_ganancias_pct ?? null,
        neto: Number(r.neto_a_pagar ?? r.neto ?? 0), moneda: mon(r.moneda),
        medios: medios.length > 1 ? medios.map((m) => MEDIO_LABEL[m.tipo] || m.tipo) : [MEDIO_LABEL[r.medio_pago || "transferencia"] || r.medio_pago || "Transf."],
        cheques: medios.filter((m) => ES_CHEQUE.includes(m?.tipo) && m?.numero_cheque).map((m) => String(m.numero_cheque)),
        chequesSinNumero: medios.filter((m) => ES_CHEQUE.includes(m?.tipo) && !m?.numero_cheque && Number(m?.monto) > 0).length,
        estado: r.estado || "pendiente", enviada: r.email_enviado_at || null, sobreVerde: !!r.sobre_verde,
      };
    });
  }, [sociedadId, recarga]);
  const { sociedadActiva } = useUser();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<OP | null>(null);
  const [rehacer, setRehacer] = useState<{ proveedorId: string; facturaIds: string[] } | null>(null);
  const [enviadas, setEnviadas] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [envio, setEnvio] = useState("");
  // Arreglo 25 (27/10/2026): abre en el mes, igual que Recibos (antes abría con todas las fechas).
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  // Arreglo 20 (27/10/2026): también por N° de cheque, con o sin los ceros de adelante.
  const coinciden = useMemo(() => (datos || []).map((o) => (enviadas[o.id] ? { ...o, enviada: enviadas[o.id] } : o)).filter((o) =>
    (!estado || o.estado === estado) && (!envio || (envio === "si") === !!o.enviada)
    && (!q || sinAcentos(`${o.numero} ${o.proveedor} ${o.cuit} ${o.medios.join(" ")}`).includes(q) || coincideNumeroCheque(o.cheques, texto))), [datos, enviadas, estado, envio, q, texto]);
  const visibles = useMemo(() => coinciden.filter((o) => enRango(o.fecha, desde, hasta)), [coinciden, desde, hasta]);
  const cols: Column<OP>[] = [
    // Arreglo 25: sin columna Estado (todas están pagadas o anuladas); la anulada lo dice abajo del N°.
    { key: "numero", label: "N°", sortable: true, sortValue: (o) => o.numero, render: (o) => (
      <span className="whitespace-nowrap font-mono text-xs">
        <span className={o.estado === "anulada" ? "text-zinc-400 line-through" : ""}>{o.numero}</span>
        {o.estado === "anulada" ? <span className="block font-sans text-[10px] font-semibold text-red-600">Anulada</span>
          : o.estado !== "pagada" && <span className="block font-sans text-[10px] font-semibold text-amber-600">Pendiente</span>}
      </span>
    ) },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (o) => o.fecha, render: (o) => <span className="whitespace-nowrap">{formatDate(o.fecha)}</span> },
    { key: "proveedor", label: "Proveedor", sortable: true, sortValue: (o) => o.proveedor },
    { key: "bruto", label: "Bruto", sortable: true, sortValue: (o) => o.bruto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono">{formatCurrency(o.bruto, o.moneda)}</span> },
    { key: "ret", label: "Ret. Gan.", sortable: true, sortValue: (o) => o.retGan, className: "text-right", render: (o) => o.retGan > 0 ? <span className="whitespace-nowrap font-mono">{formatCurrency(o.retGan, o.moneda)}{o.retPct !== null && <span className="block text-[10px] text-zinc-400">{o.retPct}%</span>}</span> : "—" },
    { key: "neto", label: "Entregado", sortable: true, sortValue: (o) => o.neto, className: "text-right", render: (o) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(o.neto, o.moneda)}</span> },
    // Arreglo 25: con los N° en "Cheques", el medio va una vez con cuántos son (antes "Ch. propio" ×9 hacía filas altísimas).
    { key: "medio", label: "Medio", sortable: true, sortValue: (o) => o.medios.join(" "), render: (o) => <span className="text-xs">{juntarRepetidos(o.medios)}</span> },
    // Arreglo 25 (27/10/2026): los N° de los cheques de la OP, hasta 3 (todos al pasar el mouse).
    { key: "cheques", label: "Cheques", sortable: true, sortValue: (o) => o.cheques.join(" "), render: (o) => {
      if (!o.cheques.length && !o.chequesSinNumero) return <span className="text-xs text-zinc-400">—</span>;
      const sinN = o.chequesSinNumero ? `${o.chequesSinNumero} sin N°` : "";
      return (
        <span className={`block max-w-[150px] font-mono text-[11px] ${o.estado === "anulada" ? "text-zinc-400" : "text-zinc-600 dark:text-zinc-300"}`} title={[o.cheques.join(", "), sinN].filter(Boolean).join(" · ")}>
          {o.cheques.slice(0, 3).join(" · ")}
          {o.cheques.length > 3 && <span className="font-sans text-zinc-400"> +{o.cheques.length - 3}</span>}
          {sinN && <span className="font-sans text-zinc-400">{o.cheques.length ? " · " : ""}{sinN}</span>}
        </span>
      );
    } },
    { key: "enviada", label: "Enviada", sortable: true, sortValue: (o) => o.enviada || "", render: (o) => o.enviada ? <span className="text-xs text-emerald-600">✓ {formatDate(o.enviada)}</span> : o.sobreVerde ? <span className="text-xs text-zinc-500">Sobre verde</span> : <span className="text-xs text-zinc-400">—</span> },
    { key: "acciones", label: "", render: (o) => (
      <span className="flex justify-end gap-0.5">
        <button type="button" title="Ver la OP (se abre en otra pestaña, sin descargar)" onClick={(e) => { e.stopPropagation(); if (sociedadActiva) verOP(o.id, sociedadActiva); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
        <button type="button" title="Descargar la OP" onClick={(e) => { e.stopPropagation(); if (sociedadActiva) descargarOP(o.id, sociedadActiva); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /></button>
        {o.estado !== "anulada" && (
          <button type="button" title={o.enviada ? `Enviada el ${formatDate(o.enviada)}: mandarla otra vez` : "Mandar la OP por mail (con los comprobantes)"} onClick={(e) => { e.stopPropagation(); setEnviando(o.id); }}
            className={`rounded p-1.5 hover:bg-orange-50 dark:hover:bg-zinc-800 ${o.enviada ? "text-emerald-600" : "text-orange-500"}`}>{o.enviada ? <MailCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}</button>
        )}
        {o.estado !== "anulada" && (
          <button type="button" title="Anular la OP (no se borra: queda tachada y la factura vuelve a quedar a pagar)" onClick={(e) => { e.stopPropagation(); setAnulando(o); }}
            className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Ban className="h-3.5 w-3.5" /></button>
        )}
      </span>
    ) },
  ];
  return (
    <Marco error={error} cargando={!datos} filtros={<>
      <button type="button" onClick={() => setPagando(true)}
        className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
        <Wallet className="h-4 w-4" /> Nueva OP
      </button>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar N°, proveedor, CUIT, medio o N° de cheque" />
      <select value={estado} onChange={(e) => setEstado(e.target.value)} className={control}><option value="">Todos los estados</option><option value="pagada">Pagadas</option><option value="anulada">Anuladas</option></select>
      <select value={envio} onChange={(e) => setEnvio(e.target.value)} className={control}><option value="">Enviadas y no</option><option value="si">Enviadas por mail</option><option value="no">No enviadas</option></select>
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} conTodas />
    </>} pie={<><span>{visibles.length} órdenes</span><span>Entregado <b className="font-mono">{sumar(visibles.filter((o) => o.estado !== "anulada"), (o) => o.neto, (o) => o.moneda)}</b></span></>}>
      <FueraDeFechas cantidad={q ? coinciden.length - visibles.length : 0} texto={texto} ver={() => { setDesde(""); setHasta(""); }} />
      <DataTable columns={cols} data={visibles} emptyMessage="No hay órdenes de pago con ese filtro" />
      <EnviarOrdenPago opId={enviando} onClose={() => setEnviando(null)} onEnviada={(id, fecha) => setEnviadas((e) => ({ ...e, [id]: fecha }))} />
      {pagando && <PagarProveedor sociedadId={sociedadId} onClose={() => setPagando(false)} onPagado={() => setRecarga((n) => n + 1)} />}
      {anulando && (
        <AnularOP op={anulando} sociedadId={sociedadId} onClose={() => setAnulando(null)}
          onAnulada={(otraVez) => { setAnulando(null); setRecarga((n) => n + 1); if (otraVez) setRehacer(otraVez); }} />
      )}
      {rehacer && <PagarProveedor sociedadId={sociedadId} proveedorId={rehacer.proveedorId} facturaIds={rehacer.facturaIds} onClose={() => setRehacer(null)} onPagado={() => setRecarga((n) => n + 1)} />}
    </Marco>
  );
}

// ── Movimientos (base de Recibos y Movimientos) ─────────────────────

interface Mov { id: string; tipo: string; fecha: string; monto: number; montoOriginal: number | null; moneda: "ARS" | "USD"; descripcion: string; conciliado: boolean; anulado: boolean; nombre: string; clase: ClaseMovimiento; cobro: boolean; facturaVenta: boolean; facturaCompra: boolean }
const bancoDeMov = (m: Mov): "conciliado" | "registrado" | "pendiente" => (m.conciliado ? "conciliado" : m.tipo === "transferencia" ? "registrado" : "pendiente");

async function traerMovimientos(sociedadId: string): Promise<Mov[]> {
  const rows = await traerTodo<any>(() => db.from("movimientos")
    .select("id, tipo, fecha, monto, monto_original, moneda, descripcion, conciliado, anulado, cliente_id, proveedor_id, factura_id, factura_compra_id, nota_credito_compra_id, ajuste_sentido, clientes(razon_social), proveedores(razon_social)")
    .eq("sociedad_id", sociedadId).order("fecha", { ascending: false }).order("id", { ascending: false }));
  return rows.map((r) => ({
    id: r.id, tipo: r.tipo || "", fecha: String(r.fecha).slice(0, 10), monto: Number(r.monto || 0), montoOriginal: r.monto_original === null || r.monto_original === undefined ? null : Number(r.monto_original),
    moneda: mon(r.moneda), descripcion: r.descripcion || "", conciliado: !!r.conciliado, anulado: !!r.anulado,
    nombre: r.clientes?.razon_social || r.proveedores?.razon_social || "",
    // Como Finanzas: la clase se calcula como si no estuviera anulado (el anulado se muestra tachado).
    clase: clasificarMovimiento({ ...r, anulado: false }), cobro: !r.anulado && esCobroDeCliente(r),
    facturaVenta: !!r.factura_id, facturaCompra: !!r.factura_compra_id,
  }));
}

/** Lista vieja (1 recibo = 1 movimiento): solo si todavía no se corrió la migración de recibos numerados. */
function RecibosPorMovimiento({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [cobrando, setCobrando] = useState(false);
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId).then((m) => m.filter((x) => x.cobro)), [sociedadId, recarga]);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((m) => enRango(m.fecha, desde, hasta) && (!q || sinAcentos(`${m.nombre} ${m.descripcion}`).includes(q))), [datos, desde, hasta, q]);
  const cols: Column<Mov>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (m) => m.fecha, render: (m) => formatDate(m.fecha) },
    { key: "nombre", label: "Cliente", sortable: true, sortValue: (m) => m.nombre, render: (m) => m.nombre || "Cliente sin nombre" },
    { key: "descripcion", label: "Detalle", sortable: true, sortValue: (m) => m.descripcion, render: (m) => <span className="text-xs">{m.descripcion || "Cobro de cliente"}</span> },
    { key: "tipo", label: "Medio", sortable: true, sortValue: (m) => m.tipo, render: (m) => <span className="text-xs">{TIPO_LABEL[m.tipo] || m.tipo}</span> },
    { key: "monto", label: "Importe", sortable: true, sortValue: (m) => m.monto, className: "text-right", render: (m) => <span className="whitespace-nowrap font-mono font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(m.monto, m.moneda)}</span> },
    { key: "conciliado", label: "Banco", sortable: true, sortValue: (m) => ORDEN_BANCO[bancoDeMov(m)], render: (m) => <EstadoBanco banco={bancoDeMov(m)} /> },
  ];
  return (
    <>
      <Marco error={error} cargando={!datos} filtros={<>
        <button type="button" onClick={() => setCobrando(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <HandCoins className="h-4 w-4" /> Nuevo cobro
        </button>
        <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar cliente o detalle" />
        <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      </>} pie={<><span>{visibles.length} cobros (hoy 1 recibo = 1 movimiento)</span><span>Cobrado <b className="font-mono text-emerald-700 dark:text-emerald-400">{sumar(visibles, (m) => m.monto, (m) => m.moneda)}</b></span></>}>
        <DataTable columns={cols} data={visibles} emptyMessage="No hay cobros con ese filtro" />
      </Marco>
      {cobrando && <CobrarCliente sociedadId={sociedadId} onClose={() => setCobrando(false)} onCobrado={() => setRecarga((n) => n + 1)} />}
    </>
  );
}

// ── Recibos numerados ───────────────────────────────────────────────

const resumenMedios = (r: Recibo) => juntarRepetidos(r.renglones.map((x) => x.medio));

export function FinanzasLazzaRecibos({ sociedadId }: { sociedadId: string }) {
  const { sociedadActiva } = useUser();
  const [recarga, setRecarga] = useState(0);
  const [cobrando, setCobrando] = useState(false);
  const [enviando, setEnviando] = useState<Recibo | null>(null);
  const [sinMigracion, setSinMigracion] = useState(false);
  const [datos, setDatos] = useState<Recibo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [envio, setEnvio] = useState("");
  const [enviados, setEnviados] = useState<Record<string, string>>({});
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null);
    traerRecibos(sociedadId).then((d) => { if (vivo) setDatos(d); })
      .catch((e) => {
        if (!vivo) return;
        if (e?.message === SIN_MIGRACION_RECIBOS) { setSinMigracion(true); return; }
        console.error("Finanzas Lazza · Recibos:", e); setError("No se pudieron cargar los recibos. Recargá la página.");
      });
    return () => { vivo = false; };
  }, [sociedadId, recarga]);
  const q = sinAcentos(texto.trim());
  // Arreglo 20 (27/10/2026): también por N° de cheque, con o sin los ceros de adelante.
  // Arreglo 25 (27/10/2026): "Enviado" como en OP; el que se acaba de mandar se marca sin recargar.
  const coinciden = useMemo(() => (datos || []).map((r) => (enviados[r.id] ? { ...r, enviado: enviados[r.id] } : r))
    .filter((r) => (!envio || (envio === "si") === !!r.enviado)
      && (!q || sinAcentos(`${r.numero} ${r.cliente} ${r.facturas.join(" ")} ${resumenMedios(r)}`).includes(q) || coincideNumeroCheque(r.cheques, texto))), [datos, enviados, envio, q, texto]);
  const visibles = useMemo(() => coinciden.filter((r) => enRango(r.fecha, desde, hasta)), [coinciden, desde, hasta]);
  if (sinMigracion) return (
    <div className="space-y-2">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Los recibos numerados todavía no están activos (falta correr la migración 20261019210000). Por ahora se ve 1 renglón por movimiento.</p>
      <RecibosPorMovimiento sociedadId={sociedadId} />
    </div>
  );
  const pdf = (r: Recibo, ver: boolean) => { if (sociedadActiva) abrirRecibo(r, sociedadActiva, ver); };
  const cols: Column<Recibo>[] = [
    { key: "numero", label: "N°", sortable: true, sortValue: (r) => r.numero, render: (r) => <span className={`font-mono text-xs ${r.anulado ? "text-zinc-400 line-through" : ""}`}>{r.numero}</span> },
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (r) => r.fecha, render: (r) => formatDate(r.fecha) },
    { key: "cliente", label: "Cliente", sortable: true, sortValue: (r) => r.cliente, render: (r) => <span className={r.anulado ? "text-zinc-400 line-through" : ""}>{r.cliente}</span> },
    { key: "medios", label: "Medios", sortable: true, sortValue: (r) => resumenMedios(r), render: (r) => <span className="text-xs">{resumenMedios(r) || "—"}</span> },
    { key: "facturas", label: "Facturas", sortable: true, sortValue: (r) => r.facturas.join(" "), render: (r) => <span className="font-mono text-[11px] text-zinc-500">{r.facturas.join(", ") || "—"}</span> },
    { key: "total", label: "Importe", sortable: true, sortValue: (r) => r.total.ARS + r.total.USD * 1000, className: "text-right", render: (r) => (
      <span className={`whitespace-nowrap font-mono font-semibold ${r.anulado ? "text-zinc-400 line-through" : "text-emerald-700 dark:text-emerald-400"}`}>{textoTotalRecibo(r.total, (v, m) => formatCurrency(v, m))}</span>
    ) },
    { key: "estado", label: "Banco", sortable: true, sortValue: (r) => (r.anulado ? 0 : ORDEN_BANCO[r.banco]), render: (r) => <EstadoBanco anulado={r.anulado} banco={r.banco} /> },
    { key: "enviado", label: "Enviado", sortable: true, sortValue: (r) => r.enviado || "", render: (r) => (r.enviado
      ? <span className="whitespace-nowrap text-xs text-emerald-600" title={r.enviadoA ? `A ${r.enviadoA}` : undefined}>✓ {formatDate(r.enviado)}</span>
      : <span className="text-xs text-zinc-400">—</span>) },
    { key: "acciones", label: "", render: (r) => (
      <span className="flex justify-end gap-0.5">
        <button type="button" title="Ver el recibo (se abre en otra pestaña, sin descargar)" onClick={(e) => { e.stopPropagation(); pdf(r, true); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Eye className="h-3.5 w-3.5" /></button>
        <button type="button" title="Descargar el recibo" onClick={(e) => { e.stopPropagation(); pdf(r, false); }}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-orange-600 dark:hover:bg-zinc-800"><Download className="h-3.5 w-3.5" /></button>
        <button type="button" title={r.enviado ? `Enviado el ${formatDate(r.enviado)}: mandarlo otra vez` : "Mandar el recibo por mail al cliente"} onClick={(e) => { e.stopPropagation(); setEnviando(r); }}
          className={`rounded p-1.5 hover:bg-orange-50 dark:hover:bg-zinc-800 ${r.enviado ? "text-emerald-600" : "text-zinc-500 hover:text-orange-600"}`}>{r.enviado ? <MailCheck className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}</button>
      </span>
    ) },
  ];
  const cobrado = visibles.filter((r) => !r.anulado).reduce((t, r) => ({ ARS: t.ARS + r.total.ARS, USD: t.USD + r.total.USD }), { ARS: 0, USD: 0 });
  return (
    <>
      <Marco error={error} cargando={!datos} filtros={<>
        <button type="button" onClick={() => setCobrando(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700">
          <HandCoins className="h-4 w-4" /> Nuevo cobro
        </button>
        <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar N°, cliente, factura, medio o N° de cheque" />
        <select value={envio} onChange={(e) => setEnvio(e.target.value)} className={control}><option value="">Enviados y no</option><option value="si">Enviados por mail</option><option value="no">No enviados</option></select>
        <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} conTodas />
      </>} pie={<><span>{visibles.length} recibos</span><span>Cobrado <b className="font-mono text-emerald-700 dark:text-emerald-400">{textoTotalRecibo(cobrado, (v, m) => formatCurrency(v, m))}</b></span></>}>
        <FueraDeFechas cantidad={q ? coinciden.length - visibles.length : 0} texto={texto} ver={() => { setDesde(""); setHasta(""); }} />
        <DataTable columns={cols} data={visibles} emptyMessage="No hay recibos con ese filtro" />
      </Marco>
      {cobrando && <CobrarCliente sociedadId={sociedadId} onClose={() => setCobrando(false)} onCobrado={() => setRecarga((n) => n + 1)} />}
      <EnviarRecibo recibo={enviando} onClose={() => setEnviando(null)} onEnviado={(id, fecha) => setEnviados((e) => ({ ...e, [id]: fecha }))} />
    </>
  );
}

const CLASE_LABEL: Record<ClaseMovimiento, string> = { ingreso: "Cobro / ingreso", egreso: "Pago / egreso", retencion_sufrida: "Retención sufrida", ajuste: "Ajuste", neutro: "Otro" };

export function FinanzasLazzaMovimientos({ sociedadId }: { sociedadId: string }) {
  const [recarga, setRecarga] = useState(0);
  const [nuevo, setNuevo] = useState(false);
  const { datos, error } = useCarga(() => traerMovimientos(sociedadId), [sociedadId, recarga]);
  const [texto, setTexto] = useState("");
  const [clase, setClase] = useState<"" | ClaseMovimiento | "anulados">("");
  const [conciliado, setConciliado] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const q = sinAcentos(texto.trim());
  const visibles = useMemo(() => (datos || []).filter((m) =>
    enRango(m.fecha, desde, hasta)
    && (!clase || (clase === "anulados" ? m.anulado : m.clase === clase))
    && (!conciliado || (conciliado === "si") === m.conciliado)
    && (!q || sinAcentos(`${m.nombre} ${m.descripcion} ${TIPO_LABEL[m.tipo] || m.tipo}`).includes(q))), [datos, desde, hasta, clase, conciliado, q]);
  const cols: Column<Mov>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (m) => m.fecha, render: (m) => formatDate(m.fecha) },
    { key: "tipo", label: "Tipo", sortable: true, sortValue: (m) => m.tipo, render: (m) => <span className="text-xs">{TIPO_LABEL[m.tipo] || m.tipo}</span> },
    { key: "descripcion", label: "Descripción", sortable: true, sortValue: (m) => m.descripcion, render: (m) => {
      const [principal, ...resto] = m.descripcion.split(" — ");
      return (
        <span className={m.anulado ? "text-zinc-400 line-through" : ""}>
          {principal || "—"}
          {resto.length > 0 && <span className="block text-[11px] text-zinc-400">{resto.join(" — ")}</span>}
          <span className="block text-[11px] text-zinc-400">{[m.nombre, m.facturaVenta ? "Factura de venta vinculada" : "", m.facturaCompra ? "Factura de compra vinculada" : ""].filter(Boolean).join(" · ")}</span>
        </span>
      );
    } },
    { key: "monto", label: "Monto", sortable: true, sortValue: (m) => m.monto, className: "text-right", render: (m) => {
      if (m.anulado) return <span className="whitespace-nowrap font-mono text-zinc-400 line-through">{formatCurrency(m.montoOriginal ?? m.monto, m.moneda)}</span>;
      const entra = m.clase === "ingreso" || m.clase === "retencion_sufrida";
      const sale = m.clase === "egreso";
      return <span className={`whitespace-nowrap font-mono ${entra ? "text-emerald-700 dark:text-emerald-400" : sale ? "text-red-600" : ""}`}>{entra ? "+" : sale ? "−" : ""}{formatCurrency(m.monto, m.moneda)}</span>;
    } },
    { key: "estado", label: "Estado", sortable: true, sortValue: (m) => (m.anulado ? 0 : ORDEN_BANCO[bancoDeMov(m)]), render: (m) => <EstadoBanco anulado={m.anulado} banco={bancoDeMov(m)} /> },
  ];
  return (
    <>
    <Marco error={error} cargando={!datos} filtros={<>
      <button type="button" onClick={() => setNuevo(true)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-500 px-3 text-sm font-medium text-white hover:bg-orange-600">
        <Plus className="h-4 w-4" /> Nuevo movimiento
      </button>
      <Buscador valor={texto} cambiar={setTexto} placeholder="Buscar descripción, cliente o proveedor" />
      <select value={clase} onChange={(e) => setClase(e.target.value as typeof clase)} className={control}>
        <option value="">Todos los tipos</option>
        {(["ingreso", "egreso", "retencion_sufrida", "ajuste", "neutro"] as ClaseMovimiento[]).map((c) => <option key={c} value={c}>{CLASE_LABEL[c]}</option>)}
        <option value="anulados">Anulados</option>
      </select>
      <select value={conciliado} onChange={(e) => setConciliado(e.target.value)} className={control}><option value="">Conciliados y no</option><option value="si">Conciliados</option><option value="no">Sin conciliar</option></select>
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
    </>} pie={<span>{visibles.length} movimientos · lo anulado queda tachado</span>}>
      <DataTable columns={cols} data={visibles} emptyMessage="No hay movimientos con ese filtro" />
    </Marco>
    <NuevoMovimiento sociedadId={sociedadId} abierto={nuevo} onClose={() => setNuevo(false)} onGuardado={() => setRecarga((r) => r + 1)} />
    </>
  );
}

// ── Retenciones ─────────────────────────────────────────────────────

const REGIMEN_TEXTO: Record<string, string> = { "078": "Bienes", "094": "Servicios", "095": "Transporte", "116": "Honorarios", "031": "Alquiler inmuebles", "030": "Alquiler muebles", "019": "Intereses", "021": "Intereses", "025": "Comisiones" };

/**
 * Exportar las retenciones de Ganancias practicadas (lo que se presenta en SICORE) del rango de fechas:
 * TXT con el formato de importación de SICORE (/api/sicore, el mismo de Finanzas) y Excel con esos mismos renglones.
 * Antes del TXT, un control que solo avisa (auditoría UX 26/10/2026, arreglo 13): proveedores sin concepto y
 * retenciones calculadas con otro régimen, % o mínimo que el del concepto de hoy. Desde la mejora H las OP anotan con qué
 * régimen se calcularon y así van al TXT; las de antes, con el de hoy. "Bajar el TXT igual" lo baja sin cambios.
 */
function ExportarSicore({ sociedadId, desde, hasta }: { sociedadId: string; desde: string; hasta: string }) {
  const [bajando, setBajando] = useState<"" | "txt" | "excel">("");
  const [avisos, setAvisos] = useState<AvisosSicore | null>(null);
  const bajar = async (formato: "txt" | "excel", revisado = false) => {
    if (!desde) { alert("Elegí la fecha desde."); return; }
    const h = hasta || todayAR();
    setBajando(formato);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const pedir = (json: boolean) => fetch(`/api/sicore?desde=${desde}&hasta=${h}&sociedad_id=${sociedadId}${json ? "&formato=json" : ""}`,
        { headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {} });
      if (formato === "txt" && !revisado) {
        const c = await pedir(true);
        if (!c.ok) { const j = await c.json().catch(() => ({})); alert(j.error || "No se pudo armar el archivo."); return; }
        const { avisos: a } = await c.json() as { avisos?: AvisosSicore };
        if (a && (a.distintos.length > 0 || a.sinConcepto.length > 0)) { setAvisos(a); return; }
      }
      const r = await pedir(formato === "excel");
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "No se pudo armar el archivo."); return; }
      const nombre = `Retenciones SICORE ${desde} a ${h}`;
      if (formato === "txt") {
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement("a"); a.href = url; a.download = `${nombre}.txt`; a.click(); URL.revokeObjectURL(url);
        return;
      }
      const { filas } = await r.json() as { filas: { fecha: string; comprobante: string; proveedor: string; cuit: string; regimen: string; importe: number; base: number; pct: number; retencion: number }[] };
      const XLSX: any = await import("xlsx");
      const datos = filas.map((f) => ({
        Fecha: formatDate(f.fecha), Comprobante: f.comprobante, Proveedor: f.proveedor, CUIT: f.cuit,
        "Régimen": `${Number(f.regimen)} ${REGIMEN_TEXTO[f.regimen] || ""}`.trim(), "Importe OP": f.importe, "Base": f.base, "%": f.pct, "Retención": f.retencion,
      }));
      datos.push({ Fecha: "", Comprobante: "", Proveedor: "TOTAL", CUIT: "", "Régimen": "", "Importe OP": filas.reduce((s, f) => s + f.importe, 0), "Base": filas.reduce((s, f) => s + f.base, 0), "%": "" as any, "Retención": Math.round(filas.reduce((s, f) => s + f.retencion, 0) * 100) / 100 });
      const ws = XLSX.utils.json_to_sheet(datos);
      ws["!cols"] = [{ wch: 11 }, { wch: 12 }, { wch: 40 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 5 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Retenciones");
      XLSX.writeFile(wb, `${nombre}.xlsx`);
    } catch (e) {
      console.error("SICORE:", e); alert("No se pudo armar el archivo. Probá de nuevo.");
    } finally { setBajando(""); }
  };
  const boton = "flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50";
  // Solo lo que no coincide: "al 2 % con mínimo $ 224.000,00".
  const como = (d: AvisosSicore["distintos"][number], pct: number, minimo: number | null) =>
    [d.difPct ? `al ${pctTexto(pct)}` : "", d.difMinimo && minimo !== null ? `con mínimo ${formatCurrency(minimo, "ARS")}` : ""].filter(Boolean).join(" ");
  const regimenTxt = (r: string) => `${REGIMEN_TEXTO[r] || "otro concepto"} (régimen ${Number(r)})`;
  return (
    <>
      <button type="button" disabled={!!bajando} onClick={() => void bajar("txt")} title="Retenciones de Ganancias practicadas del rango, en el formato para importar en SICORE"
        className={`${boton} border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300`}>
        {bajando === "txt" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} TXT SICORE
      </button>
      <button type="button" disabled={!!bajando} onClick={() => void bajar("excel")} title="Los mismos renglones del TXT, en Excel"
        className={`${boton} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>
        {bajando === "excel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Excel
      </button>
      <Modal open={!!avisos} onClose={() => setAvisos(null)} title="Antes de bajar el TXT SICORE" size="lg"
        footer={<>
          <button type="button" onClick={() => setAvisos(null)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700">Cancelar</button>
          <button type="button" onClick={() => { setAvisos(null); void bajar("txt", true); }} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600">Bajar el TXT igual</button>
        </>}>
        {avisos && <div className="space-y-4 text-sm">
          {avisos.distintos.length > 0 && <div>
            <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {avisos.distintos.length === 1 ? "1 retención se calculó" : `${avisos.distintos.length} retenciones se calcularon`} con otro concepto que el que el proveedor tiene hoy
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">Cada una dice con qué régimen va en el TXT. Miralo con el contador antes de presentar.</p>
            <ul className="mt-2 space-y-1.5">
              {avisos.distintos.map((d, i) => (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                  <b>{d.comprobante}</b> · {d.proveedor} · {formatDate(d.fecha)}: {d.congelada
                    ? <>se calculó como {regimenTxt(d.regimen)} {como(d, d.pct, d.minimo)}; hoy el proveedor está como {regimenTxt(d.regimenHoy)}{d.difPct || d.difMinimo ? <>, que corresponde {como(d, d.pctHoy, d.minimoHoy)}</> : null}. <b>Va al TXT como se calculó: régimen {Number(d.regimen)}.</b></>
                    : <>se retuvo {como(d, d.pct, d.minimo)}; hoy está como {regimenTxt(d.regimenHoy)}, que corresponde {como(d, d.pctHoy, d.minimoHoy)}. <b>Va al TXT con el de hoy: régimen {Number(d.regimenHoy)}.</b></>}
                </li>
              ))}
            </ul>
          </div>}
          {avisos.sinConcepto.length > 0 && <div>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">
              {avisos.sinConcepto.length === 1 ? "1 proveedor sin concepto" : `${avisos.sinConcepto.length} proveedores sin concepto`} de Ganancias: se calcularon como bienes y van como régimen 78
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">Si alguno no vende bienes (servicios, transporte, alquiler), miralo con el contador y cargale el concepto con «Sin concepto» (al lado del TXT) para las próximas OP.</p>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{avisos.sinConcepto.map((p) => `${p.proveedor} (${formatCurrency(p.retenido, "ARS")})`).join(" · ")}</p>
          </div>}
          <p className="text-xs text-zinc-500">Es solo un aviso: el TXT sale igual, sin cambios.</p>
        </div>}
      </Modal>
    </>
  );
}

type FilaSinConcepto = { id: string; nombre: string; cuit: string; ultimoPago: string | null; impagas: number; sugerencia: SugerenciaConcepto };
const OPCIONES_CONCEPTO = Object.entries(CONCEPTOS_RG830).map(([value, label]) => ({ value, label }));
const GRILLA_SIN_CONCEPTO = "sm:grid-cols-[minmax(0,1.3fr)_5.5rem_minmax(0,1.6fr)_12rem_auto] sm:gap-3";

/** Inscriptos activos sin concepto de Ganancias a los que se les paga ahora: OP desde el 1° del mes anterior o facturas sin pagar. */
async function cargarSinConcepto(sociedadId: string): Promise<FilaSinConcepto[]> {
  const [provs, ops, impagas] = await Promise.all([
    traerTodo<any>(() => db.from("proveedores").select("id, razon_social, cuit, condicion_iva, activo, es_transportista, concepto_retencion_ganancias")
      .eq("sociedad_id", sociedadId).order("id")),
    traerTodo<any>(() => db.from("ordenes_pago").select("id, proveedor_id, fecha")
      .eq("sociedad_id", sociedadId).neq("estado", "anulada").gte("fecha", desdeSinConcepto(todayAR())).order("id")),
    traerTodo<any>(() => db.from("facturas_compra").select("id, proveedor_id")
      .eq("sociedad_id", sociedadId).not("estado", "in", "(pagada,anulada)").order("id")),
  ]);
  const ultimo = new Map<string, string>();
  for (const o of ops) if (o.proveedor_id && String(o.fecha) > (ultimo.get(o.proveedor_id) || "")) ultimo.set(o.proveedor_id, String(o.fecha).slice(0, 10));
  const sinPagar = new Map<string, number>();
  for (const f of impagas) if (f.proveedor_id) sinPagar.set(f.proveedor_id, (sinPagar.get(f.proveedor_id) || 0) + 1);
  const candidatos = provs.filter((p) => p.activo !== false && isResponsableInscripto(p.condicion_iva)
    && !String(p.concepto_retencion_ganancias || "").trim() && (ultimo.has(p.id) || sinPagar.has(p.id)));
  // Lo que les compramos: los renglones de sus facturas de compra («Factura de transporte» cuenta como un renglón de transporte).
  const ids = candidatos.map((p) => p.id);
  const facturas: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("facturas_compra").select("id, proveedor_id, notas").eq("sociedad_id", sociedadId).in("proveedor_id", ids.slice(i, i + 200));
    if (error) throw error;
    facturas.push(...(data || []));
  }
  const renglones = new Map<string, string[]>();
  const agregar = (proveedorId: string, texto: string) => renglones.set(proveedorId, [...(renglones.get(proveedorId) || []), texto]);
  for (const f of facturas) if (/^Factura de transporte/i.test(String(f.notas || ""))) agregar(f.proveedor_id, "Factura de transporte");
  const proveedorDe = new Map(facturas.map((f) => [f.id, f.proveedor_id as string]));
  const fIds = facturas.map((f) => f.id);
  for (let i = 0; i < fIds.length; i += 200) {
    const { data, error } = await db.from("facturas_compra_items").select("factura_compra_id, descripcion").eq("sociedad_id", sociedadId).in("factura_compra_id", fIds.slice(i, i + 200));
    if (error) throw error;
    for (const it of data || []) { const p = proveedorDe.get(it.factura_compra_id); if (p) agregar(p, String(it.descripcion || "")); }
  }
  return candidatos.map((p) => ({
    id: p.id, nombre: p.razon_social || "—", cuit: String(p.cuit || ""), ultimoPago: ultimo.get(p.id) || null, impagas: sinPagar.get(p.id) || 0,
    sugerencia: sugerirConcepto({ esTransportista: p.es_transportista, renglones: renglones.get(p.id) || [] }),
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Proveedores sin concepto de Ganancias (mejora H de la auditoría de Impuestos, 27/10/2026): sin concepto se calculan
 * como bienes. Sugiere el concepto por lo que les compramos (lib/sugerir-concepto.ts) y nada se guarda solo: «Confirmar»
 * guarda el concepto y la alícuota como la ficha del proveedor. Vale para las próximas OP; las hechas quedan como se calcularon.
 */
function SinConceptoGanancias({ sociedadId }: { sociedadId: string }) {
  const { datos, error } = useCarga<FilaSinConcepto[]>(() => cargarSinConcepto(sociedadId), [sociedadId]);
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const filas = (datos || []).filter((f) => !hechos.has(f.id));
  const concepto = (f: FilaSinConcepto) => elegido[f.id] ?? f.sugerencia.concepto ?? "";
  const conConcepto = filas.filter((f) => concepto(f));
  const confirmar = async (lista: FilaSinConcepto[]) => {
    const porConcepto = new Map<string, string[]>();
    for (const f of lista) { const c = concepto(f); if (c) porConcepto.set(c, [...(porConcepto.get(c) || []), f.id]); }
    if (!porConcepto.size) return;
    setGuardando(true);
    try {
      for (const [c, ids] of porConcepto) {
        const { error: e } = await db.from("proveedores").update({ concepto_retencion_ganancias: c, alicuota_ganancias: ALICUOTA_POR_CONCEPTO[c] ?? 2 })
          .eq("sociedad_id", sociedadId).in("id", ids);
        if (e) throw e;
        setHechos((h) => new Set([...h, ...ids]));
      }
    } catch (e: any) {
      alert(`No se pudo guardar el concepto: ${e?.message || e}. Probá de nuevo.`);
    } finally { setGuardando(false); }
  };
  if (error) return <span className="text-xs text-amber-600" title={error}>Sin concepto: no se pudo cargar</span>;
  if (!filas.length) return null;
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} title="Inscriptos a los que se les paga y no tienen concepto de Ganancias: se calculan como bienes"
        className="flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3" /> Sin concepto ({filas.length})
      </button>
      <Modal open={abierto} onClose={() => setAbierto(false)} size="xl" title={`Proveedores sin concepto de Ganancias (${filas.length})`}
        description={`Inscriptos con OP desde el ${formatDate(desdeSinConcepto(todayAR()))} o facturas sin pagar. Sin concepto se calculan como bienes. «Confirmar» guarda el concepto y la alícuota como la ficha del proveedor: vale para las próximas OP; las hechas quedan como se calcularon.`}
        footer={<>
          <button type="button" onClick={() => setAbierto(false)} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700">Cerrar</button>
          <button type="button" disabled={guardando || !conConcepto.length}
            onClick={() => { if (confirm(`Se guarda el concepto elegido en ${conConcepto.length} proveedores${filas.length > conConcepto.length ? ` (${filas.length - conConcepto.length} sin sugerencia quedan para elegir)` : ""}. ¿Seguimos?`)) void confirmar(conConcepto); }}
            className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirmar todos ({conConcepto.length})
          </button>
        </>}>
        {/* Renglones en grilla: en pantallas angostas se apilan (proveedor, lo que le compramos, concepto y Confirmar). */}
        <div className={`hidden pb-1 text-xs text-zinc-500 sm:grid ${GRILLA_SIN_CONCEPTO}`}><span>Proveedor</span><span>Último pago</span><span>Lo que le compramos</span><span>Concepto</span><span /></div>
        <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
          {filas.map((f) => (
            <li key={f.id} className={`grid gap-1 py-2 sm:items-center ${GRILLA_SIN_CONCEPTO}`}>
              <div className="min-w-0"><span className="font-medium text-zinc-800 dark:text-zinc-200">{f.nombre}</span><span className="block text-[10px] text-zinc-400">CUIT {f.cuit}</span></div>
              <div className="whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                <span className="sm:hidden">Último pago: </span>{f.ultimoPago ? formatDate(f.ultimoPago) : `${f.impagas} sin pagar`}
              </div>
              <div className="min-w-0 text-zinc-600 dark:text-zinc-300">{f.sugerencia.concepto ? f.sugerencia.motivo : <span className="text-amber-600 dark:text-amber-400">{f.sugerencia.motivo}: elegí a mano</span>}</div>
              <div className="flex items-center gap-2 sm:contents">
                <div className="min-w-0 flex-1"><Select value={concepto(f)} onChange={(e) => setElegido((x) => ({ ...x, [f.id]: e.target.value }))} placeholder="Elegí…" options={OPCIONES_CONCEPTO} className="px-2 py-1 text-xs" /></div>
                <button type="button" disabled={guardando || !concepto(f)} onClick={() => void confirmar([f])}
                  className="shrink-0 rounded-lg border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30">Confirmar</button>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1] || ""} ${p.slice(0, 4)}`;
const TITULO_TRAMO: Record<TramoQuincena["cual"], string> = {
  primera: "Pago a cuenta de la 1ª quincena. El SICORE se presenta con el mes entero.",
  segunda: "Del 16 a fin de mes.",
  mes: "El mes entero: lo que se presenta en el SICORE.",
};

/**
 * Practicadas por quincena (auditoría UX 26/10/2026, arreglo 15): el mes de "Desde" con la 1ª quincena (pago a cuenta),
 * la 2ª y el mes entero (lo del SICORE). Tocar una deja la lista, el TXT y el Excel en esas fechas; ‹ › cambia de mes.
 */
function QuincenasPracticadas({ filas, desde, hasta, elegir }: { filas: FilaRetencion[]; desde: string; hasta: string; elegir: (r: { desde: string; hasta: string }) => void }) {
  const hoy = todayAR();
  const mesActual = periodoDeFecha(hoy);
  const mes = periodoDeFecha(desde) || mesActual;
  // Sin "Hasta" llega a hoy: en el mes en curso eso es el mes (o la 2ª quincena) entero.
  const activo = (t: TramoQuincena) => desde === t.desde && (hasta === t.hasta || (!hasta && t.hasta >= hoy));
  const flecha = "rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-700">
      <span className="flex items-center gap-0.5">
        <button type="button" aria-label="Mes anterior" onClick={() => elegir(rangoQuincena(sumarMeses(mes, -1), "mes"))} className={flecha}><ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="min-w-[6.5rem] text-center font-medium capitalize text-zinc-700 dark:text-zinc-200">{nombreMes(mes)}</span>
        <button type="button" aria-label="Mes siguiente" disabled={mes >= mesActual} onClick={() => elegir(rangoQuincena(sumarMeses(mes, 1), "mes"))} className={flecha}><ChevronRight className="h-3.5 w-3.5" /></button>
      </span>
      {practicadasPorQuincena(filas, mes).map((t) => (
        <button key={t.cual} type="button" onClick={() => elegir(t)} title={`${TITULO_TRAMO[t.cual]} ${t.cantidad} ${t.cantidad === 1 ? "retención" : "retenciones"}.`}
          className={`rounded-md px-2 py-0.5 ${activo(t) ? "bg-orange-50 font-medium text-orange-700 ring-1 ring-orange-300 dark:bg-orange-950/30 dark:text-orange-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
          {t.cual === "mes" ? "Mes" : `${t.cual === "primera" ? "1ª" : "2ª"} quincena (${Number(t.desde.slice(8))} al ${Number(t.hasta.slice(8))})`}{" "}
          <b className="font-mono">{formatCurrency(t.total.ARS)}{Math.abs(t.total.USD) >= 0.01 && <> + {formatCurrency(t.total.USD, "USD")}</>}</b>
        </button>
      ))}
    </div>
  );
}

/**
 * Retenciones practicadas (las de nuestras OP, van al TXT SICORE) y sufridas (las que nos hicieron los clientes).
 * Sufridas (auditoría UX 26/10/2026, arreglo 14): N° de certificado o "falta" (se lee del texto: `certificadoDeRetencion`)
 * con el filtro "Falta certificado", el recibo como origen (abre su PDF), totales por impuesto y Excel para el contador.
 * 27/10: «Cargar certificado (IA)» y el N° a mano o «Quitar» en la columna (cargar-certificado.tsx); el N° cargado vale
 * antes que el del texto.
 * Practicadas (arreglo 15): arriba, las quincenas del mes (QuincenasPracticadas).
 */
export function FinanzasLazzaRetenciones({ sociedadId }: { sociedadId: string }) {
  const { sociedadActiva, sociedades } = useUser();
  const [recarga, setRecarga] = useState(0);
  const { datos, error } = useCarga<FilaRetencion[]>(async () => {
    const [ops, movs, certificados] = await Promise.all([
      traerTodo<any>(() => db.from("ordenes_pago").select("id, numero, fecha, estado, moneda, retencion_ganancias_monto, retencion_ganancias_pct, base_retencion_ganancias, proveedores(razon_social, cuit)")
        .eq("sociedad_id", sociedadId).gt("retencion_ganancias_monto", 0).order("id")),
      traerTodo<any>(() => db.from("movimientos").select("id, tipo, fecha, monto, moneda, anulado, descripcion, cliente_id, proveedor_id, retencion_ganancias_monto, retencion_ganancias_pct, base_retencion_ganancias, clientes(razon_social, cuit), proveedores(razon_social, cuit)")
        .eq("sociedad_id", sociedadId).or("tipo.in.(retencion_iva,retencion_ganancias,retencion_iibb,retencion_suss),retencion_ganancias_monto.gt.0").order("id")),
      traerCertificadosCargados(sociedadId),
    ]);
    // Recibo de cada retención sufrida, para el origen (si falla, quedan sin recibo y se ve el texto al pasar el mouse).
    const ids = movs.filter((m) => String(m.tipo || "").startsWith("retencion_") && m.cliente_id).map((m) => m.id);
    const recibos: Record<string, { id: string; numero: number }> = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("recibo_movimientos").select("movimiento_id, recibos(id, numero)").in("movimiento_id", ids.slice(i, i + 200));
      for (const r of data || []) if (r.recibos?.numero) recibos[r.movimiento_id] = { id: r.recibos.id, numero: r.recibos.numero };
    }
    return armarRetenciones({ ops, movimientos: movs, recibos, certificados });
  }, [sociedadId, recarga]);
  const recargar = () => setRecarga((n) => n + 1);
  // Para «Cargar certificado»: todas las sufridas (sin el filtro de fechas) y de qué sociedad es cada CUIT.
  const todasSufridas = useMemo(() => (datos || []).filter((r) => r.lado === "sufrida"), [datos]);
  const sociedadCert = useMemo(() => ({ cuit: sociedadActiva?.cuit || "", otras: sociedades.filter((s) => s.id !== sociedadId).map((s) => ({ nombre: s.nombre, cuit: s.cuit })) }), [sociedadActiva, sociedades, sociedadId]);
  const [lado, setLado] = useState<"practicada" | "sufrida">("practicada");
  const [soloFalta, setSoloFalta] = useState(false);
  const [texto, setTexto] = useState("");
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState("");
  const sufridas = lado === "sufrida";
  const q = sinAcentos(texto.trim());
  const delLado = useMemo(() => (datos || []).filter((r) => r.lado === lado && enRango(r.fecha, desde, hasta)
    && (!q || sinAcentos(`${r.nombre} ${r.cuit} ${r.origen} ${r.impuesto} ${r.certificado || ""} ${r.detalle}`).includes(q))), [datos, lado, desde, hasta, q]);
  const faltan = useMemo(() => delLado.filter((r) => r.faltaCertificado), [delLado]);
  const visibles = sufridas && soloFalta ? faltan : delLado;
  const faltanVisibles = visibles.filter((r) => r.faltaCertificado);

  const verRecibo = async (r: FilaRetencion) => {
    if (!r.recibo || !sociedadActiva) return;
    const rec = await traerRecibo(sociedadId, r.recibo.id).catch(() => null);
    if (rec) abrirRecibo(rec, sociedadActiva, true);
    else alert("No se pudo abrir el recibo.");
  };
  const bajarExcel = async () => {
    const XLSX: any = await import("xlsx");
    const filas = excelRetencionesSufridas(visibles);
    const ws = XLSX.utils.aoa_to_sheet(filas);
    const anchos: Record<string, number> = { Fecha: 11, Impuesto: 16, Cliente: 36, CUIT: 16, Certificado: 16, Recibo: 8, Moneda: 8, Retenido: 14, "Detalle completo": 90 };
    ws["!cols"] = filas[0].map((h) => ({ wch: anchos[String(h)] || 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sufridas");
    XLSX.writeFile(wb, `Retenciones sufridas ${desde ? `${desde} a` : "hasta"} ${hasta || todayAR()}.xlsx`);
  };

  const cols: Column<FilaRetencion>[] = [
    { key: "fecha", label: "Fecha", sortable: true, sortValue: (r) => r.fecha, render: (r) => formatDate(r.fecha) },
    { key: "impuesto", label: "Impuesto", sortable: true, sortValue: (r) => r.impuesto },
    { key: "origen", label: "Origen", sortable: true, sortValue: (r) => r.origen, render: (r) => (r.recibo
      ? <button type="button" title={`${r.detalle}\n\nTocá para ver el recibo`} onClick={(e) => { e.stopPropagation(); void verRecibo(r); }}
          className="whitespace-nowrap text-xs text-zinc-700 underline decoration-dotted underline-offset-2 hover:text-orange-600 dark:text-zinc-300">{r.origen}</button>
      : <span className="text-xs" title={r.detalle || undefined}>{r.origen || "—"}</span>) },
    { key: "nombre", label: "Cliente / Proveedor", sortable: true, sortValue: (r) => r.nombre, render: (r) => <span>{r.nombre || "—"}{r.cuit && <span className="block text-[10px] text-zinc-400">CUIT {r.cuit}</span>}</span> },
    ...(sufridas ? [
      { key: "certificado", label: "Certificado", sortable: true, sortValue: (r) => r.certificado || "", render: (r) => <CeldaCertificado fila={r} sociedadId={sociedadId} onCambio={recargar} /> },
    ] as Column<FilaRetencion>[] : [
      { key: "base", label: "Base", sortable: true, sortValue: (r) => r.base ?? 0, className: "text-right", render: (r) => (r.base === null ? "—" : <span className="whitespace-nowrap font-mono">{formatCurrency(r.base, r.moneda)}</span>) },
      { key: "pct", label: "%", sortable: true, sortValue: (r) => r.pct ?? 0, className: "text-right", render: (r) => (r.pct === null ? "—" : `${r.pct}%`) },
    ] as Column<FilaRetencion>[]),
    { key: "monto", label: "Retenido", sortable: true, sortValue: (r) => r.monto, className: "text-right", render: (r) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(r.monto, r.moneda)}</span> },
  ];
  return (
    <Marco error={error} cargando={!datos} filtros={<>
      {([["practicada", "Practicadas"], ["sufrida", "Sufridas"]] as const).map(([k, l]) => (
        <button key={k} type="button" onClick={() => setLado(k)}
          className={`rounded-lg border px-3 py-1 text-xs font-medium ${lado === k ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-orange-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
          {l}
        </button>
      ))}
      {sufridas && (
        <button type="button" onClick={() => setSoloFalta((v) => !v)} title="Solo las que no tienen N° de certificado: sin el certificado no se pueden computar"
          className={`rounded-lg border px-3 py-1 text-xs font-medium ${soloFalta ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : "border-zinc-200 bg-white text-zinc-600 hover:border-amber-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
          Falta certificado ({faltan.length})
        </button>
      )}
      {sufridas && <CargarCertificado sociedadId={sociedadId} sufridas={todasSufridas} sociedad={sociedadCert} onGuardado={recargar} />}
      <Buscador valor={texto} cambiar={setTexto} placeholder={sufridas ? "Buscar cliente, CUIT, certificado o recibo" : "Buscar nombre, CUIT u OP"} />
      <Fechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      {sufridas ? (
        <button type="button" disabled={!visibles.length} onClick={() => void bajarExcel()} title="Las retenciones sufridas que se ven, para el contador: con el N° de certificado y el total por impuesto"
          className="flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Download className="h-3 w-3" /> Excel
        </button>
      ) : <><ExportarSicore sociedadId={sociedadId} desde={desde} hasta={hasta} /><SinConceptoGanancias sociedadId={sociedadId} /></>}
    </>} pie={sufridas ? <>
      <span>{visibles.length} retenciones</span>
      {totalesRetenciones(visibles).map((t) => <span key={`${t.impuesto}-${t.moneda}`}>{t.impuesto} <b className="font-mono">{formatCurrency(t.monto, t.moneda)}</b></span>)}
      <span>Total <b className="font-mono">{sumar(visibles, (r) => r.monto, (r) => r.moneda)}</b></span>
      {faltanVisibles.length > 0 && <span className="text-amber-700 dark:text-amber-400">Falta certificado <b className="font-mono">{sumar(faltanVisibles, (r) => r.monto, (r) => r.moneda)}</b> ({faltanVisibles.length})</span>}
    </> : <>
      <span>{visibles.length} retenciones</span>
      <span>Practicadas <b className="font-mono">{sumar(visibles, (r) => r.monto, (r) => r.moneda)}</b></span>
    </>}>
      {!sufridas && datos && <QuincenasPracticadas filas={datos} desde={desde} hasta={hasta} elegir={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />}
      <DataTable columns={cols} data={visibles} emptyMessage="No hay retenciones con ese filtro" />
    </Marco>
  );
}
