"use client";

// Finanzas Lazza → ficha de la cuenta corriente: resumen con TODOS los movimientos del cliente o proveedor
// (Augusto 19/10/2026: "no tiene que figurar solo lo pendiente"). De la más vieja a la más nueva, Debe / Haber /
// Saldo acumulado; lo que no suma (anulados, sistema anterior…) en gris. Cuentas en lib/resumen-cuenta (mismas
// reglas que el saldo de la ficha). Si no cierra con el saldo de arriba, avisa (nunca frena). Descargar Excel y PDF.
// Arreglo 22 (26/10/2026): saldo en $ y en US$ en columnas separadas; lo que no suma lleva su importe al lado del
// detalle (fuera de Debe y Haber); "Desde" con saldo anterior; "Mail" con el PDF; cada renglón abre su comprobante.
// Arreglo 23 (27/10/2026): «Anular» en el renglón de un ajuste manual (ajuste-manual.tsx); el anulado dice quién y cuándo.
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileSpreadsheet, Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, formatDateTime, todayAR } from "@/lib/utils";
import { diferenciaResumen, resumenCliente, resumenDesde, resumenProveedor, type DocResumen, type InfoCobroRC, type MonedaRC, type RenglonResumen, type ResumenCuenta } from "@/lib/resumen-cuenta";
import { sentidoAjuste } from "@/lib/tipos-movimiento";
import { generateResumenCuentaPDF, getSociedadPDF, htmlToPdfBase64, openPDFWindow } from "@/lib/pdf-templates";
import { EmailComposeModal } from "@/components/email-compose-modal";
import { FichaFacturaCompra, FichaFacturaVenta } from "@/components/facturas-consulta";
import { verOP } from "./orden-pago-doc";
import { abrirRecibo, traerRecibo } from "./recibo-doc";
import { AnularAjusteCC } from "./ajuste-manual";

const db = supabase as any;

const CAMPOS_MOV = "id, tipo, monto, monto_original, moneda, fecha, descripcion, anulado, anulado_at, anulado_por, created_at, factura_id, ajuste_sentido, factura_compra_id, orden_pago_id, nota_credito_compra_id, retencion_ganancias_monto";
const QUE_ABRE: Record<DocResumen["tipo"], string> = { factura_venta: "Abrir el comprobante", factura_compra: "Abrir la factura", op: "Ver la orden de pago", recibo: "Ver el recibo" };
// Sin el punto final del nombre ("S.A.U." daba "S.A.U..pdf").
const nombreArchivo = (nombre: string) => `Resumen de cuenta - ${nombre.replace(/[\\/:*?"<>|]+/g, "-").replace(/[.\s]+$/, "")}`;
/** "anulado por Augusto Lazzari · 27/10/2026 15:40" (arreglo 23). */
const textoAnulacion = (a: NonNullable<RenglonResumen["anulacion"]>) =>
  ["anulado", a.por && `por ${a.por}`, a.el && `· ${formatDateTime(a.el).replace(",", "")}`].filter(Boolean).join(" ");

/** Nombre de quien anuló cada movimiento (arreglo 23: el ajuste anulado dice quién y cuándo). Si no se puede, queda sin nombre. */
async function conQuienAnulo(movimientos: any[]) {
  const ids = [...new Set(movimientos.filter((m) => m.anulado && m.anulado_por).map((m) => m.anulado_por))];
  if (!ids.length) return;
  const { data } = await db.from("profiles").select("id, full_name").in("id", ids);
  const nombres = new Map<string, string>((data || []).map((p: any) => [p.id, p.full_name]));
  for (const m of movimientos) if (m.anulado_por) m.anulado_por_nombre = nombres.get(m.anulado_por) || null;
}

async function traerResumen(sociedadId: string, lado: "cliente" | "proveedor", id: string): Promise<ResumenCuenta> {
  if (lado === "cliente") {
    const [facturas, movimientos] = await Promise.all([
      traerTodo<any>(() => db.from("facturas").select("id, tipo, punto_venta, numero, fecha, total, total_acreditado, saldo_a_favor_cliente, factura_origen_id, moneda, estado")
        .eq("sociedad_id", sociedadId).eq("cliente_id", id).order("id")),
      traerTodo<any>(() => db.from("movimientos").select(CAMPOS_MOV).eq("sociedad_id", sociedadId).eq("cliente_id", id).order("id")),
    ]);
    await conQuienAnulo(movimientos);
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
        db.from("recibo_movimientos").select("movimiento_id, recibos(id, numero)").in("movimiento_id", trozo),
        db.from("echeqs").select("movimiento_id, numero, banco_emisor, estado, fecha_deposito, fecha_endoso").in("movimiento_id", trozo),
      ]);
      for (const r of rm.data || []) if (r.recibos?.numero) info.set(r.movimiento_id, { ...info.get(r.movimiento_id), recibo: r.recibos.numero, reciboId: r.recibos.id });
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
  await conQuienAnulo(movimientos);
  return resumenProveedor(facturas, ordenes, movimientos, sentidoAjuste, saldosFavor);
}

export function ResumenCuentaFicha({ sociedadId, lado, entidadId, nombre, cuit, saldoFicha, recarga, onCambio }: {
  sociedadId: string;
  lado: "cliente" | "proveedor";
  entidadId: string;
  nombre: string;
  cuit?: string | null;
  /** Saldo de la ficha (sin pasar de moneda), para avisar si el resumen no cierra. */
  saldoFicha: { ARS: number; USD: number } | null;
  recarga: number;
  /** Después de anular un ajuste: recarga la ficha (saldo, lista y este resumen). */
  onCambio?: () => void;
}) {
  const { sociedadActiva, profile } = useUser();
  const puedeAnular = profile?.role === "super_admin" || profile?.role === "admin" || profile?.role === "administrativo";
  const [res, setRes] = useState<ResumenCuenta | null>(null);
  const [error, setError] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [desde, setDesde] = useState("");
  const [mail, setMail] = useState(false);
  const [ficha, setFicha] = useState<DocResumen | null>(null);
  const [anular, setAnular] = useState<RenglonResumen | null>(null);
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
  useEffect(() => { if (res && caja.current) caja.current.scrollTop = caja.current.scrollHeight; }, [res, desde]);

  const dif = useMemo(() => (res && saldoFicha ? diferenciaResumen(res, saldoFicha) : null), [res, saldoFicha]);
  const vista = useMemo(() => (res ? resumenDesde(res, desde || null) : null), [res, desde]);
  // Una columna de saldo por moneda (antes era una sola que saltaba de $ a US$ y no se podía seguir).
  const monedas = useMemo<MonedaRC[]>(() => {
    const m = (["ARS", "USD"] as MonedaRC[]).filter((k) => res?.renglones.some((r) => r.moneda === k));
    return m.length ? m : ["ARS"];
  }, [res]);
  const dos = monedas.length > 1;
  const hayUSD = monedas.includes("USD");
  const tituloSaldo = (m: MonedaRC) => (dos ? `Saldo ${m === "USD" ? "US$" : "$"}` : "Saldo");

  const descargarExcel = async () => {
    if (!vista) return;
    const XLSX: any = await import("xlsx");
    const saldos = (moneda: MonedaRC | null, v: number | "") => monedas.map((m) => (m === moneda ? v : ""));
    const filas = [["Fecha", "Comprobante / detalle", "Nota", "Moneda", "Importe", "Debe", "Haber", ...monedas.map(tituloSaldo), "Suma", "Detalle completo"],
      ...(vista.anterior ? [[formatDate(desde), "Saldo anterior", "", "", "", "", "", ...monedas.map((m) => vista.anterior![m]), "", ""]] : []),
      ...vista.renglones.map((r) => [formatDate(r.fecha), r.detalle, r.nota || "", r.moneda, r.importe, r.suma ? r.debe : "", r.suma ? r.haber : "", ...saldos(r.suma ? r.moneda : null, r.suma ? r.saldo : ""), r.anulado ? "Anulado" : r.suma ? "Sí" : "No", r.completo || ""])];
    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws["!cols"] = [{ wch: 11 }, { wch: 45 }, { wch: 45 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, ...monedas.map(() => ({ wch: 14 })), { wch: 8 }, { wch: 80 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resumen");
    XLSX.writeFile(wb, `${nombreArchivo(nombre)}.xlsx`);
  };

  // El PDF (y el del mail) sale con lo que se ve: desde la fecha elegida, con su saldo anterior.
  const htmlPDF = () => generateResumenCuentaPDF({
    nombre, cuit, lado, fecha: todayAR(), desde: desde || null, anterior: vista?.anterior ?? null, renglones: vista?.renglones ?? [], saldo: res?.saldo ?? { ARS: 0, USD: 0 },
  }, getSociedadPDF(sociedadActiva as any));

  const descargarPDF = async () => {
    if (!res || !sociedadActiva) return;
    setBajando(true);
    try {
      await openPDFWindow(htmlPDF(), `${nombreArchivo(nombre)}.pdf`);
    } finally { setBajando(false); }
  };

  /** Tocar un renglón abre su comprobante: la ficha de la factura, la OP o el recibo (los dos últimos en una pestaña). */
  const abrir = async (d: DocResumen) => {
    if (!sociedadActiva) return;
    if (d.tipo === "op") { await verOP(d.id, sociedadActiva); return; }
    if (d.tipo === "recibo") {
      const r = await traerRecibo(sociedadId, d.id).catch(() => null);
      if (r) abrirRecibo(r, sociedadActiva, true);
      else alert("No se pudo abrir el recibo.");
      return;
    }
    setFicha(d);
  };

  const boton = "inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
  const monto = (v: number, m: MonedaRC) => (v > 0.005 ? formatCurrency(v, m) : "");
  const celdaSaldo = (i: number) => `whitespace-nowrap pl-2 text-right font-mono font-semibold ${i === monedas.length - 1 ? "pr-1" : ""}`;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase text-zinc-500">Resumen de cuenta{vista ? ` (${vista.renglones.length})` : ""}</h3>
        <span className="ml-auto" />
        <label className="flex items-center gap-1 text-[11px] text-zinc-500" title="Lo de antes queda en un renglón de saldo anterior (también en el Excel, el PDF y el mail)">
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-6 rounded border border-zinc-300 bg-white px-1 text-[11px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200" />
        </label>
        {desde && <button type="button" onClick={() => setDesde("")} className="text-[11px] text-orange-600 hover:underline">Ver todo</button>}
        <button type="button" disabled={!res} onClick={descargarExcel} className={boton} title="Descargar el resumen en Excel"><FileSpreadsheet className="h-3.5 w-3.5" /> Excel</button>
        <button type="button" disabled={!res || bajando} onClick={descargarPDF} className={boton} title="Descargar el resumen en PDF">
          {bajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} PDF
        </button>
        <button type="button" disabled={!res} onClick={() => setMail(true)} className={boton} title={`Mandar el resumen en PDF por mail al ${lado}`}><Mail className="h-3.5 w-3.5" /> Mail</button>
      </div>
      {error ? <p className="text-xs text-red-600">No se pudo armar el resumen. Cerrá y abrí la ficha de nuevo.</p>
        : !res || !vista ? <p className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…</p>
        : res.renglones.length === 0 ? <p className="text-xs text-zinc-400">Sin movimientos.</p> : (
          <>
            {dif && (Math.abs(dif.ARS) > 0.01 || Math.abs(dif.USD) > 0.01) && (
              <p className="mb-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                ⚠️ El resumen da {[dif.ARS && formatCurrency(res.saldo.ARS), dif.USD && formatCurrency(res.saldo.USD, "USD")].filter(Boolean).join(" + ")} y el saldo de arriba no: diferencia {[dif.ARS && formatCurrency(dif.ARS), dif.USD && formatCurrency(dif.USD, "USD")].filter(Boolean).join(" + ")}. Puede faltar algo cargado: revisá los renglones en gris.
              </p>
            )}
            <div ref={caja} className="max-h-[60vh] overflow-y-auto rounded-lg border border-zinc-100 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white dark:bg-zinc-900">
                  <tr className="text-left text-[10px] uppercase text-zinc-400">
                    <th className="py-1 pl-1">Fecha</th><th>Comprobante / detalle</th><th className="text-right">Debe</th><th className="text-right">Haber</th>
                    {monedas.map((m, i) => <th key={m} className={`text-right ${i === monedas.length - 1 ? "pr-1" : ""}`}>{tituloSaldo(m)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {vista.anterior && (
                    <tr className="border-t border-zinc-100 bg-zinc-50 font-medium dark:border-zinc-800 dark:bg-zinc-800/50">
                      <td className="whitespace-nowrap py-1 pl-1 pr-2">{formatDate(desde)}</td>
                      <td className="pr-2" colSpan={3}>Saldo anterior</td>
                      {monedas.map((m, i) => <td key={m} className={celdaSaldo(i)}>{formatCurrency(vista.anterior![m], m)}</td>)}
                    </tr>
                  )}
                  {vista.renglones.map((r) => {
                    const gris = !r.suma || r.anulado;
                    const doc = r.doc;
                    return (
                      <tr key={r.id} onClick={doc ? () => void abrir(doc) : undefined} title={doc ? QUE_ABRE[doc.tipo] : undefined}
                        className={`border-t border-zinc-100 align-top dark:border-zinc-800 ${gris ? "text-zinc-400" : ""} ${doc ? "cursor-pointer hover:bg-orange-50/60 dark:hover:bg-zinc-800/60" : ""}`}>
                        <td className="whitespace-nowrap py-1 pl-1 pr-2">{formatDate(r.fecha)}</td>
                        <td className="pr-2">
                          <span title={r.completo} className={r.anulado ? "line-through" : r.clase === "rechazo" ? "font-semibold text-red-600" : ""}>{r.detalle}</span>
                          {/* Lo que no suma lleva su importe acá, fuera de Debe y Haber (en el PDF al cliente no parece deuda). */}
                          {gris && <span className={`ml-1.5 whitespace-nowrap font-mono ${r.anulado ? "line-through" : ""}`}>{formatCurrency(r.importe, r.moneda)}</span>}
                          {r.ajusteId && puedeAnular && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); setAnular(r); }} title="Anular este ajuste manual: queda tachado, con quién y cuándo"
                              className="ml-1.5 rounded border border-red-200 px-1 text-[10px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30">Anular</button>
                          )}
                          {(r.anulacion || r.nota) && <span className="block text-[10px] text-zinc-400">{r.anulacion ? textoAnulacion(r.anulacion) : r.nota}</span>}
                        </td>
                        <td className="whitespace-nowrap text-right font-mono">{gris ? "" : monto(r.debe, r.moneda)}</td>
                        <td className="whitespace-nowrap pl-2 text-right font-mono text-emerald-700 dark:text-emerald-400">{gris ? "" : monto(r.haber, r.moneda)}</td>
                        {monedas.map((m, i) => <td key={m} className={celdaSaldo(i)}>{!gris && r.moneda === m ? formatCurrency(r.saldo, m) : ""}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-right text-[11px] text-zinc-500">
              Saldo <b className="font-mono">{formatCurrency(res.saldo.ARS)}</b>{hayUSD && <> · <b className="font-mono">{formatCurrency(res.saldo.USD, "USD")}</b></>}
              <span className="text-zinc-400"> · {lado === "cliente" ? "positivo = nos debe" : "positivo = le debemos"} · en gris: no suma · tocá un renglón para abrir su comprobante</span>
            </p>
          </>
        )}
      {ficha?.tipo === "factura_venta" && <FichaFacturaVenta facturaId={ficha.id} onClose={() => setFicha(null)} />}
      {ficha?.tipo === "factura_compra" && <FichaFacturaCompra facturaId={ficha.id} onClose={() => setFicha(null)} />}
      {mail && res && <EnviarResumen lado={lado} entidadId={entidadId} nombre={nombre} desde={desde} armarHtml={htmlPDF} onClose={() => setMail(false)} />}
      {anular && res && (
        <AnularAjusteCC lado={lado} nombre={nombre} ajuste={anular} saldo={res.saldo[anular.moneda]}
          onClose={() => setAnular(null)} onAnulado={() => { setAnular(null); onCambio?.(); }} />
      )}
    </div>
  );
}

/** Mail del resumen (arreglo 22): sale de administracion@ con el PDF, a los mails del cliente o del proveedor. */
function EnviarResumen({ lado, entidadId, nombre, desde, armarHtml, onClose }: {
  lado: "cliente" | "proveedor"; entidadId: string; nombre: string; desde: string; armarHtml: () => string; onClose: () => void;
}) {
  const { sociedadActiva } = useUser();
  const [mail, setMail] = useState<{ to: string; sugeridos: { email: string; label?: string }[] } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const sugeridos: { email: string; label?: string }[] = [];
      const sumar = (email: string | null | undefined, label: string) => {
        const e = String(email || "").trim();
        if (e && !sugeridos.some((s) => s.email === e)) sugeridos.push({ email: e, label });
      };
      const { data: contactos } = await db.from("contactos").select("nombre, email, principal").eq("entity_type", lado).eq("entity_id", entidadId).order("principal", { ascending: false });
      if (lado === "cliente") {
        // Mismo orden que el mail del recibo: facturación, el mail del cliente y los contactos.
        const { data: cli } = await db.from("clientes").select("email, email_facturacion").eq("id", entidadId).maybeSingle();
        for (const e of String(cli?.email_facturacion || "").split(",")) sumar(e, "Facturación");
        sumar(cli?.email, "Cliente");
        for (const c of contactos || []) sumar(c.email, c.nombre || "Contacto");
      } else {
        // Mismo orden que el mail de la OP: contacto principal, los demás contactos y el mail del proveedor.
        const { data: prov } = await db.from("proveedores").select("email").eq("id", entidadId).maybeSingle();
        for (const c of contactos || []) sumar(c.email, c.principal ? `Principal: ${c.nombre || "Contacto"}` : (c.nombre || "Contacto"));
        sumar(prov?.email, "Proveedor");
      }
      if (vivo) setMail({ to: sugeridos[0]?.email || "", sugeridos });
    })().catch(() => { if (vivo) setMail({ to: "", sugeridos: [] }); });
    return () => { vivo = false; };
  }, [lado, entidadId]);

  if (!mail || !sociedadActiva) return null;
  const empresa = sociedadActiva.razonSocial || sociedadActiva.nombre || "Lazzari";
  return (
    <EmailComposeModal
      open
      onClose={onClose}
      documentType="resumen_cuenta"
      sociedadId={sociedadActiva.id}
      defaultTo={mail.to}
      defaultSubject={`Resumen de cuenta - ${empresa}`}
      defaultBody={`<p>Hola,</p><p>Adjuntamos el resumen de la cuenta corriente${desde ? ` desde el ${formatDate(desde)}` : ""}, al ${formatDate(todayAR())}.</p><p>Muchas gracias.</p><p>${empresa}</p>`}
      pdfFilename={`${nombreArchivo(nombre)}.pdf`}
      suggestedEmails={mail.sugeridos}
      guardarContacto={{ entityType: lado, entityId: entidadId, cargo: "Administración" }}
      onSuccess={onClose}
      generatePdf={async () => htmlToPdfBase64(armarHtml())}
    />
  );
}
