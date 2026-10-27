"use client";

// Finanzas Lazza → inicio: las 14 tarjetas (Augusto 18/10: "juntá la A y la B"). Ícono + nombre + qué es + un dato clave.
// Arriba, "Cobrar y pagar" (Augusto 19/10: cobrar y pagar centralizados en un solo lugar; cobrar.tsx y pagar.tsx).
// Cada dato se calcula aparte (si uno falla, esa tarjeta queda con "—" y el resto anda). Solo lectura.
import { useEffect, useState } from "react";
import {
  BarChart3, HandCoins, Wallet, Building2, FileSpreadsheet, Files, List, Percent, Receipt, ReceiptText, ShoppingBag, Target, Users,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatCurrency, todayAR } from "@/lib/utils";
import { armarRetenciones, ivaDelMes, reporteBasico, type ReporteBasico } from "@/lib/finanzas-lazza";
import { esCobroDeCliente } from "@/lib/tipos-movimiento";
import { CargaDiaria } from "./carga-diaria";
import { traerComprasDelMes, traerDatosReporte, traerDeudas, traerIvaACuenta, traerTcDelDia, traerVentasDelMes, rangoMes } from "./datos";

const db = supabase as any;

export type SeccionFL =
  | "cobrar" | "pagar"
  | "facturas" | "cuentas" | "vencimientos"
  | "ordenes_pago" | "recibos" | "retenciones" | "iva"
  | "bancos" | "cheques" | "gastos" | "movimientos"
  | "objetivos" | "reportes";

type Grupo = "acciones" | "ventas" | "pagos" | "tesoreria" | "informes";
export interface TarjetaDef { id: SeccionFL; nombre: string; que: string; icono: LucideIcon; grupo: Grupo }

export const TARJETAS: TarjetaDef[] = [
  { id: "cobrar", nombre: "Cobrar", que: "Facturas de venta a cobrar", icono: HandCoins, grupo: "acciones" },
  { id: "pagar", nombre: "Pagar", que: "Facturas de compra a pagar", icono: Wallet, grupo: "acciones" },
  { id: "facturas", nombre: "Facturas", que: "Venta y compra, una por una", icono: Files, grupo: "ventas" },
  { id: "cuentas", nombre: "Cuentas corrientes", que: "Clientes y proveedores", icono: Users, grupo: "ventas" },
  { id: "ordenes_pago", nombre: "Órdenes de pago", que: "Pagos a proveedores", icono: ReceiptText, grupo: "pagos" },
  { id: "recibos", nombre: "Recibos", que: "Cobros de clientes", icono: Receipt, grupo: "pagos" },
  { id: "retenciones", nombre: "Retenciones", que: "Practicadas y sufridas", icono: Percent, grupo: "pagos" },
  { id: "iva", nombre: "IVA", que: "Débito y crédito", icono: FileSpreadsheet, grupo: "pagos" },
  { id: "bancos", nombre: "Bancos", que: "Efectivo, tarjetas, préstamos", icono: Building2, grupo: "tesoreria" },
  { id: "gastos", nombre: "Gastos", que: "Fijos y eventuales", icono: ShoppingBag, grupo: "tesoreria" },
  { id: "movimientos", nombre: "Movimientos", que: "Historial de todo", icono: List, grupo: "tesoreria" },
  { id: "objetivos", nombre: "Objetivos", que: "Mínimo 64 · Bueno 80 · Muy bueno 96M", icono: Target, grupo: "informes" },
  { id: "reportes", nombre: "Reportes", que: "Venta − costo − gastos", icono: BarChart3, grupo: "informes" },
];

const GRUPOS: { id: Grupo; nombre: string; icono: string; borde: string }[] = [
  { id: "acciones", nombre: "Cobrar y pagar", icono: "bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300", borde: "hover:border-orange-300" },
  { id: "ventas", nombre: "Ventas", icono: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300", borde: "hover:border-emerald-300" },
  { id: "pagos", nombre: "Pagos, cobros e impuestos", icono: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300", borde: "hover:border-blue-300" },
  { id: "tesoreria", nombre: "Tesorería", icono: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300", borde: "hover:border-violet-300" },
  { id: "informes", nombre: "Informes", icono: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300", borde: "hover:border-amber-300" },
];

/** Filas del inicio: Cobrar y pagar + Ventas comparten la primera (4 tarjetas cada fila). */
const FILAS: { nombre: string; grupos: Grupo[] }[] = [
  { nombre: "Cobrar, pagar y ventas", grupos: ["acciones", "ventas"] },
  { nombre: "Pagos, cobros e impuestos", grupos: ["pagos"] },
  { nombre: "Tesorería", grupos: ["tesoreria"] },
  { nombre: "Informes", grupos: ["informes"] },
];

/** Dato clave de una tarjeta. `tono`: rojo = atención, naranja = esta semana. */
interface Dato { valor: string; sub: string; tono?: "rojo" | "naranja" | "verde" }

const millones = (n: number) => `$ ${(n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}M`;
const mas = (ars: number, usd: number) => `${millones(ars)}${Math.abs(usd) >= 1 ? ` + US$ ${Math.round(usd).toLocaleString("es-AR")}` : ""}`;

/** Tarjetas que llena cada loader (mismo orden que `loaders`): si uno falla, esas quedan con "—". */
const TARJETAS_DE_LOADER: SeccionFL[][] = [
  ["reportes", "gastos", "objetivos"], ["vencimientos", "cuentas", "cobrar", "pagar"], ["iva", "facturas"],
  ["ordenes_pago", "retenciones"], ["recibos", "movimientos"], ["bancos"],
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
      const deLado = (lado: "venta" | "compra") => {
        const l = d.vencimientos.filter((v) => v.lado === lado);
        const venc = { ARS: 0, USD: 0 };
        for (const v of l) if (v.dias < 0) venc[v.moneda] += v.saldo;
        return { n: l.length, entidades: new Set(l.map((v) => v.entidadId)).size, venc };
      };
      const cob = deLado("venta"), pag = deLado("compra");
      return {
        cobrar: { valor: `${cob.n} facturas`, sub: `${cob.entidades} clientes · vencido ${mas(cob.venc.ARS, cob.venc.USD)}`, tono: cob.venc.ARS || cob.venc.USD ? "rojo" : undefined },
        pagar: { valor: `${pag.n} facturas`, sub: `${pag.entidades} proveedores · vencido ${mas(pag.venc.ARS, pag.venc.USD)}` },
        vencimientos: { valor: `${vencidas.length} vencidas`, sub: `${d.vencimientos.length} con saldo`, tono: vencidas.length ? "rojo" : undefined },
        cuentas: { valor: mas(ars, usd), sub: "nos deben" },
      };
    },
    // IVA del mes, estimado (arreglo 16): la misma cuenta que la pantalla IVA.
    async () => {
      const [ventas, compras, tcDia, aCuenta] = await Promise.all([traerVentasDelMes(sociedadId, periodo), traerComprasDelMes(sociedadId, periodo), traerTcDelDia(periodo), traerIvaACuenta(sociedadId, periodo)]);
      const iva = ivaDelMes({ periodo, ventas, compras, tcDia, ...aCuenta });
      return {
        iva: { valor: millones(Math.abs(iva.estimado)), sub: iva.estimado >= 0 ? "a pagar, estimado" : "a favor, estimado" },
        facturas: { valor: `${ventas.filter((f) => f.estado !== "anulada").length} · ${compras.filter((f) => f.estado !== "anulada").length}`, sub: "venta · compra del mes" },
      };
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
    // Bancos. 26/10/2026 (Augusto): el saldo del banco no se muestra por ahora; la tarjeta queda con los cheques propios de la semana.
    async () => {
      // Cheques propios a debitar en los próximos 7 días (23/10: la tarjeta Cheques se fue a Bancos y este dato viene con ella).
      const hasta7 = new Date(Date.parse(`${hoy}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
      const ch = await db.from("echeqs").select("id, monto").eq("sociedad_id", sociedadId).eq("direccion", "emitido")
        .in("estado", ["pendiente", "entregado"]).gte("fecha_pago", hoy).lte("fecha_pago", hasta7);
      const filas: any[] = ch.error ? [] : ch.data || [];
      const aDebitar = filas.reduce((s: number, c: any) => s + Number(c.monto || 0), 0);
      return { bancos: { valor: filas.length ? millones(aDebitar) : "—", sub: filas.length ? `${filas.length} cheques propios a debitar en los próximos 7 días` : "sin cheques propios esta semana", tono: filas.length ? "naranja" : undefined } };
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

  const tarjeta = (t: TarjetaDef, g: (typeof GRUPOS)[number]) => {
    const d = datos[t.id];
    const Icono = t.icono;
    const objetivo = d && typeof d === "object" && "objetivo" in d ? d.objetivo : null;
    const dato = d && typeof d === "object" && "valor" in d ? d : null;
    return (
      <button key={t.id} type="button" onClick={() => onAbrir(t.id)}
        className={`flex min-h-[88px] flex-col justify-between rounded-xl border border-zinc-200 bg-white p-3 text-left transition-colors dark:border-zinc-800 dark:bg-zinc-900 ${g.borde}`}>
        <span className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${g.icono}`}><Icono className="h-4 w-4" /></span>
          <span>
            <span className="block text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t.nombre}</span>
            <span className="block text-[11px] text-zinc-500">{t.que}</span>
          </span>
        </span>
        {objetivo ? (
          <span className="mt-2 block">
            <span className="block text-lg font-semibold text-zinc-900 dark:text-white">
              {{ debajo: "Debajo del mínimo", minimo: "Mínimo", bueno: "Bueno", muy_bueno: "Muy bueno" }[objetivo.nivel]}
              <span className="ml-2 text-xs font-normal text-zinc-500">{objetivo.proximo ? `faltan ${millones(objetivo.proximo.falta)} para ${objetivo.proximo.nombre}` : "¡superado!"}</span>
            </span>
            <span className="mt-2 block h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <span className={`block h-2 rounded-full ${objetivo.nivel === "debajo" ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (objetivo.neto / 96_000_000) * 100)}%` }} />
            </span>
          </span>
        ) : (
          <span className="mt-2 block">
            <span className={`block text-lg font-semibold ${dato?.tono === "rojo" ? "text-red-600" : dato?.tono === "naranja" ? "text-orange-600" : dato?.tono === "verde" ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-900 dark:text-white"}`}>
              {dato ? dato.valor : <span className="inline-block h-5 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />}
            </span>
            <span className="block text-[11px] text-zinc-400">{dato?.sub ?? " "}</span>
          </span>
        )}
      </button>
    );
  };

  // 4 filas completas de 4 (Augusto 20/10: "reorganizá eso así queda el espacio optimizado"); cada tarjeta mantiene el color de su grupo.
  return (
    <div className="space-y-3">
      {/* 25/10, Augusto: si falta cargar algún extracto o reporte del banco, avisa apenas se abre Finanzas. */}
      <CargaDiaria sociedadId={sociedadId} hoy={todayAR()} soloSiFalta onIr={() => onAbrir("bancos")} />
      {FILAS.map((fila) => {
        const lista = TARJETAS.filter((t) => fila.grupos.includes(t.grupo));
        return (
          <section key={fila.nombre}>
            <p className="mb-1 text-xs font-semibold text-zinc-500">{fila.nombre}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {lista.map((t) => {
                const g = GRUPOS.find((x) => x.id === t.grupo)!;
                return <div key={t.id} className={`grid ${t.grupo === "informes" ? "lg:col-span-2" : ""}`}>{tarjeta(t, g)}</div>;
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
