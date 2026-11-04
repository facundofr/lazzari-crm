"use client";

// Cuadro "Datos bancarios" de la Orden de pago (03/11/2026, Augusto: "Si cargo algún dato bancario a la hora de hacer alguna OP,
// dejame guardarlo para que ya quede en ese proveedor"). Muestra lo de la ficha con Copiar; Cargar/Editar abre los campos ahí mismo
// y «Guardar en el proveedor» los guarda en su ficha. Si la IA leyó en el comprobante un CBU de destino que no está en la ficha,
// lo ofrece (abre los campos ya completos para revisar). Nada se guarda solo; los avisos (lib/cbu `cambiosBancarios`) nunca frenan:
// solo el de "ya tenía otro CBU" pide confirmar.
import { useState } from "react";
import { Landmark, Loader2, Pencil, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { CopiarBtn } from "@/components/copiar-btn";
import { bancoDelCbu, cambiosBancarios, type DatosBancariosProveedor } from "@/lib/cbu";

export interface ProveedorBancario extends Partial<DatosBancariosProveedor> {
  id: string; razon_social: string; cuit?: string | null; numero_cuenta?: string | null; tipo_cuenta?: string | null;
}
export interface CbuDelComprobante { cbu: string; alias: string | null; titular: string | null; cuitTitular: string | null; banco: string | null }

const CAMPOS: { k: keyof DatosBancariosProveedor; label: string; ph: string; mono?: boolean }[] = [
  { k: "cbu", label: "CBU / CVU", ph: "22 números", mono: true },
  { k: "alias_bancario", label: "Alias", ph: "ej. PROVEEDOR.PAGOS", mono: true },
  { k: "banco", label: "Banco", ph: "ej. Galicia" },
  { k: "titular_cuenta", label: "Titular", ph: "a nombre de quién está la cuenta" },
  { k: "cuit_titular_cuenta", label: "CUIT titular", ph: "11 números", mono: true },
];

export function DatosBancariosProveedor({ proveedor, sociedadId, delComprobante, onGuardado }: {
  proveedor: ProveedorBancario; sociedadId: string;
  delComprobante?: CbuDelComprobante | null;
  onGuardado: (cambios: Partial<DatosBancariosProveedor>) => void;
}) {
  const [form, setForm] = useState<Partial<DatosBancariosProveedor> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const p = proveedor;
  const tieneAlgo = !!(p.cuit || p.cbu || p.alias_bancario || p.banco || p.numero_cuenta || p.titular_cuenta);
  const deFicha = (): Partial<DatosBancariosProveedor> => ({ cbu: p.cbu || "", alias_bancario: p.alias_bancario || "", banco: p.banco || "", titular_cuenta: p.titular_cuenta || "", cuit_titular_cuenta: p.cuit_titular_cuenta || "" });
  const evaluado = form ? cambiosBancarios(p, form) : null;
  const sinCambios = !!evaluado && Object.keys(evaluado.cambios).length === 0;

  function abrir(conComprobante = false) {
    const base = deFicha();
    if (conComprobante && delComprobante) {
      base.cbu = delComprobante.cbu;
      // Del comprobante solo se completa lo que la ficha no tiene (el CBU es lo que se viene a cambiar).
      if (!p.alias_bancario && delComprobante.alias) base.alias_bancario = delComprobante.alias;
      // El banco sale del CBU nuevo (04/11/2026): si se sabe, reemplaza al de la ficha (era de la cuenta vieja).
      const bancoCbu = bancoDelCbu(delComprobante.cbu);
      if (bancoCbu || (!p.banco && delComprobante.banco)) base.banco = bancoCbu || delComprobante.banco || "";
      if (!p.titular_cuenta && delComprobante.titular) base.titular_cuenta = delComprobante.titular;
      if (!p.cuit_titular_cuenta && delComprobante.cuitTitular) base.cuit_titular_cuenta = delComprobante.cuitTitular;
    }
    setForm(base); setError(""); setListo(false);
  }

  async function guardar() {
    if (!evaluado || sinCambios) return;
    if (evaluado.avisos.some((a) => a.startsWith("⚠")) && !confirm(`${evaluado.avisos.join("\n\n")}\n\n¿Guardar igual en ${p.razon_social}?`)) return;
    setGuardando(true); setError("");
    try {
      const { error: e } = await (supabase as any).from("proveedores").update(evaluado.cambios).eq("id", p.id).eq("sociedad_id", sociedadId);
      if (e) throw e;
      onGuardado(evaluado.cambios);
      setForm(null); setListo(true);
    } catch (e: any) {
      setError(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      setGuardando(false);
    }
  }

  const fila = (label: string, valor: string, copiar = false, mono = true) => (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="w-12 shrink-0 text-zinc-500">{label}</span>
      <span className={`truncate font-medium ${mono ? "font-mono" : ""} select-all`}>{valor}</span>
      {copiar && <CopiarBtn texto={valor} title={`Copiar ${label}`} />}
    </div>
  );
  const boton = "inline-flex items-center gap-1 rounded-md border border-blue-200 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40";

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 px-3 py-2 text-xs space-y-0.5">
      <div className="flex items-center gap-2 min-w-0">
        <p className="font-semibold text-blue-700 dark:text-blue-300 flex flex-1 items-center gap-1 min-w-0"><Landmark className="h-3.5 w-3.5 shrink-0" />Datos bancarios
          {(p.banco || p.tipo_cuenta || p.numero_cuenta) && <span className="truncate font-normal text-zinc-600 dark:text-zinc-300">· {[p.banco, p.tipo_cuenta, p.numero_cuenta ? `N° ${p.numero_cuenta}` : ""].filter(Boolean).join(" · ")}</span>}
        </p>
        {!form && <button type="button" onClick={() => abrir()} className={boton}><Pencil className="h-3 w-3" />{p.cbu || p.alias_bancario ? "Editar" : "Cargar"}</button>}
      </div>
      {!form && (
        <>
          {p.titular_cuenta && fila("Titular", p.titular_cuenta, false, false)}
          {p.cbu && fila("CBU", p.cbu, true)}
          {p.alias_bancario && fila("Alias", p.alias_bancario, true)}
          {p.cuit && fila("CUIT", p.cuit, true)}
          {!tieneAlgo && <p className="text-zinc-500">Este proveedor no tiene datos bancarios en su ficha.</p>}
          {listo && <p className="text-emerald-700 dark:text-emerald-400">Guardado en la ficha de {p.razon_social}.</p>}
          {delComprobante && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-sky-100/70 px-2 py-1 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>El comprobante dice CBU <b className="font-mono">{delComprobante.cbu}</b>{delComprobante.titular ? ` · ${delComprobante.titular}` : ""}{p.cbu ? " (la ficha tiene otro)" : ""}.</span>
              <button type="button" onClick={() => abrir(true)} className={boton}>Guardar en el proveedor…</button>
            </div>
          )}
        </>
      )}
      {form && (
        <div className="space-y-1 pt-1">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {CAMPOS.map((c) => (
              <label key={c.k} className="flex items-center gap-1.5 min-w-0">
                <span className="w-20 shrink-0 text-zinc-500">{c.label}</span>
                <input value={String(form[c.k] ?? "")} placeholder={c.ph} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })}
                  className={`min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-white ${c.mono ? "font-mono" : ""}`} />
              </label>
            ))}
          </div>
          {evaluado?.avisos.map((a) => <p key={a} className="text-amber-700 dark:text-amber-300">{a}</p>)}
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex items-center gap-2 pt-0.5">
            <button type="button" disabled={guardando || sinCambios} onClick={() => void guardar()}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {guardando && <Loader2 className="h-3 w-3 animate-spin" />}Guardar en el proveedor
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-[11px] text-zinc-500 hover:underline">Cancelar</button>
            {sinCambios && <span className="text-zinc-500">Sin cambios.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
