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
 * 4b. Saldo a favor: NO va acá (Augusto 27/10: esta ventana es solo para cargar facturas). Se ve en la cuenta corriente y al pagar.
 * 4c. Carga a mano (sin archivo): "Cargar a mano" en la pantalla de arranque. Se elige el proveedor, tipo, número, fecha, neto, IVA,
 *    percepciones y total (el total se arma solo y se puede corregir); el PDF se puede adjuntar o no. Del pago para abajo es igual.
 * 5. Nota de crédito: sin forma de pago; va a la cuenta corriente del proveedor como crédito
 *    (registrar_nota_credito_compra_v2, la misma de Finanzas). La nota de débito no se carga acá.
 * 6. Flete (Augusto 29/10): «Es: Compra / Transporte». Se sugiere Transporte si el proveedor es transportista, si su última
 *    factura fue de transporte o si los renglones son flete; se cambia a mano. Transporte cuenta en Transportes (Gastos y Reportes).
 * 7. Pestaña Mercado Libre (Augusto 30/10): abre esta misma ventana con "Ya pagada con Visa" elegido y, al guardar, la une a los
 *    artículos elegidos (onGuardada → unir_factura_mercado_libre). Si la unión falla, la factura ya quedó cargada.
 *    Si el vendedor no está cargado, no se pide crearlo: se crea solo al guardar con los datos de ARCA (vendedorML).
 * Guardar usa guardar_conciliacion_compra (la de siempre), sin OC, sin aceptar costos ni aprender equivalencias.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { useToast } from "@/components/ui/toast";
import { ProveedorFormModal } from "@/components/proveedor-form-modal";
import { EVENTO_FACTURAS_COMPRA } from "@/components/carga-masiva-global";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { facturaDesdeDatos, lineKey, type FacturaCarga, type ItemFactura } from "@/lib/factura-compra-leida";
import { leerFacturaLocal } from "@/lib/leer-factura-local";
import { traerTarjetas, tarjetaSugerida, registrarPagoTarjeta, movimientoPagoTarjeta } from "@/lib/pago-tarjeta";
import { cant } from "@/lib/cargar-factura";
import { ivaYPercepciones, netoFactura, tipoNotaCredito, vencimientoPorDias } from "@/lib/compras-lazza";
import { Autocompletar } from "@/components/ui/autocompletar";
import { AlertTriangle, Check, CreditCard, FileUp, Loader2, Sparkles, UserPlus, X } from "lucide-react";
import { linkArchivo } from "@/lib/archivo-link";
import { sugerenciaTransporte } from "@/lib/factura-tipo";
import { vendedorML } from "@/lib/mercado-libre-compras";

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
/** Comprobante interno cuando el proveedor no hace factura (mismo formato que los ya cargados: tipo "FC Manual", sin IVA). */
const TIPO_SIN_FACTURA = "FC Manual";
const numeroSinFactura = (fecha: string) => `SIN FACTURA ${String(fecha || todayAR()).split("-").reverse().join("/")}`;
const esNumeroSinFactura = (n: string) => /^SIN FACTURA/i.test(n.trim());
/** Factura C / NC C (monotributo) y comprobante "Sin factura": no discriminan IVA. */
const tipoSinIva = (t: string) => t === TIPO_SIN_FACTURA || /\sC$/i.test(t);
const renglonVacio = (iva = 21): ItemFactura => ({ codigo: "", descripcion: "", cantidad: 1, precio_unitario: 0, descuento_porcentaje: 0, iva_porcentaje: iva, unidad: "UN" });
const netoRenglon = (it: ItemFactura) => round2((Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) * (1 - (Number(it.descuento_porcentaje) || 0) / 100));
const esMercadoLibre = (t: string | null | undefined) => /mercado\s*libre/i.test(String(t || ""));
const COLS_PROVEEDOR = "id, razon_social, cuit, talles_especiales, medio_pago_preferido, plazo_cheque_dias, dias_pago, email, cbu, alias_bancario, es_transportista";

type Proveedor = { id: string; razon_social: string; cuit: string | null; talles_especiales?: string[] | null; medio_pago_preferido?: string | null; plazo_cheque_dias?: number | null; dias_pago?: number | null; email?: string | null; cbu?: string | null; alias_bancario?: string | null; es_transportista?: boolean | null };
type FormaPago = "transferencia" | "echeq";
const DIAS_RAPIDOS = [0, 15, 30, 45, 60];
const btnSi = "rounded-md bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700";
const btnNo = "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800";
const elegido = "ring-2 ring-violet-400";

export default function ComprasLazzaFactura({ sociedadId, onClose, conVisaInicial, para, onGuardada, tipoInicial, archivoInicial }: {
  sociedadId: string;
  onClose: () => void;
  /** Pestaña Mercado Libre (Augusto 30/10): arranca con "Ya pagada con Visa" elegido (se puede cambiar). */
  conVisaInicial?: boolean;
  /** Pestaña Mercado Libre: para qué artículo(s) es la factura (se muestra arriba). */
  para?: string;
  /** Pestaña Mercado Libre: al guardar la factura, se une a los artículos elegidos. */
  onGuardada?: (facturaId: string) => Promise<void>;
  /** Desde Transportes (Augusto 30/10): arranca con este tipo elegido ("transporte"); se puede cambiar. Sin esto, se avisa si el proveedor es transportista. */
  tipoInicial?: "mercaderia" | "transporte";
  /** Pestaña Mercado Libre, varias facturas juntas (Seba 02/11): arranca leyendo este archivo. */
  archivoInicial?: File;
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
  // Pestaña Mercado Libre (Seba 02/11): la factura ya cargada que se repite, para unirla sin cargarla de nuevo.
  const [dupId, setDupId] = useState<string | null>(null);
  const [proveedor, setProveedor] = useState<Proveedor | null>(null);
  const proveedorElegido = proveedor;
  // Mientras se busca el proveedor por CUIT no se muestra "no está cargado" (salía un instante y se corregía solo).
  const [buscandoProv, setBuscandoProv] = useState(false);
  const [crearProv, setCrearProv] = useState(false);
  const [netoTxt, setNetoTxt] = useState("");
  // Augusto 19/10: arranca sin nada elegido y hay que elegir (las pagadas con tarjeta se marcan al cargarlas).
  const [conVisa, setConVisa] = useState<boolean | null>(conVisaInicial ?? null);
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
  const [provsLista, setProvsLista] = useState<Proveedor[]>([]);
  const [percTxt, setPercTxt] = useState("");
  const [totalTxt, setTotalTxt] = useState("");
  // Cambia al sacar/agregar renglones: los campos de texto de la tabla se rearman con los valores nuevos.
  const [filasKey, setFilasKey] = useState(0);
  // Compra o Transporte (null = lo sugerido). ultimoTipo = tipo de la última factura del proveedor.
  const [tipoElegido, setTipoElegido] = useState<"mercaderia" | "transporte" | null>(tipoInicial ?? null);
  const [ultimoTipo, setUltimoTipo] = useState<string | null>(null);
  // Pestaña Mercado Libre: el vendedor que no está cargado se busca en ARCA y se crea solo al guardar.
  const deMercadoLibre = !!para;
  const [vendedorArca, setVendedorArca] = useState<{ razon_social?: string | null; condicion_iva?: string | null } | null>(null);
  const arcaVendedor = useRef<Promise<{ razon_social?: string | null; condicion_iva?: string | null } | null> | null>(null);

  const plata = (n: number) => formatCurrency(n, factura?.moneda || "ARS");
  useEffect(() => { void (async () => { await empezarManual(); if (archivoInicial) await leer(archivoInicial); })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── 1. Leer (sistema primero; IA opcional) ──
  function reiniciar() {
    ncKey.current = null;
    setError(""); setFactura(null); setProveedor(null); setBuscandoProv(false);
    setConVisa(conVisaInicial ?? null); setFaltaElegirPago(false); setForma(null); setDiasTxt(null); setNotaPago(""); setDuplicada(false); setEsNota(false); setOtraSociedad(""); setNoSeLeyo(false); setOrigen("");
    setPercTxt(""); setTotalTxt(""); setTipoElegido(tipoInicial ?? null); setUltimoTipo(null); setVendedorArca(null); arcaVendedor.current = null;
  }

  async function leer(file: File) {
    setError(""); setNoSeLeyo(false); setArchivo(file); setLeyendo(true);
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

  async function empezarManual() {
    reiniciar(); setArchivo(null);
    setFactura({ localId: `m${Date.now()}`, dbId: null, file: null, archivoNombre: "", numero: "", tipo: "FC A", fecha: todayAR(), vencimiento: "", cae: "", moneda: "ARS",
      subtotal: 0, iva: 0, ivaPorcentaje: 21, percepciones: 0, total: 0, items: [renglonVacio()], cuit: "" });
    setNetoTxt("");
    if (!provsLista.length) {
      const { data: ps } = await db.from("proveedores").select(COLS_PROVEEDOR).eq("sociedad_id", sociedadId).eq("activo", true).order("razon_social");
      setProvsLista((ps || []) as Proveedor[]);
    }
  }

  /** Carga a mano: renglones como en una factura (cantidad × precio, descuento, IVA por renglón). Neto, IVA y total se arman solos; las percepciones y el total se pueden corregir. */
  function cambiarManual(c: { items?: ItemFactura[]; perc?: string; total?: string; tipo?: string; numero?: string; fecha?: string }) {
    if (!factura) return;
    const items = c.items ?? factura.items;
    const neto = round2(items.reduce((a, it) => a + netoRenglon(it), 0));
    const iva = round2(items.reduce((a, it) => a + round2(netoRenglon(it) * (Number(it.iva_porcentaje) || 0) / 100), 0));
    const perc = c.perc != null ? num(c.perc) : factura.percepciones;
    const total = c.total != null ? num(c.total) : round2(neto + iva + perc);
    setNetoTxt(neto ? aTexto(neto) : "");
    if (c.perc != null) setPercTxt(c.perc);
    setTotalTxt(c.total != null ? c.total : total ? aTexto(total) : "");
    setFactura({ ...factura, items, subtotal: neto, iva, percepciones: perc, total, ivaPorcentaje: Number(items[0]?.iva_porcentaje ?? factura.ivaPorcentaje),
      ...(c.tipo != null ? { tipo: c.tipo } : {}), ...(c.numero != null ? { numero: c.numero } : {}), ...(c.fecha != null ? { fecha: c.fecha } : {}) });
  }
  function cambiarRenglon(i: number, cambio: Partial<ItemFactura>) {
    if (factura) cambiarManual({ items: factura.items.map((it, k) => k === i ? { ...it, ...cambio } : it) });
  }

  /** Cambia el tipo en la carga a mano: "Sin factura" va sin IVA y con número SIN FACTURA dd/mm/aaaa; al volver a una factura se limpia. */
  function cambiarTipoManual(tipo: string) {
    if (!factura) return;
    const aSin = tipo === TIPO_SIN_FACTURA, deSin = factura.tipo === TIPO_SIN_FACTURA;
    const items = tipoSinIva(tipo) !== tipoSinIva(factura.tipo) ? factura.items.map(it => ({ ...it, iva_porcentaje: tipoSinIva(tipo) ? 0 : 21 })) : factura.items;
    const numero = aSin ? (esNumeroSinFactura(factura.numero) || !factura.numero.trim() ? numeroSinFactura(factura.fecha) : factura.numero) : deSin && esNumeroSinFactura(factura.numero) ? "" : factura.numero;
    cambiarManual({ tipo, items, numero });
  }

  async function usarDatos(file: File, d: any, como: "sistema" | "ia") {
    const leida = facturaDesdeDatos(file, d);
    const nc = tipoNotaCredito(d.tipo_comprobante);
    const tipo = nc ?? leida.tipo;
    // Factura/NC C (monotributo): no discrimina IVA. Sin esto el QR (solo trae el total) se completaba con 21 % (FC C de Nadia, 23/10/2026).
    const sinIva = tipoSinIva(tipo);
    const pct = sinIva ? 0 : leida.ivaPorcentaje;
    let items = leida.items.map(it => ({ ...it, iva_porcentaje: sinIva ? 0 : it.iva_porcentaje }));
    const netoEst = leida.subtotal > 0 ? leida.subtotal : netoFactura({ subtotal: 0, total: leida.total, ivaPorcentaje: pct, percepciones: leida.percepciones }).neto;
    const imp = sinIva ? { iva: 0, percepciones: leida.percepciones } : ivaYPercepciones({ total: leida.total, neto: netoEst, iva: leida.iva, percepciones: leida.percepciones, ivaPorcentaje: pct });
    if (!items.length) items = [{ ...renglonVacio(pct), precio_unitario: netoEst }]; // sin renglones (QR o texto): uno solo con el neto, editable
    const neto = round2(items.reduce((a, it) => a + netoRenglon(it), 0));
    const total = leida.total > 0 ? leida.total : round2(neto + imp.iva + imp.percepciones);
    const f: FacturaCarga = { ...leida, tipo, items, subtotal: neto, iva: imp.iva, percepciones: imp.percepciones, total, ivaPorcentaje: pct };
    const buscar = f.cuit.length === 11 && !(proveedor && digitos(proveedor.cuit) === f.cuit);
    if (buscar) { setProveedor(null); setBuscandoProv(true); } // así no aparece "no está cargado" mientras busca
    setFactura(f); setOrigen(como); setFilasKey(k => k + 1);
    setNetoTxt(neto ? aTexto(neto) : ""); setPercTxt(imp.percepciones ? aTexto(imp.percepciones) : ""); setTotalTxt(total ? aTexto(total) : "");
    setEsNota(!nc && /D[EÉ]BITO|^N\.?\s?D\b/i.test(String(d.tipo_comprobante || "")));
    const soc = SOCIEDAD_POR_CUIT[digitos(d.cuit_receptor)];
    setOtraSociedad(soc && soc.id !== sociedadId ? soc.nombre : "");
    if (!buscar) return; // releída con IA: mismo proveedor
    try {
      const { data: ps } = await db.from("proveedores").select(COLS_PROVEEDOR).eq("sociedad_id", sociedadId).eq("activo", true);
      const p = ((ps || []) as Proveedor[]).find(x => digitos(x.cuit) === f.cuit);
      if (p) await elegirProveedor(p, f);
      else if (deMercadoLibre) {
        const promesa = fetch(`/api/cuit-lookup?cuit=${f.cuit}`).then(r => r.ok ? r.json() : null).then(d => d && !d.error ? d : null).catch(() => null);
        arcaVendedor.current = promesa;
        void promesa.then(d => { if (arcaVendedor.current === promesa) setVendedorArca(d); }); // si se leyó otra factura, no se pisa
      }
    } finally { setBuscandoProv(false); }
  }

  // ── 2. Proveedor (y aviso si la factura ya está cargada) ──
  async function elegirProveedor(p: Proveedor, f: FacturaCarga) {
    const { data: dups } = await db.from("facturas_compra").select("id, numero_factura, tipo_comprobante, tipo, created_at").eq("sociedad_id", sociedadId).eq("proveedor_id", p.id).neq("estado", "anulada");
    const ultima = [...(dups || [])].filter((x: any) => !String(x.tipo_comprobante || "").startsWith("NC")).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    setUltimoTipo(ultima?.tipo ?? null); setTipoElegido(tipoInicial ?? null);
    const norm = (n: string) => { const m = String(n || "").replace(/\s+/g, "").match(/^(\d{1,5})[-/](\d{1,8})$/); return m ? `${m[1].padStart(5, "0")}-${m[2].padStart(8, "0")}` : String(n || "").replace(/\s+/g, "").toUpperCase(); };
    const repetida = f.numero ? (dups || []).find((x: any) => norm(x.numero_factura) === norm(f.numero) && String(x.tipo_comprobante || "FC A").toUpperCase() === f.tipo.toUpperCase()) : null;
    setDuplicada(!!repetida); setDupId(repetida?.id ?? null);
    // Sin factura: si ya hay una del mismo proveedor y día, el número sigue con (2), (3)…
    if (f.tipo === TIPO_SIN_FACTURA && esNumeroSinFactura(f.numero)) {
      const usados = new Set((dups || []).filter((x: any) => String(x.tipo_comprobante || "").toUpperCase() === f.tipo.toUpperCase()).map((x: any) => norm(x.numero_factura)));
      const base = numeroSinFactura(f.fecha); let nuevo = base; for (let i = 2; usados.has(norm(nuevo)); i++) nuevo = `${base} (${i})`;
      if (nuevo !== f.numero) { setFactura(prev => prev ? { ...prev, numero: nuevo } : prev); setDuplicada(false); }
    }
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
  // IVA y percepciones: los de la ventana (al leer el QR se calculan en usarDatos: IVA = neto × alícuota y lo que sobra son percepciones, ej. IIBB).
  const impuestos = factura ? { iva: factura.iva, percepciones: factura.percepciones } : { iva: 0, percepciones: 0 };
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
  const vendedorNuevo = deMercadoLibre && !!factura && !proveedor && !buscandoProv && !esNota && factura.cuit.length === 11;
  const datosVendedor = vendedorNuevo ? vendedorML({ cuit: factura!.cuit, tipo: factura!.tipo, arca: vendedorArca, leido: factura!.razonSocialLeida }) : null;
  const nombreProveedor = proveedor?.razon_social ?? datosVendedor?.razon_social ?? "";
  const listo = !!factura && (!!proveedor || vendedorNuevo) && !esNota && factura.total > 0;
  const esNC = !!factura && factura.tipo.startsWith("NC");
  const motivoTransporte = proveedor && factura ? sugerenciaTransporte({ esTransportista: proveedor.es_transportista, ultimoTipo, descripciones: factura.items.map(it => it.descripcion) }) : null;
  const tipoFactura = tipoElegido ?? (motivoTransporte ? "transporte" : "mercaderia");

  // ── 4. Guardar ──
  /** PDF de la factura / NC al Storage (si falla, el comprobante ya quedó: no se avisa). */
  async function subirArchivo(facturaId: string) {
    if (!archivo) return;
    const path = `${sociedadId}/${facturaId}/factura.${archivo.name.split(".").pop() || "pdf"}`;
    const { error: upErr } = await supabase.storage.from("facturas-compra").upload(path, archivo, { upsert: true });
    if (upErr) return;
    const u = { publicUrl: linkArchivo("facturas-compra", path) };
    if (u?.publicUrl) await db.from("facturas_compra").update({ archivo_url: u.publicUrl, archivo_nombre: archivo.name }).eq("id", facturaId);
  }

  /** Vendedor de Mercado Libre que no está cargado: si ya existe con ese CUIT (aunque esté inactivo) se usa; si no, se crea. */
  async function crearVendedorML(): Promise<Proveedor> {
    const arca = vendedorArca ?? (arcaVendedor.current ? await arcaVendedor.current : null);
    const datos = vendedorML({ cuit: factura!.cuit, tipo: factura!.tipo, arca, leido: factura!.razonSocialLeida });
    const conGuiones = `${datos.cuit.slice(0, 2)}-${datos.cuit.slice(2, 10)}-${datos.cuit.slice(10)}`;
    const { data: ya } = await db.from("proveedores").select(COLS_PROVEEDOR).eq("sociedad_id", sociedadId).in("cuit", [datos.cuit, conGuiones]).limit(1);
    if (ya?.[0]) return ya[0] as Proveedor;
    const { data, error: e } = await db.from("proveedores").insert({ ...datos, sociedad_id: sociedadId, talles_especiales: [], tolerancia_precio_pct: 1 }).select(COLS_PROVEEDOR).single();
    if (e) throw new Error(e.message);
    return data as Proveedor;
  }

  // Nota de crédito: sin pago; queda como crédito en la cuenta corriente del proveedor (se usa al pagarle).
  async function guardarNC(proveedor: Proveedor) {
    if (!factura) return;
    const numero = factura.numero.trim();
    setGuardando(true); setError("");
    try {
      if (!ncKey.current) ncKey.current = crypto.randomUUID();
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const itemsFC = factura.items.filter(it => it.descripcion.trim() && it.cantidad > 0);
      const items = itemsFC.length ? itemsFC.map(it => ({ codigo: it.codigo || null, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, descuento_porcentaje: it.descuento_porcentaje, unidad: it.unidad, iva_porcentaje: it.iva_porcentaje }))
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
    if (!factura || !listo) return;
    if (!factura.numero.trim()) { setError("Falta el número de la factura."); return; }
    if (!esNC && conVisa === null) { setFaltaElegirPago(true); return; }
    let proveedor = proveedorElegido;
    if (!proveedor) {
      setGuardando(true); setError("");
      try { proveedor = await crearVendedorML(); setProveedor(proveedor); }
      catch (e: any) { setError(`No se pudo cargar el vendedor como proveedor: ${e?.message || "error"}`); return; }
      finally { setGuardando(false); }
    }
    if (esNC) return guardarNC(proveedor);
    setGuardando(true); setError("");
    const numero = factura.numero.trim();
    try {
      // Sin OC (Augusto 19/10): la factura va a la cuenta corriente del proveedor. No se toca ningún costo.
      // Sin artículos leídos, un renglón "Factura sin detalle" con el neto.
      const iva = Number(factura.ivaPorcentaje ?? 21);
      const itemsFC = factura.items.filter(it => it.descripcion.trim() && it.cantidad > 0);
      const items = itemsFC.length
        ? itemsFC.map((it, i) => ({ key: lineKey(factura, i), ...it }))
        : [{ key: "fc", codigo: "", descripcion: "Factura (sin detalle de artículos)", cantidad: 1, precio_unitario: num(netoTxt), descuento_porcentaje: 0, iva_porcentaje: iva, unidad: "UN" }];
      const notas = [
        pagaVisa ? "" : textoPago,
        factura.tipo === TIPO_SIN_FACTURA ? "Sin factura del proveedor (comprobante manual)" : "",
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
      // Flete: la factura queda tipo "transporte" (la RPC la guarda como mercadería). Si falla, la factura ya quedó: solo se avisa.
      if (facturaId && tipoFactura === "transporte") {
        const { error: eTipo } = await db.from("facturas_compra").update({ tipo: "transporte" }).eq("id", facturaId);
        if (eTipo) toast.warning(`La factura quedó como Compra, no como Transporte (${eTipo.message}).`);
      }

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
      toast.success([`✔ FC ${numero} cargada`, tipoFactura === "transporte" ? "Transporte" : "", pagoTxt].filter(Boolean).join(" · "));
      if (data?.aviso) toast.warning(String(data.aviso));
      if (facturaId && onGuardada) await onGuardada(facturaId);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally { setGuardando(false); }
  }

  /** Mercado Libre: la factura ya estaba cargada (ej. se sacó de otra OC con la ✕): se une a estos artículos sin cargarla otra vez. */
  async function usarExistente() {
    if (!dupId || !onGuardada) return;
    setGuardando(true); setError("");
    try {
      await onGuardada(dupId);
      window.dispatchEvent(new Event(EVENTO_FACTURAS_COMPRA));
      onClose();
    } catch (e: any) {
      setError(e?.message || "No se pudo unir la factura");
    } finally { setGuardando(false); }
  }

  // ── Pantalla ──
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && !leyendo && !guardando) void leer(f); }}>
      <div className="w-full max-w-4xl rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Cargar factura <span className="text-sm font-normal text-zinc-500">· {para ? `Mercado Libre · ${para}` : "Compras Lazza"}</span></h2>
          <button onClick={onClose} disabled={guardando} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-5 w-5" /></button>
        </div>

        {proveedor?.es_transportista && !tipoInicial && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            <span>Este proveedor es transportista: cargala desde Transportes.</span>
            <a href="/transportes" className="rounded-md bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700">Ir a Transportes</a>
            <span className="text-xs opacity-80">Es un aviso: podés seguir cargándola acá.</span>
          </div>
        )}

        {factura && (
          <div className="space-y-3">
            {(
              <div className="space-y-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`inline-flex cursor-pointer items-center gap-1 rounded-md bg-orange-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600 ${leyendo || leyendoIA || guardando ? "pointer-events-none opacity-60" : ""}`}>
                    {leyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} {leyendo ? "Leyendo…" : "Subir factura (PDF o foto)"}
                    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" disabled={leyendo || leyendoIA || guardando}
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void leer(f); }} />
                  </label>
                  <button onClick={() => void leerConIA()} disabled={!archivo || leyendo || leyendoIA || guardando} title={archivo ? "La IA lee también los renglones" : "Primero subí la factura"}
                    className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                    {leyendoIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Leer con IA
                  </button>
                  {archivo && <span className="text-xs text-zinc-600 dark:text-zinc-300">{archivo.name}{origen === "ia" ? " · ✨ leída con IA" : origen === "sistema" ? " · leída por el sistema" : ""}</span>}
                  {!archivo && <span className="text-xs text-zinc-500">o cargá los datos a mano</span>}
                </div>
                {noSeLeyo && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> El sistema no pudo leer «{archivo?.name}» solo (sin QR ni texto): tocá Leer con IA o cargala a mano.</p>}
                {origen === "sistema" && factura.items.length <= 1 && !factura.items[0]?.descripcion && <p className="text-xs text-zinc-500">Los renglones no vienen en el QR: queda uno solo con el neto. Tocá Leer con IA para traerlos.</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{proveedor ? proveedor.razon_social : "Proveedor"}</span>
                  {proveedor && <span className="text-xs text-zinc-500">CUIT {proveedor.cuit || "?"}</span>}
                  <Autocompletar opciones={provsLista.map(p => ({ valor: p.id, texto: p.razon_social, detalle: p.cuit || undefined }))} placeholder={proveedor ? "Cambiar proveedor…" : "Escribí el proveedor…"} chico className="w-56"
                    onElegir={id => { const p = provsLista.find(x => x.id === id); if (p) { const f = { ...factura, cuit: digitos(p.cuit) }; setFactura(f); void elegirProveedor(p, f); } }} />
                  <button onClick={() => setCrearProv(true)} className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-600"><UserPlus className="h-3 w-3" /> Proveedor nuevo</button>
                  <button onClick={() => void empezarManual()} disabled={guardando} className="ml-auto text-xs text-zinc-500 underline">Otra factura</button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] text-zinc-500">Tipo
                    <select value={factura.tipo} onChange={e => cambiarTipoManual(e.target.value)} className="mt-0.5 block w-36 rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
                      {[...new Set(["FC A", "FC B", "FC C", "NC A", "NC B", "NC C", ...(factura.tipo === TIPO_SIN_FACTURA ? [] : [factura.tipo])])].map(t => <option key={t}>{t}</option>)}
                      <option value={TIPO_SIN_FACTURA}>Sin factura (manual)</option>
                    </select></label>
                  <label className="text-[11px] text-zinc-500">Número
                    <input value={factura.numero} onChange={e => { setFactura({ ...factura, numero: e.target.value }); setDuplicada(false); }}
                      onBlur={() => { if (proveedor && factura.numero.trim()) void elegirProveedor(proveedor, factura); }} placeholder="0001-00001234"
                      className="mt-0.5 block w-36 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></label>
                  <label className="text-[11px] text-zinc-500">Fecha
                    <input type="date" value={factura.fecha} onChange={e => cambiarManual({ fecha: e.target.value, ...(factura.tipo === TIPO_SIN_FACTURA && esNumeroSinFactura(factura.numero) ? { numero: numeroSinFactura(e.target.value) } : {}) })} className="mt-0.5 block rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></label>
                  <label className="text-[11px] text-zinc-500">Moneda
                    <select value={factura.moneda} onChange={e => setFactura({ ...factura, moneda: e.target.value === "USD" ? "USD" : "ARS" })} className="mt-0.5 block w-20 rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">
                      <option>ARS</option><option>USD</option>
                    </select></label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-[11px] text-zinc-500">
                      <th className="px-1 font-normal">Código</th><th className="px-1 font-normal">Descripción</th><th className="px-1 text-right font-normal">Cant.</th><th className="px-1 text-right font-normal">Precio unit.</th>
                      <th className="px-1 text-right font-normal">Dto %</th><th className="px-1 font-normal">IVA %</th><th className="px-1 text-right font-normal">Importe</th><th />
                    </tr></thead>
                    <tbody>
                      {factura.items.map((it, i) => (
                        <tr key={`${filasKey}-${i}`}>
                          <td className="p-0.5"><input value={it.codigo} onChange={e => cambiarRenglon(i, { codigo: e.target.value })} placeholder="Cód." className="w-20 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></td>
                          <td className="p-0.5"><input value={it.descripcion} onChange={e => cambiarRenglon(i, { descripcion: e.target.value })} placeholder="Qué se compró" className="w-full min-w-40 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></td>
                          <td className="p-0.5"><input defaultValue={it.cantidad ? aTexto(it.cantidad) : ""} onChange={e => cambiarRenglon(i, { cantidad: num(e.target.value) })} inputMode="decimal" className="w-16 text-right rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></td>
                          <td className="p-0.5"><input defaultValue={it.precio_unitario ? aTexto(it.precio_unitario) : ""} onChange={e => cambiarRenglon(i, { precio_unitario: num(e.target.value) })} inputMode="decimal" placeholder="0,00" className="w-28 text-right rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></td>
                          <td className="p-0.5"><input defaultValue={it.descuento_porcentaje ? aTexto(it.descuento_porcentaje) : ""} onChange={e => cambiarRenglon(i, { descuento_porcentaje: Math.min(100, num(e.target.value)) })} inputMode="decimal" placeholder="0" className="w-14 text-right rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></td>
                          <td className="p-0.5"><select value={String(it.iva_porcentaje)} onChange={e => cambiarRenglon(i, { iva_porcentaje: Number(e.target.value) })} className="w-16 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100">{["21", "10.5", "27", "0"].map(v => <option key={v} value={v}>{v.replace(".", ",")}</option>)}</select></td>
                          <td className="whitespace-nowrap px-1 text-right">{plata(netoRenglon(it))}</td>
                          <td className="p-0.5"><button onClick={() => { setFilasKey(k => k + 1); cambiarManual({ items: factura.items.length > 1 ? factura.items.filter((_, k) => k !== i) : [renglonVacio(factura.tipo === TIPO_SIN_FACTURA ? 0 : 21)] }); }} title="Sacar renglón" className="rounded p-1 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"><X className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={() => cambiarManual({ items: [...factura.items, renglonVacio(factura.tipo === TIPO_SIN_FACTURA ? 0 : 21)] })} className="mt-1 text-xs font-medium text-orange-600 hover:underline">+ Agregar renglón</button>
                </div>
                <div className="flex flex-wrap items-end justify-end gap-3">
                  <div className="text-[11px] text-zinc-500">Neto<p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{plata(num(netoTxt))}</p></div>
                  <div className="text-[11px] text-zinc-500">IVA<p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{plata(factura.iva)}</p></div>
                  <label className="text-[11px] text-zinc-500">Percepciones<input value={percTxt} onChange={e => cambiarManual({ perc: e.target.value })} inputMode="decimal" placeholder="0,00" className="mt-0.5 block w-28 text-right rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></label>
                  <label className="text-[11px] text-zinc-500">Total<input value={totalTxt} onChange={e => cambiarManual({ total: e.target.value })} inputMode="decimal" placeholder="0,00" className="mt-0.5 block w-32 text-right font-bold rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100" /></label>
                </div>
                {factura.tipo === TIPO_SIN_FACTURA && <p className="text-xs text-zinc-500">Sin factura del proveedor: se carga sin IVA (total = neto) y el número queda «{factura.numero || "SIN FACTURA"}».</p>}
                {/\sC$/i.test(factura.tipo) && factura.iva > 0 && <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Una factura C no discrimina IVA: revisá el IVA de los renglones (debería ser 0).</p>}
                {/\sC$/i.test(factura.tipo) && factura.iva === 0 && <p className="text-xs text-zinc-500">Factura C: no discrimina IVA (total = neto).</p>}
                {factura.total <= 0 && <p className="text-xs text-zinc-500">Completá el neto (o el total) para poder guardar.</p>}
              </div>
            )}
            {otraSociedad && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Está a nombre de {otraSociedad}: cargala desde esa sociedad.</p>}
            {duplicada && <p className="flex flex-wrap items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {esNC ? "Esta nota de crédito" : "Esta factura"} ya está cargada en el sistema.
              {onGuardada && dupId && !esNC && <button onClick={() => void usarExistente()} disabled={guardando} title="No se carga de nuevo: la que ya está queda unida a estos artículos (el pago no cambia)"
                className="ml-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Usar la que ya está</button>}</p>}
            {esNota && <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" /> Es una nota de débito: esta pantalla es para facturas y notas de crédito.</p>}
            {!proveedor && !esNota && buscandoProv && (
              <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Buscando proveedor…</p>
            )}
            {vendedorNuevo && datosVendedor && (
              <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <UserPlus className="h-4 w-4 text-violet-600" /> Vendedor: <b>{datosVendedor.razon_social}</b> (CUIT {factura.cuit}). Se carga solo como proveedor al guardar.
              </p>
            )}
            {!proveedor && !esNota && !buscandoProv && !!factura.cuit && !deMercadoLibre && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> El proveedor CUIT {factura.cuit} no está cargado.
                <button onClick={() => setCrearProv(true)} className="ml-auto inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white"><UserPlus className="h-3.5 w-3.5" /> Crear proveedor</button>
              </div>
            )}

            {/* Nota de crédito: a la cuenta corriente del proveedor */}
            {listo && esNC && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                Nota de crédito: va a la cuenta corriente de <b>{nombreProveedor}</b> como crédito (se usa al pagarle).
              </p>
            )}

            {listo && !esNC && (
              <p className="text-xs text-zinc-600 dark:text-zinc-300">La factura va directo a la cuenta corriente de <b>{nombreProveedor}</b> (no se ata a ninguna OC).</p>
            )}
            {listo && !esNC && (
              <div className="flex flex-wrap items-center gap-1.5 px-2 text-sm">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Es</span>
                {(["mercaderia", "transporte"] as const).map(t => (
                  <button key={t} onClick={() => setTipoElegido(t)} className={`${btnNo} ${tipoFactura === t ? elegido : ""}`}>{t === "transporte" ? "Transporte (flete)" : "Compra"}</button>
                ))}
                {tipoElegido === null && motivoTransporte && <span className="text-xs text-zinc-500">sugerido: {motivoTransporte === "proveedor" ? "el proveedor hace fletes" : "los renglones son flete"}</span>}
                {tipoFactura === "transporte" && <span className="text-xs text-zinc-500">· cuenta en Transportes (Gastos y Reportes)</span>}
              </div>
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
            {listo && !deMercadoLibre && (faltaEmail || (faltaBanco && !pagaVisa && !esNC)) && (
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
        {false && error && !factura && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
      </div>

      <ProveedorFormModal open={crearProv} proveedorId={null} consultarArcaAlAbrir
        inicial={{ cuit: factura?.cuit || "", razon_social: factura?.razonSocialLeida || "", nombre_fantasia: factura?.nombreFantasiaLeido || "" }}
        subtitulo="Se guarda y queda elegido en esta factura."
        onClose={() => setCrearProv(false)}
        onSaved={row => { setCrearProv(false); if (factura) void elegirProveedor({ id: row.id as string, razon_social: row.razon_social as string, cuit: row.cuit as string }, factura); }} />
    </div>
  );
}
