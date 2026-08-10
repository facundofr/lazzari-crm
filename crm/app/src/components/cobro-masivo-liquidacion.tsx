"use client";

import { useState, useMemo } from "react";
import { X, Plus, Trash2, AlertCircle, Copy, ArrowDown } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { supabase } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────
export interface LiquidacionFactura {
  id: string;
  numero: string; // formatted "FA 0015-00000123"
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  total_acreditado: number;
  saldo: number;
  moneda: string;
}

interface MedioPago {
  _id: string;
  tipo: string;
  monto: string;
  fecha: string;
  referencia: string;
  observaciones: string;
}

interface RetencionLinea {
  _id: string;
  tipo: string;
  organismo: string;
  certificado: string;
  monto: string;
  observaciones: string;
}

interface Props {
  facturas: LiquidacionFactura[];
  clienteNombre: string;
  sociedadId: string;
  profileId: string | null;
  moneda: "ARS" | "USD";
  onClose: () => void;
  onSuccess: () => void;
}

// ── Helpers ──────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => parseFloat(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

const MEDIO_TIPOS = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "efectivo", label: "Efectivo" },
  { value: "cheque_recibido", label: "Cheque" },
  { value: "deposito", label: "Depósito" },
];

const RETENCION_TIPOS = [
  { value: "retencion_iva", label: "Retención de IVA" },
  { value: "retencion_ganancias", label: "Retención de Ganancias" },
  { value: "retencion_iibb", label: "Retención de IIBB" },
  { value: "retencion_suss", label: "Retención SUSS" },
  { value: "percepcion_iva", label: "Percepción de IVA" },
  { value: "percepcion_iibb", label: "Percepción de IIBB" },
  { value: "ajuste", label: "Otro descuento / ajuste" },
];

function newMedio(): MedioPago {
  return { _id: uid(), tipo: "transferencia", monto: "", fecha: todayStr(), referencia: "", observaciones: "" };
}
function newRetencion(): RetencionLinea {
  return { _id: uid(), tipo: "retencion_iva", organismo: "", certificado: "", monto: "", observaciones: "" };
}

// Map percepciones to "ajuste" for DB (enum may not have them yet)
function mapTipoDB(tipo: string): string {
  if (tipo === "percepcion_iva" || tipo === "percepcion_iibb") return "ajuste";
  return tipo;
}

function buildDesc(prefix: string, ref: string, obs: string, opRef: string): string {
  const parts: string[] = [];
  if (opRef) parts.push(`OP: ${opRef}`);
  if (ref) parts.push(`Ref: ${ref}`);
  if (obs) parts.push(obs);
  return parts.length > 0 ? `${prefix} — ${parts.join(" | ")}` : prefix;
}

// ── Component ────────────────────────────────────────────
export default function CobroMasivoLiquidacion({
  facturas, clienteNombre, sociedadId, profileId, moneda, onClose, onSuccess,
}: Props) {
  const [opReferencia, setOpReferencia] = useState("");
  const [medios, setMedios] = useState<MedioPago[]>([newMedio()]);
  const [retenciones, setRetenciones] = useState<RetencionLinea[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ── Computed totals ──
  const totalNeto = useMemo(() => facturas.reduce((s, f) => s + (f.subtotal || 0), 0), [facturas]);
  const totalIva = useMemo(() => facturas.reduce((s, f) => s + (f.iva || 0), 0), [facturas]);
  const totalGeneral = useMemo(() => facturas.reduce((s, f) => s + f.total, 0), [facturas]);
  const totalSaldo = useMemo(() => facturas.reduce((s, f) => s + f.saldo, 0), [facturas]);
  const totalMedios = useMemo(() => medios.reduce((s, m) => s + num(m.monto), 0), [medios]);
  const totalRetenciones = useMemo(() => retenciones.reduce((s, r) => s + num(r.monto), 0), [retenciones]);
  const totalEsperado = r2(totalSaldo - totalRetenciones);
  const diferencia = r2(totalMedios - totalEsperado);
  const canConfirm = Math.abs(diferencia) < 0.01 && totalMedios > 0 && !saving;

  // ── Medio handlers ──
  const addMedio = () => setMedios(p => [...p, newMedio()]);
  const removeMedio = (id: string) => setMedios(p => p.filter(m => m._id !== id));
  const updateMedio = (id: string, field: string, value: string) =>
    setMedios(p => p.map(m => m._id === id ? { ...m, [field]: value } : m));

  // ── Retencion handlers ──
  const addRetencion = () => setRetenciones(p => [...p, newRetencion()]);
  const removeRetencion = (id: string) => setRetenciones(p => p.filter(r => r._id !== id));
  const updateRetencion = (id: string, field: string, value: string) =>
    setRetenciones(p => p.map(r => r._id === id ? { ...r, [field]: value } : r));

  // ── Confirm & register ──
  async function handleConfirmar() {
    if (!canConfirm) return;
    setSaving(true);
    setError("");

    try {
      // Build all lineas
      const allLineas = [
        ...medios.filter(m => num(m.monto) > 0).map(m => ({
          tipo: m.tipo,
          monto: num(m.monto),
          descripcion: buildDesc(
            `Cobro masivo${clienteNombre ? ` — ${clienteNombre}` : ""}`,
            m.referencia, m.observaciones, opReferencia
          ),
        })),
        ...retenciones.filter(r => num(r.monto) > 0).map(r => {
          const label = RETENCION_TIPOS.find(t => t.value === r.tipo)?.label || r.tipo;
          return {
            tipo: mapTipoDB(r.tipo),
            monto: num(r.monto),
            descripcion: buildDesc(
              label,
              r.certificado ? `Cert: ${r.certificado}` : "",
              [r.organismo, r.observaciones].filter(Boolean).join(" | "),
              opReferencia
            ),
          };
        }),
      ];

      if (allLineas.length === 0) throw new Error("No hay líneas de pago");

      // Distribute across facturas proportionally
      const distributed: number[] = new Array(allLineas.length).fill(0);
      const fechaPago = medios[0]?.fecha || todayStr();

      for (let i = 0; i < facturas.length; i++) {
        const fc = facturas[i];
        const isLast = i === facturas.length - 1;
        const proportion = totalSaldo > 0 ? fc.saldo / totalSaldo : 0;

        const facturaLineas = allLineas.map((l, li) => {
          const amount = isLast
            ? r2(l.monto - distributed[li])
            : r2(l.monto * proportion);
          distributed[li] += amount;
          return { ...l, monto: amount };
        }).filter(l => l.monto > 0.001);

        if (facturaLineas.length > 0) {
          const { error: rpcErr } = await (supabase as any).rpc("registrar_cobro", {
            p_factura_id: fc.id,
            p_lineas: facturaLineas,
            p_fecha: fechaPago,
            p_sociedad_id: sociedadId,
            p_created_by: profileId,
            p_conciliado: true,
          });
          if (rpcErr) throw new Error(`Error en ${fc.numero}: ${rpcErr.message}`);
        }
      }

      alert(`Cobro registrado correctamente (${facturas.length} factura${facturas.length > 1 ? "s" : ""})`);
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Error al registrar el cobro");
    } finally {
      setSaving(false);
    }
  }

  const fc = formatCurrency;
  const m = moneda;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto p-4 pt-8 pb-8">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-5xl rounded-xl shadow-2xl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Liquidación de cobro</h2>
            <p className="text-sm text-zinc-500">{clienteNombre}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* ── 1. Facturas incluidas ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              Facturas incluidas ({facturas.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-500 text-xs uppercase">
                    <th className="px-3 py-2 text-left">Comprobante</th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-right">Neto</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Saldo pend.</th>
                  </tr>
                </thead>
                <tbody>
                  {facturas.map(f => (
                    <tr key={f.id} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-3 py-2 font-medium">{f.numero}</td>
                      <td className="px-3 py-2">{formatDate(f.fecha)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.subtotal, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.iva, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{fc(f.total, m)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-bold">{fc(f.saldo, m)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 dark:bg-zinc-800 font-bold text-sm">
                    <td className="px-3 py-2" colSpan={2}>Totales</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalNeto, m)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalIva, m)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fc(totalGeneral, m)}</td>
                    <td className="px-3 py-2 text-right font-mono text-orange-600">{fc(totalSaldo, m)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── 2. Orden de pago (opcional) ── */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">
              Orden de pago del cliente <span className="text-zinc-400 font-normal">(opcional)</span>
            </h3>
            <input
              type="text"
              placeholder="N° de orden de pago o referencia del cliente"
              value={opReferencia}
              onChange={e => setOpReferencia(e.target.value)}
              className="w-full max-w-md px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm"
            />
          </section>

          {/* ── 3. Medios de pago ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">Medios de pago</h3>
              <button onClick={addMedio} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-semibold">
                <Plus size={14} /> Agregar medio
              </button>
            </div>
            <div className="space-y-2">
              {medios.map(medio => (
                <div key={medio._id} className="flex flex-wrap items-end gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <div className="w-44">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Forma de pago</label>
                    <select value={medio.tipo} onChange={e => updateMedio(medio._id, "tipo", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                      {MEDIO_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="w-36">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Importe</label>
                    <input type="number" step="0.01" min="0" placeholder="0.00"
                      value={medio.monto} onChange={e => updateMedio(medio._id, "monto", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                  </div>
                  <div className="w-32">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Fecha</label>
                    <input type="date" value={medio.fecha} onChange={e => updateMedio(medio._id, "fecha", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  <div className="w-36">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Referencia / N° op.</label>
                    <input type="text" placeholder="N° transf, cheque..."
                      value={medio.referencia} onChange={e => updateMedio(medio._id, "referencia", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-[10px] uppercase text-zinc-400 mb-1">Observaciones</label>
                    <input type="text" placeholder="Opcional"
                      value={medio.observaciones} onChange={e => updateMedio(medio._id, "observaciones", e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                  </div>
                  {medios.length > 1 && (
                    <button onClick={() => removeMedio(medio._id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-sm font-bold">
              Total medios: <span className="font-mono text-orange-600">{fc(totalMedios, m)}</span>
            </div>
          </section>

          {/* ── 4. Retenciones y percepciones ── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Retenciones, percepciones y descuentos
              </h3>
              <button onClick={addRetencion} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-semibold">
                <Plus size={14} /> Agregar
              </button>
            </div>
            {retenciones.length === 0 ? (
              <p className="text-xs text-zinc-400 italic">Sin retenciones ni percepciones. Hacé clic en &quot;Agregar&quot; si corresponde.</p>
            ) : (
              <div className="space-y-2">
                {retenciones.map(ret => (
                  <div key={ret._id} className="flex flex-wrap items-end gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                    <div className="w-48">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Tipo</label>
                      <select value={ret.tipo} onChange={e => updateRetencion(ret._id, "tipo", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm">
                        {RETENCION_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="w-32">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Organismo</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.organismo} onChange={e => updateRetencion(ret._id, "organismo", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <div className="w-36">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">N° certificado</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.certificado} onChange={e => updateRetencion(ret._id, "certificado", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <div className="w-32">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Importe</label>
                      <input type="number" step="0.01" min="0" placeholder="0.00"
                        value={ret.monto} onChange={e => updateRetencion(ret._id, "monto", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm font-mono" />
                    </div>
                    <div className="flex-1 min-w-[100px]">
                      <label className="block text-[10px] uppercase text-zinc-400 mb-1">Observaciones</label>
                      <input type="text" placeholder="Opcional"
                        value={ret.observaciones} onChange={e => updateRetencion(ret._id, "observaciones", e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm" />
                    </div>
                    <button onClick={() => removeRetencion(ret._id)}
                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <div className="mt-2 text-right text-sm font-bold">
                  Total retenciones/percepciones: <span className="font-mono text-orange-600">{fc(totalRetenciones, m)}</span>
                </div>
              </div>
            )}
          </section>

          {/* ── 5. Resumen final ── */}
          <section className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-600 mb-3">Resumen</h3>
            <div className="max-w-sm ml-auto space-y-1 text-sm">
              <div className="flex justify-between"><span>Total facturas (saldo)</span><span className="font-mono">{fc(totalSaldo, m)}</span></div>
              {totalRetenciones > 0 && (
                <div className="flex justify-between text-zinc-500"><span>(-) Retenciones / percepciones</span><span className="font-mono">{fc(totalRetenciones, m)}</span></div>
              )}
              <div className="flex justify-between items-center font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1">
                <span>Total esperado a cobrar</span>
                <span className="flex items-center gap-1.5">
                  <button type="button" title="Copiar monto" onClick={() => { navigator.clipboard.writeText(totalEsperado.toFixed(2)); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"><Copy size={13} /></button>
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", String(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(totalEsperado, m)}</span>
                </span>
              </div>
              <div className="flex justify-between"><span>Total recibido (medios)</span><span className="font-mono">{fc(totalMedios, m)}</span></div>
              <div className={`flex justify-between font-bold text-base pt-1 border-t border-zinc-300 dark:border-zinc-600 ${
                Math.abs(diferencia) < 0.01 ? "text-green-600" : "text-red-600"
              }`}>
                <span>Diferencia</span>
                <span className="flex items-center gap-1.5">
                  <button type="button" title="Copiar pendiente" onClick={() => { navigator.clipboard.writeText(Math.abs(diferencia).toFixed(2)); }}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"><Copy size={13} /></button>
                  <button type="button" title="Completar en medio de pago" onClick={() => { if (medios.length > 0 && diferencia > 0.01) { const remaining = r2(totalEsperado - medios.slice(1).reduce((s, m2) => s + num(m2.monto), 0)); updateMedio(medios[0]._id, "monto", String(Math.max(0, remaining))); } }}
                    className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-400 hover:text-orange-600"><ArrowDown size={13} /></button>
                  <span className="font-mono">{fc(diferencia, m)}</span>
                </span>
              </div>
            </div>
          </section>

          {/* ── Error ── */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              <AlertCircle size={16} /> {error}
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
          <div className="text-xs text-zinc-400">
            {Math.abs(diferencia) < 0.01
              ? "La diferencia es $0 — listo para confirmar"
              : "La diferencia debe ser $0 para confirmar el cobro"}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700">
              Cancelar
            </button>
            <button onClick={handleConfirmar} disabled={!canConfirm}
              className="px-6 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Registrando..." : "Confirmar cobro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
