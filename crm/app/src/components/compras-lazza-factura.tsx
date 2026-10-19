"use client";

/**
 * Compras Lazza › Cargar factura (Augusto 16/10, simplificada 19/10): MUY simple y permisivo.
 * 1. Subís el PDF: lo lee el SISTEMA (QR de ARCA o texto, sin IA). Si no puede, "Leer con IA".
 * 2. Proveedor por CUIT ("Buscando proveedor…" mientras lo busca). Se ven tipo, número, neto, IVA, percepciones y total;
 *    los artículos solo si se leyó con IA (cargarlos es opcional).
 * 3. Augusto 19/10: las facturas ya NO se atan a ninguna OC. Van directo a la cuenta corriente del proveedor.
 *    La OC solo controla que llegue todo. Lo que ya estaba vinculado queda como está.
 * 4. "¿Cómo se paga?" arranca sin nada elegido y hay que elegir (Va a Pagos o Ya pagada con Visa); email y CBU/alias
 *    del proveedor si faltan, y "Nota para Finanzas".
 * 5. Nota de crédito: sin forma de pago; va a la cuenta corriente del proveedor como crédito
 *    (registrar_nota_credito_compra_v2, la misma de Finanzas). La nota de débito no se carga acá.
 * Guardar usa guardar_conciliacion_compra (la de siempre), sin OC, sin aceptar costos ni aprender equivalencias.
 */
import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { ProveedorFormModal } from "@/components/proveedor-form-modal";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { facturaDesdeDatos, lineKey, type FacturaCarga } from "@/lib/factura-compra-leida";
import { leerFacturaLocal } from "@/lib/leer-factura-local";
import { traerTarjetas, tarjetaSugerida, registrarPagoTarjeta, movimientoPagoTarjeta } from "@/lib/pago-tarjeta";
import { cant } from "@/lib/cargar-factura";
import { ivaYPercepciones, netoFactura, tipoNotaCredito, vencimientoPorDias } from "@/lib/compras-lazza";
import { AlertTriangle, Check, CreditCard, FileUp, Loader2, Sparkles, UserPlus, X } from "lucide-react";

const db = supabase as any;
const round2 = (n: number) => Math.round(n * 100) / 100;
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** "1.234,56", "1234,56" o "1234.56" → 1234.56 */
const num = (v: string) => { const t = String(v || "").replace(/[^\d.,-]/g, ""); return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0; };
const aTexto = (n: number) => String(round2(n)).replace(".", ",");
const SOCIEDAD_POR_CUIT: Record<string, { id: string; nombre: string }> = {
  "20379309128": { id: "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021", nombre: "Lazzari" },
  "30719396042": { id: "fee94607-747a-4e87-ba24-aff9032f7a56", nombre: "Grupo LA" },
};
const esMercadoLibre = (t: string | null | undefined) => /mercado\s*libre/i.test(String(t || ""));

type Proveedor = { id: string; razon_social: string; cuit: string | null; talles_especiales?: string[] | null; medio_pago_preferido?: string | null; plazo_cheque_dias?: number | null; dias_pago?: number | null; email?: string | null; cbu?: string | null; alias_bancario?: string | null };
type FormaPago = "transferencia" | "echeq";
const DIAS_RAPIDOS = [0, 15, 30, 45, 60];
const btnSi = "rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700";
const btnNo = "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
const elegido = "ring-2 ring-violet-400";

export default function ComprasLazzaFactura({ sociedadId, onClose }: {
  sociedadId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { profile } = useUser();
  const [leyendo, setLeyendo] = useState(false);
  const [leyendoIA, setLeyendoIA] = useState(false);
  const [error, setError] = useState("");
  const [factura, setFactura] = useState<FacturaCarga | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [origen, setOrigen] = useState<"sistema" | "ia" | "">("");
  const [noSeLeyo, setNoSeLeyo] = useState(false);
  // Nota de débito: no se carga acá. Nota de crédito: sí (factura.tipo "NC …").
  const [esNota, setEsNota] = useState(false);
  const ncKey = useRef<string | null>(null);
  const [otraSociedad, setOtraSociedad] = useState("");
  const [duplicada, setDuplicada] = useState(false);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  // Mientras se busca el proveedor por CUIT no se muestra "no está cargado" (salía un instante y se corregía solo).
  const [buscandoProv, setBuscandoProv] = useState(false);
  const [crearProv, setCrearProv] = useState(false);
  const [netoTxt, setNetoTxt] = useState("");
  // Augusto 19/10: arranca sin nada elegido y hay que elegir (las pagadas con tarjeta se marcan al cargarlas).
  const [conVisa, setConVisa] = useState<boolean | null>(null);
  const [faltaElegirPago, setFaltaElegirPago] = useState(false);
  // Para Pagos: transferencia o eCheq y a cuántos días (null = lo que sugiere el proveedor).
  const [forma, setForma] = useState<FormaPago | null>(null);
  const [diasTxt, setDiasTxt] = useState<string | null>(null);
  // Nota para Finanzas (opcional): queda en las notas de la factura.
  const [notaPago, setNotaPago] = useState("");
  // Recordatorio: si al proveedor le falta el email o los datos bancarios, se completan acá y se guardan en el proveedor.
  const [emailProv, setEmailProv] = useState("");
  const [bancoProv, setBancoProv] = useState("");
  const [guardandoProv, setGuardandoProv] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const plata = (n: number) => formatCurrency(n, factura?.moneda || "ARS");

  // ── 1. Leer (sistema primero; IA opcional) ──
  function reiniciar() {
    ncKey.current = null;
    setError(""); setFactura(null); setProveedor(null); setBuscandoProv(false);
    setConVisa(null); setFaltaElegirPago(false); setForma(null); setDiasTxt(null); setNotaPago(""); setDuplicada(false); setEsNota(false); setOtraSociedad(""); setNoSeLeyo(false); setOrigen("");
  }

  async function leer(file: File) {
    reiniciar(); setArchivo(file); setLeyendo(true);
    try {
      const local = await leerFacturaLocal(file).catch(() => null);
      if (!local) { setNoSeLeyo(true); return; }
      await usarDatos(file, local.data, "sistema");
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el archivo");
    } finally { setLeyendo(false); }
  }

  async function leerConIA() {
    if (!archivo) return;
    setLeyendoIA(true); setError("");
    try {
      const body = new FormData(); body.append("file", archivo);
      const res = await fetch("/api/parse-factura-compra", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "La IA no pudo leer el archivo");
      setNoSeLeyo(false);
      await usarDatos(archivo, json.data || {}, "ia");
    } catch (e: any) {
      setError(e?.message || "La IA no pudo leer el archivo");
    } finally { setLeyendoIA(false); }
  }

  async function usarDatos(file: File, d: any, como: "sistema" | "ia") {
    const leida = facturaDesdeDatos(file, d);
    const nc = tipoNotaCredito(d.tipo_comprobante);
    const f = nc ? { ...leida, tipo: nc } : leida;
    const buscar = f.cuit.length === 11 && !(proveedor && digitos(proveedor.cuit) === f.cuit);
    if (buscar) setBuscandoProv(true); // antes de mostrar la factura: así no aparece "no está cargado" mientras busca
    setFactura(f); setOrigen(como);
    setEsNota(!nc && /D[EÉ]BITO|^N\.?\s?D\b/i.test(String(d.tipo_comprobante || "")));
    const soc = SOCIEDAD_POR_CUIT[digitos(d.cuit_receptor)];
    setOtraSociedad(soc && soc.id !== sociedadId ? soc.nombre : "");
    setNetoTxt(aTexto(netoFactura(f).neto));
    if (!buscar) return; // releída con IA: mismo proveedor
    try {
      const { data: ps } = await db.from("proveedores").select("id, razon_social, cuit, talles_especiales, medio_pago_preferido, plazo_cheque_dias, dias_pago, email, cbu, alias_bancario").eq("sociedad_id", sociedadId).eq("activo", true);
      const p = ((ps || []) as Proveedor[]).find(x => digitos(x.cuit) === f.cuit);
      if (p) await elegirProveedor(p, f);
    } finally { setBuscandoProv(false); }
  }

  // ── 2. Proveedor (y aviso si la factura ya está cargada) ──
  async function elegirProveedor(p: Proveedor, f: FacturaCarga) {
    const { data: dups } = await db.from("facturas_compra").select("numero_factura, tipo_comprobante").eq("sociedad_id", sociedadId).eq("proveedor_id", p.id).neq("estado", "anulada");
    const norm = (n: string) => { const m = String(n || "").replace(/\s+/g, "").match(/^(\d{1,5})[-/](\d{1,8})$/); return m ? `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}` : String(n || "").replace(/\s+/g, "").toUpperCase(); };
    setDuplicada(!!f.numero && (dups || []).some((x: any) => norm(x.numero_factura) === norm(f.numero) && String(x.tipo_comprobante || "FC A").toUpperCase() === f.tipo.toUpperCase()));
    setProveedor(p); // después del chequeo de duplicada: el aviso sale junto con el proveedor
  }

  // ── 3. Cálculos ──
  // Sugerencia (no se elige sola): Mercado Libre casi siempre se paga con tarjeta.
  const visaSugerida = esMercadoLibre(proveedor?.razon_social);
  const pagaVisa = conVisa === true;
  const formaPago: FormaPago = forma ?? (/cheq/i.test(proveedor?.medio_pago_preferido || "") ? "echeq" : "transferencia");
  const diasSugeridos = formaPago === "echeq" ? (proveedor?.plazo_cheque_dias ?? proveedor?.dias_pago) : proveedor?.dias_pago;
  const dias = diasTxt ?? (diasSugeridos != null ? String(diasSugeridos) : "");
  const vencePago = factura ? vencimientoPorDias(factura.fecha, dias, factura.vencimiento) : null;
  // IVA y percepciones (leída por QR el IVA viene en 0: IVA = neto × alícuota y lo que sobra son percepciones, ej. IIBB).
  const impuestos = factura ? ivaYPercepciones({ total: factura.total, neto: num(netoTxt), iva: factura.iva, percepciones: factura.percepciones, ivaPorcentaje: factura.ivaPorcentaje }) : { iva: 0, percepciones: 0, percepcionEstimada: false };
  const ivaFactura = impuestos.iva;
  const percepcionesFactura = impuestos.percepciones;
  const faltaEmail = !!proveedor && !String(proveedor.email || "").trim();
  const faltaBanco = !!proveedor && !String(proveedor.cbu || "").trim() && !String(proveedor.alias_bancario || "").trim();

  async function guardarDatosProveedor() {
    if (!proveedor) return;
    const cambios: Record<string, string> = {};
    if (faltaEmail && emailProv.trim()) cambios.email = emailProv.trim();
    const b = bancoProv.trim();
    // 22 números = CBU/CVU; si no, es el alias.
    if (faltaBanco && b) { if (/^\d{22}$/.test(b.replace(/\s+/g, ""))) cambios.cbu = b.replace(/\s+/g, ""); else cambios.alias_bancario = b; }
    if (!Object.keys(cambios).length) return;
    setGuardandoProv(true);
    try {
      const { error: e } = await db.from("proveedores").update(cambios).eq("id", proveedor.id).eq("sociedad_id", sociedadId);
      if (e) throw e;
      setProveedor({ ...proveedor, ...cambios });
      setEmailProv(""); setBancoProv("");
      toast.success(`Guardado en ${proveedor.razon_social}`);
    } catch (e: any) {
      toast.error(`No se pudo guardar en el proveedor (${e?.message || "error"})`);
    } finally { setGuardandoProv(false); }
  }
  const textoPago = `Pago: ${formaPago === "echeq" ? "eCheq" : "transferencia"}${dias.trim() ? ` a ${Math.round(num(dias))} días` : ""}`;
  const listo = !!factura && !!proveedor && !esNota;
  const esNC = !!factura && factura.tipo.startsWith("NC");

  // ── 4. Guardar ──
  /** PDF de la factura / NC al Storage (si falla, el comprobante ya quedó: no se avisa). */
  async function subirArchivo(facturaId: string) {
    if (!archivo) return;
    const path = `${sociedadId}/${facturaId}/factura.${archivo.name.split(".").pop() || "pdf"}`;
    const { error: upErr } = await supabase.storage.from("facturas-compra").upload(path, archivo, { upsert: true });
    if (upErr) return;
    const { data: u } = supabase.storage.from("facturas-compra").getPublicUrl(path);
    if (u?.publicUrl) await db.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: archivo.name }).eq("id", facturaId);
  }

  // Nota de crédito: sin pago; queda como crédito en la cuenta corriente del proveedor (se usa al pagarle).
  async function guardarNC() {
    if (!factura || !proveedor) return;
    const numero = factura.numero.trim();
    setGuardando(true); setError("");
    try {
      if (!ncKey.current) ncKey.current = crypto.randomUUID();
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const items = factura.items.length ? factura.items.map(it => ({ codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, descuento_porcentaje: it.descuento_porcentaje, unidad: it.unidad, iva_porcentaje: it.iva_porcentaje }))
        : [{ codigo: null, descripcion: "Nota de crédito (sin detalle de artículos)", cantidad: 1, precio_unitario: num(netoTxt), descuento_porcentaje: 0, unidad: "UN", iva_porcentaje: iva }];
      const notas = [notaPago.trim() ? `Nota para Finanzas: ${notaPago.trim()}` : "", "Cargada con «Compras Lazza» (sin OC)"].filter(Boolean).join("\n");
      const { data, error: e } = await db.rpc("registrar_nota_credito_compra_v2", {
        p_sociedad_id: sociedadId, p_request_key: ncKey.current,
        p_factura: {
          numero_factura: numero, tipo_comprobante: factura.tipo, proveedor_id: proveedor.id, fecha: factura.fecha || todayAR(),
          subtotal: num(netoTxt), iva_porcentaje: factura.ivaPorcentaje, iva: ivaFactura, percepciones: percepcionesFactura, total: factura.total,
          moneda: factura.moneda, tipo: "mercaderia", notas, cae: factura.cae || null,
        },
        p_items: items, p_aplicaciones: [],
      });
      if (e) throw new Error(e.message);
      if (!data?.factura_compra_id) throw new Error("La base no confirmó la nota de crédito. No se guardó nada.");
      await subirArchivo(data.factura_compra_id);
      toast.success(`✔ ${factura.tipo} ${numero} cargada · queda como crédito de ${proveedor.razon_social}`);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(`No se pudo guardar la nota de crédito: ${e?.message || "error"}`);
    } finally { setGuardando(false); }
  }

  async function guardar() {
    if (!factura || !proveedor) return;
    if (!factura.numero.trim()) { setError("Falta el número de la factura."); return; }
    if (esNC) return guardarNC();
    if (conVisa === null) { setFaltaElegirPago(true); return; }
    setGuardando(true); setError("");
    const numero = factura.numero.trim();
    try {
      // Sin OC (Augusto 19/10): la factura va a la cuenta corriente del proveedor. No se toca ningún costo.
      // Sin artículos leídos, un renglón "Factura sin detalle" con el neto.
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const items = factura.items.length
        ? factura.items.map((it, i) => ({ key: lineKey(factura, i), ...it }))
        : [{ key: "fc", codigo: "", descripcion: "Factura (sin detalle de artículos)", cantidad: 1, precio_unitario: num(netoTxt), descuento_porcentaje: 0, iva_porcentaje: iva, unidad: "UN" }];
      const notas = [
        pagaVisa ? "" : textoPago,
        notaPago.trim() ? `Nota para Finanzas: ${notaPago.trim()}` : "",
        "Cargada con «Compras Lazza»",
      ].filter(Boolean).join("\n");
      const { data, error: eRpc } = await db.rpc("guardar_conciliacion_compra", {
        p_sociedad_id: sociedadId, p_factura_id: null,
        p_factura: {
          proveedor_id: proveedor.id, numero_factura: numero, tipo_comprobante: factura.tipo, fecha: factura.fecha,
          fecha_vencimiento: pagaVisa ? factura.vencimiento || null : vencimientoPorDias(factura.fecha, dias, factura.vencimiento), cae: factura.cae || null, moneda: factura.moneda, subtotal: num(netoTxt),
          iva: ivaFactura, iva_porcentaje: factura.ivaPorcentaje, percepciones: percepcionesFactura, total: factura.total, notas,
        },
        // Sin OC: no se tocan los costos de la OC ni del PR.
        p_items: items, p_asignaciones: [], p_borrador: false, p_aceptar_costos: false, p_equivalencias: [], p_confirmar: true,
      });
      if (eRpc) throw new Error(eRpc.message);
      const facturaId = data?.factura_compra_id as string;

      // d) PDF y pago (si algo de esto falla, la factura ya quedó: solo se avisa).
      if (facturaId) await subirArchivo(facturaId);
      let pagoTxt = "va a Pagos";
      if (facturaId && pagaVisa) {
        const visa = tarjetaSugerida(await traerTarjetas(db, sociedadId), { ocConTarjeta: true });
        const r = visa ? await registrarPagoTarjeta(db, facturaId, visa, movimientoPagoTarjeta({
          sociedadId, proveedorId: proveedor.id, facturaId, tarjeta: visa, total: factura.total, moneda: factura.moneda, fecha: factura.fecha || todayAR(),
          comprobante: `${factura.tipo} ${numero}`, proveedorNombre: proveedor.razon_social,
        })) : { error: "no hay ninguna tarjeta cargada" };
        if (r.error) { toast.warning(`No se pudo registrar el pago con Visa (${r.error}): la factura quedó para Pagos.`); await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion"); }
        else pagoTxt = `pagada con ${visa!.nombre}`;
      } else if (facturaId) {
        await db.from("facturas_compra").update({ estado: "pendiente" }).eq("id", facturaId).eq("estado", "pendiente_aprobacion");
      }
      toast.success([`✔ FC ${numero} cargada`, pagoTxt].join(" · "));
      if (data?.aviso) toast.warning(String(data.aviso));
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  // ── Pantalla ──
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && !leyendo && !guardando) void leer(f); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Cargar factura <span className="text-sm font-normal text-zinc-500">· Compras Lazza</span></h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {!factura && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 p-8 text-sm text-zinc-500 hover:border-orange-400 dark:border-zinc-600">
            {leyendo ? <span className="flex items-center gap-2 text-orange-600"><Loader2 className="h-5 w-5 animate-spin" /> Leyendo la factura…</span>
              : <><FileUp className="h-6 w-6 text-orange-500" /> Arrastrá la factura acá o hacé clic para elegirla (PDF o foto)</>}
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={leyendo || leyendoIA}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void leer(f); }} />
          </label>
        )}
        {!factura && noSeLeyo && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" /> El sistema no pudo leer «{archivo?.name}» solo (sin QR ni texto).
            <button onClick={() => void leerConIA()} disabled={leyendoIA} className="ml-auto inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white">
              {leyendoIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Leer con IA
            </button>
          </div>
        )}

        {factura && (
          <div className="space-y-3">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
              <b>{factura.tipo}</b>
              <input value={factura.numero} onChange={e => setFactura({ ...factura, numero: e.target.value })} placeholder="Número" className="w-36 rounded border border-zinc-300 bg-white px-1.5 py-0.5 font-semibold dark:border-zinc-600 dark:bg-zinc-900" />
              <span className="text-zinc-500">{formatDate(factura.fecha || todayAR())}</span>
              <span className="font-medium">{proveedor?.razon_social || factura.razonSocialLeida || "Proveedor"}</span>
              <span className="text-xs text-zinc-500">CUIT {factura.cuit || "?"}</span>
              <button onClick={() => { reiniciar(); setArchivo(null); }} disabled={guardando} className="ml-auto text-xs text-zinc-500 underline">Otra factura</button>
            </div>
            {/* Augusto 19/10: ver la información de la factura (tipo, número, neto, IVA, percepciones, total). */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([["Neto", num(netoTxt)], [`IVA${factura.ivaPorcentaje ? ` ${String(factura.ivaPorcentaje).replace(".", ",")} %` : ""}`, ivaFactura],
                [`Percepciones${impuestos.percepcionEstimada ? " (calculadas)" : ""}`, percepcionesFactura], ["Total", factura.total]] as const).map(([t, v]) => (
                <div key={t} className="rounded-lg border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                  <p className="text-[11px] text-zinc-500">{t}</p>
                  <p className={`text-sm ${t === "Total" ? "font-bold" : "font-medium"}`}>{plata(v)}</p>
                </div>
              ))}
            </div>
            {/* Artículos: opcionales. El sistema (sin IA) no los lee; con IA sí. */}
            {origen === "ia" && factura.items.length > 0 ? (
              <details className="rounded-lg border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700">
                <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">✨ Leída con IA · {factura.items.length} artículo(s)</summary>
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                  {factura.items.map((it, i) => (
                    <li key={i} className="flex gap-2"><b>{cant(it.cantidad)}</b> × <span className="flex-1">{it.descripcion}</span><span className="text-zinc-500">{plata(it.precio_unitario)}</span></li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{origen === "ia" ? "✨ Leída con IA · sin artículos" : "Leída por el sistema (sin IA)"}</span>
                {origen !== "ia" && <>Para ver los artículos, tocá
                  <button onClick={() => void leerConIA()} disabled={leyendoIA || guardando} className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40">
                    {leyendoIA ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Leer con IA
                  </button></>}
              </p>
            )}
            {otraSociedad && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Está a nombre de {otraSociedad}: cargala desde esa sociedad.</p>}
            {duplicada && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {esNC ? "Esta nota de crédito" : "Esta factura"} ya está cargada en el sistema.</p>}
            {esNota && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Es una nota de débito: esta pantalla es para facturas y notas de crédito.</p>}
            {!proveedor && !esNota && buscandoProv && (
              <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando proveedor…</p>
            )}
            {!proveedor && !esNota && !buscandoProv && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> {factura.cuit ? `El proveedor CUIT ${factura.cuit} no está cargado.` : "No se leyó el CUIT del proveedor."}
                {factura.cuit && <button onClick={() => setCrearProv(true)} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white"><UserPlus className="h-3.5 w-3.5" /> Crear proveedor</button>}
              </div>
            )}

            {/* Nota de crédito: a la cuenta corriente del proveedor */}
            {listo && esNC && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Nota de crédito: va a la cuenta corriente de <b>{proveedor!.razon_social}</b> como crédito (se usa al pagarle).
              </p>
            )}

            {listo && !esNC && (
              <p className="text-xs text-zinc-600 dark:text-zinc-300">La factura va directo a la cuenta corriente de <b>{proveedor!.razon_social}</b> (no se ata a ninguna OC).</p>
            )}

            {listo && !esNC && (
              <div className={`flex flex-wrap items-center gap-3 rounded-lg px-2 py-1 text-sm ${faltaElegirPago && conVisa === null ? "border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : ""}`}>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">¿Cómo se paga?</span>
                <label className="flex items-center gap-1"><input type="radio" checked={conVisa === false} onChange={() => setConVisa(false)} /> Va a Pagos</label>
                <label className="flex items-center gap-1"><input type="radio" checked={conVisa === true} onChange={() => setConVisa(true)} /> <CreditCard className="h-4 w-4 text-blue-600" /> Ya pagada con Visa</label>
                {visaSugerida && conVisa === null && <span className="text-xs text-zinc-500">(Mercado Libre: ¿se pagó con tarjeta?)</span>}
                {faltaElegirPago && conVisa === null && <span className="text-xs font-semibold text-red-600">Elegí cómo se paga</span>}
              </div>
            )}
            {listo && !esNC && conVisa === false && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Para Pagos</span>
                {(["transferencia", "echeq"] as const).map(f => (
                  <button key={f} onClick={() => { setForma(f); setDiasTxt(null); }} className={`${btnNo} ${formaPago === f ? elegido : ""}`}>{f === "echeq" ? "eCheq" : "Transferencia"}</button>
                ))}
                <span className="ml-2 text-xs text-zinc-500">a</span>
                <input value={dias} onChange={e => setDiasTxt(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0" aria-label="Días"
                  className="w-12 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-right dark:border-zinc-600 dark:bg-zinc-900" />
                <span className="text-xs text-zinc-500">días</span>
                {DIAS_RAPIDOS.map(d => <button key={d} onClick={() => setDiasTxt(String(d))} className={`rounded px-1.5 py-0.5 text-xs ${dias === String(d) ? "bg-violet-600 text-white" : "text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}>{d}</button>)}
                {vencePago && <span className="text-xs text-zinc-500">vence {vencePago.split("-").reverse().join("/")}</span>}
              </div>
            )}
            {listo && (faltaEmail || (faltaBanco && !pagaVisa && !esNC)) && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-amber-700 dark:text-amber-400">A {proveedor!.razon_social} le falta {[faltaEmail && "el email", faltaBanco && !pagaVisa && !esNC && "los datos bancarios"].filter(Boolean).join(" y ")}:</span>
                {faltaEmail && <input value={emailProv} onChange={e => setEmailProv(e.target.value)} placeholder="Email" type="email"
                  className="w-48 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-900" />}
                {faltaBanco && !pagaVisa && !esNC && <input value={bancoProv} onChange={e => setBancoProv(e.target.value)} placeholder="CBU o alias"
                  className="w-56 rounded border border-zinc-300 bg-white px-1.5 py-0.5 dark:border-zinc-600 dark:bg-zinc-900" />}
                <button onClick={() => void guardarDatosProveedor()} disabled={guardandoProv || !(emailProv.trim() || bancoProv.trim())} className={`${btnSi} disabled:opacity-40`}>
                  {guardandoProv ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Guardar en el proveedor"}
                </button>
              </div>
            )}
            {listo && (
              <input value={notaPago} onChange={e => setNotaPago(e.target.value)} placeholder="Nota para Finanzas (opcional)"
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900" />
            )}
            {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={onClose} disabled={guardando} className="rounded-lg border px-4 py-2 text-sm dark:border-zinc-600">Cancelar</button>
              <button onClick={() => void guardar()} disabled={!listo || guardando || leyendoIA}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {esNC ? "Guardar NC" : "Guardar"}
              </button>
            </div>
          </div>
        )}
        {error && !factura && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      </div>

      <ProveedorFormModal open={crearProv} proveedorId={null} consultarArcaAlAbrir
        inicial={{ cuit: factura?.cuit || "", razon_social: factura?.razonSocialLeida || "", nombre_fantasia: factura?.nombreFantasiaLeido || "" }}
        subtitulo="Se guarda y queda elegido en esta factura."
        onClose={() => setCrearProv(false)}
        onSaved={row => { setCrearProv(false); if (factura) void elegirProveedor({ id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string }, factura); }} />
    </div>
  );
}
