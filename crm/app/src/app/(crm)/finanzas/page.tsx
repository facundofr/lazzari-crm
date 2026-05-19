"use client";

import { Header } from "@/components/layout/header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/utils";
import { mockMovimientos, mockClients, mockProveedores, dashboardKPIs, mockExtractos, mockLineasCredito } from "@/lib/mock-data";
import type { Movimiento, ExtractoMovimiento, LineaCredito } from "@/lib/types";
import { Wallet, ArrowDownLeft, ArrowUpRight, Landmark, CreditCard, Upload, CheckCircle2, AlertTriangle, Link2, Factory } from "lucide-react";
import { useState } from "react";

const tipoConfig: Record<string, { label: string; variant: "success" | "danger" | "warning" | "info" | "outline"; icon: typeof ArrowDownLeft }> = {
  cobro: { label: "Cobro", variant: "success", icon: ArrowDownLeft },
  pago: { label: "Pago", variant: "danger", icon: ArrowUpRight },
  cheque_emitido: { label: "Cheque emitido", variant: "warning", icon: CreditCard },
  cheque_recibido: { label: "Cheque recibido", variant: "info", icon: CreditCard },
  transferencia: { label: "Transferencia", variant: "outline", icon: Landmark },
  efectivo: { label: "Efectivo", variant: "outline", icon: Wallet },
};

type FinanzasTab = "movimientos" | "cc_clientes" | "cc_proveedores" | "cheques" | "extractos" | "lineas_credito";

export default function FinanzasPage() {
  const [tab, setTab] = useState<FinanzasTab>("movimientos");
  const [filterExtracto, setFilterExtracto] = useState<"todos" | "matcheado" | "pendiente">("todos");

  const totalCobros = mockMovimientos.filter((m) => ["cobro", "cheque_recibido", "transferencia"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const totalPagos = mockMovimientos.filter((m) => ["pago", "cheque_emitido"].includes(m.tipo)).reduce((a, m) => a + m.monto, 0);
  const sinConciliar = mockMovimientos.filter((m) => !m.conciliado).length;

  const extracto = mockExtractos[0];
  const movsFiltrados = extracto ? extracto.movimientos.filter((m) => filterExtracto === "todos" || m.estado === filterExtracto) : [];

  const totalDisponibleCredito = mockLineasCredito.reduce((a, lc) => a + lc.montoDisponible, 0);
  const totalUtilizadoCredito = mockLineasCredito.reduce((a, lc) => a + lc.montoUtilizado, 0);
  const totalLineas = mockLineasCredito.reduce((a, lc) => a + lc.montoTotal, 0);

  const tabs: { id: FinanzasTab; label: string }[] = [
    { id: "movimientos", label: "Movimientos" },
    { id: "cc_clientes", label: "CC Clientes" },
    { id: "cc_proveedores", label: "CC Proveedores" },
    { id: "cheques", label: "E-Cheques" },
    { id: "extractos", label: "Extractos" },
    { id: "lineas_credito", label: "Líneas crédito" },
  ];

  return (
    <>
      <Header title="Finanzas" subtitle="Cuentas corrientes, cobros, conciliación y crédito" action={{ label: "Nuevo movimiento", onClick: () => {} }} />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Cobros del mes" value={formatCurrency(totalCobros)} icon={ArrowDownLeft} iconColor="text-emerald-600" />
          <StatCard title="Pagos del mes" value={formatCurrency(totalPagos)} icon={ArrowUpRight} iconColor="text-red-500" />
          <StatCard title="Saldo CC clientes" value={formatCurrency(mockClients.reduce((a, c) => a + c.saldoCuentaCorriente, 0))} icon={Wallet} iconColor="text-blue-600" />
          <StatCard title="Crédito disponible" value={formatCurrency(totalDisponibleCredito)} icon={CreditCard} iconColor="text-emerald-600" />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 w-fit overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.id ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-700"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Movimientos ── */}
        {tab === "movimientos" && (
          <Card className="p-0 overflow-hidden">
            <DataTable<Movimiento>
              columns={[
                { key: "tipo", label: "Tipo", render: (row) => { const cfg = tipoConfig[row.tipo]; const Icon = cfg.icon; return (<div className="flex items-center gap-2"><Icon className="h-4 w-4 text-zinc-400" /><Badge variant={cfg.variant}>{cfg.label}</Badge></div>); }},
                { key: "descripcion", label: "Descripción", render: (row) => <span className="font-medium">{row.descripcion}</span> },
                { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
                { key: "monto", label: "Monto", className: "text-right", render: (row) => {
                  const isIngreso = ["cobro", "cheque_recibido", "transferencia"].includes(row.tipo);
                  return <span className={`font-mono font-semibold block text-right ${isIngreso ? "text-emerald-600" : "text-red-600"}`}>{isIngreso ? "+" : "-"}{formatCurrency(row.monto)}</span>;
                }},
                { key: "conciliado", label: "Conciliado", render: (row) => <Badge variant={row.conciliado ? "success" : "warning"}>{row.conciliado ? "Sí" : "Pendiente"}</Badge> },
              ]}
              data={mockMovimientos}
            />
          </Card>
        )}

        {/* ── CC Clientes ── */}
        {tab === "cc_clientes" && (
          <Card className="p-0 overflow-hidden">
            <DataTable<(typeof mockClients)[0]>
              columns={[
                { key: "razonSocial", label: "Cliente", render: (row) => <span className="font-medium">{row.razonSocial}</span> },
                { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                { key: "diasCuentaCorriente", label: "Días CC", render: (row) => <span>{row.diasCuentaCorriente} días</span> },
                { key: "formaPago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.formaPago}</Badge> },
                { key: "limiteCredito", label: "Límite", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limiteCredito)}</span> },
                { key: "saldoCuentaCorriente", label: "Saldo", className: "text-right", render: (row) => {
                  const pct = (row.saldoCuentaCorriente / row.limiteCredito) * 100;
                  return (<div className="text-right"><span className={`font-mono font-semibold ${pct > 80 ? "text-red-600" : ""}`}>{formatCurrency(row.saldoCuentaCorriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                }},
              ]}
              data={mockClients}
            />
          </Card>
        )}

        {/* ── CC Proveedores ── */}
        {tab === "cc_proveedores" && (
          <Card className="p-0 overflow-hidden">
            <DataTable<(typeof mockProveedores)[0]>
              columns={[
                { key: "razonSocial", label: "Proveedor", render: (row) => <span className="font-medium">{row.razonSocial}</span> },
                { key: "cuit", label: "CUIT", render: (row) => <span className="font-mono text-xs text-zinc-500">{row.cuit}</span> },
                { key: "rubro", label: "Rubro", render: (row) => <Badge variant="info">{row.rubro.split(" ")[0]}</Badge> },
                { key: "diasCuentaCorriente", label: "Días CC", render: (row) => <span>{row.diasCuentaCorriente} días</span> },
                { key: "formaPago", label: "Forma de pago", render: (row) => <Badge variant="outline">{row.formaPago}</Badge> },
                { key: "limiteCredito", label: "Límite", className: "text-right", render: (row) => <span className="font-mono block text-right">{formatCurrency(row.limiteCredito)}</span> },
                { key: "saldoCuentaCorriente", label: "Deuda", className: "text-right", render: (row) => {
                  const pct = (row.saldoCuentaCorriente / row.limiteCredito) * 100;
                  return (<div className="text-right"><span className={`font-mono font-semibold text-red-600`}>{formatCurrency(row.saldoCuentaCorriente)}</span><div className="mt-1 h-1.5 w-20 ml-auto rounded-full bg-zinc-100"><div className={`h-1.5 rounded-full ${pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                }},
              ]}
              data={mockProveedores}
            />
          </Card>
        )}

        {/* ── E-Cheques ── */}
        {tab === "cheques" && (
          <Card>
            <CardHeader><CardTitle>E-Cheques</CardTitle></CardHeader>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-200 p-4">
                <p className="text-xs font-medium text-zinc-500 mb-3">Cheques recibidos</p>
                {mockMovimientos.filter((m) => m.tipo === "cheque_recibido").map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-blue-50 p-3 mb-2"><div><p className="text-sm font-medium">{m.descripcion}</p><p className="text-xs text-zinc-400">{m.fecha}</p></div><span className="font-mono font-semibold text-blue-600">{formatCurrency(m.monto)}</span></div>
                ))}
              </div>
              <div className="rounded-lg border border-zinc-200 p-4">
                <p className="text-xs font-medium text-zinc-500 mb-3">Cheques emitidos</p>
                {mockMovimientos.filter((m) => m.tipo === "cheque_emitido").map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-amber-50 p-3 mb-2"><div><p className="text-sm font-medium">{m.descripcion}</p><p className="text-xs text-zinc-400">{m.fecha}</p></div><span className="font-mono font-semibold text-amber-600">{formatCurrency(m.monto)}</span></div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* ── Extractos bancarios ── */}
        {tab === "extractos" && extracto && (
          <>
            <div className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-6 text-center">
              <Upload className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 font-medium text-zinc-700">Arrastrá un extracto o hacé click para subir</p>
              <p className="text-sm text-zinc-400">Formatos: .xlsx, .xls, .csv, .pdf</p>
              <button className="mt-3 rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600">Seleccionar archivo</button>
            </div>

            <Card>
              <CardHeader>
                <div><CardTitle>{extracto.banco} — {extracto.cuenta}</CardTitle><p className="text-sm text-zinc-500 mt-1">{extracto.periodo} — {extracto.archivo}</p></div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">Matcheados: {extracto.matcheados}</Badge>
                  <Badge variant="warning">Pendientes: {extracto.pendientes}</Badge>
                </div>
              </CardHeader>

              <div className="flex gap-2 mb-4">
                {(["todos", "matcheado", "pendiente"] as const).map((f) => {
                  const count = f === "todos" ? extracto.movimientos.length : extracto.movimientos.filter(m => m.estado === f).length;
                  return (<button key={f} onClick={() => setFilterExtracto(f)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${filterExtracto === f ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}>{f === "todos" ? "Todos" : f === "matcheado" ? "Matcheados" : "Pendientes"} ({count})</button>);
                })}
              </div>

              <DataTable<ExtractoMovimiento>
                columns={[
                  { key: "fecha", label: "Fecha", render: (row) => <span className="text-zinc-500">{row.fecha}</span> },
                  { key: "descripcion", label: "Descripción", render: (row) => <span className="font-medium text-xs">{row.descripcion}</span> },
                  { key: "referencia", label: "Ref.", render: (row) => <span className="font-mono text-xs text-zinc-400">{row.referencia}</span> },
                  { key: "monto", label: "Monto", className: "text-right", render: (row) => (
                    <div className="flex items-center justify-end gap-1.5">
                      {row.tipo === "credito" ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /> : <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />}
                      <span className={`font-mono font-semibold ${row.tipo === "credito" ? "text-emerald-600" : "text-red-600"}`}>{row.tipo === "credito" ? "+" : "-"}{formatCurrency(row.monto)}</span>
                    </div>
                  )},
                  { key: "estado", label: "Match", render: (row) => row.estado === "matcheado"
                    ? <div className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-emerald-500" /><Badge variant="success">Match</Badge></div>
                    : <div className="flex items-center gap-2"><Badge variant="warning">Pendiente</Badge><button className="rounded bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600">Matchear</button></div>
                  },
                ]}
                data={movsFiltrados}
              />
            </Card>
          </>
        )}

        {/* ── Líneas de crédito ── */}
        {tab === "lineas_credito" && (
          <>
            <Card>
              <CardHeader><CardTitle>Uso global de crédito</CardTitle><span className="text-sm text-zinc-500">{Math.round((totalUtilizadoCredito / totalLineas) * 100)}% utilizado</span></CardHeader>
              <div className="h-4 rounded-full bg-zinc-100"><div className="h-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500" style={{ width: `${(totalUtilizadoCredito / totalLineas) * 100}%` }} /></div>
              <div className="mt-2 flex justify-between text-xs text-zinc-400"><span>Utilizado: {formatCurrency(totalUtilizadoCredito)}</span><span>Disponible: {formatCurrency(totalDisponibleCredito)}</span></div>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {mockLineasCredito.map((lc) => {
                const pctUsado = Math.round((lc.montoUtilizado / lc.montoTotal) * 100);
                const isAgotada = lc.montoDisponible === 0;
                return (
                  <Card key={lc.id} className={isAgotada ? "border-red-200" : ""}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2.5 ${lc.tipo === "bancaria" ? "bg-blue-50 text-blue-600" : "bg-violet-50 text-violet-600"}`}>
                          {lc.tipo === "bancaria" ? <Landmark className="h-5 w-5" /> : <Factory className="h-5 w-5" />}
                        </div>
                        <div>
                          <h3 className="font-semibold text-zinc-900">{lc.entidad}</h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={lc.estado === "activa" ? "success" : "danger"}>{lc.estado}</Badge>
                            <Badge variant="outline">{lc.tipo === "bancaria" ? "Bancaria" : "Proveedor"}</Badge>
                            {lc.tasa && <span className="text-xs text-zinc-400">TNA {lc.tasa}%</span>}
                          </div>
                        </div>
                      </div>
                      {isAgotada && <AlertTriangle className="h-5 w-5 text-red-500" />}
                    </div>
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5"><span className="text-zinc-500">{pctUsado}% utilizado</span><span className="font-mono text-zinc-600">{formatCurrency(lc.montoUtilizado)} / {formatCurrency(lc.montoTotal)}</span></div>
                        <div className="h-2.5 rounded-full bg-zinc-100"><div className={`h-2.5 rounded-full ${pctUsado >= 100 ? "bg-red-500" : pctUsado >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pctUsado, 100)}%` }} /></div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                        <div><p className="text-xs text-zinc-400">Disponible</p><p className={`font-mono font-bold text-lg ${isAgotada ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(lc.montoDisponible)}</p></div>
                        <div className="text-right"><p className="text-xs text-zinc-400">Vencimiento</p><p className="text-sm font-medium text-zinc-600">{lc.vencimiento}</p></div>
                      </div>
                      {lc.notas && <p className="text-xs text-zinc-400 pt-2 border-t border-zinc-100">{lc.notas}</p>}
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
