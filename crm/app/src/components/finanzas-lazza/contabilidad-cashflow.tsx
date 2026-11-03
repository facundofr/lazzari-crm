"use client";

// Finanzas Lazza → Contabilidad → Cashflow semanal (Nati y Augusto, 29/10/2026). Etapa 1, tanda 2.
// Semanas pasadas: lo real del banco. Desde la de hoy, 12 semanas con "Proy." (foto del inicio del mes) y "Real".
// Lo único que guarda es la foto del proyectado, sola, la primera vez que se abre en el mes (fila cashflow_foto_AAAA-MM de
// `configuracion`); en la compu local no la guarda (la base es la real y se prueba sin guardar). Cuentas en lib/cashflow.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { DIA_IIBB, FILAS_CF, SEMANAS_PROYECTADAS, armarCashflow, flujo, fotoDelMes, iibbNeto, otrasDisponibilidades, planillaCF, proyeccionCF, totalEntra, totalSale, type FilaCF, type ItemCF, type SemanaCF, type ValoresCF } from "@/lib/cashflow";
import { lunesDe, sumarDias } from "@/lib/caja-proyectada";
import { guardarFotoCashflow, traerDatosCashflow } from "./datos";

const pesos = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
const semanaCorta = (desde: string) => `${desde.slice(8, 10)}/${desde.slice(5, 7)}`;
const mesCorto = (p: string) => `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(p.slice(5, 7)) - 1]} ${p.slice(2, 4)}`;
const ORIGEN: Record<ItemCF["origen"], string> = { banco: "Banco", factura_venta: "Factura de venta", factura_compra: "Factura de compra", cheque_recibido: "Cheque en cartera", cheque_emitido: "Cheque propio", gasto_fijo: "Gasto fijo", premio: "Premio (estimado)", iibb: "IIBB y tasas (estimado)" };
const control = "h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
type Col = { s: SemanaCF; cual: "real" | "proy" };
type Abierta = { desde: string; cual: "real" | "proy"; fila: FilaCF | "todo" };

export function ContabilidadCashflow({ sociedadId }: { sociedadId: string }) {
  const { sociedadActiva } = useUser();
  const esLazzari = sociedadActiva?.nombre === "Lazzari";
  const hoy = todayAR();
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof traerDatosCashflow>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasadas, setPasadas] = useState("4");
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const [fotoHoy, setFotoHoy] = useState<"guardada" | "local" | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(null); setAbierta(null);
    traerDatosCashflow(sociedadId, hoy, esLazzari)
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { console.error("Finanzas Lazza · Cashflow:", e); if (vivo) setError("No se pudieron cargar los datos. Recargá la página."); });
    return () => { vivo = false; };
  }, [sociedadId, hoy, esLazzari]);

  const calc = useMemo(() => {
    if (!datos) return null;
    const hasta = sumarDias(lunesDe(hoy), SEMANAS_PROYECTADAS * 7 - 1);
    const p = proyeccionCF({ hoy, hasta, ...datos });
    const cf = armarCashflow({ hoy, lineas: datos.lineas, cuentas: datos.cuentas, proyeccion: p.items, fotos: datos.fotos });
    return { p, cf, otras: otrasDisponibilidades(datos.otras, datos.dolar) };
  }, [datos, hoy]);

  // La foto del mes se guarda sola la primera vez (Augusto 29/10). En la compu local no: se prueba sin guardar.
  useEffect(() => {
    if (!calc || !datos || datos.fotos[hoy.slice(0, 7)]) return;
    const foto = fotoDelMes(calc.cf);
    if (!Object.keys(foto.semanas).length) return;
    if (process.env.NODE_ENV !== "production") { setFotoHoy("local"); return; }
    guardarFotoCashflow(sociedadId, hoy.slice(0, 7), foto).then((ok) => { if (ok) setFotoHoy("guardada"); });
  }, [calc, datos, hoy, sociedadId]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30">{error}</p>;
  if (!calc || !datos) return <p className="flex items-center gap-2 py-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Armando las semanas…</p>;
  const { p, cf, otras } = calc;

  const reales = cf.semanas.filter((s) => s.tipo === "real");
  const visibles = [...(pasadas === "todas" ? reales : reales.slice(-Number(pasadas))), ...cf.semanas.filter((s) => s.tipo === "proyectada")];
  const cols: Col[] = visibles.flatMap((s) => (s.tipo === "real" ? [{ s, cual: "real" as const }] : [{ s, cual: "proy" as const }, { s, cual: "real" as const }]));
  const valores = (c: Col): ValoresCF | null => (c.cual === "real" ? c.s.real : c.s.proy);
  const saldo = (c: Col) => (c.cual === "real" ? c.s.saldoReal : c.s.saldoProy);
  const detalle = (c: Col) => (c.cual === "real" ? c.s.detalleReal : c.s.detalleProy);
  const esHoy = (s: SemanaCF) => s.desde <= hoy && hoy <= s.hasta;
  const borde = (c: Col) => (c.s.tipo === "proyectada" && c.cual === "proy" ? "border-l border-zinc-200 dark:border-zinc-700" : "");
  const fondo = (c: Col) => (esHoy(c.s) ? "bg-orange-50/60 dark:bg-orange-950/20" : c.cual === "proy" ? "bg-zinc-50/70 dark:bg-zinc-800/30" : "");

  const bajarExcel = async () => {
    const XLSX: any = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(planillaCF(cf, semanaCorta));
    ws["!cols"] = [{ wch: 32 }, ...cf.semanas.flatMap((s) => (s.tipo === "real" ? [{ wch: 13 }] : [{ wch: 13 }, { wch: 13 }]))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cashflow semanal");
    XLSX.writeFile(wb, `Cashflow semanal ${sociedadActiva?.nombre || ""} ${hoy}.xlsx`);
  };

  const celda = (c: Col, n: number | null, fila: FilaCF | "todo" | null, fuerte = false) => {
    const tocable = fila && n !== null && n !== 0 && detalle(c).length > 0;
    const activa = abierta && abierta.desde === c.s.desde && abierta.cual === c.cual && abierta.fila === fila;
    const texto = n === null ? "" : n === 0 ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : pesos(n);
    return (
      <td key={`${c.s.desde}-${c.cual}`} className={`whitespace-nowrap py-1 pl-3 text-right font-mono ${fuerte ? "font-semibold" : ""} ${borde(c)} ${fondo(c)} ${activa ? "!bg-orange-100 dark:!bg-orange-900/40" : ""}`}>
        {tocable ? <button type="button" onClick={() => setAbierta(activa ? null : { desde: c.s.desde, cual: c.cual, fila: fila! })} className="hover:text-orange-600 hover:underline">{texto}</button> : texto}
      </td>
    );
  };
  const filaValores = (id: FilaCF) => {
    const f = FILAS_CF.find((x) => x.id === id)!;
    return (
      <tr key={id} className={`border-t border-zinc-100 dark:border-zinc-800 ${f.lado === "aparte" ? "text-zinc-500" : ""}`}>
        <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1 pl-3 pr-3 dark:bg-zinc-900" title={f.que}>{f.nombre}</td>
        {cols.map((c) => celda(c, valores(c)?.[id] ?? null, id))}
      </tr>
    );
  };
  const filaTotal = (nombre: string, fn: (v: ValoresCF) => number) => (
    <tr key={nombre} className="border-t border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/40">
      <td className="sticky left-0 z-10 whitespace-nowrap bg-zinc-50 py-1 pr-3 font-semibold dark:bg-zinc-800">{nombre}</td>
      {cols.map((c) => { const v = valores(c); return celda(c, v ? fn(v) : null, nombre === "Flujo de la semana" ? "todo" : null, true); })}
    </tr>
  );
  const filaSaldo = (nombre: string, cual: "inicial" | "final") => (
    <tr key={nombre} className="border-t border-zinc-200 dark:border-zinc-700">
      <td className="sticky left-0 z-10 whitespace-nowrap bg-white py-1 pr-3 font-semibold dark:bg-zinc-900">{nombre}</td>
      {cols.map((c) => {
        const n = saldo(c)?.[cual] ?? null;
        return <td key={`${c.s.desde}-${c.cual}`} className={`whitespace-nowrap py-1 pl-3 text-right font-mono font-semibold ${borde(c)} ${fondo(c)} ${n !== null && n < 0 ? "text-red-600" : ""}`}>{n === null ? "" : pesos(n)}</td>;
      })}
    </tr>
  );
  const titulo = (t: string) => (
    <tr key={t} className="border-t border-zinc-200 dark:border-zinc-700"><td colSpan={cols.length + 1} className="sticky left-0 bg-white pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-900">{t}</td></tr>
  );

  const colAbierta = abierta ? cols.find((c) => c.s.desde === abierta.desde && c.cual === abierta.cual) ?? null : null;
  const itemsAbiertos = colAbierta ? detalle(colAbierta).filter((i) => abierta!.fila === "todo" || i.fila === abierta!.fila) : [];
  const nombreFila = (id: FilaCF) => FILAS_CF.find((f) => f.id === id)!.nombre;
  const mesFoto = datos.fotos[hoy.slice(0, 7)];

  const avisos: string[] = [...cf.avisos];
  if (!Object.keys(datos.cuentas).length) avisos.push(`${sociedadActiva?.nombre || "Esta sociedad"} no tiene cuentas de banco con extracto: no hay semanas reales ni saldo inicial, solo lo proyectado.`);
  if (p.vencidoSinCobrar.cantidad) avisos.push(`${p.vencidoSinCobrar.cantidad} factura${p.vencidoSinCobrar.cantidad === 1 ? "" : "s"} de venta vencida${p.vencidoSinCobrar.cantidad === 1 ? "" : "s"} sin cobrar por ${formatCurrency(p.vencidoSinCobrar.total)}: no se cuentan (no se sabe cuándo entran). Están en Cobrar.`);
  if (p.sinDolar.length) avisos.push(`Sin dólar del día, no se proyectan: ${p.sinDolar.join(", ")}.`);
  avisos.push(`IIBB y tasas: el ${datos.iibb.pct} % de las ventas de cada mes menos el SIRCREB, las retenciones de IIBB y el saldo a favor (nunca menos de 0), el ${DIA_IIBB} del mes siguiente (sábado o domingo, el lunes). El mes en curso va con lo facturado hasta hoy; el vencido no se cuenta.`);
  const iibbMeses = datos.iibb.pct > 0 ? iibbNeto(datos.iibb) : [];
  const iibbUltimo = iibbMeses.length ? iibbMeses[iibbMeses.length - 1] : null;
  avisos.push("Todavía no se proyectan: IVA, SICORE y anticipos de Ganancias (VEP), la comisión de José y Ganancias (se paga en mayo 2027). En las semanas reales sí están, porque salen del banco.");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Cashflow semanal · {sociedadActiva?.nombre}</p>
          <p className="text-[11px] text-zinc-500">
            Por fecha de cobro y de pago, de lunes a domingo, bancos en $. Las semanas pasadas son lo real del banco; desde esta, 12 semanas con lo proyectado y lo real para comparar.
            {Object.keys(datos.cuentas).length > 0 && <> Saldo inicial del extracto al {formatDate(cf.semanas[0].desde)}: {formatCurrency(cf.saldoInicial)}.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            Semanas pasadas
            <select value={pasadas} onChange={(e) => setPasadas(e.target.value)} className={control}>
              <option value="4">4</option><option value="8">8</option><option value="todas">Todas</option>
            </select>
          </label>
          <button type="button" onClick={bajarExcel} className="flex h-8 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-xs font-medium text-white hover:bg-orange-600">
            <Download className="h-3.5 w-3.5" /> Bajar Excel
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
              <th rowSpan={2} className="sticky left-0 z-10 bg-white pb-1 text-left align-bottom font-semibold dark:bg-zinc-900">Semana del lunes</th>
              {visibles.map((s) => (
                <th key={s.desde} colSpan={s.tipo === "real" ? 1 : 2} className={`pl-3 text-right font-semibold ${s.tipo === "proyectada" ? "border-l border-zinc-200 text-center dark:border-zinc-700" : ""} ${esHoy(s) ? "text-orange-600" : ""}`} title={`${formatDate(s.desde)} al ${formatDate(s.hasta)}`}>
                  {semanaCorta(s.desde)}{esHoy(s) ? " · hoy" : ""}
                </th>
              ))}
            </tr>
            <tr className="text-[10px] text-zinc-400">
              {cols.map((c) => (
                <th key={`${c.s.desde}-${c.cual}`} className={`pb-1 pl-3 text-right font-normal ${borde(c)}`} title={c.cual === "proy" ? (c.s.proyDe === "foto" ? `Foto del ${formatDate(datos.fotos[c.s.desde.slice(0, 7)]?.tomada || "")}` : "Lo que se proyecta hoy (el mes todavía no tiene foto)") : undefined}>
                  {c.s.tipo === "real" ? "Real" : c.cual === "proy" ? (c.s.proyDe === "foto" ? "Proy." : "Proy. hoy") : "Real"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-zinc-900">
            {filaSaldo("Saldo inicial", "inicial")}
            {titulo("Entró")}
            {FILAS_CF.filter((f) => f.lado === "entra").map((f) => filaValores(f.id))}
            {filaTotal("Total entró", totalEntra)}
            {titulo("Salió")}
            {FILAS_CF.filter((f) => f.lado === "sale").map((f) => filaValores(f.id))}
            {filaTotal("Total salió", totalSale)}
            {titulo("Aparte")}
            {FILAS_CF.filter((f) => f.lado === "aparte").map((f) => filaValores(f.id))}
            {filaTotal("Flujo de la semana", flujo)}
            {filaSaldo("Saldo final", "final")}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-zinc-400">
          Tocá un número para ver de dónde sale. «Proy.» es la foto del inicio del mes; si el mes todavía no tiene foto dice «Proy. hoy».
          {mesFoto ? ` La foto de este mes es del ${formatDate(mesFoto.tomada)}.` : fotoHoy === "guardada" ? " La foto de este mes se guardó recién." : fotoHoy === "local" ? " En la compu local la foto del mes no se guarda (se guarda sola en el CRM publicado)." : ""}
          {" "}Saldo de las semanas reales: el del extracto al arrancar, más lo que entró y menos lo que salió según las líneas cargadas en Bancos.
        </p>
        {otras.cuentas.length > 0 && (
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold">Otras disponibilidades</span> <span className="text-zinc-400">(último saldo cargado; no suman al saldo de arriba)</span>:{" "}
            {otras.cuentas.map((c, i) => (
              <span key={c.nombre}>
                {i > 0 && " · "}{c.nombre} {c.moneda === "USD" ? `US$ ${c.saldo.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c.enPesos !== null ? ` (≈ $ ${pesos(c.enPesos)})` : ""}` : `$ ${pesos(c.saldo)}`}
                {c.fecha && <span className="text-zinc-400"> al {formatDate(c.fecha)}</span>}
              </span>
            ))}
            {" · "}<span className="font-semibold">Total ≈ $ {pesos(otras.total)}</span>
          </p>
        )}
        {iibbUltimo && iibbUltimo.saldoAFavor > 0 && (
          <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300"
            title={iibbMeses.map((m) => `${mesCorto(m.mes)}: ${datos.iibb.pct} % $ ${pesos(m.bruto)} − SIRCREB $ ${pesos(m.sircreb)} − retenciones $ ${pesos(m.retenciones)} − saldo anterior $ ${pesos(m.saldoAnterior)}${m.pagado ? " (pagado)" : ""}`).join("\n")}>
            <span className="font-semibold">Saldo a favor de IIBB</span> <span className="text-zinc-400">(estimado; no suma al saldo de arriba)</span>:{" "}
            $ {pesos(iibbUltimo.saldoAFavor)} con lo de {mesCorto(iibbUltimo.mes)} ({datos.iibb.pct} % de las ventas menos SIRCREB y retenciones desde {mesCorto(iibbMeses[0].mes)})
          </p>
        )}
      </div>

      {colAbierta && abierta && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {abierta.fila === "todo" ? "Todo lo de la semana" : nombreFila(abierta.fila)} <span className="text-[11px] font-normal text-zinc-500">· semana del {formatDate(colAbierta.s.desde)} · {abierta.cual === "real" ? "real" : "proyectado"}</span>
            </p>
            <button type="button" onClick={() => setAbierta(null)} className="text-xs text-orange-600 hover:underline">Cerrar</button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-zinc-400"><th className="py-1 pr-2">Fecha</th><th className="py-1 pr-2">Detalle</th><th className="py-1 pr-2">De</th>{abierta.fila === "todo" && <th className="py-1 pr-2">Fila</th>}<th className="py-1 pl-2 text-right">Monto</th></tr></thead>
              <tbody>
                {itemsAbiertos.map((d, i) => (
                  <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="whitespace-nowrap py-1 pr-2">{formatDate(d.fecha)}{d.atrasado && <span className="ml-1 text-[10px] text-amber-600">atrasado</span>}</td>
                    <td className="py-1 pr-2">{d.detalle}</td>
                    <td className={`whitespace-nowrap py-1 pr-2 ${d.origen === "premio" ? "text-amber-600" : "text-zinc-500"}`}>{ORIGEN[d.origen]}</td>
                    {abierta.fila === "todo" && <td className="whitespace-nowrap py-1 pr-2 text-zinc-500">{nombreFila(d.fila)}</td>}
                    <td className={`py-1 pl-2 text-right font-mono ${d.monto < 0 ? "" : "text-emerald-700 dark:text-emerald-400"}`}>{formatCurrency(d.monto)}</td>
                  </tr>
                ))}
                {!itemsAbiertos.length && <tr><td colSpan={5} className="py-2 text-zinc-500">Nada.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> Para revisar (no frena nada)</p>
          <ul className="space-y-0.5 text-amber-900 dark:text-amber-200">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
