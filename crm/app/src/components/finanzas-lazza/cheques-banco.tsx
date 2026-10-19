"use client";

// Finanzas Lazza → Cheques → "Subir Excel del banco" (Augusto 19/10/2026).
// Se suben juntos los listados de eCheq del BBVA (aceptados, depósito, endosados, rechazados, emitidos, denegados);
// cada archivo se reconoce solo. Reglas en lib/cheques-banco (con prueba): solo cambia el estado si coinciden N° + CUIT + monto,
// nunca crea cheques, ignora lo anterior al 22/08/2026 y solo avanza estados. Los rechazados usan rechazar_cheque_recibido
// (la misma función de Finanzas: anula el cobro, la factura vuelve a pendiente y deja aviso). Guarda solo con "Guardar".
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { compararConBanco, cuentasDeOtraSociedad, leerListadoBanco, nombreListado, DESDE_CRM, type ChequeBanco, type ChequeCrm } from "@/lib/cheques-banco";
import { useUser } from "@/lib/auth-context";

const db = supabase as any;
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));
const ESTADO: Record<string, string> = { en_cartera: "En cartera", depositado: "Depositado", cobrado: "Cobrado / debitado", endosado: "Endosado", rechazado: "Rechazado", entregado: "Sin debitar", pendiente: "Sin debitar" };

async function leerHojas(file: File): Promise<unknown[][][]> {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }));
}

export function ChequesBanco({ sociedadId, cheques, onClose, onGuardado }: {
  sociedadId: string;
  cheques: ChequeCrm[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [archivos, setArchivos] = useState<{ nombre: string; listado: string; filas: number }[]>([]);
  const [banco, setBanco] = useState<ChequeBanco[] | null>(null);
  const [resultado, setResultado] = useState<string[] | null>(null);
  const [numerosCuentas, setNumerosCuentas] = useState<string[]>([]);
  const { sociedadActiva } = useUser();

  const comp = useMemo(() => (banco ? compararConBanco(banco, cheques) : null), [banco, cheques]);
  const ajenas = useMemo(() => (banco ? cuentasDeOtraSociedad(banco, numerosCuentas) : []), [banco, numerosCuentas]);

  async function elegir(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true); setResultado(null);
    try {
      const todos: ChequeBanco[] = [];
      const info: { nombre: string; listado: string; filas: number }[] = [];
      for (const f of Array.from(files)) {
        let filas = 0, listado = "";
        for (const hoja of await leerHojas(f)) {
          const l = leerListadoBanco(hoja, f.name);
          if (l.length) { todos.push(...l); filas += l.length; listado = nombreListado(l[0].listado); }
        }
        info.push({ nombre: f.name, listado: listado || "no es un listado de eCheq", filas });
      }
      if (!todos.length) { alert("No encontré listados de eCheq en esos archivos. Bajalos del BBVA (eCheq → Exportar) y subilos tal cual."); return; }
      const { data: cs } = await db.from("cuentas_financieras").select("numero").eq("sociedad_id", sociedadId);
      setNumerosCuentas((cs || []).map((c: any) => c.numero).filter(Boolean));
      setArchivos(info);
      setBanco(todos);
    } catch (e) {
      alert(`No se pudo leer: ${errorTexto(e)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!comp?.cambios.length) return;
    setGuardando(true);
    const hechos: string[] = [];
    try {
      for (const c of comp.cambios) {
        if (c.accion === "rechazar") {
          const { data, error } = await db.rpc("rechazar_cheque_recibido", { p_cheque_id: c.chequeId, p_motivo: "Rechazado según el Excel del banco" });
          if (error) { hechos.push(`✗ ${c.numero}: ${errorTexto(error)}`); continue; }
          const avisos: string[] = Array.isArray(data?.avisos) ? data.avisos.map(String) : [];
          hechos.push(`✓ ${c.numero} rechazado${data?.cobro_anulado ? ": se anuló el cobro y la factura volvió a quedar pendiente" : ""}${avisos.length ? ` (${avisos.join("; ")})` : ""}`);
          continue;
        }
        // Solo si sigue en el estado que se comparó (si alguien lo cambió en el medio, no se pisa).
        const { data, error } = await db.from("echeqs").update(c.campos).eq("id", c.chequeId).eq("sociedad_id", sociedadId).eq("estado", c.de).select("id");
        if (error) hechos.push(`✗ ${c.numero}: ${errorTexto(error)}`);
        else if (!data?.length) hechos.push(`– ${c.numero}: cambió en el medio, no se tocó`);
        else hechos.push(`✓ ${c.numero}: ${ESTADO[c.de] || c.de} → ${ESTADO[c.a] || c.a}`);
      }
      setResultado(hechos);
      setBanco(null);
      onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Subir Excel del banco</h2>
            <p className="text-xs text-zinc-500">
              Subí juntos los listados de eCheq del BBVA (aceptados, depósito, endosados, rechazados, emitidos, denegados). No duplica nada:
              solo cambia el estado de los cheques que coinciden en N°, CUIT y monto. Nada se guarda hasta que apretás Guardar.
            </p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>

        <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Elegir archivos
          <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void elegir(e.target.files); e.target.value = ""; }} />
        </label>

        {archivos.length > 0 && banco && (
          <ul className="space-y-0.5 text-xs text-zinc-500">
            {archivos.map((a) => <li key={a.nombre}>{a.nombre}: <b className="text-zinc-700 dark:text-zinc-200">{a.listado}</b>{a.filas ? ` · ${a.filas} cheques` : ""}</li>)}
          </ul>
        )}

        {ajenas.length === 0 && comp && comp.coinciden === 0 && comp.cambios.length === 0 && comp.faltan.length > 5 && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Ningún cheque coincide con {sociedadActiva?.nombre || "esta sociedad"}: ¿estos Excel son de la otra sociedad? Cambiala arriba y volvé a subirlos.</span>
          </p>
        )}
        {ajenas.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Estos Excel son de la cuenta {ajenas.join(", ")}, que no es de {sociedadActiva?.nombre || "esta sociedad"}. Cambiá la sociedad arriba y volvé a subirlos.</span>
          </p>
        )}

        {comp && (
          <div className="space-y-3 text-sm">
            <p className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> {comp.coinciden} iguales que en el CRM</span>
              <span><b>{comp.cambios.length}</b> cambian de estado</span>
              {comp.avisos.length > 0 && <span className="text-amber-700 dark:text-amber-400">{comp.avisos.length} para revisar</span>}
              {comp.faltan.length > 0 && <span>{comp.faltan.length} no están en el CRM</span>}
              <span className="text-zinc-400">{comp.viejos} de antes del {formatDate(DESDE_CRM)} (no se tocan)</span>
            </p>

            {comp.cambios.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">Cambian de estado</p>
                <table className="w-full text-xs">
                  <tbody>
                    {comp.cambios.map((c) => (
                      <tr key={c.chequeId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1 pr-2 font-mono">{c.numero}</td>
                        <td className="pr-2">{c.quien}</td>
                        <td className="pr-2 text-right font-mono">{formatCurrency(c.monto)}</td>
                        <td className={`pr-2 ${c.accion === "rechazar" ? "font-semibold text-red-600" : ""}`}>{ESTADO[c.de] || c.de} → {ESTADO[c.a] || c.a}</td>
                        <td className="text-zinc-500">{c.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {comp.avisos.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Para revisar (no se cambian)</p>
                <ul className="space-y-0.5 text-xs text-amber-900 dark:text-amber-100">
                  {comp.avisos.map((a, i) => <li key={`${a.numero}-${i}`}><span className="font-mono">{a.numero}</span> {a.quien} {formatCurrency(a.monto)}: {a.texto}</li>)}
                </ul>
              </div>
            )}

            {comp.faltan.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-zinc-500">No están en el CRM (no se cargan solos)</p>
                <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                  {comp.faltan.map((f, i) => (
                    <li key={`${f.numero}-${i}`}>
                      <span className="font-mono">{f.numero}</span> · {nombreListado(f.listado)} · {f.quien}{f.destinatario ? ` → ${f.destinatario}` : ""} · {formatCurrency(f.monto)}
                      {f.pago ? ` · pago ${formatDate(f.pago)}` : ""} · banco: {f.estadoBanco.toLowerCase()}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {comp.cambios.length > 0 ? (
              <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : `Guardar ${comp.cambios.length} cambio${comp.cambios.length === 1 ? "" : "s"}`}
              </button>
            ) : <p className="text-xs text-emerald-700 dark:text-emerald-400">No hay nada para cambiar: el CRM está igual que el banco.</p>}
          </div>
        )}

        {resultado && (
          <ul className="space-y-0.5 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-800/50">
            {resultado.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
