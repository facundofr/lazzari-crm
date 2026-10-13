"use client";

/**
 * Plan de pagos a proveedores.
 *
 * 1. Armar: todas las facturas aprobadas pendientes, agrupadas por proveedor. Se tilda qué pagar
 *    (todo el saldo o parcial), se descuentan solas las NC disponibles y se calcula la retención
 *    de Ganancias de cada proveedor una sola vez (RG 830).
 * 2. Resumen para el banco: CUIT, CBU/alias, banco, titular, forma de pago y neto a transferir.
 *    Se exporta a Excel. (El archivo para BBVA Net Cash se agrega cuando tengamos su diseño).
 * 3. Registrar: cuando se paga, se cargan los comprobantes (todos juntos, la IA los lee y los
 *    empareja) o se marca a mano. Cada pago se registra con la misma función segura de la OP.
 *
 * Solo pesos: las facturas en dólares se pagan desde la OP (liquidación con tipo de cambio).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Sparkles, Check, AlertTriangle, Copy, Download, FileUp, ChevronDown, ChevronRight, Landmark, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { parseDecimalInput } from "@/lib/decimal-input";
import {
  r2, RETENCION_DEFAULT, baseSinIVADe, calcularRetencionGanancias, repartirNC, similitudNombre,
  type RetencionConfig, type ResultadoRetencion,
} from "@/lib/plan-pagos";
import { proponerCheques, textoCondicionPago, vencimientoFactura, type FechasChequeMes, type PlanPago } from "@/lib/condicion-pago";

const db = supabase as any;

interface Props {
  sociedadId: string;
  onClose: () => void;
  onPagosRegistrados?: () => void;
}

interface ProvInfo {
  id: string; razon_social: string; cuit: string | null; condicion_iva: string | null;
  cbu: string | null; alias_bancario: string | null; banco: string | null; titular_cuenta: string | null; tipo_cuenta: string | null;
  forma_pago: string | null; dias_cuenta_corriente: number | null; alicuota_ganancias: number | null; concepto_retencion_ganancias?: string | null;
  exclusion_retencion: boolean | null; exclusion_retencion_desde: string | null; exclusion_retencion_hasta: string | null;
  // Cómo se le paga (lib/condicion-pago.ts)
  condicion_pago?: string | null; dias_pago?: number | null; dias_pago_hasta?: number | null;
  medio_pago_preferido?: string | null; plazo_cheque_dias?: number | null; descuento_pronto_pago?: number | null;
}
interface FC {
  id: string; proveedor_id: string; numero: string; tipo_comprobante: string; fecha: string; vencimiento: string;
  plan: PlanPago;
  subtotal: number; total: number; saldo: number; enPlan: string | null;
  seleccionada: boolean; monto: string;
}
interface NC { id: string; proveedor_id: string; numero: string; subtotal: number; total: number; disponible: number }
interface ItemLote {
  id: string; lote_id: string; proveedor_id: string; razon_social: string | null; cuit: string | null;
  cbu: string | null; alias_bancario: string | null; banco: string | null; titular_cuenta: string | null; forma_pago: string;
  facturas: Array<{ id: string; numero: string; monto: number }>; notas_credito: Array<{ nc_id: string; factura_compra_id: string; monto: number }>;
  monto_bruto: number; nc_aplicado: number; base_retencion: number; retencion_pct: number; retencion_monto: number; neto: number;
  estado: "pendiente" | "pagado" | "omitido"; request_key: string; orden_pago_id: string | null; fecha_pago: string | null;
  referencia: string | null; comprobante_url: string | null; error: string | null;
}
interface Lote { id: string; numero: string; fecha: string; estado: string; created_at: string }

const inp = "rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
const ars = (n: number) => formatCurrency(n, "ARS");
const mesDe = (fecha: string) => fecha.slice(0, 7);
const sumarDias = (fecha: string, dias: number) => {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + (Number(dias) || 0));
  return d.toISOString().slice(0, 10);
};

function copiar(texto: string) {
  try { void navigator.clipboard.writeText(texto); } catch { /* sin portapapeles */ }
}

export default function PlanPagos({ sociedadId, onClose, onPagosRegistrados }: Props) {
  const [vista, setVista] = useState<"armar" | "lote">("armar");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [fechaPago, setFechaPago] = useState(todayAR());
  const [venceHasta, setVenceHasta] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [provs, setProvs] = useState<Record<string, ProvInfo>>({});
  const [fcs, setFcs] = useState<FC[]>([]);
  const [ncs, setNcs] = useState<NC[]>([]);
  const [usarNC, setUsarNC] = useState<Record<string, boolean>>({});
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [config, setConfig] = useState<RetencionConfig>(RETENCION_DEFAULT);
  const [mensual, setMensual] = useState<Record<string, { base: number; retenido: number; otraMoneda: boolean }>>({});
  const [usdPendientes, setUsdPendientes] = useState(0);
  // Fechas fijas de cheque de cada mes (Configuración → Fechas de cheque)
  const [chequeFechas, setChequeFechas] = useState<FechasChequeMes[]>([]);
  const [guardando, setGuardando] = useState(false);
  // Lote
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [loteId, setLoteId] = useState("");
  const [items, setItems] = useState<ItemLote[]>([]);
  const [registrando, setRegistrando] = useState<string>("");
  const [leyendo, setLeyendo] = useState("");
  const [asignacion, setAsignacion] = useState<Array<{ file: File; pago: any; itemId: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Carga inicial ──
  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sociedadId]);
  useEffect(() => { if (vista === "armar") void cargarMensual(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fechaPago, Object.keys(provs).length]);

  async function cargar() {
    setCargando(true); setError("");
    try {
      // Configuración de retenciones
      const { data: cfg } = await db.from("retencion_config").select("*").eq("sociedad_id", sociedadId).maybeSingle();
      if (cfg) setConfig({
        aplica_ganancias: cfg.aplica_ganancias ?? true,
        minimo_ganancias: Number(cfg.minimo_ganancias ?? 224000),
        tasa_ganancias_ri: Number(cfg.tasa_ganancias_ri ?? 2),
        minimo_retencion_ganancias: Number(cfg.minimo_retencion_ganancias ?? 240),
      });

      // Facturas pendientes (aprobadas): estado pendiente o recibida, sin NC
      const facturas: any[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error: e } = await db.from("facturas_compra")
          .select("id, proveedor_id, numero_factura, tipo_comprobante, fecha, fecha_vencimiento, subtotal, total, moneda, condicion_pago, dias_pago, dias_pago_hasta")
          .eq("sociedad_id", sociedadId).in("estado", ["pendiente", "recibida"]).not("tipo_comprobante", "ilike", "NC%")
          .order("fecha").range(desde, desde + 999);
        if (e) throw e;
        facturas.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const enPesos = facturas.filter(f => (f.moneda || "ARS") === "ARS");
      setUsdPendientes(facturas.length - enPesos.length);

      // Lo ya pagado de cada factura (OP vigentes + pagos parciales directos)
      const pagado: Record<string, number> = {};
      const ids = enPesos.map(f => f.id);
      for (let i = 0; i < ids.length; i += 150) {
        const lote = ids.slice(i, i + 150);
        const [{ data: ops, error: e1 }, { data: dir, error: e2 }] = await Promise.all([
          db.from("op_facturas_compra").select("factura_compra_id, monto, ordenes_pago(estado, sociedad_id)").in("factura_compra_id", lote),
          db.from("movimientos").select("factura_compra_id, monto, retencion_ganancias_monto, anulado").in("factura_compra_id", lote).eq("tipo", "pago").eq("sociedad_id", sociedadId),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        for (const r of ops || []) {
          if (r.ordenes_pago?.estado === "anulada" || r.ordenes_pago?.sociedad_id !== sociedadId) continue;
          pagado[r.factura_compra_id] = (pagado[r.factura_compra_id] || 0) + Number(r.monto || 0);
        }
        for (const r of dir || []) if (!r.anulado) pagado[r.factura_compra_id] = (pagado[r.factura_compra_id] || 0) + Number(r.monto || 0) + Number(r.retencion_ganancias_monto || 0);
      }

      // Facturas que ya están en un plan sin pagar
      const enPlan: Record<string, string> = {};
      const { data: abiertos } = await db.from("pagos_lote_items").select("facturas, estado, pagos_lotes(numero, estado)").eq("sociedad_id", sociedadId).eq("estado", "pendiente");
      for (const it of abiertos || []) {
        if (it.pagos_lotes?.estado === "anulado") continue;
        for (const f of it.facturas || []) enPlan[f.id] = it.pagos_lotes?.numero || "otro plan";
      }

      // Proveedores
      const provIds = [...new Set(enPesos.map(f => f.proveedor_id).filter(Boolean))];
      const mapa: Record<string, ProvInfo> = {};
      for (let i = 0; i < provIds.length; i += 150) {
        const lote = provIds.slice(i, i + 150);
        let { data, error: e } = await db.from("proveedores")
          .select("id, razon_social, cuit, condicion_iva, cbu, alias_bancario, banco, titular_cuenta, tipo_cuenta, forma_pago, dias_cuenta_corriente, alicuota_ganancias, concepto_retencion_ganancias, exclusion_retencion, exclusion_retencion_desde, exclusion_retencion_hasta, condicion_pago, dias_pago, dias_pago_hasta, medio_pago_preferido, plazo_cheque_dias, descuento_pronto_pago")
          .in("id", lote);
        if (e) ({ data } = await db.from("proveedores").select("id, razon_social, cuit, condicion_iva, cbu, alias_bancario, forma_pago, dias_cuenta_corriente").in("id", lote));
        for (const p of data || []) mapa[p.id] = { banco: null, titular_cuenta: null, tipo_cuenta: null, alicuota_ganancias: null, exclusion_retencion: null, exclusion_retencion_desde: null, exclusion_retencion_hasta: null, ...p };
      }
      setProvs(mapa);

      const { data: fechasCheque } = await db.from("cheque_fechas_mes").select("mes, dias").eq("sociedad_id", sociedadId).gte("mes", `${todayAR().slice(0, 4)}-01-01`);
      setChequeFechas((fechasCheque || []) as FechasChequeMes[]);

      setFcs(enPesos.map(f => {
        const saldo = r2(Math.max(0, Number(f.total) - (pagado[f.id] || 0)));
        const p = mapa[f.proveedor_id];
        // Lo que pidió el proveedor en esa factura; si no, lo del proveedor. Medio y plazo del cheque, siempre del proveedor.
        const plan: PlanPago = {
          condicion_pago: f.condicion_pago || p?.condicion_pago || null,
          dias_pago: f.condicion_pago ? f.dias_pago : p?.dias_pago ?? null,
          dias_pago_hasta: f.condicion_pago ? f.dias_pago_hasta : p?.dias_pago_hasta ?? null,
          medio_pago_preferido: p?.medio_pago_preferido || null, plazo_cheque_dias: p?.plazo_cheque_dias ?? null, descuento_pronto_pago: p?.descuento_pronto_pago ?? null,
        };
        return {
          id: f.id, proveedor_id: f.proveedor_id, numero: f.numero_factura || "S/N", tipo_comprobante: f.tipo_comprobante || "FC",
          plan,
          fecha: f.fecha, vencimiento: f.fecha_vencimiento || vencimientoFactura(f.fecha, plan) || sumarDias(f.fecha, Number(p?.dias_cuenta_corriente) || 0),
          subtotal: Number(f.subtotal) || 0, total: Number(f.total) || 0, saldo, enPlan: enPlan[f.id] || null,
          seleccionada: false, monto: String(saldo),
        };
      }).filter(f => f.saldo > 0.004 && f.proveedor_id));

      // NC con crédito disponible (en pesos)
      const { data: ncRows } = await db.from("facturas_compra").select("id, proveedor_id, numero_factura, subtotal, total, moneda")
        .eq("sociedad_id", sociedadId).neq("estado", "anulada").ilike("tipo_comprobante", "NC%");
      const ncPesos = (ncRows || []).filter((n: any) => (n.moneda || "ARS") === "ARS" && provIds.includes(n.proveedor_id));
      const aplicado: Record<string, number> = {};
      const ncIds = ncPesos.map((n: any) => n.id);
      for (let i = 0; i < ncIds.length; i += 150) {
        const { data: movs } = await db.from("movimientos").select("nota_credito_compra_id, monto, anulado").in("nota_credito_compra_id", ncIds.slice(i, i + 150));
        for (const m of movs || []) if (!m.anulado) aplicado[m.nota_credito_compra_id] = (aplicado[m.nota_credito_compra_id] || 0) + Number(m.monto || 0);
      }
      setNcs(ncPesos.map((n: any) => ({ id: n.id, proveedor_id: n.proveedor_id, numero: n.numero_factura || "S/N", subtotal: Number(n.subtotal) || 0, total: Number(n.total) || 0, disponible: r2(Math.max(0, Number(n.total) - (aplicado[n.id] || 0))) }))
        .filter((n: NC) => n.disponible > 0.004));

      await cargarLotes();
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las facturas pendientes");
    } finally {
      setCargando(false);
    }
  }

  // Acumulado del mes de cada proveedor (bases y retenciones ya practicadas) para RG 830
  async function cargarMensual() {
    const provIds = Object.keys(provs);
    if (!provIds.length) return;
    const mes = mesDe(fechaPago);
    const [y, m] = mes.split("-").map(Number);
    const sig = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const res: Record<string, { base: number; retenido: number; otraMoneda: boolean }> = {};
    for (let i = 0; i < provIds.length; i += 150) {
      const lote = provIds.slice(i, i + 150);
      const [{ data: ops }, { data: dir }] = await Promise.all([
        db.from("ordenes_pago").select("proveedor_id, base_retencion_ganancias, retencion_ganancias_monto, moneda, estado")
          .eq("sociedad_id", sociedadId).in("proveedor_id", lote).gte("fecha", `${mes}-01`).lt("fecha", sig).neq("estado", "anulada"),
        db.from("movimientos").select("proveedor_id, base_retencion_ganancias, retencion_ganancias_monto, moneda, anulado, nota_credito_compra_id, factura_compra_id")
          .eq("sociedad_id", sociedadId).in("proveedor_id", lote).eq("tipo", "pago").not("factura_compra_id", "is", null).is("nota_credito_compra_id", null)
          .gte("fecha", `${mes}-01`).lt("fecha", sig),
      ]);
      for (const r of [...(ops || []), ...(dir || []).filter((d: any) => !d.anulado)]) {
        const x = res[r.proveedor_id] || { base: 0, retenido: 0, otraMoneda: false };
        x.base += Number(r.base_retencion_ganancias || 0);
        x.retenido += Number(r.retencion_ganancias_monto || 0);
        if (r.moneda && r.moneda !== "ARS") x.otraMoneda = true;
        res[r.proveedor_id] = x;
      }
    }
    setMensual(res);
  }

  async function cargarLotes() {
    const { data } = await db.from("pagos_lotes").select("id, numero, fecha, estado, created_at").eq("sociedad_id", sociedadId).neq("estado", "anulado").order("created_at", { ascending: false }).limit(30);
    setLotes(data || []);
  }

  async function abrirLote(id: string) {
    setLoteId(id); setVista("lote"); setError(""); setAviso(""); setAsignacion([]);
    const { data, error: e } = await db.from("pagos_lote_items").select("*").eq("lote_id", id).order("razon_social");
    if (e) { setError(e.message); return; }
    setItems((data || []).map((it: any) => ({ ...it, monto_bruto: Number(it.monto_bruto), nc_aplicado: Number(it.nc_aplicado), base_retencion: Number(it.base_retencion), retencion_pct: Number(it.retencion_pct), retencion_monto: Number(it.retencion_monto), neto: Number(it.neto) })));
  }

  // ── Armado: agrupado por proveedor ──
  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const porProv = new Map<string, FC[]>();
    for (const f of fcs) {
      if (venceHasta && f.vencimiento > venceHasta && !f.seleccionada) continue;
      const p = provs[f.proveedor_id];
      if (q && !`${p?.razon_social || ""} ${p?.cuit || ""}`.toLowerCase().includes(q)) continue;
      const arr = porProv.get(f.proveedor_id) || [];
      arr.push(f);
      porProv.set(f.proveedor_id, arr);
    }
    return [...porProv.entries()].map(([provId, lista]) => {
      const p = provs[provId];
      const elegidas = lista.filter(f => f.seleccionada).map(f => ({ ...f, aPagar: r2(Math.min(f.saldo, Math.max(0, parseDecimalInput(f.monto) || 0))) })).filter(f => f.aPagar > 0);
      const bruto = r2(elegidas.reduce((s, f) => s + f.aPagar, 0));
      const ncDisp = ncs.filter(n => n.proveedor_id === provId);
      const aplicarNC = usarNC[provId] !== false;
      const reparto = aplicarNC && bruto > 0 ? repartirNC(elegidas.map(f => ({ id: f.id, monto: f.aPagar })), ncDisp.map(n => ({ id: n.id, monto: n.disponible }))) : [];
      const ncAplicado = r2(reparto.reduce((s, a) => s + a.monto, 0));
      // Base sin IVA: facturas pagadas − parte neta de las NC aplicadas
      const baseFC = elegidas.reduce((s, f) => s + baseSinIVADe(f.aPagar, f, p?.condicion_iva), 0);
      const baseNC = reparto.reduce((s, a) => {
        const nc = ncDisp.find(n => n.id === a.nc_id)!;
        return s + baseSinIVADe(a.monto, { subtotal: nc.subtotal, total: nc.total, tipo_comprobante: "NC" }, p?.condicion_iva);
      }, 0);
      const mes = mensual[provId] || { base: 0, retenido: 0, otraMoneda: false };
      const ret: ResultadoRetencion = calcularRetencionGanancias({
        proveedor: p || {}, config, fecha: fechaPago, baseEstePago: r2(Math.max(0, baseFC - baseNC)), baseMesPrevia: mes.base, retenidoMes: mes.retenido,
      });
      const aPagar = r2(bruto - ncAplicado);
      const neto = r2(aPagar - ret.retencion);
      const vencidas = lista.filter(f => f.vencimiento <= todayAR()).length;
      // Cheques sugeridos en las fechas fijas del mes (si paga con cheque): el neto repartido como lo pide el proveedor.
      const medioCheque = p?.medio_pago_preferido === "echeq" || p?.medio_pago_preferido === "cheque";
      const factor = bruto > 0 ? neto / bruto : 0;
      const porFecha = new Map<string, number>();
      if (medioCheque && neto > 0) {
        for (const f of elegidas) {
          for (const c of proponerCheques(f.fecha, f.aPagar * factor, f.plan, chequeFechas)) {
            const fecha = c.fecha < fechaPago ? fechaPago : c.fecha; // ya vencido: va al día del pago
            porFecha.set(fecha, r2((porFecha.get(fecha) || 0) + c.monto));
          }
        }
      }
      const cheques = [...porFecha.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, monto]) => ({ fecha, monto }));
      return { provId, p, lista, elegidas, bruto, ncDisp, reparto, ncAplicado, aPagar, ret, neto, vencidas, otraMoneda: mes.otraMoneda, cheques };
    }).sort((a, b) => (b.elegidas.length ? 1 : 0) - (a.elegidas.length ? 1 : 0) || (a.p?.razon_social || "").localeCompare(b.p?.razon_social || "", "es"));
  }, [fcs, provs, ncs, usarNC, mensual, config, fechaPago, venceHasta, busqueda, chequeFechas]);

  const conPago = grupos.filter(g => g.elegidas.length && g.aPagar > 0);
  const totalNeto = r2(conPago.reduce((s, g) => s + g.neto, 0));
  const totalRet = r2(conPago.reduce((s, g) => s + g.ret.retencion, 0));

  const setFc = (id: string, c: Partial<FC>) => setFcs(prev => prev.map(f => f.id === id ? { ...f, ...c } : f));
  const toggleProv = (provId: string, on: boolean) => setFcs(prev => prev.map(f => f.proveedor_id === provId && (!venceHasta || f.vencimiento <= venceHasta || !on) ? { ...f, seleccionada: on && !f.enPlan, monto: on ? String(f.saldo) : f.monto } : f));
  function seleccionarVencidas() {
    const limite = venceHasta || todayAR();
    setFcs(prev => prev.map(f => f.vencimiento <= limite && !f.enPlan ? { ...f, seleccionada: true, monto: String(f.saldo) } : f));
  }

  // ── Guardar el plan ──
  async function guardarPlan() {
    if (!conPago.length) { setError("Tildá al menos una factura para pagar."); return; }
    if (conPago.some(g => g.otraMoneda)) { setError("Un proveedor tiene pagos en dólares este mes: su retención hay que calcularla desde la OP."); return; }
    setGuardando(true); setError("");
    try {
      const { data: lote, error: e1 } = await db.from("pagos_lotes").insert({ sociedad_id: sociedadId, fecha: fechaPago, estado: "en_banco" }).select("id, numero").single();
      if (e1) throw e1;
      const filas = conPago.map(g => ({
        lote_id: lote.id, sociedad_id: sociedadId, proveedor_id: g.provId, moneda: "ARS",
        facturas: g.elegidas.map(f => ({ id: f.id, numero: f.numero, monto: f.aPagar })),
        notas_credito: g.reparto,
        monto_bruto: g.aPagar, nc_aplicado: g.ncAplicado, base_retencion: g.ret.base,
        retencion_pct: g.ret.retencion > 0 ? g.ret.pct : 0, retencion_monto: g.ret.retencion, neto: g.neto,
        forma_pago: g.p?.medio_pago_preferido === "echeq" || g.p?.medio_pago_preferido === "cheque" ? "echeq"
          : g.p?.medio_pago_preferido === "transferencia" || g.p?.cbu || g.p?.alias_bancario ? "transferencia"
          : (String(g.p?.forma_pago || "").toLowerCase().includes("cheq") ? "echeq" : "transferencia"),
        cuit: g.p?.cuit || null, razon_social: g.p?.razon_social || null, cbu: g.p?.cbu || null, alias_bancario: g.p?.alias_bancario || null,
        banco: g.p?.banco || null, titular_cuenta: g.p?.titular_cuenta || g.p?.razon_social || null,
      }));
      const { error: e2 } = await db.from("pagos_lote_items").insert(filas);
      if (e2) { await db.from("pagos_lotes").delete().eq("id", lote.id); throw e2; }
      setAviso(`Plan ${lote.numero} guardado: ${filas.length} proveedor(es), ${ars(totalNeto)} a transferir.`);
      await cargarLotes();
      await abrirLote(lote.id);
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el plan");
    } finally {
      setGuardando(false);
    }
  }

  // ── Excel del lote ──
  async function exportarExcel() {
    const XLSX: any = await import("xlsx");
    const lote = lotes.find(l => l.id === loteId);
    const filas = items.filter(i => i.estado !== "omitido").map(i => ({
      Proveedor: i.razon_social || "", CUIT: i.cuit || "", CBU: i.cbu || "", Alias: i.alias_bancario || "", Banco: i.banco || "", Titular: i.titular_cuenta || "",
      "Forma de pago": i.forma_pago, Facturas: i.facturas.map(f => f.numero).join(" / "),
      "Bruto": i.monto_bruto + i.nc_aplicado, "NC aplicadas": i.nc_aplicado, "Ret. Ganancias": i.retencion_monto, "Neto a transferir": i.neto,
      Referencia: lote?.numero || "", Estado: i.estado === "pagado" ? "Pagado" : "Pendiente",
    }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws["!cols"] = [{ wch: 34 }, { wch: 14 }, { wch: 24 }, { wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagos");
    XLSX.writeFile(wb, `${lote?.numero || "plan-de-pagos"}.xlsx`);
  }

  // ── Registrar un pago (misma función segura que la OP) ──
  async function registrarPago(it: ItemLote, datos: { fecha: string; referencia: string; file?: File | null }) {
    setRegistrando(it.id); setError("");
    try {
      if (datos.fecha > todayAR()) throw new Error("La fecha de pago no puede ser futura.");
      if (mesDe(datos.fecha) !== mesDe(lotes.find(l => l.id === it.lote_id)?.fecha || datos.fecha) && it.retencion_monto > 0) {
        if (!window.confirm("El pago es de otro mes que el plan: la retención se calculó para el mes del plan. ¿Registrar igual?")) return;
      }
      const facturasPayload = it.facturas.map(f => ({
        id: f.id,
        monto: r2(f.monto - it.notas_credito.filter(a => a.factura_compra_id === f.id).reduce((s, a) => s + a.monto, 0)),
      })).filter(f => f.monto > 0.004);
      const conNC = it.notas_credito.length > 0;
      const medio = {
        tipo: it.forma_pago === "echeq" ? "cheque_propio" : "transferencia",
        tipo_cheque: it.forma_pago === "echeq" ? "echeq" : "fisico",
        monto: r2(it.neto), fecha: datos.fecha, fecha_emision: null, fecha_cobro: datos.fecha,
        banco: "", numero_cheque: it.forma_pago === "echeq" ? datos.referencia : "", moneda: "ARS", echeq_id: null,
        referencia: datos.referencia || null, beneficiario_cuit: it.cuit || null, beneficiario_nombre: it.razon_social || null,
      };
      const lote = lotes.find(l => l.id === it.lote_id);
      const { data, error: e } = await db.rpc(conNC ? "registrar_pago_proveedor_con_nc" : "registrar_pago_proveedor_seguro", {
        ...(conNC ? { p_notas_credito: it.notas_credito } : {}),
        p_sociedad_id: sociedadId, p_request_key: it.request_key, p_modo: "op", p_proveedor_id: it.proveedor_id,
        p_fecha: datos.fecha, p_moneda: "ARS", p_facturas: facturasPayload, p_medios: it.neto > 0 ? [medio] : [],
        p_monto_bruto: r2(it.monto_bruto), p_base_retencion: r2(it.base_retencion), p_retencion_pct: it.retencion_pct,
        p_retencion_monto: r2(it.retencion_monto), p_notas: `Plan de pagos ${lote?.numero || ""}${datos.referencia ? ` · ref. ${datos.referencia}` : ""}`, p_sobre_verde: false,
      });
      if (e) throw new Error(e.message);
      const opId = (data?.orden_pago_id as string) || null;
      let url: string | null = null;
      if (datos.file && opId) {
        const ext = datos.file.name.split(".").pop() || "pdf";
        const path = `${sociedadId}/op-${opId}/comprobante-0.${ext}`;
        const { error: upErr } = await supabase.storage.from("comprobantes").upload(path, datos.file, { upsert: true });
        if (!upErr) {
          url = supabase.storage.from("comprobantes").getPublicUrl(path).data.publicUrl;
          await db.from("ordenes_pago").update({ archivos: JSON.stringify([{ url, nombre: datos.file.name }]) }).eq("id", opId).eq("sociedad_id", sociedadId);
        }
      }
      const cambios = { estado: "pagado", orden_pago_id: opId, fecha_pago: datos.fecha, referencia: datos.referencia || null, comprobante_url: url, comprobante_nombre: datos.file?.name || null, error: null };
      await db.from("pagos_lote_items").update(cambios).eq("id", it.id);
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, ...cambios, estado: "pagado" as const } : x));
      onPagosRegistrados?.();
      return true;
    } catch (e: any) {
      const msg = e?.message || "No se pudo registrar el pago";
      await db.from("pagos_lote_items").update({ error: msg }).eq("id", it.id);
      setItems(prev => prev.map(x => x.id === it.id ? { ...x, error: msg } : x));
      setError(`${it.razon_social}: ${msg}`);
      return false;
    } finally {
      setRegistrando("");
    }
  }

  async function marcarManual(it: ItemLote) {
    const ref = window.prompt(`Registrar el pago a ${it.razon_social} por ${ars(it.neto)}.\n\nN° de operación / referencia (opcional):`, "");
    if (ref === null) return;
    const ok = await registrarPago(it, { fecha: todayAR(), referencia: ref.trim() });
    if (ok) setAviso(`Pago a ${it.razon_social} registrado.`);
  }

  async function omitir(it: ItemLote) {
    if (!window.confirm(`¿Sacar a ${it.razon_social} de este plan? Sus facturas vuelven a quedar disponibles.`)) return;
    await db.from("pagos_lote_items").update({ estado: "omitido" }).eq("id", it.id);
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, estado: "omitido" as const } : x));
  }

  // ── Comprobantes en lote: la IA los lee y los empareja por importe y nombre ──
  async function leerComprobantes(files: FileList | null) {
    if (!files?.length) return;
    const pendientes = items.filter(i => i.estado === "pendiente");
    const propuestas: Array<{ file: File; pago: any; itemId: string }> = [];
    const usados = new Set<string>();
    for (const file of Array.from(files)) {
      setLeyendo(file.name);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("contexto", "orden_pago_proveedor");
        const res = await fetch("/api/parse-cobro", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "No se pudo leer");
        const pagos: any[] = (json.data?.pagos || (json.data?.tipo ? [json.data] : [])).filter((p: any) => !String(p.tipo || "").startsWith("retencion_"));
        const pago = pagos[0] || {};
        const monto = Number(pago.monto) || 0;
        const nombre = `${pago.destinatario || ""} ${pago.concepto || ""}`;
        const candidatos = pendientes.filter(i => !usados.has(i.id))
          .map(i => ({ i, dif: Math.abs(i.neto - monto), sim: similitudNombre(nombre, i.razon_social || "") }))
          .sort((a, b) => (a.dif < 1 ? 0 : 1) - (b.dif < 1 ? 0 : 1) || b.sim - a.sim || a.dif - b.dif);
        const mejor = candidatos.find(c => c.dif < 1 && (c.sim > 0 || candidatos.filter(x => x.dif < 1).length === 1)) || null;
        if (mejor) usados.add(mejor.i.id);
        propuestas.push({ file, pago, itemId: mejor?.i.id || "" });
      } catch (e: any) {
        propuestas.push({ file, pago: { error: e?.message }, itemId: "" });
      }
    }
    setLeyendo("");
    setAsignacion(propuestas);
  }

  async function registrarAsignados() {
    let ok = 0;
    for (const a of asignacion) {
      const it = items.find(i => i.id === a.itemId && i.estado === "pendiente");
      if (!it) continue;
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(a.pago.fecha_cobro || a.pago.fecha || "")) ? String(a.pago.fecha_cobro || a.pago.fecha) : todayAR();
      if (await registrarPago(it, { fecha: fecha > todayAR() ? todayAR() : fecha, referencia: String(a.pago.referencia || ""), file: a.file })) ok++;
    }
    setAsignacion([]);
    setAviso(`${ok} pago(s) registrados con su comprobante.`);
  }

  // ── Render ──
  const lote = lotes.find(l => l.id === loteId);
  const pendientesLote = items.filter(i => i.estado === "pendiente");
  const totalLote = r2(items.filter(i => i.estado !== "omitido").reduce((s, i) => s + i.neto, 0));

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[95vh] w-full max-w-7xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <div className="flex items-center gap-4">
            <h2 className="flex items-center gap-2 text-lg font-bold dark:text-white"><Landmark className="h-5 w-5 text-orange-500" /> Plan de pagos</h2>
            <div className="flex gap-1 text-xs">
              <button onClick={() => setVista("armar")} className={`rounded-lg px-3 py-1.5 font-medium ${vista === "armar" ? "bg-orange-500 text-white" : "border border-zinc-200 dark:border-zinc-700 dark:text-zinc-200"}`}>Armar plan</button>
              <select value={vista === "lote" ? loteId : ""} onChange={e => e.target.value && abrirLote(e.target.value)} className={`${inp} py-1.5`}>
                <option value="">Planes guardados…</option>
                {lotes.map(l => <option key={l.id} value={l.id}>{l.numero} · {formatDate(l.fecha)}</option>)}
              </select>
            </div>
          </div>
          <button onClick={onClose}><X className="h-5 w-5 text-zinc-400" /></button>
        </div>

        {(error || aviso) && <div className="px-5 pt-2">
          {error && <p className="flex items-center gap-1 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>}
          {aviso && <p className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> {aviso}</p>}
        </div>}

        {vista === "armar" ? (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-zinc-200 px-5 py-3 text-xs dark:border-zinc-700">
              <div><label className="block text-[10px] text-zinc-500">Fecha de pago</label><input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} className={inp} /></div>
              <div><label className="block text-[10px] text-zinc-500">Vencen hasta</label><input type="date" value={venceHasta} onChange={e => setVenceHasta(e.target.value)} className={inp} /></div>
              <button onClick={seleccionarVencidas} className="rounded border border-orange-400 px-2 py-1 font-medium text-orange-700 dark:text-orange-300">Tildar las que vencen{venceHasta ? " hasta esa fecha" : " hasta hoy"}</button>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar proveedor o CUIT…" className={`${inp} w-56`} />
              <span className="ml-auto text-zinc-500">Retención: mínimo no imponible {ars(config.minimo_ganancias)} · mínimo a retener {ars(config.minimo_retencion_ganancias)}</span>
            </div>
            {usdPendientes > 0 && <p className="px-5 pt-2 text-[11px] text-zinc-500">Hay {usdPendientes} factura(s) en dólares: esas se pagan desde la Orden de pago (liquidación con tipo de cambio).</p>}

            <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
              {cargando ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div> : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <tr><th className="w-8 px-2 py-2"></th><th className="px-2">Proveedor</th><th className="px-2">Datos bancarios</th><th className="px-2 text-right">Facturas</th><th className="px-2 text-right">NC</th><th className="px-2 text-right">Ret. Ganancias</th><th className="px-2 text-right">Neto a transferir</th></tr>
                  </thead>
                  <tbody>
                    {grupos.map(g => {
                      const abierto = abiertos.has(g.provId);
                      const todas = g.lista.filter(f => !f.enPlan).every(f => f.seleccionada);
                      const sinBanco = !g.p?.cbu && !g.p?.alias_bancario;
                      return (
                        <Fragment key={g.provId}>
                          <tr className={`border-t border-zinc-200 dark:border-zinc-700 dark:text-zinc-200 ${g.elegidas.length ? "bg-orange-50/60 dark:bg-orange-950/20" : ""}`}>
                            <td className="px-2 py-2"><input type="checkbox" checked={g.lista.some(f => f.seleccionada) && todas} onChange={e => toggleProv(g.provId, e.target.checked)} /></td>
                            <td className="px-2 py-2">
                              <button onClick={() => setAbiertos(prev => { const n = new Set(prev); if (n.has(g.provId)) n.delete(g.provId); else n.add(g.provId); return n; })} className="flex items-center gap-1 text-left font-semibold">
                                {abierto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{g.p?.razon_social || "Proveedor"}
                              </button>
                              <span className="ml-5 text-[10px] text-zinc-500">CUIT {g.p?.cuit || "—"} · {g.lista.length} factura(s){g.vencidas ? ` · ${g.vencidas} vencida(s)` : ""}</span>
                              <span className={`ml-5 block text-[10px] ${g.p?.condicion_pago ? "text-zinc-500" : "text-amber-600"}`}>{textoCondicionPago(g.p) || "Sin indicar cómo se le paga"}</span>
                              {g.cheques.length > 0 && <span className="ml-5 block text-[10px] text-blue-700 dark:text-blue-300" title="Sugerencia según las fechas de cheque del mes (Configuración). Se puede cambiar.">Cheques sugeridos: {g.cheques.map(c => `${formatDate(c.fecha)} ${ars(c.monto)}`).join(" · ")}</span>}
                            </td>
                            <td className="px-2 py-2">
                              {sinBanco ? <span className="font-medium text-red-600">⚠ Sin CBU / alias</span> : <span className="font-mono text-[11px]">{g.p?.cbu || g.p?.alias_bancario}</span>}
                              {g.p?.banco && <span className="block text-[10px] text-zinc-500">{g.p.banco}</span>}
                            </td>
                            <td className="px-2 py-2 text-right">{g.bruto ? ars(g.bruto) : "—"}</td>
                            <td className="px-2 py-2 text-right text-emerald-700">
                              {g.ncDisp.length > 0 && <label className="mr-1 inline-flex items-center gap-1 text-[10px] text-zinc-500"><input type="checkbox" checked={usarNC[g.provId] !== false} onChange={e => setUsarNC(prev => ({ ...prev, [g.provId]: e.target.checked }))} /> usar</label>}
                              {g.ncAplicado ? `− ${ars(g.ncAplicado)}` : g.ncDisp.length ? <span className="text-[10px]">{ars(g.ncDisp.reduce((s, n) => s + n.disponible, 0))} disp.</span> : "—"}
                            </td>
                            <td className="px-2 py-2 text-right text-violet-700 dark:text-violet-300" title={g.ret.motivo}>{g.ret.retencion ? `− ${ars(g.ret.retencion)}` : g.bruto ? <span className="text-[10px] text-zinc-400">{g.ret.aplica ? "bajo mínimo" : "no aplica"}</span> : "—"}</td>
                            <td className="px-2 py-2 text-right font-semibold">{g.bruto ? ars(g.neto) : "—"}{g.otraMoneda && <span className="block text-[10px] text-red-600">pagos en USD este mes</span>}</td>
                          </tr>
                          {abierto && g.lista.map(f => (
                            <tr key={f.id} className="border-t border-zinc-100 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                              <td className="px-2 py-1 pl-6"><input type="checkbox" disabled={!!f.enPlan} checked={f.seleccionada} onChange={e => setFc(f.id, { seleccionada: e.target.checked, monto: String(f.saldo) })} /></td>
                              <td className="px-2 py-1 pl-6">{f.tipo_comprobante} {f.numero} · {formatDate(f.fecha)}{f.enPlan && <span className="ml-2 rounded bg-zinc-200 px-1 text-[10px] dark:bg-zinc-700">en {f.enPlan}</span>}</td>
                              <td className={`px-2 py-1 ${f.vencimiento <= todayAR() ? "font-medium text-red-600" : ""}`}>vence {formatDate(f.vencimiento)}</td>
                              <td className="px-2 py-1 text-right">
                                <span className="text-[10px] text-zinc-400">saldo {ars(f.saldo)} · pagar </span>
                                <input value={f.monto} disabled={!f.seleccionada} onChange={e => setFc(f.id, { monto: e.target.value })} inputMode="decimal" className={`${inp} w-28 text-right`} />
                                <button type="button" title="Completar con el saldo" disabled={!f.seleccionada} onClick={() => setFc(f.id, { monto: String(f.saldo) })} className="ml-1 rounded p-0.5 text-orange-500 hover:bg-orange-50 disabled:opacity-30 dark:hover:bg-orange-950/40"><Sparkles className="inline h-3.5 w-3.5" /></button>
                              </td>
                              <td colSpan={3}></td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                    {!grupos.length && <tr><td colSpan={7} className="py-10 text-center text-zinc-400">No hay facturas pendientes de pago en pesos.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
              <p className="text-xs text-zinc-600 dark:text-zinc-300">{conPago.length} proveedor(es) · retenciones {ars(totalRet)} · <b className="text-base text-zinc-900 dark:text-white">{ars(totalNeto)}</b> a transferir</p>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:text-zinc-200">Cerrar</button>
                <button onClick={guardarPlan} disabled={guardando || !conPago.length} className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Guardar plan y ver resumen
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-3 text-xs dark:border-zinc-700">
              <span className="font-semibold text-zinc-800 dark:text-zinc-100">{lote?.numero} · {lote ? formatDate(lote.fecha) : ""}</span>
              <span className="text-zinc-500">{items.filter(i => i.estado === "pagado").length} pagados · {pendientesLote.length} pendientes · total {ars(totalLote)}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={exportarExcel} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:text-zinc-200"><Download className="h-3.5 w-3.5" /> Excel para el banco</button>
                <button disabled title="Falta el diseño de registro de BBVA Net Cash (pedilo en Net Cash → Transferencias masivas)" className="inline-flex items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-zinc-400 dark:border-zinc-700"><Download className="h-3.5 w-3.5" /> Archivo BBVA</button>
                <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={e => { void leerComprobantes(e.target.files); e.target.value = ""; }} />
                <button onClick={() => fileRef.current?.click()} disabled={!!leyendo || !pendientesLote.length} className="inline-flex items-center gap-1 rounded bg-orange-500 px-3 py-1 font-medium text-white disabled:opacity-50">
                  {leyendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />} {leyendo ? `Leyendo ${leyendo}…` : "Cargar comprobantes (IA)"}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
              {asignacion.length > 0 && (
                <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-xs dark:border-orange-800 dark:bg-orange-950/20">
                  <p className="mb-2 font-semibold text-orange-800 dark:text-orange-300">Comprobantes leídos: revisá a quién corresponde cada uno</p>
                  {asignacion.map((a, i) => (
                    <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="w-48 truncate" title={a.file.name}>{a.file.name}</span>
                      <span className="w-40">{a.pago.error ? <span className="text-red-600">{a.pago.error}</span> : `${ars(Number(a.pago.monto) || 0)} · ${a.pago.destinatario || "—"}`}</span>
                      <select value={a.itemId} onChange={e => setAsignacion(prev => prev.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))} className={`${inp} min-w-[260px]`}>
                        <option value="">— No asignar —</option>
                        {pendientesLote.map(it => <option key={it.id} value={it.id}>{it.razon_social} · {ars(it.neto)}</option>)}
                      </select>
                    </div>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setAsignacion([])} className="rounded border px-3 py-1 dark:border-zinc-700">Descartar</button>
                    <button onClick={registrarAsignados} disabled={!!registrando} className="rounded bg-orange-500 px-3 py-1 font-medium text-white">Registrar {asignacion.filter(a => a.itemId).length} pago(s)</button>
                  </div>
                </div>
              )}

              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <tr><th className="px-2 py-2">Proveedor</th><th className="px-2">CUIT</th><th className="px-2">CBU / alias</th><th className="px-2">Titular · banco</th><th className="px-2">Forma</th><th className="px-2 text-right">Ret.</th><th className="px-2 text-right">Neto a transferir</th><th className="px-2">Estado</th><th className="px-2"></th></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.id} className={`border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200 ${i % 2 ? "bg-zinc-50 dark:bg-zinc-800/40" : ""} ${it.estado === "omitido" ? "opacity-40" : ""}`}>
                      <td className="px-2 py-2 font-medium">{it.razon_social}<span className="block text-[10px] font-normal text-zinc-500">{it.facturas.map(f => f.numero).join(" · ")}</span></td>
                      <td className="px-2 py-2 font-mono">{it.cuit || "—"} {it.cuit && <button title="Copiar" onClick={() => copiar(String(it.cuit))}><Copy className="inline h-3 w-3 text-zinc-400 hover:text-orange-600" /></button>}</td>
                      <td className="px-2 py-2 font-mono">{it.cbu || it.alias_bancario ? <>{it.cbu || it.alias_bancario} <button title="Copiar" onClick={() => copiar(String(it.cbu || it.alias_bancario))}><Copy className="inline h-3 w-3 text-zinc-400 hover:text-orange-600" /></button>{it.cbu && it.alias_bancario && <span className="block text-[10px] text-zinc-500">{it.alias_bancario}</span>}</> : <span className="font-sans font-medium text-red-600">⚠ falta</span>}</td>
                      <td className="px-2 py-2">{it.titular_cuenta || "—"}<span className="block text-[10px] text-zinc-500">{it.banco || ""}</span></td>
                      <td className="px-2 py-2">{it.forma_pago === "echeq" ? "eCheq" : "Transferencia"}</td>
                      <td className="px-2 py-2 text-right text-violet-700 dark:text-violet-300">{it.retencion_monto ? ars(it.retencion_monto) : "—"}</td>
                      <td className="px-2 py-2 text-right font-semibold">{ars(it.neto)} <button title="Copiar importe" onClick={() => copiar(it.neto.toFixed(2).replace(".", ","))}><Copy className="inline h-3 w-3 text-zinc-400 hover:text-orange-600" /></button></td>
                      <td className="px-2 py-2">
                        {it.estado === "pagado" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Pagado {it.fecha_pago ? formatDate(it.fecha_pago) : ""}</span>
                          : it.estado === "omitido" ? <span className="text-[10px]">Fuera del plan</span>
                          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Pendiente</span>}
                        {it.error && it.estado === "pendiente" && <span className="block text-[10px] text-red-600" title={it.error}>Error: {it.error.slice(0, 60)}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {it.estado === "pendiente" && <>
                          <button onClick={() => marcarManual(it)} disabled={!!registrando} className="rounded bg-orange-500 px-2 py-1 text-white disabled:opacity-50">{registrando === it.id ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Marcar pagado"}</button>
                          <button onClick={() => omitir(it)} title="Sacar del plan" className="ml-1 text-zinc-400 hover:text-red-500"><Trash2 className="inline h-3.5 w-3.5" /></button>
                        </>}
                        {it.estado === "pagado" && it.comprobante_url && <a href={it.comprobante_url} target="_blank" rel="noreferrer" className="text-[10px] text-orange-600 underline">comprobante</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-zinc-500">Al registrar cada pago se genera su Orden de pago con la retención (desde Finanzas → Órdenes de pago imprimís el certificado). Si te equivocás, la OP se anula como siempre.</p>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
