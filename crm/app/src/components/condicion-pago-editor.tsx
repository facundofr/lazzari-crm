"use client";

// "Cómo se le paga" a un proveedor (o lo que pidió en una OC / factura): condición, días, medios + preferido, plazo del cheque
// y % de descuento por pago anticipado. Si falta algo avisa en amarillo; nunca frena (ver lib/condicion-pago.ts).
import { CONDICIONES_PAGO, DIAS_PAGO_OPCIONES, MEDIOS_PAGO, avisosPlanPago, textoCondicionPago, type PlanPago } from "@/lib/condicion-pago";

const CAJA = "mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-white";
const LABEL = "text-xs font-medium text-zinc-500";

function SelectDias({ value, onChange, aria }: { value: number | null | undefined; onChange: (v: number | null) => void; aria: string }) {
  const opciones = value != null && !DIAS_PAGO_OPCIONES.includes(value) ? [...DIAS_PAGO_OPCIONES, value].sort((a, b) => a - b) : DIAS_PAGO_OPCIONES;
  return (
    <select aria-label={aria} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={CAJA}>
      <option value="">—</option>
      {opciones.map((d) => <option key={d} value={d}>{d} días</option>)}
    </select>
  );
}

export function CondicionPagoEditor({
  value,
  onChange,
  compacto = false,
  mostrarAvisos = true,
}: {
  value: PlanPago;
  onChange: (v: PlanPago) => void;
  /** Sin medios aceptados (para OC y factura: alcanza con el preferido). */
  compacto?: boolean;
  mostrarAvisos?: boolean;
}) {
  const set = (p: Partial<PlanPago>) => onChange({ ...value, ...p });
  const medios = value.medios_pago || [];
  const condicion = value.condicion_pago || "";
  const esCheque = value.medio_pago_preferido === "echeq" || value.medio_pago_preferido === "cheque";
  const avisos = mostrarAvisos ? avisosPlanPago(value) : [];

  const cambiarCondicion = (c: string) => {
    if (!c) return set({ condicion_pago: null, dias_pago: null, dias_pago_hasta: null });
    if (c === "anticipado" || c === "contra_entrega") return set({ condicion_pago: c, dias_pago: 0, dias_pago_hasta: null });
    if (c === "cuenta_corriente") return set({ condicion_pago: c, dias_pago: value.dias_pago || 30, dias_pago_hasta: null });
    set({ condicion_pago: c, dias_pago: value.dias_pago || 30, dias_pago_hasta: value.dias_pago_hasta || 60 });
  };
  const toggleMedio = (m: string) => {
    const nuevos = medios.includes(m) ? medios.filter((x) => x !== m) : [...medios, m];
    set({ medios_pago: nuevos, medio_pago_preferido: nuevos.includes(value.medio_pago_preferido || "") ? value.medio_pago_preferido : nuevos[0] || null });
  };
  const elegirPreferido = (m: string) => {
    set({ medio_pago_preferido: m || null, medios_pago: m && !medios.includes(m) ? [...medios, m] : medios });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL}>Condición</label>
          <select aria-label="Condición de pago" value={condicion} onChange={(e) => cambiarCondicion(e.target.value)} className={CAJA}>
            <option value="">Sin indicar</option>
            {CONDICIONES_PAGO.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        {condicion === "cuenta_corriente" && (
          <div>
            <label className={LABEL}>Días desde la factura</label>
            <SelectDias aria="Días de cuenta corriente" value={value.dias_pago} onChange={(v) => set({ dias_pago: v })} />
          </div>
        )}
        {condicion === "escalonado" && (
          <>
            <div>
              <label className={LABEL}>Desde (días)</label>
              <SelectDias aria="Escalonado desde" value={value.dias_pago} onChange={(v) => set({ dias_pago: v })} />
            </div>
            <div>
              <label className={LABEL}>Hasta (días)</label>
              <SelectDias aria="Escalonado hasta" value={value.dias_pago_hasta} onChange={(v) => set({ dias_pago_hasta: v })} />
            </div>
          </>
        )}
      </div>

      {!compacto && (
        <div>
          <label className={LABEL}>Medios que acepta</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {MEDIOS_PAGO.map((m) => {
              const activo = medios.includes(m.value);
              return (
                <button key={m.value} type="button" onClick={() => toggleMedio(m.value)} aria-pressed={activo}
                  className={`rounded-full border px-2.5 py-1 text-xs ${activo ? "border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" : "border-zinc-200 text-zinc-500 dark:border-zinc-700"}`}>
                  {activo ? "✓ " : ""}{m.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL}>Medio preferido</label>
          <select aria-label="Medio de pago preferido" value={value.medio_pago_preferido || ""} onChange={(e) => elegirPreferido(e.target.value)} className={CAJA}>
            <option value="">Sin indicar</option>
            {MEDIOS_PAGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        {esCheque && condicion !== "escalonado" && (
          <div>
            <label className={LABEL}>Plazo del cheque</label>
            <SelectDias aria="Plazo del cheque" value={value.plazo_cheque_dias} onChange={(v) => set({ plazo_cheque_dias: v })} />
          </div>
        )}
        <div>
          <label className={LABEL}>% descuento por pago anticipado</label>
          <input aria-label="Descuento por pago anticipado" type="number" min={0} max={100} step={0.5} value={value.descuento_pronto_pago ?? ""}
            onChange={(e) => set({ descuento_pronto_pago: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Ej. 5" className={CAJA} />
        </div>
      </div>

      {condicion && <p className="text-xs text-zinc-500">Queda así: <b className="text-zinc-700 dark:text-zinc-300">{textoCondicionPago(value)}</b></p>}
      {avisos.length > 0 && <p className="text-xs text-amber-600">⚠️ {avisos.join(" · ")} (podés guardar igual)</p>}
    </div>
  );
}
