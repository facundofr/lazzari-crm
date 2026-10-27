"use client";

// Certificados de retenciones sufridas (Augusto 27/10/2026), en Finanzas › Retenciones › Sufridas:
// - «Cargar certificado (IA)»: se suben uno o varios PDF o fotos; la IA lee cada certificado (api/parse-certificado-retencion)
//   y lib/certificado-sufrido propone a qué retención sin N° va (mismo cliente, impuesto e importe). Nada se guarda solo:
//   «Confirmar» guarda el N° y el archivo (bucket certificados) en la tabla certificados_retencion. Avisa y nunca frena.
// - CeldaCertificado: la columna «Certificado» con el N°, 📎 para abrir el archivo y «Quitar» (queda anulado, no se borra);
//   en «falta», el N° se escribe a mano.
import { useMemo, useRef, useState } from "react";
import { Check, Loader2, Paperclip, Sparkles, Upload, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { claveCertificado, corregirPartes, proponerRetenciones, soloDigitos, TOLERANCIA_CERTIFICADO, type CertificadoLeido, type Propuesta, type RetencionSufrida } from "@/lib/certificado-sufrido";
import type { FilaRetencion } from "@/lib/finanzas-lazza";

const db = supabase as any;
const TIPOS_OK = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const GRILLA = "sm:grid-cols-[minmax(0,1.2fr)_7rem_minmax(0,2fr)_auto] sm:gap-3";
const cuitAR = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Un certificado leído y el archivo de donde salió (un PDF puede traer varios). */
interface Leido { clave: string; cert: CertificadoLeido; archivo: File }

/** Algunas compus mandan el PDF sin tipo: por la extensión se sabe. */
const conTipo = (f: File) => (f.type || !/\.pdf$/i.test(f.name) ? f : new File([f], f.name, { type: "application/pdf" }));

// Fecha e importe primero: en pantallas angostas el desplegable corta el final.
const etiqueta = (r: FilaRetencion) => `${formatDate(r.fecha)} · ${formatCurrency(r.monto, r.moneda)} · ${r.impuesto}${r.origen ? ` · ${r.origen}` : ""} · ${r.nombre.slice(0, 24)}`;

/** Lo que se le dice sobre la retención elegida: ✓ o ⚠ (nunca frena). `c` ya con agente y retenido en su lugar. */
function aviso(p: Propuesta, c: CertificadoLeido, r: FilaRetencion | null): { ok: boolean; texto: string } {
  if (p.estado === "sin_numero") return { ok: false, texto: "⚠ El papel no trae N° de certificado: no se puede cargar." };
  if (p.estado === "otra_sociedad") return { ok: false, texto: `⚠ Es de ${p.otraSociedad}: cambiá la sociedad arriba y cargalo ahí.` };
  if (!r) {
    if (p.yaCargado) return { ok: false, texto: `⚠ Ya está cargado en la retención del ${formatDate(p.yaCargado.fecha)} (${formatCurrency(p.yaCargado.monto, p.yaCargado.moneda)}).` };
    return { ok: false, texto: p.opciones.length ? "⚠ No encontré una retención que coincida: elegila si es alguna de la lista." : "⚠ No está en el CRM: registrá primero el cobro con esta retención." };
  }
  const partes: string[] = [];
  let ok = true;
  const dif = c.monto === null || r.moneda !== "ARS" ? null : r2(c.monto - r.monto);
  if (dif === null) { ok = false; partes.push(`⚠ Revisá el importe: en el CRM ${formatCurrency(r.monto, r.moneda)}`); }
  else if (Math.abs(dif) > TOLERANCIA_CERTIFICADO) { ok = false; partes.push(`⚠ Importe distinto: en el CRM ${formatCurrency(r.monto)}`); }
  else partes.push(Math.abs(dif) >= 0.01 ? `✓ Coincide (difiere ${formatCurrency(Math.abs(dif))})` : "✓ Coincide");
  if (c.agenteCuit && soloDigitos(r.cuit) !== c.agenteCuit) { ok = false; partes.push(`⚠ En el CRM es de ${r.nombre}`); }
  if (p.yaCargado && p.yaCargado.movimientoId !== r.movimientoId) { ok = false; partes.push(`⚠ Este N° ya está en la retención del ${formatDate(p.yaCargado.fecha)}`); }
  return { ok, texto: partes.join(" · ") };
}

/**
 * Botón «Cargar certificado (IA)» y su ventana. `sufridas`: todas las retenciones sufridas de la sociedad (sin el filtro
 * de fechas de la lista). `onGuardado`: se guardó al menos uno (la lista se recarga al cerrar).
 */
export function CargarCertificado({ sociedadId, sufridas, sociedad, onGuardado }: {
  sociedadId: string;
  sufridas: FilaRetencion[];
  /** CUIT de la sociedad activa y las otras (para avisar si el certificado es de otra). */
  sociedad: { cuit: string; otras: { nombre: string; cuit: string }[] };
  onGuardado: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subidos = useRef(new Map<File, string | null>()); // archivo → URL: un PDF con varios certificados se sube una sola vez
  const [abierto, setAbierto] = useState(false);
  const [leyendo, setLeyendo] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [leidos, setLeidos] = useState<Leido[]>([]);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  const [cargados, setCargados] = useState<Record<string, { mov: string; numero: string }>>({});
  const [guardando, setGuardando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);

  const porMov = useMemo(() => new Map(sufridas.filter((r) => r.movimientoId).map((r) => [r.movimientoId as string, r])), [sufridas]);
  const pendientes = useMemo(() => leidos.filter((l) => !cargados[l.clave]), [leidos, cargados]);
  const propuestas = useMemo(() => {
    // Las que se cargaron en esta ventana ya tienen N° (la lista se recarga al cerrar).
    const recien = new Map(Object.values(cargados).map((x) => [x.mov, x.numero]));
    const retenciones: RetencionSufrida[] = [...porMov.values()].map((r) => ({ movimientoId: r.movimientoId as string, fecha: r.fecha, impuesto: r.impuesto, monto: r.monto,
      moneda: r.moneda, nombre: r.nombre, cuit: r.cuit, certificado: r.certificado ?? recien.get(r.movimientoId as string) ?? null }));
    const lista = proponerRetenciones(pendientes.map((l) => l.cert), retenciones, sociedad);
    return new Map(pendientes.map((l, i) => [l.clave, lista[i]]));
  }, [pendientes, porMov, cargados, sociedad]);

  // La retención elegida: la que eligió a mano (si sigue en la lista) o la propuesta.
  const movDe = (l: Leido) => {
    const p = propuestas.get(l.clave);
    const e = elegido[l.clave];
    if (e !== undefined && (e === "" || p?.opciones.includes(e))) return e;
    return p?.movimientoId ?? "";
  };
  const seguros = pendientes.filter((l) => {
    const p = propuestas.get(l.clave);
    return p?.estado === "coincide" && !!p.movimientoId && movDe(l) === p.movimientoId && !p.otroCliente && !p.yaCargado;
  });

  const leer = async (files: FileList | null) => {
    const lista = Array.from(files || []).map(conTipo);
    const errs = lista.filter((f) => !TIPOS_OK.includes(f.type)).map((f) => `${f.name}: no es PDF ni foto`);
    for (const f of lista.filter((x) => TIPOS_OK.includes(x.type))) {
      setLeyendo(f.name);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/parse-certificado-retencion", { method: "POST", body: fd });
        const json = await res.json().catch(() => null);
        const certs: CertificadoLeido[] = json?.certificados || [];
        if (!res.ok || !json?.success) errs.push(`${f.name}: ${json?.error || "no se pudo leer"}`);
        else if (!certs.length) errs.push(`${f.name}: no encontré certificados de retención`);
        else setLeidos((prev) => {
          const ya = new Set(prev.map((x) => x.clave));
          return [...prev, ...certs.filter((c) => !ya.has(claveCertificado(c))).map((c) => ({ clave: claveCertificado(c), cert: c, archivo: f }))];
        });
      } catch {
        errs.push(`${f.name}: no se pudo conectar`);
      }
    }
    setLeyendo(null);
    setErrores(errs);
    if (inputRef.current) inputRef.current.value = "";
  };

  const confirmar = async (lista: Leido[]) => {
    setGuardando(true);
    const hechos: Record<string, { mov: string; numero: string }> = {};
    const fallas: string[] = [];
    const sinArchivo: string[] = [];
    for (const l of lista) {
      const mov = movDe(l);
      const c = corregirPartes(l.cert, sociedad.cuit);
      if (!mov || !c.numero) continue;
      let url = subidos.current.get(l.archivo);
      if (url === undefined) {
        const ext = (l.archivo.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
        const ruta = `sufridas/${sociedadId}/${todayAR()}-${crypto.randomUUID()}.${ext}`;
        const { error: eS } = await db.storage.from("certificados").upload(ruta, l.archivo, { upsert: false, contentType: l.archivo.type || undefined });
        if (eS) console.warn("Certificado: no se pudo subir el archivo", eS);
        url = eS ? null : (db.storage.from("certificados").getPublicUrl(ruta).data?.publicUrl ?? null);
        subidos.current.set(l.archivo, url ?? null);
      }
      const { error } = await db.from("certificados_retencion").insert({
        sociedad_id: sociedadId, movimiento_id: mov, numero: c.numero, fecha: c.fecha, monto: c.monto, agente_cuit: c.agenteCuit,
        archivo_url: url, archivo_nombre: l.archivo.name, origen: "ia", lectura_ia: l.cert,
      });
      if (error) { fallas.push(`${c.impuesto || ""} N° ${c.numero}: ${error.code === "23505" ? "esa retención ya tiene un certificado cargado" : error.message}`.trim()); continue; }
      hechos[l.clave] = { mov, numero: c.numero };
      if (!url) sinArchivo.push(c.numero);
    }
    setCargados((x) => ({ ...x, ...hechos }));
    setGuardando(false);
    const avisos = [...(fallas.length ? [`No se pudo guardar: ${fallas.join(" · ")}. Probá de nuevo.`] : []), ...(sinArchivo.length ? [`Se guardó el N° sin el archivo (no se pudo subir): ${sinArchivo.join(", ")}.`] : [])];
    if (avisos.length) alert(avisos.join("\n"));
  };

  const cerrar = () => {
    const hubo = Object.keys(cargados).length > 0;
    setAbierto(false); setLeidos([]); setCargados({}); setElegido({}); setErrores([]); setLeyendo(null);
    subidos.current.clear();
    if (hubo) onGuardado();
  };
  const sinConfirmar = pendientes.length > 0 ? `Hay ${pendientes.length} ${pendientes.length === 1 ? "certificado leído" : "certificados leídos"} sin confirmar. ¿Cerrar igual?` : undefined;

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} title="Subí los PDF o fotos de los certificados: la IA los lee y propone a qué retención va cada uno; vos confirmás"
        className="flex h-8 items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-2.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
        <Sparkles className="h-3 w-3" /> Cargar certificado (IA)
      </button>
      <Modal open={abierto} onClose={cerrar} size="xl" title="Cargar certificados de retención" confirmarCierre={sinConfirmar}
        description="La IA lee cada certificado y propone a qué retención sin N° va. Nada se guarda hasta que tocás «Confirmar»: se guardan el N° y el archivo."
        footer={<>
          <button type="button" onClick={() => { if (!sinConfirmar || confirm(sinConfirmar)) cerrar(); }} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700">Cerrar</button>
          <button type="button" disabled={guardando || !seguros.length} onClick={() => void confirmar(seguros)}
            title="Los que coinciden en cliente, impuesto e importe; los que tienen un ⚠ se confirman de a uno"
            className="flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirmar los que coinciden ({seguros.length})
          </button>
        </>}>
        <div onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); if (!leyendo) void leer(e.dataTransfer.files); }}
          className={`flex flex-wrap items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-xs ${arrastrando ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30" : "border-zinc-200 dark:border-zinc-700"}`}>
          {leyendo ? <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300"><Loader2 className="h-4 w-4 animate-spin" /> Leyendo {leyendo}…</span> : <>
            <span className="text-zinc-500">Arrastrá acá los PDF o fotos de los certificados, o</span>
            <button type="button" onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1 rounded-lg border border-orange-300 px-2.5 py-1 font-medium text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30">
              <Upload className="h-3 w-3" /> Elegir archivos
            </button>
          </>}
          <input ref={inputRef} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void leer(e.target.files)} />
        </div>
        {errores.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">⚠ {errores.join(" · ")}</p>}
        {leidos.length > 0 && (<>
          <div className={`mt-3 hidden pb-1 text-xs text-zinc-500 sm:grid ${GRILLA}`}><span>Certificado</span><span className="text-right">Retenido</span><span>Va a la retención</span><span /></div>
          <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
            {leidos.map((l) => {
              const c = corregirPartes(l.cert, sociedad.cuit);
              const hecho = cargados[l.clave];
              const p = propuestas.get(l.clave);
              const mov = hecho ? hecho.mov : movDe(l);
              const r = mov ? porMov.get(mov) ?? null : null;
              const a = !hecho && p ? aviso(p, c, r) : null;
              const opciones = (p?.opciones || []).map((id) => porMov.get(id)).filter((x): x is FilaRetencion => !!x).map((x) => ({ value: x.movimientoId as string, label: etiqueta(x) }));
              return (
                <li key={l.clave} className={`grid gap-1 py-2 sm:items-center ${GRILLA}`}>
                  <div className="min-w-0">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {c.impuesto || "¿Impuesto?"}{c.impuesto === "IIBB" && c.jurisdiccion ? ` ${c.jurisdiccion}` : ""} · N° <span className="font-mono">{c.numero || "—"}</span>
                    </span>
                    <span className="block truncate text-[10px] text-zinc-400" title={l.archivo.name}>
                      {c.agenteNombre || (c.agenteCuit ? `CUIT ${cuitAR(c.agenteCuit)}` : "Cliente sin leer")}{c.fecha ? ` · ${formatDate(c.fecha)}` : ""}
                    </span>
                  </div>
                  <div className="whitespace-nowrap font-mono font-semibold sm:text-right">{c.monto === null ? "—" : formatCurrency(c.monto)}</div>
                  <div className="min-w-0">
                    {hecho && r ? <span className="text-emerald-700 dark:text-emerald-400">✓ Cargado en la retención del {formatDate(r.fecha)}{r.origen ? ` (${r.origen})` : ""}</span> : (<>
                      {opciones.length > 0 && (
                        <Select value={mov} onChange={(e) => setElegido((x) => ({ ...x, [l.clave]: e.target.value }))} placeholder="Elegí la retención…" options={opciones} className="px-2 py-1 text-xs" />
                      )}
                      {a && <span className={`mt-0.5 block ${a.ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>{a.texto}</span>}
                    </>)}
                  </div>
                  <div className="flex justify-end">
                    {hecho ? <Check className="h-4 w-4 text-emerald-600" aria-label="Cargado" /> : (
                      <button type="button" disabled={guardando || !mov || !c.numero} onClick={() => void confirmar([l])}
                        className="shrink-0 rounded-lg border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-40 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/30">
                        Confirmar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>)}
      </Modal>
    </>
  );
}

/**
 * Columna «Certificado» de Sufridas: el N° (cargado o escrito en el texto); si está cargado, 📎 abre el archivo y «Quitar»
 * lo deja anulado (no se borra) y la retención vuelve a lo que diga su texto. En «falta», tocándolo se escribe el N° a mano.
 */
export function CeldaCertificado({ fila, sociedadId, onCambio }: { fila: FilaRetencion; sociedadId: string; onCambio: () => void }) {
  const [escribiendo, setEscribiendo] = useState(false);
  const [numero, setNumero] = useState("");
  const [guardando, setGuardando] = useState(false);
  const parar = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const guardar = async () => {
    const n = numero.trim();
    if (!n || !fila.movimientoId) return;
    setGuardando(true);
    const { error } = await db.from("certificados_retencion").insert({ sociedad_id: sociedadId, movimiento_id: fila.movimientoId, numero: n, origen: "manual" });
    setGuardando(false);
    if (error) { alert(`No se pudo guardar el N°: ${error.code === "23505" ? "esa retención ya tiene un certificado cargado" : error.message}. Probá de nuevo.`); return; }
    setEscribiendo(false); setNumero("");
    onCambio();
  };
  const quitar = async () => {
    const cargado = fila.certificadoCargado;
    if (!cargado || !confirm(`¿Quitar el certificado N° ${fila.certificado} de esta retención? Queda anulado (no se borra) y la retención vuelve a lo que diga su texto.`)) return;
    const { data } = await supabase.auth.getSession();
    const { error } = await db.from("certificados_retencion").update({ anulado: true, anulado_at: new Date().toISOString(), anulado_por: data.session?.user.id ?? null }).eq("id", cargado.id);
    if (error) { alert(`No se pudo quitar: ${error.message}. Probá de nuevo.`); return; }
    onCambio();
  };

  if (fila.certificado) return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="font-mono text-xs">{fila.certificado}</span>
      {fila.certificadoCargado?.url && (
        <a href={fila.certificadoCargado.url} target="_blank" rel="noopener noreferrer" onClick={parar} title="Ver el certificado" className="text-zinc-400 hover:text-orange-600"><Paperclip className="h-3 w-3" /></a>
      )}
      {fila.certificadoCargado && (
        <button type="button" onClick={(e) => { parar(e); void quitar(); }} title="Quitar este N° (queda anulado, no se borra)" className="text-zinc-300 hover:text-red-600 dark:text-zinc-600"><X className="h-3 w-3" /></button>
      )}
    </span>
  );
  if (escribiendo) return (
    <span className="flex items-center gap-1" onClick={parar}>
      <input autoFocus value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="N° del certificado"
        onKeyDown={(e) => { if (e.key === "Enter") void guardar(); if (e.key === "Escape") setEscribiendo(false); }}
        className="h-7 w-36 rounded-md border border-zinc-300 bg-white px-1.5 font-mono text-xs dark:border-zinc-600 dark:bg-zinc-800" />
      <button type="button" disabled={guardando || !numero.trim()} onClick={() => void guardar()} title="Guardar el N°"
        className="rounded-md border border-orange-300 px-1.5 py-0.5 text-xs font-medium text-orange-700 disabled:opacity-40 dark:border-orange-700 dark:text-orange-300">
        {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
      </button>
      <button type="button" onClick={() => setEscribiendo(false)} title="Cancelar" className="text-zinc-400 hover:text-zinc-600"><X className="h-3 w-3" /></button>
    </span>
  );
  return (
    <button type="button" onClick={(e) => { parar(e); if (fila.movimientoId) setEscribiendo(true); }}
      title="Sin el N° de certificado no se puede computar. Tocá para escribirlo a mano (o usá «Cargar certificado (IA)»)."
      className="text-xs font-medium text-amber-600 underline decoration-dotted underline-offset-2 hover:text-orange-700 dark:text-amber-400">falta</button>
  );
}
