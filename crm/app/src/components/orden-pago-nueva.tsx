"use client";

// Ventana "Nueva Orden de pago" (19/10/2026). Antes vivía adentro de finanzas/page.tsx; se movió TAL CUAL a esta pieza
// para que Finanzas y Finanzas Lazza abran la MISMA ventana (no una copia): retención RG 830 con acumulado del mes,
// NC del proveedor, facturas en US$ pagadas en pesos (BNA divisa), comprobantes leídos con IA, cheques de cartera,
// pago parcial, pago parcial directo y "Guardar y enviar". Se monta al abrir y carga sola lo que necesita.

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CopiarBtn } from "@/components/copiar-btn";
import { FxSettlementDialog } from "@/components/fx-settlement-dialog";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { traerTodo } from "@/lib/paginar";
import { proponerCheques, textoCondicionPago, type FechasChequeMes } from "@/lib/condicion-pago";
import { parsedPaymentForSingleInvoice, paymentDocumentFields } from "@/lib/payment-document-parser";
import { chequeDelComprobante, numeroSinCeros, type ChequeCandidato } from "@/lib/cheque-comprobante-op";
import { canonicalCondicionIva, isKnownCondicionIva, isResponsableInscripto } from "@/lib/fiscal-condition";
import { pctRetencion, reglaPorConcepto } from "@/lib/retencion-conceptos";
import { roundPaymentMoney, sumPaymentMoney } from "@/lib/payment-money";
import { calcularPagoParcial } from "@/lib/op-parcial";
import { pesosDeUsd, brutoPesosDeUsd, cotizacionValida } from "@/lib/op-usd-pesos";
import { diaHabilAnterior } from "@/lib/dias-habiles";
import { parseDecimalInput, toDecimalInput } from "@/lib/decimal-input";
import { claveArchivo, mismoPago, sinRepetir } from "@/lib/comprobante-medios";
import { FileText, Minimize2, Maximize2, X, Search, Loader2, Sparkles, ShieldCheck, Landmark, Plus, Trash2, Paperclip } from "lucide-react";

export interface ProveedorOption {
  id: string;
  razon_social: string;
  // Cómo se le paga (lib/condicion-pago.ts)
  condicion_pago?: string | null;
  dias_pago?: number | null;
  dias_pago_hasta?: number | null;
  medio_pago_preferido?: string | null;
  plazo_cheque_dias?: number | null;
  descuento_pronto_pago?: number | null;
  email?: string | null;
  cuit?: string | null;
  condicion_iva?: string | null;
  alicuota_ganancias?: number | null;
  concepto_retencion_ganancias?: string | null;
  exclusion_retencion?: boolean;
  exclusion_retencion_desde?: string | null;
  exclusion_retencion_hasta?: string | null;
  exclusion_retencion_cert?: string | null;
  forma_pago?: string | null;
  banco?: string | null;
  cbu?: string | null;
  alias_bancario?: string | null;
  numero_cuenta?: string | null;
  titular_cuenta?: string | null;
  cuit_titular_cuenta?: string | null;
  tipo_cuenta?: string | null;
  dias_cuenta_corriente?: number | null;
}

export interface OpMedioPago {
  tempId: string;
  tipo: "cheque" | "cheque_propio" | "deposito" | "transferencia" | "echeq" | "efectivo" | "tarjeta";
  monto: number;
  fecha: string;
  fecha_emision?: string;
  fecha_cobro?: string;
  banco: string;
  /** Texto ingresado cuando se elige el banco "Otro". */
  banco_otro?: string;
  numero_cheque: string;
  moneda: "ARS" | "USD";
  cotizacion: number;
  echeq_id?: string; // if selecting from cartera
  /** Un e-cheq sin id es propio/emitido; los de terceros siempre vienen de cartera. */
  origen_cheque?: "propio" | "cartera";
  /** Siempre deriva del CUIT fiscal del proveedor seleccionado. */
  beneficiario_cuit?: string | null;
  beneficiario_nombre?: string | null;
  comprobante_url?: string;
  comprobante_nombre?: string;
  /** 26/10/2026: el cheque salió del comprobante del banco (texto para mostrar) y, si hace falta, un aviso. */
  cheque_comprobante?: string;
  aviso_cheque?: string;
  /** El selector de cheques queda escondido: solo si se pide "elegir a mano". */
  elegir_a_mano?: boolean;
  /** 26/10/2026: comprobante del que salió (claveArchivo), para no sumarlo dos veces si se vuelve a subir. */
  archivo?: string;
}
const BANCOS_ARGENTINA = [
  "Banco Galicia", "Banco Nación", "Banco Provincia", "Banco Santander",
  "BBVA", "HSBC", "ICBC", "Banco Macro", "Banco Credicoop",
  "Brubank", "Mercado Pago", "Ualá", "Otro",
];
const makeOpMedio = (moneda: "ARS" | "USD" = "ARS"): OpMedioPago => ({
  tempId: Math.random().toString(36).slice(2),
  tipo: "transferencia",
  monto: 0,
  fecha: todayAR(),
  banco: "",
  numero_cheque: "",
  moneda,
  cotizacion: 1,
});

const emptyOPForm = {
  proveedor_id: "",
  moneda: "ARS" as "ARS" | "USD",
  aplica_ganancias: false,
  retencion_ganancias_pct: 0,
  notas: "",
  fecha: todayAR(),
  monto_manual: 0,
  usar_monto_manual: false,
  iva_manual_pct: 21 as number,
  sobre_verde: false,
};

function sumarDiasISO(fecha: string, dias: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const date = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fecha) return null;
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(Number(dias) || 0)));
  return date.toISOString().slice(0, 10);
}

function calcularFechaPactada(fechasFactura: string[], diasPactados: number) {
  const fechaBase = fechasFactura.map(fecha => sumarDiasISO(fecha, 0)).filter((fecha): fecha is string => Boolean(fecha)).sort()[0];
  return fechaBase ? sumarDiasISO(fechaBase, diasPactados) : null;
}


// Cheques que la OP puede usar: de terceros en cartera y propios emitidos pendientes.
interface EcheqOP {
  id: string;
  numero: string;
  tipo_cheque: "echeq" | "fisico";
  banco_emisor: string | null;
  monto: number;
  moneda: "USD" | "ARS";
  estado: string;
  direccion: "emitido" | "recibido" | null;
}

const SELECT_PROVEEDORES_OP = "id, razon_social, email, cuit, condicion_iva, forma_pago, dias_cuenta_corriente, banco, cbu, alias_bancario, numero_cuenta, titular_cuenta, cuit_titular_cuenta, tipo_cuenta, alicuota_ganancias, concepto_retencion_ganancias, exclusion_retencion, exclusion_retencion_desde, exclusion_retencion_hasta, exclusion_retencion_cert, condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago";

export interface OrdenPagoCreada { opId?: string; enviar: boolean }

export function OrdenPagoNueva({ sociedadId, proveedorId, pagoParcialFCId = null, facturaIds, onClose, onCreada }: {
  sociedadId: string;
  /** Proveedor ya elegido (Pagar desde la CC, Vencimientos o facturas de compra). */
  proveedorId?: string;
  /** Pago parcial directo contra una sola factura (no crea OP). */
  pagoParcialFCId?: string | null;
  /** Facturas que vienen tildadas (Finanzas Lazza → Vencimientos). */
  facturaIds?: string[];
  onClose: () => void;
  /** Se llama al registrar: la pantalla cierra la ventana y refresca lo suyo (con enviar, abre el mail de la OP). */
  onCreada: (r: OrdenPagoCreada) => void | Promise<void>;
}) {
  const [opModalFullscreen, setOpModalFullscreen] = useState(false);
  const pagoParcialDirecto = !!pagoParcialFCId;
  // Aviso amarillo de la OP (pago parcial): informa, nunca frena.
  const [opAviso, setOpAviso] = useState("");
  const [opForm, setOpForm] = useState(() => proveedorId ? { ...emptyOPForm, proveedor_id: proveedorId } : emptyOPForm);
  const [opSaving, setOpSaving] = useState(false);
  const opRequestKeyRef = useRef("");
  const [opError, setOpError] = useState("");
  const [opFiles, setOpFiles] = useState<File[]>([]);
  const [opParsingCount, setOpParsingCount] = useState(0);
  const opParsingFile = opParsingCount > 0;
  const [opProvCondicion, setOpProvCondicion] = useState<string | null>(null);
  const [opCondicionLoading, setOpCondicionLoading] = useState(false);
  const [opManualGanancias, setOpManualGanancias] = useState(false); // user manually toggled retención
  const [opMontoRetencionManual, setOpMontoRetencionManual] = useState<number | null>(null); // manual override of retention amount
  // FC pendientes del proveedor para vincular a la OP
  interface OpFCPendiente { id: string; numero: string; tipo_comprobante: string; fecha: string; total: number; subtotal: number; iva: number; percepciones: number; saldo_pendiente: number; moneda: string; selected: boolean; monto_a_pagar: number }
  const [opFCPendientes, setOpFCPendientes] = useState<OpFCPendiente[]>([]);
  // Fechas fijas de cheque de cada mes (Configuración → Fechas de cheque): la OP propone los cheques ahí.
  const [opChequeFechas, setOpChequeFechas] = useState<FechasChequeMes[]>([]);
  // Notas de crédito del proveedor con crédito disponible (se usan en la OP restando del pago)
  interface OpNCDisponible { id: string; numero: string; tipo_comprobante: string; fecha: string; total: number; subtotal: number; disponible: number; moneda: string; selected: boolean; monto_a_aplicar: number }
  const [opNCDisponibles, setOpNCDisponibles] = useState<OpNCDisponible[]>([]);
  const [opMedios, setOpMedios] = useState<OpMedioPago[]>([makeOpMedio()]);
  const [opMonthlyBase, setOpMonthlyBase] = useState(0); // Acumulado mensual de bases sin IVA (de OPs previas)
  // Facturas en US$ se pagan en pesos: cotización BNA divisa vendedor del día hábil anterior al pago (editable).
  const [opCotizacion, setOpCotizacion] = useState("");
  const [opCotizacionBna, setOpCotizacionBna] = useState<{ valor: number; fecha: string } | null>(null);
  const [opCotizacionLoading, setOpCotizacionLoading] = useState(false);
  const opCotizacionEditada = useRef(false);
  const [opDatosError, setOpDatosError] = useState("");
  const [opMonthlyRetenido, setOpMonthlyRetenido] = useState(0); // Retenciones ya practicadas en el mes
  const [opFCLoading, setOpFCLoading] = useState(false);
  const [retencionConfig, setRetencionConfig] = useState({
    aplica_iva: true, minimo_iva: 130000, tasa_iva_ri: 10.5,
    aplica_ganancias: true, minimo_ganancias: 224000, tasa_ganancias_ri: 2, tasa_ganancias_no_inscripto: 28,
    minimo_retencion_ganancias: 240,
  });
  const [proveedoresOptions, setProveedoresOptions] = useState<ProveedorOption[]>([]);
  const [proveedorSearch, setProveedorSearch] = useState("");

  // Lo que la OP necesita y antes cargaba Finanzas: proveedores, fechas de cheque, configuración de retenciones y cheques.
  const [datosListos, setDatosListos] = useState(false);
  const [opCargaAviso, setOpCargaAviso] = useState("");
  const [echeqs, setEcheqs] = useState<EcheqOP[]>([]);
  const [fxPago, setFxPago] = useState<{proveedorId:string; documents:{id:string;numero:string;saldo:number;total:number;subtotal?:number;cotizacion?:number}[]} | null>(null);
  useEffect(() => {
    let cancelled = false;
    const db = supabase as any;
    (async () => {
      const avisos: string[] = [];
      const [prov, fechas, ret, cheq] = await Promise.all([
        db.from("proveedores").select(SELECT_PROVEEDORES_OP).eq("sociedad_id", sociedadId).order("razon_social"),
        db.from("cheque_fechas_mes").select("mes, dias").eq("sociedad_id", sociedadId).gte("mes", `${todayAR().slice(0, 4)}-01-01`),
        db.from("retencion_config").select("*").eq("sociedad_id", sociedadId).maybeSingle(),
        traerTodo<any>(() => db.from("echeqs").select("id, numero, tipo_cheque, banco_emisor, monto, moneda, estado, direccion")
          .eq("sociedad_id", sociedadId).in("estado", ["en_cartera", "pendiente"])
          .order("fecha_pago", { ascending: true }).order("id", { ascending: true })).catch(() => null),
      ]);
      if (cancelled) return;
      if (prov.error) avisos.push("proveedores");
      const lista = (prov.data || []) as ProveedorOption[];
      setProveedoresOptions(lista);
      if (proveedorId) setProveedorSearch(lista.find(p => p.id === proveedorId)?.razon_social || "");
      setOpChequeFechas((fechas.data || []) as FechasChequeMes[]);
      const retCfg = ret.data;
      if (retCfg) setRetencionConfig({
        aplica_iva: retCfg.aplica_iva ?? true,
        minimo_iva: retCfg.minimo_iva ?? 130000,
        tasa_iva_ri: retCfg.tasa_iva_ri ?? 10.5,
        aplica_ganancias: retCfg.aplica_ganancias ?? true,
        minimo_ganancias: retCfg.minimo_ganancias ?? 224000,
        tasa_ganancias_ri: retCfg.tasa_ganancias_ri ?? 2,
        tasa_ganancias_no_inscripto: retCfg.tasa_ganancias_no_inscripto ?? 28,
        minimo_retencion_ganancias: retCfg.minimo_retencion_ganancias ?? 240,
      });
      if (cheq === null) avisos.push("cheques en cartera");
      setEcheqs(((cheq || []) as any[]).map(e => ({ ...e, tipo_cheque: e.tipo_cheque || "echeq" })) as EcheqOP[]);
      if (avisos.length) setOpCargaAviso(`No se pudieron cargar ${avisos.join(" y ")}. Cerrá y volvé a abrir la OP.`);
      setDatosListos(true);
    })().catch((e) => {
      console.error("Orden de pago: carga inicial", e);
      if (!cancelled) { setOpCargaAviso("No se pudieron cargar los datos de la OP. Cerrá y volvé a abrir."); setDatosListos(true); }
    });
    return () => { cancelled = true; };
  }, [sociedadId, proveedorId]);

  // ── OP auto-retenciones ──
  // 1. Cuando cambia el proveedor → consultar AFIP para obtener condición IVA + cargar FC pendientes
  useEffect(() => {
    if (!datosListos) return;
    if (!opForm.proveedor_id) { setOpProvCondicion(null); setOpFCPendientes([]); return; }
    let cancelled = false;
    setOpDatosError("");
    setOpCondicionLoading(false);
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    // Pre-seleccionar medio de pago según forma_pago del proveedor
    if (prov?.forma_pago) {
      const fpMap: Record<string, OpMedioPago["tipo"]> = { Transferencia: "transferencia", Cheque: "cheque", Echeq: "echeq", Efectivo: "efectivo", Tarjeta: "tarjeta" };
      const tipoMedio = fpMap[prov.forma_pago];
      if (tipoMedio && (!pagoParcialDirecto || !["cheque", "cheque_propio", "echeq"].includes(tipoMedio))) {
        setOpMedios(prev => prev.length === 1 && prev[0].monto === 0 ? [{ ...prev[0], tipo: tipoMedio }] : prev);
      }
    }
    // Usar condicion_iva de la DB directamente (fuente de verdad)
    if (prov?.condicion_iva) {
      setOpProvCondicion(prov.condicion_iva);
    } else if (prov?.cuit) {
      // Fallback: CUIT lookup solo si la DB no tiene condicion_iva
      const cuit = prov.cuit.replace(/-/g, "");
      setOpCondicionLoading(true);
      setOpProvCondicion(null);
      fetch(`/api/cuit-lookup?cuit=${cuit}`)
        .then(r => r.json())
        .then(data => { if (!cancelled) setOpProvCondicion(data.condicion_iva ?? ""); })
        .catch(() => { if (!cancelled) setOpProvCondicion(null); })
        .finally(() => { if (!cancelled) setOpCondicionLoading(false); });
    } else {
      setOpProvCondicion(null);
    }
    // Cargar FC pendientes del proveedor + total mensual para ganancias
    setOpFCLoading(true);
    (async () => {
      try {
        // FC pendientes (incluir subtotal/iva/percepciones para base sin IVA — Art. 23 RG 830)
        let q = (supabase as any).from("facturas_compra").select("id, numero_factura, tipo_comprobante, fecha, subtotal, iva, percepciones, total, moneda")
          .eq("proveedor_id", opForm.proveedor_id).in("estado", ["pendiente", "recibida"])
          .not("tipo_comprobante", "ilike", "NC%");
        if (sociedadId) q = q.eq("sociedad_id", sociedadId);
        const { data, error: fcLoadError } = await q;
        if (fcLoadError) throw fcLoadError;

        // Pagos parciales previos: sumar montos ya pagados por FC via op_facturas_compra (excluir OPs anuladas)
        const fcIds = (data || []).map((fc: any) => fc.id);
        let pagadoPorFC: Record<string, number> = {};
        if (fcIds.length > 0) {
          const { data: opfcData, error: linkedLoadError } = await (supabase as any).from("op_facturas_compra").select("factura_compra_id, monto, ordenes_pago(id, estado, sociedad_id)").in("factura_compra_id", fcIds);
          if (linkedLoadError) throw linkedLoadError;
          (opfcData || []).forEach((r: any) => {
            if (sociedadId && r.ordenes_pago?.sociedad_id !== sociedadId) return;
            if (r.ordenes_pago?.estado === "anulada") return; // Skip anulada OPs
            pagadoPorFC[r.factura_compra_id] = (pagadoPorFC[r.factura_compra_id] || 0) + Number(r.monto);
          });
          let qDirect = (supabase as any).from("movimientos").select("factura_compra_id, monto, retencion_ganancias_monto, anulado")
            .in("factura_compra_id", fcIds).eq("tipo", "pago");
          if (sociedadId) qDirect = qDirect.eq("sociedad_id", sociedadId);
          const { data: directData, error: directLoadError } = await qDirect;
          if (directLoadError) throw directLoadError;
          (directData || []).forEach((r: any) => {
            if (!r.anulado) pagadoPorFC[r.factura_compra_id] = (pagadoPorFC[r.factura_compra_id] || 0) + Number(r.monto || 0) + Number(r.retencion_ganancias_monto || 0);
          });
        }

        if (cancelled) return;
        const pendientes = (data || []).map((fc: any) => {
          const pagado = pagadoPorFC[fc.id] || 0;
          const saldo = roundPaymentMoney(Math.max(0, Number(fc.total) - pagado));
          const esDirecta = pagoParcialDirecto && pagoParcialFCId === fc.id;
          // Desde Finanzas Lazza (Vencimientos) la factura elegida viene tildada; se pueden sumar otras.
          const tildada = esDirecta || (!pagoParcialDirecto && !!facturaIds?.includes(fc.id));
          return { id: fc.id, numero: fc.numero_factura || "S/N", tipo_comprobante: fc.tipo_comprobante || "FC", fecha: fc.fecha, total: Number(fc.total), subtotal: Number(fc.subtotal || 0), iva: Number(fc.iva || 0), percepciones: Number(fc.percepciones || 0), saldo_pendiente: saldo, moneda: fc.moneda || "ARS", selected: tildada, monto_a_pagar: tildada ? saldo : 0 };
        }).filter((fc: any) => fc.saldo_pendiente > 0);
        // Cambiar la fecha vuelve a traer el acumulado del mes, pero no borra lo tildado ni lo escrito en «A pagar»
        // (auditoría UX 26/10/2026, arreglo 3). Otro proveedor no tiene facturas en común: arranca de cero.
        setOpFCPendientes((prev) => pendientes.map((p: OpFCPendiente) => {
          const antes = prev.find((x) => x.id === p.id);
          return antes ? { ...p, selected: antes.selected, monto_a_pagar: Math.min(antes.monto_a_pagar, p.saldo_pendiente) } : p;
        }));
        // Sin facturas pendientes: abre directo como pago a cuenta (Augusto 19/10). Se puede apagar.
        if (!pendientes.length && !pagoParcialDirecto) setOpForm(prev => prev.usar_monto_manual ? prev : { ...prev, usar_monto_manual: true, monto_manual: 0 });

        // NC del proveedor con crédito disponible (total − aplicaciones vigentes)
        try {
          let qNC = (supabase as any).from("facturas_compra").select("id, numero_factura, tipo_comprobante, fecha, subtotal, total, moneda")
            .eq("proveedor_id", opForm.proveedor_id).neq("estado", "anulada").ilike("tipo_comprobante", "NC%");
          if (sociedadId) qNC = qNC.eq("sociedad_id", sociedadId);
          const { data: ncData } = await qNC;
          const ncIds = (ncData || []).map((n: any) => n.id);
          const aplicadoPorNC: Record<string, number> = {};
          if (ncIds.length) {
            const { data: ncMovs } = await (supabase as any).from("movimientos").select("nota_credito_compra_id, monto, anulado").in("nota_credito_compra_id", ncIds);
            (ncMovs || []).forEach((m: any) => { if (!m.anulado) aplicadoPorNC[m.nota_credito_compra_id] = (aplicadoPorNC[m.nota_credito_compra_id] || 0) + Number(m.monto || 0); });
          }
          if (!cancelled) setOpNCDisponibles((prev) => (ncData || []).map((n: any) => ({
            id: n.id, numero: n.numero_factura || "S/N", tipo_comprobante: n.tipo_comprobante || "NC", fecha: n.fecha,
            total: Number(n.total || 0), subtotal: Number(n.subtotal || 0), moneda: n.moneda || "ARS",
            disponible: roundPaymentMoney(Math.max(0, Number(n.total || 0) - (aplicadoPorNC[n.id] || 0))), selected: false, monto_a_aplicar: 0,
          })).filter((n: OpNCDisponible) => n.disponible > 0.005).map((n: OpNCDisponible) => {
            // Igual que las facturas: cambiar la fecha no destilda las NC elegidas.
            const antes = prev.find((x) => x.id === n.id);
            return antes ? { ...n, selected: antes.selected, monto_a_aplicar: Math.min(antes.monto_a_aplicar, n.disponible) } : n;
          }));
        } catch { if (!cancelled) setOpNCDisponibles([]); }

        // Acumulado mensual de PAGOS (OPs) a este proveedor — Art. 26 RG 830
        // Se acumulan las bases sin IVA de OPs previas + retenciones ya practicadas
        // El acumulado de RG 830 corresponde al mes de la fecha de la OP.
        const mesActual = (opForm.fecha || new Date().toISOString().slice(0, 10)).slice(0, 7); // YYYY-MM
        const [year, month] = mesActual.split("-").map(Number);
        const mesSiguiente = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
        let qMensualOP = (supabase as any).from("ordenes_pago").select("base_retencion_ganancias, retencion_ganancias_monto, moneda")
          .eq("proveedor_id", opForm.proveedor_id)
          .gte("fecha", `${mesActual}-01`)
          .lt("fecha", mesSiguiente)
          .neq("estado", "anulada");
        if (sociedadId) qMensualOP = qMensualOP.eq("sociedad_id", sociedadId);
        const { data: mensualOPData, error: monthlyLoadError } = await qMensualOP;
        if (monthlyLoadError) throw monthlyLoadError;
        const { data: directMonthly, error: directMonthlyError } = await (supabase as any).from("movimientos")
          .select("base_retencion_ganancias, retencion_ganancias_monto, moneda, anulado")
          .eq("sociedad_id", sociedadId).eq("proveedor_id", opForm.proveedor_id)
          .eq("tipo", "pago").not("factura_compra_id", "is", null)
          .is("nota_credito_compra_id", null)
          .gte("fecha", `${mesActual}-01`).lt("fecha", mesSiguiente);
        if (directMonthlyError) throw directMonthlyError;
        const monthPayments = [...(mensualOPData || []), ...(directMonthly || []).filter((m: any) => !m.anulado)];
        if (monthPayments.some((m: any) => m.moneda !== "ARS")) throw new Error("El proveedor tiene pagos en otra moneda este mes: falta conciliar su base fiscal en pesos antes de calcular la retención.");
        const basesMes = monthPayments.reduce((s: number, r: any) => s + Number(r.base_retencion_ganancias || 0), 0);
        const retenidoMes = monthPayments.reduce((s: number, r: any) => s + Number(r.retencion_ganancias_monto || 0), 0);
        if (cancelled) return;
        setOpMonthlyBase(basesMes);
        setOpMonthlyRetenido(retenidoMes);
      } catch (error) {
        if (!cancelled) {
          setOpFCPendientes([]);
          setOpDatosError("No se pudieron verificar saldos y retenciones anteriores. Cerrá y volvé a abrir la OP. " + (error instanceof Error ? error.message : "Revisá la conexión."));
        }
      }
      finally { if (!cancelled) setOpFCLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [opForm.proveedor_id, opForm.fecha, datosListos, sociedadId]);

  // La moneda de la OP sigue a las facturas elegidas. Las facturas en US$ se pagan SIEMPRE en pesos
  // (pedido de Augusto 13/10): la OP queda en $ y las facturas se convierten con la cotización.
  useEffect(() => {
    const sel = opFCPendientes.filter(f => f.selected);
    if (!sel.length || opForm.usar_monto_manual) return;
    const monedas = [...new Set(sel.map(f => f.moneda))];
    const destino = monedas.length === 1 ? (monedas[0] === "USD" ? "ARS" : monedas[0]) : null;
    if (destino && destino !== opForm.moneda) setOpForm(prev => ({ ...prev, moneda: destino as typeof prev.moneda }));
  }, [opFCPendientes, opForm.usar_monto_manual, opForm.moneda]);

  // OP en pesos de facturas en US$: todas las elegidas en dólares (no monto manual).
  const opEnPesosUsd = !opForm.usar_monto_manual && opFCPendientes.some(f => f.selected) && opFCPendientes.filter(f => f.selected).every(f => f.moneda === "USD");
  const opMonedaDocs: "ARS" | "USD" = opEnPesosUsd ? "USD" : opForm.moneda;
  const opTC = opEnPesosUsd ? parseDecimalInput(opCotizacion) : 1;
  const opTCOk = !opEnPesosUsd || cotizacionValida(opTC);

  // Cotización BNA divisa (vendedor) del día hábil anterior a la fecha de la OP. Si no la tocaron, se completa sola.
  useEffect(() => {
    if (!opEnPesosUsd) return;
    const fechaTc = diaHabilAnterior(opForm.fecha || todayAR());
    let cancelled = false;
    setOpCotizacionLoading(true);
    fetch(`/api/cotizacion-bna?modalidad=divisas&fecha=${encodeURIComponent(fechaTc)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const valor = Number(data?.valor_venta);
        if (!Number.isFinite(valor) || valor <= 0) { setOpCotizacionBna(null); return; }
        setOpCotizacionBna({ valor, fecha: String(data.fecha || fechaTc) });
        if (!opCotizacionEditada.current) setOpCotizacion(toDecimalInput(valor));
      })
      .catch(() => { if (!cancelled) setOpCotizacionBna(null); })
      .finally(() => { if (!cancelled) setOpCotizacionLoading(false); });
    return () => { cancelled = true; };
  }, [opEnPesosUsd, opForm.fecha]);

  // 2. Base sin IVA de esta OP (Art. 23 RG 830: IVA se excluye de la base de retención)
  const opMontoBrutoFC = sumPaymentMoney(opFCPendientes.filter(f => f.selected).map(f => f.monto_a_pagar));
  // NC aplicadas en esta OP (no en monto manual ni en pago parcial directo). Nunca más que las facturas elegidas.
  const opNCUsables = opForm.usar_monto_manual || pagoParcialDirecto ? [] : opNCDisponibles.filter(n => n.selected && n.moneda === opMonedaDocs && n.monto_a_aplicar > 0);
  const opNCAplicado = Math.min(opMontoBrutoFC, sumPaymentMoney(opNCUsables.map(n => n.monto_a_aplicar)));
  // Reparto de las NC entre las facturas elegidas, en orden: [{nc_id, factura_compra_id, monto}]
  const opNCAsignaciones = (() => {
    const out: { nc_id: string; factura_compra_id: string; monto: number }[] = [];
    const restoFC = opFCPendientes.filter(f => f.selected).map(f => ({ id: f.id, resto: roundPaymentMoney(f.monto_a_pagar) }));
    let tope = opNCAplicado;
    for (const nc of opNCUsables) {
      let restoNC = Math.min(roundPaymentMoney(nc.monto_a_aplicar), tope);
      for (const fc of restoFC) {
        if (restoNC <= 0.004) break;
        const usar = roundPaymentMoney(Math.min(restoNC, fc.resto));
        if (usar <= 0.004) continue;
        out.push({ nc_id: nc.id, factura_compra_id: fc.id, monto: usar });
        fc.resto = roundPaymentMoney(fc.resto - usar); restoNC = roundPaymentMoney(restoNC - usar); tope = roundPaymentMoney(tope - usar);
      }
    }
    return out;
  })();
  // En US$: lo que se paga en dinero de cada factura (descontadas las NC), en dólares.
  const opFCDineroUsd = opFCPendientes.filter(f => f.selected).map(f => ({
    id: f.id,
    monto: roundPaymentMoney(f.monto_a_pagar - opNCAsignaciones.filter(a => a.factura_compra_id === f.id).reduce((s, a) => s + a.monto, 0)),
  }));
  const opMontoBrutoDocs = roundPaymentMoney(opMontoBrutoFC - opNCAplicado);
  const opMontoBruto = opEnPesosUsd
    ? (opTCOk ? brutoPesosDeUsd(opFCDineroUsd.map(f => Math.max(0, f.monto)), opTC) : 0)
    : roundPaymentMoney(opForm.usar_monto_manual && opForm.monto_manual > 0 ? opForm.monto_manual : opMontoBrutoFC - opNCAplicado);
  const opProveedor = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
  const opDiasPactados = Math.max(0, Number(opProveedor?.condicion_pago ? opProveedor.dias_pago : opProveedor?.dias_cuenta_corriente) || 0);
  // Cheques sugeridos (si el proveedor cobra con cheque): cada factura según cómo lo pide, en las fechas fijas del mes.
  const opChequesSugeridos = (() => {
    if (!opProveedor || !["echeq", "cheque"].includes(opProveedor.medio_pago_preferido || "")) return [];
    const porFecha = new Map<string, number>();
    const hoy = todayAR();
    for (const f of opFCPendientes.filter(x => x.selected && x.monto_a_pagar > 0)) {
      for (const c of proponerCheques(f.fecha, f.monto_a_pagar, opProveedor, opChequeFechas)) {
        const fecha = c.fecha < hoy ? hoy : c.fecha;
        porFecha.set(fecha, roundPaymentMoney((porFecha.get(fecha) || 0) + c.monto));
      }
    }
    return [...porFecha.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, monto]) => ({ fecha, monto }));
  })();
  const opFechaPactada = calcularFechaPactada(opFCPendientes.filter(f => f.selected).map(f => f.fecha), opDiasPactados);

  // Base sin IVA: para cada FC, la proporción sin IVA del monto a pagar (en la moneda de las facturas)
  const opBaseSinIVADocs = (() => {
    if (opForm.usar_monto_manual && opForm.monto_manual > 0) {
      // Monto manual: descontar IVA estimado (el usuario puede ajustar el % manualmente)
      const ivaPct = opForm.iva_manual_pct ?? 21;
      return roundPaymentMoney(opForm.monto_manual / (1 + ivaPct / 100));
    }
    // RG 830: base = neto gravado de lo que se cancela (sin IVA y sin percepciones) − neto de las NC aplicadas.
    // Si el comprobante no discrimina IVA (FC/NC C), subtotal = total y se toma el total.
    // Monotributista / exento o comprobante C: no hay IVA que descontar, la base es el total.
    const sinIVA = (tipo: string) => /\bC\b|\sC$/i.test(String(tipo || "")) || /monotrib|exento/i.test(String(opProvCondicion || ""));
    const baseFC = opFCPendientes.filter(f => f.selected).reduce((s, f) => {
      if (f.total <= 0) return s;
      const ratioNeto = sinIVA(f.tipo_comprobante) ? 1 : f.subtotal > 0 ? Math.min(1, f.subtotal / f.total) : 1;
      return s + roundPaymentMoney(f.monto_a_pagar * ratioNeto);
    }, 0);
    const baseNC = opNCAsignaciones.reduce((s, a) => {
      const nc = opNCDisponibles.find(n => n.id === a.nc_id);
      if (!nc || nc.total <= 0) return s;
      const ratioNeto = sinIVA(nc.tipo_comprobante) ? 1 : nc.subtotal > 0 ? Math.min(1, nc.subtotal / nc.total) : 1;
      return s + roundPaymentMoney(a.monto * ratioNeto);
    }, 0);
    return roundPaymentMoney(Math.max(0, baseFC - baseNC));
  })();
  // Base de retención siempre en pesos (RG 830): en US$ se convierte con la cotización de la OP.
  const opBaseSinIVA = opEnPesosUsd ? (opTCOk ? pesosDeUsd(opBaseSinIVADocs, opTC) : 0) : opBaseSinIVADocs;

  // 3. Auto-calcular retención ganancias según RG 830
  // Si el usuario activó/desactivó manualmente, no sobreescribir
  useEffect(() => {
    if (opManualGanancias) return; // respect manual override
    if (opProvCondicion === null || opBaseSinIVA <= 0) return;
    let aplica_ganancias = false;
    let retencion_ganancias_pct = 0;
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    // Check exclusion certificate validity
    // La vigencia se evalúa contra la fecha real del pago, no contra hoy.
    const hoy = opForm.fecha || new Date().toISOString().slice(0, 10);
    const excluido = prov?.exclusion_retencion
      && (!prov.exclusion_retencion_desde || prov.exclusion_retencion_desde <= hoy)
      && (!prov.exclusion_retencion_hasta || prov.exclusion_retencion_hasta >= hoy);
    if (excluido) {
      setOpForm(prev => ({ ...prev, aplica_ganancias: false, retencion_ganancias_pct: 0 }));
      return;
    }
    // AFIP puede devolver "RI" o la descripción completa. Normalizamos para
    // no dejar pasar una retención por diferencias de formato; Monotributo,
    // Exento y Consumidor Final no son sujetos en este circuito.
    const esResponsableInscripto = isResponsableInscripto(opProvCondicion);
    if (esResponsableInscripto && retencionConfig.aplica_ganancias) {
      // Art. 26: acumular bases sin IVA del mes + esta OP
      const acumuladoMensual = opMonthlyBase + opBaseSinIVA;
      // Mínimo y alícuota según el concepto del proveedor (sin concepto = bienes)
      const regla = reglaPorConcepto(prov?.concepto_retencion_ganancias, retencionConfig.minimo_ganancias);
      const minimoConcepto = regla ? regla.minimo : retencionConfig.minimo_ganancias;
      if (acumuladoMensual >= minimoConcepto) {
        aplica_ganancias = true;
        retencion_ganancias_pct = pctRetencion(regla, acumuladoMensual - minimoConcepto, prov?.alicuota_ganancias, retencionConfig.tasa_ganancias_ri);
      }
    }
    setOpForm(prev => ({ ...prev, aplica_ganancias, retencion_ganancias_pct }));
  }, [opProvCondicion, opBaseSinIVA, retencionConfig, opMonthlyBase, opForm.proveedor_id, opForm.fecha, opManualGanancias]);


  // Base imponible ganancias (Art. 26 RG 830):
  // 1. Acumular bases sin IVA del mes (OPs previas + esta)
  // 2. Restar mínimo no sujeto a retención
  // 3. Aplicar alícuota
  // 4. Restar retenciones ya practicadas en el mes
  // 5. Verificar monto mínimo de retención (Art. 29)
  const opMinimoGanancias = (() => {
    const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    return reglaPorConcepto(prov?.concepto_retencion_ganancias, retencionConfig.minimo_ganancias)?.minimo ?? retencionConfig.minimo_ganancias;
  })();
  const opBaseGanancias = (() => {
    if (!opForm.aplica_ganancias) return 0;
    const minimo = opMinimoGanancias;
    if (opMonthlyBase >= minimo) return opBaseSinIVA; // ya superó antes → retener sobre toda la base sin IVA de esta OP
    return (opMonthlyBase + opBaseSinIVA) - minimo; // esta OP cruza → solo excedente
  })();

  // Retención bruta sobre acumulado, menos retenciones ya practicadas (Art. 26)
  const opRetencionGananciaBruta = (() => {
    if (!opForm.aplica_ganancias || opBaseGanancias <= 0) return 0;
    const minimo = opMinimoGanancias;
    // Calcular retención sobre el acumulado total del mes
    const baseAcumulada = Math.max(0, (opMonthlyBase + opBaseSinIVA) - minimo);
    const retencionAcumulada = baseAcumulada * (opForm.retencion_ganancias_pct / 100);
    // Restar lo ya retenido en OPs previas del mes
    return Math.max(0, retencionAcumulada - opMonthlyRetenido);
  })();

  // Art. 29: si la retención es menor al mínimo, no retener
  // Allow manual override of the final amount
  const opRetencionGanancias = opMontoRetencionManual !== null
    ? roundPaymentMoney(opMontoRetencionManual)
    : opRetencionGananciaBruta < retencionConfig.minimo_retencion_ganancias
      ? 0
      : roundPaymentMoney(opRetencionGananciaBruta);
  const opNetoAPagar = roundPaymentMoney(opMontoBruto - opRetencionGanancias);
  const opTotalMedios = sumPaymentMoney(opMedios.map(m => m.monto));
  const opDiferencia = roundPaymentMoney(opNetoAPagar - opTotalMedios);
  const opSaldoFavor = Math.max(0, -opDiferencia);

  /**
   * 26/10/2026 (Augusto): los cheques no se eligen desde el sistema; se endosan o emiten en el banco y se carga el comprobante.
   * Por cada cheque leído se busca en el CRM (número + monto): de cartera → ese (al guardar pasa a endosado); propio ya cargado o
   * de una OP anulada a este proveedor → ese, sin crear otro. Si no está, se avisa (nunca se traba). Regla en lib/cheque-comprobante-op.ts.
   */
  async function chequesDelComprobante(medios: OpMedioPago[], archivo?: string): Promise<OpMedioPago[]> {
    const conCheque = medios.filter((m) => ["cheque", "cheque_propio", "echeq"].includes(m.tipo) && numeroSinCeros(m.numero_cheque));
    if (!conCheque.length) return medios;
    const db = supabase as any;
    const candidatos: ChequeCandidato[] = [];
    try {
      for (const num of [...new Set(conCheque.map((m) => numeroSinCeros(m.numero_cheque)))]) {
        const { data, error } = await db.from("echeqs").select("id, numero, monto, moneda, direccion, estado, tipo_cheque, banco_emisor, destino_id, origen_nombre, created_at")
          .eq("sociedad_id", sociedadId).like("numero", `%${num}`).limit(50);
        if (error) throw error;
        for (const c of (data || []) as Array<ChequeCandidato & { created_at: string }>) if (numeroSinCeros(c.numero) === num && !candidatos.some((x) => x.id === c.id)) candidatos.push(c);
      }
      // Los ya dados (entregado / endosado): ¿los usa alguna OP vigente? (por echeq_id en sus medios o porque la OP lo creó)
      for (const c of candidatos.filter((x) => x.estado === "entregado" || x.estado === "endosado") as Array<ChequeCandidato & { created_at: string }>) {
        const [porId, porHora] = await Promise.all([
          db.from("ordenes_pago").select("id").eq("sociedad_id", sociedadId).neq("estado", "anulada").contains("medios_pago", [{ echeq_id: c.id }]).limit(1),
          db.from("ordenes_pago").select("id").eq("sociedad_id", sociedadId).neq("estado", "anulada").eq("created_at", c.created_at).limit(1),
        ]);
        c.enOpVigente = Boolean(porId.data?.length || porHora.data?.length || porId.error || porHora.error);
      }
    } catch {
      return medios.map((m) => conCheque.includes(m) ? { ...m, aviso_cheque: "No se pudo buscar el cheque en el CRM: revisalo antes de guardar." } : m);
    }
    // Los cheques del mismo comprobante subido otra vez se reemplazan: no cuentan como ya usados.
    const usados = opMedios.filter((m) => !archivo || m.archivo !== archivo).map((m) => m.echeq_id).filter(Boolean) as string[];
    return medios.map((m) => {
      if (!conCheque.includes(m)) return m;
      const r = chequeDelComprobante({ numero: m.numero_cheque, monto: Number(m.monto), moneda: m.moneda, direccion: (m as OpMedioPago & { direccion?: string | null }).direccion ?? null }, candidatos, opForm.proveedor_id, usados);
      if (r.tipo === "cartera" || r.tipo === "propio_existente") {
        usados.push(r.cheque.id);
        const propio = r.tipo === "propio_existente";
        return {
          ...m,
          tipo: propio ? "cheque_propio" : (r.cheque.tipo_cheque === "fisico" ? "cheque" : "echeq"),
          echeq_id: r.cheque.id,
          origen_cheque: propio ? "propio" : "cartera",
          monto: Number(r.cheque.monto),
          numero_cheque: r.cheque.numero,
          banco: r.cheque.banco_emisor || m.banco,
          cheque_comprobante: `✔ Cheque ${r.cheque.numero}${!propio && r.cheque.origen_nombre ? ` de ${r.cheque.origen_nombre}` : ""} (del comprobante)${propio ? "" : ": al guardar pasa a endosado"}`,
          aviso_cheque: r.aviso || undefined,
        };
      }
      if (r.tipo === "endoso_sin_cheque") return { ...m, tipo: m.tipo === "cheque_propio" ? "cheque" : m.tipo, echeq_id: undefined, origen_cheque: "cartera", aviso_cheque: r.aviso };
      return { ...m, aviso_cheque: r.aviso || undefined };
    });
  }

  async function handleParseComprobante(f: File) {
    // 26/10/2026 (auditoría UX, arreglo 3): el mismo archivo otra vez reemplaza al anterior (no se adjunta ni se suma dos veces).
    const archivo = claveArchivo(f);
    setOpFiles(prev => [...prev.filter(p => claveArchivo(p) !== archivo), f]);
    setOpParsingCount(prev => prev + 1);
    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("contexto", "orden_pago_proveedor");
      const res = await fetch("/api/parse-cobro", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer el comprobante. Podés completar los medios de pago manualmente.");
      const pagos: any[] = json.data.pagos || (json.data.tipo ? [json.data] : []);
      if (pagos.length === 0) return;
      const mapped: OpMedioPago[] = pagos.map(d => {
        const fields = paymentDocumentFields(d, { context: "orden_pago_proveedor" });
        const tipo = fields.tipo === "cheque" && fields.direccion === "emitido" ? "cheque_propio" : fields.tipo;
        // fields.direccion queda en el medio (solo para buscar el cheque): "recibido" = comprobante de endoso.
        return {
          ...makeOpMedio(fields.moneda),
          ...fields,
          tipo,
          // En una OP el comprobante adjunto acredita un pago saliente. Si la IA
          // detecta un e-cheq, se trata de uno propio emitido; uno recibido de un
          // cliente solo puede ingresarse seleccionandolo desde cartera.
          origen_cheque: tipo === "echeq" || tipo === "cheque_propio" ? (fields.direccion === "recibido" ? "cartera" : "propio") : undefined,
          banco_otro: "",
          archivo,
        };
      });
      // Lo que ya está cargado no se suma de nuevo: lo leído del mismo archivo se reemplaza; de otro comprobante
      // se agrega solo lo que no estaba (ej. transferencia + cheque). Lo repetido se avisa (lib/comprobante-medios.ts).
      const comparable = (m: OpMedioPago) => ({ tipo: m.tipo, monto: Number(m.monto), numero: m.numero_cheque, fecha: m.fecha_cobro || m.fecha });
      const igual = (a: OpMedioPago, b: OpMedioPago) => mismoPago(comparable(a), comparable(b));
      const { agregar, repetidos } = sinRepetir(opMedios.filter(m => m.archivo !== archivo), mapped, igual);
      const conCheques = await chequesDelComprobante(agregar, archivo);
      setOpMedios(prev => {
        const otros = prev.filter(m => m.archivo !== archivo);
        const hasOnlyEmptyDefault = otros.length === 1
          && otros[0].monto === 0
          && !otros[0].banco
          && !otros[0].numero_cheque
          && !otros[0].echeq_id;
        const base = hasOnlyEmptyDefault ? [] : otros;
        const lista = [...base, ...sinRepetir(base, conCheques, igual).agregar];
        return lista.length ? lista : [makeOpMedio(opForm.moneda)];
      });
      if (repetidos.length) {
        const texto: Record<string, string> = { transferencia: "transferencia", deposito: "depósito", cheque: "cheque", cheque_propio: "cheque", echeq: "eCheq", efectivo: "efectivo", tarjeta: "tarjeta" };
        setOpAviso(`Ya estaba cargado y no se sumó de nuevo: ${repetidos.map(m => `${texto[m.tipo] || m.tipo}${m.numero_cheque ? ` ${m.numero_cheque}` : ""} ${formatCurrency(Number(m.monto), m.moneda)}`).join(" · ")}.`);
      }
      setOpFCPendientes((prev) => {
        const allocation = parsedPaymentForSingleInvoice(mapped, prev);
        if (!allocation) return prev;
        return prev.map((invoice) => invoice.id === allocation.invoiceId
          ? { ...invoice, selected: true, monto_a_pagar: allocation.amount }
          : pagoParcialDirecto ? { ...invoice, selected: false, monto_a_pagar: 0 } : invoice);
      });
    } catch (error) {
      setOpError(error instanceof Error ? error.message : (error as any)?.message || "No se pudo leer el comprobante. Completá los datos manualmente.");
    } finally {
      setOpParsingCount(prev => Math.max(0, prev - 1));
    }
  }

  // Pago parcial: recorta lo aplicado a las facturas más nuevas para que el neto cierre con los medios.
  // La retención se recalcula sobre lo que realmente se paga (misma cuenta que arriba, con la alícuota actual).
  function aplicarPagoParcial(): boolean {
    const elegidas = opFCPendientes.filter(f => f.selected && f.monto_a_pagar > 0);
    if (opForm.usar_monto_manual || elegidas.length === 0) return false;
    const sinIVA = (tipo: string) => /\bC\b|\sC$/i.test(String(tipo || "")) || /monotrib|exento/i.test(String(opProvCondicion || ""));
    const facturas = elegidas.map(f => ({
      id: f.id, fecha: f.fecha, monto: roundPaymentMoney(f.monto_a_pagar),
      ratioNeto: f.total <= 0 || sinIVA(f.tipo_comprobante) ? 1 : f.subtotal > 0 ? Math.min(1, f.subtotal / f.total) : 1,
    }));
    const baseFC = facturas.reduce((s, f) => s + roundPaymentMoney(f.monto * f.ratioNeto), 0);
    const baseNC = Math.max(0, roundPaymentMoney(baseFC - opBaseSinIVADocs));
    // En US$ todo el reparto se hace en dólares; la retención se calcula en pesos (base × cotización) y se vuelve a pasar a US$.
    const tc = opEnPesosUsd ? opTC : 1;
    const retencionDe = (base: number) => {
      if (opMontoRetencionManual !== null) return roundPaymentMoney(opMontoRetencionManual) / tc;
      if (!opForm.aplica_ganancias) return 0;
      const acumulada = Math.max(0, (opMonthlyBase + base * tc) - opMinimoGanancias) * (opForm.retencion_ganancias_pct / 100);
      const r = Math.max(0, acumulada - opMonthlyRetenido);
      return (r < retencionConfig.minimo_retencion_ganancias ? 0 : r) / tc;
    };
    const res = calcularPagoParcial(facturas, opTotalMedios / tc, retencionDe, opNCAplicado, baseNC);
    if (!res.quedan.length) return false;
    // En US$ lo parcial se redondea para abajo al centavo de dólar: así el neto en pesos nunca supera los medios.
    if (opEnPesosUsd) for (const q of res.quedan) res.montos[q.id] = Math.floor((res.montos[q.id] || 0) * 100 + 1e-6) / 100;
    setOpFCPendientes(prev => prev.map(f => res.montos[f.id] !== undefined ? { ...f, monto_a_pagar: res.montos[f.id] } : f));
    const detalle = res.quedan.map(q => {
      const fc = elegidas.find(f => f.id === q.id);
      return `${fc?.numero || "S/N"} queda debiendo ${formatCurrency(roundPaymentMoney((fc?.saldo_pendiente || 0) - (res.montos[q.id] || 0)), opMonedaDocs)}`;
    }).join(" · ");
    setOpAviso(`Pago parcial: ${detalle}. La retención se recalculó sobre lo que pagás (${formatCurrency(roundPaymentMoney(res.retencion * tc), opForm.moneda)}). Revisá y apretá «Crear Orden de pago».`);
    return true;
  }

  // "Guardar y enviar" (Augusto 19/10/2026): al crear la OP se abre el mail al proveedor con la OP y los comprobantes.
  async function handleCreateOP(enviar = false) {
    if (!sociedadId) { setOpError("No se pudo determinar la sociedad activa"); return; }
    if (!opForm.proveedor_id) { setOpError("Selecciona un proveedor"); return; }
    const selectedFCs = opFCPendientes.filter(f => f.selected);
    if (opDatosError) { setOpError(opDatosError); return; }
    if (new Set(selectedFCs.map((invoice) => invoice.id)).size !== selectedFCs.length) {
      setOpError("La misma factura fue seleccionada dos veces. Volvé a abrir la OP y reintentá.");
      return;
    }
    if (opFCLoading || opCondicionLoading || opParsingCount > 0) { setOpError("Esperá a que termine la carga de facturas, condición fiscal y comprobantes antes de generar la OP."); return; }
    if (!opProvCondicion) { setOpError("Falta verificar la condición fiscal del proveedor. Completala en su ficha antes de generar la OP."); return; }
    if (!isKnownCondicionIva(opProvCondicion)) {
      setOpError("La condición fiscal del proveedor no está reconocida. Revisá su ficha antes de generar la OP."); return;
    }
    // Facturas en US$: se pagan en pesos con la cotización de la OP (ver lib/op-usd-pesos.ts).
    if (opEnPesosUsd && !opTCOk) { setOpError("Falta la cotización del dólar (BNA divisa) para pasar las facturas a pesos."); return; }
    if ((!opEnPesosUsd && selectedFCs.some(f => f.moneda !== opForm.moneda)) || opMedios.some(m => m.moneda !== opForm.moneda)) {
      setOpError("Hay documentos o medios en otra moneda. No se puede sumar pesos y dólares sin conversión: esta OP debe tener todos sus importes en la misma moneda."); return;
    }
    if (selectedFCs.some(f => !Number.isFinite(f.monto_a_pagar) || f.monto_a_pagar <= 0 || f.monto_a_pagar > f.saldo_pendiente + 0.005)) {
      setOpError("Revisá el importe a pagar de cada factura: debe ser positivo y no superar su saldo."); return;
    }
    if (selectedFCs.length === 0 && !opForm.usar_monto_manual) { setOpError("Selecciona al menos una factura o ingresa un monto manual"); return; }
    if (opNCAsignaciones.length > 0 && opMontoBruto <= 0.005) {
      // Las NC cubren todo lo elegido: se aplican sin pago en dinero (no se genera OP).
      if (!confirm(`Las notas de crédito cubren el total elegido (${formatCurrency(opNCAplicado, opForm.moneda)}). Se aplican a las facturas sin generar pago. ¿Continuar?`)) return;
      setOpSaving(true); setOpError("");
      try {
        if (!opRequestKeyRef.current) opRequestKeyRef.current = crypto.randomUUID();
        const { error } = opEnPesosUsd ? await (supabase as any).rpc("registrar_op_usd_en_pesos", {
          p_sociedad_id: sociedadId, p_request_key: opRequestKeyRef.current, p_proveedor_id: opForm.proveedor_id,
          p_fecha: opForm.fecha, p_cotizacion: opTC, p_cotizacion_fecha: diaHabilAnterior(opForm.fecha || todayAR()),
          p_facturas: opFCDineroUsd.map(f => ({ id: f.id, monto: Math.max(0, f.monto) })), p_notas_credito: opNCAsignaciones, p_medios: [],
          p_monto_bruto: 0, p_base_retencion: 0, p_retencion_pct: 0, p_retencion_monto: 0, p_notas: opForm.notas || "", p_sobre_verde: false,
        }) : await (supabase as any).rpc("registrar_pago_proveedor_con_nc", {
          p_sociedad_id: sociedadId, p_request_key: opRequestKeyRef.current, p_modo: "op", p_proveedor_id: opForm.proveedor_id,
          p_fecha: opForm.fecha, p_moneda: opForm.moneda, p_facturas: [], p_medios: [], p_monto_bruto: 0, p_base_retencion: 0,
          p_retencion_pct: 0, p_retencion_monto: 0, p_notas: opForm.notas || "", p_sobre_verde: false, p_notas_credito: opNCAsignaciones,
        });
        if (error) throw new Error(error.message);
        opRequestKeyRef.current = ""; await onCreada({ enviar: false });
        alert("Notas de crédito aplicadas a las facturas.");
      } catch (e: any) { setOpError(e?.message || "No se pudieron aplicar las notas de crédito"); }
      finally { setOpSaving(false); }
      return;
    }
    if (opMontoBruto <= 0) { setOpError("El monto a pagar debe ser mayor a 0"); return; }
    // Partial payments are selected per invoice BEFORE calculating retention.
    // Never prorate the final retention: monthly thresholds are not linear.
    const totalMediosVal = sumPaymentMoney(opMedios.map(m => m.monto));
    const selectedEcheqIds = opMedios.map(m => m.echeq_id).filter((id): id is string => Boolean(id));
    if (new Set(selectedEcheqIds).size !== selectedEcheqIds.length) { setOpError("Un mismo e-cheq no puede usarse en dos medios de la OP"); return; }
    if (opMedios.some(m => (m.tipo === "cheque" || (m.tipo === "echeq" && m.origen_cheque !== "propio")) && !m.echeq_id)) { setOpError(opMedios.find(m => (m.tipo === "cheque" || (m.tipo === "echeq" && m.origen_cheque !== "propio")) && !m.echeq_id)?.aviso_cheque || "Los cheques de terceros deben seleccionarse desde la cartera para reservarlos junto con la OP"); return; }
    const proveedorPago = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
    const proveedorCuitPago = String(proveedorPago?.cuit || "").replace(/\D/g, "");
    if (opMedios.some(m => ["cheque", "cheque_propio", "echeq"].includes(m.tipo)) && proveedorCuitPago.length !== 11) {
      setOpError("El proveedor no tiene un CUIT válido de 11 dígitos. Corregilo en Proveedores antes de emitir el cheque o eCheq."); return;
    }
    if (opMedios.some(m => !Number.isFinite(m.monto) || m.monto < 0)) { setOpError("Los medios de pago no pueden tener importes negativos o inválidos"); return; }
    if (totalMediosVal <= 0) { setOpError("Ingresá al menos un medio de pago con monto mayor a 0"); return; }
    if (!Number.isFinite(opRetencionGanancias) || opRetencionGanancias < 0 || opRetencionGanancias > opMontoBruto) { setOpError("La retención debe estar entre cero y el importe bruto a pagar"); return; }
    const opDiffMedios = totalMediosVal - opNetoAPagar;
    // Hasta $1 menos es redondeo (la base lo acepta). Si falta más, se arma el pago parcial y se avisa: nunca se traba.
    if (opDiffMedios < -1) {
      if (aplicarPagoParcial()) { setOpError(""); return; }
      setOpError("Los medios suman menos que el neto a pagar (faltan $" + Math.abs(opDiffMedios).toFixed(2) + "). Bajá «A pagar» en la factura que queda con saldo."); return;
    }
    if (opDiffMedios > 0.01) {
      if (!confirm(`Los medios superan el neto a pagar en $${opDiffMedios.toFixed(2)}. El excedente quedará como crédito a nuestro favor en la CC del proveedor. ¿Continuar?`)) return;
    }
    const montoBrutoEfectivo = roundPaymentMoney(opMontoBruto);
    const retencionEfectiva = roundPaymentMoney(opRetencionGanancias);
    const baseRetencionEfectiva = roundPaymentMoney(opBaseSinIVA);

    setOpSaving(true);
    setOpError("");
    try {
      if (!opRequestKeyRef.current) opRequestKeyRef.current = crypto.randomUUID();
      const mediosPayload = opMedios.filter(m => m.monto > 0).map(m => ({
        // La RPC representa todos los cheques emitidos por la sociedad como
        // cheque_propio. tipo_cheque conserva si es fisico o electronico.
        tipo: m.tipo === "echeq" && m.origen_cheque === "propio" && !m.echeq_id ? "cheque_propio" : m.tipo,
        tipo_cheque: m.tipo === "echeq" ? "echeq" : "fisico",
        monto: roundPaymentMoney(m.monto),
        fecha: m.fecha,
        fecha_emision: m.fecha_emision || null,
        fecha_cobro: m.fecha_cobro || m.fecha,
        banco: m.banco === "Otro" ? (m.banco_otro?.trim() || "Otro") : m.banco,
        numero_cheque: m.numero_cheque,
        moneda: m.moneda,
        cotizacion: m.cotizacion,
        echeq_id: m.echeq_id || null,
        beneficiario_cuit: proveedorCuitPago || null,
        beneficiario_nombre: proveedorPago?.razon_social || null,
      }));
      // Con NC: cada factura se paga en dinero solo por lo que no cubre la NC.
      const facturasPayload = selectedFCs.map(fc => ({
        id: fc.id,
        monto: roundPaymentMoney(fc.monto_a_pagar - opNCAsignaciones.filter(a => a.factura_compra_id === fc.id).reduce((s, a) => s + a.monto, 0)),
      })).filter(f => f.monto > 0.004);
      const conNC = opNCAsignaciones.length > 0;
      const { data: opData, error } = opEnPesosUsd ? await (supabase as any).rpc("registrar_op_usd_en_pesos", {
        p_sociedad_id: sociedadId,
        p_request_key: opRequestKeyRef.current,
        p_proveedor_id: opForm.proveedor_id,
        p_fecha: opForm.fecha,
        p_cotizacion: opTC,
        p_cotizacion_fecha: diaHabilAnterior(opForm.fecha || todayAR()),
        p_facturas: opFCDineroUsd.filter(f => f.monto > 0.004),
        p_notas_credito: opNCAsignaciones,
        p_medios: mediosPayload,
        p_monto_bruto: montoBrutoEfectivo,
        p_base_retencion: baseRetencionEfectiva,
        p_retencion_pct: opForm.aplica_ganancias ? opForm.retencion_ganancias_pct : 0,
        p_retencion_monto: retencionEfectiva,
        p_notas: opForm.notas,
        p_sobre_verde: opForm.sobre_verde || false,
      }) : await (supabase as any).rpc(conNC ? "registrar_pago_proveedor_con_nc" : "registrar_pago_proveedor_seguro", {
        ...(conNC ? { p_notas_credito: opNCAsignaciones } : {}),
        p_sociedad_id: sociedadId,
        p_request_key: opRequestKeyRef.current,
        p_modo: "op",
        p_proveedor_id: opForm.proveedor_id,
        p_fecha: opForm.fecha,
        p_moneda: opForm.moneda,
        p_facturas: facturasPayload,
        p_medios: mediosPayload,
        p_monto_bruto: montoBrutoEfectivo,
        p_base_retencion: baseRetencionEfectiva,
        p_retencion_pct: opForm.aplica_ganancias ? opForm.retencion_ganancias_pct : 0,
        p_retencion_monto: retencionEfectiva,
        p_notas: opForm.notas,
        p_sobre_verde: opForm.sobre_verde || false,
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      const opId = opData?.orden_pago_id as string | undefined;
      const opNumero = (opData?.numero as string | undefined) || "OP";
      const attachmentWarnings: string[] = [];

      // Los archivos son un adjunto no financiero: se cargan solo despues de
      // que la saga contable termino. Si fallan, la OP queda integra y reintentable.
      if (opFiles.length > 0 && opId) {
        const archivosArr: { url: string; nombre: string }[] = [];
        for (let fi = 0; fi < opFiles.length; fi++) {
          const file = opFiles[fi];
          const ext = file.name.split(".").pop() || "pdf";
          const filePath = `${sociedadId}/op-${opId}/comprobante-${fi}.${ext}`;
          const { error: upErr } = await supabase.storage.from("comprobantes").upload(filePath, file, { upsert: true });
          if (!upErr) {
            const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(filePath);
            archivosArr.push({ url: urlData.publicUrl, nombre: file.name });
          } else attachmentWarnings.push(`${file.name}: ${upErr.message}`);
        }
        if (archivosArr.length > 0) {
          const updateData: Record<string, unknown> = { archivos: JSON.stringify(archivosArr) };
          const opDocUpdate = (supabase as any).from("ordenes_pago").update(updateData)
            .eq("id", opId).eq("sociedad_id", sociedadId);
          const { error: attachmentError } = await opDocUpdate;
          if (attachmentError) attachmentWarnings.push(`No se pudo guardar la referencia de los archivos: ${attachmentError.message}`);
        }
      }
      setOpFiles([]);
      opRequestKeyRef.current = "";
      await onCreada({ opId, enviar });
      if (Number(opData?.saldo_a_favor || 0) > 0) {
        alert(`${opNumero} registrada. Crédito a nuestro favor: ${formatCurrency(Number(opData.saldo_a_favor), opForm.moneda)}.`);
      }
      if (attachmentWarnings.length) alert(`${opNumero} registrada. Quedaron comprobantes pendientes de adjuntar desde el detalle de la OP:\n${attachmentWarnings.join("\n")}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : (err as any)?.message || "Error al crear la OP";
      setOpError(`${message}. Podés reintentar: la misma solicitud no duplica la OP.`);
    } finally {
      setOpSaving(false);
    }
  }

  async function handleRegistrarPagoParcialDirecto() {
    const selected = opFCPendientes.filter(f => f.selected);
    const fc = selected.length === 1 ? selected[0] : null;
    const total = sumPaymentMoney(opMedios.map(medio => Number(medio.monto)));
    if (!fc) { setOpError("Seleccioná una sola factura para registrar el pago parcial directo"); return; }
    if (!sociedadId) { setOpError("No se pudo determinar la sociedad activa"); return; }
    if (opDatosError) { setOpError(opDatosError); return; }
    if (opFCLoading || opCondicionLoading || opParsingCount > 0) { setOpError("Esperá a que terminen de verificarse facturas, condición fiscal y comprobantes"); return; }
    if (!opProvCondicion || !opForm.proveedor_id) { setOpError("Falta verificar la condición fiscal del proveedor"); return; }
    if (!isKnownCondicionIva(opProvCondicion)) { setOpError("La condición fiscal del proveedor no está reconocida. Revisá su ficha antes de registrar el pago"); return; }
    if (fc.moneda === "USD") {
      setFxPago({proveedorId: opForm.proveedor_id, documents: [{id:fc.id,numero:fc.numero,saldo:fc.saldo_pendiente,total:fc.total,subtotal:fc.subtotal,cotizacion:undefined}]});
      return;
    }
    if (opForm.moneda !== "ARS") { setOpError("El pago en dólares requiere registrar su conversión a pesos antes de calcular las retenciones"); return; }
    if (opForm.usar_monto_manual) { setOpError("Para un pago parcial directo indicá el importe bruto en «A pagar» de la factura"); return; }
    if (fc.moneda !== opForm.moneda || opMedios.some(m => m.moneda !== opForm.moneda)) { setOpError("La factura y todos los medios deben estar en la misma moneda"); return; }
    if (opMedios.some(m => ["cheque", "cheque_propio", "echeq"].includes(m.tipo))) { setOpError("Los pagos parciales directos con cheque o e-cheq todavía no están habilitados porque requieren reservar la cartera en la misma transacción"); return; }
    const bruto = roundPaymentMoney(Number(fc.monto_a_pagar));
    const retencion = roundPaymentMoney(Number(opRetencionGanancias));
    if (!Number.isFinite(bruto) || bruto <= 0 || bruto >= fc.saldo_pendiente - 0.005) { setOpError("El importe bruto debe ser positivo y menor al saldo pendiente; para cancelarlo usá Generar OP"); return; }
    if (!Number.isFinite(retencion) || retencion < 0 || retencion > bruto) { setOpError("La retención debe estar entre cero y el bruto a pagar"); return; }
    if (opMedios.some(m => !Number.isFinite(Number(m.monto)) || Number(m.monto) < 0) || total <= 0) { setOpError("Ingresá medios de pago válidos, sin importes negativos"); return; }
    if (Math.round(total * 100) !== Math.round((bruto - retencion) * 100)) { setOpError("Los medios deben sumar el neto: importe bruto «A pagar» menos la retención calculada"); return; }
    setOpSaving(true);
    setOpError("");
    try {
      if (!opRequestKeyRef.current) opRequestKeyRef.current = crypto.randomUUID();
      const pctGanancias = opForm.aplica_ganancias ? Number(opForm.retencion_ganancias_pct) : 0;
      const mediosPayload = opMedios.filter(m => Number(m.monto) > 0).map(m => ({
        tipo: m.tipo,
        monto: roundPaymentMoney(Number(m.monto)),
        fecha: m.fecha,
        moneda: m.moneda,
        cotizacion: m.cotizacion,
      }));
      const { error } = await (supabase as any).rpc("registrar_pago_proveedor_seguro", {
        p_sociedad_id: sociedadId,
        p_request_key: opRequestKeyRef.current,
        p_modo: "directo",
        p_proveedor_id: opForm.proveedor_id,
        p_fecha: opForm.fecha,
        p_moneda: opForm.moneda,
        p_facturas: [{ id: fc.id, monto: roundPaymentMoney(bruto) }],
        p_medios: mediosPayload,
        p_monto_bruto: bruto,
        p_base_retencion: roundPaymentMoney(opBaseSinIVA),
        p_retencion_pct: pctGanancias,
        p_retencion_monto: roundPaymentMoney(retencion),
        p_notas: opForm.notas,
        p_sobre_verde: false,
      });
      if (error) throw error;
      opRequestKeyRef.current = "";
      await onCreada({ enviar: false });
    } catch (err: unknown) {
      setOpError(err instanceof Error ? err.message : "No se pudo registrar el pago parcial");
    } finally { setOpSaving(false); }
  }

  // Filtered proveedores for search (by razon_social, nombre, or CUIT)
  const filteredProveedoresOP = proveedorSearch.trim()
    ? proveedoresOptions.filter(p => {
        const q = proveedorSearch.toLowerCase().replace(/[-\s]/g, "");
        return (
          p.razon_social.toLowerCase().includes(q) ||
          (p.cuit || "").replace(/[-\s]/g, "").includes(q)
        );
      })
    : proveedoresOptions;

  // 26/10/2026 (auditoría UX, arreglo 3): con algo cargado, el clic afuera y la X preguntan antes de cerrar (como Presupuestos, 21/10).
  // «Cancelar» cierra directo; mientras guarda no se cierra.
  const tildadaAlAbrir = (id: string) => (pagoParcialDirecto ? id === pagoParcialFCId : !!facturaIds?.includes(id));
  const opHayCargado = opFiles.length > 0 || opMedios.some(m => Number(m.monto) > 0) || !!opForm.notas.trim()
    || (opForm.usar_monto_manual && Number(opForm.monto_manual) > 0) || opNCDisponibles.some(n => n.selected)
    || opFCPendientes.some(f => f.selected !== tildadaAlAbrir(f.id) || (f.selected && Math.abs(f.monto_a_pagar - f.saldo_pendiente) > 0.005));
  function pedirCierre() {
    if (opSaving) return;
    if (opHayCargado && !confirm(`¿Estás seguro que deseas salir sin guardar? Se pierde lo que cargaste en ${pagoParcialDirecto ? "este pago" : "esta orden de pago"}.`)) return;
    onClose();
  }

  if (fxPago) return (
    <FxSettlementDialog
    kind="pago" counterpartyId={fxPago.proveedorId} sociedadId={sociedadId}
    documents={fxPago.documents}
    onClose={onClose}
    onSuccess={async () => { await onCreada({ enviar: false }); }}
  />
  );

  return (
    <>
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={pedirCierre} />
      <div className={`fixed z-50 overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-900 transition-all ${opModalFullscreen ? "inset-2 max-h-[calc(100vh-1rem)]" : "inset-4 m-auto h-fit max-h-[90vh] w-full max-w-4xl"}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-orange-500" />
            <h2 className="text-base font-bold dark:text-white">{pagoParcialDirecto ? "Registrar pago parcial" : "Nueva Orden de pago"}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setOpModalFullscreen(f => !f)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" title={opModalFullscreen ? "Reducir" : "Maximizar"}>{opModalFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
            <button onClick={pedirCierre} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {opError && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">{opError}</div>}
        {opAviso && <div className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300"><span>⚠️ {opAviso}</span><button type="button" onClick={() => setOpAviso("")} className="shrink-0 text-amber-500 hover:text-amber-700"><X className="h-3 w-3" /></button></div>}
        {opCargaAviso && <div role="alert" className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">{opCargaAviso}</div>}
          {opDatosError && <div role="alert" className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">{opDatosError}</div>}
        {pagoParcialDirecto && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">Este pago se registra como movimiento directo contra una sola factura y no crea una orden de pago. Si corresponde, la retención RG 830 se calcula sobre este pago y queda registrada junto al movimiento.</div>}
        <div className="space-y-2.5">
          {/* Proveedor + Fecha */}
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3 relative">
              <label className="text-xs font-medium text-zinc-500">Proveedor *</label>
              <div className="relative mt-1">
                <div className="flex items-center border border-zinc-200 rounded-lg dark:border-zinc-700 overflow-hidden">
                  <Search className="h-4 w-4 text-zinc-400 ml-3 flex-shrink-0" />
                  <input value={proveedorSearch}
                    onChange={(e) => { setProveedorSearch(e.target.value); if (opForm.proveedor_id) setOpForm({ ...opForm, proveedor_id: "" }); }}
                    placeholder="Buscar proveedor..." className="w-full px-2 py-1.5 text-sm bg-transparent dark:text-white outline-none" />
                </div>
                {opForm.proveedor_id && (
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <Badge variant="success">{proveedoresOptions.find(p => p.id === opForm.proveedor_id)?.razon_social}</Badge>
                    <button onClick={() => { setOpForm({ ...opForm, proveedor_id: "" }); setProveedorSearch(""); setOpProvCondicion(null); setOpManualGanancias(false); }} className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
                    {opCondicionLoading && <span className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" />AFIP…</span>}
                    {!opCondicionLoading && opProvCondicion !== null && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isResponsableInscripto(opProvCondicion) ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"}`}>
                        {isResponsableInscripto(opProvCondicion) ? "Resp. Inscripto" : canonicalCondicionIva(opProvCondicion) || opProvCondicion || "Sin datos"}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">
                      {textoCondicionPago(opProveedor) || opProveedor?.forma_pago || "Condición sin especificar"} · {opDiasPactados === 0 ? "pago inmediato" : `${opDiasPactados} días pactados`}
                      {opFechaPactada ? ` · fecha sugerida ${formatDate(opFechaPactada)}` : " · seleccioná una factura para calcular la fecha sugerida"}
                    </span>
                    {opChequesSugeridos.length > 0 && (
                      <span className="basis-full text-xs text-blue-700 dark:text-blue-300" title="Sugerencia según las fechas de cheque del mes (Configuración → Fechas de cheque). Se puede cambiar.">
                        Cheques sugeridos: {opChequesSugeridos.map(c => `${formatDate(c.fecha)} ${formatCurrency(c.monto, (opForm.moneda || "ARS") as "ARS" | "USD")}`).join(" · ")}
                      </span>
                    )}
                  </div>
                )}
                {!opForm.proveedor_id && proveedorSearch.trim() && filteredProveedoresOP.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    {filteredProveedoresOP.slice(0, 10).map(p => (
                      <button key={p.id} onClick={() => { setOpForm({ ...opForm, proveedor_id: p.id }); setProveedorSearch(p.razon_social); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 dark:text-white flex justify-between gap-2">
                        <span>{p.razon_social}</span>
                        {p.cuit && <span className="text-xs text-zinc-400 font-mono">{p.cuit}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500">Fecha</label>
              <input type="date" value={opForm.fecha} onChange={(e) => setOpForm({ ...opForm, fecha: e.target.value })} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
            </div>
          </div>

          {/* ── Documentos a pagar (FC) ── */}
          {opForm.proveedor_id && (
            <div>
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1 block">Documentos a pagar</label>
              {opFCLoading ? (
                <div className="flex items-center gap-2 text-xs text-zinc-400 py-2"><Loader2 className="h-3 w-3 animate-spin" />Cargando facturas...</div>
              ) : opFCPendientes.length === 0 ? (
                <p className="text-xs text-zinc-400 py-1">Sin facturas pendientes: se carga como pago a cuenta (queda a favor nuestro y después se aplica a la factura).</p>
              ) : (
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500">
                      <th className="w-8 px-2 py-1 text-center">
                        {!pagoParcialDirecto && (
                          <input type="checkbox" title="Seleccionar todas"
                            checked={opFCPendientes.length > 0 && opFCPendientes.every(f => f.selected)}
                            onChange={(e) => { const todas = e.target.checked; setOpFCPendientes(prev => prev.map(f => ({ ...f, selected: todas, monto_a_pagar: todas ? f.saldo_pendiente : 0 }))); }}
                            className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                        )}
                      </th>
                      <th className="text-left px-2 py-1">N° Factura</th>
                      <th className="text-left px-2 py-1">Fecha</th>
                      <th className="text-right px-2 py-1">Total</th>
                      <th className="text-right px-2 py-1">Saldo</th>
                      <th className="text-right px-2 py-1">A pagar</th>
                    </tr></thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {opFCPendientes.map(fc => (
                        <tr key={fc.id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${fc.selected ? "bg-orange-50/50 dark:bg-orange-900/10" : ""}`}>
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" checked={fc.selected}
                              disabled={pagoParcialDirecto && pagoParcialFCId !== fc.id}
                              onChange={() => {
                                setOpFCPendientes(prev => prev.map(f => (pagoParcialDirecto && f.id !== fc.id) ? { ...f, selected: false, monto_a_pagar: 0 } : f.id === fc.id ? { ...f, selected: !f.selected, monto_a_pagar: !f.selected ? f.saldo_pendiente : 0 } : f));
                              }}
                              className="rounded border-zinc-300 text-orange-500 focus:ring-orange-500" />
                          </td>
                          <td className="px-2 py-1 font-mono text-xs dark:text-white">{fc.numero || "S/N"}</td>
                          <td className="px-2 py-1 text-xs text-zinc-500">{formatDate(fc.fecha)}</td>
                          <td className="px-2 py-1 text-right font-mono text-xs text-zinc-500">{formatCurrency(fc.total, fc.moneda as "ARS"|"USD")}</td>
                          <td className="px-2 py-1 text-right font-mono text-xs font-medium dark:text-white">{formatCurrency(fc.saldo_pendiente, fc.moneda as "ARS"|"USD")}</td>
                          <td className="px-2 py-1 text-right">
                            {fc.selected ? (
                              <span className="inline-flex items-center gap-1"><span className="text-[10px] font-semibold text-zinc-500">{fc.moneda === "USD" ? "US$" : "$"}</span>
                              <input type="number" value={fc.monto_a_pagar || ""}
                                onChange={(e) => {
                                  const val = Math.min(Number(e.target.value), fc.saldo_pendiente);
                                  setOpFCPendientes(prev => prev.map(f => f.id === fc.id ? { ...f, monto_a_pagar: val } : f));
                                }}
                                className="w-28 text-right rounded border border-zinc-200 px-2 py-0.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                              <button type="button" title="Completar con el saldo de la factura" onClick={() => setOpFCPendientes(prev => prev.map(f => f.id === fc.id ? { ...f, monto_a_pagar: fc.saldo_pendiente } : f))} className="shrink-0 rounded p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles className="h-3.5 w-3.5" /></button></span>
                            ) : <span className="text-xs text-zinc-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!opForm.usar_monto_manual && !pagoParcialDirecto && opNCDisponibles.some(n => n.moneda === opMonedaDocs) && (
                <div className="mt-3 border border-emerald-200 dark:border-emerald-800 rounded-lg overflow-hidden">
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">Notas de crédito disponibles del proveedor (restan del pago)</div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {opNCDisponibles.filter(n => n.moneda === opMonedaDocs).map(nc => (
                        <tr key={nc.id} className={nc.selected ? "bg-emerald-50/60 dark:bg-emerald-900/10" : ""}>
                          <td className="px-2 py-1 w-8 text-center">
                            <input type="checkbox" checked={nc.selected}
                              onChange={() => setOpNCDisponibles(prev => prev.map(n => n.id === nc.id ? { ...n, selected: !n.selected, monto_a_aplicar: !n.selected ? n.disponible : 0 } : n))}
                              className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500" />
                          </td>
                          <td className="px-2 py-1 font-mono text-xs dark:text-white">{nc.tipo_comprobante} {nc.numero}</td>
                          <td className="px-2 py-1 text-xs text-zinc-500">{formatDate(nc.fecha)}</td>
                          <td className="px-2 py-1 text-right font-mono text-xs text-zinc-500">disp. {formatCurrency(nc.disponible, nc.moneda as "ARS"|"USD")}</td>
                          <td className="px-2 py-1 text-right">
                            {nc.selected ? (
                              <input type="number" value={nc.monto_a_aplicar || ""}
                                onChange={(e) => { const val = Math.max(0, Math.min(Number(e.target.value), nc.disponible)); setOpNCDisponibles(prev => prev.map(n => n.id === nc.id ? { ...n, monto_a_aplicar: val } : n)); }}
                                className="w-28 text-right rounded border border-emerald-200 px-2 py-1 text-xs font-mono text-emerald-700 dark:border-emerald-800 dark:bg-zinc-800" />
                            ) : <span className="text-xs text-zinc-300">—</span>}
                            {nc.selected && (
                              <button type="button" title="Aplicar todo lo disponible" onClick={() => setOpNCDisponibles(prev => prev.map(n => n.id === nc.id ? { ...n, monto_a_aplicar: nc.disponible } : n))} className="shrink-0 rounded p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles className="h-3.5 w-3.5" /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {opEnPesosUsd && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-1.5 text-xs dark:border-sky-800 dark:bg-sky-950/20">
                  <span className="font-semibold text-sky-800 dark:text-sky-300">Se paga en pesos · Dólar</span>
                  <span className="inline-flex items-center gap-1">$
                    <input type="text" inputMode="decimal" value={opCotizacion}
                      onChange={(e) => { opCotizacionEditada.current = true; setOpCotizacion(e.target.value); }}
                      className={`w-24 rounded border px-2 py-0.5 text-right font-mono text-xs dark:bg-zinc-800 dark:text-white ${opTCOk ? "border-zinc-200 dark:border-zinc-700" : "border-red-400"}`} />
                  </span>
                  {opCotizacionLoading ? <span className="text-zinc-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />BNA…</span>
                    : opCotizacionBna ? (
                      <button type="button" title="Usar la cotización del BNA" onClick={() => { opCotizacionEditada.current = false; setOpCotizacion(toDecimalInput(opCotizacionBna.valor)); }}
                        className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">BNA divisa vendedor {formatDate(opCotizacionBna.fecha)}: {formatCurrency(opCotizacionBna.valor, "ARS")}</button>
                    ) : <span className="text-amber-700 dark:text-amber-400">Sin BNA: cargá la cotización a mano</span>}
                  {opTCOk && <span className="ml-auto font-mono text-zinc-600 dark:text-zinc-300">{formatCurrency(opMontoBrutoDocs, "USD")} × {formatCurrency(opTC, "ARS")} = <strong>{formatCurrency(opMontoBruto, "ARS")}</strong></span>}
                </div>
              )}
              {(opMontoBruto > 0 || opNCAplicado > 0) && (
                <div className="mt-2 space-y-0.5 text-sm">
                  {opNCAplicado > 0 && <>
                    <div className="flex justify-between text-zinc-500"><span>Facturas</span><span className="font-mono">{formatCurrency(opMontoBrutoFC, opMonedaDocs)}</span></div>
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400"><span>− Notas de crédito</span><span className="font-mono">−{formatCurrency(opNCAplicado, opMonedaDocs)}</span></div>
                  </>}
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500">{opFCPendientes.filter(f => f.selected).length} documento(s) seleccionado(s){opNCAplicado > 0 ? " · a pagar en dinero" : ""}</span>
                    <span className="font-mono font-bold text-orange-600">{formatCurrency(opMontoBruto, opForm.moneda)}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Retención Ganancias ── */}
          {opMontoBruto > 0 && (
            <div className="rounded-lg border border-violet-200 dark:border-violet-800 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" />Ret. Ganancias</label>
                <button type="button" onClick={() => { const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id); setOpManualGanancias(true); setOpMontoRetencionManual(null); setOpForm({ ...opForm, aplica_ganancias: !opForm.aplica_ganancias, retencion_ganancias_pct: !opForm.aplica_ganancias ? (prov?.alicuota_ganancias ?? retencionConfig.tasa_ganancias_ri) : 0 }); }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full ${opForm.aplica_ganancias ? "bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${opForm.aplica_ganancias ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
                {opForm.aplica_ganancias && (
                  <>
                    <input type="number" step="0.5" value={opForm.retencion_ganancias_pct || ""} onChange={(e) => { setOpForm({ ...opForm, retencion_ganancias_pct: Number(e.target.value) }); setOpMontoRetencionManual(null); }}
                      className="w-14 rounded border border-zinc-200 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    <span className="text-xs text-zinc-400">%</span>
                    {[0.25, 2, 3, 6, 28].map(pct => (
                      <button key={pct} type="button" onClick={() => { setOpForm({ ...opForm, retencion_ganancias_pct: pct }); setOpMontoRetencionManual(null); }}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${opForm.retencion_ganancias_pct === pct ? "bg-violet-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>{pct}%</button>
                    ))}
                    <span className="ml-auto text-xs text-zinc-500">Monto retención:</span>
                    <input type="number" step="0.01"
                      value={opMontoRetencionManual !== null ? opMontoRetencionManual : (opRetencionGananciaBruta < retencionConfig.minimo_retencion_ganancias ? 0 : Math.round(opRetencionGananciaBruta * 100) / 100)}
                      onChange={(e) => setOpMontoRetencionManual(Number(e.target.value))}
                      className="w-28 rounded border border-zinc-200 px-1.5 py-0.5 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    {opMontoRetencionManual !== null && (
                      <button type="button" onClick={() => setOpMontoRetencionManual(null)} className="text-[10px] text-violet-500 hover:text-violet-700 underline">auto</button>
                    )}
                  </>
                )}
              </div>
              {/* Exclusion badge */}
              {(() => { const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
                const hoy = new Date().toISOString().slice(0, 10);
                const excluido = prov?.exclusion_retencion && (!prov.exclusion_retencion_desde || prov.exclusion_retencion_desde <= hoy) && (!prov.exclusion_retencion_hasta || prov.exclusion_retencion_hasta >= hoy);
                return excluido ? (
                  <div className="flex items-center gap-1.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300">Excluido de retención{prov.exclusion_retencion_hasta ? ` hasta ${prov.exclusion_retencion_hasta}` : ""}{prov.exclusion_retencion_cert ? ` — Cert: ${prov.exclusion_retencion_cert}` : ""}</span>
                  </div>
                ) : null;
              })()}
              {/* Acumulado mensual y concepto, en una línea */}
              {(() => {
                const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
                const verAcum = isResponsableInscripto(opProvCondicion) && retencionConfig.aplica_ganancias;
                const verConcepto = opForm.aplica_ganancias && !!prov?.concepto_retencion_ganancias;
                if (!verAcum && !verConcepto) return null;
                return (
                  <p className="text-[10px] text-violet-600 dark:text-violet-400 flex flex-wrap gap-x-3">
                    {verAcum && <>
                      <span>Acum. mes <span className="font-mono">{formatCurrency(opMonthlyBase, opForm.moneda)}</span> + esta OP <span className="font-mono">{formatCurrency(opBaseSinIVA, opForm.moneda)}</span> = <span className="font-mono font-semibold">{formatCurrency(opMonthlyBase + opBaseSinIVA, opForm.moneda)}</span></span>
                      <span>Mín. no imponible <span className="font-mono">{formatCurrency(opMinimoGanancias, opForm.moneda)}</span></span>
                      {opMonthlyRetenido > 0 && <span>Ya retenido en el mes <span className="font-mono">{formatCurrency(opMonthlyRetenido, opForm.moneda)}</span></span>}
                    </>}
                    {verConcepto && <span className="text-violet-500">RG 830: {prov!.concepto_retencion_ganancias!.replace(/_/g, " ")} → {prov!.alicuota_ganancias}% inscripto</span>}
                  </p>
                );
              })()}
            </div>
          )}

          {/* ── Monto manual override ── */}
          {opForm.proveedor_id && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Pago a cuenta (sin factura) <span className="font-normal text-zinc-400">— monto libre, sin vincular facturas</span></label>
                <button type="button" onClick={() => setOpForm({ ...opForm, usar_monto_manual: !opForm.usar_monto_manual, monto_manual: 0 })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full ${opForm.usar_monto_manual ? "bg-orange-500" : "bg-zinc-300 dark:bg-zinc-600"}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${opForm.usar_monto_manual ? "translate-x-4.5" : "translate-x-0.5"}`} />
                </button>
              </div>
              {opForm.usar_monto_manual && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-2">
                    <input type="number" value={opForm.monto_manual || ""} onChange={(e) => setOpForm({ ...opForm, monto_manual: Number(e.target.value) })}
                      placeholder="Monto total a pagar" className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    <span className="text-xs text-zinc-400 whitespace-nowrap">{opForm.moneda}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-zinc-500 whitespace-nowrap">IVA incluido:</label>
                    {[21, 10.5, 0].map(pct => (
                      <button key={pct} type="button" onClick={() => setOpForm({ ...opForm, iva_manual_pct: pct })}
                        className={`rounded px-2 py-0.5 text-xs font-medium ${opForm.iva_manual_pct === pct ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2.5 md:grid-cols-2 items-start">
          {/* ── Resumen ── */}
          {opMontoBruto > 0 && (
            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 space-y-0.5">
              <div className="flex justify-between text-sm"><span className="text-zinc-500">{opForm.usar_monto_manual ? "Monto" : "Documentos"}</span><span className="font-mono">{formatCurrency(opMontoBruto, opForm.moneda)}</span></div>
              {opBaseSinIVA > 0 && opBaseSinIVA !== opMontoBruto && (
                <div className="flex justify-between text-sm text-zinc-400">
                  <span>Base sin IVA (Art. 23 RG 830)</span>
                  <span className="font-mono">{formatCurrency(opBaseSinIVA, opForm.moneda)}</span>
                </div>
              )}
              {opRetencionGanancias > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-violet-500" />
                    Ret. Ganancias ({opForm.retencion_ganancias_pct}% s/ {formatCurrency(opBaseGanancias, opForm.moneda)})
                  </span>
                  <span className="font-mono text-violet-600">- {formatCurrency(opRetencionGanancias, opForm.moneda)}</span>
                </div>
              )}
              {opRetencionGananciaBruta > 0 && opRetencionGanancias === 0 && (
                <div className="flex justify-between text-xs text-amber-500">
                  <span>Ret. Ganancias no aplicada (menor a {formatCurrency(retencionConfig.minimo_retencion_ganancias, opForm.moneda)} — Art. 29 RG 830)</span>
                  <span className="font-mono">{formatCurrency(opRetencionGananciaBruta, opForm.moneda)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                <span className="text-zinc-700 dark:text-white">Neto a pagar</span>
                <span className="flex items-center gap-1">
                  <span className="font-mono text-emerald-600 text-base">{formatCurrency(opNetoAPagar, opForm.moneda)}</span>
                  <CopiarBtn texto={(Math.round(opNetoAPagar * 100) / 100).toFixed(2)} title="Copiar neto a pagar" />
                </span>
              </div>
              {opSaldoFavor > 0.01 && (
                <div className="flex justify-between text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <span>Crédito a nuestro favor en cuenta corriente</span>
                  <span className="font-mono">{formatCurrency(opSaldoFavor, opForm.moneda)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Datos bancarios del proveedor ── */}
          {opForm.proveedor_id && (() => {
            const prov = proveedoresOptions.find(p => p.id === opForm.proveedor_id);
            if (!prov || (!prov.cuit && !prov.cbu && !prov.alias_bancario && !prov.banco && !prov.numero_cuenta && !prov.titular_cuenta)) return null;
            const fila = (label: string, valor: string, copiar = false, mono = true) => (
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-12 shrink-0 text-zinc-500">{label}</span>
                <span className={`truncate font-medium ${mono ? "font-mono" : ""} select-all`}>{valor}</span>
                {copiar && <CopiarBtn texto={valor} title={`Copiar ${label}`} />}
              </div>
            );
            return (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-2 text-xs space-y-0.5">
                <p className="font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1 min-w-0"><Landmark className="h-3.5 w-3.5 shrink-0" />Datos bancarios
                  {(prov.banco || prov.tipo_cuenta || prov.numero_cuenta) && <span className="truncate font-normal text-zinc-600 dark:text-zinc-300">· {[prov.banco, prov.tipo_cuenta, prov.numero_cuenta ? `N° ${prov.numero_cuenta}` : ""].filter(Boolean).join(" · ")}</span>}
                </p>
                {prov.titular_cuenta && fila("Titular", prov.titular_cuenta, false, false)}
                {prov.cbu && fila("CBU", prov.cbu, true)}
                {prov.alias_bancario && fila("Alias", prov.alias_bancario, true)}
                {prov.cuit && fila("CUIT", prov.cuit, true)}
              </div>
            );
          })()}
          </div>

          {/* ── Medios de pago (múltiples) ── */}
          {opMontoBruto > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Medios de pago</label>
                <button type="button" onClick={() => setOpMedios([...opMedios, makeOpMedio(opForm.moneda)])}
                  className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600 font-medium"><Plus className="h-3 w-3" />Agregar medio</button>
              </div>
              <div className="space-y-1">
                {opMedios.map((m, idx) => (
                  <div key={m.tempId} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-2 py-1">
                    <select value={m.tipo} onChange={(e) => setOpMedios(prev => prev.map((x, i) => {
                      if (i !== idx) return x;
                      const tipo = e.target.value as OpMedioPago["tipo"];
                      return {
                        ...x,
                        tipo,
                        echeq_id: undefined,
                        cheque_comprobante: undefined,
                        aviso_cheque: undefined,
                        origen_cheque: tipo === "echeq" || tipo === "cheque_propio" ? "propio" : tipo === "cheque" ? "cartera" : undefined,
                      };
                    }))}
                      className="w-28 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                      <option value="transferencia">Transferencia</option>
                      <option value="deposito">Depósito</option>
                      {!pagoParcialDirecto && <option value="cheque">Cheque tercero</option>}
                      {!pagoParcialDirecto && <option value="cheque_propio">Cheque propio</option>}
                      {!pagoParcialDirecto && <option value="echeq">E-Cheq</option>}
                      <option value="efectivo">Efectivo</option>
                      <option value="tarjeta">Tarjeta</option>
                    </select>
                    <div className="relative w-32 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-mono">$</span>
                      <input type="number" value={m.monto || ""} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, monto: Number(e.target.value) } : x))}
                        placeholder="Monto" className="w-full rounded border border-zinc-200 pl-5 pr-2 py-1 text-right text-xs font-mono dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    </div>
                    <button type="button" title="Completar con lo que falta del neto a pagar" onClick={() => setOpMedios(prev => { const otros = prev.reduce((s, x, i) => i === idx ? s : s + (Number(x.monto) || 0), 0); return prev.map((x, i) => i === idx ? { ...x, monto: Math.max(0, Math.round((opNetoAPagar - otros) * 100) / 100) } : x); })} className="shrink-0 rounded p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/40"><Sparkles className="h-3.5 w-3.5" /></button>
                    <input type="date" title="Cobro / acreditación" value={m.fecha_cobro || m.fecha} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, fecha: e.target.value, fecha_cobro: e.target.value } : x))}
                      className="w-32 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                    {(m.tipo !== "efectivo" && m.tipo !== "tarjeta") && (
                      <>
                        <select value={m.banco === "Otro" || (m.banco && !BANCOS_ARGENTINA.includes(m.banco)) ? "Otro" : m.banco} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, banco: e.target.value, banco_otro: e.target.value === "Otro" ? (x.banco === "Otro" ? x.banco_otro : x.banco) : undefined } : x))}
                          className="w-32 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="">Banco…</option>
                          {BANCOS_ARGENTINA.filter((b, i, a) => a.indexOf(b) === i).map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                        {(m.banco === "Otro" || (m.banco && !BANCOS_ARGENTINA.includes(m.banco))) && <input value={m.banco === "Otro" ? (m.banco_otro || "") : m.banco} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, banco: "Otro", banco_otro: e.target.value } : x))}
                          placeholder="Nombre del banco" className="w-28 rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />}
                        <input value={m.numero_cheque} onChange={(e) => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, numero_cheque: e.target.value } : x))}
                          placeholder="N° cheque" className="w-24 shrink-0 rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                      </>
                    )}
                    {/* Un e-cheq manual se emite ahora; solo los cheques elegidos de cartera son de terceros. */}
                    {/* 26/10/2026: el cheque sale del comprobante del banco; elegirlo de la lista queda escondido ("elegir a mano"). */}
                    {(m.tipo === "echeq" || m.tipo === "cheque" || m.tipo === "cheque_propio") && !m.elegir_a_mano && (
                      <span className="flex items-center gap-1.5 text-[10px]">
                        {m.cheque_comprobante
                          ? <span className="font-medium text-emerald-600">{m.cheque_comprobante}</span>
                          : m.tipo === "cheque" || (m.tipo === "echeq" && m.origen_cheque === "cartera")
                            ? <span className="text-amber-600">Cheque de cliente: cargá el comprobante del endoso</span>
                            : <span className="text-zinc-400">Se registrará como emitido al confirmar</span>}
                        <button type="button" onClick={() => setOpMedios(prev => prev.map((x, i) => i === idx ? { ...x, elegir_a_mano: true } : x))} className="text-zinc-400 underline hover:text-zinc-600">elegir a mano</button>
                      </span>
                    )}
                    {(m.tipo === "echeq" || m.tipo === "cheque" || m.tipo === "cheque_propio") && m.elegir_a_mano && (() => {
                      const available = m.tipo === "cheque_propio"
                        ? echeqs.filter(e => e.direccion === "emitido" && e.estado === "pendiente" && e.moneda === m.moneda)
                        : echeqs.filter(e => (e.direccion === "recibido" || !e.direccion)
                          && e.estado === "en_cartera"
                          && e.moneda === m.moneda
                          && (m.tipo === "echeq" ? e.tipo_cheque === "echeq" : e.tipo_cheque !== "echeq"));
                      return available.length > 0 ? (
                        <select value={m.echeq_id || ""} onChange={(e) => {
                          const sel = available.find(x => x.id === e.target.value);
                          setOpMedios(prev => prev.map((x, i) => i === idx ? {
                            ...x,
                            echeq_id: e.target.value || undefined,
                            cheque_comprobante: undefined,
                            aviso_cheque: undefined,
                            origen_cheque: e.target.value ? (m.tipo === "cheque_propio" ? "propio" : "cartera") : (m.tipo === "echeq" || m.tipo === "cheque_propio" ? "propio" : "cartera"),
                            monto: sel ? sel.monto : x.monto,
                            banco: sel?.banco_emisor || x.banco,
                            numero_cheque: sel?.numero || x.numero_cheque,
                          } : x));
                        }} className="max-w-[160px] rounded border border-zinc-200 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                          <option value="" disabled={m.tipo === "cheque"}>{m.tipo === "echeq" ? "Emitido manualmente" : m.tipo === "cheque_propio" ? "Nuevo cheque" : "Elegí de cartera"}</option>
                          {available.map(e => <option key={e.id} value={e.id}>{e.numero} — {formatCurrency(e.monto, (e.moneda as "ARS" | "USD") || "ARS")}{e.banco_emisor ? ` (${e.banco_emisor})` : ""}</option>)}
                        </select>
                      ) : m.tipo === "cheque_propio" || m.tipo === "echeq" ? (
                        <span className="text-[10px] text-zinc-400">Se registrará como emitido al confirmar</span>
                      ) : m.tipo === "cheque" ? (
                        <span className="text-[10px] text-red-500">No hay cheques de terceros disponibles en cartera</span>
                      ) : null;
                    })()}
                    {m.fecha_emision && <span className="text-[10px] text-zinc-500">Emitido {formatDate(m.fecha_emision)}</span>}
                    {m.aviso_cheque && <span className="basis-full text-[10px] font-medium text-amber-600">⚠️ {m.aviso_cheque}</span>}
                    {opMedios.length > 1 && (
                      <button type="button" onClick={() => setOpMedios(prev => prev.filter((_, i) => i !== idx))} className="ml-auto text-zinc-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-1 text-sm">
                <span className="text-zinc-500">Total medios</span>
                <span className={`font-mono font-bold ${opSaldoFavor > 0.01 || Math.abs(opDiferencia) <= 1 ? "text-emerald-600" : "text-amber-600"}`}>
                  {formatCurrency(opTotalMedios, opForm.moneda)}
                </span>
              </div>
              {opSaldoFavor > 0.01 && (
                <p className="text-xs text-emerald-600 mt-1">Crédito a nuestro favor en CC: {formatCurrency(opSaldoFavor, opForm.moneda)}</p>
              )}
              {opDiferencia > 1 && opTotalMedios > 0 && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-2">
                  Faltan {formatCurrency(opDiferencia, opForm.moneda)}
                  {!pagoParcialDirecto && !opForm.usar_monto_manual && (
                    <button type="button" onClick={() => aplicarPagoParcial()} className="rounded border border-amber-300 px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20">Pagar parcial</button>
                  )}
                </p>
              )}
              {opMedios.length === 1 && opMedios[0].monto === 0 && opNetoAPagar > 0 && (
                <button type="button" onClick={() => setOpMedios([{ ...opMedios[0], monto: Math.round(opNetoAPagar * 100) / 100 }])}
                  className="text-xs text-orange-500 hover:text-orange-600 mt-1 font-medium">Completar con neto a pagar</button>
              )}
            </div>
          )}

          {/* Notas + Comprobante */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-500">Notas</label>
              <textarea value={opForm.notas} onChange={(e) => setOpForm({ ...opForm, notas: e.target.value })}
                rows={1} className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" placeholder="Observaciones..." />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500">Comprobantes — <span className="text-orange-500">IA autocompleta medios</span></label>
              <div className="mt-1 space-y-1">
                <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed px-3 py-1.5 text-sm hover:border-orange-400 ${opParsingFile ? "border-orange-300 bg-orange-50/50 text-orange-600" : "border-zinc-300 text-zinc-500 dark:border-zinc-600"}`}>
                  {opParsingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-orange-500" />}
                  {opParsingFile ? "Procesando con IA..." : opFiles.length > 0 ? `+ Agregar otro archivo` : "Adjuntar comprobante"}
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden" disabled={opParsingFile} onChange={(e) => {
                    const files = e.target.files;
                    if (files) { for (const f of Array.from(files)) handleParseComprobante(f); }
                    e.target.value = "";
                  }} />
                </label>
                {opFiles.length > 0 && !opParsingFile && (
                  <div className="space-y-1">
                    {opFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <Paperclip className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate flex-1">{f.name}</span>
                        <button onClick={() => setOpFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
          <button onClick={onClose} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
          {!pagoParcialDirecto && (
            <button onClick={() => handleCreateOP(false)} disabled={opSaving || !opForm.proveedor_id || (opMontoBruto <= 0)}
              title="Crea la OP sin mandar nada; la mandás después desde la lista"
              className="flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-600 hover:bg-orange-50 disabled:opacity-50 dark:hover:bg-orange-950/30">
              {opSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>
          )}
          <button onClick={pagoParcialDirecto ? handleRegistrarPagoParcialDirecto : () => handleCreateOP(true)} disabled={opSaving || !opForm.proveedor_id || (opMontoBruto <= 0)}
            title={pagoParcialDirecto ? undefined : "Crea la OP y abre el mail al proveedor con la OP y los comprobantes"}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
            {opSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {pagoParcialDirecto ? "Registrar pago parcial" : "Guardar y enviar"}
          </button>
        </div>
      </div>
    </>
    </>
  );
}
