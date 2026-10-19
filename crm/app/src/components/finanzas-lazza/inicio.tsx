"use client";

// Finanzas Lazza → inicio: las 14 tarjetas (Augusto 18/10: "juntá la A y la B"). Ícono + nombre + qué es + un dato clave.
// Cada dato se calcula aparte (si uno falla, esa tarjeta queda con "—" y el resto anda). Solo lectura.
import { useEffect, useState } from "react";
import {
  BarChart3, Banknote, Building2, CalendarClock, FileSpreadsheet, FileText, Files, List, Percent, Receipt, ReceiptText, ShoppingBag, Target, Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, todayAR } from "@/lib/utils";
import { armarRetenciones, ivaDelMes, reporteBasico, type ReporteBasico } from "@/lib/finanzas-lazza";
import { esCobroDeCliente } from "@/lib/tipos-movimiento";
import { traerComprasDelMes, traerDatosReporte, traerDeudas, traerTcDelDia, traerVentasDelMes, rangoMes } from "./datos";

const db = supabase as any;

export type SeccionFL =
  | "facturar" | "facturas" | "cuentas" | "vencimientos"
  | "ordenes_pago" | "recibos" | "retenciones" | "iva"
  | "bancos" | "cheques" | "gastos" | "movimientos"
  | "objetivos" | "reportes";

type Grupo = "ventas" | "pagos" | "tesoreria" | "informes";
export interface TarjetaDef { id: SeccionFL; nombre: string; que: string; icono: LucideIcon; grupo: Grupo }

export const TARJETAS: TarjetaDef[] = [
  { id: "facturar", nombre: "Facturar", que: "PR listos para facturar", icono: FileText, grupo: "ventas" },
  { id: "facturas", nombre: "Facturas", que: "Venta y compra", icono: Files, grupo: "ventas" },
  { id: "cuentas", nombre: "Cuentas corrientes", que: "Clientes y proveedores", icono: Users, grupo: "ventas" },
  { id: "vencimientos", nombre: "Vencimientos de deuda", que: "A cobrar y a pagar", icono: CalendarClock, grupo: "ventas" },
  { id: "ordenes_pago", nombre: "Órdenes de pago", que: "Pagos a proveedores", icono: ReceiptText, grupo: "pagos" },
  { id: "recibos", nombre: "Recibos", que: "Cobros de clientes", icono: Receipt, grupo: "pagos" },
  { id: "retenciones", nombre: "Retenciones", que: "Practicadas y sufridas", icono: Percent, grupo: "pagos" },
  { id: "iva", nombre: "IVA", que: "Débito y crédito", icono: FileSpreadsheet, grupo: "pagos" },
  { id: "bancos", nombre: "Bancos", que: "Efectivo, tarjetas, préstamos", icono: Building2, grupo: "tesoreria" },
  { id: "cheques", nombre: "Cheques", que: "Emitidos y en cartera", icono: Banknote, grupo: "tesoreria" },
  { id: "gastos", nombre: "Gastos", que: "Fijos y eventuales", icono: ShoppingBag, grupo: "tesoreria" },
  { id: "movimientos", nombre: "Movimientos", que: "Historial de todo", icono: List, grupo: "tesoreria" },
  { id: "objetivos", nombre: "Objetivos", que: "Mínimo 64 · Bueno 80 · Muy bueno 96M", icono: Target, grupo: "informes" },
  { id: "reportes", nombre: "Reportes", que: "Venta − costo − gastos", icono: BarChart3, grupo: "informes" },
];

const GRUPOS: { id: Grupo; nombre: string; icono: string; borde: string }[] = [
  { id: "ventas", nombre: "Ventas", icono: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", borde: "hover:border-emerald-300" },
  { id: "pagos", nombre: "Pagos, cobros e impuestos", icono: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300", borde: "hover:border-blue-300" },
  { id: "tesoreria", nombre: "Tesorería", icono: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300", borde: "hover:border-violet-300" },
  { id: "informes", nombre: "Informes", icono: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", borde: "hover:border-amber-300" },
];

/** Dato clave de una tarjeta. `tono`: rojo = atención, naranja = esta semana. */
interface Dato { valor: string; sub: string; tono?: "rojo" | "naranja" | "verde" }

const millones = (n: number) => `$ ${(n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}M`;
const mas = (ars: number, usd: number) => `${millones(ars)}${Math.abs(usd) >= 1 ? ` + US$ ${Math.round(usd).toLocaleString("es-AR")}` : ""}`;

/** Tarjetas que llena cada loader (mismo orden que `loaders`): si uno falla, esas quedan con "—". */
const TARJETAS_DE_LOADER: SeccionFL[][] = [
  ["reportes", "gastos", "objetivos"], ["vencimientos", "cuentas"], ["iva", "facturas"], ["facturar"],
  ["ordenes_pago", "retenciones"], ["recibos", "movimientos"], ["bancos"], ["cheques"],
];

/** Cada loader devuelve los datos de una o más tarjetas. */
function loaders(sociedadId: string, periodo: string, hoy: string): (() => Promise<Partial<Record<SeccionFL, Dato | { objetivo: ReporteBasico["objetivo"] }>>>)[] {
  const { desde, hasta } = rangoMes(periodo);
  return [
    // Reportes, gastos y objetivos (misma cuenta que Reportes).
    async () => {
      const r = reporteBasico({ periodo, ...(await traerDatosReporte(sociedadId, periodo)) });
      return {
        reportes: { valor: formatCurrency(Math.round(r.resultado)).replace(/,00$/, ""), sub: "resultado del mes (neto)", tono: r.resultado >= 0 ? "verde" : "rojo" },
        gastos: { valor: millones(r.gastos.total), sub: "del mes" },
        objetivos: { objetivo: r.objetivo },
      };
    },
    // Vencimientos y cuentas corrientes.
    async () => {
      const d = await traerDeudas(sociedadId, hoy);
      const vencidas = d.vencimientos.filter((v) => v.dias < 0);
      let ars = 0, usd = 0;
      for (const s of Object.values(d.saldosClientes)) { if (s.ARS.saldo > 0) ars += s.ARS.saldo; if (s.USD.saldo > 0) usd += s.USD.saldo; }
      return {
        vencimientos: { valor: `${vencidas.length} vencidas`, sub: `${d.vencimientos.length} con saldo`, tono: vencidas.length ? "rojo" : undefined },
        cuentas: { valor: mas(ars, usd), sub: "nos deben" },
      };
    },
    // IVA del mes.
    async () => {
      const [ventas, compras, tcDia] = await Promise.all([traerVentasDelMes(sociedadId, periodo), traerComprasDelMes(sociedadId, periodo), traerTcDelDia(periodo)]);
      const iva = ivaDelMes({ periodo, ventas, compras, tcDia });
      return {
        iva: { valor: millones(iva.diferencia), sub: "débito − crédito" },
        facturas: { valor: `${ventas.filter((f) => f.estado !== "anulada").length} · ${compras.filter((f) => f.estado !== "anulada").length}`, sub: "venta · compra del mes" },
      };
    },
    // Facturar: PR aprobados / para facturar sin factura vigente (misma regla que el Resumen de Finanzas).
    async () => {
      const prs = await traerTodo<{ id: string; total: number | null; moneda: string | null }>(() => db.from("presupuestos").select("id, total, moneda")
        .eq("sociedad_id", sociedadId).in("estado", ["facturar", "aprobado"]).order("id"));
      const facturados = new Set<string>();
      const ids = prs.map((p) => p.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("facturas").select("presupuesto_id").eq("sociedad_id", sociedadId).in("presupuesto_id", ids.slice(i, i + 200)).neq("estado", "anulada");
        for (const f of data || []) if (f.presupuesto_id) facturados.add(f.presupuesto_id);
      }
      const pend = prs.filter((p) => !facturados.has(p.id));
      const ars = pend.filter((p) => p.moneda !== "USD").reduce((s, p) => s + Number(p.total || 0), 0);
      const usd = pend.filter((p) => p.moneda === "USD").reduce((s, p) => s + Number(p.total || 0), 0);
      return { facturar: { valor: `${pend.length} PR`, sub: `${mas(ars, usd)} sin facturar` } };
    },
    // Órdenes de pago y retenciones del mes.
    async () => {
      const [ops, movs] = await Promise.all([
        traerTodo<any>(() => db.from("ordenes_pago").select("id, numero, fecha, estado, moneda, email_enviado_at, retencion_ganancias_monto").eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).order("id")),
        traerTodo<any>(() => db.from("movimientos").select("id, tipo, fecha, monto, moneda, anulado, cliente_id, proveedor_id, retencion_ganancias_monto")
          .eq("sociedad_id", sociedadId).gte("fecha", desde).lt("fecha", hasta).or("tipo.in.(retencion_iva,retencion_ganancias,retencion_iibb,retencion_suss),retencion_ganancias_monto.gt.0").order("id")),
      ]);
      const vigentes = ops.filter((o) => o.estado !== "anulada");
      const ret = armarRetenciones({ ops, movimientos: movs }).filter((r) => r.moneda === "ARS");
      const pract = ret.filter((r) => r.lado === "practicada").reduce((s, r) => s + r.monto, 0);
      const suf = ret.filter((r) => r.lado === "sufrida").reduce((s, r) => s + r.monto, 0);
      return {
        ordenes_pago: { valor: `${vigentes.filter((o) => !o.email_enviado_at).length} sin enviar`, sub: `${vigentes.length} este mes` },
        retenciones: { valor: millones(pract + suf), sub: `del mes · practicadas ${millones(pract)}` },
      };
    },
    // Recibos del mes y movimientos de hoy.
    async () => {
      const [cobros, hoyCount] = await Promise.all([
        traerTodo<any>(() => db.from("movimientos").select("id, tipo, anulado, cliente_id, proveedor_id, descripcion, nota_credito_compra_id, ajuste_sentido")
          .eq("sociedad_id", sociedadId).not("cliente_id", "is", null).gte("fecha", desde).lt("fecha", hasta).order("id")),
        db.from("movimientos").select("id", { count: "exact", head: true }).eq("sociedad_id", sociedadId).eq("fecha", hoy),
      ]);
      return {
        recibos: { valor: String(cobros.filter((m) => !m.anulado && esCobroDeCliente(m)).length), sub: "cobros este mes" },
        movimientos: { valor: `${hoyCount.count ?? 0} hoy`, sub: "ver historial" },
      };
    },
    // Bancos: saldo según banco de las cuentas activas en pesos.
    async () => {
      const { data, error } = await db.from("cuentas_financieras").select("tipo, moneda, activa, saldo_banco").eq("sociedad_id", sociedadId);
      if (error) throw error;
      const ars = (data || []).filter((c: any) => c.activa !== false && c.moneda !== "USD" && ["cuenta_corriente", "caja_ahorro", "efectivo"].includes(c.tipo))
        .reduce((s: number, c: any) => s + Number(c.saldo_banco || 0), 0);
      return { bancos: { valor: millones(ars), sub: "según banco" } };
    },
    // Cheques propios a debitar en los próximos 7 días.
    async () => {
      const hasta7 = new Date(Date.parse(`${hoy}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await db.from("echeqs").select("id, monto").eq("sociedad_id", sociedadId).eq("direccion", "emitido")
        .in("estado", ["pendiente", "entregado"]).gte("fecha_pago", hoy).lte("fecha_pago", hasta7);
      if (error) throw error;
      const n = (data || []).length;
      return { cheques: { valor: `${n} esta semana`, sub: n ? `${millones((data || []).reduce((s: number, c: any) => s + Number(c.monto || 0), 0))} a debitar` : "a debitar", tono: n ? "naranja" : undefined } };
    },
  ];
}

export function FinanzasLazzaInicio({ sociedadId, onAbrir }: { sociedadId: string; onAbrir: (s: SeccionFL) => void }) {
  const [datos, setDatos] = useState<Partial<Record<SeccionFL, Dato | { objetivo: ReporteBasico["objetivo"] }>>>({});
  const hoy = todayAR();
  const periodo = hoy.slice(0, 7);

  useEffect(() => {
    let vivo = true;
    setDatos({});
    loaders(sociedadId, periodo, hoy).forEach((cargar, i) => {
      cargar()
        .then((d) => { if (vivo) setDatos((prev) => ({ ...prev, ...d })); })
        .catch((e) => {
          console.error(`Finanzas Lazza · tarjeta ${i}:`, e);
          if (vivo) setDatos((prev) => ({ ...prev, ...Object.fromEntries(TARJETAS_DE_LOADER[i].map((k) => [k, { valor: "—", sub: "no se pudo calcular" }])) }));
        });
    });
    return () => { vivo = false; };
  }, [sociedadId, periodo, hoy]);

  const tarjeta = (t: TarjetaDef, g: (typeof GRUPOS)[number], ancha = false) => {
    const d = datos[t.id];
    const Icono = t.icono;
    const objetivo = d && typeof d === "object" && "objetivo" in d ? d.objetivo : null;
    const dato = d && typeof d === "object" && "valor" in d ? d : null;
    return (
      <button key={t.id} type="button" onClick={() => onAbrir(t.id)}
        className={`flex min-h-[112px] flex-col justify-between rounded-xl border border-zinc-200 bg-white p-3.5 text-left transition-colors dark:border-zinc-800 dark:bg-zinc-900 ${g.borde} ${ancha ? "" : ""}`}>
        <span className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${g.icono}`}><Icono className="h-4 w-4" /></span>
          <span>
            <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t.nombre}</span>
            <span className="block text-[11px] text-zinc-500">{t.que}</span>
          </span>
        </span>
        {objetivo ? (
          <span className="mt-3 block">
            <span className="block text-lg font-semibold text-zinc-900 dark:text-white">
              {{ debajo: "Debajo del mínimo", minimo: "Mínimo", bueno: "Bueno", muy_bueno: "Muy bueno" }[objetivo.nivel]}
              <span className="ml-2 text-xs font-normal text-zinc-500">{objetivo.proximo ? `faltan ${millones(objetivo.proximo.falta)} para ${objetivo.proximo.nombre}` : "¡superado!"}</span>
            </span>
            <span className="mt-2 block h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <span className={`block h-2 rounded-full ${objetivo.nivel === "debajo" ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (objetivo.neto / 96_000_000) * 100)}%` }} />
            </span>
          </span>
        ) : (
          <span className="mt-3 block">
            <span className={`block text-lg font-semibold ${dato?.tono === "rojo" ? "text-red-600" : dato?.tono === "naranja" ? "text-orange-600" : dato?.tono === "verde" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-white"}`}>
              {dato ? dato.valor : <span className="inline-block h-5 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />}
            </span>
            <span className="block text-[11px] text-zinc-400">{dato?.sub ?? " "}</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {GRUPOS.map((g) => {
        const lista = TARJETAS.filter((t) => t.grupo === g.id);
        return (
          <section key={g.id}>
            <p className="mb-1.5 text-xs font-semibold text-zinc-500">{g.nombre}</p>
            <div className={`grid grid-cols-1 gap-2.5 sm:grid-cols-2 ${g.id === "informes" ? "" : "lg:grid-cols-4"}`}>
              {lista.map((t) => tarjeta(t, g, g.id === "informes"))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
