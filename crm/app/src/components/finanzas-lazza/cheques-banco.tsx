"use client";

// Finanzas Lazza → Cheques → "Subir Excel del banco" (Augusto 19/10/2026).
// Mismo circuito que Finanzas > Extractos > "Completar cheques emitidos" (lib/extracto-bbva + RPC completar_cheques_emitidos):
// lee la planilla (hoja "Emitidos") o los Excel de eCheq emitidos, NO DUPLICA (busca cada cheque por número),
// agrega solo los que faltan, marca los de Martín y pasa a debitados los que el banco pagó antes del corte del extracto.
// Muestra el resumen y guarda recién cuando Augusto aprieta Guardar.
import { useMemo, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import { leerListadoCheques, chequesParaCompletar, unirListados, numeroCheque, type ChequeListado } from "@/lib/extracto-bbva";

const db = supabase as any;
const CHEQUES_DESDE = "2026-08-01";
const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

async function leerHojas(file: File): Promise<unknown[][][]> {
  const XLSX: any = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return wb.SheetNames.map((n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }));
}

export function ChequesBanco({ sociedadId, cheques, onClose, onGuardado }: {
  sociedadId: string;
  cheques: { numero: string; direccion: string; estado: string }[];
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [archivos, setArchivos] = useState<string[]>([]);
  const [listado, setListado] = useState<ChequeListado[] | null>(null);
  const [viejosPagados, setViejosPagados] = useState<ChequeListado[]>([]);
  const [corte, setCorte] = useState("2026-08-31");
  const [aviso, setAviso] = useState<string | null>(null);

  const aPagarEnCrm = useMemo(() => new Set(cheques.filter((c) => c.direccion === "emitido" && ["pendiente", "entregado"].includes(c.estado)).map((c) => numeroCheque(c.numero))), [cheques]);
  const comparacion = useMemo(() => {
    if (!listado) return null;
    const enCrm = new Set(cheques.filter((c) => c.direccion === "emitido").map((c) => numeroCheque(c.numero)));
    const nuevos = listado.filter((c) => !enCrm.has(numeroCheque(c.numero)));
    const pagadosAntes = [...listado, ...viejosPagados].filter((c) => c.estado === "PAGADO" && c.fecha_debito && c.fecha_debito <= corte && aPagarEnCrm.has(numeroCheque(c.numero)));
    return { total: listado.length, nuevos, yaEstan: listado.length - nuevos.length, terceros: listado.filter((c) => c.cubre_tercero).length, pagadosAntes: pagadosAntes.length };
  }, [listado, viejosPagados, cheques, corte, aPagarEnCrm]);

  async function elegir(files: FileList | null) {
    if (!files?.length) return;
    setLeyendo(true); setAviso(null);
    try {
      const { data: cs } = await db.from("cuentas_financieras").select("fecha_corte").eq("sociedad_id", sociedadId);
      setCorte((cs || []).map((c: any) => c.fecha_corte).filter(Boolean).sort()[0] || "2026-08-31");
      const listados: ChequeListado[][] = [];
      for (const f of Array.from(files)) {
        for (const hoja of await leerHojas(f)) {
          const l = leerListadoCheques(hoja);
          if (l.length) listados.push(l);
        }
      }
      if (!listados.length) { alert("No encontré cheques emitidos en esos archivos (hace falta la hoja \"Emitidos\" o el Excel de eCheq emitidos del banco)."); return; }
      const l = chequesParaCompletar(listados, CHEQUES_DESDE);
      const enListado = new Set(l.map((c) => numeroCheque(c.numero)));
      setListado(l);
      setViejosPagados(unirListados(listados).filter((c) => c.estado === "PAGADO" && c.fecha_debito && !enListado.has(numeroCheque(c.numero))));
      setArchivos(Array.from(files).map((f) => f.name));
    } catch (e) {
      alert(`No se pudo leer: ${errorTexto(e)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    if (!listado?.length) return;
    setGuardando(true);
    let agregados = 0, numerados = 0, marcados = 0, pagados = 0;
    try {
      // Los viejos solo van si el CRM los tiene "a pagar" (para no mandar los cheques de años anteriores).
      const viejos = viejosPagados.filter((c) => aPagarEnCrm.has(numeroCheque(c.numero)) && String(c.fecha_debito) <= corte).map((c) => ({ ...c, soloMarcar: true }));
      const todos: Array<ChequeListado & { soloMarcar?: boolean }> = [...listado, ...viejos];
      for (let i = 0; i < todos.length; i += 200) {
        const { data, error } = await db.rpc("completar_cheques_emitidos", {
          p_sociedad_id: sociedadId,
          p_cheques: todos.slice(i, i + 200).map((c) => ({
            numero: c.numero, monto: c.monto, fecha_emision: c.fecha_emision, fecha_pago: c.fecha_pago,
            beneficiario: c.beneficiario, estado: c.estado, cubre_tercero: c.cubre_tercero,
            pagado_antes_corte: c.estado === "PAGADO" && Boolean(c.fecha_debito) && String(c.fecha_debito) <= corte,
            solo_marcar: Boolean(c.soloMarcar),
          })),
        });
        if (error) throw error;
        agregados += Number(data?.agregados || 0); numerados += Number(data?.numerados || 0); marcados += Number(data?.marcados || 0); pagados += Number(data?.pagados || 0);
      }
      setAviso(`${agregados} agregados · ${numerados} del CRM completados con su número · ${marcados} marcados de Martín · ${pagados} pasaron a debitados.`);
      setListado(null); setViejosPagados([]);
      onGuardado();
    } catch (e) {
      alert(`No se pudieron guardar los cheques: ${errorTexto(e)}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white">Subir Excel del banco</h2>
            <p className="text-xs text-zinc-500">
              La planilla de cheques (hoja &quot;Emitidos&quot;) o los Excel de eCheq emitidos. No duplica: si el cheque ya está, no lo vuelve a cargar.
              Agrega los que faltan (desde el {formatDate(CHEQUES_DESDE)} o sin pagar) y pasa a debitados los que el banco pagó antes del extracto.
            </p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Elegir archivos
          <input type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void elegir(e.target.files); e.target.value = ""; }} />
        </label>
        {comparacion && (
          <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
            <p className="text-xs text-zinc-500">{archivos.join(", ")}</p>
            <ul className="space-y-0.5">
              <li>{comparacion.total} cheques que importan</li>
              <li><b>{comparacion.nuevos.length} nuevos</b> (no están en el CRM)</li>
              <li>{comparacion.yaEstan} ya están (no se duplican)</li>
              {comparacion.terceros > 0 && <li>{comparacion.terceros} de Martín Fernández</li>}
              {comparacion.pagadosAntes > 0 && <li>{comparacion.pagadosAntes} figuran &quot;a pagar&quot; pero el banco los debitó: pasan a debitados</li>}
            </ul>
            <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </button>
          </div>
        )}
        {aviso && <p className="text-xs text-emerald-700 dark:text-emerald-400">✓ {aviso}</p>}
        <p className="text-[11px] text-zinc-400">Los recibidos (en cartera, depositados, cobrados, rechazados) los actualiza el sistema con cada cobro, OP y extracto.</p>
      </div>
    </div>
  );
}
