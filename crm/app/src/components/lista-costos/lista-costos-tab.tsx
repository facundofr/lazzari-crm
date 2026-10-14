"use client";

/**
 * Proveedores > Lista de costos (etapa 1, solo para ver): buscador sin tildes, filtros, fotos, costo, margen y venta,
 * con el semáforo y las reglas de cada proveedor. Los precios salen de catalogo_costos (catalogo_crm.csv sigue mandando).
 */
import { useEffect, useMemo, useState } from "react";
import { Search, Loader2, Image as ImageIcon, Percent } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useUser } from "@/lib/auth-context";
import { palabrasBusqueda, coincideTodas } from "@/lib/buscar-texto";
import { semaforoVigencia, margenSobreCosto, redondearVenta, EMOJI_SEMAFORO, DIAS_VERDE, DIAS_AMARILLO } from "@/lib/lista-costos";
import { traerListaCompleta, type FilaLista } from "@/components/presupuestos/catalogo-picker";
import { useReglasCostos, urlFoto } from "./reglas-datos";
import { AvisosProveedor, PuntoSemaforo } from "./regla-info";

const POR_PAGINA = 200;
type Col = "codigo" | "descripcion" | "proveedor" | "costo" | "margen" | "venta";

const fmt = (n: number, m: string) =>
  `${m === "ARS" ? "$" : "US$"} ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function leerPref(clave: string, porDefecto: boolean): boolean {
  try { const v = localStorage.getItem(clave); return v === null ? porDefecto : v === "1"; } catch { return porDefecto; }
}

export function ListaCostosTab() {
  const { profile } = useUser();
  const datos = useReglasCostos();
  const [todas, setTodas] = useState<FilaLista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [provSel, setProvSel] = useState<Set<string>>(new Set());
  const [marcaSel, setMarcaSel] = useState<Set<string>>(new Set());
  const [rubroSel, setRubroSel] = useState<Set<string>>(new Set());
  const [verFiltros, setVerFiltros] = useState<"" | "prov" | "marca" | "rubro">("");
  const [orden, setOrden] = useState<{ col: Col; dir: 1 | -1 } | null>(null);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [fotos, setFotos] = useState(true);
  const [fotoGrande, setFotoGrande] = useState<FilaLista | null>(null);
  const [verMargenes, setVerMargenes] = useState(false);

  // Botón Fotos sí/no: queda recordado por usuario en esta compu.
  const clavePref = `lista-costos-fotos:${profile?.id || "anon"}`;
  useEffect(() => { setFotos(leerPref(clavePref, true)); }, [clavePref]);
  function cambiarFotos() {
    setFotos((f) => { try { localStorage.setItem(clavePref, f ? "0" : "1"); } catch { /* sin almacenamiento: queda solo en pantalla */ } return !f; });
  }

  useEffect(() => {
    let vivo = true;
    traerListaCompleta().then((f) => { if (vivo) setTodas(f); }, (e: any) => { if (vivo) setError(e?.message || "No se pudo traer la lista de costos."); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  const { proveedores, marcas, rubros } = useMemo(() => {
    const p = new Set<string>(), m = new Set<string>(), r = new Set<string>();
    for (const f of todas) { p.add(f.proveedor); if (f.marca) m.add(f.marca); if (f.rubro) r.add(f.rubro); }
    const ord = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, "es"));
    return { proveedores: ord(p), marcas: ord(m), rubros: ord(r) };
  }, [todas]);

  const rows = useMemo(() => {
    const palabras = palabrasBusqueda(q);
    return todas.filter((r) =>
      (!provSel.size || provSel.has(r.proveedor))
      && (!marcaSel.size || (!!r.marca && marcaSel.has(r.marca)))
      && (!rubroSel.size || (!!r.rubro && rubroSel.has(r.rubro)))
      && coincideTodas(r._txt, palabras));
  }, [todas, q, provSel, marcaSel, rubroSel]);
  useEffect(() => { setMostrar(POR_PAGINA); }, [q, provSel, marcaSel, rubroSel, orden]);

  // Costo y venta se ordenan dentro de cada moneda (pesos primero, después dólares): no se mezclan sin tipo de cambio.
  const ordenadas = useMemo(() => {
    if (!orden) return rows;
    const val = (r: FilaLista): string | number => {
      if (orden.col === "codigo") return r.codigo_interno || r.codigo;
      if (orden.col === "descripcion") return r.descripcion;
      if (orden.col === "proveedor") return `${r.proveedor} ${r.descripcion}`;
      if (orden.col === "margen") return margenSobreCosto(r.costo, r.precio_venta) ?? -1;
      return orden.col === "costo" ? r.costo : r.precio_venta;
    };
    const monedaOrden = (r: FilaLista) => (r.moneda === "ARS" ? 0 : 1);
    return [...rows].sort((a, b) => {
      if ((orden.col === "costo" || orden.col === "venta") && monedaOrden(a) !== monedaOrden(b)) return monedaOrden(a) - monedaOrden(b);
      const va = val(a), vb = val(b);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es", { numeric: true, sensitivity: "base" });
      return c * orden.dir;
    });
  }, [rows, orden]);

  const conFoto = useMemo(() => rows.reduce((n, r) => n + (r.foto_path ? 1 : 0), 0), [rows]);
  const setsFiltro = { prov: [provSel, setProvSel], marca: [marcaSel, setMarcaSel], rubro: [rubroSel, setRubroSel] } as const;
  const cabecera = (col: Col, label: string, align = "text-left") => (
    <th key={col} className={`px-2 py-2 ${align} cursor-pointer select-none whitespace-nowrap hover:text-orange-600`} title="Ordenar"
      onClick={() => setOrden((o) => !o || o.col !== col ? { col, dir: 1 } : o.dir === 1 ? { col, dir: -1 } : null)}>
      {label} {orden?.col === col ? (orden.dir === 1 ? "▲" : "▼") : <span className="opacity-30">↕</span>}
    </th>
  );

  return (
    <div className="space-y-2">
      {/* Buscador, filtros, fotos y márgenes en una línea */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: «pantalon cargo», «P24», «guante nitrilo»…"
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        {(["prov", "marca", "rubro"] as const).map((k) => {
          const n = setsFiltro[k][0].size;
          const lista = k === "prov" ? proveedores : k === "marca" ? marcas : rubros;
          return (
            <button key={k} onClick={() => setVerFiltros((v) => (v === k ? "" : k))} disabled={!lista.length}
              className={`rounded-lg border px-2.5 py-1.5 text-sm disabled:opacity-40 ${n ? "border-orange-500 text-orange-600" : "border-zinc-300 dark:border-zinc-600"}`}>
              {k === "prov" ? "Proveedores" : k === "marca" ? "Marcas" : "Rubros"}{n ? ` (${n})` : ""} ▾
            </button>
          );
        })}
        <button onClick={cambiarFotos} title="Mostrar u ocultar las fotos (queda recordado)"
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm ${fotos ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/40" : "border-zinc-300 text-zinc-500 dark:border-zinc-600"}`}>
          <ImageIcon className="h-4 w-4" /> Fotos {fotos ? "sí" : "no"}
        </button>
        <button onClick={() => setVerMargenes(true)} className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-600">
          <Percent className="h-4 w-4" /> Márgenes y redondeo
        </button>
      </div>

      {verFiltros && (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          {(verFiltros === "prov" ? proveedores : verFiltros === "marca" ? marcas : rubros).map((x) => {
            const [set, setSet] = setsFiltro[verFiltros];
            const on = set.has(x);
            return (
              <button key={x} onClick={() => setSet((prev) => { const n = new Set(prev); if (n.has(x)) n.delete(x); else n.add(x); return n; })}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-orange-500 bg-orange-500 text-white" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"}`}>
                {verFiltros === "prov" && datos.reglas[x] && <PuntoSemaforo semaforo={semaforoVigencia(datos.reglas[x])} />}{x}
              </button>
            );
          })}
          {setsFiltro[verFiltros][0].size > 0 && (
            <button onClick={() => setsFiltro[verFiltros][1](new Set())} className="ml-1 text-xs text-zinc-500 underline">Quitar filtro</button>
          )}
        </div>
      )}

      {/* Si hay un solo proveedor elegido, sus reglas arriba de la tabla */}
      {provSel.size === 1 && (() => { const p = [...provSel][0]; return datos.reglas[p] ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-1.5 text-xs dark:border-sky-900 dark:bg-sky-950/30">
          <span className="font-semibold">{p}</span><AvisosProveedor proveedor={p} datos={datos} />
          <span className="text-zinc-500">{datos.reglas[p].vigencia_texto}</span>
        </div>
      ) : null; })()}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        {error && <p className="p-4 text-sm text-red-600">{error}</p>}
        {cargando && <p className="flex items-center gap-2 p-4 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Trayendo la lista de costos…</p>}
        {!cargando && !error && !rows.length && <p className="p-8 text-center text-sm text-zinc-500">No se encontró nada con esa búsqueda.</p>}
        {rows.length > 0 && (
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <tr>
                  {fotos && <th className="w-14 px-2 py-2"></th>}
                  {cabecera("codigo", "Código")}
                  {cabecera("descripcion", "Descripción")}
                  {cabecera("proveedor", "Proveedor")}
                  {cabecera("costo", "Costo", "text-right")}
                  {cabecera("margen", "Margen", "text-right")}
                  {cabecera("venta", "Venta", "text-right")}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {ordenadas.slice(0, mostrar).map((r) => {
                  const foto = fotos ? urlFoto(r.foto_path) : null;
                  const margen = margenSobreCosto(r.costo, r.precio_venta);
                  return (
                    <tr key={r.id} className="hover:bg-orange-50/60 dark:hover:bg-orange-950/20">
                      {fotos && (
                        <td className="px-2 py-1">
                          {foto ? (
                            <button onClick={() => setFotoGrande(r)} title="Ver foto grande">
                              <img src={foto} alt="" loading="lazy" className="h-10 w-10 rounded border border-zinc-200 bg-white object-contain dark:border-zinc-700" />
                            </button>
                          ) : <span className="block h-10 w-10 rounded border border-dashed border-zinc-200 dark:border-zinc-700" />}
                        </td>
                      )}
                      <td className="whitespace-nowrap px-2 py-1 font-mono text-xs">{r.codigo_interno || r.codigo}{r.codigo_interno && r.codigo_interno !== r.codigo && <span className="block text-[10px] text-zinc-400">{r.codigo}</span>}</td>
                      <td className="px-2 py-1">{r.descripcion}{(r.marca || r.rubro) && <span className="block text-[11px] text-zinc-500">{[r.marca, r.rubro].filter(Boolean).join(" · ")}</span>}</td>
                      <td className="px-2 py-1 text-xs">
                        <span className="flex items-center gap-1.5 whitespace-nowrap font-medium">{r.proveedor}<AvisosProveedor proveedor={r.proveedor} datos={datos} compacto /></span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right text-zinc-500">{fmt(r.costo, r.moneda)}{r.moneda === "USD divisa" ? " div." : ""}</td>
                      <td className={`whitespace-nowrap px-2 py-1 text-right text-xs ${margen !== null && margen < 15 ? "font-semibold text-red-600" : "text-zinc-500"}`}>{margen === null ? "—" : `${margen.toLocaleString("es-AR")} %`}</td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-semibold">{fmt(r.precio_venta, r.moneda)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="p-2 text-center text-xs text-zinc-500">
              {Math.min(mostrar, rows.length).toLocaleString("es-AR")} de {rows.length.toLocaleString("es-AR")} artículos · {conFoto.toLocaleString("es-AR")} con foto
              {rows.length > mostrar && <> · <button onClick={() => setMostrar((m) => m + POR_PAGINA * 3)} className="text-orange-600 underline">Ver más</button></>}
            </p>
          </div>
        )}
      </div>

      <Modal open={!!fotoGrande} onClose={() => setFotoGrande(null)} title={fotoGrande?.descripcion || ""} description={fotoGrande ? `${fotoGrande.proveedor} · ${fotoGrande.codigo_interno || fotoGrande.codigo}` : ""} size="lg">
        {fotoGrande && (
          <img src={urlFoto(fotoGrande.foto_path) || ""} alt={fotoGrande.descripcion} className="mx-auto max-h-[65vh] w-full max-w-md object-contain" />
        )}
      </Modal>

      <Modal open={verMargenes} onClose={() => setVerMargenes(false)} title="Márgenes y redondeo" description="De la hoja Reglas. Por ahora se cambian en el chat de listas (el CSV sigue mandando)." size="lg">
        <div className="space-y-3 text-sm">
          <table className="w-full">
            <thead className="text-xs text-zinc-500"><tr><th className="py-1 text-left">Rubro</th><th className="py-1 text-right">Margen</th><th className="py-1 pl-3 text-left">Se aplica a</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {datos.margenes.map((m) => (
                <tr key={m.rubro}><td className="py-1 font-medium">{m.rubro}</td><td className="py-1 text-right font-semibold">{Math.round(m.margen * 1000) / 10} %</td><td className="py-1 pl-3 text-xs text-zinc-500">{m.aplica_a}</td></tr>
              ))}
              {!datos.margenes.length && <tr><td colSpan={3} className="py-2 text-xs text-zinc-500">Sin márgenes cargados.</td></tr>}
            </tbody>
          </table>
          <div className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
            <p className="font-medium">Redondeo</p>
            <p className="text-zinc-600 dark:text-zinc-400">{datos.redondeo?.texto || "Sin configurar."}</p>
            {datos.redondeo && <p className="mt-1 text-zinc-500">Ejemplos: $ 12.345 → $ {redondearVenta(12345, "ARS", datos.redondeo).toLocaleString("es-AR")} · $ 987 → $ {redondearVenta(987, "ARS", datos.redondeo).toLocaleString("es-AR")} · US$ 10,001 → US$ {redondearVenta(10.001, "USD", datos.redondeo).toLocaleString("es-AR")}</p>}
          </div>
          <div className="rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800">
            <p className="font-medium">Semáforo de las listas</p>
            <p className="text-zinc-600 dark:text-zinc-400">{EMOJI_SEMAFORO.verde} hasta {DIAS_VERDE} días · {EMOJI_SEMAFORO.amarillo} de {DIAS_VERDE} a {DIAS_AMARILLO} días · {EMOJI_SEMAFORO.rojo} más de {DIAS_AMARILLO} días o sin fecha (pedir actualización). Solo avisa.</p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {Object.keys(datos.reglas).sort((a, b) => a.localeCompare(b, "es")).map((p) => { const s = semaforoVigencia(datos.reglas[p]); return (
                <span key={p} className="whitespace-nowrap">{EMOJI_SEMAFORO[s.color]} {p} <span className="text-zinc-400">({s.texto.toLowerCase()})</span></span>
              ); })}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
