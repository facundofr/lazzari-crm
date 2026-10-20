"use client";

// Finanzas Lazza → ficha de la cuenta corriente: resumen con TODOS los movimientos del cliente o proveedor
// (Augusto 19/10/2026: "no tiene que figurar solo lo pendiente"). De la más vieja a la más nueva, Debe / Haber /
// Saldo acumulado; lo que no suma (anulados, sistema anterior…) en gris. Cuentas en lib/resumen-cuenta (mismas
// reglas que el saldo de la ficha). Si no cierra con el saldo de arriba, avisa (nunca frena). Descargar Excel y PDF.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { diferenciaResumen, resumenCliente, resumenProveedor, type InfoCobroRC, type ResumenCuenta } from "@/lib/resumen-cuenta";
import { sentidoAjuste } from "@/lib/tipos-movimiento";
import { generateResumenCuentaPDF, getSociedadPDF, openPDFWindow } from "@/lib/pdf-templates";

const db = supabase as any;

const CAMPOS_MOV = "id, tipo, monto, monto_original, moneda, fecha, descripcion, anulado, anulado_at, created_at, factura_id, ajuste_sentido, factura_compra_id, orden_pago_id, nota_credito_compra_id, retencion_ganancias_monto";

async function traerResumen(sociedadId: string, lado: "cliente" | "proveedor", id: string): Promise<ResumenCuenta> {
  if (lado === "cliente") {
    const [facturas, movimientos] = await Promise.all([
      traerTodo<any>(() => db.from("facturas").select("id, tipo, punto_venta, numero, fecha, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado")
        .eq("sociedad_id", sociedadId).eq("cliente_id", id).order("id")),
      traerTodo<any>(() => db.from("movimientos").select(CAMPOS_MOV).eq("sociedad_id", sociedadId).eq("cliente_id", id).order("id")),
    ]);
    const ids = movimientos.map((m) => m.id);
    const aplicaciones: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from("cobro_aplicaciones").select("movimiento_id, factura_id, monto").in("movimiento_id", ids.slice(i, i + 200));
      if (error) throw error;
      aplicaciones.push(...(data || []));
    }
    // Recibo y cheque de cada cobro, para el detalle corto (si falla, queda el texto del cobro).
    const info = new Map<string, InfoCobroRC>();
    for (let i = 0; i < ids.length; i += 200) {
      const trozo = ids.slice(i, i + 200);
      const [rm, ch] = await Promise.all([
        db.from("recibo_movimientos").select("movimiento_id, recibos(numero)").in("movimiento_id", trozo),
        db.from("echeqs").select("movimiento_id, numero, banco_emisor, estado, fecha_deposito, fecha_endoso").in("movimiento_id", trozo),
      ]);
      for (const r of rm.data || []) if (r.recibos?.numero) info.set(r.movimiento_id, { ...info.get(r.movimiento_id), recibo: r.recibos.numero });
      for (const c of ch.data || []) info.set(c.movimiento_id, { ...info.get(c.movimiento_id), cheque: { numero: c.numero, banco: c.banco_emisor, estado: c.estado, fecha_deposito: c.fecha_deposito, fecha_endoso: c.fecha_endoso } });
    }
    // NC que cancelan varias facturas (si falla, cada NC queda con su factura de origen).
    const ncIds = facturas.filter((f) => String(f.tipo || "").toUpperCase().startsWith("NC")).map((f) => f.id);
    const ncAplicaciones: any[] = [];
    for (let i = 0; i < ncIds.length; i += 200) {
      const { data } = await db.from("nota_credito_venta_aplicaciones").select("nota_credito_id, factura_id").in("nota_credito_id", ncIds.slice(i, i + 200));
      ncAplicaciones.push(...(data || []));
    }
    const anulados = new Set(movimientos.filter((m) => m.anulado).map((m) => m.id));
    return resumenCliente(facturas, movimientos, aplicaciones.filter((a) => !anulados.has(a.movimiento_id)), info, ncAplicaciones);
  }
  const [facturas, ordenes, movimientos, saldosFavor] = await Promise.all([
    traerTodo<any>(() => db.from("facturas_compra").select("id, numero_factura, tipo_comprobante, fecha, total, total_acreditado, moneda, estado, op_facturas_compra(monto, ordenes_pago(estado, numero))")
      .eq("sociedad_id", sociedadId).eq("proveedor_id", id).order("id")),
    traerTodo<any>(() => db.from("ordenes_pago").select("id, numero, fecha, monto_bruto, moneda, estado, created_at, op_facturas_compra(factura_compra_id, monto)")
      .eq("sociedad_id", sociedadId).eq("proveedor_id", id).order("id")),
    traerTodo<any>(() => db.from("movimientos").select(CAMPOS_MOV).eq("sociedad_id", sociedadId).eq("proveedor_id", id).order("id")),
    traerTodo<any>(() => db.from("saldos_favor_proveedor").select("id, orden_pago_id, monto_original").eq("sociedad_id", sociedadId).eq("proveedor_id", id).order("id")),
  ]);
  return resumenProveedor(facturas, ordenes, movimientos, sentidoAjuste, saldosFavor);
}

export function ResumenCuentaFicha({ sociedadId, lado, entidadId, nombre, cuit, saldoFicha, recarga }: {
  sociedadId: string;
  lado: "cliente" | "proveedor";
  entidadId: string;
  nombre: string;
  cuit?: string | null;
  /** Saldo de la ficha (sin pasar de moneda), para avisar si el resumen no cierra. */
  saldoFicha: { ARS: number; USD: number } | null;
  recarga: number;
}) {
  const { sociedadActiva } = useUser();
  const [res, setRes] = useState<ResumenCuenta | null>(null);
  const [error, setError] = useState(false);
  const [bajando, setBajando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    setRes(null); setError(false);
    traerResumen(sociedadId, lado, entidadId)
      .then((r) => { if (vivo) setRes(r); })
      .catch((e) => { console.error("Finanzas Lazza · Resumen de cuenta:", e); if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [sociedadId, lado, entidadId, recarga]);

  // Abre mostrando lo último (lo más nuevo queda abajo).
  useEffect(() => { if (res && caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [res]);

  const dif = useMemo(() => (res && saldoFicha ? diferenciaResumen(res, saldoFicha) : null), [res, saldoFicha]);
  const hayUSD = !!res?.renglones.some((r) => r.moneda === "USD");

  const descargarExcel = async () => {
    if (!res) return;
    const XLSX: any = await import("xlsx");
    const filas = [["Fecha", "Comprobante / detalle", "Nota", "Moneda", "Importe", "Debe", "Haber", "Saldo", "Suma", "Detalle completo"],
      ...res.renglones.map((r) => [formatDate(r.fecha), r.detalle, r.nota || "", r.moneda, r.importe, r.suma ? r.debe : "", r.suma ? r.haber : "", r.suma ? r.saldo : "", r.anulado ? "Anulado" : r.suma ? "Sí" : "No", r.completo || ""])];
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws["!cols"] = [{ wch: 11 }, { wch: 45 }, { wch: 45 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen");
    XLSX.writeFile(wb, `Resumen de cuenta - ${nombre.replace(/[\\/:*?"<>|]+/g, "-")}.xlsx`);
  };

  const descargarPDF = async () => {
    if (!res || !sociedadActiva) return;
    setBajando(true);
    try {
      const html = generateResumenCuentaPDF({ nombre, cuit, lado, fecha: todayAR(), renglones: res.renglones, saldo: res.saldo }, getSociedadPDF(sociedadActiva as any));
      await openPDFWindow(html, `Resumen de cuenta - ${nombre}.pdf`);
    } finally { setBajando(false); }
  };

  const boton = "inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
  const monto = (v: number, m: "ARS" | "USD") => (v > 0.005 ? formatCurrency(v, m) : "");

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase text-zinc-500">Resumen de cuenta{res ? ` (${res.renglones.length})` : ""}</h3>
        <span className="ml-auto" />
        <button type="button" disabled={!res} onClick={descargarExcel} className={boton} title="Descargar el resumen en Excel"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</button>
        <button type="button" disabled={!res || bajando} onClick={descargarPDF} className={boton} title="Descargar el resumen en PDF">
          {bajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">No se pudo armar el resumen. Cerrá y abrí la ficha de nuevo.</p>
        : !res ? <p className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
        : res.renglones.length === 0 ? <p className="text-xs text-zinc-400">Sin movimientos.</p> : (
          <>
            {dif && (Math.abs(dif.ARS) > 0.01 || Math.abs(dif.USD) > 0.01) && (
              <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                ⚠️ El resumen da {[dif.ARS && formatCurrency(res.saldo.ARS), dif.USD && formatCurrency(res.saldo.USD, "USD")].filter(Boolean).join(" + ")} y el saldo de arriba no: diferencia {[dif.ARS && formatCurrency(dif.ARS), dif.USD && formatCurrency(dif.USD, "USD")].filter(Boolean).join(" + ")}. Avisame para revisarlo.
              </p>
            )}
            <div ref={caja} className="max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-left text-[10px] uppercase text-zinc-400">
                    <th className="py-1 pl-1">Fecha</th><th>Comprobante / detalle</th><th className="text-right">Debe</th><th className="text-right">Haber</th><th className="pr-1 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {res.renglones.map((r) => {
                    const gris = !r.suma || r.anulado;
                    return (
                      <tr key={r.id} className={`border-t border-zinc-100 align-top dark:border-zinc-800 ${gris ? "text-zinc-400" : ""}`}>
                        <td className="whitespace-nowrap py-1 pl-1 pr-2">{formatDate(r.fecha)}</td>
                        <td className="pr-2">
                          <span title={r.completo} className={r.anulado ? "line-through" : r.clase === "rechazo" ? "font-semibold text-red-600" : ""}>{r.detalle}</span>
                          {r.nota && <span className="block text-[10px] text-zinc-400">{r.nota}</span>}
                        </td>
                        <td className="whitespace-nowrap text-right font-mono">{gris ? <span className={r.anulado ? "line-through" : ""}>{formatCurrency(r.importe, r.moneda)}</span> : monto(r.debe, r.moneda)}</td>
                        <td className="whitespace-nowrap pl-2 text-right font-mono text-emerald-700 dark:text-emerald-400">{gris ? "" : monto(r.haber, r.moneda)}</td>
                        <td className="whitespace-nowrap pl-2 pr-1 text-right font-mono font-semibold">{gris ? "" : formatCurrency(r.saldo, r.moneda)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-right text-[11px] text-zinc-500">
              Saldo <b className="font-mono">{formatCurrency(res.saldo.ARS)}</b>{hayUSD && <> · <b className="font-mono">{formatCurrency(res.saldo.USD, "USD")}</b></>}
              <span className="text-zinc-400"> · {lado === "cliente" ? "positivo = nos debe" : "positivo = le debemos"} · en gris: no suma</span>
            </p>
          </>
        )}
    </div>
  );
}
