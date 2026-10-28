"use client";

// Asistente de Finanzas (16/10/2026): botón flotante en Finanzas que abre un chat con la IA experta en finanzas.
// Contesta con los datos reales (api/finanzas/asistente), puede mandar al agente a leer los correos y ofrece botones
// para ir a la pantalla que corresponde. Se le puede adjuntar el Excel del banco: lo verifica al centavo y lo carga
// sin duplicar (mismas funciones que Para confirmar). Las cargas y lecturas de correo quedan en el Registro.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate } from "@/lib/utils";
import { leerArchivoExtracto, guardarArchivoExtracto, confirmarChequesDelExtracto, textoChequesSolos, type CuentaRow, type ArchivoPreview } from "@/components/extracto-bbva";
import { Bot, Loader2, Paperclip, Send, Trash2, X } from "lucide-react";

/** 26/10/2026 (Augusto): una sola puerta para el banco; el asistente (hoy oculto) no carga Excel. */
const CON_EXCEL = false;

interface Mensaje { role: "user" | "assistant"; content: string; botones?: { pestana: string; texto: string }[]; archivo?: ArchivoPreview & { estado?: string } }

const SUGERENCIAS = [
  "¿Cómo estoy hoy?",
  "¿Qué pago esta semana?",
  "¿Quién me debe y quién está atrasado?",
  "¿Cuánto me cobró el banco de impuestos este mes?",
  "Leé los correos nuevos y decime qué pagos llegaron",
];

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

/** Negritas (**x**). */
function Linea({ t }: { t: string }) {
  return <>{t.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith("**") && p.endsWith("**") ? <b key={k}>{p.slice(2, -2)}</b> : <span key={k}>{p}</span>))}</>;
}

/** Texto de la IA: negritas, viñetas y tablas simples (| a | b |), sin HTML de afuera. */
function Texto({ t }: { t: string }) {
  const bloques: ({ tabla: string[][] } | { linea: string })[] = [];
  for (const l of t.split("\n")) {
    const s = l.trim();
    if (s.startsWith("|") && s.endsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(s)) continue; // separador |---|
      const celdas = s.slice(1, -1).split("|").map((c) => c.trim());
      const prev = bloques[bloques.length - 1];
      if (prev && "tabla" in prev) prev.tabla.push(celdas); else bloques.push({ tabla: [celdas] });
    } else bloques.push({ linea: l });
  }
  return (
    <>
      {bloques.map((b, i) => "tabla" in b ? (
        <table key={i} className="my-1 w-full text-xs">
          <tbody>
            {b.tabla.map((fila, k) => (
              <tr key={k} className={k === 0 ? "font-semibold" : "border-t border-zinc-200 dark:border-zinc-700"}>
                {fila.map((c, j) => <td key={j} className={`py-0.5 pr-2 ${j > 0 ? "text-right" : ""}`}><Linea t={c} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p key={i} className={!b.linea.trim() ? "h-2" : /^\s*[-•]\s/.test(b.linea) ? "pl-3 -indent-3" : ""}>
          <Linea t={b.linea.replace(/^\s*-\s/, "• ")} />
        </p>
      ))}
    </>
  );
}

export default function AsistenteFinanzas({ onIrATab }: { onIrATab?: (tab: string) => void }) {
  const { sociedadActiva, profile } = useUser() as any;
  const sociedadId: string | undefined = sociedadActiva?.id;
  const clave = `lz-asistente-finanzas-${sociedadId || ""}`;
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  // La conversación se guarda solo en esta compu (para no perderla al cambiar de pestaña).
  // `cargada`: para qué sociedad ya se leyó lo guardado (así no se pisa con la lista vacía al cambiar de sociedad).
  const [cargada, setCargada] = useState<string | null>(null);
  useEffect(() => {
    try { const g = localStorage.getItem(clave); setMensajes(g ? JSON.parse(g) : []); } catch { setMensajes([]); }
    setCargada(clave);
  }, [clave]);
  useEffect(() => {
    if (cargada !== clave) return;
    try { localStorage.setItem(clave, JSON.stringify(mensajes.slice(-40).map((m) => ({ ...m, archivo: undefined })))); } catch { /* sin almacenamiento */ }
    fin.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, clave, cargada]);

  const puede = useMemo(() => ["super_admin", "admin", "administrativo"].includes(String(profile?.role)), [profile?.role]);
  if (!sociedadId || !puede) return null;

  async function anotar(accion: string, resumen: string, resultado: Record<string, unknown> = {}) {
    await (supabase as any).from("finanzas_registro").insert({ sociedad_id: sociedadId, accion, origen: "asistente", resumen, resultado, usuario_id: profile?.id });
  }

  async function preguntar(q: string) {
    const pregunta = q.trim();
    if (!pregunta || pensando) return;
    const nuevos: Mensaje[] = [...mensajes, { role: "user", content: pregunta }];
    setMensajes(nuevos);
    setTexto("");
    setPensando(true);
    try {
      const res = await fetch("/api/finanzas/asistente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sociedad_id: sociedadId, mensajes: nuevos.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "El asistente no respondió");
      setMensajes((m) => [...m, { role: "assistant", content: String(j.texto || ""), botones: j.botones || [] }]);
      if ((j.acciones || []).includes("leyo_correos")) void anotar("asistente_leyo_correos", `El asistente mandó a leer los correos (pedido: "${pregunta.slice(0, 120)}")`);
    } catch (e) {
      setMensajes((m) => [...m, { role: "assistant", content: `⚠️ ${errorTexto(e)}. Probá de nuevo.` }]);
    } finally {
      setPensando(false);
    }
  }

  async function adjuntar(files: FileList | null) {
    if (!files?.length || !sociedadId) return;
    setPensando(true);
    try {
      const db = supabase as any;
      const { data: cs, error: e1 } = await db.from("cuentas_financieras").select("id, nombre, tipo, numero, moneda, fecha_corte, activa, saldo_banco, saldo_banco_fecha").eq("sociedad_id", sociedadId);
      if (e1) throw e1;
      const cuentas = (cs || []) as CuentaRow[];
      for (const f of Array.from(files)) {
        try {
          const preliminar = await leerArchivoExtracto(f, cuentas, new Map());
          const claves = new Set<string>();
          const guardadas: Array<{ cuenta_id: string; fecha: string; importe: number }> = [];
          if (preliminar.cuenta) {
            const { data: ls } = await db.from("extracto_movimientos").select("clave, fecha, monto, tipo").eq("cuenta_id", preliminar.cuenta.id).gte("fecha", preliminar.leido.lineas[0]?.fecha || "2000-01-01").limit(5000);
            for (const l of ls || []) {
              if (l.clave) claves.add(l.clave);
              // 25/10: también por fecha + importe, para no duplicar líneas cargadas desde otro formato del banco (saldo o texto distintos).
              guardadas.push({ cuenta_id: preliminar.cuenta.id, fecha: String(l.fecha).slice(0, 10), importe: l.tipo === "credito" ? Number(l.monto) : -Number(l.monto) });
            }
          }
          const a = await leerArchivoExtracto(f, cuentas, new Map(preliminar.cuenta ? [[preliminar.cuenta.id, claves]] : []), preliminar.cuenta ? guardadas : undefined);
          const resumen = a.cuenta
            ? `**${f.name}** → ${a.cuenta.nombre}. Del ${formatDate(a.leido.lineas[0]?.fecha || "")} al ${formatDate(a.leido.saldoFecha || "")}, saldo ${formatCurrency(a.leido.saldoFinal || 0)}. ${a.leido.avisoSaldo ? `⚠️ ${a.leido.avisoSaldo}` : "Saldos verificados ✔."} **${a.nuevas} líneas nuevas**, ${a.desdeCorte.length - a.nuevas} ya estaban.`
            : `**${f.name}**: no hay una cuenta con ese número en esta sociedad (${a.leido.cuentaTexto}).`;
          setMensajes((m) => [...m, { role: "user", content: `📎 ${f.name}` }, { role: "assistant", content: resumen, archivo: a.cuenta && a.nuevas ? a : undefined }]);
        } catch (e) {
          setMensajes((m) => [...m, { role: "user", content: `📎 ${f.name}` }, { role: "assistant", content: `⚠️ No lo cargo: ${errorTexto(e)}` }]);
        }
      }
    } catch (e) {
      setMensajes((m) => [...m, { role: "assistant", content: `⚠️ ${errorTexto(e)}` }]);
    } finally {
      setPensando(false);
    }
  }

  async function guardarArchivo(i: number) {
    const a = mensajes[i]?.archivo;
    if (!a || !sociedadId) return;
    setPensando(true);
    try {
      const r = await guardarArchivoExtracto(sociedadId, a);
      await anotar("extracto_cargado", `Extracto ${a.nombre} → ${a.cuenta?.nombre}: ${r.insertadas} líneas nuevas, saldo ${formatCurrency(a.leido.saldoFinal || 0)} al ${formatDate(a.leido.saldoFecha || "")} (desde el asistente)`, { archivo: a.nombre, ...r });
      // 28/10/2026 (Augusto): los débitos de cheques propios con el mismo N° e importe se confirman solos.
      let solos = "";
      try {
        const xs = await confirmarChequesDelExtracto(sociedadId);
        solos = textoChequesSolos(xs);
        if (xs.length) await anotar("cheques_confirmados_solos", solos, { cheques: xs.map((s) => ({ numero: s.numero, monto: s.monto, fecha: s.fecha, linea_id: s.linea_id })) });
      } catch (e) {
        solos = `⚠️ Los cheques no se confirmaron solos (quedan en Para confirmar): ${errorTexto(e)}`;
      }
      setMensajes((m) => m.map((x, k) => (k === i ? { ...x, archivo: undefined } : x)).concat({
        role: "assistant",
        content: `Listo: guardé **${r.insertadas} líneas** en ${a.cuenta?.nombre}${r.repetidas ? ` (${r.repetidas} ya estaban, no se duplicaron)` : ""}.${solos ? ` ${solos}.` : ""} El sistema ya armó los cruces: confirmalos en Para confirmar.`,
        botones: [{ pestana: "para_confirmar", texto: "Abrir Para confirmar" }],
      }));
    } catch (e) {
      setMensajes((m) => [...m, { role: "assistant", content: `⚠️ No se pudo guardar: ${errorTexto(e)}` }]);
    } finally {
      setPensando(false);
    }
  }

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-violet-700">
        <Bot className="h-5 w-5" /> Asistente de Finanzas
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 z-40 flex h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-zinc-200 bg-white shadow-2xl sm:bottom-5 sm:right-5 sm:rounded-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white"><Bot className="h-5 w-5 text-violet-600" /> Asistente de Finanzas</p>
        <div className="flex gap-1">
          {mensajes.length > 0 && <button title="Empezar de nuevo" onClick={() => setMensajes([])} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><Trash2 className="h-4 w-4" /></button>}
          <button title="Cerrar" onClick={() => setAbierto(false)} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {!mensajes.length && (
          <div className="space-y-2">
            <p className="text-zinc-600 dark:text-zinc-300">Preguntame lo que quieras de la plata de <b>{sociedadActiva?.nombre}</b>: pagos, cobranzas, cheques, impuestos del banco.</p>
            {SUGERENCIAS.map((s) => (
              <button key={s} onClick={() => void preguntar(s)} className="block w-full rounded-lg border border-violet-200 px-3 py-2 text-left text-violet-800 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-200 dark:hover:bg-violet-950/40">{s}</button>
            ))}
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-violet-600 px-3 py-2 text-white" : "mr-4 space-y-1 rounded-xl bg-zinc-100 px-3 py-2 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"}>
            <Texto t={m.content} />
            {m.archivo && (
              <button disabled={pensando} onClick={() => void guardarArchivo(i)} className="mt-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Guardar {m.archivo.nuevas} líneas y armar los cruces</button>
            )}
            {(m.botones || []).length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {m.botones!.map((b, k) => (
                  <button key={k} onClick={() => { onIrATab?.(b.pestana); }} className="rounded-md border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300">{b.texto} →</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {pensando && <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Mirando los números…</p>}
        <div ref={fin} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }} className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        {/* 26/10/2026 (Finanzas simple): el asistente es solo para preguntas; el Excel del banco se sube solo en Bancos > Movimientos. */}
        {CON_EXCEL && <button type="button" title="Adjuntar el Excel del banco" onClick={() => archivoRef.current?.click()} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Paperclip className="h-5 w-5" /></button>}
        {CON_EXCEL && <input ref={archivoRef} type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(e) => { void adjuntar(e.target.files); e.target.value = ""; }} />}
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Escribí tu pregunta…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void preguntar(texto); } }}
          className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
        <button type="submit" disabled={pensando || !texto.trim()} className="rounded-lg bg-violet-600 p-2 text-white hover:bg-violet-700 disabled:opacity-50"><Send className="h-5 w-5" /></button>
      </form>
    </div>
  );
}
