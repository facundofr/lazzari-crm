"use client";

// Finanzas Lazza → Facturas → "Facturar" (Augusto 20/10/2026): los PR aprobados que faltan facturar, "Listo" o "Esperando OC",
// con la misma regla que Ventas → "Para facturar" (lib/ventas-etapas.ts). Columnas: Fecha P/Fact (OC o aprobación) · N° PR ·
// Cliente · Detalle (como en Presupuestos) · Sucursal · Neto · Total · Estado. "Facturar" abre la MISMA ventana de Ventas
// (EmitirFacturaModal); "Esperando OC" es un aviso, se puede facturar igual.
// Restos (26/10/2026): lo que quedó sin facturar de un PR (renglones sacados o cantidades menores) sale como renglón propio
// "PR-… · resto" con Facturar y No facturar (tabla presupuesto_restos_facturar, lib/resto-facturar.ts).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Receipt, Search, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmitirFacturaModal, type PresupuestoAFacturar } from "@/components/facturacion/emitir-factura-modal";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useArcaStatus } from "@/lib/use-arca-status";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { comprobanteVenta } from "@/lib/finanzas-lazza";
import { esNotaCredito } from "@/lib/ventas-documentos";
import { detalleDePr, enBandeja, etapaVenta, fechaParaFacturar } from "@/lib/ventas-etapas";
import { detalleResto } from "@/lib/resto-facturar";

const db = supabase as any;
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

interface FilaFacturar {
  id: string;
  fechaPFact: string;
  numero: string;
  cliente: string;
  ocCliente: string;
  detalle: { texto: string; completo: string };
  sucursal: string;
  moneda: "ARS" | "USD";
  neto: number;
  total: number;
  esperandoOc: boolean;
  refacturar: boolean;
  /** Si la factura se anuló con NC: el número de esa NC (para el estado "Anulada por NC …"). */
  ncAnula: string | null;
  /** Resto pendiente de un PR ya facturado: su id (la fila es el resto, no el PR entero). */
  restoId: string | null;
  presupuesto: PresupuestoAFacturar;
}

/** NC que anulan cada factura: por factura_origen_id y por nota_credito_venta_aplicaciones (NC de varias facturas). Si falla, queda vacío. */
async function ncDeFacturas(sociedadId: string, ids: string[]): Promise<Map<string, string>> {
  const nc = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const trozo = ids.slice(i, i + 200);
    const [directas, aplicadas] = await Promise.all([
      db.from("facturas").select("id, tipo, punto_venta, numero, factura_origen_id").eq("sociedad_id", sociedadId).in("factura_origen_id", trozo),
      db.from("nota_credito_venta_aplicaciones").select("nota_credito_id, factura_id").in("factura_id", trozo),
    ]);
    for (const f of directas.data || []) if (!nc.has(f.factura_origen_id)) nc.set(f.factura_origen_id, comprobanteVenta(f));
    const faltan = (aplicadas.data || []).filter((a: any) => !nc.has(a.factura_id));
    if (!faltan.length) continue;
    const { data } = await db.from("facturas").select("id, tipo, punto_venta, numero").in("id", [...new Set(faltan.map((a: any) => a.nota_credito_id))]);
    const porId = new Map<string, any>((data || []).map((f: any) => [f.id, f]));
    for (const a of faltan) { const f = porId.get(a.nota_credito_id); if (f && !nc.has(a.factura_id)) nc.set(a.factura_id, comprobanteVenta(f)); }
  }
  return nc;
}

const CAMPOS_PR = `
      id, numero, cliente_id, fecha, respondido_at, estado, subtotal, total, moneda, cotizacion_modalidad, modalidad_emision, oc_cliente, oc_cliente_fecha, archivo_url, observaciones,
      clientes(razon_social, cuit, condicion_iva, forma_pago, dias_cuenta_corriente, limite_credito, email, email_facturacion, pide_oc_para_facturar, moneda_predeterminada),
      sucursal:sucursal_id(nombre),
      presupuesto_items(id, descripcion, cantidad, precio_venta, iva_porcentaje, total, orden)`;

function presupuestoAFacturar(p: any, items: PresupuestoAFacturar["items"], restoId: string | null = null): PresupuestoAFacturar {
  return {
    id: p.id, numero: p.numero, cliente_id: p.cliente_id, moneda: p.moneda,
    cotizacion_modalidad: p.cotizacion_modalidad, modalidad_emision: p.modalidad_emision,
    oc_cliente: p.oc_cliente, oc_cliente_fecha: p.oc_cliente_fecha, archivo_url: p.archivo_url, observaciones: p.observaciones,
    cliente: p.clientes ? { ...p.clientes } : null,
    items, resto_id: restoId,
  };
}

/** Restos pendientes: cada uno es una fila con solo lo que falta facturar. Si falla, la lista sale sin restos. */
async function traerRestos(sociedadId: string): Promise<FilaFacturar[]> {
  const { data, error } = await db.from("presupuesto_restos_facturar").select(`id, created_at, moneda, items, subtotal, total, presupuesto:presupuesto_id(${CAMPOS_PR})`)
    .eq("sociedad_id", sociedadId).eq("estado", "pendiente");
  if (error) { console.error("Finanzas Lazza · Facturar (restos):", error.message); return []; }
  return (data || []).filter((r: any) => r.presupuesto).map((r: any) => {
    const p = r.presupuesto;
    const items = Array.isArray(r.items) ? r.items : [];
    const texto = detalleResto(items);
    return {
      id: r.id,
      fechaPFact: String(r.created_at || "").slice(0, 10),
      numero: p.numero,
      cliente: p.clientes?.razon_social || "",
      ocCliente: p.oc_cliente || "",
      detalle: { texto, completo: texto },
      sucursal: p.sucursal?.nombre || "",
      moneda: r.moneda === "USD" ? "USD" : "ARS",
      neto: Number(r.subtotal) || 0,
      total: Number(r.total) || 0,
      esperandoOc: false,
      refacturar: false,
      ncAnula: null,
      restoId: r.id,
      presupuesto: presupuestoAFacturar(p, items, r.id),
    };
  });
}

async function traerParaFacturar(sociedadId: string, hoy: string): Promise<FilaFacturar[]> {
  const restos = traerRestos(sociedadId);
  const prs = await traerTodo<any>(() => db.from("presupuestos").select(CAMPOS_PR)
    .in("estado", ["aprobado", "facturar", "facturado"]).neq("eliminado", true).eq("sociedad_id", sociedadId).order("id"));
  const ids = prs.map((p) => p.id);
  const facturas: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("facturas").select("id, tipo, estado, fecha, total, total_acreditado, moneda, fecha_vencimiento, presupuesto_id")
      .eq("sociedad_id", sociedadId).in("presupuesto_id", ids.slice(i, i + 200));
    if (error) throw error;
    facturas.push(...(data || []));
  }
  const filas: FilaFacturar[] = [];
  const anuladaDe = new Map<string, string>(); // PR → su última factura anulada
  for (const p of prs) {
    const e = etapaVenta({
      fechaPr: p.fecha, totalPr: Number(p.total) || 0, monedaPr: p.moneda, ocCliente: p.oc_cliente,
      clientePideOc: !!p.clientes?.pide_oc_para_facturar, facturas: facturas.filter((f) => f.presupuesto_id === p.id), remitos: [],
    }, null, hoy);
    if (!enBandeja(e, "facturar") && !enBandeja(e, "esperando_oc")) continue;
    if (e.refacturar) {
      const ultima = facturas.filter((f) => f.presupuesto_id === p.id && f.estado === "anulada" && !esNotaCredito(f.tipo))
        .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""))[0];
      if (ultima) anuladaDe.set(p.id, ultima.id);
    }
    const items = [...(p.presupuesto_items || [])].sort((a: any, b: any) => Number(a.orden || 0) - Number(b.orden || 0));
    filas.push({
      id: p.id,
      fechaPFact: fechaParaFacturar(p),
      numero: p.numero,
      cliente: p.clientes?.razon_social || "",
      ocCliente: p.oc_cliente || "",
      detalle: detalleDePr(items, p.observaciones),
      sucursal: p.sucursal?.nombre || "",
      moneda: p.moneda === "USD" ? "USD" : "ARS",
      neto: Number(p.subtotal) || 0,
      total: Number(p.total) || 0,
      esperandoOc: e.esperandoOc,
      refacturar: e.refacturar,
      ncAnula: null,
      restoId: null,
      presupuesto: presupuestoAFacturar(p, items),
    });
  }
  if (anuladaDe.size) {
    try {
      const nc = await ncDeFacturas(sociedadId, [...anuladaDe.values()]);
      for (const f of filas) { const id = anuladaDe.get(f.id); if (id) f.ncAnula = nc.get(id) || null; }
    } catch (e) { console.error("Finanzas Lazza · Facturar (NC):", e); }
  }
  filas.push(...await restos);
  return filas.sort((a, b) => a.fechaPFact.localeCompare(b.fechaPFact));
}

export function FinanzasLazzaFacturar({ sociedadId }: { sociedadId: string }) {
  const arcaStatus = useArcaStatus(sociedadId);
  const hoy = todayAR();
  const [filas, setFilas] = useState<FilaFacturar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [texto, setTexto] = useState("");
  const [emitir, setEmitir] = useState<FilaFacturar | null>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    traerParaFacturar(sociedadId, hoy)
      .then((f) => { if (vivo) setFilas(f); })
      .catch((e) => { console.error("Finanzas Lazza · Facturar:", e); if (vivo) setError("No se pudieron cargar los PR para facturar. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, recarga]);

  const visibles = useMemo(() => {
    const q = texto.toLowerCase().trim();
    if (!q) return filas || [];
    return (filas || []).filter((f) => [f.cliente, f.numero, f.ocCliente, f.sucursal, f.detalle.completo].some((t) => t.toLowerCase().includes(q)));
  }, [filas, texto]);

  const suma = useMemo(() => {
    const s = { ARS: { neto: 0, total: 0 }, USD: { neto: 0, total: 0 } };
    for (const f of visibles) { s[f.moneda].neto += f.neto; s[f.moneda].total += f.total; }
    return s;
  }, [visibles]);
  const plata = (k: "neto" | "total") => [suma.ARS[k] >= 0.01 ? formatCurrency(suma.ARS[k]) : null, suma.USD[k] >= 0.01 ? formatCurrency(suma.USD[k], "USD") : null].filter(Boolean).join(" + ") || "$ 0";

  const facturar = (f: FilaFacturar) => {
    if (f.esperandoOc && !confirm(`${f.cliente || "El cliente"} pide OC para facturar y este presupuesto todavía no la tiene.\n\n¿Facturar igual?`)) return;
    setEmitir(f);
  };

  // Igual que "No facturar" de Ventas: el PR pasa a «rechazado» y sale de la lista; la factura anulada y su NC quedan como están.
  const noFacturar = async (f: FilaFacturar) => {
    if (f.restoId) {
      if (!confirm(`¿No facturar el resto del ${f.numero}? (${f.detalle.texto})

Sale de esta lista; el PR y su factura quedan como están.`)) return;
      const { error } = await db.from("presupuesto_restos_facturar").update({ estado: "no_facturar", resuelto_at: new Date().toISOString() }).eq("id", f.restoId).eq("estado", "pendiente");
      if (error) { alert("No se pudo guardar: " + error.message); return; }
      setRecarga((n) => n + 1);
      return;
    }
    if (!confirm(`¿No facturar ${f.numero}? La factura anulada y su NC quedan como están, y el PR pasa a «rechazado» (sale de esta lista).`)) return;
    const { error } = await db.from("presupuestos").update({ estado: "rechazado" }).eq("id", f.id).eq("sociedad_id", sociedadId);
    if (error) { alert("No se pudo guardar: " + error.message); return; }
    setRecarga((n) => n + 1);
  };

  const cols: Column<FilaFacturar>[] = [
    { key: "fecha", label: "Fecha P/Fact", sortable: true, sortValue: (f) => f.fechaPFact, render: (f) => (
      <span className="whitespace-nowrap" title={f.ocCliente ? "Fecha de la OC del cliente" : "Fecha en que se aprobó el PR"}>{formatDate(f.fechaPFact)}</span>
    ) },
    { key: "numero", label: "N° PR", sortable: true, sortValue: (f) => f.numero, render: (f) => (
      <Link href={`/presupuestos?selected=${f.presupuesto.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-mono text-xs text-orange-600 hover:underline dark:text-orange-400">{f.numero}{f.restoId && <span className="font-sans text-zinc-500"> · resto</span>}</Link>
    ) },
    { key: "cliente", label: "Cliente", sortable: true, sortValue: (f) => f.cliente, render: (f) => <span className="block max-w-[200px] truncate" title={f.cliente}>{f.cliente || "—"}</span> },
    { key: "detalle", label: "Detalle", render: (f) => (
      f.detalle.texto ? <span className="block max-w-[260px] truncate text-xs text-zinc-600 dark:text-zinc-400" title={f.detalle.completo}>{f.detalle.texto}</span> : <span className="text-xs text-zinc-400">—</span>
    ) },
    { key: "sucursal", label: "Sucursal", sortable: true, sortValue: (f) => f.sucursal, render: (f) => <span className="block max-w-[130px] truncate text-xs text-zinc-600 dark:text-zinc-300" title={f.sucursal}>{f.sucursal || "—"}</span> },
    { key: "neto", label: "Neto", sortable: true, sortValue: (f) => f.neto, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono text-zinc-500">{formatCurrency(f.neto, f.moneda)}</span> },
    { key: "total", label: "Total", sortable: true, sortValue: (f) => f.total, className: "text-right", render: (f) => <span className="whitespace-nowrap font-mono font-semibold">{formatCurrency(f.total, f.moneda)}</span> },
    { key: "estado", label: "Estado", sortable: true, sortValue: (f) => (f.esperandoOc ? 1 : f.refacturar ? 2 : f.restoId ? 3 : 0), render: (f) => f.restoId ? (
      <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" title="Lo que quedó sin facturar de este PR">Resto a facturar</span>
    ) : (
      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${f.esperandoOc ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" : f.refacturar ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>
        {f.esperandoOc ? "Esperando OC" : f.refacturar ? (f.ncAnula ? `Anulada por ${f.ncAnula}` : "Anulada") : "Listo"}
      </span>
    ) },
    { key: "facturar", label: "", render: (f) => (
      <div className="flex items-center gap-1">
        <button type="button" onClick={(e) => { e.stopPropagation(); facturar(f); }} title={f.esperandoOc ? "El cliente pide OC: avisa y se puede facturar igual" : f.refacturar ? "Hacer una factura nueva de este PR" : f.restoId ? "Facturar lo que quedó de este PR" : "Hacer la factura de este PR"}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600">
          <Receipt className="h-3.5 w-3.5" /> {f.refacturar ? "Re-facturar" : "Facturar"}
        </button>
        {(f.refacturar || f.restoId) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); noFacturar(f); }} title={f.restoId ? "No facturar lo que quedó y sacarlo de la lista" : "Dejar la factura anulada como está y sacar el PR de la lista"}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-red-600 dark:hover:bg-zinc-800">
            <X className="h-3.5 w-3.5" /> No facturar
          </button>
        )}
      </div>
    ) },
  ];

  return (
    <div className="space-y-2">
      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar cliente, N° PR, OC, sucursal o detalle" className={`${control} w-full pl-8`} />
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>
      ) : !filas ? (
        <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <DataTable columns={cols} data={visibles} pageSize={50} emptyMessage={texto ? "No hay PR para facturar con esa búsqueda" : "No hay PR para facturar"} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <span className="text-zinc-400">{visibles.length} PR · {visibles.filter((f) => f.esperandoOc).length} esperando OC</span>
            <span>Neto <b className="font-mono text-zinc-800 dark:text-zinc-100">{plata("neto")}</b></span>
            <span>Total <b className="font-mono text-zinc-800 dark:text-zinc-100">{plata("total")}</b></span>
          </div>
        </div>
      )}

      {emitir && (
        <EmitirFacturaModal
          presupuesto={emitir.presupuesto}
          arcaCertOk={arcaStatus?.certOk}
          onClose={() => setEmitir(null)}
          onEmitted={() => setRecarga((n) => n + 1)}
        />
      )}
    </div>
  );
}
