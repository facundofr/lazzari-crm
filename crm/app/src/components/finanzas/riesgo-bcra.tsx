"use client";

/**
 * Riesgo BCRA (Central de Deudores) de la cartera de clientes, dentro de Finanzas.
 * Antes vivía en Oportunidades. Es solo un aviso: no frena ninguna operación.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import { useUser } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { SEMAFORO_LABEL, cuitLimpio, mesActual, type Semaforo } from "@/lib/bcra";
import { SEMAFORO_CLASES, actualizarBCRA, pesosDesdeMiles } from "@/components/clientes/bcra-card";
import { Loader2, RefreshCw, Search, Square } from "lucide-react";

const db = supabase as any;

interface Cliente { id: string; razon_social: string; cuit: string | null; vendedor_id: string | null }
interface Informe { id?: string; cliente_id: string; mes: string; semaforo: Semaforo; peor_situacion: number | null; deuda_total: number; cheques_sin_pagar: number; error: string | null }

export function RiesgoBcra({ tipo = "cliente" }: { tipo?: "cliente" | "proveedor" }) {
  const esProv = tipo === "proveedor";
  const tabla = esProv ? "proveedor_bcra_informes" : "cliente_bcra_informes";
  const colId = esProv ? "proveedor_id" : "cliente_id";
  const plural = esProv ? "proveedores" : "clientes";
  const { sociedadActiva } = useUser();
  const { toast } = useToast();
  const sociedadId = sociedadActiva?.id;

  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Array<{ id: string; full_name: string }>>([]);
  const [informes, setInformes] = useState<Map<string, Informe>>(new Map());
  const [vendedor, setVendedor] = useState<string>("");
  const [buscar, setBuscar] = useState("");
  const [filtroSem, setFiltroSem] = useState<Semaforo | "todos">("todos");
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; errores: number } | null>(null);
  const cortar = useRef(false);

  const cargarInformes = useCallback(async () => {
    if (!sociedadId) return;
    const desde = mesActual(new Date(Date.now() - 400 * 86400_000));
    const filas = await traerTodo<Informe & { id: string }>(() => db.from(tabla)
      .select(`id, ${colId}, mes, semaforo, peor_situacion, deuda_total, cheques_sin_pagar, error`)
      .eq("sociedad_id", sociedadId).gte("mes", desde).order("mes", { ascending: false }).order("id"));
    const m = new Map<string, Informe>();
    for (const f of filas) {
      const idEnt = (f as any)[colId] as string;
      const prev = m.get(idEnt);
      // El más nuevo que no sea error; si solo hay errores, el más nuevo.
      if (!prev || (prev.semaforo === "gris" && f.semaforo !== "gris" && f.mes >= prev.mes)) m.set(idEnt, { ...f, cliente_id: idEnt });
    }
    setInformes(m);
  }, [sociedadId, tabla, colId]);

  const cargar = useCallback(async () => {
    if (!sociedadId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [cli, vend] = await Promise.all([
        traerTodo<Omit<Cliente, "vendedor_id"> & { assigned_to?: string | null }>(() => db.from(plural).select(esProv ? "id, razon_social, cuit" : "id, razon_social, cuit, assigned_to").eq("sociedad_id", sociedadId).eq("activo", true).order("id"))
          .then(rows => rows.map(({ assigned_to, ...c }) => ({ ...c, vendedor_id: assigned_to ?? null }) as Cliente)),
        db.from("profiles").select("id, full_name").in("role", ["vendedor", "admin", "super_admin"]).order("full_name"),
      ]);
      setClientes(cli);
      setVendedores(vend.data || []);
      await cargarInformes();
    } catch (e: any) {
      toast.error(`No se pudo cargar el riesgo BCRA: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [sociedadId, toast, cargarInformes, plural, esProv]);
  useEffect(() => { void cargar(); }, [cargar]);

  const q = buscar.trim().toLowerCase();
  const mes = mesActual();
  const conCuit = clientes.filter(c => cuitLimpio(c.cuit));
  const pendientesMes = conCuit.filter(c => { const i = informes.get(c.id); return !i || i.mes !== mes || i.semaforo === "gris"; });
  const conteoSem = (s: Semaforo) => conCuit.filter(c => (informes.get(c.id)?.semaforo || "gris") === s).length;

  async function actualizarPendientes() {
    if (!sociedadId || !pendientesMes.length) return;
    cortar.current = false;
    const lista = [...pendientesMes];
    let hechos = 0, errores = 0, empeoraron = 0;
    setProgreso({ hechos, total: lista.length, errores });
    for (const c of lista) {
      if (cortar.current) break;
      const r = await actualizarBCRA(sociedadId, c.id, tipo);
      hechos++;
      if (!r.ok) errores++;
      if (r.empeoro) empeoraron++;
      setProgreso({ hechos, total: lista.length, errores });
      await new Promise(res => setTimeout(res, 300));
    }
    await cargarInformes();
    setProgreso(null);
    toast.success(`BCRA: ${hechos - errores} ${esProv ? "proveedor(es)" : "cliente(s)"} actualizados${errores ? `, ${errores} sin respuesta` : ""}${empeoraron ? `. ${empeoraron} empeoraron (te quedó el aviso en la campanita)` : ""}.`);
  }

  const orden = ["rojo", "amarillo", "gris", "verde"];
  const bcraLista = conCuit
    .map(c => ({ c, i: informes.get(c.id) || null }))
    .filter(({ c, i }) => (filtroSem === "todos" || (i?.semaforo || "gris") === filtroSem) && (!vendedor || c.vendedor_id === vendedor) && (!q || c.razon_social.toLowerCase().includes(q)))
    .sort((a, b) => orden.indexOf(a.i?.semaforo || "gris") - orden.indexOf(b.i?.semaforo || "gris") || a.c.razon_social.localeCompare(b.c.razon_social));

  const inputClass = "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-orange-500" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {(["rojo", "amarillo", "verde", "gris"] as Semaforo[]).map(s => (
          <button key={s} onClick={() => setFiltroSem(filtroSem === s ? "todos" : s)} className={`rounded-xl border p-2.5 text-left ${SEMAFORO_CLASES[s].caja} ${filtroSem === s ? "ring-2 ring-orange-400" : ""}`}>
            <p className={`flex items-center gap-1.5 text-xs font-medium ${SEMAFORO_CLASES[s].texto}`}><span className={`h-2.5 w-2.5 rounded-full ${SEMAFORO_CLASES[s].punto}`} /> {SEMAFORO_LABEL[s]}</p>
            <p className="text-xl font-bold dark:text-white">{conteoSem(s)}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="dark:text-zinc-200">{pendientesMes.length ? <>Faltan actualizar <b>{pendientesMes.length}</b> de {conCuit.length} {plural} este mes.</> : <>Todos los {plural} con CUIT están actualizados este mes.</>}</span>
        <span className="text-xs text-zinc-500">El sistema los actualiza solo todos los meses; este botón es para hacerlo ya.</span>
        {!esProv && (
          <select value={vendedor} onChange={e => setVendedor(e.target.value)} className={`${inputClass} ml-auto`}>
            <option value="">Todos los vendedores</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.full_name}</option>)}
          </select>
        )}
        <div className="relative"><Search className="absolute left-2.5 top-2 h-4 w-4 text-zinc-400" /><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder={esProv ? "Buscar proveedor…" : "Buscar cliente…"} className={`${inputClass} w-48 pl-8`} /></div>
        {progreso ? (
          <span className="inline-flex items-center gap-2 text-xs dark:text-zinc-200">
            <Loader2 className="h-4 w-4 animate-spin text-orange-500" /> {progreso.hechos}/{progreso.total}{progreso.errores ? ` · ${progreso.errores} sin respuesta` : ""}
            <button onClick={() => { cortar.current = true; }} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 dark:border-zinc-700"><Square className="h-3 w-3" /> Frenar</button>
          </span>
        ) : (
          <button onClick={actualizarPendientes} disabled={!pendientesMes.length} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Actualizar pendientes</button>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-800/50"><tr><th className="px-3 py-2">{esProv ? "Proveedor" : "Cliente"}</th><th className="px-3">Semáforo</th><th className="px-3 text-center">Peor situación</th><th className="px-3 text-right">Deuda en bancos</th><th className="px-3 text-center">Cheques sin pagar</th><th className="px-3">Mes</th></tr></thead>
          <tbody>
            {bcraLista.slice(0, 500).map(({ c, i }) => {
              const s: Semaforo = i?.semaforo || "gris";
              return (
                <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800 dark:text-zinc-200">
                  <td className="px-3 py-1.5"><Link href={esProv ? "/proveedores" : `/clientes?id=${c.id}`} className="hover:text-orange-600">{c.razon_social}</Link></td>
                  <td className="px-3"><span className={`inline-flex items-center gap-1 text-xs font-medium ${SEMAFORO_CLASES[s].texto}`}><span className={`h-2 w-2 rounded-full ${SEMAFORO_CLASES[s].punto}`} /> {SEMAFORO_LABEL[s]}</span></td>
                  <td className="px-3 text-center">{i?.peor_situacion ?? (i && !i.error ? "—" : "")}</td>
                  <td className="px-3 text-right">{i && !i.error ? pesosDesdeMiles(i.deuda_total) : ""}</td>
                  <td className="px-3 text-center">{i?.cheques_sin_pagar || ""}</td>
                  <td className="px-3 text-xs text-zinc-500">{i?.mes || "sin consultar"}</td>
                </tr>
              );
            })}
            {!bcraLista.length && <tr><td colSpan={6} className="py-8 text-center text-sm text-zinc-400">Sin {plural} con este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
