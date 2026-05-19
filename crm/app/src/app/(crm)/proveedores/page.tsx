"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatCurrency } from "@/lib/utils";
import { mockProveedores, mockListasPrecios } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase/client";
import type { Proveedor, ListaPrecios, ListaPreciosItem } from "@/lib/types";
import { Search, Filter, Download, MapPin, Phone, Mail, ListOrdered, Upload, AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

const estadoListaConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  vigente: { label: "Vigente", variant: "success" },
  vencida: { label: "Vencida", variant: "danger" },
  borrador: { label: "Borrador", variant: "warning" },
};

function mapSupabaseProveedor(row: any): Proveedor {
  return {
    id: row.id,
    razonSocial: row.razon_social,
    cuit: row.cuit,
    condicionIva: row.condicion_iva,
    email: row.email,
    telefono: row.telefono,
    direccion: row.direccion,
    localidad: row.localidad,
    provincia: row.provincia,
    contactos: (row.contactos ?? []).map((c: any) => ({
      id: c.id,
      nombre: c.nombre,
      cargo: c.cargo,
      email: c.email,
      telefono: c.telefono,
      principal: c.principal,
    })),
    rubro: row.rubro,
    formaPago: row.forma_pago,
    diasCuentaCorriente: row.dias_cuenta_corriente,
    limiteCredito: row.limite_credito,
    saldoCuentaCorriente: row.saldo_cuenta_corriente,
    listasDePrecios: (row.listas_precios ?? []).map((lp: any) => lp.id),
    notas: row.notas ?? "",
    activo: row.activo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupabaseLista(row: any): ListaPrecios {
  return {
    id: row.id,
    nombre: row.nombre,
    proveedorId: row.proveedor_id,
    proveedorNombre: row.proveedores?.razon_social ?? "",
    moneda: row.moneda,
    vigenciaDesde: row.vigencia_desde,
    vigenciaHasta: row.vigencia_hasta,
    estado: row.estado,
    items: (row.lista_precios_items ?? []).map((item: any) => ({
      id: item.id,
      codigo: item.codigo,
      descripcion: item.descripcion,
      categoria: item.categoria,
      unidad: item.unidad,
      precio: item.precio,
      descuento: item.descuento,
      precioNeto: item.precio_neto,
    })),
    archivoOrigen: row.archivo_origen,
    notas: row.notas ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function ProveedoresPage() {
  const [tab, setTab] = useState<"proveedores" | "listas">("proveedores");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "cards">("table");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterLista, setFilterLista] = useState<string>("todas");

  const [proveedores, setProveedores] = useState<Proveedor[]>(mockProveedores);
  const [listas, setListas] = useState<ListaPrecios[]>(mockListasPrecios);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [provRes, listasRes] = await Promise.all([
          supabase
            .from("proveedores")
            .select(`*, contactos(*), listas_precios(id, nombre, moneda, vigencia_hasta, estado)`)
            .order("razon_social"),
          supabase
            .from("listas_precios")
            .select(`*, proveedores(razon_social), lista_precios_items(*)`)
            .order("created_at", { ascending: false }),
        ]);

        if (provRes.data && provRes.data.length > 0) {
          setProveedores(provRes.data.map(mapSupabaseProveedor));
        }
        if (listasRes.data && listasRes.data.length > 0) {
          setListas(listasRes.data.map(mapSupabaseLista));
        }
      } catch (err) {
        console.error("Error fetching proveedores/listas from Supabase, using mock data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const filteredProveedores = proveedores.filter(
    (p) =>
      p.razonSocial.toLowerCase().includes(search.toLowerCase()) ||
      p.cuit.includes(search) ||
      p.rubro.toLowerCase().includes(search.toLowerCase())
  );

  const filteredListas = listas.filter((lp) => {
    if (filterLista !== "todas" && lp.estado !== filterLista) return false;
    if (search && !lp.nombre.toLowerCase().includes(search.toLowerCase()) && !lp.proveedorNombre.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalDeuda = proveedores.reduce((a, p) => a + p.saldoCuentaCorriente, 0);
  const totalCredito = proveedores.reduce((a, p) => a + p.limiteCredito, 0);
  const listasVigentes = listas.filter((l) => l.estado === "vigente").length;
  const listasVencidas = listas.filter((l) => l.estado === "vencida").length;

  if (loading) {
    return (
      <>
        <Header
          title="Proveedores"
          subtitle="Cargando datos..."
          action={{ label: "Nuevo proveedor", onClick: () => {} }}
        />
        <div className="flex items-center justify-center p-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          <span className="ml-3 text-sm text-zinc-500">Cargando proveedores y listas de precios...</span>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Proveedores"
        subtitle={`${proveedores.length} proveedores — ${listas.length} listas de precios`}
        action={{ label: tab === "proveedores" ? "Nuevo proveedor" : "Cargar lista", onClick: () => {} }}
      />
      <div className="p-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Proveedores</p>
            <p className="mt-1 text-2xl font-bold">{proveedores.length}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Deuda CC</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(totalDeuda)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Crédito total</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(totalCredito)}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vigentes</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{listasVigentes}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs text-zinc-500">Listas vencidas</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{listasVencidas}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit">
          {(["proveedores", "listas"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSearch(""); }}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                tab === t ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t === "proveedores" ? "Proveedores" : "Listas de precios"}
            </button>
          ))}
        </div>

        {/* -- TAB: Proveedores -- */}
        {tab === "proveedores" && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar por razón social, CUIT o rubro..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 dark:border-zinc-700 dark:bg-zinc-900" />
              </div>
              <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"><Filter className="h-4 w-4" /> Filtros</button>
              <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"><Download className="h-4 w-4" /> Exportar</button>
              <div className="flex rounded-lg border border-zinc-200 overflow-hidden">
                <button onClick={() => setView("table")} className={`px-3 py-2 text-xs font-medium ${view === "table" ? "bg-zinc-100 text-zinc-800" : "bg-white text-zinc-400"}`}>Tabla</button>
                <button onClick={() => setView("cards")} className={`px-3 py-2 text-xs font-medium ${view === "cards" ? "bg-zinc-100 text-zinc-800" : "bg-white text-zinc-400"}`}>Tarjetas</button>
              </div>
            </div>

            {view === "table" ? (
              <Card className="p-0 overflow-hidden">
                <DataTable<Proveedor>
                  columns={[
                    { key: "razonSocial", label: "Proveedor", render: (row) => (
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-xs">{row.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                        <div><p className="font-medium text-zinc-900 dark:text-white">{row.razonSocial}</p><p className="text-xs text-zinc-400">{row.cuit}</p></div>
                      </div>
                    )},
                    { key: "rubro", label: "Rubro", render: (row) => <Badge variant="info">{row.rubro}</Badge> },
                    { key: "localidad", label: "Ubicación", render: (row) => <span className="text-zinc-500">{row.localidad}, {row.provincia}</span> },
                    { key: "formaPago", label: "Forma pago", render: (row) => <Badge variant="outline">{row.formaPago}</Badge> },
                    { key: "listasDePrecios", label: "Listas", render: (row) => {
                      const count = listas.filter((l) => l.proveedorId === row.id && l.estado === "vigente").length;
                      return <Badge variant={count > 0 ? "success" : "warning"}>{count} vigente(s)</Badge>;
                    }},
                    { key: "saldoCuentaCorriente", label: "Saldo CC", className: "text-right", render: (row) => <span className="font-mono block text-right text-red-600">{formatCurrency(row.saldoCuentaCorriente)}</span> },
                    { key: "limiteCredito", label: "Límite", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limiteCredito)}</span> },
                  ]}
                  data={filteredProveedores}
                  onRowClick={() => {}}
                />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProveedores.map((prov) => {
                  const provListas = listas.filter((l) => l.proveedorId === prov.id);
                  return (
                    <Card key={prov.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 font-bold text-sm">{prov.razonSocial.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                          <div><p className="font-semibold text-zinc-900 dark:text-white">{prov.razonSocial}</p><p className="text-xs text-zinc-400">{prov.cuit}</p></div>
                        </div>
                        <Badge variant="info">{prov.rubro.split(" ")[0]}</Badge>
                      </div>
                      <div className="mt-4 space-y-2 text-sm text-zinc-500">
                        <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> {prov.localidad}, {prov.provincia}</div>
                        <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {prov.telefono}</div>
                        <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {prov.email}</div>
                        <div className="flex items-center gap-2"><ListOrdered className="h-3.5 w-3.5" /> {provListas.length} lista(s) — {provListas.filter(l => l.estado === "vigente").length} vigente(s)</div>
                      </div>
                      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <div><p className="text-xs text-zinc-400">Saldo CC</p><p className="font-mono font-semibold text-red-600">{formatCurrency(prov.saldoCuentaCorriente)}</p></div>
                        <div className="text-right"><p className="text-xs text-zinc-400">Forma pago</p><Badge variant="outline">{prov.formaPago}</Badge></div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* -- TAB: Listas de precios -- */}
        {tab === "listas" && (
          <>
            {listasVencidas > 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <div><p className="font-medium text-amber-800">{listasVencidas} lista(s) vencida(s)</p><p className="text-sm text-amber-600">Solicitá la actualización a los proveedores correspondientes.</p></div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-2">
                {(["todas", "vigente", "vencida", "borrador"] as const).map((estado) => {
                  const count = estado === "todas" ? listas.length : listas.filter(l => l.estado === estado).length;
                  return (
                    <button key={estado} onClick={() => setFilterLista(estado)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${filterLista === estado ? "bg-orange-500 text-white" : "bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-50"}`}>
                      {estado === "todas" ? "Todas" : estadoListaConfig[estado].label} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input type="text" placeholder="Buscar lista o proveedor..." value={search} onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-4 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100" />
              </div>
              <button className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"><Upload className="h-4 w-4" /> Importar Excel/PDF</button>
            </div>

            <div className="space-y-4">
              {filteredListas.map((lista) => {
                const isExpanded = expandedId === lista.id;
                const cfg = estadoListaConfig[lista.estado];
                return (
                  <Card key={lista.id} className="p-0 overflow-hidden">
                    <button onClick={() => setExpandedId(isExpanded ? null : lista.id)}
                      className="flex w-full items-center justify-between p-5 text-left hover:bg-zinc-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><ListOrdered className="h-5 w-5" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-zinc-900">{lista.nombre}</h3>
                            <Badge variant={cfg.variant}>{cfg.label}</Badge>
                            <Badge variant="outline">{lista.moneda}</Badge>
                          </div>
                          <p className="text-sm text-zinc-500">{lista.proveedorNombre} — {lista.items.length} artículos</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-zinc-400">Vigencia</p>
                          <p className="text-sm text-zinc-600">{lista.vigenciaDesde} — {lista.vigenciaHasta}</p>
                        </div>
                        {isExpanded ? <ChevronDown className="h-5 w-5 text-zinc-400" /> : <ChevronRight className="h-5 w-5 text-zinc-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-zinc-200">
                        {lista.notas && <div className="bg-zinc-50 px-5 py-2.5 text-sm text-zinc-500">{lista.notas}</div>}
                        <DataTable<ListaPreciosItem>
                          columns={[
                            { key: "codigo", label: "Código", render: (row) => <span className="font-mono text-xs font-bold">{row.codigo}</span> },
                            { key: "descripcion", label: "Artículo", render: (row) => <span className="font-medium">{row.descripcion}</span> },
                            { key: "categoria", label: "Categoría", render: (row) => <Badge variant="outline">{row.categoria}</Badge> },
                            { key: "unidad", label: "Un.", render: (row) => <span className="text-zinc-400">{row.unidad}</span> },
                            { key: "precio", label: "P. Lista", className: "text-right", render: (row) => <span className="font-mono block text-right text-zinc-400 line-through">{lista.moneda === "USD" ? `USD ${row.precio.toFixed(2)}` : formatCurrency(row.precio)}</span> },
                            { key: "descuento", label: "Desc.", className: "text-right", render: (row) => row.descuento ? <span className="text-emerald-600 font-medium">{row.descuento}%</span> : <span className="text-zinc-300">—</span> },
                            { key: "precioNeto", label: "P. Neto", className: "text-right", render: (row) => <span className="font-mono font-semibold block text-right">{lista.moneda === "USD" ? `USD ${row.precioNeto.toFixed(2)}` : formatCurrency(row.precioNeto)}</span> },
                          ]}
                          data={lista.items}
                        />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Comparador */}
            <Card>
              <CardHeader><CardTitle>Comparador entre proveedores</CardTitle></CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500">Categoría</th>
                      {listas.filter(l => l.estado === "vigente").map((l) => (
                        <th key={l.id} className="px-4 py-2 text-right text-xs font-semibold text-zinc-500">{l.proveedorNombre.split(" ")[0]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {["Válvulas", "Caños", "Bridas", "Fittings", "Bulonería", "Instrumentación"].map((cat) => {
                      const vigentes = listas.filter(l => l.estado === "vigente");
                      if (!vigentes.some(l => l.items.some(i => i.categoria === cat))) return null;
                      return (
                        <tr key={cat} className="border-b border-zinc-100">
                          <td className="px-4 py-2 font-medium text-zinc-700">{cat}</td>
                          {vigentes.map((l) => {
                            const item = l.items.find(i => i.categoria === cat);
                            return <td key={l.id} className="px-4 py-2 text-right font-mono">{item ? (l.moneda === "USD" ? `USD ${item.precioNeto.toFixed(2)}` : formatCurrency(item.precioNeto)) : <span className="text-zinc-300">—</span>}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
